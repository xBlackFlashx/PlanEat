"""Determinismo y reproducibilidad. DISENO.md §8.1.

Determinismo no es un lujo de tests: es requisito de soporte. Un plan que no se
puede volver a construir no se puede depurar cuando el usuario escribe diciendo
que su martes estaba mal.

Lo único de la respuesta que legítimamente cambia entre dos ejecuciones
idénticas es `msTranscurridos` (mide tiempo real) y `DiaPlan.fecha` (deriva del
reloj y de nada más, §2.6). Todo lo demás se compara byte a byte.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from app.catalogo import cargar_catalogo
from app.schemas import SolicitudGeneracion
from app.solver import rng_de
from app.solver.motor import generar

RAIZ = Path(__file__).resolve().parent.parent
SLOTS_3 = ["desayuno", "comida", "cena"]
SLOTS_5 = ["desayuno", "almuerzo", "comida", "merienda", "cena"]

OBJETIVO = {
    "kcal": 2100,
    "toleranciaKcal": 0.05,
    "proteinaG": {"min": 130, "max": 165},
    "carbohidratoG": {"min": 190, "max": 260},
    "grasaG": {"min": 58, "max": 82},
    "fibraMinG": 22,
}


@pytest.fixture(scope="module")
def cat():
    return cargar_catalogo()


def _peticion(dias=1, slots=None, seed=1, **restricciones) -> SolicitudGeneracion:
    return SolicitudGeneracion(
        objetivos=[OBJETIVO] * dias,
        restricciones={"slots": slots or SLOTS_3, **restricciones},
        seed=seed,
    )


def _huella(respuesta) -> str:
    """JSON canónico del plan, sin lo que legítimamente varía.

    `fecha` se excluye porque deriva del reloj y no de una decisión;
    `msTranscurridos` porque mide tiempo real. Excluir cualquier otra cosa
    sería tapar un fallo de reproducibilidad.
    """
    datos = respuesta.model_dump()
    if datos["ok"]:
        for dia in datos["dias"]:
            dia.pop("fecha")
        datos.pop("msTranscurridos")
    return json.dumps(datos, sort_keys=True, ensure_ascii=False)


# ---------------------------------------------------------------------------


def test_mismo_seed_mismo_plan_un_dia(cat):
    peticion = _peticion(slots=SLOTS_5, seed=4242)
    huellas = {_huella(generar(peticion, cat)[0]) for _ in range(10)}
    assert len(huellas) == 1


def test_mismo_seed_mismo_plan_una_semana(cat):
    peticion = _peticion(dias=7, slots=SLOTS_5, seed=4242)
    huellas = {_huella(generar(peticion, cat)[0]) for _ in range(6)}
    assert len(huellas) == 1


def test_mismo_seed_mismo_plan_con_todas_las_restricciones(cat):
    """El camino con más estado: despensa, presupuesto, recientes y topes.

    Es donde más fácil se cuela una dependencia del orden de un `set`.
    """
    peticion = _peticion(
        dias=7,
        slots=SLOTS_5,
        seed=99,
        dieta="mediterranea",
        alergenosExcluidos=["crustaceos", "moluscos"],
        ingredientesExcluidos=["huevo", "arroz_blanco"],
        minutosMaxPorSlot={"desayuno": 10, "merienda": 5},
        presupuestoSemanalCents=9000,
        despensaAlimentoIds=["avena_copos", "yogur_griego", "pechuga_pollo"],
        recetasRecientes=["wrap_pollo", "ensalada_pasta_atun"],
        comensales=2,
    )
    huellas = {_huella(generar(peticion, cat)[0]) for _ in range(6)}
    assert len(huellas) == 1


def test_el_fallo_tambien_es_determinista(cat):
    """El diagnóstico se lee en soporte: si cambia entre llamadas, no sirve."""
    # El mínimo (300 g -> 350 g -> 400 g) sube otra vez, en la cuarta ronda de
    # "menos ingredientes": el catálogo de datos (ingredientes.json) sigue
    # ganando densidad proteica en trabajo ajeno a esta ronda (fuera de su
    # alcance tocarlo), así que 350 g dejó de ser un objetivo probadamente
    # imposible -el plan empezaba a salir OK, comprobado contra el catálogo
    # real, no adivinado-. 400 g sigue fallando de forma determinista (5/5)
    # con el catálogo actual.
    peticion = SolicitudGeneracion(
        objetivos=[
            {
                **OBJETIVO,
                "kcal": 1600,
                "proteinaG": {"min": 400, "max": 450},
                "carbohidratoG": {"min": 0, "max": 100},
                "grasaG": {"min": 0, "max": 45},
                "fibraMinG": 0,
            }
        ],
        restricciones={"slots": SLOTS_3},
        seed=5,
    )
    respuestas = [generar(peticion, cat)[0] for _ in range(5)]
    assert all(not r.ok for r in respuestas)
    assert len({_huella(r) for r in respuestas}) == 1


def test_seeds_distintos_dan_planes_distintos(cat):
    """Si el seed no mueve nada, el re-roll de la spec §6.2 no existe."""
    huellas = {
        _huella(generar(_peticion(slots=SLOTS_5, seed=s), cat)[0]) for s in range(20)
    }
    assert len(huellas) >= 12, f"sólo {len(huellas)} planes distintos en 20 seeds"


def test_el_orden_de_los_slots_no_cambia_el_plan(cat):
    a = generar(
        _peticion(slots=["cena", "merienda", "desayuno", "comida"], seed=8), cat
    )[0]
    b = generar(
        _peticion(slots=["desayuno", "comida", "merienda", "cena"], seed=8), cat
    )[0]
    assert _huella(a) == _huella(b)


def test_el_orden_de_los_alergenos_no_cambia_el_plan(cat):
    a = generar(_peticion(seed=8, alergenosExcluidos=["lacteos", "gluten"]), cat)[0]
    b = generar(_peticion(seed=8, alergenosExcluidos=["gluten", "lacteos"]), cat)[0]
    assert _huella(a) == _huella(b)


def test_arbol_de_semillas_da_flujos_independientes():
    """Dos nodos del árbol nunca comparten flujo. §2.6

    Es la propiedad que hace que añadir un slot o un reintento no desplace el
    resto del plan, y la que permitiría paralelizar sin cambiar el resultado.
    """
    a = rng_de(7, 0, 1, 2, 3).random(50)
    b = rng_de(7, 0, 1, 2, 4).random(50)
    c = rng_de(7, 0, 1, 2, 3).random(50)
    assert np.array_equal(a, c)
    assert not np.array_equal(a, b)


def test_consumir_un_nodo_no_afecta_a_los_demas():
    esperado = rng_de(11, 1).random(10)
    rng_de(11, 0).random(10_000)  # se consume otro nodo a lo bestia
    assert np.array_equal(rng_de(11, 1).random(10), esperado)


def test_determinismo_independiente_de_pythonhashseed(cat):
    """Si algún camino itera un `set` sin ordenar, esto lo destapa.

    Se lanzan dos subprocesos con `PYTHONHASHSEED` distinto: el hash de las
    cadenas cambia, luego el orden de iteración de cualquier `set` de ids
    cambia, y el plan tendría que cambiar con él si hubiera una fuga.
    """
    guion = "\n".join(
        [
            "import json, sys",
            f"sys.path.insert(0, {str(RAIZ)!r})",
            "from app.catalogo import cargar_catalogo",
            "from app.schemas import SolicitudGeneracion",
            "from app.solver.motor import generar",
            f"objetivo = {json.dumps(OBJETIVO)}",
            f"slots = {SLOTS_5!r}",
            "s = SolicitudGeneracion(objetivos=[objetivo] * 3, restricciones={"
            "'slots': slots, 'alergenosExcluidos': ['crustaceos'], "
            "'despensaAlimentoIds': ['huevo', 'avena_copos'], "
            "'recetasRecientes': ['wrap_pollo']}, seed=31337)",
            "r, _ = generar(s, cargar_catalogo())",
            "d = r.model_dump()",
            "[x.pop('fecha') for x in d['dias']]",
            "d.pop('msTranscurridos')",
            "print(json.dumps(d, sort_keys=True, ensure_ascii=False))",
        ]
    )

    salidas = []
    for semilla_hash in ("0", "1", "12345"):
        entorno = {**os.environ, "PYTHONHASHSEED": semilla_hash}
        proceso = subprocess.run(
            [sys.executable, "-c", guion],
            capture_output=True,
            text=True,
            cwd=RAIZ,
            env=entorno,
            check=True,
        )
        salidas.append(proceso.stdout.strip())
    assert len(set(salidas)) == 1, "el plan depende de PYTHONHASHSEED"


def test_la_cache_del_pool_no_altera_el_resultado(cat):
    """Primera llamada = fallo de caché, segunda = acierto. Deben coincidir."""
    from app.solver.scoring import invalidar_cache_pool

    peticion = _peticion(dias=3, slots=SLOTS_5, seed=77)
    invalidar_cache_pool()
    frio = _huella(generar(peticion, cat)[0])
    caliente = _huella(generar(peticion, cat)[0])
    assert frio == caliente


def test_recargar_el_catalogo_no_cambia_el_plan(cat):
    """`cargar_catalogo` es determinista: mismo fichero, mismos arrays y versión."""
    otro = cargar_catalogo()
    assert otro.version == cat.version
    peticion = _peticion(dias=3, slots=SLOTS_5, seed=1234)
    assert _huella(generar(peticion, cat)[0]) == _huella(generar(peticion, otro)[0])
