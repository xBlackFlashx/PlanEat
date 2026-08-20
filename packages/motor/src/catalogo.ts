/**
 * Decodificación del catálogo compilado. Port de la mitad de
 * `services/solver/app/catalogo.py:36-212` que sigue existiendo en el navegador.
 *
 * La otra mitad —leer el jsonl, ordenar el vocabulario de alimentos, calcular
 * `v_macro` y hashear el fichero— se ha movido a `herramientas/compilar-catalogo.ts`,
 * que corre en el build. Aquí NO se recalcula ninguna de esas cuatro cosas: son
 * exactamente los puntos donde el navegador podría derivar algo distinto de lo
 * que derivó el build (orden de `sorted()`, redondeo de float32, sha256), y la
 * forma de que no diverjan no es replicarlas con cuidado, es no tenerlas.
 *
 * Lo que queda es un decodificador: JSON columnar → typed arrays, más las
 * validaciones que impiden que un catálogo torcido se convierta en un plan
 * torcido. La regla para decidir qué se valida y qué no es una sola: **se
 * comprueba todo aquello que, de estar mal, se corrompería en silencio**. Una
 * longitud que no cuadra revienta sola en el primer acceso; un `mAlergeno` con
 * un bit de más se trunca al meterlo en un typed array demasiado estrecho y
 * deja pasar recetas con alérgenos sin que nada falle. Lo primero no se
 * comprueba, lo segundo sí.
 *
 * Invariante maestro heredado del Python, del que depende todo lo demás: **todos
 * los arrays están alineados por índice de fila**; la fila `i` es la misma
 * receta en todos ellos.
 */

import {
  ALERGENOS,
  DIETAS,
  NUTRIENTES,
  N_ALERGENOS,
  N_DIETAS,
  N_NUTR,
  N_SLOTS,
  SLOTS,
} from "./constantes.ts";
import { BITS_POR_PALABRA } from "./numerico.ts";

/**
 * El contrato de salida del compilador se importa, no se copia.
 *
 * `import type` con `verbatimModuleSyntax` se borra ENTERO al emitir, así que
 * esto no crea ninguna arista de ejecución hacia `herramientas/`, que importa
 * `node:fs` y `node:crypto` y jamás puede entrar en el bundle del worker. Es una
 * dependencia de tipos y nada más.
 *
 * La alternativa —volver a declarar aquí la misma interfaz— compilaría igual
 * (TypeScript es estructural) y se pudriría en silencio el día que el compilador
 * ganara una columna: el decodificador seguiría leyendo las de ayer. Es el mismo
 * argumento por el que `tipos.ts` prohíbe duplicar los tipos de `@planeat/shared`.
 */
import type { CatalogoSerializado } from "../herramientas/compilar-catalogo.ts";

export type { CatalogoSerializado };

// Ninguna de las constantes de este bloque va a `constantes.ts`, y no por
// descuido: allí viven las constantes del MOTOR, las que obligan a subir
// VERSION_GENERADOR al tocarlas. Éstas son propiedades de los tipos de dato
// (el rango de un Int16Array, el último code point ASCII) o se derivan de las
// tuplas del vocabulario. Cambiar cualquiera de ellas no cambiaría ningún plan:
// haría que este fichero dejara de detectar un catálogo corrupto.

/** Bits que caben en cada una de las máscaras colapsadas de un solo entero. */
const BITS_DIETA = N_DIETAS;
const BITS_SLOT = N_SLOTS;

/** Palabras de 32 bits que hacen falta para `N_ALERGENOS` bits — espejo exacto
 * de `W_ALERGENO` en `herramientas/compilar-catalogo.ts`. Deja de ser 1 en
 * cuanto N_ALERGENOS pasa de 32 (2026-08-19: ya van 25 y subiendo), así que
 * `mAlergeno` ya no cabe en "un entero por fila" como `mDieta`/`mSlot`. */
