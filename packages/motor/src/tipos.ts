/**
 * Tipos internos del motor. Ni una línea de código: este fichero se borra
 * entero al compilar.
 *
 * Dos cosas viven aquí y ninguna más:
 *
 * 1. Las estructuras que en Python son **dataclasses privadas del solver**
 *    (`Pool`, `Contexto`, `CandidatoDia`, `Bandas`, `ResultadoPorcionado`) más
 *    las dos que el port añade porque en Python no existían (`Traza` sí existe
 *    pero moría en un log de servidor, y `Progreso` no tenía a quién
 *    informar). Están juntas para que se lean juntas: son el contrato interno
 *    entre las etapas A, B, C y D, y una etapa que no cuadra con la siguiente
 *    es el fallo que más caro sale depurar.
 * 2. La reexportación de los tipos de dominio de `@planeat/shared`, para que
 *    ningún módulo del motor tenga que decidir de cuál de los dos sitios
 *    importa `SlotComida`.
 *
 * `@planeat/shared` es la ÚNICA fuente de verdad del dominio. Redefinir aquí
 * `SlotComida`, `TipoDieta`, `Alergeno` o cualquier pieza de la respuesta
 * compilaría igual —TypeScript es estructural— y divergiría en silencio la
 * primera vez que alguien tocara uno de los dos. Por eso se reexportan y no se
 * copian.
 *
 * Nota para quien escriba `pool.ts`, `scoring.ts`, `porciones.ts` o
 * `reparacion.ts`: la spec del port declara estas mismas estructuras en la
 * sección de cada módulo. Reexpórtalas desde aquí
 * (`export type { Pool } from './tipos.ts';`) en vez de volver a escribirlas.
 * Dos copias estructuralmente idénticas compilan sin quejarse, así que la
 * duplicación no falla: se pudre, y se descubre el día que una de las dos gana
 * un campo.
 *
 * Convenciones que se dan por sabidas en todo el fichero, porque repetirlas en
 * cada campo lo haría ilegible:
 *
 *  - Toda matriz va en **struct-of-arrays**: un typed array plano con stride,
 *    nunca un array de objetos. La fila `i` es el mismo elemento en TODOS los
 *    arrays de la estructura; ése es el invariante maestro heredado del Python.
 *  - Los vectores de nutrientes tienen 6 posiciones en el orden de `NUTRIENTES`
 *    (constantes.ts). No hay forma de expresar «longitud 6» sobre un
 *    `Float64Array`, así que va escrito y no comprobado: es la razón de que el
 *    orden de esa tupla sea contrato y esté congelado por un test.
 *  - `Float32Array` donde numpy tiene float32 y `Float64Array` donde numpy
 *    ensancha a float64. No es cosmético: el tipo decide qué empates del top-K
 *    se rompen y por dónde.
 *  - Las máscaras booleanas van en `Uint8Array` (0/1) en vez de en un array de
 *    `boolean`: los typed arrays no admiten booleanos y un `boolean[]` sería un
 *    array de objetos en el camino caliente.
 */

// ---------------------------------------------------------------------------
// Dominio: se reexporta, no se redefine
// ---------------------------------------------------------------------------

export type {
  Alergeno,
  ComidaPlan,
  DiaPlan,
  FalloGeneracion,
  ItemPlan,
  ObjetivoNutricional,
  Rango,
  RespuestaError,
  RespuestaGeneracion,
  RespuestaOk,
  RestriccionesGeneracion,
  SlotComida,
  SolicitudGeneracion,
  TipoDieta,
  TotalesNutricionales,
} from "@planeat/shared";

import type { SlotComida } from "@planeat/shared";

// ---------------------------------------------------------------------------
// Etapa 0 — el pool
// ---------------------------------------------------------------------------

/**
 * Copia contigua de las filas del catálogo que pasan los filtros duros. §1.2
 *
 * Es una COPIA y no una lista de índices sobre el catálogo por la misma razón
 * que en Python: se materializa una vez por petición (~90 KB) y a cambio cada
 * slot recorre memoria contigua. Indexar el catálogo entero en cada slot cuesta
 * unas cinco veces más y rompe la localidad de caché, y `scoreSlot` se ejecuta
 * cientos de veces por semana.
 *
 * Port de la dataclass `Pool` de `scoring.py:49-77`. Los `(P, k)` de numpy son
 * aquí arrays planos de `P*k` en row-major: la fila `i` empieza en `i*k`.
 */
