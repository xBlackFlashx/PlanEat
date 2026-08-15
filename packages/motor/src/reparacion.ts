/**
 * Etapa C — reparación dirigida. Port de
 * `services/solver/app/solver/reparacion.py:42-297` y DISENO §4.
 *
 * Produce un **candidato de día completo**: selección (etapa A) + porcionado
 * (etapa B) y, si el error se pasa del umbral, hasta tres sustituciones
 * dirigidas.
 *
 * Se sustituye **sólo el slot culpable**, no el día entero como pedía la spec
 * original. Tres razones, y siguen valiendo en el navegador: los otros slots
 * pueden estar bien y rehacerlos es tirar trabajo; el coste por intento baja
 * ~4× —se re-puntúa 1 slot y no 5, y `scoreSlot` es O(P)—; y como se guarda
 * siempre el mejor candidato visto, un intento peor nunca empeora el resultado.
 *
 * ---------------------------------------------------------------------------
 * LOAD-BEARING: el `Contexto` es MUTABLE y los días van EN ORDEN
 * ---------------------------------------------------------------------------
 *
 * Este módulo no muta `ctx`, pero lo LEE en tres campos que la etapa D reescribe
 * entre días: `bitsSemana` (a través de `solPre`), `vetoSemana` y `vetoSlot`.
 * Eso convierte a `generarCandidatoDia` en una función que depende del estado
 * acumulado de los días anteriores, y por tanto:
 *
 *  - los días DEBEN generarse estrictamente en orden creciente;
 *  - `ctx` NO debe convertirse en inmutable ni copiarse por día;
 *  - las llamadas NO se pueden paralelizar ni reordenar.
 *
 * Romper cualquiera de las tres no da un error: da otro plan, con el veto de
 * «lo mismo que ayer» apagado y el término de solape congelado en el día 0. Es
 * exactamente el tipo de fallo que se descubre en producción, mirando un plan
 * con lentejas dos días seguidos, y no en un test.
 *
 * ---------------------------------------------------------------------------
 * DIVERGENCIAS de DISENO.md que el port NO reproduce (verificadas en la
 * auditoría, `docs/auditoria-motor.md`, sección «Divergencias DISENO ↔ código»)
 * ---------------------------------------------------------------------------
 *
 *  1. `UMBRAL_ERROR_ACEPTABLE` (0,12). §4.2 dice que tras los tres intentos el
 *     día se marca como fallido si E > 0,12. `reparacion.py` ni siquiera
 *     importa la constante: la comprobación es única, sobre el PEOR día, y vive
 *     en `motor.py:299-301`, después de la etapa D y de `repararDuras`. Aquí no
 *     se comprueba nada: se devuelve el mejor visto, con el error que tenga.
 *  2. `items_bloqueados`. §4.2 describe saltar al siguiente κ si el slot
 *     culpable está bloqueado, y un culpable `items_bloqueados` para el
 *     diagnóstico. **No existe nada de eso en el código.** El único mecanismo de
 *     exclusión es el conjunto local `vetadas`. No se inventa.
 */

import {
  FACTOR_TEMPERATURA_REINTENTO,
  FRACCION_MINIMA_FIBRA,
  IDX_FIBRA,
  IDX_KCAL,
  IDX_SLOT,
  IDX_SODIO,
  MAX_INTENTOS_REPARACION,
  N_NUTR,
  RUTA_A,
  UMBRAL_ERROR_OK,
} from "./constantes.ts";
import { argsortEstableDesc, comparaId } from "./numerico.ts";
import { bandasDe, culpabilidad } from "./porciones.ts";
import { rngDe } from "./rng.ts";
import {
  muestrear,
  ordenDeSlots,
  scoreSlot,
  seleccionarDia,
  sigmaSugerido,
} from "./scoring.ts";
import type {
  Bandas,
  CandidatoDia,
  Contexto,
  ObjetivoNutricional,
  Pool,
  ResolverPorciones,
  ResultadoPorcionado,
  SlotComida,
} from "./tipos.ts";

export type { CandidatoDia };

// ---------------------------------------------------------------------------
// Buffers de trabajo
//
// Mismo criterio que en scoring.ts y numerico.ts: estado de módulo, legítimo
// porque el motor corre en un único hilo y ninguna de estas funciones cede el
// control entre que llena un buffer y lo consume. Aquí ahorran del orden de
// 7 días × 6 candidatos × 3 intentos = 126 asignaciones de P bytes y P flotantes
// por semana, que no es dramático pero sí gratis.
//
// `bufScores` NO colisiona con los buffers internos de `muestrear`: aquél lee
// éste y escribe en los suyos. Sí colisionaría con otro `scoreSlot` anidado, y
// no lo hay.
// ---------------------------------------------------------------------------

