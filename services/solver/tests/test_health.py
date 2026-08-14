from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_responde_ok():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_generate_declara_no_implementado():
    """El motor debe fallar de forma explícita, no devolver un plan falso."""
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
    assert r.status_code == 501
    assert r.json()["fallo"]["restriccionCulpable"] == "motor_no_implementado"
