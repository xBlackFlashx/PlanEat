/**
 * Fallo honesto: qué restricción ata. Port de
 * `services/solver/app/solver/diagnostico.py` y de DISENO.md §6.
 *
 * Esto es producto, no ingeniería. Cuando no hay plan, la salida obligatoria es
 * un `FalloGeneracion` con **exactamente tres sugerencias concretas y
 * cuantificadas**, cada una accionable con un botón.
 *
 * Dos reglas de seguridad no negociables (spec §11.3):
 *
 * 1. **Jamás se sugiere relajar una exclusión de alérgeno.** Si un alérgeno es
 *    lo que más ata, `restriccionCulpable` lo nombra —el usuario merece saber
 *    por qué su pool es pequeño— pero las tres sugerencias salen de los
 *    siguientes ejes. El filtro vive en un único sitio (`ejesSugeribles`) y es
 *    la única puerta de entrada a las sugerencias estructurales, precisamente
 *    para que no haya un segundo camino que alguien olvide revisar.
 * 2. **Jamás se sugiere bajar de `KCAL_MINIMAS_ABSOLUTO`.**
 *
 * Y una regla de calidad: cada sugerencia tiene que ser **cierta**. Por eso los
 * números de la fase 2 no salen de una cota teórica sino del mejor plan que el
 * motor ha conseguido generar de verdad: si decimos «puedes llegar a 138 g», es
 * porque hay un plan con 138 g.
 *
 * Dos magnitudes que se parecen y NO son la misma, y que aparecen juntas en el
 * mismo `Fallo`: `p0` es el tamaño del pool que mide la ablación (con los topes
 * por slot y la máscara de slots aplicados) y alimenta los MENSAJES;
 * `pTotal` es `pool.p`, el pool real de la petición, y es lo que va en
 * `recetasCandidatas`. Unificarlas parece una limpieza y es una mentira: la
 * ablación no filtra por ingredientes en el mismo orden ni con las mismas
 * cotas.
 *
 * Los textos se transcriben LITERALES del Python, con sus comillas latinas, su
 * «Sólo» con tilde diacrítica y sus rarezas gramaticales («el tiempo del
 * comida»): son contrato de producto y hay tests que los parsean con regex.
 * Toda interpolación con formato `:.0f` pasa por `fmt0`, que NO es `toFixed(0)`.
 */

import type { CatalogoCompilado } from "./catalogo.ts";
import { W_ALERGENO } from "./catalogo.ts";
import {
  ALERGENOS,
  IDX_ALERGENO,
  IDX_DIETA,
  IDX_FIBRA,
  IDX_KCAL,
  IDX_PROT,
  IDX_SLOT,
  IDX_SODIO,
  KCAL_MINIMAS_ABSOLUTO,
  MIN_POOL,
  N_NUTR,
  N_SLOTS,
  N_SUGERENCIAS,
  SIN_LIMITE_MINUTOS,
} from "./constantes.ts";
import { comparaId, fmt0, popcountAnd } from "./numerico.ts";
import { bitsDe, topesPorSlot } from "./pool.ts";
import type {
  FalloGeneracion,
  ObjetivoNutricional,
  Pool,
  RestriccionesGeneracion,
  SlotComida,
} from "./tipos.ts";

// ---------------------------------------------------------------------------
// Números de este módulo
//
// La regla del repositorio es que todo número mágico vive en `constantes.ts`.
// Estos diez no están allí porque `constantes.ts` es de otro agente del port y
// editarlo en paralelo es como se pierden ediciones; es la misma excepción
// operativa que ya se declaró para las tolerancias del porcionador (D3 de
// DIVERGENCIAS.md) y está registrada como pendiente de trasladar.
//
// Ninguno de ellos aparece en `constantes.py`: en el Python están sueltos
// dentro de `diagnostico.py`, que es exactamente el problema que la regla
// pretende evitar. Aquí al menos están juntos y explicados.
// ---------------------------------------------------------------------------

/**
 * Las sugerencias de calorías se redondean a múltiplos de 50 hacia ARRIBA.
 * Arriba y no al más cercano: redondear a la baja convertiría «sube a 1.480»
 * en «sube a 1.450», que es un objetivo que ya sabemos que no alcanza.
 */
const PASO_KCAL_SUGERENCIA = 50;

/**
 * Cuánto se propone subir el tope de tiempo de un slot. Diez minutos es el
 * salto que el usuario percibe como «un poco más» y no como «otra receta»; no
 * hay nada demostrable detrás, y el número de recetas que abre sí está medido
 * por la ablación, así que la sugerencia sigue siendo cierta.
 */
const MINUTOS_EXTRA_SUGERENCIA = 10;

/** Factores de Atwater. La comprobación algebraica de `macrosIncompatibles`. */
const KCAL_POR_G_PROTEINA = 4;
const KCAL_POR_G_CARBOHIDRATO = 4;
const KCAL_POR_G_GRASA = 9;

/** Suelo de la kcal de una receta al calcular densidades. Evita dividir por 0. */
const EPS_KCAL_RECETA = 1e-6;

/** Suelo de la densidad proteica del pool. Mismo cometido, otra escala. */
const EPS_DENSIDAD = 1e-9;

