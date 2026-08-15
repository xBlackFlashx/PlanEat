/**
 * Etapa C — reparación dirigida.
 *
 * Un test por invariante. Los invariantes que se fijan aquí no son los números
 * concretos del plan (ésos dependen del RNG, que por decisión de
 * docs/port-typescript.md NO es el de numpy y no tiene paridad con Python), sino
 * las tres propiedades de las que depende que el motor sea usable:
 *
 *  1. la reparación nunca devuelve algo peor que lo que ya tenía;
 *  2. el trabajo está acotado (tres intentos, no más);
 *  3. el estado mutable del contexto entre días hace su trabajo — dos días
 *     seguidos no repiten receta en el mismo slot.
 *
 * Todo lo que se compara contra Python en este módulo son fórmulas puras
 * (`vectorObjetivo`, `nutrientesActivos`), y ésas sí se comprueban con números
 * escritos a mano.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { cargarCatalogo } from "../src/catalogo.ts";
import {
  FACTOR_TEMPERATURA_REINTENTO,
  IDX_FIBRA,
  IDX_KCAL,
  IDX_SLOT,
  IDX_SODIO,
  MAX_INTENTOS_REPARACION,
  N_NUTR,
  RUTA_A,
  UMBRAL_ERROR_OK,
} from "../src/constantes.ts";
import { construirPool, invalidarCachePool } from "../src/pool.ts";
import { resolverPorciones } from "../src/porciones.ts";
import {
  generarCandidatoDia,
  mejorAlternativa,
  nutrientesActivos,
  recomponerDia,
  vectorObjetivo,
} from "../src/reparacion.ts";
import { contadorDeSorteos, rngDe } from "../src/rng.ts";
import type { Rng } from "../src/rng.ts";
import { contextoDe, ordenDeSlots, scoreSlot, seleccionarDia } from "../src/scoring.ts";
import type {
  Contexto,
  ObjetivoNutricional,
  Pool,
  ResolverPorciones,
  ResultadoPorcionado,
  RestriccionesGeneracion,
  SlotComida,
} from "../src/tipos.ts";
import type { CatalogoSerializado } from "../herramientas/compilar-catalogo.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const CAT = cargarCatalogo(
  JSON.parse(
    readFileSync(resolve(AQUI, "../datos/catalogo-compilado.json"), "utf8"),
  ) as CatalogoSerializado,
);

const SLOTS_BASE: SlotComida[] = ["desayuno", "comida", "cena"];

function restrDe(extra: Partial<RestriccionesGeneracion> = {}): RestriccionesGeneracion {
  return {
    dieta: "omnivora",
    alergenosExcluidos: [],
    ingredientesExcluidos: [],
    slots: SLOTS_BASE,
    comensales: 1,
    ...extra,
  };
}

/** Escenario completo: pool y contexto sobre el catálogo compilado real. */
function escenario(extra: Partial<RestriccionesGeneracion> = {}): {
  restr: RestriccionesGeneracion;
  pool: Pool;
  ctx: Contexto;
} {
  invalidarCachePool();
  const restr = restrDe(extra);
  const pool = construirPool(CAT, restr);
  const ctx = contextoDe(CAT, pool, restr, 7, 0.37);
  return { restr, pool, ctx };
}

/**
 * Objetivo cómodo: el porcionado cuadra a la primera y no se entra al bucle.
 * Sirve para afirmar el atajo de UMBRAL_ERROR_OK.
 */
const OBJETIVO_FACIL: ObjetivoNutricional = {
  kcal: 2200,
  toleranciaKcal: 0.05,
  proteinaG: { min: 100, max: 160 },
  carbohidratoG: { min: 200, max: 300 },
  grasaG: { min: 55, max: 90 },
  fibraMinG: 25,
  sodioMaxMg: 2300,
};