export interface Pool {
  /** Filas admisibles. En Python era la propiedad `p` derivada de `idx`. */
  p: number;
  /** Palabras de 32 bits por bitset de ingredientes: `ceil(nAlimentos / 32)`. */
  w32: number;
  /** (P,) fila del catálogo de cada elemento del pool. */
  idx: Int32Array;
  /** (N,) fila del catálogo → posición en el pool, o −1 si no entró. */
  mapaFila: Int32Array;
  /** (P,) ids de receta. Es lo único no numérico del pool: desempata el top-K. */
  ids: readonly string[];
  /** (P, 6) row-major, en el orden de NUTRIENTES. */
  nutr: Float32Array;
  /** (P, 6) 1 si ese nutriente está declarado; 0 si se está sumando un cero. */
  conocido: Uint8Array;
  /** (P, 3) dirección de macros, norma L2 = 1. Sólo proteína, carbo y grasa. */
  vMacro: Float32Array;
  /** (P,) 0 si la receta no tiene macros y su `fit` es 0,5 por convención. */
  tieneMacro: Uint8Array;
  /** (P,) cotas del factor de ración. Son del catálogo, no del objetivo. */
  escalaMin: Float32Array;
  escalaMax: Float32Array;
  /** (P,) máscara de 5 bits: en qué slots admite servirse esta receta. */
  mSlot: Uint8Array;
  /** (P,) minutos totales. int16 porque SIN_LIMITE_MINUTOS es su máximo. */
  minutos: Int16Array;
  /** (P, w32) bitset de alimentos de la receta. */
  bits: Uint32Array;
  /** (P,) ingredientes distintos. Denominador de la cobertura, nunca 0 sin guarda. */
  nIngr: Int16Array;
  /** (P,) céntimos por ración. Una receta sin precio vale 0 y sale «gratis». */
  costeCents: Int32Array;
  /** (P,) 0 si el precio es una estimación de cero, no un precio. */
  costeConocido: Uint8Array;
}

// ---------------------------------------------------------------------------
// Etapa A — contexto de la petición
// ---------------------------------------------------------------------------

/**
 * Todo lo que el score necesita y no cambia dentro de un día. §2.2
 *
 * **Es MUTABLE y se muta entre días**, en este orden exacto: al empezar el día
 * se recalcula `vetoSemana`; al cerrarlo se acumula `bitsSemana` y se reescribe
 * `vetoSlot`. Convertirlo en inmutable o generar los días en paralelo no es una
 * mejora de estilo: cambia el plan, porque el solape (§2.2d) y las dos
 * restricciones de variedad dependen de lo ya decidido. Port de `scoring.py:188`.
 */
export interface Contexto {
  /**
   * Fracción de las kcal del día por slot, renormalizada al subconjunto pedido.
   *
   * Ojo: sólo contiene los slots de la petición, aunque el tipo prometa los
   * cinco. `Record<SlotComida, number>` no puede expresar «los que vengan» sin
   * volver opcional cada acceso del camino caliente, y todos los accesos reales
   * usan un slot que sí está en la petición. Es una promesa que el tipo no
   * puede cumplir y el código sí: indexar con un slot no pedido devuelve
   * `undefined` con cara de `number`.
   */
  cuota: Record<SlotComida, number>;
  /** Tope de minutos por slot, con los CINCO rellenos (SIN_LIMITE_MINUTOS). */
  topes: Record<SlotComida, number>;
  /** (w32,) alimentos que el usuario ya tiene en casa. */
  bitsDespensa: Uint32Array;
  /** (w32,) unión de los días ya cerrados. Ceros el primer día. */
  bitsSemana: Uint32Array;
  /** (P,) penalización por repetición reciente, ya decaída. */
  penRep: Float32Array;
  /** 0 apaga el término de coste entero. */
  pesoCoste: number;
  /** Céntimos por ración que el presupuesto permite. */
  umbralCoste: number;
  /** §2.2h: mayor `nIngr` del POOL, normalizador de `nuevoPre`. Siempre ≥ 1. */
  escalaNuevos: number;
  /** Temperatura del softmax. La etapa C la sube en cada reintento. */
  tau: number;
  /** 'sin_presupuesto' | 'precios_incompletos'. La UI ya consume estos motivos. */
  costeDesactivadoPor: string | null;
  /**
   * (P,) 1 si la receta agotó MAX_USOS_RECETA_SEMANA. `null` el primer día.
   *
   * Vive en el contexto y no sólo en la etapa D porque es una restricción, no
   * una preferencia: si sólo se comprobara al ensamblar, los K candidatos del
   * día se generarían sin saberlo y el recocido no tendría ningún estado
   * factible que visitar. Aquí poda, igual que el filtro de alérgenos.
   */
  vetoSemana: Uint8Array | null;
  /** slot → fila servida ayer en ese slot. Evita «otra vez lo mismo que ayer». */
  vetoSlot: Map<SlotComida, number>;
  /**
   * Precálculos que Python NO hace, y que no cambian ni un bit del resultado.
   *
   * `desp` y `cost` no dependen del slot ni del residuo, y `sol` sólo del día:
   * recalcularlos dentro de `scoreSlot` repetía los popcounts unas 60 veces de
   * más. En el backend sobraba tiempo; en el navegador esto es la diferencia
   * entre decenas de milisegundos y segundos de hilo bloqueado.
   *
   * `despPre` y `costPre` se llenan una vez por petición; `solPre` y
   * `nuevoPre`, una vez por día, en `recalcularSolape`. Si alguien muta
   * `bitsSemana` sin volver a llamarla, los dos términos se quedan en el día
   * anterior.
   *
   * `nuevoPre` no puede arrancar en ceros como `solPre`: con `bitsSemana`
   * vacío (día 1) TODOS los ingredientes de cada receta son nuevos, así que
   * `contextoDe` lo calcula de verdad antes de devolver el contexto en vez de
   * dejarlo para la primera llamada a `recalcularSolape`. §2.2h.
   */
  despPre: Float32Array;
  costPre: Float32Array;
  solPre: Float32Array;
  nuevoPre: Float32Array;
}

