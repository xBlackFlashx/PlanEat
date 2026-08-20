#!/usr/bin/env python3
"""Vuelca `cargar_catalogo()` a JSON para el test del compilador de TypeScript.

El port del motor al navegador precompila el catálogo en `build`
(`packages/motor/herramientas/compilar-catalogo.ts`). Ese compilador tiene que
producir exactamente los mismos números que este servicio: si el vocabulario de
alimentos se ordena distinto, o si `v_macro` se calcula en float64 en vez de
float32, los planes cambian y no hay ningún síntoma que lo delate.

La comparación no puede hacerse desde el test de Node (no hay Python en ese
proceso), así que se congela aquí un volcado literal y el test de TypeScript
compara contra él. Sin este script el volcado sería un blob sin procedencia.

Uso:
    cd services/solver && source .venv/bin/activate
    python scripts/volcar_referencia_catalogo.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from app.catalogo import cargar_catalogo
from app.solver import ALERGENOS, DIETAS, NUTRIENTES, SLOTS

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = (
    RAIZ.parent.parent
    / "packages"
    / "motor"
    / "pruebas"
    / "datos"
    / "referencia-python-catalogo.json"
)


def mascara_a_entero(m: np.ndarray) -> list[int]:
    """Colapsa una matriz booleana de pocas columnas a un entero por fila.

    Es la representación que usa el port: las máscaras de dieta (6), alérgeno
    (14) y slot (5) caben en un entero y el filtro base del pool pasa a ser un
    único bucle en vez de un barrido por columnas.
    """
    salida = []
    for fila in m:
        v = 0
        for j, b in enumerate(fila):
            if b:
                v |= 1 << j
        salida.append(v)
    return salida


def mascara_a_palabras(m: np.ndarray) -> list[list[int]]:
    """Como `mascara_a_entero`, pero en `ceil(columnas/32)` palabras por fila.

    `m_alergeno` ya no cabe en un único entero (2026-08-19: ALERGENOS pasó de
    14 a 25 columnas, camino a más) — el port empaqueta `mAlergeno` igual que
    los bitsets de ingredientes: palabra `j // 32`, bit `j % 32` dentro de
    ella, baja primero. Con columnas ≤ 32 da una lista de una palabra por
    fila, que es justo `mascara_a_entero` envuelta en `[...]`.
    """
    salida = []
    for fila in m:
        palabras: list[int] = [0] * max(1, (len(fila) + 31) // 32)
        for j, b in enumerate(fila):
            if b:
                palabras[j // 32] |= 1 << (j % 32)
        salida.append(palabras)
    return salida


def bits_a_u32(bits: np.ndarray) -> list[list[int]]:
    """Reempaqueta los bitsets de uint64 a palabras de 32 bits, la baja primero.

    JavaScript no tiene enteros de 64 bits sin BigInt, y BigInt en el bucle de
    popcount de la etapa A cuesta un orden de magnitud. El port usa Uint32Array.
    """
    salida = []
    for fila in bits:
        palabras: list[int] = []
        for w in fila:
            w = int(w)
            palabras.append(w & 0xFFFFFFFF)
            palabras.append((w >> 32) & 0xFFFFFFFF)
        salida.append(palabras)
    return salida


def main() -> None:
    cat = cargar_catalogo()
    ref = {
        "version": cat.version,
        "n": cat.n,
        "nAlimentos": cat.n_alimentos,
        "alimentoId": list(cat.alimento_id),
        "ids": [str(x) for x in cat.ids],
        "titulos": [str(x) for x in cat.titulos],
        "nutr": [float(x) for x in cat.nutr.reshape(-1)],
        "conocido": [int(x) for x in cat.conocido.reshape(-1)],
        "vMacro": [float(x) for x in cat.v_macro.reshape(-1)],
        "tieneMacro": [int(x) for x in cat.tiene_macro],
        "escalaMin": [float(x) for x in cat.escala_min],
        "escalaMax": [float(x) for x in cat.escala_max],
        "mDieta": mascara_a_entero(cat.m_dieta),
        "mAlergenoPalabras": mascara_a_palabras(cat.m_alergeno),
        "mSlot": mascara_a_entero(cat.m_slot),
        "minutos": [int(x) for x in cat.minutos],
        "nIngredientes": [int(x) for x in cat.n_ingredientes],
        "costeCents": [int(x) for x in cat.coste_cents],
        "costeConocido": [int(x) for x in cat.coste_conocido],
        "ingrBitsU32": bits_a_u32(cat.ingr_bits),
        "ingrPerecBitsU32": bits_a_u32(cat.ingr_perec_bits),
        "vocabulario": {
            "nutrientes": list(NUTRIENTES),
            "dietas": list(DIETAS),
            "alergenos": list(ALERGENOS),
            "slots": list(SLOTS),
        },
    }
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    with DESTINO.open("w", encoding="utf-8") as fh:
        json.dump(ref, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    print(f"escrito {DESTINO} ({cat.n} recetas, {cat.n_alimentos} alimentos, {cat.version})")


if __name__ == "__main__":
    main()
