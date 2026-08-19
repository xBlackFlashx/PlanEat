/**
 * Verificación del compilador del catálogo contra el Python de origen.
 *
 * `pruebas/datos/referencia-python-catalogo.json` es un volcado literal de
 * `cargar_catalogo()` (services/solver/app/catalogo.py) generado con el mismo
 * catalogo.jsonl. Comparar contra él, y no contra valores escritos a mano, es lo
 * único que demuestra que el motor del navegador arranca desde exactamente los
 * mismos números que el backend: cualquier deriva en el orden del vocabulario de
 * alimentos o en el float32 de `vMacro` cambiaría los planes sin dar ningún
 * síntoma. El test no necesita Python; para regenerar el volcado, sí:
 *
 *   cd services/solver && source .venv/bin/activate
 *   python scripts/volcar_referencia_catalogo.py
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ALERGENOS, DIETAS, NUTRIENTES, SLOTS } from "../src/constantes.ts";
import type {
  CatalogoSerializado,
  PorcionesRecetas,
  VistaRecetas,
} from "../herramientas/compilar-catalogo.ts";
import { compilar, porcionesDeReceta, vistaDeRecetas } from "../herramientas/compilar-catalogo.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIR_DATOS_SOLVER = resolve(AQUI, "../../../services/solver/data");
const DIR_SALIDA = resolve(AQUI, "../datos");

interface ReferenciaPython {
  version: string;
  n: number;
  nAlimentos: number;
  alimentoId: string[];
  ids: string[];
  nutr: number[];
  conocido: number[];
  vMacro: number[];
  tieneMacro: number[];
  escalaMin: number[];
  escalaMax: number[];
  mDieta: number[];
  mAlergenoPalabras: number[][];
  mSlot: number[];
  minutos: number[];
  nIngredientes: number[];
  costeCents: number[];
  costeConocido: number[];
  ingrBitsU32: number[][];
  ingrPerecBitsU32: number[][];
  vocabulario: { nutrientes: string[]; dietas: string[]; alergenos: string[]; slots: string[] };
}

const JSONL = readFileSync(resolve(DIR_DATOS_SOLVER, "catalogo.jsonl"), "utf8");
const INGREDIENTES: unknown = JSON.parse(
  readFileSync(resolve(DIR_DATOS_SOLVER, "ingredientes.json"), "utf8"),
);
const IMAGENES: unknown = JSON.parse(
  readFileSync(resolve(DIR_DATOS_SOLVER, "imagenes.json"), "utf8"),
);
const REF = JSON.parse(
  readFileSync(resolve(AQUI, "datos/referencia-python-catalogo.json"), "utf8"),
) as ReferenciaPython;
const RECETAS_JSON: unknown = JSON.parse(
  readFileSync(resolve(DIR_DATOS_SOLVER, "recetas.json"), "utf8"),
);

const CAT: CatalogoSerializado = compilar(JSONL, INGREDIENTES);
const VISTA: VistaRecetas = vistaDeRecetas(
  JSONL,
  INGREDIENTES,
  RECETAS_JSON,
  CAT.version,
  IMAGENES,
);

/**
 * Lo que el motor verá de verdad. El JSON lleva el número tal cual está en el
 * fichero fuente; el redondeo a float32 ocurre al volcarlo al typed array, y es
 * ahí donde tiene que coincidir con numpy, no antes.
 */
function comoFloat32(v: readonly number[]): number[] {
  return [...Float32Array.from(v)];
}

function en<T>(v: readonly T[], i: number): T {
  const x = v[i];
  assert.notEqual(x, undefined, `índice ${i} fuera de rango`);
  return x as T;
}

// --------------------------------------------------------------------------
// Paridad con cargar_catalogo()
// --------------------------------------------------------------------------

test("la version es el sha256 del jsonl truncado, igual que catalogo.py", () => {
  assert.equal(CAT.version, REF.version);
  assert.equal(CAT.version.length, 16);
});

test("el numero de recetas y sus ids coinciden con el catalogo de Python", () => {
  assert.equal(CAT.n, REF.n);
  assert.deepEqual(CAT.ids, REF.ids);
});

test("el vocabulario de alimentos coincide en contenido y en orden con el sorted() de Python", () => {
  // El orden ES el contrato: define qué bit ocupa cada alimento en los bitsets.
  assert.equal(CAT.nAlimentos, REF.nAlimentos);
  assert.deepEqual(CAT.alimentoId, REF.alimentoId);
});

test("el vocabulario de alimentos son solo los alimentos citados por alguna receta", () => {
  // 66 presentes en el jsonl, no los 73 de ingredientes.json: incluir los que
  // nadie usa desplazaría todos los bits siguientes.
  const citados = new Set<string>();
  for (const linea of JSONL.split("\n")) {
    if (linea.trim() === "") continue;
    const fila = JSON.parse(linea) as { ingredientes: string[] };
    for (const a of fila.ingredientes) citados.add(a);
  }
  assert.equal(CAT.alimentoId.length, citados.size);
});

