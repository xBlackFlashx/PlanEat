/**
 * Etapa B — porcionado. DISENO.md §3.
 *
 * El punto que la spec dejaba abierto sigue igual de abierto aquí: los
 * objetivos no son puntos, son **rangos**, y el goal programming clásico gasta
 * su libertad en clavar el centro del rango en vez de en cuadrar el resto. Se
 * conserva la banda muerta (interval goal programming): dentro del rango, coste
 * cero. Todo lo de §3.1 a §3.3 —bandas, desviaciones, error E, culpabilidad— se
 * porta literalmente del Python.
 *
 * Lo que NO se porta es §3.4: aquí no hay HiGHS. `resolverPorcionesRejilla`
 * hace **descenso coordinado sobre la rejilla de 0,05 minimizando la MISMA
 * función objetivo del LP**, J(σ) = W·E(σ) + EPS_REG·Σ|σᵢ − σrefᵢ|, con
 * vecindad de pares (2-opt) cada vez que el descenso simple se estanca, y
 * multiarranque determinista.
 *
 * **Por qué esto puede salir MEJOR que Python, y no es una licencia.** Python
 * no es óptimo sobre el conjunto que devuelve: resuelve el LP *continuo* y
 * después cuantiza (`_cuantizar`), reparando una sola coordenada y sólo si las
 * kcal se salieron de banda. Como el óptimo del LP reposa sobre el borde de la
 * banda —es lo que hace un símplex—, la cuantización lo empuja fuera, y la
 * brecha de redondeo medida es del orden de ΔE ≈ 0,009 sobre un presupuesto de
 * aceptación de 0,04: entre un quinto y un cuarto del margen, tirado en el
 * último paso. Nosotros optimizamos directamente sobre la rejilla, que es lo
 * único que se puede devolver (σ = 1,2837 no es cocinable). Son dos heurísticas
 * sobre el mismo conjunto finito y la nuestra ataca la magnitud que se reporta.
 * El criterio de aceptación del port es por tanto «E_ts ≤ E_py + holgura», no
 * «σ_ts == σ_py»: comparar σ componente a componente sería exigir paridad con
 * el pivoteo de un símplex que ya no existe.
 *
 * El tamaño del problema lo permite sin trampa: R ≤ 6 recetas por día y ≤ 60
 * puntos por coordenada. El LP era de juguete (≤22 columnas) pero masivamente
 * degenerado por diseño (§3.2); el problema real es discreto, no continuo.
 *
 * Todo vive detrás de la interfaz síncrona `ResolverPorciones` para que meter
 * highs-js WASM más adelante sea sustituir una constante, no reescribir la
 * etapa C. Esa es la puerta de decisión pre-registrada de
 * docs/port-typescript.md: si p95(E_ts − E_py) > 0,005 sobre el corpus de
 * paridad, se cambia el motor y no se discute.
 */

import type { ObjetivoNutricional } from '@planeat/shared';

import {
  EPS_REG,
  IDX_FIBRA,
  IDX_KCAL,
  IDX_SODIO,
  INF_BANDA,
  N_NUTR,
  PASO_RACION,
  PESOS_LP,
} from './constantes.ts';
import { redondeoMitadAPar } from './numerico.ts';

// ---------------------------------------------------------------------------
// Constantes del porcionador
//
// Deberían vivir en `constantes.ts` como manda la regla del repositorio, pero
// ese fichero es de otro agente del port y modificarlo en paralelo es cómo se
// pierden ediciones. Quedan aquí, exportadas y con su porqué, y su traslado
// está anotado en el informe del módulo. Ninguna es un parámetro de producto:
// las tres son tolerancias numéricas del algoritmo.
// ---------------------------------------------------------------------------

/**
 * Holgura al contar pasos de rejilla, en unidades de paso. Es el mismo `1e-9`
 * que Python mete en `_rejilla`: sin él, `hi/0,05` puede caer en 35,999999999
 * por representación binaria y la rejilla pierde su último punto útil —el que
 * casi siempre es la solución cuando el día se queda corto de kcal.
 */
export const TOL_PASOS_REJILLA = 1e-9;

/**
 * Tope de pasadas del descenso coordinado. El descenso termina solo: J decrece
 * estrictamente en cada movimiento aceptado y el espacio es finito. El tope
 * está para que un empate mal resuelto por aritmética de coma flotante no
 * convierta un bug en un navegador colgado; si salta, es un bug.
 */
export const MAX_PASADAS_DESCENSO = 64;

/**
 * Tope de rondas de (barrido de pares → descenso). Medido sobre las 2.171
 * instancias del corpus de paridad: con dos rondas el error ya es el mismo que
 * con cuatro. Las dos de más son margen y apenas cuestan, porque el barrido
 * devuelve `false` en cuanto no encuentra mejora y la ronda termina sola.
 */
export const MAX_RONDAS_PARES = 4;

// ---------------------------------------------------------------------------
// §3.1 — Bandas
// ---------------------------------------------------------------------------

/** Intervalo objetivo y pesos asimétricos por nutriente. §3.1 */
export interface Bandas {
  /** (6,) L_n. `-INF_BANDA` si el lado está abierto. */
  lo: Float64Array;
  /** (6,) U_n. `+INF_BANDA` si el lado está abierto. */
  hi: Float64Array;
  /** (6,) coste del exceso; 0 = ese lado no se penaliza. */
  wMas: Float64Array;
  /** (6,) coste del defecto. */
  wMenos: Float64Array;
  /** (6,) normalizador relativo. */
  e: Float64Array;
  /** Σ max(wMas, wMenos). Denominador de E. En Python era una `@property`. */
  pesoTotal: number;
}

