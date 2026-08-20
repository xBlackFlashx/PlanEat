import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALERGENOS,
  DIETAS,
  FRACCION_MINIMA_FIBRA,
  FRACCION_MINIMA_PRECIOS,
  FRACCION_POOL_ATRIBUIBLE,
  IDX_ALERGENO,
  IDX_CARB,
  IDX_DIETA,
  IDX_FIBRA,
  IDX_GRASA,
  IDX_KCAL,
  IDX_NUTRIENTE,
  IDX_PROT,
  IDX_SLOT,
  IDX_SODIO,
  INF_BANDA,
  KCAL_MINIMAS_ABSOLUTO,
  MAX_USOS_RECETA_SEMANA,
  MIN_CANDIDATOS_SLOT_SEMANA,
  NUTRIENTES,
  N_ALERGENOS,
  N_DIETAS,
  N_NUTR,
  N_SLOTS,
  PESOS_LP,
  PESO_SLOT,
  RUTA_A,
  RUTA_D,
  RUTA_DESEMPATE,
  SLOTS,
  TAU_MAX,
  TAU_MIN,
  VERSION_GENERADOR,
  W_AFIN,
  W_COST,
  W_DESP,
  W_ESC,
  W_FIT,
  W_NUEVO,
  W_REP,
  W_SOL,
  temperatura,
} from "../src/constantes.ts";

/**
 * FNV-1a de 32 bits sobre los code points. Vive aquí y no en `numerico.ts`
 * porque no es un primitivo del motor: es el instrumento de este test y de
 * ningún otro.
 */
