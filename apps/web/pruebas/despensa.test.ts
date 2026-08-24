import assert from "node:assert/strict";
import { test } from "node:test";

import type { RecetaVista, VistaRecetas } from "@planeat/motor";

import { recetasQuePuedoHacer } from "../src/lib/despensa.ts";

function receta(id: string, alimentoIds: string[]): RecetaVista {
  return {
    id,
    titulo: id,
    racionesBase: 1,
    minutos: 10,
    slots: ["comida"],
    alergenos: [],
    ingredientes: alimentoIds.map((alimentoId) => ({
      alimentoId,
      nombre: alimentoId,
      cantidad: "",
    })),
    pasos: [],
    porRacion: { kcal: 0, proteinaG: 0, carbohidratoG: 0, grasaG: 0, fibraG: 0, sodioMg: 0 },
    conocido: { kcal: true, proteinaG: true, carbohidratoG: true, grasaG: true, fibraG: true, sodioMg: true },
    costeCents: null,
    revisadaPor: null,
    imagenUrl: null,
  };
}

const VISTA: VistaRecetas = {
  version: "x",
  total: 3,
  alimentos: [],
  recetas: {
    completa: receta("completa", ["huevo", "pan_integral"]),
    parcial: receta("parcial", ["huevo", "pan_integral", "aguacate"]),
    sin_nada: receta("sin_nada", ["salmon", "esparragos"]),
  },
};

test("una receta cubierta al 100% queda primero, sin faltantes", () => {
  const [primera] = recetasQuePuedoHacer(["huevo", "pan_integral"], VISTA);
  assert.equal(primera?.receta.id, "completa");
  assert.equal(primera?.cobertura, 1);
  assert.deepEqual(primera?.faltantes, []);
});

test("una receta parcial reporta exactamente lo que falta", () => {
  const resultado = recetasQuePuedoHacer(["huevo", "pan_integral"], VISTA);
  const parcial = resultado.find((r) => r.receta.id === "parcial");
  assert.equal(parcial?.cobertura, 2 / 3);
  assert.deepEqual(
    parcial?.faltantes.map((i) => i.alimentoId),
    ["aguacate"],
  );
});

test("sin ningún ingrediente en común, la cobertura es 0 y todo falta", () => {
  const resultado = recetasQuePuedoHacer(["huevo", "pan_integral"], VISTA);
  const sinNada = resultado.find((r) => r.receta.id === "sin_nada");
  assert.equal(sinNada?.cobertura, 0);
  assert.deepEqual(
    sinNada?.faltantes.map((i) => i.alimentoId),
    ["salmon", "esparragos"],
  );
});

test("el orden es por cobertura descendente y, en empate, por menos faltantes", () => {
  const ids = recetasQuePuedoHacer(["huevo", "pan_integral"], VISTA).map((r) => r.receta.id);
  assert.deepEqual(ids, ["completa", "parcial", "sin_nada"]);
});

test("un ingrediente que ninguna receta usa no rompe nada", () => {
  const resultado = recetasQuePuedoHacer(["ingrediente_inventado"], VISTA);
  assert.equal(resultado.length, 3);
  assert.ok(resultado.every((r) => r.cobertura === 0));
});
