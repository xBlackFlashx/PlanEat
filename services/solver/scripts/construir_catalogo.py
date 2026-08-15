#!/usr/bin/env python3
"""Construye `data/catalogo.jsonl` a partir de los ficheros fuente.

Separación deliberada de responsabilidades:

  ingredientes.json  Hechos nutricionales. Se editan a mano, con fuente citada.
  recetas.json       Lo que decide un humano: qué lleva, cómo se hace, cuándo.
  catalogo.jsonl     GENERADO. Es lo único que lee el solver.

Todo lo derivable se deriva aquí y nunca se escribe a mano:

  · La nutrición se calcula desde los ingredientes. Escribirla a mano en la
    receta permite que se desincronice en silencio al cambiar una cantidad.
  · Los alérgenos son la unión de los de sus ingredientes. Un olvido humano
    aquí no es un bug de datos, es un riesgo de daño real (spec §11.3).
  · Las dietas se derivan del origen de los ingredientes. Que alguien marque
    "vegana" a mano una receta con miel es cuestión de tiempo.

Uso:
    python scripts/construir_catalogo.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DIR_DATOS = RAIZ / "data"

# --------------------------------------------------------------------------
# Origen de los ingredientes. Explícito y auditable: no se puede inferir del
# panel nutricional ni de los alérgenos (el pollo no tiene alérgeno declarable).
# --------------------------------------------------------------------------

CARNE = {"pechuga_pollo", "muslo_pollo", "ternera_magra", "lomo_cerdo"}
PESCADO_Y_MARISCO = {"salmon", "merluza", "bacalao", "atun_natural", "gambas"}
LACTEO = {
    "leche_semi", "yogur_natural", "yogur_griego", "queso_batido_0",
    "requeson", "queso_curado", "mozzarella",
}
HUEVO = {"huevo", "clara_huevo"}
OTRO_ANIMAL = {"miel"}  # no es vegano, sí vegetariano

# Umbral de carbohidratos por ración para clasificar una receta como baja en
# carbohidratos. Convención de producto, no un valor clínico.
UMBRAL_BAJO_CARBOHIDRATO_G = 25.0

ESCALA_MIN_DEFECTO = 0.6
ESCALA_MAX_DEFECTO = 1.8


def cargar(nombre: str) -> dict:
    ruta = DIR_DATOS / nombre
    if not ruta.exists():
        sys.exit(f"ERROR: falta {ruta}")
    with ruta.open(encoding="utf-8") as fh:
        return json.load(fh)


def derivar_dietas(ids_ingredientes: set[str], carbohidrato_g: float,
                   mediterranea: bool) -> list[str]:
    """Deriva las dietas compatibles. Nunca se declaran a mano."""
    tiene_carne = bool(ids_ingredientes & CARNE)
    tiene_pescado = bool(ids_ingredientes & PESCADO_Y_MARISCO)
    tiene_lacteo = bool(ids_ingredientes & LACTEO)
    tiene_huevo = bool(ids_ingredientes & HUEVO)
    tiene_otro_animal = bool(ids_ingredientes & OTRO_ANIMAL)

    dietas = ["omnivora"]
    if not tiene_carne:
        dietas.append("pescetariana")
        if not tiene_pescado:
            dietas.append("vegetariana")
            if not (tiene_lacteo or tiene_huevo or tiene_otro_animal):
                dietas.append("vegana")
    if carbohidrato_g < UMBRAL_BAJO_CARBOHIDRATO_G:
        dietas.append("baja_en_carbohidratos")
    if mediterranea:
        dietas.append("mediterranea")
    return dietas


def main() -> int:
    datos_ing = cargar("ingredientes.json")
    datos_rec = cargar("recetas.json")

    ingredientes = {i["id"]: i for i in datos_ing["ingredientes"]}
    if len(ingredientes) != len(datos_ing["ingredientes"]):
        sys.exit("ERROR: hay ids de ingrediente duplicados")

    errores: list[str] = []
    lineas: list[str] = []
    vistos: set[str] = set()

    for receta in datos_rec["recetas"]:
        rid = receta["id"]
        if rid in vistos:
            errores.append(f"{rid}: id de receta duplicado")
            continue
        vistos.add(rid)

        raciones = receta["racionesBase"]
        if raciones < 1:
            errores.append(f"{rid}: racionesBase debe ser >= 1")
            continue

        # --- Nutrición: se acumula por 100 g y se divide entre las raciones ---
        total = dict.fromkeys(
            ("kcal", "proteina", "carbohidrato", "grasa", "fibra", "sodio"), 0.0
        )
        alergenos: set[str] = set()
        ids_ing: set[str] = set()
        perecederos: set[str] = set()
        coste_cents = 0.0
        coste_completo = True

        for item in receta["ingredientes"]:
            aid = item["alimentoId"]
            ing = ingredientes.get(aid)
            if ing is None:
                errores.append(f"{rid}: ingrediente inexistente '{aid}'")
                coste_completo = False
                continue

            g = item["gramos"]
            f = g / 100.0
            p = ing["panel"]
            total["kcal"] += p["kcal"] * f
            total["proteina"] += p["proteinaG"] * f
            total["carbohidrato"] += p["carbohidratoG"] * f
            total["grasa"] += p["grasaG"] * f
            total["fibra"] += p.get("fibraG", 0.0) * f
            total["sodio"] += p.get("sodioMg", 0.0) * f

            alergenos.update(ing.get("alergenos", []))
            ids_ing.add(aid)
            if ing.get("perecedero"):
                perecederos.add(aid)

            formatos = ing.get("formatosCompra") or []
            if formatos and formatos[0].get("precioEstimadoCents") is not None:
                fmt = formatos[0]
                coste_cents += fmt["precioEstimadoCents"] * (g / fmt["gramos"])
            else:
                coste_completo = False

        por_racion = {k: v / raciones for k, v in total.items()}

        # Comprobación de coherencia de Atwater. No corrige nada: avisa. Una
        # desviación grande casi siempre significa un gramaje mal tecleado.
        kcal_atwater = (
            4 * por_racion["proteina"]
            + 4 * por_racion["carbohidrato"]
            + 9 * por_racion["grasa"]
        )
        if por_racion["kcal"] > 0:
            desvio = abs(kcal_atwater - por_racion["kcal"]) / por_racion["kcal"]
            if desvio > 0.15:
                errores.append(
                    f"{rid}: kcal declarada {por_racion['kcal']:.0f} vs Atwater "
                    f"{kcal_atwater:.0f} ({desvio:.0%} de desvío) — revisa gramajes"
                )

        dietas = derivar_dietas(ids_ing, por_racion["carbohidrato"],
                                receta.get("mediterranea", False))

        lineas.append(json.dumps({
            "id": rid,
            "titulo": receta["titulo"],
            "racionesBase": raciones,
            "nutr": [
                round(por_racion["kcal"], 2),
                round(por_racion["proteina"], 2),
                round(por_racion["carbohidrato"], 2),
                round(por_racion["grasa"], 2),
                round(por_racion["fibra"], 2),
                round(por_racion["sodio"], 1),
            ],
            # Todo el catálogo semilla tiene los seis nutrientes calculados
            # desde los ingredientes. Se emite explícito para que el día que
            # entre una fuente parcial el solver ya sepa distinguirlo.
            "conocido": [True] * 6,
            "minutos": receta["minutosPreparacion"] + receta["minutosCoccion"],
            "dietas": sorted(dietas),
            "alergenos": sorted(alergenos),
            "slots": receta["slotsAdmitidos"],
            "ingredientes": sorted(ids_ing),
            "ingredientesPerecederos": sorted(perecederos),
            "costeCents": round(coste_cents / raciones) if coste_completo else 0,
            "costeConocido": coste_completo,
            "escalaMin": receta.get("escalaMin", ESCALA_MIN_DEFECTO),
            "escalaMax": receta.get("escalaMax", ESCALA_MAX_DEFECTO),
            "revisadaPor": None,
        }, ensure_ascii=False))

    if errores:
        print("Se han encontrado errores en los datos fuente:\n", file=sys.stderr)
        for e in errores:
            print(f"  · {e}", file=sys.stderr)
        return 1

    salida = DIR_DATOS / "catalogo.jsonl"
    salida.write_text("\n".join(lineas) + "\n", encoding="utf-8")

    print(f"OK  {len(lineas)} recetas · {len(ingredientes)} ingredientes")
    print(f"    -> {salida.relative_to(RAIZ)}")

    # Resumen de cobertura: es lo que determina si el solver podrá trabajar.
    from collections import Counter
    slots: Counter[str] = Counter()
    dietas_c: Counter[str] = Counter()
    proteicas = 0
    for linea in lineas:
        r = json.loads(linea)
        slots.update(r["slots"])
        dietas_c.update(r["dietas"])
        kcal, prot, _, grasa = r["nutr"][0], r["nutr"][1], r["nutr"][2], r["nutr"][3]
        if kcal > 0 and (prot * 4) / kcal > 0.30 and (grasa * 9) / kcal < 0.30:
            proteicas += 1

    print("\n  Cobertura por slot:")
    for s, n in sorted(slots.items()):
        print(f"    {s:10} {n:3}")
    print("  Cobertura por dieta:")
    for d, n in sorted(dietas_c.items()):
        print(f"    {d:24} {n:3}")
    print(f"  Recetas de proteína alta y grasa baja: {proteicas}")
    if proteicas < 6:
        print("  AVISO: menos de 6. El LP fallará con objetivos proteicos altos.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