/**
 * Objetivo imposible con este catálogo: 160 g de proteína en 1400 kcal con 30 g
 * de carbohidrato. Fuerza los tres intentos de reparación en todos los días, que
 * es lo que hace falta para poder afirmar que el bucle está acotado y que nunca
 * empeora. No es un objetivo absurdo por absurdo: es el perfil que pide un
 * usuario en déficit agresivo, y el motor tiene que rendirse con elegancia.
 */
const OBJETIVO_IMPOSIBLE: ObjetivoNutricional = {
  kcal: 1400,
  toleranciaKcal: 0.01,
  proteinaG: { min: 160, max: 170 },
  carbohidratoG: { min: 20, max: 30 },
  grasaG: { min: 20, max: 25 },
  fibraMinG: 60,
};

/** Envuelve el porcionador y anota cada error que devuelve, en orden. */
function resolverEspia(errores: number[]): ResolverPorciones {
  return (a, r, lo, hi, sigmaRef, bandas): ResultadoPorcionado => {
    const res = resolverPorciones(a, r, lo, hi, sigmaRef, bandas);
    errores.push(res.error);
    return res;
  };
}

// ---------------------------------------------------------------------------
// vectorObjetivo
// ---------------------------------------------------------------------------

test("vectorObjetivo apunta al CENTRO de cada banda, no a un extremo", () => {
  const v = vectorObjetivo(OBJETIVO_FACIL);
  assert.equal(v.length, N_NUTR);
  assert.equal(v[IDX_KCAL], 2200);
  assert.equal(v[1], 130); // (100 + 160) / 2
  assert.equal(v[2], 250); // (200 + 300) / 2
  assert.equal(v[3], 72.5); // (55 + 90) / 2
  // Fibra y sodio son cotas de un solo lado y viajan tal cual: la etapa A sólo
  // necesita la dirección y el cuadre contra los extremos lo hace el LP.
  assert.equal(v[IDX_FIBRA], 25);
  assert.equal(v[IDX_SODIO], 2300);
});

test("vectorObjetivo colapsa la ausencia de fibra y de sodio en cero", () => {
  const v = vectorObjetivo({ ...OBJETIVO_FACIL, fibraMinG: 0 });
  assert.equal(v[IDX_FIBRA], 0);
  // `sodioMaxMg` opcional y ausente: es el `is None` de Python, no un 0 real.
  const sinSodio: ObjetivoNutricional = { ...OBJETIVO_FACIL };
  delete sinSodio.sodioMaxMg;
  assert.equal(vectorObjetivo(sinSodio)[IDX_SODIO], 0);
});

// ---------------------------------------------------------------------------
// nutrientesActivos
//
// Con un pool sintético y no con el catálogo real: las 36 recetas compiladas
// tienen fibra y sodio conocidos en el 100 % de las filas, así que sobre ellas
// las dos ramas de desactivación son inalcanzables. Lo que se está fijando aquí
// es precisamente el comportamiento ante los huecos de un catálogo peor
// documentado, que es el caso que §8.5 existe para cubrir.
// ---------------------------------------------------------------------------

/**
 * Pool mínimo: sólo los campos que `nutrientesActivos` lee (`nutr`, `conocido`)
 * más el relleno estructural. `kcals` y `conocido` van fila a fila.
 */
function poolSintetico(
  kcals: readonly number[],
  fibraConocida: readonly boolean[],
  sodioConocido: readonly boolean[],
): Pool {
  const p = kcals.length;
  const nutr = new Float32Array(p * N_NUTR);
  const conocido = new Uint8Array(p * N_NUTR).fill(1);
  for (let i = 0; i < p; i++) {
    nutr[i * N_NUTR + IDX_KCAL] = kcals[i] ?? 0;
    conocido[i * N_NUTR + IDX_FIBRA] = fibraConocida[i] ? 1 : 0;
    conocido[i * N_NUTR + IDX_SODIO] = sodioConocido[i] ? 1 : 0;
  }
  return {
    p,
    w32: 1,
    idx: new Int32Array(p),
    mapaFila: new Int32Array(0),
    ids: Array.from({ length: p }, (_, i) => `r${i}`),
    nutr,
    conocido,
    vMacro: new Float32Array(p * 3),
    tieneMacro: new Uint8Array(p),
    escalaMin: new Float32Array(p).fill(0.6),
    escalaMax: new Float32Array(p).fill(1.8),
    mSlot: new Uint8Array(p).fill(0b11111),
    minutos: new Int16Array(p),
    bits: new Uint32Array(p),
    nIngr: new Int16Array(p).fill(1),
    costeCents: new Int32Array(p),
    costeConocido: new Uint8Array(p),
  };
}

