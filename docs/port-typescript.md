# Port del motor a TypeScript
Documento generado por la auditoría multiagente del 2026-08-15. Es la
especificación contra la que se implementa `packages/motor`. Si el código y
este documento discrepan, gana el código y se corrige aquí.

## Decisiones de arquitectura

### Sustitución de HiGHS: descenso coordinado sobre la rejilla de 0,05 minimizando la MISMA función objetivo del LP, J(σ) = W·E(σ) + EPS_REG·Σ|σᵢ−σrefᵢ|, con vecindad de pares (2-opt) y multiarranque determinista, detrás de una interfaz síncrona `ResolverPorciones` sustituible.

**Por qué.** Python NO es óptimo sobre el conjunto que devuelve: resuelve el LP continuo y luego cuantiza a la rejilla (`_cuantizar`), reparando después una sola coordenada y sólo si kcal se sale de banda. La brecha de redondeo es del orden de dE≈0,009 sobre un umbral de aceptación de 0,04 (20-25 % del presupuesto de error), precisamente porque el óptimo del LP reposa sobre el borde de banda. Es decir: Python y el port son dos heurísticas sobre la misma rejilla finita, y la nuestra optimiza directamente la magnitud que se devuelve. El LP es de juguete (≤22 columnas, ≤16 filas) pero masivamente degenerado por diseño (DISENO §3.2), y R≤5 con ≤26 puntos por coordenada hace que el problema real sea discreto, no continuo. Cuesta ~150 LOC, cero dependencias, cero KB de bundle, cero inicialización asíncrona en el camino crítico, y es determinista por construcción (sin RNG, sin pivoteo, sin tolerancias de solver). Multiarranque fijo: Q(σref), escala uniforme de emergencia, todo-lo, todo-hi; desempate total por (J, E, orden lexicográfico de σ).

**Descartado.** (a) Símplex de variables acotadas propio: 400-600 LOC, 3-5 días, y es el mayor riesgo de corrección del port entero — símplex artesanal sobre un LP degenerado es el escenario clásico de ciclado, y encima sigue necesitando la cuantización posterior, que es donde está la brecha real. Además la unicidad del óptimo con el regularizador NO está demostrada (sólo verificada empíricamente en un caso), así que ni siquiera garantiza paridad. (c) highs-js / glpk.js WASM: ~1-2 MB estimados (SIN verificar) para un LP de 22 columnas sobre GitHub Pages, más inicialización asíncrona. Se conserva como plan B explícito detrás de la interfaz, con puerta de decisión pre-registrada (ver estrategia de pruebas). (c-bis) jsLPSolver/YALPS: robustez dudosa ante degeneración.

### Sustitución del árbol de RNG de numpy: árbol propio. `rngDe(seed: bigint, ...ruta: number[])` deriva el estado con SplitMix64 sobre una mezcla determinista de (seed_le64 ‖ ruta_le32…) y alimenta xoshiro256++ implementado con pares de Uint32 (sin BigInt en el camino caliente). Interfaz de tres métodos: `random()`, `integers(n)`, `choice(n, p)`. Rutas idénticas a Python: (RUTA_A, dia, kCand, intento, IDX_SLOT[slot]) y (RUTA_D,).

**Por qué.** Lo que hace falta preservar NO es la secuencia de bits de numpy, sino la propiedad estructural del árbol: nodos distintos → flujos independientes, y el flujo de un nodo no depende de cuántos números consuman los demás. Esa propiedad se consigue con cualquier derivación determinista y bien mezclada. Reproducir la secuencia exigiría reimplementar SeedSequence (mezcla de entropía + spawn_key), PCG64, Lemire-32 con rechazo y el buffer de media palabra uint32 del bit generator — cuatro algoritmos, 150-250 líneas, ninguno documentado en este repositorio — y AUN ASÍ los planes divergirían, porque `Math.exp` y `Math.acos` de V8 no están obligados a coincidir a 1 ULP con la libm de CPython, y una diferencia de 1 ULP voltea la comparación `random() < exp(-Δ/t)` del recocido o el orden del top-K. Perseguir la paridad bit a bit es gastar el presupuesto de riesgo en algo que además no se alcanza. Lo que SÍ se porta literalmente es el consumo: un único sorteo categórico por nodo del árbol en A/C, con los dos atajos que consumen CERO (`cand.length === 1` en `muestrear`, y el cortocircuito `delta < 0 || rng.random() < …` del recocido), y el orden exacto del bucle SA (integers(dTotal) siempre → integers(len) sólo si len>1 → random() sólo si Δ≥0 → `t *= SA_ALFA` fuera de todos los condicionales).

**Descartado.** Reimplementar SeedSequence + PCG64 XSL-RR + el buffer has_uint32 + Lemire (la recomendación del auditor de reparacion-semanal). Descartada por decisión explícita del usuario y por el argumento de exp/acos: la paridad sería falsa incluso con el RNG exacto. `RUTA_DESEMPATE = 2` se porta como constante reservada y no se implementa: no aparece en ningún `rng_de` de todo el servicio.

### Cómo se documenta la promesa de reproducibilidad: `VERSION_GENERADOR = "2.0.0-ts"` (salto de mayor, no de parche), un fichero `packages/motor/REPRODUCIBILIDAD.md` con la promesa literal, y los tres datos (seed, versionCatalogo, versionGenerador) DENTRO del payload de `RespuestaOk`, no en cabeceras.

**Por qué.** La promesa que se puede sostener es: «mismo seed + mismo catálogo (misma `versionCatalogo`) + misma `versionGenerador` + mismo motor JS → el mismo plan, byte a byte del JSON de respuesta». Lo que NO se promete y se escribe explícitamente: (1) que un plan generado por el backend Python se reproduzca en el navegador, y viceversa; (2) que dos motores JS distintos (V8 vs SpiderMonkey) den el mismo plan, porque `Math.exp`/`Math.acos` no están especificados a 1 ULP — dentro de un mismo motor sí es estable, y ese es el caso real de un usuario. El salto de versión mayor es obligatorio: el docstring de `app/solver/__init__.py` impone subir `VERSION_GENERADOR` si cambia cualquier constante, y aquí cambia el RNG entero y el porcionador. Los golden tests de Python NO se traducen: se regeneran contra la implementación TS. Y como en GitHub Pages no hay backend ni cabeceras HTTP (`X-PlanEat-Seed` desaparece), sin mover esos tres datos al payload un plan guardado deja de ser reproducible, que es exactamente el fallo «indepurable en soporte» contra el que avisa `main.py:76-80`.

**Descartado.** Dejar `VERSION_GENERADOR` en "1.0.0" y tratar el port como equivalente: mentiría sobre planes guardados. Persistir el seed sólo en localStorage: no sobrevive a compartir el enlace; se codifica además en la query de `/plan` para que el plan sea regenerable desde la URL.

### Representación de datos: struct-of-arrays con typed arrays y stride, NUNCA arrays de objetos. `Float32Array` para lo que numpy tiene en float32 (nutr(n×6), vMacro(n×3), escalaMin/Max, y el array de score); `Float64Array` para lo que numpy ensancha a float64 (residuo, objetivoVec, sigma, totales, bandas, probabilidades del softmax). Máscaras booleanas de pocas columnas (mDieta 6, mAlergeno 14, mSlot 5) colapsadas a un entero por fila. Bitsets de ingredientes en `Uint32Array` con W32 = ceil(nAlimentos/32) y popcount SWAR de 32 bits. Catálogo precompilado en build a JSON columnar y embebido en el bundle.

**Por qué.** Cuatro razones concretas. (1) Rendimiento: `scoreSlot` se ejecuta 300-670 veces por semana y cada llamada hace dos popcounts sobre P×W y un matvec (P,3)·(3,); con `BigUint64Array` o con arrays de objetos esto pasa de decenas de ms a segundos. JS no tiene `np.bitwise_count` y las operaciones bitwise sobre BigInt son ~10× más lentas. (2) Float32Array no es cosmético: mantiene el orden del top-K en la misma clase de empates que Python y hace que `.astype(np.float32)` del score final tenga un equivalente natural (escribir a un Float32Array redondea). NO se aplica `Math.fround` en cada operación intermedia: no da paridad de todas formas (acos/exp) y cuesta rendimiento; se aplica sólo en los puntos donde Python materializa un float32. (3) El catálogo compilado son 4,2 KB de matrices con 36 recetas (~10 KB con 80): cabe entero en memoria y en el bundle (≈3,3 KB gzip el catálogo + ≈1 KB el mapa de nombres). (4) Precompilarlo elimina los dos puntos donde el navegador podría divergir del build: el `sorted()` del vocabulario de alimentos y el cálculo de `v_macro`. El vocabulario se emite YA ordenado desde el compilador y el navegador sólo lo consume.

**Descartado.** `BigUint64Array` para replicar los uint64 de numpy (lento, y obliga a `BigInt.asUintN` en el bucle caliente). `number[]` planos (sin control de precisión, peor localidad, y el motor de JS los deoptimiza en cuanto hay huecos). Servir el catálogo por `fetch`: cuesta un RTT completo, añade un estado de carga y un modo de fallo, y `fetch('/data/...')` se rompe bajo `basePath: '/PlanEat'`. Nota: al pasar de palabras de 64 a 32 bits hay que ajustar el dimensionado del contador de ingredientes únicos (`semanal.py:239` usa `bits.shape[1]*64` → `*32`).

### Web Worker: SÍ, obligatorio y desde el primer día. Un único worker de módulo (`new Worker(new URL('./motor.worker.ts', import.meta.url), { type: 'module' })`), catálogo enviado una vez con `ArrayBuffer` transferibles, mensaje de progreso por día, cancelación por token + `terminate()`. Se expone además un camino síncrono (`generar()` directo) para tests en Node y como respaldo.

**Por qué.** El coste medido/estimado es 120-250 ms con P=1.500 y 300-800 ms con P=5.000, es decir 7-50 frames de hilo principal bloqueado. Sin worker: (1) no se puede ni repintar el estado de generación, que es la pantalla cuya única razón de ser es informar mientras se espera; (2) el corte de seguridad de 20 s (`MS_LIMITE_GENERACION`) es inaplicable porque no hay hilo libre para dispararlo; (3) no hay cancelación cuando el usuario cambia un filtro. Con worker se obtienen las tres cosas y, además, los cuatro pasos de `estado-generacion.tsx` dejan de estar cableados (`hecho = indice === 0`) y pasan a ser honestos por primera vez. NO se necesita `SharedArrayBuffer` (GitHub Pages no puede enviar COOP/COEP) ni paralelismo: la etapa D es intrínsecamente secuencial por `bits_semana`, y los días DEBEN generarse en orden.

