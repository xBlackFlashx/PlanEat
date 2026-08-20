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
    "paprika",
    "vainilla",
    "sal",
    "miel",
    "mayonesa",
    "vinagre",
    "pesto",
    "mermelada",
    "tofu",
    "tempeh",
    "salsa",
    "azafran",
    "clavo",
    "anis",
    "cardamomo",
    "nuez_moscada",
    "azucar",
    "catsup",
    "mole",
    "hummus",
    "guacamole",
    "cajeta",
    "chocolate",
    "cacao",
    "gelatina",
    "seitan",
    "proteina",
    "cafe",
    "te",
    "huevo",
    "pollo",
    "pavo",
    "res",
    "cerdo",
    "cordero",
    "conejo",
    "pato",
    "codorniz",
    "ternera",
    "bistec",
    "filete",
    "costilla",
    "chuleta",
    "jamon",
    "tocino",
    "salchicha",
    "chorizo",
    "cecina",
    "carne",
    "higado",
    "atun",
    "salmon",
    "sardina",
    "trucha",
    "tilapia",
    "bacalao",
    "merluza",
    "robalo",
    "huachinango",
    "mojarra",
    "camaron",
    "langosta",
    "cangrejo",
    "pulpo",
    "calamar",
    "ostion",
    "almeja",
    "mejillon",
    "cacahuate",
    "almendra",
    "nuez",
    "pistache",
    "avellana",
    "macadamia",
    "castana",
    "nuezpecana",
    "pinon",
    "chia",
    "linaza",
    "ajonjoli",
    "girasol",
    "pepita",
    "canamo",
    "amaranto",
    "manzana",
    "platano",
    "naranja",
    "mandarina",
    "limon",
    "lima",
    "toronja",
    "uva",
    "fresa",
    "frambuesa",
    "zarzamora",
    "arandano",
    "cereza",
    "durazno",
    "nectarina",
    "ciruela",
    "pera",
    "mango",
    "papaya",
    "pina",
    "sandia",
    "melon",
    "kiwi",
    "guayaba",
    "granada",
    "higo",
    "datil",
    "coco",
    "maracuya",
    "lichi",
    "carambola",
    "pitahaya",
    "tuna",
    "mamey",
    "zapote",
    "guanabana",
    "chirimoya",
    "tejocote",
    "tamarindo",
    "membrillo",
    "persimon",
    "grosella",
    "acerola",
    "rambutan",
    "lechuga",
    "espinaca",
    "acelga",
    "col",
    "kale",
    "arugula",
    "berro",
    "brocoli",
    "coliflor",
    "zanahoria",
    "jitomate",
    "tomate",
    "pepino",
    "calabaza",
    "calabacita",
    "chayote",
    "berenjena",
    "pimiento",
    "chile",
    "jalapeno",
    "serrano",
    "poblano",
    "habanero",
    "cebolla",
    "ajo",
    "nopal",
    "rabano",
    "betabel",
    "esparrago",
    "alcachofa",
    "poro",
    "jicama",
    "ejote",
    "elote",
    "champinon",
    "hongo",
    "coles",
    "endivia",
    "escarola",
    "quelite",
    "verdolaga",
    "huauzontle",
    "frijol",
    "lenteja",
    "garbanzo",
    "chicharo",
    "haba",
    "soya",
    "alubia",
    "edamame",
    "arroz",
    "avena",
    "trigo",
    "maiz",
    "cebada",
    "centeno",
    "quinoa",
    "mijo",
    "sorgo",
    "espelta",
    "bulgur",
    "cuscus",
    "farro",
    "papa",
    "camote",
    "yuca",
    "name",
    "malanga",
    "tapioca",
    "leche",
    "queso",
    "yogur",
    "crema",
    "mantequilla",
    "requeson",
    "jocoque",
    "kefir",
    "cuajada",
    "ricotta",
    "mozzarella",
    "manchego",
    "cheddar",
    "parmesano",
    "gouda",
    "cottage",
    "panela",
    "pan",
    "tortilla",
    "tostada",
    "bolillo",
    "telera",
    "baguette",
    "bagel",
    "croissant",
    "galleta",
    "granola",
    "cereal",
    "pasta",
    "espagueti",
    "macarron",
    "fideo",
    "lasana",
    "aguacate",
    "aceituna",
    "oliva",
    "aceite",
    "manteca",
    "tahini",
    "cilantro",
    "perejil",
    "albahaca",
    "oregano",
    "romero",
    "tomillo",
    "menta",
    "hierbabuena",
    "eneldo",
    "laurel",
    "salvia",
    "estragon",
    "curcuma",
    "jengibre",
    "canela",
    "pimienta",
    "comino",
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


