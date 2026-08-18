"""Tests del motor de generación. DISENO.md §8.

Convención: nombres en español, un test por invariante. Los tests que llevan
**CRÍTICO** en el docstring son de seguridad (spec §11.3): si fallan, el
servicio no se despliega.

Ninguno de estos tests inventa datos nutricionales. Los que necesitan un
catálogo controlado lo construyen a partir del catálogo real recortando filas,
no fabricando paneles.
"""

from __future__ import annotations

import dataclasses
import math
import re
import statistics
import time
from collections import Counter

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.catalogo import cargar_catalogo
from app.main import app
from app.schemas import (
    ObjetivoNutricional,
    RestriccionesGeneracion,
    SolicitudGeneracion,
)
from app.solver import (
    ALERGENOS,
    IDX_ALERGENO,
    IDX_KCAL,
    IDX_PROT,
    IDX_SLOT,
    MAX_USOS_RECETA_SEMANA,
    PASO_RACION,
    TAU_MAX,
    TAU_MIN,
    TOP_K,
    UMBRAL_ERROR_ACEPTABLE,
    rng_de,
    temperatura,
)
from app.solver.diagnostico import ablacion, mascaras_restriccion
from app.solver.motor import ObjetivoInvalido, generar
from app.solver.porciones import bandas_de, error_de, resolver_porciones
from app.solver.scoring import (
    construir_pool,
    contexto_de,
    cuotas_de,
    muestrear,
    orden_de_slots,
    vector_macro,
)
from app.solver.semanal import ensamblar, generar_candidatos

SLOTS_3 = ["desayuno", "comida", "cena"]
SLOTS_5 = ["desayuno", "almuerzo", "comida", "merienda", "cena"]


@pytest.fixture(scope="module")
def cat():
    return cargar_catalogo()


def _catalogo_recortado(cat, n: int):
    """Primeras `n` filas del catálogo real, con `version` distinta para no

    colisionar con la caché de pool del catálogo completo (`scoring._cache_pool`
    indexa por `cat.version`). El catálogo semilla ya no es lo bastante
    estrecho para disparar la puerta 3 de §6.0 ni forzar reparaciones duras
    tras la ampliación a 91 recetas: MIN_POOL(40) < 0.5·91, así que la ventana
    de la puerta 3 queda vacía en el catálogo real. Se recorta, no se inventa.
    """
    ids = cat.ids[:n]
    return dataclasses.replace(
        cat,
        version=f"{cat.version}-recortado-{n}",
        ids=ids,
        idx_por_id={aid: i for i, aid in enumerate(ids)},
        titulos=cat.titulos[:n],
        nutr=cat.nutr[:n],
        conocido=cat.conocido[:n],
        v_macro=cat.v_macro[:n],
        tiene_macro=cat.tiene_macro[:n],
        escala_min=cat.escala_min[:n],
        escala_max=cat.escala_max[:n],
        m_dieta=cat.m_dieta[:n],
        m_alergeno=cat.m_alergeno[:n],
        m_slot=cat.m_slot[:n],
        minutos=cat.minutos[:n],
        ingr_bits=cat.ingr_bits[:n],
        ingr_perec_bits=cat.ingr_perec_bits[:n],
        n_ingredientes=cat.n_ingredientes[:n],
        coste_cents=cat.coste_cents[:n],
        coste_conocido=cat.coste_conocido[:n],
    )


@pytest.fixture(scope="module")
def cat_estrecho(cat):
    return _catalogo_recortado(cat, 36)


def objetivo(**cambios) -> dict:
    """Objetivo diario razonable para un adulto de ~2.000 kcal.

    No es una recomendación nutricional: son los números que el motor de
    objetivos de la app produciría, usados aquí sólo como entrada del solver.
    """
    base = {
        "kcal": 2000,
        "toleranciaKcal": 0.05,
        "proteinaG": {"min": 120, "max": 160},
        "carbohidratoG": {"min": 180, "max": 250},
        "grasaG": {"min": 55, "max": 80},
        "fibraMinG": 20,
    }
    base.update(cambios)
    return base


def solicitud(dias: int = 1, slots=None, seed: int = 1, obj=None, **restricciones):
    return SolicitudGeneracion(
        objetivos=[obj or objetivo()] * dias,
        restricciones={"slots": slots or SLOTS_3, **restricciones},
        seed=seed,
    )


def plan(cat, **kw):
    r, traza = generar(solicitud(**kw), cat)
    return r, traza


# ---------------------------------------------------------------------------
# Camino feliz y contrato
# ---------------------------------------------------------------------------


def test_catalogo_semilla_genera_dia(cat):
    r, traza = plan(cat)
    assert r.ok, getattr(r, "fallo", None)
    assert len(r.dias) == 1
    assert r.msTranscurridos > 0


def test_catalogo_estrecho_puerta_3(cat_estrecho):
    """Puerta 3 de §6.0: 36 recetas < MIN_POOL y aun así se genera.

    Es el test del fallo de diseño que el umbral absoluto habría provocado:
    rechazar el 100 % de las peticiones culpando al usuario de restricciones
    que no ha puesto. El catálogo real ya tiene demasiadas recetas para
    disparar esta puerta por sí solo (ver `_catalogo_recortado`).
    """
    r, traza = plan(cat_estrecho)
    assert r.ok, getattr(r, "fallo", None)
    assert traza.catalogo_estrecho is True
    assert len(r.dias) == 1
    assert r.msTranscurridos > 0


