/**
 * Motor de generación de planes. Vocabulario canónico y constantes.
 *
 * Port de `services/solver/app/solver/__init__.py` (todo salvo `rng_de`, que
 * vive en `rng.ts` porque allí está el árbol de generadores entero y aquí no
 * cabe sin arrastrar dependencias).
 *
 * Este fichero hace de `constantes.ts` por la misma razón que el `__init__.py`
 * hacía de `constantes.py`: DISENO.md impone que ningún número mágico viva
 * fuera de un único módulo. No importa a ningún otro módulo del motor —sólo
 * tipos de `@planeat/shared`, que se borran en compilación— así que no puede
 * haber ciclos por mucho que crezca.
 *
 * REGLA OPERATIVA, heredada literal del Python: si cambias una constante,
 * cambia también `VERSION_GENERADOR`. Sin eso, un plan guardado deja de ser
 * reproducible y el bug es indepurable en soporte. En el navegador esto es
 * MÁS grave que en el backend: el seed y las dos versiones viajan dentro del
 * JSON del plan y en la URL, no en cabeceras que alguien pueda correlacionar
 * con un despliegue.
 */

import type { Alergeno, SlotComida, TipoDieta } from "@planeat/shared";

// ---------------------------------------------------------------------------
// Utilidades de tipos. No generan código: su único cometido es convertir "el
// orden de las tuplas es contrato" en un error de compilación en vez de en un
// plan silenciosamente distinto.
// ---------------------------------------------------------------------------

type Igual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Falla la compilación si `T` no es exactamente `true`. */
type Afirma<T extends true> = T;

/**
 * Deriva el mapa valor → posición de una tupla. Se deriva en vez de escribirse
 * a mano para que un reordenado no pueda dejar la tupla y sus índices
 * discrepando (que sería el peor de los dos mundos: ni el orden viejo ni el
 * nuevo).
 */
function indicesDe<T extends string>(tupla: readonly T[]): Readonly<Record<T, number>> {
  const salida = {} as Record<T, number>;
  for (const [i, clave] of tupla.entries()) salida[clave] = i;
  return salida;
}

// ---------------------------------------------------------------------------
// Vocabulario
//
// El orden de estas cuatro tuplas ES el orden de las columnas de todas las
// matrices del catálogo compilado. No es estilo: es formato binario. Lo que
// rompe cada una si se reordena, por si alguien duda de si "da igual":
//
//  - NUTRIENTES: columnas de `nutr` (n×6) y `conocido` (n×6), y posiciones del
//    vector `residuo`/`objetivoVec`/`activos`/`totales`. Además `vectorMacro`
//    lee `residuo[1..3]` como (proteína, carbohidrato, grasa) por ser POSICIONES
//    CONTIGUAS: reordenar aquí no rompe una comparación, rompe una rebanada, y
//    el motor sigue funcionando dando macros equivocadas.
//  - DIETAS: columnas de la máscara `mDieta`. Un catálogo compilado con otro
//    orden filtra por la dieta equivocada sin fallar.
//  - ALERGENOS: columnas de `mAlergeno` —o sea, seguridad alimentaria— y además
//    orden de inserción de las máscaras del diagnóstico, que es el desempate de
//    la ablación leave-one-out: reordenar cambia a quién se culpa en un empate.
//  - SLOTS: columnas de `mSlot`; desempate de `ordenDeSlots` (almuerzo y
//    merienda empatan a 0,10 y decide el índice); orden de presentación de las
//    comidas del día; y ÚLTIMO COMPONENTE DE LA RUTA DEL ÁRBOL DE RNG. Esto
//    último es lo definitivo: reordenar SLOTS cambia el plan generado con el
//    mismo seed, sin cambiar ni una línea de lógica.
//
// `cargarCatalogo` compara estas cuatro tuplas con el bloque `vocabulario` del
// catálogo compilado y lanza si difieren; el test de `pruebas/constantes.test.ts`
// congela un hash de las cuatro. Entre las dos cosas, un reordenado accidental
// falla en rojo y no en silencio.
// ---------------------------------------------------------------------------

export const NUTRIENTES = [
  "kcal",
  "proteina",
  "carbohidrato",
  "grasa",
  "fibra",
  "sodio",
] as const;
export type Nutriente = (typeof NUTRIENTES)[number];
export const N_NUTR = NUTRIENTES.length;
export const IDX_NUTRIENTE: Readonly<Record<Nutriente, number>> = indicesDe(NUTRIENTES);

