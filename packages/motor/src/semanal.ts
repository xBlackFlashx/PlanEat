/**
 * Etapa D — ensamblado semanal. Port de
 * `services/solver/app/solver/semanal.py:38-387` y DISENO.md §5.
 *
 * Ésta es la etapa que produce **listas de la compra cortas**. Un día aislado no
 * puede ver los tres términos que la hacen falta —ingredientes únicos de la
 * semana, presupuesto y repetición—, así que se generan K candidatos
 * independientes por día y se busca la combinación que minimiza un coste global
 * que sí los ve.
 *
 * Tres cosas hay que tener presentes al leer o tocar este fichero, porque las
 * tres son la diferencia entre portar el motor y escribir otro parecido:
 *
 * 1. **Los días se producen ESTRICTAMENTE EN ORDEN** y `ctx` se muta entre
 *    ellos. El término de solape (§2.2d) lee `ctx.bitsSemana`, que es la unión
 *    de los días ya cerrados, y las dos restricciones de variedad leen
 *    `vetoSemana` y `vetoSlot`. Paralelizar los días o reordenarlos no es una
 *    optimización: es otro plan.
 * 2. **El bucle del recocido se porta línea a línea** por el consumo de
 *    aleatoriedad, no por el resultado. `integers(dTotal)` siempre;
 *    `integers(len)` sólo si hay más de un candidato; `random()` sólo si
 *    Δ ≥ 0 —el `or` de Python cortocircuita y el nuestro también—; y
 *    `t *= SA_ALFA` fuera de todos los condicionales. Evaluar el uniforme
 *    antes del `if` desincroniza el flujo entero y produce otro plan con la
 *    misma semilla. El pseudocódigo de DISENO §5.3 extrae `alt`
 *    incondicionalmente: ahí manda el código, no el documento.
 * 3. **Se devuelve el MEJOR visto, no el último.** El recocido termina en un
 *    estado arbitrario. El propio Python llama a esto «el error de
 *    implementación más común de SA» y tiene razón.
 *
 * Lo único que este port hace y Python no es precalcular los céntimos de cada
 * candidato una vez, en vez de rehacer el producto σ·precio en cada una de las
 * 400 iteraciones. No cambia un bit del resultado: el coste en céntimos de un
 * candidato no depende de con qué otros días se combine.
 */

import {
  IDX_SLOT,
  K_CANDIDATOS_DIA,
  LAMBDA_INGREDIENTES,
  MAX_USOS_RECETA_SEMANA,
  MU_PRESUPUESTO,
  N_NUTR,
  N_SLOTS,
  NU_REPETICION,
  RUTA_D,
  SA_ALFA,
  SA_ITERACIONES,
  SA_T0,
} from "./constantes.ts";
import { BITS_POR_PALABRA, bitsAIndices, orEnSitio } from "./numerico.ts";
import { generarCandidatoDia, mejorAlternativa, recomponerDia, vectorObjetivo } from "./reparacion.ts";
import type { Rng } from "./rng.ts";
import { rngDe } from "./rng.ts";
import { recalcularSolape } from "./scoring.ts";
import type {
  CandidatoDia,
  Contexto,
  ObjetivoNutricional,
  Pool,
  ResolverPorciones,
  SlotComida,
} from "./tipos.ts";

// ---------------------------------------------------------------------------
// Constantes del módulo
//
// Las dos que siguen NO van a `constantes.ts` y conviene decir por qué, porque
// la regla del repositorio es que allí vive todo número mágico: allí viven los
// parámetros del MOTOR, los que obligan a subir VERSION_GENERADOR al tocarlos.
// Éstas no lo son. Una es un factor de forma derivado de K_CANDIDATOS_DIA y la
// otra un guarda aritmético que no elige nada.
// ---------------------------------------------------------------------------

/**
 * Hasta 2K intentos para reunir K candidatos distintos (`semanal.py:84`).
 *
 * El margen existe porque los K candidatos de un día se generan contra el mismo
 * objetivo y la misma temperatura, así que salen parecidos y se pisan: sin
 * margen, un día con tres duplicados se quedaría con tres candidatos. Con 2K,
 * la mitad de los intentos puede caer en duplicado y el día sigue completo.
 */
