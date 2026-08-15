/**
 * Etapa A: contexto de la petición, los siete términos del score, el muestreo
 * softmax con top-K y el bucle de selección de un día. Port de
 * `services/solver/app/solver/scoring.py:188-514` y DISENO §2.
 *
 * El módulo más delicado del port, por dos razones que conviene tener delante
 * antes de tocar nada:
 *
 *  1. **Es donde se consume la aleatoriedad de la etapa A**, y con un modelo de
 *     consumo que tiene un atajo: `muestrear` devuelve SIN sortear cuando queda
 *     un único candidato. Ese atajo es contrato (DISENO §2.6). Si se «limpia»
 *     llamando siempre al RNG, no falla nada: simplemente sale otro plan, y el
 *     bug es indistinguible de un cambio de datos.
 *  2. **Es el bucle caliente.** `scoreSlot` se ejecuta 300-670 veces por semana
 *     y recorre el pool entero cada vez. En el backend sobraba tiempo porque
 *     numpy lo hacía en C; aquí cada línea de numpy es un bucle sobre P.
 *
 * Sobre la precisión: Python calcula el score con arrays float32 y lo devuelve
 * con `.astype(np.float32)`. Aquí se acumula en float64 y se materializa una
 * sola vez al escribir en el `Float32Array` de salida. NO se aplica `Math.fround`
 * en cada operación intermedia: no daría paridad de todas formas —`Math.acos`
 * de V8 no está obligado a coincidir a 1 ULP con la libm de CPython— y costaría
 * rendimiento real. La decisión está tomada y escrita en docs/port-typescript.md;
 * lo que sí se respeta es materializar float32 donde Python lo materializa:
 * `vectorMacro`, `despPre`, `costPre`, `solPre`, `penRep` y el score final.
 *
 * DIVERGENCIA de estructura, no de resultado: Python recalcula los siete
 * términos en cada `scoreSlot`. Aquí `desp` y `cost` se precalculan una vez por
 * petición y `sol` una vez por día, porque no dependen del slot ni del residuo.
 * Reduce el trabajo de popcount unas 60 veces sin cambiar ni un bit (ver
 * `Contexto.despPre` en tipos.ts). El precio es que `bitsSemana` y `solPre`
 * pueden desincronizarse: quien mute `bitsSemana` DEBE llamar a
 * `recalcularSolape`.
 */

import type { CatalogoCompilado } from "./catalogo.ts";
import {
  DECAIMIENTO_REPETICION,
  FRACCION_MINIMA_PRECIOS,
  IDX_KCAL,
  IDX_SLOT,
  N_NUTR,
  PESO_SLOT,
  SIN_LIMITE_MINUTOS,
  TOP_K,
  W_AFIN,
  W_COST,
  W_DESP,
  W_ESC,
  W_FIT,
  W_REP,
  W_SOL,
} from "./constantes.ts";
import {
  clamp,
  comparaId,
  desviacionPoblacional,
  normaL2,
  ordenarPorScoreEId,
  popcountAnd,
  softmaxEstable,
  umbralTopK,
} from "./numerico.ts";
import { bitsDe, topesPorSlot } from "./pool.ts";
import type { Rng } from "./rng.ts";
import type { Contexto, Pool, RestriccionesGeneracion, SlotComida } from "./tipos.ts";

export type { Contexto };

// ---------------------------------------------------------------------------
// Constantes del módulo
//
// No van a constantes.ts por el mismo criterio que las de `rng.ts` y las
// máscaras SWAR de `numerico.ts`: constantes.ts es el port de
// `app/solver/__init__.py`, donde viven los parámetros de producto. Éstas son
// piezas de la definición de las fórmulas de scoring.py y sólo tienen sentido
// junto a ellas. Lo que sí comparten es la regla operativa: tocar cualquiera de
// estos números cambia los planes y obliga a subir VERSION_GENERADOR.
// ---------------------------------------------------------------------------

/**
 * Columnas de `vMacro`: proteína, carbohidrato y grasa. Mismo razonamiento que
 * el `N_MACROS` de pool.ts: no es un parámetro que se pueda subir, es la aridad
 * de un vector. Se nombra para que el `3` de los índices no parezca otro `3`.
 */
const N_MACROS = 3;

/**
 * Factores de Atwater (kcal por gramo). Convierten el residuo en gramos a un
 * residuo en kcal antes de normalizar, que es lo que hace comparables el perfil
 * de la receta y el del día. Son los mismos con los que el compilador de
 * catálogo calcula `vMacro`: si divergen, el coseno compara dos cosas distintas.
 */
const ATWATER_PROTEINA = 4.0;
const ATWATER_CARBOHIDRATO = 4.0;
const ATWATER_GRASA = 9.0;

/**
 * 2/π. Normaliza el ángulo de [0, π] a [0, 1] para que `fit` caiga en el mismo
 * rango que los otros seis términos. DISENO §2.2(a).
 */