# W_SOL bajó de 3,2 a 2,4 y aparece W_NUEVO en esta misma ronda: la tercera vez
# que se pidió una despensa más compartida (histórico: 1,2 -> 2,0 -> 3,2 en las
# dos rondas anteriores). Subir sólo W_SOL ya no daba nada -medido de 3,2 a 6,0
# con scripts/medir_w_sol.py: la media de ingredientes/semana se queda clavada
# en ~41 en todo el rango y sólo se hunde %cuadra- porque `sol` premia la
# FRACCIÓN de la receta ya cubierta, no el número de ingredientes nuevos que
# añade: una receta de 2 ingredientes con 0 en la despensa (sol=0) puntúa igual
# de mal que una de 10 con 0 en la despensa (sol=0), aunque la segunda pese 5
# veces más en la lista de la compra. W_NUEVO corrige eso puntuando el conteo
# ABSOLUTO de ingredientes nuevos. Medido con scripts/medir_w_nuevo.py (barrido
# conjunto, pareado, 40 semillas x 3 perfiles): (W_SOL=2,4, W_NUEVO=3,0) fue el
# único punto que redujo la media de ingredientes/semana de forma reproducible
# (-4,0 ingredientes, -9,7 %) SIN costar tasa de "Cuadra" -de hecho la sube
# +4,5 pp, probablemente porque también evita las recetas atípicas de muchos
# ingredientes que rara vez encajan bien nutricionalmente-. Puntos con W_NUEVO
# más alto (4-10) no bajaban más la media (el catálogo semilla, 240 recetas,
# ~4,5 ingredientes de media, con MAX_USOS_RECETA_SEMANA=2 forzando variedad,
# tenía un suelo estructural alrededor de 35-38) y sí hundían %cuadra, cerca o
# por debajo del suelo de "producto usable" (un tercio de los días). Bajar más
# la media exigía tocar la etapa D (semanal.py, LAMBDA_INGREDIENTES) y el
# límite de repetición semanal -exactamente lo que hace la CUARTA ronda, ver
# el comentario de §5.1 más abajo.
W_FIT, W_ESC, W_DESP, W_SOL, W_AFIN = 4.0, 2.0, 1.5, 2.4, 0.0  # §2.2
W_COST, W_REP = 1.5, 2.0  # §2.2
# Penaliza el número ABSOLUTO de ingredientes nuevos (no comprometidos aún esta
# semana) que introduce la receta candidata, normalizado por el tamaño de
# receta más grande del pool (no por el tamaño de la propia receta: eso ya es
# lo que hace `sol`, y normalizar igual habría hecho de W_NUEVO un múltiplo
# escalar de W_SOL en vez de un término que mide algo distinto). §2.2h
W_NUEVO = 3.0
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
# CUARTA ronda de "menos ingredientes" (histórico completo: W_SOL 1,2->2,0->
# 3,2->2,4 + W_NUEVO en scoring.py §2.2h, comentario de arriba). Con eso la
# media bajó a ~37-38 ingredientes/semana y se estancó -es el scoring POR
# SLOT, que decide qué receta gana dentro de un día, y no ve nada de la etapa
# D-. El usuario pidió explícitamente bajar a 15-25, casi la mitad: eso exige
# tocar la etapa D, que sí ve la semana completa.
#
# scripts/medir_lambda_ingredientes.py (barrido 0,006->0,5, pareado, 40
# semillas x 3 perfiles) muestra que subir sólo λ satura: la media cae de
# 37,6 a un SUELO de ~27,3 en lam=0,08-0,12 y no baja más ni en lam=0,5
# (idéntica en todo ese tramo). scripts/medir_k_candidatos.py descarta que el
# suelo venga de tener pocos candidatos por día para elegir: K_CANDIDATOS_DIA
# de 6 a 20 no mueve la media un ápice. El suelo es estructural: con
# MAX_USOS_RECETA_SEMANA=2 hacen falta al menos ceil(21/2)=11 recetas
# distintas para cubrir 3 comidas x 7 días, y con ~4,5 ingredientes/receta de
# media eso empuja el mínimo teórico muy por encima de 25 aunque la
# superposición entre esas 11 recetas sea perfecta -la etapa D no puede
# "inventar" solape que la variedad obligatoria no deja tener.
#
# scripts/medir_max_usos.py + scripts/confirmar_final.py (barrido conjunto,
# 40 semillas x 3 perfiles) prueban MAX_USOS_RECETA_SEMANA en {2,3,4,5}: subir
# a 4 baja el mínimo estructural a ceil(21/4)=6 recetas y, con λ=0,12, deja
# media=19,85 ingredientes/semana (antes 37,6) con el 94,2 % de las semanas
# cayendo dentro de [15,25] -el resto quedan un poco por debajo o encima, no
# hay ningún combo que garantice el 100 %-. SÍ hace falta tocar
# MIN_CANDIDATOS_SLOT_SEMANA (más abajo, §6.0): es un valor derivado -no lo
# recalcula nadie solo- y dejarlo en 8 (el ceil(7/2)+4 de MAX_USOS_RECETA_
# SEMANA=2) le daría a la holgura del recocido el doble de margen del que
# pide el diseño (6 en vez de 4) en lugar de mantener la misma holgura con el
# nuevo tope de repetición.
#
# La sorpresa: %cuadra SUBE de 57,3 % a 81,1 % en vez de bajar. No es gratis
# -MAX_USOS_RECETA_SEMANA=4 es la restricción dura la que se relaja, así que
# el LP de porcionado (etapa B) tiene más margen para ajustar factorRacion
# receta a receta en vez de que la variedad obligue a mezclar platos que
# encajan peor-. λ=0,10 daba el mismo resultado que 0,12 (empate en media,
# mínimo y % en rango); se eligió 0,12 por tener el %cuadra ligeramente mejor
# y coincidir con el punto donde λ=sola ya había tocado su suelo.
LAMBDA_INGREDIENTES, MU_PRESUPUESTO, NU_REPETICION = 0.12, 0.30, 0.05
MAX_USOS_RECETA_SEMANA = 4  # §5.1 (restricción dura, no penalización)
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
# D días hacen falta ceil(D/MAX_USOS_RECETA_SEMANA) recetas distintas por
# slot; +4 de holgura para que el recocido de la etapa D tenga algo que
# intercambiar. Un número derivado se recalcula a mano cuando cambie el
# horizonte O el tope de repetición; uno inventado, no. (Cuarta ronda de
# "menos ingredientes": bajó de 8 -ceil(7/2)+4, con el MAX_USOS_RECETA_SEMANA
# de entonces- a 6, para no darle a la holgura el doble del margen que pide
# el diseño con el nuevo MAX_USOS_RECETA_SEMANA=4.)
MIN_CANDIDATOS_SLOT_DIA = 3  # elegir + 2 reparaciones            §6.0
MIN_CANDIDATOS_SLOT_SEMANA = 6  # ceil(7/4) + 4                   §6.0
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

VERSION_GENERADOR = "1.5.0"

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
