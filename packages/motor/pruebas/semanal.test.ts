/**
 * Etapa D: los K candidatos por día, el recocido y la pasada de las duras.
 *
 * Dos familias de test, con propósitos distintos:
 *
 *  - **Sintéticos** (la mayoría): candidatos de día fabricados a mano sobre un
 *    pool de mentira. No prueban que el motor genere buenos planes —eso es de
 *    otras etapas— sino las cuatro cosas que sólo se pueden afirmar controlando
 *    los costes al céntimo: que el recocido nunca devuelve algo peor que su
 *    arranque, que las duras se rechazan en vez de penalizarse, que el día vacío
 *    no rompe la cadena de días consecutivos, y sobre todo **cuántos sorteos
 *    consume el bucle**. Este último es el invariante frágil de todo el port: si
 *    el `random()` de Metropolis se evalúa antes del cortocircuito `Δ < 0`, el
 *    flujo de RUTA_D se desincroniza y la misma semilla da otro plan. Un test de
 *    «el plan sale» no lo distingue; contar sorteos, sí.
 *
 *  - **De integración** (los tres últimos): el catálogo real, el pool real y la
 *    etapa C real. Ahí se comprueba lo que ningún sintético puede: que el
 *    contexto se muta en el orden correcto entre días y que la semana entera
 *    respeta el tope de dos usos por receta.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { cargarCatalogo } from "../src/catalogo.ts";
import {
  IDX_SLOT,
  K_CANDIDATOS_DIA,
  LAMBDA_INGREDIENTES,
  MAX_USOS_RECETA_SEMANA,
  NU_REPETICION,
  RUTA_D,
  SA_ITERACIONES,
  VARIEDAD_POR_DEFECTO,
  temperatura,
} from "../src/constantes.ts";
import { construirPool } from "../src/pool.ts";
import { resolverPorcionesRejilla } from "../src/porciones.ts";
import { contadorDeSorteos, rngDe } from "../src/rng.ts";
import { contextoDe } from "../src/scoring.ts";
import { ensamblar, generarCandidatos, repararDuras } from "../src/semanal.ts";
import type {
  CandidatoDia,
  ObjetivoNutricional,
  Pool,
  RestriccionesGeneracion,
  SlotComida,
} from "../src/tipos.ts";
import type { CatalogoSerializado } from "../herramientas/compilar-catalogo.ts";

// ---------------------------------------------------------------------------
// Andamios
// ---------------------------------------------------------------------------

const SEMILLA = 20260815n;

/** Pool de mentira: `ensamblar` sólo mira `p`, `w32` y `costeCents`. */
function poolFalso(p: number, w32 = 1): Pool {
  return {
    p,
    w32,
    idx: new Int32Array(p),
    mapaFila: new Int32Array(p).fill(-1),
    ids: Array.from({ length: p }, (_, i) => `r${i}`),
    nutr: new Float32Array(p * 6),
    conocido: new Uint8Array(p * 6),
    vMacro: new Float32Array(p * 3),
    tieneMacro: new Uint8Array(p),
    escalaMin: new Float32Array(p).fill(0.6),
    escalaMax: new Float32Array(p).fill(1.8),
    mSlot: new Uint8Array(p),
    minutos: new Int16Array(p),
    bits: new Uint32Array(p * w32),
    nIngr: new Int16Array(p),
    costeCents: new Int32Array(p),
    costeConocido: new Uint8Array(p),
  };
}

/** Bitset de una palabra con los bits pedidos. */
function bitsDe(indices: readonly number[]): Uint32Array {
  const b = new Uint32Array(1);
  for (const i of indices) b[0] = ((b[0] ?? 0) | (1 << i)) >>> 0;
  return b;
}

