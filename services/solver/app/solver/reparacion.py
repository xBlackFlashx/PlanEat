"""Etapa C — reparación dirigida. DISENO.md §4.

Produce un **candidato de día completo**: selección (etapa A) + porcionado
(etapa B) y, si el error se pasa del umbral, hasta tres sustituciones dirigidas.

Se sustituye **sólo el slot culpable**, no el día entero como hacía la spec.
Tres razones: los otros slots pueden estar bien y rehacerlos es tirar trabajo;
el coste por intento baja ~4×; y como se guarda siempre el mejor candidato
visto, un intento peor nunca empeora el resultado final.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import (
    FACTOR_TEMPERATURA_REINTENTO,
    FRACCION_MINIMA_FIBRA,
    IDX_FIBRA,
    IDX_KCAL,
    IDX_SLOT,
    IDX_SODIO,
    MAX_INTENTOS_REPARACION,
    RUTA_A,
    UMBRAL_ERROR_OK,
    rng_de,
)
from .porciones import Bandas, bandas_de, culpabilidad, resolver_porciones
from .scoring import (
    Contexto,
    Pool,
    muestrear,
    orden_de_slots,
    score_slot,
    seleccionar_dia,
    sigma_sugerido,
)


@dataclass(slots=True)
class CandidatoDia:
    """Un día completo, listo para que la etapa D lo compare con sus hermanos.

    `slots` y `filas` van alineados y en **orden de selección** (cuota
    descendente), no de presentación: quien serializa la respuesta reordena.
    """

    slots: list[str]
    filas: list[int]  # posición en el pool
    sigma: np.ndarray  # (R,) factores de ración ya cuantizados
    totales: np.ndarray  # (6,) los de estos sigma, no los del LP continuo
    error: float
    intentos: int = 0
    emergencia: bool = False
    fibra_fiable: bool = True
    bits: np.ndarray = field(default_factory=lambda: np.zeros(1, dtype=np.uint64))

    @property
    def claves(self) -> frozenset:
        """Identidad del candidato, para deduplicar entre los K de un día."""
        return frozenset(self.filas)


def vector_objetivo(objetivo) -> np.ndarray:
    """Centro de cada banda: hacia dónde apunta el residuo de la etapa A.

    La etapa A no necesita el rango, sólo la dirección. El cuadre fino contra
    los extremos lo hace el LP, que sí conoce la banda muerta.
    """
    return np.array(
        [
            float(objetivo.kcal),
            (float(objetivo.proteinaG.min) + float(objetivo.proteinaG.max)) / 2.0,
            (float(objetivo.carbohidratoG.min) + float(objetivo.carbohidratoG.max))
            / 2.0,
            (float(objetivo.grasaG.min) + float(objetivo.grasaG.max)) / 2.0,
            float(objetivo.fibraMinG or 0.0),
            float(objetivo.sodioMaxMg) if objetivo.sodioMaxMg is not None else 0.0,
        ],
        dtype=np.float64,
    )


def nutrientes_activos(
    pool: Pool, filas: list[int], objetivo
) -> tuple[np.ndarray, bool]:
    """Qué nutrientes tienen dato suficiente para entrar en el LP. §8.5

    Fibra y sodio son los dos campos con huecos reales en cualquier catálogo.
    Si faltan, la restricción se ignora en vez de tratarse como cero: un cero
    inventado desplaza el óptimo hacia recetas cuyo dato simplemente no existe,
    que es una forma silenciosa de mentir.
    """
    activos = np.ones(6, dtype=bool)
    if not filas:
        return activos, True

    conocido = pool.conocido[filas]
    kcal = pool.nutr[filas, IDX_KCAL].astype(np.float64)
    total = float(kcal.sum())
    frac_fibra = float(kcal[conocido[:, IDX_FIBRA]].sum() / total) if total > 0 else 0.0
    fibra_fiable = frac_fibra >= FRACCION_MINIMA_FIBRA
    if not fibra_fiable:
        activos[IDX_FIBRA] = False
    if objetivo.sodioMaxMg is None or not bool(conocido[:, IDX_SODIO].all()):
        activos[IDX_SODIO] = False
    return activos, fibra_fiable


def _porcionar(pool: Pool, filas: list[int], sigma_ref: np.ndarray, bandas: Bandas):
    a = np.ascontiguousarray(pool.nutr[filas].astype(np.float64).T)  # (6, R)
    lo = pool.escala_min[filas].astype(np.float64)
    hi = pool.escala_max[filas].astype(np.float64)
    return a, resolver_porciones(a, lo, hi, sigma_ref, bandas)


def _empaquetar(pool, slots_orden, filas, res, intentos, fibra_fiable) -> CandidatoDia:
    bits = (
        np.bitwise_or.reduce(pool.bits[filas], axis=0)
        if filas
        else np.zeros(pool.bits.shape[1], dtype=np.uint64)
    )
    return CandidatoDia(
        slots=list(slots_orden),
        filas=list(filas),
        sigma=res.sigma,
        totales=res.totales,
        error=res.error,
        intentos=intentos,
        emergencia=res.emergencia,
        fibra_fiable=fibra_fiable,
        bits=bits,
    )


def generar_candidato_dia(
    pool: Pool,
    ctx: Contexto,
    objetivo,
    slots: list[str],
    seed: int,
    dia: int,
    k_cand: int,
) -> CandidatoDia | None:
    """Etapa A + B + C para un día. Devuelve el mejor candidato visto.

    `None` sólo si algún slot se queda literalmente sin recetas admisibles. Ese
    caso lo caza antes la puerta 1 del diagnóstico (§6.0); llegar aquí significa
    que el pool se agotó por exclusiones dentro del propio día.
    """
    objetivo_vec = vector_objetivo(objetivo)
    slots_orden = orden_de_slots(slots)

    elegidas = seleccionar_dia(
        pool,
        ctx,
        slots,
        objetivo_vec,
        lambda slot: rng_de(seed, RUTA_A, dia, k_cand, 0, IDX_SLOT[slot]),
    )
    if elegidas is None:
        return None

    # σ de referencia: el que la etapa A ya consideró sensato. Es el ancla del
    # desempate del LP (§3.2), no una restricción.
    filas: list[int] = []
    ref = np.empty(len(slots_orden))
    residuo = objetivo_vec.copy()
    for pos, slot in enumerate(slots_orden):
        j = elegidas[slot]
        filas.append(j)
        ref[pos] = sigma_sugerido(pool, j, residuo, ctx.cuota[slot])
        residuo -= ref[pos] * pool.nutr[j].astype(np.float64)

    activos, fibra_fiable = nutrientes_activos(pool, filas, objetivo)
    bandas = bandas_de(objetivo, activos)
    a, res = _porcionar(pool, filas, ref, bandas)
    mejor = _empaquetar(pool, slots_orden, filas, res, 0, fibra_fiable)
    if mejor.error <= UMBRAL_ERROR_OK:
        return mejor

    vetadas: set[int] = set()
    for k in range(1, MAX_INTENTOS_REPARACION + 1):
        kappa = culpabilidad(a, res.sigma, res.totales, bandas)
        # Desempate por índice de slot ascendente: `argsort` estable sobre el
        # orden de selección, que ya es determinista.
        culpable = next(
            (
                int(p)
                for p in np.argsort(-kappa, kind="stable")
                if filas[p] not in vetadas
            ),
            None,
        )
        if culpable is None:
            break

        slot_culpable = slots_orden[culpable]
        vetadas.add(filas[culpable])

        # Con los σ del LP el residuo del slot culpable ya no es una
        # estimación: sabemos exactamente qué hueco hay que llenar.
        residuo_s = objetivo_vec.copy()
        for pos, fila in enumerate(filas):
            if pos != culpable:
                residuo_s -= float(res.sigma[pos]) * pool.nutr[fila].astype(np.float64)

        excl = np.zeros(pool.p, dtype=bool)
        excl[[f for p, f in enumerate(filas) if p != culpable]] = True
        excl[list(vetadas)] = True

        # Subir la temperatura en cada reintento amplía la exploración: si el
        # primer intento falló, el argmax local no era la respuesta.
        tau_k = ctx.tau * (1.0 + FACTOR_TEMPERATURA_REINTENTO * k)
        nuevo = muestrear(
            score_slot(pool, ctx, slot_culpable, residuo_s, excl),
            pool.ids,
            tau_k,
            rng_de(seed, RUTA_A, dia, k_cand, k, IDX_SLOT[slot_culpable]),
        )
        if nuevo is None:
            break

        filas[culpable] = nuevo
        activos, fibra_fiable = nutrientes_activos(pool, filas, objetivo)
        bandas = bandas_de(objetivo, activos)
        ref_k = res.sigma.copy()
        ref_k[culpable] = sigma_sugerido(
            pool, nuevo, residuo_s, ctx.cuota[slot_culpable]
        )
        a, res = _porcionar(pool, filas, ref_k, bandas)

        candidato = _empaquetar(pool, slots_orden, filas, res, k, fibra_fiable)
        if candidato.error < mejor.error:
            mejor = candidato
        if mejor.error <= UMBRAL_ERROR_OK:
            break

    return mejor


def recomponer_dia(
    pool: Pool,
    ctx: Contexto,
    objetivo,
    slots_orden: list[str],
    filas: list[int],
    intentos: int = 0,
) -> CandidatoDia:
    """Reconstruye el porcionado de un día con las recetas ya decididas.

    Lo usa la reparación de restricciones duras de la etapa D: cuando se
    sustituye un item, sus σ y sus totales dejan de ser válidos y hay que
    volver a resolver el LP. Devolver los totales viejos con la receta nueva
    sería exactamente el tipo de mentira que el resto del motor evita.
    """
    objetivo_vec = vector_objetivo(objetivo)
    residuo = objetivo_vec.copy()
    ref = np.empty(len(filas))
    for pos, (slot, j) in enumerate(zip(slots_orden, filas, strict=True)):
        ref[pos] = sigma_sugerido(pool, j, residuo, ctx.cuota[slot])
        residuo -= ref[pos] * pool.nutr[j].astype(np.float64)
    activos, fibra_fiable = nutrientes_activos(pool, filas, objetivo)
    _, res = _porcionar(pool, filas, ref, bandas_de(objetivo, activos))
    return _empaquetar(pool, slots_orden, filas, res, intentos, fibra_fiable)


def mejor_alternativa(
    pool: Pool,
    ctx: Contexto,
    slot: str,
    residuo: np.ndarray,
    excluidas: np.ndarray,
) -> int | None:
    """Mejor receta admisible para un slot, sin muestrear.

    La reparación de restricciones duras no debe introducir aleatoriedad nueva:
    ya se está corrigiendo un plan concreto y lo que hace falta es la mejor
    sustitución, no una sorteada. El desempate por id la hace reproducible.
    """
    s = score_slot(pool, ctx, slot, residuo, excluidas)
    validos = np.flatnonzero(np.isfinite(s))
    if validos.size == 0:
        return None
    return min(validos.tolist(), key=lambda i: (-float(s[i]), str(pool.ids[i])))


__all__ = [
    "CandidatoDia",
    "mejor_alternativa",
    "recomponer_dia",
    "generar_candidato_dia",
    "nutrientes_activos",
    "vector_objetivo",
]