const MAX_INTENTOS_CANDIDATOS_DIA = 2 * K_CANDIDATOS_DIA;

/**
 * Suelo de la temperatura en el denominador de Metropolis (`semanal.py:279`).
 *
 * Con el programa geométrico T nunca llega a cero (0,05·0,994^400 ≈ 0,0046), así
 * que este guarda no se dispara nunca hoy. Se porta igualmente porque es lo que
 * separa un cambio de SA_ITERACIONES de una división por cero: en JS `-Δ/0` da
 * −Infinity y `exp(−Infinity)` da 0, es decir, el recocido dejaría de aceptar
 * empeoramientos EN SILENCIO en vez de romperse.
 */
const TEMPERATURA_MINIMA = 1e-9;

/** Resultado del ensamblado. Port de la dataclass `ResultadoSemanal`. */
export interface ResultadoSemanal {
  /**
   * Los días elegidos, **omitiendo los que se quedaron sin candidatos**. Puede
   * ser más corto que `objetivos`, y eso es una señal, no un descuido: es cómo
   * `motor.ts` detecta que el pool no daba para la semana. Rellenar los huecos
   * con algo inventado sería tapar justo el síntoma que hay que reportar.
   */
  dias: CandidatoDia[];
  /** Coste global del arranque voraz. El recocido nunca devuelve nada peor. */
  costeInicial: number;
  /** Coste global del mejor estado visto. Por construcción ≤ `costeInicial`. */
  costeFinal: number;
  diasSinCandidato: number;
}

// ---------------------------------------------------------------------------
// Generación de los K candidatos por día
// ---------------------------------------------------------------------------

/**
 * K candidatos por día, deduplicados. §5.4
 *
 * Sin deduplicar, los K candidatos de un día salen casi idénticos (mismo
 * objetivo, misma temperatura) y la etapa D no tiene nada que combinar.
 *
 * El día se cierra con su **mejor candidato provisional** (el de menor error),
 * que es lo que el día siguiente ve como «ya está en la lista de la compra» y
 * como «esto ya lo comiste ayer». Ojo: NO es necesariamente el que elegirá el
 * recocido, y por eso `repararDuras` no es opcional.
 *
 * `alCerrarDia` es el gancho de progreso del worker. Existe porque la pantalla
 * de generación es la única cuya razón de ser es informar mientras se espera, y
 * hasta ahora marcaba los pasos como hechos con `indice === 0`; con el motor
 * dentro del navegador la barra puede por fin avanzar cuando avanza el trabajo.
 * Un día sin candidatos no lo llama: no hay nada honesto que anunciar, y ese
 * caso termina en `FalloGeneracion`.
 */
