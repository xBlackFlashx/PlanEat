/**
 * Etapa A: los siete términos del score y el muestreo.
 *
 * La mayoría de los números esperados NO están escritos a mano: salen de
 * ejecutar el `scoring.py` real del backend sobre el mismo catálogo compilado,
 * volcados a `datos/referencia-python-scoring.json`. Se regeneran con el script
 * `volcar_scoring.py` (ver la cabecera del fichero de datos y el informe del
 * port); el volcado incluye, para cada escenario, el vector de scores completo,
 * el conjunto y el orden del top-K y el vector de probabilidades del softmax,
 * capturados con un RNG falso para que la comparación no dependa del generador
 * —que por decisión de `docs/port-typescript.md` NO es el de numpy—.
 *
 * Comparar contra Python y no contra una cuenta propia es lo que hace que este
 * fichero valga: un término mal portado no da error, da otro plan. Y la etapa A
 * es donde se decide QUÉ come el usuario; la etapa B sólo decide cuánto.
 *
 * Tolerancia: 1e-6 relativo sobre los términos finitos, y exacta sobre los
 * −Infinity, los conjuntos de candidatos y su orden. No es cero porque
 * `Math.acos` de V8 no está obligado a coincidir a 1 ULP con la libm de CPython
 * y porque el score se acumula en float64 y se materializa una vez, en vez de
 * redondear a float32 en cada operación intermedia: las dos divergencias están
 * declaradas en docs/port-typescript.md.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { cargarCatalogo } from "../src/catalogo.ts";
import {
  IDX_SLOT,
  N_NUTR,
  PESO_SLOT,
  SLOTS,
  TOP_K,
  W_AFIN,
  W_ESC,
  W_FIT,
  W_REP,
} from "../src/constantes.ts";
import { construirPool, invalidarCachePool } from "../src/pool.ts";
import { contadorDeSorteos, rngDe } from "../src/rng.ts";
import type { Rng } from "../src/rng.ts";
import {
  contextoDe,
  cuotasDe,
  muestrear,
  ordenDeSlots,
  penalizacionRepeticion,
  recalcularSolape,
  scoreSlot,
  seleccionarDia,
  sigmaSugerido,
  totalesDe,
  vectorMacro,
} from "../src/scoring.ts";
import type { Contexto, Pool, RestriccionesGeneracion, SlotComida } from "../src/tipos.ts";
import type { CatalogoSerializado } from "../herramientas/compilar-catalogo.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const CAT = cargarCatalogo(
  JSON.parse(
    readFileSync(resolve(AQUI, "../datos/catalogo-compilado.json"), "utf8"),
  ) as CatalogoSerializado,
);

// ---------------------------------------------------------------------------
// El volcado de referencia
// ---------------------------------------------------------------------------

/** Los flotantes viajan como número, o como centinela si son ±inf / NaN. */
type Flotante = number | "inf" | "-inf" | "nan";

interface EscenarioRef {
  nombre: string;
  restr: Record<string, unknown>;
  nDias: number;
  tau: number;
  residuo: Flotante[];
  slot: SlotComida;
  excluidas: number[];
  sinPrecio: number[];
  bitsSemana64: string[];
  vetoSemana: number[] | null;
  vetoSlot: Record<string, number>;
  p: number;
  ids: string[];
  pesoCoste: Flotante;
  umbralCoste: Flotante;
  costeDesactivadoPor: string | null;
  cuota: Record<string, Flotante>;
  penRep: Flotante[];
  score: Flotante[];
  candidatos: number[];
  probabilidades: Flotante[] | null;
  elegidoConSorteo0: number | null;
}

interface Referencia {
  versionCatalogo: string;
  topK: number;
  escenarios: EscenarioRef[];
  cuotas: { slots: SlotComida[]; cuotas: Record<string, Flotante>; orden: SlotComida[] }[];
  vectoresMacro: { residuo: Flotante[]; v: Flotante[] }[];
  sigmas: { j: number; residuo: Flotante[]; cuota: number; sigma: Flotante }[];
  totales: { filas: number[]; sigmas: Flotante[]; totales: Flotante[] }[];
  penalizaciones: { recientes: string[]; nSlots: number; pen: Flotante[] }[];
  muestreos: {
    nombre: string;
    scores: Flotante[];
    ids: string[];
    tau: number;
    candidatos: number[];
    probabilidades: Flotante[] | null;
  }[];
}

const REF = JSON.parse(
  readFileSync(resolve(AQUI, "datos/referencia-python-scoring.json"), "utf8"),
) as Referencia;

function num(x: Flotante): number {
  if (x === "inf") return Infinity;
  if (x === "-inf") return -Infinity;
  if (x === "nan") return NaN;
  return x;
}

function f64(v: Flotante[]): Float64Array {
  const a = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) a[i] = num(v[i] ?? 0);
  return a;
}

