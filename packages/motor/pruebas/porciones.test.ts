/**
 * Pruebas de `porciones.ts` — la etapa B.
 *
 * Este módulo sustituye a HiGHS, así que no se puede validar contra sí mismo.
 * Se valida contra tres cosas distintas, y las tres tienen que estar verdes:
 *
 *  1. **Nivel 0** — las funciones portadas literalmente (`bandasDe`,
 *     `desviaciones`, `errorDe`, `cuantizar`, `culpabilidad`,
 *     `porcionadoDeEmergencia`) reproducen BIT A BIT el volcado del solver
 *     Python. Aquí no hay excusa: es la misma aritmética.
 *  2. **Nivel 1** — el porcionador se compara contra las 2.171 instancias
 *     reales resueltas con HiGHS y contra los 7 fixtures de referencia. El
 *     criterio NO es «mismo σ» —eso sería exigir paridad con el pivoteo de un
 *     símplex que ya no existe— sino «E_ts ≤ E_py + holgura» y concordancia de
 *     bucket. Es la puerta de decisión pre-registrada de
 *     docs/port-typescript.md: si p95 se pasa de 0,005, se cambia a highs-js.
 *  3. **Invariantes propios** — σ siempre en la rejilla, totales y error
 *     siempre correspondientes al σ devuelto, determinismo.
 *
 * Las divergencias esperadas (rejilla anclada en 0) están en DIVERGENCIAS.md y
 * se comprueban aquí como divergencias ACOTADAS; no se ignoran.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ObjetivoNutricional } from '@planeat/shared';

import { PASO_RACION, UMBRAL_ERROR_ACEPTABLE, UMBRAL_ERROR_OK } from '../src/constantes.ts';
import {
  bandasDe,
  cuantizar,
  culpabilidad,
  desviaciones,
  errorDe,
  objetivoJ,
  porcionadoDeEmergencia,
  pulirUna,
  rejilla,
  resolverPorcionesRejilla,
  totalesDe,
  type Bandas,
} from '../src/porciones.ts';

// ---------------------------------------------------------------------------
// Forma de los volcados. Se declara entera en vez de usar `any`: si el script
// de volcado cambia un nombre de campo, el fallo tiene que salir aquí y no como
// un `undefined` que se propaga hasta un assert incomprensible.
// ---------------------------------------------------------------------------

interface BandasJson {
  lo: number[];
  hi: number[];
  wMas: number[];
  wMenos: number[];
  e: number[];
  pesoTotal: number;
}

interface Volcado {
  fn: string;
  caso: string;
  divergenciaPreRegistrada?: boolean;
}
/** Entrada común de las funciones que reciben la matriz `a` (6 × R) aplanada. */
interface EntradaAR {
  a: number[];
  r: number;
  lo: number[];
  hi: number[];
  bandas: BandasJson;
}

interface VolcadoBandas extends Volcado {
  entrada: { objetivo: ObjetivoNutricional; activos: boolean[] | null };
  salida: BandasJson;
}
interface VolcadoDesviaciones extends Volcado {
  entrada: { totales: number[]; bandas: BandasJson };
  salida: { uMas: number[]; uMenos: number[] };
}
interface VolcadoError extends Volcado {
  entrada: { totales: number[]; bandas: BandasJson };
  salida: number;
}
interface VolcadoCuantizar extends Volcado {
  entrada: { sigma: number[]; lo: number[]; hi: number[] };
  salida: number[];
}
interface VolcadoRejilla extends Volcado {
  entrada: { lo: number; hi: number };
  salida: number[];
}
interface VolcadoCulpabilidad extends Volcado {
  entrada: EntradaAR & { sigma: number[]; totales: number[] };
  salida: { kappa: number[]; ordenArgsortDesc: number[] };
}
interface VolcadoPulir extends Volcado {
  entrada: EntradaAR & { sigma: number[]; j: number };
  salida: number[];
}
interface VolcadoEmergencia extends Volcado {
  entrada: EntradaAR;
  salida: { sigma: number[]; totales: number[]; error: number; emergencia: boolean };
}