export function generarCandidatos(
  pool: Pool,
  ctx: Contexto,
  objetivos: readonly ObjetivoNutricional[],
  slots: readonly SlotComida[],
  seed: bigint,
  resolver: ResolverPorciones,
  alCerrarDia?: (dia: number, mejor: CandidatoDia) => void,
): { porDia: CandidatoDia[][]; duplicados: number } {
  const porDia: CandidatoDia[][] = [];
  let duplicados = 0;

  /** Usos acumulados por fila del pool. Int16 sobra: el máximo es D·S. */
  const usos = new Int16Array(pool.p);
  /**
   * Un único buffer para el veto semanal, reescrito al empezar cada día. Python
   * crea un array nuevo cada vez; aquí nadie conserva el del día anterior —el
   * contexto sólo guarda la referencia y `scoreSlot` lo lee dentro del día— así
   * que reutilizarlo ahorra siete copias de P bytes sin cambiar nada.
   */
  const vetoSemana = new Uint8Array(pool.p);

  for (const [d, objetivo] of objetivos.entries()) {
    // Las restricciones duras de variedad se aplican al ELEGIR, no sólo al
    // ensamblar: si los K candidatos se generan sin conocerlas, el recocido se
    // queda sin ningún estado factible que visitar.
    for (let i = 0; i < pool.p; i++) {
      vetoSemana[i] = (usos[i] ?? 0) >= MAX_USOS_RECETA_SEMANA ? 1 : 0;
    }
    ctx.vetoSemana = vetoSemana;

    const vistos = new Set<string>();
    const candidatos: CandidatoDia[] = [];
    for (let k = 0; k < MAX_INTENTOS_CANDIDATOS_DIA; k++) {
      if (candidatos.length >= K_CANDIDATOS_DIA) break;
      const cand = generarCandidatoDia(pool, ctx, objetivo, slots, seed, d, k, resolver);
      // `null` significa que algún slot se quedó literalmente sin recetas
      // admisibles: los intentos siguientes verían el mismo pool y darían lo
      // mismo, así que se rompe el bucle en vez de agotarlo.
      if (cand === null) break;
      if (vistos.has(cand.clave)) {
        duplicados++;
        continue;
      }
      vistos.add(cand.clave);
      candidatos.push(cand);
    }
    porDia.push(candidatos);

    // `min(candidatos, key=error)` de Python devuelve el PRIMER mínimo: la
    // comparación estricta lo reproduce y deja el desempate en el orden de
    // generación, que es el que fija la semilla.
    let mejor: CandidatoDia | undefined;
    for (const cand of candidatos) {
      if (mejor === undefined || cand.error < mejor.error) mejor = cand;
    }
    if (mejor === undefined) continue;

    orEnSitio(ctx.bitsSemana, 0, mejor.bits, 0, pool.w32);
    // Contrato de `scoring.recalcularSolape`: quien mueve `bitsSemana` vuelve a
    // calcular el precálculo del solape. Sin esta línea el plan sale igualmente,
    // sólo que con más líneas en la lista de la compra de las que debería, y no
    // hay forma de notarlo desde fuera.
    recalcularSolape(pool, ctx);

    ctx.vetoSlot = new Map<SlotComida, number>();
    for (const [pos, slot] of mejor.slots.entries()) {
      const fila = mejor.filas[pos];
      // El `strict=True` del `zip` de Python: si esto salta, el candidato viene
      // roto de la etapa C y todo lo que siga sería basura alineada al azar.
      if (fila === undefined) {
        throw new Error("generarCandidatos: slots y filas del candidato no están alineados");
      }
      ctx.vetoSlot.set(slot, fila);
      usos[fila] = (usos[fila] ?? 0) + 1;
    }

    alCerrarDia?.(d, mejor);
  }

  return { porDia, duplicados };
}

// ---------------------------------------------------------------------------
// Restricciones duras de variedad
// ---------------------------------------------------------------------------

/**
 * Memoria de trabajo de `violaDura` y del coste, con marcas de generación.
 *
 * Las dos funciones necesitan contar filas y marcar pares (slot, fila) de un
 * combo, y se llaman ~800 veces por ensamblado. Limpiar arrays de P posiciones
 * cada vez costaría más que todo el resto del recocido junto, así que en vez de
 * limpiar se sella: una posición sólo cuenta si su sello coincide con el de la
 * llamada en curso. `tic` es monótono y se comparte entre los dos sellos, así
 * que ninguna marca vieja puede confundirse con una nueva.
 */
interface Memoria {
  /** (P,) usos de cada fila dentro del combo que se está evaluando. */
  usos: Int32Array;
  /** (P,) sello de `usos`. */
  selloUsos: Int32Array;
  /** (N_SLOTS·P,) sello del par (slot, fila) del día previo no vacío. */
  selloPares: Int32Array;
  tic: number;
}

function memoriaDe(p: number): Memoria {
  return {
    usos: new Int32Array(p),
    selloUsos: new Int32Array(p),
    selloPares: new Int32Array(N_SLOTS * p),
    tic: 0,
  };
}