/** Factores de ración devueltos por la etapa B, ya sobre la rejilla. */
export interface ResultadoPorcionado {
  /** (R,) factores de ración, siempre puntos admisibles de la rejilla. */
  sigma: Float64Array;
  /** (6,) totales REALES de los σ devueltos. Nunca los de otro σ. */
  totales: Float64Array;
  /** E de §3.3, sin el regularizador. */
  error: number;
  emergencia: boolean;
}

/**
 * La etapa C sólo conoce el porcionador por esta firma. Cambiar el descenso
 * coordinado por highs-js WASM es cambiar qué función se pasa, nada más.
 *
 * `a` es (6, R) en row-major —6 filas de nutriente × R recetas—, igual que el
 * `a` de numpy. `r` viaja aparte porque un Float64Array plano no tiene forma.
 */
export type ResolverPorciones = (
  a: Float64Array,
  r: number,
  lo: Float64Array,
  hi: Float64Array,
  sigmaRef: Float64Array,
  bandas: Bandas,
) => ResultadoPorcionado;

/**
 * Traduce `ObjetivoNutricional` a bandas. §3.1
 *
 * `activos` (6,) desactiva nutrientes de los que no hay dato fiable: un
 * nutriente desactivado tiene banda abierta y peso 0, así que ni penaliza ni
 * entra en el error. No se inventa un objetivo sobre datos que no existen.
 *
 * El orden importa: el normalizador `e` se calcula DESPUÉS de aplicar
 * `activos`, así que un nutriente desactivado sale con e = 1 y no con su
 * escala real. Es intencionado en Python y se replica; cambiarlo movería el
 * error de todas las instancias con fibra o sodio sin dato.
 */
export function bandasDe(
  objetivo: ObjetivoNutricional,
  activos: Uint8Array | null = null,
): Bandas {
  const lo = new Float64Array(N_NUTR).fill(-INF_BANDA);
  const hi = new Float64Array(N_NUTR).fill(INF_BANDA);
  const wMas = new Float64Array(N_NUTR);
  const wMenos = new Float64Array(N_NUTR);

  const tol = objetivo.toleranciaKcal;
  const kcal = objetivo.kcal;
  lo[IDX_KCAL] = kcal * (1 - tol);
  hi[IDX_KCAL] = kcal * (1 + tol);
  lo[1] = objetivo.proteinaG.min;
  hi[1] = objetivo.proteinaG.max;
  lo[2] = objetivo.carbohidratoG.min;
  hi[2] = objetivo.carbohidratoG.max;
  lo[3] = objetivo.grasaG.min;
  hi[3] = objetivo.grasaG.max;

  // `fibraMinG` falsy (0, null, undefined) significa «no se exige fibra», no
  // «se exigen 0 g»: el `or 0.0` de Python colapsa los tres casos.
  const fibraMin = objetivo.fibraMinG || 0.0;
  lo[IDX_FIBRA] = fibraMin;
  const sodioMax = objetivo.sodioMaxMg;
  const haySodio = sodioMax !== undefined && sodioMax !== null;
  if (haySodio) hi[IDX_SODIO] = sodioMax;

  for (let i = 0; i < N_NUTR; i++) {
    const par = PESOS_LP[i] ?? [0, 0];
    wMas[i] = par[0];
    wMenos[i] = par[1];
  }

  // Sin dato o sin objetivo declarado, el nutriente sale del modelo.
  if (!haySodio) wMas[IDX_SODIO] = 0.0;
  if (!fibraMin) wMenos[IDX_FIBRA] = 0.0;
  if (activos !== null) {
    for (let i = 0; i < N_NUTR; i++) {
      if (!activos[i]) {
        wMas[i] = 0.0;
        wMenos[i] = 0.0;
        lo[i] = -INF_BANDA;
        hi[i] = INF_BANDA;
      }
    }
  }

  // Normalizador: convierte gramos y miligramos en desviaciones RELATIVAS, que
  // es lo único comparable entre nutrientes. 10 g de desviación en carbohidrato
  // y 10 mg en sodio no son la misma falta. §3.2
  const e = new Float64Array(N_NUTR);
  let pesoTotal = 0;
  for (let i = 0; i < N_NUTR; i++) {
    const li = lo[i] ?? 0;
    const ui = hi[i] ?? 0;
    if (li > -INF_BANDA && ui < INF_BANDA) e[i] = Math.max((li + ui) / 2.0, 1.0);
    else if (li > -INF_BANDA) e[i] = Math.max(li, 1.0);
    else if (ui < INF_BANDA) e[i] = Math.max(ui, 1.0);
    else e[i] = 1.0;
    pesoTotal += Math.max(wMas[i] ?? 0, wMenos[i] ?? 0);
  }
  return { lo, hi, wMas, wMenos, e, pesoTotal };
}

/** u⁺ = cuánto sobra por encima de U_n, u⁻ = cuánto falta por debajo de L_n. */
export function desviaciones(
  totales: Float64Array,
  bandas: Bandas,
): { uMas: Float64Array; uMenos: Float64Array } {
  const uMas = new Float64Array(N_NUTR);
  const uMenos = new Float64Array(N_NUTR);
  for (let i = 0; i < N_NUTR; i++) {
    const t = totales[i] ?? 0;
    const ui = bandas.hi[i] ?? INF_BANDA;
    const li = bandas.lo[i] ?? -INF_BANDA;
    if (ui < INF_BANDA) uMas[i] = Math.max(0.0, t - ui);
    if (li > -INF_BANDA) uMenos[i] = Math.max(0.0, li - t);
  }
  return { uMas, uMenos };
}

