/**
 * Primitivos numéricos que numpy regala y JavaScript no tiene.
 *
 * Este módulo no toma ni una decisión de producto: es la capa que permite que
 * el resto del port se lea como el Python de origen. Existe por una razón muy
 * concreta: cada vez que una de estas piezas se improvisa en el sitio donde
 * hace falta aparece una variante sutilmente distinta —`Math.round` en vez de
 * redondeo bancario, ddof=1 en vez de ddof=0, `<` sobre strings en vez de
 * comparación por code point— y el síntoma no es una excepción, es OTRO plan
 * con el mismo seed. Aquí hay una sola versión de cada cosa y está probada.
 *
 * Tres reglas que valen para todo el fichero:
 *
 * 1. Bucles planos sobre typed arrays, jamás BigInt ni arrays de objetos.
 *    `popcountAnd` se ejecuta P×W veces por cada `scoreSlot` y hay ~500
 *    `scoreSlot` por semana (DISENO §7.1); con BigInt esto pasa de decenas de
 *    ms a segundos y bloquea el worker.
 * 2. Las lecturas indexadas llevan `?? 0`. El tsconfig tiene
 *    `noUncheckedIndexedAccess` y un typed array nunca devuelve `undefined`
 *    dentro de rango, así que la coalescencia es una anotación de tipos sin
 *    coste. Lo que sí taparía es una lectura FUERA de rango, que pasaría a
 *    valer 0 en silencio; por eso las funciones que reciben longitudes y
 *    desplazamientos del llamante los validan, salvo las tres del camino
 *    caliente, que lo declaran en su documentación.
 * 3. Cada función dice en qué se diferencia de numpy, si es que se diferencia.
 *    Hay una diferencia común a todas las reducciones y no se repite en cada
 *    una: numpy suma por pares (pairwise summation, bloques de 128) y aquí se
 *    suma de izquierda a derecha. No se intenta reproducir. La promesa del
 *    port es «mismo seed en el mismo motor JS → mismo plan», no paridad bit a
 *    bit con numpy (port-typescript.md, decisión del árbol de RNG), y el
 *    orden de sumación no es lo que la rompería: `Math.exp` y `Math.acos` ya
 *    lo hacen.
 */

// Máscaras del popcount SWAR. Son constantes DEL ALGORITMO, no parámetros del
// motor: cambiarlas no es una decisión de producto, es romper la función. Por
// eso viven aquí y no en constantes.ts, que es el sitio de las constantes cuyo
// cambio obliga a subir VERSION_GENERADOR.
const SWAR_PARES = 0x55555555;
const SWAR_CUARTETOS = 0x33333333;
const SWAR_OCTETOS = 0x0f0f0f0f;
const SWAR_ACUMULA_BYTES = 0x01010101;

/**
 * Bits por palabra del bitset. Los bitsets del motor son `Uint32Array` con
 * W32 = ceil(nAlimentos/32) (port-typescript.md, representación de datos), no
 * los uint64 de numpy. Se exporta porque `semanal.ts` dimensiona el contador
 * de ingredientes únicos con w32 × este número: el Python usa ×64 y copiarlo
 * sin pensar reserva el doble de memoria y, peor, desalinea los índices que
 * produce `bitsAIndices`.
 */
export const BITS_POR_PALABRA = 32;

// ---------------------------------------------------------------------------
// Bitsets: popcount SWAR y álgebra de conjuntos
// ---------------------------------------------------------------------------

/**
 * Bits a 1 de una palabra de 32 bits. Equivale a `np.bitwise_count` sobre
 * uint32.
 *
 * SWAR clásico: suma en paralelo dentro de la propia palabra. El detalle que
 * importa en JS es que TODAS las operaciones intermedias usan `>>>` y `&`, que
 * fuerzan la interpretación sin signo; con `>>` una palabra con el bit 31
 * puesto arrastraría el signo y devolvería basura. Acepta tanto un entero sin
 * signo (0..2^32−1, como sale de un `Uint32Array`) como el int32 con signo que
 * producen los operadores bitwise de JS: `0xffffffff` y `-1` dan ambos 32.
 */