/** Igualdad con tolerancia relativa, y exacta para los infinitos. */
function casiIgual(obtenido: number, esperado: number, tol: number, contexto: string): void {
  if (!Number.isFinite(esperado) || !Number.isFinite(obtenido)) {
    assert.equal(obtenido, esperado, contexto);
    return;
  }
  const error = Math.abs(obtenido - esperado) / Math.max(1, Math.abs(esperado));
  assert.ok(
    error <= tol,
    `${contexto}: obtenido ${obtenido}, esperado ${esperado} (error relativo ${error})`,
  );
}

function vectorCasiIgual(
  obtenido: ArrayLike<number>,
  esperado: Flotante[],
  tol: number,
  contexto: string,
): void {
  assert.equal(obtenido.length, esperado.length, `${contexto}: longitud`);
  for (let i = 0; i < esperado.length; i++) {
    casiIgual(obtenido[i] ?? NaN, num(esperado[i] ?? 0), tol, `${contexto}[${i}]`);
  }
}

const TOL = 1e-6;

// ---------------------------------------------------------------------------
// Montaje de un escenario del volcado
// ---------------------------------------------------------------------------

function restrDe(bruto: Record<string, unknown>): RestriccionesGeneracion {
  const r = bruto as Partial<RestriccionesGeneracion> & { [k: string]: unknown };
  const salida: RestriccionesGeneracion = {
    dieta: r.dieta ?? "omnivora",
    alergenosExcluidos: r.alergenosExcluidos ?? [],
    ingredientesExcluidos: r.ingredientesExcluidos ?? [],
    slots: r.slots ?? ["desayuno", "comida", "cena"],
    comensales: r.comensales ?? 1,
  };
  // Pydantic serializa los ausentes como null; el contrato de TS los quiere
  // ausentes. Traducir aquí y no en el motor: el motor no habla pydantic.
  if (r.minutosMaxPorSlot != null) salida.minutosMaxPorSlot = r.minutosMaxPorSlot;
  if (r.presupuestoSemanalCents != null) {
    salida.presupuestoSemanalCents = r.presupuestoSemanalCents;
  }
  if (r.despensaAlimentoIds != null) salida.despensaAlimentoIds = r.despensaAlimentoIds;
  if (r.recetasRecientes != null) salida.recetasRecientes = r.recetasRecientes;
  return salida;
}

/**
 * Las palabras de 64 bits del volcado a las de 32 bits del port. Es la
 * traducción que hace el compilador de catálogo con `ingrBits`, aquí a mano
 * para el `bitsSemana` sintético de los escenarios.
 */
function bits32Desde64(palabras64: string[], w32: number): Uint32Array {
  const salida = new Uint32Array(w32);
  for (let i = 0; i < palabras64.length; i++) {
    const v = BigInt(palabras64[i] ?? "0");
    const baja = Number(v & 0xffffffffn);
    const alta = Number((v >> 32n) & 0xffffffffn);
    if (2 * i < w32) salida[2 * i] = baja;
    if (2 * i + 1 < w32) salida[2 * i + 1] = alta;
  }
  return salida;
}

function montar(e: EscenarioRef): { pool: Pool; ctx: Contexto } {
  invalidarCachePool();
  const restr = restrDe(e.restr);
  const pool = construirPool(CAT, restr);
  assert.equal(pool.p, e.p, `${e.nombre}: tamaño del pool`);
  assert.deepEqual([...pool.ids], e.ids, `${e.nombre}: ids del pool`);
  for (const i of e.sinPrecio) pool.costeConocido[i] = 0;

  const ctx = contextoDe(CAT, pool, restr, e.nDias, e.tau);
  if (e.bitsSemana64.length > 0) {
    const bits = bits32Desde64(e.bitsSemana64, pool.w32);
    ctx.bitsSemana.set(bits);
    recalcularSolape(pool, ctx);
  }
  if (e.vetoSemana !== null) {
    const m = new Uint8Array(pool.p);
    for (const i of e.vetoSemana) m[i] = 1;
    ctx.vetoSemana = m;
  }
  for (const [slot, fila] of Object.entries(e.vetoSlot)) {
    ctx.vetoSlot.set(slot as SlotComida, fila);
  }
  return { pool, ctx };
}

/** Rng falso que registra la `p` recibida y devuelve el índice que se le fije. */
function rngFalso(devuelve: number): Rng & { p: Float64Array | null; llamadas: number } {
  return {
    p: null,
    llamadas: 0,
    random(): number {
      throw new Error("rngFalso: muestrear no debe llamar a random()");
    },
    integers(): number {
      throw new Error("rngFalso: muestrear no debe llamar a integers()");
    },
    choice(n: number, p: Float64Array): number {
      this.p = p.slice(0, n);
      this.llamadas++;
      return devuelve;
    },
  };
}

// ---------------------------------------------------------------------------
// Reparto por slots
// ---------------------------------------------------------------------------