let bufScores = new Float32Array(0);
let bufExcluidas = new Uint8Array(0);

function buffersDe(p: number): void {
  if (bufScores.length >= p) return;
  bufScores = new Float32Array(p);
  bufExcluidas = new Uint8Array(p);
}

/**
 * Cuota del slot cuando `ctx.cuota` no lo trae. Es el `ctx.cuota.get(slot, 1.0)`
 * de Python y no una salvaguarda inventada: el `Record` sólo contiene los slots
 * de la petición (ver `Contexto.cuota` en tipos.ts), y todos los accesos reales
 * usan uno que sí está.
 */
const CUOTA_POR_DEFECTO = 1.0;

// ---------------------------------------------------------------------------
// El objetivo, visto por la etapa A
// ---------------------------------------------------------------------------

/**
 * Centro de cada banda: hacia dónde apunta el residuo de la etapa A.
 * `reparacion.py:66-83`.
 *
 * La etapa A no necesita el rango, sólo la dirección: lo que hace con este
 * vector es restarle lo ya elegido y comparar el resto contra el perfil de cada
 * receta. El cuadre fino contra los EXTREMOS lo hace el LP, que sí conoce la
 * banda muerta (§3.1). Apuntar a un extremo aquí sesgaría la selección entera
 * hacia un lado de la banda sin que el LP pudiera corregirlo.
 *
 * `fibraMinG` usa `|| 0` y no `?? 0` para replicar el `or 0.0` de Python: un
 * mínimo de fibra de 0 y la ausencia de mínimo son el mismo caso, «no se exige
 * fibra». `sodioMaxMg` sí usa `?? 0`, porque allí Python compara contra `None`.
 */
export function vectorObjetivo(objetivo: ObjetivoNutricional): Float64Array {
  const v = new Float64Array(N_NUTR);
  v[IDX_KCAL] = objetivo.kcal;
  v[1] = (objetivo.proteinaG.min + objetivo.proteinaG.max) / 2.0;
  v[2] = (objetivo.carbohidratoG.min + objetivo.carbohidratoG.max) / 2.0;
  v[3] = (objetivo.grasaG.min + objetivo.grasaG.max) / 2.0;
  v[IDX_FIBRA] = objetivo.fibraMinG || 0.0;
  v[IDX_SODIO] = objetivo.sodioMaxMg ?? 0.0;
  return v;
}

// ---------------------------------------------------------------------------
// Qué nutrientes tienen dato suficiente
// ---------------------------------------------------------------------------

/**
 * Qué nutrientes entran en el LP. `reparacion.py:86-109`. DISENO §8.5.
 *
 * Fibra y sodio son los dos campos con huecos reales en cualquier catálogo. Si
 * faltan, la restricción se IGNORA en vez de tratarse como cero: un cero
 * inventado desplaza el óptimo hacia recetas cuyo dato simplemente no existe,
 * que es una forma silenciosa de mentir —y además premia al catálogo peor
 * documentado, porque «sin dato» pasa a leerse como «sin sodio»—.
 *
 * La fibra se pondera por KCAL y no por número de recetas: lo que decide si el
 * total de fibra del día es fiable es qué fracción de la comida del día tiene
 * dato, y una infusión sin fibra declarada no invalida un día entero.
 *
 * Detalle que parece un caso imposible y no lo es: con `total <= 0` (todas las
 * recetas del día a 0 kcal) la fracción sale 0 y la fibra queda DESACTIVADA. Es
 * lo que hace Python y es lo correcto: sin kcal no hay evidencia de nada.
 *
 * El sodio es todo-o-nada (`conocido[:, IDX_SODIO].all()`) y no ponderado: el
 * objetivo de sodio es un MÁXIMO, y basta un item sin dato para que el total
 * pueda estar por encima sin que se note. Con la fibra —que es un mínimo— pasar
 * por alto un hueco sólo hace la estimación conservadora.
 */