/**
 * ¿Rompe este combo alguna restricción DURA de variedad? `semanal.py:108-129`.
 *
 * Dos reglas, y las dos se aplican rechazando el movimiento, no penalizándolo.
 * Codificarlas como penalización blanda dejaría que un buen término de
 * ingredientes las comprara, y el usuario lee eso como un fallo del producto:
 *
 *  - ninguna receta más de MAX_USOS_RECETA_SEMANA veces en la semana;
 *  - ninguna receta en el MISMO slot dos días consecutivos. Compara PARES
 *    (slot, fila): la misma receta en slots distintos dos días seguidos es
 *    legal, y confundirlo prohíbe planes perfectamente razonables.
 *
 * Un día vacío **no rompe la cadena**: se salta sin tocar el «previo», de modo
 * que se comparan los dos días no vacíos que rodean el hueco. Es comportamiento
 * de borde del original y se preserva tal cual.
 *
 * `dTotal` permite evaluar un combo PARCIAL (los primeros `dTotal` días), que es
 * como lo llama el arranque voraz.
 */
function violaDura(
  combo: Int32Array,
  dTotal: number,
  porDia: readonly CandidatoDia[][],
  m: Memoria,
  p: number,
): boolean {
  const selloUsos = ++m.tic;
  let selloPrevio = 0;
  let hayPrevio = false;

  for (let d = 0; d < dTotal; d++) {
    const cands = porDia[d];
    if (cands === undefined || cands.length === 0) continue;
    const cand = cands[combo[d] ?? 0];
    // Los `undefined` de aquí en adelante son de `noUncheckedIndexedAccess`, no
    // casos reales: el combo indexa siempre dentro de rango y `slots` y `filas`
    // van alineados por construcción de la etapa C.
    if (cand === undefined) continue;

    const filas = cand.filas;
    const slots = cand.slots;
    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      if (fila === undefined) continue;
      const u = m.selloUsos[fila] === selloUsos ? (m.usos[fila] ?? 0) + 1 : 1;
      m.selloUsos[fila] = selloUsos;
      m.usos[fila] = u;
      if (u > MAX_USOS_RECETA_SEMANA) return true;
    }

    if (hayPrevio) {
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const fila = filas[i];
        if (slot === undefined || fila === undefined) continue;
        if (m.selloPares[(IDX_SLOT[slot] ?? 0) * p + fila] === selloPrevio) return true;
      }
    }

    selloPrevio = ++m.tic;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const fila = filas[i];
      if (slot === undefined || fila === undefined) continue;
      m.selloPares[(IDX_SLOT[slot] ?? 0) * p + fila] = selloPrevio;
    }
    hayPrevio = true;
  }
  return false;
}

/**
 * Mejor candidato por día que NO rompa las restricciones duras.
 * `semanal.py:132-157`.
 *
 * El voraz ingenuo (`argmin` del error, día a día) produce planes con la misma
 * receta tres veces en la semana o dos cenas iguales seguidas. El recocido
 * rechaza los movimientos que violan las duras, pero nunca visita un estado que
 * ya arrancó violándolas, así que devolvería el plan malo intacto. Aquí se
 * construye día a día comprobando la factibilidad contra los días ya fijados.
 *
 * Si ningún candidato de un día es factible se coge el de menor error y se
 * sigue: un plan con una repetición de más es mejor que ningún plan, y el
 * síntoma real no es este día sino que el catálogo se ha quedado corto. Ése es
 * el estado infactible que `repararDuras` tiene que limpiar al final.
 */
function arranqueVoraz(
  porDia: readonly CandidatoDia[][],
  m: Memoria,
  p: number,
): Int32Array {
  const combo = new Int32Array(porDia.length);
  for (const [d, cands] of porDia.entries()) {
    if (cands.length === 0) {
      combo[d] = 0; // día vacío: el índice no se llega a indexar nunca
      continue;
    }
    // Orden por (error, k): el desempate por índice de candidato es lo que hace
    // reproducible el arranque cuando dos candidatos cuadran igual de bien.
    const orden: number[] = [];
    for (let k = 0; k < cands.length; k++) orden.push(k);
    orden.sort((a, b) => {
      const ea = cands[a]?.error ?? 0;
      const eb = cands[b]?.error ?? 0;
      if (ea < eb) return -1;
      if (ea > eb) return 1;
      return a - b;
    });

    let elegido = orden[0] ?? 0;
    for (const k of orden) {
      combo[d] = k;
      if (!violaDura(combo, d + 1, porDia, m, p)) {
        elegido = k;
        break;
      }
    }
    combo[d] = elegido;
  }
  return combo;
}