def test_catalogo_semilla_genera_semana(cat):
    r, _ = plan(cat, dias=7, slots=SLOTS_5)
    assert r.ok, getattr(r, "fallo", None)
    assert len(r.dias) == 7
    assert [d.fecha for d in r.dias] == sorted({d.fecha for d in r.dias})


def test_totales_coinciden_con_items(cat):
    """El invariante más caro: la suma de la UI tiene que cuadrar con la UI."""
    r, _ = plan(cat, dias=3, slots=SLOTS_5)
    assert r.ok
    for dia in r.dias:
        for campo in ("kcal", "proteinaG", "carbohidratoG", "grasaG"):
            suma = sum(getattr(c.totales, campo) for c in dia.comidas)
            assert getattr(dia.totales, campo) == pytest.approx(suma, abs=0.6)


def test_hay_una_comida_por_slot_pedido(cat):
    r, _ = plan(cat, slots=SLOTS_5)
    assert r.ok
    assert [c.slot for c in r.dias[0].comidas] == SLOTS_5


def test_factor_racion_dentro_de_cotas_y_en_rejilla(cat):
    r, _ = plan(cat, dias=3, slots=SLOTS_5)
    assert r.ok
    for dia in r.dias:
        for comida in dia.comidas:
            f = comida.items[0].factorRacion
            assert 0.6 - 1e-9 <= f <= 1.8 + 1e-9
            assert abs(f / PASO_RACION - round(f / PASO_RACION)) < 1e-6


def test_error_final_bajo_el_umbral(cat):
    """Si se devuelve un plan, es porque cuadra. Lo contrario sería mentir."""
    for seed in range(10):
        _, traza = plan(cat, dias=3, slots=SLOTS_5, seed=seed)
        assert max(traza.errores_por_dia) <= UMBRAL_ERROR_ACEPTABLE


def test_nunca_usa_el_porcionado_de_emergencia(cat):
    """El camino de emergencia existe para no caerse, no para operar.

    Si aparece en una ejecución normal es un bug del LP que hay que perseguir.
    """
    for seed in range(10):
        _, traza = plan(cat, dias=3, slots=SLOTS_5, seed=seed)
        assert traza.porcionados_de_emergencia == 0


# ---------------------------------------------------------------------------
# Etapa A: filtros duros
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("alergeno", ALERGENOS)
def test_alergeno_excluido_nunca_aparece(cat, alergeno):
    """CRÍTICO (spec §11.3). Si esto falla, el servicio no se despliega.

    Se recorren varios seeds porque la selección es estocástica: un único seed
    podría no llegar nunca a la receta peligrosa y dar un falso verde.
    """
    col = IDX_ALERGENO[alergeno]
    for seed in range(8):
        r, _ = plan(
            cat, dias=2, slots=SLOTS_5, seed=seed, alergenosExcluidos=[alergeno]
        )
        if not r.ok:
            continue  # sin plan no hay riesgo; el diagnóstico se prueba aparte
        for dia in r.dias:
            for comida in dia.comidas:
                for item in comida.items:
                    fila = cat.idx_por_id[item.recetaId]
                    assert not cat.m_alergeno[fila, col], (
                        f"{item.recetaId} contiene {alergeno} y se coló en el plan"
                    )


def test_dieta_se_respeta(cat):
    """Un día por dieta: con el catálogo semilla, varias dietas no dan para más.

    La mediterránea sólo tiene 3 desayunos, así que a dos días la puerta 1 la
    rechaza — y hace bien. Aquí se prueba el filtro, no la cobertura.
    """
    from app.solver import IDX_DIETA

    for dieta in ("vegetariana", "pescetariana", "mediterranea", "omnivora"):
        r, _ = plan(cat, slots=SLOTS_3, dieta=dieta)
        assert r.ok, (dieta, getattr(r, "fallo", None))
        for dia in r.dias:
            for comida in dia.comidas:
                fila = cat.idx_por_id[comida.items[0].recetaId]
                assert cat.m_dieta[fila, IDX_DIETA[dieta]]


def test_dieta_estrecha_falla_de_forma_honesta(cat_estrecho):
    """La vegana a 7 días no cabe en un catálogo estrecho: hay que decirlo.

    Antes se probaba contra el catálogo semilla completo, pero éste ya no es
    estrecho para la dieta vegana a propósito (pasó de 19 a 45 recetas
    veganas en esta ampliación) — un catálogo rico fallando aquí sería el bug,
    no el caso a probar. `cat_estrecho` (36 recetas, ver su fixture) es la
    versión deliberadamente limitada que sigue disparando este fallo.
    """
    r, _ = plan(cat_estrecho, dias=7, slots=SLOTS_3, dieta="vegana")
    assert not r.ok
    assert r.fallo.restriccionCulpable.startswith("slot_sin_candidatos")
    assert len(r.fallo.sugerencias) == 3


def test_dieta_vegana_7_dias_ya_cabe_en_el_catalogo_semilla(cat):
    """Lo contrario del test anterior: la ampliación cumplió lo que prometía.

    Regresión para el día en que alguien recorte el catálogo vegano sin
    darse cuenta — si esto vuelve a fallar, hay que mirar por qué antes de
    tocar el test.
    """
    r, _ = plan(cat, dias=7, slots=SLOTS_3, dieta="vegana")
    assert r.ok, getattr(r, "fallo", None)


