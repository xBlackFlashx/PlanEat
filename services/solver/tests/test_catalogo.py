"""Validación del catálogo.

Estos tests comprueban los datos, no el código. Un fallo aquí casi siempre
significa que alguien editó `ingredientes.json` o `recetas.json` y rompió una
invariante, no que `catalogo.py` esté mal.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from app.catalogo import cargar_catalogo
from app.solver import ALERGENOS, DIETAS, IDX_DIETA, IDX_SLOT, SLOTS

RAIZ = Path(__file__).resolve().parent.parent
DIR_DATOS = RAIZ / "data"


@pytest.fixture(scope="module")
def fuentes() -> tuple[dict, dict]:
    ing = json.loads((DIR_DATOS / "ingredientes.json").read_text(encoding="utf-8"))
    rec = json.loads((DIR_DATOS / "recetas.json").read_text(encoding="utf-8"))
    return {i["id"]: i for i in ing["ingredientes"]}, rec


@pytest.fixture(scope="module")
def cat():
    return cargar_catalogo()


# --------------------------------------------------------------------------
# Integridad referencial
# --------------------------------------------------------------------------


def test_todo_ingrediente_referenciado_existe(fuentes):
    ingredientes, recetas = fuentes
    huerfanos = [
        (r["id"], item["alimentoId"])
        for r in recetas["recetas"]
        for item in r["ingredientes"]
        if item["alimentoId"] not in ingredientes
    ]
    assert huerfanos == [], f"Ingredientes inexistentes: {huerfanos}"


def test_no_hay_ids_duplicados(fuentes, cat):
    ingredientes, recetas = fuentes
    ids_recetas = [r["id"] for r in recetas["recetas"]]
    assert len(ids_recetas) == len(set(ids_recetas))
    assert cat.n == len(ids_recetas)


# --------------------------------------------------------------------------
# Coherencia nutricional
# --------------------------------------------------------------------------


def test_kcal_coherente_con_atwater(cat):
    """kcal ≈ 4P + 4C + 9G. Un desvío grande delata un gramaje mal tecleado."""
    kcal = cat.nutr[:, 0]
    atwater = 4 * cat.nutr[:, 1] + 4 * cat.nutr[:, 2] + 9 * cat.nutr[:, 3]
    con_kcal = kcal > 0
    desvio = np.abs(atwater[con_kcal] - kcal[con_kcal]) / kcal[con_kcal]
    malas = [
        (cat.ids[i], float(kcal[i]), float(atwater[i]))
        for i, d in zip(np.where(con_kcal)[0], desvio, strict=True)
        if d > 0.15
    ]
    assert malas == [], f"Recetas con kcal incoherente: {malas}"


def test_valores_nutricionales_no_negativos(cat):
    assert (cat.nutr >= 0).all()


def test_kcal_por_racion_en_rango_plausible(cat):
    """Ninguna ración debe salirse de un rango razonable para una comida."""
    kcal = cat.nutr[:, 0]
    fuera = [(cat.ids[i], float(k)) for i, k in enumerate(kcal) if not (80 <= k <= 1200)]
    assert fuera == [], f"Raciones con kcal implausible: {fuera}"


def test_v_macro_normalizado(cat):
    """v_macro debe tener norma L2 = 1 donde hay macros."""
    normas = np.linalg.norm(cat.v_macro[cat.tiene_macro], axis=1)
    assert np.allclose(normas, 1.0, atol=1e-5)
    # Y exactamente cero donde no los hay: un vector no nulo sesgaría el coseno.
    assert np.all(cat.v_macro[~cat.tiene_macro] == 0)


# --------------------------------------------------------------------------
# Alérgenos: la invariante con consecuencias de seguridad
# --------------------------------------------------------------------------


def test_alergenos_son_la_union_de_los_ingredientes(fuentes, cat):
    ingredientes, recetas = fuentes
    fallos = []
    for r in recetas["recetas"]:
        esperados = set()
        for item in r["ingredientes"]:
            esperados.update(ingredientes[item["alimentoId"]].get("alergenos", []))
        fila = cat.idx_por_id[r["id"]]
        declarados = {a for a in ALERGENOS if cat.m_alergeno[fila, ALERGENOS.index(a)]}
        if declarados != esperados:
            fallos.append((r["id"], sorted(esperados), sorted(declarados)))
    assert fallos == [], f"Alérgenos mal derivados: {fallos}"


def test_alergenos_pertenecen_a_la_lista_de_la_ue(fuentes):
    ingredientes, _ = fuentes
    invalidos = {
        a
        for i in ingredientes.values()
        for a in i.get("alergenos", [])
        if a not in ALERGENOS
    }
    assert invalidos == set(), f"Alérgenos no reconocidos: {invalidos}"


# --------------------------------------------------------------------------
# Dietas
# --------------------------------------------------------------------------


def test_recetas_veganas_no_llevan_producto_animal(fuentes, cat):
    from scripts.construir_catalogo import CARNE, HUEVO, LACTEO, OTRO_ANIMAL, PESCADO_Y_MARISCO

    prohibidos = CARNE | PESCADO_Y_MARISCO | LACTEO | HUEVO | OTRO_ANIMAL
    _, recetas = fuentes
    fallos = []
    for r in recetas["recetas"]:
        fila = cat.idx_por_id[r["id"]]
        if not cat.m_dieta[fila, IDX_DIETA["vegana"]]:
            continue
        usados = {item["alimentoId"] for item in r["ingredientes"]}
        if usados & prohibidos:
            fallos.append((r["id"], sorted(usados & prohibidos)))
    assert fallos == [], f"Recetas veganas con producto animal: {fallos}"


def test_toda_receta_admite_omnivora(cat):
    assert cat.m_dieta[:, IDX_DIETA["omnivora"]].all()


def test_baja_en_carbohidratos_es_coherente(cat):
    from scripts.construir_catalogo import UMBRAL_BAJO_CARBOHIDRATO_G

    marcadas = cat.m_dieta[:, IDX_DIETA["baja_en_carbohidratos"]]
    assert (cat.nutr[marcadas, 2] < UMBRAL_BAJO_CARBOHIDRATO_G).all()
    assert (cat.nutr[~marcadas, 2] >= UMBRAL_BAJO_CARBOHIDRATO_G).all()


# --------------------------------------------------------------------------
# Cobertura: si esto falla, el solver fallará por catálogo pobre y no por bugs
# --------------------------------------------------------------------------


@pytest.mark.parametrize("slot", ["desayuno", "comida", "cena"])
def test_cobertura_minima_por_slot_principal(cat, slot):
    n = int(cat.m_slot[:, IDX_SLOT[slot]].sum())
    assert n >= 8, f"Sólo {n} recetas para '{slot}'; el solver necesita variedad"


@pytest.mark.parametrize("dieta", ["vegana", "vegetariana", "baja_en_carbohidratos"])
def test_cobertura_minima_por_dieta(cat, dieta):
    n = int(cat.m_dieta[:, IDX_DIETA[dieta]].sum())
    assert n >= 6, f"Sólo {n} recetas para la dieta '{dieta}'"


def test_hay_recetas_de_proteina_alta_y_grasa_baja(cat):
    """El hueco que vuelve infactible el LP con objetivos proteicos exigentes."""
    kcal = cat.nutr[:, 0]
    frac_prot = np.divide(4 * cat.nutr[:, 1], kcal, out=np.zeros_like(kcal), where=kcal > 0)
    frac_grasa = np.divide(9 * cat.nutr[:, 3], kcal, out=np.zeros_like(kcal), where=kcal > 0)
    n = int(((frac_prot > 0.30) & (frac_grasa < 0.30)).sum())
    assert n >= 6, f"Sólo {n} recetas de proteína alta y grasa baja"


# --------------------------------------------------------------------------
# Estructura y determinismo
# --------------------------------------------------------------------------


def test_arrays_alineados_por_fila(cat):
    """La invariante que sostiene todo el solver."""
    n = cat.n
    for nombre in ("titulos", "nutr", "conocido", "v_macro", "tiene_macro",
                   "escala_min", "escala_max", "m_dieta", "m_alergeno",
                   "m_slot", "minutos", "ingr_bits", "ingr_perec_bits",
                   "n_ingredientes", "coste_cents", "coste_conocido"):
        assert getattr(cat, nombre).shape[0] == n, f"{nombre} desalineado"


def test_bitsets_coinciden_con_el_recuento(cat):
    contados = np.array(
        [int(sum(int(p).bit_count() for p in fila)) for fila in cat.ingr_bits]
    )
    assert (contados == cat.n_ingredientes).all()


def test_perecederos_son_subconjunto_de_ingredientes(cat):
    assert (cat.ingr_perec_bits & ~cat.ingr_bits).sum() == 0


def test_version_es_estable_entre_cargas(cat):
    assert cargar_catalogo().version == cat.version
    assert len(cat.version) == 16


def test_falta_de_catalogo_da_error_claro(tmp_path):
    with pytest.raises(FileNotFoundError, match="construir_catalogo"):
        cargar_catalogo(tmp_path / "no_existe.jsonl")
