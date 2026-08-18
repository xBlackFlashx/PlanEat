/**
 * Fallo honesto: la ablación, las cotas y los textos.
 *
 * Los números y las frases esperadas NO están escritos a mano: salen de
 * ejecutar el `diagnostico.py` real del backend sobre el mismo catálogo. Se
 * regeneran con el script que hay en la cabecera de cada bloque. Comparar
 * contra Python y no contra una cuenta propia es lo único que convierte este
 * fichero en una prueba: un texto de diagnóstico mal portado no da error, da
 * un usuario que lee un consejo falso y lo aplica.
 *
 * Tres tests de este fichero son BLOQUEANTES del build y no de calidad
 * (spec §11.3): los dos de seguridad —jamás relajar un alérgeno, jamás bajar
 * del suelo calórico— y el de las tres sugerencias distintas. Están escritos
 * como baterías sobre muchos escenarios a propósito: un test de seguridad que
 * sólo cubre el caso que ya se sabía peligroso no protege de nada, y así se
 * descubrió justamente que Python emitía «el mínimo baja a 571 kcal»
 * (DIVERGENCIAS.md D6).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { cargarCatalogo } from "../src/catalogo.ts";
import { KCAL_MINIMAS_ABSOLUTO, N_SUGERENCIAS } from "../src/constantes.ts";
import {
  ablacion,
  candidatosPorSlot,
  cotasAlcanzables,
  diagnosticarObjetivo,
  diagnosticarPool,
  macrosIncompatibles,
  mascarasRestriccion,
} from "../src/diagnostico.ts";
import { construirPool } from "../src/pool.ts";
import type {
  ObjetivoNutricional,
  Pool,
  RestriccionesGeneracion,
  SlotComida,
} from "../src/tipos.ts";
import type { CatalogoSerializado } from "../herramientas/compilar-catalogo.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const CAT = cargarCatalogo(
  JSON.parse(
    readFileSync(resolve(AQUI, "../datos/catalogo-compilado.json"), "utf8"),
  ) as CatalogoSerializado,
);

const S3: SlotComida[] = ["desayuno", "comida", "cena"];
const S5: SlotComida[] = ["desayuno", "almuerzo", "comida", "merienda", "cena"];

function restr(cambios: Partial<RestriccionesGeneracion> = {}): RestriccionesGeneracion {
  return {
    dieta: "omnivora",
    alergenosExcluidos: [],
    ingredientesExcluidos: [],
    slots: S3,
    comensales: 1,
    ...cambios,
  };
}

function objetivo(cambios: Partial<ObjetivoNutricional> = {}): ObjetivoNutricional {
  return {
    kcal: 2000,
    toleranciaKcal: 0.05,
    proteinaG: { min: 120, max: 160 },
    carbohidratoG: { min: 180, max: 250 },
    grasaG: { min: 55, max: 80 },
    fibraMinG: 20,
    ...cambios,
  };
}

/**
 * `cuotas_de` de `scoring.py`, reimplementado aquí porque `scoring.ts` es de
 * otro agente del port y este fichero no puede depender de que ya exista. Los
 * valores están congelados contra el Python en el primer test del bloque de
 * cotas, así que si el port real acaba difiriendo, se ve.
 */
const PESO_SLOT: Readonly<Record<SlotComida, number>> = {
  desayuno: 0.22,
  almuerzo: 0.1,
  comida: 0.35,
  merienda: 0.1,
  cena: 0.28,
};
function cuotasDe(slots: readonly SlotComida[]): Record<SlotComida, number> {
  let total = 0;
  for (const s of slots) total += PESO_SLOT[s];
  const salida = {} as Record<SlotComida, number>;
  for (const s of slots) salida[s] = PESO_SLOT[s] / total;
  return salida;
}

function poolDe(r: RestriccionesGeneracion): Pool {
  return construirPool(CAT, r);
}

// ---------------------------------------------------------------------------
// Fase 1 — máscaras y ablación
//
// Referencia:
//   cd services/solver && ./.venv/bin/python - <<'PY'
//   from app.catalogo import cargar_catalogo
//   from app.schemas import RestriccionesGeneracion
//   from app.solver.diagnostico import ablacion, mascaras_restriccion
//   cat = cargar_catalogo()
//   S3 = ["desayuno","comida","cena"]
//   r = RestriccionesGeneracion(dieta="vegana", alergenosExcluidos=["gluten"],
//       slots=S3, minutosMaxPorSlot={"desayuno": 10})
//   m = mascaras_restriccion(cat, r, S3); print(list(m), ablacion(m))
//   PY
// ---------------------------------------------------------------------------