export function popcount32(x: number): number {
  let v = x >>> 0;
  v = v - ((v >>> 1) & SWAR_PARES);
  v = (v & SWAR_CUARTETOS) + ((v >>> 2) & SWAR_CUARTETOS);
  v = (v + (v >>> 4)) & SWAR_OCTETOS;
  return (v * SWAR_ACUMULA_BYTES) >>> 24;
}

/**
 * Bits a 1 de una fila del bitset: `np.bitwise_count(bits[i]).sum()`.
 *
 * CAMINO CALIENTE: no valida `off` ni `w`. El llamante pasa `off = fila * w`.
 */
export function popcountFila(bits: Uint32Array, off: number, w: number): number {
  let n = 0;
  for (let k = 0; k < w; k++) n += popcount32(bits[off + k] ?? 0);
  return n;
}

/**
 * Bits a 1 de la intersección de dos filas:
 * `np.bitwise_count(a & b).sum(axis=1)` de `scoring.py:158,355,364` y
 * `diagnostico.py:139`, para UNA fila.
 *
 * CAMINO CALIENTE: no valida nada. Es la función más ejecutada del motor
 * (P×W por `scoreSlot`), así que aquí no entra ni una comprobación.
 */
export function popcountAnd(
  a: Uint32Array,
  offA: number,
  b: Uint32Array,
  offB: number,
  w: number,
): number {
  let n = 0;
  for (let k = 0; k < w; k++) n += popcount32((a[offA + k] ?? 0) & (b[offB + k] ?? 0));
  return n;
}

/**
 * Bits a 1 de A \ B (`a & ~b`), es decir cuántos elementos de la fila `a` NO
 * están en `b`. Con `nIngr` a mano es lo mismo que `nIngr − popcountAnd`, pero
 * escrito así no depende de que `nIngr` coincida con el popcount de la fila
 * —y hoy no siempre coincide: si el JSONL trae ingredientes duplicados o
 * alimentos fuera del índice, `nIngr` es mayor (auditoria-motor.md §despensa).
 *
 * CAMINO CALIENTE: no valida nada.
 */
export function popcountAndNot(
  a: Uint32Array,
  offA: number,
  b: Uint32Array,
  offB: number,
  w: number,
): number {
  let n = 0;
  for (let k = 0; k < w; k++) n += popcount32((a[offA + k] ?? 0) & ~(b[offB + k] ?? 0));
  return n;
}

/**
 * `dst |= src` sobre una fila. Es el `np.bitwise_or.reduce` con el que
 * `reparacion.py:121` funde los ingredientes de las recetas de un día y con el
 * que `semanal.ts` acumula `bitsSemana`.
 */
export function orEnSitio(
  dst: Uint32Array,
  offDst: number,
  src: Uint32Array,
  offSrc: number,
  w: number,
): void {
  for (let k = 0; k < w; k++) dst[offDst + k] = (dst[offDst + k] ?? 0) | (src[offSrc + k] ?? 0);
}

/**
 * `dst &= src` sobre una fila.
 *
 * Honestidad: hoy NINGÚN módulo del motor la usa —el Python sólo necesita el
 * OR para fundir los ingredientes de un día—. Está aquí porque el álgebra de
 * conjuntos incompleta es lo que empuja al siguiente módulo a escribirse su
 * propio bucle de bitset, y dos representaciones del mismo bitset conviviendo
 * es exactamente el fallo contra el que avisa la auditoría. Si dentro de unas
 * semanas sigue sin consumidor, se borra.
 */
export function andEnSitio(
  dst: Uint32Array,
  offDst: number,
  src: Uint32Array,
  offSrc: number,
  w: number,
): void {
  for (let k = 0; k < w; k++) dst[offDst + k] = (dst[offDst + k] ?? 0) & (src[offSrc + k] ?? 0);
}