// ---------------------------------------------------------------------------
// Función objetivo semanal
// ---------------------------------------------------------------------------

/**
 * Coste global de una combinación. §5.1
 *
 * λ = 0,12 (subido desde 0,006 en la cuarta ronda de "menos ingredientes",
 * ver LAMBDA_INGREDIENTES en constantes.ts): quitar 10 ingredientes de la
 * lista vale ahora lo mismo que empeorar un día en ~1,4 puntos de desviación
 * nutricional, mucho más agresivo que antes -es el punto donde
 * scripts/medir_lambda_ingredientes.py (Python) encuentra el suelo de la
 * media de ingredientes/semana-. Ya no deja la nutrición tan dominante como
 * antes a propósito: el usuario prefiere explícitamente una despensa mucho
 * más compartida a costa de precisión nutricional.
 *
 * `unicos` NO se calcula aquí: llega del contador incremental, que el llamante
 * ya ha actualizado con el movimiento propuesto. Es un acoplamiento incómodo y
 * es del original: recalcular la unión en cada iteración cuesta D×W.
 *
 * El término de repetición es `Σ max(0, usos(r) − 1)`, que es exactamente
 * «cuántas filas hay de más»: total de items menos filas distintas. Se cuenta
 * así para no tener que recorrer un diccionario de usos al final.
 */
function costeDe(
  combo: Int32Array,
  porDia: readonly CandidatoDia[][],
  unicos: number,
  centsPorCandidato: readonly Float64Array[],
  presupuestoCents: number | null,
  comensales: number,
  m: Memoria,
): number {
  const sello = ++m.tic;
  let err = 0.0;
  let items = 0;
  let distintas = 0;
  let cents = 0.0;

  for (const [d, cands] of porDia.entries()) {
    if (cands.length === 0) continue; // los días vacíos NO contribuyen
    const k = combo[d] ?? 0;
    const cand = cands[k];
    if (cand === undefined) continue;
    err += cand.error;
    cents += centsPorCandidato[d]?.[k] ?? 0;
    const filas = cand.filas;
    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      if (fila === undefined) continue;
      items++;
      if (m.selloUsos[fila] !== sello) {
        m.selloUsos[fila] = sello;
        distintas++;
      }
    }
  }

  const rep = items - distintas;
  let exceso = 0.0;
  if (presupuestoCents !== null && presupuestoCents > 0) {
    const total = cents * Math.max(1, comensales);
    exceso = Math.max(0.0, total - presupuestoCents) / presupuestoCents;
  }
  return err + LAMBDA_INGREDIENTES * unicos + MU_PRESUPUESTO * exceso + NU_REPETICION * rep;
}

// ---------------------------------------------------------------------------
// Recocido simulado
// ---------------------------------------------------------------------------

/**
 * Recocido simulado sobre las combinaciones día × candidato. §5.3
 *
 * `rngRecocido` es un gancho de PRUEBAS y el motor nunca lo pasa: el flujo real
 * es siempre `rngDe(seed, RUTA_D)`. Existe porque el invariante más frágil de
 * esta etapa es *cuántos* sorteos consume el bucle —los dos cortocircuitos
 * (`len > 1` y `Δ < 0`) son los que fijan el flujo— y sin poder observar el
 * contador desde fuera ese invariante sólo se puede afirmar comparando planes
 * enteros, que es justo el test que no distingue un fallo de otro.
 */
