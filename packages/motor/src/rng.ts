/**
 * Árbol de generadores reproducible. Sustituye a `np.random.SeedSequence` +
 * `PCG64` (services/solver/app/solver/__init__.py:167-201).
 *
 * DISENO §2.6 fija la regla y el docstring de `rng_de` la repite: **nunca un
 * único generador compartido y consumido en orden**. Con un flujo secuencial,
 * cualquier cambio en el número de llamadas —un slot más, un reintento más,
 * generar los días en paralelo— desplaza todo lo que viene detrás y el plan
 * cambia. Aquí la ruta identifica el nodo —(etapa, día, candidato, intento,
 * slot)— y el flujo de un nodo no depende de cuántos números consuman los
 * demás. Eso es lo que hace que el resultado sea idéntico en serie y en
 * paralelo.
 *
 * Lo que se porta NO es la secuencia de bits de numpy sino esa propiedad
 * estructural (docs/port-typescript.md, «Sustitución del árbol de RNG»). La
 * paridad bit a bit está descartada por escrito: exigiría reimplementar
 * SeedSequence, PCG64, Lemire con su buffer de media palabra y el `choice` de
 * `Generator` —cuatro algoritmos no documentados en este repositorio— y aun así
 * los planes divergirían, porque `Math.exp` de V8 no está obligado a coincidir
 * a 1 ULP con la libm de CPython y una diferencia de 1 ULP voltea la
 * comparación del recocido. Por eso VERSION_GENERADOR salta de mayor.
 *
 * Lo que sí se porta literalmente es el CONSUMO, y vive en los llamantes, no
 * aquí: un único sorteo categórico por nodo en las etapas A/C, y los dos atajos
 * que consumen cero (`cand.length === 1` en `muestrear`, y el cortocircuito
 * `delta < 0 || rng.random() < …` del recocido). `contadorDeSorteos` existe
 * para que esos invariantes se puedan afirmar en un test.
 */

/** Los tres métodos que consume el motor. No hay un cuarto: ver el inventario
 * de puntos de consumo en docs/auditoria-motor.md (scoring.py:436 y
 * semanal.py:267-279 son los únicos). */
export interface Rng {
  /** Doble uniforme en [0, 1) con 53 bits de resolución. */
  random(): number;
  /** Entero uniforme en [0, n). */
  integers(n: number): number;
  /** Índice en [0, n) con probabilidades `p`. Consume exactamente un sorteo. */
  choice(n: number, p: Float64Array): number;
}

// ---------------------------------------------------------------------------
// Constantes del algoritmo
//
// Estas NO van a constantes.ts a propósito: constantes.ts es el port de
// __init__.py:1-201 *salvo* rng_de (docs/port-typescript.md), y son parámetros
// de producto que se pueden discutir. Las de aquí son la definición de
// SplitMix64 y de xoshiro256++; cambiar una no es afinar el motor, es cambiar
// de generador. Se quedan junto al código que las usa, con nombre, y sujetas a
// la misma regla operativa: tocarlas obliga a subir VERSION_GENERADOR.
// ---------------------------------------------------------------------------

/** Incremento de SplitMix64: 2^64 / φ, redondeado a impar. */
const GAMMA_ALTA = 0x9e3779b9;
const GAMMA_BAJA = 0x7f4a7c15;

/** Primer multiplicador del finalizador de SplitMix64. */
const MEZCLA1_ALTA = 0xbf58476d;
const MEZCLA1_BAJA = 0x1ce4e5b9;

/** Segundo multiplicador del finalizador de SplitMix64. */
const MEZCLA2_ALTA = 0x94d049bb;
const MEZCLA2_BAJA = 0x133111eb;

/**
 * Valor inicial del acumulador de la mezcla (seed ‖ ruta). Son los primeros
 * dígitos hexadecimales de π: una constante «nothing up my sleeve», elegida
 * sólo para separar el dominio de la mezcla del de SplitMix64 y no porque
 * tenga ninguna propiedad especial.
 */
const SEMILLA_MEZCLA_ALTA = 0x243f6a88;
const SEMILLA_MEZCLA_BAJA = 0x85a308d3;