const DOS_ENTRE_PI = 2.0 / Math.PI;

/**
 * Valor neutro de `fit`. Se usa en dos casos DISTINTOS entre sí y con la misma
 * justificación: una infusión no encaja ni desencaja composicionalmente
 * (`tieneMacro` falso), y un día con los macros ya cubiertos no tiene dirección
 * que comparar (el residuo da el vector nulo). En ese segundo caso vale 0,5 para
 * TODO el pool y el término deja de discriminar a propósito.
 */
const FIT_NEUTRO = 0.5;

/**
 * φ_afin es el vector nulo (`scoring.py:374-375`): el contrato no trae
 * preferencias de comida, así que el término existe pero no aporta.
 *
 * Se deja escrito como `W_AFIN * AFIN_NEUTRA` en vez de elidirlo porque así el
 * código dice la verdad: el término está y vale cero, sea cual sea W_AFIN
 * —exactamente como en Python, donde multiplicar el peso por un array de ceros
 * da cero aunque alguien ponga W_AFIN = 0,8—. El motor de JS pliega el producto
 * de dos constantes, así que no cuesta nada en el bucle caliente.
 */
const AFIN_NEUTRA = 0.0;

/**
 * Guarda de las tres divisiones de `esc` (kcal de la receta, escalaMin, η).
 *
 * En Python es `np.maximum(x, 1e-6)` y aquí hay que copiarlo literalmente por
 * una razón que no es cosmética: una división por cero en numpy avisa, y en JS
 * devuelve Infinity en silencio. Un `esc` infinito contamina el score, el score
 * infinito lo descarta `Number.isFinite` en `muestrear`, y la receta desaparece
 * del muestreo sin que nada falle.
 */
const EPS_DIVISION = 1e-6;

/**
 * Suelo de la desviación típica del z-score. Sin él, un top-K con todos los
 * scores iguales (habitual: `fit` vale 0,5 para media tabla con un pool corto)
 * daría 0/0. Con él, la distribución queda uniforme, que es la respuesta
 * correcta cuando nada discrimina. DISENO §2.4.
 */
const DESVIACION_MINIMA = 1e-3;

/** Suelo de la temperatura. Evita el 1/0 de `logits = z / tau` con tau = 0. */
const TAU_MINIMA = 1e-6;

// ---------------------------------------------------------------------------
// Buffers de trabajo
//
// Estado de módulo, y puede serlo porque el motor corre en un único hilo (un
// worker, sin SharedArrayBuffer) y ninguna de estas funciones cede el control
// entre que llena un buffer y lo consume. Evitan asignar del orden de 500 × P
// elementos por semana generada, que es lo que separa «decenas de ms» de
// «segundos de hilo bloqueado».
// ---------------------------------------------------------------------------

/**
 * Código de admisibilidad por fila, escrito por `scoreSlot`:
 * 0 = inadmisible, 1 = admisible pero vetado, 3 = admisible y no vetado.
 *
 * Un solo array con dos bits en vez de dos máscaras booleanas: la regla de los
 * vetos («si dejan algo que elegir, mandan; si no, ceden») necesita las dos
 * lecturas, y con un byte se resuelven las dos en la misma pasada de caché.
 */
const ADM_NO = 0;
const ADM_CEDE = 1;
const ADM_ESTRICTA = 3;
let bufMascara = new Uint8Array(0);

/** Índices candidatos de `muestrear`, y sus valores para el umbral del top-K. */
let bufValidos = new Int32Array(0);
let bufValores = new Float32Array(0);
let bufEmpatados = new Int32Array(0);
/** z-scores y probabilidades del softmax, en float64 como en Python. */
let bufLogits = new Float64Array(0);
let bufProbabilidades = new Float64Array(0);

function mascaraDe(p: number): Uint8Array {
  if (bufMascara.length < p) bufMascara = new Uint8Array(p);
  return bufMascara;
}

function buffersDeMuestreo(p: number): void {
  if (bufValidos.length >= p) return;
  bufValidos = new Int32Array(p);
  bufValores = new Float32Array(p);
  bufEmpatados = new Int32Array(p);
  bufLogits = new Float64Array(p);
  bufProbabilidades = new Float64Array(p);
}

/** El vector de macros del residuo. Tres componentes: se reutiliza y ya está. */
const vectorResiduo = new Float64Array(N_MACROS);

// ---------------------------------------------------------------------------
// Reparto por slots
// ---------------------------------------------------------------------------