export function ensamblar(
  pool: Pool,
  porDia: readonly CandidatoDia[][],
  seed: bigint,
  presupuestoCents: number | null,
  comensales: number,
  rngRecocido?: Rng,
): ResultadoSemanal {
  const dTotal = porDia.length;
  let diasVacios = 0;
  for (const cands of porDia) {
    if (cands.length === 0) diasVacios++;
  }
  // Sin ningún día con candidatos no hay nada que combinar y, sobre todo, no se
  // toca el RNG: el flujo de RUTA_D no existe en esta rama.
  if (diasVacios === dTotal) {
    return { dias: [], costeInicial: 0.0, costeFinal: 0.0, diasSinCandidato: diasVacios };
  }

  const m = memoriaDe(pool.p);
  const combo = arranqueVoraz(porDia, m, pool.p);

  // Céntimos de cada candidato, una vez. Python los recalcula en cada
  // evaluación del coste; el valor no depende del combo, así que precalcularlo
  // no cambia el resultado, sólo evita ~2.800 productos σ·precio.
  const centsPorCandidato: Float64Array[] = [];
  for (const cands of porDia) {
    const fila = new Float64Array(cands.length);
    for (const [k, cand] of cands.entries()) {
      let total = 0.0;
      for (let i = 0; i < cand.filas.length; i++) {
        const j = cand.filas[i];
        if (j === undefined) continue;
        total += (pool.costeCents[j] ?? 0) * (cand.sigma[i] ?? 0);
      }
      fila[k] = total;
    }
    centsPorCandidato.push(fila);
  }

  // Índices de alimento de cada candidato, expandidos una vez (D·K = 42
  // expansiones) para que el contador incremental trabaje sobre listas ya
  // hechas. El dimensionado es w32·32 y NO w·64 como en Python: al pasar de
  // palabras de 64 a 32 bits el índice máximo se divide por dos, y sobrar
  // memoria aquí sería un array de uso indexado fuera de rango allá.
  const nBits = pool.w32 * BITS_POR_PALABRA;
  const scratch = new Int32Array(nBits);
  const ingr: Int32Array[][] = [];
  for (const cands of porDia) {
    const fila: Int32Array[] = [];
    for (const cand of cands) {
      const cuantos = bitsAIndices(cand.bits, 0, pool.w32, scratch);
      fila.push(scratch.slice(0, cuantos));
    }
    ingr.push(fila);
  }

  /**
   * Contador incremental de ingredientes únicos. §5.2
   *
   * Nótese el orden OPUESTO de las comprobaciones: `anadir` comprueba antes de
   * incrementar y `quitar` decrementa antes de comprobar. Invertir cualquiera
   * de las dos descuadra la cuenta sin dar error.
   */
  const uso = new Int16Array(nBits);
  let unicos = 0;
  const anadir = (indices: Int32Array): void => {
    for (let i = 0; i < indices.length; i++) {
      const b = indices[i] ?? 0;
      if (uso[b] === 0) unicos++;
      uso[b] = (uso[b] ?? 0) + 1;
    }
  };
  const quitar = (indices: Int32Array): void => {
    for (let i = 0; i < indices.length; i++) {
      const b = indices[i] ?? 0;
      uso[b] = (uso[b] ?? 0) - 1;
      if (uso[b] === 0) unicos--;
    }
  };

  for (const [d, cands] of porDia.entries()) {
    if (cands.length === 0) continue;
    const lista = ingr[d]?.[combo[d] ?? 0];
    if (lista !== undefined) anadir(lista);
  }

  const costeTotal = (): number =>
    costeDe(combo, porDia, unicos, centsPorCandidato, presupuestoCents, comensales, m);

  const costeInicial = costeTotal();
  let costeActual = costeInicial;
  const mejor = combo.slice();
  let costeMejor = costeActual;

  // Con un solo día, o con un solo candidato por día, no hay nada que combinar:
  // el arranque voraz ya es el óptimo del espacio. En esa rama el generador de
  // RUTA_D ni se crea, y eso también es contrato del flujo.
  let algunoConVarios = false;
  for (const cands of porDia) {
    if (cands.length > 1) {
      algunoConVarios = true;
      break;
    }
  }

  if (dTotal > 1 && algunoConVarios) {
    const rng = rngRecocido ?? rngDe(seed, RUTA_D);
    let t = SA_T0;
    for (let it = 0; it < SA_ITERACIONES; it++) {
      const d = rng.integers(dTotal); // [1] SIEMPRE
      const cands = porDia[d];
      const kViejo = combo[d] ?? 0;
      if (cands !== undefined && cands.length > 1) {
        const kNuevo = rng.integers(cands.length); // [2] sólo si hay dónde elegir
        if (kNuevo !== kViejo) {
          // La propuesta se escribe en sitio y se deshace si no prospera: es el
          // `propuesta = list(combo)` de Python sin asignar 400 arrays.
          combo[d] = kNuevo;
          if (!violaDura(combo, dTotal, porDia, m, pool.p)) {
            const viejo = ingr[d]?.[kViejo];
            const nuevo = ingr[d]?.[kNuevo];
            if (viejo !== undefined) quitar(viejo);
            if (nuevo !== undefined) anadir(nuevo);
            const costeNuevo = costeTotal(); // el contador YA refleja la propuesta
            const delta = costeNuevo - costeActual;
            // [3] El `random()` va DETRÁS del cortocircuito: con Δ < 0 no se
            // consume. Evaluarlo siempre desincroniza el flujo entero.
            if (delta < 0 || rng.random() < Math.exp(-delta / Math.max(t, TEMPERATURA_MINIMA))) {
              costeActual = costeNuevo;
              if (costeActual < costeMejor) {
                mejor.set(combo);
                costeMejor = costeActual;
              }
            } else {
              if (nuevo !== undefined) quitar(nuevo);
              if (viejo !== undefined) anadir(viejo);
              combo[d] = kViejo;
            }
          } else {
            combo[d] = kViejo;
          }
        }
      }
      t *= SA_ALFA; // SIEMPRE, aunque no se haya propuesto nada
    }
  }

  const dias: CandidatoDia[] = [];
  for (const [d, cands] of porDia.entries()) {
    if (cands.length === 0) continue; // los días vacíos se OMITEN
    const cand = cands[mejor[d] ?? 0];
    if (cand !== undefined) dias.push(cand);
  }

  return {
    dias,
    costeInicial,
    costeFinal: costeMejor,
    diasSinCandidato: diasVacios,
  };
}