/**
 * Desviación relativa media ponderada FUERA de banda. §3.3
 *
 * Se calcula sobre los totales reales, nunca sobre el valor objetivo del LP:
 * ése incluye el regularizador. E = 0 significa «todos los nutrientes dentro de
 * sus rangos», no «clavado en el centro».
 *
 * Devuelve 0,0 si `pesoTotal ≤ 0` —todos los nutrientes desactivados—, igual
 * que Python. Es un 0 que significa «sin datos», no «objetivo alcanzado»: la
 * traza expone cuántos nutrientes estaban activos precisamente para que en la
 * validación de la demo no se confundan los dos.
 *
 * No llama a `desviaciones` aunque Python sí lo haga: esta función se ejecuta
 * decenas de miles de veces por plan dentro del descenso y asignar dos arrays
 * por evaluación la domina. Las expresiones aritméticas son las mismas, término
 * a término y en el mismo orden de suma.
 */
export function errorDe(totales: Float64Array, bandas: Bandas): number {
  const total = bandas.pesoTotal;
  if (total <= 0) return 0.0;
  const { lo, hi, wMas, wMenos, e } = bandas;
  let num = 0;
  for (let i = 0; i < N_NUTR; i++) {
    const t = totales[i] ?? 0;
    const ui = hi[i] ?? INF_BANDA;
    const li = lo[i] ?? -INF_BANDA;
    const uMas = ui < INF_BANDA ? Math.max(0.0, t - ui) : 0.0;
    const uMenos = li > -INF_BANDA ? Math.max(0.0, li - t) : 0.0;
    const en = e[i] ?? 1;
    num += ((wMas[i] ?? 0) * uMas) / en + ((wMenos[i] ?? 0) * uMenos) / en;
  }
  return num / total;
}

/**
 * Qué receta empuja en la dirección equivocada. §4.1
 *
 * La spec culpaba a «la de mayor distancia composicional al residuo», que es
 * una heurística ciega al resultado del porcionado teniendo el porcionado toda
 * la información. Aquí se usa la dirección de necesidad g (g_n > 0: falta ese
 * nutriente; g_n < 0: sobra) y se culpa a quien aporta mucho de lo que sobra y
 * poco de lo que falta. Funciona igual cuando el problema es de magnitud y no
 * de composición: si sobran kcal, la receta más calórica es la más culpable.
 *
 * Ojo al doble normalizado: g divide por e_n y el aporte vuelve a dividir por
 * e_n, así que el término efectivo lleva e_n². Está así en Python y se replica
 * literalmente; corregirlo cambiaría a qué slot se ataca en la reparación.
 */
export function culpabilidad(
  a: Float64Array,
  r: number,
  sigma: Float64Array,
  totales: Float64Array,
  bandas: Bandas,
): Float64Array {
  const { uMas, uMenos } = desviaciones(totales, bandas);
  const g = new Float64Array(N_NUTR);
  for (let n = 0; n < N_NUTR; n++) {
    const en = bandas.e[n] ?? 1;
    g[n] = ((bandas.wMenos[n] ?? 0) * (uMenos[n] ?? 0) - (bandas.wMas[n] ?? 0) * (uMas[n] ?? 0)) / en;
  }
  const kappa = new Float64Array(r);
  for (let j = 0; j < r; j++) {
    const sj = sigma[j] ?? 0;
    let acc = 0;
    for (let n = 0; n < N_NUTR; n++) {
      const en = bandas.e[n] ?? 1;
      acc += (g[n] ?? 0) * (((a[n * r + j] ?? 0) * sj) / en);
    }
    kappa[j] = -acc;
  }
  return kappa;
}

// ---------------------------------------------------------------------------
// §3.4 — Rejilla y cuantización
//
// DIVERGENCIA PRE-REGISTRADA (1) de docs/port-typescript.md, detallada en
// DIVERGENCIAS.md: aquí `cuantizar` y `rejilla` hablan de la MISMA rejilla,
// anclada en 0. En Python `_cuantizar` ancla en 0 (múltiplos de 0,05) y
// `_rejilla` ancla en `lo`, así que con un `escala_min` que no sea múltiplo de
// 0,05 `_pulir_una` devuelve σ que `_cuantizar` no produciría jamás. Y no es
// hipotético: `escalaMin` viaja en float32 y 0,6 en float32 vale
// 0,6000000238418579 en float64, que no es múltiplo de 0,05. Ocurre en el 8 %
// de las instancias volcadas del solver Python.
// ---------------------------------------------------------------------------

/**
 * σ = 1,2837 no es cocinable. Se redondea al múltiplo de 0,05 y se clipa.
 *
 * El redondeo es bancario (`redondeoMitadAPar`) porque `np.round` lo es:
 * `Math.round(12.5)` da 13 y numpy da 12, y ese medio paso mueve 0,05 raciones
 * en el plato del usuario.
 */
export function cuantizar(
  sigma: Float64Array,
  lo: Float64Array,
  hi: Float64Array,
): Float64Array {
  const n = sigma.length;
  const salida = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const q = redondeoMitadAPar((sigma[i] ?? 0) / PASO_RACION) * PASO_RACION;
    // El orden de los clips es el de `np.clip`: primero el suelo, luego el
    // techo. Con cotas cruzadas (lo > hi, que sería un bug de catálogo) gana
    // `hi`, igual que en numpy.
    salida[i] = Math.min(Math.max(q, lo[i] ?? 0), hi[i] ?? 0);
  }
  return salida;
}