test("los valores nutricionales coinciden bit a bit al pasarlos a float32", () => {
  assert.deepEqual(comoFloat32(CAT.nutr), REF.nutr);
});

test("la mascara de nutriente conocido coincide con la de Python", () => {
  assert.deepEqual(CAT.conocido, REF.conocido);
});

test("vMacro coincide bit a bit con el float32 de numpy", () => {
  // Es la comprobación más delicada del compilador: numpy hace toda la cuenta
  // de Atwater en float32 y aquí se replica con Math.fround paso a paso.
  assert.deepEqual(comoFloat32(CAT.vMacro), REF.vMacro);
  assert.deepEqual(CAT.tieneMacro, REF.tieneMacro);
});

test("vMacro tiene norma L2 uno en toda receta con macros", () => {
  for (let i = 0; i < CAT.n; i++) {
    if (en(CAT.tieneMacro, i) === 0) continue;
    const p = en(CAT.vMacro, i * 3);
    const c = en(CAT.vMacro, i * 3 + 1);
    const g = en(CAT.vMacro, i * 3 + 2);
    assert.ok(
      Math.abs(Math.sqrt(p * p + c * c + g * g) - 1) < 1e-6,
      `la fila ${i} no está normalizada`,
    );
  }
});

test("las escalas, los minutos y el coste coinciden con los del catalogo de Python", () => {
  assert.deepEqual(comoFloat32(CAT.escalaMin), REF.escalaMin);
  assert.deepEqual(comoFloat32(CAT.escalaMax), REF.escalaMax);
  assert.deepEqual(CAT.minutos, REF.minutos);
  assert.deepEqual(CAT.nIngredientes, REF.nIngredientes);
  assert.deepEqual(CAT.costeCents, REF.costeCents);
  assert.deepEqual(CAT.costeConocido, REF.costeConocido);
});

test("las mascaras colapsadas reproducen las columnas booleanas de Python", () => {
  assert.deepEqual(CAT.mDieta, REF.mDieta);
  assert.deepEqual(CAT.mSlot, REF.mSlot);
});

test("mAlergeno reproduce las columnas booleanas de Python en palabras de 32 bits", () => {
  // A diferencia de mDieta/mSlot, mAlergeno ya no es un entero por fila
  // (ALERGENOS.length puede pasar de 32 — 2026-08-19: ya van 25): mismo
  // esquema multi-palabra que ingrBits, con ancho fijo W_ALERGENO en vez de
  // w32 (que depende del catálogo).
  const wAlergeno = Math.max(1, Math.ceil(ALERGENOS.length / 32));
  for (let i = 0; i < CAT.n; i++) {
    const esperado = en(REF.mAlergenoPalabras, i);
    for (let w = 0; w < wAlergeno; w++) {
      const propio = en(CAT.mAlergeno, i * wAlergeno + w);
      assert.equal(propio, esperado[w] ?? 0, `mAlergeno[${i}][${w}]`);
    }
    // Ninguna palabra más allá de wAlergeno del lado de Python: si la hubiera,
    // wAlergeno estaría perdiendo alérgenos en silencio.
    assert.equal(esperado[wAlergeno] ?? 0, 0, `la fila ${i} usa bits por encima de W_ALERGENO`);
  }
});

test("los bitsets de 32 bits reproducen los uint64 de Python", () => {
  // Python usa palabras de 64 bits y aquí son de 32: la palabra baja va primero.
  // Las palabras que sobran del lado de Python tienen que ser cero, o el
  // dimensionado con ceil(nAlimentos/32) estaría perdiendo alimentos.
  assert.equal(CAT.w32, Math.ceil(REF.nAlimentos / 32));
  for (let i = 0; i < CAT.n; i++) {
    const esperadoIngr = en(REF.ingrBitsU32, i);
    const esperadoPerec = en(REF.ingrPerecBitsU32, i);
    for (let w = 0; w < esperadoIngr.length; w++) {
      const propioIngr = w < CAT.w32 ? en(CAT.ingrBits, i * CAT.w32 + w) : 0;
      const propioPerec = w < CAT.w32 ? en(CAT.ingrPerecBits, i * CAT.w32 + w) : 0;
      assert.equal(propioIngr, en(esperadoIngr, w), `ingrBits[${i}][${w}]`);
      assert.equal(propioPerec, en(esperadoPerec, w), `ingrPerecBits[${i}][${w}]`);
    }
  }
});