// ---------------------------------------------------------------------------
// Última pasada: las duras, receta a receta
// ---------------------------------------------------------------------------

/** Fila servida ayer en ese slot, o −1 si ayer no tenía ese slot. */
function filaEnSlot(dia: CandidatoDia, slot: SlotComida): number {
  const pos = dia.slots.indexOf(slot);
  if (pos < 0) return -1;
  return dia.filas[pos] ?? -1;
}

/**
 * Hace cumplir las restricciones duras receta a receta. `semanal.py:301-378`.
 *
 * Por qué hace falta pese a que la etapa A ya las veta y el recocido ya rechaza
 * los movimientos que las rompen: los K candidatos de un día se generan contra
 * el *mejor provisional* de los días anteriores, y el recocido puede cambiar
 * esos días. Si además ningún candidato del día era factible, el arranque voraz
 * cede a propósito. Medido con 5 slots y 7 días sobre el catálogo semilla, eso
 * dejaba pasar una receta usada 3 veces.
 *
 * Aquí se corrige donde duele: se sustituye **el item concreto** que sobra, con
 * el residuo real del día, y se vuelve a resolver el porcionado. Si no hay
 * ninguna alternativa admisible se deja como está y no se cuenta: el catálogo no
 * da para más y decirlo es mejor que fingirlo.
 *
 * Detalles que parecen descuido y no lo son, todos del original:
 *
 *  - `dias` se MUTA en sitio y además se devuelve. El día d se reemplaza
 *    mientras el bucle sigue, así que `ayer` ve el día YA reparado.
 *  - `cand.sigma` es el del día ANTES de reparar, incluso si ya se sustituyó
 *    otra posición del mismo día. Es una aproximación consciente: el porcionado
 *    final del día lo corrige.
 *  - No consume ni un sorteo. `mejorAlternativa` es un argmax con desempate por
 *    id: aquí ya se está corrigiendo un plan concreto y lo que hace falta es la
 *    mejor sustitución, no una sorteada.
 */
