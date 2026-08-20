"""Confirmacion final (40 semillas) de los combos candidatos (MAX_USOS_RECETA_SEMANA,
LAMBDA_INGREDIENTES) preseleccionados por el barrido exploratorio de
medir_max_usos.py. Script de un solo uso para esta ronda.

Uso:
    cd services/solver
    ./.venv/bin/python scripts/confirmar_final.py
"""

from __future__ import annotations

import statistics

from app.solver import motor as motor_mod
from app.solver import semanal
from app.schemas import RestriccionesGeneracion, SolicitudGeneracion
from app.solver.motor import generar
from medir_w_sol import CAT, PERFILES, _cuadra, _n_ingredientes_semana, objetivo

SEMILLAS = list(range(1, 41))


def medir(max_usos: int, lam: float) -> dict:
    motor_mod.MAX_USOS_RECETA_SEMANA = max_usos
    semanal.MAX_USOS_RECETA_SEMANA = max_usos
    semanal.LAMBDA_INGREDIENTES = lam
    ingr = []
    dias_totales = dias_cuadran = fallos = 0
    for nombre, dieta, slots, comensales, kcal in PERFILES:
        for seed in SEMILLAS:
            restr = RestriccionesGeneracion(dieta=dieta, slots=slots, comensales=comensales)
            sol = SolicitudGeneracion(objetivos=[objetivo(kcal)] * 7, restricciones=restr, seed=seed)
            resp, _traza = generar(sol, CAT)
            if not getattr(resp, "ok", False):
                fallos += 1
                continue
            usadas: set[str] = set()
            for dia in resp.dias:
                dias_totales += 1
                if _cuadra(dia):
                    dias_cuadran += 1
                for comida in dia.comidas:
                    for item in comida.items:
                        usadas.add(item.recetaId)
            ingr.append(_n_ingredientes_semana(usadas))
    return {
        "max_usos": max_usos,
        "lam": lam,
        "media": statistics.mean(ingr),
        "mediana": statistics.median(ingr),
        "min": min(ingr),
        "max": max(ingr),
        "pct_15_25": sum(1 for n in ingr if 15 <= n <= 25) / len(ingr) * 100,
        "tasa_cuadra": dias_cuadran / dias_totales * 100,
        "fallos": fallos,
    }


def main() -> None:
    combos = [(3, 0.12), (3, 0.18), (3, 0.25), (4, 0.10), (4, 0.12)]
    print(
        f"{'MAX':>4} | {'lam':>5} | {'media':>7} | {'mediana':>7} | {'min':>4} | {'max':>4} | "
        f"{'%en[15,25]':>10} | {'%cuadra':>8} | {'fallos':>6}"
    )
    for mu, lam in combos:
        r = medir(mu, lam)
        print(
            f"{r['max_usos']:>4} | {r['lam']:>5.2f} | {r['media']:>7.2f} | {r['mediana']:>7.1f} | "
            f"{r['min']:>4} | {r['max']:>4} | {r['pct_15_25']:>9.1f}% | {r['tasa_cuadra']:>7.1f}% | {r['fallos']:>6}"
        )


if __name__ == "__main__":
    main()
