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

import { W_ALERGENO, cargarCatalogo } from "../src/catalogo.ts";
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
    ["omnivora", 240],
    ["vegetariana", 138],
    ["vegana", 72],
    ["pescetariana", 176],
    ["baja_en_carbohidratos", 134],
    ["mediterranea", 105],
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
  "tostada_cacahuete_platano",
  "manzana_almendras",
  "cuscus_verduras_garbanzos",
  "avena_crema_cacahuete_platano",
  "ensalada_pepino_tomate_verano",
  "esparragos_horno",
  "ensalada_espinacas_sencilla",
  "sandwich_mermelada_cacahuete_grande",
  "arroz_blanco_sencillo",
  "coles_bruselas_ajo",
  "pasta_aceite_tomate_albahaca",
  "hummus_pan_centeno",
  "patatas_pimientos_sarten",
  "boniato_microondas",
  "tofu_revuelto_verduras",
  "avena_platano_chia_vegana",
  "tempeh_salteado_verduras",
  "ensalada_quinoa_garbanzos",
  "curry_lentejas_espinacas",
  "hummus_verduras_crudas",
  "tazon_tofu_arroz",
  "wrap_hummus_verduras",
  "batido_verde_platano",
  "ensalada_alubias_aguacate",
  "tacos_soja_texturizada",
  "sopa_lentejas_verduras",
  "bowl_tempeh_cuscus",
  "tostada_aguacate_tomate_vegana",
  "ensalada_kale_manzana",
  "tazon_soja_arroz_verduras",
  "ensalada_pepino_alubias_eneldo",
  "tofu_horneado_boniato",
  "platano_crema_cacahuate_snack",
  "palitos_zanahoria_hummus",
  "manzana_crema_cacahuate",
  "mix_frutos_secos_pasas",
  "apio_crema_cacahuate",
  "pimientos_rellenos_soja",
  "ensalada_col_lombarda_manzana",
  "ensalada_tempeh_kale",
  "tofu_teriyaki_arroz",
  "ensalada_tabule_quinoa",
  "hamburguesa_garbanzos",
  "arroz_frito_tofu_verduras",
  "tempeh_teriyaki_verduras",
  "burrito_frijoles_verduras",
  "pasta_lentejas_tomate",
  "tazon_quinoa_verduras_asadas",
  "sopa_garbanzos_espinacas",
  "tostada_alubias_aguacate",
  "ensalada_lentejas_verduras_vegana",
  "tofu_curry_verduras_vegano",
  "quinoa_desayuno_frutas",
  "wrap_tempeh_verduras",
  "crema_lentejas_zanahoria",
  "ensalada_cuscus_verduras_vegana",
  "tostada_hummus_pepino",
  "batido_verde_manzana_espinaca",
  "tofu_salteado_pimientos_vegano",
  "lentejas_curry_boniato",
  "ensalada_garbanzos_espinacas_pasas",
  "sopa_alubias_verduras",
  "tazon_tempeh_quinoa_verduras",
  "avena_nocturna_cacao_platano",
  "ensalada_col_lombarda_alubias",
  "tostada_aguacate_pimienta",
  "brocoli_almendras_salteado",
  "coliflor_horno_curry",
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
  "huevos_duros_faciles",
  "revuelto_espinacas_pimiento",
  "tortilla_francesa_cheddar",
  "revuelto_espinacas_feta",
  "frittata_calabacin",
  "ensalada_pollo_cesar",
  "ensalada_atun_clasica",
  "ensalada_pepino_tomate_verano",
  "salteado_pollo_verduras",
  "ensalada_atun_aguacate_paleo",
  "pollo_limon_sarten",
  "pollo_espinacas_queso",
  "salteado_ternera_verduras",
  "pollo_costra_parmesano",
  "esparragos_horno",
  "salmon_horno_hierbas",
  "brocoli_vapor_parmesano",
  "ensalada_espinacas_sencilla",
  "brocoli_vapor_mantequilla",
  "tortilla_claras_queso",
  "pollo_caprese",
  "salmon_balsamico",
  "esparragos_parmesano",
  "ensalada_pollo_verduras",
  "coles_bruselas_ajo",
  "ensalada_rucula_pollo",
  "judias_verdes_ajo",
  "salteado_col_verde_bacon",
  "pollo_teriyaki_parrilla",
  "ensalada_atun_americana",
  "pollo_asado_aderezo_italiano",
  "wrap_pollo_lechuga",
  "ensalada_pollo_curry",
  "revuelto_pavo_queso_tostada",
  "revuelto_bacon_champinones",
  "tofu_revuelto_verduras",
  "tempeh_salteado_verduras",
  "ensalada_kale_manzana",
  "manzana_crema_cacahuate",
  "huevo_duro_pepino_sal",
  "queso_cottage_pina",
  "mix_frutos_secos_pasas",
  "tostada_queso_tomate",
  "batido_proteico_fresas",
  "rollitos_pavo_queso",
  "melon_jamon",
  "sandia_queso_feta",
  "apio_crema_cacahuate",
  "pepinillos_atun_pan",
  "requeson_pasas_canela",
  "pechuga_pollo_verduras_vapor",
  "claras_huevo_espinacas",
  "atun_ensalada_pepino_ligera",
  "pechuga_pollo_esparragos_ajo",
  "bacalao_verduras_horno",
  "gambas_salteadas_ajo_limon",
  "merluza_espinacas_vapor",
  "pollo_curry_ligero_yogur",
  "ensalada_pollo_espinacas_balsamico",
  "tortilla_claras_pavo_pimiento",
  "lomo_cerdo_verduras_plancha",
  "salmon_esparragos_limon",
  "berenjena_horno_parmesano",
  "coliflor_arroz_salteado",
  "ensalada_cesar_ligera_pollo",
  "brocheta_gambas_limon_pimenton",
  "sopa_verduras_pollo_desmenuzado",
  "rollitos_pepino_atun",
  "ensalada_col_lombarda_manzana",
  "lomo_cerdo_manzana_romero",
  "ensalada_esparragos_huevo_parmesano",
  "ensalada_tempeh_kale",
  "pollo_champinones_salsa_ligera",
  "tempeh_teriyaki_verduras",
  "tofu_curry_verduras_vegano",
  "tofu_salteado_pimientos_vegano",
  "queso_curado_manzana",
  "yogur_pina_snack",
  "nueces_miel_snack",
  "requeson_pepino_snack",
  "apio_requeson_snack",
  "yogur_manzana_canela_snack",
  "batido_arandanos_yogur",
  "huevo_duro_tomate_snack",
  "pavo_queso_manzana_snack",
  "tostada_aguacate_pimienta",
  "fresas_requeson_snack",
  "pepino_atun_snack",
  "galletas_integrales_queso",
  "jamon_melon_snack",
  "muslo_pollo_horno_verduras",
  "claras_huevo_pavo_tostada",
  "pechuga_pollo_brocoli_limon",
  "atun_tomate_relleno",
  "merluza_limon_horno",
  "ensalada_pollo_manzana_ligera",
  "gambas_limon_espinacas",
  "bacalao_tomate_horno",
  "pechuga_pavo_espinacas_plancha",
  "claras_huevo_champinones",
  "ensalada_atun_esparragos",
  "salmon_vapor_brocoli",
  "ternera_verduras_plancha",
  "huevos_duros_espinacas_snack",
  "pollo_pimenton_horno",
  "ensalada_gambas_espinacas",
  "pavo_verduras_salteado",
  "merluza_esparragos_limon",
  "revuelto_claras_pimiento_cebolla",
  "ensalada_pollo_aguacate_maiz",
  "salmon_mostaza_horno",
  "ternera_champinones_salsa",
  "pollo_limon_esparragos_horno",
  "brocoli_almendras_salteado",
  "ensalada_pepino_menta_queso",
  "ensalada_atun_huevo_aceitunas",
  "pollo_salsa_mostaza_champinones",
  "ensalada_espinacas_queso_feta_nueces",
  "salmon_teriyaki_brocoli",
  "coliflor_horno_curry",
  "berenjena_relleno_pavo",
  "ensalada_rucula_queso_curado",
  "ensalada_espinacas_pollo_manzana",
  "pollo_cebolla_caramelizada",
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
    [["gluten"], 177],
    [["lacteos", "gluten"], 134],
    [["huevos"], 204],
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
      "manzana_almendras",
      "cuscus_verduras_garbanzos",
      "ensalada_pepino_tomate_verano",
      "esparragos_horno",
      "ensalada_espinacas_sencilla",
      "arroz_blanco_sencillo",
      "coles_bruselas_ajo",
      "patatas_pimientos_sarten",
      "boniato_microondas",
      "tofu_revuelto_verduras",
      "tempeh_salteado_verduras",
      "ensalada_quinoa_garbanzos",
      "curry_lentejas_espinacas",
      "hummus_verduras_crudas",
      "tazon_tofu_arroz",
      "ensalada_alubias_aguacate",
      "sopa_lentejas_verduras",
      "bowl_tempeh_cuscus",
      "ensalada_kale_manzana",
      "tazon_soja_arroz_verduras",
      "ensalada_pepino_alubias_eneldo",
      "tofu_horneado_boniato",
      "platano_crema_cacahuate_snack",
      "palitos_zanahoria_hummus",
      "manzana_crema_cacahuate",
      "mix_frutos_secos_pasas",
      "apio_crema_cacahuate",
      "pimientos_rellenos_soja",
      "ensalada_col_lombarda_manzana",
      "ensalada_tempeh_kale",
      "ensalada_tabule_quinoa",
      "arroz_frito_tofu_verduras",
      "tazon_quinoa_verduras_asadas",
      "sopa_garbanzos_espinacas",
      "ensalada_lentejas_verduras_vegana",
      "tofu_curry_verduras_vegano",
      "crema_lentejas_zanahoria",
      "ensalada_cuscus_verduras_vegana",
      "tofu_salteado_pimientos_vegano",
      "lentejas_curry_boniato",
      "ensalada_garbanzos_espinacas_pasas",
      "sopa_alubias_verduras",
      "tazon_tempeh_quinoa_verduras",
      "ensalada_col_lombarda_alubias",
      "brocoli_almendras_salteado",
      "coliflor_horno_curry",
    ],
  );
});