test("las máscaras salen en el orden canónico, que es el desempate de la ablación", () => {
  const r = restr({
    dieta: "vegana",
    alergenosExcluidos: ["gluten"],
    minutosMaxPorSlot: { desayuno: 10 },
  });
  assert.deepEqual(
    [...mascarasRestriccion(CAT, r, S3).keys()],
    ["dieta", "alergeno:gluten", "tiempo:desayuno", "slots"],
  );
});

test("los alérgenos entran en el orden de ALERGENOS, no en el que los pida el usuario", () => {
  // El usuario los manda desordenados; el mapa los ordena por vocabulario
  // porque ese orden es el desempate de la ablación (constantes.ts, ALERGENOS).
  const r = restr({ alergenosExcluidos: ["soja", "gluten", "huevos"] });
  assert.deepEqual(
    [...mascarasRestriccion(CAT, r, S3).keys()],
    ["dieta", "alergeno:gluten", "alergeno:huevos", "alergeno:soja", "slots"],
  );
});

test("un tope de tiempo sin límite no genera eje: no hay nada que relajar", () => {
  // `topesPorSlot` rellena los cinco slots con SIN_LIMITE_MINUTOS; si eso
  // produjera un eje `tiempo:*`, el diagnóstico sugeriría subir un tope que el
  // usuario no ha puesto.
  const claves = [...mascarasRestriccion(CAT, restr(), S3).keys()];
  assert.ok(!claves.some((k) => k.startsWith("tiempo:")));
});

test("la ablación cuantifica cada eje contra el mismo p0 que Python", () => {
  const r = restr({
    dieta: "vegana",
    alergenosExcluidos: ["gluten"],
    minutosMaxPorSlot: { desayuno: 10 },
  });
  const { p0, ganancia } = ablacion(mascarasRestriccion(CAT, r, S3), CAT.n);
  assert.equal(p0, 11);
  assert.deepEqual(Object.fromEntries(ganancia), {
    dieta: 19,
    "alergeno:gluten": 13,
    "tiempo:desayuno": 30,
    slots: 7,
  });
});

test("quitar el único eje deja el catálogo entero, no el primer array que se pase", () => {
  // Es el caso `base = todas[0].shape[0]` de Python: con una sola máscara, el
  // «pool sin ella» es N. Un port que devolviera 0 aquí diría que relajar la
  // dieta no aporta nada.
  const m = new Map([["dieta", new Uint8Array([1, 0, 1, 0, 0])]]);
  const { p0, ganancia } = ablacion(m, 5);
  assert.equal(p0, 2);
  assert.equal(ganancia.get("dieta"), 3);
});

test("sin máscaras la ablación no inventa un pool", () => {
  const { p0, ganancia } = ablacion(new Map(), CAT.n);
  assert.equal(p0, 0);
  assert.equal(ganancia.size, 0);
});

test("ninguna ganancia es negativa: quitar una restricción nunca resta recetas", () => {
  const r = restr({
    dieta: "vegana",
    alergenosExcluidos: ["gluten", "lacteos"],
    ingredientesExcluidos: ["huevo", "avena_copos"],
    slots: S5,
    minutosMaxPorSlot: { desayuno: 10, cena: 20 },
  });
  const { ganancia } = ablacion(mascarasRestriccion(CAT, r, S5), CAT.n);
  for (const [clave, g] of ganancia) assert.ok(g >= 0, `${clave} = ${g}`);
});

// ---------------------------------------------------------------------------
// Fase 1 — atribución de culpa y textos
// ---------------------------------------------------------------------------

test("la dieta culpable se nombra con su nombre legible y con el p0 de la ablación", () => {
  const r = restr({ dieta: "vegana", slots: S5 });
  const f = diagnosticarPool(CAT, r, S5, poolDe(r).p, {}, 8);
  assert.equal(f.restriccionCulpable, "dieta");
  assert.equal(
    f.mensaje,
    "La dieta vegana deja 73 recetas para 5 comidas al día, y no me da para un plan variado.",
  );
  assert.equal(f.recetasCandidatas, 73);
  assert.deepEqual(f.sugerencias, [
    "Ampliar la dieta más allá de «vegana» (+167 recetas)",
    "Planificar 4 comidas al día en vez de 5",
    "Avisarte en cuanto el catálogo tenga más recetas que te encajen",
  ]);
});