/**
 * Tope de la sugerencia «sube las calorías». Por encima de un 25 % deja de ser
 * un ajuste del objetivo y pasa a ser otro objetivo distinto, y ofrecerlo con
 * un botón sería empujar al usuario a un plan que no ha pedido.
 */
const FACTOR_MAX_SUBIDA_KCAL = 1.25;

/**
 * Margen que se exige antes de declarar el sodio inalcanzable. Sin él, un plan
 * que se pasa un 2 % del tope se anunciaría como imposible: el sodio es el
 * nutriente con los datos más flojos del catálogo y el que menos merece un
 * fallo duro.
 */
const MARGEN_SODIO_INALCANZABLE = 1.2;

/** Los topes de sodio se sugieren redondeados a 100 mg: nadie ajusta a 7 mg. */
const PASO_SODIO_SUGERENCIA = 100;

/**
 * Suelo de la tolerancia de kcal que se propone ampliar, y los puntos que se le
 * suman. Con la tolerancia por defecto (0,03) la sugerencia sale «al 8 %».
 */
const TOLERANCIA_MINIMA_SUGERIDA = 0.03;
const PUNTOS_EXTRA_TOLERANCIA = 5;

// ---------------------------------------------------------------------------
// Nombres legibles, para no escupir claves de máquina en la cara del usuario
// ---------------------------------------------------------------------------

const NOMBRE_DIETA: Readonly<Record<string, string>> = {
  omnivora: "omnívora",
  vegetariana: "vegetariana",
  vegana: "vegana",
  pescetariana: "pescetariana",
  baja_en_carbohidratos: "baja en carbohidratos",
  mediterranea: "mediterránea",
};

const NOMBRE_ALERGENO: Readonly<Record<string, string>> = {
  gluten: "gluten",
  crustaceos: "crustáceos",
  huevos: "huevos",
  pescado: "pescado",
  cacahuetes: "cacahuetes",
  soja: "soja",
  lacteos: "lácteos",
  frutos_de_cascara: "frutos de cáscara",
  apio: "apio",
  mostaza: "mostaza",
  sesamo: "sésamo",
  sulfitos: "sulfitos",
  altramuces: "altramuces",
  moluscos: "moluscos",
};

const NOMBRE_SLOT: Readonly<Record<string, string>> = {
  desayuno: "desayuno",
  almuerzo: "almuerzo",
  comida: "comida",
  merienda: "merienda",
  cena: "cena",
};

/** Con artículo, para que las sugerencias se lean como frases y no como etiquetas. */
const SLOT_CON_ARTICULO: Readonly<Record<string, string>> = {
  desayuno: "el desayuno",
  almuerzo: "el almuerzo",
  comida: "la comida",
  merienda: "la merienda",
  cena: "la cena",
};

/**
 * Los tres rellenos genéricos de último recurso, en orden de uso.
 *
 * DIVERGENCIA D5 con Python, ordenada por `docs/port-typescript.md`: allí el
 * `while` final de `_tres` repite SIEMPRE la misma frase, así que un fallo con
 * una sola sugerencia cuantificada salía con dos líneas idénticas debajo. El
 * propio `test_siempre_exactamente_tres_sugerencias` exige
 * `len(set(sugerencias)) == 3` y hoy sólo pasa por suerte: ningún caso de la
 * batería llega a necesitar dos rellenos. Aquí son tres frases distintas.
 *
 * La primera es la literal del Python (con su punto final, que las demás
 * sugerencias no llevan). Las otras dos son nuevas y están escritas con dos
 * condiciones encima: no pueden nombrar ningún alérgeno —el test de seguridad
 * las cubre igual que a las demás— y no pueden prometer un número, porque a
 * estas alturas del diagnóstico no hay ningún número que sea cierto. Son la
 * única parte de este fichero que admite que no sabemos qué recomendar.
 *
 * Tres es exactamente lo que hace falta: si `salida` ya tiene k elementos,
 * como mucho k de estos rellenos colisionan con ellos, así que siempre quedan
 * al menos 3 − k disponibles. Por eso la longitud está congelada por tipo.
 */
const RELLENO_GENERICO: readonly [string, string, string] = [
  "Escríbenos y ampliamos el catálogo con lo que te falta.",
  "Quitar un filtro cada vez y volver a pedir plan, para ver cuál aprieta",
  "Empezar con un plan de menos días y ampliarlo después",
];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Redondea a 50 kcal y **nunca** propone bajar del suelo de seguridad.
 *
 * Regla de spec §11.3: el producto no sugiere jamás un objetivo calórico por
 * debajo del mínimo, ni siquiera cuando la petición ya venía por debajo. Si el
 * usuario pide 400 kcal al día, la salida honesta es subir a 1.200, no a 700.
 */
function kcalSegura(valor: number): number {
  return Math.trunc(
    Math.max(
      Math.ceil(valor / PASO_KCAL_SUGERENCIA) * PASO_KCAL_SUGERENCIA,
      KCAL_MINIMAS_ABSOLUTO,
    ),
  );
}

/**
 * El contrato de producto es siempre exactamente tres salidas.
 *
 * Ni dos (el usuario se siente en un callejón) ni cinco (deja de ser una
 * decisión y pasa a ser un formulario). Y las tres DISTINTAS: ver
 * `RELLENO_GENERICO`.
 */