test("ninguna receta del pool lleva un alérgeno excluido", () => {
  // El filtro de alérgenos es el único del motor que no puede ceder NUNCA: el
  // resto de restricciones son preferencias que el score negocia.
  for (const alergeno of Object.keys(IDX_ALERGENO) as Alergeno[]) {
    const pool = construirPool(CAT, restr({ alergenosExcluidos: [alergeno] }));
    const bit = IDX_ALERGENO[alergeno];
    const palabra = bit / 32 | 0;
    const bitEnPalabra = bit % 32;
    for (let i = 0; i < pool.p; i++) {
      const fila = pool.idx[i] ?? -1;
      assert.equal(
        (CAT.mAlergeno[fila * W_ALERGENO + palabra] ?? 0) & (1 << bitEnPalabra),
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
  assert.equal(construirPool(CAT, restr({ ingredientesExcluidos: ["pechuga_pollo"] })).p, 203);
  assert.equal(
    construirPool(CAT, restr({ ingredientesExcluidos: ["pechuga_pollo", "arroz_blanco"] })).p,
    193,
  );
});

test("un ingrediente que el catálogo no conoce se ignora en silencio", () => {
  // No hacer fallar la generación es deliberado: la lista la escribe el usuario
  // o la arrastra una versión anterior del catálogo, y un alimento que no existe
  // no puede estar en ninguna receta, así que ignorarlo da el mismo pool.
  const pool = construirPool(CAT, restr({ ingredientesExcluidos: ["no_existe_este_alimento"] }));
  assert.equal(pool.p, CAT.n);
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
  // desayuno (15 min), las recetas que sólo caben en comida o cena se
  // perderían y el día se quedaría sin cenas. Con un solo slot topado no hay
  // MÁXIMO que aplicar sobre los demás, así que el pool sale completo.
  const pool = construirPool(CAT, restr({ minutosMaxPorSlot: { desayuno: 15 } }));
  assert.equal(pool.p, CAT.n);
});

test("un tope en TODOS los slots pedidos sí poda, y poda lo mismo que Python", () => {
  assert.equal(
    construirPool(CAT, restr({ minutosMaxPorSlot: { desayuno: 15, comida: 15, cena: 15 } })).p,
    109,
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
      "tortilla_francesa_cheddar",
      "tostada_crema_cacahuete_platano",
      "avena_platano_leche",
      "revuelto_espinacas_feta",
      "avena_crema_cacahuete_platano",
      "yogur_griego_bayas_granola",
      "yogur_canela_manzana",
      "ensalada_atun_clasica",
      "ensalada_pepino_tomate_verano",
      "ensalada_atun_aguacate_paleo",
      "ensalada_espinacas_sencilla",
      "sandwich_pavo_sencillo",
      "sandwich_jamon_queso",
      "tortilla_claras_queso",
      "sandwich_mermelada_cacahuete_grande",
      "salmon_balsamico",
      "batido_tropical",
      "hummus_pan_centeno",
      "boniato_microondas",
      "ensalada_atun_americana",
      "wrap_pavo_espinacas_queso",
      "sandwich_aguacate_lechuga_tomate",
      "avena_platano_chia_vegana",
      "hummus_verduras_crudas",
      "wrap_hummus_verduras",
      "batido_verde_platano",
      "ensalada_alubias_aguacate",
      "tostada_aguacate_tomate_vegana",
      "ensalada_kale_manzana",
      "ensalada_pepino_alubias_eneldo",
      "platano_crema_cacahuate_snack",
      "yogur_granola_arandanos",
      "palitos_zanahoria_hummus",
      "manzana_crema_cacahuate",
      "queso_cottage_pina",
      "mix_frutos_secos_pasas",
      "tostada_queso_tomate",
      "batido_proteico_fresas",
      "rollitos_pavo_queso",
      "melon_jamon",
      "sandia_queso_feta",
      "apio_crema_cacahuate",
      "pepinillos_atun_pan",
      "requeson_pasas_canela",
      "atun_ensalada_pepino_ligera",
      "rollitos_pepino_atun",
      "ensalada_col_lombarda_manzana",
      "wrap_atun_aguacate",
      "tazon_desayuno_proteico",
      "tostada_alubias_aguacate",
      "ensalada_lentejas_verduras_vegana",
      "tostada_hummus_pepino",
      "batido_verde_manzana_espinaca",
      "ensalada_garbanzos_espinacas_pasas",
      "avena_nocturna_cacao_platano",
      "ensalada_col_lombarda_alubias",
      "queso_curado_manzana",
      "platano_yogur_granola",
      "bolitas_avena_cacahuate",
      "sandwich_atun_pepinillo",
      "yogur_pina_snack",
      "nueces_miel_snack",
      "requeson_pepino_snack",
      "apio_requeson_snack",
      "yogur_manzana_canela_snack",
      "tostada_platano_canela",
      "batido_arandanos_yogur",
      "pavo_queso_manzana_snack",
      "tostada_aguacate_pimienta",
      "fresas_requeson_snack",
      "pepino_atun_snack",
      "galletas_integrales_queso",
      "batido_fresas_platano",
      "jamon_melon_snack",
      "atun_tomate_relleno",
      "ensalada_pepino_menta_queso",
      "ensalada_espinacas_queso_feta_nueces",
      "ensalada_rucula_queso_curado",
    ],
  );
});

test("sin slots pedidos no hay tope global que aplicar", () => {
  // Un máximo sobre el conjunto vacío no puede podar nada: no hay ningún slot
  // cuyo límite respetar. Con un `-Infinity` mal puesto, el pool saldría vacío.
  assert.equal(construirPool(CAT, restr({ slots: [] })).p, CAT.n);
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
  // El bit 0 es `aceite_oliva`; `zanahoria` cae en una palabra posterior a la
  // primera, que es el caso que distingue las palabras de 32 bits de los
  // uint64 de numpy. El índice y la palabra/posición se derivan del propio
  // catálogo cargado, no se fijan a mano: cambian cada vez que el vocabulario
  // de alimentos crece.
  const idxZanahoria = CAT.alimentoIdx.get("zanahoria");
  assert.equal(CAT.alimentoIdx.get("aceite_oliva"), 0);
  assert.ok(idxZanahoria !== undefined && idxZanahoria >= 32, "zanahoria debería caer fuera de la primera palabra");
  const bits = bitsDe(CAT, ["aceite_oliva", "no_existe", "zanahoria"]);
  assert.equal(bits.length, CAT.w32);
  const esperadas = new Array(CAT.w32).fill(0);
  esperadas[0] = 1;
  esperadas[Math.floor(idxZanahoria! / 32)] |= 1 << (idxZanahoria! % 32);
  assert.deepEqual([...bits], esperadas);
  assert.deepEqual([...bitsDe(CAT, [])], new Array(CAT.w32).fill(0));
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
