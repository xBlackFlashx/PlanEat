/**
 * Árbol de generadores. DISENO §2.6.
 *
 * Lo que se prueba aquí NO es la secuencia de bits —eso es una decisión de
 * implementación y está declarado como divergencia consciente respecto a numpy
 * en docs/port-typescript.md— sino las cuatro propiedades de las que depende
 * que un plan se pueda volver a construir cuando un usuario escribe diciendo
 * que su martes estaba mal:
 *
 *   1. Mismo (seed, ruta) → mismo flujo, siempre.
 *   2. Nodos distintos → flujos independientes, y el flujo de un nodo no
 *      depende de cuántos números consuman los demás. Es la razón de ser del
 *      árbol, no un detalle.
 *   3. Las distribuciones son las que se anuncian (uniformes, y categórica
 *      según p), porque el softmax de la etapa A no significa nada si no.
 *   4. Una semilla sobrevive al viaje a texto y de vuelta sin perder bits.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  contadorDeSorteos,
  rngDe,
  semillaATexto,
  semillaAleatoria,
  semillaDesdeTexto,
  type Rng,
} from '../src/rng.ts';

const SEED = 4611686018427387903n; // 2^62 − 1: por encima de 2^53, a propósito

function flujo(r: Rng, n: number): number[] {
  const salida: number[] = [];
  for (let i = 0; i < n; i += 1) salida.push(r.random());
  return salida;
}

/** χ² de Pearson sobre frecuencias observadas frente a esperadas. */
function chiCuadrado(observadas: number[], esperadas: number[]): number {
  let acc = 0;
  for (let i = 0; i < observadas.length; i += 1) {
    const e = esperadas[i] ?? 0;
    const o = observadas[i] ?? 0;
    acc += ((o - e) * (o - e)) / e;
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Reproducibilidad
// ---------------------------------------------------------------------------

test('el mismo seed y la misma ruta dan exactamente el mismo flujo', () => {
  const a = flujo(rngDe(SEED, 0, 3, 5, 1, 2), 500);
  const b = flujo(rngDe(SEED, 0, 3, 5, 1, 2), 500);
  assert.deepEqual(a, b);
});

test('el mismo seed y la misma ruta dan el mismo flujo mezclando los tres métodos', () => {
  const p = Float64Array.from([0.1, 0.2, 0.3, 0.4]);
  const traza = (r: Rng): string =>
    [r.integers(7), r.random(), r.choice(4, p), r.integers(12), r.random()].join('|');
  assert.equal(traza(rngDe(SEED, 1)), traza(rngDe(SEED, 1)));
});

test('cambiar el seed cambia el flujo aunque la ruta sea la misma', () => {
  const a = flujo(rngDe(SEED, 0, 1), 8);
  const b = flujo(rngDe(SEED + 1n, 0, 1), 8);
  assert.notDeepEqual(a, b);
});

// ---------------------------------------------------------------------------
// Independencia estructural: la propiedad que justifica el árbol
// ---------------------------------------------------------------------------

test('el flujo de un nodo no depende de cuántos números consuman los demás', () => {
  // Es literalmente el caso que rompe un generador secuencial compartido: un
  // día gasta más sorteos (un reintento más, un slot más) y todos los días
  // siguientes se desplazan. Aquí el nodo (0,2,0,0,1) tiene que dar lo mismo
  // haya consumido lo que haya consumido cualquier otro nodo.
  const referencia = flujo(rngDe(SEED, 0, 2, 0, 0, 1), 20);

  const vecino = rngDe(SEED, 0, 1, 0, 0, 1);
  for (let i = 0; i < 10_000; i += 1) vecino.random();
  const despues = flujo(rngDe(SEED, 0, 2, 0, 0, 1), 20);

  assert.deepEqual(despues, referencia);
});

test('rutas distintas producen flujos distintos', () => {
  const vistos = new Set<string>();
  for (let dia = 0; dia < 7; dia += 1) {
    for (let k = 0; k < 12; k += 1) {
      for (let intento = 0; intento < 4; intento += 1) {
        for (let slot = 0; slot < 5; slot += 1) {
          vistos.add(flujo(rngDe(SEED, 0, dia, k, intento, slot), 2).join('|'));
        }
      }
    }
  }
  assert.equal(vistos.size, 7 * 12 * 4 * 5);
});

test('la ruta es sensible al orden y a la longitud', () => {
  // Un xor plano de los componentes colisionaría en las tres: (1,2) y (2,1)
  // son nodos distintos del árbol, y (1,2) y (1,2,0) también. La colisión no
  // fallaría de forma visible, sólo haría que dos etapas compartieran flujo.
  const a = flujo(rngDe(SEED, 1, 2), 4).join('|');
  const b = flujo(rngDe(SEED, 2, 1), 4).join('|');
  const c = flujo(rngDe(SEED, 1, 2, 0), 4).join('|');
  const d = flujo(rngDe(SEED), 4).join('|');
  assert.equal(new Set([a, b, c, d]).size, 4);
});

test('las rutas del recocido y de la etapa A no comparten flujo', () => {
  // RUTA_A = 0, RUTA_D = 1. La etapa D es un único flujo secuencial y la A un
  // nodo por slot; si colisionaran, el recocido leería la cola de un slot.
  const etapaA = flujo(rngDe(SEED, 0, 0, 0, 0, 0), 50);
  const etapaD = flujo(rngDe(SEED, 1), 50);
  assert.equal(etapaA.filter((x) => etapaD.includes(x)).length, 0);
});

// ---------------------------------------------------------------------------
// Distribuciones
// ---------------------------------------------------------------------------

test('random cae siempre en [0, 1)', () => {
  const r = rngDe(SEED, 0);
  for (let i = 0; i < 200_000; i += 1) {
    const x = r.random();
    assert.ok(x >= 0 && x < 1, `random() fuera de rango: ${x}`);
  }
});

test('random es razonablemente uniforme (chi-cuadrado sobre 32 cajas)', () => {
  const CAJAS = 32;
  const N = 320_000;
  const cajas = new Array<number>(CAJAS).fill(0);
  const r = rngDe(SEED, 0, 9);
  for (let i = 0; i < N; i += 1) {
    const c = Math.floor(r.random() * CAJAS);
    cajas[c] = (cajas[c] ?? 0) + 1;
  }
  // 31 grados de libertad: el valor crítico al 99,9 % es ≈ 61,1. El umbral es
  // flojo a propósito —esto detecta un generador roto, no certifica calidad—
  // y el test es determinista, así que no puede fallar de forma intermitente.
  const chi = chiCuadrado(cajas, new Array<number>(CAJAS).fill(N / CAJAS));
  assert.ok(chi < 70, `chi-cuadrado demasiado alto: ${chi}`);
});

test('random usa los 53 bits de mantisa y no una rejilla más basta', () => {
  // Si `random()` se hubiera construido con 32 bits, los valores caerían en
  // múltiplos de 2^-32 y este contador se quedaría muy corto.
  const r = rngDe(SEED, 0, 7);
  let finos = 0;
  for (let i = 0; i < 1000; i += 1) {
    const x = r.random() * 2 ** 32;
    if (x !== Math.floor(x)) finos += 1;
  }
  assert.ok(finos > 990, `demasiados valores en la rejilla de 32 bits: ${1000 - finos}`);
});

test('integers se queda dentro de [0, n) para todos los n del motor', () => {
  // n real: días de la semana (≤7) y candidatos por día (≤12).
  for (let n = 1; n <= 13; n += 1) {
    const r = rngDe(SEED, 1, n);
    for (let i = 0; i < 5_000; i += 1) {
      const v = r.integers(n);
      assert.ok(Number.isInteger(v) && v >= 0 && v < n, `integers(${n}) devolvió ${v}`);
    }
  }
});

test('integers es uniforme incluso cuando n no es potencia de dos', () => {
  // n = 7 es el caso real del recocido con una semana completa, y es el que
  // ejercita el rechazo: la máscara cubre [0,8) y descarta el 12,5 %.
  const N = 140_000;
  const cajas = new Array<number>(7).fill(0);
  const r = rngDe(SEED, 1, 77);
  for (let i = 0; i < N; i += 1) {
    const v = r.integers(7);
    cajas[v] = (cajas[v] ?? 0) + 1;
  }
  // 6 grados de libertad: crítico al 99,9 % ≈ 22,5.
  const chi = chiCuadrado(cajas, new Array<number>(7).fill(N / 7));
  assert.ok(chi < 30, `chi-cuadrado demasiado alto: ${chi}`);
});

test('integers rechaza los n que no son enteros de [1, 2^32]', () => {
  const r = rngDe(SEED, 1);
  assert.throws(() => r.integers(0), RangeError);
  assert.throws(() => r.integers(-3), RangeError);
  assert.throws(() => r.integers(2.5), RangeError);
  assert.throws(() => r.integers(Number.NaN), RangeError);
  assert.throws(() => r.integers(2 ** 32 + 1), RangeError);
});

test('choice respeta las probabilidades que se le pasan', () => {
  const p = Float64Array.from([0.5, 0.3, 0.15, 0.05]);
  const N = 200_000;
  const cajas = new Array<number>(4).fill(0);
  const r = rngDe(SEED, 0, 4);
  for (let i = 0; i < N; i += 1) {
    const j = r.choice(4, p);
    cajas[j] = (cajas[j] ?? 0) + 1;
  }
  // 3 grados de libertad: crítico al 99,9 % ≈ 16,3.
  const chi = chiCuadrado(cajas, [N * 0.5, N * 0.3, N * 0.15, N * 0.05]);
  assert.ok(chi < 25, `chi-cuadrado demasiado alto: ${chi}`);
});

test('choice nunca devuelve una opción de probabilidad cero', () => {
  // El softmax de `muestrear` produce ceros por desbordamiento cuando tau es
  // pequeña. Devolver una de esas recetas sería elegir algo que el score había
  // descartado.
  const p = Float64Array.from([0, 0.4, 0, 0.6, 0]);
  const r = rngDe(SEED, 0, 5);
  for (let i = 0; i < 20_000; i += 1) {
    const j = r.choice(5, p);
    assert.ok(j === 1 || j === 3, `choice devolvió la opción imposible ${j}`);
  }
});

test('choice es robusta a que p no sume 1', () => {
  // La acumulada se normaliza por su último elemento, así que escalar p entera
  // no puede cambiar nada. Es el caso real: `p /= p.sum()` en float64 deja un
  // residuo del orden de 1e-16.
  const base = [0.1, 0.25, 0.3, 0.35];
  const normal = Float64Array.from(base);
  const escalada = Float64Array.from(base.map((x) => x * 1000));
  const desviada = Float64Array.from(base.map((x, i) => x + (i === 0 ? 1e-16 : 0)));
  for (let i = 0; i < 500; i += 1) {
    const esperado = rngDe(SEED, 0, 6, i).choice(4, normal);
    assert.equal(rngDe(SEED, 0, 6, i).choice(4, escalada), esperado);
    assert.equal(rngDe(SEED, 0, 6, i).choice(4, desviada), esperado);
  }
});

test('choice con p degenerada reparte en rango en vez de reventar el plan', () => {
  const r = rngDe(SEED, 0, 8);
  const ceros = new Float64Array(5);
  for (let i = 0; i < 1_000; i += 1) {
    const j = r.choice(5, ceros);
    assert.ok(Number.isInteger(j) && j >= 0 && j < 5, `choice devolvió ${j}`);
  }
});

test('choice exige tantos pesos como opciones', () => {
  const r = rngDe(SEED, 0);
  assert.throws(() => r.choice(4, Float64Array.from([1, 1])), RangeError);
  assert.throws(() => r.choice(0, new Float64Array(0)), RangeError);
});

test('choice funciona con n mayor que el buffer inicial de la acumulada', () => {
  const n = 500;
  const p = new Float64Array(n).fill(1 / n);
  const r = rngDe(SEED, 0, 10);
  for (let i = 0; i < 2_000; i += 1) {
    const j = r.choice(n, p);
    assert.ok(j >= 0 && j < n, `choice(${n}) devolvió ${j}`);
  }
});

// ---------------------------------------------------------------------------
// Modelo de consumo
// ---------------------------------------------------------------------------

test('cada llamada a random, integers o choice consume exactamente un sorteo', () => {
  const r = rngDe(SEED, 0);
  assert.equal(contadorDeSorteos(r), 0);
  r.random();
  assert.equal(contadorDeSorteos(r), 1);
  r.integers(7);
  assert.equal(contadorDeSorteos(r), 2);
  r.choice(3, Float64Array.from([0.2, 0.5, 0.3]));
  assert.equal(contadorDeSorteos(r), 3);
});

test('integers(1) devuelve 0 sin consumir sorteo ni mover el flujo', () => {
  // Consumir aquí desincronizaría la etapa D respecto a un flujo que no ha
  // tomado ninguna decisión: con una sola opción no hay nada que sortear.
  const r = rngDe(SEED, 1);
  assert.equal(r.integers(1), 0);
  assert.equal(contadorDeSorteos(r), 0);
  assert.equal(r.random(), rngDe(SEED, 1).random());
});

test('un generador recién creado no ha tocado su flujo', () => {
  assert.equal(contadorDeSorteos(rngDe(SEED, 0, 1, 2, 3, 4)), 0);
});

test('contadorDeSorteos rechaza lo que no venga de rngDe', () => {
  const impostor: Rng = { random: () => 0, integers: () => 0, choice: () => 0 };
  assert.throws(() => contadorDeSorteos(impostor), TypeError);
});

// ---------------------------------------------------------------------------
// Semillas
// ---------------------------------------------------------------------------

test('el round-trip semilla → texto → semilla no pierde bits', () => {
  const casos = [
    0n,
    1n,
    9007199254740991n, // 2^53 − 1: el último que un Number representa
    9007199254740993n, // 2^53 + 1: el primero que un Number ya redondea
    4611686018427387903n,
    9223372036854775807n, // 2^63 − 1
  ];
  for (const seed of casos) {
    assert.equal(semillaDesdeTexto(semillaATexto(seed)), seed);
  }
  for (let i = 0; i < 200; i += 1) {
    const seed = semillaAleatoria();
    assert.equal(semillaDesdeTexto(semillaATexto(seed)), seed);
  }
});

test('el round-trip por Number sí perdería bits, y por eso el contrato es texto', () => {
  // Este test documenta el bug del que se defiende toda la disciplina: si
  // alguien tipa `seed` como number en cualquier punto del monorepo, el plan
  // guardado deja de reproducirse y no falla nada visiblemente.
  const seed = 9007199254740993n;
  assert.notEqual(BigInt(Number(seed)), seed);
  assert.equal(semillaDesdeTexto(semillaATexto(seed)), seed);
});

test('la semilla del round-trip genera el mismo flujo que la original', () => {
  const seed = semillaAleatoria();
  const recuperada = semillaDesdeTexto(semillaATexto(seed));
  assert.deepEqual(flujo(rngDe(recuperada, 0, 1, 2), 32), flujo(rngDe(seed, 0, 1, 2), 32));
});

test('semillaDesdeTexto lanza con cualquier cosa que no sea un entero decimal', () => {
  const basura = [
    '',
    ' ',
    '12 ',
    ' 12',
    '-1',
    '+1',
    '1.0',
    '1e3',
    '0x10',
    'abc',
    '1_000',
    '١٢٣', // dígitos árabo-índicos: BigInt() los aceptaría, el contrato no
  ];
  for (const s of basura) {
    assert.throws(() => semillaDesdeTexto(s), `debería lanzar con «${s}»`);
  }
});

test('semillaDesdeTexto lanza si la semilla se sale de [0, 2^63)', () => {
  assert.throws(() => semillaDesdeTexto('9223372036854775808')); // 2^63
  assert.throws(() => semillaDesdeTexto('18446744073709551616')); // 2^64
  assert.equal(semillaDesdeTexto('9223372036854775807'), (1n << 63n) - 1n);
});

test('semillaATexto lanza si la semilla se sale de rango', () => {
  assert.throws(() => semillaATexto(-1n), RangeError);
  assert.throws(() => semillaATexto(1n << 63n), RangeError);
});

test('semillaAleatoria da 63 bits y no repite', () => {
  const vistas = new Set<bigint>();
  for (let i = 0; i < 2_000; i += 1) {
    const seed = semillaAleatoria();
    assert.ok(seed >= 0n && seed < 1n << 63n, `semilla fuera de rango: ${seed}`);
    vistas.add(seed);
  }
  assert.equal(vistas.size, 2_000);
});

test('rngDe rechaza semillas y rutas fuera de rango', () => {
  assert.throws(() => rngDe(-1n), RangeError);
  assert.throws(() => rngDe(1n << 63n), RangeError);
  assert.throws(() => rngDe(SEED, -1), RangeError);
  assert.throws(() => rngDe(SEED, 1.5), RangeError);
  assert.throws(() => rngDe(SEED, 2 ** 32), RangeError);
});