// ---------------------------------------------------------------------------
// Etapa B — porcionado
// ---------------------------------------------------------------------------

/**
 * Intervalo objetivo y pesos asimétricos por nutriente. §3.1
 *
 * Los seis vectores van en el orden de NUTRIENTES. Un lado abierto se escribe
 * con ±INF_BANDA (1e30) y NO con `Infinity`: el código decide si una banda está
 * acotada comparando contra 1e30, y el normalizador `e` aritmetiza con estos
 * valores —con `Infinity` daría NaN y el NaN se propagaría a todo el error.
 *
 * Un nutriente desactivado (sin dato fiable) tiene banda abierta y peso 0: ni
 * penaliza ni entra en el error. No se inventa un objetivo sobre datos que no
 * existen. Port de la dataclass `Bandas` de `porciones.py:39-51`.
 */
export interface Bandas {
  /** (6,) L_n, −INF_BANDA si el lado está abierto. */
  lo: Float64Array;
  /** (6,) U_n, +INF_BANDA si el lado está abierto. */
  hi: Float64Array;
  /** (6,) coste del exceso; 0 = ese lado no se penaliza. */
  wMas: Float64Array;
  /** (6,) coste del defecto. */
  wMenos: Float64Array;
  /** (6,) normalizador relativo, calculado DESPUÉS de aplicar los activos. */
  e: Float64Array;
  /**
   * Σ max(wMas, wMenos). En Python era una propiedad; aquí se materializa
   * porque el descenso coordinado lo lee en cada evaluación de J.
   *
   * Vale 0 exactamente cuando no queda ningún nutriente activo, y entonces el
   * error es 0 por definición. Ese cero significa «no se ha podido medir», no
   * «objetivo cumplido», y la traza lleva los activos para poder distinguirlos.
   */
  pesoTotal: number;
}

/** Port de la dataclass `ResultadoPorcionado` de `porciones.py:134-139`. */
export interface ResultadoPorcionado {
  /** (R,) factores de ración, ya en la rejilla de PASO_RACION y dentro de cotas. */
  sigma: Float64Array;
  /**
   * (6,) los totales de ESTOS sigma. Nunca los de una solución continua
   * intermedia: devolver unos totales que no son A·σ es el bug más caro
   * posible, porque la suma que enseña la UI deja de cuadrar con las comidas
   * que enseña la UI. El Python lo repite tres veces; se repite aquí.
   */
  totales: Float64Array;
  /** Error nutricional E de `totales`, sin el regularizador de J. */
  error: number;
  /**
   * Se recurrió al porcionado de emergencia (escala uniforme).
   *
   * En Python también se activaba al agotar el `time_limit` de HiGHS. Aquí no
   * hay solver que se quede sin tiempo, así que sólo queda el caso degenerado
   * (R = 0 o `a` sin información). Ojo al comparar con la referencia: este flag
   * NO es comparable entre los dos motores.
   */
  emergencia: boolean;
}

/**
 * La etapa B, detrás de una interfaz para poder sustituirla.
 *
 * `a` es (6, R) en row-major —seis filas de nutriente por R recetas—, igual que
 * en Python. Es SÍNCRONA a propósito: el plan B declarado del port es cambiar
 * el descenso coordinado por highs-js compilado a WASM, y una firma asíncrona
 * contagiaría el `await` a las etapas C y D, que no lo necesitan.
 */