/**
 * Reparto calórico por slot, renormalizado al subconjunto pedido.
 * `scoring.py:211-214`. DISENO §2.1.
 *
 * El `Record` que devuelve contiene SÓLO los slots pedidos, aunque el tipo
 * prometa los cinco; es la misma media verdad que documenta `Contexto.cuota` en
 * tipos.ts, y por eso todos los consumidores leen con `?? 1.0`, igual que el
 * `ctx.cuota.get(slot, 1.0)` de Python.
 *
 * Las repeticiones NO se deduplican: el total suma el peso de cada aparición,
 * exactamente como el `sum(PESO_SLOT[s] for s in slots)` de Python. Pedir
 * ['comida', 'comida'] da cuota 0,5, no 1,0. Es raro, pero es lo que hace el
 * original y no es este el sitio de arreglarlo.
 *
 * DIVERGENCIA declarada: Python lanza `ZeroDivisionError` con la lista vacía y
 * aquí se lanza un Error con mensaje. Dejarlo dividir por cero daría `Infinity`
 * en cada cuota y un residuo NaN cuatro llamadas más abajo, que es el fallo que
 * cuesta media tarde encontrar.
 */
export function cuotasDe(slots: readonly SlotComida[]): Record<SlotComida, number> {
  let total = 0;
  for (const s of slots) total += PESO_SLOT[s];
  if (!(total > 0)) {
    throw new Error("cuotasDe: no hay slots que repartir (la lista viene vacía)");
  }
  const salida = {} as Record<SlotComida, number>;
  for (const s of slots) salida[s] = PESO_SLOT[s] / total;
  return salida;
}

/**
 * Slots por cuota descendente, desempatando por el orden canónico de SLOTS.
 * `scoring.py:217-224`. DISENO §2.1.
 *
 * Determinista y además correcto: los slots grandes consumen la mayor parte del
 * presupuesto nutricional y deben elegir primero, porque el residuo que dejan
 * condiciona a los pequeños y no al revés. Como el orden se deriva aquí, **el
 * orden en que la petición liste los slots no afecta al plan**, que es lo que
 * permite que dos peticiones equivalentes den el mismo resultado.
 *
 * Deduplica, igual que el `set(slots)` de Python. La clave de orden es total
 * (peso, índice canónico), así que no depende de la estabilidad del `sort`.
 */
export function ordenDeSlots(slots: readonly SlotComida[]): SlotComida[] {
  const unicos = [...new Set(slots)];
  unicos.sort((a, b) => {
    const pa = PESO_SLOT[a];
    const pb = PESO_SLOT[b];
    if (pa !== pb) return pa > pb ? -1 : 1;
    return IDX_SLOT[a] - IDX_SLOT[b];
  });
  return unicos;
}

// ---------------------------------------------------------------------------
// Precálculos por petición
// ---------------------------------------------------------------------------

/**
 * Decaimiento 0,85 por día sobre `recetasRecientes`. `scoring.py:227-251`.
 * DISENO §2.2(f).
 *
 * Por contrato la lista llega ordenada de más reciente a más antigua; con |S|
 * slots por día, la posición estima los días transcurridos. Sólo cuenta la
 * PRIMERA aparición de cada receta: si una salió ayer y también hace dos
 * semanas, manda ayer.
 *
 * Dos sutilezas que un port razonable rompe, y las dos cambian los exponentes:
 *
 *  - `pos` es el índice en la lista COMPLETA, duplicados incluidos. El salto de
 *    los ya vistos NO decrementa la posición: un duplicado consume un hueco y
 *    desplaza la estimación de días de todo lo que viene detrás. Deduplicar la
 *    lista antes de recorrerla da otro resultado.
 *  - La indirección es doble: id → fila del catálogo → posición del pool. Las
 *    recetas recientes que no pasaron los filtros duros tienen −1 y se ignoran
 *    en silencio, igual que los ids que el catálogo ya no conoce.
 */
export function penalizacionRepeticion(
  cat: CatalogoCompilado,
  pool: Pool,
  recientes: readonly string[],
  nSlots: number,
): Float32Array {
  const pen = new Float32Array(pool.p);
  if (recientes.length === 0 || nSlots <= 0) return pen;
  const vistos = new Set<string>();
  for (let pos = 0; pos < recientes.length; pos++) {
    const rid = recientes[pos] ?? "";
    if (vistos.has(rid)) continue;
    vistos.add(rid);
    const fila = cat.idxPorId.get(rid);
    if (fila === undefined) continue;
    const j = pool.mapaFila[fila] ?? -1;
    // `Math.floor` y no `| 0` ni `~~`: son equivalentes sólo para no negativos
    // y para valores por debajo de 2^31, y aquí no hay razón para apostar.
    if (j >= 0) pen[j] = DECAIMIENTO_REPETICION ** Math.floor(pos / nSlots);
  }
  return pen;
}