/** El seed es de 63 bits (`secrets.randbits(63)` en motor.py:216). */
const LIMITE_SEMILLA = 1n << 63n;
const MASCARA_ALTA_63 = 0x7fffffff;
const MASCARA_32 = 0xffffffffn;
const BITS_PALABRA = 32n;

/** `random()` = (u64 >>> 11) · 2^-53: los 53 bits altos, que es la mantisa. */
const DESPLAZAMIENTO_DOBLE = 11;
const ESCALA_DOBLE = 2 ** -53;
/** Peso de la palabra alta una vez descartados los 11 bits bajos: 2^(32-11). */
const PESO_ALTA_DOBLE = 2 ** 21;

/** `integers` trabaja sobre la palabra alta de 32 bits; n no puede excederla. */
const LIMITE_INTEGERS = 2 ** 32;

/** Tamaño inicial del buffer de la acumulada de `choice`. Crece si hace falta. */
const CDF_INICIAL = 64;

// ---------------------------------------------------------------------------
// Aritmética de 64 bits sobre pares de Uint32
//
// Sin BigInt: `siguiente64` se llama del orden de 10^4 veces por semana
// generada (el recocido son 600 iteraciones × 7 días de candidatos) y BigInt
// asigna en el montón en cada operación.
//
// La derivación escribe su resultado en estas dos variables de módulo en vez de
// devolver una tupla o un array. Es feo, pero sólo se ejecuta al construir el
// generador y evita una asignación por multiplicación. El camino caliente
// (xoshiro) no las toca: lleva su aritmética en línea, sobre locales.
// ---------------------------------------------------------------------------

let mezclaAlta = 0;
let mezclaBaja = 0;

/**
 * Producto de 64 bits truncado, por descomposición en cuatro limbos de 16 bits.
 * Los productos parciales llegan a ~2^34, muy por debajo de 2^53, así que la
 * aritmética de dobles es exacta; se usan `%` y `Math.floor` en vez de `>>>`
 * precisamente porque los parciales sí exceden 2^32 y `>>>` los truncaría.
 */
function multiplicar64(alta: number, baja: number, factorAlta: number, factorBaja: number): void {
  const a0 = baja & 0xffff;
  const a1 = baja >>> 16;
  const a2 = alta & 0xffff;
  const a3 = alta >>> 16;
  const b0 = factorBaja & 0xffff;
  const b1 = factorBaja >>> 16;
  const b2 = factorAlta & 0xffff;
  const b3 = factorAlta >>> 16;

  let t = a0 * b0;
  const r0 = t % 65536;
  t = a1 * b0 + a0 * b1 + Math.floor(t / 65536);
  const r1 = t % 65536;
  t = a2 * b0 + a1 * b1 + a0 * b2 + Math.floor(t / 65536);
  const r2 = t % 65536;
  t = a3 * b0 + a2 * b1 + a1 * b2 + a0 * b3 + Math.floor(t / 65536);
  const r3 = t % 65536;

  mezclaBaja = ((r1 << 16) | r0) >>> 0;
  mezclaAlta = ((r3 << 16) | r2) >>> 0;
}

/**
 * Finalizador de SplitMix64: `z ^= z>>30; z *= C1; z ^= z>>27; z *= C2; z ^= z>>31`.
 * Es una biyección con avalancha completa, que es justo lo que necesita la
 * mezcla de la ruta: un bit distinto en cualquier componente debe repartirse
 * por los 64 antes de absorber el siguiente componente.
 */
function finalizar64(alta: number, baja: number): void {
  let h = alta;
  let l = baja;

  l = (l ^ ((l >>> 30) | (h << 2))) >>> 0;
  h = (h ^ (h >>> 30)) >>> 0;
  multiplicar64(h, l, MEZCLA1_ALTA, MEZCLA1_BAJA);
  h = mezclaAlta;
  l = mezclaBaja;

  l = (l ^ ((l >>> 27) | (h << 5))) >>> 0;
  h = (h ^ (h >>> 27)) >>> 0;
  multiplicar64(h, l, MEZCLA2_ALTA, MEZCLA2_BAJA);
  h = mezclaAlta;
  l = mezclaBaja;

  mezclaBaja = (l ^ ((l >>> 31) | (h << 1))) >>> 0;
  mezclaAlta = (h ^ (h >>> 31)) >>> 0;
}

