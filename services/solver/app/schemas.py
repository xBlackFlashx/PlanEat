"""Contrato HTTP del servicio solver.

Estos modelos son el espejo de `packages/shared/src/types.ts`. Cualquier cambio
aquí obliga a actualizar el lado TypeScript: no hay generación automática todavía
(está en el roadmap, fase 1).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Sexo = Literal["hombre", "mujer"]
TipoDieta = Literal[
    "omnivora",
    "vegetariana",
    "vegana",
    "pescetariana",
    "baja_en_carbohidratos",
    "mediterranea",
]
SlotComida = Literal["desayuno", "almuerzo", "comida", "merienda", "cena"]
Alergeno = Literal[
    "gluten",
    "crustaceos",
    "huevos",
    "pescado",
    "cacahuetes",
    "soja",
    "lacteos",
    "frutos_de_cascara",
    "apio",
    "mostaza",
    "sesamo",
    "sulfitos",
    "altramuces",
    "moluscos",
]


class Rango(BaseModel):
    min: float
    max: float


class ObjetivoNutricional(BaseModel):
    kcal: float
    toleranciaKcal: float = 0.03
    proteinaG: Rango
    carbohidratoG: Rango
    grasaG: Rango
    fibraMinG: float = 0
    sodioMaxMg: float | None = None


class RestriccionesGeneracion(BaseModel):
    dieta: TipoDieta = "omnivora"
    alergenosExcluidos: list[Alergeno] = Field(default_factory=list)
    ingredientesExcluidos: list[str] = Field(default_factory=list)
    slots: list[SlotComida]
    minutosMaxPorSlot: dict[SlotComida, int] | None = None
    comensales: int = 1
    presupuestoSemanalCents: int | None = None
    despensaAlimentoIds: list[str] = Field(default_factory=list)
    recetasRecientes: list[str] = Field(default_factory=list)


class SolicitudGeneracion(BaseModel):
    objetivos: list[ObjetivoNutricional]
    restricciones: RestriccionesGeneracion
    seed: int | None = None


class PanelNutricional(BaseModel):
    kcal: float
    proteinaG: float
    carbohidratoG: float
    grasaG: float
    fibraG: float | None = None


class ItemPlan(BaseModel):
    recetaId: str
    factorRacion: float
    bloqueado: bool = False


class ComidaPlan(BaseModel):
    slot: SlotComida
    items: list[ItemPlan]
    totales: PanelNutricional


class DiaPlan(BaseModel):
    fecha: str
    comidas: list[ComidaPlan]
    totales: PanelNutricional
    objetivo: ObjetivoNutricional


class FalloGeneracion(BaseModel):
    """Un fallo del solver explica qué restricción ata, nunca un error genérico.

    La UI convierte `sugerencias` en botones de acción concreta.
    """

    restriccionCulpable: str
    mensaje: str
    recetasCandidatas: int
    sugerencias: list[str]


class RespuestaOk(BaseModel):
    ok: Literal[True] = True
    dias: list[DiaPlan]
    msTranscurridos: int


class RespuestaError(BaseModel):
    ok: Literal[False] = False
    fallo: FalloGeneracion
