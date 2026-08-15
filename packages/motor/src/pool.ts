/**
 * Etapa 0: el pool. Port de `services/solver/app/solver/scoring.py:41-180`
 * (`Pool`, `_idx_base`, `bits_de`, `topes_por_slot`, `construir_pool`).
 *
 * Una sola idea: aplicar los filtros DUROS una vez por petición y materializar
 * una COPIA CONTIGUA de las filas que sobreviven. No una lista de índices sobre
 * el catálogo —eso obligaría a cada slot a hacer *fancy indexing*, que cuesta
 * unas cinco veces más y rompe la localidad de caché—, sino sus propios typed
 * arrays. Son ~90 KB copiados una vez a cambio de que los ~500 `scoreSlot` de
 * una semana recorran memoria contigua. Es la misma decisión que toma el Python
 * y por la misma razón, sólo que aquí el precio de equivocarse es más alto:
 * numpy hace el gather en C y JS lo haría en el intérprete.
 *
 * Filtros duros, que son los que NO ceden nunca: dieta, alérgenos, ingredientes
 * excluidos y minutos. Todo lo demás —variedad, repetición, presupuesto— es
 * preferencia y vive en el score.
 *
 * La distinción que hay que tener presente al leer este fichero: **el tope de
 * minutos es POR SLOT** y aquí sólo se aplica el máximo de los topes pedidos,
 * que es una cota LAXA. El filtro fino lo hace `scoreSlot`. Confundir las dos
 * cosas es el bug clásico de «filtrar el pool entero por el límite del desayuno
 * y quedarse sin cenas».
 */

import type { CatalogoCompilado } from "./catalogo.ts";
import {
  IDX_ALERGENO,
  IDX_DIETA,
  N_NUTR,
  SIN_LIMITE_MINUTOS,
  SLOTS,
} from "./constantes.ts";
import { comparaId, popcountAnd } from "./numerico.ts";
import type { Pool, RestriccionesGeneracion, SlotComida } from "./tipos.ts";

export type { Pool };

/**
 * Columnas de `vMacro`: proteína, carbohidrato y grasa.
 *
 * No va a `constantes.ts` por el mismo motivo que las máscaras SWAR de
 * `numerico.ts`: allí viven las constantes cuyo cambio obliga a subir
 * VERSION_GENERADOR, y esto no es un parámetro del motor sino la aridad de un
 * vector. No hay un cuarto macronutriente que se pueda añadir bajando un número;
 * habría que reescribir `vectorMacro`, el compilador y el catálogo. Se nombra
 * para que el `3` de los gathers no parezca el `3` de otra cosa.
 */
const N_MACROS = 3;

// ---------------------------------------------------------------------------
// Caché de nivel 1
// ---------------------------------------------------------------------------

/**
 * Nivel 1: dieta AND NOT alérgenos AND minutos ≤ tope global.
 *
 * La clave es de BAJA cardinalidad a propósito: la mayoría de peticiones de un
 * mismo usuario comparten dieta, alérgenos y topes, y lo que cambia entre una y
 * otra son los objetivos. `ingredientesExcluidos` se queda FUERA —es el nivel 2,
 * sin cachear— porque es de altísima cardinalidad y hundiría la tasa de aciertos
 * hasta hacer la caché inútil. Es literal del Python (`scoring.py:79-84`).
 *
 * DIVERGENCIA declarada respecto del Python, pre-registrada en `constantes.ts`:
 * allí la caché tenía TTL (3600 s), tope de tamaño (256) y un `threading.Lock`,
 * porque vivía en un proceso servidor multipetición con recarga en caliente del
 * catálogo. Aquí hay un hilo, un catálogo estático embebido en el bundle y una
 * petición cada vez: ni el cerrojo ni el TTL tienen a quién proteger, y un tope
 * de tamaño sería un número mágico nuevo para acotar un Map cuyas claves las
 * genera el propio usuario cambiando filtros en una pantalla. `invalidarCachePool`
 * es la única forma de vaciarla, y existe para el día que el catálogo deje de ser
 * estático.
 */
const cachePool = new Map<string, Int32Array>();

/** Clave de caché. El separador `|` no aparece en ids, dietas ni alérgenos. */
function claveCache(
  version: string,
  dieta: string,
  alergenosOrdenados: readonly string[],
  topeGlobal: number,
): string {
  return `${version}|${dieta}|${alergenosOrdenados.join(",")}|${topeGlobal}`;
}