/** Una instancia real de la etapa B, con su solución de HiGHS. */
interface InstanciaB {
  caso: number;
  r: number;
  entrada: { a: number[]; lo: number[]; hi: number[]; sigmaRef: number[] };
  bandas: BandasJson;
  salida: { sigma: number[]; totales: number[]; error: number; bucket: string; j: number };
}

interface FixtureCaso {
  nombre: string;
  objetivo: ObjetivoNutricional;
  /** Aquí `a` viaja ANIDADA (6 filas × R), no aplanada como en el volcado. */
  entrada: { a: number[][]; lo: number[]; hi: number[]; sigmaRef: number[] };
  referencia: { sigma: number[]; totales: number[]; error: number; emergencia: boolean };
}

const AQUI = dirname(fileURLToPath(import.meta.url));
const SOLVER = join(AQUI, '..', '..', '..', 'services', 'solver');

function jsonl(ruta: string): unknown[] {
  if (!existsSync(ruta)) return [];
  return readFileSync(ruta, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as unknown);
}

const PURAS = jsonl(join(SOLVER, 'data', 'paridad', 'funciones-puras.jsonl')) as Volcado[];
const PORCIONES = jsonl(join(SOLVER, 'data', 'paridad', 'porciones.jsonl')) as InstanciaB[];

/**
 * El volcado pesa ~7 MB y está fuera del repositorio (ver `.gitignore`), así que
 * en un clon limpio no existe. Los tests que lo consumen se saltan con un motivo
 * que dice cómo regenerarlo, en vez de reventar con un ENOENT que se lee como
 * «el port está roto».
 *
 * Saltar no es lo mismo que aprobar: el workflow de Pages regenera el volcado
 * antes de `npm test` justamente para que en CI estos tests SÍ se ejecuten. Si
 * alguna vez ves este motivo en la salida de CI, la paridad no se ha comprobado.
 */
const SIN_VOLCADO =
  PURAS.length > 0 && PORCIONES.length > 0
    ? false
    : 'falta el volcado de paridad; regenéralo con:\n' +
      '  cd services/solver && source .venv/bin/activate && python scripts/volcar_paridad.py';
const FIXTURES = JSON.parse(
  readFileSync(join(SOLVER, 'data', 'fixtures', 'porciones.json'), 'utf8'),
) as { casos: FixtureCaso[] };

/**
 * Registros de una función del volcado. El `as` es la única conversión sin
 * comprobar del fichero y está aislada aquí: `fn` selecciona la forma, y si el
 * volcado cambiara, los asserts de cada test caerían inmediatamente.
 */
function casos<T extends Volcado>(fn: string): T[] {
  const v = PURAS.filter((d) => d.fn === fn) as T[];
  assert.ok(v.length > 0, `el volcado no trae ningún caso de ${fn}`);
  return v;
}

/**
 * Elemento `i` de un array del volcado. Con `noUncheckedIndexedAccess` todo
 * índice es `T | undefined`; escribir el `?? 0` en cada línea escondería un
 * volcado truncado detrás de un cero silencioso, que es justo lo que un test de
 * paridad no puede permitirse.
 */
function num(v: ArrayLike<number>, i: number): number {
  const x = v[i];
  if (x === undefined) throw new Error(`índice ${i} fuera de rango (longitud ${v.length})`);
  return x;
}

function bandasDeJson(b: BandasJson): Bandas {
  return {
    lo: Float64Array.from(b.lo),
    hi: Float64Array.from(b.hi),
    wMas: Float64Array.from(b.wMas),
    wMenos: Float64Array.from(b.wMenos),
    e: Float64Array.from(b.e),
    pesoTotal: b.pesoTotal,
  };
}