test("cuotasDe reparte igual que el cuotas_de de Python y suma 1", () => {
  for (const caso of REF.cuotas) {
    const cuotas = cuotasDe(caso.slots);
    let suma = 0;
    for (const [slot, valor] of Object.entries(caso.cuotas)) {
      casiIgual(cuotas[slot as SlotComida], num(valor), TOL, `cuota de ${slot}`);
      suma += cuotas[slot as SlotComida];
    }
    casiIgual(suma, 1.0, TOL, `suma de cuotas de ${caso.slots.join("+")}`);
  }
});

test("cuotasDe lanza con la lista vacía en vez de devolver Infinity en silencio", () => {
  // Python lanza ZeroDivisionError; aquí la división daría Infinity y el
  // síntoma aparecería cuatro llamadas más abajo, como un residuo NaN.
  assert.throws(() => cuotasDe([]), /no hay slots que repartir/);
});

test("cuotasDe cuenta las repeticiones, igual que el sum() de Python", () => {
  // Comportamiento raro pero vigente: la lista no se deduplica al sumar el
  // total, así que ['comida','comida'] da 0,5 y no 1,0. Se fija para que nadie
  // lo «arregle» sin darse cuenta de que cambia los planes.
  const cuotas = cuotasDe(["comida", "comida"]);
  casiIgual(cuotas.comida, 0.5, TOL, "cuota de comida duplicada");
});

test("ordenDeSlots ordena por cuota descendente y desempata por el orden canónico", () => {
  for (const caso of REF.cuotas) {
    assert.deepEqual(ordenDeSlots(caso.slots), caso.orden, caso.slots.join("+"));
  }
  // El orden en que la petición liste los slots no puede afectar al plan: es lo
  // que hace que dos peticiones equivalentes den el mismo resultado.
  const todos: SlotComida[] = [...SLOTS];
  const alReves = [...todos].reverse();
  assert.deepEqual(ordenDeSlots(alReves), ordenDeSlots(todos));
  // almuerzo y merienda empatan a 0,10: manda el índice canónico (almuerzo).
  assert.deepEqual(ordenDeSlots(["merienda", "almuerzo"]), ["almuerzo", "merienda"]);
  assert.ok(PESO_SLOT.almuerzo === PESO_SLOT.merienda);
  assert.ok(IDX_SLOT.almuerzo < IDX_SLOT.merienda);
});

// ---------------------------------------------------------------------------
// vectorMacro
// ---------------------------------------------------------------------------

test("vectorMacro reproduce el vector_macro de Python, incluido el caso nulo", () => {
  const salida = new Float64Array(3);
  for (const caso of REF.vectoresMacro) {
    const hay = vectorMacro(f64(caso.residuo), salida);
    vectorCasiIgual(salida, caso.v, TOL, `vectorMacro(${caso.residuo.join(",")})`);
    const esperadoHay = caso.v.some((x) => num(x) !== 0);
    assert.equal(hay, esperadoHay, "np.any(v_res)");
  }
});

test("vectorMacro clampa a cero componente a componente, no el vector entero", () => {
  // La trampa del port señalada por la auditoría: un residuo con la proteína ya
  // cubierta (negativa) y el carbohidrato pendiente NO da el vector nulo, da un
  // vector válido con la proteína a cero.
  const salida = new Float64Array(3);
  const hay = vectorMacro(Float64Array.from([100, -20, 50, 0, 0, 0]), salida);
  assert.equal(hay, true);
  assert.equal(salida[0], 0);
  assert.equal(salida[1], 1);
  assert.equal(salida[2], 0);
});

test("vectorMacro devuelve el vector nulo con el día ya cubierto", () => {
  const salida = new Float64Array(3);
  assert.equal(vectorMacro(Float64Array.from([-1, -1, -1, -1, 0, 0]), salida), false);
  assert.deepEqual([...salida], [0, 0, 0]);
});

// ---------------------------------------------------------------------------
// Penalización de repetición
// ---------------------------------------------------------------------------

test("penalizacionRepeticion reproduce los exponentes de Python", () => {
  invalidarCachePool();
  const pool = construirPool(CAT, restrDe({}));
  for (const caso of REF.penalizaciones) {
    const pen = penalizacionRepeticion(CAT, pool, caso.recientes, caso.nSlots);
    vectorCasiIgual(pen, caso.pen, TOL, `penRep(${caso.recientes.join(",")})`);
  }
});