**Descartado.** Ejecutar en el hilo principal y trocear con `setTimeout`/`scheduler.yield`: rompe el estado mutable compartido entre días y no da cancelación limpia. Paralelizar los 42 candidatos en varios workers: los días están acoplados por `ctx.bits_semana`, `ctx.veto_semana` y `ctx.veto_slot`; paralelizar cambia el plan.

### Divergencias conscientes respecto de Python, todas registradas en `packages/motor/DIVERGENCIAS.md` con test que las fija: (1) rejilla unificada anclada en 0; (2) `redondeoMitadAPar` propio para `cuantizar` y `fmt0`; (3) se corrige la segunda llamada a `diagnosticarPool` (pasar los slots realmente flojos, no `porSlot` completo); (4) `_tres` garantiza tres sugerencias DISTINTAS con tres rellenos genéricos distintos; (5) `W_AFIN = 0.0` y rango real del score [−3,5 ; 8,7].

**Por qué.** (1) `_cuantizar` ancla la rejilla en 0 (múltiplos de 0,05) y `_rejilla` la ancla en `lo`: con un `escalaMin` que no sea múltiplo de 0,05, `_pulir_una` puede devolver un σ que `_cuantizar` nunca produciría. Hoy no se ve porque todo el catálogo usa 0,6/1,8, pero es una bomba. Se unifica en la anclada en 0 (múltiplos de 0,05 clipados a [lo,hi], más lo y hi como puntos admisibles). (2) `np.round` es bancario (half-to-even) y `Math.round` es half-away-from-zero; `:.0f` de Python tampoco es `toFixed(0)`, y hay tests que parsean los números de las sugerencias con regex. (3) `motor.py:282` pasa `por_slot` COMPLETO como `slots_flojos`, dict que nunca está vacío, así que la rama de `slot_sin_candidatos` siempre se dispara y produce mensajes incoherentes («Sólo encuentro 21 recetas para la comida… y necesito al menos 8»). En Pages, con catálogo corto, este camino se verá mucho: se corrige. (4) `_tres` deduplica en el bucle pero el `while` de relleno final no, y hay un test que exige `len(set(...)) == 3`. (5) DISENO §2.2 escribe 0,8·φ_afin; el código fija 0,0 y §2.2(g) lo confirma. El código manda.

**Descartado.** Portar bug por bug para maximizar la paridad de textos. Descartado en (3) y (4) porque son bugs observables de producto en la pantalla que más se verá en la demo, y la paridad de textos no es un criterio de aceptación (los mensajes se validan contra golden vectors del port, no de Python). En (1) y (2) la divergencia es de comportamiento numérico y se pre-registra en el arnés de paridad para que no se lea como fallo del port.

### Se porta el CÓDIGO, no DISENO.md, en los siete puntos donde divergen; y las tres puertas de §6.0 se portan como una única unidad junto con `diagnostico.ts`.

**Por qué.** Divergencias verificadas: (a) el umbral de fallo por día NO se comprueba en la etapa C sino una sola vez, sobre el peor día, después de la etapa D y de `repararDuras` (`motor.py:299-301`); (b) los `items_bloqueados` de §4.2 no existen en `reparacion.py`; (c) el pseudocódigo del recocido de §5.3 extrae `alt` incondicionalmente y el código real no; (d) el desempate del culpable del diagnóstico es alfabético por clave (clave MAYOR gana), no por orden de inserción de máscaras; (e) `macros_incompatibles` se comprueba el PRIMERO de todo, no el quinto; (f) el código usa `KCAL_MINIMAS_ABSOLUTO = 1200`, no `KCAL_MINIMAS` por sexo (el solver no conoce el sexo); (g) la tabla PLANTILLAS de DISENO describe salidas que el código no genera. Sobre las puertas: si se porta `diagnostico.ts` aislado, el port aplica `MIN_POOL = 40` como umbral absoluto y con el catálogo semilla de 36 recetas rechaza el 100 % de las peticiones culpando al usuario. La puerta 3 (|P| < 40 pero |P| ≥ 0,5·N → se genera igual y se anota `catalogoEstrecho`) es lo que hace utilizable la demo.

**Descartado.** Guiar el port por DISENO.md, que es el documento de diseño y el más legible. Reintroduciría siete bugs. Al terminar el port se anotan las siete divergencias en DISENO.md para que la próxima persona no las reintroduzca.

### Olas de implementación paralela: Ola 0 (sin dependencias, 5 agentes en paralelo): constantes, numerico, rng, compilador de catálogo, volcador de paridad Python. Ola 1 (3 agentes): tipos + extensión del contrato en shared, catalogo, porciones. Ola 2 (3 agentes): pool, scoring, diagnostico. Ola 3 (2 agentes): reparacion, semanal. Ola 4 (1 agente): motor, index, worker, arnés de comparación.

**Por qué.** `porciones.ts` es el módulo más grande y más arriesgado (sustituye a HiGHS) y depende SÓLO de constantes + numerico: puede arrancar en la ola 1 y avanzar en paralelo con todo el resto del motor, que no lo necesita hasta la ola 3. `diagnostico.ts` es el módulo más fácil (no toca LP ni RNG, sólo reducciones booleanas y textos) y depende sólo de pool + catalogo: paralelo total con scoring. `rng.ts` y `numerico.ts` son la base de todo y no dependen de nada, así que van primero y se testean aisladamente. Cada ola se cierra con sus tests verdes antes de abrir la siguiente; ningún agente de una ola toca ficheros de otro agente de la misma ola.

**Descartado.** Un port monolítico en orden de lectura del Python (motor → scoring → …). Serializa el trabajo y deja el riesgo grande (el LP) para el final, que es cuando ya no hay margen para cambiar a highs-js.

## Módulos

Orden de implementación:

1. `packages/motor/src/constantes.ts`
2. `packages/motor/src/numerico.ts`
3. `packages/motor/src/rng.ts`
4. `packages/motor/herramientas/compilar-catalogo.ts`
5. `services/solver/scripts/volcar_paridad.py`
6. `packages/shared/src/types.ts`
7. `packages/motor/src/tipos.ts`
8. `packages/motor/src/catalogo.ts`
9. `packages/motor/src/porciones.ts`
10. `packages/motor/src/pool.ts`
11. `packages/motor/src/scoring.ts`
12. `packages/motor/src/diagnostico.ts`
13. `packages/motor/src/reparacion.ts`
14. `packages/motor/src/semanal.ts`
15. `packages/motor/src/motor.ts`
16. `packages/motor/src/index.ts`
17. `packages/motor/pruebas/paridad/comparar.ts`
18. `packages/motor/src/worker/motor.worker.ts`
19. `packages/motor/src/worker/cliente.ts`

### `packages/motor/src/constantes.ts`

Origen Python: `services/solver/app/solver/__init__.py:1-201 (todo salvo rng_de)`

Vocabulario canónico (las cuatro tuplas), índices derivados y TODAS las constantes numéricas del motor. Es el único sitio donde vive un número mágico.

Depende de: `@planeat/shared (sólo tipos: TipoDieta, Alergeno, SlotComida)`

```ts
export const NUTRIENTES: readonly ['kcal','proteina','carbohidrato','grasa','fibra','sodio'];
export const DIETAS: readonly TipoDieta[]; export const ALERGENOS: readonly Alergeno[]; export const SLOTS: readonly SlotComida[];
export const IDX_KCAL = 0, IDX_PROT = 1, IDX_CARB = 2, IDX_GRASA = 3, IDX_FIBRA = 4, IDX_SODIO = 5;
export const IDX_DIETA: Readonly<Record<TipoDieta, number>>;
export const IDX_ALERGENO: Readonly<Record<Alergeno, number>>;
export const IDX_SLOT: Readonly<Record<SlotComida, number>>;
export const PESO_SLOT: Readonly<Record<SlotComida, number>>;
export const W_FIT: 4.0, W_ESC: 2.0, W_DESP: 1.5, W_SOL: 1.2, W_AFIN: 0.0, W_COST: 1.5, W_REP: 2.0;
export const DECAIMIENTO_REPETICION: 0.85, FRACCION_MINIMA_PRECIOS: 0.80, TOP_K: 25, TAU_MIN: 0.12, TAU_MAX: 1.5, VARIEDAD_POR_DEFECTO: 45;
export const PESOS_LP: readonly (readonly [number, number])[];  // orden = NUTRIENTES
export const EPS_REG: 1e-3, UMBRAL_ERROR_OK: 0.04, UMBRAL_ERROR_ACEPTABLE: 0.12, PASO_RACION: 0.05,
  ESCALA_MIN_POR_DEFECTO: 0.6, ESCALA_MAX_POR_DEFECTO: 1.8, INF_BANDA: 1.0e30;
export const MAX_INTENTOS_REPARACION: 3, FACTOR_TEMPERATURA_REINTENTO: 0.25;
export const K_CANDIDATOS_DIA: 6, LAMBDA_INGREDIENTES: 0.006, MU_PRESUPUESTO: 0.30, NU_REPETICION: 0.05,
  MAX_USOS_RECETA_SEMANA: 2, SA_T0: 0.05, SA_ALFA: 0.994, SA_ITERACIONES: 400;
export const MIN_POOL: 40, MIN_CANDIDATOS_SLOT_DIA: 3, MIN_CANDIDATOS_SLOT_SEMANA: 8,
  FRACCION_POOL_ATRIBUIBLE: 0.5, N_SUGERENCIAS: 3, KCAL_MINIMAS_ABSOLUTO: 1200, FRACCION_MINIMA_FIBRA: 0.80,
  SIN_LIMITE_MINUTOS: 32767;
export const RUTA_A = 0, RUTA_D = 1, RUTA_DESEMPATE = 2;
export const VERSION_GENERADOR = '2.0.0-ts';
export const MS_LIMITE_GENERACION = 20_000;
export function temperatura(variedad: number): number;
```