// ---------------------------------------------------------------------------
// El generador
// ---------------------------------------------------------------------------

/**
 * xoshiro256++ (Blackman & Vigna, dominio público) con el estado en ocho
 * campos de 32 bits en vez de un `Uint32Array`: son ocho enteros pequeños que
 * V8 guarda en slots del objeto, y de paso esquiva el `| undefined` que
 * `noUncheckedIndexedAccess` añade a cada acceso indexado.
 *
 * No es exportada: la única forma de obtener un generador es `rngDe`, para que
 * nadie pueda construir un flujo fuera del árbol.
 */
class GeneradorXoshiro implements Rng {
  private s0a: number;
  private s0b: number;
  private s1a: number;
  private s1b: number;
  private s2a: number;
  private s2b: number;
  private s3a: number;
  private s3b: number;

  /** Última salida de 64 bits, en dos mitades. Evita asignar por sorteo. */
  private salidaAlta = 0;
  private salidaBaja = 0;

  /** Sorteos lógicos consumidos. Sólo lo lee `contadorDeSorteos`, en tests. */
  sorteos = 0;

  constructor(
    s0a: number,
    s0b: number,
    s1a: number,
    s1b: number,
    s2a: number,
    s2b: number,
    s3a: number,
    s3b: number,
  ) {
    this.s0a = s0a;
    this.s0b = s0b;
    this.s1a = s1a;
    this.s1b = s1b;
    this.s2a = s2a;
    this.s2b = s2b;
    this.s3a = s3a;
    this.s3b = s3b;
  }

  /** Un paso del generador. Deja el resultado en `salidaAlta`/`salidaBaja`. */
  private siguiente64(): void {
    const s0a = this.s0a;
    const s0b = this.s0b;
    const s1a = this.s1a;
    const s1b = this.s1b;
    let s2a = this.s2a;
    let s2b = this.s2b;
    let s3a = this.s3a;
    let s3b = this.s3b;

    // resultado = rotl(s0 + s3, 23) + s0
    let sumaBaja = s0b + s3b;
    const sumaAlta = (s0a + s3a + (sumaBaja > 0xffffffff ? 1 : 0)) >>> 0;
    sumaBaja = sumaBaja >>> 0;
    const rotAlta = ((sumaAlta << 23) | (sumaBaja >>> 9)) >>> 0;
    const rotBaja = ((sumaBaja << 23) | (sumaAlta >>> 9)) >>> 0;
    const salBaja = rotBaja + s0b;
    this.salidaAlta = (rotAlta + s0a + (salBaja > 0xffffffff ? 1 : 0)) >>> 0;
    this.salidaBaja = salBaja >>> 0;

    // t = s1 << 17
    const tAlta = ((s1a << 17) | (s1b >>> 15)) >>> 0;
    const tBaja = (s1b << 17) >>> 0;

    // El orden de estos seis xor es el del algoritmo de referencia y no es
    // conmutable: s1 usa el s2 YA actualizado y s0 el s3 YA actualizado.
    s2a = (s2a ^ s0a) >>> 0;
    s2b = (s2b ^ s0b) >>> 0;
    s3a = (s3a ^ s1a) >>> 0;
    s3b = (s3b ^ s1b) >>> 0;
    this.s1a = (s1a ^ s2a) >>> 0;
    this.s1b = (s1b ^ s2b) >>> 0;
    this.s0a = (s0a ^ s3a) >>> 0;
    this.s0b = (s0b ^ s3b) >>> 0;
    this.s2a = (s2a ^ tAlta) >>> 0;
    this.s2b = (s2b ^ tBaja) >>> 0;
    // rotl(s3, 45): 45 ≥ 32, así que es rotl(s3 con mitades intercambiadas, 13).
    this.s3a = ((s3b << 13) | (s3a >>> 19)) >>> 0;
    this.s3b = ((s3a << 13) | (s3b >>> 19)) >>> 0;
  }

  /** Doble uniforme sin tocar el contador: lo comparten `random` y `choice`. */
  private siguienteDoble(): number {
    this.siguiente64();
    return (
      (this.salidaAlta * PESO_ALTA_DOBLE + (this.salidaBaja >>> DESPLAZAMIENTO_DOBLE)) *
      ESCALA_DOBLE
    );
  }