test("un alérgeno puede ser el culpable y decirse por su nombre", () => {
  // Que el alérgeno aparezca en `restriccionCulpable` y en el mensaje es
  // DELIBERADO: el usuario merece saber por qué su pool es pequeño. Lo que no
  // puede es aparecer entre las sugerencias, y ahí está el test de seguridad.
  const r = restr({
    alergenosExcluidos: [
      "gluten",
      "lacteos",
      "huevos",
      "pescado",
      "soja",
      "frutos_de_cascara",
      "sesamo",
      "crustaceos",
      "moluscos",
    ],
  });
  const f = diagnosticarPool(CAT, r, S3, poolDe(r).p, {}, 3);
  assert.equal(f.restriccionCulpable, "alergeno:gluten");
  assert.equal(
    f.mensaje,
    "Excluir gluten deja 58 recetas. Mantenemos la exclusión: la seguridad va primero.",
  );
});

test("el tope de tiempo culpable propone diez minutos más y cuánto abren", () => {
  const r = restr({ minutosMaxPorSlot: { desayuno: 3, comida: 5, cena: 5 } });
  const f = diagnosticarPool(CAT, r, S3, poolDe(r).p, {}, 3);
  assert.equal(f.restriccionCulpable, "tiempo:desayuno");
  assert.equal(f.mensaje, "Con 3 min para el desayuno sólo quedan 5 recetas.");
  assert.deepEqual(f.sugerencias, [
    "Subir el tiempo del desayuno de 3 a 13 min (+24 recetas)",
    "Elegir otras comidas del día (+20 recetas)",
    "Planificar 2 comidas al día en vez de 3",
  ]);
});

test("un pool vacío por ingredientes excluidos se explica y se cuantifica", () => {
  const r = restr({ ingredientesExcluidos: [...CAT.alimentoId] });
  const pool = poolDe(r);
  assert.equal(pool.p, 0);
  const f = diagnosticarPool(CAT, r, S3, pool.p, {}, 3);
  assert.equal(f.restriccionCulpable, "ingredientes_excluidos");
  assert.equal(
    f.mensaje,
    "Tus 121 ingredientes excluidos dejan fuera 211 recetas y me quedo con 0.",
  );
  assert.equal(f.recetasCandidatas, 0);
  assert.deepEqual(f.sugerencias, [
    "Revisar tus 121 ingredientes excluidos (+211 recetas)",
    "Planificar 2 comidas al día en vez de 3",
    "Avisarte en cuanto el catálogo tenga más recetas que te encajen",
  ]);
});

test("con dos slots no se ofrece quitar una comida", () => {
  // El relleno «Planificar N-1 comidas» sólo existe con más de dos slots:
  // proponer un día de una sola comida no es una sugerencia, es otra cosa.
  const dos: SlotComida[] = ["comida", "cena"];
  const r = restr({ dieta: "vegana", slots: dos });
  const f = diagnosticarPool(CAT, r, dos, poolDe(r).p, {}, 3);
  assert.deepEqual(f.sugerencias, [
    "Ampliar la dieta más allá de «vegana» (+111 recetas)",
    "Elegir otras comidas del día (+20 recetas)",
    "Avisarte en cuanto el catálogo tenga más recetas que te encajen",
  ]);
});

test("con slots flojos manda el slot, y se nombra el más flojo y más temprano", () => {
  const r = restr({ dieta: "vegana", slots: S5 });
  const f = diagnosticarPool(CAT, r, S5, poolDe(r).p, { desayuno: 2, cena: 2 }, 8);
  assert.equal(f.restriccionCulpable, "slot_sin_candidatos:desayuno");
  assert.equal(
    f.mensaje,
    "Sólo encuentro 2 recetas para el desayuno con tus filtros, y necesito al menos 8 " +
      "para armar el plan sin repetir.",
  );
});

test("un dict de slots flojos VACÍO no dispara la rama de slot_sin_candidatos", () => {
  // DIVERGENCIA D4: `motor.py:299` pasaba el recuento COMPLETO por slot, que
  // nunca está vacío, así que esta rama se disparaba siempre y escribía
  // mensajes falsos («Sólo encuentro 21 recetas… y necesito al menos 8»). Este
  // test fija que el contrato del sexto argumento es «los flojos», no «todos».
  //
  // El escenario es el del bug: catálogo entero, cinco slots y NINGÚN slot por
  // debajo del mínimo, que es exactamente el estado en el que `motor.py:299`
  // podía llegar aquí (ya había pasado la puerta 1).
  const r = restr({ slots: S5 });
  const pool = poolDe(r);
  const completo = candidatosPorSlot(pool, r, S5);
  assert.ok(
    Object.values(completo).every((c) => c >= 8),
    "el caso no probaría nada: algún slot sí está flojo",
  );

  const conTodos = diagnosticarPool(CAT, r, S5, pool.p, completo, 8);
  const conFlojos = diagnosticarPool(CAT, r, S5, pool.p, {}, 8);
  // Lo que veía el usuario: «Sólo encuentro 8 recetas… y necesito al menos 8».
  assert.equal(conTodos.restriccionCulpable, "slot_sin_candidatos:almuerzo");
  assert.ok(!conFlojos.restriccionCulpable.startsWith("slot_sin_candidatos"));
});