function candidato(
  filas: readonly number[],
  slots: readonly SlotComida[],
  error: number,
  ingredientes: readonly number[],
): CandidatoDia {
  return {
    slots: [...slots],
    filas: [...filas],
    sigma: Float64Array.from(filas.map(() => 1.0)),
    totales: new Float64Array(6),
    error,
    intentos: 0,
    emergencia: false,
    fibraFiable: true,
    bits: bitsDe(ingredientes),
    clave: [...filas].sort((a, b) => a - b).join(","),
  };
}

/** Coste global recalculado desde cero sobre los días devueltos. */
function costeDeLosDias(dias: readonly CandidatoDia[]): number {
  let err = 0.0;
  const usos = new Map<number, number>();
  const unicos = new Set<number>();
  for (const dia of dias) {
    err += dia.error;
    for (const fila of dia.filas) usos.set(fila, (usos.get(fila) ?? 0) + 1);
    for (let b = 0; b < 32; b++) {
      if ((((dia.bits[0] ?? 0) >>> b) & 1) === 1) unicos.add(b);
    }
  }
  let rep = 0;
  for (const u of usos.values()) rep += Math.max(0, u - 1);
  return err + LAMBDA_INGREDIENTES * unicos.size + NU_REPETICION * rep;
}

/** ¿Rompe este plan alguna de las dos duras de variedad? */
function planIncumpleDuras(dias: readonly CandidatoDia[]): boolean {
  const usos = new Map<number, number>();
  for (const dia of dias) {
    for (const fila of dia.filas) {
      const u = (usos.get(fila) ?? 0) + 1;
      usos.set(fila, u);
      if (u > MAX_USOS_RECETA_SEMANA) return true;
    }
  }
  for (let d = 1; d < dias.length; d++) {
    const hoy = dias[d];
    const ayer = dias[d - 1];
    if (hoy === undefined || ayer === undefined) continue;
    for (const [pos, slot] of hoy.slots.entries()) {
      const posAyer = ayer.slots.indexOf(slot);
      if (posAyer >= 0 && ayer.filas[posAyer] === hoy.filas[pos]) return true;
    }
  }
  return false;
}

const COMIDA: SlotComida = "comida";

// ---------------------------------------------------------------------------
// El recocido nunca empeora su arranque
// ---------------------------------------------------------------------------

test("el coste final del recocido nunca supera al del arranque voraz", () => {
  // La propiedad interna del SA: se devuelve el MEJOR estado visto, no el
  // último. Si alguien «simplifica» devolviendo `combo`, este test cae en el
  // primer escenario donde el recocido acepte un empeoramiento y no vuelva —
  // que con T0 = 0,05 es casi cualquiera.
  const pool = poolFalso(40);
  for (let caso = 0; caso < 30; caso++) {
    const gen = rngDe(BigInt(caso), 99);
    const porDia: CandidatoDia[][] = [];
    for (let d = 0; d < 7; d++) {
      const cands: CandidatoDia[] = [];
      for (let k = 0; k < K_CANDIDATOS_DIA; k++) {
        const filas = [gen.integers(12), 12 + gen.integers(12), 24 + gen.integers(12)];
        const ingredientes = [gen.integers(8), 8 + gen.integers(8), 16 + gen.integers(8)];
        cands.push(
          candidato(filas, ["desayuno", COMIDA, "cena"], 0.01 + gen.integers(80) / 1000, ingredientes),
        );
      }
      porDia.push(cands);
    }
    const res = ensamblar(pool, porDia, BigInt(caso), null, 1);
    assert.ok(
      res.costeFinal <= res.costeInicial,
      `caso ${caso}: final ${res.costeFinal} > inicial ${res.costeInicial}`,
    );
  }
});