  random(): number {
    this.sorteos += 1;
    return this.siguienteDoble();
  }

  /**
   * Entero uniforme en [0, n) por **rechazo enmascarado sobre 32 bits**.
   *
   * El algoritmo es normativo del port, no de numpy (que usa Lemire con un
   * buffer de media palabra): se toma la máscara de la potencia de dos que
   * cubre n−1, se leen los 32 bits altos de un paso completo del generador y se
   * repite mientras el valor caiga fuera. Se descarta a propósito el buffer de
   * media palabra de numpy: guardar 32 bits sobrantes entre llamadas es estado
   * extra que acopla un sorteo con el siguiente, y aquí lo único que hay que
   * defender es la independencia entre nodos.
   *
   * n ≤ 1 devuelve 0 SIN consumir, igual que numpy con un rango vacío. En el
   * motor no ocurre —el recocido comprueba `d_total > 1` y `len > 1` antes de
   * llamar (semanal.py:262-270)— pero el atajo tiene que existir por si algún
   * día ocurre: consumir un sorteo para devolver la única respuesta posible
   * desincronizaría el flujo de la etapa D.
   */
  integers(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > LIMITE_INTEGERS) {
      throw new RangeError(`integers: n debe ser un entero en [1, 2^32], y es ${n}`);
    }
    if (n === 1) return 0;

    let mascara = (n - 1) >>> 0;
    mascara |= mascara >>> 1;
    mascara |= mascara >>> 2;
    mascara |= mascara >>> 4;
    mascara |= mascara >>> 8;
    mascara |= mascara >>> 16;

    this.sorteos += 1;
    for (;;) {
      this.siguiente64();
      const v = (this.salidaAlta & mascara) >>> 0;
      if (v < n) return v;
    }
  }

  /**
   * Índice categórico. Porta el modelo de consumo de `Generator.choice(n, p=p)`
   * de numpy: `cdf = p.cumsum(); cdf /= cdf[-1]; searchsorted(cdf, u, 'right')`.
   * **Exactamente un doble uniforme**, siempre, sea cual sea n; el atajo que
   * consume cero vive en `muestrear` (`cand.length === 1`), no aquí.
   *
   * Normalizar por el último elemento en vez de por la suma es lo que la hace
   * robusta a que p no sume 1 por error de coma flotante: el último elemento de
   * la acumulada ES la suma que se ha calculado, así que cdf[n−1] queda en 1,0
   * exacto y un `u` de [0,1) siempre cae dentro. Comparar contra `u·total`
   * habría dejado un caso de borde en el que el redondeo se sale del array.
   *
   * Las probabilidades negativas o NaN se tratan como 0. No es indulgencia: la
   * acumulada tiene que ser monótona o la búsqueda binaria deja de significar
   * nada, y prefiero un sesgo visible a un índice arbitrario.
   */
  choice(n: number, p: Float64Array): number {
    if (!Number.isInteger(n) || n < 1) {
      throw new RangeError(`choice: n debe ser un entero ≥ 1, y es ${n}`);
    }
    if (p.length < n) {
      throw new RangeError(`choice: p tiene ${p.length} pesos para ${n} opciones`);
    }

    const acumulada = bufferAcumulada(n);
    let suma = 0;
    for (let i = 0; i < n; i += 1) {
      // El `?? 0` es inalcanzable tras la comprobación de longitud de arriba;
      // está porque noUncheckedIndexedAccess no ve ese invariante.
      const peso = p[i] ?? 0;
      if (peso > 0) suma += peso;
      acumulada[i] = suma;
    }

    this.sorteos += 1;
    const u = this.siguienteDoble();

    if (!(suma > 0) || !Number.isFinite(suma)) {
      // p degenerada (todo ceros, o infinitos). No se lanza: en la etapa A esto
      // sólo puede venir de un softmax que se ha ido a cero, y abortar el plan
      // entero por eso sería peor que repartir uniformemente. El sorteo ya se ha
      // consumido, así que el flujo del nodo no se desplaza.
      const idx = Math.floor(u * n);
      return idx < n ? idx : n - 1;
    }

    for (let i = 0; i < n; i += 1) acumulada[i] = (acumulada[i] ?? 0) / suma;

    // searchsorted(..., side='right'): primer índice cuya acumulada supera u.
    let izq = 0;
    let der = n - 1;
    while (izq < der) {
      const medio = (izq + der) >>> 1;
      if ((acumulada[medio] ?? 0) > u) der = medio;
      else izq = medio + 1;
    }
    return izq;
  }
}