test("un duplicado en recetasRecientes consume posición y desplaza los exponentes", () => {
  // Es la sutileza número 2 de la auditoría: el `continue` del dedupe NO
  // decrementa `pos`. Deduplicar la lista antes de recorrerla daría 0,85^0 para
  // la segunda receta en vez de 0,85^1, y el plan cambiaría sin que nada fallara.
  invalidarCachePool();
  const pool = construirPool(CAT, restrDe({}));
  const a = "pollo_arroz_brocoli";
  const b = "lentejas_guisadas";
  const conDuplicado = penalizacionRepeticion(CAT, pool, [a, a, b], 1);
  const deduplicada = penalizacionRepeticion(CAT, pool, [a, b], 1);
  const jb = pool.mapaFila[CAT.idxPorId.get(b) ?? 0] ?? -1;
  assert.ok(jb >= 0);
  casiIgual(conDuplicado[jb] ?? 0, 0.85 ** 2, TOL, "con duplicado");
  casiIgual(deduplicada[jb] ?? 0, 0.85 ** 1, TOL, "deduplicada");
});

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

test("contextoDe apaga el coste con los dos motivos que la UI consume", () => {
  for (const e of REF.escenarios) {
    const { ctx } = montar(e);
    casiIgual(ctx.pesoCoste, num(e.pesoCoste), TOL, `${e.nombre}: pesoCoste`);
    casiIgual(ctx.umbralCoste, num(e.umbralCoste), TOL, `${e.nombre}: umbralCoste`);
    assert.equal(ctx.costeDesactivadoPor, e.costeDesactivadoPor, `${e.nombre}: motivo`);
  }
  // Y los dos literales son contrato: aparecen en la traza y la UI los lee.
  const motivos = new Set(REF.escenarios.map((e) => e.costeDesactivadoPor));
  assert.ok(motivos.has("sin_presupuesto"));
  assert.ok(motivos.has("precios_incompletos"));
  assert.ok(motivos.has(null));
});

test("el término de coste se apaga entero por debajo del 80 % de precios conocidos", () => {
  // El volcado de Python calcula, para el tamaño de pool que le toque, el
  // recuento de precios conocidos justo por debajo y justo por encima del
  // 80 %. Trae los dos casos, así que el umbral queda fijado por ambos lados
  // y no sólo por uno.
  const apagado = REF.escenarios.find((e) => e.nombre === "presupuesto-sin-precios");
  const encendido = REF.escenarios.find(
    (e) => e.nombre === "presupuesto-con-precios-justo-en-el-umbral",
  );
  assert.ok(apagado !== undefined && encendido !== undefined);
  assert.equal(montar(apagado).ctx.costeDesactivadoPor, "precios_incompletos");
  assert.equal(montar(encendido).ctx.costeDesactivadoPor, null);
});

// ---------------------------------------------------------------------------
// scoreSlot
// ---------------------------------------------------------------------------

test("scoreSlot reproduce el vector de scores de Python en los doce escenarios", () => {
  for (const e of REF.escenarios) {
    const { pool, ctx } = montar(e);
    const excluidas = new Uint8Array(pool.p);
    for (const i of e.excluidas) excluidas[i] = 1;
    const salida = new Float32Array(pool.p);
    scoreSlot(pool, ctx, e.slot, f64(e.residuo), excluidas, salida);
    vectorCasiIgual(salida, e.score, TOL, `${e.nombre}: score`);
  }
});

test("los vetos de variedad ceden cuando dejarían el slot sin candidatos", () => {
  // La única restricción del servicio que cede, y cede porque no es de
  // seguridad: una repetición de más es infinitamente mejor que un fallo.
  const e = REF.escenarios.find((x) => x.nombre === "vetos-que-vacian");
  assert.ok(e !== undefined);
  const { pool, ctx } = montar(e);
  assert.notEqual(ctx.vetoSemana, null);
  const salida = new Float32Array(pool.p);
  scoreSlot(pool, ctx, e.slot, f64(e.residuo), new Uint8Array(pool.p), salida);
  // Todas las filas del pool están vetadas y aun así hay candidatos finitos.
  let finitos = 0;
  for (let i = 0; i < pool.p; i++) if (Number.isFinite(salida[i])) finitos++;
  assert.ok(finitos > 0, "los vetos han dejado el slot sin candidatos");
});

test("los vetos de variedad podan cuando dejan algo que elegir", () => {
  const e = REF.escenarios.find((x) => x.nombre === "vetos-que-dejan-algo");
  assert.ok(e !== undefined);
  const { pool, ctx } = montar(e);
  const salida = new Float32Array(pool.p);
  scoreSlot(pool, ctx, e.slot, f64(e.residuo), new Uint8Array(pool.p), salida);
  for (const i of e.vetoSemana ?? []) {
    assert.equal(salida[i], -Infinity, `la fila vetada ${i} debería ser inadmisible`);
  }
  assert.equal(salida[e.vetoSlot[e.slot] ?? -1], -Infinity, "la receta de ayer");
});