/** `dst &= ~src` sobre una fila. Sin consumidor hoy, igual que `andEnSitio`. */
export function andNotEnSitio(
  dst: Uint32Array,
  offDst: number,
  src: Uint32Array,
  offSrc: number,
  w: number,
): void {
  for (let k = 0; k < w; k++) dst[offDst + k] = (dst[offDst + k] ?? 0) & ~(src[offSrc + k] ?? 0);
}

/**
 * Índices de alimento de los bits activos de una fila. Puerto de
 * `semanal.bits_a_indices`, que los precalcula por candidato para que el
 * contador incremental de ingredientes únicos del recocido cueste ~40
 * operaciones por movimiento en vez de ~500 (DISENO §5.2).
 *
 * Diferencia con Python: allí es `(v & -v).bit_length() - 1` sobre palabras de
 * 64 bits; aquí es `31 - Math.clz32(v & -v)` sobre palabras de 32. El
 * `>>> 0` tras cada `v &= v - 1` no es cosmético: los operadores bitwise de JS
 * devuelven int32 CON SIGNO, y una palabra con el bit 31 puesto se volvería
 * negativa y saldría del bucle por el sitio equivocado.
 *
 * Devuelve cuántos índices ha escrito. Lanza si `salida` se queda corta: en
 * este módulo un desbordamiento silencioso sería indepurable tres capas más
 * arriba.
 */