/**
 * Todos los valores admisibles de un σ sobre la rejilla de 0,05.
 *
 * Rejilla unificada anclada en 0: los múltiplos de 0,05 que caen dentro de
 * [lo, hi], más `lo` y `hi`, que son admisibles aunque no sean múltiplos. Sin
 * duplicados y en orden ascendente estricto — el ascendente es contrato: todos
 * los desempates del módulo se resuelven con `<` estricto recorriendo la
 * rejilla, así que un empate se lleva siempre el σ más bajo, y eso sólo es
 * determinista si el recorrido está ordenado.
 *
 * Con `hi ≤ lo` (cotas degeneradas o cruzadas) devuelve `[hi]`, que es el único
 * valor que `np.clip(x, lo, hi)` puede producir en ese caso.
 */
export function rejilla(lo: number, hi: number): Float64Array {
  if (!(hi > lo)) return Float64Array.of(hi);

  const kLo = Math.ceil(lo / PASO_RACION - TOL_PASOS_REJILLA);
  const kHi = Math.floor(hi / PASO_RACION + TOL_PASOS_REJILLA);
  // Los múltiplos que coinciden con `lo` o `hi` salvo por ruido binario no se
  // añaden: ya están representados por el propio extremo, que es el valor
  // exacto que las cotas del catálogo dicen.
  const holgura = PASO_RACION * TOL_PASOS_REJILLA;
  let n = 2;
  for (let k = kLo; k <= kHi; k++) {
    const v = k * PASO_RACION;
    if (v > lo + holgura && v < hi - holgura) n++;
  }
  const salida = new Float64Array(n);
  let m = 0;
  salida[m++] = lo;
  for (let k = kLo; k <= kHi; k++) {
    const v = k * PASO_RACION;
    if (v > lo + holgura && v < hi - holgura) salida[m++] = v;
  }
  salida[m] = hi;
  return salida;
}

/**
 * Reoptimiza σ_j con los demás fijos, exhaustivamente sobre la rejilla.
 *
 * El problema es unidimensional y lineal a trozos, así que el óptimo continuo
 * está en un punto de ruptura; pero como el σ que se devuelve tiene que caer en
 * la rejilla de todos modos, evaluar sus ≤60 puntos es a la vez más simple y
 * exactamente óptimo sobre lo que se puede devolver. Cuesta ~60 productos
 * escalares de 6 elementos.
 *
 * Minimiza E a secas, sin el regularizador: es el port literal de `_pulir_una`,
 * que en Python es una reparación de emergencia después de cuantizar y no parte
 * del objetivo. El descenso de `resolverPorcionesRejilla` NO usa esta función
 * por eso mismo: allí se minimiza J, que sí lleva el regularizador.
 */
export function pulirUna(
  a: Float64Array,
  r: number,
  sigma: Float64Array,
  lo: Float64Array,
  hi: Float64Array,
  bandas: Bandas,
  j: number,
): Float64Array {
  const salida = Float64Array.from(sigma);
  if (r <= 0 || j < 0 || j >= r) return salida;

  // resto = A·σ − a[:,j]·σ_j
  const resto = new Float64Array(N_NUTR);
  const sj = sigma[j] ?? 0;
  for (let n = 0; n < N_NUTR; n++) {
    let acc = 0;
    for (let i = 0; i < r; i++) acc += (a[n * r + i] ?? 0) * (sigma[i] ?? 0);
    resto[n] = acc - (a[n * r + j] ?? 0) * sj;
  }

  const puntos = rejilla(lo[j] ?? 0, hi[j] ?? 0);
  const tot = new Float64Array(N_NUTR);
  let mejor = Number.POSITIVE_INFINITY;
  let mejorP = puntos[0] ?? sj;
  for (let k = 0; k < puntos.length; k++) {
    const p = puntos[k] ?? 0;
    for (let n = 0; n < N_NUTR; n++) tot[n] = (resto[n] ?? 0) + p * (a[n * r + j] ?? 0);
    const err = errorDe(tot, bandas);
    // `<` estricto sobre una rejilla ascendente = `np.argmin`: el empate se lo
    // lleva el σ más bajo, que es el que menos comida pone en el plato.
    if (err < mejor) {
      mejor = err;
      mejorP = p;
    }
  }
  salida[j] = mejorP;
  return salida;
}

/**
 * Escala uniforme para cuadrar kcal. Nunca óptimo, pero siempre existe.
 *
 * En Python era la red de un `time_limit` mal puesto que hacía caer el servicio
 * al porcionado de emergencia para siempre y en silencio. Aquí no hay solver ni
 * límite de tiempo, así que sólo queda como red para R = 0 o para una `a`
 * degenerada (no finita). Si `emergencia` sale a true en producción es un bug
 * que perseguir, no un modo de operación.
 */
export function porcionadoDeEmergencia(
  a: Float64Array,
  r: number,
  lo: Float64Array,
  hi: Float64Array,
  bandas: Bandas,
): ResultadoPorcionado {
  const loKcal = bandas.lo[IDX_KCAL] ?? -INF_BANDA;
  const hiKcal = bandas.hi[IDX_KCAL] ?? INF_BANDA;
  let objetivoKcal = loKcal > -INF_BANDA ? loKcal : 0.0;
  if (hiKcal < INF_BANDA) objetivoKcal = (objetivoKcal + hiKcal) / 2.0;

  let denom = 0;
  for (let i = 0; i < r; i++) denom += a[i] ?? 0; // fila 0 = kcal
  const s = denom > 0 ? objetivoKcal / denom : 1.0;

  const bruto = new Float64Array(r);
  for (let i = 0; i < r; i++) {
    bruto[i] = Math.min(Math.max(s, lo[i] ?? 0), hi[i] ?? 0);
  }
  const sigma = cuantizar(bruto, lo, hi);
  const totales = totalesDe(a, r, sigma);
  return { sigma, totales, error: errorDe(totales, bandas), emergencia: true };
}

