from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_responde_ok():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_generate_devuelve_un_plan_real():
    """Este test comprobaba el 501 de "motor_no_implementado".

    El motor ya está implementado, así que la afirmación se ha invertido: la
    ruta tiene que devolver un plan. La cobertura completa del motor está en
    `tests/test_solver.py`; aquí sólo se guarda que la ruta está viva.
    """
    r = client.post(
        "/v1/plan/generate",
        json={
            "objetivos": [
                {
                    "kcal": 2000,
                    "proteinaG": {"min": 130, "max": 160},
                    "carbohidratoG": {"min": 180, "max": 230},
                    "grasaG": {"min": 55, "max": 75},
                }
            ],
            "restricciones": {"slots": ["desayuno", "comida", "cena"]},
        },
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True