export function bitsAIndices(
  bits: Uint32Array,
  off: number,
  w: number,
  salida: Int32Array,
): number {
  let m = 0;
  for (let k = 0; k < w; k++) {
    let v = (bits[off + k] ?? 0) >>> 0;
    while (v !== 0) {
      const bajo = (v & -v) >>> 0;
      if (m >= salida.length) {
        throw new Error(`bitsAIndices: la salida no cabe (${salida.length} huecos)`);
      }
      salida[m] = k * BITS_POR_PALABRA + (31 - Math.clz32(bajo));
      m++;
      v = (v & (v - 1)) >>> 0;
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Redondeo bancario y el formato ":.0f" de Python
// ---------------------------------------------------------------------------

/**
 * Redondeo al entero más cercano con los empates al PAR, como `np.round`.
 *
 * `Math.round` no sirve: redondea los empates hacia +∞ (`Math.round(-0.5)` es
 * −0 pero `Math.round(0.5)` es 1 y `Math.round(2.5)` es 3). La diferencia
 * aparece en `cuantizar` —σ/0,05 cae en un empate exacto con muchísima más
 * frecuencia de la que la intuición sugiere, porque σ viene de una rejilla de
 * 0,05— y en `fmt0`, que alimenta los números que los tests de diagnóstico
 * parsean con regex.
 *
 * Conserva el cero negativo igual que numpy: `np.round(-0.2)` es `-0.0` y
 * `f'{-0.2:.0f}'` es `'-0'`. Parece un detalle sin consecuencias hasta que se
 * imprime.
 *
 * El empate se detecta con la parte fraccionaria exacta (`x - floor(x)`, que
 * es exacta en binario para todo double), no comparando con `x % 1`, y por
 * tanto NO redondea 0.49999999999999994 hacia arriba, que es justo el caso en
 * el que fallan las implementaciones basadas en `floor(x + 0.5)`.
 */
export function redondeoMitadAPar(x: number): number {
  if (!Number.isFinite(x)) return x;
  const suelo = Math.floor(x);
  const resto = x - suelo;
  let r: number;
  if (resto > 0.5) r = suelo + 1;
  else if (resto < 0.5) r = suelo;
  else r = suelo % 2 === 0 ? suelo : suelo + 1;
  return r === 0 && (x < 0 || Object.is(x, -0)) ? -0 : r;
}

/**
 * Equivalente a `f'{x:.0f}'` de Python. NO es `toFixed(0)`.
 *
 * Tres divergencias de `toFixed(0)`, y las tres se ven en pantalla:
 * `(0.5).toFixed(0)` es `'1'` y Python escribe `'0'` (empates al par);
 * `(-0.5).toFixed(0)` es `'-1'` y Python escribe `'-0'`; y a partir de 1e21
 * `String`/`toFixed` pasan a notación exponencial mientras Python sigue
 * escribiendo todas las cifras.
 *
 * Todas las interpolaciones numéricas de `diagnostico.ts` pasan por aquí
 * (port-typescript.md, notas de diagnóstico), y hay tests de producto que
 * extraen esos números con regex y vuelven a pedir un plan con ellos: un
 * redondeo de más hacia arriba en «puedes llegar a 138 g» convierte un test de
 * honestidad en un fallo real.
 */
export function fmt0(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  const r = redondeoMitadAPar(x);
  if (Object.is(r, -0)) return '-0';
  // Aquí `r` ya es un entero exacto, así que BigInt lo escribe sin perder una
  // cifra. Es un camino frío —mensajes de diagnóstico, nunca un bucle—, que es
  // la única razón por la que se permite BigInt en este paquete.
  return Math.abs(r) >= 1e21 ? BigInt(r).toString() : String(r);
}

// ---------------------------------------------------------------------------
// Reducciones y estadística
// ---------------------------------------------------------------------------

/** Suma de los `n` primeros elementos. `v.sum()`. */
export function suma(v: Float64Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += v[i] ?? 0;
  return s;
}

/** Media de los `n` primeros elementos. `v.mean()`. Devuelve NaN si n = 0, como numpy. */
export function media(v: Float64Array, n: number): number {
  return suma(v, n) / n;
}

/**
 * Fracción de elementos no nulos de una máscara. Es el `bool.mean()` de
 * `scoring.py`, del que cuelga la puerta `FRACCION_MINIMA_PRECIOS`: si menos
 * del 80 % del pool tiene precio conocido, el término de coste se apaga entero.
 */
export function mediaUint8(v: Uint8Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += (v[i] ?? 0) !== 0 ? 1 : 0;
  return s / n;
}

/**
 * Producto escalar de dos tramos. Cubre a la vez el `a @ sigma` del porcionado
 * y la «suma ponderada» de `error_de` (Σ w·u), que es el mismo bucle con
 * desplazamiento 0.
 *
 * CAMINO CALIENTE: no valida desplazamientos.
 */
export function productoPunto(
  a: Float64Array,
  offA: number,
  b: Float64Array,
  offB: number,
  n: number,
): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[offA + i] ?? 0) * (b[offB + i] ?? 0);
  return s;
}

/**
 * Norma euclídea. Es el `np.linalg.norm` de `vector_macro`, que allí opera
 * sobre 3 componentes float64.
 *
 * Diferencia con numpy: numpy usa BLAS (`nrm2`), que escala para evitar
 * desbordamientos intermedios. Aquí las tres componentes son fracciones de
 * kcal en [0,1], así que no hay nada que desbordar; documentarlo por si algún
 * día se le pasa un vector de magnitudes distintas.
 */
export function normaL2(v: Float64Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const x = v[i] ?? 0;
    s += x * x;
  }
  return Math.sqrt(s);
}

/**
 * Media y desviación típica POBLACIONAL (ddof = 0), como `np.std` por defecto.
 *
 * Dividir por n−1 es el valor por defecto de casi toda librería estadística de
 * JS y sería un error sin síntoma: cambiaría TODAS las probabilidades del
 * softmax del muestreo (DISENO §2.4) sin que nada fallara, sólo eligiendo
 * otras recetas. Con n = 25 el sesgo es del 2 % en la desviación, suficiente
 * para mover el orden de las colas de la distribución.
 *
 * Se calcula en dos pasadas (media y luego suma de cuadrados de las
 * desviaciones), igual que numpy: la fórmula de un solo paso E[x²]−E[x]²
 * cancela catastróficamente cuando la media es grande frente a la dispersión,
 * que es exactamente el caso de los scores del top-K.
 *
 * Con n = 1 devuelve desv = 0 (numpy también); con n = 0, NaN.
 */