**Notas de port.** El ORDEN de las cuatro tuplas es contrato, no estilo: es el orden de columnas de todas las matrices del catálogo, y en SLOTS es además el último componente de la ruta del árbol de RNG y el desempate de `ordenDeSlots`. Declararlas `as const` y derivar los IDX_* de ellas. Copiar la regla operativa del docstring de Python al fichero: cambiar cualquier constante obliga a subir VERSION_GENERADOR. W_AFIN es 0.0 (el 0,8 de DISENO §2.2 es un error del documento); rango real del score [−3,5 ; 8,7]. `temperatura(v) = TAU_MIN * (TAU_MAX/TAU_MIN)**(v/100)`; NO clampa v en Python — aquí se clampa a [0,100] porque la API puede exponerlo. INF_BANDA se queda en 1.0e30 literal, no Infinity: las comparaciones son `hi < 1e30` y el normalizador `e_n` depende de la finitud. No portar el truco de `__all__` por introspección. MIN_CANDIDATOS_SLOT_SEMANA=8 y la holgura 4 son redundantes entre sí (8 − ceil(7/2)): documentarlo.

### `packages/motor/src/numerico.ts`

Origen Python: `operaciones numpy dispersas en scoring.py, porciones.py, semanal.py, diagnostico.py`

Todos los primitivos que numpy regala y JS no tiene: popcount sobre bitsets Uint32, redondeo bancario, formato :.0f de Python, desviación típica poblacional, comparadores y ordenaciones deterministas, OR/AND de bitsets.

```ts
export function popcount32(x: number): number;
export function popcountAnd(a: Uint32Array, offA: number, b: Uint32Array, offB: number, w: number): number;
export function orEnSitio(dst: Uint32Array, offDst: number, src: Uint32Array, offSrc: number, w: number): void;
export function bitsAIndices(bits: Uint32Array, off: number, w: number, salida: Int32Array): number;
export function redondeoMitadAPar(x: number): number;
export function fmt0(x: number): string;               // equivalente a f'{x:.0f}'
export function desviacionPoblacional(v: Float64Array, n: number): { media: number; desv: number };
export function comparaId(a: string, b: string): number;   // por code point, no por code unit
export function ordenarPorScoreEId(idx: Int32Array, n: number, score: Float32Array, ids: readonly string[]): void;
export function argsortEstableDesc(v: Float64Array, n: number): Int32Array;
export function clamp(x: number, lo: number, hi: number): number;
```

**Notas de port.** popcount SWAR clásico de 32 bits, JAMÁS BigInt: se ejecuta P×W veces por `scoreSlot` y hay ~500 llamadas por semana. `desviacionPoblacional` divide por n (ddof=0), no por n−1: es el error por defecto de casi toda librería de JS y cambiaría TODAS las probabilidades del softmax sin dar síntoma. `comparaId` itera con `for...of` (code points) para no divergir de Python fuera del BMP; los 36 ids actuales son ASCII, así que hoy da igual, pero se añade validación de ASCII al cargar catálogo. `bitsAIndices` usa `31 - Math.clz32(v & -v)` sobre palabras de 32 bits, no `(v & -v).bit_length()` de Python. `redondeoMitadAPar` replica `np.round` (half-to-even). `fmt0` NO es `toFixed(0)`. `argsortEstableDesc` se usa sólo para `-kappa` en la etapa C, donde importa el primer elemento no vetado y el desempate por índice de slot ascendente.

### `packages/motor/src/rng.ts`

Origen Python: `services/solver/app/solver/__init__.py:167-192 (rng_de) + el modelo de consumo de scoring.py:436 y semanal.py:262-291`

Árbol de generadores reproducible: (seed, ruta) → flujo independiente. Tres métodos, nada más. Generación y serialización de semillas de 63 bits.

```ts
export interface Rng { random(): number; integers(n: number): number; choice(n: number, p: Float64Array): number; }
export function rngDe(seed: bigint, ...ruta: number[]): Rng;
export function semillaAleatoria(): bigint;          // 63 bits vía crypto.getRandomValues
export function semillaDesdeTexto(s: string): bigint; // lanza si no es entero decimal en [0, 2^63)
export function semillaATexto(s: bigint): string;
export function contadorDeSorteos(r: Rng): number;    // sólo para tests
```

**Notas de port.** Derivación: estado = SplitMix64 sembrado con la mezcla de (seed como dos u32 ‖ cada componente de ruta como u32), y de ahí las cuatro palabras de xoshiro256++ implementado con pares de Uint32 (sin BigInt en el camino caliente; BigInt sólo en la API de la semilla). `random()` = (u64 >>> 11) * 2^-53. `integers(n)` = rechazo enmascarado sobre 32 bits (documentar el algoritmo elegido: es normativo del port, no de numpy). `choice(n, p)` = CDF acumulada normalizada por el último elemento + un único `random()` + búsqueda `side='right'`: exactamente un doble uniforme, igual que numpy. El seed de 63 bits NO cabe en un Number (2^53−1): se usa `bigint` internamente y string decimal en el contrato y en la URL. Un round-trip por Number pierde precisión en silencio y es justo el bug que toda la disciplina de semillas intenta evitar: hay test de round-trip obligatorio. RUTA_DESEMPATE existe como constante y no se usa en ninguna parte.

### `packages/motor/herramientas/compilar-catalogo.ts`

Origen Python: `services/solver/app/catalogo.py:36-212 (cargar_catalogo) + scripts/construir_catalogo.py`

Script de BUILD (Node, fuera del bundle) que lee catalogo.jsonl + ingredientes.json y emite el catálogo ya compilado en JSON columnar más la vista de presentación para la UI.

Depende de: `packages/motor/src/constantes.ts`

```ts
// CLI: npm run catalogo:build
// emite packages/motor/datos/catalogo.compilado.json  (motor)
// emite packages/motor/datos/catalogo.presentacion.json (UI)
export interface CatalogoSerializado {
  version: string; n: number; nAlimentos: number; w32: number;
  ids: string[]; nutr: number[]; conocido: number[]; vMacro: number[]; tieneMacro: number[];
  escalaMin: number[]; escalaMax: number[]; mDieta: number[]; mAlergeno: number[]; mSlot: number[];
  minutos: number[]; ingrBits: number[]; ingrPerecBits: number[]; nIngredientes: number[];
  alimentoId: string[]; costeCents: number[]; costeConocido: number[];
  vocabulario: { nutrientes: string[]; dietas: string[]; alergenos: string[]; slots: string[] };
}
export function compilar(jsonl: string, ingredientes: unknown): CatalogoSerializado;
```

**Notas de port.** ÚNICO fichero del paquete que puede usar node:fs, y vive fuera de src/ con su propio tsconfig, excluido del entry del paquete. Emite el vocabulario de alimentos YA ordenado (`sorted()` sobre los ids presentes en el jsonl: hoy 66, no los 73 de ingredientes.json) y `vMacro` YA calculado con la kcal de Atwater (4P+4C+9G), no la declarada: son los dos únicos puntos donde el navegador podría divergir del build, y se eliminan de raíz. `version` = sha256 del jsonl truncado a 16 hex, calculado aquí, nunca en el navegador. Bitsets emitidos con W32 = ceil(nAlimentos/32), no W64. Incluye el bloque `vocabulario` para que el runtime pueda fallar ruidosamente si el catálogo se compiló con otro orden de tuplas. Valida que todos los ids de receta y de alimento son ASCII. La vista de presentación conserva `titulo`, `racionesBase` y `revisadaPor`, que el motor no carga y la UI sí necesita.

### `services/solver/scripts/volcar_paridad.py`

Origen Python: `nuevo, sobre app/solver/porciones.py, scoring.py y diagnostico.py`

Script Python que vuelca a JSONL las entradas y salidas de las funciones puras y de ≥2.000 instancias reales de la etapa B, para que el arnés TS las compare sin depender del RNG.

```ts
// CLI: python scripts/volcar_paridad.py --salida ../../packages/motor/pruebas/datos/
// emite: funciones-puras.jsonl, etapa-b.jsonl, diagnostico.jsonl, catalogo-compilado.json
```

**Notas de port.** Imprescindible aislar la etapa B: las selecciones de receta se INYECTAN desde el volcado (a, lo, hi, sigmaRef, objetivo, activos, bandas ya calculadas), porque comparar planes de extremo a extremo no valida nada mientras el RNG sea distinto por decisión. Cubrir R=1..5, nutrientes desactivados, cotas activas y objetivos inalcanzables. Volcar también `bandas` y `activos` ya resueltos: si el port de `nutrientesActivos` difiere, E_ts y E_py dejan de ser comparables aunque el porcionado sea correcto. Serializar todos los flotantes con `repr()` (17 dígitos) para no perder bits en el JSON.

### `packages/shared/src/types.ts`

Origen Python: `services/solver/app/schemas.py:47-97`

Extensión del contrato: añadir a RespuestaOk los tres datos que viajaban en cabeceras HTTP y partir PanelNutricional en dos tipos con semánticas distintas.

```ts
export interface RespuestaOk { ok: true; dias: DiaPlan[]; msTranscurridos: number;
  seed: string;              // decimal, 63 bits, NO number
  versionCatalogo: string; versionGenerador: string; pool: number; catalogoEstrecho: boolean; }
export interface PanelPor100g { /* el actual, con salG?, azucaresG? */ }
export interface TotalesNutricionales { kcal: number; proteinaG: number; carbohidratoG: number; grasaG: number; fibraG: number | null; sodioMg: number | null; }
export interface ComidaPlan { slot: SlotComida; items: ItemPlan[]; totales: TotalesNutricionales; }
export interface DiaPlan { fecha: string; comidas: ComidaPlan[]; totales: TotalesNutricionales; objetivo: ObjetivoNutricional; }
```

**Notas de port.** Cambio deliberado de contrato, no un descuido: sin backend no hay cabeceras `X-PlanEat-*` y sin esos tres campos un plan guardado deja de ser reproducible. `seed` es STRING decimal porque 63 bits no caben en un Number. `PanelNutricional` estaba reutilizado con dos semánticas incompatibles (por 100 g vs totales del día) y `bloque-nutricional.tsx:159` ya lee `totales.salG`, que el solver nunca emite: se parte en dos y se añade `sodioMg` a los totales (el motor ya lo calcula en la columna 5 y lo tiraba). Alinear también la opcionalidad divergente en los 7 campos detectados (`toleranciaKcal`, `fibraMinG`, `dieta`, `alergenosExcluidos`, `ingredientesExcluidos`, `comensales`, `bloqueado` tienen default en pydantic y son requeridos en TS; `despensaAlimentoIds` y `recetasRecientes` van al revés). Si se quiere mantener la paridad de tests con Python, replicar el cambio en schemas.py.