export const W_ALERGENO = Math.max(1, Math.ceil(N_ALERGENOS / BITS_POR_PALABRA));

/** Rango de `Int16Array`, que es donde viven los minutos. */
const MIN_INT16 = -32768;
const MAX_INT16 = 32767;

/** Rango de `Int32Array`, que es donde viven los céntimos. */
const MIN_INT32 = -2147483648;
const MAX_INT32 = 2147483647;

/** Último code point ASCII. Ver `esAscii`. */
const MAX_ASCII = 0x7f;

// ---------------------------------------------------------------------------
// Estructura en memoria
// ---------------------------------------------------------------------------

/**
 * El catálogo listo para el motor. Port de la dataclass `Catalogo` de
 * `catalogo.py:36-78`, con tres cambios de representación y ninguno de
 * contenido:
 *
 *  - Las matrices `(n, k)` de numpy son arrays planos de `n*k` en row-major: la
 *    fila `i` empieza en `i*k`. Struct-of-arrays, nunca un array de objetos.
 *  - Las máscaras booleanas de pocas columnas que caben en 32 bits (`mDieta`
 *    6, `mSlot` 5) van colapsadas a UN ENTERO por fila: el filtro base del
 *    pool pasa de un barrido de columnas a una comprobación de bits, y de
 *    paso desaparece la posibilidad de leer la columna equivocada.
 *    `mAlergeno` (N_ALERGENOS = 25 hoy, subiendo) YA NO cabe en ese patrón —
 *    se codifica como `ingrBits`/`ingrPerecBits` de abajo, en W_ALERGENO
 *    palabras por fila.
 *  - Los bitsets de alimentos (`ingrBits`/`ingrPerecBits`) y `mAlergeno` son
 *    `Uint32Array` con varias palabras por fila (`w32`/`W_ALERGENO`) y no los
 *    uint64 de numpy: JS no tiene enteros de 64 bits sin BigInt, y BigInt en
 *    el camino caliente cuesta un orden de magnitud (port-typescript.md,
 *    representación de datos).
 *
 * `titulos` NO está: es lo único de `Catalogo` que el motor nunca lee. Vive en
 * `datos/recetas-vista.json`, que consume la UI. Meterlo aquí serían 36 cadenas
 * en el bundle del worker para no usarlas nunca.
 */
