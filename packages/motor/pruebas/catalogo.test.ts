/**
 * Decodificación del catálogo compilado.
 *
 * Dos familias de test y ninguna más, porque `catalogo.ts` sólo hace dos cosas:
 *
 * 1. **Decodifica**. Se compara contra `pruebas/datos/referencia-python-catalogo.json`,
 *    que es un volcado literal de `cargar_catalogo()` del backend con el mismo
 *    catalogo.jsonl. Comparar contra el Python y no contra números escritos a
 *    mano es lo único que demuestra que el motor del navegador arranca desde
 *    exactamente los mismos bits.
 * 2. **Se niega a arrancar** cuando el catálogo no cuadra. Ésta es la parte que
 *    de verdad importa: todo lo que se valida aquí es algo que, sin la
 *    validación, se corrompería EN SILENCIO. Por eso cada caso comprueba que
 *    lanza, no que devuelve algo raro.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { cargarCatalogo, transferibles } from "../src/catalogo.ts";
import { ALERGENOS, DIETAS, NUTRIENTES, SLOTS } from "../src/constantes.ts";
import type { CatalogoSerializado } from "../herramientas/compilar-catalogo.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));

function leerJson<T>(ruta: string): T {
  return JSON.parse(readFileSync(ruta, "utf8")) as T;
}

const COMPILADO = leerJson<CatalogoSerializado>(
  resolve(AQUI, "../datos/catalogo-compilado.json"),
);

/** El volcado de `cargar_catalogo()` de Python. Sólo los campos que se comparan. */
interface ReferenciaPython {
  version: string;
  n: number;
  nAlimentos: number;
  ids: string[];
  alimentoId: string[];
  nutr: number[];
  conocido: number[];
  vMacro: number[];
  tieneMacro: number[];
  escalaMin: number[];
  escalaMax: number[];
  mDieta: number[];
  mAlergeno: number[];
  mSlot: number[];
  minutos: number[];
  /** Los uint64 de numpy ya partidos en cuatro palabras de 32 bits por fila. */
  ingrBitsU32: number[][];
  ingrPerecBitsU32: number[][];
  nIngredientes: number[];
  costeCents: number[];
  costeConocido: number[];
}

const PY = leerJson<ReferenciaPython>(
  resolve(AQUI, "datos/referencia-python-catalogo.json"),
);

/**
 * Copia profunda del catálogo compilado para poder estropearlo sin contaminar
 * los demás tests. `structuredClone` y no `JSON.parse(JSON.stringify(...))`
 * porque es más corto y aquí no hay nada que no sepa clonar.
 */
function copiaCompilado(): CatalogoSerializado {
  return structuredClone(COMPILADO);
}

/** Comprueba que `cargarCatalogo` lanza y que el mensaje señala la causa. */
function exigeFallo(datos: CatalogoSerializado, fragmento: string): void {
  assert.throws(
    () => cargarCatalogo(datos),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, new RegExp(fragmento));
      return true;
    },
  );
}

// ---------------------------------------------------------------------------
// Decodificación
// ---------------------------------------------------------------------------

test("las formas y los escalares son los que declara el catálogo compilado", () => {
  const cat = cargarCatalogo(COMPILADO);

  assert.equal(cat.version, PY.version);
  assert.equal(cat.n, PY.n);
  assert.equal(cat.nAlimentos, PY.nAlimentos);
  // W32 = ceil(nAlimentos/32). En Python son la mitad de palabras de 64 bits:
  // el mismo conjunto de alimentos con otro tamaño de palabra, no otro dato.
  // Se deriva de cat.nAlimentos y no se fija a mano: el número de alimentos
  // del catálogo crece con el catálogo, y un valor fijo aquí se rompe cada
  // vez que se añaden ingredientes sin que sea un fallo real.
  assert.equal(cat.w32, Math.ceil(cat.nAlimentos / 32));

  assert.equal(cat.nutr.length, cat.n * NUTRIENTES.length);
  assert.equal(cat.conocido.length, cat.n * NUTRIENTES.length);
  assert.equal(cat.vMacro.length, cat.n * 3);
  assert.equal(cat.ingrBits.length, cat.n * cat.w32);
  assert.equal(cat.ingrPerecBits.length, cat.n * cat.w32);

  // Los tipos NO son intercambiables: float32 donde numpy tiene float32 decide
  // qué empates del top-K se rompen, y un Uint16Array para `mAlergeno` es lo
  // que hace que los catorce bits quepan.
  assert.ok(cat.nutr instanceof Float32Array);
  assert.ok(cat.vMacro instanceof Float32Array);
  assert.ok(cat.escalaMin instanceof Float32Array);
  assert.ok(cat.mDieta instanceof Uint8Array);
  assert.ok(cat.mAlergeno instanceof Uint16Array);
  assert.ok(cat.mSlot instanceof Uint8Array);
  assert.ok(cat.minutos instanceof Int16Array);
  assert.ok(cat.ingrBits instanceof Uint32Array);
  assert.ok(cat.costeCents instanceof Int32Array);
});

