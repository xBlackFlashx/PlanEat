/**
 * Contrato del volcado de paridad que emite `services/solver/scripts/volcar_paridad.py`.
 *
 * Estos tests NO comparan Python contra TypeScript: eso lo hará el arnés
 * (`pruebas/paridad/comparar.ts`). Lo que fijan aquí es que el fichero de
 * referencia sea *utilizable* — forma, cobertura y coherencia interna—, porque
 * una referencia mal serializada se descubre normalmente en el lado equivocado
 * del port: el runner marca fallos de paridad y uno pasa la tarde depurando
 * `porciones.ts`, que estaba bien.
 *
 * Por eso el fichero se valida contra sí mismo: los `totales` que Python volcó
 * tienen que ser exactamente A·σ, y su `error` el que se deduce de las bandas
 * volcadas. Si eso no cuadra, el problema es del volcado, no del port.
 *
 * No importa nada de `src/`: tiene que poder ejecutarse aunque el port aún no
 * exista.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR_VOLCADO = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'services',
  'solver',
  'data',
  'paridad',
);

const COMO_REGENERAR =
  'Falta el volcado de paridad. Regenéralo con: ' +
  'cd services/solver && python scripts/volcar_paridad.py';

// El volcado pesa ~5,5 MB y está fuera del control de versiones (ver .gitignore),
// así que en un clon limpio no existe. Se avisa y se salta en vez de fallar: un
// rojo aquí diría «el port está mal» cuando lo que pasa es que faltan datos.
const HAY_VOLCADO = existsSync(join(DIR_VOLCADO, 'porciones.jsonl'));

// Espejo de INF_HIGHS / INF_BANDA. Es 1e30 y no Infinity a propósito: JSON no
// tiene Infinity y el normalizador `e` depende de la finitud.
const INF_BANDA = 1.0e30;
const PASO_RACION = 0.05;
const UMBRAL_ERROR_OK = 0.04;
const UMBRAL_ERROR_ACEPTABLE = 0.12;

// Las funciones puras del «Nivel 0» de docs/port-typescript.md. Si el volcado no
// trae una, el port de esa función se quedaría sin referencia y nadie lo notaría
// hasta que fallara un plan entero.
const FUNCIONES_NIVEL_0 = [
  'bandasDe',
  'desviaciones',
  'errorDe',
  'culpabilidad',
  'cuantizar',
  'rejilla',
  'pulirUna',
  'porcionadoDeEmergencia',
  'vectorMacro',
  'cuotasDe',
  'ordenDeSlots',
  'penalizacionRepeticion',
  'nutrientesActivos',
  'topesPorSlot',
  'bitsDe',
  'ablacion',
  'cotasAlcanzables',
  'macrosIncompatibles',
  'minCandidatosSlot',
  'temperatura',
  'sigmaSugerido',
  'totalesDe',
];

interface Bandas {
  lo: number[];
  hi: number[];
  wMas: number[];
  wMenos: number[];
  e: number[];
  pesoTotal: number;
}

interface LineaPorciones {
  caso: number;
  origen: string;
  r: number;
  recetaIds: string[] | null;
  activos: boolean[] | null;
  entrada: { a: number[]; lo: number[]; hi: number[]; sigmaRef: number[] };
  bandas: Bandas;
  salida: {
    sigma: number[];
    totales: number[];
    error: number;
    emergencia: boolean;
    bucket: string;
    j: number;
  };
  flags: Record<string, boolean>;
}

function leerJsonl(nombre: string): unknown[] {
  const texto = readFileSync(join(DIR_VOLCADO, nombre), 'utf8');
  return texto
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l, i) => {
      try {
        return JSON.parse(l) as unknown;
      } catch (e) {
        throw new Error(`línea ${i + 1} de ${nombre} no es JSON: ${String(e)}`);
      }
    });
}

/** Recorre todo número del árbol y avisa de dónde está el que no es finito. */
function numerosDe(x: unknown, ruta: string, salida: [string, number][]): void {
  if (typeof x === 'number') salida.push([ruta, x]);
  else if (Array.isArray(x)) x.forEach((v, i) => numerosDe(v, `${ruta}[${i}]`, salida));
  else if (x !== null && typeof x === 'object')
    for (const [k, v] of Object.entries(x)) numerosDe(v, `${ruta}.${k}`, salida);
}