### `packages/motor/src/tipos.ts`

Origen Python: `services/solver/app/schemas.py + las dataclasses de scoring.py, reparacion.py, semanal.py, porciones.py`

Tipos internos del motor (Pool, Contexto, CandidatoDia, Bandas, ResultadoPorcionado, Traza, Progreso) y re-export de los tipos de dominio de @planeat/shared. No duplica ni un tipo de shared.

Depende de: `@planeat/shared`, `packages/motor/src/constantes.ts`

```ts
export type { SolicitudGeneracion, RestriccionesGeneracion, ObjetivoNutricional, RespuestaGeneracion, RespuestaOk, FalloGeneracion, SlotComida, TipoDieta, Alergeno, DiaPlan, ComidaPlan, ItemPlan } from '@planeat/shared';
export interface Traza { seed: string; pool: number; msTotal: number; msPool: number; msGeneracion: number; msEnsamblado: number; duplicados: number; erroresPorDia: number[]; intentosReparacion: number; porcionadosDeEmergencia: number; reparacionesDuras: number; terminosDesactivados: string[]; catalogoEstrecho: boolean; }
export interface Progreso { etapa: 'objetivos' | 'pool' | 'porcionado' | 'cuadre'; dia: number; deDias: number; titulos?: string[]; }
```

**Notas de port.** packages/shared es la fuente de verdad del dominio: prohibido redefinir SlotComida, TipoDieta, Alergeno o RespuestaGeneracion aquí. Lo que sí vive aquí son las estructuras que en Python son dataclasses privadas del solver. `Traza` deja de ir a un log de servidor: se devuelve al llamante para que la UI pueda exponerla en un modo diagnóstico — para «validar el funcionamiento real», que es el objetivo del despliegue, enseñarla vale más que perderla. `Progreso` es el contrato del worker con `estado-generacion.tsx`, atado a las cuatro etapas reales.

### `packages/motor/src/catalogo.ts`

Origen Python: `services/solver/app/catalogo.py:36-212`

Decodificar el JSON columnar del build a typed arrays y validar que el catálogo es compatible con el vocabulario compilado en constantes.ts.

Depende de: `packages/motor/src/constantes.ts`, `packages/motor/src/tipos.ts`

```ts
export interface CatalogoCompilado {
  version: string; n: number; nAlimentos: number; w32: number;
  ids: readonly string[]; idxPorId: Map<string, number>;
  nutr: Float32Array;        // n*6, row-major
  conocido: Uint8Array;      // n*6
  vMacro: Float32Array;      // n*3, norma L2 = 1
  tieneMacro: Uint8Array; escalaMin: Float32Array; escalaMax: Float32Array;
  mDieta: Uint8Array;        // bitmask de 6 bits por fila
  mAlergeno: Uint16Array;    // bitmask de 14 bits por fila
  mSlot: Uint8Array;         // bitmask de 5 bits por fila
  minutos: Int16Array; ingrBits: Uint32Array; ingrPerecBits: Uint32Array; nIngredientes: Int16Array;
  alimentoIdx: Map<string, number>; alimentoId: readonly string[];
  costeCents: Int32Array; costeConocido: Uint8Array;
}
export function cargarCatalogo(datos: CatalogoSerializado): CatalogoCompilado;
export function transferibles(cat: CatalogoCompilado): ArrayBuffer[];
```

**Notas de port.** Invariante maestro que hereda del Python: todos los arrays están alineados por índice de fila; la fila i es la misma receta en todos. `cargarCatalogo` LANZA si `datos.vocabulario` no coincide exactamente con las cuatro tuplas de constantes.ts (protege contra el fallo silencioso más caro del port). NO recalcula el vocabulario de alimentos ni vMacro: los consume del build. Las máscaras de pocas columnas van colapsadas a bitmask por fila, así el filtro base del pool es un único bucle. `transferibles` devuelve los ArrayBuffer para pasar el catálogo al worker sin copiarlo. No hay caché con TTL ni cerrojo: el catálogo es estático en el bundle.

### `packages/motor/src/porciones.ts`

Origen Python: `services/solver/app/solver/porciones.py:39-377 (íntegro, con resolver_porciones reimplementado)`

Etapa B: bandas, error nutricional E, culpabilidad, y el porcionador que sustituye a HiGHS por descenso coordinado sobre la rejilla de 0,05.

Depende de: `packages/motor/src/constantes.ts`, `packages/motor/src/numerico.ts`

```ts
export interface Bandas { lo: Float64Array; hi: Float64Array; wMas: Float64Array; wMenos: Float64Array; e: Float64Array; pesoTotal: number; }
export interface ResultadoPorcionado { sigma: Float64Array; totales: Float64Array; error: number; emergencia: boolean; }
export type ResolverPorciones = (a: Float64Array, r: number, lo: Float64Array, hi: Float64Array, sigmaRef: Float64Array, bandas: Bandas) => ResultadoPorcionado;
export function bandasDe(objetivo: ObjetivoNutricional, activos: Uint8Array | null): Bandas;
export function desviaciones(totales: Float64Array, bandas: Bandas): { uMas: Float64Array; uMenos: Float64Array };
export function errorDe(totales: Float64Array, bandas: Bandas): number;
export function culpabilidad(a: Float64Array, r: number, sigma: Float64Array, totales: Float64Array, bandas: Bandas): Float64Array;
export function cuantizar(sigma: Float64Array, lo: Float64Array, hi: Float64Array): Float64Array;
export function rejilla(lo: number, hi: number): Float64Array;
export function pulirUna(a: Float64Array, r: number, sigma: Float64Array, lo: Float64Array, hi: Float64Array, bandas: Bandas, j: number): Float64Array;
export function porcionadoDeEmergencia(a: Float64Array, r: number, lo: Float64Array, hi: Float64Array, bandas: Bandas): ResultadoPorcionado;
export function objetivoJ(a: Float64Array, r: number, sigma: Float64Array, sigmaRef: Float64Array, bandas: Bandas): number;
export const resolverPorcionesRejilla: ResolverPorciones;
```

**Notas de port.** `a` es (6, R) en row-major (6 filas de nutriente × R recetas), igual que Python. `bandasDe`: el normalizador e_n se calcula DESPUÉS de aplicar `activos`; fibra tiene L siempre finito (0.0 si no hay fibraMinG) salvo que esté inactiva; INF es 1e30, no Infinity. `errorDe` devuelve 0.0 si pesoTotal ≤ 0 (todos los nutrientes inactivos): replicar literalmente, pero exponer en la traza cuántos nutrientes están activos para que la validación en Pages no confunda «sin datos» con «objetivo alcanzado». `culpabilidad` normaliza por e_n DOS veces (el término efectivo lleva e_n²): replicar literalmente. `pulirUna` desempata con `<` estricto recorriendo la rejilla ascendente, igual que `np.argmin` (empate → el σ más bajo). El nuevo `resolverPorcionesRejilla`: multiarranque {Q(σref), escala uniforme de emergencia, todo-lo, todo-hi}, descenso coordinado cíclico j=0..R−1 minimizando J = pesoTotal·E + EPS_REG·Σ|σ−σref| aceptando sólo mejoras estrictas, y si tras estancarse E > 0,04, barrido de pares (≤26×26 por par, C(5,2)=10 pares). Devolver SIEMPRE totales = A·σ_final y error = errorDe puro (sin el regularizador). Invariante contractual repetido tres veces en el Python: mentir aquí es el bug que hace que la suma de la UI no cuadre con lo que muestra por comida. `porcionadoDeEmergencia` se conserva como red para R=0 o `a` degenerada, pero deja de dispararse por time_limit: el contador diagnóstico pierde su significado y se sustituye por «nº de instancias que terminaron con E > 0,12» y «nº de veces que hizo falta el barrido de pares». Rejilla unificada anclada en 0 (ver decisión de divergencias).

### `packages/motor/src/pool.ts`

Origen Python: `services/solver/app/solver/scoring.py:41-180 (Pool, _idx_base, bits_de, topes_por_slot, construir_pool)`

Etapa 0: materializar una copia contigua de las filas del catálogo que pasan los filtros duros, con caché de nivel 1.

Depende de: `packages/motor/src/catalogo.ts`, `packages/motor/src/constantes.ts`, `packages/motor/src/numerico.ts`

```ts
export interface Pool { p: number; w32: number;
  idx: Int32Array; mapaFila: Int32Array; ids: readonly string[];
  nutr: Float32Array; conocido: Uint8Array; vMacro: Float32Array; tieneMacro: Uint8Array;
  escalaMin: Float32Array; escalaMax: Float32Array; mSlot: Uint8Array; minutos: Int16Array;
  bits: Uint32Array; nIngr: Int16Array; costeCents: Int32Array; costeConocido: Uint8Array; }
export function construirPool(cat: CatalogoCompilado, restr: RestriccionesGeneracion): Pool;
export function bitsDe(cat: CatalogoCompilado, alimentoIds: readonly string[]): Uint32Array;
export function topesPorSlot(restr: RestriccionesGeneracion): Record<SlotComida, number>;
export function invalidarCachePool(): void;
```

**Notas de port.** El pool es una COPIA contigua, no una indirección: se materializa una vez por petición y luego cada slot hace recorridos contiguos. `mapaFila` es (N,) int32 con −1 para las filas fuera del pool. Nivel 1 (cacheable por versión+dieta+alérgenos ordenados+tope global): dieta AND NOT alérgenos AND minutos ≤ tope_global, donde tope_global = max(topes[s]) — cota LAXA a propósito; el tope de minutos es POR SLOT y se aplica dentro de `scoreSlot`. Confundirlo es el bug clásico de «filtrar el pool entero por el límite del desayuno y quedarse sin cenas». Nivel 2 sin cachear: popcount(bits & bitsExcluidos) == 0. `topesPorSlot` rellena LOS CINCO slots con SIN_LIMITE_MINUTOS (32767 = máx. de int16), no sólo los pedidos. `bitsDe` ignora en silencio los ids de alimento desconocidos. La caché es un Map sin cerrojo ni TTL (un hilo por worker, catálogo estático); `invalidarCachePool` se mantiene por si se recarga el catálogo.

### `packages/motor/src/scoring.ts`