test("cada columna decodificada coincide con el volcado de cargar_catalogo", () => {
  const cat = cargarCatalogo(COMPILADO);

  assert.deepEqual([...cat.ids], PY.ids);
  assert.deepEqual([...cat.alimentoId], PY.alimentoId);

  // `nutr` y `vMacro` se comparan EXACTAMENTE, sin tolerancia: el volcado trae
  // los float32 de numpy ensanchados a double, y el constructor de Float32Array
  // redondea con el mismo modo. Si hiciera falta una tolerancia, es que uno de
  // los dos lados está haciendo la cuenta en otra precisión, y eso es
  // justamente lo que este test tiene que detectar.
  assert.deepEqual([...cat.nutr], PY.nutr);
  assert.deepEqual([...cat.vMacro], PY.vMacro);
  assert.deepEqual([...cat.escalaMin], PY.escalaMin);
  assert.deepEqual([...cat.escalaMax], PY.escalaMax);

  assert.deepEqual([...cat.conocido], PY.conocido);
  assert.deepEqual([...cat.tieneMacro], PY.tieneMacro);
  assert.deepEqual([...cat.mDieta], PY.mDieta);
  assert.deepEqual([...cat.mAlergeno], PY.mAlergeno);
  assert.deepEqual([...cat.mSlot], PY.mSlot);
  assert.deepEqual([...cat.minutos], PY.minutos);
  assert.deepEqual([...cat.nIngredientes], PY.nIngredientes);
  assert.deepEqual([...cat.costeCents], PY.costeCents);
  assert.deepEqual([...cat.costeConocido], PY.costeConocido);
});

test("los bitsets de alimentos son los uint64 del Python en palabras de 32 bits", () => {
  const cat = cargarCatalogo(COMPILADO);
  for (let i = 0; i < cat.n; i++) {
    const esperadas = PY.ingrBitsU32[i] ?? [];
    const perec = PY.ingrPerecBitsU32[i] ?? [];
    for (let k = 0; k < cat.w32; k++) {
      assert.equal(cat.ingrBits[i * cat.w32 + k], esperadas[k], `ingrBits[${i}][${k}]`);
      assert.equal(cat.ingrPerecBits[i * cat.w32 + k], perec[k], `ingrPerecBits[${i}][${k}]`);
    }
    // La palabra justo después de las que TS usa (índice cat.w32) tiene que
    // estar vacía; si no, w32 estaría perdiendo alimentos en silencio.
    assert.equal(esperadas[cat.w32] ?? 0, 0, `la fila ${i} usa bits por encima de w32`);
  }
});

test("los índices inversos resuelven recetas y alimentos a su fila y a su bit", () => {
  const cat = cargarCatalogo(COMPILADO);
  assert.equal(cat.idxPorId.size, cat.n);
  assert.equal(cat.alimentoIdx.size, cat.nAlimentos);
  for (let i = 0; i < cat.n; i++) assert.equal(cat.idxPorId.get(cat.ids[i] ?? ""), i);
  for (let b = 0; b < cat.nAlimentos; b++) {
    assert.equal(cat.alimentoIdx.get(cat.alimentoId[b] ?? ""), b);
  }
  assert.equal(cat.idxPorId.get("no_existe_esta_receta"), undefined);
});

// ---------------------------------------------------------------------------
// El vocabulario: la defensa contra el fallo más caro del port
// ---------------------------------------------------------------------------

test("lanza si una de las cuatro tuplas del vocabulario no es la de constantes.ts", () => {
  // Reordenar, no cambiar: dos alérgenos intercambiados siguen siendo los mismos
  // catorce nombres y el catálogo se cargaría sin una sola queja. Lo que cambia
  // es a qué bit corresponde cada uno, es decir, a quién se le sirve gluten.
  const conAlergenosGirados = copiaCompilado();
  const alergenos = [...ALERGENOS];
  conAlergenosGirados.vocabulario.alergenos = [alergenos[1] ?? "", alergenos[0] ?? ""].concat(
    alergenos.slice(2),
  );
  exigeFallo(conAlergenosGirados, "alergenos");

  const conSlotsGirados = copiaCompilado();
  conSlotsGirados.vocabulario.slots = [...SLOTS].reverse();
  exigeFallo(conSlotsGirados, "slots");

  const conNutrientesGirados = copiaCompilado();
  conNutrientesGirados.vocabulario.nutrientes = [...NUTRIENTES].reverse();
  exigeFallo(conNutrientesGirados, "nutrientes");

  const conDietaDeMenos = copiaCompilado();
  conDietaDeMenos.vocabulario.dietas = [...DIETAS].slice(0, -1);
  exigeFallo(conDietaDeMenos, "dietas");
});

test("lanza si el catálogo se compiló sin el bloque vocabulario", () => {
  const sinBloque = copiaCompilado() as Partial<CatalogoSerializado>;
  delete sinBloque.vocabulario;
  exigeFallo(sinBloque as CatalogoSerializado, "vocabulario");
});

