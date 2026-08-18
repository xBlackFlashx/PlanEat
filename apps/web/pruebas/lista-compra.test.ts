import assert from "node:assert/strict";
import { test } from "node:test";

import type { DiaPlan } from "@planeat/shared";
import type { PorcionesRecetas } from "@planeat/motor";

import { listaDeLaCompra } from "../src/lib/lista-compra.ts";

const PORCIONES: PorcionesRecetas = {
  version: "x",
  recetas: {
    tortilla: {
      racionesBase: 2,
      ingredientes: [
        { alimentoId: "huevo", nombre: "Huevo", categoria: "huevos", gramos: 240 },
        { alimentoId: "aceite_oliva", nombre: "Aceite de oliva", categoria: "despensa", gramos: 20 },
      ],
    },
    revuelto: {
      racionesBase: 1,
      ingredientes: [
        { alimentoId: "huevo", nombre: "Huevo", categoria: "huevos", gramos: 100 },
        { alimentoId: "espinacas", nombre: "Espinacas", categoria: "verduras", gramos: 80 },
      ],
    },
  },
};

function dia(comidas: DiaPlan["comidas"]): DiaPlan {
  return {
    fecha: "2026-08-17",
    comidas,
    totales: { kcal: 0, proteinaG: 0, carbohidratoG: 0, grasaG: 0, fibraG: 0, sodioMg: 0 },
    objetivo: {
      kcal: 2000,
      toleranciaKcal: 0.05,
      proteinaG: { min: 0, max: 999 },
      carbohidratoG: { min: 0, max: 999 },
      grasaG: { min: 0, max: 999 },
      fibraMinG: 0,
    },
  };
}

test("suma gramos del mismo ingrediente entre recetas y días, repartiendo por racionesBase", () => {
  const dias: DiaPlan[] = [
    dia([
      {
        slot: "comida",
        items: [{ recetaId: "tortilla", factorRacion: 1, bloqueado: false }],
        totales: { kcal: 0, proteinaG: 0, carbohidratoG: 0, grasaG: 0, fibraG: 0, sodioMg: 0 },
      },
    ]),
    dia([
      {
        slot: "cena",
        items: [{ recetaId: "revuelto", factorRacion: 1, bloqueado: false }],
        totales: { kcal: 0, proteinaG: 0, carbohidratoG: 0, grasaG: 0, fibraG: 0, sodioMg: 0 },
      },
    ]),
  ];

  const lista = listaDeLaCompra(dias, PORCIONES);
  const huevo = lista.find((i) => i.alimentoId === "huevo");
  // tortilla: 240g / 2 raciones * factor 1 = 120g. revuelto: 100g / 1 * 1 = 100g. Total 220g.
  assert.equal(huevo?.gramos, 220);
  assert.equal(huevo?.enRecetas, 2);
});

test("respeta el factorRacion del item, no sólo racionesBase", () => {
  const dias: DiaPlan[] = [
    dia([
      {
        slot: "comida",
        items: [{ recetaId: "tortilla", factorRacion: 1.5, bloqueado: false }],
        totales: { kcal: 0, proteinaG: 0, carbohidratoG: 0, grasaG: 0, fibraG: 0, sodioMg: 0 },
      },
    ]),
  ];
  const lista = listaDeLaCompra(dias, PORCIONES);
  const aceite = lista.find((i) => i.alimentoId === "aceite_oliva");
  // 20g / 2 raciones * 1.5 = 15g.
  assert.equal(aceite?.gramos, 15);
});

test("una receta sin porciones conocidas se omite en vez de inventar gramos", () => {
  const dias: DiaPlan[] = [
    dia([
      {
        slot: "comida",
        items: [{ recetaId: "receta_desconocida", factorRacion: 1, bloqueado: false }],
        totales: { kcal: 0, proteinaG: 0, carbohidratoG: 0, grasaG: 0, fibraG: 0, sodioMg: 0 },
      },
    ]),
  ];
  assert.deepEqual(listaDeLaCompra(dias, PORCIONES), []);
});

test("ordena por categoria y luego por nombre", () => {
  const dias: DiaPlan[] = [
    dia([
      {
        slot: "cena",
        items: [{ recetaId: "revuelto", factorRacion: 1, bloqueado: false }],
        totales: { kcal: 0, proteinaG: 0, carbohidratoG: 0, grasaG: 0, fibraG: 0, sodioMg: 0 },
      },
    ]),
  ];
  const lista = listaDeLaCompra(dias, PORCIONES);
  assert.deepEqual(
    lista.map((i) => i.categoria),
    [...lista.map((i) => i.categoria)].sort((a, b) => a.localeCompare(b, "es")),
  );
});
