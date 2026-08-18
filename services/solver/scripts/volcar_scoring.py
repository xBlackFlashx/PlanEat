"""Vuelca la referencia de la etapa A (`scoring.py`) para el port a TypeScript.

Lo consume `packages/motor/pruebas/scoring.test.ts`, que compara contra este
volcado en vez de contra números escritos a mano: un término del score mal
portado no da error, da otro plan, y sólo el original sabe cuál es el bueno.

Se vuelca lo que NO depende del generador de aleatoriedad —el port usa un árbol
propio por decisión de `docs/port-typescript.md`—: el vector de scores completo,
el conjunto y el orden del top-K, y el vector de probabilidades del softmax.
Los tres se capturan con un RNG falso que registra la `p` que recibe y devuelve
el índice que se le pida, así que la comparación aísla el scoring del muestreo.

Uso:

    cd services/solver
    ./.venv/bin/python scripts/volcar_scoring.py \
        ../../packages/motor/pruebas/datos/referencia-python-scoring.json
"""

from __future__ import annotations

import dataclasses
import json
import math
import sys

import numpy as np

from app.catalogo import cargar_catalogo
from app.schemas import RestriccionesGeneracion
from app.solver import FRACCION_MINIMA_PRECIOS, IDX_SLOT, TOP_K
from app.solver.scoring import (
    construir_pool,
    contexto_de,
    cuotas_de,
    muestrear,
    orden_de_slots,
    penalizacion_repeticion,
    score_slot,
    sigma_sugerido,
    totales_de,
    vector_macro,
)

CAT = cargar_catalogo()


def f(x):
    """Flotante serializado con repr (17 dígitos) o centinela para ±inf/NaN."""
    x = float(x)
    if math.isinf(x):
        return "-inf" if x < 0 else "inf"
    if math.isnan(x):
        return "nan"
    return x


def vec(a):
    return [f(x) for x in np.asarray(a).ravel().tolist()]


def restr(**kw):
    base = dict(
        dieta="omnivora",
        alergenosExcluidos=[],
        ingredientesExcluidos=[],
        slots=["desayuno", "comida", "cena"],
        comensales=1,
    )
    base.update(kw)
    return RestriccionesGeneracion(**base)


ESCENARIOS = []


def escenario(nombre, r, *, n_dias=7, tau=0.37, residuo, slot, excluidas=(),
              bits_semana=None, veto_semana=None, veto_slot=None,
              sin_precio_desde=None, sin_precio_bajo_umbral=None):
    pool = construir_pool(CAT, r)
    sin_precio = []
    if sin_precio_bajo_umbral is not None:
        # `coste_conocido` es 1 para todo el catálogo semilla, así que la puerta
        # FRACCION_MINIMA_PRECIOS no se puede disparar con datos reales: se
        # fuerza aquí borrando el precio de las últimas filas del pool. El
        # índice se calcula a partir de pool.p y no se fija a mano — un número
        # fijo sólo cae justo en el umbral para el tamaño de catálogo con el
        # que se escribió, y deja de ser el caso en cuanto el catálogo crece.
        umbral = math.ceil(FRACCION_MINIMA_PRECIOS * pool.p)
        desde = (umbral - 1) if sin_precio_bajo_umbral else umbral
        desde = max(0, min(pool.p, desde))
        cc = pool.coste_conocido.copy()
        cc[desde:] = False
        sin_precio = list(range(desde, pool.p))
        pool = dataclasses.replace(pool, coste_conocido=cc)
    elif sin_precio_desde is not None:
        cc = pool.coste_conocido.copy()
        cc[sin_precio_desde:] = False
        sin_precio = list(range(sin_precio_desde, pool.p))
        pool = dataclasses.replace(pool, coste_conocido=cc)
    ctx = contexto_de(CAT, pool, r, n_dias, tau)
    if bits_semana is not None:
        ctx.bits_semana = np.array(bits_semana, dtype=np.uint64)
    if veto_semana is not None:
        m = np.zeros(pool.p, dtype=bool)
        m[list(veto_semana)] = True
        ctx.veto_semana = m
    if veto_slot is not None:
        ctx.veto_slot = dict(veto_slot)
    excl = np.zeros(pool.p, dtype=bool)
    for i in excluidas:
        excl[i] = True
    res = np.array(residuo, dtype=np.float64)
    s = score_slot(pool, ctx, slot, res, excl)

    # Recuperar `cand` y `p` de muestrear sin tocar el RNG real.
    capt = {}

    class RngFalso:
        def __init__(self, k):
            self.k = k

        def choice(self, n, p=None):
            capt["p"] = vec(p)
            capt["n"] = int(n)
            return self.k

    j0 = muestrear(s, pool.ids, tau, RngFalso(0))
    cand = []
    if j0 is not None and "n" in capt:
        for k in range(capt["n"]):
            cand.append(int(muestrear(s, pool.ids, tau, RngFalso(k))))
    elif j0 is not None:
        cand = [int(j0)]

    ESCENARIOS.append(
        {
            "nombre": nombre,
            "restr": r.model_dump(),
            "nDias": n_dias,
            "tau": tau,
            "residuo": vec(res),
            "slot": slot,
            "excluidas": [int(i) for i in excluidas],
            "sinPrecio": sin_precio,
            "bitsSemana64": [str(int(x)) for x in np.asarray(ctx.bits_semana).tolist()],
            "vetoSemana": sorted(int(i) for i in np.flatnonzero(ctx.veto_semana))
            if ctx.veto_semana is not None
            else None,
            "vetoSlot": {k: int(v) for k, v in ctx.veto_slot.items()},
            "p": int(pool.p),
            "ids": [str(x) for x in pool.ids.tolist()],
            "pesoCoste": f(ctx.peso_coste),
            "umbralCoste": f(ctx.umbral_coste),
            "costeDesactivadoPor": ctx.coste_desactivado_por,
            "cuota": {k: f(v) for k, v in ctx.cuota.items()},
            "penRep": vec(ctx.pen_rep),
            "score": vec(s),
            "candidatos": cand,
            "probabilidades": capt.get("p"),
            "elegidoConSorteo0": None if j0 is None else int(j0),
        }
    )