Origen Python: `services/solver/app/solver/scoring.py:188-514`

Etapa A: contexto de la petición, los siete términos del score, el muestreo softmax con top-K, y el bucle de selección de un día.

Depende de: `packages/motor/src/pool.ts`, `packages/motor/src/rng.ts`, `packages/motor/src/constantes.ts`, `packages/motor/src/numerico.ts`

```ts
export interface Contexto { cuota: Record<SlotComida, number>; topes: Record<SlotComida, number>;
  bitsDespensa: Uint32Array; bitsSemana: Uint32Array; penRep: Float32Array;
  pesoCoste: number; umbralCoste: number; tau: number; costeDesactivadoPor: string | null;
  vetoSemana: Uint8Array | null; vetoSlot: Map<SlotComida, number>;
  despPre: Float32Array; costPre: Float32Array; solPre: Float32Array; }
export function cuotasDe(slots: readonly SlotComida[]): Record<SlotComida, number>;
export function ordenDeSlots(slots: readonly SlotComida[]): SlotComida[];
export function penalizacionRepeticion(cat, pool: Pool, recientes: readonly string[], nSlots: number): Float32Array;
export function contextoDe(cat, pool: Pool, restr, nDias: number, tau: number): Contexto;
export function recalcularSolape(pool: Pool, ctx: Contexto): void;
export function vectorMacro(residuo: Float64Array, salida: Float64Array): boolean;
export function scoreSlot(pool: Pool, ctx: Contexto, slot: SlotComida, residuo: Float64Array, excluidas: Uint8Array, salida: Float32Array): void;
export function muestrear(scores: Float32Array, p: number, ids: readonly string[], tau: number, rng: Rng): number | null;
export function sigmaSugerido(pool: Pool, j: number, residuo: Float64Array, cuota: number): number;
export function seleccionarDia(pool, ctx, objetivoVec: Float64Array, slots, rngPorSlot: (s: SlotComida) => Rng): Map<SlotComida, number> | null;
export function totalesDe(pool: Pool, filas: readonly number[], sigmas: Float64Array): Float64Array;
```

**Notas de port.** Módulo más delicado del port. (1) Admisibilidad ANTES de puntuar: mSlot AND NOT excluidas AND minutos ≤ topes[slot]; luego los vetos de variedad (`vetoSemana`, `vetoSlot`) sólo se aplican SI dejan algo que elegir — es la única restricción del servicio que cede, y cede porque no es de seguridad. (2) `fit` = 1 − (2/π)·acos(clip(cos,−1,1)) sobre vectores unitarios de macro; 0.5 si la receta no tiene macro y 0.5 para TODO el pool si el residuo de macros está cubierto. NO sustituir por coseno crudo: el coseno se comprime contra 1 (σ 0,064 vs 0,106 angular) y el orden del top-K pasaría a depender del ruido. `vectorMacro` clampa a 0 COMPONENTE A COMPONENTE. (3) `esc` es cociente, nunca resta; si el residuo de kcal ≤ 0, η=0 y esc=0 para todo el pool (no 1). Copiar los tres guardas 1e-6: en JS una división por cero da Infinity en silencio. (4) `desp` y `sol` son COBERTURA (popcount / nIngr), no Jaccard. (5) `cost` se apaga entero (pesoCoste=0) si no hay presupuesto o si `mean(costeConocido)` del POOL < 0,80, con motivo 'sin_presupuesto' | 'precios_incompletos' que la UI ya consume. Una receta sin precio tiene coste 0 y sale «gratis»: sesgo real y vigente, NO corregirlo. (6) `penRep`: recorrer `recetasRecientes` con su índice ORIGINAL, saltando los ya vistos SIN decrementar el índice — un duplicado consume posición; deduplicar antes rompe los exponentes. `Math.floor(pos / nSlots)`. (7) OPTIMIZACIÓN obligatoria que Python no hace: `desp` y `cost` no dependen ni del slot ni del residuo (precalcular una vez por petición en `despPre`/`costPre`), y `sol` sólo del día (`recalcularSolape` una vez por día). Reduce el trabajo de popcount ~60×, sin cambiar un bit. (8) `muestrear` se porta paso a paso: top-K sólo si válidos > 25, usando argpartition SÓLO para el VALOR umbral (único sea cual sea la permutación), separando estrictamente-mejores de empatados y recortando los empatados por id ascendente; orden explícito por (−score, id); atajo `cand.length === 1` que devuelve SIN tocar el RNG; z-scores en float64 con desviación POBLACIONAL y clamp 1e-3; softmax estable con clamp de tau a 1e-6. El desempate por id es, según el propio docstring, «el fallo de reproducibilidad más fácil de introducir». (9) `Contexto` es MUTABLE y se muta entre días: no convertirlo en inmutable ni reordenar los días.

### `packages/motor/src/diagnostico.ts`

Origen Python: `services/solver/app/solver/diagnostico.py:42-508`

Fallo honesto: ablación leave-one-out para atribuir la culpa, cotas demostrables del objetivo, y los textos en español con sus exactamente tres sugerencias.

Depende de: `packages/motor/src/pool.ts`, `packages/motor/src/catalogo.ts`, `packages/motor/src/constantes.ts`, `packages/motor/src/numerico.ts`

```ts
export function mascarasRestriccion(cat, restr, slots): Map<string, Uint8Array>;
export function ablacion(mascaras: Map<string, Uint8Array>, n: number): { p0: number; ganancia: Map<string, number> };
export function candidatosPorSlot(pool: Pool, restr, slots): Record<SlotComida, number>;
export function cotasAlcanzables(pool, restr, slots, cuota, kcal): { protMax: number; fibraMax: number; kcalMin: number; sodioMin: number };
export function macrosIncompatibles(objetivo): { malo: boolean; motivo: string };
export function diagnosticarPool(cat, restr, slots, pTotal: number, slotsFlojos: Record<string, number>, minPorSlot: number): FalloGeneracion;
export function diagnosticarObjetivo(pool, cat, restr, slots, cuota, objetivo, alcanzado: Float64Array | null, pTotal: number): FalloGeneracion;
```

**Notas de port.** Módulo sin LP y sin RNG: el más fácil, y el que más contrato de producto contiene. (1) `mascarasRestriccion` devuelve un Map (orden de inserción = el del dict de Python): dieta, alergeno:<a> en el orden canónico de ALERGENOS, ingredientes_excluidos, tiempo:<slot>, slots. (2) El culpable es `max(ganancia, key=(ganancia, clave))`: a igualdad gana la clave alfabéticamente MAYOR — el código manda sobre DISENO.md:1036. Las sugerencias ordenan al revés: (−ganancia, clave MENOR). (3) REGLA NO NEGOCIABLE: `ejesSugeribles` filtra TODOS los ejes `alergeno:*` y los de ganancia ≤ 0. Es un filtro por prefijo en un solo sitio; aislarlo como única puerta de entrada a las sugerencias estructurales y cubrirlo con el test de regex completo como test bloqueante del build. Sugerir a un alérgico que coma el alérgeno es el peor fallo posible del producto. (4) `p0` (de la ablación, con topes por slot y máscara `slots`) y `pTotal` (= pool.p) son magnitudes DISTINTAS y aparecen en el mismo Fallo: los mensajes usan p0, `recetasCandidatas` usa pTotal. No unificarlas. (5) `_kcalSegura` redondea SIEMPRE hacia arriba a múltiplo de 50 y aplica el suelo 1200 (KCAL_MINIMAS_ABSOLUTO; el mapa por sexo NO se usa: el solver no conoce el sexo). La sugerencia de subir kcal sólo se ofrece si ≤ kcal·1,25. (6) Los números de las sugerencias salen del mejor plan REAL (`alcanzado`), no de la cota teórica: si decimos «puedes llegar a 138 g» es porque hay un plan con 138 g. (7) Todos los textos se transcriben LITERALES, con comillas latinas « », tildes, «Sólo» con tilde diacrítica, sin separador de miles, sugerencias sin punto final y mensajes con él. Todas las interpolaciones numéricas pasan por `fmt0`. (8) La rama de sodio exige un 20 % de margen y NO usa `sodioMin`. (9) En `cotasAlcanzables` los slots sin filas se SALTAN (sus cuotas se pierden): replicar.

### `packages/motor/src/reparacion.ts`

Origen Python: `services/solver/app/solver/reparacion.py:42-297`

Etapa C: generar un candidato de día (selección A + porcionado B) y repararlo hasta 3 veces sustituyendo el slot culpable.

Depende de: `packages/motor/src/scoring.ts`, `packages/motor/src/porciones.ts`, `packages/motor/src/rng.ts`, `packages/motor/src/constantes.ts`

```ts
export interface CandidatoDia { slots: SlotComida[]; filas: number[]; sigma: Float64Array; totales: Float64Array; error: number; intentos: number; emergencia: boolean; fibraFiable: boolean; bits: Uint32Array; clave: string; }
export function vectorObjetivo(objetivo: ObjetivoNutricional): Float64Array;
export function nutrientesActivos(pool: Pool, filas: readonly number[], objetivo): { activos: Uint8Array; fibraFiable: boolean };
export function generarCandidatoDia(pool, ctx, objetivo, slots, seed: bigint, dia: number, kCand: number, resolver: ResolverPorciones): CandidatoDia | null;
export function recomponerDia(pool, ctx, objetivo, slotsOrden, filas, intentos, resolver): CandidatoDia;
export function mejorAlternativa(pool, ctx, slot, residuo: Float64Array, excluidas: Uint8Array): number | null;
```