// Índices sueltos, equivalentes al `= range(6)` del Python. Se escriben como
// literales (y no derivados de IDX_NUTRIENTE) para que el compilador conozca su
// valor exacto y el acceso a tuplas de longitud fija no arrastre `| undefined`;
// las seis afirmaciones de debajo garantizan que siguen cuadrando con la tupla.
export const IDX_KCAL = 0;
export const IDX_PROT = 1;
export const IDX_CARB = 2;
export const IDX_GRASA = 3;
export const IDX_FIBRA = 4;
export const IDX_SODIO = 5;

type _IdxKcal = Afirma<Igual<(typeof NUTRIENTES)[typeof IDX_KCAL], "kcal">>;
type _IdxProt = Afirma<Igual<(typeof NUTRIENTES)[typeof IDX_PROT], "proteina">>;
type _IdxCarb = Afirma<Igual<(typeof NUTRIENTES)[typeof IDX_CARB], "carbohidrato">>;
type _IdxGrasa = Afirma<Igual<(typeof NUTRIENTES)[typeof IDX_GRASA], "grasa">>;
type _IdxFibra = Afirma<Igual<(typeof NUTRIENTES)[typeof IDX_FIBRA], "fibra">>;
type _IdxSodio = Afirma<Igual<(typeof NUTRIENTES)[typeof IDX_SODIO], "sodio">>;

export const DIETAS = [
  "omnivora",
  "vegetariana",
  "vegana",
  "pescetariana",
  "baja_en_carbohidratos",
  "mediterranea",
] as const satisfies readonly TipoDieta[];
export const N_DIETAS = DIETAS.length;
export const IDX_DIETA: Readonly<Record<TipoDieta, number>> = indicesDe(DIETAS);

export const ALERGENOS = [
  "gluten",
  "crustaceos",
  "huevos",
  "pescado",
  "cacahuetes",
  "soja",
  "lacteos",
  "frutos_de_cascara",
  "apio",
  "mostaza",
  "sesamo",
  "sulfitos",
  "altramuces",
  "moluscos",
] as const satisfies readonly Alergeno[];
export const N_ALERGENOS = ALERGENOS.length;
export const IDX_ALERGENO: Readonly<Record<Alergeno, number>> = indicesDe(ALERGENOS);

/** Orden CRONOLÓGICO, no de importancia. El de importancia es `PESO_SLOT`. */
export const SLOTS = [
  "desayuno",
  "almuerzo",
  "comida",
  "merienda",
  "cena",
] as const satisfies readonly SlotComida[];
export const N_SLOTS = SLOTS.length;
export const IDX_SLOT: Readonly<Record<SlotComida, number>> = indicesDe(SLOTS);

// `satisfies` sólo comprueba que cada elemento pertenece al tipo de dominio; lo
// que hace falta comprobar es la COBERTURA en los dos sentidos. Si alguien añade
// un alérgeno a `@planeat/shared` y no lo añade aquí, el catálogo se compilaría
// con 14 columnas y el filtro duro dejaría pasar recetas con ese alérgeno: es el
// fallo más caro que puede tener este producto, y aquí falla al compilar.
type _CoberturaDietas = Afirma<Igual<TipoDieta, (typeof DIETAS)[number]>>;
type _CoberturaAlergenos = Afirma<Igual<Alergeno, (typeof ALERGENOS)[number]>>;
type _CoberturaSlots = Afirma<Igual<SlotComida, (typeof SLOTS)[number]>>;

// ---------------------------------------------------------------------------
// Etapa A — selección
// ---------------------------------------------------------------------------

/**
 * Convención de producto (patrón mediterráneo, comida como ingesta principal),
 * NO un dato nutricional. Sólo ordena la selección; el cuadre real lo hace la
 * etapa B a nivel de día, así que un reparto imperfecto no degrada la
 * precisión.
 *
 * OJO: NO suman 1, suman 1,05 (el anexo de auditoría afirma que suman 1,00 y se
 * equivoca; los valores son los del Python, comprobados uno a uno). Da igual
 * porque `cuotasDe` divide siempre por la suma del subconjunto pedido, así que
 * lo único que codifican estos números son sus proporciones relativas. Se
 * portan tal cual: "arreglarlos" para que sumen 1 cambiaría las proporciones y
 * con ellas todos los planes. §2.1
 */