def test_ingredientes_excluidos_respetados(cat):
    excluidos = ["huevo", "leche_semi", "arroz_blanco"]
    r, _ = plan(cat, dias=3, slots=SLOTS_3, ingredientesExcluidos=excluidos)
    assert r.ok
    bits_prohibidos = {cat.alimento_idx[a] for a in excluidos if a in cat.alimento_idx}
    assert bits_prohibidos, "los ingredientes de prueba deben existir en el catálogo"
    for dia in r.dias:
        for comida in dia.comidas:
            fila = cat.idx_por_id[comida.items[0].recetaId]
            for bit in bits_prohibidos:
                palabra = int(cat.ingr_bits[fila, bit >> 6])
                assert not (palabra >> (bit & 63)) & 1


def test_minutos_max_es_por_slot(cat):
    """Cubre el bug de §1.4: filtrar el pool entero por el tope del desayuno.

    Con 5 min para el desayuno y 60 para la cena tiene que haber cenas largas y
    no puede haber ningún desayuno largo.
    """
    hubo_cena_larga = False
    for seed in range(10):
        r, _ = plan(
            cat,
            slots=["desayuno", "cena"],
            seed=seed,
            minutosMaxPorSlot={"desayuno": 5, "cena": 60},
        )
        assert r.ok
        for comida in r.dias[0].comidas:
            minutos = int(cat.minutos[cat.idx_por_id[comida.items[0].recetaId]])
            if comida.slot == "desayuno":
                assert minutos <= 5
            else:
                assert minutos <= 60
                hubo_cena_larga |= minutos > 5
    assert hubo_cena_larga, "el tope del desayuno se está aplicando a la cena"


def test_sin_repeticion_de_receta_en_el_dia(cat):
    for seed in range(15):
        r, _ = plan(cat, slots=SLOTS_5, seed=seed)
        assert r.ok
        ids = [c.items[0].recetaId for c in r.dias[0].comidas]
        assert len(ids) == len(set(ids))


def test_orden_de_slots_no_afecta(cat):
    """El orden de recorrido se deriva de la cuota, no del orden de la petición."""
    a, _ = generar(solicitud(slots=["cena", "desayuno", "comida"], seed=99), cat)
    b, _ = generar(solicitud(slots=["desayuno", "comida", "cena"], seed=99), cat)
    assert a.ok and b.ok
    assert [c.model_dump() for c in a.dias[0].comidas] == [
        c.model_dump() for c in b.dias[0].comidas
    ]


def test_orden_de_recorrido_por_cuota(cat):
    assert orden_de_slots(SLOTS_5) == [
        "comida",
        "cena",
        "desayuno",
        "almuerzo",
        "merienda",
    ]


# ---------------------------------------------------------------------------
# Etapa A: score y muestreo
# ---------------------------------------------------------------------------


def test_fit_maximo_para_composicion_identica(cat):
    """Una receta con la composición exacta del residuo tiene fit = 1."""
    residuo = np.array([2000.0, 150.0, 200.0, 60.0, 25.0, 0.0])
    v = vector_macro(residuo)
    cos = float(np.dot(v, v))
    fit = 1.0 - (2.0 / np.pi) * np.arccos(min(1.0, cos))
    assert fit == pytest.approx(1.0, abs=1e-6)


def test_vector_macro_es_nulo_si_el_dia_esta_cubierto():
    assert not np.any(vector_macro(np.array([0.0, -5.0, -10.0, -2.0, 0.0, 0.0])))


def test_temperatura_es_monotona_y_acota():
    assert temperatura(0) == pytest.approx(TAU_MIN)
    assert temperatura(100) == pytest.approx(TAU_MAX)
    valores = [temperatura(v) for v in (0, 25, 45, 75, 100)]
    assert valores == sorted(valores)


def test_temperatura_baja_tiende_a_argmax():
    scores = np.array([5.0, 4.9, 4.0, 3.0, 1.0], dtype=np.float32)
    ids = np.array(["a", "b", "c", "d", "e"], dtype=object)
    elegidos = [muestrear(scores, ids, 0.01, rng_de(7, 2, i)) for i in range(200)]
    assert Counter(elegidos)[0] >= 190


def test_temperatura_alta_tiende_a_uniforme():
    scores = np.array([5.0, 4.9, 4.0, 3.0, 1.0], dtype=np.float32)
    ids = np.array(["a", "b", "c", "d", "e"], dtype=object)
    elegidos = [muestrear(scores, ids, TAU_MAX, rng_de(7, 2, i)) for i in range(400)]
    cuenta = Counter(elegidos)
    p = np.array([cuenta.get(i, 0) for i in range(5)], dtype=float) / 400
    entropia = float(-(p[p > 0] * np.log(p[p > 0])).sum())
    assert entropia >= 0.85 * math.log(5)


def test_entropia_creciente_en_temperatura():
    scores = np.linspace(5.0, 1.0, 12).astype(np.float32)
    ids = np.array([f"r{i:02d}" for i in range(12)], dtype=object)

    def entropia(tau):
        c = Counter(muestrear(scores, ids, tau, rng_de(11, 2, i)) for i in range(400))
        p = np.array([c.get(i, 0) for i in range(12)], dtype=float) / 400
        return float(-(p[p > 0] * np.log(p[p > 0])).sum())

    valores = [entropia(t) for t in (0.12, 0.37, 0.8, 1.5)]
    assert valores == sorted(valores)