/**
 * Cobertura de un bitset sobre el pool: `popcount(bits_r & mascara) / |I_r|`.
 *
 * Es el cuerpo compartido de `desp` (§2.2c) y `sol` (§2.2d), que en Python son
 * la misma línea con distinto bitset. Los dos son COBERTURA, no Jaccard: el
 * denominador es el número de ingredientes de la receta y no el de la unión.
 * Jaccard dividiría por algo que crece con los días ya planificados, así que el
 * mismo solape puntuaría cada vez menos y hacia el viernes el término se
 * apagaría solo.
 *
 * El denominador es `max(nIngr, 1)` y no `nIngr`: una receta sin ingredientes
 * registrados daría 0/0. Y `nIngr` es `len(ingredientes)` del JSONL, que NO
 * tiene por qué coincidir con el popcount de la fila (ingredientes repetidos, o
 * alimentos que no entraron en el vocabulario): en ese caso la cobertura queda
 * por debajo de 1. No es un bug a corregir aquí, es el comportamiento vigente.
 *
 * Se escribe en un `Float32Array` porque Python lo materializa en float32.
 */
function cobertura(pool: Pool, mascara: Uint32Array, salida: Float32Array): void {
  const w = pool.w32;
  for (let i = 0; i < pool.p; i++) {
    const n = Math.max(pool.nIngr[i] ?? 0, 1);
    salida[i] = popcountAnd(pool.bits, i * w, mascara, 0, w) / n;
  }
}

/**
 * Recalcula `solPre` a partir de `ctx.bitsSemana`. Hay que llamarla cada vez que
 * la etapa D cierra un día y acumula los ingredientes de su mejor candidato.
 *
 * Existe porque el precálculo del solape es la única parte del contexto que
 * cambia DENTRO de una petición. Si alguien muta `bitsSemana` y no llama aquí,
 * el término de solape se queda congelado en el día anterior y el fallo es
 * invisible: el plan sale, sólo que con más líneas de la compra de las que
 * debería. No se puede detectar desde aquí sin volver a hacer el popcount, que
 * es justo lo que se quería evitar; así que es contrato del llamante.
 */
export function recalcularSolape(pool: Pool, ctx: Contexto): void {
  cobertura(pool, ctx.bitsSemana, ctx.solPre);
}

/**
 * Precalcula por petición todo lo que el score reutiliza en cada slot.
 * `scoring.py:254-279`.
 *
 * La puerta del término de coste (§2.2e) es lo único con lógica de verdad:
 *
 *  - sin presupuesto (ausente o ≤ 0) → `sin_presupuesto`;
 *  - menos de FRACCION_MINIMA_PRECIOS (80 %) del POOL con precio conocido, o
 *    pool vacío → `precios_incompletos`.
 *
 * En los dos casos el término se apaga ENTERO (peso 0), no se degrada: puntuar
 * con precios inventados es peor que no puntuar. El motivo viaja a la traza y la
 * UI ya lo consume, así que los dos literales son contrato.
 *
 * La media se calcula sobre el POOL y no sobre el catálogo: lo que importa es la
 * cobertura de precios de lo que el usuario puede comer, no la global.
 *
 * Comportamiento vigente que NO se corrige: el término lee `costeCents` sin
 * mirar `costeConocido` fila a fila, y una receta sin precio tiene coste 0, así
 * que sale «gratis» y queda favorecida. Como máximo afecta al 20 % del pool por
 * la puerta de arriba, pero es un sesgo real y portarlo distinto cambiaría los
 * planes.
 */
export function contextoDe(
  cat: CatalogoCompilado,
  pool: Pool,
  restr: RestriccionesGeneracion,
  nDias: number,
  tau: number,
): Contexto {
  const slots = restr.slots;
  let pesoCoste = W_COST;
  let umbral = 0.0;
  let motivo: string | null = null;

  const presupuesto = restr.presupuestoSemanalCents;
  if (presupuesto === undefined || presupuesto <= 0) {
    pesoCoste = 0.0;
    motivo = "sin_presupuesto";
  } else if (pool.p === 0 || fraccionConPrecio(pool) < FRACCION_MINIMA_PRECIOS) {
    pesoCoste = 0.0;
    motivo = "precios_incompletos";
  } else {
    umbral =
      presupuesto / Math.max(1, nDias * slots.length * Math.max(1, restr.comensales));
  }

  const despPre = new Float32Array(pool.p);
  const costPre = new Float32Array(pool.p);
  const solPre = new Float32Array(pool.p);
  const bitsDespensa = bitsDe(cat, restr.despensaAlimentoIds ?? []);
  cobertura(pool, bitsDespensa, despPre);

  if (pesoCoste > 0.0) {
    const b = Math.max(umbral, EPS_DIVISION);
    for (let i = 0; i < pool.p; i++) {
      costPre[i] = clamp(((pool.costeCents[i] ?? 0) - b) / b, 0.0, 1.0);
    }
  }
  // `solPre` se queda en ceros: `bitsSemana` arranca vacío y el primer día el
  // término de solape no distorsiona. La etapa D lo recalcula al cerrar cada día.

  return {
    cuota: cuotasDe(slots),
    topes: topesPorSlot(restr),
    bitsDespensa,
    bitsSemana: new Uint32Array(pool.w32),
    penRep: penalizacionRepeticion(
      cat,
      pool,
      restr.recetasRecientes ?? [],
      slots.length,
    ),
    pesoCoste,
    umbralCoste: umbral,
    tau,
    costeDesactivadoPor: motivo,
    vetoSemana: null,
    vetoSlot: new Map<SlotComida, number>(),
    despPre,
    costPre,
    solPre,
  };
}