function tres(sugerencias: readonly string[], relleno: readonly string[]): string[] {
  const salida: string[] = [];
  for (const s of [...sugerencias, ...relleno]) {
    if (s !== "" && !salida.includes(s)) salida.push(s);
    if (salida.length === N_SUGERENCIAS) break;
  }
  for (const generico of RELLENO_GENERICO) {
    if (salida.length >= N_SUGERENCIAS) break;
    if (!salida.includes(generico)) salida.push(generico);
  }
  return salida;
}

/** Slots pedidos, sin repetidos y en el orden canónico. Es el desempate de todo. */
function slotsUnicos(slots: readonly SlotComida[]): SlotComida[] {
  return [...new Set(slots)].sort((a, b) => IDX_SLOT[a] - IDX_SLOT[b]);
}

/**
 * Vista de `IDX_SLOT` indexable por cadena suelta.
 *
 * Las claves de `slotsFlojos` y las que se extraen de `tiempo:<slot>` son
 * `string`, no `SlotComida`, y castearlas para indexar un `Record` total sería
 * afirmar algo que no se ha comprobado. Con esta vista el acceso devuelve
 * `undefined` cuando toca y el llamante decide qué hacer, que es la diferencia
 * entre un valor ausente y un `NaN` viajando tres capas.
 */
const ORDEN_SLOT: Readonly<Record<string, number | undefined>> = IDX_SLOT;

// ---------------------------------------------------------------------------
// Fase 1 — el pool es demasiado pequeño (ablación leave-one-out)
// ---------------------------------------------------------------------------

/**
 * Una máscara booleana por eje de restricción, en orden fijo.
 *
 * El orden importa: es el desempate determinista de la ablación, y por eso la
 * estructura es un `Map` y no un objeto —el orden de inserción de un objeto de
 * JS depende de si las claves parecen índices, y `alergeno:gluten` no lo
 * parece pero nadie debería tener que comprobarlo—. El orden es el del dict de
 * Python: dieta, `alergeno:<a>` en el orden canónico de ALERGENOS,
 * `ingredientes_excluidos`, `tiempo:<slot>` en orden canónico de slots, y
 * `slots`.
 *
 * Divergencia declarada, y es una que sólo se alcanza con una petición
 * inválida: si `slots` viene vacío, Python revienta con un ValueError de numpy
 * (`logical_or.reduce` sobre una lista vacía) y aquí la máscara `slots`
 * simplemente no se añade. Este módulo es el camino de ERROR del motor:
 * fallar dentro del diagnóstico deja al usuario sin ninguna explicación, que
 * es peor que diagnosticar una petición degenerada.
 */
export function mascarasRestriccion(
  cat: CatalogoCompilado,
  restr: RestriccionesGeneracion,
  slots: readonly SlotComida[],
): Map<string, Uint8Array> {
  const topes = topesPorSlot(restr);
  const m = new Map<string, Uint8Array>();

  // La anotación `| undefined` no es ruido: `IDX_DIETA` es total sobre
  // `TipoDieta`, así que para el compilador esto nunca falla, pero el paquete
  // es API pública y lo puede llamar JavaScript. Python lanzaría un KeyError.
  const bitDieta: number | undefined = IDX_DIETA[restr.dieta];
  if (bitDieta === undefined) {
    throw new Error(`diagnóstico: la dieta «${restr.dieta}» no está en el vocabulario`);
  }
  const dieta = new Uint8Array(cat.n);
  for (let i = 0; i < cat.n; i++) dieta[i] = ((cat.mDieta[i] ?? 0) >>> bitDieta) & 1;
  m.set("dieta", dieta);

  for (const a of ALERGENOS) {
    if (!restr.alergenosExcluidos.includes(a)) continue;
    const bit = IDX_ALERGENO[a];
    // `mAlergeno` es multi-palabra (W_ALERGENO, ver catalogo.ts): la palabra
    // que le toca a este alérgeno y su posición dentro de ella, no un único
    // desplazamiento sobre un entero por fila.
    const palabra = bit / 32 | 0;
    const bitEnPalabra = bit % 32;
    const libre = new Uint8Array(cat.n);
    // Máscara NEGADA: «esta receta NO lleva el alérgeno». Es la única del mapa
    // que se invierte, y por eso es la única cuya ganancia significa «cuántas
    // recetas volverían si el usuario se comiera el alérgeno». Ese número se
    // calcula —el usuario merece saber cuánto le cuesta su alergia— y jamás
    // se convierte en una sugerencia: lo impide `ejesSugeribles`.
    for (let i = 0; i < cat.n; i++) {
      libre[i] = ((cat.mAlergeno[i * W_ALERGENO + palabra] ?? 0) >>> bitEnPalabra) & 1 ? 0 : 1;
    }
    m.set(`alergeno:${a}`, libre);
  }

  if (restr.ingredientesExcluidos.length > 0) {
    const excl = bitsDe(cat, restr.ingredientesExcluidos);
    const limpias = new Uint8Array(cat.n);
    for (let i = 0; i < cat.n; i++) {
      limpias[i] = popcountAnd(cat.ingrBits, i * cat.w32, excl, 0, cat.w32) === 0 ? 1 : 0;
    }
    m.set("ingredientes_excluidos", limpias);
  }

  const pedidos = slotsUnicos(slots);
  for (const s of pedidos) {
    const tope = topes[s];
    if (tope >= SIN_LIMITE_MINUTOS) continue;
    const aTiempo = new Uint8Array(cat.n);
    for (let i = 0; i < cat.n; i++) aTiempo[i] = (cat.minutos[i] ?? 0) <= tope ? 1 : 0;
    m.set(`tiempo:${s}`, aTiempo);
  }

  // Sin esta máscara, un pool «grande» podría no contener ninguna receta
  // admisible en ningún slot pedido.
  if (pedidos.length > 0) {
    const enSlots = new Uint8Array(cat.n);
    for (const s of pedidos) {
      const bit = IDX_SLOT[s];
      for (let i = 0; i < cat.n; i++) {
        if (((cat.mSlot[i] ?? 0) >>> bit) & 1) enSlots[i] = 1;
      }
    }
    m.set("slots", enSlots);
  }

  return m;
}