def test_empates_desempatan_por_id():
    """Sin desempate explícito por id, `argpartition` cambia el plan entre
    versiones de NumPy. Es el fallo de reproducibilidad más fácil de introducir.
    """
    scores = np.zeros(40, dtype=np.float32)
    ids = np.array([f"receta_{i:03d}" for i in range(40)], dtype=object)
    elegidos = {muestrear(scores, ids, 0.001, rng_de(5, 2, i)) for i in range(60)}
    # Con 40 empates, el top-25 tiene que ser el de los 25 ids menores: si el
    # corte dependiera del orden de `argpartition`, saldrían índices ≥ 25.
    assert elegidos and max(elegidos) < TOP_K
    # Y el mismo nodo del árbol de semillas devuelve siempre lo mismo.
    assert len({muestrear(scores, ids, 0.001, rng_de(5, 2, 0)) for _ in range(20)}) == 1


# ---------------------------------------------------------------------------
# Etapa B: el LP
# ---------------------------------------------------------------------------


def _obj_simple(
    kcal=1000, prot=(50, 70), carb=(100, 140), grasa=(25, 40), fibra=0, sodio=None
):
    return ObjetivoNutricional(
        kcal=kcal,
        toleranciaKcal=0.05,
        proteinaG={"min": prot[0], "max": prot[1]},
        carbohidratoG={"min": carb[0], "max": carb[1]},
        grasaG={"min": grasa[0], "max": grasa[1]},
        fibraMinG=fibra,
        sodioMaxMg=sodio,
    )


def test_lp_error_cero_dentro_de_rango():
    """E = 0 significa "todos dentro de banda", no "clavado en el centro"."""
    bandas = bandas_de(_obj_simple())
    a = np.array(
        [
            [500.0, 500.0],  # kcal
            [30.0, 30.0],  # proteína
            [60.0, 60.0],  # carbohidrato
            [15.0, 15.0],  # grasa
            [0.0, 0.0],
            [0.0, 0.0],
        ]
    )
    res = resolver_porciones(
        a, np.array([0.6, 0.6]), np.array([1.8, 1.8]), np.array([1.0, 1.0]), bandas
    )
    assert res.error == pytest.approx(0.0, abs=1e-9)
    assert res.totales[IDX_KCAL] == pytest.approx(a[IDX_KCAL] @ res.sigma)


def test_lp_banda_muerta_no_mueve_sigma():
    """Si σ_ref ya cae dentro de todas las bandas, el LP lo devuelve intacto.

    Es la verificación del regularizador: sin él, HiGHS devuelve cualquier
    vértice de la cara óptima y el plan es incocinable.
    """
    bandas = bandas_de(_obj_simple())
    a = np.array(
        [
            [500.0, 500.0],
            [30.0, 30.0],
            [60.0, 60.0],
            [15.0, 15.0],
            [0.0, 0.0],
            [0.0, 0.0],
        ]
    )
    ref = np.array([1.0, 1.0])
    res = resolver_porciones(a, np.array([0.6, 0.6]), np.array([1.8, 1.8]), ref, bandas)
    assert res.sigma == pytest.approx(ref, abs=1e-9)


def test_lp_degenerado_es_estable():
    """Cuatro recetas intercambiables → siempre el mismo reparto equilibrado.

    Sin el regularizador este test falla devolviendo (0,6 · 0,6 · 1,0 · 1,8):
    media ración de dos platos y casi dos de otro. Es su razón de ser.
    """
    bandas = bandas_de(
        _obj_simple(kcal=1000, prot=(50, 70), carb=(100, 140), grasa=(25, 40))
    )
    a = np.tile(np.array([[250.0], [15.0], [30.0], [7.5], [0.0], [0.0]]), (1, 4))
    lo, hi = np.full(4, 0.6), np.full(4, 1.8)
    ref = np.ones(4)
    soluciones = {
        tuple(resolver_porciones(a, lo, hi, ref, bandas).sigma.round(4))
        for _ in range(50)
    }
    assert len(soluciones) == 1
    assert soluciones.pop() == pytest.approx((1.0, 1.0, 1.0, 1.0), abs=1e-6)


def test_lp_asimetria_proteina():
    """Quedarse corto de proteína cuesta 2,5×; pasarse, 1,0×. Es de producto."""
    bandas = bandas_de(_obj_simple(prot=(50, 50)))
    # El resto de nutrientes se deja DENTRO de banda para aislar la proteína:
    # si contribuyeran al error, la razón medida no sería la de los pesos.
    dentro = np.array([1000.0, 50.0, 120.0, 32.0, 0.0, 0.0])
    assert error_de(dentro, bandas) == pytest.approx(0.0, abs=1e-12)
    defecto = dentro.copy()
    defecto[IDX_PROT] = 40.0
    exceso = dentro.copy()
    exceso[IDX_PROT] = 60.0
    assert error_de(defecto, bandas) == pytest.approx(
        2.5 * error_de(exceso, bandas), rel=1e-9
    )


