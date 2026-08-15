/**
 * Etapa 0: los filtros duros.
 *
 * Los números esperados NO están escritos a mano ni deducidos leyendo el
 * catálogo: salen de ejecutar el `construir_pool` real del backend sobre el
 * mismo catalogo.jsonl. Se regeneran así:
 *
 *   cd services/solver && ./.venv/bin/python - <<'PY'
 *   from app.catalogo import cargar_catalogo
 *   from app.solver.scoring import construir_pool
 *   from app.schemas import RestriccionesGeneracion
 *   cat = cargar_catalogo()
 *   r = RestriccionesGeneracion(dieta="vegana", alergenosExcluidos=[],
 *       ingredientesExcluidos=[], slots=["desayuno","comida","cena"], comensales=1)
 *   p = construir_pool(cat, r); print(p.p, [str(x) for x in p.ids.tolist()])
 *   PY
 *
 * Comparar contra Python y no contra una cuenta propia es lo que hace que este
 * fichero sirva de algo: un filtro duro mal portado no da error, da un plan con
 * gluten. Y la etapa 0 es la última barrera antes de que una receta prohibida
 * entre en el score, donde ya todo son preferencias que ceden.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { cargarCatalogo } from "../src/catalogo.ts";
import { IDX_ALERGENO, IDX_DIETA, SIN_LIMITE_MINUTOS, SLOTS } from "../src/constantes.ts";
import { popcountAnd } from "../src/numerico.ts";
import { bitsDe, construirPool, invalidarCachePool, topesPorSlot } from "../src/pool.ts";
import type { Alergeno, Pool, RestriccionesGeneracion, SlotComida, TipoDieta } from "../src/tipos.ts";
import type { CatalogoSerializado } from "../herramientas/compilar-catalogo.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const CAT = cargarCatalogo(
  JSON.parse(
    readFileSync(resolve(AQUI, "../datos/catalogo-compilado.json"), "utf8"),
  ) as CatalogoSerializado,
);

/** Los tres slots con los que se generaron todas las referencias de Python. */
const TRES_SLOTS: SlotComida[] = ["desayuno", "comida", "cena"];

function restr(cambios: Partial<RestriccionesGeneracion> = {}): RestriccionesGeneracion {
  return {
    dieta: "omnivora",
    alergenosExcluidos: [],
    ingredientesExcluidos: [],
    slots: TRES_SLOTS,
    comensales: 1,
    ...cambios,
  };
}

/** Los ids del pool, en su orden, que es el del catálogo. */
function idsDe(pool: Pool): string[] {
  return [...pool.ids];
}

// ---------------------------------------------------------------------------
// Filtros duros: dieta
// ---------------------------------------------------------------------------

test("cada dieta deja exactamente las recetas que deja el construir_pool de Python", () => {
  // Referencia: construir_pool con slots [desayuno, comida, cena] y sin más
  // restricciones. Las seis dietas del vocabulario, incluidas las dos que la
  // spec señala como candidatas a caer siempre en sobre-restricción con 36
  // recetas (vegana y baja_en_carbohidratos).
  const esperado: ReadonlyArray<readonly [TipoDieta, number]> = [
    ["omnivora", 36],
    ["vegetariana", 21],
    ["vegana", 8],
    ["pescetariana", 29],
    ["baja_en_carbohidratos", 10],
    ["mediterranea", 24],
  ];
  for (const [dieta, p] of esperado) {
    assert.equal(construirPool(CAT, restr({ dieta })).p, p, `dieta ${dieta}`);
  }
});

test("la dieta no filtra por conteo sino por receta: los ids son los del Python", () => {
  // Un conteo correcto con las recetas equivocadas es indistinguible de un
  // acierto, y es exactamente lo que produce leer la columna de dieta contigua.
  assert.deepEqual(idsDe(construirPool(CAT, restr({ dieta: "vegana" }))), [
    "lentejas_guisadas",
    "ensalada_garbanzos",
    "quinoa_tofu_pimiento",
    "curry_garbanzos",
    "revuelto_champinones_tofu",
    "tostada_cacahuete_platano",
    "manzana_almendras",
    "cuscus_verduras_garbanzos",
  ]);
  assert.deepEqual(idsDe(construirPool(CAT, restr({ dieta: "baja_en_carbohidratos" }))), [
    "tortilla_claras_espinacas",
    "yogur_fresas_almendras",
    "salmon_calabacin",
    "crema_calabacin_requeson",
    "revuelto_champinones_tofu",
    "pollo_coliflor_aceitunas",
    "salmon_espinacas_aguacate",
    "revuelto_gambas_bajo_carb",
    "yogur_nueces",
    "requeson_miel_almendras",
  ]);
});

