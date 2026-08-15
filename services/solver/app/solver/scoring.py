"""Etapa 0 (pool) y etapa A (selección estocástica). DISENO.md §1.4 y §2.

Dos responsabilidades que van juntas porque comparten las vistas compactas del
pool: construir el conjunto admisible una vez por petición, y elegir una receta
por slot puntuando *todo* el pool de golpe.

Regla de rendimiento que gobierna este módulo (§7.2): **si un bucle `for` de
Python itera sobre recetas, es un bug**. Los únicos bucles legítimos son sobre
slots (≤5), días (≤7), candidatos (≤6) e intentos (≤3).
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

import numpy as np

from . import (
    DECAIMIENTO_REPETICION,
    FRACCION_MINIMA_PRECIOS,
    IDX_ALERGENO,
    IDX_DIETA,
    IDX_KCAL,
    IDX_SLOT,
    PESO_SLOT,
    SLOTS,
    TAM_CACHE_POOL,
    TOP_K,
    TTL_CACHE_POOL_S,
    W_AFIN,
    W_COST,
    W_DESP,
    W_ESC,
    W_FIT,
    W_REP,
    W_SOL,
)

SIN_LIMITE_MINUTOS = 32767  # int16 máximo: "este slot no tiene tope de tiempo"


# ---------------------------------------------------------------------------
# Vistas compactas del pool
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Pool:
    """Copia contigua de las filas admisibles del catálogo. §1.2

    Se materializa una vez por petición en lugar de indexar el catálogo entero
    en cada slot: `nutr[idx]` copia ~90 KB una sola vez y luego cada slot hace
    productos matriz-vector contiguos. El *fancy indexing* por slot cuesta unas
    5 veces más y rompe la localidad de caché.
    """

    idx: np.ndarray  # (P,) int32 — fila del catálogo de cada elemento
    mapa_fila: np.ndarray  # (N,) int32 — fila del catálogo -> posición en el pool, o -1
    ids: np.ndarray  # (P,) object
    nutr: np.ndarray  # (P, 6) float32
    conocido: np.ndarray  # (P, 6) bool
    v_macro: np.ndarray  # (P, 3) float32
    tiene_macro: np.ndarray  # (P,) bool
    escala_min: np.ndarray  # (P,) float32
    escala_max: np.ndarray  # (P,) float32
    m_slot: np.ndarray  # (P, 5) bool
    minutos: np.ndarray  # (P,) int16
    bits: np.ndarray  # (P, W) uint64
    n_ingr: np.ndarray  # (P,) int16
    coste_cents: np.ndarray  # (P,) int32
    coste_conocido: np.ndarray  # (P,) bool

    @property
    def p(self) -> int:
        return int(self.idx.shape[0])


# --- Caché de nivel 1 (§1.4) ------------------------------------------------
# Clave de baja cardinalidad: la mayoría de usuarios comparten dieta, alérgenos
# y tope de tiempo. `ingredientesExcluidos` se queda FUERA a propósito: es de
# altísima cardinalidad (la lista es distinta por usuario) y hundiría la tasa
# de aciertos hasta hacer la caché inútil.
_cache_pool: dict[tuple, tuple[float, np.ndarray]] = {}
_cerrojo_cache = threading.Lock()


def _idx_base(
    cat, dieta: str, alergenos: tuple[str, ...], minutos_tope: int
) -> np.ndarray:
    m = cat.m_dieta[:, IDX_DIETA[dieta]].copy()
    for a in alergenos:
        if a in IDX_ALERGENO:
            m &= ~cat.m_alergeno[:, IDX_ALERGENO[a]]
    m &= cat.minutos <= minutos_tope
    return np.flatnonzero(m).astype(np.int32)


def _idx_base_cacheado(cat, dieta, alergenos, minutos_tope) -> np.ndarray:
    clave = (cat.version, dieta, alergenos, minutos_tope)
    ahora = time.monotonic()
    with _cerrojo_cache:
        entrada = _cache_pool.get(clave)
        if entrada is not None and ahora - entrada[0] < TTL_CACHE_POOL_S:
            return entrada[1]
    idx = _idx_base(cat, dieta, alergenos, minutos_tope)
    with _cerrojo_cache:
        if len(_cache_pool) >= TAM_CACHE_POOL:
            _cache_pool.clear()  # política simple: el pool es barato de recalcular
        _cache_pool[clave] = (ahora, idx)
    return idx


def invalidar_cache_pool() -> None:
    """Se llama al recargar el catálogo. Sin esto, planes viejos con datos nuevos."""
    with _cerrojo_cache:
        _cache_pool.clear()


def bits_de(cat, alimento_ids) -> np.ndarray:
    """Codifica una lista de alimentos como bitset alineado con `cat.ingr_bits`."""
    palabras = cat.ingr_bits.shape[1]
    fila = np.zeros(palabras, dtype=np.uint64)
    for aid in alimento_ids:
        bit = cat.alimento_idx.get(aid)
        if bit is None:
            continue
        fila[bit >> 6] |= np.uint64(1) << np.uint64(bit & 63)
    return fila


def topes_por_slot(restr) -> dict[str, int]:
    """El tope de minutos es POR SLOT, nunca global. §1.4

    Confundirlo es el bug clásico: filtrar el pool entero por el límite del
    desayuno y quedarse sin cenas. En el pool base sólo se usa el máximo de
    todos los topes, que es una cota laxa y sólo poda lo que ningún slot
    admitiría.
    """
    por_slot = dict(restr.minutosMaxPorSlot or {})
    return {s: int(por_slot.get(s, SIN_LIMITE_MINUTOS)) for s in SLOTS}


def construir_pool(cat, restr) -> Pool:
    """Filtros duros -> vistas compactas. Nivel 1 cacheado, nivel 2 no. §1.4"""
    topes = topes_por_slot(restr)
    # Cota superior laxa para el nivel 1: sólo poda lo que NINGÚN slot admitiría.
    tope_global = (
        max(topes[s] for s in restr.slots) if restr.slots else SIN_LIMITE_MINUTOS
    )
    alergenos = tuple(sorted(restr.alergenosExcluidos))
    idx = _idx_base_cacheado(cat, restr.dieta, alergenos, tope_global)

    # Nivel 2: exclusiones de ingredientes, por petición y sin cachear.
    if restr.ingredientesExcluidos:
        excl = bits_de(cat, restr.ingredientesExcluidos)
        limpias = np.bitwise_count(cat.ingr_bits[idx] & excl).sum(axis=1) == 0
        idx = idx[limpias]

    mapa = np.full(cat.n, -1, dtype=np.int32)
    mapa[idx] = np.arange(idx.shape[0], dtype=np.int32)

    return Pool(
        idx=idx,
        mapa_fila=mapa,
        ids=cat.ids[idx],
        nutr=cat.nutr[idx],
        conocido=cat.conocido[idx],
        v_macro=cat.v_macro[idx],
        tiene_macro=cat.tiene_macro[idx],
        escala_min=cat.escala_min[idx],
        escala_max=cat.escala_max[idx],
        m_slot=cat.m_slot[idx],
        minutos=cat.minutos[idx],
        bits=cat.ingr_bits[idx],
        n_ingr=cat.n_ingredientes[idx],
        coste_cents=cat.coste_cents[idx],
        coste_conocido=cat.coste_conocido[idx],
    )


# ---------------------------------------------------------------------------
# Contexto de puntuación
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class Contexto:
    """Todo lo que el score necesita y no cambia dentro de un día."""

    cuota: dict[str, float]
    topes: dict[str, int]
    bits_despensa: np.ndarray
    bits_semana: np.ndarray  # acumulador de la etapa D; ceros el primer día
    pen_rep: np.ndarray  # (P,) float32
    peso_coste: float  # 0 si no hay presupuesto o faltan precios
    umbral_coste: float  # cents por ración que el presupuesto permite
    tau: float
    coste_desactivado_por: str | None = None
    # --- Restricciones duras de variedad semanal (§5.1) ---------------------
    # Van aquí y no sólo en la etapa D porque son restricciones, no
    # preferencias: si sólo se comprueban al ensamblar, los K candidatos de un
    # día se generan sin saberlo y el recocido no tiene ningún estado factible
    # que visitar. Con el catálogo semilla eso producía semanas con la misma
    # cena tres veces. Aquí se comportan como el filtro de alérgenos: podan.
    veto_semana: np.ndarray | None = None  # (P,) bool — agotó MAX_USOS_RECETA_SEMANA
    veto_slot: dict[str, int] = field(default_factory=dict)  # slot -> fila de ayer


def cuotas_de(slots: list[str]) -> dict[str, float]:
    """Reparto calórico por slot, renormalizado al subconjunto pedido. §2.1"""
    total = sum(PESO_SLOT[s] for s in slots)
    return {s: PESO_SLOT[s] / total for s in slots}


def orden_de_slots(slots: list[str]) -> list[str]:
    """Slots por cuota descendente, desempatando por el orden canónico. §2.1

    Determinista y además correcto: los slots grandes consumen la mayor parte
    del presupuesto nutricional y deben elegir primero. Como el orden se deriva
    aquí, el orden en que la petición liste los slots no afecta al plan.
    """
    return sorted(set(slots), key=lambda s: (-PESO_SLOT[s], IDX_SLOT[s]))


def penalizacion_repeticion(
    cat, pool: Pool, recientes: list[str], n_slots: int
) -> np.ndarray:
    """Decaimiento 0,85/día sobre `recetasRecientes`. §2.2f

    Por contrato la lista llega ordenada de más reciente a más antigua; con
    |S| slots por día, la posición estima los días transcurridos. Sólo cuenta
    la primera aparición: si una receta salió ayer y hace dos semanas, manda
    ayer.
    """
    pen = np.zeros(pool.p, dtype=np.float32)
    if not recientes or n_slots <= 0:
        return pen
    vistos: set[str] = set()
    for pos, rid in enumerate(recientes):
        if rid in vistos:
            continue
        vistos.add(rid)
        fila = cat.idx_por_id.get(rid)
        if fila is None:
            continue
        j = int(pool.mapa_fila[fila])
        if j >= 0:
            pen[j] = DECAIMIENTO_REPETICION ** (pos // n_slots)
    return pen


def contexto_de(cat, pool: Pool, restr, n_dias: int, tau: float) -> Contexto:
    """Precalcula por petición lo que el score reutiliza en cada slot. §1.2"""
    slots = list(restr.slots)
    peso_coste, umbral, motivo = W_COST, 0.0, None
    presupuesto = restr.presupuestoSemanalCents
    if presupuesto is None or presupuesto <= 0:
        peso_coste, motivo = 0.0, "sin_presupuesto"
    elif pool.p == 0 or float(pool.coste_conocido.mean()) < FRACCION_MINIMA_PRECIOS:
        # Puntuar con precios inventados es peor que no puntuar. §2.2e
        peso_coste, motivo = 0.0, "precios_incompletos"
    else:
        umbral = presupuesto / max(1, n_dias * len(slots) * max(1, restr.comensales))

    return Contexto(
        cuota=cuotas_de(slots),
        topes=topes_por_slot(restr),
        bits_despensa=bits_de(cat, restr.despensaAlimentoIds),
        bits_semana=np.zeros(pool.bits.shape[1], dtype=np.uint64),
        pen_rep=penalizacion_repeticion(
            cat, pool, list(restr.recetasRecientes), len(slots)
        ),
        peso_coste=peso_coste,
        umbral_coste=umbral,
        tau=tau,
        coste_desactivado_por=motivo,
    )


# ---------------------------------------------------------------------------
# Score
# ---------------------------------------------------------------------------


def vector_macro(residuo: np.ndarray) -> np.ndarray:
    """Fracciones calóricas normalizadas (P, C, G) del residuo. §2.2a

    Devuelve el vector nulo si el día ya está cubierto: en ese caso el encaje
    composicional deja de discriminar y el score debe decidirlo el resto de
    términos, no un vector de signo arbitrario.
    """
    macros = np.maximum(residuo[1:4], 0.0)
    kcal = np.array([4.0, 4.0, 9.0]) * macros
    total = kcal.sum()
    if total <= 0:
        return np.zeros(3, dtype=np.float32)
    frac = kcal / total
    norma = float(np.linalg.norm(frac))
    if norma <= 0:
        return np.zeros(3, dtype=np.float32)
    return (frac / norma).astype(np.float32)


def score_slot(
    pool: Pool, ctx: Contexto, slot: str, residuo: np.ndarray, excluidas: np.ndarray
) -> np.ndarray:
    """Puntúa TODO el pool para un slot. Devuelve (P,) con -inf en lo inadmisible."""
    admisible = pool.m_slot[:, IDX_SLOT[slot]] & ~excluidas
    admisible &= pool.minutos <= ctx.topes.get(slot, SIN_LIMITE_MINUTOS)

    # Vetos duros de variedad semanal. Se aplican SÓLO si dejan algo que elegir:
    # con un catálogo corto, exigirlos a rajatabla dejaría al usuario sin plan, y
    # una repetición de más es infinitamente mejor que un fallo. Es la única
    # restricción de este servicio que cede, y cede porque no es de seguridad.
    estricto = admisible.copy()
    if ctx.veto_semana is not None:
        estricto &= ~ctx.veto_semana
    veto_ayer = ctx.veto_slot.get(slot)
    if veto_ayer is not None:
        estricto[veto_ayer] = False
    if estricto.any():
        admisible = estricto

    # (a) Encaje composicional: distancia angular, no coseno crudo. §2.2a
    # Los dos vectores viven en el octante no negativo y sus componentes suman
    # ~1 antes de normalizar, así que el coseno se comprime contra 1 (mediana
    # medida: 0,946) y casi no discrimina. arccos es lineal justo donde el
    # coseno es plano: multiplica la dispersión por 1,66.
    v_res = vector_macro(residuo)
    if np.any(v_res):
        cos = pool.v_macro @ v_res
        fit = 1.0 - (2.0 / np.pi) * np.arccos(np.clip(cos, -1.0, 1.0))
        # Una infusión no encaja ni desencaja composicionalmente: fit neutro.
        fit = np.where(pool.tiene_macro, fit, 0.5).astype(np.float32)
    else:
        fit = np.full(pool.p, 0.5, dtype=np.float32)

    # (b) Encaje de escala: cociente, no resta. §2.2b
    # Restar factores de ración mezcla unidades y castiga brutalmente a las
    # recetas ligeras. El cociente es invariante a escala, cae en (0,1] y
    # penaliza igual "necesito la mitad" que "necesito el doble".
    kcal_r = np.maximum(pool.nutr[:, IDX_KCAL], 1e-6)
    eta = (max(residuo[IDX_KCAL], 0.0) * ctx.cuota.get(slot, 1.0)) / kcal_r
    esc = np.where(
        eta < pool.escala_min,
        eta / np.maximum(pool.escala_min, 1e-6),
        np.where(eta > pool.escala_max, pool.escala_max / np.maximum(eta, 1e-6), 1.0),
    ).astype(np.float32)

    n_seguro = np.maximum(pool.n_ingr.astype(np.float32), 1.0)
    # (c) Despensa: fracción de la receta que ya está en casa.
    desp = (
        np.bitwise_count(pool.bits & ctx.bits_despensa).sum(axis=1).astype(np.float32)
        / n_seguro
    )
    # (d) Solape semanal: COBERTURA, no Jaccard. §2.2d
    # Jaccard divide por la unión, que crece con los días ya planificados: el
    # mismo solape puntúa cada vez menos y hacia el viernes el término se apaga
    # solo. La cobertura mide justo lo que queremos: recetas que no añaden
    # líneas nuevas a la lista de la compra.
    sol = (
        np.bitwise_count(pool.bits & ctx.bits_semana).sum(axis=1).astype(np.float32)
        / n_seguro
    )

    if ctx.peso_coste > 0.0:
        b = max(ctx.umbral_coste, 1e-6)
        cost = np.clip((pool.coste_cents.astype(np.float32) - b) / b, 0.0, 1.0)
    else:
        cost = np.zeros(pool.p, dtype=np.float32)

    # (g) Afinidad: no existe en el contrato (food_preference es v1). Peso 0.
    afin = np.zeros(pool.p, dtype=np.float32)

    s = (
        W_FIT * fit
        + W_ESC * esc
        + W_DESP * desp
        + W_SOL * sol
        + W_AFIN * afin
        - ctx.peso_coste * cost
        - W_REP * ctx.pen_rep
    )
    return np.where(admisible, s.astype(np.float32), -np.inf)


def muestrear(scores: np.ndarray, ids: np.ndarray, tau: float, rng) -> int | None:
    """Softmax con temperatura sobre los z-scores del top-k. §2.4

    Tres decisiones, y las tres importan:

    1. Top-k recorta la cola larga que sólo aporta ruido y hace el coste
       independiente de |P|.
    2. El orden explícito por (-score, id) es OBLIGATORIO: `argpartition` no
       garantiza el orden de los empates, y sin desempate por id el mismo seed
       produce planes distintos entre versiones de NumPy. Es el fallo de
       reproducibilidad más fácil de introducir.
    3. Estandarizar antes del softmax da a `tau` un significado estable: sin
       ello la dispersión del score cambia con el residuo y la misma tau
       significa "casi determinista" en un slot y "casi uniforme" en otro.
    """
    validos = np.flatnonzero(np.isfinite(scores))
    if validos.size == 0:
        return None
    if validos.size > TOP_K:
        # `argpartition` es O(P) pero no define qué empatados deja dentro del
        # corte: con scores repetidos, el CONJUNTO del top-k depende de la
        # implementación y cambia entre versiones de NumPy. Ordenar después no
        # lo arregla, porque lo que varía es qué entra. Se usa por tanto sólo
        # para obtener el valor umbral —que sí es único sea cual sea la
        # permutación— y los empates en ese umbral se resuelven por id.
        s_val = scores[validos]
        umbral = float(s_val[np.argpartition(-s_val, TOP_K - 1)[TOP_K - 1]])
        mejores = validos[s_val > umbral]
        empatados = validos[s_val == umbral]
        huecos = TOP_K - mejores.size
        if empatados.size > huecos:
            empatados = np.asarray(
                sorted(empatados.tolist(), key=lambda i: str(ids[i]))[:huecos],
                dtype=validos.dtype,
            )
        validos = np.concatenate([mejores, empatados])
    orden = sorted(validos.tolist(), key=lambda i: (-float(scores[i]), str(ids[i])))
    cand = np.asarray(orden, dtype=np.int64)
    if cand.size == 1:
        return int(cand[0])

    s = scores[cand].astype(np.float64)
    z = (s - s.mean()) / max(float(s.std()), 1e-3)
    logits = z / max(tau, 1e-6)
    logits -= logits.max()  # estabilidad numérica
    p = np.exp(logits)
    p /= p.sum()
    return int(cand[rng.choice(cand.size, p=p)])


def sigma_sugerido(pool: Pool, j: int, residuo: np.ndarray, cuota: float) -> float:
    """Factor de ración que la etapa A considera sensato. §2.5

    Se usa dos veces: para actualizar el residuo (restar la ración real y no
    1,0, que dejaría un residuo inflado y elegiría los slots siguientes contra
    un objetivo falso) y como ancla del desempate del LP.
    """
    kcal = float(pool.nutr[j, IDX_KCAL])
    if kcal <= 0:
        return 1.0
    eta = max(residuo[IDX_KCAL], 0.0) * cuota / kcal
    return float(np.clip(eta, pool.escala_min[j], pool.escala_max[j]))


def seleccionar_dia(
    pool: Pool,
    ctx: Contexto,
    slots: list[str],
    objetivo_vec: np.ndarray,
    rng_por_slot,
    vetadas: set[int] | None = None,
    tau: float | None = None,
) -> dict[str, int] | None:
    """Elige una receta por slot recorriendo por cuota descendente. §2.1

    `rng_por_slot(slot)` devuelve el generador del nodo del árbol de semillas
    correspondiente; se inyecta para que este módulo no tenga que conocer la
    estructura de la ruta.
    """
    residuo = objetivo_vec.astype(np.float64).copy()
    excl = np.zeros(pool.p, dtype=bool)
    if vetadas:
        excl[list(vetadas)] = True
    t = ctx.tau if tau is None else tau

    elegidas: dict[str, int] = {}
    for slot in orden_de_slots(slots):
        s = score_slot(pool, ctx, slot, residuo, excl)
        j = muestrear(s, pool.ids, t, rng_por_slot(slot))
        if j is None:
            return None
        elegidas[slot] = j
        excl[j] = True  # sin repetir receta dentro del mismo día
        residuo -= sigma_sugerido(pool, j, residuo, ctx.cuota[slot]) * pool.nutr[
            j
        ].astype(np.float64)
    return elegidas


def totales_de(pool: Pool, filas: list[int], sigmas: np.ndarray) -> np.ndarray:
    """Σ σ_i · nutrientes_i. La única fuente de los totales que se devuelven."""
    if not filas:
        return np.zeros(6, dtype=np.float64)
    a = pool.nutr[filas].astype(np.float64)
    return (a * np.asarray(sigmas, dtype=np.float64)[:, None]).sum(axis=0)


__all__ = [
    "SIN_LIMITE_MINUTOS",
    "Contexto",
    "Pool",
    "bits_de",
    "construir_pool",
    "contexto_de",
    "cuotas_de",
    "invalidar_cache_pool",
    "muestrear",
    "orden_de_slots",
    "penalizacion_repeticion",
    "score_slot",
    "seleccionar_dia",
    "sigma_sugerido",
    "topes_por_slot",
    "totales_de",
    "vector_macro",
]