export interface CatalogoCompilado {
  /** sha256 del jsonl truncado a 16 hex. Entra en la clave de caché del pool. */
  version: string;
  /** Recetas. */
  n: number;
  /** Alimentos distintos citados por alguna receta. Define el ancho del bitset. */
  nAlimentos: number;
  /** Palabras de 32 bits por bitset: `ceil(nAlimentos / 32)`, mínimo 1. */
  w32: number;
  ids: readonly string[];
  idxPorId: Map<string, number>;
  /** (n, 6) row-major, en el orden de NUTRIENTES, por ración base. */
  nutr: Float32Array;
  /** (n, 6) 1 si el nutriente está declarado. Un 0 significa «no lo sé». */
  conocido: Uint8Array;
  /** (n, 3) dirección de macros con norma L2 = 1, o fila de ceros. */
  vMacro: Float32Array;
  /** (n,) 0 si 4P+4C+9G = 0 y por tanto no hay dirección que comparar. */
  tieneMacro: Uint8Array;
  escalaMin: Float32Array;
  escalaMax: Float32Array;
  /** (n,) bitmask de 6 bits: bit IDX_DIETA[d]. */
  mDieta: Uint8Array;
  /** (n, W_ALERGENO) row-major, palabras de 32 bits: bit `IDX_ALERGENO[a] %
   * 32` de la palabra `i*W_ALERGENO + (IDX_ALERGENO[a] / 32 | 0)`. Seguridad
   * alimentaria — con N_ALERGENOS (25 hoy) ya por encima de 32 no cabría en
   * un entero por fila (eso fue justo el bug que esto reemplaza: un
   * Uint16Array truncaba en silencio y dejaba pasar alérgenos). Mismo
   * esquema que `ingrBits`/`ingrPerecBits`, sólo que con ancho fijo
   * (W_ALERGENO) en vez de dependiente del catálogo (w32). */
  mAlergeno: Uint32Array;
  /** (n,) bitmask de 5 bits: bit IDX_SLOT[s]. */
  mSlot: Uint8Array;
  /** (n,) prep + cocción. int16 porque SIN_LIMITE_MINUTOS (32767) es su máximo. */
  minutos: Int16Array;
  /** (n, w32) bitset de los alimentos de la receta. */
  ingrBits: Uint32Array;
  /** (n, w32) subconjunto perecedero. Hoy sin consumidor en el motor. */
  ingrPerecBits: Uint32Array;
  /** (n,) `ingredientes.length`. NO tiene por qué ser el popcount de la fila. */
  nIngredientes: Int16Array;
  alimentoIdx: Map<string, number>;
  alimentoId: readonly string[];
  /** (n,) céntimos por ración base. */
  costeCents: Int32Array;
  /** (n,) 0 si el precio no se sabe. Entonces `costeCents` es un cero, no un precio. */
  costeConocido: Uint8Array;
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

function fallo(mensaje: string): never {
  throw new Error(`catálogo compilado: ${mensaje}`);
}

/**
 * Compara el vocabulario con el que se compiló el catálogo contra el que tiene
 * este motor. Es la ÚNICA defensa contra el fallo más caro del port.
 *
 * El orden de las cuatro tuplas es el orden de las columnas de todas las
 * matrices. Si alguien reordena ALERGENOS en `constantes.ts` y no recompila el
 * catálogo, `mAlergeno` sigue teniendo el bit 0 en «gluten» y el motor lo lee
 * como otra cosa: se filtra por el alérgeno equivocado, no falla nada, y a un
 * celíaco se le sirve pan. Si se reordena SLOTS, cambia además el último
 * componente de la ruta del árbol de RNG y el mismo seed produce otro plan.
 *
 * Por eso esto lanza en vez de avisar, y por eso compara el contenido y no un
 * hash: el mensaje tiene que decir QUÉ tupla no cuadra, o quien lo reciba
 * recompilará a ciegas.
 */
function verificarVocabulario(
  vocabulario: CatalogoSerializado["vocabulario"] | undefined,
): void {
  if (vocabulario === undefined || vocabulario === null) {
    fallo(
      "no trae el bloque `vocabulario`. Se compiló con una versión anterior del " +
        "compilador y no hay forma de saber con qué orden de columnas. " +
        "Regenera con: npm run motor:catalogo",
    );
  }
  const pares: readonly (readonly [string, readonly string[], readonly string[]])[] = [
    ["nutrientes", NUTRIENTES, vocabulario.nutrientes],
    ["dietas", DIETAS, vocabulario.dietas],
    ["alergenos", ALERGENOS, vocabulario.alergenos],
    ["slots", SLOTS, vocabulario.slots],
  ];
  for (const [nombre, esperado, recibido] of pares) {
    const iguales =
      Array.isArray(recibido) &&
      recibido.length === esperado.length &&
      esperado.every((v, i) => recibido[i] === v);
    if (!iguales) {
      fallo(
        `el vocabulario «${nombre}» no coincide con constantes.ts.\n` +
          `  constantes.ts: [${esperado.join(", ")}]\n` +
          `  catálogo:      [${Array.isArray(recibido) ? recibido.join(", ") : String(recibido)}]\n` +
          "El orden de esa tupla es el orden de las columnas de las matrices del " +
          "catálogo: usarlo desalineado no da un error, da otro plan. " +
          "Regenera con: npm run motor:catalogo",
      );
    }
  }
}

/** `datos.campo` tiene exactamente `esperado` elementos, o se explica por qué debería. */
function verificarLargo(nombre: string, recibido: readonly unknown[], esperado: number): void {
  if (!Array.isArray(recibido)) fallo(`«${nombre}» no es un array`);
  if (recibido.length !== esperado) {
    fallo(`«${nombre}» tiene ${recibido.length} elementos y debería tener ${esperado}`);
  }
}

/**
 * Los ids se comparan y se ordenan por code point (`comparaId`) y desempatan el
 * top-K del muestreo. Restringirlos a ASCII hace que el orden de V8 y el de
 * CPython coincidan por construcción y no por suerte, que es lo que hoy los hace
 * coincidir. El compilador ya lo valida; se revalida aquí porque el JSON es un
 * fichero de texto versionado en git y editarlo a mano es más fácil que
 * recompilarlo.
 */
function esAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if ((s.charCodeAt(i) ?? 0) > MAX_ASCII) return false;
  }
  return s.length > 0;
}