test("el tope de minutos es POR SLOT y no filtra el pool entero", () => {
  // El bug clásico: filtrar el pool por el límite del desayuno y quedarse sin
  // cenas. El pool sólo poda por el MÁXIMO de los topes pedidos (cota laxa) y
  // el filtro fino vive aquí.
  invalidarCachePool();
  const restr = restrDe({ minutosMaxPorSlot: { desayuno: 5, comida: 90, cena: 90 } });
  const pool = construirPool(CAT, restr);
  const ctx = contextoDe(CAT, pool, restr, 7, 0.37);
  const residuo = Float64Array.from([2200, 110, 250, 70, 30, 2000]);
  const salida = new Float32Array(pool.p);

  scoreSlot(pool, ctx, "desayuno", residuo, new Uint8Array(pool.p), salida);
  for (let i = 0; i < pool.p; i++) {
    if ((pool.minutos[i] ?? 0) > 5) {
      assert.equal(salida[i], -Infinity, `fila ${i} pasa el tope del desayuno`);
    }
  }
  scoreSlot(pool, ctx, "comida", residuo, new Uint8Array(pool.p), salida);
  let admisibles = 0;
  for (let i = 0; i < pool.p; i++) if (Number.isFinite(salida[i])) admisibles++;
  assert.ok(admisibles > 0, "el tope del desayuno se ha comido las comidas");
});

test("con el residuo de kcal cubierto, esc vale 0 para todo el pool, no 1", () => {
  // Uniforme, así que no discrimina; pero desplaza el score absoluto en −2,0 y
  // con ello la media y la σ del z-score del muestreo. Reproducirlo tal cual.
  const e = REF.escenarios.find((x) => x.nombre === "residuo-cubierto");
  assert.ok(e !== undefined);
  const { pool, ctx } = montar(e);
  const salida = new Float32Array(pool.p);
  scoreSlot(pool, ctx, e.slot, f64(e.residuo), new Uint8Array(pool.p), salida);
  // fit = 0,5 y esc = 0 para todos; sin despensa, semana, coste ni repetición
  // el score es exactamente W_FIT·0,5.
  for (let i = 0; i < pool.p; i++) {
    if (!Number.isFinite(salida[i])) continue;
    casiIgual(salida[i] ?? NaN, W_FIT * 0.5, 1e-6, `fila ${i}`);
  }
});

test("el rango del score es [-3,5 ; 8,7], que es el del código y no el de DISENO", () => {
  // W_AFIN vale 0,0: el término existe y no aporta. DISENO §2.2 escribe 0,8·φ,
  // y el documento se equivoca. Si alguien «corrige» el peso, este test cae.
  assert.equal(W_AFIN, 0.0);
  const maximo = W_FIT + W_ESC + 1.5 + 1.2 + W_AFIN;
  const minimo = -1.5 - W_REP;
  casiIgual(maximo, 8.7, 1e-12, "máximo del score");
  casiIgual(minimo, -3.5, 1e-12, "mínimo del score");
  for (const e of REF.escenarios) {
    for (const s of e.score) {
      const v = num(s);
      if (!Number.isFinite(v)) continue;
      assert.ok(v >= minimo - 1e-6 && v <= maximo + 1e-6, `score fuera de rango: ${v}`);
    }
  }
});

test("recalcularSolape es obligatorio tras mutar bitsSemana", () => {
  // Sin la llamada el término se queda congelado en el día anterior y el fallo
  // es invisible: sale plan, sólo que con más líneas en la lista de la compra.
  invalidarCachePool();
  const restr = restrDe({});
  const pool = construirPool(CAT, restr);
  const ctx = contextoDe(CAT, pool, restr, 7, 0.37);
  for (let i = 0; i < pool.p; i++) assert.equal(ctx.solPre[i], 0, "el primer día es 0");

  ctx.bitsSemana.set(pool.bits.subarray(0, pool.w32));
  let sumaAntes = 0;
  for (let i = 0; i < pool.p; i++) sumaAntes += ctx.solPre[i] ?? 0;
  assert.equal(sumaAntes, 0, "mutar bitsSemana no debe tocar solPre por sí solo");

  recalcularSolape(pool, ctx);
  // La receta 0 comparte todos sus ingredientes consigo misma: cobertura 1 si
  // nIngr coincide con el popcount de su fila.
  assert.ok((ctx.solPre[0] ?? 0) > 0, "el solape de la receta 0 consigo misma");
});

// ---------------------------------------------------------------------------
// muestrear
// ---------------------------------------------------------------------------

test("muestrear elige el mismo top-K, en el mismo orden, que el de Python", () => {
  for (const caso of REF.muestreos) {
    const scores = new Float32Array(caso.scores.length);
    for (let i = 0; i < caso.scores.length; i++) scores[i] = num(caso.scores[i] ?? 0);
    const obtenidos: number[] = [];
    for (let k = 0; k < Math.max(caso.candidatos.length, 1); k++) {
      const j = muestrear(scores, scores.length, caso.ids, caso.tau, rngFalso(k));
      if (j !== null) obtenidos.push(j);
    }
    assert.deepEqual(obtenidos, caso.candidatos, `${caso.nombre}: candidatos`);
    if (caso.probabilidades !== null && caso.probabilidades !== undefined) {
      const r = rngFalso(0);
      muestrear(scores, scores.length, caso.ids, caso.tau, r);
      assert.ok(r.p !== null);
      vectorCasiIgual(r.p, caso.probabilidades, 1e-9, `${caso.nombre}: probabilidades`);
    }
  }
});