function fnv1a(texto: string): string {
  let h = 0x811c9dc5;
  for (const c of texto) {
    h ^= c.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

test("el vocabulario está congelado: las cuatro tuplas y su orden", () => {
  // Este hash NO es una comprobación de estilo. El orden de las cuatro tuplas es
  // el formato binario del catálogo compilado y, en SLOTS, el último componente
  // de la ruta del árbol de RNG. Reordenar una tupla cambia los planes generados
  // con el mismo seed sin romper ninguna otra prueba: este test es lo que hace
  // que eso falle en rojo en vez de en silencio.
  //
  // Si has llegado aquí porque el test está rojo: el orden viejo era
  //   kcal,proteina,carbohidrato,grasa,fibra,sodio
  //   omnivora,vegetariana,vegana,pescetariana,baja_en_carbohidratos,mediterranea
  //   gluten,crustaceos,huevos,pescado,cacahuetes,soja,lacteos,frutos_de_cascara,
  //     apio,mostaza,sesamo,sulfitos,altramuces,moluscos
  //   desayuno,almuerzo,comida,merienda,cena
  // 2026-08-19: se añadieron 253 alérgenos más al final de ALERGENOS —83 con
  // veto real, anclados a un ingrediente del catálogo (paprika, vainilla,
  // sal, miel, mayonesa, vinagre, pesto, mermelada, tofu, tempeh, salsa,
  // pollo, huevo, res... — ver services/solver/data/ingredientes.json para
  // el mapeo completo) más 170 sin ingrediente real todavía (azafrán, mole,
  // café, mango, kiwi, langosta... — sobre todo frutas/verduras/carnes/
  // lácteos exóticos que el catálogo semilla no cubre) que el negocio pidió
  // dejar disponibles igual. El hash cambió por eso, junto con
  // VERSION_GENERADOR en los dos motores.
  //
  // Nota: el primer intento de añadir alérgenos sin ingrediente real (18 de
  // ellos) rompía la carga del catálogo entero, porque entonces `mAlergeno`
  // vivía empaquetado en un solo entero de 32 bits por receta y más de 32
  // categorías desbordan eso (`1 << 32` da basura por wraparound en JS). Se
  // arregló portando `mAlergeno` al mismo esquema multi-palabra que
  // `ingrBits`/`ingrPerecBits` (ver `W_ALERGENO` en
  // packages/motor/src/catalogo.ts) antes de reintentar — con 267 alérgenos
  // eso ya son 9 palabras por fila, no 1.
  // Cambiar el hash es legítimo SÓLO junto con: recompilar el catálogo, subir
  // VERSION_GENERADOR y aceptar que todos los planes guardados dejan de
  // reproducirse.
  const canonico =
    `NUTRIENTES=${NUTRIENTES.join(",")}` +
    `|DIETAS=${DIETAS.join(",")}` +
    `|ALERGENOS=${ALERGENOS.join(",")}` +
    `|SLOTS=${SLOTS.join(",")}`;
  assert.equal(fnv1a(canonico), "af14cae1");
});

test("los tamaños derivados son los del vocabulario, no números escritos a mano", () => {
  assert.equal(N_NUTR, NUTRIENTES.length);
  assert.equal(N_DIETAS, DIETAS.length);
  assert.equal(N_ALERGENOS, ALERGENOS.length);
  assert.equal(N_SLOTS, SLOTS.length);
  // Los anchos de las máscaras del catálogo: 6 dietas, 267 alérgenos (los 14
  // del anexo II del Reglamento UE 1169/2011 + 253 sensibilidades adicionales
  // del negocio, 2026-08-19 — de las cuales 83 vetan de verdad), 5 slots.
  assert.deepEqual([N_NUTR, N_DIETAS, N_ALERGENOS, N_SLOTS], [6, 6, 267, 5]);
});

test("los índices derivados son la posición exacta en su tupla", () => {
  for (const [i, n] of NUTRIENTES.entries()) assert.equal(IDX_NUTRIENTE[n], i);
  for (const [i, d] of DIETAS.entries()) assert.equal(IDX_DIETA[d], i);
  for (const [i, a] of ALERGENOS.entries()) assert.equal(IDX_ALERGENO[a], i);
  for (const [i, s] of SLOTS.entries()) assert.equal(IDX_SLOT[s], i);
});

test("los índices sueltos de nutriente coinciden con el mapa derivado", () => {
  // `vectorMacro` lee residuo[1..3] como (P, C, G) por ser posiciones contiguas:
  // si estos tres dejan de ser 1,2,3 el motor sigue funcionando y devuelve
  // macros equivocadas, que es la peor forma de romperse.
  assert.deepEqual(
    [IDX_KCAL, IDX_PROT, IDX_CARB, IDX_GRASA, IDX_FIBRA, IDX_SODIO],
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(IDX_NUTRIENTE.kcal, IDX_KCAL);
  assert.equal(IDX_NUTRIENTE.proteina, IDX_PROT);
  assert.equal(IDX_NUTRIENTE.carbohidrato, IDX_CARB);
  assert.equal(IDX_NUTRIENTE.grasa, IDX_GRASA);
  assert.equal(IDX_NUTRIENTE.fibra, IDX_FIBRA);
  assert.equal(IDX_NUTRIENTE.sodio, IDX_SODIO);
});

test("PESO_SLOT cubre los cinco slots y conserva sus proporciones (no suma 1)", () => {
  // Los cinco pesos suman 1,05, no 1. No es un error de transcripción: son los
  // valores del Python y `cuotasDe` renormaliza siempre por la suma del
  // subconjunto pedido, así que lo único que codifican son las proporciones
  // relativas. El test lo fija para que nadie los "corrija" a 1,00 creyendo que
  // no cambia nada: cambiaría todos los planes.
  const suma = SLOTS.reduce((acc, s) => acc + PESO_SLOT[s], 0);
  assert.ok(Math.abs(suma - 1.05) < 1e-12, `los pesos de slot suman ${suma}`);
  // La proporción que de verdad importa: la comida pesa 3,5 veces el almuerzo.
  assert.ok(Math.abs(PESO_SLOT.comida / PESO_SLOT.almuerzo - 3.5) < 1e-12);
  // El empate almuerzo/merienda a 0,10 es el que obliga a `ordenDeSlots` a
  // desempatar por IDX_SLOT; si dejan de empatar, ese desempate deja de tener
  // cobertura y nadie se entera.
  assert.equal(PESO_SLOT.almuerzo, PESO_SLOT.merienda);
  assert.ok(PESO_SLOT.comida > PESO_SLOT.cena);
});

test("PESOS_LP tiene una pareja por nutriente y conserva las dos asimetrías", () => {
  assert.equal(PESOS_LP.length, N_NUTR);
  // Asimetrías de producto, no de modelado: quedarse corto de proteína daña el
  // objetivo del usuario y pasarse no; con el sodio es al revés.
  assert.deepEqual(PESOS_LP[IDX_PROT], [1.0, 2.5]);
  assert.deepEqual(PESOS_LP[IDX_SODIO], [0.3, 0.0]);
  assert.deepEqual(PESOS_LP[IDX_KCAL], [3.0, 3.0]);
  assert.deepEqual(PESOS_LP[IDX_FIBRA], [0.0, 0.5]);
});

test("W_AFIN es 0 y el rango real del score es [-6,5 ; 9,9]", () => {
  // DISENO.md §2.2 escribe 0,8·φ_afin y declara [-3,5 ; 9,5]. Manda el código:
  // con W_AFIN=0 el máximo real coincidía con ese 9,5 sólo mientras W_SOL
  // valía 2,0, y era coincidencia numérica, no un indicio de que la fórmula del
  // documento se hubiera portado. El rango se ha movido en cada ronda de esta
  // sesión: 9,5 -> 10,7 (W_SOL a 3,2) -> ahora, con W_SOL bajado a 2,4 y la
  // llegada de W_NUEVO (§2.2h, penaliza el conteo absoluto de ingredientes
  // nuevos), el máximo baja a 9,9 y el mínimo se hunde de −3,5 a −6,5 porque
  // W_NUEVO es el primer término negativo desde W_REP.
  assert.equal(W_AFIN, 0.0);
  const maximo = W_FIT + W_ESC + W_DESP + W_SOL + W_AFIN;
  const minimo = -(W_COST + W_REP + W_NUEVO);
  assert.ok(Math.abs(maximo - 9.9) < 1e-12, `máximo ${maximo}`);
  assert.equal(minimo, -6.5);
});

test("temperatura mapea los extremos del control de variedad a [TAU_MIN, TAU_MAX]", () => {
  assert.ok(Math.abs(temperatura(0) - TAU_MIN) < 1e-12);
  assert.ok(Math.abs(temperatura(100) - TAU_MAX) < 1e-12);
});

test("temperatura es estrictamente creciente y geométrica", () => {
  const valores = [0, 25, 45, 75, 100].map(temperatura);
  for (let i = 1; i < valores.length; i++) {
    const previo = valores[i - 1] ?? Number.NaN;
    const actual = valores[i] ?? Number.NaN;
    assert.ok(actual > previo, `temperatura no crece en el punto ${i}`);
  }
  // Geométrica: subir de 25 a 50 multiplica τ por lo mismo que subir de 50 a 75.
  assert.ok(
    Math.abs(temperatura(50) / temperatura(25) - temperatura(75) / temperatura(50)) < 1e-12,
  );
});

test("temperatura clampa fuera de [0,100] en vez de devolver un softmax uniforme", () => {
  // Divergencia consciente con Python, donde el rango lo garantizaba pydantic.
  // Aquí la función es API pública del paquete.
  assert.equal(temperatura(-40), temperatura(0));
  assert.equal(temperatura(1000), temperatura(100));
});

test("INF_BANDA es finito: las bandas abiertas se detectan comparando, no con Infinity", () => {
  assert.ok(Number.isFinite(INF_BANDA));
  assert.equal(INF_BANDA, 1.0e30);
  // El patrón real del porcionador: `hi < INF_BANDA` distingue banda acotada de
  // banda abierta, y `INF_BANDA - INF_BANDA` tiene que ser 0 y no NaN.
  assert.ok(!(INF_BANDA < INF_BANDA));
  assert.equal(INF_BANDA - INF_BANDA, 0);
});

test("las rutas del árbol de RNG son distintas entre sí", () => {
  // RUTA_DESEMPATE está reservada y sin uso: se porta para que nadie reutilice
  // el 2 en una ruta nueva y colisione con un árbol antiguo.
  assert.equal(new Set([RUTA_A, RUTA_D, RUTA_DESEMPATE]).size, 3);
});

test("VERSION_GENERADOR declara el salto de mayor del port", () => {
  // Cambian el RNG y el porcionador enteros: el mismo seed NO reproduce el plan
  // del backend Python, y la versión es lo único que lo dice.
  assert.equal(VERSION_GENERADOR, "2.5.0-ts");
  const mayor = Number(VERSION_GENERADOR.split(".")[0]);
  assert.ok(mayor > 1, "el port obliga a subir la versión mayor");
});

test("los umbrales del diagnóstico conservan sus relaciones derivadas", () => {
  // MIN_CANDIDATOS_SLOT_SEMANA = ceil(7 / MAX_USOS_RECETA_SEMANA) + 4. La
  // holgura de 4 se recalcula en el código A PARTIR de este mismo número, así
  // que los dos se mueven juntos: si esta igualdad deja de cumplirse, el umbral
  // por slot del horizonte semanal ha cambiado de significado.
  assert.equal(MIN_CANDIDATOS_SLOT_SEMANA, Math.ceil(7 / MAX_USOS_RECETA_SEMANA) + 4);
  // Suelo de seguridad: ninguna sugerencia puede proponer bajar de aquí.
  assert.equal(KCAL_MINIMAS_ABSOLUTO, 1200);
  // Fracciones: todas en [0,1], porque todas se comparan contra un cociente.
  for (const f of [FRACCION_MINIMA_PRECIOS, FRACCION_MINIMA_FIBRA, FRACCION_POOL_ATRIBUIBLE]) {
    assert.ok(f > 0 && f <= 1, `fracción fuera de (0,1]: ${f}`);
  }
});
