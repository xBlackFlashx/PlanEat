"""Segunda pasada, más fina, de medir_recetas_distintas.py.

El barrido grueso (medir_recetas_distintas.py, 21 combos de MAX_USOS_RECETA_
SEMANA x NU_REPETICION) deja claro que MAX_USOS_RECETA_SEMANA=2 es el único
valor que garantiza estructuralmente "ninguna receta repetida >2 veces"
(%rep<=2 = 100,0% en las 7 columnas de NU_REP probadas; con MAX_USOS=3 ese
%rep<=2 nunca pasa de 20,6% y con MAX_USOS=4 nunca pasa de 3,1%, confirmando
que NU_REPETICION -penalización blanda- no puede sustituir al tope duro para
esa garantía). Con MAX_USOS=2 fijo, subir NU_REPETICION por encima del valor
actual (0,05) sólo empeora: ingredientes/semana sube de 26,74 a 36+ y %cuadra
baja de 58,3% a 43,5%, sin mejorar recetas distintas de forma proporcional
(ya están en 14,10 de media / 83,8% >=12 en NU_REP=0,05).

Esta segunda pasada explora, con MAX_USOS_RECETA_SEMANA=2 fijo, si bajar
NU_REPETICION (para no sumarle más presión a los ingredientes) y/o subir
LAMBDA_INGREDIENTES (el término que sí empuja a compartir ingredientes,
ortogonal a la variedad de recetas) puede acercar la media de ingredientes/
semana a la ventana 15-25 sin perder la variedad de recetas ya lograda.

Uso:
    cd services/solver
    ./.venv/bin/python scripts/medir_recetas_distintas_fino.py
"""

from __future__ import annotations

from app.solver import motor as motor_mod
from app.solver import semanal
from medir_recetas_distintas import medir

MAX_USOS_FIJO = 2


def main() -> None:
    max_usos_orig = motor_mod.MAX_USOS_RECETA_SEMANA
    nu_rep_orig = semanal.NU_REPETICION
    lam_orig = semanal.LAMBDA_INGREDIENTES
    try:
        combos = [
            (nu, lam)
            for lam in (0.12, 0.16, 0.20, 0.25, 0.30)
            for nu in (0.0, 0.02, 0.05, 0.08)
        ]
        resultados = [medir(MAX_USOS_FIJO, nu, lam) for nu, lam in combos]
    finally:
        motor_mod.MAX_USOS_RECETA_SEMANA = max_usos_orig
        semanal.MAX_USOS_RECETA_SEMANA = max_usos_orig
        semanal.NU_REPETICION = nu_rep_orig
        semanal.LAMBDA_INGREDIENTES = lam_orig

    header = (
        f"{'NU_REP':>6} | {'LAMBDA':>6} | {'ingr_med':>8} | {'ingr[min,max]':>13} | "
        f"{'%[15,25]':>8} | {'recetas_med':>11} | {'recetas_min':>11} | {'%>=12rec':>8} | "
        f"{'rep_max_med':>11} | {'%rep<=2':>7} | {'%cuadra':>7} | {'fallos':>6}"
    )
    print(f"MAX_USOS_RECETA_SEMANA={MAX_USOS_FIJO} (fijo)")
    print(header)
    for r in resultados:
        print(
            f"{r['nu_rep']:>6.2f} | {r['lam']:>6.2f} | {r['ingr_media']:>8.2f} | "
            f"[{r['ingr_min']:>3},{r['ingr_max']:>3}]{'':>4} | {r['ingr_pct_15_25']:>7.1f}% | "
            f"{r['recetas_media']:>11.2f} | {r['recetas_min']:>11} | {r['recetas_pct_ge12']:>7.1f}% | "
            f"{r['rep_max_media']:>11.2f} | {r['pct_rep_le2']:>6.1f}% | "
            f"{r['tasa_cuadra']:>6.1f}% | {r['fallos']:>6}"
        )


if __name__ == "__main__":
    main()