export function desviacionPoblacional(
  v: Float64Array,
  n: number,
): { media: number; desv: number } {
  const m = media(v, n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const d = (v[i] ?? 0) - m;
    acc += d * d;
  }
  return { media: m, desv: Math.sqrt(acc / n) };
}

/**
 * Softmax numéricamente estable sobre `n` logits, escrito en `salida`.
 *
 * Resta el máximo antes de exponenciar. No es una precaución teórica: en el
 * muestreo los logits son z/τ con τ ≥ 1e-6, así que un z de 3 desviaciones da
 * un exponente de 3e6 y `Math.exp` devuelve Infinity; sin la resta, el reparto
 * de probabilidad sale NaN y `choice` elige lo que caiga.
 *
 * Normaliza por la suma, no por el último acumulado: eso es cosa de `choice`,
 * que además vuelve a normalizar por el último elemento de la CDF.
 */
export function softmaxEstable(logits: Float64Array, n: number, salida: Float64Array): void {
  if (n <= 0) return;
  let maximo = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = logits[i] ?? 0;
    if (x > maximo) maximo = x;
  }
  let total = 0;
  for (let i = 0; i < n; i++) {
    const e = Math.exp((logits[i] ?? 0) - maximo);
    salida[i] = e;
    total += e;
  }
  for (let i = 0; i < n; i++) salida[i] = (salida[i] ?? 0) / total;
}

// ---------------------------------------------------------------------------
// Clip y álgebra vectorial
// ---------------------------------------------------------------------------

/**
 * `np.clip(x, lo, hi)`. El orden importa: numpy aplica primero el mínimo y
 * luego el máximo, así que con cotas cruzadas (lo > hi) GANA hi. No es una
 * hipótesis: `_cuantizar` clipa contra escalaMin/escalaMax del catálogo y una
 * receta mal capturada con min > max no debe volverse un σ enorme.
 */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

/** `np.clip` componente a componente con cotas vectoriales, en sitio. */
export function clipEnSitio(
  v: Float64Array,
  lo: Float64Array,
  hi: Float64Array,
  n: number,
): void {
  for (let i = 0; i < n; i++) v[i] = clamp(v[i] ?? 0, lo[i] ?? 0, hi[i] ?? 0);
}

/**
 * Matvec (P,3)·(3,) row-major, escrito en `salida` (P,). Es el
 * `pool.v_macro @ v_res` del término de encaje composicional.
 *
 * Diferencia con numpy: numpy acumula en float32 (sgemv sobre dos float32);
 * aquí se acumula en float64 y sólo se redondea al escribir, y sólo si el
 * llamante pasa un `Float32Array` de salida —que es lo que hay que hacer allí
 * donde Python materializa un float32—. Es más preciso, no menos, y la
 * decisión de no emular float32 en cada operación intermedia está tomada en
 * port-typescript.md: no daría paridad de todas formas, porque `Math.acos` de
 * V8 no está obligado a coincidir a 1 ULP con la libm de CPython.
 */
export function matvec3(
  m: Float32Array,
  p: number,
  v: Float32Array | Float64Array,
  salida: Float32Array | Float64Array,
): void {
  if (v.length < 3) throw new Error('matvec3: el vector debe tener 3 componentes');
  if (m.length < p * 3 || salida.length < p) throw new Error('matvec3: dimensiones incoherentes');
  const v0 = v[0] ?? 0;
  const v1 = v[1] ?? 0;
  const v2 = v[2] ?? 0;
  for (let i = 0; i < p; i++) {
    const o = i * 3;
    salida[i] = (m[o] ?? 0) * v0 + (m[o + 1] ?? 0) * v1 + (m[o + 2] ?? 0) * v2;
  }
}

// ---------------------------------------------------------------------------
// Orden y selección deterministas
// ---------------------------------------------------------------------------