export const PESO_SLOT: Readonly<Record<SlotComida, number>> = {
  desayuno: 0.22,
  almuerzo: 0.1,
  comida: 0.35,
  merienda: 0.1,
  cena: 0.28,
};

// Pesos de los siete términos del score. §2.2
export const W_FIT = 4.0;
export const W_ESC = 2.0;
export const W_DESP = 1.5;
export const W_SOL = 1.2;
/**
 * Afinidad: término muerto pero presente. DISENO.md §2.2 escribe la fórmula con
 * `0,8·φ_afin` y declara un rango S ∈ [−3,5 ; 9,5]; el CÓDIGO fija 0,0 porque
 * las preferencias de alimento son v1 y no existen en el contrato, y §2.2(g) lo
 * confirma («peso efectivo 0 en MVP»). Se porta el código.
 *
 * El rango real del score es por tanto [−3,5 ; 8,7]: máximo 4,0+2,0+1,5+1,2 con
 * todos los φ en [0,1], mínimo −1,5·cost − 2,0·rep. Queda escrito aquí porque
 * el número que circula por la documentación (9,5) es el equivocado y quien
 * depure una normalización del score va a comparar contra él.
 */
export const W_AFIN = 0.0;
export const W_COST = 1.5;
export const W_REP = 2.0;

/** 0,85/día deja ~3 % de penalización residual a 21 días, la ventana de la spec. §2.2f */
export const DECAIMIENTO_REPETICION = 0.85;
/**
 * Por debajo de esta fracción de precios conocidos EN EL POOL el término de
 * coste se apaga entero: puntuar con precios inventados es peor que no puntuar.
 * §2.2e
 */
export const FRACCION_MINIMA_PRECIOS = 0.8;

export const TOP_K = 25; // §2.4
export const TAU_MIN = 0.12; // §2.4
export const TAU_MAX = 1.5; // §2.4
export const VARIEDAD_POR_DEFECTO = 45; // §2.4

/**
 * "Sin tope de tiempo" para un slot. 32767 es el máximo de int16, que es el tipo
 * en el que viajan los minutos del catálogo: usar Infinity obligaría a sacar los
 * minutos de los typed arrays. Origen: `scoring.py:41`, no `__init__.py`, pero
 * es un número mágico y aquí es donde viven.
 */
export const SIN_LIMITE_MINUTOS = 32767;

// ---------------------------------------------------------------------------
// Etapa B — porcionado
// ---------------------------------------------------------------------------

/**
 * (peso del exceso, peso del defecto) por nutriente, EN EL ORDEN DE NUTRIENTES.
 * En Python es un dict indexado por nombre; aquí es posicional porque el bucle
 * de `bandasDe` recorre índices y un `Record<Nutriente, …>` obligaría a mapear
 * nombre↔índice en el camino caliente sin ganar nada.
 *
 * La asimetría de la proteína (1,0 / 2,5) es de producto: pasarse no daña el
 * objetivo del usuario, quedarse corto sí. La del sodio va al revés por la misma
 * lógica. §3.1
 */
export const PESOS_LP: readonly [
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
] = [
  [3.0, 3.0], // kcal
  [1.0, 2.5], // proteina
  [1.0, 1.0], // carbohidrato
  [1.0, 1.0], // grasa
  [0.0, 0.5], // fibra
  [0.3, 0.0], // sodio
];
type _PesosLpCompletos = Afirma<Igual<(typeof PESOS_LP)["length"], typeof N_NUTR>>;

/**
 * Regularizador L1 hacia σref. En Python rompía la degeneración del LP: sin él
 * HiGHS devolvía un vértice arbitrario ("media ración de lentejas y 1,8 de
 * tostada") y el plan dejaba de ser reproducible entre versiones.
 *
 * En el port no hay LP ni vértices, pero el término se conserva con el MISMO
 * valor porque forma parte de la función objetivo J que el descenso coordinado
 * minimiza: es lo que hace que, ante dos σ igual de buenos nutricionalmente,
 * gane el más parecido a las raciones de referencia. §3.2
 */
