"""Carga del catálogo en memoria.

Implementa `Catalogo` y `cargar_catalogo` según DISENO.md §1.1. El catálogo se
carga una vez por proceso y vive en memoria: la generación nunca toca disco.

El resto del servicio sólo conoce `Catalogo`. El día que la fuente pase de
`catalogo.jsonl` a una consulta a Postgres, cambia únicamente este módulo.

Invariante que sostiene todo lo demás: **todos los arrays están alineados por
índice de fila**. La fila `i` es siempre la misma receta, en todos ellos.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .solver import (
    ALERGENOS,
    DIETAS,
    ESCALA_MAX_POR_DEFECTO,
    ESCALA_MIN_POR_DEFECTO,
    IDX_ALERGENO,
    IDX_DIETA,
    IDX_SLOT,
    SLOTS,
)

RUTA_POR_DEFECTO = Path(__file__).resolve().parent.parent / "data" / "catalogo.jsonl"


@dataclass(frozen=True, slots=True)
class Catalogo:
    """Catálogo precalculado. Ver DISENO.md §1.1 para la justificación de cada campo."""

    version: str
    ids: np.ndarray
    idx_por_id: dict[str, int]
    titulos: np.ndarray

    # Nutrición por ración base. Columnas: kcal, proteína, carbohidrato,
    # grasa, fibra, sodio (orden fijo, ver solver.NUTRIENTES).
    nutr: np.ndarray
    conocido: np.ndarray

    # Composición macro normalizada: el término que decide la selección.
    v_macro: np.ndarray
    tiene_macro: np.ndarray

    escala_min: np.ndarray
    escala_max: np.ndarray

    m_dieta: np.ndarray
    m_alergeno: np.ndarray
    m_slot: np.ndarray
    minutos: np.ndarray

    ingr_bits: np.ndarray
    ingr_perec_bits: np.ndarray
    n_ingredientes: np.ndarray
    alimento_idx: dict[str, int]
    alimento_id: list[str]

    coste_cents: np.ndarray
    coste_conocido: np.ndarray

    @property
    def n(self) -> int:
        """Número de recetas."""
        return int(self.ids.shape[0])

    @property
    def n_alimentos(self) -> int:
        return len(self.alimento_id)


def _bitset(ids: list[str], indice: dict[str, int], palabras: int) -> np.ndarray:
    """Codifica un conjunto de alimentos como bitset de `palabras` uint64."""
    fila = np.zeros(palabras, dtype=np.uint64)
    for aid in ids:
        bit = indice.get(aid)
        if bit is None:
            continue
        fila[bit >> 6] |= np.uint64(1) << np.uint64(bit & 63)
    return fila


def cargar_catalogo(ruta: str | Path | None = None) -> Catalogo:
    """Lee el catálogo y precalcula todas las estructuras derivadas.

    `version` es el sha256 truncado del fichero. Entra en toda clave de caché:
    sin él, una recarga en caliente produciría planes distintos con el mismo
    seed y el fallo sería indepurable en soporte.
    """
    ruta = Path(ruta) if ruta is not None else RUTA_POR_DEFECTO
    if not ruta.exists():
        raise FileNotFoundError(
            f"No existe el catálogo en {ruta}. "
            "Genéralo con: python scripts/construir_catalogo.py"
        )

    crudo = ruta.read_bytes()
    version = hashlib.sha256(crudo).hexdigest()[:16]

    filas = [json.loads(linea) for linea in crudo.decode("utf-8").splitlines() if linea.strip()]
    if not filas:
        raise ValueError(f"El catálogo {ruta} está vacío")

    n = len(filas)

    # --- Vocabulario de alimentos: bit estable por orden alfabético ---------
    # El orden debe ser determinista entre procesos: si dependiera del orden de
    # aparición, dos procesos con el mismo catálogo asignarían bits distintos y
    # los bitsets cacheados dejarían de ser comparables.
    todos = sorted({a for f in filas for a in f["ingredientes"]})
    alimento_idx = {a: i for i, a in enumerate(todos)}
    palabras = max(1, (len(todos) + 63) // 64)

    ids = np.empty(n, dtype=object)
    titulos = np.empty(n, dtype=object)
    nutr = np.zeros((n, 6), dtype=np.float32)
    conocido = np.zeros((n, 6), dtype=bool)
    escala_min = np.full(n, ESCALA_MIN_POR_DEFECTO, dtype=np.float32)
    escala_max = np.full(n, ESCALA_MAX_POR_DEFECTO, dtype=np.float32)
    m_dieta = np.zeros((n, len(DIETAS)), dtype=bool)
    m_alergeno = np.zeros((n, len(ALERGENOS)), dtype=bool)
    m_slot = np.zeros((n, len(SLOTS)), dtype=bool)
    minutos = np.zeros(n, dtype=np.int16)
    ingr_bits = np.zeros((n, palabras), dtype=np.uint64)
    ingr_perec_bits = np.zeros((n, palabras), dtype=np.uint64)
    n_ingredientes = np.zeros(n, dtype=np.int16)
    coste_cents = np.zeros(n, dtype=np.int32)
    coste_conocido = np.zeros(n, dtype=bool)

    for i, f in enumerate(filas):
        ids[i] = f["id"]
        titulos[i] = f["titulo"]
        nutr[i] = f["nutr"]
        conocido[i] = f.get("conocido", [True] * 6)
        escala_min[i] = f.get("escalaMin", ESCALA_MIN_POR_DEFECTO)
        escala_max[i] = f.get("escalaMax", ESCALA_MAX_POR_DEFECTO)
        minutos[i] = f["minutos"]

        for d in f["dietas"]:
            if d in IDX_DIETA:
                m_dieta[i, IDX_DIETA[d]] = True
        for a in f["alergenos"]:
            if a in IDX_ALERGENO:
                m_alergeno[i, IDX_ALERGENO[a]] = True
        for s in f["slots"]:
            if s in IDX_SLOT:
                m_slot[i, IDX_SLOT[s]] = True

        ingr_bits[i] = _bitset(f["ingredientes"], alimento_idx, palabras)
        ingr_perec_bits[i] = _bitset(
            f.get("ingredientesPerecederos", []), alimento_idx, palabras
        )
        n_ingredientes[i] = len(f["ingredientes"])
        coste_cents[i] = f.get("costeCents", 0)
        coste_conocido[i] = f.get("costeConocido", False)

    idx_por_id = {str(r): i for i, r in enumerate(ids)}
    if len(idx_por_id) != n:
        raise ValueError("El catálogo contiene ids de receta duplicados")

    # --- v_macro (DISENO.md §1.1) ------------------------------------------
    # Se normaliza con la kcal derivada de Atwater, NO con la declarada. Si el
    # panel declara 320 kcal y los macros suman 298, las fracciones calculadas
    # sobre 320 no suman 1 y el coseno de la etapa A queda sesgado. La kcal
    # declarada se sigue usando para todo lo demás.
    prot, carb, grasa = nutr[:, 1], nutr[:, 2], nutr[:, 3]
    kcal_macro = 4.0 * prot + 4.0 * carb + 9.0 * grasa
    tiene_macro = kcal_macro > 0

    v_macro = np.zeros((n, 3), dtype=np.float32)
    seguro = np.where(tiene_macro, kcal_macro, 1.0)
    fracciones = np.stack(
        [4.0 * prot / seguro, 4.0 * carb / seguro, 9.0 * grasa / seguro], axis=1
    )
    normas = np.linalg.norm(fracciones, axis=1)
    normas_seguras = np.where(normas > 0, normas, 1.0)
    v_macro[tiene_macro] = (
        fracciones[tiene_macro] / normas_seguras[tiene_macro, None]
    ).astype(np.float32)

    return Catalogo(
        version=version,
        ids=ids,
        idx_por_id=idx_por_id,
        titulos=titulos,
        nutr=nutr,
        conocido=conocido,
        v_macro=v_macro,
        tiene_macro=tiene_macro,
        escala_min=escala_min,
        escala_max=escala_max,
        m_dieta=m_dieta,
        m_alergeno=m_alergeno,
        m_slot=m_slot,
        minutos=minutos,
        ingr_bits=ingr_bits,
        ingr_perec_bits=ingr_perec_bits,
        n_ingredientes=n_ingredientes,
        alimento_idx=alimento_idx,
        alimento_id=todos,
        coste_cents=coste_cents,
        coste_conocido=coste_conocido,
    )
