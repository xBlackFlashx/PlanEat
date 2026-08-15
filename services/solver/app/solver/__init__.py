"""Motor de generación de planes. Constantes y vocabulario compartido.

Este `__init__` hace de `constantes.py`: DISENO.md impone que ningún número
mágico viva fuera de un único módulo, y el ámbito de ficheros de esta tarea no
incluye `constantes.py`. Ponerlos aquí cumple la regla sin inventar ficheros:
cualquier submódulo hace `from . import W_FIT` y no hay ciclo, porque este
fichero no importa a ninguno de sus submódulos.

Cada constante cita la sección de DISENO.md que la justifica. Si cambias una,
cambia también `VERSION_GENERADOR`: sin eso, un plan guardado deja de ser
reproducible y el bug es indepurable en soporte.
"""

from __future__ import annotations

# --------------------------------------------------------------------------
# Vocabulario: el orden de estas tuplas ES el orden de las columnas de todas
# las máscaras del catálogo. Cambiarlo invalida cualquier catálogo cacheado.
# --------------------------------------------------------------------------

NUTRIENTES: tuple[str, ...] = (
    "kcal",
    "proteina",
    "carbohidrato",
    "grasa",
    "fibra",
    "sodio",
)
IDX_NUTRIENTE = {n: i for i, n in enumerate(NUTRIENTES)}  # §1.1
IDX_KCAL, IDX_PROT, IDX_CARB, IDX_GRASA, IDX_FIBRA, IDX_SODIO = range(6)

DIETAS: tuple[str, ...] = (
    "omnivora",
    "vegetariana",
    "vegana",
    "pescetariana",
    "baja_en_carbohidratos",
    "mediterranea",
)
IDX_DIETA = {d: i for i, d in enumerate(DIETAS)}

ALERGENOS: tuple[str, ...] = (
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
)
IDX_ALERGENO = {a: i for i, a in enumerate(ALERGENOS)}

SLOTS: tuple[str, ...] = ("desayuno", "almuerzo", "comida", "merienda", "cena")
IDX_SLOT = {s: i for i, s in enumerate(SLOTS)}

# --------------------------------------------------------------------------
# Etapa A — selección
# --------------------------------------------------------------------------

# Convención de producto (patrón mediterráneo, comida como ingesta principal),
# NO un dato nutricional. Solo ordena la selección; el cuadre real lo hace el LP
# a nivel de día, así que un reparto imperfecto no degrada la precisión. §2.1
PESO_SLOT = {
    "desayuno": 0.22,
    "almuerzo": 0.10,
    "comida": 0.35,
    "merienda": 0.10,
    "cena": 0.28,
}

W_FIT, W_ESC, W_DESP, W_SOL, W_AFIN = 4.0, 2.0, 1.5, 1.2, 0.0  # §2.2
W_COST, W_REP = 1.5, 2.0  # §2.2
# 0,85/día deja ~3 % de penalización residual a 21 días, la ventana de la spec.
DECAIMIENTO_REPETICION = 0.85  # §2.2f
# Por debajo de esta fracción de precios conocidos el término de coste se apaga:
# puntuar con precios inventados es peor que no puntuar. §2.2e
FRACCION_MINIMA_PRECIOS = 0.80

TOP_K = 25  # §2.4
TAU_MIN, TAU_MAX = 0.12, 1.5  # §2.4
VARIEDAD_POR_DEFECTO = 45  # §2.4

# --------------------------------------------------------------------------
# Etapa B — porcionado
# --------------------------------------------------------------------------

# (peso del exceso, peso del defecto). La asimetría de la proteína es de
# producto: pasarse no daña el objetivo del usuario, quedarse corto sí. §3.1
PESOS_LP: dict[str, tuple[float, float]] = {
    "kcal": (3.0, 3.0),
    "proteina": (1.0, 2.5),
    "carbohidrato": (1.0, 1.0),
    "grasa": (1.0, 1.0),
    "fibra": (0.0, 0.5),
    "sodio": (0.3, 0.0),
}
# Rompe la degeneración del LP hacia la solución equilibrada. Sin esto HiGHS
# devuelve un vértice arbitrario ("media ración de lentejas y 1,8 de tostada")
# y el plan deja de ser reproducible entre versiones. §3.2
EPS_REG = 1e-3
UMBRAL_ERROR_OK, UMBRAL_ERROR_ACEPTABLE = 0.04, 0.12  # §3.3
PASO_RACION = 0.05  # §3.4
ESCALA_MIN_POR_DEFECTO, ESCALA_MAX_POR_DEFECTO = 0.6, 1.8  # §1.1
INF_HIGHS = 1.0e30
LIMITE_TIEMPO_LP_S = 0.05  # 100× el tiempo esperado; §3.5