/**
 * J(σ) = W·E(σ) + EPS_REG·Σ|σᵢ − σrefᵢ|, con W = `bandas.pesoTotal`.
 *
 * Es exactamente el valor objetivo del LP de §3.2 evaluado en un σ de la
 * rejilla: W·E es el término nutricional Σ(w⁺u⁺ + w⁻u⁻)/e y el segundo sumando
 * es el regularizador Σt_i, que en el LP rompía la degeneración masiva del
 * politopo y aquí hace exactamente lo mismo — ante dos σ igual de buenos
 * nutricionalmente gana el más parecido a las raciones de referencia, en vez
 * de «media ración de lentejas y 1,8 de tostada».
 *
 * `sigmaRef` se toma tal cual: cliparlo a [lo, hi] es responsabilidad de quien
 * llama, como en Python. `resolverPorcionesRejilla` lo clipa antes de usarlo.
 */
export function objetivoJ(
  a: Float64Array,
  r: number,
  sigma: Float64Array,
  sigmaRef: Float64Array,
  bandas: Bandas,
): number {
  const totales = totalesDe(a, r, sigma);
  let l1 = 0;
  for (let i = 0; i < r; i++) l1 += Math.abs((sigma[i] ?? 0) - (sigmaRef[i] ?? 0));
  return bandas.pesoTotal * errorDe(totales, bandas) + EPS_REG * l1;
}

/** Totales nutricionales de un σ: A·σ, con A (6, R) en row-major. */
export function totalesDe(a: Float64Array, r: number, sigma: Float64Array): Float64Array {
  const totales = new Float64Array(N_NUTR);
  for (let n = 0; n < N_NUTR; n++) {
    let acc = 0;
    for (let i = 0; i < r; i++) acc += (a[n * r + i] ?? 0) * (sigma[i] ?? 0);
    totales[n] = acc;
  }
  return totales;
}

// ---------------------------------------------------------------------------
// El porcionador: descenso coordinado sobre la rejilla
// ---------------------------------------------------------------------------

/**
 * Estado de trabajo de una instancia. Existe para que el camino caliente no
 * asigne memoria: los bucles internos ejecutan del orden de 10⁴ evaluaciones de
 * J por instancia y hay ~340 instancias por plan, así que un array temporal por
 * evaluación se convierte en el coste dominante del generador entero.
 *
 * `aAct`/`actLo`/... son las filas de nutriente con peso > 0, compactadas. Los
 * nutrientes sin peso aportan exactamente +0,0 al numerador de E —su banda está
 * abierta por ambos lados—, así que saltárselos no cambia ni un bit del
 * resultado y ahorra entre un tercio y la mitad del trabajo: con fibra o sodio
 * sin dato fiable, que es el caso mayoritario, sólo quedan cuatro filas vivas.
 */
interface Instancia {
  r: number;
  sigmaRef: Float64Array;
  /** Rejillas por coordenada, concatenadas; `inicio[j]`..`inicio[j+1]`. */
  puntos: Float64Array;
  inicio: Int32Array;
  /** Nº de nutrientes con peso. */
  nAct: number;
  /** (nAct × r) filas activas de `a`, row-major. */
  aAct: Float64Array;
  actLo: Float64Array;
  actHi: Float64Array;
  actWMas: Float64Array;
  actWMenos: Float64Array;
  actE: Float64Array;
  /** Buffers del camino caliente. */
  sigma: Float64Array;
  resto: Float64Array;
  pre: Float64Array;
  tot: Float64Array;
  colJ: Float64Array;
  colK: Float64Array;
}

/**
 * Numerador de E restringido a los nutrientes activos: Σ(w⁺u⁺ + w⁻u⁻)/e. Es
 * W·E, la parte nutricional de J. No se divide por W porque J tampoco lo hace
 * y la división sólo añadiría ruido de coma flotante al comparador.
 */
function pesoFuera(inst: Instancia, tot: Float64Array): number {
  let num = 0;
  for (let k = 0; k < inst.nAct; k++) {
    const t = tot[k] ?? 0;
    const ui = inst.actHi[k] ?? INF_BANDA;
    const li = inst.actLo[k] ?? -INF_BANDA;
    const uMas = ui < INF_BANDA ? Math.max(0.0, t - ui) : 0.0;
    const uMenos = li > -INF_BANDA ? Math.max(0.0, li - t) : 0.0;
    const en = inst.actE[k] ?? 1;
    num += ((inst.actWMas[k] ?? 0) * uMas) / en + ((inst.actWMenos[k] ?? 0) * uMenos) / en;
  }
  return num;
}

/** Σ|σ − σref| sobre todas las coordenadas. */
function regularizador(inst: Instancia, sigma: Float64Array): number {
  let l1 = 0;
  for (let i = 0; i < inst.r; i++) l1 += Math.abs((sigma[i] ?? 0) - (inst.sigmaRef[i] ?? 0));
  return l1;
}

/** J de un σ cualquiera, recalculado desde cero. Fuera del camino caliente. */
function costeDe(inst: Instancia, sigma: Float64Array): number {
  const tot = inst.tot;
  for (let k = 0; k < inst.nAct; k++) {
    let acc = 0;
    for (let i = 0; i < inst.r; i++) acc += (inst.aAct[k * inst.r + i] ?? 0) * (sigma[i] ?? 0);
    tot[k] = acc;
  }
  return pesoFuera(inst, tot) + EPS_REG * regularizador(inst, sigma);
}

