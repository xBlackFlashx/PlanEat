/**
 * Pruebas de `numerico.ts`.
 *
 * Este fichero es la base de todo lo demás: un fallo aquí no se depura desde
 * arriba, se manifiesta como «el plan salió distinto» tres capas más allá. Por
 * eso hay un test por invariante y no un test por función, y por eso los
 * valores de referencia del redondeo, del formato y de la desviación típica
 * están copiados de una ejecución real de CPython + numpy, no derivados de la
 * propia implementación.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BITS_POR_PALABRA,
  andEnSitio,
  andNotEnSitio,
  argmaxEstable,
  argminEstable,
  argsortEstableDesc,
  bitsAIndices,
  clamp,
  clipEnSitio,
  comparaId,
  desviacionPoblacional,
  fmt0,
  matvec3,
  media,
  mediaUint8,
  normaL2,
  ordenarPorScoreEId,
  orEnSitio,
  popcount32,
  popcountAnd,
  popcountAndNot,
  popcountFila,
  productoPunto,
  redondeoMitadAPar,
  softmaxEstable,
  suma,
  umbralTopK,
} from '../src/numerico.ts';

// LCG determinista para los tests de fuerza bruta. No usa el RNG del motor a
// propósito: estos tests no deben depender de otro módulo del port.
function lcg(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

function popcountIngenuo(x: number): number {
  return ((x >>> 0).toString(2).match(/1/g) ?? []).length;
}

// ---------------------------------------------------------------------------
// Bitsets
// ---------------------------------------------------------------------------

test('popcount32 cuenta los bits de palabras conocidas', () => {
  assert.equal(popcount32(0), 0);
  assert.equal(popcount32(1), 1);
  assert.equal(popcount32(0b1011), 3);
  assert.equal(popcount32(0x55555555), 16);
  assert.equal(popcount32(0x0f0f0f0f), 16);
});

test('popcount32 no se rompe con el bit 31 puesto', () => {
  // El problema del signo en JS: 0x80000000 leído de un Uint32Array llega como
  // 2147483648, y los operadores bitwise lo ven como -2147483648.
  assert.equal(popcount32(0x80000000), 1);
  assert.equal(popcount32(0xffffffff), 32);
  assert.equal(popcount32(-1), 32);
  assert.equal(popcount32(1 << 31), 1);
  for (let b = 0; b < 32; b++) {
    assert.equal(popcount32((1 << b) >>> 0), 1, `bit ${b}`);
  }
});

test('popcount32 coincide con el recuento ingenuo sobre palabras arbitrarias', () => {
  const siguiente = lcg(20260815);
  for (let i = 0; i < 5000; i++) {
    const x = siguiente();
    assert.equal(popcount32(x), popcountIngenuo(x), `palabra ${x}`);
  }
});

test('popcountFila suma las palabras de una fila del bitset', () => {
  const w = 3;
  const bits = new Uint32Array([0, 0, 0, 0xffffffff, 0x80000001, 0b111]);
  assert.equal(popcountFila(bits, 0, w), 0);
  assert.equal(popcountFila(bits, w, w), 32 + 2 + 3);
});

test('popcountAnd y popcountAndNot parten la fila en intersección y diferencia', () => {
  const w = 4;
  const siguiente = lcg(7);
  const a = new Uint32Array(2 * w);
  const b = new Uint32Array(2 * w);
  for (let i = 0; i < 2 * w; i++) {
    a[i] = siguiente();
    b[i] = siguiente();
  }
  for (const [offA, offB] of [
    [0, 0],
    [0, w],
    [w, 0],
    [w, w],
  ] as const) {
    let inter = 0;
    let dif = 0;
    for (let k = 0; k < w; k++) {
      inter += popcountIngenuo((a[offA + k] ?? 0) & (b[offB + k] ?? 0));
      dif += popcountIngenuo((a[offA + k] ?? 0) & ~(b[offB + k] ?? 0));
    }
    assert.equal(popcountAnd(a, offA, b, offB, w), inter);
    assert.equal(popcountAndNot(a, offA, b, offB, w), dif);
    // Invariante que usa el término de despensa: lo que está y lo que no está
    // suman la fila entera.
    assert.equal(inter + dif, popcountFila(a, offA, w));
  }
});

test('orEnSitio, andEnSitio y andNotEnSitio respetan el bit 31', () => {
  const w = 2;
  const dst = new Uint32Array([0x80000000, 0x00000001, 0, 0]);
  const src = new Uint32Array([0, 0, 0xc0000000, 0x00000003]);

  orEnSitio(dst, 0, src, w, w);
  assert.deepEqual(Array.from(dst.subarray(0, w)), [0xc0000000, 0x00000003]);

  andEnSitio(dst, 0, src, w, w);
  assert.deepEqual(Array.from(dst.subarray(0, w)), [0xc0000000, 0x00000003]);

  andNotEnSitio(dst, 0, src, w, w);
  assert.deepEqual(Array.from(dst.subarray(0, w)), [0, 0]);
});

test('bitsAIndices devuelve los índices de alimento en orden ascendente', () => {
  const w = 2;
  const bits = new Uint32Array([0b1010, 0x80000001]);
  const salida = new Int32Array(64);
  const n = bitsAIndices(bits, 0, w, salida);
  assert.equal(n, 4);
  assert.deepEqual(Array.from(salida.subarray(0, n)), [
    1,
    3,
    BITS_POR_PALABRA + 0,
    BITS_POR_PALABRA + 31,
  ]);
});

test('bitsAIndices coincide con la enumeración ingenua sobre bitsets arbitrarios', () => {
  const w = 3;
  const siguiente = lcg(99);
  const bits = new Uint32Array(w);
  const salida = new Int32Array(w * BITS_POR_PALABRA);
  for (let caso = 0; caso < 500; caso++) {
    for (let k = 0; k < w; k++) bits[k] = siguiente();
    const esperado: number[] = [];
    for (let k = 0; k < w; k++) {
      for (let b = 0; b < 32; b++) {
        if ((((bits[k] ?? 0) >>> b) & 1) === 1) esperado.push(k * BITS_POR_PALABRA + b);
      }
    }
    const n = bitsAIndices(bits, 0, w, salida);
    assert.deepEqual(Array.from(salida.subarray(0, n)), esperado);
  }
});

test('bitsAIndices lanza si la salida se queda corta en vez de desbordar en silencio', () => {
  const bits = new Uint32Array([0xffffffff]);
  assert.throws(() => bitsAIndices(bits, 0, 1, new Int32Array(4)), /no cabe/);
});

// ---------------------------------------------------------------------------
// Redondeo bancario y formato
// ---------------------------------------------------------------------------

test('redondeoMitadAPar manda los empates al par, como np.round', () => {
  // Valores comprobados contra np.round en CPython.
  assert.equal(redondeoMitadAPar(0.5), 0);
  assert.equal(redondeoMitadAPar(1.5), 2);
  assert.equal(redondeoMitadAPar(2.5), 2);
  assert.equal(redondeoMitadAPar(3.5), 4);
  // −0,5 va al par, que es cero; el SIGNO de ese cero lo fija el test siguiente.
  assert.ok(redondeoMitadAPar(-0.5) === 0);
  assert.equal(redondeoMitadAPar(-1.5), -2);
  assert.equal(redondeoMitadAPar(-2.5), -2);
  assert.equal(redondeoMitadAPar(-3.5), -4);
});

test('redondeoMitadAPar conserva el cero negativo igual que numpy', () => {
  assert.ok(Object.is(redondeoMitadAPar(-0.5), -0));
  assert.ok(Object.is(redondeoMitadAPar(-0.2), -0));
  assert.ok(Object.is(redondeoMitadAPar(-0), -0));
  assert.ok(Object.is(redondeoMitadAPar(0.2), 0));
});

test('redondeoMitadAPar diverge de Math.round justo en los empates', () => {
  // Divergencia registrada en port-typescript.md: Math.round es
  // half-away-from-zero (hacia +infinito en los negativos) y np.round no.
  assert.notEqual(redondeoMitadAPar(2.5), Math.round(2.5));
  assert.notEqual(redondeoMitadAPar(0.5), Math.round(0.5));
  assert.notEqual(redondeoMitadAPar(-1.5), Math.round(-1.5));
  // Fuera de los empates coinciden. Se compara con === y no con assert.equal
  // porque este último distingue −0 de 0 y el signo del cero se comprueba
  // aparte: aquí lo que se fija es que la divergencia sea SÓLO la de los
  // empates, no una función distinta.
  const siguiente = lcg(3);
  for (let i = 0; i < 2000; i++) {
    const x = (siguiente() / 0xffffffff) * 200 - 100;
    assert.ok(redondeoMitadAPar(x) === Math.round(x), `x=${x}`);
  }
});

test('redondeoMitadAPar no redondea hacia arriba el doble justo por debajo de 0,5', () => {
  // El caso que rompe cualquier implementación con floor(x + 0.5).
  assert.equal(redondeoMitadAPar(0.49999999999999994), 0);
  assert.equal(redondeoMitadAPar(4503599627370497), 4503599627370497);
  assert.equal(redondeoMitadAPar(Infinity), Infinity);
  assert.ok(Number.isNaN(redondeoMitadAPar(NaN)));
});

test('fmt0 reproduce el formato :.0f de Python', () => {
  // Tabla volcada de CPython: f'{x:.0f}'.
  const casos: readonly (readonly [number, string])[] = [
    [0.5, '0'],
    [1.5, '2'],
    [2.5, '2'],
    [3.5, '4'],
    [-0.5, '-0'],
    [-1.5, '-2'],
    [-2.5, '-2'],
    [-3.5, '-4'],
    [-0.2, '-0'],
    [0.2, '0'],
    [2.675, '3'],
    [1234.5, '1234'],
    [1233.5, '1234'],
    [0, '0'],
    [-0, '-0'],
    [1e21, '1000000000000000000000'],
    [138.4, '138'],
    [137.5, '138'],
    [1200, '1200'],
  ];
  for (const [x, esperado] of casos) {
    assert.equal(fmt0(x), esperado, `f'{${x}:.0f}'`);
  }
});

test('fmt0 no es toFixed(0)', () => {
  // Las tres divergencias que se ven en pantalla.
  assert.notEqual(fmt0(0.5), (0.5).toFixed(0));
  assert.notEqual(fmt0(-0.5), (-0.5).toFixed(0));
  assert.notEqual(fmt0(1e21), (1e21).toFixed(0));
});

test('fmt0 escribe los no finitos como Python', () => {
  assert.equal(fmt0(Infinity), 'inf');
  assert.equal(fmt0(-Infinity), '-inf');
  assert.equal(fmt0(NaN), 'nan');
});

test('fmt0 nunca escribe separador de miles ni notación exponencial', () => {
  // El contrato de los textos del diagnóstico: los tests de producto parsean
  // estos números con regex.
  for (const x of [1200, 12345.6, 1234567.89, 1e15]) {
    assert.match(fmt0(x), /^-?\d+$/, `fmt0(${x})`);
  }
});

// ---------------------------------------------------------------------------
// Reducciones y estadística
// ---------------------------------------------------------------------------

test('desviacionPoblacional divide por n, no por n-1', () => {
  // np.std([1,2,3]) = 0.816496580927726; con ddof=1 saldría 1.0.
  const r = desviacionPoblacional(new Float64Array([1, 2, 3]), 3);
  assert.equal(r.media, 2);
  assert.ok(Math.abs(r.desv - 0.816496580927726) < 1e-15, `desv=${r.desv}`);
  assert.notEqual(r.desv, 1);
});

test('desviacionPoblacional coincide con numpy en un vector de referencia', () => {
  const v = new Float64Array([2.5, -1, 0.25, 7, 3.5, 3.5, -2]);
  const r = desviacionPoblacional(v, 7);
  assert.ok(Math.abs(r.media - 1.9642857142857142) < 1e-15);
  assert.ok(Math.abs(r.desv - 2.873613241413063) < 1e-14, `desv=${r.desv}`);
});

test('desviacionPoblacional de un único elemento es cero', () => {
  // Con ddof=1 sería NaN y el z-score del muestreo se volvería NaN entero.
  const r = desviacionPoblacional(new Float64Array([4.2]), 1);
  assert.equal(r.desv, 0);
  assert.equal(r.media, 4.2);
});

test('desviacionPoblacional usa dos pasadas y no cancela con medias grandes', () => {
  // E[x²]-E[x]² daría 0 o negativo aquí por cancelación catastrófica.
  const v = new Float64Array([1e8 + 4, 1e8 + 7, 1e8 + 13, 1e8 + 16]);
  const r = desviacionPoblacional(v, 4);
  assert.ok(Math.abs(r.desv - Math.sqrt(22.5)) < 1e-9, `desv=${r.desv}`);
});

test('mediaUint8 es la fracción de elementos no nulos', () => {
  assert.equal(mediaUint8(new Uint8Array([1, 1, 0, 1]), 4), 0.75);
  assert.equal(mediaUint8(new Uint8Array([0, 0]), 2), 0);
  // Sólo cuenta longitud n, no el array entero.
  assert.equal(mediaUint8(new Uint8Array([1, 1, 0, 0]), 2), 1);
});

test('suma, media, normaL2 y productoPunto operan sólo sobre los n primeros', () => {
  const v = new Float64Array([1, 2, 3, 1000]);
  assert.equal(suma(v, 3), 6);
  assert.equal(media(v, 3), 2);
  assert.equal(normaL2(new Float64Array([3, 4, 99]), 2), 5);
  const a = new Float64Array([1, 2, 3, 4]);
  const b = new Float64Array([0, 0, 10, 100]);
  assert.equal(productoPunto(a, 0, b, 2, 2), 1 * 10 + 2 * 100);
  assert.equal(productoPunto(a, 2, b, 2, 2), 3 * 10 + 4 * 100);
});

// ---------------------------------------------------------------------------
// Softmax
// ---------------------------------------------------------------------------

test('softmaxEstable devuelve una distribución que suma 1', () => {
  const logits = new Float64Array([0.5, -1.25, 3, 0]);
  const p = new Float64Array(4);
  softmaxEstable(logits, 4, p);
  assert.ok(Math.abs(suma(p, 4) - 1) < 1e-15);
  for (let i = 0; i < 4; i++) assert.ok((p[i] ?? 0) > 0);
});

test('softmaxEstable sobrevive a logits enormes sin producir NaN', () => {
  // z/tau con tau = 1e-6 llega a millones: sin restar el máximo, Math.exp
  // desborda y todo el reparto sale NaN.
  const logits = new Float64Array([3e6, 1e6, -2e6]);
  const p = new Float64Array(3);
  softmaxEstable(logits, 3, p);
  assert.ok(Math.abs(suma(p, 3) - 1) < 1e-15);
  assert.equal(p[0], 1);
  assert.equal(p[1], 0);
});

test('softmaxEstable es invariante a un desplazamiento común de los logits', () => {
  const base = [0.5, -1.25, 3, 0];
  const p1 = new Float64Array(4);
  const p2 = new Float64Array(4);
  softmaxEstable(new Float64Array(base), 4, p1);
  softmaxEstable(
    new Float64Array(base.map((x) => x + 137.5)),
    4,
    p2,
  );
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs((p1[i] ?? 0) - (p2[i] ?? 0)) < 1e-15, `componente ${i}`);
  }
});

// ---------------------------------------------------------------------------
// Clip y álgebra vectorial
// ---------------------------------------------------------------------------

test('clamp con cotas cruzadas devuelve hi, igual que np.clip', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(30, 0, 10), 10);
  // np.clip aplica primero el máximo y luego el mínimo: con lo > hi gana hi.
  assert.equal(clamp(5, 10, 2), 2);
});

test('clipEnSitio recorta componente a componente', () => {
  const v = new Float64Array([0.1, 2.5, 1]);
  clipEnSitio(v, new Float64Array([0.6, 0.6, 0.6]), new Float64Array([1.8, 1.8, 1.8]), 3);
  assert.deepEqual(Array.from(v), [0.6, 1.8, 1]);
});

test('matvec3 multiplica cada fila (P,3) por el vector (3,)', () => {
  const m = new Float32Array([1, 0, 0, 0, 1, 0, 0.5, 0.5, 0.5]);
  const v = new Float32Array([2, 4, 8]);
  const salida = new Float32Array(3);
  matvec3(m, 3, v, salida);
  assert.deepEqual(Array.from(salida), [2, 4, 7]);
});

test('matvec3 lanza con dimensiones incoherentes en vez de leer basura', () => {
  const m = new Float32Array(6);
  const v = new Float32Array(3);
  assert.throws(() => matvec3(m, 3, v, new Float32Array(3)), /dimensiones/);
  assert.throws(() => matvec3(m, 2, new Float32Array(2), new Float32Array(2)), /3 componentes/);
});

// ---------------------------------------------------------------------------
// Orden y selección
// ---------------------------------------------------------------------------

test('comparaId ordena por code point y no por code unit UTF-16', () => {
  const emoji = '\u{1F600}'; // U+1F600, fuera del BMP
  const reemplazo = '�'; // U+FFFD, dentro del BMP
  // El `<` de JS compara D83D contra FFFD y se equivoca; Python compara
  // 0x1F600 contra 0xFFFD.
  assert.ok(emoji < reemplazo);
  assert.ok(comparaId(emoji, reemplazo) > 0);
  assert.ok(comparaId(reemplazo, emoji) < 0);
});

test('comparaId pone el prefijo antes que la extensión', () => {
  assert.ok(comparaId('ab', 'abc') < 0);
  assert.ok(comparaId('abc', 'ab') > 0);
  assert.equal(comparaId('abc', 'abc'), 0);
});

test('comparaId ordena los ids ASCII como sorted() de Python', () => {
  const ids = ['a10', 'a2', 'A1', 'B', 'a'];
  const orden = [...ids].sort(comparaId);
  assert.deepEqual(orden, ['A1', 'B', 'a', 'a10', 'a2']);
});

test('ordenarPorScoreEId ordena por score descendente y desempata por id ascendente', () => {
  const ids = ['rec-c', 'rec-a', 'rec-b', 'rec-d'];
  const score = new Float32Array([1, 1, 2, 0.5]);
  const idx = Int32Array.from([0, 1, 2, 3]);
  ordenarPorScoreEId(idx, 4, score, ids);
  assert.deepEqual(Array.from(idx), [2, 1, 0, 3]);
});

test('ordenarPorScoreEId no toca los elementos más allá de n', () => {
  const ids = ['a', 'b', 'c', 'z'];
  const score = new Float32Array([1, 3, 2, 99]);
  const idx = Int32Array.from([0, 1, 2, 3]);
  ordenarPorScoreEId(idx, 3, score, ids);
  assert.deepEqual(Array.from(idx), [1, 2, 0, 3]);
});

test('ordenarPorScoreEId lanza si un índice no pertenece al pool', () => {
  const idx = Int32Array.from([0, 7]);
  assert.throws(() => ordenarPorScoreEId(idx, 2, new Float32Array([1, 2]), ['a', 'b']), /fuera/);
});

test('argsortEstableDesc devuelve los empates por índice ascendente', () => {
  // Es lo único que se consume aguas abajo: el primer índice no vetado del
  // argsort de -kappa.
  const v = new Float64Array([0.3, 0.9, 0.9, 0.1, 0.9]);
  assert.deepEqual(Array.from(argsortEstableDesc(v, 5)), [1, 2, 4, 0, 3]);
});

test('argsortEstableDesc coincide con una ordenación completa estable', () => {
  const siguiente = lcg(1234);
  const n = 40;
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.floor((siguiente() / 0xffffffff) * 5); // muchos empates
  const esperado = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const d = (v[b] ?? 0) - (v[a] ?? 0);
    return d !== 0 ? d : a - b;
  });
  assert.deepEqual(Array.from(argsortEstableDesc(v, n)), esperado);
});

test('argminEstable devuelve el PRIMER mínimo, como np.argmin', () => {
  // De esto depende que pulirUna devuelva el sigma más bajo entre los que
  // empatan en error.
  assert.equal(argminEstable(new Float64Array([3, 1, 1, 5]), 4), 1);
  assert.equal(argminEstable(new Float64Array([-1, -1]), 2), 0);
  assert.equal(argminEstable(new Float64Array([]), 0), -1);
});

test('argmaxEstable devuelve el PRIMER máximo, como np.argmax', () => {
  assert.equal(argmaxEstable(new Float64Array([3, 9, 9, 5]), 4), 1);
  assert.equal(argmaxEstable(new Float64Array([-5, -9]), 2), 0);
  assert.equal(argmaxEstable(new Float64Array([]), 0), -1);
});

test('umbralTopK devuelve el k-ésimo mayor sobre valores arbitrarios', () => {
  const siguiente = lcg(555);
  for (let caso = 0; caso < 200; caso++) {
    const n = 1 + (siguiente() % 60);
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = Math.fround((siguiente() / 0xffffffff) * 10 - 5);
    const orden = Array.from(v).sort((a, b) => b - a);
    for (const k of [1, Math.min(n, 25), n]) {
      assert.equal(umbralTopK(v, n, k), orden[k - 1], `n=${n} k=${k}`);
    }
  }
});

test('umbralTopK sobrevive a un array con muchos empates', () => {
  // El caso real: con un pool corto, `fit` vale 0,5 para media tabla y la
  // partición de dos vías degeneraría a O(n^2).
  const n = 500;
  const v = new Float32Array(n);
  v.fill(2.5);
  v[123] = 9;
  assert.equal(umbralTopK(v, n, 1), 9);
  assert.equal(umbralTopK(v, n, 2), 2.5);
  assert.equal(umbralTopK(v, n, n), 2.5);
});

test('umbralTopK no modifica el array de entrada', () => {
  const v = Float32Array.from([3, 1, 4, 1, 5, 9, 2, 6]);
  const copia = Array.from(v);
  umbralTopK(v, v.length, 3);
  assert.deepEqual(Array.from(v), copia);
});

test('umbralTopK rechaza un k fuera de rango en vez de devolver basura', () => {
  const v = Float32Array.from([1, 2, 3]);
  assert.throws(() => umbralTopK(v, 3, 0), /fuera/);
  assert.throws(() => umbralTopK(v, 3, 4), /fuera/);
  assert.throws(() => umbralTopK(v, 0, 1), /positivo/);
});

test('umbralTopK tolera -Infinity, que es como scoreSlot marca lo inadmisible', () => {
  const v = Float32Array.from([-Infinity, 2, -Infinity, 7]);
  assert.equal(umbralTopK(v, 4, 1), 7);
  assert.equal(umbralTopK(v, 4, 2), 2);
  assert.equal(umbralTopK(v, 4, 3), -Infinity);
});
