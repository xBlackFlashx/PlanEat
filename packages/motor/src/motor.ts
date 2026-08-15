/**
 * Orquestador del motor. `SolicitudGeneracion` → `RespuestaGeneracion`.
 *
 * Port de `services/solver/app/solver/motor.py`, más el saneado de objetivos que
 * hoy vive en el route handler de Next (`apps/web/src/app/api/plan/route.ts:49-66`)
 * y que aquí se absorbe porque en GitHub Pages ese servidor deja de existir.
 *
 * El motor es una **función pura sobre catálogo + petición**: no toca disco, no
 * consulta nada y no lee el reloj para decidir. La fecha entra sólo en
 * `DiaPlan.fecha`, jamás en una decisión (§2.6); por eso el mismo seed con la
 * misma entrada produce el mismo plan. `performance.now()` se usa para medir, y
 * ninguna medida se compara con un umbral: si se comparara, el plan dependería
 * de lo cargada que estuviera la máquina.
 *
 * Orden de las comprobaciones, y por qué es ése:
 *
 * 1. Validación del objetivo — un rango invertido es un error del cliente, no un
 *    plan imposible; devolverlo como sobre-restricción sería indepurable.
 * 2. Macros incompatibles — comprobación algebraica de 1 µs que ahorra cientos
 *    de milisegundos de trabajo inútil. Es lo PRIMERO del motor, no lo quinto
 *    como dice DISENO.md.
 * 3. Las tres puertas del pool (§6.0) — distinguir «tus filtros aprietan» de
 *    «nuestro catálogo es corto» es el trabajo de producto más diferencial del
 *    servicio, y con 36 recetas en el catálogo semilla y MIN_POOL = 40 es la
 *    diferencia entre una demo que funciona y una que rechaza el 100 % de las
 *    peticiones culpando al usuario de restricciones que no ha puesto.
 * 4. Generación A→B→C→D.
 * 5. Umbral de honestidad — si tras reparar el PEOR día sigue fuera de banda,
 *    diagnóstico honesto en vez de un plan silenciosamente incorrecto. Una sola
 *    vez, después de la etapa D y de `repararDuras`, no dentro de la etapa C
 *    (DISENO §4.2 dice otra cosa; manda el código).
 */

import {
  FRACCION_POOL_ATRIBUIBLE,
  IDX_CARB,
  IDX_FIBRA,
  IDX_GRASA,
  IDX_KCAL,
  IDX_PROT,
  IDX_SLOT,
  IDX_SODIO,
  MAX_USOS_RECETA_SEMANA,
  MIN_CANDIDATOS_SLOT_DIA,
  MIN_CANDIDATOS_SLOT_SEMANA,
  MIN_POOL,
  N_NUTR,
  UMBRAL_ERROR_ACEPTABLE,
  VARIEDAD_POR_DEFECTO,
  VERSION_GENERADOR,
  temperatura,
} from "./constantes.ts";
import {
  candidatosPorSlot,
  diagnosticarObjetivo,
  diagnosticarPool,
  macrosIncompatibles,
} from "./diagnostico.ts";
import { construirPool } from "./pool.ts";
import { resolverPorcionesRejilla } from "./porciones.ts";
import { semillaAleatoria, semillaDesdeTexto } from "./rng.ts";
import { contextoDe, cuotasDe } from "./scoring.ts";
import { ensamblar, generarCandidatos, repararDuras } from "./semanal.ts";
import type { CatalogoCompilado } from "./catalogo.ts";
import type {
  CandidatoDia,
  ComidaPlan,
  DiaPlan,
  FalloGeneracion,
  ObjetivoNutricional,
  Pool,
  Progreso,
  ResolverPorciones,
  RespuestaGeneracion,
  SlotComida,
  SolicitudGeneracion,
  TotalesNutricionales,
  Traza,
} from "./tipos.ts";