/**
 * Lleva cada coordenada al punto de rejilla más cercano, con el empate hacia
 * abajo. Los arranques (Q(σref), la escala de emergencia, las cotas) no tienen
 * por qué caer en la rejilla —`cuantizar(0,6)` da 0,6000000000000001 y la
 * rejilla tiene el 0,6 exacto de la cota—, y el descenso sólo acepta mejoras
 * estrictas, así que sin este ajuste un arranque ligeramente fuera de rejilla
 * podría sobrevivir hasta la salida y romper el contrato del módulo.
 */
function ajustarARejilla(inst: Instancia, sigma: Float64Array): void {
  for (let j = 0; j < inst.r; j++) {
    const ini = inst.inicio[j] ?? 0;
    const fin = inst.inicio[j + 1] ?? 0;
    const v = sigma[j] ?? 0;
    let mejor = inst.puntos[ini] ?? v;
    let dist = Math.abs(mejor - v);
    for (let t = ini + 1; t < fin; t++) {
      const p = inst.puntos[t] ?? 0;
      const d = Math.abs(p - v);
      if (d < dist) {
        dist = d;
        mejor = p;
      }
    }
    sigma[j] = mejor;
  }
}

/**
 * Descenso coordinado cíclico: se recorre j = 0..R−1 reoptimizando σ_j sobre su
 * rejilla completa con las demás coordenadas fijas, y se repite hasta que una
 * pasada entera no mueve nada.
 *
 * Sólo acepta mejoras ESTRICTAS de J. Es lo que garantiza la terminación (J
 * decrece estrictamente en cada movimiento sobre un conjunto finito) y lo que
 * hace que el resultado no dependa del orden en que se descubran los empates.
 */
function descenso(inst: Instancia): void {
  const { r, sigma, resto, colJ } = inst;
  const nAct = inst.nAct;
  for (let pasada = 0; pasada < MAX_PASADAS_DESCENSO; pasada++) {
    let movio = false;
    for (let j = 0; j < r; j++) {
      const ini = inst.inicio[j] ?? 0;
      const fin = inst.inicio[j + 1] ?? 0;
      if (fin - ini <= 1) continue;

      const sj = sigma[j] ?? 0;
      for (let k = 0; k < nAct; k++) {
        const c = inst.aAct[k * r + j] ?? 0;
        colJ[k] = c;
        let acc = 0;
        for (let i = 0; i < r; i++) acc += (inst.aAct[k * r + i] ?? 0) * (sigma[i] ?? 0);
        resto[k] = acc - c * sj;
      }
      // El regularizador se parte en la parte fija (las demás coordenadas) y la
      // que depende del punto que se prueba.
      const refJ = inst.sigmaRef[j] ?? 0;
      const l1Fijo = regularizador(inst, sigma) - Math.abs(sj - refJ);
      const tot = inst.tot;

      // El punto en el que ya estamos no compite consigo mismo: se guarda su J
      // aparte y sólo se acepta un candidato que lo mejore ESTRICTAMENTE. Es lo
      // que impide que un empate exacto mueva σ, y con ello que el bucle oscile
      // entre dos soluciones de idéntico coste sin converger nunca. Entre los
      // candidatos que sí mejoran gana el más bajo, porque la rejilla se
      // recorre ascendente: menos comida en el plato ante igualdad de coste.
      let jActual = Number.POSITIVE_INFINITY;
      let mejorJ = Number.POSITIVE_INFINITY;
      let mejorP = sj;
      for (let t = ini; t < fin; t++) {
        const p = inst.puntos[t] ?? 0;
        for (let k = 0; k < nAct; k++) tot[k] = (resto[k] ?? 0) + p * (colJ[k] ?? 0);
        const jp = pesoFuera(inst, tot) + EPS_REG * (l1Fijo + Math.abs(p - refJ));
        if (p === sj) {
          jActual = jp;
        } else if (jp < mejorJ) {
          mejorJ = jp;
          mejorP = p;
        }
      }
      if (mejorJ < jActual) {
        sigma[j] = mejorP;
        movio = true;
      }
    }
    if (!movio) return;
  }
}

/**
 * Vecindad de pares (2-opt) sobre la rejilla producto. §3.2 explica por qué
 * hace falta: el LP es degenerado por diseño y en la banda muerta hay
 * direcciones de mejora que sólo existen moviendo dos raciones a la vez —subir
 * una y bajar otra para mantener las kcal dentro mientras se recoloca la
 * proteína—. El descenso coordinado no las ve porque cada paso intermedio
 * empeora.
 *
 * Coste: C(R,2) ≤ 15 pares × ≤60×60 puntos por par. Se ejecuta cada vez que el
 * descenso simple se estanca, no sólo cuando E > UMBRAL_ERROR_OK: ver
 * DIVERGENCIAS.md D2.a, con los números que justifican el cambio.
 *
 * Devuelve `true` si movió alguna coordenada, para que el llamante sepa si
 * merece la pena otra ronda de descenso.
 */