export function nutrientesActivos(
  pool: Pool,
  filas: readonly number[],
  objetivo: ObjetivoNutricional,
): { activos: Uint8Array; fibraFiable: boolean } {
  const activos = new Uint8Array(N_NUTR).fill(1);
  if (filas.length === 0) return { activos, fibraFiable: true };

  let total = 0;
  let conFibra = 0;
  let sodioCompleto = true;
  for (let r = 0; r < filas.length; r++) {
    const j = filas[r] ?? 0;
    const base = j * N_NUTR;
    const kcal = pool.nutr[base + IDX_KCAL] ?? 0;
    total += kcal;
    if ((pool.conocido[base + IDX_FIBRA] ?? 0) !== 0) conFibra += kcal;
    if ((pool.conocido[base + IDX_SODIO] ?? 0) === 0) sodioCompleto = false;
  }

  const fracFibra = total > 0 ? conFibra / total : 0.0;
  const fibraFiable = fracFibra >= FRACCION_MINIMA_FIBRA;
  if (!fibraFiable) activos[IDX_FIBRA] = 0;
  if (objetivo.sodioMaxMg === undefined || objetivo.sodioMaxMg === null || !sodioCompleto) {
    activos[IDX_SODIO] = 0;
  }
  return { activos, fibraFiable };
}

// ---------------------------------------------------------------------------
// Porcionado y empaquetado de un día
// ---------------------------------------------------------------------------

/**
 * Monta la matriz `a` (6, R) row-major y llama al porcionador.
 * `reparacion.py:112-116`.
 *
 * `a` es la TRANSPUESTA de `pool.nutr[filas]`: seis filas de nutriente por R
 * recetas, igual que en numpy. Esa orientación no es un capricho de la
 * traducción: el descenso coordinado y `culpabilidad` recorren un nutriente
 * entero para todas las recetas, así que la fila de nutriente es la que tiene
 * que ser contigua.
 *
 * Se devuelve `a` junto al resultado porque el bucle de reparación la necesita
 * para calcular κ, y reconstruirla en cada intento sería recorrer el pool otra
 * vez para nada.
 */
function porcionar(
  pool: Pool,
  filas: readonly number[],
  sigmaRef: Float64Array,
  bandas: Bandas,
  resolver: ResolverPorciones,
): { a: Float64Array; res: ResultadoPorcionado } {
  const r = filas.length;
  const a = new Float64Array(N_NUTR * r);
  const lo = new Float64Array(r);
  const hi = new Float64Array(r);
  for (let j = 0; j < r; j++) {
    const fila = filas[j] ?? 0;
    const base = fila * N_NUTR;
    for (let n = 0; n < N_NUTR; n++) a[n * r + j] = pool.nutr[base + n] ?? 0;
    lo[j] = pool.escalaMin[fila] ?? 0;
    hi[j] = pool.escalaMax[fila] ?? 0;
  }
  return { a, res: resolver(a, r, lo, hi, sigmaRef, bandas) };
}

/**
 * Cierra un `CandidatoDia`. `reparacion.py:119-135`.
 *
 * `filas` y `slots` se COPIAN, no se referencian: el bucle de reparación muta
 * `filas` en sitio en cada intento, y un `mejor` que apuntase al mismo array se
 * reescribiría solo con la receta del intento siguiente. En Python el `list(…)`
 * hace lo mismo y es igual de load-bearing.
 *
 * `bits` es la unión de los bitsets de ingredientes del día (`bitwise_or.reduce`
 * en Python). La consume el término de solape (§2.2d) y el contador de
 * ingredientes únicos del recocido (§5.1).
 */
function empaquetar(
  pool: Pool,
  slotsOrden: readonly SlotComida[],
  filas: readonly number[],
  res: ResultadoPorcionado,
  intentos: number,
  fibraFiable: boolean,
): CandidatoDia {
  const w = pool.w32;
  const bits = new Uint32Array(w);
  for (let r = 0; r < filas.length; r++) {
    const off = (filas[r] ?? 0) * w;
    for (let k = 0; k < w; k++) bits[k] = ((bits[k] ?? 0) | (pool.bits[off + k] ?? 0)) >>> 0;
  }
  return {
    slots: [...slotsOrden],
    filas: [...filas],
    sigma: res.sigma,
    totales: res.totales,
    error: res.error,
    intentos,
    emergencia: res.emergencia,
    fibraFiable,
    bits,
    clave: claveDe(filas),
  };
}