test("nutrientesActivos pondera la fibra por kcal y no por número de recetas", () => {
  // Una sola receta sin dato, pero es el 30 % de las kcal del día: por debajo
  // del 80 % exigido, así que la fibra sale del modelo.
  const pool = poolSintetico([700, 300], [true, false], [true, true]);
  const flojo = nutrientesActivos(pool, [0, 1], OBJETIVO_FACIL);
  assert.equal(flojo.activos[IDX_FIBRA], 0);
  assert.equal(flojo.fibraFiable, false);

  // La misma receta sin dato, ahora testimonial (10 %): el día sigue siendo
  // fiable. Es la razón de ponderar por kcal: una infusión no invalida un día.
  const fuerte = poolSintetico([900, 100], [true, false], [true, true]);
  const ok = nutrientesActivos(fuerte, [0, 1], OBJETIVO_FACIL);
  assert.equal(ok.activos[IDX_FIBRA], 1);
  assert.equal(ok.fibraFiable, true);
});

test("nutrientesActivos trata el sodio como todo-o-nada", () => {
  // El sodio es un MÁXIMO: basta un item sin dato para que el total pueda estar
  // por encima sin que se note, así que no se pondera, se exige entero.
  const pool = poolSintetico([990, 10], [true, true], [true, false]);
  assert.equal(nutrientesActivos(pool, [0, 1], OBJETIVO_FACIL).activos[IDX_SODIO], 0);

  const completo = poolSintetico([990, 10], [true, true], [true, true]);
  assert.equal(nutrientesActivos(completo, [0, 1], OBJETIVO_FACIL).activos[IDX_SODIO], 1);

  // Sin objetivo de sodio tampoco hay restricción que imponer.
  const sinSodio: ObjetivoNutricional = { ...OBJETIVO_FACIL };
  delete sinSodio.sodioMaxMg;
  assert.equal(nutrientesActivos(completo, [0, 1], sinSodio).activos[IDX_SODIO], 0);
});

test("nutrientesActivos con un día de 0 kcal desactiva la fibra: sin kcal no hay evidencia", () => {
  const pool = poolSintetico([0, 0], [true, true], [true, true]);
  const r = nutrientesActivos(pool, [0, 1], OBJETIVO_FACIL);
  assert.equal(r.fibraFiable, false);
  assert.equal(r.activos[IDX_FIBRA], 0);
});

test("nutrientesActivos sin filas no desactiva nada", () => {
  const pool = poolSintetico([100], [false], [false]);
  const r = nutrientesActivos(pool, [], OBJETIVO_FACIL);
  assert.deepEqual([...r.activos], [1, 1, 1, 1, 1, 1]);
  assert.equal(r.fibraFiable, true);
});

// ---------------------------------------------------------------------------
// generarCandidatoDia — el atajo y la forma del candidato
// ---------------------------------------------------------------------------

test("un candidato que ya cumple el umbral no entra al bucle de reparación", () => {
  const { restr, pool, ctx } = escenario();
  const errores: number[] = [];
  const c = generarCandidatoDia(
    pool,
    ctx,
    OBJETIVO_FACIL,
    restr.slots,
    42n,
    0,
    0,
    resolverEspia(errores),
  );
  assert.ok(c !== null);
  assert.ok(c.error <= UMBRAL_ERROR_OK, `error ${c.error} por encima del umbral`);
  assert.equal(c.intentos, 0);
  assert.equal(errores.length, 1, "se porcionó más de una vez pese a cumplir a la primera");
});

