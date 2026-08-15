"""Servicio de generación de planes de comida.

Vive aparte de la app web por tres razones (ver docs/spec.md §8.2):

1. El ecosistema numérico de Python (NumPy, HiGHS, OR-Tools) no tiene
   equivalente serio en JavaScript, y el scoring vectorizado de candidatos es
   la operación caliente del producto.
2. El perfil de recursos es distinto: el solver es CPU-bound con picos de
   segundos; el CRUD es I/O-bound. Escalarlos juntos desperdicia dinero.
3. El motor evolucionará mucho más rápido que el modelo de datos. Un contrato
   HTTP versionado permite hacer A/B del algoritmo sin tocar la app.
"""

from __future__ import annotations

import logging
import os
from dataclasses import asdict

from fastapi import FastAPI, Response
from fastapi.responses import JSONResponse

from .catalogo import cargar_catalogo
from .schemas import RespuestaError, RespuestaOk, SolicitudGeneracion
from .solver import VERSION_GENERADOR
from .solver.motor import ObjetivoInvalido, generar

log = logging.getLogger("planeat.solver")

app = FastAPI(
    title="PlanEat Solver",
    version="0.1.0",
    description="Generación de planes de comida bajo restricciones nutricionales.",
)

# El catálogo se carga UNA vez por proceso y vive en memoria: la generación
# nunca toca disco ni base de datos (spec §6.5). Cargarlo en el import y no en
# un `startup` hace que un catálogo roto reviente el arranque en vez de la
# primera petición, que es cuando peor duele.
CATALOGO = cargar_catalogo()


@app.get("/health")
def health() -> dict[str, str]:
    """Sonda de vida para el orquestador."""
    return {
        "status": "ok",
        "version": app.version,
        "catalogo": CATALOGO.version,
        "recetas": str(CATALOGO.n),
        "generador": VERSION_GENERADOR,
    }


@app.post("/v1/plan/generate", tags=["plan"])
def generar_plan(solicitud: SolicitudGeneracion, respuesta: Response) -> JSONResponse:
    """Genera un plan que satisface los objetivos y restricciones dados.

    Cuatro etapas (docs/spec.md §6, detalladas en services/solver/DISENO.md):

      A. Selección estocástica por slot sobre un pool de candidatos puntuado.
      B. Porcionado óptimo por programación lineal con banda muerta.
      C. Reparación dirigida del slot culpable, máximo 3 intentos.
      D. Ensamblado semanal por recocido para acortar la lista de la compra.

    Códigos de estado, y por qué:

    - **200** tanto para `ok: true` como para `ok: false`. Un fallo diagnosticado
      NO es un error de la petición: el usuario pidió algo legítimo y el sistema
      responde qué restricción ata y qué tres cosas puede hacer. Devolverlo como
      4xx/5xx obligaría a la web a tratar como excepción lo que es una respuesta
      de producto de primera clase, y se acabaría enseñando un "algo ha ido mal".
    - **422** sólo cuando la petición está mal formada (un rango invertido, kcal
      ≤ 0). Eso sí es culpa del cliente y hay que distinguirlo.

    Reproducibilidad: `seed`, `versionCatalogo`, `versionGenerador`, `pool` y
    `catalogoEstrecho` viajan DENTRO de `RespuestaOk`. Estaban en las cabeceras
    `X-PlanEat-*` porque la respuesta no tenía dónde llevarlos; ahora sí, y hacía
    falta que lo tuviera: el motor del navegador (`packages/motor`) genera sin
    servidor y no puede poner una cabecera en ninguna parte. Sin esos datos, un
    plan guardado o compartido no se puede volver a construir.

    Las cabeceras se mantienen como espejo de sólo lectura, no como fuente: hay
    clientes que las leen y quitarlas no aporta nada. La fuente es el payload.
    """
    try:
        resultado, traza = generar(solicitud, CATALOGO)
    except ObjetivoInvalido as e:
        return JSONResponse(
            status_code=422,
            content=RespuestaError(
                fallo={
                    "restriccionCulpable": "objetivo_mal_formado",
                    "mensaje": str(e),
                    "recetasCandidatas": 0,
                    "sugerencias": [
                        "Revisa que el mínimo de cada macro no supere su máximo",
                        "Comprueba que las kcal objetivo sean mayores que cero",
                        "Vuelve a calcular los objetivos desde tu perfil",
                    ],
                }
            ).model_dump(),
        )

    log.info("generacion %s", asdict(traza))
    # Espejo de lo que ya va en el payload; ver el docstring.
    cabeceras = {
        "X-PlanEat-Seed": str(traza.seed),
        "X-PlanEat-Catalogo": CATALOGO.version,
        "X-PlanEat-Generador": VERSION_GENERADOR,
    }
    if isinstance(resultado, RespuestaOk):
        cabeceras["X-PlanEat-Pool"] = str(traza.pool)
    return JSONResponse(
        status_code=200, content=resultado.model_dump(), headers=cabeceras
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000)),
        reload=True,
    )