test("ninguna palabra del bitset sale negativa al JSON", () => {
  // `1 << 31` es negativo en JS. Un Uint32Array lo leería igual, pero el fichero
  // dejaría de ser comparable con el volcado de Python y de ser legible.
  for (const w of CAT.ingrBits) assert.ok(w >= 0 && w <= 0xffffffff, `palabra fuera de rango: ${w}`);
  for (const w of CAT.ingrPerecBits) assert.ok(w >= 0 && w <= 0xffffffff);
  for (const w of CAT.mAlergeno) assert.ok(w >= 0 && w <= 0xffffffff, `palabra de mAlergeno fuera de rango: ${w}`);
});

test("el bloque vocabulario son las cuatro tuplas de constantes.ts", () => {
  assert.deepEqual(CAT.vocabulario.nutrientes, [...NUTRIENTES]);
  assert.deepEqual(CAT.vocabulario.dietas, [...DIETAS]);
  assert.deepEqual(CAT.vocabulario.alergenos, [...ALERGENOS]);
  assert.deepEqual(CAT.vocabulario.slots, [...SLOTS]);
  assert.deepEqual(CAT.vocabulario, REF.vocabulario);
});

// --------------------------------------------------------------------------
// Invariantes propias del compilador
// --------------------------------------------------------------------------

test("compilar dos veces la misma entrada da exactamente la misma salida", () => {
  assert.deepEqual(compilar(JSONL, INGREDIENTES), CAT);
});

test("el catalogo compilado que hay en el repositorio esta al dia", () => {
  const enDisco = JSON.parse(
    readFileSync(resolve(DIR_SALIDA, "catalogo-compilado.json"), "utf8"),
  ) as CatalogoSerializado;
  assert.deepEqual(enDisco, CAT);
});

test("todos los arrays columnares tienen la longitud que impone n", () => {
  // El invariante maestro: la fila i es la misma receta en todos los arrays.
  assert.equal(CAT.ids.length, CAT.n);
  assert.equal(CAT.nutr.length, CAT.n * NUTRIENTES.length);
  assert.equal(CAT.conocido.length, CAT.n * NUTRIENTES.length);
  assert.equal(CAT.vMacro.length, CAT.n * 3);
  assert.equal(CAT.ingrBits.length, CAT.n * CAT.w32);
  assert.equal(CAT.ingrPerecBits.length, CAT.n * CAT.w32);
  assert.equal(CAT.mAlergeno.length, CAT.n * Math.max(1, Math.ceil(ALERGENOS.length / 32)));
  for (const columna of [
    CAT.tieneMacro,
    CAT.escalaMin,
    CAT.escalaMax,
    CAT.mDieta,
    CAT.mSlot,
    CAT.minutos,
    CAT.nIngredientes,
    CAT.costeCents,
    CAT.costeConocido,
  ]) {
    assert.equal(columna.length, CAT.n);
  }
});

test("un id de receta duplicado detiene la compilacion", () => {
  const primera = JSONL.split("\n")[0] ?? "";
  assert.throws(() => compilar(`${primera}\n${primera}\n`, INGREDIENTES), /duplicados/);
});

test("un id que no es ASCII detiene la compilacion", () => {
  const primera = JSON.parse(en(JSONL.split("\n"), 0)) as Record<string, unknown>;
  primera["id"] = "tortilla_española";
  assert.throws(() => compilar(`${JSON.stringify(primera)}\n`, INGREDIENTES), /ASCII/);
});

test("un alimento que no esta en ingredientes.json detiene la compilacion", () => {
  // La UI degradaría a enseñar el id crudo y nadie se enteraría en meses.
  const primera = JSON.parse(en(JSONL.split("\n"), 0)) as Record<string, unknown>;
  primera["ingredientes"] = ["alimento_que_no_existe"];
  assert.throws(
    () => compilar(`${JSON.stringify(primera)}\n`, INGREDIENTES),
    /no están en ingredientes.json/,
  );
});

test("un catalogo vacio detiene la compilacion", () => {
  assert.throws(() => compilar("\n  \n", INGREDIENTES), /vacío/);
});

// --------------------------------------------------------------------------
// Vista de presentación
// --------------------------------------------------------------------------

test("la vista tiene una entrada por receta, con los mismos ids que el catalogo", () => {
  assert.equal(VISTA.total, CAT.n);
  assert.deepEqual(Object.keys(VISTA.recetas).sort(), [...CAT.ids].sort());
  assert.equal(VISTA.version, CAT.version);
});

