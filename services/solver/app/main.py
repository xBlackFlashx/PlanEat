"""Servicio de generación de planes de comida.

Vive aparte de la app web por tres razones (ver docs/spec.md §8.2):

1. El ecosistema numérico de Python (NumPy, HiGHS, OR-Tools) no tiene
   equivalente serio en JavaScript, y el scoring vectorizado de candidatos es
   la operación caliente del producto.
2. El perfil de recursos es distinto: el solver es CPU-bound con picos de
   segundos; el CRUD es I/O-bound. Escalarlos juntos desperdicia dinero.
3. El motor evolucionará mucho más rápido que el modelo de datos. Un contrato
   HTTP versionado permite hacer A/B del algoritmo sin tocar la app.

Estado: esqueleto. La implementación del solver es la fase 1 del roadmap.
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .schemas import RespuestaError, SolicitudGeneracion

app = FastAPI(
    title="PlanEat Solver",
    version="0.1.0",
    description="Generación de planes de comida bajo restricciones nutricionales.",
)


@app.get("/health")
def health() -> dict[str, str]:
    """Sonda de vida para el orquestador."""
    return {"status": "ok", "version": app.version}


@app.post("/v1/plan/generate", tags=["plan"])
def generar_plan(solicitud: SolicitudGeneracion) -> JSONResponse:
    """Genera un plan que satisface los objetivos y restricciones dados.

    Arquitectura prevista, en cuatro etapas (docs/spec.md §6):

      A. Selección estocástica por slot sobre un pool de candidatos puntuado.
      B. Porcionado óptimo por programación lineal (goal programming L1) para
         cuadrar macros ajustando el factor de ración de forma continua.
      C. Reparación: si B no converge, sustituir el candidato que más desvía
         y reintentar.
      D. Ensamblado semanal: penalizar ingredientes no compartidos para acortar
         la lista de la compra.

    Todavía no implementado: devolver un plan falso sería peor que devolver un
    fallo honesto, porque escondería el trabajo real que falta.
    """
    fallo = RespuestaError(
        fallo={
            "restriccionCulpable": "motor_no_implementado",
            "mensaje": (
                "El motor de generación aún no está implementado. "
                "Es la fase 1 del roadmap."
            ),
            "recetasCandidatas": 0,
            "sugerencias": [
                "Consulta docs/spec.md §6 para la arquitectura del solver.",
                "El contrato de esta ruta ya es estable: se puede integrar "
                "contra ella desde ahora.",
            ],
        }
    )
    return JSONResponse(status_code=501, content=fallo.model_dump())


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000)),
        reload=True,
    )