// ---------------------------------------------------------------------------
// Números de este módulo
// ---------------------------------------------------------------------------
//
// La regla de la casa es que todo número mágico vive en `constantes.ts`. Estos
// siete no están allí por el mismo motivo operativo que D3 y D7 de
// DIVERGENCIAS.md: `constantes.ts` es de otro agente del port y editarlo en
// paralelo es cómo se pierden ediciones. Van juntos, nombrados y comentados, y
// están **pendientes de trasladar** cuando el port se cierre (entrada D8).

/**
 * Límites de seguridad del objetivo diario, absorbidos del saneado que hoy hace
 * el route handler de Next sobre los ajustes del usuario
 * (`apps/web/src/app/api/plan/route.ts:52-58`).
 *
 * No son una defensa contra ataques —no hay servidor que defender— sino un
 * límite de producto: por debajo de 800 kcal ningún plan es defendible sin
 * supervisión médica, y por encima de 6.000 el catálogo no da y el diagnóstico
 * culparía a los filtros. Al desaparecer el servidor, si no viajan aquí
 * desaparecen con él.
 */
const KCAL_MINIMAS_SOLICITUD = 800;
const KCAL_MAXIMAS_SOLICITUD = 6000;
const PROTEINA_MINIMA_SOLICITUD_G = 20;
const PROTEINA_MAXIMA_SOLICITUD_G = 400;

/** Decimales del contrato. Los totales van a 0,1 g y el factor de ración a 0,01. */
const DECIMALES_TOTALES = 1;
const DECIMALES_RACION = 2;
/** Los errores de la traza, a 1e-4: por debajo de eso no dicen nada. */
const DECIMALES_ERROR_TRAZA = 4;

const MS_POR_DIA = 86_400_000;

// ---------------------------------------------------------------------------
// Error del cliente
// ---------------------------------------------------------------------------

/**
 * Objetivo mal formado. **No** es una sobre-restricción.
 *
 * Es la única excepción que `generar` deja escapar, y el llamante la traduce a
 * un estado propio: un rango invertido no es «no llego a tu objetivo», es «tu
 * objetivo no se puede leer», y confundirlos deja al usuario delante de una
 * pantalla que le propone relajar restricciones que no tienen nada que ver.
 * En el servicio Python esto era el 422 de la capa HTTP.
 */
export class ObjetivoInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ObjetivoInvalido";
  }
}

/** Opciones de generación. Ninguna cambia el contrato; todas tienen defecto. */
export interface OpcionesGenerar {
  /** `YYYY-MM-DD`. Sólo alimenta `DiaPlan.fecha`. Por defecto, hoy. */
  hoy?: string;
  /** Semilla en decimal. **Cadena**: son 63 bits y no caben en un `number`. */
  seed?: string;
  /**
   * 0-100. NO se cablea al contrato por defecto: exponerlo cambia los planes de
   * todo el mundo el día que la UI decida enseñarlo. Queda como opción.
   */
  variedad?: number;
  /** La etapa B, sustituible. Por defecto, el descenso coordinado del port. */
  resolver?: ResolverPorciones;
  /**
   * Gancho de progreso. Se llama en las cuatro etapas reales; si lanza, la
   * excepción sale por `generar` y rompe la promesa de «nunca lanza salvo
   * ObjetivoInvalido». Quien lo pase se encarga de que no lance.
   */
  alAvanzar?: (progreso: Progreso) => void;
}

// ---------------------------------------------------------------------------
// Redondeo del contrato
// ---------------------------------------------------------------------------

/**
 * `round(x, d)` de Python para d ≥ 1, sin banca y sin que haga falta.
 *
 * Python redondea los empates al par y `toFixed` los redondea hacia +∞, así que
 * en general no son la misma función. Con **d ≥ 1 decimal sí lo son**, y la
 * razón es aritmética, no empírica: un empate exacto a d decimales exige que el
 * double valga n/10^d + 1/(2·10^d) = (2n+1)/(2·10^d), cuyo denominador tiene un
 * factor 5^d y por tanto no es representable en binario. Los empates
 * simplemente no ocurren, los dos redondeos coinciden con el correcto, y
 * `toFixed` es el correcto por especificación de ECMAScript.
 *
 * Con d = 0 esto NO valdría (0,5 y 2,5 sí son exactos), y por eso el redondeo a
 * entero del resto del motor pasa por `redondeoMitadAPar` de `numerico.ts` y no
 * por aquí.
 */