function activosDeJson(v: boolean[] | null): Uint8Array | null {
  return v === null ? null : Uint8Array.from(v, (x) => (x ? 1 : 0));
}

function clipado(v: number[], lo: number[], hi: number[]): Float64Array {
  return Float64Array.from(v, (x, i) => Math.min(Math.max(x, num(lo, i)), num(hi, i)));
}

/** Percentil por rango más cercano sobre un array YA ordenado ascendentemente. */
function percentil(v: readonly number[], p: number): number {
  const k = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return num(v, k);
}

const bucketDe = (e: number): 'ok' | 'aceptable' | 'malo' =>
  e <= UMBRAL_ERROR_OK ? 'ok' : e <= UMBRAL_ERROR_ACEPTABLE ? 'aceptable' : 'malo';
const RANGO_BUCKET: Readonly<Record<string, number>> = { ok: 0, aceptable: 1, malo: 2 };
const rango = (b: string): number => RANGO_BUCKET[b] ?? 3;

/** Resuelve una instancia del volcado con el porcionador del port. */
function resolver(d: InstanciaB) {
  return resolverPorcionesRejilla(
    Float64Array.from(d.entrada.a),
    d.r,
    Float64Array.from(d.entrada.lo),
    Float64Array.from(d.entrada.hi),
    Float64Array.from(d.entrada.sigmaRef),
    bandasDeJson(d.bandas),
  );
}

// ---------------------------------------------------------------------------
// Nivel 0 — paridad exacta de las funciones portadas literalmente
// ---------------------------------------------------------------------------

test('bandasDe reproduce bit a bit las bandas del solver Python', { skip: SIN_VOLCADO }, () => {
  for (const c of casos<VolcadoBandas>('bandasDe')) {
    const b = bandasDe(c.entrada.objetivo, activosDeJson(c.entrada.activos));
    for (let i = 0; i < 6; i++) {
      assert.equal(num(b.lo, i), num(c.salida.lo, i), `lo[${i}] en ${c.caso}`);
      assert.equal(num(b.hi, i), num(c.salida.hi, i), `hi[${i}] en ${c.caso}`);
      assert.equal(num(b.wMas, i), num(c.salida.wMas, i), `wMas[${i}] en ${c.caso}`);
      assert.equal(num(b.wMenos, i), num(c.salida.wMenos, i), `wMenos[${i}] en ${c.caso}`);
      assert.equal(num(b.e, i), num(c.salida.e, i), `e[${i}] en ${c.caso}`);
    }
    assert.equal(b.pesoTotal, c.salida.pesoTotal, `pesoTotal en ${c.caso}`);
  }
});

test('el normalizador e se calcula DESPUÉS de aplicar activos', () => {
  // Si `e` se calculase antes, la fibra desactivada saldría con e = 20 en vez de
  // e = 1. No cambia el error —su peso es 0— pero sí `culpabilidad`, que divide
  // por e dos veces y decide a qué slot ataca la reparación.
  const objetivo: ObjetivoNutricional = {
    kcal: 2000,
    toleranciaKcal: 0.05,
    proteinaG: { min: 120, max: 160 },
    carbohidratoG: { min: 180, max: 250 },
    grasaG: { min: 55, max: 80 },
    fibraMinG: 20,
  };
  assert.equal(num(bandasDe(objetivo, null).e, 4), 20);
  const sinFibra = bandasDe(objetivo, Uint8Array.of(1, 1, 1, 1, 0, 1));
  assert.equal(num(sinFibra.e, 4), 1);
  assert.equal(num(sinFibra.wMenos, 4), 0);
});