test("la vista resuelve los ingredientes a nombres legibles con su cantidad", () => {
  const receta = VISTA.recetas["avena_yogur_arandanos"];
  assert.notEqual(receta, undefined);
  assert.deepEqual(receta?.ingredientes, [
    { nombre: "Arándanos", cantidad: "un puñado · 70 g" },
    { nombre: "Copos de avena", cantidad: "5 cdas · 50 g" },
    { nombre: "Miel", cantidad: "1 cdta · 8 g" },
    { nombre: "Yogur griego natural", cantidad: "150 g" },
  ]);
  assert.equal(receta?.titulo, "Avena con yogur griego y arándanos");
});

test("la vista trae los pasos de elaboración de recetas.json", () => {
  const receta = VISTA.recetas["avena_yogur_arandanos"];
  assert.deepEqual(receta?.pasos, [
    "Mezcla la avena con el yogur en un bol.",
    "Deja reposar 5 minutos para que la avena ablande.",
    "Añade los arándanos por encima y riega con la miel.",
  ]);
});

test("ninguna receta de la vista se queda sin pasos", () => {
  // 240/240 recetas traen `pasos` en recetas.json: si alguna aparece vacía es
  // que el lookup por id se rompió, no que al catálogo le falte el dato.
  for (const receta of Object.values(VISTA.recetas)) {
    assert.ok(receta.pasos.length > 0, `${receta.id} no tiene pasos`);
  }
});

test("la vista no enseña coste cuando el precio no se conoce", () => {
  // Regla de producto: en una app de presupuesto, un precio inventado es peor
  // que un hueco. Es lo que ya hace apps/web/src/lib/catalogo.ts.
  for (const receta of Object.values(VISTA.recetas)) {
    if (receta.costeCents !== null) assert.ok(receta.costeCents >= 0);
  }
  const primera = JSON.parse(en(JSONL.split("\n"), 0)) as Record<string, unknown>;
  primera["costeConocido"] = false;
  primera["costeCents"] = 999;
  const vista = vistaDeRecetas(
    `${JSON.stringify(primera)}\n`,
    INGREDIENTES,
    RECETAS_JSON,
    "x",
  );
  assert.equal(vista.recetas[String(primera["id"])]?.costeCents, null);
});

test("el panel por racion de la vista es el mismo que la fila del catalogo columnar", () => {
  for (let i = 0; i < CAT.n; i++) {
    const receta = VISTA.recetas[en(CAT.ids, i)];
    assert.notEqual(receta, undefined, `falta la receta ${en(CAT.ids, i)} en la vista`);
    if (receta === undefined) continue;
    assert.equal(receta.porRacion.kcal, en(CAT.nutr, i * NUTRIENTES.length));
    assert.equal(receta.porRacion.proteinaG, en(CAT.nutr, i * NUTRIENTES.length + 1));
    assert.equal(receta.porRacion.sodioMg, en(CAT.nutr, i * NUTRIENTES.length + 5));
    assert.equal(receta.minutos, en(CAT.minutos, i));
  }
});

test("la vista del repositorio esta al dia", () => {
  const enDisco = JSON.parse(
    readFileSync(resolve(DIR_SALIDA, "recetas-vista.json"), "utf8"),
  ) as VistaRecetas;
  assert.deepEqual(enDisco, VISTA);
});

// --------------------------------------------------------------------------
// Porciones (lista de la compra del plan Pro)
// --------------------------------------------------------------------------

const PORCIONES: PorcionesRecetas = porcionesDeReceta(RECETAS_JSON, INGREDIENTES, CAT.version);

test("las porciones tienen una entrada por receta, con los mismos ids que el catalogo", () => {
  assert.deepEqual(Object.keys(PORCIONES.recetas).sort(), [...CAT.ids].sort());
  assert.equal(PORCIONES.version, CAT.version);
});

test("las porciones llevan los gramos crudos de recetas.json, sin dividir por racion", () => {
  const receta = PORCIONES.recetas["avena_yogur_arandanos"];
  assert.notEqual(receta, undefined);
  assert.equal(receta?.racionesBase, 1);
  assert.deepEqual(
    receta?.ingredientes.map((i) => [i.alimentoId, i.gramos]).sort(),
    [
      ["arandanos", 70],
      ["avena_copos", 50],
      ["miel", 8],
      ["yogur_griego", 150],
    ].sort(),
  );
});

test("las porciones resuelven nombre y categoria contra ingredientes.json", () => {
  const receta = PORCIONES.recetas["avena_yogur_arandanos"];
  const yogur = receta?.ingredientes.find((i) => i.alimentoId === "yogur_griego");
  assert.equal(yogur?.nombre, "Yogur griego natural");
  assert.equal(yogur?.categoria, "lacteos");
});

test("las porciones del repositorio estan al dia", () => {
  const enDisco = JSON.parse(
    readFileSync(resolve(DIR_SALIDA, "receta-ingredientes.json"), "utf8"),
  ) as PorcionesRecetas;
  assert.deepEqual(enDisco, PORCIONES);
});