RES_TIPICO = [2200.0, 110.0, 250.0, 70.0, 30.0, 2000.0]

escenario("base-comida", restr(), residuo=RES_TIPICO, slot="comida")
escenario("base-desayuno", restr(), residuo=RES_TIPICO, slot="desayuno")
escenario(
    "residuo-cubierto",
    restr(),
    residuo=[-100.0, -5.0, -10.0, -3.0, 0.0, 0.0],
    slot="cena",
)
escenario(
    "macro-parcial-negativo",
    restr(),
    residuo=[1500.0, -20.0, 180.0, 40.0, 12.0, 900.0],
    slot="comida",
)
escenario(
    "despensa-y-presupuesto",
    restr(
        despensaAlimentoIds=["arroz_integral", "aceite_oliva", "tomate", "cebolla",
                             "huevo", "pechuga_pollo", "lentejas_cocidas",
                             "yogur_natural", "no_existe_este_alimento"],
        presupuestoSemanalCents=21000,
        comensales=2,
    ),
    residuo=RES_TIPICO,
    slot="comida",
)
escenario(
    "presupuesto-sin-precios",
    restr(presupuestoSemanalCents=14000),
    residuo=RES_TIPICO,
    slot="comida",
    sin_precio_bajo_umbral=True,
)
escenario(
    "presupuesto-con-precios-justo-en-el-umbral",
    restr(presupuestoSemanalCents=14000),
    residuo=RES_TIPICO,
    slot="comida",
    sin_precio_bajo_umbral=False,
)
escenario(
    "presupuesto-cero",
    restr(presupuestoSemanalCents=0),
    residuo=RES_TIPICO,
    slot="comida",
)
escenario(
    "recientes-con-duplicados",
    restr(
        recetasRecientes=[
            "pollo_arroz_brocoli", "lentejas_guisadas", "yogur_nueces",
            "pollo_arroz_brocoli", "salmon_calabacin", "wrap_pollo",
            "curry_garbanzos", "lentejas_guisadas", "manzana_almendras",
            "no_existe_esta_receta", "sopa_pollo_verduras",
        ],
    ),
    residuo=RES_TIPICO,
    slot="comida",
)
escenario(
    "topes-de-minutos",
    restr(minutosMaxPorSlot={"desayuno": 10, "comida": 25, "cena": 20}),
    residuo=RES_TIPICO,
    slot="cena",
)
escenario(
    "solape-semanal",
    restr(),
    residuo=RES_TIPICO,
    slot="comida",
    bits_semana=[0x00FF00FF00FF00FF, 0x0000000000000003],
)
escenario(
    "vetos-que-dejan-algo",
    restr(),
    residuo=RES_TIPICO,
    slot="comida",
    veto_semana=[0, 1, 2, 3, 4],
    veto_slot={"comida": 5},
)
escenario(
    "vetos-que-vacian",
    restr(dieta="vegana"),
    residuo=RES_TIPICO,
    slot="desayuno",
    veto_semana=list(range(8)),
)
escenario(
    "excluidas-del-dia",
    restr(),
    residuo=RES_TIPICO,
    slot="comida",
    excluidas=[0, 1, 2, 3, 4, 5, 6, 7],
)

# --- Funciones puras -------------------------------------------------------

CUOTAS = []
for slots in (
    ["desayuno", "comida", "cena"],
    ["desayuno", "almuerzo", "comida", "merienda", "cena"],
    ["comida"],
    ["merienda", "almuerzo"],
    ["cena", "comida", "desayuno"],
):
    CUOTAS.append(
        {
            "slots": slots,
            "cuotas": {k: f(v) for k, v in cuotas_de(slots).items()},
            "orden": orden_de_slots(slots),
        }
    )