def test_lp_sodio_solo_penaliza_exceso():
    bandas = bandas_de(_obj_simple(sodio=2000))
    tot = np.array([1000.0, 60.0, 120.0, 32.0, 0.0, 100.0])
    assert error_de(tot, bandas) == pytest.approx(0.0, abs=1e-12)
    tot[5] = 4000.0
    assert error_de(tot, bandas) > 0


def test_lp_fibra_solo_penaliza_defecto():
    bandas = bandas_de(_obj_simple(fibra=30))
    tot = np.array([1000.0, 60.0, 120.0, 32.0, 90.0, 0.0])
    assert error_de(tot, bandas) == pytest.approx(0.0, abs=1e-12)
    tot[4] = 5.0
    assert error_de(tot, bandas) > 0


def test_lp_cotas_activas_dan_error_conocido():
    """Objetivo inalcanzable dentro de [ℓ, u]: σ va a la cota y E es calculable."""
    bandas = bandas_de(
        _obj_simple(kcal=4000, prot=(200, 260), carb=(400, 520), grasa=(100, 140))
    )
    a = np.array([[500.0], [30.0], [60.0], [15.0], [0.0], [0.0]])
    res = resolver_porciones(
        a, np.array([0.6]), np.array([1.8]), np.array([1.0]), bandas
    )
    assert res.sigma[0] == pytest.approx(1.8)
    assert res.totales == pytest.approx(a[:, 0] * 1.8)
    assert res.error == pytest.approx(error_de(res.totales, bandas))


def test_lp_totales_son_los_de_sigma_cuantizado():
    bandas = bandas_de(
        _obj_simple(kcal=987, prot=(41, 63), carb=(93, 137), grasa=(21, 39))
    )
    a = np.array(
        [
            [437.0, 313.0],
            [21.0, 19.0],
            [41.0, 44.0],
            [11.0, 7.0],
            [0.0, 0.0],
            [0.0, 0.0],
        ]
    )
    res = resolver_porciones(
        a, np.array([0.6, 0.6]), np.array([1.8, 1.8]), np.array([1.0, 1.0]), bandas
    )
    assert res.totales == pytest.approx(a @ res.sigma)
    for s in res.sigma:
        assert abs(s / PASO_RACION - round(s / PASO_RACION)) < 1e-9


# ---------------------------------------------------------------------------
# Etapa D: semana
# ---------------------------------------------------------------------------


def test_receta_maximo_dos_veces_por_semana(cat):
    for seed in range(12):
        r, _ = plan(
            cat, dias=7, slots=["desayuno", "comida", "merienda", "cena"], seed=seed
        )
        assert r.ok
        cuenta = Counter(c.items[0].recetaId for d in r.dias for c in d.comidas)
        assert max(cuenta.values()) <= MAX_USOS_RECETA_SEMANA, cuenta


def test_sin_misma_receta_en_slot_consecutivo(cat):
    for seed in range(12):
        r, _ = plan(
            cat, dias=7, slots=["desayuno", "comida", "merienda", "cena"], seed=seed
        )
        assert r.ok
        for ayer, hoy in zip(r.dias, r.dias[1:], strict=False):
            previo = {c.slot: c.items[0].recetaId for c in ayer.comidas}
            for comida in hoy.comidas:
                assert previo.get(comida.slot) != comida.items[0].recetaId


def test_repeticion_semanal_degrada_pero_no_se_dispara(cat):
    """Con 5 slots × 7 días el catálogo semilla se queda corto: 35 comidas
    contra 34 recetas admisibles. La restricción dura cede a propósito antes
    que devolver un fallo, pero tiene que ceder POCO y sólo en el tope semanal,
    nunca en la repetición en días consecutivos, que es la que se ve.
    """
    peor = 0
    for seed in range(15):
        r, _ = plan(cat, dias=7, slots=SLOTS_5, seed=seed)
        assert r.ok
        cuenta = Counter(c.items[0].recetaId for d in r.dias for c in d.comidas)
        peor = max(peor, max(cuenta.values()))
        assert sum(1 for v in cuenta.values() if v > MAX_USOS_RECETA_SEMANA) <= 1
        for ayer, hoy in zip(r.dias, r.dias[1:], strict=False):
            previo = {c.slot: c.items[0].recetaId for c in ayer.comidas}
            for comida in hoy.comidas:
                assert previo.get(comida.slot) != comida.items[0].recetaId
    assert peor <= MAX_USOS_RECETA_SEMANA + 1


def test_la_reparacion_dura_conserva_los_totales(cat_estrecho):
    """Sustituir un item obliga a rehacer el LP: los totales no pueden quedarse
    con los de la receta vieja. Es la mentira más fácil de colar aquí.

    Necesita un catálogo estrecho (ver `_catalogo_recortado`): con las 91
    recetas del catálogo real, siete días de cinco comidas ya no agotan el
    tope de dos usos por receta lo bastante como para forzar una reparación.
    """
    visto = False
    for seed in range(15):
        r, traza = plan(cat_estrecho, dias=7, slots=SLOTS_5, seed=seed)
        assert r.ok
        if traza.reparaciones_duras:
            visto = True
        for dia in r.dias:
            suma = sum(c.totales.kcal for c in dia.comidas)
            assert dia.totales.kcal == pytest.approx(suma, abs=0.6)
    assert visto, "ninguna reparación dura se ejecutó: el test no prueba nada"