/**
 * Buffer reutilizado para la acumulada de `choice`. Es estado de módulo
 * compartido por todos los generadores, y puede serlo porque `choice` no cede
 * el control entre que lo llena y lo consume: no hay reentrada posible.
 */
let acumuladaCompartida = new Float64Array(CDF_INICIAL);

function bufferAcumulada(n: number): Float64Array {
  if (acumuladaCompartida.length < n) {
    let tam = acumuladaCompartida.length;
    while (tam < n) tam *= 2;
    acumuladaCompartida = new Float64Array(tam);
  }
  return acumuladaCompartida;
}

// ---------------------------------------------------------------------------
// El árbol
// ---------------------------------------------------------------------------

/**
 * Generador independiente y reproducible para un punto del árbol. §2.6
 *
 * La derivación es: se absorbe palabra a palabra (seed baja, seed alta, y cada
 * componente de la ruta como u32) en un acumulador de 64 bits, aplicando el
 * finalizador de SplitMix64 tras cada absorción; el acumulador resultante
 * siembra un SplitMix64 que produce las cuatro palabras de estado de
 * xoshiro256++.
 *
 * Aplicar el finalizador DESPUÉS de cada palabra, y no una sola vez al final,
 * es lo que hace que la mezcla dependa del orden y de la longitud de la ruta:
 * (0, 1) y (1, 0) son nodos distintos, y (0, 1) y (0, 1, 0) también. Si la
 * ruta se absorbiera con un xor plano, las tres colisionarían y dos etapas
 * distintas compartirían flujo sin que nada fallase visiblemente.
 */
export function rngDe(seed: bigint, ...ruta: number[]): Rng {
  if (seed < 0n || seed >= LIMITE_SEMILLA) {
    throw new RangeError(`rngDe: el seed debe estar en [0, 2^63), y es ${seed}`);
  }

  let acuAlta = SEMILLA_MEZCLA_ALTA;
  let acuBaja = SEMILLA_MEZCLA_BAJA;

  // BigInt sólo aquí, y sólo dos veces: partir el seed en dos u32. A partir de
  // este punto no vuelve a aparecer.
  const palabras = [
    Number(seed & MASCARA_32),
    Number((seed >> BITS_PALABRA) & MASCARA_32),
  ];
  for (let i = 0; i < ruta.length; i += 1) {
    const componente = ruta[i] ?? 0;
    if (!Number.isInteger(componente) || componente < 0 || componente >= LIMITE_INTEGERS) {
      throw new RangeError(
        `rngDe: la ruta admite enteros en [0, 2^32), y el componente ${i} es ${componente}`,
      );
    }
    palabras.push(componente);
  }

  for (let i = 0; i < palabras.length; i += 1) {
    acuBaja = (acuBaja ^ (palabras[i] ?? 0)) >>> 0;
    finalizar64(acuAlta, acuBaja);
    acuAlta = mezclaAlta;
    acuBaja = mezclaBaja;
  }

  // SplitMix64 sembrado con la mezcla: cuatro salidas, cuatro palabras.
  const estado = new Array<number>(8);
  for (let i = 0; i < 4; i += 1) {
    const sumaBaja = acuBaja + GAMMA_BAJA;
    acuAlta = (acuAlta + GAMMA_ALTA + (sumaBaja > 0xffffffff ? 1 : 0)) >>> 0;
    acuBaja = sumaBaja >>> 0;
    finalizar64(acuAlta, acuBaja);
    estado[i * 2] = mezclaAlta;
    estado[i * 2 + 1] = mezclaBaja;
  }

  const s0a = estado[0] ?? 0;
  const s0b = estado[1] ?? 0;
  const s1a = estado[2] ?? 0;
  const s1b = estado[3] ?? 0;
  const s2a = estado[4] ?? 0;
  const s2b = estado[5] ?? 0;
  const s3a = estado[6] ?? 0;
  const s3b = estado[7] ?? 0;

  // El estado todo a ceros es el punto fijo de xoshiro: se quedaría devolviendo
  // cero para siempre. Es astronómicamente improbable (2^-256) y no se puede
  // provocar desde fuera, pero un generador que puede morir en silencio no es
  // un generador; el coste de descartarlo es una comparación por nodo.
  if ((s0a | s0b | s1a | s1b | s2a | s2b | s3a | s3b) === 0) {
    return new GeneradorXoshiro(GAMMA_ALTA, GAMMA_BAJA, 0, 0, 0, 0, 0, 0);
  }
  return new GeneradorXoshiro(s0a, s0b, s1a, s1b, s2a, s2b, s3a, s3b);
}

