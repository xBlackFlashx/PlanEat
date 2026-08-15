/**
 * Compilador del catálogo. **Script de BUILD: corre en Node y NO entra al bundle.**
 *
 * Porta la parte de compilación de `services/solver/app/catalogo.py`
 * (`cargar_catalogo`) y de `apps/web/src/lib/catalogo.ts`. Emite dos ficheros:
 *
 *   datos/catalogo-compilado.json  El catálogo en JSON columnar que consume el
 *                                  motor. Cada campo es un array plano que se
 *                                  vuelca a un typed array sin recorrer objetos.
 *   datos/recetas-vista.json       Lo que hoy lee la web del disco del solver:
 *                                  título, ingredientes con nombre legible,
 *                                  panel por ración. En Pages no hay disco.
 *
 * Por qué se precompila en vez de parsear el jsonl en el navegador: hay
 * exactamente dos puntos donde el navegador podría derivar algo distinto de lo
 * que deriva Python — el `sorted()` del vocabulario de alimentos y el cálculo de
 * `v_macro` en float32 — y ambos desaparecen si el build los resuelve y el
 * runtime sólo los consume. Ver docs/port-typescript.md, §compilar-catalogo.
 *
 * Éste es el ÚNICO fichero del paquete que puede importar node:*. Todo lo que
 * vive bajo src/ tiene que correr en un Worker del navegador.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALERGENOS,
  DIETAS,
  ESCALA_MAX_POR_DEFECTO,
  ESCALA_MIN_POR_DEFECTO,
  NUTRIENTES,
  SLOTS,
} from "../src/constantes.ts";

// --------------------------------------------------------------------------
// Constantes locales del compilador.
//
// No van a constantes.ts a propósito: constantes.ts es el vocabulario del
// MOTOR, y el motor nunca ve ninguna de estas. Los factores de Atwater sólo se
// usan aquí (el navegador recibe vMacro ya calculado) y el tamaño de palabra es
// una propiedad de Uint32Array, no una decisión de producto. En Python viven
// igualmente sueltos en catalogo.py, no en solver/__init__.py.
// --------------------------------------------------------------------------

/** Atwater: kcal por gramo de proteína, carbohidrato y grasa. */
const ATWATER_PROTEINA = 4.0;
const ATWATER_CARBOHIDRATO = 4.0;
const ATWATER_GRASA = 9.0;

/** Bits por palabra del bitset. 32, no 64: JS no tiene enteros de 64 bits sin BigInt. */
const BITS_POR_PALABRA = 32;

/** Longitud del sha256 que se conserva como `version`, igual que catalogo.py:107. */
const DIGITOS_VERSION = 16;

/** Dígitos significativos máximos que puede necesitar un float32 para round-trip. */
const DIGITOS_FLOAT32 = 9;

const NOMBRE_SALIDA_MOTOR = "catalogo-compilado.json";
const NOMBRE_SALIDA_VISTA = "recetas-vista.json";

// --------------------------------------------------------------------------
// Contrato de salida
// --------------------------------------------------------------------------

/**
 * El catálogo columnar tal y como viaja en el bundle. Todos los arrays están
 * alineados por índice de fila: la fila `i` es la misma receta en todos ellos.
 * Es el invariante maestro que hereda del Python y del que depende el resto.
 */
export interface CatalogoSerializado {
  version: string;
  n: number;
  nAlimentos: number;
  w32: number;
  ids: string[];
  /** n*6 en row-major, orden de columnas = NUTRIENTES. */
  nutr: number[];
  /** n*6, 0/1. `false` significa «no lo sé», nunca «cero». */
  conocido: number[];
  /** n*3, norma L2 = 1 por fila (o fila de ceros si no hay macros). */
  vMacro: number[];
  tieneMacro: number[];
  escalaMin: number[];
  escalaMax: number[];
  /** Un entero por fila: bit IDX_DIETA[d]. Idem para alérgeno (14 bits) y slot (5). */
  mDieta: number[];
  mAlergeno: number[];
  mSlot: number[];
  minutos: number[];
  /** n*w32 palabras sin signo, row-major. */
  ingrBits: number[];
  ingrPerecBits: number[];
  nIngredientes: number[];
  alimentoId: string[];
  costeCents: number[];
  costeConocido: number[];
  /**
   * Las cuatro tuplas con las que se compiló. `cargarCatalogo` compara esto
   * contra constantes.ts y lanza si no coincide: un catálogo compilado con otro
   * orden de columnas produce planes silenciosamente incorrectos, que es el
   * fallo más caro que puede tener este port.
   */
  vocabulario: {
    nutrientes: string[];
    dietas: string[];
    alergenos: string[];
    slots: string[];
  };
}