/** `pool.coste_conocido.mean()`: fracción de filas del pool con precio real. */
function fraccionConPrecio(pool: Pool): number {
  let n = 0;
  for (let i = 0; i < pool.p; i++) if ((pool.costeConocido[i] ?? 0) !== 0) n++;
  return n / pool.p;
}

// ---------------------------------------------------------------------------
// El score
// ---------------------------------------------------------------------------

/**
 * Fracciones calóricas normalizadas (P, C, G) del residuo, escritas en `salida`.
 * Devuelve `false` si el vector es nulo. `scoring.py:287-303`. DISENO §2.2(a).
 *
 * El vector nulo significa «el día ya está cubierto»: en ese caso el encaje
 * composicional deja de discriminar y el score debe decidirlo el resto de
 * términos, no una dirección de signo arbitrario. Por eso el llamante necesita
 * saber si hubo vector o no, y por eso esta función devuelve un booleano en vez
 * de dejar que `scoreSlot` compruebe tres componentes contra cero: es el
 * `np.any(v_res)` de Python, con nombre.
 *
 * TRAMPA del port: el clamp a 0 es COMPONENTE A COMPONENTE, no del vector
 * entero. Un residuo con la proteína ya cubierta (negativa) y el carbohidrato
 * pendiente da un vector válido con la proteína a cero, no un vector nulo.
 *
 * Las tres componentes se redondean a float32 porque Python las materializa en
 * float32 (`.astype`) antes de multiplicarlas por `vMacro`, que también lo es.
 * Son tres `fround`, no P: aquí el redondeo es gratis y elimina una divergencia.
 */
export function vectorMacro(residuo: Float64Array, salida: Float64Array): boolean {
  const prot = Math.max(residuo[1] ?? 0, 0.0);
  const carb = Math.max(residuo[2] ?? 0, 0.0);
  const grasa = Math.max(residuo[3] ?? 0, 0.0);
  const kProt = ATWATER_PROTEINA * prot;
  const kCarb = ATWATER_CARBOHIDRATO * carb;
  const kGrasa = ATWATER_GRASA * grasa;
  const total = kProt + kCarb + kGrasa;
  if (total <= 0) {
    salida[0] = 0;
    salida[1] = 0;
    salida[2] = 0;
    return false;
  }
  salida[0] = kProt / total;
  salida[1] = kCarb / total;
  salida[2] = kGrasa / total;
  const norma = normaL2(salida, N_MACROS);
  if (norma <= 0) {
    salida[0] = 0;
    salida[1] = 0;
    salida[2] = 0;
    return false;
  }
  salida[0] = Math.fround((salida[0] ?? 0) / norma);
  salida[1] = Math.fround((salida[1] ?? 0) / norma);
  salida[2] = Math.fround((salida[2] ?? 0) / norma);
  return (salida[0] ?? 0) !== 0 || (salida[1] ?? 0) !== 0 || (salida[2] ?? 0) !== 0;
}

/**
 * Puntúa TODO el pool para un slot y escribe (P,) en `salida`, con −Infinity en
 * lo inadmisible. `scoring.py:306-386`.
 *
 * **Admisibilidad antes de puntuar**, en dos niveles que no son lo mismo:
 *
 *  - Duro y sin apelación: la receta admite ese slot, no está ya elegida hoy y
 *    cabe en el tope de minutos DE ESE SLOT. El pool ya filtró por el máximo de
 *    los topes, que es una cota laxa; el filtro fino es éste y sólo éste.
 *  - Vetos de variedad semanal (`vetoSemana`, `vetoSlot`): se aplican SÓLO si
 *    dejan algo que elegir. Es, literalmente, la única restricción del servicio
 *    que cede, y cede porque no es de seguridad: con un catálogo corto,
 *    exigirlos a rajatabla dejaría al usuario sin plan, y una repetición de más
 *    es infinitamente mejor que un fallo.
 *
 * Python calcula los siete términos para TODAS las filas y sólo al final
 * sustituye las inadmisibles por −inf; es desperdicio deliberado por
 * vectorización. Aquí se saltan, que ahorra trabajo real y no cambia el
 * resultado porque el valor descartado nunca se lee.
 */
