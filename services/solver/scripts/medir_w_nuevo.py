"""Mide el efecto conjunto de (W_SOL, W_NUEVO) sobre ingredientes/semana y %cuadra.

Hermano de medir_w_sol.py, para la ronda en la que ajustar sólo W_SOL se agotó
(el barrido de medir_w_sol.py de esta misma ronda: subir W_SOL de 3.2 a 6.0 no
movió la media de ingredientes -~41 en todo el rango- y sólo hundió %cuadra).
Ese resultado es la evidencia que motiva el término estructural nuevo de
scoring.py §2.2h: `sol` premia la FRACCIÓN de la receta ya cubierta y por eso
trata igual a una receta pequeña sin nada en la despensa que a una grande sin
nada en la despensa, cuando la segunda pesa mucho más en la lista de la
compra. `W_NUEVO` penaliza el conteo ABSOLUTO de ingredientes nuevos.

Reutiliza el harness de medir_w_sol.py (perfiles, `_cuadra`,
`_n_ingredientes_semana`, catálogo) y parchea ambas constantes en caliente.

Uso:
    cd services/solver
    ./.venv/bin/python scripts/medir_w_nuevo.py
"""

from __future__ import annotations

import statistics

from app.schemas import RestriccionesGeneracion, SolicitudGeneracion
from app.solver import scoring
from app.solver.motor import generar
from medir_w_sol import CAT, PERFILES, _cuadra, _n_ingredientes_semana, objetivo

# El doble de semillas que medir_w_sol.py: a 20 el orden entre puntos cercanos
# del barrido (§ combos de main()) no era estable de una corrida a otra.
SEMILLAS = list(range(1, 41))


def medir(w_sol: float, w_nuevo: float) -> dict:
    scoring.W_SOL = w_sol
    scoring.W_NUEVO = w_nuevo
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
        "w_sol": w_sol,
        "w_nuevo": w_nuevo,
        "ingredientes_por_semana": ingredientes_por_semana,
        "cuadra_por_semana": cuadra_por_semana,
        "media": statistics.mean(n for _, _, n in ingredientes_por_semana),
        "mediana": statistics.median(n for _, _, n in ingredientes_por_semana),
        "tasa_cuadra": dias_cuadran / dias_totales if dias_totales else float("nan"),
        "fallos": fallos,
    }


def main() -> None:
    w_sol_orig, w_nuevo_orig = scoring.W_SOL, scoring.W_NUEVO
    try:
        # (3.2, 0.0) es el control: W_SOL solo, W_NUEVO desactivado (el estado
        # anterior a esta ronda). El resto es el barrido que decidió el punto
        # final W_SOL=2.4 / W_NUEVO=3.0: se prueba alrededor de ese óptimo con
        # 40 semillas por combinación (el doble que medir_w_sol.py) porque a 20
        # semillas el orden entre puntos cercanos no era estable.
        combos = [
            (3.2, 0.0),
            (2.4, 2.5),
            (2.4, 3.0),  # elegido
            (2.4, 3.5),
            (2.4, 4.0),
            (2.0, 4.0),
            (1.6, 4.0),
        ]
        resultados = [medir(ws, wn) for ws, wn in combos]
    finally:
        scoring.W_SOL, scoring.W_NUEVO = w_sol_orig, w_nuevo_orig

    print(f"{'W_SOL':>6} | {'W_NUEVO':>7} | {'media':>7} | {'mediana':>7} | {'%cuadra':>8} | {'fallos':>6}")
    for r in resultados:
        print(
            f"{r['w_sol']:>6.2f} | {r['w_nuevo']:>7.2f} | {r['media']:>7.2f} | "
            f"{r['mediana']:>7.1f} | {r['tasa_cuadra'] * 100:>7.1f}% | {r['fallos']:>6}"
        )

    base = resultados[0]
    base_ingr = {(n, s): v for n, s, v in base["ingredientes_por_semana"]}
    print()
    print("Comparacion pareada contra (W_SOL=%.2f, W_NUEVO=%.2f):" % (base["w_sol"], base["w_nuevo"]))
    for r in resultados[1:]:
        deltas_ingr = [v - base_ingr[(n, s)] for n, s, v in r["ingredientes_por_semana"]]
        deltas_cuadra = [
            r["cuadra_por_semana"][k] - base["cuadra_por_semana"][k] for k in r["cuadra_por_semana"]
        ]
        print(
            f"  ({r['w_sol']:.2f}, {r['w_nuevo']:.2f}): d_ingr_media={statistics.mean(deltas_ingr):+.2f}  "
            f"d_cuadra_media={statistics.mean(deltas_cuadra) * 100:+.2f}pp"
        )


if __name__ == "__main__":
    main()