/** Sorteos lógicos que ha consumido un generador. Sólo para tests: es la única
 * forma de afirmar los invariantes de consumo (un sorteo por nodo en A/C, cero
 * en los dos atajos) sin comparar planes enteros. */
export function contadorDeSorteos(r: Rng): number {
  if (!(r instanceof GeneradorXoshiro)) {
    throw new TypeError('contadorDeSorteos: sólo cuenta generadores creados por rngDe');
  }
  return r.sorteos;
}

// ---------------------------------------------------------------------------
// Semillas
//
// 63 bits NO caben en un Number (2^53−1). Un round-trip por Number —un
// JSON.parse, un parseInt de la query, un campo tipado como number en cualquier
// punto del monorepo— pierde precisión EN SILENCIO y el plan deja de ser
// reproducible: exactamente el bug que toda esta disciplina intenta evitar, y
// ahora sin backend donde depurarlo. De ahí bigint dentro y string decimal en
// el contrato.
// ---------------------------------------------------------------------------

/** Sólo dígitos. Rechaza signo, espacios, `0x`, notación científica y decimales;
 * acepta ceros a la izquierda porque no son ambiguos y `semillaATexto` nunca los
 * produce, así que no rompen el round-trip. */
const SEMILLA_DECIMAL = /^[0-9]+$/;

/**
 * Semilla nueva de 63 bits, espejo de `secrets.randbits(63)` (motor.py:216).
 *
 * No hay respaldo con `Math.random` si falta `crypto`: una semilla de calidad
 * desconocida se vería exactamente igual que una buena en el contrato y en la
 * URL, y el usuario no tendría forma de saberlo. Es mejor fallar aquí.
 */
export function semillaAleatoria(): bigint {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('semillaAleatoria: no hay crypto.getRandomValues en este entorno');
  }
  const palabras = new Uint32Array(2);
  crypto.getRandomValues(palabras);
  const alta = BigInt((palabras[0] ?? 0) & MASCARA_ALTA_63);
  const baja = BigInt(palabras[1] ?? 0);
  return (alta << BITS_PALABRA) | baja;
}

/** Lee una semilla del contrato, de la query o de localStorage. Lanza si el
 * texto no es un entero decimal en [0, 2^63): un seed que no se puede leer
 * tiene que ser un error ruidoso, no un plan distinto al guardado. */
export function semillaDesdeTexto(s: string): bigint {
  if (typeof s !== 'string' || !SEMILLA_DECIMAL.test(s)) {
    throw new Error(`semillaDesdeTexto: «${s}» no es un entero decimal`);
  }
  const seed = BigInt(s);
  if (seed >= LIMITE_SEMILLA) {
    throw new Error(`semillaDesdeTexto: «${s}» se sale de [0, 2^63)`);
  }
  return seed;
}

/** Escribe una semilla para el contrato, la query y localStorage. Valida el
 * rango también en esta dirección: emitir un texto que `semillaDesdeTexto`
 * rechazaría rompería el round-trip en el lado que menos se mira. */
export function semillaATexto(s: bigint): string {
  if (s < 0n || s >= LIMITE_SEMILLA) {
    throw new RangeError(`semillaATexto: el seed debe estar en [0, 2^63), y es ${s}`);
  }
  return s.toString(10);
}