/**
 * Índice del primer mínimo. `np.argmin`: en caso de empate gana el índice más
 * bajo, y de eso depende `pulirUna`, que recorre la rejilla ascendente y por
 * tanto devuelve el σ MÁS BAJO de los que empatan en error. Cambiar el `<` por
 * `<=` mueve porciones sin cambiar el error, y con ello la lista de la compra.
 *
 * Devuelve −1 si n ≤ 0.
 */
export function argminEstable(v: Float64Array, n: number): number {
  let mejor = -1;
  let valor = Infinity;
  for (let i = 0; i < n; i++) {
    const x = v[i] ?? 0;
    if (mejor < 0 || x < valor) {
      mejor = i;
      valor = x;
    }
  }
  return mejor;
}

/** Índice del primer máximo. `np.argmax`, con el mismo desempate por índice bajo. */
export function argmaxEstable(v: Float64Array, n: number): number {
  let mejor = -1;
  let valor = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = v[i] ?? 0;
    if (mejor < 0 || x > valor) {
      mejor = i;
      valor = x;
    }
  }
  return mejor;
}

/**
 * Compara dos ids como los compara Python: por CODE POINT.
 *
 * El `<` de JavaScript compara por code unit UTF-16, y las dos ordenaciones
 * difieren en cuanto aparece un carácter fuera del BMP: «😀» (U+1F600) empieza
 * por el surrogate D83D, así que para JS va ANTES de U+FFFD y para Python va
 * después. Los 36 ids del catálogo semilla son ASCII y hoy da igual; se
 * escribe bien igualmente porque este comparador es el desempate del top-K,
 * «el fallo de reproducibilidad más fácil de introducir» según el propio
 * docstring de `muestrear` (DISENO §2.4), y porque el día que alguien meta un
 * id con acento el fallo sería un plan distinto, no un error.
 *
 * Prefijo antes que extensión, como Python: 'ab' < 'abc'.
 */
export function comparaId(a: string, b: string): number {
  if (a === b) return 0;
  let ia = 0;
  let ib = 0;
  while (ia < a.length && ib < b.length) {
    const ca = a.codePointAt(ia) ?? 0;
    const cb = b.codePointAt(ib) ?? 0;
    if (ca !== cb) return ca < cb ? -1 : 1;
    ia += ca > 0xffff ? 2 : 1;
    ib += cb > 0xffff ? 2 : 1;
  }
  if (ia >= a.length && ib >= b.length) return 0;
  return ia >= a.length ? -1 : 1;
}

/**
 * Ordena en sitio los `n` primeros elementos de `idx` por (−score, id), que es
 * el `sorted(validos, key=lambda i: (-float(scores[i]), str(ids[i])))` de
 * `muestrear`.
 *
 * El desempate por id es OBLIGATORIO y no decorativo: `argpartition` no define
 * qué empatados deja dentro del corte, y sin este orden el mismo seed produce
 * planes distintos entre versiones de NumPy (DISENO §2.4). El tercer criterio
 * —el índice— no existe en Python porque allí `sorted` es estable; aquí se
 * añade explícitamente para no depender de si el motor de JS garantiza la
 * estabilidad de `%TypedArray%.prototype.sort`. Con ids únicos nunca se
 * dispara, así que no cambia el resultado; sólo lo blinda.
 */
export function ordenarPorScoreEId(
  idx: Int32Array,
  n: number,
  score: Float32Array,
  ids: readonly string[],
): void {
  for (let i = 0; i < n; i++) {
    const j = idx[i] ?? -1;
    if (j < 0 || j >= ids.length || j >= score.length) {
      throw new Error(`ordenarPorScoreEId: índice ${j} fuera del pool`);
    }
  }
  idx.subarray(0, n).sort((a, b) => {
    const sa = score[a] ?? 0;
    const sb = score[b] ?? 0;
    if (sa !== sb) return sa > sb ? -1 : 1;
    const c = comparaId(ids[a] ?? '', ids[b] ?? '');
    return c !== 0 ? c : a - b;
  });
}

