"""Etapa B — porcionado óptimo por programación lineal. DISENO.md §3.

El punto que la spec deja abierto: los objetivos no son puntos, son **rangos**.
El goal programming clásico fuerza un punto y penaliza cualquier desviación,
incluida la que el producto declara aceptable; eso hace que el LP gaste su
libertad en clavar el centro del rango en vez de en cuadrar el resto. Aquí se
usa **banda muerta** (interval goal programming): dentro del rango, coste cero.

Garantía de diseño: **el LP es siempre factible**. Las holguras u⁺/u⁻ no tienen
cota superior y σ vive en una caja no vacía. Por eso la insatisfacibilidad real
se manifiesta como error residual alto —un número interpretable y accionable—
y no como un estado de excepción. Es exactamente la razón de elegir goal
programming en vez de restricciones duras de macro.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass

import numpy as np
from highspy import Highs, HighsLp, HighsModelStatus, MatrixFormat, ObjSense

from . import (
    EPS_REG,
    IDX_FIBRA,
    IDX_KCAL,
    IDX_SODIO,
    INF_HIGHS,
    LIMITE_TIEMPO_LP_S,
    NUTRIENTES,
    PASO_RACION,
    PESOS_LP,
)

N_NUTR = len(NUTRIENTES)


@dataclass(frozen=True, slots=True)
class Bandas:
    """Intervalo objetivo y pesos asimétricos por nutriente. §3.1"""

    lo: np.ndarray  # (6,) float64 — L_n, -INF si el lado está abierto
    hi: np.ndarray  # (6,) float64 — U_n, +INF si el lado está abierto
    w_mas: np.ndarray  # (6,) coste del exceso; 0 = ese lado no se penaliza
    w_menos: np.ndarray  # (6,) coste del defecto
    e: np.ndarray  # (6,) normalizador relativo

    @property
    def peso_total(self) -> float:
        return float(np.maximum(self.w_mas, self.w_menos).sum())


def bandas_de(objetivo, activos: np.ndarray | None = None) -> Bandas:
    """Traduce `ObjetivoNutricional` a bandas. §3.1

    `activos` (6,) bool desactiva nutrientes de los que no hay dato fiable: un
    nutriente desactivado tiene banda abierta y peso 0, así que ni penaliza ni
    entra en el error. No se inventa un objetivo sobre datos que no existen.
    """
    lo = np.full(N_NUTR, -INF_HIGHS)
    hi = np.full(N_NUTR, INF_HIGHS)
    w_mas = np.zeros(N_NUTR)
    w_menos = np.zeros(N_NUTR)

    tol = float(objetivo.toleranciaKcal)
    kcal = float(objetivo.kcal)
    lo[IDX_KCAL], hi[IDX_KCAL] = kcal * (1 - tol), kcal * (1 + tol)
    for idx, rango in (
        (1, objetivo.proteinaG),
        (2, objetivo.carbohidratoG),
        (3, objetivo.grasaG),
    ):
        lo[idx], hi[idx] = float(rango.min), float(rango.max)
    lo[IDX_FIBRA] = float(objetivo.fibraMinG or 0.0)
    if objetivo.sodioMaxMg is not None:
        hi[IDX_SODIO] = float(objetivo.sodioMaxMg)

    for i, nombre in enumerate(NUTRIENTES):
        w_mas[i], w_menos[i] = PESOS_LP[nombre]

    # Sin dato o sin objetivo declarado, el nutriente sale del modelo.
    if objetivo.sodioMaxMg is None:
        w_mas[IDX_SODIO] = 0.0
    if not objetivo.fibraMinG:
        w_menos[IDX_FIBRA] = 0.0
    if activos is not None:
        w_mas = np.where(activos, w_mas, 0.0)
        w_menos = np.where(activos, w_menos, 0.0)
        lo = np.where(activos, lo, -INF_HIGHS)
        hi = np.where(activos, hi, INF_HIGHS)

    # Normalizador: convierte gramos y miligramos en desviaciones RELATIVAS,
    # que es lo único comparable entre nutrientes. 10 g de desviación en
    # carbohidrato y 10 mg en sodio no son la misma falta. §3.2
    e = np.empty(N_NUTR)
    for i in range(N_NUTR):
        if lo[i] > -INF_HIGHS and hi[i] < INF_HIGHS:
            e[i] = max((lo[i] + hi[i]) / 2.0, 1.0)
        elif lo[i] > -INF_HIGHS:
            e[i] = max(lo[i], 1.0)
        elif hi[i] < INF_HIGHS:
            e[i] = max(hi[i], 1.0)
        else:
            e[i] = 1.0
    return Bandas(lo=lo, hi=hi, w_mas=w_mas, w_menos=w_menos, e=e)


def desviaciones(totales: np.ndarray, bandas: Bandas) -> tuple[np.ndarray, np.ndarray]:
    """u⁺ = cuánto sobra por encima de U_n, u⁻ = cuánto falta por debajo de L_n."""
    u_mas = np.where(bandas.hi < INF_HIGHS, np.maximum(0.0, totales - bandas.hi), 0.0)
    u_menos = np.where(
        bandas.lo > -INF_HIGHS, np.maximum(0.0, bandas.lo - totales), 0.0
    )
    return u_mas, u_menos


def error_de(totales: np.ndarray, bandas: Bandas) -> float:
    """Desviación relativa media ponderada FUERA de banda. §3.3

    Se calcula sobre los totales reales, nunca sobre el valor objetivo del LP:
    ése incluye el regularizador y además corresponde a los σ continuos, no a
    los cuantizados que se devuelven. E = 0 significa "todos los nutrientes
    dentro de sus rangos", no "clavado en el centro".
    """
    u_mas, u_menos = desviaciones(totales, bandas)
    total = bandas.peso_total
    if total <= 0:
        return 0.0
    num = (bandas.w_mas * u_mas / bandas.e + bandas.w_menos * u_menos / bandas.e).sum()
    return float(num / total)


@dataclass(slots=True)
class ResultadoPorcionado:
    sigma: np.ndarray  # (R,) float64, cuantizado a PASO_RACION
    totales: np.ndarray  # (6,) float64 — SIEMPRE los de los sigma devueltos
    error: float
    emergencia: bool = False


# Una instancia de `Highs` por hilo. Construirla cuesta ~1 ms, más que resolver
# tres LP, así que se reutiliza; pero FastAPI ejecuta los endpoints síncronos en
# un pool de hilos, y `Highs` no es reentrante: compartir una sola instancia
# global daría respuestas cruzadas bajo carga.
_local = threading.local()


def _highs() -> Highs:
    h = getattr(_local, "h", None)
    if h is None:
        h = Highs()
        _local.h = h
    return h


def construir_lp(
    a: np.ndarray,
    lo: np.ndarray,
    hi: np.ndarray,
    sigma_ref: np.ndarray,
    bandas: Bandas,
) -> HighsLp:
    """Monta el LP en formato columna (CSC). §3.4

    Se construye a bajo nivel en vez de con la API de expresiones: para un
    modelo de ~20 columnas, construir expresiones Python cuesta más que
    resolver, y el orden de recorrido de las expresiones puede variar entre
    versiones. El CSC explícito es determinista y su construcción es NumPy.

    **Una sola fila por nutriente.** La formulación clásica necesita dos
    restricciones para modelar una banda muerta. Con L ≤ Σaσ − u⁺ + u⁻ ≤ U y
    costes positivos sobre u±, el óptimo da u⁺ = max(0, A−U), u⁻ = max(0, L−A)
    y u⁺=u⁻=0 dentro de la banda. Es exacto, no una aproximación: la mitad de
    modelo.
    """
    n_nutr, n_rec = a.shape
    n_col = 2 * n_rec + 2 * n_nutr
    n_fil = n_nutr + 2 * n_rec

    coste = np.zeros(n_col)
    col_lo = np.zeros(n_col)
    col_hi = np.full(n_col, INF_HIGHS)

    coste[n_rec : n_rec + 2 * n_nutr : 2] = bandas.w_mas / bandas.e
    coste[n_rec + 1 : n_rec + 2 * n_nutr : 2] = bandas.w_menos / bandas.e
    coste[n_rec + 2 * n_nutr :] = EPS_REG
    col_lo[:n_rec], col_hi[:n_rec] = lo, hi
    # Lado suprimido (peso 0): la holgura se fija en 0 en vez de eliminar la
    # columna. Mantener la disposición fija es lo que permite reutilizar el
    # mismo buffer entre días.
    col_hi[n_rec : n_rec + 2 * n_nutr : 2][bandas.w_mas == 0] = 0.0
    col_hi[n_rec + 1 : n_rec + 2 * n_nutr : 2][bandas.w_menos == 0] = 0.0

    fil_lo = np.concatenate([bandas.lo, np.empty(2 * n_rec)])
    fil_hi = np.concatenate([bandas.hi, np.full(2 * n_rec, INF_HIGHS)])
    fil_lo[n_nutr::2] = -sigma_ref  # t_i - σ_i ≥ -ref
    fil_lo[n_nutr + 1 :: 2] = sigma_ref  # t_i + σ_i ≥  ref

    inicio: list[int] = [0]
    indice: list[int] = []
    valor: list[float] = []
    for i in range(n_rec):  # columnas σ_i
        indice += list(range(n_nutr)) + [n_nutr + 2 * i, n_nutr + 2 * i + 1]
        valor += list(a[:, i]) + [-1.0, 1.0]
        inicio.append(len(indice))
    for n in range(n_nutr):  # columnas u_n⁺, u_n⁻
        indice += [n]
        valor += [-1.0]
        inicio.append(len(indice))
        indice += [n]
        valor += [1.0]
        inicio.append(len(indice))
    for i in range(n_rec):  # columnas t_i
        indice += [n_nutr + 2 * i, n_nutr + 2 * i + 1]
        valor += [1.0, 1.0]
        inicio.append(len(indice))

    lp = HighsLp()
    lp.num_col_, lp.num_row_ = n_col, n_fil
    lp.sense_ = ObjSense.kMinimize
    lp.col_cost_, lp.col_lower_, lp.col_upper_ = coste, col_lo, col_hi
    lp.row_lower_, lp.row_upper_ = fil_lo, fil_hi
    lp.a_matrix_.format_ = MatrixFormat.kColwise
    # Los dtypes importan: con otros, la conversión de pybind11 es silenciosa
    # pero costosa.
    lp.a_matrix_.start_ = np.asarray(inicio, dtype=np.int32)
    lp.a_matrix_.index_ = np.asarray(indice, dtype=np.int32)
    lp.a_matrix_.value_ = np.asarray(valor, dtype=np.float64)
    return lp


def _cuantizar(sigma: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> np.ndarray:
    """σ = 1,2837 no es cocinable. Se redondea al múltiplo de 0,05 y se clipa."""
    q = np.round(sigma / PASO_RACION) * PASO_RACION
    return np.clip(q, lo, hi)


def _rejilla(lo: float, hi: float) -> np.ndarray:
    """Todos los valores admisibles de un σ sobre la rejilla de 0,05."""
    n = int(np.floor((hi - lo) / PASO_RACION + 1e-9))
    puntos = lo + PASO_RACION * np.arange(n + 1)
    return np.clip(np.append(puntos, hi), lo, hi)


def _pulir_una(
    a: np.ndarray,
    sigma: np.ndarray,
    lo: np.ndarray,
    hi: np.ndarray,
    bandas: Bandas,
    j: int,
) -> np.ndarray:
    """Reoptimiza σ_j con los demás fijos, exhaustivamente sobre la rejilla.

    El problema es unidimensional y lineal a trozos, así que el óptimo continuo
    está en un punto de ruptura; pero como el σ que se devuelve tiene que caer
    en la rejilla de 0,05 de todos modos, evaluar los ≤25 puntos de la rejilla
    es a la vez **más simple y exactamente óptimo sobre lo que se puede
    devolver** — resolver el problema continuo y volver a redondear podría salir
    peor. Cuesta ~25 productos escalares de 6 elementos.
    """
    resto = a @ sigma - a[:, j] * sigma[j]
    puntos = _rejilla(float(lo[j]), float(hi[j]))
    totales = resto[None, :] + puntos[:, None] * a[:, j][None, :]
    errores = [error_de(t, bandas) for t in totales]
    mejor = int(np.argmin(errores))
    salida = sigma.copy()
    salida[j] = puntos[mejor]
    return salida


def _porcionado_de_emergencia(
    a: np.ndarray, lo: np.ndarray, hi: np.ndarray, bandas: Bandas
) -> ResultadoPorcionado:
    """Escala uniforme para cuadrar kcal. Nunca óptimo, pero siempre existe.

    Se instrumenta con `emergencia=True`: si aparece en producción es un bug
    que hay que perseguir, no un modo de operación.
    """
    objetivo_kcal = bandas.lo[IDX_KCAL] if bandas.lo[IDX_KCAL] > -INF_HIGHS else 0.0
    if bandas.hi[IDX_KCAL] < INF_HIGHS:
        objetivo_kcal = (objetivo_kcal + bandas.hi[IDX_KCAL]) / 2.0
    denom = float(a[IDX_KCAL].sum())
    s = objetivo_kcal / denom if denom > 0 else 1.0
    sigma = _cuantizar(np.clip(np.full(a.shape[1], s), lo, hi), lo, hi)
    totales = a @ sigma
    return ResultadoPorcionado(
        sigma, totales, error_de(totales, bandas), emergencia=True
    )


def resolver_porciones(
    a: np.ndarray,
    lo: np.ndarray,
    hi: np.ndarray,
    sigma_ref: np.ndarray,
    bandas: Bandas,
) -> ResultadoPorcionado:
    """Devuelve los factores de ración óptimos, ya cuantizados. §3.4

    `a` es (6, R): nutrientes por ración base de cada receta elegida.
    """
    a = np.ascontiguousarray(a, dtype=np.float64)
    lo = np.asarray(lo, dtype=np.float64)
    hi = np.asarray(hi, dtype=np.float64)
    sigma_ref = np.clip(np.asarray(sigma_ref, dtype=np.float64), lo, hi)

    h = _highs()
    h.clear()
    h.setOptionValue("output_flag", False)
    h.setOptionValue("threads", 1)  # determinismo (§2.6)
    h.setOptionValue("solver", "simplex")
    # `time_limit` se compara contra el tiempo ACUMULADO de la instancia de
    # HiGHS, y `clear()` NO reinicia ese contador. Fijarlo al valor absoluto
    # 0,05 s parece razonable y es un bug grave: tras ~0,05 s de solver
    # acumulados —unos 700 LP, o sea media docena de semanas— **todas** las
    # llamadas siguientes devuelven `kTimeLimit` de inmediato y el servicio se
    # cae al porcionado de emergencia para siempre, en silencio y sin volver.
    # Medido y reproducido. Por eso el presupuesto se suma al reloj actual.
    h.setOptionValue("time_limit", h.getRunTime() + LIMITE_TIEMPO_LP_S)
    h.passModel(construir_lp(a, lo, hi, sigma_ref, bandas))
    h.run()

    if h.getModelStatus() != HighsModelStatus.kOptimal:
        return _porcionado_de_emergencia(a, lo, hi, bandas)

    x = np.asarray(h.getSolution().col_value, dtype=np.float64)
    sigma = _cuantizar(x[: a.shape[1]], lo, hi)

    totales = a @ sigma
    error = error_de(totales, bandas)
    # Si la cuantización sacó las kcal de banda, se libera la receta con mayor
    # contribución calórica y se reoptimiza sólo ella. Los totales devueltos son
    # SIEMPRE los de los σ finales: mentir aquí es el bug que hace que la suma
    # de la UI no cuadre con lo que la UI muestra por comida.
    fuera = (
        totales[IDX_KCAL] < bandas.lo[IDX_KCAL]
        or totales[IDX_KCAL] > bandas.hi[IDX_KCAL]
    )
    if fuera and a.shape[1] > 0:
        j = int(np.argmax(a[IDX_KCAL] * sigma))
        candidato = _pulir_una(a, sigma, lo, hi, bandas, j)
        tot_c = a @ candidato
        err_c = error_de(tot_c, bandas)
        if err_c < error:
            sigma, totales, error = candidato, tot_c, err_c

    return ResultadoPorcionado(sigma, totales, error)


def culpabilidad(a: np.ndarray, sigma: np.ndarray, totales: np.ndarray, bandas: Bandas):
    """Qué receta empuja en la dirección equivocada. §4.1

    La spec culpaba a "la de mayor distancia composicional al residuo", que es
    una heurística ciega al resultado del LP teniendo el LP toda la información.
    Aquí se usa la dirección de necesidad g (g_n > 0: falta ese nutriente;
    g_n < 0: sobra) y se culpa a quien aporta mucho de lo que sobra y poco de lo
    que falta. Funciona igual cuando el problema es de magnitud y no de
    composición: si sobran kcal, la receta más calórica es la más culpable.
    """
    u_mas, u_menos = desviaciones(totales, bandas)
    g = (bandas.w_menos * u_menos - bandas.w_mas * u_mas) / bandas.e
    aporte = a * np.asarray(sigma)[None, :] / bandas.e[:, None]
    return -(g[None, :] @ aporte).ravel()


__all__ = [
    "Bandas",
    "ResultadoPorcionado",
    "bandas_de",
    "construir_lp",
    "culpabilidad",
    "desviaciones",
    "error_de",
    "resolver_porciones",
]