export function scoreSlot(
  pool: Pool,
  ctx: Contexto,
  slot: SlotComida,
  residuo: Float64Array,
  excluidas: Uint8Array,
  salida: Float32Array,
): void {
  const p = pool.p;
  if (p === 0) return;

  // --- Admisibilidad y vetos ---------------------------------------------
  const bitSlot = 1 << IDX_SLOT[slot];
  const tope = ctx.topes[slot] ?? SIN_LIMITE_MINUTOS;
  const vetoSemana = ctx.vetoSemana;
  const vetoAyer = ctx.vetoSlot.get(slot) ?? -1;
  const mascara = mascaraDe(p);
  let hayEstricta = false;
  for (let i = 0; i < p; i++) {
    if (
      ((pool.mSlot[i] ?? 0) & bitSlot) === 0 ||
      (excluidas[i] ?? 0) !== 0 ||
      (pool.minutos[i] ?? 0) > tope
    ) {
      mascara[i] = ADM_NO;
      continue;
    }
    const vetada = (vetoSemana !== null && (vetoSemana[i] ?? 0) !== 0) || i === vetoAyer;
    if (vetada) {
      mascara[i] = ADM_CEDE;
    } else {
      mascara[i] = ADM_ESTRICTA;
      hayEstricta = true;
    }
  }
  // `if estricto.any(): admisible = estricto`. Si ningún candidato sobrevive a
  // los vetos, se puntúa el conjunto laxo entero.
  const exigido = hayEstricta ? ADM_ESTRICTA : ADM_CEDE;

  // --- Precálculos que no dependen de la fila -----------------------------
  const hayMacro = vectorMacro(residuo, vectorResiduo);
  const v0 = vectorResiduo[0] ?? 0;
  const v1 = vectorResiduo[1] ?? 0;
  const v2 = vectorResiduo[2] ?? 0;
  // `ctx.cuota` sólo trae los slots pedidos; el 1,0 es el `dict.get(slot, 1.0)`
  // de Python, no una salvaguarda inventada.
  const cuota = ctx.cuota[slot] ?? 1.0;
  const numeradorEta = Math.max(residuo[IDX_KCAL] ?? 0, 0.0) * cuota;
  const pesoCoste = ctx.pesoCoste;
  const despPre = ctx.despPre;
  const solPre = ctx.solPre;
  const costPre = ctx.costPre;
  const penRep = ctx.penRep;
  const nutr = pool.nutr;
  const vMacro = pool.vMacro;

  for (let i = 0; i < p; i++) {
    if ((mascara[i] ?? 0) < exigido) {
      salida[i] = -Infinity;
      continue;
    }

    // (a) Encaje composicional: distancia angular, NO coseno crudo. §2.2a
    // Los dos vectores viven en el octante no negativo y sus componentes suman
    // ~1 antes de normalizar, así que el coseno se comprime contra 1 (mediana
    // medida: 0,946) y casi no discrimina. `acos` es lineal justo donde el
    // coseno es plano: multiplica la dispersión por 1,66 y el orden del top-K
    // deja de depender del ruido del float32.
    let fit = FIT_NEUTRO;
    if (hayMacro && (pool.tieneMacro[i] ?? 0) !== 0) {
      const o = i * N_MACROS;
      const cos = (vMacro[o] ?? 0) * v0 + (vMacro[o + 1] ?? 0) * v1 + (vMacro[o + 2] ?? 0) * v2;
      fit = 1.0 - DOS_ENTRE_PI * Math.acos(clamp(cos, -1.0, 1.0));
    }

    // (b) Encaje de escala: cociente, NUNCA resta. §2.2b
    // Restar factores de ración mezcla unidades y castiga brutalmente a las
    // recetas ligeras. El cociente es invariante a escala, cae en (0,1] y
    // penaliza igual «necesito la mitad» que «necesito el doble».
    // Si el residuo de kcal ya es ≤ 0, η = 0 y esc = 0 para TODO el pool, no 1:
    // no discrimina, pero desplaza el score en −2,0 y con ello la media y la σ
    // del z-score del muestreo. Reproducirlo tal cual.
    const eta = numeradorEta / Math.max(nutr[i * N_NUTR + IDX_KCAL] ?? 0, EPS_DIVISION);
    const eMin = pool.escalaMin[i] ?? 0;
    const eMax = pool.escalaMax[i] ?? 0;
    let esc: number;
    if (eta < eMin) esc = eta / Math.max(eMin, EPS_DIVISION);
    else if (eta > eMax) esc = eMax / Math.max(eta, EPS_DIVISION);
    else esc = 1.0;

    // (c)(d)(e) Despensa, solape y coste: precalculados. Ver la cabecera.
    // (f) Repetición: precalculada una vez por petición en `contextoDe`.
    // (g) Afinidad: el término existe y vale cero.
    salida[i] =
      W_FIT * fit +
      W_ESC * esc +
      W_DESP * (despPre[i] ?? 0) +
      W_SOL * (solPre[i] ?? 0) +
      W_AFIN * AFIN_NEUTRA -
      pesoCoste * (costPre[i] ?? 0) -
      W_REP * (penRep[i] ?? 0);
  }
}