/** Una receta tal y como la dibuja la UI. Espejo de `RecetaResumen` de apps/web. */
export interface RecetaVista {
  id: string;
  titulo: string;
  racionesBase: number;
  minutos: number;
  slots: string[];
  alergenos: string[];
  /** Nombres legibles ya resueltos contra ingredientes.json. */
  ingredientes: string[];
  porRacion: {
    kcal: number;
    proteinaG: number;
    carbohidratoG: number;
    grasaG: number;
    fibraG: number;
    sodioMg: number;
  };
  conocido: {
    kcal: boolean;
    proteinaG: boolean;
    carbohidratoG: boolean;
    grasaG: boolean;
    fibraG: boolean;
    sodioMg: boolean;
  };
  /** `null` cuando el precio no se sabe: la UI no inventa una cifra. */
  costeCents: number | null;
  revisadaPor: string | null;
}

export interface VistaRecetas {
  version: string;
  total: number;
  recetas: Record<string, RecetaVista>;
}

// --------------------------------------------------------------------------
// Lectura defensiva del jsonl
//
// El jsonl lo genera scripts/construir_catalogo.py, así que en teoría siempre
// está bien formado. Se valida igual porque un catálogo torcido aquí se
// convierte en un plan torcido en producción, y a esas alturas ya no hay traza
// que lleve de vuelta a la línea 17 del fichero de datos.
// --------------------------------------------------------------------------

type Objeto = Record<string, unknown>;

class ErrorCatalogo extends Error {}

function fallo(mensaje: string): never {
  throw new ErrorCatalogo(mensaje);
}

function comoObjeto(valor: unknown, donde: string): Objeto {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    fallo(`${donde}: se esperaba un objeto`);
  }
  return valor as Objeto;
}

function comoTexto(valor: unknown, donde: string): string {
  if (typeof valor !== "string") fallo(`${donde}: se esperaba una cadena`);
  return valor;
}

function comoNumero(valor: unknown, donde: string): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) {
    fallo(`${donde}: se esperaba un número finito`);
  }
  return valor;
}

function comoLista(valor: unknown, donde: string): unknown[] {
  if (!Array.isArray(valor)) fallo(`${donde}: se esperaba una lista`);
  return valor;
}

function listaDeTextos(valor: unknown, donde: string): string[] {
  return comoLista(valor, donde).map((v, i) => comoTexto(v, `${donde}[${i}]`));
}

/** Lista de exactamente `largo` números. Los paneles nutricionales son de 6. */
function listaDeNumeros(valor: unknown, largo: number, donde: string): number[] {
  const bruta = comoLista(valor, donde);
  if (bruta.length !== largo) {
    fallo(`${donde}: se esperaban ${largo} valores, hay ${bruta.length}`);
  }
  return bruta.map((v, i) => comoNumero(v, `${donde}[${i}]`));
}

function listaDeBooleanos(valor: unknown, largo: number, donde: string): boolean[] {
  const bruta = comoLista(valor, donde);
  if (bruta.length !== largo) {
    fallo(`${donde}: se esperaban ${largo} valores, hay ${bruta.length}`);
  }
  return bruta.map((v, i) => {
    if (typeof v !== "boolean") fallo(`${donde}[${i}]: se esperaba un booleano`);
    return v;
  });
}

/**
 * Los ids se comparan y se ordenan en dos runtimes distintos (CPython y V8) y
 * viajan en claves de caché. Restringirlos a ASCII hace que `sorted()` de Python
 * y el orden por code point de JS coincidan por construcción, y no por suerte.
 */
function esAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === undefined || c > 0x7f) return false;
  }
  return s.length > 0;
}

/**
 * Orden por code point, que es lo que hace `sorted()` de Python. El `sort()` de
 * JS ordena por code unit UTF-16 y difiere fuera del BMP; hoy todos los ids son
 * ASCII y da igual, pero el vocabulario de alimentos define qué bit ocupa cada
 * alimento y una discrepancia aquí no daría error, daría otro plan.
 */
function comparaCodePoint(a: string, b: string): number {
  const ca = [...a];
  const cb = [...b];
  const menor = Math.min(ca.length, cb.length);
  for (let i = 0; i < menor; i++) {
    const pa = ca[i]?.codePointAt(0) ?? 0;
    const pb = cb[i]?.codePointAt(0) ?? 0;
    if (pa !== pb) return pa - pb;
  }
  return ca.length - cb.length;
}

// --------------------------------------------------------------------------
// Emisión de flotantes
// --------------------------------------------------------------------------

const f32 = Math.fround;

/**
 * Decimal más corto que sigue redondeando al mismo float32. `vMacro` se calcula
 * aquí y sale como double exacto de un float32 (17 dígitos, «0.6417525410652161»);
 * el motor lo va a meter en un Float32Array de todas formas, así que los dígitos
 * de más sólo engordan el bundle. No se aplica a `nutr` ni a las escalas porque
 * ahí los valores vienen ya cortos del fichero fuente.
 */
function corto(x: number): number {
  for (let p = 1; p <= DIGITOS_FLOAT32; p++) {
    const candidato = Number(x.toPrecision(p));
    if (f32(candidato) === x) return candidato;
  }
  return x;
}

// --------------------------------------------------------------------------
// Compilación
// --------------------------------------------------------------------------

interface FilaCruda {
  id: string;
  titulo: string;
  racionesBase: number;
  nutr: number[];
  conocido: boolean[];
  minutos: number;
  dietas: string[];
  alergenos: string[];
  slots: string[];
  ingredientes: string[];
  ingredientesPerecederos: string[];
  costeCents: number;
  costeConocido: boolean;
  escalaMin: number;
  escalaMax: number;
  revisadaPor: string | null;
}

/** Parsea el jsonl aplicando los mismos defaults que `cargar_catalogo`. */
function leerFilas(jsonl: string): FilaCruda[] {
  const filas: FilaCruda[] = [];
  const lineas = jsonl.split(/\r?\n/);
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i] ?? "";
    if (linea.trim() === "") continue;
    const donde = `catalogo.jsonl:${i + 1}`;
    let crudo: unknown;
    try {
      crudo = JSON.parse(linea);
    } catch (e) {
      fallo(`${donde}: JSON ilegible (${(e as Error).message})`);
    }
    const f = comoObjeto(crudo, donde);
    const revisada = f["revisadaPor"];
    filas.push({
      id: comoTexto(f["id"], `${donde}.id`),
      titulo: comoTexto(f["titulo"], `${donde}.titulo`),
      racionesBase: f["racionesBase"] === undefined
        ? 1
        : comoNumero(f["racionesBase"], `${donde}.racionesBase`),
      nutr: listaDeNumeros(f["nutr"], NUTRIENTES.length, `${donde}.nutr`),
      conocido: f["conocido"] === undefined
        ? NUTRIENTES.map(() => true)
        : listaDeBooleanos(f["conocido"], NUTRIENTES.length, `${donde}.conocido`),
      minutos: comoNumero(f["minutos"], `${donde}.minutos`),
      dietas: listaDeTextos(f["dietas"], `${donde}.dietas`),
      alergenos: listaDeTextos(f["alergenos"], `${donde}.alergenos`),
      slots: listaDeTextos(f["slots"], `${donde}.slots`),
      ingredientes: listaDeTextos(f["ingredientes"], `${donde}.ingredientes`),
      ingredientesPerecederos: f["ingredientesPerecederos"] === undefined
        ? []
        : listaDeTextos(f["ingredientesPerecederos"], `${donde}.ingredientesPerecederos`),
      costeCents: f["costeCents"] === undefined
        ? 0
        : comoNumero(f["costeCents"], `${donde}.costeCents`),
      costeConocido: f["costeConocido"] === true,
      escalaMin: f["escalaMin"] === undefined
        ? ESCALA_MIN_POR_DEFECTO
        : comoNumero(f["escalaMin"], `${donde}.escalaMin`),
      escalaMax: f["escalaMax"] === undefined
        ? ESCALA_MAX_POR_DEFECTO
        : comoNumero(f["escalaMax"], `${donde}.escalaMax`),
      revisadaPor: typeof revisada === "string" ? revisada : null,
    });
  }
  return filas;
}