/**
 * Cuántas recetas devolvería el pool si se quitara cada eje, y sólo ése.
 *
 * Coste: ~20 reducciones AND sobre N booleanos. Es la única forma de decir
 * «quitar esto te da 41 recetas más» sin inventarse el número, y es lo que
 * separa un diagnóstico honesto de una plantilla de texto.
 *
 * `n` es el número de filas del catálogo. Hace falta explícitamente para el
 * caso de una sola máscara: quitarla no deja ninguna condición y el pool
 * resultante es el catálogo entero. Python lo lee de `todas[0].shape[0]`; aquí
 * las máscaras son `Uint8Array` y su `length` serviría igual, pero pedirlo al
 * llamante deja claro que el resultado se mide contra el catálogo y no contra
 * lo que quepa en el primer array que se haya pasado.
 */
export function ablacion(
  mascaras: ReadonlyMap<string, Uint8Array>,
  n: number,
): { p0: number; ganancia: Map<string, number> } {
  const ganancia = new Map<string, number>();
  if (mascaras.size === 0) return { p0: 0, ganancia };

  const cuentaSalvo = (excluida: string | null): number => {
    let total = 0;
    for (let i = 0; i < n; i++) {
      let vivo = true;
      for (const [clave, mascara] of mascaras) {
        if (clave === excluida) continue;
        if ((mascara[i] ?? 0) === 0) {
          vivo = false;
          break;
        }
      }
      if (vivo) total++;
    }
    return total;
  };

  const p0 = cuentaSalvo(null);
  for (const clave of mascaras.keys()) {
    // Con una sola máscara, `cuentaSalvo` recorre un conjunto vacío de
    // condiciones y devuelve `n`, que es justo lo que hace el Python.
    ganancia.set(clave, cuentaSalvo(clave) - p0);
  }
  return { p0, ganancia };
}

/**
 * Ejes ordenados por ganancia, **sin ningún alérgeno**. Regla de seguridad.
 *
 * Es la ÚNICA puerta de entrada a las sugerencias estructurales de todo el
 * módulo, y así tiene que seguir siendo: sugerirle a un alérgico que se coma el
 * alérgeno es el peor fallo posible de este producto, y un filtro repetido en
 * dos sitios es un filtro que algún día sólo se arregla en uno.
 *
 * Se descartan también los ejes de ganancia ≤ 0: un «(+0 recetas)» no es una
 * sugerencia, es ruido con forma de botón.
 */
function ejesSugeribles(
  ganancia: ReadonlyMap<string, number>,
): Array<[string, number]> {
  const ejes: Array<[string, number]> = [];
  for (const [k, g] of ganancia) {
    if (k.startsWith("alergeno:")) continue;
    if (g > 0) ejes.push([k, g]);
  }
  // Mayor ganancia primero; a igualdad, la clave alfabéticamente MENOR. Ojo:
  // el desempate del CULPABLE va al revés (gana la mayor). No es un descuido
  // del Python, son dos preguntas distintas y así está en el código.
  ejes.sort((a, b) => (a[1] !== b[1] ? b[1] - a[1] : comparaId(a[0], b[0])));
  return ejes;
}

function fraseEje(eje: string, ganancia: number, restr: RestriccionesGeneracion): string {
  if (eje === "dieta") {
    const d = NOMBRE_DIETA[restr.dieta] ?? restr.dieta;
    return `Ampliar la dieta más allá de «${d}» (+${ganancia} recetas)`;
  }
  if (eje === "ingredientes_excluidos") {
    const n = restr.ingredientesExcluidos.length;
    return `Revisar tus ${n} ingredientes excluidos (+${ganancia} recetas)`;
  }
  if (eje.startsWith("tiempo:")) {
    const slot = eje.slice("tiempo:".length);
    const topes: Readonly<Record<string, number | undefined>> = topesPorSlot(restr);
    const tope = topes[slot] ?? SIN_LIMITE_MINUTOS;
    // «el tiempo del comida» es agramatical y así lo escribe el Python. Se
    // porta literal: los textos son contrato y hay fixtures que los congelan.
    // Arreglarlo es una decisión de producto, no del port.
    return (
      `Subir el tiempo del ${NOMBRE_SLOT[slot] ?? slot} ` +
      `de ${tope} a ${tope + MINUTOS_EXTRA_SUGERENCIA} min (+${ganancia} recetas)`
    );
  }
  if (eje === "slots") return `Elegir otras comidas del día (+${ganancia} recetas)`;
  return `Relajar «${eje}» (+${ganancia} recetas)`;
}