function redondear(x: number, decimales: number): number {
  return Number(x.toFixed(decimales));
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

/**
 * Convierte un «no hay plan» indepurable en un mensaje claro. §3.5
 *
 * El contrato compartido (`@planeat/shared`) no lleva validadores —es la fuente
 * de verdad de la FORMA, no de los rangos— así que se comprueban en la frontera
 * del motor, igual que hacía `motor.py:94`.
 *
 * Las dos últimas comprobaciones no vienen de Python sino del route handler de
 * Next: ver `KCAL_MINIMAS_SOLICITUD` y siguientes. Van DESPUÉS de las de Python
 * y en su propia pasada para que los mensajes de las comprobaciones portadas
 * salgan idénticos a los del servicio mientras los dos convivan.
 */
export function validarSolicitud(solicitud: SolicitudGeneracion): void {
  if (solicitud.objetivos.length === 0) {
    throw new ObjetivoInvalido("Hace falta al menos un objetivo diario.");
  }
  if (solicitud.restricciones.slots.length === 0) {
    throw new ObjetivoInvalido("Hace falta al menos una comida al día.");
  }

  for (const [i, obj] of solicitud.objetivos.entries()) {
    const dia = i + 1;
    if (obj.kcal <= 0) {
      throw new ObjetivoInvalido(`Día ${dia}: las kcal objetivo deben ser mayores que cero.`);
    }
    if (!(obj.toleranciaKcal >= 0 && obj.toleranciaKcal <= 0.5)) {
      throw new ObjetivoInvalido(`Día ${dia}: la tolerancia de kcal debe estar entre 0 y 0,5.`);
    }
    for (const [nombre, rango] of [
      ["proteína", obj.proteinaG],
      ["carbohidrato", obj.carbohidratoG],
      ["grasa", obj.grasaG],
    ] as const) {
      if (rango.min < 0 || rango.max < 0) {
        throw new ObjetivoInvalido(`Día ${dia}: el rango de ${nombre} no puede ser negativo.`);
      }
      if (rango.min > rango.max) {
        throw new ObjetivoInvalido(
          `Día ${dia}: el rango de ${nombre} está invertido ` +
            `(mín ${formatoG(rango.min)} > máx ${formatoG(rango.max)}).`,
        );
      }
    }
  }

  for (const [i, obj] of solicitud.objetivos.entries()) {
    const dia = i + 1;
    if (obj.kcal < KCAL_MINIMAS_SOLICITUD || obj.kcal > KCAL_MAXIMAS_SOLICITUD) {
      throw new ObjetivoInvalido(
        `Día ${dia}: las kcal objetivo tienen que estar entre ` +
          `${KCAL_MINIMAS_SOLICITUD} y ${KCAL_MAXIMAS_SOLICITUD}.`,
      );
    }
    if (
      obj.proteinaG.max < PROTEINA_MINIMA_SOLICITUD_G ||
      obj.proteinaG.max > PROTEINA_MAXIMA_SOLICITUD_G
    ) {
      throw new ObjetivoInvalido(
        `Día ${dia}: el máximo de proteína tiene que estar entre ` +
          `${PROTEINA_MINIMA_SOLICITUD_G} y ${PROTEINA_MAXIMA_SOLICITUD_G} g.`,
      );
    }
  }
}

/**
 * El `:g` de Python para los mensajes de rango invertido.
 *
 * `f'{160.0:g}'` escribe `160`, no `160.0`, y `f'{0.5:g}'` escribe `0.5`. En JS
 * `String(160)` ya da `'160'` porque no hay float distinto de int, así que
 * basta con recortar la notación exponencial, que `:g` sólo usa a partir de
 * 1e6 y que aquí no puede aparecer con los límites de arriba.
 */
function formatoG(x: number): string {
  return String(x);
}

/**
 * Cuántas recetas hacen falta por slot para que el plan sea armable. §6.0
 *
 * Sale de la restricción dura de repetición, no de un número a ojo: con
 * `MAX_USOS_RECETA_SEMANA` usos y D días hacen falta al menos ceil(D/2) recetas
 * distintas por slot, más 4 de holgura para que el recocido tenga algo que
 * intercambiar. La holgura se calcula (8 − ceil(7/2)) en vez de escribirse:
 * `MIN_CANDIDATOS_SLOT_SEMANA` y ese 4 son redundantes entre sí, y derivar uno
 * del otro es lo que impide que se separen sin que nadie se entere.
 */
export function minCandidatosSlot(nDias: number): number {
  if (nDias <= 1) return MIN_CANDIDATOS_SLOT_DIA; // elegir + 2 reparaciones
  const holgura = MIN_CANDIDATOS_SLOT_SEMANA - Math.ceil(7 / MAX_USOS_RECETA_SEMANA);
  return Math.min(
    MIN_CANDIDATOS_SLOT_SEMANA,
    Math.ceil(nDias / MAX_USOS_RECETA_SEMANA) + holgura,
  );
}

// ---------------------------------------------------------------------------
// Serialización al contrato
// ---------------------------------------------------------------------------

/**
 * Traduce el vector de 6 nutrientes a los totales del contrato.
 *
 * `fibraG` va a `null` cuando menos del 80 % de las kcal del día tienen fibra
 * conocida: un total parcial se lee como total y miente. §8.5
 *
 * `sodioMg` sale de la columna 5, que el motor ya calculaba y el serializador
 * de Python tiraba. Su criterio de fiabilidad es MÁS estricto que el de la
 * fibra —basta con que UN item no declare sodio para anularlo— y no es una
 * incoherencia: el sodio es la única columna donde el interés del usuario es un
 * techo, y un techo estimado por defecto invita a pasarse creyendo que no.
 *
 * Ojo: esto NO es lo mismo que `nutrientesActivos`, que decide si el sodio entra
 * en la función objetivo y para eso mira además si hay `sodioMaxMg`.
 */
function panel(
  totales: Float64Array,
  fibraFiable: boolean,
  sodioFiable: boolean,
): TotalesNutricionales {
  const v = (n: number): number => redondear(totales[n] ?? 0, DECIMALES_TOTALES);
  return {
    kcal: v(IDX_KCAL),
    proteinaG: v(IDX_PROT),
    carbohidratoG: v(IDX_CARB),
    grasaG: v(IDX_GRASA),
    fibraG: fibraFiable ? v(IDX_FIBRA) : null,
    sodioMg: sodioFiable ? v(IDX_SODIO) : null,
  };
}

/**
 * Serializa un candidato. Los totales SIEMPRE se recalculan desde los items.
 *
 * Devolver los totales de una solución intermedia mientras los items llevan los
 * σ cuantizados es el bug más caro posible: la suma que enseña la UI dejaría de
 * cuadrar con las comidas que enseña la misma UI, y con ella se cae la confianza
 * en todo el plan. Aquí el día se acumula comida a comida, del mismo vector del
 * que sale cada comida, así que la igualdad es estructural y no una promesa.
 *
 * Las comidas se reordenan a orden CRONOLÓGICO por `IDX_SLOT`: el candidato
 * viene en orden de selección (cuota descendente), que es el que necesita la
 * etapa A y el que no espera nadie que lea un plan.
 */
function diaAContrato(
  pool: Pool,
  cand: CandidatoDia,
  fecha: string,
  objetivo: ObjetivoNutricional,
): DiaPlan {
  const clave = cand.slots.map((s) => IDX_SLOT[s]);
  const orden = cand.slots.map((_, p) => p);
  orden.sort((a, b) => (clave[a] ?? 0) - (clave[b] ?? 0));

  const comidas: ComidaPlan[] = [];
  const acumulado = new Float64Array(N_NUTR);

  // El sodio del día sólo es fiable si lo es el de TODAS sus comidas: una suma a
  // la que le falta un sumando no es cota superior de nada.
  let sodioDia = true;
  for (const fila of cand.filas) {
    if ((pool.conocido[fila * N_NUTR + IDX_SODIO] ?? 0) === 0) sodioDia = false;
  }

  for (const p of orden) {
    const fila = cand.filas[p];
    const sigma = cand.sigma[p];
    const slot = cand.slots[p];
    if (fila === undefined || sigma === undefined || slot === undefined) {
      throw new Error("diaAContrato: el candidato tiene slots, filas y sigma desalineados");
    }
    const totales = new Float64Array(N_NUTR);
    const base = fila * N_NUTR;
    for (let n = 0; n < N_NUTR; n++) {
      totales[n] = (pool.nutr[base + n] ?? 0) * sigma;
      acumulado[n] = (acumulado[n] ?? 0) + (totales[n] ?? 0);
    }
    comidas.push({
      slot,
      items: [
        {
          recetaId: pool.ids[fila] ?? "",
          factorRacion: redondear(sigma, DECIMALES_RACION),
          bloqueado: false,
        },
      ],
      totales: panel(
        totales,
        cand.fibraFiable,
        (pool.conocido[base + IDX_SODIO] ?? 0) === 1,
      ),
    });
  }

  return {
    fecha,
    comidas,
    totales: panel(acumulado, cand.fibraFiable, sodioDia),
    objetivo,
  };
}

/**
 * Los slots de la petición en orden CANÓNICO, sin deduplicar.
 *
 * `ordenDeSlots` deriva el orden de SELECCIÓN de la cuota, así que la etapa A no
 * mira en qué orden llegaron los slots. Pero `cuotasDe` sí: normaliza dividiendo
 * por `Σ PESO_SLOT[s]` sumado en el orden de la lista, y la suma en coma
 * flotante no es asociativa. Con los cinco slots, pedirlos al derecho o al revés
 * da un total que difiere en 2 ULP, cada cuota difiere en 1 ULP, `sigmaSugerido`
 * hereda la diferencia y el descenso coordinado acaba en OTRO óptimo de la
 * rejilla —igual de bueno, E idéntico, pero con σ distintos—. Es decir: dos
 * peticiones equivalentes con el mismo seed daban planes distintos, que es
 * exactamente lo que la promesa de reproducibilidad dice que no pasa.
 *
 * Python tiene el mismo agujero (`sum(PESO_SLOT[s] for s in slots)`) y nunca se
 * notó porque el cliente siempre manda los slots en orden cronológico. Se cierra
 * aquí, en la frontera, y no en `cuotasDe`, por dos razones: es el único sitio
 * por el que entra la lista del usuario, y `cuotasDe` es una función pura que el
 * arnés de paridad compara contra el volcado de Python entrada a entrada.
 *
 * NO deduplica: `cuotasDe` cuenta cada aparición y pedir ['comida','comida'] da
 * cuota 0,5. Es raro, pero es el comportamiento del original y arreglarlo aquí
 * cambiaría planes por la puerta de atrás. Con la lista ya ordenada, dos
 * permutaciones del mismo multiconjunto son la misma lista, que es lo único que
 * hacía falta.
 */
function slotsCanonicos(slots: readonly SlotComida[]): SlotComida[] {
  return [...slots].sort((a, b) => IDX_SLOT[a] - IDX_SLOT[b]);
}

/**
 * `hoy` + d días en ISO, sin que la zona horaria se cuele en la fecha.
 *
 * Todo el cálculo va en UTC a propósito. Sumar días con `setDate` sobre una
 * fecha local hace que un plan generado la noche del cambio de hora tenga dos
 * días con la misma fecha o se salte uno, y una fecha equivocada en un plan
 * semanal es de las cosas que el usuario sí nota.
 */
function fechaDe(hoy: string | undefined, d: number): string {
  let base: number;
  if (hoy === undefined) {
    const ahora = new Date();
    base = Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hoy);
    if (m === null) {
      throw new ObjetivoInvalido(`La fecha «${hoy}» no está en formato YYYY-MM-DD.`);
    }
    base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(base + d * MS_POR_DIA).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Generación
// ---------------------------------------------------------------------------

function trazaVacia(seed: bigint): Traza {
  return {
    seed: seed.toString(),
    pool: 0,
    msTotal: 0,
    msPool: 0,
    msGeneracion: 0,
    msEnsamblado: 0,
    duplicados: 0,
    erroresPorDia: [],
    intentosReparacion: 0,
    porcionadosDeEmergencia: 0,
    reparacionesDuras: 0,
    terminosDesactivados: [],
    catalogoEstrecho: false,
  };
}

/**
 * La semilla efectiva, con las tres procedencias en orden de precedencia.
 *
 * `opciones.seed` es la canónica y viaja como cadena decimal porque son 63 bits
 * y un `number` sólo garantiza 53: el redondeo ocurriría en silencio al pasar
 * por JSON o por la query de la URL y el plan dejaría de ser reproducible sin
 * que nada fallara.
 *
 * `solicitud.seed` sigue siendo `number` en el contrato compartido y se admite
 * por compatibilidad con lo que hoy manda la web, pero se rechaza si no es un
 * entero exacto: aceptar 2^53+1 en silencio sería regenerar un plan distinto y
 * jurar que es el mismo.
 */
function semillaDe(solicitud: SolicitudGeneracion, opciones: OpcionesGenerar): bigint {
  if (opciones.seed !== undefined) return semillaDesdeTexto(opciones.seed);
  if (solicitud.seed !== undefined) {
    if (!Number.isSafeInteger(solicitud.seed) || solicitud.seed < 0) {
      throw new ObjetivoInvalido(
        `La semilla ${String(solicitud.seed)} no es un entero exacto: pásala como ` +
          "cadena decimal en las opciones para no perder bits.",
      );
    }
    return BigInt(solicitud.seed);
  }
  return semillaAleatoria();
}

function fallo(f: FalloGeneracion, traza: Traza, t0: number): {
  respuesta: RespuestaGeneracion;
  traza: Traza;
} {
  traza.msTotal = Math.trunc(performance.now() - t0);
  return { respuesta: { ok: false, fallo: f }, traza };
}

/**
 * Genera el plan. Nunca lanza salvo `ObjetivoInvalido` (error del cliente).
 *
 * Devuelve también la `Traza`, que en el servicio moría en un log de servidor.
 * Aquí no hay servidor: el objetivo del despliegue es validar que el motor
 * funciona de verdad, y para eso enseñar la instrumentación vale más que
 * archivarla.
 */
export function generar(
  solicitud: SolicitudGeneracion,
  cat: CatalogoCompilado,
  opciones: OpcionesGenerar = {},
): { respuesta: RespuestaGeneracion; traza: Traza } {
  const t0 = performance.now();
  validarSolicitud(solicitud);

  const seed = semillaDe(solicitud, opciones);
  const traza = trazaVacia(seed);
  // Las restricciones se copian con los slots ya en orden canónico y se pasan
  // así a TODO lo que viene detrás. `contextoDe` calcula la cuota a partir de
  // `restr.slots`, no del argumento `slots`, así que ordenar sólo la variable
  // local dejaría la mitad del motor leyendo el orden del usuario.
  const slots = slotsCanonicos(solicitud.restricciones.slots);
  const restr = { ...solicitud.restricciones, slots };
  const objetivos = solicitud.objetivos;
  const nDias = objetivos.length;
  const resolver = opciones.resolver ?? resolverPorcionesRejilla;
  const avisar = opciones.alAvanzar;

  // Las fechas se calculan antes de nada para que una `hoy` mal formada falle
  // como error del cliente y no después de 300 ms de trabajo tirado.
  const fechas: string[] = [];
  for (let d = 0; d < nDias; d++) fechas.push(fechaDe(opciones.hoy, d));

  avisar?.({ etapa: "objetivos", dia: 0, deDias: nDias });

  // (2) Comprobación algebraica antes de construir nada: 1 µs frente a ~300 ms.
  // Sus tres sugerencias son fijas y las escribe este módulo: en este punto no
  // hay pool y no hay ni un número medido que ofrecer, así que ofrecer uno sería
  // inventarlo.
  for (const obj of objetivos) {
    const { malo, motivo } = macrosIncompatibles(obj);
    if (malo) {
      return fallo(
        {
          restriccionCulpable: "macros_incompatibles",
          mensaje: motivo,
          recetasCandidatas: 0,
          sugerencias: [
            "Recalcular los macros a partir de tus kcal objetivo",
            "Ampliar el rango de carbohidratos",
            "Ampliar el rango de grasa",
          ],
        },
        traza,
        t0,
      );
    }
  }

  const tPool = performance.now();
  const pool = construirPool(cat, restr);
  traza.msPool = Math.trunc(performance.now() - tPool);
  traza.pool = pool.p;
  avisar?.({ etapa: "pool", dia: 0, deDias: nDias });

  // (3) Las tres puertas de §6.0. Un umbral absoluto `|P| < MIN_POOL` culparía
  // al usuario de que el catálogo sea corto: con el catálogo semilla —36
  // recetas frente a un MIN_POOL de 40— rechazaría el 100 % de las peticiones.
  const minSlot = minCandidatosSlot(nDias);
  const porSlot = candidatosPorSlot(pool, restr, slots);
  const flojos: Record<string, number> = {};
  let hayFlojos = false;
  for (const s of slots) {
    const c = porSlot[s] ?? 0;
    if (c < minSlot) {
      flojos[s] = c;
      hayFlojos = true;
    }
  }

  // Puerta 1: algún slot no tiene con qué armarse, y da igual lo grande que sea
  // el pool global. Puerta 2: el pool es pequeño Y los filtros son los
  // responsables (se han comido más de la mitad del catálogo).
  const puerta2 = pool.p < MIN_POOL && pool.p < FRACCION_POOL_ATRIBUIBLE * cat.n;
  if (hayFlojos || puerta2) {
    return fallo(diagnosticarPool(cat, restr, slots, pool.p, flojos, minSlot), traza, t0);
  }
  if (pool.p < MIN_POOL) {
    // Puerta 3: los filtros apenas podan, el corto es el catálogo. Se genera
    // igual y se anota; culpar al usuario aquí sería mentirle.
    traza.catalogoEstrecho = true;
  }

  // (4) Generación.
  const ctx = contextoDe(cat, pool, restr, nDias, temperatura(opciones.variedad ?? VARIEDAD_POR_DEFECTO));
  if (ctx.costeDesactivadoPor !== null) {
    traza.terminosDesactivados.push(`coste:${ctx.costeDesactivadoPor}`);
  }

  const tGen = performance.now();
  // Los títulos del progreso son IDS de receta: el motor no carga títulos (el
  // catálogo compilado no los trae, y traerlos costaría bundle para algo que
  // sólo se ve un instante). Quien tenga la vista de presentación —`index.ts`—
  // los traduce; quien no, se queda sin texto, que es mejor que enseñar un
  // identificador con pinta de nombre de plato.
  const { porDia, duplicados } = generarCandidatos(
    pool,
    ctx,
    objetivos,
    slots,
    seed,
    resolver,
    avisar === undefined
      ? undefined
      : (d, mejor) => {
          avisar({
            etapa: "porcionado",
            dia: d,
            deDias: nDias,
            titulos: mejor.filas.map((f) => pool.ids[f] ?? ""),
          });
        },
  );
  traza.duplicados = duplicados;
  traza.msGeneracion = Math.trunc(performance.now() - tGen);

  avisar?.({ etapa: "cuadre", dia: nDias, deDias: nDias });

  const tEns = performance.now();
  const resultado = ensamblar(
    pool,
    porDia,
    seed,
    restr.presupuestoSemanalCents ?? null,
    restr.comensales,
  );
  traza.msEnsamblado = Math.trunc(performance.now() - tEns);

  if (resultado.diasSinCandidato > 0 || resultado.dias.length !== nDias) {
    // Algún día se quedó sin ninguna combinación admisible. No es un caso de
    // objetivo inalcanzable sino de pool agotado DENTRO del día.
    //
    // El quinto argumento es el dict de slots FLOJOS, no el recuento completo
    // por slot. Python pasaba aquí `por_slot`, que nunca está vacío: la rama de
    // `slot_sin_candidatos` se disparaba SIEMPRE y escribía mensajes falsos del
    // tipo «Sólo encuentro 21 recetas para la comida y necesito al menos 8»
    // —21 ≥ 8, o sea, ese slot no era el problema—. En este punto ya se ha
    // pasado la puerta 1, así que `flojos` está vacío por construcción y el
    // diagnóstico cae donde debe: en el eje que la ablación señala como
    // culpable. Es la misma llamada que la de la puerta 1, y ésa siempre fue
    // correcta. Divergencia D4 de DIVERGENCIAS.md.
    return fallo(diagnosticarPool(cat, restr, slots, pool.p, flojos, minSlot), traza, t0);
  }

  // El recocido puede haber roto una restricción dura que la etapa A vetó contra
  // un estado provisional: el día se cerró con su mejor candidato, no con el que
  // acabó eligiendo la etapa D. Se comprueba y se corrige item a item.
  const reparado = repararDuras(pool, ctx, objetivos, resultado.dias, resolver);
  const dias = reparado.dias;
  traza.reparacionesDuras = reparado.arreglados;

  traza.erroresPorDia = dias.map((c) => redondear(c.error, DECIMALES_ERROR_TRAZA));
  traza.intentosReparacion = dias.reduce((suma, c) => suma + c.intentos, 0);
  traza.porcionadosDeEmergencia = dias.reduce((suma, c) => suma + (c.emergencia ? 1 : 0), 0);

  // (5) Umbral de honestidad: por encima, no se devuelve un plan que finge
  // cumplir el objetivo. El PEOR día manda —un plan semanal con un día roto es
  // un plan roto— y se comprueba una sola vez, aquí, no dentro de la etapa C.
  // El empate lo gana el primero, igual que el `max` de Python.
  let peor = 0;
  for (let d = 1; d < dias.length; d++) {
    if ((dias[d]?.error ?? 0) > (dias[peor]?.error ?? 0)) peor = d;
  }
  const candPeor = dias[peor];
  const objPeor = objetivos[peor];
  if (candPeor !== undefined && objPeor !== undefined && candPeor.error > UMBRAL_ERROR_ACEPTABLE) {
    return fallo(
      diagnosticarObjetivo(
        pool,
        cat,
        restr,
        slots,
        cuotasDe(slots),
        objPeor,
        candPeor.totales,
        pool.p,
      ),
      traza,
      t0,
    );
  }

  const diasContrato: DiaPlan[] = [];
  for (const [d, cand] of dias.entries()) {
    const objetivo = objetivos[d];
    const fecha = fechas[d];
    if (objetivo === undefined || fecha === undefined) {
      throw new Error("generar: hay más días que objetivos; el plan viene desalineado");
    }
    diasContrato.push(diaAContrato(pool, cand, fecha, objetivo));
  }

  const ms = Math.max(1, Math.trunc(performance.now() - t0));
  traza.msTotal = ms;

  // Los cinco datos de reproducibilidad van DENTRO de la respuesta, no en
  // cabeceras: el motor del navegador no tiene ninguna que poner, y un plan sin
  // ellos no se puede volver a generar. `seed` como cadena porque son 63 bits.
  return {
    respuesta: {
      ok: true,
      dias: diasContrato,
      msTranscurridos: ms,
      seed: seed.toString(),
      versionCatalogo: cat.version,
      versionGenerador: VERSION_GENERADOR,
      pool: pool.p,
      catalogoEstrecho: traza.catalogoEstrecho,
    },
    traza,
  };
}