test("muestrear sobre el pool real da los mismos candidatos y probabilidades", () => {
  for (const e of REF.escenarios) {
    const { pool, ctx } = montar(e);
    const excluidas = new Uint8Array(pool.p);
    for (const i of e.excluidas) excluidas[i] = 1;
    const scores = new Float32Array(pool.p);
    scoreSlot(pool, ctx, e.slot, f64(e.residuo), excluidas, scores);

    const obtenidos: number[] = [];
    for (let k = 0; k < Math.max(e.candidatos.length, 1); k++) {
      const j = muestrear(scores, pool.p, pool.ids, e.tau, rngFalso(k));
      if (j !== null) obtenidos.push(j);
    }
    assert.deepEqual(obtenidos, e.candidatos, `${e.nombre}: candidatos`);
    if (e.probabilidades !== null && e.probabilidades !== undefined) {
      const r = rngFalso(0);
      muestrear(scores, pool.p, pool.ids, e.tau, r);
      assert.ok(r.p !== null);
      // Tolerancia 1e-5 y no 1e-9 como en el test sintético de arriba, y la
      // diferencia es informativa: allí los scores de entrada son EXACTOS (los
      // fija el test), así que se está midiendo `muestrear` sola. Aquí vienen de
      // `scoreSlot`, que diverge de numpy en el último bit del float32 porque
      // acumula en float64 y no redondea en cada operación intermedia. El
      // softmax amplifica esa diferencia por 1/(σ·τ) ≈ 5, así que un error
      // relativo de 1,2e-7 en el score sale como ~6e-7 en la probabilidad. Es la
      // divergencia declarada en docs/port-typescript.md, no un fallo del port:
      // lo que sí se exige exacto es el CONJUNTO y el ORDEN de los candidatos,
      // que es de lo que depende la reproducibilidad.
      vectorCasiIgual(r.p, e.probabilidades, 1e-5, `${e.nombre}: probabilidades`);
    }
  }
});

test("con UN solo candidato, muestrear no consume NINGÚN sorteo del RNG", () => {
  // ATAJO LOAD-BEARING (DISENO §2.6). El flujo de cada nodo del árbol depende
  // de cuántos sorteos consume; uno de más aquí desplaza todo lo que venga
  // detrás y produce otro plan sin que nada falle. Es exactamente el fallo
  // contra el que avisa la auditoría, y por eso se cuenta y no se supone.
  const scores = Float32Array.from([-Infinity, 3.25, -Infinity, -Infinity]);
  const rng = rngDe(12345n, 0, 0, 0, 0, 0);
  assert.equal(contadorDeSorteos(rng), 0);
  const j = muestrear(scores, scores.length, ["a", "b", "c", "d"], 0.37, rng);
  assert.equal(j, 1);
  assert.equal(contadorDeSorteos(rng), 0, "el atajo ha consumido un sorteo");
});

test("sin ningún candidato, muestrear devuelve null sin tocar el RNG", () => {
  const scores = Float32Array.from([-Infinity, -Infinity]);
  const rng = rngDe(999n, 1);
  assert.equal(muestrear(scores, 2, ["a", "b"], 0.37, rng), null);
  assert.equal(contadorDeSorteos(rng), 0);
});

test("con más de un candidato, muestrear consume EXACTAMENTE un sorteo", () => {
  const scores = Float32Array.from([1.0, 2.0, 3.0]);
  const rng = rngDe(777n, 0, 1, 2);
  muestrear(scores, 3, ["a", "b", "c"], 0.37, rng);
  assert.equal(contadorDeSorteos(rng), 1);
});

test("el top-K con todo empatado se queda con los 25 ids menores, no con los 25 primeros", () => {
  // El caso que la auditoría propone como test del desempate: 30 recetas con el
  // mismo score y los ids en orden DESCENDENTE respecto del índice. Si el corte
  // se hiciera por posición saldrían los índices 0..24; el desempate por id
  // exige que salgan los 25 de id menor, que son los índices 29..5.
  const n = 30;
  const scores = new Float32Array(n).fill(1.0);
  const ids = Array.from({ length: n }, (_, i) => `id${String(n - 1 - i).padStart(2, "0")}`);
  const elegidos = new Set<number>();
  for (let k = 0; k < TOP_K; k++) {
    const j = muestrear(scores, n, ids, 0.37, rngFalso(k));
    assert.ok(j !== null);
    elegidos.add(j);
  }
  assert.equal(elegidos.size, TOP_K);
  const idsElegidos = [...elegidos].map((i) => ids[i] ?? "").sort();
  assert.deepEqual(idsElegidos, [...ids].sort().slice(0, TOP_K));
});