/**
 * Vacía la caché de nivel 1. En el Python se llamaba al recargar el catálogo:
 * sin esto, planes viejos con datos nuevos.
 *
 * Hoy no tiene ningún llamante en el motor —el catálogo viaja dentro del bundle
 * y no cambia mientras el worker vive— y se conserva porque es la única salida
 * si algún día se carga un catálogo distinto en el mismo worker, y porque los
 * tests necesitan poder demostrar que la caché no cambia el resultado.
 */
export function invalidarCachePool(): void {
  cachePool.clear();
}

// ---------------------------------------------------------------------------
// Piezas del filtro
// ---------------------------------------------------------------------------

/**
 * Tope de minutos de CADA UNO de los cinco slots, no sólo de los pedidos.
 * `scoring.py:133-142`.
 *
 * Rellenar los cinco no es cosmético: `scoreSlot` indexa `topes[slot]` sin
 * comprobar, y un `undefined` en una comparación `minutos <= topes[slot]` da
 * `false` para toda receta, es decir, deja el slot sin candidatos y el día sin
 * plan. Con SIN_LIMITE_MINUTOS (32767, el máximo de int16) la comparación es
 * siempre cierta porque ninguna receta puede tener más minutos: es el mismo
 * número que el tipo del catálogo.
 */
export function topesPorSlot(restr: RestriccionesGeneracion): Record<SlotComida, number> {
  const porSlot = restr.minutosMaxPorSlot;
  const salida = {} as Record<SlotComida, number>;
  for (const slot of SLOTS) {
    const v = porSlot === undefined ? undefined : porSlot[slot];
    // `Math.trunc` es el `int()` de Python: el contrato dice enteros, pero el
    // JSON puede traer 15.7 y `minutos <= 15.7` admitiría una receta de 15 y
    // media que ningún otro camino del motor consideraría admisible.
    salida[slot] = v === undefined ? SIN_LIMITE_MINUTOS : Math.trunc(v);
  }
  return salida;
}

/**
 * Codifica una lista de alimentos como bitset alineado con `cat.ingrBits`.
 * `scoring.py:121-130`.
 *
 * Los ids desconocidos se ignoran EN SILENCIO, igual que Python. Es deliberado:
 * la despensa y los ingredientes excluidos los escribe el usuario o los arrastra
 * una versión anterior del catálogo, y hacer fallar una generación entera porque
 * alguien excluyó un alimento que ya no existe sería castigar al usuario por un
 * cambio nuestro. Un alimento que el catálogo no conoce no puede estar en
 * ninguna receta, así que ignorarlo da exactamente el mismo resultado que
 * tenerlo en cuenta.
 */
export function bitsDe(
  cat: CatalogoCompilado,
  alimentoIds: readonly string[],
): Uint32Array {
  const fila = new Uint32Array(cat.w32);
  for (const aid of alimentoIds) {
    const bit = cat.alimentoIdx.get(aid);
    if (bit === undefined) continue;
    const palabra = bit >>> 5;
    // La asignación a un `Uint32Array` reinterpreta sin signo, así que `1 << 31`
    // (que en JS es negativo) entra como 2147483648 sin necesidad de `>>> 0`.
    fila[palabra] = (fila[palabra] ?? 0) | (1 << (bit & 31));
  }
  return fila;
}

/**
 * Filtro duro de nivel 1, sin caché. `scoring.py:88-96`.
 *
 * Las tres máscaras del catálogo vienen colapsadas a un entero por fila, así que
 * los tres barridos de columnas de numpy son aquí un único bucle plano con tres
 * comprobaciones de bits. Se recorren las N filas del catálogo, que es el único
 * bucle sobre recetas que este módulo se permite: los demás van sobre el pool ya
 * filtrado.
 */
function idxBase(
  cat: CatalogoCompilado,
  dieta: string,
  mascaraAlergenos: number,
  topeGlobal: number,
): Int32Array {
  // La anotación explícita `| undefined` no es ruido: `IDX_DIETA` es un Record
  // total sobre `TipoDieta`, así que para el compilador el acceso nunca falla y
  // la guarda de debajo sería código muerto. Lo es en TypeScript y no lo es en
  // ejecución: este paquete es API pública y lo puede llamar JavaScript.
  const bitDieta: number | undefined = IDX_DIETA[dieta as keyof typeof IDX_DIETA];
  if (bitDieta === undefined) {
    // Python lanzaría un KeyError aquí. Merece un mensaje: es la única entrada
    // del pool que no puede degradarse a «no filtra nada» sin mentir sobre lo
    // que se ha respetado.
    throw new Error(`pool: la dieta «${dieta}» no está en el vocabulario`);
  }
  const idx = new Int32Array(cat.n);
  let p = 0;
  for (let i = 0; i < cat.n; i++) {
    if ((((cat.mDieta[i] ?? 0) >>> bitDieta) & 1) === 0) continue;
    if (((cat.mAlergeno[i] ?? 0) & mascaraAlergenos) !== 0) continue;
    if ((cat.minutos[i] ?? 0) > topeGlobal) continue;
    idx[p] = i;
    p++;
  }
  return idx.slice(0, p);
}