test('desviaciones reproduce bit a bit u⁺ y u⁻ del solver Python', { skip: SIN_VOLCADO }, () => {
  for (const c of casos<VolcadoDesviaciones>('desviaciones')) {
    const { uMas, uMenos } = desviaciones(
      Float64Array.from(c.entrada.totales),
      bandasDeJson(c.entrada.bandas),
    );
    for (let i = 0; i < 6; i++) {
      assert.equal(num(uMas, i), num(c.salida.uMas, i), `uMas[${i}] en ${c.caso}`);
      assert.equal(num(uMenos, i), num(c.salida.uMenos, i), `uMenos[${i}] en ${c.caso}`);
    }
  }
});

test('errorDe reproduce bit a bit E del solver Python', { skip: SIN_VOLCADO }, () => {
  for (const c of casos<VolcadoError>('errorDe')) {
    const e = errorDe(Float64Array.from(c.entrada.totales), bandasDeJson(c.entrada.bandas));
    assert.equal(e, c.salida, `E en ${c.caso}`);
  }
});

test('errorDe devuelve 0 cuando no queda ningún nutriente activo', () => {
  // Ese 0 significa «no hay datos», no «objetivo alcanzado». Se replica el
  // comportamiento de Python; distinguirlos es trabajo de la traza.
  const bandas = bandasDe(
    {
      kcal: 2000,
      toleranciaKcal: 0.05,
      proteinaG: { min: 120, max: 160 },
      carbohidratoG: { min: 180, max: 250 },
      grasaG: { min: 55, max: 80 },
      fibraMinG: 20,
    },
    Uint8Array.of(0, 0, 0, 0, 0, 0),
  );
  assert.equal(bandas.pesoTotal, 0);
  assert.equal(errorDe(Float64Array.of(9e9, 0, 0, 0, 0, 0), bandas), 0);
});

test('cuantizar reproduce bit a bit el redondeo bancario y el clip de Python', { skip: SIN_VOLCADO }, () => {
  for (const c of casos<VolcadoCuantizar>('cuantizar')) {
    const q = cuantizar(
      Float64Array.from(c.entrada.sigma),
      Float64Array.from(c.entrada.lo),
      Float64Array.from(c.entrada.hi),
    );
    for (let i = 0; i < q.length; i++) {
      assert.equal(num(q, i), num(c.salida, i), `σ[${i}] en ${c.caso}`);
    }
  }
});

test('culpabilidad reproduce κ del solver Python', { skip: SIN_VOLCADO }, () => {
  for (const c of casos<VolcadoCulpabilidad>('culpabilidad')) {
    const k = culpabilidad(
      Float64Array.from(c.entrada.a),
      c.entrada.r,
      Float64Array.from(c.entrada.sigma),
      Float64Array.from(c.entrada.totales),
      bandasDeJson(c.entrada.bandas),
    );
    assert.equal(k.length, c.salida.kappa.length);
    for (let i = 0; i < k.length; i++) {
      const py = num(c.salida.kappa, i);
      const rel = Math.abs(num(k, i) - py) / Math.max(1e-12, Math.abs(py));
      assert.ok(rel <= 1e-12, `κ[${i}] en ${c.caso}: ${num(k, i)} vs ${py}`);
    }
  }
});

test('porcionadoDeEmergencia reproduce σ, totales y error del solver Python', { skip: SIN_VOLCADO }, () => {
  for (const c of casos<VolcadoEmergencia>('porcionadoDeEmergencia')) {
    const res = porcionadoDeEmergencia(
      Float64Array.from(c.entrada.a),
      c.entrada.r,
      Float64Array.from(c.entrada.lo),
      Float64Array.from(c.entrada.hi),
      bandasDeJson(c.entrada.bandas),
    );
    assert.equal(res.emergencia, true);
    for (let i = 0; i < res.sigma.length; i++) {
      assert.equal(num(res.sigma, i), num(c.salida.sigma, i), `σ[${i}] en ${c.caso}`);
    }
    for (let i = 0; i < 6; i++) {
      const py = num(c.salida.totales, i);
      assert.ok(
        Math.abs(num(res.totales, i) - py) <= 1e-12 * Math.max(1, Math.abs(py)),
        `totales[${i}] en ${c.caso}`,
      );
    }
    assert.ok(Math.abs(res.error - c.salida.error) <= 1e-12, `E en ${c.caso}`);
  }
});