test("slots y filas del candidato van en orden de selección y están alineados", () => {
  const { pool, ctx } = escenario();
  const c = generarCandidatoDia(
    pool,
    ctx,
    OBJETIVO_FACIL,
    // El orden en que la petición liste los slots NO debe afectar al plan: el
    // orden lo deriva `ordenDeSlots` por cuota descendente.
    ["cena", "desayuno", "comida"],
    42n,
    0,
    0,
    resolverPorciones,
  );
  assert.ok(c !== null);
  assert.deepEqual(c.slots, ordenDeSlots(SLOTS_BASE));
  assert.equal(c.filas.length, c.slots.length);
  assert.equal(c.sigma.length, c.filas.length);
  assert.equal(c.totales.length, N_NUTR);
  for (let i = 0; i < c.filas.length; i++) {
    const slot = c.slots[i] ?? "comida";
    const fila = c.filas[i] ?? -1;
    assert.ok(
      ((pool.mSlot[fila] ?? 0) & (1 << IDX_SLOT[slot])) !== 0,
      `la fila ${fila} no admite el slot ${slot}`,
    );
  }
  assert.equal(new Set(c.filas).size, c.filas.length, "receta repetida dentro del día");
});

test("la clave ordena las filas: dos días con las mismas recetas son el mismo día", () => {
  const { restr, pool, ctx } = escenario();
  const c = generarCandidatoDia(
    pool,
    ctx,
    OBJETIVO_FACIL,
    restr.slots,
    42n,
    0,
    0,
    resolverPorciones,
  );
  assert.ok(c !== null);
  assert.equal(c.clave, [...c.filas].sort((a, b) => a - b).join(","));
  // Y el orden numérico es explícito, no el alfabético del `sort` por defecto.
  assert.equal([9, 10].sort((a, b) => a - b).join(","), "9,10");
});

test("bits del candidato es la unión de los bitsets de sus recetas", () => {
  const { restr, pool, ctx } = escenario();
  const c = generarCandidatoDia(
    pool,
    ctx,
    OBJETIVO_FACIL,
    restr.slots,
    7n,
    0,
    0,
    resolverPorciones,
  );
  assert.ok(c !== null);
  const esperado = new Uint32Array(pool.w32);
  for (const fila of c.filas) {
    for (let k = 0; k < pool.w32; k++) {
      esperado[k] = ((esperado[k] ?? 0) | (pool.bits[fila * pool.w32 + k] ?? 0)) >>> 0;
    }
  }
  assert.deepEqual([...c.bits], [...esperado]);
});

// ---------------------------------------------------------------------------
// El bucle de reparación
// ---------------------------------------------------------------------------

test("la reparación baja el error o se rinde, pero nunca devuelve uno peor", () => {
  const { restr, pool, ctx } = escenario();
  // Se recorren varios días para no fiarlo todo a un sorteo concreto: lo que se
  // afirma vale para cualquier trayectoria del bucle, incluidas las que sólo
  // encuentran candidatos peores.
  let huboReparacion = false;
  for (let dia = 0; dia < 7; dia++) {
    const errores: number[] = [];
    const c = generarCandidatoDia(
      pool,
      ctx,
      OBJETIVO_IMPOSIBLE,
      restr.slots,
      99n,
      dia,
      0,
      resolverEspia(errores),
    );
    assert.ok(c !== null);
    if (errores.length > 1) huboReparacion = true;
    const inicial = errores[0] ?? Infinity;
    assert.ok(
      c.error <= inicial,
      `día ${dia}: la reparación empeoró el candidato (${inicial} → ${c.error})`,
    );
    assert.equal(
      c.error,
      Math.min(...errores),
      `día ${dia}: no se devolvió el mejor de los ${errores.length} porcionados`,
    );
    // `intentos` es el k EN QUE se encontró el mejor, no cuántos se hicieron.
    assert.equal(c.error, errores[c.intentos]);
  }
  assert.ok(huboReparacion, "el objetivo elegido no llegó a disparar el bucle");
});