def test_ensamblado_no_empeora_el_voraz(cat):
    """Cubre "devolver el mejor visto, no el último", el error clásico de SA."""
    restr = solicitud(dias=7, slots=SLOTS_3).restricciones
    pool = construir_pool(cat, restr)
    for seed in (1, 2, 3):
        ctx = contexto_de(cat, pool, restr, 7, temperatura(45))
        objetivos = [ObjetivoNutricional(**objetivo())] * 7
        por_dia, _ = generar_candidatos(pool, ctx, objetivos, SLOTS_3, seed)
        res = ensamblar(pool, por_dia, seed, None, 1)
        assert res.coste_final <= res.coste_inicial + 1e-9


def test_semana_usa_menos_recetas_distintas_que_dias_sueltos(cat):
    """El ensamblado existe para acortar la lista; si no lo hace, sobra."""
    r, _ = plan(cat, dias=7, slots=SLOTS_3, seed=4)
    assert r.ok
    distintas = len({c.items[0].recetaId for d in r.dias for c in d.comidas})
    assert distintas < 7 * len(SLOTS_3)


def test_recetas_recientes_se_penalizan(cat):
    """Las recetas marcadas como recientes aparecen menos que en el control."""
    control = Counter()
    tratado = Counter()
    for seed in range(25):
        base, _ = plan(cat, slots=SLOTS_3, seed=seed)
        assert base.ok
        control.update(c.items[0].recetaId for c in base.dias[0].comidas)
    penalizadas = [rid for rid, _ in control.most_common(4)]
    for seed in range(25):
        r, _ = plan(cat, slots=SLOTS_3, seed=seed, recetasRecientes=penalizadas)
        assert r.ok
        tratado.update(c.items[0].recetaId for c in r.dias[0].comidas)
    antes = sum(control[r] for r in penalizadas)
    despues = sum(tratado[r] for r in penalizadas)
    assert despues < antes, (antes, despues)


def test_despensa_aumenta_su_uso(cat):
    """Con despensa, las recetas elegidas comparten más ingredientes con ella."""
    despensa = ["huevo", "avena_copos", "yogur_griego", "pechuga_pollo", "arroz_blanco"]
    bits = 0
    for a in despensa:
        bits |= 1 << cat.alimento_idx[a]

    def cobertura(**kw):
        total = 0.0
        n = 0
        for seed in range(20):
            r, _ = plan(cat, slots=SLOTS_3, seed=seed, **kw)
            assert r.ok
            for comida in r.dias[0].comidas:
                fila = cat.idx_por_id[comida.items[0].recetaId]
                receta = int.from_bytes(cat.ingr_bits[fila].tobytes(), "little")
                total += bin(receta & bits).count("1") / max(
                    1, int(cat.n_ingredientes[fila])
                )
                n += 1
        return total / n

    assert cobertura(despensaAlimentoIds=despensa) > cobertura()


# ---------------------------------------------------------------------------
# Fallo honesto
# ---------------------------------------------------------------------------


def test_siempre_exactamente_tres_sugerencias(cat):
    casos = [
        dict(dias=7, slots=SLOTS_3, dieta="vegana"),
        dict(
            slots=SLOTS_3, alergenosExcluidos=["gluten", "lacteos", "huevos", "pescado"]
        ),
        dict(slots=SLOTS_5, obj=objetivo(kcal=400, proteinaG={"min": 20, "max": 40})),
    ]
    hubo_fallo = False
    for caso in casos:
        r, _ = plan(cat, **caso)
        if r.ok:
            continue
        hubo_fallo = True
        assert len(r.fallo.sugerencias) == 3, r.fallo
        assert len(set(r.fallo.sugerencias)) == 3
        assert r.fallo.mensaje
        assert r.fallo.restriccionCulpable
    assert hubo_fallo, "ningún caso adverso falló: la batería no prueba nada"


def test_nunca_sugiere_relajar_alergeno(cat):
    """CRÍTICO (spec §11.3). Test de seguridad, no de calidad.

    El alérgeno puede ser el culpable —el usuario merece saberlo— pero jamás
    puede aparecer como una salida que se le ofrece pulsar.
    """
    prohibido = re.compile(
        r"al[eé]rgen|gluten|l[aá]cteo|huevo|pescado|crust[aá]ceo|cacahuete|"
        r"soja|frutos de c[aá]scara|apio|mostaza|s[eé]samo|sulfito|altramuz|molusco",
        re.IGNORECASE,
    )
    hubo_fallo = False
    for combinacion in (
        ["gluten", "lacteos", "huevos", "pescado"],
        ["gluten", "lacteos", "huevos", "pescado", "frutos_de_cascara", "soja"],
        ["lacteos", "huevos", "gluten"],
    ):
        for seed in range(3):
            r, _ = plan(
                cat, dias=7, slots=SLOTS_5, seed=seed, alergenosExcluidos=combinacion
            )
            if r.ok:
                continue
            hubo_fallo = True
            for s in r.fallo.sugerencias:
                assert not prohibido.search(s), f"sugerencia peligrosa: {s!r}"
    assert hubo_fallo


