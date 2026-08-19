"""Mide el efecto de W_SOL sobre el numero de ingredientes distintos por semana.

Herramienta de un solo uso para la tarea "bajar el tamano de la despensa
semanal". Genera semanas completas (7 dias) con el pool/contexto REALES
(catalogo cargado de disco, sin mocks) para varios perfiles/semillas, cuenta
ingredientes distintos por semana (union de bits de las recetas usadas, igual
que hace `listaDeLaCompra` en la web) y la tasa de dias que "Cuadra" (kcal
dentro de tolerancia y los tres macros dentro de rango), y repite todo para
distintos valores de W_SOL parcheando el modulo en caliente.

Uso:
    cd services/solver
    ./.venv/bin/python scripts/medir_w_sol.py
"""

from __future__ import annotations

import statistics
from dataclasses import replace

from app.catalogo import cargar_catalogo
from app.schemas import RestriccionesGeneracion, SolicitudGeneracion
from app.solver import scoring
from app.solver.motor import generar

CAT = cargar_catalogo()

SLOTS_3 = ["desayuno", "comida", "cena"]
SLOTS_5 = ["desayuno", "almuerzo", "comida", "merienda", "cena"]


def objetivo(kcal: float = 2000) -> dict:
    return {
        "kcal": kcal,
        "toleranciaKcal": 0.05,
        "proteinaG": {"min": 120, "max": 160},
        "carbohidratoG": {"min": 180, "max": 250},
        "grasaG": {"min": 55, "max": 80},
        "fibraMinG": 20,
    }


# Perfiles: (nombre, dieta, slots, comensales, kcal)
PERFILES = [
    ("por_defecto_3_omnivora_2000", "omnivora", SLOTS_3, 1, 2000),
    ("5slots_omnivora_2200", "omnivora", SLOTS_5, 1, 2200),
    ("vegetariana_3_1800", "vegetariana", SLOTS_3, 2, 1800),
]
SEMILLAS = list(range(1, 21))


def _n_ingredientes_semana(recetas_usadas: set[str]) -> int:
    palabras = CAT.ingr_bits.shape[1]
    acumulado = [0] * palabras
    for rid in recetas_usadas:
        fila = CAT.idx_por_id.get(rid)
        if fila is None:
            continue
        bits = CAT.ingr_bits[fila]
        for w in range(palabras):
            acumulado[w] |= int(bits[w])
    return sum(bin(w).count("1") for w in acumulado)


def _cuadra(dia) -> bool:
    obj = dia.objetivo
    tot = dia.totales
    tol = obj.kcal * obj.toleranciaKcal
    if abs(tot.kcal - obj.kcal) > tol:
        return False
    for valor, rango in (
        (tot.proteinaG, obj.proteinaG),
        (tot.carbohidratoG, obj.carbohidratoG),
        (tot.grasaG, obj.grasaG),
    ):
        v = round(valor)
        if v < round(rango.min) or v > round(rango.max):
            return False
    return True


def medir(w_sol: float) -> dict:
    scoring.W_SOL = w_sol
    ingredientes_por_semana = []
    cuadra_por_semana: dict[tuple[str, int], float] = {}
    dias_totales = 0
    dias_cuadran = 0
    fallos = 0
    for nombre, dieta, slots, comensales, kcal in PERFILES:
        for seed in SEMILLAS:
            restr = RestriccionesGeneracion(
                dieta=dieta,
                slots=slots,
                comensales=comensales,
            )
            solicitud = SolicitudGeneracion(
                objetivos=[objetivo(kcal)] * 7,
                restricciones=restr,
                seed=seed,
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
        "ingredientes_por_semana": ingredientes_por_semana,
        "cuadra_por_semana": cuadra_por_semana,
        "media": statistics.mean(n for _, _, n in ingredientes_por_semana),
        "mediana": statistics.median(n for _, _, n in ingredientes_por_semana),
        "tasa_cuadra": dias_cuadran / dias_totales if dias_totales else float("nan"),
        "dias_totales": dias_totales,
        "fallos": fallos,
    }


def main() -> None:
    w_sol_original = scoring.W_SOL
    try:
        valores = [3.2, 3.6, 4.0, 4.5, 5.0, 5.5, 6.0]
        resultados = [medir(w) for w in valores]
    finally:
        scoring.W_SOL = w_sol_original

    print(f"{'W_SOL':>6} | {'media':>7} | {'mediana':>7} | {'%cuadra':>8} | {'fallos':>6}")
    for r in resultados:
        print(
            f"{r['w_sol']:>6.2f} | {r['media']:>7.2f} | {r['mediana']:>7.1f} | "
            f"{r['tasa_cuadra'] * 100:>7.1f}% | {r['fallos']:>6}"
        )

    base = resultados[0]
    base_ingr = {(n, s): v for n, s, v in base["ingredientes_por_semana"]}
    print()
    print("Comparacion pareada contra W_SOL=%.2f (mismo perfil+seed):" % base["w_sol"])
    print(
        f"{'W_SOL':>6} | {'d_ingr_media':>13} | {'semanas -':>10} | "
        f"{'semanas =':>10} | {'semanas +':>10} | {'d_cuadra_media':>15}"
    )
    for r in resultados[1:]:
        deltas_ingr = []
        menos = igual = mas = 0
        for n, s, v in r["ingredientes_por_semana"]:
            d = v - base_ingr[(n, s)]
            deltas_ingr.append(d)
            if d < 0:
                menos += 1
            elif d > 0:
                mas += 1
            else:
                igual += 1
        deltas_cuadra = [
            r["cuadra_por_semana"][k] - base["cuadra_por_semana"][k]
            for k in r["cuadra_por_semana"]
        ]
        print(
            f"{r['w_sol']:>6.2f} | {statistics.mean(deltas_ingr):>13.2f} | "
            f"{menos:>10} | {igual:>10} | {mas:>10} | "
            f"{statistics.mean(deltas_cuadra) * 100:>14.2f}%"
        )

    print()
    for r in resultados:
        print(f"--- W_SOL={r['w_sol']:.2f} ---")
        for nombre, seed, n in r["ingredientes_por_semana"]:
            print(f"  {nombre:35s} seed={seed}  ingredientes={n}")


if __name__ == "__main__":
    main()