/** Los nombres legibles de ingredientes.json, por id. */
function leerNombres(ingredientes: unknown): Map<string, string> {
  const nombres = new Map<string, string>();
  const raiz = comoObjeto(ingredientes, "ingredientes.json");
  const lista = comoLista(raiz["ingredientes"] ?? [], "ingredientes.json.ingredientes");
  for (let i = 0; i < lista.length; i++) {
    const item = comoObjeto(lista[i], `ingredientes.json.ingredientes[${i}]`);
    nombres.set(
      comoTexto(item["id"], `ingredientes.json.ingredientes[${i}].id`),
      comoTexto(item["nombre"], `ingredientes.json.ingredientes[${i}].nombre`),
    );
  }
  return nombres;
}

/** Índice de un valor en su tupla canónica, o −1 si no pertenece al vocabulario. */
function indiceEn(vocabulario: readonly string[], clave: string): number {
  return vocabulario.indexOf(clave);
}

/**
 * Colapsa una lista de etiquetas a un entero con un bit por posición de la tupla
 * canónica. Las etiquetas desconocidas se ignoran en silencio, igual que Python:
 * un alérgeno que el vocabulario no conoce no puede filtrarse, y hacer fallar el
 * build por una etiqueta nueva bloquearía el catálogo entero.
 */
function mascaraDe(vocabulario: readonly string[], etiquetas: readonly string[]): number {
  let mascara = 0;
  for (const etiqueta of etiquetas) {
    const bit = indiceEn(vocabulario, etiqueta);
    if (bit >= 0) mascara |= 1 << bit;
  }
  return mascara;
}

/** Escribe el bitset de un conjunto de alimentos sobre `destino[base .. base+w32)`. */
function escribirBitset(
  destino: number[],
  base: number,
  ids: readonly string[],
  indice: Map<string, number>,
): void {
  for (const aid of ids) {
    const bit = indice.get(aid);
    if (bit === undefined) continue;
    const palabra = base + (bit / BITS_POR_PALABRA | 0);
    const anterior = destino[palabra] ?? 0;
    // `>>> 0` porque `1 << 31` es negativo en JS: sin esto la palabra alta
    // saldría al JSON como −2147483648 y el Uint32Array la leería bien, pero el
    // fichero dejaría de ser legible por un humano y de compararse con Python.
    destino[palabra] = (anterior | (1 << (bit % BITS_POR_PALABRA))) >>> 0;
  }
}

/**
 * Compila el catálogo columnar. `ingredientes` es el contenido ya parseado de
 * ingredientes.json y se usa para comprobar integridad referencial: si una
 * receta cita un alimento que no existe, el build para. La UI degradaría a
 * enseñar el id crudo («yogur_griego») y nadie se enteraría durante meses.
 */