// ---------------------------------------------------------------------------
// Muestreo
// ---------------------------------------------------------------------------

/**
 * Softmax con temperatura sobre los z-scores del top-K. `scoring.py:389-436`.
 * DISENO §2.4. Devuelve el índice de pool elegido, o `null` si no hay ninguno.
 *
 * **Es el punto crítico de reproducibilidad del motor entero.** Tres decisiones,
 * y las tres importan:
 *
 *  1. El top-K recorta la cola larga que sólo aporta ruido y hace el coste
 *     independiente de |P|.
 *  2. El orden explícito por (−score, id) es OBLIGATORIO. La selección por
 *     particionado no define qué empatados deja dentro del corte, y ordenar
 *     después no lo arregla porque lo que varía es qué ENTRA. Por eso el
 *     particionado se usa SÓLO para obtener el valor umbral —que sí es único
 *     sea cual sea la permutación— y los empates en ese umbral se resuelven por
 *     id ascendente. Es, según el propio docstring del original, «el fallo de
 *     reproducibilidad más fácil de introducir».
 *  3. Estandarizar antes del softmax da a `tau` un significado estable: sin
 *     ello la dispersión del score cambia con el residuo y la misma tau
 *     significa «casi determinista» en un slot y «casi uniforme» en otro.
 *
 * **ATAJO LOAD-BEARING**: con un único candidato se devuelve SIN tocar el RNG.
 * No es una optimización, es contrato del árbol de semillas (DISENO §2.6): el
 * flujo de cada nodo depende de cuántos sorteos consume, y consumir uno de más
 * aquí desplaza todo lo que venga detrás en ese nodo. No falla nada; sale otro
 * plan. Hay un test que cuenta los sorteos y afirma que son cero.
 */
export function muestrear(
  scores: Float32Array,
  p: number,
  ids: readonly string[],
  tau: number,
  rng: Rng,
): number | null {
  if (p <= 0) return null;
  buffersDeMuestreo(p);
  const validos = bufValidos;

  let n = 0;
  for (let i = 0; i < p; i++) {
    // `Number.isFinite` es el `np.isfinite`: descarta −Infinity (inadmisible) y
    // también NaN, que no debería llegar nunca pero elegiría al azar si llegara.
    if (Number.isFinite(scores[i])) {
      validos[n] = i;
      n++;
    }
  }
  if (n === 0) return null;

  if (n > TOP_K) {
    const valores = bufValores;
    for (let i = 0; i < n; i++) valores[i] = scores[validos[i] ?? 0] ?? 0;
    const umbral = umbralTopK(valores, n, TOP_K);

    // Estrictamente mejores y empatados en el umbral, por separado y cada grupo
    // en orden de índice ascendente, que es el orden en el que `flatnonzero`
    // los produce en Python. El orden importa: si hay que recortar empatados,
    // se recortan por id, y el desempate final del recorte es la posición.
    const empatados = bufEmpatados;
    let nMejores = 0;
    let nEmpatados = 0;
    for (let i = 0; i < n; i++) {
      const j = validos[i] ?? 0;
      const s = scores[j] ?? 0;
      if (s > umbral) {
        validos[nMejores] = j;
        nMejores++;
      } else if (s === umbral) {
        empatados[nEmpatados] = j;
        nEmpatados++;
      }
    }
    const huecos = TOP_K - nMejores;
    if (nEmpatados > huecos) {
      empatados.subarray(0, nEmpatados).sort((a, b) => {
        const c = comparaId(ids[a] ?? "", ids[b] ?? "");
        return c !== 0 ? c : a - b;
      });
      nEmpatados = huecos;
    }
    for (let i = 0; i < nEmpatados; i++) validos[nMejores + i] = empatados[i] ?? 0;
    n = nMejores + nEmpatados;
  }

  ordenarPorScoreEId(validos, n, scores, ids);
  // ATAJO: cero sorteos. Ver la cabecera de la función.
  if (n === 1) return validos[0] ?? null;

  const logits = bufLogits;
  // Los scores se promocionan a float64 YA redondeados a float32, igual que el
  // `scores[cand].astype(np.float64)` de Python: la media y la desviación se
  // calculan sobre los valores redondeados, no sobre los exactos.
  for (let i = 0; i < n; i++) logits[i] = scores[validos[i] ?? 0] ?? 0;
  const { media, desv } = desviacionPoblacional(logits, n);
  // Las DOS divisiones van separadas, como en Python (`z = …/std` y luego
  // `logits = z/tau`). Fundirlas en `/(std·tau)` es algebraicamente lo mismo y
  // numéricamente no: redondea una vez en vez de dos, y una diferencia de 1 ULP
  // en un logit basta para voltear el orden de dos candidatos empatados.
  const desvSegura = Math.max(desv, DESVIACION_MINIMA);
  const tauSegura = Math.max(tau, TAU_MINIMA);
  for (let i = 0; i < n; i++) {
    logits[i] = (((logits[i] ?? 0) - media) / desvSegura) / tauSegura;
  }

  const probabilidades = bufProbabilidades;
  softmaxEstable(logits, n, probabilidades);
  return validos[rng.choice(n, probabilidades)] ?? null;
}