/**
 * Índice inverso de una lista de ids, lanzando si hay repetidos. Es el
 * `if len(idx_por_id) != n: raise ValueError` de `catalogo.py:166-168`, que
 * existe porque un id duplicado no rompe nada visible: simplemente hace que una
 * de las dos recetas sea inalcanzable por id y que `mapaFila` apunte a la otra.
 */
function indiceInverso(nombre: string, ids: readonly string[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (typeof id !== "string") fallo(`«${nombre}[${i}]» no es una cadena`);
    if (!esAscii(id)) fallo(`el id «${id}» de «${nombre}» no es ASCII`);
    if (mapa.has(id)) fallo(`«${nombre}» contiene ids duplicados: ${id}`);
    mapa.set(id, i);
  }
  return mapa;
}

/**
 * Comprueba que ningún valor se va a truncar en silencio al meterlo en su typed
 * array. Es la única familia de errores de este fichero que no se manifestaría
 * nunca como excepción:
 *
 *  - una máscara con un bit por encima de su tupla se recorta y deja de filtrar
 *    (así se descubrió que `mAlergeno` en un solo `Uint16Array` de 16 bits
 *    perdía los alérgenos más allá del 16.º — por eso ahora es multi-palabra,
 *    como `ingrBits`, y no un único entero por fila);
 *  - unos minutos de 40000 en un `Int16Array` salen como −25536, que es ≤ que
 *    cualquier tope y cuela la receta en todos los slots;
 *  - un `costeCents` fuera de int32 da la vuelta y sale «gratis».
 *
 * Con n = 36 esto son microsegundos, y corre una vez por carga del catálogo.
 */
function verificarRango(
  nombre: string,
  valores: readonly number[],
  minimo: number,
  maximo: number,
): void {
  for (let i = 0; i < valores.length; i++) {
    const v = valores[i];
    if (typeof v !== "number" || !Number.isInteger(v) || v < minimo || v > maximo) {
      fallo(`«${nombre}[${i}]» = ${String(v)} está fuera de [${minimo}, ${maximo}]`);
    }
  }
}

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

/**
 * Decodifica el catálogo columnar del build a typed arrays.
 *
 * LANZA si el catálogo se compiló con otro vocabulario, si alguna columna no
 * tiene la longitud que anuncian `n`/`w32`, si hay ids duplicados o no ASCII, o
 * si algún entero se truncaría al meterlo en su typed array. No lanza por nada
 * más: las validaciones de contenido (que un alérgeno exista, que una receta
 * cite alimentos conocidos) son cosa del compilador, que las hace con el fichero
 * fuente delante y puede decir en qué línea.
 *
 * A diferencia del Python, no hay caché, ni TTL, ni cerrojo: el catálogo es
 * estático y viaja dentro del bundle, así que esto se llama una vez por arranque
 * del worker.
 */