// ---------------------------------------------------------------------------
// Fase 2 — cotas y macros
// ---------------------------------------------------------------------------

test("candidatosPorSlot cuenta con el tope de tiempo DE CADA slot", () => {
  const r = restr({ slots: S5 });
  assert.deepEqual(candidatosPorSlot(poolDe(r), r, S5), {
    desayuno: 55,
    almuerzo: 48,
    comida: 150,
    merienda: 51,
    cena: 118,
  });
});

test("las cotas alcanzables coinciden con las de Python", () => {
  // Referencia: cotas_alcanzables(pool, restr, S5, cuotas_de(S5), 2000.0).
  // La tolerancia es 1e-9 relativa y no igualdad exacta porque numpy suma en
  // float32 en el mínimo de kcal·escala y aquí se replica con Math.fround: el
  // orden de sumación entre slots sigue siendo el mismo, pero no se promete
  // paridad de bits (port-typescript.md).
  const r = restr({ slots: S5 });
  const c = cotasAlcanzables(poolDe(r), r, S5, cuotasDe(S5), 2000);
  const esperado = {
    protMax: 382.55895552147314,
    fibraMax: 102.58664089091712,
    kcalMin: 296.60400390625,
    sodioMin: 11.460000276565552,
  };
  for (const [clave, v] of Object.entries(esperado)) {
    const propio = c[clave as keyof typeof esperado];
    assert.ok(
      Math.abs(propio - v) <= 1e-9 * Math.abs(v),
      `${clave}: ${propio} vs ${v}`,
    );
  }
});

test("un slot sin ninguna fila se salta y su cuota se pierde", () => {
  // Comportamiento replicado del Python, no una consecuencia accidental: la
  // cota resultante es la de un día con menos comidas. En el motor real este
  // caso ya lo ha atajado la puerta 1, pero la función es pública.
  const r = restr({ slots: S3, minutosMaxPorSlot: { desayuno: 1 } });
  const pool = poolDe(r);
  assert.equal(candidatosPorSlot(pool, r, S3).desayuno, 0);
  const con = cotasAlcanzables(pool, r, S3, cuotasDe(S3), 1600);
  const sin = cotasAlcanzables(pool, r, ["comida", "cena"], cuotasDe(S3), 1600);
  assert.equal(con.kcalMin, sin.kcalMin);
});

test("macrosIncompatibles detecta los dos lados y escribe los números con fmt0", () => {
  assert.deepEqual(macrosIncompatibles(objetivo()), { malo: false, motivo: "" });
  assert.deepEqual(
    macrosIncompatibles(
      objetivo({
        kcal: 800,
        toleranciaKcal: 0.01,
        proteinaG: { min: 90, max: 100 },
        carbohidratoG: { min: 20, max: 40 },
        grasaG: { min: 10, max: 20 },
      }),
    ),
    {
      malo: true,
      motivo: "Los máximos de macros que pides suman 740 kcal, menos de las 800 kcal del día.",
    },
  );
  assert.deepEqual(
    macrosIncompatibles(
      objetivo({
        kcal: 1500,
        proteinaG: { min: 200, max: 250 },
        carbohidratoG: { min: 250, max: 300 },
        grasaG: { min: 80, max: 100 },
      }),
    ),
    {
      malo: true,
      motivo: "Los mínimos de macros que pides suman 2520 kcal, más de las 1500 kcal del día.",
    },
  );
});

// ---------------------------------------------------------------------------
// Fase 2 — diagnóstico del objetivo
// ---------------------------------------------------------------------------

