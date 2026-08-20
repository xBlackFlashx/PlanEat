"""Etapa D — ensamblado semanal por recocido simulado. DISENO.md §5.

Esta es la etapa que produce **listas de la compra cortas**. Se generan K
candidatos independientes por día y se busca la combinación que minimiza un
coste global que sí incluye ingredientes únicos, presupuesto y repetición —
términos que un día aislado no puede ver.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import (
    K_CANDIDATOS_DIA,
    LAMBDA_INGREDIENTES,
    MAX_USOS_RECETA_SEMANA,
    MU_PRESUPUESTO,
    NU_REPETICION,
    RUTA_D,
    SA_ALFA,
    SA_ITERACIONES,
    SA_T0,
    rng_de,
)
from .reparacion import (
    CandidatoDia,
    generar_candidato_dia,
    mejor_alternativa,
    recomponer_dia,
    vector_objetivo,
)
from .scoring import Contexto, Pool


@dataclass(slots=True)
class ResultadoSemanal:
    dias: list[CandidatoDia]
    coste_inicial: float
    coste_final: float
    dias_sin_candidato: int


def bits_a_indices(bits: np.ndarray) -> np.ndarray:
    """Bits activos de un bitset -> índices de alimento. Se precalcula por día."""
    idx: list[int] = []
    for w, palabra in enumerate(bits.tolist()):
        v = int(palabra)
        while v:
            b = (v & -v).bit_length() - 1
            idx.append(w * 64 + b)
            v &= v - 1
    return np.asarray(idx, dtype=np.int32)


def generar_candidatos(
    pool: Pool,
    ctx: Contexto,
    objetivos: list,
    slots: list[str],
    seed: int,
) -> tuple[list[list[CandidatoDia]], int]:
    """K candidatos por día, deduplicados. §5.4

    Sin deduplicar, los K candidatos de un día salen casi idénticos (mismo
    objetivo, misma temperatura) y la etapa D no tiene nada que combinar.

    Los días se producen **en orden** porque el término de solape (§2.2d)
    necesita `bits_semana`, la unión de los días ya cerrados. Es un
    acoplamiento consciente: la alternativa (días independientes) daría
    candidatos peores de partida, y el presupuesto de tiempo sobra.
    """
    por_dia: list[list[CandidatoDia]] = []
    duplicados = 0
    usos = np.zeros(pool.p, dtype=np.int16)
    for d, objetivo in enumerate(objetivos):
        # Las restricciones duras de variedad se aplican al elegir, no sólo al
        # ensamblar: si los K candidatos se generan sin conocerlas, el recocido
        # se queda sin ningún estado factible que visitar.
        ctx.veto_semana = usos >= MAX_USOS_RECETA_SEMANA
        vistos: set[frozenset] = set()
        candidatos: list[CandidatoDia] = []
        for k in range(2 * K_CANDIDATOS_DIA):
            if len(candidatos) >= K_CANDIDATOS_DIA:
                break
            cand = generar_candidato_dia(pool, ctx, objetivo, slots, seed, d, k)
            if cand is None:
                break
            if cand.claves in vistos:
                duplicados += 1
                continue
            vistos.add(cand.claves)
            candidatos.append(cand)
        por_dia.append(candidatos)
        if candidatos:
            # El día se cierra con su mejor candidato provisional: es lo que el
            # día siguiente ve como "ya está en la lista de la compra" y como
            # "esto ya lo comiste ayer".
            mejor = min(candidatos, key=lambda c: c.error)
            ctx.bits_semana = ctx.bits_semana | mejor.bits
            ctx.veto_slot = dict(zip(mejor.slots, mejor.filas, strict=True))
            for fila in mejor.filas:
                usos[fila] += 1
    return por_dia, duplicados


def _viola_dura(combo: list[int], por_dia: list[list[CandidatoDia]]) -> bool:
    """Restricciones duras de variedad: se rechaza el movimiento, no se penaliza.

    Codificarlas como penalización blanda dejaría que un buen término de
    ingredientes las comprara, y el usuario lee eso como un fallo del producto.
    """
    usos: dict[int, int] = {}
    previo: CandidatoDia | None = None
    for d, k in enumerate(combo):
        if not por_dia[d]:
            continue
        cand = por_dia[d][k]
        for fila in cand.filas:
            usos[fila] = usos.get(fila, 0) + 1
            if usos[fila] > MAX_USOS_RECETA_SEMANA:
                return True
        if previo is not None:
            pares_previos = set(zip(previo.slots, previo.filas, strict=True))
            if pares_previos & set(zip(cand.slots, cand.filas, strict=True)):
                return True  # misma receta, mismo slot, dos días consecutivos
        previo = cand
    return False


def _arranque_voraz(por_dia: list[list[CandidatoDia]]) -> list[int]:
    """Mejor candidato por día que NO rompa las restricciones duras.

    El voraz ingenuo (`argmin` del error, día a día) produce planes con la misma
    receta tres veces en la semana o dos cenas iguales seguidas: el recocido
    rechaza los movimientos que violan las duras, pero nunca visita un estado
    que ya arrancó violándolas, así que devolvería el plan malo intacto. Aquí se
    construye día a día comprobando la factibilidad contra los días ya fijados.

    Si ningún candidato de un día es factible, se coge el de menor error y se
    sigue: un plan con una repetición de más es mejor que ningún plan, y el
    síntoma real es que el catálogo se ha quedado corto.
    """
    combo: list[int] = []
    for d, cands in enumerate(por_dia):
        if not cands:
            combo.append(0)
            continue
        orden = sorted(range(len(cands)), key=lambda k: (cands[k].error, k))
        elegido = orden[0]
        for k in orden:
            if not _viola_dura([*combo, k], por_dia[: d + 1]):
                elegido = k
                break
        combo.append(elegido)
    return combo


class _Contador:
    """Cuenta ingredientes únicos de forma incremental. §5.2

    Recalcular la unión en cada iteración cuesta D×W operaciones; con el
    contador son ~40 por movimiento en vez de ~500.
    """

    __slots__ = ("uso", "unicos")

    def __init__(self, n_alimentos: int) -> None:
        self.uso = np.zeros(n_alimentos, dtype=np.int16)
        self.unicos = 0

    def anadir(self, indices: np.ndarray) -> None:
        for b in indices:
            if self.uso[b] == 0:
                self.unicos += 1
            self.uso[b] += 1

    def quitar(self, indices: np.ndarray) -> None:
        for b in indices:
            self.uso[b] -= 1
            if self.uso[b] == 0:
                self.unicos -= 1


def _coste(
    combo: list[int],
    por_dia: list[list[CandidatoDia]],
    unicos: int,
    coste_cents: float,
    presupuesto: int | None,
) -> float:
    """Coste global de una combinación. §5.1

    λ = 0,12 (subido desde 0,006 en la cuarta ronda de "menos ingredientes",
    ver el comentario junto a LAMBDA_INGREDIENTES en __init__.py): quitar 10
    ingredientes de la lista vale ahora lo mismo que empeorar un día en ~1,4
    puntos de desviación nutricional, mucho más agresivo que antes -medido
    con scripts/medir_lambda_ingredientes.py, éste es el punto donde la media
    de ingredientes/semana toca su suelo (más λ no baja más la media, sólo
    empeora %cuadra sin necesidad). Ya no deja la nutrición tan dominante
    como antes a propósito: el usuario prefiere explícitamente una despensa
    mucho más compartida a costa de precisión nutricional.
    """
    err = 0.0
    usos: dict[int, int] = {}
    for d, k in enumerate(combo):
        if not por_dia[d]:
            continue
        cand = por_dia[d][k]
        err += cand.error
        for fila in cand.filas:
            usos[fila] = usos.get(fila, 0) + 1
    rep = sum(max(0, u - 1) for u in usos.values())
    exceso = 0.0
    if presupuesto and presupuesto > 0:
        exceso = max(0.0, coste_cents - presupuesto) / presupuesto
    return (
        err
        + LAMBDA_INGREDIENTES * unicos
        + MU_PRESUPUESTO * exceso
        + NU_REPETICION * rep
    )


def ensamblar(
    pool: Pool,
    por_dia: list[list[CandidatoDia]],
    seed: int,
    presupuesto: int | None,
    comensales: int,
) -> ResultadoSemanal:
    """Recocido simulado sobre las combinaciones día × candidato. §5.3"""
    dias_vacios = sum(1 for c in por_dia if not c)
    if all(not c for c in por_dia):
        return ResultadoSemanal([], 0.0, 0.0, dias_vacios)

    d_total = len(por_dia)
    combo = _arranque_voraz(por_dia)

    ingr = [[bits_a_indices(c.bits) for c in cands] for cands in por_dia]
    contador = _Contador(pool.bits.shape[1] * 64)
    for d, k in enumerate(combo):
        if por_dia[d]:
            contador.anadir(ingr[d][k])

    def cents_de(c: list[int]) -> float:
        total = 0.0
        for d, k in enumerate(c):
            if not por_dia[d]:
                continue
            cand = por_dia[d][k]
            total += float((pool.coste_cents[cand.filas] * cand.sigma).sum())
        return total * max(1, comensales)

    def coste_total(c: list[int]) -> float:
        return _coste(c, por_dia, contador.unicos, cents_de(c), presupuesto)

    coste_inicial = coste_actual = coste_total(combo)
    mejor, coste_mejor = list(combo), coste_actual

    # Con un solo día, o con un solo candidato por día, no hay nada que
    # combinar: el arranque voraz ya es el óptimo del espacio.
    if d_total > 1 and any(len(c) > 1 for c in por_dia):
        rng = rng_de(
            seed, RUTA_D
        )  # un solo flujo: el bucle es estrictamente secuencial
        t = SA_T0
        for _ in range(SA_ITERACIONES):
            d = int(rng.integers(d_total))
            k_viejo = combo[d]
            if len(por_dia[d]) > 1:
                k_nuevo = int(rng.integers(len(por_dia[d])))
                if k_nuevo != k_viejo:
                    propuesta = list(combo)
                    propuesta[d] = k_nuevo
                    if not _viola_dura(propuesta, por_dia):
                        contador.quitar(ingr[d][k_viejo])
                        contador.anadir(ingr[d][k_nuevo])
                        coste_nuevo = coste_total(propuesta)
                        delta = coste_nuevo - coste_actual
                        if delta < 0 or rng.random() < np.exp(-delta / max(t, 1e-9)):
                            combo, coste_actual = propuesta, coste_nuevo
                            if coste_actual < coste_mejor:
                                # Se devuelve el MEJOR visto, no el último: el
                                # recocido termina en un estado arbitrario y sin
                                # esta memoria puede devolver algo peor que el
                                # arranque voraz. Es el error de implementación
                                # más común de SA.
                                mejor, coste_mejor = list(combo), coste_actual
                        else:
                            contador.quitar(ingr[d][k_nuevo])
                            contador.anadir(ingr[d][k_viejo])
            t *= SA_ALFA

    return ResultadoSemanal(
        dias=[por_dia[d][k] for d, k in enumerate(mejor) if por_dia[d]],
        coste_inicial=coste_inicial,
        coste_final=coste_mejor,
        dias_sin_candidato=dias_vacios,
    )


def reparar_duras(
    pool: Pool,
    ctx: Contexto,
    objetivos: list,
    dias: list[CandidatoDia],
) -> tuple[list[CandidatoDia], int]:
    """Última pasada: hace cumplir las restricciones duras receta a receta.

    Por qué hace falta pese a que la etapa A ya las veta y el recocido ya
    rechaza los movimientos que las rompen: los K candidatos de un día se
    generan contra el *mejor provisional* de los días anteriores, y el recocido
    puede cambiar esos días. Si además ningún candidato del día es factible, el
    arranque voraz cede a propósito. Medido con 5 slots y 7 días sobre el
    catálogo semilla, eso dejaba pasar una receta usada 3 veces.

    Aquí se corrige donde duele: se sustituye **el item concreto** que sobra,
    con el residuo real del día, y se vuelve a resolver el LP de ese día. Si
    no hay ninguna alternativa admisible se deja como está y se cuenta: el
    catálogo no da para más y decirlo es mejor que fingirlo.
    """
    usos: dict[int, int] = {}
    for cand in dias:
        for fila in cand.filas:
            usos[fila] = usos.get(fila, 0) + 1

    arreglados = 0
    for d, cand in enumerate(dias):
        cambios = False
        filas = list(cand.filas)
        for pos, fila in enumerate(filas):
            slot = cand.slots[pos]
            repetida = usos[fila] > MAX_USOS_RECETA_SEMANA
            ayer = dias[d - 1] if d > 0 else None
            consecutiva = bool(
                ayer is not None
                and slot in ayer.slots
                and ayer.filas[ayer.slots.index(slot)] == fila
            )
            if not (repetida or consecutiva):
                continue

            # Residuo real: lo que le falta al día una vez fijado todo lo demás.
            residuo = vector_objetivo(objetivos[d]).astype(np.float64)
            for otra_pos, otra in enumerate(filas):
                if otra_pos != pos:
                    residuo -= float(cand.sigma[otra_pos]) * pool.nutr[otra].astype(
                        np.float64
                    )

            base = np.zeros(pool.p, dtype=bool)
            base[filas] = True  # sin repetir receta dentro del mismo día, nunca
            if ayer is not None and slot in ayer.slots:
                base[ayer.filas[ayer.slots.index(slot)]] = True

            agotadas = [f for f, u in usos.items() if u >= MAX_USOS_RECETA_SEMANA]
            estricta = base.copy()
            estricta[agotadas] = True

            # Dos intentos, en orden de exigencia. Si respetar las dos reglas a
            # la vez deja el slot sin candidatos, se cede la del tope semanal y
            # se conserva la de días consecutivos: el usuario percibe mucho más
            # "otra vez lo mismo que ayer" que "esto ya salió el lunes".
            nueva = mejor_alternativa(pool, ctx, slot, residuo, estricta)
            if nueva is None:
                nueva = mejor_alternativa(pool, ctx, slot, residuo, base)
            if nueva is None:
                continue
            usos[fila] -= 1
            usos[nueva] = usos.get(nueva, 0) + 1
            filas[pos] = nueva
            cambios = True
            arreglados += 1

        if cambios:
            dias[d] = recomponer_dia(
                pool, ctx, objetivos[d], cand.slots, filas, cand.intentos
            )
    return dias, arreglados


__all__ = [
    "ResultadoSemanal",
    "bits_a_indices",
    "ensamblar",
    "generar_candidatos",
    "reparar_duras",
]
