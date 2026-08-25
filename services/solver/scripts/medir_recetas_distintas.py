"""Mide el efecto conjunto de (MAX_USOS_RECETA_SEMANA, NU_REPETICION) sobre la
VARIEDAD DE RECETAS por semana, no sólo sobre ingredientes/semana.

Contexto (quinta ronda de "menos ingredientes", esta vez por el lado opuesto):
las cuatro rondas anteriores bajaron la despensa semanal de ~41 a ~19,85
ingredientes/semana subiendo W_NUEVO (scoring.py §2.2h), LAMBDA_INGREDIENTES y
MAX_USOS_RECETA_SEMANA=4 (semanal.py + motor.py). Pero esas tres palancas
juntas tienen un efecto secundario que ninguna medición anterior miró
directamente: exprimen MUY pocas recetas distintas. Planes de 7 días x 3
comidas generados a mano con el catálogo actual (240 recetas) para
omnívoro/vegetariano/vegano usan sólo 6-7 recetas distintas para las 21
comidas de la semana, varias repetidas 3-4 veces -exactamente el límite duro
MAX_USOS_RECETA_SEMANA=4-. Es la causa raíz de la queja de usuario ("toda la
semana tofu teriyaki y arroz").

Este script mide, para cada combo (MAX_USOS_RECETA_SEMANA, NU_REPETICION), TRES
cosas a la vez, en la misma corrida, para no optimizar una a costa de las
otras dos:
  (a) ingredientes distintos/semana (objetivo 15-25, un poco más está bien)
  (b) recetas DISTINTAS/semana y repeticiones máximas de una receta (objetivo:
      ninguna receta >2 veces en 21 comidas, al menos ~12-14 recetas
      distintas/semana)
  (c) tasa de "Cuadra"

LAMBDA_INGREDIENTES se deja fijo en 0,12 (el valor ya calibrado en la ronda
anterior) durante el barrido principal: el encargo pide tocar W_NUEVO/
LAMBDA_INGREDIENTES sólo "si hace falta", después de agotar MAX_USOS_RECETA_
SEMANA y NU_REPETICION.

Uso:
    cd services/solver
    ./.venv/bin/python scripts/medir_recetas_distintas.py
"""

from __future__ import annotations

import statistics

from app.catalogo import cargar_catalogo
from app.schemas import RestriccionesGeneracion, SolicitudGeneracion
from app.solver import motor as motor_mod
from app.solver import semanal
from app.solver.motor import generar
from medir_w_sol import SLOTS_3, _cuadra, _n_ingredientes_semana, objetivo

CAT = cargar_catalogo()

# Perfiles: (nombre, dieta, slots, comensales, kcal). Los tres que pide el
# encargo como mínimo (de_todo, vegetariana, vegana) más el 5-slots omnívoro
# que ya traía medir_w_sol.py, para no perder cobertura de esa ronda.
SLOTS_5 = ["desayuno", "almuerzo", "comida", "merienda", "cena"]
PERFILES = [
    ("de_todo_3_omnivora_2000", "omnivora", SLOTS_3, 1, 2000),
    ("5slots_omnivora_2200", "omnivora", SLOTS_5, 1, 2200),
    ("vegetariana_3_1800", "vegetariana", SLOTS_3, 2, 1800),
    ("vegana_3_1800", "vegana", SLOTS_3, 1, 1800),
]
SEMILLAS = list(range(1, 41))
LAMBDA_FIJA = 0.12