/**
 * Permutación que ordena `v` de MAYOR a menor, estable. Es
 * `np.argsort(-kappa, kind='stable')` de la etapa C.
 *
 * Se escribe como orden descendente sobre `v` en vez de ascendente sobre `−v`
 * a propósito: negar mete un cero negativo por medio y, sobre todo, lo único
 * que se consume aguas abajo es el PRIMER índice no vetado, así que el
 * desempate (índice de slot ascendente) es la parte que hay que garantizar.
 */
export function argsortEstableDesc(v: Float64Array, n: number): Int32Array {
  const orden = new Int32Array(n);
  for (let i = 0; i < n; i++) orden[i] = i;
  orden.sort((a, b) => {
    const va = v[a] ?? 0;
    const vb = v[b] ?? 0;
    if (va !== vb) return va > vb ? -1 : 1;
    return a - b;
  });
  return orden;
}

// Buffer de trabajo de `umbralTopK`. Es estado de módulo, y se puede permitir
// porque el motor corre en un único hilo (un worker, sin SharedArrayBuffer) y
// la función no es reentrante ni se llama desde un comparador. Evita una
// asignación de P flotantes en cada uno de los ~500 muestreos de una semana.
let bufSeleccion = new Float32Array(0);

/**
 * Valor del k-ésimo mayor de `v` (k en base 1), sin ordenar el array entero y
 * sin modificar la entrada. Sustituye a
 * `s_val[np.argpartition(-s_val, K-1)[K-1]]` de `muestrear`.
 *
 * Lo que se necesita de `argpartition` es SÓLO el valor umbral, precisamente
 * porque el conjunto que deja a cada lado no está definido cuando hay empates:
 * el valor sí es único sea cual sea la permutación, y los empates en él los
 * resuelve después el desempate por id. Replicar eso es lo que hace que el
 * top-K no dependa de la implementación.
 *
 * Quickselect con partición de tres vías (mayores / iguales / menores) y
 * pivote mediana de tres. Las tres vías no son un adorno: con scores muy
 * repetidos —lo normal en un pool pequeño donde `fit` vale 0,5 para media
 * tabla— la partición de dos vías degenera a O(n²). Sin RNG, porque el
 * consumo de aleatoriedad es contrato (DISENO §2.6).
 *
 * No admite NaN: el llamante filtra por `isFinite` antes, igual que Python.
 */
export function umbralTopK(v: Float32Array, n: number, k: number): number {
  if (n <= 0) throw new Error('umbralTopK: n debe ser positivo');
  if (k < 1 || k > n) throw new Error(`umbralTopK: k=${k} fuera de [1, ${n}]`);
  if (bufSeleccion.length < n) bufSeleccion = new Float32Array(n);
  const a = bufSeleccion;
  for (let i = 0; i < n; i++) a[i] = v[i] ?? 0;

  const r = k - 1;
  let ini = 0;
  let fin = n - 1;
  while (ini < fin) {
    const pivote = medianaDeTres(a, ini, fin);
    let lt = ini;
    let i = ini;
    let gt = fin;
    while (i <= gt) {
      const x = a[i] ?? 0;
      if (x > pivote) {
        a[i] = a[lt] ?? 0;
        a[lt] = x;
        lt++;
        i++;
      } else if (x < pivote) {
        a[i] = a[gt] ?? 0;
        a[gt] = x;
        gt--;
      } else {
        i++;
      }
    }
    if (r < lt) fin = lt - 1;
    else if (r > gt) ini = gt + 1;
    else return pivote;
  }
  return a[ini] ?? 0;
}

/** Mediana de (primero, central, último). Pivote determinista de `umbralTopK`. */
function medianaDeTres(a: Float32Array, ini: number, fin: number): number {
  const x = a[ini] ?? 0;
  const y = a[(ini + fin) >> 1] ?? 0;
  const z = a[fin] ?? 0;
  if (x < y) {
    if (y < z) return y;
    return x < z ? z : x;
  }
  if (x < z) return x;
  return y < z ? z : y;
}