test("el coste final es el del plan devuelto, no el de otro estado", () => {
  // Devolver `mejor` pero los días de `combo` (o al revés) es un fallo que no
  // se ve en ninguna cifra agregada: el plan sale, sólo que su coste declarado
  // es de otro plan. Se recalcula el coste desde los días devueltos.
  const pool = poolFalso(40);
  for (let caso = 0; caso < 20; caso++) {
    const gen = rngDe(BigInt(caso), 98);
    const porDia: CandidatoDia[][] = [];
    for (let d = 0; d < 5; d++) {
      const cands: CandidatoDia[] = [];
      for (let k = 0; k < 4; k++) {
        cands.push(
          candidato(
            [gen.integers(10), 10 + gen.integers(10)],
            [COMIDA, "cena"],
            0.01 + gen.integers(60) / 1000,
            [gen.integers(10), 10 + gen.integers(10), 20 + gen.integers(10)],
          ),
        );
      }
      porDia.push(cands);
    }
    const res = ensamblar(pool, porDia, BigInt(caso), null, 1);
    assert.ok(
      Math.abs(costeDeLosDias(res.dias) - res.costeFinal) < 1e-12,
      `caso ${caso}: ${costeDeLosDias(res.dias)} != ${res.costeFinal}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Restricciones duras
// ---------------------------------------------------------------------------

test("ninguna receta aparece más de dos veces en la semana si hay alternativa", () => {
  // El voraz ingenuo (argmin del error día a día) elegiría la receta 0 los tres
  // días: es la de menor error en los tres. El arranque voraz de verdad
  // comprueba la factibilidad contra los días ya fijados, y el recocido no
  // puede volver a un estado infactible porque rechaza el movimiento.
  const pool = poolFalso(10);
  const porDia: CandidatoDia[][] = [];
  for (let d = 0; d < 3; d++) {
    porDia.push([
      candidato([0], [COMIDA], 0.01, [0, 1]),
      candidato([d + 1], [COMIDA], 0.02, [2, 3]),
    ]);
  }
  // El test no sería nada sin esta línea: el plan que elegiría el argmin
  // ingenuo, y que el arranque voraz tiene prohibido, sí rompe las duras.
  const argminIngenuo: CandidatoDia[] = [];
  for (const cands of porDia) {
    const primero = cands[0];
    if (primero !== undefined) argminIngenuo.push(primero);
  }
  assert.ok(planIncumpleDuras(argminIngenuo));

  const res = ensamblar(pool, porDia, SEMILLA, null, 1);
  assert.equal(res.dias.length, 3);
  assert.ok(!planIncumpleDuras(res.dias), "el plan devuelto rompe una restricción dura");
});

test("un día vacío no rompe la cadena de días consecutivos", () => {
  // Comportamiento de borde del original: el día sin candidatos se salta SIN
  // actualizar el «previo», así que la regla de «lo mismo que ayer» compara los
  // dos días no vacíos que rodean el hueco. Aquí el día 0 y el día 2 querrían
  // los dos la receta 1 en la comida; con el hueco en medio, eso sigue siendo
  // «dos días seguidos».
  const pool = poolFalso(10);
  const porDia: CandidatoDia[][] = [
    [candidato([1], [COMIDA], 0.01, [0, 1]), candidato([5], [COMIDA], 0.09, [0, 1])],
    [],
    [candidato([1], [COMIDA], 0.01, [0, 1]), candidato([6], [COMIDA], 0.05, [0, 1])],
  ];
  const res = ensamblar(pool, porDia, SEMILLA, null, 1);
  assert.equal(res.diasSinCandidato, 1);
  assert.equal(res.dias.length, 2, "los días vacíos se omiten, no se rellenan");
  assert.deepEqual(
    res.dias.map((c) => c.filas[0]),
    [1, 6],
  );
});

test("sin ningún día con candidatos se devuelve el vacío y no se toca nada", () => {
  const pool = poolFalso(10);
  const res = ensamblar(pool, [[], [], []], SEMILLA, null, 1);
  assert.deepEqual(res, {
    dias: [],
    costeInicial: 0.0,
    costeFinal: 0.0,
    diasSinCandidato: 3,
  });
});

// ---------------------------------------------------------------------------
// Consumo de aleatoriedad: el invariante frágil
// ---------------------------------------------------------------------------

test("el recocido consume exactamente los sorteos del flujo de Python", () => {
  // Escenario con Δ EXACTAMENTE 0 en todos los movimientos: los dos candidatos
  // del día 0 tienen el mismo error, los mismos ingredientes y el mismo coste,
  // así que el `or` nunca cortocircuita y el `random()` se consume SIEMPRE que
  // se propone un cambio real. El día 1 tiene un solo candidato, así que su
  // `integers(len)` no se llega a extraer nunca.
  const pool = poolFalso(10);
  const porDia: CandidatoDia[][] = [
    [candidato([1], [COMIDA], 0.02, [0, 1, 2]), candidato([2], [COMIDA], 0.02, [0, 1, 2])],
    [candidato([3], [COMIDA], 0.02, [0, 1, 2])],
  ];

  const rng = rngDe(SEMILLA, RUTA_D);
  const res = ensamblar(pool, porDia, SEMILLA, null, 1, rng);
  const consumidos = contadorDeSorteos(rng);

  // Réplica del consumo, no de la decisión: con Δ = 0 la aceptación es segura
  // (`random()` está en [0, 1) y exp(0) es 1), así que el estado sólo depende
  // de los enteros sorteados.
  const espejo = rngDe(SEMILLA, RUTA_D);
  let k = 0;
  let esperados = 0;
  for (let it = 0; it < SA_ITERACIONES; it++) {
    const d = espejo.integers(2);
    esperados++;
    if (d === 0) {
      const kNuevo = espejo.integers(2);
      esperados++;
      if (kNuevo !== k) {
        espejo.random();
        esperados++;
        k = kNuevo;
      }
    }
  }

  assert.equal(consumidos, esperados);
  // Las dos cotas que hacen que el número signifique algo: si el `integers` del
  // candidato o el `random()` de Metropolis se extrajeran incondicionalmente,
  // el contador se iría a 3·400.
  assert.ok(consumidos > SA_ITERACIONES, "el bucle extrae al menos un entero por iteración");
  assert.ok(consumidos < 3 * SA_ITERACIONES, "no se extrae todo incondicionalmente");
  assert.equal(res.costeFinal, res.costeInicial);
});

test("el random() de Metropolis no se consume cuando delta es negativo", () => {
  // El día 0 arranca en un estado INFACTIBLE (la receta 2 choca con el día 1 en
  // el mismo slot), porque el voraz ordena por error y cede cuando ningún
  // candidato es factible. El primer movimiento sale de ahí: menos
  // ingredientes únicos y sin repetición, así que Δ < 0 y se acepta sin tocar
  // el uniforme. A partir de ese momento cualquier vuelta atrás la rechaza
  // `violaDura`, también antes del `random()`.
  const pool = poolFalso(10);
  const porDia: CandidatoDia[][] = [
    [
      candidato([2], [COMIDA], 0.019, [6, 7, 8, 9, 10, 11]),
      candidato([1], [COMIDA], 0.02, [0, 1, 2]),
    ],
    [candidato([2], [COMIDA], 0.01, [0, 1, 2, 3, 4, 5])],
  ];

  const rng = rngDe(SEMILLA, RUTA_D);
  const res = ensamblar(pool, porDia, SEMILLA, null, 1, rng);

  const espejo = rngDe(SEMILLA, RUTA_D);
  let esperados = 0;
  for (let it = 0; it < SA_ITERACIONES; it++) {
    if (espejo.integers(2) === 0) {
      espejo.integers(2);
      esperados++;
    }
    esperados++;
  }

  assert.equal(contadorDeSorteos(rng), esperados, "se ha consumido algún uniforme de más");
  assert.ok(res.costeFinal < res.costeInicial, "el movimiento de Δ < 0 no se llegó a aceptar");
  assert.deepEqual(
    res.dias.map((c) => c.filas[0]),
    [1, 2],
  );
});

test("un movimiento que viola una dura se rechaza antes de mirar el coste", () => {
  // Aquí el único movimiento posible del día 0 lleva a la receta 2, que el día
  // 1 ya sirve en el mismo slot. `violaDura` corta antes del contador de
  // ingredientes y antes del `random()`: el flujo se queda en dos enteros.
  const pool = poolFalso(10);
  const porDia: CandidatoDia[][] = [
    [candidato([1], [COMIDA], 0.01, [0, 1]), candidato([2], [COMIDA], 0.02, [2, 3])],
    [candidato([2], [COMIDA], 0.01, [0, 1])],
  ];

  const rng = rngDe(SEMILLA, RUTA_D);
  const res = ensamblar(pool, porDia, SEMILLA, null, 1, rng);

  const espejo = rngDe(SEMILLA, RUTA_D);
  let esperados = 0;
  for (let it = 0; it < SA_ITERACIONES; it++) {
    if (espejo.integers(2) === 0) {
      espejo.integers(2);
      esperados++;
    }
    esperados++;
  }

  assert.equal(contadorDeSorteos(rng), esperados);
  assert.equal(res.costeFinal, res.costeInicial);
  assert.deepEqual(
    res.dias.map((c) => c.filas[0]),
    [1, 2],
  );
});

test("con un solo día, o con un candidato por día, el recocido ni se ejecuta", () => {
  // El generador de RUTA_D no llega a crearse. Se comprueba por su efecto
  // observable: un rng inyectado sale con cero sorteos consumidos.
  const pool = poolFalso(10);
  const unDia: CandidatoDia[][] = [
    [candidato([1], [COMIDA], 0.02, [0]), candidato([2], [COMIDA], 0.01, [1])],
  ];
  const rngUno = rngDe(SEMILLA, RUTA_D);
  ensamblar(pool, unDia, SEMILLA, null, 1, rngUno);
  assert.equal(contadorDeSorteos(rngUno), 0);

  const sinAlternativas: CandidatoDia[][] = [
    [candidato([1], [COMIDA], 0.02, [0])],
    [candidato([2], [COMIDA], 0.01, [1])],
  ];
  const rngDos = rngDe(SEMILLA, RUTA_D);
  ensamblar(pool, sinAlternativas, SEMILLA, null, 1, rngDos);
  assert.equal(contadorDeSorteos(rngDos), 0);
});

// ---------------------------------------------------------------------------
// Determinismo
// ---------------------------------------------------------------------------

test("misma semilla, mismo ensamblado: 50 ejecuciones idénticas", () => {
  // Los candidatos se reconstruyen en cada vuelta para que el test no pueda
  // pasar por reutilizar los mismos objetos: si el resultado dependiera del
  // orden de iteración de algún Map o de una identidad de objeto, se vería.
  const pool = poolFalso(40);
  const construir = (): CandidatoDia[][] => {
    const gen = rngDe(7n, 97);
    const porDia: CandidatoDia[][] = [];
    for (let d = 0; d < 7; d++) {
      const cands: CandidatoDia[] = [];
      for (let k = 0; k < K_CANDIDATOS_DIA; k++) {
        cands.push(
          candidato(
            [gen.integers(12), 12 + gen.integers(12), 24 + gen.integers(12)],
            ["desayuno", COMIDA, "cena"],
            0.01 + gen.integers(80) / 1000,
            [gen.integers(8), 8 + gen.integers(8), 16 + gen.integers(8)],
          ),
        );
      }
      porDia.push(cands);
    }
    return porDia;
  };

  const referencia = ensamblar(pool, construir(), SEMILLA, 12000, 2);
  const huella = (r: ReturnType<typeof ensamblar>): string =>
    `${r.dias.map((c) => c.clave).join("|")}#${r.costeInicial}#${r.costeFinal}#${r.diasSinCandidato}`;
  for (let i = 0; i < 50; i++) {
    assert.equal(huella(ensamblar(pool, construir(), SEMILLA, 12000, 2)), huella(referencia));
  }
});

test("semillas distintas exploran combinaciones distintas", () => {
  // Contraprueba del test anterior: si el recocido fuera insensible a la
  // semilla, el determinismo sería trivial y no probaría nada.
  const pool = poolFalso(40);
  const gen = rngDe(11n, 96);
  const porDia: CandidatoDia[][] = [];
  for (let d = 0; d < 7; d++) {
    const cands: CandidatoDia[] = [];
    for (let k = 0; k < K_CANDIDATOS_DIA; k++) {
      cands.push(
        candidato(
          [gen.integers(12), 12 + gen.integers(12)],
          [COMIDA, "cena"],
          0.01 + gen.integers(80) / 1000,
          [gen.integers(8), 8 + gen.integers(8), 16 + gen.integers(8)],
        ),
      );
    }
    porDia.push(cands);
  }
  const claves = new Set<string>();
  for (let s = 0; s < 12; s++) {
    claves.add(ensamblar(pool, porDia, BigInt(s), null, 1).dias.map((c) => c.clave).join("|"));
  }
  assert.ok(claves.size > 1, "todas las semillas dan el mismo plan: el flujo de RUTA_D no se usa");
});

// ---------------------------------------------------------------------------
// Integración: catálogo real, pool real, etapa C real
// ---------------------------------------------------------------------------

const AQUI = dirname(fileURLToPath(import.meta.url));
const CAT = cargarCatalogo(
  JSON.parse(
    readFileSync(resolve(AQUI, "../datos/catalogo-compilado.json"), "utf8"),
  ) as CatalogoSerializado,
);

const SLOTS_PEDIDOS: SlotComida[] = ["desayuno", "comida", "cena"];
const RESTR: RestriccionesGeneracion = {
  dieta: "omnivora",
  alergenosExcluidos: [],
  ingredientesExcluidos: [],
  slots: SLOTS_PEDIDOS,
  comensales: 1,
};

function objetivos(nDias: number): ObjetivoNutricional[] {
  const uno: ObjetivoNutricional = {
    kcal: 2100,
    toleranciaKcal: 0.05,
    proteinaG: { min: 105, max: 160 },
    carbohidratoG: { min: 210, max: 290 },
    grasaG: { min: 55, max: 85 },
    fibraMinG: 25,
    sodioMaxMg: 2300,
  };
  return Array.from({ length: nDias }, () => uno);
}

function semanaReal(seed: bigint, nDias = 7) {
  const pool = construirPool(CAT, RESTR);
  const ctx = contextoDe(CAT, pool, RESTR, nDias, temperatura(VARIEDAD_POR_DEFECTO));
  const objs = objetivos(nDias);
  const cerrados: number[] = [];
  const mejores: CandidatoDia[] = [];
  const { porDia, duplicados } = generarCandidatos(
    pool,
    ctx,
    objs,
    SLOTS_PEDIDOS,
    seed,
    resolverPorcionesRejilla,
    (dia, mejor) => {
      cerrados.push(dia);
      mejores.push(mejor);
    },
  );
  return { pool, ctx, objs, porDia, duplicados, cerrados, mejores };
}

test("generarCandidatos produce hasta K candidatos por día, todos distintos", () => {
  const { porDia } = semanaReal(SEMILLA);
  assert.equal(porDia.length, 7, "un hueco por día, incluso si se queda vacío");
  for (const [d, cands] of porDia.entries()) {
    assert.ok(cands.length > 0, `el día ${d} se quedó sin candidatos`);
    assert.ok(cands.length <= K_CANDIDATOS_DIA, `el día ${d} devolvió ${cands.length} candidatos`);
    const claves = new Set(cands.map((c) => c.clave));
    assert.equal(claves.size, cands.length, `el día ${d} tiene candidatos duplicados`);
  }
});

test("el gancho alCerrarDia se llama una vez por día, en orden, con el de menor error", () => {
  // Es lo que hace honesta la barra de progreso: si se llamara al empezar el
  // día, o con el candidato equivocado, la UI escribiría títulos de un plan que
  // todavía no está decidido.
  const { porDia, cerrados, mejores } = semanaReal(SEMILLA);
  assert.deepEqual(cerrados, [0, 1, 2, 3, 4, 5, 6]);
  for (const [d, mejor] of mejores.entries()) {
    const cands = porDia[d] ?? [];
    const minimo = Math.min(...cands.map((c) => c.error));
    assert.equal(mejor.error, minimo, `el día ${d} no se cerró con su mejor candidato`);
  }
});

test("el contexto se muta entre días: solape acumulado y veto del día anterior", () => {
  // El acoplamiento consciente de §5.5. Si alguien paraleliza los días o
  // convierte el contexto en inmutable, `vetoSlot` deja de ser el de ayer y el
  // solape se queda congelado en ceros: el plan sale igual de válido y con la
  // lista de la compra el doble de larga.
  const { ctx, mejores, pool } = semanaReal(SEMILLA);
  const ultimo = mejores[mejores.length - 1];
  assert.ok(ultimo !== undefined);
  for (const [pos, slot] of ultimo.slots.entries()) {
    assert.equal(ctx.vetoSlot.get(slot), ultimo.filas[pos]);
  }
  let alimentos = 0;
  for (let w = 0; w < pool.w32; w++) {
    let v = ctx.bitsSemana[w] ?? 0;
    while (v !== 0) {
      alimentos++;
      v = (v & (v - 1)) >>> 0;
    }
  }
  assert.ok(alimentos > 0, "bitsSemana se quedó a cero: nadie acumuló los días cerrados");
});

test("la semana entera respeta el tope de dos usos por receta", () => {
  // El invariante de producto de la etapa D, comprobado sobre el camino
  // completo: candidatos → recocido → reparación de duras. Tres semillas, para
  // que no pase por casualidad.
  for (const seed of [SEMILLA, 1n, 987654321n]) {
    const { pool, ctx, objs, porDia } = semanaReal(seed);
    const res = ensamblar(pool, porDia, seed, null, 1);
    assert.equal(res.dias.length, 7);
    const { dias, arreglados } = repararDuras(
      pool,
      ctx,
      objs,
      [...res.dias],
      resolverPorcionesRejilla,
    );
    assert.ok(arreglados >= 0);
    const usos = new Map<number, number>();
    for (const dia of dias) {
      for (const fila of dia.filas) usos.set(fila, (usos.get(fila) ?? 0) + 1);
    }
    for (const [fila, u] of usos) {
      assert.ok(
        u <= MAX_USOS_RECETA_SEMANA,
        `semilla ${seed}: la receta ${pool.ids[fila] ?? fila} sale ${u} veces`,
      );
    }
  }
});

test("repararDuras rehace el porcionado del día que toca y deja los demás intactos", () => {
  // El día sustituido tiene que volver a pasar por la etapa B: devolver los
  // totales viejos con la receta nueva es exactamente el tipo de mentira que el
  // resto del motor evita, y la suma de la UI dejaría de cuadrar.
  const { pool, ctx, objs, porDia } = semanaReal(SEMILLA);
  const res = ensamblar(pool, porDia, SEMILLA, null, 1);
  const antes = [...res.dias];
  const { dias, arreglados } = repararDuras(pool, ctx, objs, [...antes], resolverPorcionesRejilla);
  let cambiados = 0;
  for (const [d, dia] of dias.entries()) {
    if (dia !== antes[d]) cambiados++;
  }
  assert.ok(cambiados <= arreglados, "se han recompuesto más días que items arreglados");
  for (const dia of dias) {
    // Invariante de la etapa B que la reparación no puede romper: los totales
    // son A·σ de las recetas que el día lleva de verdad.
    const totales = new Float64Array(6);
    for (const [pos, fila] of dia.filas.entries()) {
      const s = dia.sigma[pos] ?? 0;
      for (let n = 0; n < 6; n++) {
        totales[n] = (totales[n] ?? 0) + s * (pool.nutr[fila * 6 + n] ?? 0);
      }
    }
    for (let n = 0; n < 6; n++) {
      assert.ok(Math.abs((totales[n] ?? 0) - (dia.totales[n] ?? 0)) < 1e-9);
    }
  }
});

test("repararDuras es determinista y no consume aleatoriedad", () => {
  // `mejorAlternativa` es un argmax con desempate por id: dos ejecuciones
  // idénticas tienen que dar el mismo plan, y ninguna semilla puede influir.
  const { pool, ctx, objs, porDia } = semanaReal(SEMILLA);
  const res = ensamblar(pool, porDia, SEMILLA, null, 1);
  const huella = (ds: readonly CandidatoDia[]): string => ds.map((c) => c.clave).join("|");
  const a = repararDuras(pool, ctx, objs, [...res.dias], resolverPorcionesRejilla);
  const b = repararDuras(pool, ctx, objs, [...res.dias], resolverPorcionesRejilla);
  assert.equal(huella(a.dias), huella(b.dias));
  assert.equal(a.arreglados, b.arreglados);
});

test("el par (slot, receta) es lo que se compara, no la receta suelta", () => {
  // La misma receta en slots distintos dos días seguidos es LEGAL: prohibirlo
  // recortaría el espacio de planes sin que nadie lo haya pedido. El escenario
  // sólo tiene esa opción, así que si el port compara filas sueltas se queda sin
  // estados factibles y el voraz cede.
  const pool = poolFalso(10);
  const porDia: CandidatoDia[][] = [
    [candidato([1], [COMIDA], 0.01, [0, 1])],
    [candidato([1], ["cena"], 0.01, [0, 1])],
  ];
  const res = ensamblar(pool, porDia, SEMILLA, null, 1);
  assert.equal(res.dias.length, 2);
  assert.ok(!planIncumpleDuras(res.dias));
});

test("el exceso de presupuesto entra en el coste y sólo si hay presupuesto", () => {
  // μ = 0,30 sobre el exceso RELATIVO, multiplicado por comensales. Sin
  // presupuesto (null o ≤ 0) el término se apaga entero, que es lo que hace que
  // un usuario sin presupuesto no vea planes sesgados hacia lo barato.
  const pool = poolFalso(10);
  pool.costeCents[1] = 900;
  pool.costeCents[2] = 100;
  const porDia: CandidatoDia[][] = [
    [candidato([1], [COMIDA], 0.01, [0]), candidato([2], [COMIDA], 0.02, [0])],
    [candidato([3], [COMIDA], 0.01, [0])],
  ];
  const sinPresupuesto = ensamblar(pool, porDia, SEMILLA, null, 1);
  const conPresupuesto = ensamblar(pool, porDia, SEMILLA, 200, 1);
  assert.equal(sinPresupuesto.dias[0]?.filas[0], 1, "sin presupuesto manda el error");
  assert.equal(conPresupuesto.dias[0]?.filas[0], 2, "con presupuesto, 900 céntimos no compensan");
  assert.ok(conPresupuesto.costeFinal > sinPresupuesto.costeFinal);
});

test("el orden de los slots del catálogo es el que codifica los pares", () => {
  // Guarda del andamio: si IDX_SLOT dejara de tener los cinco slots, la
  // codificación IDX_SLOT[slot]·P + fila de `violaDura` colisionaría en
  // silencio y dos pares distintos pasarían por el mismo.
  assert.equal(new Set(Object.values(IDX_SLOT)).size, Object.keys(IDX_SLOT).length);
});