// ---------------------------------------------------------------------------
// La rejilla unificada — DIVERGENCIAS.md D1
// ---------------------------------------------------------------------------

test('la rejilla unificada está anclada en 0, es ascendente estricta y contiene ambas cotas', () => {
  const pares: readonly (readonly [number, number])[] = [
    [0.6, 1.8],
    [1.0, 1.1],
    [0.05, 3.0],
    [0.7333, 1.8],
    [0.6, 1.7333],
    // El caso real y la razón de ser de la divergencia: escalaMin es float32 y
    // 0,6 en float32 vale 0,6000000238418579, que no es múltiplo de 0,05.
    [0.6000000238418579, 1.7999999523162842],
  ];
  for (const [lo, hi] of pares) {
    const g = rejilla(lo, hi);
    assert.equal(num(g, 0), lo, `el primer punto debe ser lo (${lo}, ${hi})`);
    assert.equal(num(g, g.length - 1), hi, `el último punto debe ser hi (${lo}, ${hi})`);
    for (let i = 1; i < g.length; i++) {
      assert.ok(num(g, i) > num(g, i - 1), `rejilla no ascendente en (${lo}, ${hi})`);
    }
    for (let i = 1; i < g.length - 1; i++) {
      const k = num(g, i) / PASO_RACION;
      assert.equal(num(g, i), Math.round(k) * PASO_RACION, `punto interior fuera de rejilla: ${num(g, i)}`);
    }
  }
});

test('la rejilla degenerada o cruzada devuelve el único valor que np.clip puede dar', () => {
  assert.deepEqual(Array.from(rejilla(1.0, 1.0)), [1.0]);
  assert.deepEqual(Array.from(rejilla(1.5, 1.0)), [1.0]);
});

test('la rejilla coincide con la de Python cuando las dos cotas son múltiplos de 0,05', { skip: SIN_VOLCADO }, () => {
  // Con cotas «limpias» la única diferencia admitida es que Python duplica `hi`
  // (`np.append` incondicional) y arrastra el error de acumular desde `lo`. El
  // CONJUNTO tiene que ser el mismo: si no, el port exploraría otro espacio.
  for (const c of casos<VolcadoRejilla>('rejilla')) {
    if (c.divergenciaPreRegistrada === true) continue;
    const mios = Array.from(rejilla(c.entrada.lo, c.entrada.hi));
    const suyos = [...new Set(c.salida)];
    assert.equal(mios.length, suyos.length, `nº de puntos en ${c.caso}`);
    for (let i = 0; i < mios.length; i++) {
      assert.ok(
        Math.abs(num(mios, i) - num(suyos, i)) < 1e-12,
        `punto ${i} en ${c.caso}: ${num(mios, i)} vs ${num(suyos, i)}`,
      );
    }
  }
});