export function compilar(jsonl: string, ingredientes: unknown): CatalogoSerializado {
  const version = createHash("sha256").update(jsonl, "utf8").digest("hex").slice(0, DIGITOS_VERSION);
  const filas = leerFilas(jsonl);
  if (filas.length === 0) fallo("El catálogo está vacío");
  const n = filas.length;

  // --- Vocabulario de alimentos: bit estable por orden alfabético -----------
  // Sólo los alimentos que aparecen en `ingredientes` de alguna receta (hoy 66),
  // no los 73 de ingredientes.json: es lo que hace Python y añadir los que nadie
  // usa desplazaría todos los bits siguientes.
  const presentes = new Set<string>();
  for (const f of filas) for (const a of f.ingredientes) presentes.add(a);
  const alimentoId = [...presentes].sort(comparaCodePoint);
  const alimentoIdx = new Map<string, number>(alimentoId.map((a, i) => [a, i]));
  const nAlimentos = alimentoId.length;
  const w32 = Math.max(1, Math.ceil(nAlimentos / BITS_POR_PALABRA));

  const nombres = leerNombres(ingredientes);
  const huerfanos = alimentoId.filter((a) => !nombres.has(a));
  if (huerfanos.length > 0) {
    fallo(
      `El catálogo cita alimentos que no están en ingredientes.json: ${huerfanos.join(", ")}. ` +
        "Regenera el catálogo con: python scripts/construir_catalogo.py",
    );
  }

  for (const a of alimentoId) {
    if (!esAscii(a)) fallo(`El id de alimento «${a}» no es ASCII`);
  }

  const ids: string[] = new Array<string>(n);
  const nutr: number[] = new Array<number>(n * NUTRIENTES.length).fill(0);
  const conocido: number[] = new Array<number>(n * NUTRIENTES.length).fill(0);
  const vMacro: number[] = new Array<number>(n * 3).fill(0);
  const tieneMacro: number[] = new Array<number>(n).fill(0);
  const escalaMin: number[] = new Array<number>(n).fill(0);
  const escalaMax: number[] = new Array<number>(n).fill(0);
  const mDieta: number[] = new Array<number>(n).fill(0);
  const mAlergeno: number[] = new Array<number>(n).fill(0);
  const mSlot: number[] = new Array<number>(n).fill(0);
  const minutos: number[] = new Array<number>(n).fill(0);
  const ingrBits: number[] = new Array<number>(n * w32).fill(0);
  const ingrPerecBits: number[] = new Array<number>(n * w32).fill(0);
  const nIngredientes: number[] = new Array<number>(n).fill(0);
  const costeCents: number[] = new Array<number>(n).fill(0);
  const costeConocido: number[] = new Array<number>(n).fill(0);

  const vistos = new Set<string>();
  for (let i = 0; i < n; i++) {
    // `filas` se acaba de construir con longitud n; el índice no puede fallar.
    const f = filas[i] as FilaCruda;
    if (!esAscii(f.id)) fallo(`El id de receta «${f.id}» no es ASCII`);
    if (vistos.has(f.id)) fallo(`El catálogo contiene ids de receta duplicados: ${f.id}`);
    vistos.add(f.id);
    ids[i] = f.id;

    for (let c = 0; c < NUTRIENTES.length; c++) {
      // Se emite el valor del fichero sin redondear a float32: el motor lo
      // vuelca a un Float32Array y el redondeo ocurre allí, con el mismo modo
      // (al par más cercano) que usa numpy. Emitir el float32 ya redondeado
      // añadiría dígitos al bundle sin cambiar un bit del resultado.
      nutr[i * NUTRIENTES.length + c] = f.nutr[c] ?? 0;
      conocido[i * NUTRIENTES.length + c] = f.conocido[c] === true ? 1 : 0;
    }

    escalaMin[i] = f.escalaMin;
    escalaMax[i] = f.escalaMax;
    mDieta[i] = mascaraDe(DIETAS, f.dietas);
    mAlergeno[i] = mascaraDe(ALERGENOS, f.alergenos);
    mSlot[i] = mascaraDe(SLOTS, f.slots);
    minutos[i] = f.minutos;
    escribirBitset(ingrBits, i * w32, f.ingredientes, alimentoIdx);
    escribirBitset(ingrPerecBits, i * w32, f.ingredientesPerecederos, alimentoIdx);
    nIngredientes[i] = f.ingredientes.length;
    costeCents[i] = f.costeCents;
    costeConocido[i] = f.costeConocido ? 1 : 0;

    // --- vMacro (DISENO.md §1.1) -------------------------------------------
    // Se normaliza con la kcal derivada de Atwater, NO con la declarada: si el
    // panel declara 320 kcal y los macros suman 298, las fracciones sobre 320 no
    // suman 1 y el coseno de la etapa A queda sesgado.
    //
    // Cada operación pasa por Math.fround porque numpy hace toda esta cuenta en
    // float32 (arrays float32 con escalares de Python, que bajo NEP 50 no
    // promocionan). Es la única forma de que el vector que viaja al navegador
    // sea bit a bit el mismo que el del backend; aquí el coste no importa, esto
    // corre una vez por build.
    const prot = f32(f.nutr[1] ?? 0);
    const carb = f32(f.nutr[2] ?? 0);
    const grasa = f32(f.nutr[3] ?? 0);
    const kProt = f32(ATWATER_PROTEINA * prot);
    const kCarb = f32(ATWATER_CARBOHIDRATO * carb);
    const kGrasa = f32(ATWATER_GRASA * grasa);
    const kcalMacro = f32(f32(kProt + kCarb) + kGrasa);
    if (kcalMacro > 0) {
      tieneMacro[i] = 1;
      const fp = f32(kProt / kcalMacro);
      const fc = f32(kCarb / kcalMacro);
      const fg = f32(kGrasa / kcalMacro);
      // np.linalg.norm reduce en el mismo orden: ((p²+c²)+g²), y luego raíz.
      const suma = f32(f32(f32(fp * fp) + f32(fc * fc)) + f32(fg * fg));
      const norma = f32(Math.sqrt(suma));
      const divisor = norma > 0 ? norma : 1.0;
      vMacro[i * 3] = corto(f32(fp / divisor));
      vMacro[i * 3 + 1] = corto(f32(fc / divisor));
      vMacro[i * 3 + 2] = corto(f32(fg / divisor));
    }
  }

  return {
    version,
    n,
    nAlimentos,
    w32,
    ids,
    nutr,
    conocido,
    vMacro,
    tieneMacro,
    escalaMin,
    escalaMax,
    mDieta,
    mAlergeno,
    mSlot,
    minutos,
    ingrBits,
    ingrPerecBits,
    nIngredientes,
    alimentoId,
    costeCents,
    costeConocido,
    vocabulario: {
      nutrientes: [...NUTRIENTES],
      dietas: [...DIETAS],
      alergenos: [...ALERGENOS],
      slots: [...SLOTS],
    },
  };
}