/**
 * Fase 1. Se dispara por las puertas 1 y 2 de §6.0.
 *
 * `slotsFlojos` es el dict FILTRADO de slots por debajo de `minPorSlot`, NO el
 * recuento completo de `candidatosPorSlot`. La diferencia no es cosmética: si
 * se pasa el recuento completo, el dict nunca está vacío, la rama de
 * `slot_sin_candidatos` se dispara SIEMPRE y el usuario lee «Sólo encuentro 21
 * recetas para la comida y necesito al menos 8», que además de incoherente es
 * falso. Era un bug real de `motor.py:299` (ya corregido también allí) y está
 * registrado como D4 en DIVERGENCIAS.md.
 */
export function diagnosticarPool(
  cat: CatalogoCompilado,
  restr: RestriccionesGeneracion,
  slots: readonly SlotComida[],
  pTotal: number,
  slotsFlojos: Readonly<Record<string, number | undefined>>,
  minPorSlot: number,
): FalloGeneracion {
  const mascaras = mascarasRestriccion(cat, restr, slots);
  const { p0, ganancia } = ablacion(mascaras, cat.n);
  const sugerencias = ejesSugeribles(ganancia).map(([e, g]) => fraseEje(e, g, restr));

  const relleno: string[] = [];
  if (slots.length > 2) {
    relleno.push(`Planificar ${slots.length - 1} comidas al día en vez de ${slots.length}`);
  }
  relleno.push("Avisarte en cuanto el catálogo tenga más recetas que te encajen");

  // El culpable puede ser un alérgeno: el usuario merece saberlo. Lo que nunca
  // ocurre es que aparezca entre las sugerencias.
  let culpable = "pool_insuficiente";
  let mejor = -Infinity;
  for (const [clave, g] of ganancia) {
    // `max(ganancia, key=lambda k: (ganancia[k], k))`: a igualdad de ganancia
    // gana la clave alfabéticamente MAYOR. El código manda sobre DISENO.md
    // §6, que describe el desempate por orden de inserción.
    if (g > mejor || (g === mejor && comparaId(clave, culpable) > 0)) {
      culpable = clave;
      mejor = g;
    }
  }

  const flojos = Object.entries(slotsFlojos).filter(
    (par): par is [string, number] => par[1] !== undefined,
  );
  if (flojos.length > 0) {
    // Se nombra el slot MÁS flojo; a igualdad, el más temprano del día. Un
    // slot que no esté en el vocabulario —que Python ni siquiera admitiría—
    // se ordena al final en vez de reventar: ver el docstring del módulo.
    let slot = "";
    let cuantas = Infinity;
    let orden = Infinity;
    for (const [s, c] of flojos) {
      const o = ORDEN_SLOT[s] ?? N_SLOTS;
      if (c < cuantas || (c === cuantas && o < orden)) {
        slot = s;
        cuantas = c;
        orden = o;
      }
    }
    return {
      restriccionCulpable: `slot_sin_candidatos:${slot}`,
      mensaje:
        `Sólo encuentro ${cuantas} recetas para el ` +
        `${NOMBRE_SLOT[slot] ?? slot} con tus filtros, y necesito al menos ` +
        `${minPorSlot} para armar el plan sin repetir.`,
      recetasCandidatas: pTotal,
      sugerencias: tres(sugerencias, relleno),
    };
  }

  let mensaje: string;
  if (culpable.startsWith("alergeno:")) {
    const a = culpable.slice("alergeno:".length);
    mensaje =
      `Excluir ${NOMBRE_ALERGENO[a] ?? a} deja ${p0} recetas. ` +
      "Mantenemos la exclusión: la seguridad va primero.";
  } else if (culpable === "dieta") {
    const d = NOMBRE_DIETA[restr.dieta] ?? restr.dieta;
    mensaje =
      `La dieta ${d} deja ${p0} recetas para ${slots.length} comidas al día, ` +
      "y no me da para un plan variado.";
  } else if (culpable === "ingredientes_excluidos") {
    const g = ganancia.get(culpable) ?? 0;
    mensaje =
      `Tus ${restr.ingredientesExcluidos.length} ingredientes excluidos ` +
      `dejan fuera ${g} recetas y me quedo con ${p0}.`;
  } else if (culpable.startsWith("tiempo:")) {
    const slot = culpable.slice("tiempo:".length);
    const topes: Readonly<Record<string, number | undefined>> = topesPorSlot(restr);
    mensaje =
      `Con ${topes[slot] ?? SIN_LIMITE_MINUTOS} min para el ${NOMBRE_SLOT[slot] ?? slot} ` +
      `sólo quedan ${p0} recetas.`;
  } else {
    mensaje =
      `Tu combinación de filtros deja ${p0} recetas y necesito ` +
      `al menos ${MIN_POOL} para que el plan no se repita.`;
  }

  return {
    restriccionCulpable: culpable,
    mensaje,
    recetasCandidatas: pTotal,
    sugerencias: tres(sugerencias, relleno),
  };
}

// ---------------------------------------------------------------------------
// Fase 2 — el pool basta pero el objetivo es inalcanzable
// ---------------------------------------------------------------------------