def medir(max_usos: int, nu_rep: float, lam: float = LAMBDA_FIJA) -> dict:
    motor_mod.MAX_USOS_RECETA_SEMANA = max_usos
    semanal.MAX_USOS_RECETA_SEMANA = max_usos
    semanal.NU_REPETICION = nu_rep
    semanal.LAMBDA_INGREDIENTES = lam

    ingredientes_por_semana: list[tuple[str, int, int]] = []
    recetas_distintas_por_semana: list[tuple[str, int, int]] = []
    max_rep_por_semana: list[tuple[str, int, int]] = []
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
            conteo: dict[str, int] = {}
            cuadran_semana = 0
            for dia in resp.dias:
                dias_totales += 1
                if _cuadra(dia):
                    dias_cuadran += 1
                    cuadran_semana += 1
                for comida in dia.comidas:
                    for item in comida.items:
                        recetas_usadas.add(item.recetaId)
                        conteo[item.recetaId] = conteo.get(item.recetaId, 0) + 1
            n_ingr = _n_ingredientes_semana(recetas_usadas)
            ingredientes_por_semana.append((nombre, seed, n_ingr))
            recetas_distintas_por_semana.append((nombre, seed, len(recetas_usadas)))
            max_rep_por_semana.append((nombre, seed, max(conteo.values()) if conteo else 0))
            cuadra_por_semana[(nombre, seed)] = cuadran_semana / len(resp.dias)

    n_semanas = len(ingredientes_por_semana) or 1
    return {
        "max_usos": max_usos,
        "nu_rep": nu_rep,
        "lam": lam,
        "ingredientes_por_semana": ingredientes_por_semana,
        "recetas_distintas_por_semana": recetas_distintas_por_semana,
        "max_rep_por_semana": max_rep_por_semana,
        "cuadra_por_semana": cuadra_por_semana,
        "ingr_media": statistics.mean(n for _, _, n in ingredientes_por_semana),
        "ingr_min": min(n for _, _, n in ingredientes_por_semana),
        "ingr_max": max(n for _, _, n in ingredientes_por_semana),
        "ingr_pct_15_25": sum(1 for _, _, n in ingredientes_por_semana if 15 <= n <= 25)
        / n_semanas
        * 100,
        "recetas_media": statistics.mean(n for _, _, n in recetas_distintas_por_semana),
        "recetas_min": min(n for _, _, n in recetas_distintas_por_semana),
        "recetas_pct_ge12": sum(
            1 for _, _, n in recetas_distintas_por_semana if n >= 12
        )
        / n_semanas
        * 100,
        "rep_max_media": statistics.mean(n for _, _, n in max_rep_por_semana),
        "rep_max_maximo": max(n for _, _, n in max_rep_por_semana),
        "pct_rep_le2": sum(1 for _, _, n in max_rep_por_semana if n <= 2)
        / n_semanas
        * 100,
        "tasa_cuadra": dias_cuadran / dias_totales * 100 if dias_totales else float("nan"),
        "fallos": fallos,
    }


def main() -> None:
    max_usos_orig = motor_mod.MAX_USOS_RECETA_SEMANA
    nu_rep_orig = semanal.NU_REPETICION
    lam_orig = semanal.LAMBDA_INGREDIENTES
    try:
        combos = [
            (m, nu)
            for m in (2, 3, 4)
            for nu in (0.05, 0.15, 0.3, 0.5, 0.8, 1.2, 2.0)
        ]
        resultados = [medir(m, nu) for m, nu in combos]
    finally:
        motor_mod.MAX_USOS_RECETA_SEMANA = max_usos_orig
        semanal.MAX_USOS_RECETA_SEMANA = max_usos_orig
        semanal.NU_REPETICION = nu_rep_orig
        semanal.LAMBDA_INGREDIENTES = lam_orig

    header = (
        f"{'MAX':>4} | {'NU_REP':>6} | {'ingr_med':>8} | {'ingr[min,max]':>13} | "
        f"{'%[15,25]':>8} | {'recetas_med':>11} | {'recetas_min':>11} | {'%>=12rec':>8} | "
        f"{'rep_max_med':>11} | {'rep_max_max':>11} | {'%rep<=2':>7} | {'%cuadra':>7} | {'fallos':>6}"
    )
    print(header)
    for r in resultados:
        print(
            f"{r['max_usos']:>4} | {r['nu_rep']:>6.2f} | {r['ingr_media']:>8.2f} | "
            f"[{r['ingr_min']:>3},{r['ingr_max']:>3}]{'':>4} | {r['ingr_pct_15_25']:>7.1f}% | "
            f"{r['recetas_media']:>11.2f} | {r['recetas_min']:>11} | {r['recetas_pct_ge12']:>7.1f}% | "
            f"{r['rep_max_media']:>11.2f} | {r['rep_max_maximo']:>11} | {r['pct_rep_le2']:>6.1f}% | "
            f"{r['tasa_cuadra']:>6.1f}% | {r['fallos']:>6}"
        )


if __name__ == "__main__":
    main()