export type ResolverPorciones = (
  a: Float64Array,
  r: number,
  lo: Float64Array,
  hi: Float64Array,
  sigmaRef: Float64Array,
  bandas: Bandas,
) => ResultadoPorcionado;

// ---------------------------------------------------------------------------
// Etapa C — candidato de día
// ---------------------------------------------------------------------------

/**
 * Un día completo, listo para que la etapa D lo compare con sus hermanos.
 *
 * `slots` y `filas` van alineados y en **orden de selección** (cuota
 * descendente), no de presentación: reordenar a orden cronológico es cosa de
 * quien serializa. Port de `reparacion.py:42-63`.
 */
export interface CandidatoDia {
  slots: SlotComida[];
  /** Posición en el POOL, no fila del catálogo. */
  filas: number[];
  /** (R,) factores de ración ya cuantizados. */
  sigma: Float64Array;
  /** (6,) los de estos sigma, no los de ninguna solución intermedia. */
  totales: Float64Array;
  error: number;
  /**
   * En qué intento se encontró este candidato, no cuántos se hicieron. Un 0
   * significa que la primera selección ya cuadró y no hubo reparación.
   */
  intentos: number;
  emergencia: boolean;
  /** Si es falso, `totales.fibraG` va a null en el contrato. */
  fibraFiable: boolean;
  /** (w32,) unión de los alimentos del día. Alimenta el solape y la etapa D. */
  bits: Uint32Array;
  /**
   * Identidad del candidato para deduplicar entre los K del día. Sustituye al
   * `frozenset(filas)` de Python: filas ordenadas ascendentemente y unidas por
   * comas. Es una cadena porque JS no tiene conjuntos con igualdad por valor, y
   * ordenar antes de unir es lo que hace que dos días con las mismas recetas en
   * distinto orden de selección se reconozcan como el mismo.
   */
  clave: string;
}

// ---------------------------------------------------------------------------
// Instrumentación
// ---------------------------------------------------------------------------

/**
 * Instrumentación de una generación. Port de `motor.py:70-86`.
 *
 * En el backend esto se resumía en un log de servidor. Aquí no hay servidor, y
 * en vez de perderla se devuelve al llamante: el objetivo del despliegue es
 * validar que el motor funciona de verdad, y para eso enseñarla vale más que
 * archivarla. La UI la expone en un modo diagnóstico.
 *
 * Los tres contadores de reparación (`intentosReparacion`,
 * `porcionadosDeEmergencia`, `reparacionesDuras`) miden cosas distintas y
 * ninguno es «cuántas veces falló»: el primero cuenta el intento GANADOR de
 * cada día, no los realizados.
 */
export interface Traza {
  /** Decimal y como cadena: 63 bits no caben en un `number`. */
  seed: string;
  /** Recetas admisibles tras los filtros duros. */
  pool: number;
  msTotal: number;
  msPool: number;
  msGeneracion: number;
  msEnsamblado: number;
  /** Candidatos de día descartados por repetir la misma combinación de recetas. */
  duplicados: number;
  /** Un error por día, en el orden del plan. Es lo que decide si se responde ok. */
  erroresPorDia: number[];
  intentosReparacion: number;
  porcionadosDeEmergencia: number;
  /** Items que la pasada final tuvo que cambiar por romper una restricción dura. */
  reparacionesDuras: number;
  /** p. ej. 'coste:precios_incompletos'. Qué términos del score no se aplicaron. */
  terminosDesactivados: string[];
  /** Puerta 3 de §6.0: se generó igual, pero el catálogo se quedó corto. */
  catalogoEstrecho: boolean;
}

/**
 * Progreso de la generación. Contrato del worker con `estado-generacion.tsx`.
 *
 * Las cuatro etapas son las REALES, no cuatro rótulos repartidos por el tiempo
 * de espera: hasta ahora la pantalla marcaba el paso hecho con `indice === 0`,
 * es decir, mentía educadamente. Con el motor dentro del navegador ya no hace
 * falta, y una barra que avanza cuando avanza el trabajo es la única razón de
 * ser de esa pantalla.
 *
 * `porcionado` es la única etapa que emite varios mensajes: uno por día al
 * cerrarlo, con `dia` de 0 a `deDias`−1.
 */
export interface Progreso {
  etapa: "objetivos" | "pool" | "porcionado" | "cuadre";
  dia: number;
  deDias: number;
  /** Títulos del mejor candidato provisional del día, si ya se conocen. */
  titulos?: string[];
}