export function repararDuras(
  pool: Pool,
  ctx: Contexto,
  objetivos: readonly ObjetivoNutricional[],
  dias: CandidatoDia[],
  resolver: ResolverPorciones,
): { dias: CandidatoDia[]; arreglados: number } {
  const usos = new Int32Array(pool.p);
  for (const cand of dias) {
    for (const fila of cand.filas) {
      usos[fila] = (usos[fila] ?? 0) + 1;
    }
  }

  let arreglados = 0;
  for (const [d, cand] of dias.entries()) {
    const objetivo = objetivos[d];
    // `dias` viene de `ensamblar`, que omite los días sin candidatos; quien
    // llama aquí (motor.ts) ya ha comprobado que no falta ninguno. Si faltara,
    // los objetivos estarían desplazados y el plan saldría cuadrado contra el
    // día equivocado, que es peor que no salir.
    if (objetivo === undefined) {
      throw new Error("repararDuras: hay más días que objetivos; el plan viene desalineado");
    }

    let cambios = false;
    const filas = [...cand.filas];
    for (const [pos, fila] of filas.entries()) {
      const slot = cand.slots[pos];
      if (slot === undefined) continue;
      const ayer = d > 0 ? dias[d - 1] : undefined;
      const filaAyer = ayer === undefined ? -1 : filaEnSlot(ayer, slot);
      const repetida = (usos[fila] ?? 0) > MAX_USOS_RECETA_SEMANA;
      const consecutiva = filaAyer === fila;
      if (!repetida && !consecutiva) continue;

      // Residuo real: lo que le falta al día una vez fijado todo lo demás. Con
      // los σ ya resueltos esto no es una estimación.
      const residuo = vectorObjetivo(objetivo);
      for (const [otraPos, otra] of filas.entries()) {
        if (otraPos === pos) continue;
        const s = cand.sigma[otraPos] ?? 0;
        const base = otra * N_NUTR;
        for (let n = 0; n < N_NUTR; n++) {
          residuo[n] = (residuo[n] ?? 0) - s * (pool.nutr[base + n] ?? 0);
        }
      }

      const excluidasBase = new Uint8Array(pool.p);
      for (const f of filas) excluidasBase[f] = 1; // nunca dos veces en el mismo día
      if (filaAyer >= 0) excluidasBase[filaAyer] = 1;

      // `agotadas` se recalcula aquí dentro y no fuera: las sustituciones
      // anteriores de este mismo día ya cuentan.
      const excluidasEstricta = excluidasBase.slice();
      for (let f = 0; f < pool.p; f++) {
        if ((usos[f] ?? 0) >= MAX_USOS_RECETA_SEMANA) excluidasEstricta[f] = 1;
      }

      // Dos intentos, en orden de exigencia. Si respetar las dos reglas a la vez
      // deja el slot sin candidatos, se cede la del tope semanal y se conserva
      // la de días consecutivos: el usuario percibe mucho más «otra vez lo mismo
      // que ayer» que «esto ya salió el lunes».
      let nueva = mejorAlternativa(pool, ctx, slot, residuo, excluidasEstricta);
      if (nueva === null) nueva = mejorAlternativa(pool, ctx, slot, residuo, excluidasBase);
      if (nueva === null) continue;

      usos[fila] = (usos[fila] ?? 0) - 1;
      usos[nueva] = (usos[nueva] ?? 0) + 1;
      filas[pos] = nueva;
      cambios = true;
      arreglados++;
    }

    if (cambios) {
      dias[d] = recomponerDia(pool, ctx, objetivo, cand.slots, filas, cand.intentos, resolver);
    }
  }

  return { dias, arreglados };
}