**Notas de port.** (1) `vectorObjetivo` usa el CENTRO de cada banda: [kcal, (protMin+protMax)/2, (carbMin+carbMax)/2, (grasaMin+grasaMax)/2, fibraMinG||0, sodioMaxMg||0]. La etapa A sólo necesita la dirección. (2) `slots` y `filas` del candidato van en orden de SELECCIÓN (cuota descendente), no cronológico: el reordenado a orden de presentación lo hace motor.ts. (3) Ruta de RNG de la selección inicial: (RUTA_A, dia, kCand, 0, IDX_SLOT[slot]), un generador nuevo por slot. (4) Si el error inicial ≤ 0,04 se retorna SIN entrar al bucle. (5) En cada intento k=1..3: kappa = culpabilidad con `a` y `bandas` del ÚLTIMO porcionado; culpable = primer índice de argsort estable de −kappa cuya fila no esté vetada; veto LOCAL al día; residuo del slot culpable recalculado con los σ REALES del LP; tau_k = ctx.tau·(1+0,25k); ruta (RUTA_A, dia, kCand, k, IDX_SLOT[slotCulpable]). Se recalculan `activos`/`bandas` porque la receta nueva puede cambiar la fiabilidad de fibra/sodio, y `refK` reutiliza los σ anteriores como ancla salvo en el slot tocado. Se guarda el mejor con comparación ESTRICTA (empate → gana el k menor). `intentos` es el k en que se encontró el mejor, no el total. (6) UMBRAL_ERROR_ACEPTABLE NO se usa aquí: DISENO §4.2 dice que sí y el código dice que no. Portar el código. (7) Los `items_bloqueados` de DISENO §4.2 NO existen: no inventarlos. (8) `mejorAlternativa` es argmax DETERMINISTA con desempate por id, sin tocar el RNG. (9) `clave` sustituye a `frozenset(filas)`: filas ordenadas ascendentemente y unidas por coma. (10) `nutrientesActivos` desactiva fibra si la fracción de kcal del día con fibra conocida < 0,80, y sodio si no hay sodioMaxMg o algún item no lo tiene conocido.

### `packages/motor/src/semanal.ts`

Origen Python: `services/solver/app/solver/semanal.py:38-387`

Etapa D: K candidatos por día deduplicados, recocido simulado sobre el espacio 6^7, y la pasada final de reparación de restricciones duras.

Depende de: `packages/motor/src/reparacion.ts`, `packages/motor/src/rng.ts`, `packages/motor/src/constantes.ts`, `packages/motor/src/numerico.ts`

```ts
export interface ResultadoSemanal { dias: CandidatoDia[]; costeInicial: number; costeFinal: number; diasSinCandidato: number; }
export function generarCandidatos(pool, ctx, objetivos, slots, seed: bigint, resolver: ResolverPorciones, alCerrarDia?: (d: number, mejor: CandidatoDia) => void): { porDia: CandidatoDia[][]; duplicados: number };
export function ensamblar(pool, porDia: CandidatoDia[][], seed: bigint, presupuestoCents: number | null, comensales: number): ResultadoSemanal;
export function repararDuras(pool, ctx, objetivos, dias: CandidatoDia[], resolver): { dias: CandidatoDia[]; arreglados: number };
```

**Notas de port.** (1) Los días se producen ESTRICTAMENTE EN ORDEN y `ctx` se muta entre ellos en este orden exacto: `vetoSemana = usos >= 2` al empezar el día; al cerrarlo, `bitsSemana |= mejor.bits`, `vetoSlot = zip(mejor.slots, mejor.filas)`, `usos[fila]++`. El día se cierra con su MEJOR candidato provisional (menor error), no con el que elegirá el recocido: por eso `repararDuras` es imprescindible. `alCerrarDia` es el gancho de progreso para el worker. (2) Bucle k de 0 a 2K−1 (12), parando al llegar a 6 aceptados; `null` rompe el bucle; duplicado por `clave` se cuenta y se sigue. (3) `violaDura` compara PARES (slot, fila) codificados como IDX_SLOT[slot]*P+fila en un Set<number>; un día vacío se salta SIN actualizar `previo`, de modo que compara los dos días no vacíos que rodean el hueco: comportamiento de borde a preservar. Debe tolerar combos parciales (la llama el arranque voraz). (4) El bucle SA se porta LÍNEA A LÍNEA: `integers(dTotal)` SIEMPRE; `integers(len)` sólo si len>1; `random()` sólo si Δ≥0 (cortocircuito del `or`); `t *= SA_ALFA` FUERA de todos los condicionales; el contador de ingredientes únicos se muta ANTES de calcular el coste y se deshace en la rama de rechazo; se devuelve `mejor`, no `combo` (el error de implementación más común de SA); `mejor` sólo se actualiza con `<` estricto. Si dTotal ≤ 1 o ningún día tiene más de un candidato, el recocido NO se ejecuta y el RNG de RUTA_D no se crea. (5) `dias` OMITE los días sin candidatos, así que puede ser más corto que `objetivos`: es la señal que motor.ts usa para el fallo de pool. No «arreglarlo» rellenando huecos. (6) `repararDuras` muta el array en sitio y lee `dias[d-1]` YA reparado; `agotadas` se recalcula dentro del bucle interno; se cede el tope semanal ANTES que la regla de días consecutivos (el usuario percibe mucho más «otra vez lo mismo que ayer»); no consume aleatoriedad. (7) El contador de únicos se dimensiona con w32*32, no *64.

### `packages/motor/src/motor.ts`

Origen Python: `services/solver/app/solver/motor.py:1-323 + el saneado de apps/web/src/app/api/plan/route.ts:49-66`

Orquestador: validar, macros incompatibles, las tres puertas del pool, A/B/C/D, umbral de honestidad, serialización al contrato y traza.

Depende de: `packages/motor/src/semanal.ts`, `packages/motor/src/diagnostico.ts`, `packages/motor/src/scoring.ts`, `packages/motor/src/porciones.ts`, `packages/motor/src/rng.ts`, `packages/motor/src/tipos.ts`

```ts
export class ObjetivoInvalido extends Error {}
export interface OpcionesGenerar { hoy?: string; seed?: string; variedad?: number; resolver?: ResolverPorciones; alAvanzar?: (p: Progreso) => void; }
export function minCandidatosSlot(nDias: number): number;
export function validarSolicitud(s: SolicitudGeneracion): void;
export function generar(solicitud: SolicitudGeneracion, cat: CatalogoCompilado, opciones?: OpcionesGenerar): { respuesta: RespuestaGeneracion; traza: Traza };
```

**Notas de port.** (1) Orden exacto: validar → macros incompatibles (algebraico, ANTES de construir el pool: 1 µs frente a ~300 ms) → pool → tres puertas → contexto → generarCandidatos → ensamblar → comprobación de días faltantes → repararDuras → umbral de honestidad sobre el PEOR día → serializar. (2) `minCandidatosSlot(nDias)`: 3 si nDias ≤ 1; si no, min(8, ceil(nDias/2) + 4). (3) Puerta 1: algún slot con menos candidatos que el umbral. Puerta 2: pool < 40 Y pool < 0,5·N. Puerta 3: pool < 40 pero ≥ 0,5·N → SE GENERA IGUAL y se marca `catalogoEstrecho`. Sin la puerta 3, el catálogo semilla de 36 recetas rechazaría el 100 % de las peticiones culpando al usuario de restricciones que no ha puesto. (4) La segunda llamada a `diagnosticarPool` (días faltantes) recibe los slots REALMENTE flojos, no `porSlot` completo: divergencia consciente que corrige un bug de mensajes. (5) El umbral 0,12 se aplica UNA sola vez, sobre el peor día, después de la etapa D. (6) `_diaAContrato` reordena las comidas a orden CRONOLÓGICO por IDX_SLOT, porque el candidato va en orden de selección. (7) El seed: si la solicitud no lo trae, `semillaAleatoria()`; se devuelve SIEMPRE como string decimal junto con versionCatalogo, versionGenerador, pool y catalogoEstrecho. (8) Aquí se absorben los límites de saneado que hoy viven en el route handler de Next (800-6000 kcal, 20-400 g de proteína): son límites de seguridad del producto, no una defensa contra ataques, y deben sobrevivir a la desaparición del servidor. (9) `variedad` NO se cablea al contrato por defecto (se usa VARIEDAD_POR_DEFECTO=45, τ≈0,374) porque exponerlo cambia los planes; queda como opción documentada. (10) `generar` nunca lanza salvo `ObjetivoInvalido`, que el llamante mapea al tercer estado del resultado (objetivo mal formado ≠ sobre-restricción).

### `packages/motor/src/index.ts`

Origen Python: `services/solver/app/main.py:55-111 (la capa HTTP, colapsada a una llamada de función)`

API pública del paquete: la fachada que consume apps/web, con la misma forma de resultado que hoy devuelve src/lib/solver.ts.

Depende de: `packages/motor/src/motor.ts`, `packages/motor/src/catalogo.ts`, `packages/motor/src/rng.ts`

```ts
export { generar, ObjetivoInvalido, minCandidatosSlot, validarSolicitud } from './motor';
export { cargarCatalogo, transferibles } from './catalogo';
export { semillaAleatoria, semillaATexto, semillaDesdeTexto } from './rng';
export { VERSION_GENERADOR, MS_LIMITE_GENERACION } from './constantes';
export { resolverPorcionesRejilla } from './porciones';
export type { CatalogoCompilado, CatalogoSerializado, Traza, Progreso, ResolverPorciones, ResultadoPorcionado } from './tipos';
```

**Notas de port.** Punto de entrada único, sin efectos secundarios y sin importar nada de node:. `main` y `types` del package.json apuntan a `./src/index.ts` igual que @planeat/shared, y apps/web lo añade a `transpilePackages`. `MS_LIMITE_GENERACION` sigue exportándose (20 s) porque es el mismo corte que la interfaz declara al usuario. El paquete NO exporta el catálogo: los datos compilados se importan como JSON desde apps/web para que el bundler los inline y la versión del catálogo quede atada al hash del bundle.

### `packages/motor/pruebas/paridad/comparar.ts`

Origen Python: `services/solver/tests/test_solver.py + scripts/volcar_paridad.py`

Arnés de paridad: corre en Node sobre los JSONL volcados desde Python y emite el informe de las cuatro clases de comparación con su veredicto.

Depende de: `packages/motor/src/porciones.ts`, `packages/motor/src/diagnostico.ts`, `packages/motor/src/scoring.ts`, `packages/motor/src/catalogo.ts`

```ts
// CLI: npm run paridad --workspace @planeat/motor
export interface InformeParidad { funcionesPuras: { total: number; fallos: number[] };
  etapaB: { n: number; p50: number; p95: number; max: number; pctMejorOIgual: number; cambiosDeBucket: number };
  invariantes: { totalesOk: boolean; sigmaEnRejilla: boolean; sigmaEnCotas: boolean };
  veredicto: 'acepta' | 'cambiar-a-highs-js'; }
export function comparar(rutaDatos: string): InformeParidad;
```