test("el conjunto del top-K no depende del orden de llegada de los empatados", () => {
  // Es la razón por la que el particionado se usa SÓLO para el valor umbral:
  // el conjunto que deja a cada lado no está definido cuando hay empates, y el
  // valor sí es único sea cual sea la permutación.
  const n = 40;
  const ids = Array.from({ length: n }, (_, i) => `x${String(i).padStart(2, "0")}`);
  const base = new Float32Array(n);
  for (let i = 0; i < n; i++) base[i] = i < 10 ? 5.0 : 2.0;
  const candidatosDe = (s: Float32Array, orden: string[]): string[] => {
    const salida: string[] = [];
    for (let k = 0; k < TOP_K; k++) {
      const j = muestrear(s, n, orden, 0.37, rngFalso(k));
      assert.ok(j !== null);
      salida.push(orden[j] ?? "");
    }
    return salida.sort();
  };
  const primera = candidatosDe(base, ids);
  // Misma distribución de scores, ids permutados al revés dentro de los
  // empatados: el conjunto elegido tiene que salir de la misma regla.
  const idsRev = [...ids];
  idsRev.reverse();
  const segunda = candidatosDe(base, idsRev);
  assert.equal(primera.length, TOP_K);
  assert.equal(segunda.length, TOP_K);
  assert.equal(new Set(segunda).size, TOP_K, "el top-K tiene repetidos");
});

test("con desviación nula el softmax queda uniforme y no divide por cero", () => {
  const caso = REF.muestreos.find((m) => m.nombre === "desviacion-nula");
  assert.ok(caso !== undefined);
  const scores = Float32Array.from(caso.scores.map((x) => num(x)));
  const r = rngFalso(0);
  muestrear(scores, scores.length, caso.ids, caso.tau, r);
  assert.ok(r.p !== null);
  for (const q of r.p) casiIgual(q, 1 / scores.length, 1e-12, "probabilidad uniforme");
});

// ---------------------------------------------------------------------------
// sigmaSugerido y totalesDe
// ---------------------------------------------------------------------------

test("sigmaSugerido reproduce el clip de Python, incluidos los extremos", () => {
  invalidarCachePool();
  const pool = construirPool(CAT, restrDe({}));
  for (const caso of REF.sigmas) {
    const s = sigmaSugerido(pool, caso.j, f64(caso.residuo), caso.cuota);
    casiIgual(s, num(caso.sigma), TOL, `sigma(j=${caso.j}, kcal=${caso.residuo[0]})`);
    assert.ok(s >= (pool.escalaMin[caso.j] ?? 0) - 1e-12, "por debajo de escalaMin");
    assert.ok(s <= (pool.escalaMax[caso.j] ?? 0) + 1e-12, "por encima de escalaMax");
  }
});

test("totalesDe es exactamente A·σ, que es lo único que la UI puede sumar", () => {
  invalidarCachePool();
  const pool = construirPool(CAT, restrDe({}));
  for (const caso of REF.totales) {
    const t = totalesDe(pool, caso.filas, f64(caso.sigmas));
    vectorCasiIgual(t, caso.totales, 1e-12, `totales(${caso.filas.join(",")})`);
  }
  // Y con la lista vacía son seis ceros, no un array vacío.
  assert.deepEqual([...totalesDe(pool, [], new Float64Array(0))], new Array(N_NUTR).fill(0));
});

// ---------------------------------------------------------------------------
// seleccionarDia
// ---------------------------------------------------------------------------

test("seleccionarDia elige una receta distinta por slot y en orden de cuota", () => {
  invalidarCachePool();
  const restr = restrDe({});
  const pool = construirPool(CAT, restr);
  const ctx = contextoDe(CAT, pool, restr, 7, 0.37);
  const objetivo = Float64Array.from([2200, 110, 250, 70, 30, 2000]);
  const elegidas = seleccionarDia(pool, ctx, objetivo, restr.slots, (slot) =>
    rngDe(42n, 0, 0, 0, 0, IDX_SLOT[slot]),
  );
  assert.ok(elegidas !== null);
  assert.deepEqual([...elegidas.keys()], ordenDeSlots(restr.slots));
  assert.equal(new Set(elegidas.values()).size, elegidas.size, "receta repetida en el día");
  for (const [slot, j] of elegidas) {
    assert.ok(((pool.mSlot[j] ?? 0) & (1 << IDX_SLOT[slot])) !== 0, `${slot} no admite ${j}`);
  }
});