export const EPS_REG = 1e-3;
export const UMBRAL_ERROR_OK = 0.04; // §3.3
export const UMBRAL_ERROR_ACEPTABLE = 0.12; // §3.3
export const PASO_RACION = 0.05; // §3.4
export const ESCALA_MIN_POR_DEFECTO = 0.6; // §1.1
export const ESCALA_MAX_POR_DEFECTO = 1.8; // §1.1
/**
 * "Sin cota" en las bandas nutricionales. Se queda en 1e30 literal y NO pasa a
 * Infinity aunque el LP haya desaparecido: el código compara `hi < 1e30` para
 * decidir si una banda está acotada, y el normalizador `e_n` de `bandasDe`
 * aritmetiza con estos valores. Con Infinity, `e_n` daría NaN en las bandas
 * abiertas y el error se propagaría a todo el porcionado.
 * (En Python se llamaba INF_HIGHS; el nombre cambia porque ya no hay HiGHS.)
 */
export const INF_BANDA = 1.0e30;

// ---------------------------------------------------------------------------
// Etapa C — reparación
// ---------------------------------------------------------------------------

export const MAX_INTENTOS_REPARACION = 3; // §4.2
/** Cada reintento sube τ un 25 % acumulado: si la primera elección no cuadró, se busca más lejos. §4.2 */
export const FACTOR_TEMPERATURA_REINTENTO = 0.25;

// ---------------------------------------------------------------------------
// Etapa D — ensamblado semanal
// ---------------------------------------------------------------------------

export const K_CANDIDATOS_DIA = 6; // §5
/**
 * λ = 0,006: quitar 10 ingredientes de la lista de la compra vale lo mismo que
 * empeorar un día en 6 puntos de desviación nutricional. Deja la nutrición
 * dominante pero con capacidad real de mover la solución cuando hay empate. §5.1
 */
export const LAMBDA_INGREDIENTES = 0.006;
export const MU_PRESUPUESTO = 0.3; // §5.1
export const NU_REPETICION = 0.05; // §5.1
/** Restricción DURA, no penalización: la impone `repararDuras`, no el recocido. §5.1 */
export const MAX_USOS_RECETA_SEMANA = 2;
export const SA_T0 = 0.05; // §5.3
export const SA_ALFA = 0.994; // §5.3
export const SA_ITERACIONES = 400; // §5.3

// ---------------------------------------------------------------------------
// Diagnóstico
// ---------------------------------------------------------------------------

/**
 * Umbral de calidad del pool. NO es un umbral absoluto de rechazo: un solo
 * número culparía al usuario de que el catálogo sea corto. Con el catálogo
 * semilla (36 recetas) ese uso rechazaría el 100 % de las peticiones —que es
 * exactamente el caso de la demo de Pages—. Las tres puertas de §6.0 separan
 * "tus filtros aprietan" de "nuestro catálogo es corto".
 */
export const MIN_POOL = 40; // §6.0
/** Elegir + 2 reparaciones. §6.0 */
export const MIN_CANDIDATOS_SLOT_DIA = 3;
/**
 * ceil(7/2) + 4. Sale de la restricción dura de repetición: con
 * MAX_USOS_RECETA_SEMANA usos y D días hacen falta ceil(D/2) recetas distintas
 * por slot, más 4 de holgura para que el recocido tenga algo que intercambiar.
 *
 * Ojo al portar `_min_candidatos_slot`: esta constante y esa holgura de 4 son
 * REDUNDANTES entre sí, porque el código recalcula `holgura = 8 − ceil(7/2)`
 * a partir de este mismo 8. Es decir, cambiar este número cambia dos cosas a la
 * vez (el techo y la holgura) y no de forma independiente. Se porta tal cual
 * para no alterar el umbral, pero conviene saberlo antes de tocarlo. §6.0
 */
export const MIN_CANDIDATOS_SLOT_SEMANA = 8;
/**
 * Por debajo de esta fracción del catálogo, la poda es atribuible a los filtros
 * del usuario (puerta 2). Por encima, el corto es el catálogo (puerta 3). §6.0
 */
export const FRACCION_POOL_ATRIBUIBLE = 0.5;
/** Contrato de producto: siempre exactamente tres sugerencias, ni dos ni cuatro. */
export const N_SUGERENCIAS = 3;
/**
 * Suelo de seguridad: ninguna sugerencia del diagnóstico puede proponer bajar de
 * aquí (spec §11.3). Python define además un mapa por sexo
 * (`KCAL_MINIMAS = {hombre: 1500, mujer: 1200}`) que NO se porta porque NINGÚN
 * módulo del solver lo usa: el solver no conoce el sexo del usuario, sólo su
 * objetivo en kcal. Portarlo sería insinuar una capacidad que no existe.
 */