test('pulirUna coincide con Python salvo el desplazamiento de la rejilla anclada en 0', { skip: SIN_VOLCADO }, () => {
  const lista = casos<VolcadoPulir>('pulirUna');
  let distintos = 0;
  let maxDelta = 0;
  let maxPeorE = 0;
  for (const c of lista) {
    const { a: aJson, r, bandas: bJson } = c.entrada;
    const a = Float64Array.from(aJson);
    const bandas = bandasDeJson(bJson);
    const mio = pulirUna(
      a,
      r,
      Float64Array.from(c.entrada.sigma),
      Float64Array.from(c.entrada.lo),
      Float64Array.from(c.entrada.hi),
      bandas,
      c.entrada.j,
    );
    const suyo = Float64Array.from(c.salida);
    let delta = 0;
    for (let i = 0; i < r; i++) delta = Math.max(delta, Math.abs(num(mio, i) - num(suyo, i)));
    if (delta > 0) distintos++;
    maxDelta = Math.max(maxDelta, delta);
    // El desplazamiento tiene que quedarse en el ruido del float32 de escalaMin
    // (2,4·10⁻⁸). Si alguna vez llegara a medio paso, el argmin habría saltado
    // de punto y la divergencia dejaría de ser cosmética.
    assert.ok(delta < PASO_RACION / 2, `Δσ demasiado grande en ${c.caso}: ${delta}`);
    const eMio = errorDe(totalesDe(a, r, mio), bandas);
    const eSuyo = errorDe(totalesDe(a, r, suyo), bandas);
    maxPeorE = Math.max(maxPeorE, eMio - eSuyo);
    assert.ok(eMio <= eSuyo + 1e-8, `pulirUna empeora E en ${c.caso}: ${eMio} vs ${eSuyo}`);
  }
  console.log(
    `[pulirUna] ${lista.length} casos · σ distinto en ${distintos} ` +
      `· máx |Δσ| ${maxDelta.toExponential(2)} · máx (E_ts − E_py) ${maxPeorE.toExponential(2)}`,
  );
});

// ---------------------------------------------------------------------------
// Invariantes del porcionador
// ---------------------------------------------------------------------------

test('el σ devuelto siempre cae en la rejilla de su propia coordenada', { skip: SIN_VOLCADO }, () => {
  // Es el contrato que Python rompía: `_pulir_una` devolvía σ que `_cuantizar`
  // no podía producir jamás. Si esto falla, la UI acaba enseñando «1,6000000238
  // raciones de lentejas».
  for (const d of PORCIONES) {
    const res = resolver(d);
    for (let j = 0; j < d.r; j++) {
      const puntos = rejilla(num(d.entrada.lo, j), num(d.entrada.hi, j));
      assert.ok(
        puntos.includes(num(res.sigma, j)),
        `caso ${d.caso}: σ[${j}] = ${num(res.sigma, j)} no está en su rejilla`,
      );
    }
  }
});

test('totales y error se corresponden SIEMPRE con el σ devuelto', { skip: SIN_VOLCADO }, () => {
  // El invariante que el Python de origen repite tres veces: mentir aquí es el
  // bug que hace que la suma de la UI no cuadre con lo que muestra por comida.
  for (const d of PORCIONES) {
    const a = Float64Array.from(d.entrada.a);
    const bandas = bandasDeJson(d.bandas);
    const res = resolver(d);
    const tot = totalesDe(a, d.r, res.sigma);
    for (let n = 0; n < 6; n++) {
      assert.equal(num(res.totales, n), num(tot, n), `caso ${d.caso}, nutriente ${n}`);
    }
    assert.equal(res.error, errorDe(tot, bandas), `caso ${d.caso}`);
    // `emergencia` ya no se dispara por límite de tiempo: DIVERGENCIAS.md D2.b.
    assert.equal(res.emergencia, false, `caso ${d.caso}`);
  }
});

test('el porcionador es determinista: misma entrada, mismo σ, sin RNG', { skip: SIN_VOLCADO }, () => {
  for (const d of PORCIONES.slice(0, 300)) {
    const uno = resolver(d);
    const dos = resolver(d);
    assert.deepEqual(Array.from(uno.sigma), Array.from(dos.sigma), `caso ${d.caso}`);
    assert.equal(uno.error, dos.error, `caso ${d.caso}`);
  }
});