const opciones = { skip: HAY_VOLCADO ? false : COMO_REGENERAR };

test('el volcado de funciones puras cubre las 22 funciones del nivel 0', opciones, () => {
  const lineas = leerJsonl('funciones-puras.jsonl') as { fn: string; caso: string }[];
  const presentes = new Set(lineas.map((l) => l.fn));
  for (const fn of FUNCIONES_NIVEL_0) {
    assert.ok(presentes.has(fn), `sin casos volcados para ${fn}`);
  }
});

test('cada línea de funciones puras tiene fn, caso, entrada y salida', opciones, () => {
  const lineas = leerJsonl('funciones-puras.jsonl') as Record<string, unknown>[];
  assert.ok(lineas.length > 500, `sólo ${lineas.length} casos volcados`);
  const vistos = new Set<string>();
  for (const l of lineas) {
    assert.equal(typeof l['fn'], 'string');
    assert.equal(typeof l['caso'], 'string');
    assert.ok('entrada' in l, `sin entrada en ${String(l['fn'])}`);
    assert.ok('salida' in l, `sin salida en ${String(l['fn'])}`);
    // (fn, caso) es la identidad de un caso: si se repite, un fallo del arnés
    // apunta a dos sitios distintos y deja de ser diagnosticable.
    const clave = `${String(l['fn'])}/${String(l['caso'])}`;
    assert.ok(!vistos.has(clave), `caso duplicado: ${clave}`);
    vistos.add(clave);
  }
});

test('ningún flotante del volcado es NaN ni infinito', opciones, () => {
  for (const fichero of ['funciones-puras.jsonl', 'porciones.jsonl']) {
    for (const [i, linea] of leerJsonl(fichero).entries()) {
      const nums: [string, number][] = [];
      numerosDe(linea, `${fichero}:${i + 1}`, nums);
      for (const [ruta, n] of nums) {
        assert.ok(Number.isFinite(n), `no finito en ${ruta}: ${n}`);
        // 1e30 es «sin cota» y es el mayor valor legítimo del modelo. Cualquier
        // cosa por encima significa que se coló un infinito disfrazado.
        assert.ok(Math.abs(n) <= INF_BANDA, `magnitud imposible en ${ruta}: ${n}`);
      }
    }
  }
});

test('el volcado de la etapa B trae al menos 2.000 instancias', opciones, () => {
  const lineas = leerJsonl('porciones.jsonl');
  assert.ok(
    lineas.length >= 2000,
    `${lineas.length} instancias: la puerta de decisión del porcionador ` +
      'está pre-registrada sobre ≥2.000',
  );
});

test('las instancias de la etapa B tienen dimensiones coherentes', opciones, () => {
  for (const l of leerJsonl('porciones.jsonl') as LineaPorciones[]) {
    const { r, entrada, bandas, salida } = l;
    assert.ok(r >= 1 && r <= 6, `R fuera de rango en el caso ${l.caso}: ${r}`);
    // `a` viaja aplanada en row-major (6 nutrientes × R recetas): el orden es
    // contrato con el Float64Array del port.
    assert.equal(entrada.a.length, 6 * r, `a mal dimensionada en ${l.caso}`);
    for (const v of [entrada.lo, entrada.hi, entrada.sigmaRef, salida.sigma]) {
      assert.equal(v.length, r, `vector de longitud ≠ R en ${l.caso}`);
    }
    for (const v of [bandas.lo, bandas.hi, bandas.wMas, bandas.wMenos, bandas.e]) {
      assert.equal(v.length, 6, `banda de longitud ≠ 6 en ${l.caso}`);
    }
    assert.equal(salida.totales.length, 6);
    assert.ok(l.activos === null || l.activos.length === 6);
  }
});