test("proteína contra energía: el número prometido sale del plan REAL, no de la cota", () => {
  // Es la regla de calidad del módulo: «si decimos que puedes llegar a 138 g,
  // es porque hay un plan con 138 g». Con `alcanzado` se promete 137 (floor de
  // 137,6); sin él se cae a la cota teórica, 317.
  //
  // El mínimo (antes 280 g) subió a 350 g al ampliar el catálogo: recetas
  // nuevas de alta densidad proteica empujaron `protMax` (la cota teórica de
  // §6.2) por encima de 280, y el fallo dejaba de caer en la rama
  // proteina_vs_kcal — comprobado contra el catálogo real. 350 g sigue por
  // encima de esa cota tras la segunda ampliación (240 recetas).
  const r = restr({ slots: S3 });
  const pool = poolDe(r);
  const obj = objetivo({
    kcal: 1600,
    proteinaG: { min: 350, max: 400 },
    carbohidratoG: { min: 0, max: 100 },
    grasaG: { min: 0, max: 45 },
    fibraMinG: 0,
  });
  const alcanzado = Float64Array.from([1580, 137.6, 90, 44, 21, 2100]);

  const conPlan = diagnosticarObjetivo(pool, CAT, r, S3, cuotasDe(S3), obj, alcanzado, pool.p);
  assert.equal(conPlan.restriccionCulpable, "proteina_vs_kcal");
  assert.equal(
    conPlan.mensaje,
    "No consigo llegar a 350 g de proteína con 1600 kcal y las 240 recetas que quedan " +
      "tras tus filtros. Lo más cerca que llego es 138 g.",
  );
  assert.deepEqual(conPlan.sugerencias, [
    "Bajar el mínimo de proteína a 137 g",
    "Subir a 1800 kcal al día",
    "Elegir otras comidas del día (+29 recetas)",
  ]);

  const sinPlan = diagnosticarObjetivo(pool, CAT, r, S3, cuotasDe(S3), obj, null, pool.p);
  assert.equal(sinPlan.sugerencias[0], "Bajar el mínimo de proteína a 317 g");
});

test("subir kcal sólo se ofrece si no dispara el objetivo más de un 25 %", () => {
  // 500 g con una densidad de 254/1600 exigirían ~3.150 kcal, casi el doble:
  // muy por encima del 25 %, así que la sugerencia no aparece.
  const r = restr({ slots: S3 });
  const pool = poolDe(r);
  const f = diagnosticarObjetivo(
    pool,
    CAT,
    r,
    S3,
    cuotasDe(S3),
    objetivo({
      kcal: 1600,
      proteinaG: { min: 500, max: 550 },
      carbohidratoG: { min: 0, max: 100 },
      grasaG: { min: 0, max: 45 },
      fibraMinG: 0,
    }),
    null,
    pool.p,
  );
  assert.ok(!f.sugerencias.some((s) => s.includes("kcal al día")));
});

test("cinco comidas para muy pocas kcal culpan al reparto, no a la proteína", () => {
  const r = restr({ slots: S5 });
  const pool = poolDe(r);
  const f = diagnosticarObjetivo(
    pool,
    CAT,
    r,
    S5,
    cuotasDe(S5),
    objetivo({
      kcal: 200,
      proteinaG: { min: 20, max: 40 },
      carbohidratoG: { min: 30, max: 60 },
      grasaG: { min: 8, max: 20 },
      fibraMinG: 0,
    }),
    null,
    pool.p,
  );
  assert.equal(f.restriccionCulpable, "kcal_insuficientes_para_slots");
  // El mínimo depende del catálogo (la combinación de 5 comidas más barata
  // que admite el motor): 297 kcal con el catálogo ampliado a 240 recetas. El
  // objetivo pedido (200) sólo tiene que quedar cómodamente por debajo, no
  // tocar un valor exacto.
  assert.equal(
    f.mensaje,
    "Con 5 comidas al día, lo mínimo que puedo servir son 297 kcal, y tú pides 200.",
  );
  // DIVERGENCIA D6: Python escribe aquí «el mínimo baja a 571 kcal», por debajo
  // del suelo de seguridad. Ver DIVERGENCIAS.md.
  assert.deepEqual(f.sugerencias, [
    "Quitar el almuerzo: es la comida que menos calorías aporta",
    "Subir a 1200 kcal al día",
    "Planificar 4 comidas al día en vez de 5",
  ]);
});

test("fibra y sodio se diagnostican con sus propios textos", () => {
  const r = restr({ slots: S3 });
  const pool = poolDe(r);
  const cuota = cuotasDe(S3);

  const fibra = diagnosticarObjetivo(
    pool,
    CAT,
    r,
    S3,
    cuota,
    objetivo({
      kcal: 1600,
      proteinaG: { min: 40, max: 160 },
      carbohidratoG: { min: 0, max: 250 },
      grasaG: { min: 0, max: 80 },
      fibraMinG: 300,
    }),
    Float64Array.from([1580, 100, 90, 44, 31.4, 2100]),
    pool.p,
  );
  assert.equal(fibra.restriccionCulpable, "fibra_inalcanzable");
  assert.equal(
    fibra.mensaje,
    "Con estas recetas no llego a 300 g de fibra; lo más alto que consigo son 31 g.",
  );
  assert.equal(fibra.sugerencias[0], "Bajar la fibra mínima a 31 g");

  const sodio = diagnosticarObjetivo(
    pool,
    CAT,
    r,
    S3,
    cuota,
    objetivo({
      kcal: 1600,
      proteinaG: { min: 40, max: 160 },
      carbohidratoG: { min: 0, max: 250 },
      grasaG: { min: 0, max: 80 },
      fibraMinG: 0,
      sodioMaxMg: 500,
    }),
    Float64Array.from([1580, 100, 90, 44, 21, 2137]),
    pool.p,
  );
  assert.equal(sodio.restriccionCulpable, "sodio_inalcanzable");
  assert.equal(
    sodio.mensaje,
    "No consigo bajar de 2137 mg de sodio con estas recetas, y tu tope son 500 mg.",
  );
  assert.equal(sodio.sugerencias[0], "Subir el tope de sodio a 2200 mg");
});

