"""Mide el efecto de LAMBDA_INGREDIENTES (etapa D, recocido semanal) sobre el
numero de ingredientes distintos por semana.

Cuarta ronda de la misma tarea ("bajar el tamano de la despensa semanal"): las
tres rondas anteriores sólo tocaron el scoring por slot (W_SOL, W_NUEVO en
scoring.py §2.2), que decide qué receta gana DENTRO de un día/slot. Ese lever
se agotó: con W_SOL=2.4/W_NUEVO=3.0 la media quedó en ~37-38 ingredientes/
semana y no bajaba más subiendo esos pesos. Pero hay una segunda etapa,
totalmente separada, que scoring.py no toca: la etapa D (semanal.py, recocido
simulado) elige, para cada día, uno de K_CANDIDATOS_DIA=6 planes-de-día ya
generados, minimizando

    coste = error_nutricional + LAMBDA_INGREDIENTES * ingredientes_unicos_semana
            + MU_PRESUPUESTO * exceso + NU_REPETICION * repeticion

LAMBDA_INGREDIENTES=0.006 se eligió (semanal.py `_coste`) para que quitar 10
ingredientes cueste lo mismo que empeorar un día en 6 puntos de desviación
nutricional -casi todo su presupuesto de error-. Ese calibre es exactamente lo
que hay que revisar ahora: el usuario pide explícitamente una despensa MUCHO
más agresiva (15-25 ingredientes/semana en vez de ~37) aunque cueste bastante
más precisión nutricional que antes.

Parchea `semanal.LAMBDA_INGREDIENTES` en caliente (igual que medir_w_sol.py
parchea `scoring.W_SOL`) y reutiliza el mismo harness de medir_w_sol.py.

Uso:
    cd services/solver
    ./.venv/bin/python scripts/medir_lambda_ingredientes.py
"""

from __future__ import annotations

import statistics

from app.solver import semanal
from app.schemas import RestriccionesGeneracion, SolicitudGeneracion
from app.solver.motor import generar
from medir_w_sol import CAT, PERFILES, _cuadra, _n_ingredientes_semana, objetivo

SEMILLAS = list(range(1, 41))


def medir(lam: float) -> dict:
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
    lam_original = semanal.LAMBDA_INGREDIENTES
    try:
        # 0.006 es el control (valor actual, sin tocar en las 3 rondas
        # anteriores). El resto sube en orden de magnitud: si a 0.10 el coste
        # de "quitar 10 ingredientes" ya vale ~1.7 puntos de desviación
        # nutricional en vez de 6, la annealing debería preferir mucho más
        # la superposición aunque empeore bastante el ajuste de macros.
        valores = [0.006, 0.02, 0.05, 0.08, 0.12, 0.18, 0.25, 0.35, 0.5]
        resultados = [medir(v) for v in valores]
    finally:
        semanal.LAMBDA_INGREDIENTES = lam_original

    print(f"{'LAMBDA':>7} | {'media':>7} | {'mediana':>7} | {'min':>4} | {'max':>4} | {'%cuadra':>8} | {'fallos':>6}")
    for r in resultados:
        print(
            f"{r['lam']:>7.3f} | {r['media']:>7.2f} | {r['mediana']:>7.1f} | "
            f"{r['minimo']:>4} | {r['maximo']:>4} | {r['tasa_cuadra'] * 100:>7.1f}% | {r['fallos']:>6}"
        )

    base = resultados[0]
    base_ingr = {(n, s): v for n, s, v in base["ingredientes_por_semana"]}
    print()
    print("Comparacion pareada contra LAMBDA_INGREDIENTES=%.3f (control):" % base["lam"])
    for r in resultados[1:]:
        deltas_ingr = [v - base_ingr[(n, s)] for n, s, v in r["ingredientes_por_semana"]]
        deltas_cuadra = [
            r["cuadra_por_semana"][k] - base["cuadra_por_semana"][k] for k in r["cuadra_por_semana"]
        ]
        print(
            f"  lam={r['lam']:.3f}: d_ingr_media={statistics.mean(deltas_ingr):+.2f}  "
            f"d_cuadra_media={statistics.mean(deltas_cuadra) * 100:+.2f}pp  fallos={r['fallos']}"
        )


if __name__ == "__main__":
    main()
