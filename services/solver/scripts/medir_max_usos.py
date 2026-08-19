"""Mide el efecto conjunto de (MAX_USOS_RECETA_SEMANA, LAMBDA_INGREDIENTES).

Contexto: `medir_k_candidatos.py` (misma ronda) descarta K_CANDIDATOS_DIA como
causa del suelo de ~26-27 ingredientes/semana que deja LAMBDA_INGREDIENTES
solo -subir K de 6 a 20 no mueve la media un ápice-. El suelo real es
estructural: con `MAX_USOS_RECETA_SEMANA=2` hacen falta al menos
ceil(21/2)=11 recetas distintas para cubrir 3 comidas x 7 días, y con ~4,5
ingredientes/receta de media eso empuja el mínimo teórico bastante por encima
de 15-25 aunque la superposición entre esas 11 recetas sea perfecta. Subir
MAX_USOS_RECETA_SEMANA a 3 o 4 baja ese mínimo a ceil(21/3)=7 u ceil(21/4)=6
recetas.

`_min_candidatos_slot` (motor.py) ya deriva `holgura` de
`MIN_CANDIDATOS_SLOT_SEMANA` en caliente a partir de `MAX_USOS_RECETA_SEMANA`,
así que no hace falta tocar esa constante aparte -sólo
MAX_USOS_RECETA_SEMANA en motor.py Y semanal.py (los dos módulos que la
importan por valor).

Uso:
    cd services/solver
    ./.venv/bin/python scripts/medir_max_usos.py
"""

from __future__ import annotations

import statistics

from app.solver import motor as motor_mod
from app.solver import semanal
from app.schemas import RestriccionesGeneracion, SolicitudGeneracion
from app.solver.motor import generar
from medir_w_sol import CAT, PERFILES, _cuadra, _n_ingredientes_semana, objetivo

SEMILLAS = list(range(1, 16))  # exploratorio
LAMBDA_FIJA = 0.12


def medir(max_usos: int, lam: float = LAMBDA_FIJA) -> dict:
    motor_mod.MAX_USOS_RECETA_SEMANA = max_usos
    semanal.MAX_USOS_RECETA_SEMANA = max_usos
    semanal.LAMBDA_INGREDIENTES = lam
    ingredientes_por_semana = []
    cuadra_por_semana: dict[tuple[str, int], float] = {}
    dias_totales = 0
    dias_cuadran = 0
    fallos = 0
    max_repeticiones = 0
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
            cuadra_por_semana[(nombre, seed)] = cuadran_semana / len(resp.dias)
            if conteo:
                max_repeticiones = max(max_repeticiones, max(conteo.values()))
    return {
        "max_usos": max_usos,
        "lam": lam,
        "ingredientes_por_semana": ingredientes_por_semana,
        "cuadra_por_semana": cuadra_por_semana,
        "media": statistics.mean(n for _, _, n in ingredientes_por_semana),
        "mediana": statistics.median(n for _, _, n in ingredientes_por_semana),
        "maximo": max(n for _, _, n in ingredientes_por_semana),
        "minimo": min(n for _, _, n in ingredientes_por_semana),
        "tasa_cuadra": dias_cuadran / dias_totales if dias_totales else float("nan"),
        "fallos": fallos,
        "max_repeticiones_vistas": max_repeticiones,
    }


def main() -> None:
    max_usos_original = motor_mod.MAX_USOS_RECETA_SEMANA
    lam_original = semanal.LAMBDA_INGREDIENTES
    try:
        valores = [2, 3, 4, 5]
        resultados = [medir(v) for v in valores]
    finally:
        motor_mod.MAX_USOS_RECETA_SEMANA = max_usos_original
        semanal.MAX_USOS_RECETA_SEMANA = max_usos_original
        semanal.LAMBDA_INGREDIENTES = lam_original

    print(f"{'MAX_USOS':>8} | {'lam':>5} | {'media':>7} | {'mediana':>7} | {'min':>4} | {'max':>4} | {'%cuadra':>8} | {'fallos':>6} | {'rep_max':>7}")
    for r in resultados:
        print(
            f"{r['max_usos']:>8} | {r['lam']:>5.2f} | {r['media']:>7.2f} | {r['mediana']:>7.1f} | "
            f"{r['minimo']:>4} | {r['maximo']:>4} | {r['tasa_cuadra'] * 100:>7.1f}% | {r['fallos']:>6} | {r['max_repeticiones_vistas']:>7}"
        )


if __name__ == "__main__":
    main()