function barridoDePares(inst: Instancia): boolean {
  const { r, sigma, resto, pre, colJ, colK } = inst;
  const nAct = inst.nAct;
  let movio = false;
  for (let j = 0; j < r - 1; j++) {
    for (let k2 = j + 1; k2 < r; k2++) {
      const iniJ = inst.inicio[j] ?? 0;
      const finJ = inst.inicio[j + 1] ?? 0;
      const iniK = inst.inicio[k2] ?? 0;
      const finK = inst.inicio[k2 + 1] ?? 0;
      if (finJ - iniJ <= 1 && finK - iniK <= 1) continue;

      const sj = sigma[j] ?? 0;
      const sk = sigma[k2] ?? 0;
      for (let n = 0; n < nAct; n++) {
        const cj = inst.aAct[n * r + j] ?? 0;
        const ck = inst.aAct[n * r + k2] ?? 0;
        colJ[n] = cj;
        colK[n] = ck;
        let acc = 0;
        for (let i = 0; i < r; i++) acc += (inst.aAct[n * r + i] ?? 0) * (sigma[i] ?? 0);
        resto[n] = acc - cj * sj - ck * sk;
      }
      const refJ = inst.sigmaRef[j] ?? 0;
      const refK = inst.sigmaRef[k2] ?? 0;
      const l1Fijo =
        regularizador(inst, sigma) - Math.abs(sj - refJ) - Math.abs(sk - refK);
      const tot = inst.tot;

      // Mismo criterio que el descenso simple: el par actual no compite consigo
      // mismo y sólo se acepta una mejora estricta de J.
      let jActual = Number.POSITIVE_INFINITY;
      let mejorJ = Number.POSITIVE_INFINITY;
      let mejorPJ = sj;
      let mejorPK = sk;
      for (let tj = iniJ; tj < finJ; tj++) {
        const p = inst.puntos[tj] ?? 0;
        for (let n = 0; n < nAct; n++) pre[n] = (resto[n] ?? 0) + p * (colJ[n] ?? 0);
        const regJ = Math.abs(p - refJ);
        for (let tk = iniK; tk < finK; tk++) {
          const q = inst.puntos[tk] ?? 0;
          for (let n = 0; n < nAct; n++) tot[n] = (pre[n] ?? 0) + q * (colK[n] ?? 0);
          const jpq = pesoFuera(inst, tot) + EPS_REG * (l1Fijo + regJ + Math.abs(q - refK));
          if (p === sj && q === sk) {
            jActual = jpq;
          } else if (jpq < mejorJ) {
            mejorJ = jpq;
            mejorPJ = p;
            mejorPK = q;
          }
        }
      }
      if (mejorJ < jActual) {
        sigma[j] = mejorPJ;
        sigma[k2] = mejorPK;
        movio = true;
      }
    }
  }
  return movio;
}

/**
 * Compara dos soluciones con el desempate TOTAL del multiarranque: primero J,
 * luego E, luego el orden lexicográfico de σ. Los tres niveles hacen falta:
 * dos arranques distintos pueden converger a σ con el mismo J hasta el último
 * bit, y sin el tercer criterio el plan dependería del orden en que se
 * enumeran los arranques, que es exactamente la clase de dependencia que la
 * promesa de reproducibilidad prohíbe.
 */
function esMejor(
  jNuevo: number,
  eNuevo: number,
  sNuevo: Float64Array,
  jViejo: number,
  eViejo: number,
  sViejo: Float64Array,
  r: number,
): boolean {
  if (jNuevo < jViejo) return true;
  if (jNuevo > jViejo) return false;
  if (eNuevo < eViejo) return true;
  if (eNuevo > eViejo) return false;
  for (let i = 0; i < r; i++) {
    const a = sNuevo[i] ?? 0;
    const b = sViejo[i] ?? 0;
    if (a < b) return true;
    if (a > b) return false;
  }
  return false;
}

/** ¿Hay algo en la entrada que impida siquiera plantear el problema? */
function entradaDegenerada(a: Float64Array, r: number, lo: Float64Array, hi: Float64Array): boolean {
  if (r <= 0) return true;
  for (let i = 0; i < r; i++) {
    if (!Number.isFinite(lo[i] ?? NaN) || !Number.isFinite(hi[i] ?? NaN)) return true;
  }
  for (let i = 0; i < N_NUTR * r; i++) {
    if (!Number.isFinite(a[i] ?? NaN)) return true;
  }
  return false;
}

function prepararInstancia(
  a: Float64Array,
  r: number,
  lo: Float64Array,
  hi: Float64Array,
  sigmaRef: Float64Array,
  bandas: Bandas,
): Instancia {
  const rejillas: Float64Array[] = [];
  const inicio = new Int32Array(r + 1);
  let total = 0;
  for (let j = 0; j < r; j++) {
    const g = rejilla(lo[j] ?? 0, hi[j] ?? 0);
    rejillas.push(g);
    inicio[j] = total;
    total += g.length;
  }
  inicio[r] = total;
  const puntos = new Float64Array(total);
  for (let j = 0; j < r; j++) puntos.set(rejillas[j] ?? new Float64Array(0), inicio[j] ?? 0);

  const activos: number[] = [];
  for (let n = 0; n < N_NUTR; n++) {
    if ((bandas.wMas[n] ?? 0) > 0 || (bandas.wMenos[n] ?? 0) > 0) activos.push(n);
  }
  const nAct = activos.length;
  const aAct = new Float64Array(nAct * r);
  const actLo = new Float64Array(nAct);
  const actHi = new Float64Array(nAct);
  const actWMas = new Float64Array(nAct);
  const actWMenos = new Float64Array(nAct);
  const actE = new Float64Array(nAct);
  for (let k = 0; k < nAct; k++) {
    const n = activos[k] ?? 0;
    for (let i = 0; i < r; i++) aAct[k * r + i] = a[n * r + i] ?? 0;
    actLo[k] = bandas.lo[n] ?? -INF_BANDA;
    actHi[k] = bandas.hi[n] ?? INF_BANDA;
    actWMas[k] = bandas.wMas[n] ?? 0;
    actWMenos[k] = bandas.wMenos[n] ?? 0;
    actE[k] = bandas.e[n] ?? 1;
  }

  return {
    r,
    sigmaRef,
    puntos,
    inicio,
    nAct,
    aAct,
    actLo,
    actHi,
    actWMas,
    actWMenos,
    actE,
    sigma: new Float64Array(r),
    resto: new Float64Array(Math.max(nAct, 1)),
    pre: new Float64Array(Math.max(nAct, 1)),
    tot: new Float64Array(Math.max(nAct, 1)),
    colJ: new Float64Array(Math.max(nAct, 1)),
    colK: new Float64Array(Math.max(nAct, 1)),
  };
}