test("el sodio exige un 20 % de margen antes de declararse inalcanzable", () => {
  // Sin el margen, un plan que se pasa un 2 % del tope se anunciaría como
  // imposible. El sodio es el nutriente con los datos más flojos del catálogo.
  const r = restr({ slots: S3 });
  const pool = poolDe(r);
  const obj = objetivo({
    kcal: 1600,
    proteinaG: { min: 40, max: 160 },
    carbohidratoG: { min: 0, max: 250 },
    grasaG: { min: 0, max: 80 },
    fibraMinG: 0,
    sodioMaxMg: 2000,
  });
  const justo = diagnosticarObjetivo(
    pool,
    CAT,
    r,
    S3,
    cuotasDe(S3),
    obj,
    Float64Array.from([1580, 100, 90, 44, 21, 2300]),
    pool.p,
  );
  assert.notEqual(justo.restriccionCulpable, "sodio_inalcanzable");
  const pasado = diagnosticarObjetivo(
    pool,
    CAT,
    r,
    S3,
    cuotasDe(S3),
    obj,
    Float64Array.from([1580, 100, 90, 44, 21, 2500]),
    pool.p,
  );
  assert.equal(pasado.restriccionCulpable, "sodio_inalcanzable");
});

test("el genérico admite que no sabe por qué, pero dice hasta dónde ha llegado", () => {
  const r = restr({ slots: S3 });
  const pool = poolDe(r);
  const f = diagnosticarObjetivo(
    pool,
    CAT,
    r,
    S3,
    cuotasDe(S3),
    objetivo({
      kcal: 1600,
      proteinaG: { min: 40, max: 160 },
      carbohidratoG: { min: 0, max: 250 },
      grasaG: { min: 0, max: 80 },
      fibraMinG: 0,
    }),
    Float64Array.from([1234.5, 87.6, 90, 44, 21, 2100]),
    pool.p,
  );
  assert.equal(f.restriccionCulpable, "objetivo_inalcanzable_generico");
  assert.equal(
    f.mensaje,
    "No encuentro una combinación que cuadre con tus objetivos y las 240 recetas " +
      "disponibles. Lo más cerca que llego son 1234 kcal con 88 g de proteína.",
  );
  assert.deepEqual(f.sugerencias, [
    "Ampliar la tolerancia de calorías al 10 %",
    "Bajar el mínimo de proteína a 87 g",
    "Elegir otras comidas del día (+29 recetas)",
  ]);
});

test("sin plan alcanzado el genérico no promete ningún número", () => {
  // Aquí es donde Python repetía relleno: sus tres sugerencias salían
  // ["Elegir otras comidas…", "Escríbenos…", "Escríbenos…"]. Ver D5.
  const dos: SlotComida[] = ["comida", "cena"];
  const r = restr({ slots: dos });
  const pool = poolDe(r);
  const f = diagnosticarObjetivo(
    pool,
    CAT,
    r,
    dos,
    cuotasDe(dos),
    objetivo({
      kcal: 1600,
      proteinaG: { min: 40, max: 160 },
      carbohidratoG: { min: 0, max: 250 },
      grasaG: { min: 0, max: 80 },
      fibraMinG: 0,
    }),
    null,
    pool.p,
  );
  assert.equal(
    f.mensaje,
    "No encuentro una combinación que cuadre con tus objetivos y las 240 recetas disponibles.",
  );
  assert.equal(f.sugerencias[0], "Elegir otras comidas del día (+76 recetas)");
  assert.equal(new Set(f.sugerencias).size, 3);
});

// ---------------------------------------------------------------------------
// La batería de fallos que alimenta los tres tests bloqueantes
// ---------------------------------------------------------------------------

interface Caso {
  nombre: string;
  restr: RestriccionesGeneracion;
  slots: SlotComida[];
  fallo: { sugerencias: string[]; mensaje: string; restriccionCulpable: string };
}

/**
 * Todos los caminos de salida del módulo, de los dos diagnósticos, con y sin
 * plan alcanzado. Si mañana aparece una rama nueva y no se añade aquí, los tres
 * tests bloqueantes dejan de cubrirla en silencio: por eso el último test
 * comprueba que la batería toca todas las culpas conocidas.
 */