test("el catálogo del repositorio trae el vocabulario vigente", () => {
  // El complemento del test anterior: si esto falla, alguien tocó una tupla de
  // constantes.ts y no recompiló el catálogo.
  assert.deepEqual(COMPILADO.vocabulario.nutrientes, [...NUTRIENTES]);
  assert.deepEqual(COMPILADO.vocabulario.dietas, [...DIETAS]);
  assert.deepEqual(COMPILADO.vocabulario.alergenos, [...ALERGENOS]);
  assert.deepEqual(COMPILADO.vocabulario.slots, [...SLOTS]);
});

// ---------------------------------------------------------------------------
// Lo demás que se corrompería en silencio
// ---------------------------------------------------------------------------

test("lanza si una columna no tiene la longitud que anuncian n y w32", () => {
  const cortada = copiaCompilado();
  cortada.nutr = cortada.nutr.slice(0, -NUTRIENTES.length);
  exigeFallo(cortada, "nutr");

  const bitsCortos = copiaCompilado();
  bitsCortos.ingrBits = bitsCortos.ingrBits.slice(0, -1);
  exigeFallo(bitsCortos, "ingrBits");
});

test("lanza si w32 no es el que corresponde a nAlimentos", () => {
  // El caso real: se añade un alimento que cruza el múltiplo de 32 y alguien
  // regenera sólo la mitad de los ficheros. Leer los bits con la anchura
  // equivocada desplaza las filas y cada receta hereda los ingredientes de otra.
  const desalineado = copiaCompilado();
  desalineado.w32 = 2;
  exigeFallo(desalineado, "w32");
});

test("lanza si hay ids de receta duplicados", () => {
  const duplicado = copiaCompilado();
  duplicado.ids[1] = duplicado.ids[0] ?? "";
  exigeFallo(duplicado, "duplicados");
});

test("lanza si un id no es ASCII", () => {
  // Los ids desempatan el top-K y se ordenan por code point en dos runtimes
  // distintos. Restringirlos a ASCII es lo que hace que V8 y CPython coincidan
  // por construcción y no por suerte.
  const conTilde = copiaCompilado();
  conTilde.ids[0] = "avena_con_arándanos";
  exigeFallo(conTilde, "ASCII");
});

test("lanza si una máscara trae bits por encima de su tupla", () => {
  // El bit 14 de `mAlergeno` no cabe en ALERGENOS. Sin esta comprobación se
  // colaría entero en el Uint16Array (que tiene 16 bits) y el filtro duro
  // compararía contra un alérgeno que no existe.
  const alergenoFantasma = copiaCompilado();
  alergenoFantasma.mAlergeno[0] = 1 << ALERGENOS.length;
  exigeFallo(alergenoFantasma, "mAlergeno");

  const dietaFantasma = copiaCompilado();
  dietaFantasma.mDieta[3] = 1 << DIETAS.length;
  exigeFallo(dietaFantasma, "mDieta");

  const slotFantasma = copiaCompilado();
  slotFantasma.mSlot[5] = 1 << SLOTS.length;
  exigeFallo(slotFantasma, "mSlot");
});

test("lanza si unos minutos no caben en int16", () => {
  // 40000 minutos entran en un Int16Array como −25536, que es ≤ que cualquier
  // tope: la receta pasaría el filtro de tiempo de TODOS los slots.
  const eterna = copiaCompilado();
  eterna.minutos[0] = 40000;
  exigeFallo(eterna, "minutos");
});

test("lanza si un booleano del catálogo no es 0 ni 1", () => {
  const conocidoRaro = copiaCompilado();
  conocidoRaro.conocido[4] = 256; // se truncaría a 0: «sí» convertido en «no lo sé»
  exigeFallo(conocidoRaro, "conocido");
});

test("lanza si falta la versión, que es la clave de caché del pool", () => {
  const sinVersion = copiaCompilado();
  sinVersion.version = "";
  exigeFallo(sinVersion, "version");
});

// ---------------------------------------------------------------------------
// Transferencia al worker
// ---------------------------------------------------------------------------

test("transferibles entrega los quince buffers y transferirlos desacopla el origen", () => {
  const cat = cargarCatalogo(COMPILADO);
  const buffers = transferibles(cat);
  assert.equal(buffers.length, 15);
  assert.equal(new Set(buffers).size, 15, "cada matriz debe tener su propio buffer");

  const bytesAntes = cat.nutr.length;
  assert.ok(bytesAntes > 0);

  // El transfer real que hace el worker. Lo que se comprueba no es sólo que la
  // copia llega entera, sino que el original queda inservible: es el precio de
  // no copiar 4 KB, y quien llame a `transferibles` tiene que saberlo.
  const copia = structuredClone(cat, { transfer: buffers });
  assert.equal(copia.n, cat.n);
  assert.deepEqual([...copia.ids], PY.ids);
  assert.equal(copia.idxPorId.get(PY.ids[0] ?? ""), 0);
  assert.deepEqual([...copia.nutr], PY.nutr);
  assert.equal(cat.nutr.length, 0, "el catálogo de origen debe quedar desacoplado");
});