test("toda receta del pool está marcada con la dieta pedida", () => {
  // El invariante, no el conteo: si esto falla, da igual que los números cuadren.
  for (const dieta of Object.keys(IDX_DIETA) as TipoDieta[]) {
    const pool = construirPool(CAT, restr({ dieta }));
    const bit = IDX_DIETA[dieta];
    for (let i = 0; i < pool.p; i++) {
      const fila = pool.idx[i] ?? -1;
      assert.equal(
        ((CAT.mDieta[fila] ?? 0) >>> bit) & 1,
        1,
        `${pool.ids[i] ?? ""} no admite la dieta ${dieta}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Filtros duros: alérgenos
// ---------------------------------------------------------------------------

test("los alérgenos excluidos quitan las recetas que dice Python, y sólo ésas", () => {
  const casos: ReadonlyArray<readonly [Alergeno[], number]> = [
    [["gluten"], 26],
    [["lacteos", "gluten"], 21],
    [["huevos"], 31],
  ];
  for (const [alergenos, p] of casos) {
    assert.equal(
      construirPool(CAT, restr({ alergenosExcluidos: alergenos })).p,
      p,
      alergenos.join("+"),
    );
  }
  // Combinado con dieta: los dos filtros son un AND, no dos caminos distintos.
  assert.deepEqual(
    idsDe(construirPool(CAT, restr({ dieta: "vegana", alergenosExcluidos: ["gluten"] }))),
    [
      "lentejas_guisadas",
      "ensalada_garbanzos",
      "quinoa_tofu_pimiento",
      "curry_garbanzos",
      "revuelto_champinones_tofu",
      "manzana_almendras",
    ],
  );
});

test("ninguna receta del pool lleva un alérgeno excluido", () => {
  // El filtro de alérgenos es el único del motor que no puede ceder NUNCA: el
  // resto de restricciones son preferencias que el score negocia.
  for (const alergeno of Object.keys(IDX_ALERGENO) as Alergeno[]) {
    const pool = construirPool(CAT, restr({ alergenosExcluidos: [alergeno] }));
    const mascara = 1 << IDX_ALERGENO[alergeno];
    for (let i = 0; i < pool.p; i++) {
      assert.equal(
        (CAT.mAlergeno[pool.idx[i] ?? -1] ?? 0) & mascara,
        0,
        `${pool.ids[i] ?? ""} lleva ${alergeno}`,
      );
    }
  }
});

test("el orden en que se piden los alérgenos no cambia el pool", () => {
  // La clave de caché los ordena; si el orden se colara en el resultado, dos
  // peticiones equivalentes darían planes distintos según cómo la UI rellene la
  // lista.
  const a = construirPool(CAT, restr({ alergenosExcluidos: ["lacteos", "gluten"] }));
  const b = construirPool(CAT, restr({ alergenosExcluidos: ["gluten", "lacteos"] }));
  assert.deepEqual(idsDe(a), idsDe(b));
});

// ---------------------------------------------------------------------------
// Filtros duros: ingredientes excluidos (nivel 2)
// ---------------------------------------------------------------------------

test("los ingredientes excluidos quitan las recetas que los usan", () => {
  assert.equal(construirPool(CAT, restr({ ingredientesExcluidos: ["pechuga_pollo"] })).p, 30);
  assert.equal(
    construirPool(CAT, restr({ ingredientesExcluidos: ["pechuga_pollo", "arroz_blanco"] })).p,
    28,
  );
});

test("un ingrediente que el catálogo no conoce se ignora en silencio", () => {
  // No hacer fallar la generación es deliberado: la lista la escribe el usuario
  // o la arrastra una versión anterior del catálogo, y un alimento que no existe
  // no puede estar en ninguna receta, así que ignorarlo da el mismo pool.
  const pool = construirPool(CAT, restr({ ingredientesExcluidos: ["no_existe_este_alimento"] }));
  assert.equal(pool.p, 36);
});

test("ninguna receta del pool contiene un ingrediente excluido", () => {
  const excluidos = ["pechuga_pollo", "arroz_blanco", "huevo"];
  const pool = construirPool(CAT, restr({ ingredientesExcluidos: excluidos }));
  const excl = bitsDe(CAT, excluidos);
  for (let i = 0; i < pool.p; i++) {
    assert.equal(
      popcountAnd(pool.bits, i * pool.w32, excl, 0, pool.w32),
      0,
      `${pool.ids[i] ?? ""} usa un ingrediente excluido`,
    );
  }
});

// ---------------------------------------------------------------------------
// El tope de minutos es POR SLOT
// ---------------------------------------------------------------------------

test("el nivel 1 poda con el MÁXIMO de los topes pedidos, no con el más estricto", () => {
  // Es el bug clásico del módulo: si el pool se filtrara con el tope del
  // desayuno (15 min), las 23 recetas que sólo caben en comida o cena se
  // perderían y el día se quedaría sin cenas. Python devuelve 36 aquí.
  const pool = construirPool(CAT, restr({ minutosMaxPorSlot: { desayuno: 15 } }));
  assert.equal(pool.p, 36);
});

test("un tope en TODOS los slots pedidos sí poda, y poda lo mismo que Python", () => {
  assert.equal(
    construirPool(CAT, restr({ minutosMaxPorSlot: { desayuno: 15, comida: 15, cena: 15 } })).p,
    13,
  );
  assert.deepEqual(
    idsDe(
      construirPool(CAT, restr({ minutosMaxPorSlot: { desayuno: 10, comida: 10, cena: 10 } })),
    ),
    [
      "avena_yogur_arandanos",
      "tostada_aguacate_huevo",
      "porridge_platano_cacahuete",
      "yogur_fresas_almendras",
      "pudin_chia_avena",
      "ensalada_garbanzos",
      "yogur_nueces",
      "tostada_cacahuete_platano",
      "batido_platano_avena",
      "requeson_miel_almendras",
      "manzana_almendras",
      "queso_batido_fresas",
    ],
  );
});

test("sin slots pedidos no hay tope global que aplicar", () => {
  // Un máximo sobre el conjunto vacío no puede podar nada: no hay ningún slot
  // cuyo límite respetar. Con un `-Infinity` mal puesto, el pool saldría vacío.
  assert.equal(construirPool(CAT, restr({ slots: [] })).p, 36);
});

test("topesPorSlot rellena los CINCO slots, no sólo los pedidos", () => {
  // `scoreSlot` indexa `topes[slot]` sin comprobar: un hueco convierte la
  // comparación `minutos <= undefined` en falsa para toda receta y deja el slot
  // sin candidatos.
  const topes = topesPorSlot(restr({ minutosMaxPorSlot: { desayuno: 15 } }));
  assert.deepEqual(Object.keys(topes).sort(), [...SLOTS].sort());
  assert.equal(topes.desayuno, 15);
  for (const slot of SLOTS) {
    if (slot !== "desayuno") assert.equal(topes[slot], SIN_LIMITE_MINUTOS);
  }
  // Sin `minutosMaxPorSlot` los cinco quedan sin tope.
  assert.deepEqual(
    Object.values(topesPorSlot(restr())),
    SLOTS.map(() => SIN_LIMITE_MINUTOS),
  );
});

// ---------------------------------------------------------------------------
// bitsDe
// ---------------------------------------------------------------------------

test("bitsDe pone un bit por alimento conocido y ninguno por los demás", () => {
  // El bit 0 es `aceite_oliva` y el 65 es `zanahoria`, que cae en la tercera
  // palabra: es el caso que distingue las palabras de 32 bits de los uint64 de
  // numpy (allí sale [1, 2]; aquí, [1, 0, 2]).
  assert.equal(CAT.alimentoIdx.get("aceite_oliva"), 0);
  assert.equal(CAT.alimentoIdx.get("zanahoria"), 65);
  const bits = bitsDe(CAT, ["aceite_oliva", "no_existe", "zanahoria"]);
  assert.equal(bits.length, CAT.w32);
  assert.deepEqual([...bits], [1, 0, 2]);
  assert.deepEqual([...bitsDe(CAT, [])], [0, 0, 0]);
});

test("bitsDe coloca el bit 31 sin volverlo negativo", () => {
  // `1 << 31` es negativo en JS. Si el bitset no fuera un Uint32Array o si se
  // escribiera con `>>`, la palabra saldría mal y `popcountAnd` contaría de más.
  const alimento = CAT.alimentoId[31] ?? "";
  const bits = bitsDe(CAT, [alimento]);
  assert.equal(bits[0], 2147483648);
  assert.equal(bits[1], 0);
});

// ---------------------------------------------------------------------------
// Estructura del pool
// ---------------------------------------------------------------------------

test("mapaFila traduce fila del catálogo a posición del pool, y −1 fuera de él", () => {
  const pool = construirPool(CAT, restr({ dieta: "vegana" }));
  assert.equal(pool.mapaFila.length, CAT.n);
  let dentro = 0;
  for (let fila = 0; fila < CAT.n; fila++) {
    const pos = pool.mapaFila[fila] ?? -2;
    if (pos === -1) continue;
    dentro++;
    assert.equal(pool.idx[pos], fila);
    assert.equal(pool.ids[pos], CAT.ids[fila]);
  }
  assert.equal(dentro, pool.p);
});

test("las columnas del pool son las filas del catálogo, alineadas por índice", () => {
  // El invariante maestro: la fila `i` es la misma receta en TODOS los arrays.
  // Se comprueba sobre un pool que no es el catálogo entero, que es donde un
  // gather con el ancho equivocado se nota.
  const pool = construirPool(CAT, restr({ dieta: "vegetariana" }));
  assert.equal(pool.w32, CAT.w32);
  for (let i = 0; i < pool.p; i++) {
    const fila = pool.idx[i] ?? -1;
    for (let c = 0; c < 6; c++) {
      assert.equal(pool.nutr[i * 6 + c], CAT.nutr[fila * 6 + c], `nutr[${i}][${c}]`);
      assert.equal(pool.conocido[i * 6 + c], CAT.conocido[fila * 6 + c]);
    }
    for (let c = 0; c < 3; c++) {
      assert.equal(pool.vMacro[i * 3 + c], CAT.vMacro[fila * 3 + c], `vMacro[${i}][${c}]`);
    }
    for (let k = 0; k < pool.w32; k++) {
      assert.equal(pool.bits[i * pool.w32 + k], CAT.ingrBits[fila * CAT.w32 + k]);
    }
    assert.equal(pool.tieneMacro[i], CAT.tieneMacro[fila]);
    assert.equal(pool.escalaMin[i], CAT.escalaMin[fila]);
    assert.equal(pool.escalaMax[i], CAT.escalaMax[fila]);
    assert.equal(pool.mSlot[i], CAT.mSlot[fila]);
    assert.equal(pool.minutos[i], CAT.minutos[fila]);
    assert.equal(pool.nIngr[i], CAT.nIngredientes[fila]);
    assert.equal(pool.costeCents[i], CAT.costeCents[fila]);
    assert.equal(pool.costeConocido[i], CAT.costeConocido[fila]);
  }
});

// ---------------------------------------------------------------------------
// La caché
// ---------------------------------------------------------------------------

test("la caché no cambia el resultado de ninguna combinación de filtros", () => {
  const casos = [
    restr(),
    restr({ dieta: "vegana" }),
    restr({ dieta: "vegetariana", alergenosExcluidos: ["gluten"] }),
    restr({ alergenosExcluidos: ["lacteos", "huevos"] }),
    restr({ ingredientesExcluidos: ["pechuga_pollo"] }),
    restr({ minutosMaxPorSlot: { desayuno: 10, comida: 10, cena: 10 } }),
    restr({ slots: [] }),
  ];
  // Primera pasada en frío, segunda con la caché caliente. Cualquier estado que
  // se colara entre peticiones aparecería aquí.
  invalidarCachePool();
  const enFrio = casos.map((r) => idsDe(construirPool(CAT, r)));
  const calientes = casos.map((r) => idsDe(construirPool(CAT, r)));
  assert.deepEqual(calientes, enFrio);

  // Y vaciarla tiene que devolver exactamente lo mismo: si la caché fuera lo
  // único que sostiene un resultado, `invalidarCachePool` sería un bug latente.
  invalidarCachePool();
  assert.deepEqual(
    casos.map((r) => idsDe(construirPool(CAT, r))),
    enFrio,
  );
});

test("tocar el pool devuelto no envenena la caché", () => {
  // `pool.idx` viaja a cuatro módulos. Python devuelve el array cacheado tal
  // cual; aquí se copia, y esto es lo que fija esa decisión: sin la copia, un
  // solo `sort()` en sitio aguas abajo corrompería todas las peticiones
  // siguientes con el mismo filtro, y el fallo sería indepurable.
  invalidarCachePool();
  const primero = construirPool(CAT, restr({ dieta: "mediterranea" }));
  const original = idsDe(primero);
  primero.idx.fill(0);
  const segundo = construirPool(CAT, restr({ dieta: "mediterranea" }));
  assert.deepEqual(idsDe(segundo), original);
});