/**
 * Comprobación algebraica previa: los rangos no pueden sumar esas kcal.
 *
 * Cuesta un microsegundo y ahorra cientos de milisegundos de trabajo inútil.
 * Se hace ANTES de generar nada —lo primero de todo, no lo quinto como dice
 * DISENO.md—, y por eso su fallo no lleva ninguna sugerencia cuantificada: en
 * ese punto todavía no se ha construido el pool y no hay ningún número medido
 * que ofrecer. Las tres sugerencias de esa rama las escribe `motor.ts`.
 */
export function macrosIncompatibles(objetivo: ObjetivoNutricional): {
  malo: boolean;
  motivo: string;
} {
  const tol = objetivo.toleranciaKcal;
  const kcal = objetivo.kcal;
  const minimo =
    KCAL_POR_G_PROTEINA * objetivo.proteinaG.min +
    KCAL_POR_G_CARBOHIDRATO * objetivo.carbohidratoG.min +
    KCAL_POR_G_GRASA * objetivo.grasaG.min;
  const maximo =
    KCAL_POR_G_PROTEINA * objetivo.proteinaG.max +
    KCAL_POR_G_CARBOHIDRATO * objetivo.carbohidratoG.max +
    KCAL_POR_G_GRASA * objetivo.grasaG.max;
  if (minimo > kcal * (1 + tol)) {
    return {
      malo: true,
      motivo:
        `Los mínimos de macros que pides suman ${fmt0(minimo)} kcal, ` +
        `más de las ${fmt0(kcal)} kcal del día.`,
    };
  }
  if (maximo < kcal * (1 - tol)) {
    return {
      malo: true,
      motivo:
        `Los máximos de macros que pides suman ${fmt0(maximo)} kcal, ` +
        `menos de las ${fmt0(kcal)} kcal del día.`,
    };
  }
  return { malo: false, motivo: "" };
}

/**
 * Filas del pool admisibles en cada slot, con el tope de tiempo DE ESE SLOT.
 * Orden de inserción canónico, que es el que fija el orden de sumación de
 * `cotasAlcanzables`.
 */
function filasPorSlot(
  pool: Pool,
  restr: RestriccionesGeneracion,
  slots: readonly SlotComida[],
): Map<SlotComida, Int32Array> {
  const topes = topesPorSlot(restr);
  const salida = new Map<SlotComida, Int32Array>();
  for (const s of slotsUnicos(slots)) {
    const bit = IDX_SLOT[s];
    const tope = topes[s];
    const filas = new Int32Array(pool.p);
    let k = 0;
    for (let i = 0; i < pool.p; i++) {
      if ((((pool.mSlot[i] ?? 0) >>> bit) & 1) === 0) continue;
      if ((pool.minutos[i] ?? 0) > tope) continue;
      filas[k] = i;
      k++;
    }
    salida.set(s, filas.subarray(0, k));
  }
  return salida;
}

/** Recuento de recetas admisibles por slot, con el tope de tiempo de ese slot. */
export function candidatosPorSlot(
  pool: Pool,
  restr: RestriccionesGeneracion,
  slots: readonly SlotComida[],
): Record<SlotComida, number> {
  // Sólo contiene los slots PEDIDOS, aunque el tipo prometa los cinco: es la
  // misma licencia que se toma `Contexto.cuota` y por el mismo motivo (un
  // `Partial` obligaría a cada llamante a comprobar cinco accesos que siempre
  // existen). Quien itere sus claves, y no las cinco del vocabulario, no nota
  // la diferencia; y es exactamente lo que hacen `motor.ts` y el Python.
  const salida = {} as Record<SlotComida, number>;
  for (const [s, filas] of filasPorSlot(pool, restr, slots)) salida[s] = filas.length;
  return salida;
}

/**
 * Cotas demostrables sobre lo que este pool puede dar. §6.2
 *
 * No se adivina: si el objetivo cae fuera de estas cotas, la imposibilidad está
 * *probada* y se puede escribir un mensaje afirmativo sin mentir.
 *
 * Los slots sin ninguna fila se SALTAN, y con ellos su cuota: la cota resultante
 * es la de un día con menos comidas de las pedidas. Se replica del Python
 * porque el caso real —un slot vacío— ya se ha rechazado antes por la puerta 1,
 * así que aquí sólo aparece cuando alguien llama a la función suelta.
 */