function bateria(): Caso[] {
  const casos: Caso[] = [];
  const push = (
    nombre: string,
    r: RestriccionesGeneracion,
    slots: SlotComida[],
    fallo: Caso["fallo"],
  ) => casos.push({ nombre, restr: r, slots, fallo });

  const combinaciones: Array<[string, RestriccionesGeneracion, SlotComida[]]> = [
    ["vegana_5", restr({ dieta: "vegana", slots: S5 }), S5],
    ["vegana_3", restr({ dieta: "vegana", slots: S3 }), S3],
    [
      "alergenos_4",
      restr({ alergenosExcluidos: ["gluten", "lacteos", "huevos", "pescado"], slots: S5 }),
      S5,
    ],
    [
      "alergenos_6",
      restr({
        alergenosExcluidos: [
          "gluten",
          "lacteos",
          "huevos",
          "pescado",
          "frutos_de_cascara",
          "soja",
        ],
        slots: S5,
      }),
      S5,
    ],
    ["alergenos_3", restr({ alergenosExcluidos: ["lacteos", "huevos", "gluten"], slots: S3 }), S3],
    [
      "todos_los_alergenos",
      restr({
        alergenosExcluidos: [
          "gluten",
          "crustaceos",
          "huevos",
          "pescado",
          "cacahuetes",
          "soja",
          "lacteos",
          "frutos_de_cascara",
          "apio",
          "mostaza",
          "sesamo",
          "sulfitos",
          "altramuces",
          "moluscos",
        ],
        slots: S3,
      }),
      S3,
    ],
    ["tiempo", restr({ slots: S3, minutosMaxPorSlot: { desayuno: 3, comida: 5, cena: 5 } }), S3],
    ["pool_vacio", restr({ slots: S3, ingredientesExcluidos: [...CAT.alimentoId] }), S3],
    ["dos_slots", restr({ dieta: "vegana", slots: ["comida", "cena"] }), ["comida", "cena"]],
    ["sin_filtros", restr({ slots: S3 }), S3],
  ];

  for (const [nombre, r, slots] of combinaciones) {
    const pool = poolDe(r);
    const completo = candidatosPorSlot(pool, r, slots);
    const flojos: Record<string, number> = {};
    for (const [s, c] of Object.entries(completo)) if (c < 8) flojos[s] = c;
    push(`pool:${nombre}:flojos`, r, slots, diagnosticarPool(CAT, r, slots, pool.p, flojos, 8));
    push(`pool:${nombre}:sin_flojos`, r, slots, diagnosticarPool(CAT, r, slots, pool.p, {}, 8));

    const objetivos: Array<[string, ObjetivoNutricional]> = [
      ["normal", objetivo()],
      [
        // kcal bajado de 400 a 250 al ampliar el catálogo: con más recetas
        // disponibles, el kcalMin alcanzable para 5 comidas bajó lo bastante
        // (~350) como para que 400 kcal dejara de ser «insuficiente para los
        // slots» — comprobado contra el catálogo real. Los macros se
        // reescalan junto con las kcal para no disparar antes la rama de
        // macrosIncompatibles.
        "kcal_bajas",
        objetivo({
          kcal: 250,
          proteinaG: { min: 12, max: 30 },
          carbohidratoG: { min: 18, max: 45 },
          grasaG: { min: 5, max: 15 },
          fibraMinG: 0,
        }),
      ],
      [
        "proteina_alta",
        objetivo({
          kcal: 1600,
          proteinaG: { min: 280, max: 330 },
          carbohidratoG: { min: 0, max: 100 },
          grasaG: { min: 0, max: 45 },
          fibraMinG: 0,
        }),
      ],
      ["fibra_alta", objetivo({ kcal: 1600, fibraMinG: 300 })],
      ["sodio_bajo", objetivo({ kcal: 1600, fibraMinG: 0, sodioMaxMg: 300 })],
    ];
    for (const [nombreObj, obj] of objetivos) {
      for (const [nombreAlc, alc] of [
        ["sin_plan", null],
        ["con_plan", Float64Array.from([1234.5, 87.6, 90, 44, 21.4, 2137])],
      ] as Array<[string, Float64Array | null]>) {
        push(
          `objetivo:${nombre}:${nombreObj}:${nombreAlc}`,
          r,
          slots,
          diagnosticarObjetivo(pool, CAT, r, slots, cuotasDe(slots), obj, alc, pool.p),
        );
      }
    }
  }
  return casos;
}

const CASOS = bateria();

// ---------------------------------------------------------------------------
// BLOQUEANTES
// ---------------------------------------------------------------------------

