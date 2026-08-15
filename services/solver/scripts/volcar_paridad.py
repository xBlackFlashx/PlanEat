"""Volcado masivo de referencias para el arnés de paridad del port a TypeScript.

Complementa a `exportar_fixtures.py`, que congela un puñado de casos legibles a
mano (7 del LP, 6 planes, 4 diagnósticos) en JSON indentado. Esto es lo otro: el
volcado **masivo** y de **funciones puras**, en JSONL, pensado para que un runner
lo recorra línea a línea sin cargarlo entero en memoria. No se duplica ni un caso
de `exportar_fixtures.py`; aquel sigue siendo la referencia humana y éste la
referencia de máquina.

Por qué hacen falta las dos cosas por separado (docs/port-typescript.md,
«Estrategia de pruebas»):

1. **Nivel 0 — funciones puras.** No dependen ni del RNG ni de HiGHS, así que
   aquí la paridad se exige a 1e-12 y sin excusas. Si `error_de` no coincide, no
   hay nada que discutir sobre el porcionador. `funciones-puras.jsonl` es
   entrada → salida de cada una de ellas.
2. **Nivel 1 — etapa B aislada.** El port sustituye HiGHS por descenso coordinado
   sobre la rejilla, así que E_ts y E_py son resultados de dos heurísticas sobre
   el mismo conjunto finito. Compararlos exige **inyectar** la selección de
   recetas desde aquí: comparar planes de extremo a extremo no valida nada
   mientras el RNG sea distinto por decisión explícita. `porciones.jsonl` son
   ≥2.000 instancias con sus entradas exactas y el resultado de HiGHS.

Lo que NO emite este script, y por qué: el catálogo compilado (lo emite
`packages/motor/herramientas/compilar-catalogo.ts`, que es quien decide el
formato columnar y el hash de versión) y los textos del diagnóstico (los
mensajes se validan contra golden vectors regenerados desde el TS, porque el
port corrige dos bugs de mensajes a propósito).

Precisión: todos los flotantes se serializan con `repr()`, que en CPython 3 es la
cadena decimal **más corta que round-trippea al mismo double**. `json.dumps` ya
usa `float.__repr__`, así que basta con no meterse en medio; aun así `Volcador`
comprueba línea a línea que el round-trip devuelve los mismos bits (`_mismos_bits`
compara con `float.hex()`, no con `==`).

Uso:

    cd services/solver && source .venv/bin/activate
    python scripts/volcar_paridad.py
    python scripts/volcar_paridad.py --salida ../../packages/motor/pruebas/datos/
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sys
from pathlib import Path
from typing import Any

import numpy as np

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from app.catalogo import cargar_catalogo  # noqa: E402
from app.schemas import SolicitudGeneracion  # noqa: E402
from app.solver import (  # noqa: E402
    EPS_REG,
    INF_HIGHS,
    PASO_RACION,
    SLOTS,
    UMBRAL_ERROR_ACEPTABLE,
    UMBRAL_ERROR_OK,
    VERSION_GENERADOR,
    temperatura,
)
from app.solver import diagnostico as diag  # noqa: E402
from app.solver import porciones as porc  # noqa: E402
from app.solver import reparacion as rep  # noqa: E402
from app.solver import scoring as sco  # noqa: E402
from app.solver.motor import _min_candidatos_slot, generar  # noqa: E402

SALIDA_POR_DEFECTO = RAIZ / "data" / "paridad"

# Semilla del generador de escenarios. Fija a propósito: el volcado se versiona
# y dos ejecuciones tienen que producir el mismo fichero, byte a byte.
SEMILLA_ESCENARIOS = 20260815

MIN_INSTANCIAS_B = 2000

SLOTS_1 = ["comida"]
SLOTS_2 = ["comida", "cena"]
SLOTS_3 = ["desayuno", "comida", "cena"]
SLOTS_4 = ["desayuno", "comida", "merienda", "cena"]
SLOTS_5 = list(SLOTS)


# ---------------------------------------------------------------------------
# Serialización
# ---------------------------------------------------------------------------


def _plano(x: Any) -> Any:
    """numpy -> tipos de Python, sin perder un bit por el camino.

    `float(np.float32)` da el double exacto que representa ese float32, que es
    justo lo que el lado TS leerá al escribir el valor en un `Float32Array` y
    volver a leerlo. No se redondea nada aquí.
    """
    if isinstance(x, (np.floating,)):
        return float(x)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.bool_,)):
        return bool(x)
    if isinstance(x, np.ndarray):
        return [_plano(v) for v in x.tolist()]
    if isinstance(x, dict):
        return {str(k): _plano(v) for k, v in x.items()}
    if isinstance(x, (list, tuple, set, frozenset)):
        return [_plano(v) for v in x]
    return x


def _sin_infinitos(x: Any, ruta: str = "") -> None:
    """Aborta si se cuela un NaN o un inf.

    El modelo usa 1e30 como «sin cota» precisamente para no tener que
    serializar infinitos: `Infinity` no existe en JSON y cada biblioteca lo
    inventa a su manera. Si aparece uno es un bug del volcado, no un dato.
    """
    if isinstance(x, float):
        if math.isnan(x) or math.isinf(x):
            raise ValueError(f"flotante no finito en {ruta or '<raíz>'}: {x!r}")
    elif isinstance(x, dict):
        for k, v in x.items():
            _sin_infinitos(v, f"{ruta}.{k}")
    elif isinstance(x, list):
        for i, v in enumerate(x):
            _sin_infinitos(v, f"{ruta}[{i}]")


def _mismos_bits(a: Any, b: Any) -> bool:
    if isinstance(a, float) or isinstance(b, float):
        return isinstance(a, float) and isinstance(b, float) and a.hex() == b.hex()
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_mismos_bits(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(
            _mismos_bits(u, v) for u, v in zip(a, b, strict=True)
        )
    return a == b


class Volcador:
    """Escribe JSONL comprobando cada línea. Un fichero mal serializado que se
    descubre en el runner de TS cuesta una sesión de depuración en el lado
    equivocado del port; comprobarlo aquí cuesta microsegundos.
    """

    def __init__(self, ruta: Path) -> None:
        self.ruta = ruta
        self.lineas = 0
        self._f = ruta.open("w", encoding="utf-8")

    def escribir(self, registro: dict) -> None:
        limpio = _plano(registro)
        _sin_infinitos(limpio)
        texto = json.dumps(limpio, ensure_ascii=False, sort_keys=False)
        if not _mismos_bits(limpio, json.loads(texto)):
            raise ValueError(f"round-trip JSON no exacto en {registro.get('fn')}")
        self._f.write(texto + "\n")
        self.lineas += 1

    def cerrar(self) -> None:
        self._f.close()


# ---------------------------------------------------------------------------
# Constructores de entradas realistas
# ---------------------------------------------------------------------------


def objetivo_dict(**cambios) -> dict:
    """Objetivo diario de referencia (~2.000 kcal). No es consejo nutricional."""
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


def solicitud(objetivos: list[dict], slots: list[str], seed: int, **restr):
    return SolicitudGeneracion(
        objetivos=objetivos,
        restricciones={"slots": slots, **restr},
        seed=seed,
    )


def objetivo_modelo(d: dict):
    return solicitud([d], SLOTS_3, 1).objetivos[0]


def restricciones_modelo(slots: list[str], **restr):
    return solicitud([objetivo_dict()], slots, 1, **restr).restricciones


def _bandas_json(b) -> dict:
    return {
        "lo": b.lo,
        "hi": b.hi,
        "wMas": b.w_mas,
        "wMenos": b.w_menos,
        "e": b.e,
        "pesoTotal": b.peso_total,
    }


def _a_filas(a: np.ndarray) -> list[float]:
    """`a` es (6, R) y viaja **aplanada en row-major**, igual que el Float64Array
    del port: 6 filas de nutriente × R recetas. El orden es contrato."""
    return [float(v) for v in np.ascontiguousarray(a, dtype=np.float64).ravel()]


def _bucket(e: float) -> str:
    """Lo único observable del error: dispara la reparación y dispara ok:false."""
    if e <= UMBRAL_ERROR_OK:
        return "ok"
    if e <= UMBRAL_ERROR_ACEPTABLE:
        return "aceptable"
    return "malo"


# ---------------------------------------------------------------------------
# Bloque 1 — funciones puras (nivel 0 de la estrategia de pruebas)
# ---------------------------------------------------------------------------

# Objetivos que recorren la casuística de `bandas_de`: con y sin fibra, con y sin
# sodio, tolerancia cero, rangos degenerados (min == max) y un objetivo
# inalcanzable a propósito.
OBJETIVOS_PUROS: list[tuple[str, dict]] = [
    ("base", objetivo_dict()),
    ("sin_fibra", objetivo_dict(fibraMinG=0)),
    ("con_sodio", objetivo_dict(sodioMaxMg=1800)),
    ("sin_fibra_con_sodio", objetivo_dict(fibraMinG=0, sodioMaxMg=2300)),
    ("tolerancia_cero", objetivo_dict(toleranciaKcal=0.0)),
    ("tolerancia_alta", objetivo_dict(toleranciaKcal=0.5)),
    ("rango_degenerado", objetivo_dict(proteinaG={"min": 140, "max": 140})),
    ("kcal_bajas", objetivo_dict(kcal=900, toleranciaKcal=0.02, fibraMinG=0)),
    (
        "proteina_imposible",
        objetivo_dict(kcal=1500, proteinaG={"min": 220, "max": 260}, sodioMaxMg=1500),
    ),
    ("macros_altos", objetivo_dict(kcal=3200, grasaG={"min": 90, "max": 130})),
]

# Máscaras de nutrientes activos. La primera es «todos», y las demás recorren los
# dos apagados reales (fibra sin dato, sodio sin tope) más el caso extremo de
# ninguno activo, que es el que hace que `error_de` devuelva 0,0 por peso total
# nulo: una rama de una línea, y la más fácil de portar mal.
ACTIVOS_PUROS: list[tuple[str, list[bool] | None]] = [
    ("nulo", None),
    ("todos", [True] * 6),
    ("sin_fibra", [True, True, True, True, False, True]),
    ("sin_sodio", [True, True, True, True, True, False]),
    ("sin_fibra_ni_sodio", [True, True, True, True, False, False]),
    ("solo_kcal", [True, False, False, False, False, False]),
    ("ninguno", [False] * 6),
]

# Vectores de totales con los que se evalúan desviaciones/error/culpabilidad:
# dentro de banda, por encima, por debajo, y mezclas.
TOTALES_PUROS: list[tuple[str, list[float]]] = [
    ("dentro", [2000.0, 140.0, 210.0, 67.0, 25.0, 1500.0]),
    ("kcal_alto", [2400.0, 140.0, 260.0, 80.0, 25.0, 1500.0]),
    ("kcal_bajo", [1500.0, 90.0, 150.0, 40.0, 12.0, 900.0]),
    ("proteina_baja", [2000.0, 70.0, 260.0, 70.0, 30.0, 2600.0]),
    ("todo_alto", [3000.0, 220.0, 330.0, 120.0, 60.0, 4200.0]),
    ("todo_cero", [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
    ("borde_exacto", [2100.0, 160.0, 250.0, 80.0, 20.0, 1800.0]),
]


def volcar_funciones_puras(cat, v: Volcador, aleatorio: random.Random) -> dict:
    """Entrada → salida de cada función pura del nivel 0."""
    conteo: dict[str, int] = {}

    def emitir(fn: str, caso: str, entrada: dict, salida: Any, **extra) -> None:
        v.escribir(
            {"fn": fn, "caso": caso, "entrada": entrada, "salida": salida, **extra}
        )
        conteo[fn] = conteo.get(fn, 0) + 1

    # --- temperatura --------------------------------------------------------
    # El port clampa `variedad` a [0,100] y Python no; se vuelcan sólo valores
    # dentro del rango para no convertir una divergencia consciente en un fallo.
    for variedad in [0, 1, 10, 25, 45, 50, 60, 75, 90, 99, 100]:
        emitir(
            "temperatura",
            f"v{variedad}",
            {"variedad": float(variedad)},
            temperatura(float(variedad)),
        )

    # --- min_candidatos_slot ------------------------------------------------
    for n in range(0, 15):
        emitir("minCandidatosSlot", f"d{n}", {"nDias": n}, _min_candidatos_slot(n))

    # --- cuotas_de / orden_de_slots ----------------------------------------
    combos = [
        SLOTS_1,
        SLOTS_2,
        SLOTS_3,
        SLOTS_4,
        SLOTS_5,
        ["cena", "desayuno"],
        ["cena", "comida", "desayuno"],  # orden de entrada invertido a propósito
        ["merienda", "almuerzo"],
        ["desayuno"],
        ["comida", "comida", "cena"],  # duplicado: `orden_de_slots` deduplica
    ]
    for i, slots in enumerate(combos):
        emitir("cuotasDe", f"c{i}", {"slots": slots}, sco.cuotas_de(slots))
        emitir("ordenDeSlots", f"c{i}", {"slots": slots}, sco.orden_de_slots(slots))

    # --- topes_por_slot -----------------------------------------------------
    topes_casos = [
        ("sin_topes", None),
        ("solo_desayuno", {"desayuno": 10}),
        ("tres", {"desayuno": 8, "comida": 30, "cena": 20}),
        ("todos", {s: 15 + 3 * i for i, s in enumerate(SLOTS)}),
    ]
    for nombre, topes in topes_casos:
        restr = restricciones_modelo(SLOTS_3, minutosMaxPorSlot=topes)
        emitir(
            "topesPorSlot",
            nombre,
            {"restricciones": restr.model_dump()},
            sco.topes_por_slot(restr),
        )

    # --- bits_de ------------------------------------------------------------
    # El port usa palabras de 32 bits y Python de 64, así que la comparación
    # honesta es el CONJUNTO de bits encendidos, no las palabras. Se vuelcan las
    # dos cosas: los índices (contrato) y las palabras de 64 bits en decimal
    # (referencia, y sólo referencia).
    todos_alimentos = list(cat.alimento_id)
    casos_bits = [
        ("vacio", []),
        ("uno", todos_alimentos[:1]),
        ("tres", todos_alimentos[:3]),
        ("cruzando_palabra", todos_alimentos[60:66]),
        ("desconocidos", ["no_existe_1", "no_existe_2"]),
        ("mezcla", [todos_alimentos[5], "no_existe", todos_alimentos[40]]),
        ("todos", todos_alimentos),
    ]
    for nombre, ids in casos_bits:
        fila = sco.bits_de(cat, ids)
        indices = sorted(cat.alimento_idx[a] for a in ids if a in cat.alimento_idx)
        emitir(
            "bitsDe",
            nombre,
            {"alimentoIds": ids},
            {
                "indices": indices,
                "palabras64": [str(int(p)) for p in fila],
                "nAlimentos": cat.n_alimentos,
            },
        )

    # --- vector_macro -------------------------------------------------------
    residuos = [
        [2000.0, 120.0, 200.0, 60.0, 20.0, 1500.0],
        [1000.0, 40.0, 90.0, 25.0, 10.0, 700.0],
        [500.0, -10.0, 50.0, 12.0, 0.0, 0.0],  # componente negativa: se clampa
        [0.0, 0.0, 0.0, 0.0, 0.0, 0.0],  # día cubierto: vector nulo
        [100.0, -5.0, -5.0, -5.0, 0.0, 0.0],  # todo negativo: vector nulo
        [800.0, 0.0, 0.0, 30.0, 5.0, 100.0],  # sólo grasa
        [800.0, 60.0, 0.0, 0.0, 5.0, 100.0],  # sólo proteína
    ]
    for i, r in enumerate(residuos):
        emitir(
            "vectorMacro",
            f"r{i}",
            {"residuo": r},
            sco.vector_macro(np.array(r, dtype=np.float64)),
        )

    # --- bandas_de ----------------------------------------------------------
    bandas_por_caso: dict[str, Any] = {}
    for nombre_obj, obj_d in OBJETIVOS_PUROS:
        objn = objetivo_modelo(obj_d)
        for nombre_act, act in ACTIVOS_PUROS:
            act_np = None if act is None else np.array(act, dtype=bool)
            b = porc.bandas_de(objn, act_np)
            caso = f"{nombre_obj}/{nombre_act}"
            bandas_por_caso[caso] = b
            emitir(
                "bandasDe",
                caso,
                {"objetivo": obj_d, "activos": act},
                _bandas_json(b),
            )

    # --- desviaciones / error_de / culpabilidad -----------------------------
    # Se recorren TODAS las combinaciones (bandas × totales): son 490 líneas, el
    # fichero sigue pesando kilobytes y cubrir la matriz entera es más barato
    # que discutir qué combinación importaba.
    for caso_b, b in bandas_por_caso.items():
        bj = _bandas_json(b)
        for nombre_t, tot in TOTALES_PUROS:
            t = np.array(tot, dtype=np.float64)
            u_mas, u_menos = porc.desviaciones(t, b)
            emitir(
                "desviaciones",
                f"{caso_b}/{nombre_t}",
                {"totales": tot, "bandas": bj},
                {"uMas": u_mas, "uMenos": u_menos},
            )
            emitir(
                "errorDe",
                f"{caso_b}/{nombre_t}",
                {"totales": tot, "bandas": bj},
                porc.error_de(t, b),
            )

    # --- _cuantizar y _rejilla ---------------------------------------------
    # DIVERGENCIA PRE-REGISTRADA (docs/port-typescript.md, «Divergencias
    # conscientes» (1)): con `lo` que no es múltiplo de 0,05 las dos rejillas de
    # Python no coinciden entre sí —`_cuantizar` ancla en 0 y `_rejilla` ancla en
    # `lo`— y el port unifica en la anclada en 0. Esos casos se marcan para que
    # el arnés los cuente como divergencia esperada y no como fallo.
    casos_cuantizar = [
        ("tipico", [1.0, 1.2837, 0.4, 2.5], [0.6] * 4, [1.8] * 4, False),
        ("mitades", [1.025, 1.075, 0.625, 0.675], [0.6] * 4, [1.8] * 4, False),
        ("bordes", [0.6, 1.8, 0.59, 1.81], [0.6] * 4, [1.8] * 4, False),
        ("negativos", [-1.0, 0.0], [0.6, 0.6], [1.8, 1.8], False),
        ("lo_igual_hi", [1.3], [1.0], [1.0], False),
        ("lo_no_multiplo", [0.8, 1.1], [0.7333, 0.7333], [1.8, 1.8], True),
    ]
    for nombre, sigma, lo, hi, divergente in casos_cuantizar:
        emitir(
            "cuantizar",
            nombre,
            {"sigma": sigma, "lo": lo, "hi": hi},
            porc._cuantizar(
                np.array(sigma, dtype=np.float64),
                np.array(lo, dtype=np.float64),
                np.array(hi, dtype=np.float64),
            ),
            divergenciaPreRegistrada=divergente,
        )

    casos_rejilla = [
        ("por_defecto", 0.6, 1.8, False),
        ("estrecha", 1.0, 1.1, False),
        ("degenerada", 1.0, 1.0, False),
        ("ancha", 0.05, 3.0, False),
        ("no_multiplo_lo", 0.7333, 1.8, True),
        ("no_multiplo_hi", 0.6, 1.7333, True),
        ("resto_casi_cero", 0.6, 1.7999999999, False),
    ]
    for nombre, lo, hi, divergente in casos_rejilla:
        emitir(
            "rejilla",
            nombre,
            {"lo": lo, "hi": hi},
            porc._rejilla(lo, hi),
            divergenciaPreRegistrada=divergente,
        )

    # --- culpabilidad / _pulir_una / _porcionado_de_emergencia --------------
    # Sobre recetas REALES del catálogo. Nunca se fabrica un panel nutricional,
    # ni siquiera para un test: un panel inventado puede ser algebraicamente
    # imposible y entonces el caso no prueba nada.
    combos_recetas = [
        [3],
        [3, 8],
        [0, 5, 11],
        [3, 8, 13, 18],
        [2, 7, 12, 17, 22],
        [1, 6, 11, 16, 21, 26],
    ]
    for ci, filas in enumerate(combos_recetas):
        a = np.ascontiguousarray(cat.nutr[filas].T, dtype=np.float64)
        r = len(filas)
        lo = cat.escala_min[filas].astype(np.float64)
        hi = cat.escala_max[filas].astype(np.float64)
        ids = [str(cat.ids[i]) for i in filas]
        for nombre_obj in ("base", "con_sodio", "proteina_imposible"):
            for nombre_act in ("nulo", "sin_sodio", "sin_fibra_ni_sodio"):
                b = bandas_por_caso[f"{nombre_obj}/{nombre_act}"]
                bj = _bandas_json(b)
                base = {
                    "a": _a_filas(a),
                    "r": r,
                    "lo": _plano(lo),
                    "hi": _plano(hi),
                    "bandas": bj,
                }
                caso = f"c{ci}/{nombre_obj}/{nombre_act}"

                for si, sigma_l in enumerate(
                    [
                        [1.0] * r,
                        [0.6] * r,
                        [1.8] * r,
                        [0.6 + 0.05 * ((i * 7) % 25) for i in range(r)],
                    ]
                ):
                    sigma = np.array(sigma_l, dtype=np.float64)
                    totales = a @ sigma
                    kappa = porc.culpabilidad(a, sigma, totales, b)
                    emitir(
                        "culpabilidad",
                        f"{caso}/s{si}",
                        {**base, "sigma": sigma_l, "totales": _plano(totales)},
                        {
                            "kappa": _plano(kappa),
                            # Es lo ÚNICO que se consume aguas abajo
                            # (reparacion.py:189-196): el orden del argsort
                            # estable descendente. Se vuelca explícito para que
                            # el port lo compare sin reimplementar el desempate.
                            "ordenArgsortDesc": _plano(
                                np.argsort(-kappa, kind="stable")
                            ),
                        },
                        recetaIds=ids,
                    )

                    for j in range(r):
                        emitir(
                            "pulirUna",
                            f"{caso}/s{si}/j{j}",
                            {**base, "sigma": sigma_l, "j": j},
                            porc._pulir_una(a, sigma, lo, hi, b, j),
                            recetaIds=ids,
                        )

                res = porc._porcionado_de_emergencia(a, lo, hi, b)
                emitir(
                    "porcionadoDeEmergencia",
                    caso,
                    base,
                    {
                        "sigma": _plano(res.sigma),
                        "totales": _plano(res.totales),
                        "error": res.error,
                        "emergencia": bool(res.emergencia),
                    },
                    recetaIds=ids,
                )

    # --- macros_incompatibles ----------------------------------------------
    casos_macros = [
        ("base", objetivo_dict()),
        (
            "minimos_pasados",
            objetivo_dict(kcal=1200, proteinaG={"min": 200, "max": 220}),
        ),
        (
            "maximos_cortos",
            objetivo_dict(
                kcal=3000,
                proteinaG={"min": 40, "max": 60},
                carbohidratoG={"min": 50, "max": 80},
                grasaG={"min": 10, "max": 20},
            ),
        ),
        ("justo_dentro", objetivo_dict(kcal=2000, toleranciaKcal=0.2)),
        ("tolerancia_cero", objetivo_dict(toleranciaKcal=0.0)),
    ]
    for nombre, obj_d in casos_macros:
        malo, motivo = diag.macros_incompatibles(objetivo_modelo(obj_d))
        emitir(
            "macrosIncompatibles",
            nombre,
            {"objetivo": obj_d},
            {"malo": bool(malo), "motivo": motivo},
        )

    # --- mascaras_restriccion + ablacion -----------------------------------
    escenarios_restr = [
        ("omnivora_3", SLOTS_3, {}),
        ("vegana_5", SLOTS_5, {"dieta": "vegana"}),
        (
            "vegetariana_sin_gluten",
            SLOTS_3,
            {"dieta": "vegetariana", "alergenosExcluidos": ["gluten"]},
        ),
        (
            "alergenos_multiples",
            SLOTS_3,
            {
                "alergenosExcluidos": [
                    "gluten",
                    "lacteos",
                    "huevos",
                    "frutos_de_cascara",
                ]
            },
        ),
        (
            "ingredientes_excluidos",
            SLOTS_3,
            {"ingredientesExcluidos": [cat.alimento_id[2], cat.alimento_id[9]]},
        ),
        (
            "tiempos",
            SLOTS_3,
            {"minutosMaxPorSlot": {"desayuno": 8, "comida": 25, "cena": 20}},
        ),
        (
            "todo_junto",
            SLOTS_5,
            {
                "dieta": "baja_en_carbohidratos",
                "alergenosExcluidos": ["gluten", "soja"],
                "ingredientesExcluidos": [cat.alimento_id[0]],
                "minutosMaxPorSlot": {"desayuno": 10},
            },
        ),
        ("un_slot", SLOTS_1, {}),
    ]
    for nombre, slots, extra in escenarios_restr:
        restr = restricciones_modelo(slots, **extra)
        mascaras = diag.mascaras_restriccion(cat, restr, slots)
        # El orden de inserción del dict ES el desempate determinista: se vuelca
        # explícito porque un Map de JS lo conserva pero un objeto JSON no lo
        # garantiza para cualquier parser.
        orden = list(mascaras.keys())
        emitir(
            "mascarasRestriccion",
            nombre,
            {"restricciones": restr.model_dump(), "slots": slots},
            {
                "orden": orden,
                "mascaras": {k: [int(x) for x in m] for k, m in mascaras.items()},
            },
        )
        p0, ganancia = diag.ablacion(mascaras)
        culpable = (
            max(ganancia, key=lambda k: (ganancia[k], k))
            if ganancia
            else "pool_insuficiente"
        )
        emitir(
            "ablacion",
            nombre,
            {
                "orden": orden,
                "mascaras": {k: [int(x) for x in m] for k, m in mascaras.items()},
                "n": cat.n,
            },
            {
                "p0": p0,
                "ganancia": ganancia,
                # El culpable desempata por clave alfabéticamente MAYOR
                # (diagnostico.py:221). El código manda sobre DISENO.md §6.1.
                "culpable": culpable,
                "ejesSugeribles": [list(e) for e in diag._ejes_sugeribles(ganancia)],
            },
        )

        pool = sco.construir_pool(cat, restr)
        emitir(
            "candidatosPorSlot",
            nombre,
            {"restricciones": restr.model_dump(), "slots": slots},
            diag.candidatos_por_slot(pool, restr, slots),
            poolP=pool.p,
        )
        cuota = sco.cuotas_de(slots)
        for kcal in (1400.0, 2000.0, 2800.0):
            prot_max, fibra_max, kcal_min, sodio_min = diag.cotas_alcanzables(
                pool, restr, slots, cuota, kcal
            )
            emitir(
                "cotasAlcanzables",
                f"{nombre}/{int(kcal)}",
                {
                    "restricciones": restr.model_dump(),
                    "slots": slots,
                    "cuota": cuota,
                    "kcal": kcal,
                },
                {
                    "protMax": prot_max,
                    "fibraMax": fibra_max,
                    "kcalMin": kcal_min,
                    "sodioMin": sodio_min,
                },
                poolP=pool.p,
            )

        # --- penalizacion_repeticion, sigma_sugerido, totales_de, nutrientes_activos
        # Todas necesitan un pool: se identifican las filas por id de receta
        # (estable entre implementaciones) y además por su índice en el pool.
        ids_pool = [str(x) for x in pool.ids]
        for ns in (1, 3, 5):
            for ri, recientes in enumerate(
                [
                    [],
                    ids_pool[:1],
                    ids_pool[:7],
                    # Un duplicado consume posición sin decrementar el índice:
                    # deduplicar antes rompe los exponentes (scoring.py:241-250).
                    [ids_pool[0], ids_pool[0], ids_pool[1]]
                    if len(ids_pool) > 1
                    else [],
                    ["receta_que_no_existe", *ids_pool[:3]],
                ]
            ):
                emitir(
                    "penalizacionRepeticion",
                    f"{nombre}/ns{ns}/r{ri}",
                    {
                        "restricciones": restr.model_dump(),
                        "recientes": recientes,
                        "nSlots": ns,
                    },
                    {
                        "pen": _plano(
                            sco.penalizacion_repeticion(cat, pool, recientes, ns)
                        )
                    },
                    poolIds=ids_pool,
                )

        if pool.p == 0:
            continue

        for si in range(6):
            j = aleatorio.randrange(pool.p)
            residuo = [
                float(aleatorio.uniform(-200.0, 2600.0)),
                float(aleatorio.uniform(0.0, 180.0)),
                float(aleatorio.uniform(0.0, 300.0)),
                float(aleatorio.uniform(0.0, 100.0)),
                float(aleatorio.uniform(0.0, 40.0)),
                float(aleatorio.uniform(0.0, 3000.0)),
            ]
            cuota_j = cuota[slots[si % len(slots)]]
            emitir(
                "sigmaSugerido",
                f"{nombre}/s{si}",
                {
                    "restricciones": restr.model_dump(),
                    "j": j,
                    "recetaId": ids_pool[j],
                    "residuo": residuo,
                    "cuota": cuota_j,
                },
                sco.sigma_sugerido(
                    pool, j, np.array(residuo, dtype=np.float64), cuota_j
                ),
            )

        for ti in range(6):
            k = 1 + (ti % min(5, pool.p))
            filas = sorted(aleatorio.sample(range(pool.p), k))
            sigmas = [round(0.6 + 0.05 * aleatorio.randrange(0, 25), 2) for _ in filas]
            emitir(
                "totalesDe",
                f"{nombre}/t{ti}",
                {
                    "restricciones": restr.model_dump(),
                    "filas": filas,
                    "recetaIds": [ids_pool[f] for f in filas],
                    "sigmas": sigmas,
                },
                _plano(
                    sco.totales_de(pool, filas, np.array(sigmas, dtype=np.float64))
                ),
            )
            for nombre_obj in ("base", "con_sodio", "sin_fibra"):
                obj_d = dict(OBJETIVOS_PUROS)[nombre_obj]
                activos, fibra_fiable = rep.nutrientes_activos(
                    pool, filas, objetivo_modelo(obj_d)
                )
                emitir(
                    "nutrientesActivos",
                    f"{nombre}/t{ti}/{nombre_obj}",
                    {
                        "restricciones": restr.model_dump(),
                        "filas": filas,
                        "recetaIds": [ids_pool[f] for f in filas],
                        "objetivo": obj_d,
                    },
                    {"activos": _plano(activos), "fibraFiable": bool(fibra_fiable)},
                )

    # --- vector_objetivo ----------------------------------------------------
    for nombre_obj, obj_d in OBJETIVOS_PUROS:
        emitir(
            "vectorObjetivo",
            nombre_obj,
            {"objetivo": obj_d},
            _plano(rep.vector_objetivo(objetivo_modelo(obj_d))),
        )

    return conteo


# ---------------------------------------------------------------------------
# Bloque 2 — instancias de la etapa B
# ---------------------------------------------------------------------------


class Cosechadora:
    """Intercepta las llamadas REALES a la etapa B durante `generar`.

    Fabricar instancias a mano daría cobertura de forma pero no de distribución:
    lo que decide si el porcionador del port sirve es cómo se comporta en las
    instancias que el motor produce de verdad —σref del `sigma_sugerido` de la
    etapa A, bandas con el `activos` real, y las combinaciones de recetas que el
    softmax elige—, no en instancias uniformes. Por eso se cosechan de la
    ejecución, no se inventan.

    Se parchea `reparacion`, no `porciones`: `reparacion` importa los nombres al
    cargarse y es el ÚNICO módulo que llama a la etapa B (semanal.py sólo entra
    por `recomponer_dia`). Y se envuelve `_porcionar` en vez de
    `resolver_porciones` por un motivo concreto: `_porcionar` recibe el pool y
    las filas, así que la instancia se puede etiquetar con los ids de receta
    reales. Sin eso, un fallo de paridad sería un montón de números sin nombre.
    """

    def __init__(self) -> None:
        self.instancias: list[dict] = []
        self.claves: set[bytes] = set()
        self._ultimo_objetivo: Any = None
        self._ultimos_activos: Any = None
        self._bandas_orig = rep.bandas_de
        self._porcionar_orig = rep._porcionar

    def __enter__(self) -> Cosechadora:
        def bandas_espia(objetivo, activos=None):
            self._ultimo_objetivo = objetivo
            self._ultimos_activos = activos
            return self._bandas_orig(objetivo, activos)

        def porcionar_espia(pool, filas, sigma_ref, bandas):
            a, res = self._porcionar_orig(pool, filas, sigma_ref, bandas)
            lo = pool.escala_min[filas].astype(np.float64)
            hi = pool.escala_max[filas].astype(np.float64)
            self._registrar(
                a, lo, hi, sigma_ref, bandas, res,
                [str(pool.ids[f]) for f in filas],
            )
            return a, res

        rep.bandas_de = bandas_espia
        rep._porcionar = porcionar_espia
        return self

    def __exit__(self, *_exc) -> None:
        rep.bandas_de = self._bandas_orig
        rep._porcionar = self._porcionar_orig

    def _registrar(self, a, lo, hi, sigma_ref, bandas, res, receta_ids) -> None:
        a64 = np.ascontiguousarray(a, dtype=np.float64)
        lo64 = np.asarray(lo, dtype=np.float64)
        hi64 = np.asarray(hi, dtype=np.float64)
        ref64 = np.asarray(sigma_ref, dtype=np.float64)
        clave = hashlib.blake2b(
            a64.tobytes()
            + lo64.tobytes()
            + hi64.tobytes()
            + ref64.tobytes()
            + bandas.lo.tobytes()
            + bandas.hi.tobytes()
            + bandas.w_mas.tobytes()
            + bandas.w_menos.tobytes(),
            digest_size=16,
        ).digest()
        if clave in self.claves:
            return  # dos veces la misma instancia no aporta ni una comparación
        self.claves.add(clave)
        self.instancias.append(
            {
                "origen": "real",
                "a": a64,
                "lo": lo64,
                "hi": hi64,
                "sigmaRef": ref64,
                "bandas": bandas,
                "objetivo": self._ultimo_objetivo,
                "activos": self._ultimos_activos,
                "res": res,
                "recetaIds": receta_ids,
            }
        )


def _escenarios_cosecha(rondas: int = 4) -> list[SolicitudGeneracion]:
    """Peticiones que barren la casuística real de la etapa B.

    Se busca variedad de R (número de slots), de bandas (con y sin sodio, con y
    sin fibra, tolerancias distintas) y de dificultad (objetivos holgados,
    apretados e imposibles), no realismo nutricional: el que decide qué
    instancias son difíciles es el motor.
    """
    # Todos pasan la comprobación algebraica de `macros_incompatibles`: si no la
    # pasaran, `generar` cortaría antes de la etapa B y la petición no cosecharía
    # ni una instancia. Difícil ≠ algebraicamente imposible.
    objetivos_variados = [
        objetivo_dict(),
        objetivo_dict(
            kcal=1600,
            toleranciaKcal=0.02,
            proteinaG={"min": 100, "max": 140},
            carbohidratoG={"min": 120, "max": 180},
            grasaG={"min": 40, "max": 60},
        ),
        objetivo_dict(
            kcal=2600,
            proteinaG={"min": 150, "max": 190},
            carbohidratoG={"min": 180, "max": 280},
        ),
        objetivo_dict(fibraMinG=0),
        objetivo_dict(sodioMaxMg=2000),
        objetivo_dict(kcal=1800, sodioMaxMg=1500, fibraMinG=25),
        objetivo_dict(kcal=2200, toleranciaKcal=0.10, grasaG={"min": 40, "max": 100}),
        # Inalcanzable con este catálogo a propósito: la etapa B tiene que
        # devolver su mejor esfuerzo, y ésas son justo las instancias donde el
        # port puede separarse de HiGHS.
        objetivo_dict(
            kcal=1500,
            proteinaG={"min": 190, "max": 230},
            carbohidratoG={"min": 40, "max": 120},
            grasaG={"min": 20, "max": 45},
        ),
        objetivo_dict(
            kcal=3000,
            proteinaG={"min": 60, "max": 80},
            carbohidratoG={"min": 380, "max": 460},
        ),
    ]
    dietas = ["omnivora", "vegetariana", "pescetariana", "mediterranea",
              "baja_en_carbohidratos", "vegana"]
    conjuntos_slots = [SLOTS_1, SLOTS_2, SLOTS_3, SLOTS_4, SLOTS_5]

    # Cada ronda desplaza semilla y dieta: mismas familias de objetivo, otras
    # recetas elegidas por la etapa A y otras combinaciones que porcionar. Es la
    # forma barata de multiplicar instancias DISTINTAS (la cosechadora deduplica
    # por entrada exacta, así que repetir una petición no aporta nada).
    peticiones: list[SolicitudGeneracion] = []
    seed = 1000
    for ronda, dias, (si, slots), (i, obj) in (
        (r, d, s, o)
        for r in range(rondas)
        for d in (1, 3, 7)
        for s in enumerate(conjuntos_slots)
        for o in enumerate(objetivos_variados)
    ):
        seed += 1
        # La dieta NO se empareja con el índice del objetivo: hacerlo ata cada
        # objetivo a una sola dieta y, con este catálogo, deja los objetivos con
        # tope de sodio siempre en manos de la dieta vegana (8 recetas), que no
        # pasa las puertas del pool. El resultado sería un volcado sin apenas
        # instancias con sodio acotado, o sea sin cobertura de media banda del
        # modelo. Medido: 12 instancias con sodio acotado antes, 267 después.
        extra: dict[str, Any] = {"dieta": dietas[(i + si + ronda) % len(dietas)]}
        if i % 3 == 0:
            extra["presupuestoSemanalCents"] = 9000
        if i % 4 == 1:
            extra["alergenosExcluidos"] = ["gluten"]
        if i % 5 == 2:
            extra["minutosMaxPorSlot"] = {"desayuno": 15, "cena": 30}
        peticiones.append(solicitud([obj] * dias, list(slots), seed, **extra))
    return peticiones


def _instancias_sinteticas(cat, aleatorio: random.Random) -> list[dict]:
    """Cobertura que la ejecución real no puede dar.

    Dos huecos concretos: (1) **R = 6**, que no existe en la etapa B porque sólo
    hay cinco slots, pero que el contrato de `resolverPorciones` admite y
    conviene fijar; (2) máscaras de `activos` que el catálogo actual nunca
    produce —tiene los seis nutrientes conocidos en las 36 recetas, así que
    `fibra` jamás se desactiva— y que sí aparecerán en cuanto el catálogo crezca.
    """
    salida: list[dict] = []
    objetivos = [
        objetivo_dict(),
        objetivo_dict(kcal=1500, toleranciaKcal=0.02, sodioMaxMg=1600),
        objetivo_dict(kcal=2600, fibraMinG=35),
        objetivo_dict(kcal=1200, proteinaG={"min": 150, "max": 180}),
    ]
    mascaras = [
        None,
        [True] * 6,
        [True, True, True, True, False, True],
        [True, True, True, True, False, False],
        [True, True, True, True, True, False],
        [False] * 6,
    ]
    for r in range(1, 7):
        for k in range(24):
            filas = sorted(aleatorio.sample(range(cat.n), r))
            obj_d = objetivos[k % len(objetivos)]
            act = mascaras[k % len(mascaras)]
            act_np = None if act is None else np.array(act, dtype=bool)
            objn = objetivo_modelo(obj_d)
            bandas = porc.bandas_de(objn, act_np)
            a = np.ascontiguousarray(cat.nutr[filas].T, dtype=np.float64)
            lo = cat.escala_min[filas].astype(np.float64)
            hi = cat.escala_max[filas].astype(np.float64)
            # σref variado: unos, el borde inferior, el superior y valores fuera
            # de la caja (el resolver los clipa, y ése es justo el detalle que un
            # port puede olvidar).
            eleccion = k % 4
            if eleccion == 0:
                ref = np.ones(r)
            elif eleccion == 1:
                ref = lo.copy()
            elif eleccion == 2:
                ref = hi.copy()
            else:
                ref = np.array(
                    [aleatorio.uniform(0.2, 2.4) for _ in range(r)], dtype=np.float64
                )
            res = porc.resolver_porciones(a, lo, hi, ref, bandas)
            salida.append(
                {
                    "origen": "sintetico",
                    "a": a,
                    "lo": lo,
                    "hi": hi,
                    "sigmaRef": ref,
                    "bandas": bandas,
                    "objetivo": objn,
                    "activos": act_np,
                    "res": res,
                    "recetaIds": [str(cat.ids[f]) for f in filas],
                }
            )
    return salida


def _registro_b(cat, i: int, inst: dict) -> dict:
    a = np.ascontiguousarray(inst["a"], dtype=np.float64)
    r = int(a.shape[1])
    lo = np.asarray(inst["lo"], dtype=np.float64)
    hi = np.asarray(inst["hi"], dtype=np.float64)
    ref = np.asarray(inst["sigmaRef"], dtype=np.float64)
    b = inst["bandas"]
    res = inst["res"]
    sigma = np.asarray(res.sigma, dtype=np.float64)
    ref_clip = np.clip(ref, lo, hi)
    activos = inst["activos"]
    obj = inst["objetivo"]
    # J es el objetivo que el port minimiza (W·E + EPS_REG·Σ|σ−σref|). No es el
    # criterio de aceptación —ése es E— pero permite ver si el descenso
    # coordinado está optimizando lo que dice optimizar.
    j = b.peso_total * res.error + EPS_REG * float(np.abs(sigma - ref_clip).sum())
    return {
        "caso": i,
        "origen": inst["origen"],
        "r": r,
        "recetaIds": inst["recetaIds"],
        "objetivo": obj.model_dump() if obj is not None else None,
        "activos": None if activos is None else [bool(x) for x in activos],
        "entrada": {
            # `a` va aplanada en row-major (6 × R), igual que el Float64Array del
            # port. `sigmaRef` es el que RECIBE el resolver, sin clipar: clipar
            # es responsabilidad suya y el port tiene que hacerlo también.
            "a": _a_filas(a),
            "lo": _plano(lo),
            "hi": _plano(hi),
            "sigmaRef": _plano(ref),
        },
        "bandas": _bandas_json(b),
        "salida": {
            "sigma": _plano(sigma),
            "totales": _plano(np.asarray(res.totales, dtype=np.float64)),
            "error": float(res.error),
            "emergencia": bool(res.emergencia),
            "bucket": _bucket(float(res.error)),
            "j": j,
        },
        "flags": {
            "cotaActiva": bool(
                np.any(sigma <= lo + 1e-12) or np.any(sigma >= hi - 1e-12)
            ),
            # DIVERGENCIA PRE-REGISTRADA (1) DE docs/port-typescript.md, y NO es
            # hipotética: la spec dice que «hoy no se ve porque todo el catálogo
            # usa 0,6/1,8», pero `escala_min` es float32 y 0,6 almacenado en
            # float32 vale 0,6000000238418579 en float64, que NO es múltiplo de
            # 0,05. Como `_rejilla` ancla en `lo`, `_pulir_una` devuelve σ del
            # tipo 1,6000000238418579, imposibles para `_cuantizar`. Ocurre en el
            # 8 % de las instancias volcadas. El port, con la rejilla unificada
            # anclada en 0, dará otro σ aquí legítimamente: esta bandera es la
            # que evita que se lea como fallo.
            "sigmaFueraDeRejillaAnclada0": bool(
                np.any(
                    (
                        np.abs(sigma / PASO_RACION - np.round(sigma / PASO_RACION))
                        >= 1e-9
                    )
                    & (sigma != lo)
                    & (sigma != hi)
                )
            ),
            "algunNutrienteInactivo": bool(
                activos is not None and not bool(np.all(activos))
            ),
            "sodioAcotado": bool(b.hi[5] < INF_HIGHS),
            "fibraExigida": bool(b.w_menos[4] > 0.0),
            "pesoTotalNulo": b.peso_total <= 0.0,
        },
    }


def volcar_porciones(cat, v: Volcador, aleatorio: random.Random, minimo: int) -> dict:
    peticiones = _escenarios_cosecha()
    with Cosechadora() as cosecha:
        for s in peticiones:
            generar(s, cat)
            if len(cosecha.instancias) >= minimo:
                break
    instancias = list(cosecha.instancias)
    reales = len(instancias)
    instancias += _instancias_sinteticas(cat, aleatorio)

    resumen: dict[str, Any] = {
        "total": 0,
        "reales": reales,
        "sinteticos": len(instancias) - reales,
        "porR": {},
        "porBucket": {},
        "conCotaActiva": 0,
        "conNutrienteInactivo": 0,
        "conSodioAcotado": 0,
        "conSigmaFueraDeRejillaAnclada0": 0,
        "emergencias": 0,
    }
    for i, inst in enumerate(instancias):
        reg = _registro_b(cat, i, inst)
        v.escribir(reg)
        resumen["total"] += 1
        resumen["porR"][reg["r"]] = resumen["porR"].get(reg["r"], 0) + 1
        bk = reg["salida"]["bucket"]
        resumen["porBucket"][bk] = resumen["porBucket"].get(bk, 0) + 1
        resumen["conCotaActiva"] += int(reg["flags"]["cotaActiva"])
        resumen["conNutrienteInactivo"] += int(reg["flags"]["algunNutrienteInactivo"])
        resumen["conSodioAcotado"] += int(reg["flags"]["sodioAcotado"])
        resumen["conSigmaFueraDeRejillaAnclada0"] += int(
            reg["flags"]["sigmaFueraDeRejillaAnclada0"]
        )
        resumen["emergencias"] += int(reg["salida"]["emergencia"])
    return resumen


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--salida", default=str(SALIDA_POR_DEFECTO))
    ap.add_argument("--min-instancias", type=int, default=MIN_INSTANCIAS_B)
    args = ap.parse_args()

    salida = Path(args.salida).resolve()
    salida.mkdir(parents=True, exist_ok=True)
    cat = cargar_catalogo()
    aleatorio = random.Random(SEMILLA_ESCENARIOS)

    v_puras = Volcador(salida / "funciones-puras.jsonl")
    conteo = volcar_funciones_puras(cat, v_puras, aleatorio)
    v_puras.cerrar()

    v_porc = Volcador(salida / "porciones.jsonl")
    resumen = volcar_porciones(cat, v_porc, aleatorio, args.min_instancias)
    v_porc.cerrar()

    # El manifiesto no es adorno: sin la versión del catálogo, un volcado viejo
    # comparado con un catálogo nuevo produce fallos de paridad inexplicables.
    manifiesto = {
        "versionCatalogo": cat.version,
        "versionGeneradorPython": VERSION_GENERADOR,
        "nRecetas": cat.n,
        "nAlimentos": cat.n_alimentos,
        "pasoRacion": PASO_RACION,
        "infBanda": INF_HIGHS,
        "umbralErrorOk": UMBRAL_ERROR_OK,
        "umbralErrorAceptable": UMBRAL_ERROR_ACEPTABLE,
        "semillaEscenarios": SEMILLA_ESCENARIOS,
        "funcionesPuras": {"lineas": v_puras.lineas, "porFuncion": conteo},
        "porciones": resumen,
    }
    (salida / "manifiesto.json").write_text(
        json.dumps(manifiesto, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    for f in ("funciones-puras.jsonl", "porciones.jsonl", "manifiesto.json"):
        ruta = salida / f
        print(f"escrito {ruta}  ({ruta.stat().st_size / 1024:.1f} KiB)")
    print(f"funciones puras: {v_puras.lineas} líneas, {len(conteo)} funciones")
    print(f"etapa B: {resumen['total']} instancias "
          f"({resumen['reales']} reales, {resumen['sinteticos']} sintéticas)")
    print(f"  por R: {dict(sorted(resumen['porR'].items()))}")
    print(f"  por bucket: {resumen['porBucket']}")
    print(
        f"  con sodio acotado: {resumen['conSodioAcotado']}; "
        f"con σ fuera de la rejilla anclada en 0: "
        f"{resumen['conSigmaFueraDeRejillaAnclada0']} (divergencia pre-registrada)"
    )
    if resumen["total"] < args.min_instancias:
        print(
            f"AVISO: {resumen['total']} instancias, por debajo del mínimo "
            f"{args.min_instancias}",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