export const KCAL_MINIMAS_ABSOLUTO = 1200;
/**
 * Fracción mínima de las kcal del día que debe tener fibra conocida para que se
 * reporte `fibraG`. Por debajo, el campo va a null: un total parcial se lee como
 * total y miente. §8.5
 */
export const FRACCION_MINIMA_FIBRA = 0.8;

// ---------------------------------------------------------------------------
// Reproducibilidad
// ---------------------------------------------------------------------------

/**
 * Prefijos del árbol de generadores. Dos nodos distintos nunca comparten flujo y
 * el flujo de un nodo no depende de cuántos números consuman los demás. §2.6
 *
 * RUTA_DESEMPATE está RESERVADA: no aparece en ninguna llamada a `rng_de` de
 * todo el servicio Python. Se porta el número para que nadie reutilice el 2 en
 * una ruta nueva y colisione con un árbol antiguo.
 */
export const RUTA_A = 0;
export const RUTA_D = 1;
export const RUTA_DESEMPATE = 2;

/**
 * Salto de MAYOR respecto del "1.0.0" de Python, no de parche. Dos cosas que
 * determinan el plan cambian por completo en el port: el árbol de RNG (numpy
 * SeedSequence+PCG64 → SplitMix64+xoshiro256++) y el porcionador (HiGHS sobre el
 * continuo → descenso coordinado sobre la rejilla de 0,05). Con el mismo seed y
 * el mismo catálogo, este motor NO produce el plan que producía el backend, y
 * decirlo con un número de versión es la única forma de que un plan guardado
 * siga siendo depurable.
 *
 * El sufijo `-ts` no es decorativo: hace imposible confundir la versión del
 * motor del navegador con la del servicio Python si algún día conviven.
 */
export const VERSION_GENERADOR = "2.0.0-ts";

/**
 * Corte de seguridad de la generación. En el backend lo aplicaba el cliente HTTP
 * con un AbortSignal; en el navegador lo aplica el hilo principal sobre el
 * worker, que es el único sitio desde el que se puede hacer cumplir.
 */
export const MS_LIMITE_GENERACION = 20_000;

/**
 * Mapa del control de "variedad" (0-100) a la temperatura del softmax. §2.4
 *
 * Geométrico porque la percepción de "más variado" es multiplicativa, no
 * aditiva: subir de 10 a 20 se nota tanto como subir de 40 a 80.
 *
 * DIVERGENCIA consciente con Python: aquí se clampa `variedad` a [0, 100]. En el
 * backend el valor venía validado por pydantic antes de llegar; en el navegador
 * esta función es API pública del paquete y un 1000 daría τ ≈ 3e10, es decir un
 * softmax uniforme sobre las 25 candidatas —variedad "infinita" indistinguible
 * de un sorteo al azar—. Dentro de [0,100] el resultado es idéntico al de Python.
 */
export function temperatura(variedad: number): number {
  const v = variedad < 0 ? 0 : variedad > 100 ? 100 : variedad;
  return TAU_MIN * (TAU_MAX / TAU_MIN) ** (v / 100.0);
}

// ---------------------------------------------------------------------------
// Constantes del Python que NO se portan, y por qué. Se dejan escritas para que
// nadie las eche de menos y las reinvente con otro valor:
//
//  - LIMITE_TIEMPO_LP_S = 0.05 — era el `time_limit` de HiGHS. No hay solver que
//    limitar: el descenso coordinado tiene un número de pasos acotado por
//    construcción. Su contador diagnóstico ("porcionados de emergencia por
//    tiempo") se sustituye por "instancias con E > 0,12" y "veces que hizo falta
//    el barrido de pares", que sí significan algo aquí.
//  - TTL_CACHE_POOL_S = 3600 y TAM_CACHE_POOL = 256 — la caché del pool era de
//    un proceso servidor multipetición. En el worker hay un hilo, un catálogo
//    estático embebido en el bundle y una petición cada vez: la caché es un Map
//    sin caducidad ni cerrojo, y `invalidarCachePool` es la única forma de
//    vaciarla.
//  - KCAL_MINIMAS por sexo — ver KCAL_MINIMAS_ABSOLUTO.
//  - __all__ por introspección de `dir()` — no tiene equivalente ni falta que
//    hace: aquí lo público es lo que lleva `export`.
// ---------------------------------------------------------------------------