test('el descenso nunca sale peor que su propio arranque Q(σref)', { skip: SIN_VOLCADO }, () => {
  // Q(σref) es el ancla que el LP usa y lo que Python devolvería si el óptimo
  // continuo cayera justo ahí. Salir peor significaría que el descenso está
  // aceptando movimientos que no mejoran J.
  for (const d of PORCIONES) {
    const a = Float64Array.from(d.entrada.a);
    const lo = Float64Array.from(d.entrada.lo);
    const hi = Float64Array.from(d.entrada.hi);
    const bandas = bandasDeJson(d.bandas);
    const refClip = clipado(d.entrada.sigmaRef, d.entrada.lo, d.entrada.hi);
    const res = resolver(d);
    const jFinal = objetivoJ(a, d.r, res.sigma, refClip, bandas);
    const jAncla = objetivoJ(a, d.r, cuantizar(refClip, lo, hi), refClip, bandas);
    assert.ok(jFinal <= jAncla + 1e-12, `caso ${d.caso}: J ${jFinal} > ancla ${jAncla}`);
  }
});

test('R = 0 y las entradas no finitas caen al porcionado de emergencia', () => {
  const bandas = bandasDe(
    {
      kcal: 2000,
      toleranciaKcal: 0.05,
      proteinaG: { min: 120, max: 160 },
      carbohidratoG: { min: 180, max: 250 },
      grasaG: { min: 55, max: 80 },
      fibraMinG: 20,
    },
    null,
  );
  const vacia = new Float64Array(0);
  const sinRecetas = resolverPorcionesRejilla(vacia, 0, vacia, vacia, vacia, bandas);
  assert.equal(sinRecetas.emergencia, true);
  assert.equal(sinRecetas.sigma.length, 0);
  assert.deepEqual(Array.from(sinRecetas.totales), [0, 0, 0, 0, 0, 0]);

  const roto = resolverPorcionesRejilla(
    Float64Array.of(NaN, 1, 1, 1, 1, 1),
    1,
    Float64Array.of(0.6),
    Float64Array.of(1.8),
    Float64Array.of(1.0),
    bandas,
  );
  assert.equal(roto.emergencia, true);
});

test('objetivoJ es el valor objetivo del LP evaluado en un σ de la rejilla', { skip: SIN_VOLCADO }, () => {
  // Se comprueba contra el J que el volcado calcula sobre el σ de Python: si
  // las dos fórmulas no coincidieran, el descenso estaría minimizando otra cosa
  // y la comparación de la puerta de decisión no significaría nada.
  let peor = 0;
  for (const d of PORCIONES) {
    const refClip = clipado(d.entrada.sigmaRef, d.entrada.lo, d.entrada.hi);
    const jMio = objetivoJ(
      Float64Array.from(d.entrada.a),
      d.r,
      Float64Array.from(d.salida.sigma),
      refClip,
      bandasDeJson(d.bandas),
    );
    peor = Math.max(peor, Math.abs(jMio - d.salida.j) / Math.max(1e-12, Math.abs(d.salida.j)));
  }
  assert.ok(peor <= 1e-12, `J diverge de la fórmula del volcado: error relativo ${peor}`);
});

// ---------------------------------------------------------------------------
// Nivel 1 — la comparación cuantitativa que decide el porcionador
// ---------------------------------------------------------------------------

test('los 7 fixtures de HiGHS: error_ts ≤ error_py + 0,005', () => {
  assert.equal(FIXTURES.casos.length, 7);
  const filas: string[] = [];
  let peor = -Infinity;
  for (const c of FIXTURES.casos) {
    const lo = Float64Array.from(c.entrada.lo);
    const r = lo.length;
    // En los fixtures `a` viaja anidada (6 × R); el port la quiere aplanada.
    const a = new Float64Array(6 * r);
    for (let n = 0; n < 6; n++) {
      const fila = c.entrada.a[n];
      if (fila === undefined) throw new Error(`fixture ${c.nombre}: falta la fila ${n} de a`);
      for (let i = 0; i < r; i++) a[n * r + i] = num(fila, i);
    }
    const res = resolverPorcionesRejilla(
      a,
      r,
      lo,
      Float64Array.from(c.entrada.hi),
      Float64Array.from(c.entrada.sigmaRef),
      bandasDe(c.objetivo, null),
    );
    const delta = res.error - c.referencia.error;
    peor = Math.max(peor, delta);
    filas.push(
      `  ${c.nombre.padEnd(16)} R=${r}  E_py=${c.referencia.error.toFixed(6)}  ` +
        `E_ts=${res.error.toFixed(6)}  Δ=${delta >= 0 ? '+' : ''}${delta.toExponential(2)}  ` +
        `bucket ${bucketDe(c.referencia.error)}→${bucketDe(res.error)}`,
    );
    assert.ok(delta <= 0.005, `${c.nombre}: E_ts ${res.error} > E_py ${c.referencia.error} + 0,005`);
  }
  console.log('[fixtures HiGHS] distribución completa de (E_ts − E_py):');
  for (const f of filas) console.log(f);
  console.log(`  peor Δ = ${peor.toExponential(3)} (umbral 5,0e-3)`);
});