test("el bucle respeta MAX_INTENTOS_REPARACION: como mucho tres sustituciones", () => {
  const { restr, pool, ctx } = escenario();
  for (let dia = 0; dia < 7; dia++) {
    const errores: number[] = [];
    const c = generarCandidatoDia(
      pool,
      ctx,
      OBJETIVO_IMPOSIBLE,
      restr.slots,
      99n,
      dia,
      0,
      resolverEspia(errores),
    );
    assert.ok(c !== null);
    // Un porcionado inicial más, como mucho, uno por intento.
    assert.ok(
      errores.length <= MAX_INTENTOS_REPARACION + 1,
      `día ${dia}: ${errores.length} porcionados para ${MAX_INTENTOS_REPARACION} intentos`,
    );
    assert.ok(c.intentos <= MAX_INTENTOS_REPARACION);
    assert.ok(c.intentos >= 0);
  }
});

test("los nodos del árbol de la etapa C no colisionan entre intentos ni con la selección", () => {
  // El invariante de DISENO §2.6 que sostiene el «mismo seed → mismo plan»: cada
  // intento tiene su propio nodo, así que consumir un sorteo de más o de menos
  // en uno no desplaza a los demás. Si dos intentos compartieran flujo, subir la
  // temperatura no exploraría nada: el sorteo sería el mismo.
  const rutas: Rng[] = [];
  for (let k = 0; k <= MAX_INTENTOS_REPARACION; k++) {
    rutas.push(rngDe(99n, RUTA_A, 0, 0, k, IDX_SLOT.comida));
  }
  // Recién creados no han gastado nada: `muestrear` consume exactamente uno, y
  // cero cuando queda un único candidato (el atajo de §2.6).
  for (const r of rutas) assert.equal(contadorDeSorteos(r), 0);
  const valores = rutas.map((r) => r.random());
  assert.equal(new Set(valores).size, rutas.length, "dos nodos comparten flujo");
  // El slot también separa: el intento k del desayuno no es el del almuerzo.
  assert.notEqual(rngDe(99n, RUTA_A, 0, 0, 1, IDX_SLOT.cena).random(), valores[1]);
});

test("la etapa C no muta ctx.tau al subir la temperatura de los reintentos", () => {
  // `tau_k = ctx.tau * (1 + 0,25k)` es un valor LOCAL del intento. Escribirlo de
  // vuelta en el contexto —el `ctx.tau *= …` que sale solo— haría que la
  // temperatura creciera acumulativamente entre días y entre candidatos, y el
  // plan se volvería más aleatorio según avanza la semana sin que nada fallara.
  const { restr, pool, ctx } = escenario();
  const tauAntes = ctx.tau;
  for (let dia = 0; dia < 5; dia++) {
    generarCandidatoDia(
      pool,
      ctx,
      OBJETIVO_IMPOSIBLE,
      restr.slots,
      99n,
      dia,
      0,
      resolverPorciones,
    );
  }
  assert.equal(ctx.tau, tauAntes);
  assert.equal(tauAntes * (1 + FACTOR_TEMPERATURA_REINTENTO * 1), 0.37 * 1.25);
});