**Notas de port.** Implementa la puerta de decisión pre-registrada del porcionador. Nunca compara σ componente a componente (salvo el caso de óptimo único), ni el vértice, ni u⁺/u⁻, ni el flag `emergencia` (en TS deja de dispararse por time_limit). El veredicto 'cambiar-a-highs-js' se dispara automáticamente si p95(E_ts − E_py) > 0,005 o si > 1 % de las instancias cambian de bucket a peor.

### `packages/motor/src/worker/motor.worker.ts`

Origen Python: `n/a (sustituye al proceso FastAPI)`

Worker de módulo que aloja el motor: recibe el catálogo una vez, genera planes, emite progreso y atiende cancelaciones.

Depende de: `packages/motor/src/index.ts`

```ts
// protocolo de mensajes
type AlWorker = { tipo: 'catalogo'; datos: CatalogoSerializado }
  | { tipo: 'generar'; token: number; solicitud: SolicitudGeneracion; opciones?: { hoy?: string; seed?: string } }
  | { tipo: 'cancelar'; token: number };
type DelWorker = { tipo: 'listo' }
  | { tipo: 'progreso'; token: number; progreso: Progreso }
  | { tipo: 'resultado'; token: number; respuesta: RespuestaGeneracion; traza: Traza }
  | { tipo: 'error'; token: number; clase: 'objetivo_invalido' | 'error_motor'; mensaje: string };
```

**Notas de port.** Se instancia desde apps/web con `new Worker(new URL('./motor.worker.ts', import.meta.url), { type: 'module' })` para que el bundler lo resuelva a un asset con hash y respete `basePath: '/PlanEat'`; una ruta absoluta a public/ da 404 en Pages. El catálogo llega por postMessage con ArrayBuffer transferibles (no fetch: evita el RTT y el problema de basePath). El progreso se emite en las cuatro etapas reales (objetivos → pool → porcionado por día → cuadre) usando el gancho `alCerrarDia` de `generarCandidatos`, incluyendo los títulos del mejor candidato provisional para que el compás 3 de la coreografía pueda escribir texto real antes de que la barra cuadre. Cancelación por token: los mensajes de un token obsoleto se descartan; el corte duro de 20 s lo aplica el cliente con `terminate()`.

### `packages/motor/src/worker/cliente.ts`

Origen Python: `apps/web/src/lib/solver.ts:67-160 (misma máquina de estados, sin HTTP)`

Cliente del worker con la MISMA firma que hoy usa la web, para que generador.tsx y vista-plan.tsx sólo cambien el fetch por una llamada.

Depende de: `packages/motor/src/worker/motor.worker.ts`, `packages/motor/src/index.ts`

```ts
export interface ClienteMotor {
  generar(solicitud: SolicitudGeneracion, alAvanzar?: (p: Progreso) => void): Promise<ResultadoPlan>;
  cancelar(): void; destruir(): void; }
export function crearClienteMotor(datos: CatalogoSerializado): ClienteMotor;
export type ResultadoPlan =
  | { estado: 'ok'; respuesta: RespuestaOk; traza: Traza }
  | { estado: 'sobre_restriccion'; fallo: FalloGeneracion }
  | { estado: 'objetivo_invalido'; mensaje: string }
  | { estado: 'sin_servicio'; motivo: 'error_motor' | 'tiempo_agotado' };
```

**Notas de port.** Cuatro estados, no tres: hoy la web colapsa 'objetivo mal formado' y 'avería' en `sin_servicio`, y son cosas distintas con pantallas distintas (la web ya las trata como tales aguas abajo). Los motivos `sin_conexion`, `motor_no_implementado` y `respuesta_ilegible` de `MotivoSinServicio` quedan sin uso: NO borrarlos del tipo sin actualizar `sin-servicio.tsx:21-45`, que tiene un Record exhaustivo. El corte de 20 s sustituye a `AbortSignal.timeout` por `terminate()` + recreación del worker. Si `Worker` no existe (tests en Node, navegador antiguo), el cliente cae a la ejecución síncrona de `generar()` y no emite progreso.

## Riesgos críticos

### Se persigue, por inercia o por presión de «que los tests de Python sigan valiendo», la paridad bit a bit con numpy. Es un pozo de cuatro algoritmos no documentados (SeedSequence, PCG64, Lemire con buffer uint32, Generator.choice) más la emulación de float32, y AUN ASÍ no se alcanza porque Math.exp y Math.acos de V8 no están obligados a coincidir a 1 ULP con la libm de CPython: una diferencia de 1 ULP voltea `random() < exp(-Δ/t)` en el recocido o el orden del top-K, y a partir de ahí el plan diverge por completo.

**Mitigación.** Decisión cerrada y escrita en packages/motor/REPRODUCIBILIDAD.md antes de escribir código: NO se busca compatibilidad de semillas con Python. VERSION_GENERADOR = '2.0.0-ts'. Los golden tests se REGENERAN contra el TS, no se traducen. Los criterios de aceptación son E, bandas e invariantes, nunca igualdad de plan. Cualquier PR que introduzca un test del tipo «mismo plan que Python» se rechaza.

### El descenso coordinado del porcionador se estanca en un mínimo local no global: kcal (peso 3,0) pegada al borde de banda bloquea todo movimiento unidimensional de ±0,05, mientras que un movimiento compensatorio en dos recetas mantendría kcal y mejoraría proteína. Resultado: E_ts > E_py en las instancias apretadas, que son justo las que importan.

**Mitigación.** Vecindad de pares (2-opt) sobre la rejilla producto activada cuando el descenso simple se estanca con E > 0,04, multiarranque determinista desde Q(σref) —que es exactamente el ancla que el LP usa—, y puerta de decisión PRE-REGISTRADA: si sobre ≥2.000 instancias reales p95(E_ts − E_py) > 0,005, o si > 1 % de las instancias cambian de bucket de umbral a peor, se sustituye `resolverPorcionesRejilla` por highs-js WASM detrás de la MISMA interfaz síncrona (verificando antes tamaño real del .wasm, API y mantenimiento con npm view). El arnés `comparar.ts` emite ese veredicto automáticamente.

### El seed de 63 bits no cabe en un Number (2^53−1). Un round-trip por JSON, por la query de la URL o por un `parseInt` pierde precisión en silencio y el plan deja de ser reproducible: exactamente el bug que toda la disciplina de semillas intenta evitar, y ahora sin backend donde depurarlo.

**Mitigación.** `bigint` internamente, string decimal en el contrato (`RespuestaOk.seed: string`), en la query de /plan y en localStorage. `semillaDesdeTexto` lanza si el texto no es un entero decimal en [0, 2^63). Test obligatorio de round-trip seed → JSON → URL → seed → mismo plan, y prohibición explícita de tipar `seed` como number en cualquier punto del monorepo.

### Rendimiento en el navegador: `scoreSlot` se ejecuta 300-670 veces por semana y cada llamada hace dos popcounts sobre P×W y un matvec sobre P filas. Con BigInt para los bitsets, con arrays de objetos, o sin los precálculos de los términos invariantes, esto pasa de decenas de ms a segundos, bloquea el hilo principal 7-50 frames y hace inviable tanto el estado de generación como el corte de 20 s.

**Mitigación.** Tres medidas no negociables: (1) bitsets en Uint32Array con popcount SWAR de 32 bits, jamás BigInt; (2) struct-of-arrays con typed arrays en todo el pool, bucles planos, nunca .map/.filter sobre objetos; (3) precalcular `desp` y `cost` una vez por petición y `sol` una vez por día (reduce el trabajo de popcount ~60× sin cambiar un bit). Más el Web Worker desde el primer día. Benchmark obligatorio al cerrar la ola 3 con P=1.500 y P=5.000; si supera 1 s con P=1.500, se para y se perfila antes de seguir.

### Alguien reordena una de las cuatro tuplas de vocabulario al «limpiar» el código. En NUTRIENTES rompe el slice residuo[1:4] y todas las matrices; en SLOTS rompe además el árbol de RNG (IDX_SLOT es el último componente de la ruta) y el desempate de ordenDeSlots, es decir cambia los planes con el mismo seed; en ALERGENOS rompe el desempate determinista de la ablación del diagnóstico y por tanto a quién se culpa.

**Mitigación.** Las cuatro tuplas viven `as const` en un único módulo con el aviso copiado del Python, los IDX_* se derivan de ellas, y `cargarCatalogo` LANZA si el bloque `vocabulario` del catálogo compilado no coincide exactamente. Test que compara un hash congelado de las cuatro tuplas. Cambiarlas obliga a recompilar el catálogo y a subir VERSION_GENERADOR.

### Un port «limpio» rompe los tres puntos de estado mutable y consumo condicional: el Contexto se convierte en inmutable o los días se generan en paralelo (rompe bitsSemana, vetoSemana y vetoSlot); el atajo `cand.length === 1` de `muestrear` pasa a llamar al RNG siempre; el `random()` del recocido se evalúa antes del `if` en vez de tras el cortocircuito `Δ < 0`. Cualquiera de los tres desincroniza el flujo y produce otro plan sin que nada falle visiblemente.

**Mitigación.** Portar `muestrear`, el bucle SA y `generarCandidatos` línea a línea, con comentarios que marquen esos puntos como load-bearing. Tests dirigidos: (a) contador de sorteos consumidos por el generador de RUTA_D en un caso fijo comparado con un número esperado; (b) `muestrear` con un único candidato no debe consumir ningún sorteo; (c) dos días con el mismo objetivo deben producir bitsSemana creciente y vetoSlot igual al mejor candidato del día anterior.

### El catálogo tiene 36 recetas y tanto MIN_POOL como el UMBRAL_VIABILIDAD de la UI están en 40. En cuanto la generación corra de verdad en el navegador, la pantalla de sobre-restricción puede decir «N recetas encajan, de 36 que tengo; necesito unas 40», que se lee como que el producto es inviable por construcción — el peor mensaje posible en la demo cuyo objetivo es validar el funcionamiento real. Y si además se porta diagnostico.ts sin las tres puertas de motor.py, se rechaza el 100 % de las peticiones culpando al usuario.

**Mitigación.** Tratar «puertas + diagnóstico» como una sola unidad de port, con test de humo del despliegue que reproduzca `test_catalogo_semilla_genera_dia`: debe devolver ok:true con `catalogoEstrecho: true`, no un fallo. Y antes de publicar, ampliar el catálogo por encima de 40 recetas o bajar el umbral con nota de por qué, probando la generación con las SEIS dietas (vegana y baja_en_carbohidratos son las candidatas a caer siempre en sobre-restricción con 36 recetas).