/** Nivel 1 con caché. La entrada cacheada NUNCA se devuelve: ver `construirPool`. */
function idxBaseCacheado(
  cat: CatalogoCompilado,
  dieta: string,
  alergenosOrdenados: readonly string[],
  mascaraAlergenos: number,
  topeGlobal: number,
): Int32Array {
  const clave = claveCache(cat.version, dieta, alergenosOrdenados, topeGlobal);
  const guardado = cachePool.get(clave);
  if (guardado !== undefined) return guardado;
  const idx = idxBase(cat, dieta, mascaraAlergenos, topeGlobal);
  cachePool.set(clave, idx);
  return idx;
}

// ---------------------------------------------------------------------------
// Gather
// ---------------------------------------------------------------------------

/**
 * Lo mínimo que necesita `copiarFilas` de un typed array. Escrito a mano porque
 * los ocho tipos de typed array no comparten ningún supertipo útil en la
 * biblioteca estándar: `ArrayBufferView` no tiene índice numérico y
 * `ArrayLike<number>` es de sólo lectura.
 */
interface VectorNumerico {
  readonly length: number;
  [indice: number]: number;
}

/**
 * `destino[i] = origen[idx[i]]` con filas de `ancho` columnas. Es el
 * *fancy indexing* de los trece gathers de `construir_pool` (`scoring.py:167-179`).
 *
 * Un solo bucle plano para los trece: la alternativa —trece bucles escritos a
 * mano— es donde se cuela el que copia con el ancho equivocado y desplaza una
 * columna entera sin que nada falle.
 */