test("seleccionarDia es determinista: el mismo seed da el mismo día", () => {
  invalidarCachePool();
  const restr = restrDe({});
  const pool = construirPool(CAT, restr);
  const ctx = contextoDe(CAT, pool, restr, 7, 0.37);
  const objetivo = Float64Array.from([2200, 110, 250, 70, 30, 2000]);
  const uno = seleccionarDia(pool, ctx, objetivo, restr.slots, (s) =>
    rngDe(7n, 0, 3, 1, 0, IDX_SLOT[s]),
  );
  const dos = seleccionarDia(pool, ctx, objetivo, restr.slots, (s) =>
    rngDe(7n, 0, 3, 1, 0, IDX_SLOT[s]),
  );
  assert.deepEqual([...(uno ?? [])], [...(dos ?? [])]);
});

test("el orden en que la petición liste los slots no cambia el día elegido", () => {
  invalidarCachePool();
  const restr = restrDe({});
  const pool = construirPool(CAT, restr);
  const ctx = contextoDe(CAT, pool, restr, 7, 0.37);
  const objetivo = Float64Array.from([2200, 110, 250, 70, 30, 2000]);
  const rng = (s: SlotComida): Rng => rngDe(11n, 0, 0, 0, 0, IDX_SLOT[s]);
  const directo = seleccionarDia(pool, ctx, objetivo, ["desayuno", "comida", "cena"], rng);
  const alReves = seleccionarDia(pool, ctx, objetivo, ["cena", "comida", "desayuno"], rng);
  assert.deepEqual([...(directo ?? [])], [...(alReves ?? [])]);
});

test("seleccionarDia devuelve null si un slot se queda sin candidatos", () => {
  invalidarCachePool();
  const restr = restrDe({ minutosMaxPorSlot: { cena: 0 } });
  const pool = construirPool(CAT, restr);
  const ctx = contextoDe(CAT, pool, restr, 7, 0.37);
  const objetivo = Float64Array.from([2200, 110, 250, 70, 30, 2000]);
  const elegidas = seleccionarDia(pool, ctx, objetivo, restr.slots, (s) =>
    rngDe(5n, 0, 0, 0, 0, IDX_SLOT[s]),
  );
  assert.equal(elegidas, null);
});

test("el residuo baja tras cada slot: se resta la ración real, no 1,0", () => {
  // Restar 1,0 dejaría un residuo inflado y los slots siguientes se elegirían
  // contra un objetivo falso (DISENO §2.5). Se comprueba indirectamente: con un
  // objetivo pequeño, la σ sugerida del primer slot cae por debajo de 1.
  invalidarCachePool();
  const pool = construirPool(CAT, restrDe({}));
  const residuo = Float64Array.from([600, 30, 60, 20, 10, 500]);
  const sigma = sigmaSugerido(pool, 0, residuo, 0.35);
  assert.ok(sigma < 1.0, `σ sugerida ${sigma} debería ser menor que 1`);
  assert.ok(sigma >= (pool.escalaMin[0] ?? 0));
});

// ---------------------------------------------------------------------------
// Rendimiento
// ---------------------------------------------------------------------------

test("scoreSlot con el pool del catálogo semilla se mantiene en el orden de los µs", () => {
  invalidarCachePool();
  const restr = restrDe({
    despensaAlimentoIds: ["arroz_integral", "aceite_oliva", "tomate", "huevo"],
    presupuestoSemanalCents: 21000,
  });
  const pool = construirPool(CAT, restr);
  const ctx = contextoDe(CAT, pool, restr, 7, 0.37);
  const residuo = Float64Array.from([2200, 110, 250, 70, 30, 2000]);
  const excluidas = new Uint8Array(pool.p);
  const salida = new Float32Array(pool.p);

  const REPETICIONES = 20_000;
  for (let k = 0; k < 2000; k++) scoreSlot(pool, ctx, "comida", residuo, excluidas, salida);
  const t0 = performance.now();
  for (let k = 0; k < REPETICIONES; k++) {
    scoreSlot(pool, ctx, "comida", residuo, excluidas, salida);
  }
  const usPorLlamada = ((performance.now() - t0) * 1000) / REPETICIONES;
  // 670 llamadas por semana es la cota alta de la auditoría. El umbral es
  // deliberadamente laxo (10 µs por llamada con P=36, es decir ~7 ms por semana
  // entera): no está para medir la máquina de nadie, está para que una
  // regresión de dos órdenes de magnitud —un BigInt, un array de objetos, un
  // popcount metido otra vez dentro del bucle— salte en CI en vez de aparecer
  // como una demo que se cuelga.
  assert.ok(
    usPorLlamada < 10,
    `scoreSlot tarda ${usPorLlamada.toFixed(2)} µs con P=${pool.p}, y no debería pasar de 10`,
  );
  console.log(
    `      scoreSlot: ${usPorLlamada.toFixed(2)} µs/llamada con P=${pool.p} ` +
      `(≈ ${((usPorLlamada * 670) / 1000).toFixed(2)} ms por semana)`,
  );
});