def test_nunca_sugiere_bajar_de_kcal_minimas(cat):
    """Ninguna sugerencia puede empujar por debajo del suelo de seguridad."""
    from app.solver import KCAL_MINIMAS_ABSOLUTO

    r, _ = plan(
        cat, slots=SLOTS_5, obj=objetivo(kcal=400, proteinaG={"min": 20, "max": 40})
    )
    assert not r.ok
    for s in r.fallo.sugerencias:
        for numero in re.findall(r"(\d+)\s*kcal", s):
            assert int(numero) >= KCAL_MINIMAS_ABSOLUTO, s


def test_cinco_comidas_pocas_kcal(cat):
    r, _ = plan(
        cat,
        slots=SLOTS_5,
        obj=objetivo(
            kcal=200,
            proteinaG={"min": 5, "max": 40},
            carbohidratoG={"min": 10, "max": 60},
            grasaG={"min": 2, "max": 20},
            fibraMinG=0,
        ),
    )
    assert not r.ok
    assert r.fallo.restriccionCulpable == "kcal_insuficientes_para_slots"
    assert (
        "comida" in r.fallo.sugerencias[0].lower()
        or "quitar" in r.fallo.sugerencias[0].lower()
    )


def test_proteina_imposible_identifica_culpable(cat):
    # El mínimo (antes 280 g) subió a 350 g al ampliar el catálogo: recetas
    # nuevas como claras de huevo con espinacas son tan densas en proteína
    # que 280 g dejó de superar la cota teórica `prot_max` de §6.2 y el fallo
    # pasaba a genérico. 350 g sigue por encima de esa cota — comprobado
    # contra el catálogo real, no adivinado — así que la rama que se quiere
    # probar (culpable = proteina_vs_kcal) sigue siendo la que dispara.
    r, _ = plan(
        cat,
        slots=SLOTS_3,
        obj=objetivo(
            kcal=1600,
            proteinaG={"min": 350, "max": 400},
            carbohidratoG={"min": 0, "max": 100},
            grasaG={"min": 0, "max": 45},
            fibraMinG=0,
        ),
    )
    assert not r.ok
    assert r.fallo.restriccionCulpable == "proteina_vs_kcal"
    assert r.fallo.recetasCandidatas == 240


def test_sugerencia_a_funciona(cat):
    """Lo que separa un diagnóstico honesto de uno decorativo.

    Se aplica literalmente la primera sugerencia y se vuelve a pedir plan: si
    el motor prometía algo que no puede cumplir, aquí sale.
    """
    # Mismo mínimo que test_proteina_imposible_identifica_culpable y por la
    # misma razón: tiene que seguir cayendo en la rama proteina_vs_kcal.
    obj = objetivo(
        kcal=1600,
        proteinaG={"min": 350, "max": 400},
        carbohidratoG={"min": 0, "max": 100},
        grasaG={"min": 0, "max": 45},
        fibraMinG=0,
    )
    r, _ = plan(cat, slots=SLOTS_3, obj=obj)
    assert not r.ok
    sugerencia = r.fallo.sugerencias[0]
    gramos = int(re.search(r"(\d+)\s*g", sugerencia).group(1))
    obj2 = dict(obj)
    obj2["proteinaG"] = {"min": gramos, "max": 330}
    r2, _ = plan(cat, slots=SLOTS_3, obj=obj2)
    assert r2.ok, (
        f"la sugerencia {sugerencia!r} no funciona: {getattr(r2, 'fallo', None)}"
    )


def test_macros_incompatibles_falla_pronto(cat):
    t = time.perf_counter()
    r, _ = plan(
        cat,
        obj=objetivo(
            kcal=1500,
            proteinaG={"min": 200, "max": 250},
            carbohidratoG={"min": 250, "max": 300},
            grasaG={"min": 80, "max": 100},
        ),
    )
    assert not r.ok
    assert r.fallo.restriccionCulpable == "macros_incompatibles"
    assert (time.perf_counter() - t) * 1000 < 50


def test_slot_sin_candidatos_falla_por_la_puerta_1(cat):
    r, _ = plan(cat, slots=SLOTS_3, minutosMaxPorSlot={"cena": 1})
    assert not r.ok
    assert r.fallo.restriccionCulpable.startswith("slot_sin_candidatos")


def test_pool_corto_por_filtros_si_falla(cat):
    """Puerta 2: cuando los filtros son la causa, se dice y se cuantifica."""
    r, _ = plan(
        cat,
        dias=7,
        slots=SLOTS_3,
        dieta="vegana",
        alergenosExcluidos=["gluten", "frutos_de_cascara"],
    )
    assert not r.ok
    assert r.fallo.recetasCandidatas < 0.5 * cat.n


def test_rango_invertido_es_error_de_cliente(cat):
    with pytest.raises(ObjetivoInvalido):
        generar(solicitud(obj=objetivo(proteinaG={"min": 200, "max": 100})), cat)


def test_kcal_cero_es_error_de_cliente(cat):
    with pytest.raises(ObjetivoInvalido):
        generar(solicitud(obj=objetivo(kcal=0)), cat)


def test_pool_vacio_no_revienta(cat):
    """Cero recetas admisibles debe dar un FalloGeneracion, nunca una traza."""
    r, _ = plan(cat, slots=SLOTS_3, ingredientesExcluidos=list(cat.alimento_idx))
    assert not r.ok
    assert r.fallo.recetasCandidatas == 0
    assert len(r.fallo.sugerencias) == 3