test("la reparación sólo toca el slot culpable: los demás quedan como los eligió la etapa A", () => {
  // Con los CINCO slots, para que la cota no sea trivial: hay 5 posiciones y
  // como mucho 3 intentos, así que «no se tocan las demás» dice algo de verdad.
  const cinco: SlotComida[] = ["desayuno", "almuerzo", "comida", "merienda", "cena"];
  const { pool, ctx } = escenario({ slots: cinco });
  const orden = ordenDeSlots(cinco);

  // La selección inicial, reproducida con la misma ruta que usa la etapa C.
  const elegidas = seleccionarDia(pool, ctx, vectorObjetivo(OBJETIVO_IMPOSIBLE), cinco, (s) =>
    rngDe(99n, RUTA_A, 0, 0, 0, IDX_SLOT[s]),
  );
  assert.ok(elegidas !== null);
  const inicial = orden.map((s) => elegidas.get(s));

  const errores: number[] = [];
  const c = generarCandidatoDia(
    pool,
    ctx,
    OBJETIVO_IMPOSIBLE,
    cinco,
    99n,
    0,
    0,
    resolverEspia(errores),
  );
  assert.ok(c !== null);
  const intentosRealizados = errores.length - 1;
  assert.ok(intentosRealizados > 0, "el escenario no llegó a reparar nada");

  let cambiados = 0;
  for (let i = 0; i < orden.length; i++) if (c.filas[i] !== inicial[i]) cambiados++;
  assert.ok(
    cambiados <= intentosRealizados,
    `${cambiados} slots distintos de la selección inicial con sólo ${intentosRealizados} intentos`,
  );
  assert.ok(cambiados < orden.length, "se rehizo el día entero en vez del slot culpable");
});

test("el mismo seed da el mismo candidato, y otro seed da otro", () => {
  const { restr, pool, ctx } = escenario();
  const gen = (seed: bigint, dia: number) =>
    generarCandidatoDia(pool, ctx, OBJETIVO_FACIL, restr.slots, seed, dia, 0, resolverPorciones);
  const uno = gen(1234n, 0);
  const dos = gen(1234n, 0);
  assert.ok(uno !== null && dos !== null);
  assert.deepEqual(uno.filas, dos.filas);
  assert.equal(uno.clave, dos.clave);
  assert.deepEqual([...uno.sigma], [...dos.sigma]);
  assert.equal(uno.error, dos.error);

  // Y la semilla manda de verdad: si el plan no cambiara con el seed, el motor
  // estaría ignorando la aleatoriedad y todos los usuarios comerían lo mismo.
  const distintos = new Set<string>();
  for (const s of [1n, 2n, 3n, 4n, 5n, 6n]) distintos.add(gen(s, 0)?.clave ?? "");
  assert.ok(distintos.size > 1, "el seed no cambia el plan");
});

// ---------------------------------------------------------------------------
// Veto entre días — el estado mutable del contexto
// ---------------------------------------------------------------------------

test("dos días seguidos no repiten la misma receta en el mismo slot", () => {
  // LOAD-BEARING: el veto vive en `ctx.vetoSlot`, que la etapa D reescribe al
  // cerrar cada día. Este test es el que se cae si alguien hace inmutable el
  // contexto o paraleliza los días — y se caería en silencio, con un plan que
  // repite lentejas dos días seguidos, si no estuviera escrito.
  const { restr, pool, ctx } = escenario();
  const ayer = generarCandidatoDia(
    pool,
    ctx,
    OBJETIVO_FACIL,
    restr.slots,
    2024n,
    0,
    0,
    resolverPorciones,
  );
  assert.ok(ayer !== null);

  // Cierre del día, tal y como lo hace la etapa D.
  ctx.vetoSlot = new Map<SlotComida, number>();
  for (let i = 0; i < ayer.slots.length; i++) {
    ctx.vetoSlot.set(ayer.slots[i] ?? "comida", ayer.filas[i] ?? -1);
  }

  const hoy = generarCandidatoDia(
    pool,
    ctx,
    OBJETIVO_FACIL,
    restr.slots,
    2024n,
    1,
    0,
    resolverPorciones,
  );
  assert.ok(hoy !== null);
  assert.deepEqual(hoy.slots, ayer.slots);
  for (let i = 0; i < hoy.slots.length; i++) {
    assert.notEqual(
      hoy.filas[i],
      ayer.filas[i],
      `${hoy.slots[i]}: la misma receta dos días seguidos`,
    );
  }
});