/**
 * Identidad del candidato, para deduplicar entre los K de un día. Sustituye al
 * `frozenset(self.filas)` de Python, que JS no tiene.
 *
 * Ordenar ANTES de unir es la parte que importa: dos días con las mismas recetas
 * en distinto orden de selección son el mismo día, y sin ordenar se colarían
 * como candidatos distintos. El orden numérico es explícito porque el `sort` por
 * defecto de JS ordena como texto y pondría el 10 antes del 9.
 */
function claveDe(filas: readonly number[]): string {
  return [...filas].sort((a, b) => a - b).join(",");
}

// ---------------------------------------------------------------------------
// La etapa C
// ---------------------------------------------------------------------------

/**
 * Etapa A + B + C para un día. Devuelve el MEJOR candidato visto.
 * `reparacion.py:138-241`. DISENO §4.
 *
 * `null` sólo si algún slot se queda literalmente sin recetas admisibles. Ese
 * caso lo caza antes la puerta 1 del diagnóstico (§6.0); llegar aquí significa
 * que el pool se agotó por exclusiones dentro del propio día.
 *
 * El árbol de semillas (§2.6) usa dos familias de nodos, y la separación es lo
 * que hace que el plan sea reproducible pese a que el número de intentos varíe:
 *
 *  - `(RUTA_A, dia, kCand, 0, IDX_SLOT[slot])` para la selección inicial, un
 *    generador nuevo y desechable POR SLOT;
 *  - `(RUTA_A, dia, kCand, k, IDX_SLOT[slotCulpable])` para el intento k.
 *
 * Como cada nodo tiene su propio flujo, que un slot consuma un sorteo de más o
 * de menos no desplaza a los demás. Ese invariante es el que permite reparar un
 * slot sin que el resto del día cambie.
 *
 * Ver la cabecera del módulo sobre el estado mutable de `ctx`: esta función
 * tiene que llamarse con los días en orden.
 */