export function cargarCatalogo(datos: CatalogoSerializado): CatalogoCompilado {
  verificarVocabulario(datos.vocabulario);
  if (typeof datos.version !== "string" || datos.version === "") {
    // Sin `version` no hay clave de caché del pool ni forma de saber con qué
    // catálogo se generó un plan guardado. `catalogo.py:95-98` dice por qué:
    // una recarga en caliente produciría planes distintos con el mismo seed y
    // el fallo sería indepurable en soporte.
    fallo("«version» vacía o no es una cadena");
  }

  const { n, nAlimentos, w32 } = datos;
  if (!Number.isInteger(n) || n <= 0) fallo(`«n» = ${String(n)}; debe ser un entero positivo`);
  if (!Number.isInteger(nAlimentos) || nAlimentos < 0) {
    fallo(`«nAlimentos» = ${String(nAlimentos)}; debe ser un entero no negativo`);
  }
  // El ancho del bitset no se recalcula sobre `nAlimentos` y ya está: se
  // comprueba que el que trae el fichero es el que tocaba. Si el compilador
  // emitió los bits con W32 = 2 y aquí se dedujera 3, el decodificador leería
  // las filas desplazadas y cada receta heredaría los ingredientes de la
  // siguiente, sin error y sin síntoma hasta la lista de la compra.
  const w32Esperado = Math.max(1, Math.ceil(nAlimentos / BITS_POR_PALABRA));
  if (w32 !== w32Esperado) {
    fallo(`«w32» = ${String(w32)} y con ${nAlimentos} alimentos debería ser ${w32Esperado}`);
  }

  verificarLargo("ids", datos.ids, n);
  verificarLargo("alimentoId", datos.alimentoId, nAlimentos);
  verificarLargo("nutr", datos.nutr, n * N_NUTR);
  verificarLargo("conocido", datos.conocido, n * N_NUTR);
  verificarLargo("vMacro", datos.vMacro, n * 3);
  verificarLargo("tieneMacro", datos.tieneMacro, n);
  verificarLargo("escalaMin", datos.escalaMin, n);
  verificarLargo("escalaMax", datos.escalaMax, n);
  verificarLargo("mDieta", datos.mDieta, n);
  verificarLargo("mAlergeno", datos.mAlergeno, n * W_ALERGENO);
  verificarLargo("mSlot", datos.mSlot, n);
  verificarLargo("minutos", datos.minutos, n);
  verificarLargo("ingrBits", datos.ingrBits, n * w32);
  verificarLargo("ingrPerecBits", datos.ingrPerecBits, n * w32);
  verificarLargo("nIngredientes", datos.nIngredientes, n);
  verificarLargo("costeCents", datos.costeCents, n);
  verificarLargo("costeConocido", datos.costeConocido, n);

  // mDieta/mSlot: ni un bit por encima de su tupla. mAlergeno ya no es un
  // entero por fila (ver W_ALERGENO) así que se valida como los bitsets de
  // alimentos: cada palabra es un uint32 legítimo, igual que `ingrBits`.
  verificarRango("mDieta", datos.mDieta, 0, (1 << BITS_DIETA) - 1);
  verificarRango("mAlergeno", datos.mAlergeno, 0, 0xffffffff);
  verificarRango("mSlot", datos.mSlot, 0, (1 << BITS_SLOT) - 1);
  verificarRango("minutos", datos.minutos, MIN_INT16, MAX_INT16);
  verificarRango("nIngredientes", datos.nIngredientes, MIN_INT16, MAX_INT16);
  verificarRango("costeCents", datos.costeCents, MIN_INT32, MAX_INT32);
  verificarRango("ingrBits", datos.ingrBits, 0, 0xffffffff);
  verificarRango("ingrPerecBits", datos.ingrPerecBits, 0, 0xffffffff);
  // Los tres booleanos: 0 o 1 y nada más. Un 256 se trunca a 0 en el
  // `Uint8Array` y convierte un «sí» en un «no lo sé» sin ruido.
  verificarRango("conocido", datos.conocido, 0, 1);
  verificarRango("tieneMacro", datos.tieneMacro, 0, 1);
  verificarRango("costeConocido", datos.costeConocido, 0, 1);

  const ids: readonly string[] = [...datos.ids];
  const alimentoId: readonly string[] = [...datos.alimentoId];

  return {
    version: datos.version,
    n,
    nAlimentos,
    w32,
    ids,
    idxPorId: indiceInverso("ids", ids),
    // El constructor de `Float32Array` a partir de `number[]` redondea a float32
    // con el mismo modo (al par más cercano) que `.astype(np.float32)`. Es el
    // punto en el que Python materializa el float32 y aquí también, así que no
    // hace falta ningún `Math.fround` extra.
    nutr: new Float32Array(datos.nutr),
    conocido: new Uint8Array(datos.conocido),
    vMacro: new Float32Array(datos.vMacro),
    tieneMacro: new Uint8Array(datos.tieneMacro),
    escalaMin: new Float32Array(datos.escalaMin),
    escalaMax: new Float32Array(datos.escalaMax),
    mDieta: new Uint8Array(datos.mDieta),
    mAlergeno: new Uint32Array(datos.mAlergeno),
    mSlot: new Uint8Array(datos.mSlot),
    minutos: new Int16Array(datos.minutos),
    ingrBits: new Uint32Array(datos.ingrBits),
    ingrPerecBits: new Uint32Array(datos.ingrPerecBits),
    nIngredientes: new Int16Array(datos.nIngredientes),
    alimentoIdx: indiceInverso("alimentoId", alimentoId),
    alimentoId,
    costeCents: new Int32Array(datos.costeCents),
    costeConocido: new Uint8Array(datos.costeConocido),
  };
}