VECTORES_MACRO = []
for r in (
    [2000.0, 100.0, 250.0, 70.0, 25.0, 2000.0],
    [0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [100.0, -5.0, -3.0, -1.0, 0.0, 0.0],
    [100.0, -5.0, 30.0, 0.0, 0.0, 0.0],
    [500.0, 40.0, 0.0, 0.0, 0.0, 0.0],
    [1.0, 1e-9, 1e-9, 1e-9, 0.0, 0.0],
):
    VECTORES_MACRO.append({"residuo": vec(r), "v": vec(vector_macro(np.array(r)))})

POOL_BASE = construir_pool(CAT, restr())
SIGMAS = []
for j in (0, 3, 7, 12, 20):
    for res_k in (2200.0, 0.0, -50.0, 60000.0):
        res = np.array([res_k, 100.0, 200.0, 60.0, 20.0, 1500.0])
        SIGMAS.append(
            {
                "j": j,
                "residuo": vec(res),
                "cuota": 0.35,
                "sigma": f(sigma_sugerido(POOL_BASE, j, res, 0.35)),
            }
        )

TOTALES = []
for filas, sig in (
    ([0, 5, 11], [1.0, 0.6, 1.35]),
    ([2], [1.8]),
    ([], []),
    ([1, 2, 3, 4, 5], [0.6, 0.75, 1.0, 1.25, 1.8]),
):
    TOTALES.append(
        {
            "filas": filas,
            "sigmas": vec(sig),
            "totales": vec(totales_de(POOL_BASE, filas, np.array(sig, dtype=np.float64))),
        }
    )

PENALIZACIONES = []
A, B, C, D, E = ("pollo_arroz_brocoli", "lentejas_guisadas", "yogur_nueces",
                 "curry_garbanzos", "wrap_pollo")
for recientes, n_slots in (
    ([A, B, C], 3),
    ([A, A, B], 3),
    ([A, B, C, A, D, E, B, C], 3),
    (["desconocida", A], 5),
    ([], 3),
    ([A, B], 0),
    ([A, "desconocida", "desconocida", B, C], 2),
):
    PENALIZACIONES.append(
        {
            "recientes": recientes,
            "nSlots": n_slots,
            "pen": vec(penalizacion_repeticion(CAT, POOL_BASE, recientes, n_slots)),
        }
    )

# --- muestrear sintético: empates y top-K ----------------------------------

MUESTREOS = []


def muestreo(nombre, scores, ids, tau):
    s = np.asarray(scores, dtype=np.float32)
    ids_a = np.asarray(ids, dtype=object)
    capt = {}

    class RngFalso:
        def __init__(self, k):
            self.k = k

        def choice(self, n, p=None):
            capt["p"] = vec(p)
            capt["n"] = int(n)
            return self.k

    j0 = muestrear(s, ids_a, tau, RngFalso(0))
    cand = []
    if j0 is not None and "n" in capt:
        cand = [int(muestrear(s, ids_a, tau, RngFalso(k))) for k in range(capt["n"])]
    elif j0 is not None:
        cand = [int(j0)]
    MUESTREOS.append(
        {
            "nombre": nombre,
            "scores": vec(s),
            "ids": list(ids),
            "tau": tau,
            "candidatos": cand,
            "probabilidades": capt.get("p"),
        }
    )


muestreo("vacio", [float("-inf")] * 5, [f"id{i}" for i in range(5)], 0.37)
muestreo("uno-solo", [float("-inf"), 3.0, float("-inf")], ["a", "b", "c"], 0.37)
muestreo("todos-iguales-30", [1.0] * 30, [f"id{i:02d}" for i in range(30)], 0.37)
muestreo(
    "todos-iguales-30-ids-descendentes",
    [1.0] * 30,
    [f"id{29 - i:02d}" for i in range(30)],
    0.37,
)
muestreo(
    "empate-en-el-umbral",
    [5.0] * 20 + [2.0] * 15,
    [f"z{i:02d}" for i in range(20)] + [f"a{i:02d}" for i in range(15)],
    0.37,
)
muestreo(
    "gradiente-40",
    [float(i) * 0.1 for i in range(40)],
    [f"id{i:02d}" for i in range(40)],
    0.37,
)
muestreo("tau-minima", [float(i) * 0.1 for i in range(30)], [f"id{i:02d}" for i in range(30)], 0.12)
muestreo("tau-cero", [float(i) * 0.1 for i in range(5)], [f"id{i}" for i in range(5)], 0.0)
muestreo("desviacion-nula", [2.5] * 3, ["c", "a", "b"], 0.37)

SALIDA = {
    "versionCatalogo": CAT.version,
    "topK": TOP_K,
    "idxSlot": dict(IDX_SLOT),
    "escenarios": ESCENARIOS,
    "cuotas": CUOTAS,
    "vectoresMacro": VECTORES_MACRO,
    "sigmas": SIGMAS,
    "totales": TOTALES,
    "penalizaciones": PENALIZACIONES,
    "muestreos": MUESTREOS,
}

destino = sys.argv[1]
with open(destino, "w", encoding="utf-8") as fh:
    json.dump(SALIDA, fh, ensure_ascii=False, indent=1)
print("escrito", destino)
