"""Mide el efecto conjunto de (K_CANDIDATOS_DIA, LAMBDA_INGREDIENTES) sobre el
numero de ingredientes distintos por semana.

Contexto: `medir_lambda_ingredientes.py` (misma ronda) muestra que subir
LAMBDA_INGREDIENTES desde el 0.006 original hace caer la media de ~37.6 a un
suelo de ~27.3 alrededor de lam=0.08-0.12, y NO baja mas ni subiendo lam a
0.5 -media identica en todo ese rango-. Ese suelo es sospechoso de venir de
`K_CANDIDATOS_DIA=6`: la etapa D (recocido) sólo puede ELEGIR entre los K
candidatos ya generados por día, nunca inventar uno nuevo -y el candidato
"mejor" que cierra cada día (para generar el día siguiente, `semanal.py
generar_candidatos`) se escoge SÓLO por error nutricional, sin mirar
ingredientes-, así que con pocos candidatos por día la annealing puede no
tener ningún combo con solape realmente alto entre los que elegir. Subir K da
más materia prima para que el término LAMBDA_INGREDIENTES encuentre mejores
combinaciones.

Barrido reducido (menos semillas que medir_w_sol.py/medir_lambda_ingredientes
-exploratorio, sólo para decidir si K vale la pena antes de una medición
completa) a LAMBDA_INGREDIENTES fijo en el suelo encontrado (0.12).

Uso:
    cd services/solver
    ./.venv/bin/python scripts/medir_k_candidatos.py
"""

from __future__ import annotations

import statistics

from app.solver import semanal
from app.schemas import RestriccionesGeneracion, SolicitudGeneracion
from app.solver.motor import generar
from medir_w_sol import CAT, PERFILES, _cuadra, _n_ingredientes_semana, objetivo

SEMILLAS = list(range(1, 16))  # exploratorio: 15 en vez de 40
LAMBDA_FIJA = 0.12


def medir(k: int, lam: float = LAMBDA_FIJA) -> dict:
    semanal.K_CANDIDATOS_DIA = k
    semanal.LAMBDA_INGREDIENTES = lam
    ingredientes_por_semana = []
    cuadra_por_semana: dict[tuple[str, int], float] = {}
    dias_totales = 0
    dias_cuadran = 0
    fallos = 0
    for nombre, dieta, slots, comensales, kcal in PERFILES:
        for seed in SEMILLAS:
            restr = RestriccionesGeneracion(dieta=dieta, slots=slots, comensales=comensales)
            solicitud = SolicitudGeneracion(
                objetivos=[objetivo(kcal)] * 7, restricciones=restr, seed=seed
            )
            resp, _traza = generar(solicitud, CAT)
            if not getattr(resp, "ok", False):
                fallos += 1
                continue
            recetas_usadas: set[str] = set()
            cuadran_semana = 0
            for dia in resp.dias:
                dias_totales += 1
                if _cuadra(dia):
                    dias_cuadran += 1
                    cuadran_semana += 1
                for comida in dia.comidas:
                    for item in comida.items:
                        recetas_usadas.add(item.recetaId)
            n_ingr = _n_ingredientes_semana(recetas_usadas)
            ingredientes_por_semana.append((nombre, seed, n_ingr))
            cuadra_por_semana[(nombre, seed)] = cuadran_semana / len(resp.dias)
    return {
        "k": k,
        "lam": lam,
        "ingredientes_por_semana": ingredientes_por_semana,
        "cuadra_por_semana": cuadra_por_semana,
        "media": statistics.mean(n for _, _, n in ingredientes_por_semana),
        "mediana": statistics.median(n for _, _, n in ingredientes_por_semana),
        "maximo": max(n for _, _, n in ingredientes_por_semana),
        "minimo": min(n for _, _, n in ingredientes_por_semana),
        "tasa_cuadra": dias_cuadran / dias_totales if dias_totales else float("nan"),
        "fallos": fallos,
    }


def main() -> None:
    k_original = semanal.K_CANDIDATOS_DIA
    lam_original = semanal.LAMBDA_INGREDIENTES
    try:
        valores_k = [6, 10, 14, 20]
        resultados = [medir(k) for k in valores_k]
    finally:
        semanal.K_CANDIDATOS_DIA = k_original
        semanal.LAMBDA_INGREDIENTES = lam_original

    print(f"{'K':>4} | {'lam':>5} | {'media':>7} | {'mediana':>7} | {'min':>4} | {'max':>4} | {'%cuadra':>8} | {'fallos':>6}")
    for r in resultados:
        print(
            f"{r['k']:>4} | {r['lam']:>5.2f} | {r['media']:>7.2f} | {r['mediana']:>7.1f} | "
            f"{r['minimo']:>4} | {r['maximo']:>4} | {r['tasa_cuadra'] * 100:>7.1f}% | {r['fallos']:>6}"
        )


if __name__ == "__main__":
    main()