/**
 * Los `ArrayBuffer` del catálogo, para pasarlo al worker sin copiarlo:
 * `worker.postMessage(cat, transferibles(cat))`.
 *
 * El resto de campos (`version`, las dos listas de ids, los dos `Map`) los clona
 * el algoritmo de clonado estructurado, que los soporta de serie. Sólo las
 * matrices merecen transferirse, y son las únicas que pueden.
 *
 * OJO: transferir DESACOPLA los buffers del lado emisor. Tras un `postMessage`
 * con esta lista, el `CatalogoCompilado` de origen queda inservible (todos sus
 * typed arrays pasan a tener longitud 0) y hay que volver a llamar a
 * `cargarCatalogo`. Es lo que se quiere —el catálogo vive en el worker, no en el
 * hilo principal— pero no es reversible.
 */
export function transferibles(cat: CatalogoCompilado): ArrayBuffer[] {
  const vistas = [
    cat.nutr,
    cat.conocido,
    cat.vMacro,
    cat.tieneMacro,
    cat.escalaMin,
    cat.escalaMax,
    cat.mDieta,
    cat.mAlergeno,
    cat.mSlot,
    cat.minutos,
    cat.ingrBits,
    cat.ingrPerecBits,
    cat.nIngredientes,
    cat.costeCents,
    cat.costeConocido,
  ];
  // `.buffer` está tipado como `ArrayBufferLike` porque podría ser un
  // `SharedArrayBuffer`, que NO es transferible. Aquí nunca lo es —
  // `cargarCatalogo` reserva buffers normales, y en GitHub Pages no se pueden
  // enviar las cabeceras COOP/COEP que habilitan la memoria compartida—, pero
  // se filtra en vez de aserción: un buffer que se quedara fuera de la lista se
  // COPIA en el postMessage en lugar de transferirse, que es lento y correcto.
  // Un `as ArrayBuffer` sería rápido y mentiroso.
  const salida: ArrayBuffer[] = [];
  for (const vista of vistas) {
    const buffer = vista.buffer;
    if (buffer instanceof ArrayBuffer) salida.push(buffer);
  }
  return salida;
}