export function cotasAlcanzables(
  pool: Pool,
  restr: RestriccionesGeneracion,
  slots: readonly SlotComida[],
  cuota: Readonly<Record<SlotComida, number>>,
  kcal: number,
): { protMax: number; fibraMax: number; kcalMin: number; sodioMin: number } {
  let protMax = 0;
  let fibraMax = 0;
  let kcalMin = 0;
  let sodioMin = 0;

  for (const [s, filas] of filasPorSlot(pool, restr, slots)) {
    if (filas.length === 0) continue;
    let densProt = -Infinity;
    let densFibra = -Infinity;
    let minKcal = Infinity;
    let minSodio = Infinity;
    for (let t = 0; t < filas.length; t++) {
      const i = filas[t] ?? 0;
      const base = i * N_NUTR;
      const k = Math.max(pool.nutr[base + IDX_KCAL] ?? 0, EPS_KCAL_RECETA);
      // Máxima densidad proteica del slot: asigna a cada slot su mejor receta e
      // ignora las cotas de σ, que sólo pueden empeorarlo. Cota SUPERIOR.
      const dp = (pool.nutr[base + IDX_PROT] ?? 0) / k;
      if (dp > densProt) densProt = dp;
      const df = (pool.nutr[base + IDX_FIBRA] ?? 0) / k;
      if (df > densFibra) densFibra = df;
      // Cota INFERIOR de energía: ni comiendo la receta más ligera en su ración
      // más pequeña se baja de aquí. `Math.fround` porque numpy multiplica dos
      // float32 y el resultado se queda en float32 antes del mínimo; es de los
      // pocos sitios donde el Python materializa un float32 y aquí se replica.
      const escala = pool.escalaMin[i] ?? 0;
      const ek = Math.fround((pool.nutr[base + IDX_KCAL] ?? 0) * escala);
      if (ek < minKcal) minKcal = ek;
      const es = Math.fround((pool.nutr[base + IDX_SODIO] ?? 0) * escala);
      if (es < minSodio) minSodio = es;
    }
    const c = cuota[s] ?? 0;
    protMax += kcal * c * densProt;
    fibraMax += kcal * c * densFibra;
    kcalMin += minKcal;
    sodioMin += minSodio;
  }
  return { protMax, fibraMax, kcalMin, sodioMin };
}

/**
 * Fase 2. Se dispara cuando E > UMBRAL_ERROR_ACEPTABLE tras la etapa D.
 *
 * `alcanzado` son los totales (6,) del mejor plan REAL que se ha conseguido. De
 * ahí salen los números de las sugerencias: prometer lo que ya hemos construido
 * es la única forma de que la sugerencia sea verdad cuando el usuario la pulsa
 * y vuelve a pedir plan. Si es `null` se cae a las cotas teóricas, que son
 * ciertas pero más flojas.
 */
