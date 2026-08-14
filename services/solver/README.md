# PlanEat Solver

Servicio de generación de planes de comida. Python + FastAPI.

## Requisitos

Python **3.11 o superior**. El Python del sistema en macOS es 3.9 y no sirve:

```bash
brew install python@3.12
```

## Arranque

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

Documentación interactiva del contrato en <http://localhost:8000/docs>.

## Estado

Esqueleto. El contrato HTTP (`POST /v1/plan/generate`) ya es estable y se puede
integrar contra él. El motor devuelve `501` a propósito: un plan falso escondería
el trabajo real pendiente.

La implementación es la fase 1 del roadmap — ver `docs/spec.md` §6 para la
arquitectura en cuatro etapas y el pseudocódigo completo.