/**
 * La vista de presentación que hoy construye apps/web/src/lib/catalogo.ts
 * leyendo del disco del solver. En GitHub Pages no hay disco ni servidor, así
 * que este fichero la sustituye. `version` la ata al catálogo compilado con el
 * que se generó: si divergen, es que alguien recompiló sólo la mitad.
 */
export function vistaDeRecetas(jsonl: string, ingredientes: unknown, version: string): VistaRecetas {
  const filas = leerFilas(jsonl);
  const nombres = leerNombres(ingredientes);
  const recetas: Record<string, RecetaVista> = {};

  for (const f of filas) {
    const v = (c: number): number => f.nutr[c] ?? 0;
    const s = (c: number): boolean => f.conocido[c] === true;
    recetas[f.id] = {
      id: f.id,
      titulo: f.titulo,
      racionesBase: f.racionesBase,
      minutos: f.minutos,
      slots: f.slots,
      alergenos: f.alergenos,
      ingredientes: f.ingredientes.map((id) => nombres.get(id) ?? id),
      porRacion: {
        kcal: v(0),
        proteinaG: v(1),
        carbohidratoG: v(2),
        grasaG: v(3),
        fibraG: v(4),
        sodioMg: v(5),
      },
      conocido: {
        kcal: s(0),
        proteinaG: s(1),
        carbohidratoG: s(2),
        grasaG: s(3),
        fibraG: s(4),
        sodioMg: s(5),
      },
      // Sin `costeConocido` no hay precio, aunque venga un número: enseñar un
      // coste inventado en una app de presupuesto es peor que no enseñar nada.
      costeCents: f.costeConocido ? f.costeCents : null,
      revisadaPor: f.revisadaPor,
    };
  }

  return { version, total: filas.length, recetas };
}