test('los totales volcados son exactamente A·σ', opciones, () => {
  // Es el invariante que el propio Python repite tres veces: los totales son
  // SIEMPRE los de los σ devueltos. Si el volcado no lo cumpliera, el arnés
  // estaría comparando contra una referencia que miente.
  for (const l of leerJsonl('porciones.jsonl') as LineaPorciones[]) {
    for (let n = 0; n < 6; n++) {
      let acc = 0;
      for (let i = 0; i < l.r; i++) acc += (l.entrada.a[n * l.r + i] ?? 0) * (l.salida.sigma[i] ?? 0);
      const dado = l.salida.totales[n] ?? Number.NaN;
      const tol = 1e-9 * Math.max(1, Math.abs(dado));
      assert.ok(
        Math.abs(acc - dado) <= tol,
        `totales[${n}] del caso ${l.caso}: volcado ${dado}, A·σ = ${acc}`,
      );
    }
  }
});

test('los σ volcados están en la caja y en una de las dos rejillas', opciones, () => {
  // Python tiene DOS rejillas incompatibles: `_cuantizar` ancla en 0 y
  // `_rejilla` (la que usa `_pulir_una`) ancla en `lo`. Y `lo` sale de un
  // float32: 0,6 almacenado en float32 vale 0,6000000238418579, que no es
  // múltiplo de 0,05. Así que hay σ como 1,6000000238418579 en el volcado, y la
  // línea los marca con `sigmaFueraDeRejillaAnclada0`.
  //
  // El port unifica en la rejilla anclada en 0 (divergencia consciente (1) de
  // docs/port-typescript.md), así que ahí dará otro σ. Este test comprueba lo
  // único exigible al VOLCADO: que cada σ esté en la caja y en alguna de las dos
  // rejillas, y que la bandera cuente la verdad.
  let marcadas = 0;
  for (const l of leerJsonl('porciones.jsonl') as LineaPorciones[]) {
    let fueraDeRejilla0 = false;
    for (let i = 0; i < l.r; i++) {
      const s = l.salida.sigma[i] ?? Number.NaN;
      const lo = l.entrada.lo[i] ?? Number.NaN;
      const hi = l.entrada.hi[i] ?? Number.NaN;
      assert.ok(s >= lo - 1e-12 && s <= hi + 1e-12, `σ fuera de [lo,hi] en ${l.caso}`);
      const enBorde = s === lo || s === hi;
      const enRejilla0 = Math.abs(s / PASO_RACION - Math.round(s / PASO_RACION)) < 1e-9;
      const d = (s - lo) / PASO_RACION;
      const enRejillaDeLo = Math.abs(d - Math.round(d)) < 1e-9;
      assert.ok(
        enBorde || enRejilla0 || enRejillaDeLo,
        `σ=${s} no está en ninguna de las dos rejillas (caso ${l.caso})`,
      );
      if (!enBorde && !enRejilla0) fueraDeRejilla0 = true;
    }
    assert.equal(
      l.flags['sigmaFueraDeRejillaAnclada0'],
      fueraDeRejilla0,
      `bandera de rejilla mal puesta en el caso ${l.caso}`,
    );
    if (fueraDeRejilla0) marcadas++;
  }
  // Si esto llegara a cero, la divergencia habría dejado de ser observable y el
  // arnés estaría midiendo un caso que ya no existe: conviene enterarse.
  assert.ok(marcadas > 0, 'ninguna instancia ejerce la divergencia de rejilla');
});