function copiarFilas(
  destino: VectorNumerico,
  origen: VectorNumerico,
  idx: Int32Array,
  p: number,
  ancho: number,
): void {
  for (let i = 0; i < p; i++) {
    const desde = (idx[i] ?? 0) * ancho;
    const hasta = i * ancho;
    for (let k = 0; k < ancho; k++) destino[hasta + k] = origen[desde + k] ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Construcción del pool
// ---------------------------------------------------------------------------

/**
 * Filtros duros → vistas compactas. `scoring.py:145-180`.
 *
 * Dos niveles y una asimetría que es el corazón del módulo:
 *
 *  - **Nivel 1** (cacheable): dieta, alérgenos y `minutos ≤ topeGlobal`, donde
 *    `topeGlobal = max(topes[s])` SOBRE LOS SLOTS PEDIDOS. Es una cota laxa a
 *    propósito: sólo poda lo que NINGÚN slot admitiría. El tope real es por slot
 *    y lo aplica `scoreSlot`.
 *  - **Nivel 2** (por petición, sin cachear): `popcount(bits & bitsExcluidos) == 0`.
 *
 * Si `restr.slots` viene vacío, `topeGlobal` es SIN_LIMITE_MINUTOS y no
 * SIN_LIMITE_MINUTOS negado ni `-Infinity`: un `max` sobre el conjunto vacío no
 * puede podar nada, porque no hay ningún slot cuyo límite respetar. Python lo
 * escribe con un condicional explícito y aquí también.
 */
export function construirPool(
  cat: CatalogoCompilado,
  restr: RestriccionesGeneracion,
): Pool {
  const topes = topesPorSlot(restr);
  let topeGlobal = SIN_LIMITE_MINUTOS;
  if (restr.slots.length > 0) {
    topeGlobal = -Infinity;
    // `topes` trae los CINCO slots rellenos, así que aquí no hace falta guarda:
    // ésa es exactamente la razón de que `topesPorSlot` los rellene todos.
    for (const slot of restr.slots) {
      if (topes[slot] > topeGlobal) topeGlobal = topes[slot];
    }
  }

  // El orden de los alérgenos entra en la clave de caché, así que se ordena por
  // code point (`sorted()` de Python) y no con el `sort()` por defecto de JS.
  // Con los catorce nombres actuales, todos ASCII, coinciden; el día que no,
  // dos peticiones idénticas usarían dos entradas distintas de la caché. No
  // sería un fallo de corrección, pero sí una caché que deja de servir.
  const alergenosOrdenados = [...restr.alergenosExcluidos].sort(comparaId);
  let mascaraAlergenos = 0;
  for (const a of alergenosOrdenados) {
    const bit: number | undefined = IDX_ALERGENO[a];
    // Un alérgeno fuera del vocabulario se ignora, igual que en Python
    // (`if a in IDX_ALERGENO`). No hay ninguna receta marcada con él, así que
    // filtrar por él no quitaría nada; lo que NO se puede hacer es lanzar y
    // dejar al usuario sin plan por un alérgeno que nuestro catálogo aún no
    // etiqueta.
    if (bit !== undefined) mascaraAlergenos |= 1 << bit;
  }

  const base = idxBaseCacheado(
    cat,
    restr.dieta,
    alergenosOrdenados,
    mascaraAlergenos,
    topeGlobal,
  );

  // La entrada de la caché se COPIA antes de salir de aquí. Python devuelve el
  // array cacheado tal cual; aquí no, porque `pool.idx` viaja a cuatro módulos y
  // basta con que uno lo ordene en sitio para envenenar la caché de todas las
  // peticiones siguientes con un fallo indepurable. Copiar entre 36 y 1.500
  // int32 cuesta menos que el barrido de N filas que la caché se ahorra, así que
  // la caché sigue valiendo la pena y deja de ser un arma cargada.
  let idx = base.slice();

  const excluidos = restr.ingredientesExcluidos;
  if (excluidos.length > 0) {
    const excl = bitsDe(cat, excluidos);
    const limpias = new Int32Array(idx.length);
    let q = 0;
    for (let i = 0; i < idx.length; i++) {
      const fila = idx[i] ?? 0;
      if (popcountAnd(cat.ingrBits, fila * cat.w32, excl, 0, cat.w32) === 0) {
        limpias[q] = fila;
        q++;
      }
    }
    idx = limpias.slice(0, q);
  }

  const p = idx.length;

  // (N,) fila del catálogo → posición en el pool, o −1. Es la segunda mitad de
  // la doble indirección id → fila → posición que usan `penalizacionRepeticion`
  // y los vetos de la etapa D; el −1 significa «esa receta no pasó los filtros
  // duros» y sus consumidores la ignoran en silencio.
  const mapaFila = new Int32Array(cat.n).fill(-1);
  for (let i = 0; i < p; i++) mapaFila[idx[i] ?? 0] = i;

  const ids: string[] = new Array<string>(p);
  for (let i = 0; i < p; i++) ids[i] = cat.ids[idx[i] ?? 0] ?? "";

  const nutr = new Float32Array(p * N_NUTR);
  const conocido = new Uint8Array(p * N_NUTR);
  const vMacro = new Float32Array(p * N_MACROS);
  const tieneMacro = new Uint8Array(p);
  const escalaMin = new Float32Array(p);
  const escalaMax = new Float32Array(p);
  const mSlot = new Uint8Array(p);
  const minutos = new Int16Array(p);
  const bits = new Uint32Array(p * cat.w32);
  const nIngr = new Int16Array(p);
  const costeCents = new Int32Array(p);
  const costeConocido = new Uint8Array(p);

  copiarFilas(nutr, cat.nutr, idx, p, N_NUTR);
  copiarFilas(conocido, cat.conocido, idx, p, N_NUTR);
  copiarFilas(vMacro, cat.vMacro, idx, p, N_MACROS);
  copiarFilas(tieneMacro, cat.tieneMacro, idx, p, 1);
  copiarFilas(escalaMin, cat.escalaMin, idx, p, 1);
  copiarFilas(escalaMax, cat.escalaMax, idx, p, 1);
  copiarFilas(mSlot, cat.mSlot, idx, p, 1);
  copiarFilas(minutos, cat.minutos, idx, p, 1);
  copiarFilas(bits, cat.ingrBits, idx, p, cat.w32);
  copiarFilas(nIngr, cat.nIngredientes, idx, p, 1);
  copiarFilas(costeCents, cat.costeCents, idx, p, 1);
  copiarFilas(costeConocido, cat.costeConocido, idx, p, 1);

  return {
    p,
    w32: cat.w32,
    idx,
    mapaFila,
    ids,
    nutr,
    conocido,
    vMacro,
    tieneMacro,
    escalaMin,
    escalaMax,
    mSlot,
    minutos,
    bits,
    nIngr,
    costeCents,
    costeConocido,
  };
}