// --------------------------------------------------------------------------
// Serialización a fichero
// --------------------------------------------------------------------------

/**
 * Un campo por línea. El fichero está versionado en git y se regenera a menudo:
 * con `JSON.stringify(x)` a pelo cualquier cambio produce un diff de una línea
 * de 40 KB, y con indentación completa pesa el triple. Un array por línea deja
 * ver qué columna cambió sin engordar el bundle.
 */
function serializarColumnar(cat: CatalogoSerializado): string {
  const lineas = Object.entries(cat).map(
    ([clave, valor]) => `${JSON.stringify(clave)}: ${JSON.stringify(valor)}`,
  );
  return `{\n${lineas.join(",\n")}\n}\n`;
}

/** Idem para la vista: una receta por línea. */
function serializarVista(vista: VistaRecetas): string {
  const lineas = Object.entries(vista.recetas).map(
    ([id, receta]) => ` ${JSON.stringify(id)}: ${JSON.stringify(receta)}`,
  );
  return (
    `{\n"version": ${JSON.stringify(vista.version)},\n` +
    `"total": ${vista.total},\n` +
    `"recetas": {\n${lineas.join(",\n")}\n}\n}\n`
  );
}

/**
 * Escribe sólo si el contenido cambia. El script es idempotente por
 * construcción (no hay ni relojes ni orden de recorrido inestable), y no tocar
 * la mtime evita que un `npm run motor:catalogo` de más dispare recompilaciones
 * en cascada de la web.
 */
function escribirSiCambia(ruta: string, contenido: string): boolean {
  let anterior: string | null = null;
  try {
    anterior = readFileSync(ruta, "utf8");
  } catch {
    anterior = null;
  }
  if (anterior === contenido) return false;
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, contenido, "utf8");
  return true;
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIR_DATOS_SOLVER = resolve(AQUI, "../../../services/solver/data");
const DIR_SALIDA = resolve(AQUI, "../datos");

export function principal(argv: readonly string[]): number {
  // `--verificar` no escribe: falla si los ficheros del repositorio no son los
  // que produce el compilador hoy. Es la comprobación que va en CI para que
  // nadie edite a mano un fichero generado.
  const soloVerificar = argv.includes("--verificar");

  const jsonl = readFileSync(resolve(DIR_DATOS_SOLVER, "catalogo.jsonl"), "utf8");
  const ingredientes: unknown = JSON.parse(
    readFileSync(resolve(DIR_DATOS_SOLVER, "ingredientes.json"), "utf8"),
  );

  const cat = compilar(jsonl, ingredientes);
  const vista = vistaDeRecetas(jsonl, ingredientes, cat.version);

  const salidas: [string, string][] = [
    [resolve(DIR_SALIDA, NOMBRE_SALIDA_MOTOR), serializarColumnar(cat)],
    [resolve(DIR_SALIDA, NOMBRE_SALIDA_VISTA), serializarVista(vista)],
  ];

  let desfasados = 0;
  for (const [ruta, contenido] of salidas) {
    if (soloVerificar) {
      let actual: string | null = null;
      try {
        actual = readFileSync(ruta, "utf8");
      } catch {
        actual = null;
      }
      if (actual !== contenido) {
        desfasados++;
        console.error(`DESFASADO: ${ruta}`);
      }
      continue;
    }
    const cambiado = escribirSiCambia(ruta, contenido);
    console.log(`${cambiado ? "escrito " : "sin cambios"} ${ruta}`);
  }

  if (soloVerificar) {
    if (desfasados > 0) {
      console.error("Regenera con: npm run motor:catalogo");
      return 1;
    }
    console.log("Los ficheros compilados están al día.");
    return 0;
  }

  console.log(
    `catálogo ${cat.version}: ${cat.n} recetas, ${cat.nAlimentos} alimentos, w32=${cat.w32}`,
  );
  return 0;
}

const rutaInvocada = process.argv[1];
if (rutaInvocada !== undefined && resolve(rutaInvocada) === fileURLToPath(import.meta.url)) {
  process.exitCode = principal(process.argv.slice(2));
}