test("nunca sugiere relajar un alérgeno", () => {
  // CRÍTICO (spec §11.3). Test de seguridad, no de calidad. El alérgeno puede
  // ser el culpable —el usuario merece saberlo— pero jamás puede aparecer como
  // una salida que se le ofrece pulsar. Regex portado literal de
  // `test_nunca_sugiere_relajar_alergeno`.
  const prohibido =
    /al[eé]rgen|gluten|l[aá]cteo|huevo|pescado|crust[aá]ceo|cacahuete|soja|frutos de c[aá]scara|apio|mostaza|s[eé]samo|sulfito|altramuz|molusco/i;
  assert.ok(CASOS.length > 0, "la batería está vacía: no prueba nada");
  for (const caso of CASOS) {
    for (const s of caso.fallo.sugerencias) {
      assert.ok(!prohibido.test(s), `sugerencia peligrosa en ${caso.nombre}: ${s}`);
    }
  }
});

test("nunca sugiere bajar de las kcal mínimas", () => {
  // Ninguna sugerencia puede empujar por debajo del suelo de seguridad, ni
  // como objetivo ni como cifra que oriente hacia él. Es el test que descubrió
  // el «el mínimo baja a 571 kcal» de Python (D6).
  for (const caso of CASOS) {
    for (const s of caso.fallo.sugerencias) {
      for (const m of s.matchAll(/(\d+)\s*kcal/g)) {
        assert.ok(
          Number(m[1]) >= KCAL_MINIMAS_ABSOLUTO,
          `${caso.nombre}: ${s} propone ${m[1]} kcal`,
        );
      }
    }
  }
});

test("siempre exactamente tres sugerencias, y las tres distintas", () => {
  for (const caso of CASOS) {
    assert.equal(caso.fallo.sugerencias.length, N_SUGERENCIAS, caso.nombre);
    assert.equal(new Set(caso.fallo.sugerencias).size, N_SUGERENCIAS, caso.nombre);
    assert.ok(caso.fallo.mensaje.length > 0, caso.nombre);
    assert.ok(caso.fallo.restriccionCulpable.length > 0, caso.nombre);
  }
});

test("la batería recorre de verdad todas las culpas conocidas", () => {
  // Sin esto, los tres bloqueantes de arriba podrían pasar porque la batería
  // sólo toca dos ramas. Es el guardián del guardián.
  const culpas = new Set(CASOS.map((c) => c.fallo.restriccionCulpable.split(":")[0]));
  for (const esperada of [
    "dieta",
    "alergeno",
    "tiempo",
    "ingredientes_excluidos",
    "slots",
    "slot_sin_candidatos",
    "kcal_insuficientes_para_slots",
    "proteina_vs_kcal",
    "fibra_inalcanzable",
    "sodio_inalcanzable",
    "objetivo_inalcanzable_generico",
  ]) {
    assert.ok(culpas.has(esperada), `la batería no llega nunca a «${esperada}»`);
  }
});

test("las tres sugerencias son distintas incluso cuando no hay nada que sugerir", () => {
  // El caso degenerado directo: cero ejes cuantificables y cero relleno del
  // llamante. Python devolvía aquí tres veces la misma frase.
  const dos: SlotComida[] = ["comida", "cena"];
  const r = restr({ slots: dos, ingredientesExcluidos: [...CAT.alimentoId] });
  const pool = poolDe(r);
  const f = diagnosticarObjetivo(
    pool,
    CAT,
    r,
    dos,
    cuotasDe(dos),
    objetivo({ kcal: 1600 }),
    null,
    pool.p,
  );
  assert.equal(new Set(f.sugerencias).size, 3);
});

test("el filtro de alérgenos es la única puerta a las sugerencias estructurales", () => {
  // Comprobación estructural, no de texto: con un pool donde el alérgeno es el
  // eje de MAYOR ganancia con diferencia, ninguna sugerencia lo menciona pero
  // el culpable sí. Si alguien añadiera un segundo camino a las sugerencias
  // que no pasara por `ejesSugeribles`, este test seguiría pasando sólo si ese
  // camino también filtra.
  const r = restr({ alergenosExcluidos: ["gluten"], slots: S3 });
  const { ganancia } = ablacion(mascarasRestriccion(CAT, r, S3), CAT.n);
  const gGluten = ganancia.get("alergeno:gluten") ?? 0;
  assert.ok(gGluten > 0, "el gluten no ata nada: el caso no probaría nada");
  const f = diagnosticarPool(CAT, r, S3, poolDe(r).p, {}, 3);
  assert.ok(!f.sugerencias.some((s) => s.includes("gluten")));
});