// ---------------------------------------------------------------------------
// Selección de un día
// ---------------------------------------------------------------------------

/**
 * Factor de ración que la etapa A considera sensato. `scoring.py:439-450`.
 * DISENO §2.5.
 *
 * Se usa dos veces y las dos importan: para actualizar el residuo —restar la
 * ración REAL y no 1,0, que dejaría un residuo inflado y elegiría los slots
 * siguientes contra un objetivo falso— y como ancla del desempate del
 * porcionado (el σ_ref de §3.3).
 */
export function sigmaSugerido(
  pool: Pool,
  j: number,
  residuo: Float64Array,
  cuota: number,
): number {
  const kcal = pool.nutr[j * N_NUTR + IDX_KCAL] ?? 0;
  if (kcal <= 0) return 1.0;
  const eta = (Math.max(residuo[IDX_KCAL] ?? 0, 0.0) * cuota) / kcal;
  return clamp(eta, pool.escalaMin[j] ?? 0, pool.escalaMax[j] ?? 0);
}

/**
 * Elige una receta por slot recorriendo por cuota descendente.
 * `scoring.py:453-485`. DISENO §2.1.
 *
 * `rngPorSlot(slot)` devuelve el generador del nodo del árbol de semillas
 * correspondiente. Se inyecta para que este módulo no tenga que conocer la
 * estructura de la ruta —la conoce `reparacion.ts`— y se evalúa DENTRO del
 * bucle, un generador nuevo y desechable por slot.
 *
 * Devuelve `null` en cuanto un slot se queda literalmente sin candidatos, sin
 * intentar rellenar los que faltan: un día incompleto no es un día.
 *
 * DIVERGENCIA declarada respecto de la firma de Python: allí hay dos parámetros
 * opcionales más, `vetadas` y `tau`, que ningún llamante del servicio usa (la
 * etapa C construye su propia máscara y llama a `scoreSlot`/`muestrear` por
 * separado). Se omiten en vez de portarlos muertos; `docs/port-typescript.md`
 * declara esta firma.
 */
export function seleccionarDia(
  pool: Pool,
  ctx: Contexto,
  objetivoVec: Float64Array,
  slots: readonly SlotComida[],
  rngPorSlot: (slot: SlotComida) => Rng,
): Map<SlotComida, number> | null {
  const residuo = Float64Array.from(objetivoVec);
  const excluidas = new Uint8Array(pool.p);
  const scores = new Float32Array(pool.p);
  const elegidas = new Map<SlotComida, number>();

  for (const slot of ordenDeSlots(slots)) {
    scoreSlot(pool, ctx, slot, residuo, excluidas, scores);
    const j = muestrear(scores, pool.p, pool.ids, ctx.tau, rngPorSlot(slot));
    if (j === null) return null;
    elegidas.set(slot, j);
    excluidas[j] = 1; // sin repetir receta dentro del mismo día
    const sigma = sigmaSugerido(pool, j, residuo, ctx.cuota[slot] ?? 1.0);
    const base = j * N_NUTR;
    for (let k = 0; k < N_NUTR; k++) {
      residuo[k] = (residuo[k] ?? 0) - sigma * (pool.nutr[base + k] ?? 0);
    }
  }
  return elegidas;
}

/**
 * Σ σᵢ · nutrientesᵢ en float64. `scoring.py:488-493`.
 *
 * «La única fuente de los totales que se devuelven», dice el original, y no es
 * retórica: devolver unos totales que no sean exactamente A·σ hace que la suma
 * del día que enseña la UI no cuadre con las comidas que enseña la UI, y ése es
 * el fallo más caro posible porque destruye la confianza en todo el plan.
 */
export function totalesDe(
  pool: Pool,
  filas: readonly number[],
  sigmas: Float64Array,
): Float64Array {
  const total = new Float64Array(N_NUTR);
  for (let r = 0; r < filas.length; r++) {
    const base = (filas[r] ?? 0) * N_NUTR;
    const s = sigmas[r] ?? 0;
    for (let k = 0; k < N_NUTR; k++) {
      total[k] = (total[k] ?? 0) + s * (pool.nutr[base + k] ?? 0);
    }
  }
  return total;
}