test('el error volcado se deduce de los totales y las bandas volcadas', opciones, () => {
  // Reimplementa `error_de` en diez líneas para comprobar que `bandas`,
  // `totales` y `error` de cada línea cuentan la misma historia. Volcar las
  // bandas ya resueltas es justamente lo que permite comparar E aunque el port
  // de `nutrientesActivos` difiera.
  for (const l of leerJsonl('porciones.jsonl') as LineaPorciones[]) {
    const b = l.bandas;
    let num = 0;
    for (let n = 0; n < 6; n++) {
      const t = l.salida.totales[n] ?? 0;
      const hi = b.hi[n] ?? INF_BANDA;
      const lo = b.lo[n] ?? -INF_BANDA;
      const uMas = hi < INF_BANDA ? Math.max(0, t - hi) : 0;
      const uMenos = lo > -INF_BANDA ? Math.max(0, lo - t) : 0;
      num += ((b.wMas[n] ?? 0) * uMas + (b.wMenos[n] ?? 0) * uMenos) / (b.e[n] ?? 1);
    }
    const esperado = b.pesoTotal <= 0 ? 0 : num / b.pesoTotal;
    assert.ok(
      Math.abs(esperado - l.salida.error) <= 1e-12 * Math.max(1, Math.abs(esperado)),
      `error del caso ${l.caso}: volcado ${l.salida.error}, recalculado ${esperado}`,
    );
  }
});

test('el bucket volcado corresponde a los umbrales del motor', opciones, () => {
  // El bucket es lo ÚNICO observable del error: dispara la reparación y dispara
  // ok:false. La puerta de decisión del porcionador se mide sobre él.
  for (const l of leerJsonl('porciones.jsonl') as LineaPorciones[]) {
    const e = l.salida.error;
    const esperado =
      e <= UMBRAL_ERROR_OK ? 'ok' : e <= UMBRAL_ERROR_ACEPTABLE ? 'aceptable' : 'malo';
    assert.equal(l.salida.bucket, esperado, `bucket mal etiquetado en ${l.caso}`);
  }
});

test('la etapa B volcada cubre R=1..6, cotas activas, sodio y nutrientes apagados', opciones, () => {
  const lineas = leerJsonl('porciones.jsonl') as LineaPorciones[];
  const porR = new Map<number, number>();
  const buckets = new Set<string>();
  let cota = 0;
  let inactivos = 0;
  let sodio = 0;
  let pesoNulo = 0;
  for (const l of lineas) {
    porR.set(l.r, (porR.get(l.r) ?? 0) + 1);
    buckets.add(l.salida.bucket);
    if (l.flags['cotaActiva']) cota++;
    if (l.flags['algunNutrienteInactivo']) inactivos++;
    if (l.flags['sodioAcotado']) sodio++;
    if (l.flags['pesoTotalNulo']) pesoNulo++;
  }
  for (let r = 1; r <= 6; r++) {
    assert.ok((porR.get(r) ?? 0) > 0, `sin instancias con R=${r}`);
  }
  for (const b of ['ok', 'aceptable', 'malo']) {
    assert.ok(buckets.has(b), `sin instancias en el bucket ${b}`);
  }
  assert.ok(cota > 0, 'sin instancias con σ pegado a una cota');
  assert.ok(inactivos > 0, 'sin instancias con nutrientes desactivados');
  assert.ok(sodio > 0, 'sin instancias con el sodio acotado');
  // pesoTotal = 0 es la rama en que `errorDe` devuelve 0,0 sin mirar nada más.
  assert.ok(pesoNulo > 0, 'sin instancias con todos los nutrientes inactivos');
});

test('el manifiesto ata el volcado a una versión concreta del catálogo', opciones, () => {
  const m = JSON.parse(readFileSync(join(DIR_VOLCADO, 'manifiesto.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  // Sin la versión del catálogo, comparar un volcado viejo contra un catálogo
  // nuevo produce fallos de paridad inexplicables.
  assert.match(String(m['versionCatalogo']), /^[0-9a-f]{16}$/);
  assert.equal(m['pasoRacion'], PASO_RACION);
  assert.equal(m['infBanda'], INF_BANDA);
  const porciones = m['porciones'] as Record<string, number>;
  assert.ok((porciones['total'] ?? 0) >= 2000);
});