export function diagnosticarObjetivo(
  pool: Pool,
  cat: CatalogoCompilado,
  restr: RestriccionesGeneracion,
  slots: readonly SlotComida[],
  cuota: Readonly<Record<SlotComida, number>>,
  objetivo: ObjetivoNutricional,
  alcanzado: Float64Array | null,
  pTotal: number,
): FalloGeneracion {
  const tol = objetivo.toleranciaKcal;
  const kcal = objetivo.kcal;
  const { protMax, fibraMax, kcalMin } = cotasAlcanzables(pool, restr, slots, cuota, kcal);

  const { ganancia } = ablacion(mascarasRestriccion(cat, restr, slots), cat.n);
  const ejes = ejesSugeribles(ganancia);
  // Sólo el PRIMER eje, no todos: aquí el problema no es el pool sino el
  // objetivo, y las dos primeras sugerencias tienen que ser las cuantificadas
  // sobre el objetivo. Lo estructural es la red de seguridad.
  const estructural: string[] = ejes.slice(0, 1).map(([e, g]) => fraseEje(e, g, restr));
  if (slots.length > 2) {
    estructural.push(
      `Planificar ${slots.length - 1} comidas al día en vez de ${slots.length}`,
    );
  }

  // 1. Pedir demasiadas comidas para tan pocas calorías. Es el fallo más común
  //    en la práctica, más que la proteína.
  //
  // La condición y el cuerpo van en dos `if` en vez de en uno porque
  // `cuotaMenor` sale de un bucle y con `noUncheckedIndexedAccess` el
  // compilador no puede saber que `slots.length > 1` lo deja asignado. Callarlo
  // con `!` taparía justo eso; separarlo hace que, si alguna vez quedara sin
  // asignar, se caiga a la rama siguiente en vez de emitir una sugerencia sobre
  // «undefined».
  let cuotaMenor: SlotComida | undefined;
  if (kcal * (1 + tol) < kcalMin && slots.length > 1) {
    for (const s of slots) {
      if (cuotaMenor === undefined || (cuota[s] ?? 0) < (cuota[cuotaMenor] ?? 0)) {
        cuotaMenor = s;
      }
    }
  }
  if (cuotaMenor !== undefined) {
    const menor = cuotaMenor;
    const restantes = slots.filter((s) => s !== menor);
    // Se pasa la `cuota` entera y no una copia recortada: `cotasAlcanzables`
    // sólo lee las claves de `restantes`, así que el resultado es idéntico al
    // del dict por comprensión de Python.
    const { kcalMin: kcalMinMenos } = cotasAlcanzables(
      pool,
      restr,
      restantes,
      cuota,
      kcal,
    );
    return {
      restriccionCulpable: "kcal_insuficientes_para_slots",
      mensaje:
        `Con ${slots.length} comidas al día, lo mínimo que puedo servir son ` +
        `${fmt0(kcalMin)} kcal, y tú pides ${fmt0(kcal)}.`,
      recetasCandidatas: pTotal,
      sugerencias: tres(
        [
          // DIVERGENCIA D6, con el número delante. Python cuantifica siempre
          // («el mínimo baja a 571 kcal») y ese 571 es un suelo REAL del pool,
          // no un objetivo… pero es un botón que empuja al usuario hacia un día
          // de 571 kcal, y spec §11.3 no distingue: por debajo de
          // KCAL_MINIMAS_ABSOLUTO no se propone nada. Cuando el suelo que
          // quedaría es seguro se cuantifica igual que Python; cuando no, se
          // dice lo que sí es cierto y no orienta a nadie hacia un déficit
          // peligroso. La otra sugerencia de esta rama ya lleva el objetivo
          // seguro («Subir a 1.200 kcal al día»).
          kcalMinMenos >= KCAL_MINIMAS_ABSOLUTO
            ? `Quitar ${SLOT_CON_ARTICULO[menor] ?? menor}: ` +
              `el mínimo baja a ${fmt0(kcalMinMenos)} kcal`
            : `Quitar ${SLOT_CON_ARTICULO[menor] ?? menor}: ` +
              `es la comida que menos calorías aporta`,
          `Subir a ${kcalSegura(kcalMin)} kcal al día`,
        ],
        estructural,
      ),
    };
  }

  // 2. Proteína contra energía: el ejemplo canónico de la spec §4.2.
  const protMinPedida = objetivo.proteinaG.min;
  if (protMinPedida > protMax) {
    const logrado = alcanzado !== null ? (alcanzado[IDX_PROT] ?? 0) : protMax;
    const kcalNecesarias = kcalSegura(protMinPedida / Math.max(protMax / kcal, EPS_DENSIDAD));
    // El número sale del plan que SÍ hemos construido, no de la cota teórica.
    const sugerencias = [`Bajar el mínimo de proteína a ${Math.floor(logrado)} g`];
    if (kcalNecesarias <= kcal * FACTOR_MAX_SUBIDA_KCAL) {
      sugerencias.push(`Subir a ${kcalNecesarias} kcal al día`);
    }
    return {
      restriccionCulpable: "proteina_vs_kcal",
      mensaje:
        `No consigo llegar a ${fmt0(protMinPedida)} g de proteína con ` +
        `${fmt0(kcal)} kcal y las ${pTotal} recetas que quedan tras tus filtros. ` +
        `Lo más cerca que llego es ${fmt0(logrado)} g.`,
      recetasCandidatas: pTotal,
      sugerencias: tres(sugerencias, estructural),
    };
  }

  // 3. Fibra y sodio: mismo esquema, menor gravedad percibida.
  const fibraMinPedida = objetivo.fibraMinG || 0;
  if (fibraMinPedida > fibraMax) {
    const logrado = alcanzado !== null ? (alcanzado[IDX_FIBRA] ?? 0) : fibraMax;
    return {
      restriccionCulpable: "fibra_inalcanzable",
      mensaje:
        `Con estas recetas no llego a ${fmt0(fibraMinPedida)} g de fibra; ` +
        `lo más alto que consigo son ${fmt0(logrado)} g.`,
      recetasCandidatas: pTotal,
      sugerencias: tres([`Bajar la fibra mínima a ${Math.floor(logrado)} g`], estructural),
    };
  }

  const sodioTope = objetivo.sodioMaxMg ?? null;
  // Se exige un 20 % de margen y NO se usa `sodioMin`: la cota inferior de
  // sodio del pool se calcula porque es barata y porque la traza la enseña,
  // pero declarar imposible un tope de sodio con la receta más ligera de cada
  // slot sería declararlo casi siempre. Manda lo que el motor ha conseguido.
  if (
    sodioTope !== null &&
    alcanzado !== null &&
    (alcanzado[IDX_SODIO] ?? 0) > sodioTope * MARGEN_SODIO_INALCANZABLE
  ) {
    const logrado = alcanzado[IDX_SODIO] ?? 0;
    const techo = Math.ceil(logrado / PASO_SODIO_SUGERENCIA) * PASO_SODIO_SUGERENCIA;
    return {
      restriccionCulpable: "sodio_inalcanzable",
      mensaje:
        `No consigo bajar de ${fmt0(logrado)} mg de sodio con estas recetas, ` +
        `y tu tope son ${fmt0(sodioTope)} mg.`,
      recetasCandidatas: pTotal,
      sugerencias: tres([`Subir el tope de sodio a ${fmt0(techo)} mg`], estructural),
    };
  }

  // 4. Genérico: se sabe que no cuadra, no se sabe demostrar por qué. Es la
  //    única rama que no promete nada, y por eso es la que más depende de que
  //    los rellenos genéricos sean tres frases distintas.
  let detalle = "";
  const sugerencias: string[] = [];
  if (alcanzado !== null) {
    detalle =
      ` Lo más cerca que llego son ${fmt0(alcanzado[IDX_KCAL] ?? 0)} kcal ` +
      `con ${fmt0(alcanzado[IDX_PROT] ?? 0)} g de proteína.`;
    sugerencias.push(
      `Ampliar la tolerancia de calorías al ` +
        `${fmt0(Math.max(tol, TOLERANCIA_MINIMA_SUGERIDA) * 100 + PUNTOS_EXTRA_TOLERANCIA)} %`,
    );
    sugerencias.push(
      `Bajar el mínimo de proteína a ${Math.floor(alcanzado[IDX_PROT] ?? 0)} g`,
    );
  }
  return {
    restriccionCulpable: "objetivo_inalcanzable_generico",
    mensaje:
      "No encuentro una combinación que cuadre con tus objetivos y las " +
      `${pTotal} recetas disponibles.${detalle}`,
    recetasCandidatas: pTotal,
    sugerencias: tres(sugerencias, estructural),
  };
}