def test_ablacion_cuantifica_cada_eje(cat):
    """La ablación tiene que dar un número real por eje, no una etiqueta."""
    restr = RestriccionesGeneracion(
        dieta="vegana",
        alergenosExcluidos=["gluten"],
        slots=SLOTS_3,
        minutosMaxPorSlot={"desayuno": 10},
    )
    p0, ganancia = ablacion(mascaras_restriccion(cat, restr, SLOTS_3))
    assert p0 >= 0
    assert ganancia["dieta"] > 0  # quitar "vegana" abre mucho el catálogo
    assert ganancia["alergeno:gluten"] >= 0
    assert all(g >= 0 for g in ganancia.values())


# ---------------------------------------------------------------------------
# Honestidad con los datos
# ---------------------------------------------------------------------------


def test_sin_presupuesto_el_termino_de_coste_se_apaga(cat):
    _, traza = plan(cat)
    assert "coste:sin_presupuesto" in traza.terminos_desactivados


def test_con_presupuesto_el_coste_se_activa_si_hay_precios(cat):
    _, traza = plan(cat, dias=7, slots=SLOTS_3, presupuestoSemanalCents=7000)
    assert traza.terminos_desactivados == []


def test_fibra_se_reporta_solo_si_hay_dato(cat):
    """El catálogo semilla tiene fibra en todas las recetas: debe reportarse."""
    r, _ = plan(cat, slots=SLOTS_3)
    assert r.ok
    assert r.dias[0].totales.fibraG is not None


# ---------------------------------------------------------------------------
# Rendimiento y contrato HTTP
# ---------------------------------------------------------------------------


def test_dia_bajo_presupuesto(cat):
    """Objetivo de la tarea: < 2 s para un día. Se mide, no se estima."""
    tiempos = []
    for seed in range(50):
        t = time.perf_counter()
        r, _ = plan(cat, slots=SLOTS_5, seed=seed)
        tiempos.append((time.perf_counter() - t) * 1000)
        assert r.ok
    tiempos.sort()
    p95 = tiempos[int(0.95 * len(tiempos))]
    assert p95 < 600, (
        f"p95 = {p95:.0f} ms (mediana {statistics.median(tiempos):.0f} ms)"
    )


def test_semana_bajo_presupuesto(cat):
    tiempos = []
    for seed in range(20):
        t = time.perf_counter()
        r, _ = plan(cat, dias=7, slots=SLOTS_5, seed=seed)
        tiempos.append((time.perf_counter() - t) * 1000)
        assert r.ok
    tiempos.sort()
    assert tiempos[int(0.95 * len(tiempos))] < 2000


def test_ruta_http_devuelve_un_plan_real():
    cliente = TestClient(app)
    r = cliente.post(
        "/v1/plan/generate",
        json={
            "objetivos": [objetivo()],
            "restricciones": {"slots": SLOTS_3},
            "seed": 123,
        },
    )
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["ok"] is True
    assert len(cuerpo["dias"]) == 1
    assert cuerpo["msTranscurridos"] > 0
    assert r.headers["X-PlanEat-Seed"] == "123"
    assert r.headers["X-PlanEat-Catalogo"]
    assert r.headers["X-PlanEat-Generador"]


def test_ruta_http_devuelve_fallo_diagnosticado_con_200():
    """Un fallo diagnosticado no es un error de la petición: es una respuesta."""
    cliente = TestClient(app)
    r = cliente.post(
        "/v1/plan/generate",
        json={
            "objetivos": [objetivo(kcal=1500, proteinaG={"min": 200, "max": 250})],
            "restricciones": {"slots": SLOTS_3},
            "seed": 1,
        },
    )
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["ok"] is False
    assert len(cuerpo["fallo"]["sugerencias"]) == 3


def test_ruta_http_objetivo_mal_formado_es_422():
    cliente = TestClient(app)
    r = cliente.post(
        "/v1/plan/generate",
        json={
            "objetivos": [objetivo(proteinaG={"min": 200, "max": 100})],
            "restricciones": {"slots": SLOTS_3},
        },
    )
    assert r.status_code == 422
    assert r.json()["fallo"]["restriccionCulpable"] == "objetivo_mal_formado"


def test_ruta_http_sin_seed_devuelve_la_semilla_usada():
    """Sin la cabecera, un plan generado sin seed no se puede reproducir jamás."""
    cliente = TestClient(app)
    payload = {"objetivos": [objetivo()], "restricciones": {"slots": SLOTS_3}}
    r = cliente.post("/v1/plan/generate", json=payload)
    assert r.status_code == 200
    semilla = int(r.headers["X-PlanEat-Seed"])
    repetido = cliente.post("/v1/plan/generate", json={**payload, "seed": semilla})
    assert repetido.json()["dias"] == r.json()["dias"]


def test_cuotas_suman_uno():
    assert sum(cuotas_de(SLOTS_5).values()) == pytest.approx(1.0)
    assert sum(cuotas_de(["desayuno", "cena"]).values()) == pytest.approx(1.0)


def test_orden_canonico_de_slots_en_la_salida(cat):
    r, _ = plan(cat, slots=["cena", "almuerzo", "desayuno"])
    assert r.ok
    indices = [IDX_SLOT[c.slot] for c in r.dias[0].comidas]
    assert indices == sorted(indices)