test('paridad nivel 1 sobre las instancias reales: p95(E_ts − E_py) ≤ 0,005 y bucket sin regresiones', { skip: SIN_VOLCADO }, () => {
  assert.ok(PORCIONES.length >= 2000, `el corpus de paridad trae sólo ${PORCIONES.length} instancias`);
  const deltas: number[] = [];
  let mejorOIgual = 0;
  let bucketIgual = 0;
  let bucketMejor = 0;
  let bucketPeor = 0;
  const regresiones: string[] = [];
  const t0 = performance.now();

  for (const d of PORCIONES) {
    const res = resolver(d);
    deltas.push(res.error - d.salida.error);
    if (res.error <= d.salida.error + 1e-12) mejorOIgual++;
    const bTs = bucketDe(res.error);
    if (bTs === d.salida.bucket) bucketIgual++;
    else if (rango(bTs) > rango(d.salida.bucket)) {
      bucketPeor++;
      regresiones.push(`caso ${d.caso} (R=${d.r}): ${d.salida.bucket} → ${bTs}, E ${d.salida.error} → ${res.error}`);
    } else bucketMejor++;
  }
  const ms = performance.now() - t0;
  deltas.sort((x, y) => x - y);
  const n = deltas.length;

  console.log(`[paridad nivel 1] n = ${n} instancias · ${(ms / n).toFixed(3)} ms/instancia`);
  console.log('  distribución completa de (E_ts − E_py):');
  console.log(`    min = ${num(deltas, 0).toExponential(3)}`);
  for (const p of [5, 25, 50, 75, 90, 95, 99]) {
    console.log(`    p${String(p).padStart(2)} = ${percentil(deltas, p).toExponential(3)}`);
  }
  console.log(`    max = ${num(deltas, n - 1).toExponential(3)}`);
  console.log(`  E_ts ≤ E_py en ${((100 * mejorOIgual) / n).toFixed(2)} % de las instancias`);
  console.log(`  buckets: igual ${bucketIgual}, mejor ${bucketMejor}, peor ${bucketPeor}`);
  for (const r of regresiones) console.log(`    REGRESIÓN ${r}`);

  // Puerta de decisión PRE-REGISTRADA de docs/port-typescript.md: si cualquiera
  // de estas falla, se sustituye el descenso por highs-js WASM detrás de la
  // misma interfaz síncrona. Se decide con el número, no con la opinión.
  assert.ok(percentil(deltas, 95) <= 0.005, `p95 = ${percentil(deltas, 95)} > 0,005`);
  assert.ok(percentil(deltas, 50) <= 0, `p50 = ${percentil(deltas, 50)} > 0`);
  assert.ok(bucketPeor <= 0.01 * n, `${bucketPeor} cambios de bucket a peor (> 1 %)`);
  // Concordancia de bucket: las únicas discrepancias admitidas son a MEJOR.
  assert.equal(bucketPeor, 0, 'ninguna instancia puede cambiar de bucket a peor');
});