test("los vetos ceden antes que dejar al usuario sin día", () => {
  // Los vetos de variedad son la única restricción del servicio que cede, y cede
  // porque no es de seguridad: una repetición de más es infinitamente mejor que
  // un plan menos. Aquí se vetan TODAS las filas por las dos vías a la vez —el
  // caso extremo de un catálogo agotado a mitad de semana— y aun así hay día.
  const { restr, pool, ctx } = escenario();
  ctx.vetoSemana = new Uint8Array(pool.p).fill(1);
  ctx.vetoSlot = new Map<SlotComida, number>();
  for (const slot of restr.slots) ctx.vetoSlot.set(slot, 0);
  const c = generarCandidatoDia(
    pool,
    ctx,
    OBJETIVO_FACIL,
    restr.slots,
    5n,
    3,
    0,
    resolverPorciones,
  );
  assert.ok(c !== null, "el veto dejó al usuario sin día en vez de ceder");
  assert.equal(c.filas.length, restr.slots.length);
});

// ---------------------------------------------------------------------------
// recomponerDia y mejorAlternativa — las rutas sin aleatoriedad
// ---------------------------------------------------------------------------

test("recomponerDia devuelve los totales de SUS sigma, no unos heredados", () => {
  const { restr, pool, ctx } = escenario();
  const orden = ordenDeSlots(restr.slots);
  const filas = [0, 1, 2];
  const c = recomponerDia(pool, ctx, OBJETIVO_FACIL, orden, filas, 2, resolverPorciones);
  assert.deepEqual(c.filas, filas);
  assert.equal(c.intentos, 2);
  // A·σ recalculado a mano: es el invariante que impide que la suma que enseña
  // la UI deje de cuadrar con las comidas que enseña la UI.
  for (let n = 0; n < N_NUTR; n++) {
    let esperado = 0;
    for (let r = 0; r < filas.length; r++) {
      esperado += (c.sigma[r] ?? 0) * (pool.nutr[(filas[r] ?? 0) * N_NUTR + n] ?? 0);
    }
    assert.ok(
      Math.abs((c.totales[n] ?? 0) - esperado) < 1e-9,
      `nutriente ${n}: ${c.totales[n]} ≠ ${esperado}`,
    );
  }
});

test("recomponerDia no consume aleatoriedad: dos llamadas idénticas dan lo mismo", () => {
  const { restr, pool, ctx } = escenario();
  const orden = ordenDeSlots(restr.slots);
  const uno = recomponerDia(pool, ctx, OBJETIVO_FACIL, orden, [3, 4, 5], 0, resolverPorciones);
  const dos = recomponerDia(pool, ctx, OBJETIVO_FACIL, orden, [3, 4, 5], 0, resolverPorciones);
  assert.deepEqual([...uno.sigma], [...dos.sigma]);
  assert.equal(uno.error, dos.error);
});

test("mejorAlternativa es el argmax determinista, con desempate por id", () => {
  const { pool, ctx } = escenario();
  const residuo = vectorObjetivo(OBJETIVO_FACIL);
  const excluidas = new Uint8Array(pool.p);
  const j = mejorAlternativa(pool, ctx, "comida", residuo, excluidas);
  assert.ok(j !== null);

  // Se recalculan los scores y se comprueba que no hay nadie estrictamente
  // mejor, y que entre los empatados el elegido tiene el id menor.
  const scores = new Float32Array(pool.p);
  scoreSlot(pool, ctx, "comida", residuo, excluidas, scores);
  const suyo = scores[j] ?? 0;
  assert.ok(Number.isFinite(suyo));
  for (let i = 0; i < pool.p; i++) {
    const s = scores[i] ?? 0;
    if (!Number.isFinite(s)) continue;
    assert.ok(s <= suyo, `la fila ${i} puntúa más que la elegida`);
    if (s === suyo) {
      assert.ok((pool.ids[j] ?? "") <= (pool.ids[i] ?? ""), "desempate por id incumplido");
    }
  }
});

test("mejorAlternativa devuelve null cuando no queda nada admisible", () => {
  const { pool, ctx } = escenario();
  const residuo = vectorObjetivo(OBJETIVO_FACIL);
  assert.equal(
    mejorAlternativa(pool, ctx, "comida", residuo, new Uint8Array(pool.p).fill(1)),
    null,
  );
});
