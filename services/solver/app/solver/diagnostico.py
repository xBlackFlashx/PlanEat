"""Fallo honesto: qué restricción ata. DISENO.md §6.

Esto es producto, no ingeniería. Cuando no hay plan, la salida obligatoria es un
`FalloGeneracion` con **exactamente tres sugerencias concretas y cuantificadas**,
cada una accionable con un botón.

Dos reglas de seguridad no negociables (spec §11.3):

1. **Jamás se sugiere relajar una exclusión de alérgeno.** Si un alérgeno es lo
   que más ata, `restriccionCulpable` lo nombra —el usuario merece saber por qué
   su pool es pequeño— pero las tres sugerencias salen de los siguientes ejes.
2. **Jamás se sugiere bajar de `KCAL_MINIMAS_ABSOLUTO`.**

Y una regla de calidad: cada sugerencia tiene que ser **cierta**. Por eso los
números de la fase 2 no salen de una cota teórica sino del mejor plan que el
motor ha conseguido generar de verdad: si decimos "puedes llegar a 138 g", es
porque hay un plan con 138 g.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from . import (
    ALERGENOS,
    IDX_ALERGENO,
    IDX_DIETA,
    IDX_FIBRA,
    IDX_KCAL,
    IDX_PROT,
    IDX_SLOT,
    IDX_SODIO,
    KCAL_MINIMAS_ABSOLUTO,
    MIN_POOL,
    N_SUGERENCIAS,
)
from .scoring import SIN_LIMITE_MINUTOS, Pool, bits_de, topes_por_slot

# Nombres legibles, para no escupir claves de máquina en la cara del usuario.
NOMBRE_DIETA = {
    "omnivora": "omnívora",
    "vegetariana": "vegetariana",
    "vegana": "vegana",
    "pescetariana": "pescetariana",
    "baja_en_carbohidratos": "baja en carbohidratos",
    "mediterranea": "mediterránea",
}
NOMBRE_ALERGENO = {
    "gluten": "gluten",
    "crustaceos": "crustáceos",
    "huevos": "huevos",
    "pescado": "pescado",
    "cacahuetes": "cacahuetes",
    "soja": "soja",
    "lacteos": "lácteos",
    "frutos_de_cascara": "frutos de cáscara",
    "apio": "apio",
    "mostaza": "mostaza",
    "sesamo": "sésamo",
    "sulfitos": "sulfitos",
    "altramuces": "altramuces",
    "moluscos": "moluscos",
}
NOMBRE_SLOT = {
    "desayuno": "desayuno",
    "almuerzo": "almuerzo",
    "comida": "comida",
    "merienda": "merienda",
    "cena": "cena",
}
# Con artículo, para que las sugerencias se lean como frases y no como etiquetas.
SLOT_CON_ARTICULO = {
    "desayuno": "el desayuno",
    "almuerzo": "el almuerzo",
    "comida": "la comida",
    "merienda": "la merienda",
    "cena": "la cena",
}


def _kcal_segura(valor: float) -> int:
    """Redondea a 50 kcal y **nunca** propone bajar del suelo de seguridad.

    Regla de spec §11.3: el producto no sugiere jamás un objetivo calórico por
    debajo del mínimo, ni siquiera cuando la petición ya venía por debajo. Si el
    usuario pide 400 kcal al día, la salida honesta es subir a 1.200, no a 700.
    """
    return int(max(math.ceil(valor / 50) * 50, KCAL_MINIMAS_ABSOLUTO))


@dataclass(frozen=True, slots=True)
class Fallo:
    """Espejo interno de `schemas.FalloGeneracion`; el motor lo traduce."""

    restriccionCulpable: str  # noqa: N815 — el contrato usa camelCase
    mensaje: str
    recetasCandidatas: int  # noqa: N815
    sugerencias: list[str]


def _tres(sugerencias: list[str], relleno: list[str]) -> list[str]:
    """El contrato de producto es siempre exactamente tres salidas.

    Ni dos (el usuario se siente en un callejón) ni cinco (deja de ser una
    decisión y pasa a ser un formulario).
    """
    salida: list[str] = []
    for s in [*sugerencias, *relleno]:
        if s and s not in salida:
            salida.append(s)
        if len(salida) == N_SUGERENCIAS:
            break
    while len(salida) < N_SUGERENCIAS:
        salida.append("Escríbenos y ampliamos el catálogo con lo que te falta.")
    return salida


# ---------------------------------------------------------------------------
# Fase 1 — el pool es demasiado pequeño (ablación leave-one-out)
# ---------------------------------------------------------------------------


def mascaras_restriccion(cat, restr, slots: list[str]) -> dict[str, np.ndarray]:
    """Una máscara booleana por eje de restricción, en orden fijo.

    El orden importa: es el desempate determinista de la ablación.
    """
    topes = topes_por_slot(restr)
    m: dict[str, np.ndarray] = {"dieta": cat.m_dieta[:, IDX_DIETA[restr.dieta]].copy()}
    for a in ALERGENOS:
        if a in restr.alergenosExcluidos:
            m[f"alergeno:{a}"] = ~cat.m_alergeno[:, IDX_ALERGENO[a]]
    if restr.ingredientesExcluidos:
        excl = bits_de(cat, restr.ingredientesExcluidos)
        m["ingredientes_excluidos"] = (
            np.bitwise_count(cat.ingr_bits & excl).sum(axis=1) == 0
        )
    for s in sorted(set(slots), key=lambda x: IDX_SLOT[x]):
        if topes[s] < SIN_LIMITE_MINUTOS:
            m[f"tiempo:{s}"] = cat.minutos <= topes[s]
    # Sin esta máscara, un pool "grande" podría no contener ninguna receta
    # admisible en ningún slot pedido.
    m["slots"] = np.logical_or.reduce([cat.m_slot[:, IDX_SLOT[s]] for s in set(slots)])
    return m


def ablacion(mascaras: dict[str, np.ndarray]) -> tuple[int, dict[str, int]]:
    """Cuántas recetas devolvería el pool si se quitara cada eje, y sólo ése.

    Coste: ~20 reducciones AND sobre N booleanos. Es la única forma de decir
    "quitar esto te da 41 recetas más" sin inventarse el número.
    """
    if not mascaras:
        return 0, {}
    todas = list(mascaras.values())
    p0 = int(np.logical_and.reduce(todas).sum())
    ganancia: dict[str, int] = {}
    for nombre in mascaras:
        resto = [m for k, m in mascaras.items() if k != nombre]
        base = (
            int(np.logical_and.reduce(resto).sum()) if resto else int(todas[0].shape[0])
        )
        ganancia[nombre] = base - p0
    return p0, ganancia


def _ejes_sugeribles(ganancia: dict[str, int]) -> list[tuple[str, int]]:
    """Ejes ordenados por ganancia, **sin ningún alérgeno**. Regla de seguridad."""
    ejes = [
        (k, g) for k, g in ganancia.items() if not k.startswith("alergeno:") and g > 0
    ]
    return sorted(ejes, key=lambda kv: (-kv[1], kv[0]))


def _frase_eje(eje: str, ganancia: int, restr) -> str:
    if eje == "dieta":
        d = NOMBRE_DIETA.get(restr.dieta, restr.dieta)
        return f"Ampliar la dieta más allá de «{d}» (+{ganancia} recetas)"
    if eje == "ingredientes_excluidos":
        n = len(restr.ingredientesExcluidos)
        return f"Revisar tus {n} ingredientes excluidos (+{ganancia} recetas)"
    if eje.startswith("tiempo:"):
        slot = eje.split(":", 1)[1]
        topes = topes_por_slot(restr)
        return (
            f"Subir el tiempo del {NOMBRE_SLOT.get(slot, slot)} "
            f"de {topes[slot]} a {topes[slot] + 10} min (+{ganancia} recetas)"
        )
    if eje == "slots":
        return f"Elegir otras comidas del día (+{ganancia} recetas)"
    return f"Relajar «{eje}» (+{ganancia} recetas)"


def diagnosticar_pool(
    cat,
    restr,
    slots: list[str],
    p_total: int,
    slots_flojos: dict[str, int],
    min_por_slot: int,
) -> Fallo:
    """Fase 1. Se dispara por las puertas 1 y 2 de §6.0."""
    mascaras = mascaras_restriccion(cat, restr, slots)
    p0, ganancia = ablacion(mascaras)
    ejes = _ejes_sugeribles(ganancia)
    sugerencias = [_frase_eje(e, g, restr) for e, g in ejes]

    relleno = []
    if len(slots) > 2:
        relleno.append(
            f"Planificar {len(slots) - 1} comidas al día en vez de {len(slots)}"
        )
    relleno.append("Avisarte en cuanto el catálogo tenga más recetas que te encajen")

    # El culpable puede ser un alérgeno: el usuario merece saberlo. Lo que nunca
    # ocurre es que aparezca entre las sugerencias.
    culpable = (
        max(ganancia, key=lambda k: (ganancia[k], k))
        if ganancia
        else "pool_insuficiente"
    )

    if slots_flojos:
        slot, cuantas = min(
            slots_flojos.items(), key=lambda kv: (kv[1], IDX_SLOT[kv[0]])
        )
        mensaje = (
            f"Sólo encuentro {cuantas} recetas para el "
            f"{NOMBRE_SLOT.get(slot, slot)} con tus filtros, y necesito al menos "
            f"{min_por_slot} para armar el plan sin repetir."
        )
        return Fallo(
            restriccionCulpable=f"slot_sin_candidatos:{slot}",
            mensaje=mensaje,
            recetasCandidatas=p_total,
            sugerencias=_tres(sugerencias, relleno),
        )

    if culpable.startswith("alergeno:"):
        a = culpable.split(":", 1)[1]
        mensaje = (
            f"Excluir {NOMBRE_ALERGENO.get(a, a)} deja {p0} recetas. "
            "Mantenemos la exclusión: la seguridad va primero."
        )
    elif culpable == "dieta":
        d = NOMBRE_DIETA.get(restr.dieta, restr.dieta)
        mensaje = (
            f"La dieta {d} deja {p0} recetas para {len(slots)} comidas al día, "
            "y no me da para un plan variado."
        )
    elif culpable == "ingredientes_excluidos":
        g = ganancia.get(culpable, 0)
        mensaje = (
            f"Tus {len(restr.ingredientesExcluidos)} ingredientes excluidos "
            f"dejan fuera {g} recetas y me quedo con {p0}."
        )
    elif culpable.startswith("tiempo:"):
        slot = culpable.split(":", 1)[1]
        topes = topes_por_slot(restr)
        mensaje = (
            f"Con {topes[slot]} min para el {NOMBRE_SLOT.get(slot, slot)} "
            f"sólo quedan {p0} recetas."
        )
    else:
        mensaje = (
            f"Tu combinación de filtros deja {p0} recetas y necesito "
            f"al menos {MIN_POOL} para que el plan no se repita."
        )

    return Fallo(
        restriccionCulpable=culpable,
        mensaje=mensaje,
        recetasCandidatas=p_total,
        sugerencias=_tres(sugerencias, relleno),
    )


# ---------------------------------------------------------------------------
# Fase 2 — el pool basta pero el objetivo es inalcanzable
# ---------------------------------------------------------------------------


def macros_incompatibles(objetivo) -> tuple[bool, str]:
    """Comprobación algebraica previa: los rangos no pueden sumar esas kcal.

    Cuesta un microsegundo y ahorra cientos de milisegundos de trabajo inútil.
    Se hace ANTES de generar nada.
    """
    tol = float(objetivo.toleranciaKcal)
    kcal = float(objetivo.kcal)
    minimo = (
        4 * objetivo.proteinaG.min
        + 4 * objetivo.carbohidratoG.min
        + 9 * objetivo.grasaG.min
    )
    maximo = (
        4 * objetivo.proteinaG.max
        + 4 * objetivo.carbohidratoG.max
        + 9 * objetivo.grasaG.max
    )
    if minimo > kcal * (1 + tol):
        return True, (
            f"Los mínimos de macros que pides suman {minimo:.0f} kcal, "
            f"más de las {kcal:.0f} kcal del día."
        )
    if maximo < kcal * (1 - tol):
        return True, (
            f"Los máximos de macros que pides suman {maximo:.0f} kcal, "
            f"menos de las {kcal:.0f} kcal del día."
        )
    return False, ""


def _por_slot(pool: Pool, restr, slots: list[str]) -> dict[str, np.ndarray]:
    topes = topes_por_slot(restr)
    salida: dict[str, np.ndarray] = {}
    for s in sorted(set(slots), key=lambda x: IDX_SLOT[x]):
        m = pool.m_slot[:, IDX_SLOT[s]] & (pool.minutos <= topes[s])
        salida[s] = np.flatnonzero(m)
    return salida


def candidatos_por_slot(pool: Pool, restr, slots: list[str]) -> dict[str, int]:
    """Recuento de recetas admisibles por slot, con el tope de tiempo de ese slot."""
    return {s: int(v.size) for s, v in _por_slot(pool, restr, slots).items()}


def cotas_alcanzables(
    pool: Pool, restr, slots: list[str], cuota: dict[str, float], kcal: float
):
    """Cotas demostrables sobre lo que este pool puede dar. §6.2

    No se adivina: si el objetivo cae fuera de estas cotas, la imposibilidad
    está *probada* y se puede escribir un mensaje afirmativo sin mentir.
    """
    idx = _por_slot(pool, restr, slots)
    prot_max = fibra_max = 0.0
    kcal_min = 0.0
    sodio_min = 0.0
    for s, filas in idx.items():
        if filas.size == 0:
            continue
        k = np.maximum(pool.nutr[filas, IDX_KCAL].astype(np.float64), 1e-6)
        # Máxima densidad proteica del slot: asigna a cada slot su mejor receta
        # e ignora las cotas de σ, que sólo pueden empeorarlo. Cota superior.
        prot_max += kcal * cuota[s] * float((pool.nutr[filas, IDX_PROT] / k).max())
        fibra_max += kcal * cuota[s] * float((pool.nutr[filas, IDX_FIBRA] / k).max())
        # Cota inferior de energía: ni comiendo la receta más ligera en su ración
        # más pequeña se baja de aquí.
        kcal_min += float((pool.nutr[filas, IDX_KCAL] * pool.escala_min[filas]).min())
        sodio_min += float((pool.nutr[filas, IDX_SODIO] * pool.escala_min[filas]).min())
    return prot_max, fibra_max, kcal_min, sodio_min


def diagnosticar_objetivo(
    pool: Pool,
    cat,
    restr,
    slots: list[str],
    cuota: dict[str, float],
    objetivo,
    alcanzado: np.ndarray | None,
    p_total: int,
) -> Fallo:
    """Fase 2. Se dispara cuando E > UMBRAL_ERROR_ACEPTABLE tras la etapa C.

    `alcanzado` son los totales del mejor plan REAL que se ha conseguido. De ahí
    salen los números de las sugerencias: prometer lo que ya hemos construido es
    la única forma de que la sugerencia sea verdad.
    """
    tol = float(objetivo.toleranciaKcal)
    kcal = float(objetivo.kcal)
    prot_max, fibra_max, kcal_min, _sodio_min = cotas_alcanzables(
        pool, restr, slots, cuota, kcal
    )

    _, ganancia = ablacion(mascaras_restriccion(cat, restr, slots))
    ejes = _ejes_sugeribles(ganancia)
    estructural = [_frase_eje(e, g, restr) for e, g in ejes[:1]]
    if len(slots) > 2:
        estructural.append(
            f"Planificar {len(slots) - 1} comidas al día en vez de {len(slots)}"
        )

    # 1. Pedir demasiadas comidas para tan pocas calorías. Es el fallo más común
    #    en la práctica, más que la proteína.
    if kcal * (1 + tol) < kcal_min and len(slots) > 1:
        cuota_menor = min(slots, key=lambda s: cuota[s])
        restantes = [s for s in slots if s != cuota_menor]
        _, _, kcal_min_menos, _ = cotas_alcanzables(
            pool, restr, restantes, {s: cuota[s] for s in restantes}, kcal
        )
        return Fallo(
            restriccionCulpable="kcal_insuficientes_para_slots",
            mensaje=(
                f"Con {len(slots)} comidas al día, lo mínimo que puedo servir son "
                f"{kcal_min:.0f} kcal, y tú pides {kcal:.0f}."
            ),
            recetasCandidatas=p_total,
            sugerencias=_tres(
                [
                    f"Quitar {SLOT_CON_ARTICULO.get(cuota_menor, cuota_menor)}: "
                    f"el mínimo baja a {kcal_min_menos:.0f} kcal",
                    f"Subir a {_kcal_segura(kcal_min)} kcal al día",
                ],
                estructural,
            ),
        )

    # 2. Proteína contra energía: el ejemplo canónico de la spec §4.2.
    prot_min_pedida = float(objetivo.proteinaG.min)
    if prot_min_pedida > prot_max:
        logrado = float(alcanzado[IDX_PROT]) if alcanzado is not None else prot_max
        kcal_necesarias = _kcal_segura(prot_min_pedida / max(prot_max / kcal, 1e-9))
        # El número sale del plan que SÍ hemos construido, no de la cota
        # teórica: prometer sólo lo que ya existe es lo que hace verdadera la
        # sugerencia cuando el usuario la aplica y vuelve a pedir plan.
        sugerencias = [f"Bajar el mínimo de proteína a {math.floor(logrado)} g"]
        # Subir kcal sólo se ofrece si no dispara el objetivo más de un 25 %:
        # por encima de eso deja de ser un ajuste y pasa a ser otro objetivo.
        if kcal_necesarias <= kcal * 1.25:
            sugerencias.append(f"Subir a {kcal_necesarias} kcal al día")
        return Fallo(
            restriccionCulpable="proteina_vs_kcal",
            mensaje=(
                f"No consigo llegar a {prot_min_pedida:.0f} g de proteína con "
                f"{kcal:.0f} kcal y las {p_total} recetas que quedan tras tus filtros. "
                f"Lo más cerca que llego es {logrado:.0f} g."
            ),
            recetasCandidatas=p_total,
            sugerencias=_tres(sugerencias, estructural),
        )

    # 3. Fibra y sodio: mismo esquema, menor gravedad percibida.
    if float(objetivo.fibraMinG or 0.0) > fibra_max:
        logrado = float(alcanzado[IDX_FIBRA]) if alcanzado is not None else fibra_max
        return Fallo(
            restriccionCulpable="fibra_inalcanzable",
            mensaje=(
                f"Con estas recetas no llego a {objetivo.fibraMinG:.0f} g de fibra; "
                f"lo más alto que consigo son {logrado:.0f} g."
            ),
            recetasCandidatas=p_total,
            sugerencias=_tres(
                [f"Bajar la fibra mínima a {math.floor(logrado)} g"], estructural
            ),
        )

    sodio_tope = float(objetivo.sodioMaxMg) if objetivo.sodioMaxMg is not None else None
    if (
        sodio_tope is not None
        and alcanzado is not None
        and alcanzado[IDX_SODIO] > sodio_tope * 1.2
    ):
        logrado = float(alcanzado[IDX_SODIO])
        techo = math.ceil(logrado / 100) * 100
        return Fallo(
            restriccionCulpable="sodio_inalcanzable",
            mensaje=(
                f"No consigo bajar de {logrado:.0f} mg de sodio con estas recetas, "
                f"y tu tope son {sodio_tope:.0f} mg."
            ),
            recetasCandidatas=p_total,
            sugerencias=_tres(
                [f"Subir el tope de sodio a {techo:.0f} mg"],
                estructural,
            ),
        )

    # 4. Genérico: se sabe que no cuadra, no se sabe demostrar por qué.
    detalle = ""
    if alcanzado is not None:
        detalle = (
            f" Lo más cerca que llego son {alcanzado[IDX_KCAL]:.0f} kcal "
            f"con {alcanzado[IDX_PROT]:.0f} g de proteína."
        )
    sugerencias = []
    if alcanzado is not None:
        sugerencias.append(
            f"Ampliar la tolerancia de calorías al {max(tol, 0.03) * 100 + 5:.0f} %"
        )
        sugerencias.append(
            f"Bajar el mínimo de proteína a {math.floor(alcanzado[IDX_PROT])} g"
        )
    return Fallo(
        restriccionCulpable="objetivo_inalcanzable_generico",
        mensaje=(
            "No encuentro una combinación que cuadre con tus objetivos y las "
            f"{p_total} recetas disponibles." + detalle
        ),
        recetasCandidatas=p_total,
        sugerencias=_tres(sugerencias, estructural),
    )


__all__ = [
    "Fallo",
    "ablacion",
    "candidatos_por_slot",
    "cotas_alcanzables",
    "diagnosticar_objetivo",
    "diagnosticar_pool",
    "macros_incompatibles",
    "mascaras_restriccion",
]