export function generarCandidatoDia(
  pool: Pool,
  ctx: Contexto,
  objetivo: ObjetivoNutricional,
  slots: readonly SlotComida[],
  seed: bigint,
  dia: number,
  kCand: number,
  resolver: ResolverPorciones,
): CandidatoDia | null {
  const objetivoVec = vectorObjetivo(objetivo);
  const slotsOrden = ordenDeSlots(slots);

  const elegidas = seleccionarDia(pool, ctx, objetivoVec, slots, (slot) =>
    rngDe(seed, RUTA_A, dia, kCand, 0, IDX_SLOT[slot]),
  );
  if (elegidas === null) return null;

  // σ de referencia: el que la etapa A ya consideró sensato. Es el ancla del
  // desempate del LP (§3.2), no una restricción; el LP puede alejarse de él si
  // el error lo justifica, y sólo lo usa para elegir entre soluciones empatadas.
  //
  // El residuo se descuenta EN EL MISMO ORDEN en que se seleccionó: cada slot
  // ve lo que dejaron los anteriores. Recorrer `slotsOrden` al revés, o calcular
  // los σ en paralelo contra el objetivo completo, daría un ancla distinta.
  const filas: number[] = [];
  const ref = new Float64Array(slotsOrden.length);
  const residuo = Float64Array.from(objetivoVec);
  for (let pos = 0; pos < slotsOrden.length; pos++) {
    // `slotsOrden` sale de `ordenDeSlots(slots)` y `seleccionarDia` rellena
    // exactamente ese mismo conjunto, así que el `undefined` es inalcanzable;
    // se comprueba en vez de callarlo con `!` porque si algún día deja de serlo,
    // el síntoma sería un NaN propagándose hasta los totales que ve el usuario.
    const slot = slotsOrden[pos];
    const j = slot === undefined ? undefined : elegidas.get(slot);
    if (slot === undefined || j === undefined) {
      throw new Error(`generarCandidatoDia: seleccionarDia no devolvió el slot ${pos}`);
    }
    filas.push(j);
    ref[pos] = sigmaSugerido(pool, j, residuo, ctx.cuota[slot] ?? CUOTA_POR_DEFECTO);
    const base = j * N_NUTR;
    for (let n = 0; n < N_NUTR; n++) {
      residuo[n] = (residuo[n] ?? 0) - (ref[pos] ?? 0) * (pool.nutr[base + n] ?? 0);
    }
  }

  let { activos, fibraFiable } = nutrientesActivos(pool, filas, objetivo);
  let bandas = bandasDe(objetivo, activos);
  let { a, res } = porcionar(pool, filas, ref, bandas, resolver);
  let mejor = empaquetar(pool, slotsOrden, filas, res, 0, fibraFiable);
  if (mejor.error <= UMBRAL_ERROR_OK) return mejor;

  buffersDe(pool.p);

  // Veto LOCAL al día, y sólo al día: una receta que no cuadró hoy puede ser la
  // correcta mañana. Guarda filas de pool, no slots, porque lo que se descarta
  // es la receta concreta que ya se probó, no la posición.
  const vetadas = new Set<number>();

  for (let k = 1; k <= MAX_INTENTOS_REPARACION; k++) {
    // κ se calcula con la `a` y las `bandas` del ÚLTIMO porcionado, no con las
    // iniciales: tras sustituir un slot las bandas pueden haber cambiado (la
    // receta nueva puede activar o desactivar fibra/sodio) y culpar con las
    // viejas señalaría al slot equivocado.
    const kappa = culpabilidad(a, filas.length, res.sigma, res.totales, bandas);
    // Desempate por índice de slot ascendente: el orden estable sobre κ
    // descendente hereda el orden de selección, que ya es determinista.
    const orden = argsortEstableDesc(kappa, filas.length);
    let culpable = -1;
    for (let i = 0; i < orden.length; i++) {
      const p = orden[i] ?? 0;
      if (!vetadas.has(filas[p] ?? -1)) {
        culpable = p;
        break;
      }
    }
    // Todas las filas del día ya se han probado: no queda nada que sustituir.
    if (culpable < 0) break;

    const slotCulpable = slotsOrden[culpable];
    if (slotCulpable === undefined) break;
    const filaCulpable = filas[culpable] ?? 0;
    vetadas.add(filaCulpable);

    // Con los σ del LP el residuo del slot culpable ya no es una estimación:
    // sabemos exactamente qué hueco hay que llenar. Es la diferencia entre
    // «prueba otra cosa» y «prueba algo con 30 g más de proteína».
    const residuoS = Float64Array.from(objetivoVec);
    for (let pos = 0; pos < filas.length; pos++) {
      if (pos === culpable) continue;
      const base = (filas[pos] ?? 0) * N_NUTR;
      const s = res.sigma[pos] ?? 0;
      for (let n = 0; n < N_NUTR; n++) {
        residuoS[n] = (residuoS[n] ?? 0) - s * (pool.nutr[base + n] ?? 0);
      }
    }

    const excl = bufExcluidas;
    excl.fill(0, 0, pool.p);
    for (let pos = 0; pos < filas.length; pos++) {
      if (pos !== culpable) excl[filas[pos] ?? 0] = 1;
    }
    for (const f of vetadas) excl[f] = 1;

    // Subir la temperatura en cada reintento amplía la exploración: si el primer
    // intento falló, el argmax local no era la respuesta y repetir el mismo
    // muestreo casi determinista devolvería casi lo mismo. §2.4.
    const tauK = ctx.tau * (1.0 + FACTOR_TEMPERATURA_REINTENTO * k);
    scoreSlot(pool, ctx, slotCulpable, residuoS, excl, bufScores);
    const nuevo = muestrear(
      bufScores,
      pool.p,
      pool.ids,
      tauK,
      rngDe(seed, RUTA_A, dia, kCand, k, IDX_SLOT[slotCulpable]),
    );
    // Sin alternativa admisible no hay reparación posible: se conserva el mejor.
    if (nuevo === null) break;

    filas[culpable] = nuevo;
    ({ activos, fibraFiable } = nutrientesActivos(pool, filas, objetivo));
    bandas = bandasDe(objetivo, activos);
    // Los σ del LP anterior se reutilizan como ancla para los slots NO tocados:
    // ya estaban cuadrados entre sí y volver a partir de la estimación de la
    // etapa A tiraría esa información.
    const refK = Float64Array.from(res.sigma);
    refK[culpable] = sigmaSugerido(
      pool,
      nuevo,
      residuoS,
      ctx.cuota[slotCulpable] ?? CUOTA_POR_DEFECTO,
    );
    ({ a, res } = porcionar(pool, filas, refK, bandas, resolver));

    const candidato = empaquetar(pool, slotsOrden, filas, res, k, fibraFiable);
    // Comparación ESTRICTA: un empate conserva el candidato del k menor, que es
    // lo que hace la salida independiente de en qué orden se empató.
    if (candidato.error < mejor.error) mejor = candidato;
    if (mejor.error <= UMBRAL_ERROR_OK) break;
  }

  // Se devuelve el mejor visto, con el error que tenga: aquí NO se comprueba
  // UMBRAL_ERROR_ACEPTABLE. Ver la divergencia (1) de la cabecera.
  return mejor;
}