### Se pierden los tres datos de reproducibilidad al desaparecer las cabeceras X-PlanEat-*, o se pierde la traza entera al no haber log de servidor. Un plan generado en Pages queda irreproducible y sin instrumentación, que es justo lo que el despliegue pretende validar.

**Mitigación.** `seed`, `versionCatalogo`, `versionGenerador`, `pool` y `catalogoEstrecho` pasan al payload de RespuestaOk (cambio de contrato deliberado, replicado en schemas.py para no romper la paridad de los tests de Python). El seed se codifica además en la query de /plan para que el plan sea compartible y regenerable. La Traza se devuelve al llamante y se expone en un modo diagnóstico de la UI en vez de descartarse.

### Se mezcla el port del motor con el pulido de diseño pendiente (tipografía, coreografía del estado de generación, ficha de receta) y con la conversión a export estático. Los tres tocan los mismos ficheros y se solapan justo en el estado de generación, con lo que un fallo deja de ser atribuible: no se sabe si es del motor, del bundler o del CSS.

**Mitigación.** Tres fases con verificación entre ellas. (1) Export estático + basePath + .nojekyll + workflow de Pages con el motor devolviendo todavía `sin_servicio`: valida despliegue, assets, favicon y rutas de forma aislada. (2) Motor TS con la firma de `generarPlan` intacta: valida el port sin ruido visual. (3) Pulido de diseño, ya sobre un motor que emite progreso real. No se abre una fase sin cerrar la anterior.

## Estrategia de pruebas

# Cómo se verifica la paridad TS vs Python, de forma honesta

**Principio rector**: no se puede exigir el mismo plan, y exigirlo sería deshonesto por dos razones independientes. (1) El RNG es distinto por decisión explícita. (2) El porcionador resuelve un problema distinto —el discreto sobre la rejilla, que es el único cuyo resultado se puede devolver— mientras Python resuelve el continuo y redondea. Un test que exigiera `E_ts == E_py` fallaría precisamente cuando TS mejora.

Lo que sí es comparable, en cinco niveles de exigencia decreciente.

## Nivel 0 — Funciones puras: paridad EXACTA, sin excusas (tolerancia 1e-12)

No dependen del solver ni del RNG. Se vuelcan desde Python a `funciones-puras.jsonl` (entrada → salida, flotantes con `repr()` a 17 dígitos) y el runner TS exige coincidencia:

`bandasDe`, `desviaciones`, `errorDe`, `culpabilidad`, `cuantizar`, `rejilla`, `pulirUna`, `porcionadoDeEmergencia`, `vectorMacro`, `cuotasDe`, `ordenDeSlots`, `penalizacionRepeticion`, `nutrientesActivos`, `topesPorSlot`, `bitsDe`, `ablacion`, `cotasAlcanzables`, `macrosIncompatibles`, `minCandidatosSlot`, `temperatura`, `sigmaSugerido`, `totalesDe`.

Si alguna de estas falla, no hay nada que discutir sobre el solver ni sobre el RNG. Atención especial a `culpabilidad`: con el MISMO σ de entrada debe coincidir exactamente, y además debe coincidir el ORDEN del argsort descendente estable, que es lo único que se consume aguas abajo.

**Divergencias pre-registradas** (fallo esperado, marcado como tal en el arnés, no como error): la rejilla unificada anclada en 0 cuando `escalaMin` no es múltiplo de 0,05, y `redondeoMitadAPar` frente a los casos frontera de `np.round`.

## Nivel 1 — Etapa B aislada: la comparación cuantitativa que decide el porcionador

≥2.000 instancias reales volcadas desde Python `{a (6×R), lo, hi, sigmaRef, objetivo, activos, bandas}` con su salida `{sigma, totales, error}`, cubriendo R=1..5, nutrientes desactivados, cotas activas y objetivos inalcanzables. **Es imprescindible aislar la etapa B**: las selecciones de receta se INYECTAN desde el volcado, porque comparar planes de extremo a extremo no valida nada mientras el RNG sea distinto por diseño.

Métricas y umbrales:

| Métrica | Criterio de aceptación |
|---|---|
| `E_ts − E_py`, distribución completa | p50 ≤ 0; **p95 ≤ 0,005**; se reporta max |
| % de instancias con `E_ts ≤ E_py` | ≥ 90 % (la expectativa razonada es que TS sea MEJOR en la mayoría) |
| Concordancia de bucket (≤0,04 / (0,04, 0,12] / >0,12) | **100 %**, o cada discrepancia justificada una a una |
| Cambios de bucket a peor | ≤ 1 % |

El bucket es lo único que cambia el comportamiento observable: dispara la reparación y dispara `ok:false`.

**Puerta de decisión pre-registrada**: si p95 > 0,005 o si más del 1 % cambia de bucket a peor, se sustituye `resolverPorcionesRejilla` por highs-js WASM detrás de la misma interfaz síncrona. Se decide con el número, no con la opinión.

**Lo que NO se asevera nunca**: igualdad de σ componente a componente, igualdad del vértice, igualdad de la base óptima, igualdad de u⁺/u⁻, igualdad del flag `emergencia` (en TS deja de dispararse por time_limit). `‖σ_ts − σ_py‖₁` se reporta como histograma, jamás como aserción.

**Único caso en que sí se exige el mismo σ**: `test_lp_banda_muerta_no_mueve_sigma` — si σref ya cae dentro de todas las bandas, el óptimo es único y vale exactamente σref. Ahí la igualdad es legítima.

## Nivel 2 — Plan completo: invariantes duros y agregados, nunca igualdad

Sobre ≥500 semillas × (1, 3, 7) días × las 6 dietas, ejecutados sólo en TS. No se compara con Python plan a plan; se comparan **distribuciones** y se exigen **invariantes absolutos**.

Invariantes que deben cumplirse el **100 %** de las veces (cualquier fallo es bloqueante):

- `totales == A·σ` a 1e-9 en cada comida y en cada día. Es el bug más caro posible: que la suma de la UI no cuadre con lo que la UI muestra por comida.
- Cada σᵢ ∈ [escalaMinᵢ, escalaMaxᵢ] y en la rejilla (|σ/0,05 − round(σ/0,05)| < 1e-9, o σ == lo, o σ == hi).
- Cero recetas con un alérgeno excluido. Cero recetas con un ingrediente excluido. Dieta respetada. `minutos ≤ tope` del slot correspondiente.
- Ninguna receta repetida dentro del mismo día. Ninguna receta usada más de 2 veces en la semana. Nunca la misma (receta, slot) dos días consecutivos.
- El plan devuelto tiene exactamente tantos días como objetivos, o se devolvió un fallo.
- `E ≥ 0`, y `E == 0` ⟺ todos los totales dentro de banda.

Agregados comparados contra la referencia Python (holgura declarada):

- % de días con E ≤ 0,04: no inferior a Python − 2 puntos porcentuales.
- % de peticiones con peor día > 0,12 (es decir, `ok:false` por honestidad): no superior a Python + 1 punto porcentual.
- Mediana de ingredientes únicos por semana: ≤ Python × 1,10 (el término λ de la etapa D).
- Coste final del recocido: ≤ coste del arranque voraz, siempre (propiedad interna, no comparación).

## Nivel 3 — Determinismo intra-TS: la promesa que sí se hace

Es la promesa del producto y por tanto es un test bloqueante:

- **200 ejecuciones** de la misma solicitud con el mismo seed → JSON de respuesta idéntico byte a byte (espejo de `test_lp_degenerado_es_estable`).
- Round-trip: seed → JSON → query de URL → `semillaDesdeTexto` → mismo plan.
- Independencia de nodos del árbol: cambiar el número de sorteos consumidos en un nodo no altera la salida de otro nodo. Se verifica generando el mismo día con y sin reparaciones en un slot y comprobando que los demás slots eligen lo mismo.
- Contador de sorteos: para un caso fijo, el número de draws consumidos por el generador de RUTA_D coincide con el esperado; `muestrear` con un único candidato consume CERO.
- El orden de los slots en la petición no altera el plan (`ordenDeSlots` deriva el orden).

## Nivel 4 — Diagnóstico y contrato de producto: golden vectors del port

Los textos se validan contra golden vectors **regenerados desde el TS**, no desde Python (los mensajes cambian por dos divergencias conscientes). Lo que se porta literal son los **tests de seguridad**, que son bloqueantes del build:

- `nunca_sugiere_relajar_alergeno`: regex completa sobre las tres sugerencias, prohibiendo cualquier mención a alérgeno/gluten/lácteo/huevo/pescado/crustáceo/cacahuete/soja/frutos de cáscara/apio/mostaza/sésamo/sulfito/altramuz/molusco.
- `nunca_sugiere_bajar_de_kcal_minimas`: todo número que preceda a «kcal» en una sugerencia debe ser ≥ 1200.
- `siempre_exactamente_tres_sugerencias`: `length === 3` **y** tres cadenas DISTINTAS (aquí el port corrige el bug de `_tres`).
- `sugerencia_a_funciona`: parsear los gramos de la primera sugerencia con regex, reejecutar la petición con ese mínimo de proteína y exigir `ok: true`. Es la promesa «si decimos que puedes llegar a 138 g, es porque hay un plan con 138 g» ejecutada como test.
- `catalogo_semilla_genera_dia`: con las 36 recetas debe devolver `ok:true` con `catalogoEstrecho: true`. Es el test de humo del despliegue.

## Herramientas y cadencia

- `npm run paridad --workspace @planeat/motor` corre los niveles 0 y 1 sobre los JSONL y emite el `InformeParidad` con el veredicto automático del porcionador. Se ejecuta al cerrar la ola 1 (porciones) y en cada PR que toque `porciones.ts`.
- Los niveles 2, 3 y 4 corren como tests unitarios normales en cada PR.
- Benchmark obligatorio al cerrar la ola 3: P=1.500 y P=5.000, semana de 7 días, reportando ms totales y ms por etapa. Umbral de alarma: > 1 s con P=1.500.
- Cada divergencia consciente (rejilla anclada en 0, redondeo bancario, corrección de `diagnosticarPool`, `_tres` con tres rellenos distintos, W_AFIN=0) tiene su entrada en `packages/motor/DIVERGENCIAS.md` **y** un test que la fija, para que no se lea como fallo del port ni se «arregle» de vuelta.

