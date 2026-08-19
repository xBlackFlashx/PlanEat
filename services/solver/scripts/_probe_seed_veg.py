from app.catalogo import cargar_catalogo
from app.schemas import RestriccionesGeneracion, SolicitudGeneracion
from app.solver.motor import generar

cat = cargar_catalogo()
OBJ = {
    "kcal": 2000, "toleranciaKcal": 0.05,
    "proteinaG": {"min": 120, "max": 160},
    "carbohidratoG": {"min": 180, "max": 250},
    "grasaG": {"min": 55, "max": 80},
    "fibraMinG": 20,
}
SLOTS_3 = ["desayuno", "comida", "cena"]

for seed in range(1, 61):
    restr = RestriccionesGeneracion(dieta="vegetariana", slots=SLOTS_3)
    sol = SolicitudGeneracion(objetivos=[OBJ] * 3, restricciones=restr, seed=seed)
    resp, _ = generar(sol, cat)
    if not resp.ok:
        continue
    d1 = resp.dias[1]
    prot = d1.totales.proteinaG
    kcal_ok = all(abs(d.totales.kcal - 2000) <= 100 for d in resp.dias)
    margen = prot - 120
    if margen >= 3 and kcal_ok:
        print(f"seed={seed}  dia1_proteina={prot:.1f}  margen={margen:.1f}  kcal_ok={kcal_ok}")