// ---------------------------------------------------------------------------
// Rutas sin aleatoriedad, para la reparación de restricciones duras (etapa D)
// ---------------------------------------------------------------------------

/**
 * Reconstruye el porcionado de un día con las recetas ya decididas.
 * `reparacion.py:244-267`.
 *
 * Lo usa la reparación de restricciones duras de la etapa D (`repararDuras`, en
 * `semanal.ts`): cuando se sustituye un item, sus σ y sus totales dejan de ser
 * válidos y hay que volver a resolver el LP. Devolver los totales viejos con la
 * receta nueva sería exactamente el tipo de mentira que el resto del motor
 * evita —la suma del día que enseña la UI dejaría de cuadrar con las comidas
 * que enseña la UI—.
 *
 * NO consume aleatoriedad: mismas filas, mismo resultado, siempre.
 *
 * `intentos` viaja como parámetro porque el candidato reconstruido hereda el
 * contador del que sustituye; es una etiqueta para la traza, no un estado.
 */
export function recomponerDia(
  pool: Pool,
  ctx: Contexto,
  objetivo: ObjetivoNutricional,
  slotsOrden: readonly SlotComida[],
  filas: readonly number[],
  intentos: number,
  resolver: ResolverPorciones,
): CandidatoDia {
  const objetivoVec = vectorObjetivo(objetivo);
  const residuo = Float64Array.from(objetivoVec);
  const ref = new Float64Array(filas.length);
  for (let pos = 0; pos < filas.length; pos++) {
    const slot = slotsOrden[pos];
    const j = filas[pos];
    if (slot === undefined || j === undefined) {
      throw new Error("recomponerDia: slotsOrden y filas deben tener la misma longitud");
    }
    ref[pos] = sigmaSugerido(pool, j, residuo, ctx.cuota[slot] ?? CUOTA_POR_DEFECTO);
    const base = j * N_NUTR;
    for (let n = 0; n < N_NUTR; n++) {
      residuo[n] = (residuo[n] ?? 0) - (ref[pos] ?? 0) * (pool.nutr[base + n] ?? 0);
    }
  }
  const { activos, fibraFiable } = nutrientesActivos(pool, filas, objetivo);
  const { res } = porcionar(pool, filas, ref, bandasDe(objetivo, activos), resolver);
  return empaquetar(pool, slotsOrden, filas, res, intentos, fibraFiable);
}

/**
 * Mejor receta admisible para un slot, SIN muestrear. `reparacion.py:270-287`.
 *
 * La reparación de restricciones duras no debe introducir aleatoriedad nueva: ya
 * se está corrigiendo un plan concreto y lo que hace falta es la mejor
 * sustitución, no una sorteada. Si sorteara, dos ejecuciones del mismo plan con
 * la misma semilla podrían repararse distinto según cuántos sorteos se hubieran
 * consumido antes, y el «mismo seed → mismo plan» se caería.
 *
 * El desempate es por id (`min` sobre `(-score, id)`), con la comparación por
 * code points de `comparaId` —la misma que usa el top-K— y no con el `<` de JS,
 * que compara por unidades UTF-16 y difiere de Python fuera del BMP.
 */
export function mejorAlternativa(
  pool: Pool,
  ctx: Contexto,
  slot: SlotComida,
  residuo: Float64Array,
  excluidas: Uint8Array,
): number | null {
  if (pool.p <= 0) return null;
  buffersDe(pool.p);
  scoreSlot(pool, ctx, slot, residuo, excluidas, bufScores);

  let mejor = -1;
  let mejorScore = 0;
  for (let i = 0; i < pool.p; i++) {
    const s = bufScores[i] ?? 0;
    // `Number.isFinite` es el `np.isfinite`: descarta el −Infinity de lo
    // inadmisible y también el NaN, que elegiría al azar si llegara.
    if (!Number.isFinite(s)) continue;
    if (mejor < 0 || s > mejorScore) {
      mejor = i;
      mejorScore = s;
    } else if (s === mejorScore && comparaId(pool.ids[i] ?? "", pool.ids[mejor] ?? "") < 0) {
      mejor = i;
    }
  }
  return mejor < 0 ? null : mejor;
}