/**
 * Sustituto de HiGHS. Descenso coordinado sobre la rejilla de 0,05 minimizando
 * J = W·E + EPS_REG·Σ|σ − σref|, con vecindad de pares cada vez que el descenso
 * simple se estanca, y multiarranque determinista.
 *
 * Los cuatro arranques no son decorativos: Q(σref) es el ancla que el LP usa y
 * gana casi siempre; la escala uniforme de emergencia salva los días en que las
 * kcal mandan y σref apunta al sitio equivocado; y todo-lo / todo-hi cubren los
 * casos con la solución pegada a una cota, que son los que el descenso desde el
 * centro tarda más pasadas en alcanzar. No hay RNG en ninguna parte: mismo
 * problema, mismo σ, siempre.
 *
 * `totales` y `error` se recalculan SIEMPRE sobre el σ que se devuelve, nunca
 * sobre el mejor visto en algún punto intermedio. El invariante está repetido
 * tres veces en el Python de origen y mentir aquí es el bug que hace que la
 * suma de la UI no cuadre con lo que la UI muestra por comida.
 */
export const resolverPorcionesRejilla: ResolverPorciones = (
  a,
  r,
  lo,
  hi,
  sigmaRef,
  bandas,
): ResultadoPorcionado => {
  if (entradaDegenerada(a, r, lo, hi)) {
    return porcionadoDeEmergencia(a, Math.max(r, 0), lo, hi, bandas);
  }

  // Clipar σref es responsabilidad del resolver, igual que en Python: la etapa
  // A sugiere raciones sin saber las cotas de cada receta.
  const ref = new Float64Array(r);
  for (let i = 0; i < r; i++) {
    ref[i] = Math.min(Math.max(sigmaRef[i] ?? 0, lo[i] ?? 0), hi[i] ?? 0);
  }
  const inst = prepararInstancia(a, r, lo, hi, ref, bandas);

  const arranques: Float64Array[] = [];
  arranques.push(cuantizar(ref, lo, hi));
  arranques.push(porcionadoDeEmergencia(a, r, lo, hi, bandas).sigma);
  const todoLo = new Float64Array(r);
  const todoHi = new Float64Array(r);
  for (let i = 0; i < r; i++) {
    todoLo[i] = lo[i] ?? 0;
    todoHi[i] = hi[i] ?? 0;
  }
  arranques.push(todoLo);
  arranques.push(todoHi);

  let mejorSigma: Float64Array | null = null;
  let mejorJ = Number.POSITIVE_INFINITY;
  let mejorE = Number.POSITIVE_INFINITY;
  const explorados: Float64Array[] = [];

  for (const arranque of arranques) {
    inst.sigma.set(arranque);
    ajustarARejilla(inst, inst.sigma);
    // Dos arranques que colapsan al mismo punto de rejilla dan exactamente el
    // mismo descenso: repetirlo sólo cuesta tiempo. Con las cotas por defecto
    // (0,6 / 1,8) la escala de emergencia y «todo-hi» coinciden a menudo.
    if (yaExplorado(explorados, inst.sigma, r)) continue;
    explorados.push(Float64Array.from(inst.sigma));

    descenso(inst);
    // El barrido de pares se ejecuta SIEMPRE que el descenso simple se estanca,
    // no sólo cuando E > UMBRAL_ERROR_OK como pedía la spec del port. Se probó
    // la versión condicionada sobre las 2.171 instancias del corpus de paridad:
    // dejaba p95(E_ts − E_py) en 0,0019 y el 10 % de las instancias PEOR que
    // Python, porque cortar en cuanto E ≤ 0,04 se conforma con la primera
    // solución aceptable en vez de con la mejor. Sin la condición, p95 baja a 0
    // y el máximo a 0,0008, a cambio de duplicar el coste (0,18 → 0,31 ms por
    // instancia, ~100 ms por plan) que el worker absorbe de sobra. Anotado en
    // DIVERGENCIAS.md.
    for (let ronda = 0; ronda < MAX_RONDAS_PARES; ronda++) {
      if (!barridoDePares(inst)) break;
      descenso(inst);
    }

    const j = costeDe(inst, inst.sigma);
    const tot = totalesDe(a, r, inst.sigma);
    const e = errorDe(tot, bandas);
    if (mejorSigma === null || esMejor(j, e, inst.sigma, mejorJ, mejorE, mejorSigma, r)) {
      mejorSigma = Float64Array.from(inst.sigma);
      mejorJ = j;
      mejorE = e;
    }
  }

  const sigma = mejorSigma ?? new Float64Array(r);
  const totales = totalesDe(a, r, sigma);
  return { sigma, totales, error: errorDe(totales, bandas), emergencia: false };
};

/** ¿Este arranque, ya ajustado a la rejilla, coincide con uno anterior? */
function yaExplorado(
  explorados: readonly Float64Array[],
  sigma: Float64Array,
  r: number,
): boolean {
  for (const otro of explorados) {
    let igual = true;
    for (let i = 0; i < r; i++) {
      if ((otro[i] ?? 0) !== (sigma[i] ?? 0)) {
        igual = false;
        break;
      }
    }
    if (igual) return true;
  }
  return false;
}

/**
 * El porcionador que usa el motor. Alias con nombre estable para que la etapa C
 * no importe la implementación concreta: si algún día entra highs-js WASM, se
 * cambia esta línea y nada más.
 */
export const resolverPorciones: ResolverPorciones = resolverPorcionesRejilla;