# --------------------------------------------------------------------------
# Etapa C — reparación
# --------------------------------------------------------------------------

MAX_INTENTOS_REPARACION = 3  # §4.2
FACTOR_TEMPERATURA_REINTENTO = 0.25  # §4.2

# --------------------------------------------------------------------------
# Etapa D — ensamblado semanal
# --------------------------------------------------------------------------

K_CANDIDATOS_DIA = 6  # §5
# λ = 0,006: quitar 10 ingredientes de la lista vale lo mismo que empeorar un
# día en 6 puntos de desviación nutricional. Deja la nutrición dominante pero
# con capacidad real de mover la solución cuando hay empate. §5.1
LAMBDA_INGREDIENTES, MU_PRESUPUESTO, NU_REPETICION = 0.006, 0.30, 0.05
MAX_USOS_RECETA_SEMANA = 2  # §5.1 (restricción dura, no penalización)
SA_T0, SA_ALFA, SA_ITERACIONES = 0.05, 0.994, 400  # §5.3

# --------------------------------------------------------------------------
# Diagnóstico
# --------------------------------------------------------------------------

# Umbral de calidad del pool. NO es un umbral absoluto de rechazo: un solo
# número culparía al usuario de que el catálogo sea corto. Con el catálogo
# semilla (36 recetas) ese uso rechazaría el 100 % de las peticiones. Las tres
# puertas de §6.0 separan "tus filtros aprietan" de "nuestro catálogo es corto".
MIN_POOL = 40  # §6.0
# Sale de la restricción dura de repetición: con MAX_USOS_RECETA_SEMANA usos y
# D días hacen falta ceil(D/2) recetas distintas por slot; +4 de holgura para
# que el recocido de la etapa D tenga algo que intercambiar. Un número derivado
# se recalcula cuando cambie el horizonte; uno inventado, no.
MIN_CANDIDATOS_SLOT_DIA = 3  # elegir + 2 reparaciones            §6.0
MIN_CANDIDATOS_SLOT_SEMANA = 8  # ceil(7/2) + 4                   §6.0
# Por debajo de esta fracción del catálogo, la poda es atribuible a los filtros
# del usuario (puerta 2). Por encima, el corto es el catálogo (puerta 3).
FRACCION_POOL_ATRIBUIBLE = 0.5  # §6.0
TTL_CACHE_POOL_S, TAM_CACHE_POOL = 3600, 256  # §1.4
N_SUGERENCIAS = 3  # el contrato de producto: siempre exactamente tres
# Suelo de seguridad, espejo de packages/shared/src/nutricion.ts. Ninguna
# sugerencia del diagnóstico puede bajar de aquí (spec §11.3).
KCAL_MINIMAS = {"hombre": 1500, "mujer": 1200}
KCAL_MINIMAS_ABSOLUTO = 1200

# Fracción mínima de las kcal del día que debe tener fibra conocida para que se
# reporte `fibraG`. Por debajo, el campo va a None: un total parcial se lee como
# total y miente. §8.5
FRACCION_MINIMA_FIBRA = 0.80

# --------------------------------------------------------------------------
# Reproducibilidad
# --------------------------------------------------------------------------

# Prefijos del árbol de SeedSequence. Dos nodos distintos nunca comparten flujo
# y el flujo de un nodo no depende de cuántos números consuman los demás. §2.6
RUTA_A, RUTA_D, RUTA_DESEMPATE = 0, 1, 2

VERSION_GENERADOR = "1.0.0"

__all__ = [n for n in dir() if n.isupper() or n.startswith(("IDX_", "PESO"))]


def rng_de(seed: int, *ruta: int) -> np.random.Generator:  # noqa: F821
    """Generador independiente y reproducible para un punto del árbol. §2.6

    Nunca se usa un único `Generator` compartido y consumido en orden: con un
    generador secuencial, cualquier cambio en el número de llamadas (un slot
    más, un reintento más) desplaza todo el flujo y el plan cambia. Aquí la
    ruta identifica el nodo —(etapa, día, candidato, intento, slot)— y el flujo
    de un nodo no depende de cuántos números hayan consumido los demás. Eso es
    lo que hace que el resultado sea idéntico en serie y en paralelo.
    """
    import numpy as np

    return np.random.Generator(
        np.random.PCG64(
            np.random.SeedSequence(entropy=int(seed), spawn_key=tuple(ruta))
        )
    )


def temperatura(variedad: float) -> float:
    """Mapa del control de "variedad" (0-100) a la temperatura del softmax. §2.4

    Geométrico porque la percepción de "más variado" es multiplicativa, no
    aditiva: subir de 10 a 20 se nota tanto como subir de 40 a 80.
    """
    return TAU_MIN * (TAU_MAX / TAU_MIN) ** (variedad / 100.0)
