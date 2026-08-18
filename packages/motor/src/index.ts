/**
 * API pública de `@planeat/motor`. Es lo único que `apps/web` importa.
 *
 * Sustituye a la capa HTTP de `services/solver/app/main.py` colapsada a una
 * llamada de función: sin `fetch`, sin códigos de estado y sin cabeceras. Los
 * cinco datos de reproducibilidad que viajaban en `X-PlanEat-*` van ahora
 * dentro de `RespuestaOk`, porque en GitHub Pages no hay ninguna cabecera que
 * poner y un plan sin ellos no se puede volver a generar.
 *
 * Dos capas, y la diferencia importa:
 *
 *  - `generar` es el motor puro: catálogo + petición → respuesta del contrato.
 *    Lanza `ObjetivoInvalido` y nada más.
 *  - `generarPlan` es la fachada de producto: envuelve a `generar`, traduce las
 *    excepciones a estados y **adjunta las recetas de presentación**. Es el
 *    equivalente exacto de `apps/web/src/lib/solver.ts` + `catalogo.ts`, que
 *    hoy leen el catálogo del disco del servicio; en Pages no hay disco, así
 *    que la vista llega precompilada como JSON.
 *
 * Este módulo no importa nada de `node:` ni tiene efectos secundarios al
 * cargarse: se ejecuta tal cual dentro de un Web Worker.
 *
 * El paquete NO exporta el catálogo. Los datos compilados (`datos/*.json`) los
 * importa quien monta la aplicación, para que el bundler los inline y la
 * versión del catálogo quede atada al hash del bundle en vez de a un `fetch`
 * que `basePath: '/PlanEat'` rompería.
 */

import { generar, ObjetivoInvalido } from "./motor.ts";
import type { CatalogoCompilado } from "./catalogo.ts";
import type { OpcionesGenerar } from "./motor.ts";
import type {
  DiaPlan,
  FalloGeneracion,
  Progreso,
  RespuestaOk,
  SolicitudGeneracion,
  Traza,
} from "./tipos.ts";
import type { RecetaVista, VistaRecetas } from "../herramientas/compilar-catalogo.ts";

// ---------------------------------------------------------------------------
// Superficie pública
// ---------------------------------------------------------------------------

export { generar, minCandidatosSlot, ObjetivoInvalido, validarSolicitud } from "./motor.ts";
export { cargarCatalogo, transferibles } from "./catalogo.ts";
export { semillaAleatoria, semillaATexto, semillaDesdeTexto } from "./rng.ts";
export { MS_LIMITE_GENERACION, VERSION_GENERADOR } from "./constantes.ts";
export { resolverPorcionesRejilla } from "./porciones.ts";

export type { OpcionesGenerar } from "./motor.ts";
export type { CatalogoCompilado } from "./catalogo.ts";
export type {
  Bandas,
  CandidatoDia,
  Progreso,
  ResolverPorciones,
  ResultadoPorcionado,
  Traza,
} from "./tipos.ts";
export type {
  CatalogoSerializado,
  IngredienteConGramos,
  PorcionesRecetas,
  RecetaConGramos,
  RecetaVista,
  VistaRecetas,
} from "../herramientas/compilar-catalogo.ts";

// ---------------------------------------------------------------------------
// El resultado que consume la interfaz
// ---------------------------------------------------------------------------

/**
 * Por qué no hay plan cuando la culpa es nuestra y no del usuario.
 *
 * Sin servidor sólo quedan dos motivos reales: que el motor reviente
 * (`error_motor`) o que el corte de seguridad de 20 s lo mate desde fuera
 * (`tiempo_agotado`, que emite el cliente del worker, no este módulo). Los
 * `sin_conexion`, `motor_no_implementado` y `respuesta_ilegible` de la web se
 * quedan sin uso: describían modos de fallo de un `fetch` que ya no existe.
 */
export type MotivoSinServicio = "error_motor" | "tiempo_agotado";

/**
 * Resultado de pedir un plan. **Cuatro** desenlaces, no tres.
 *
 * La web colapsaba «tu objetivo está mal formado» dentro de `sin_servicio`, y
 * son cosas distintas con pantallas distintas: un rango de proteína invertido
 * no es una avería nuestra ni una sobre-restricción del usuario, y proponerle
 * que relaje filtros cuando lo que pasa es que el mínimo es mayor que el máximo
 * es mandarlo a arreglar lo que no está roto.
 *
 * Los campos de `ok` y de `sobre_restriccion` son los mismos que hoy devuelve
 * `apps/web/src/lib/solver.ts` —para que las vistas no tengan que cambiar— más
 * `respuesta` y `traza`, que antes se perdían: la primera lleva los cinco datos
 * de reproducibilidad y la segunda es la instrumentación que en el backend se
 * iba a un log de servidor que aquí no existe.
 */
export type ResultadoPlan =
  | {
      estado: "ok";
      dias: DiaPlan[];
      msTranscurridos: number;
      /** Sólo las recetas que aparecen en el plan, por id. */
      recetas: Record<string, RecetaVista>;
      /** Falso si no se pasó la vista de presentación: la UI lo refleja. */
      catalogoDisponible: boolean;
      respuesta: RespuestaOk;
      traza: Traza;
    }
  | {
      estado: "sobre_restriccion";
      fallo: FalloGeneracion;
      /** Recetas del catálogo entero. Da contexto a la cifra de candidatas. */
      totalCatalogo: number | null;
      traza: Traza;
    }
  | { estado: "objetivo_invalido"; mensaje: string }
  | { estado: "sin_servicio"; motivo: MotivoSinServicio; detalle: string };

/** Opciones de `generarPlan`: las del motor más la vista de presentación. */
export interface OpcionesGenerarPlan extends OpcionesGenerar {
  /**
   * `datos/recetas-vista.json`. Sin ella el plan sale igual —el motor sólo
   * necesita el catálogo compilado— pero la UI se queda sin títulos ni
   * ingredientes y lo dice, en vez de inventárselos.
   */
  vista?: VistaRecetas | null;
}

// ---------------------------------------------------------------------------
// Fachada
// ---------------------------------------------------------------------------

/** Recetas que aparecen en el plan, en orden de aparición y sin repetir. */
export function recetasDelPlan(dias: readonly DiaPlan[]): string[] {
  const vistas = new Set<string>();
  for (const dia of dias) {
    for (const comida of dia.comidas) {
      for (const item of comida.items) vistas.add(item.recetaId);
    }
  }
  return [...vistas];
}

/**
 * Traduce los ids de receta del progreso a títulos legibles.
 *
 * El motor no carga títulos: el catálogo compilado son matrices numéricas y
 * meter 36 cadenas dentro sólo para un rótulo que se ve medio segundo no sale a
 * cuenta. Emite ids y los traduce quien tiene la vista, que es este módulo. Un
 * id sin traducción se **descarta** en vez de enseñarse: `pollo_arroz_brocoli`
 * en pantalla parece un fallo del producto, y no tener texto parece lo que es.
 */
function titulosDe(ids: readonly string[] | undefined, vista: VistaRecetas | null): string[] | undefined {
  if (ids === undefined || vista === null) return undefined;
  const titulos: string[] = [];
  for (const id of ids) {
    const receta = vista.recetas[id];
    if (receta !== undefined) titulos.push(receta.titulo);
  }
  return titulos.length > 0 ? titulos : undefined;
}

/**
 * Genera un plan y lo deja listo para dibujar. Nunca lanza.
 *
 * Es el punto de entrada de la interfaz. Todo lo que puede salir mal sale como
 * un estado de `ResultadoPlan`: una excepción que se escapara aquí dejaría la
 * pantalla de generación girando para siempre, que es peor que cualquier
 * mensaje de error.
 */
export function generarPlan(
  solicitud: SolicitudGeneracion,
  cat: CatalogoCompilado,
  opciones: OpcionesGenerarPlan = {},
): ResultadoPlan {
  const vista = opciones.vista ?? null;
  const alAvanzar = opciones.alAvanzar;

  const opcionesMotor: OpcionesGenerar = {
    ...opciones,
    alAvanzar:
      alAvanzar === undefined
        ? undefined
        : (progreso: Progreso) => {
            alAvanzar({ ...progreso, titulos: titulosDe(progreso.titulos, vista) });
          },
  };

  let respuesta;
  let traza;
  try {
    ({ respuesta, traza } = generar(solicitud, cat, opcionesMotor));
  } catch (error) {
    if (error instanceof ObjetivoInvalido) {
      return { estado: "objetivo_invalido", mensaje: error.message };
    }
    // Cualquier otra excepción es un fallo NUESTRO, no del usuario, y se dice
    // tal cual. No se devuelve un plan de relleno: un producto de nutrición que
    // enseña números inventados cuando algo falla pierde lo único que vende.
    return {
      estado: "sin_servicio",
      motivo: "error_motor",
      detalle: error instanceof Error ? error.message : String(error),
    };
  }

  const totalCatalogo = vista?.total ?? cat.n;

  if (!respuesta.ok) {
    return { estado: "sobre_restriccion", fallo: respuesta.fallo, totalCatalogo, traza };
  }

  const recetas: Record<string, RecetaVista> = {};
  if (vista !== null) {
    for (const id of recetasDelPlan(respuesta.dias)) {
      const receta = vista.recetas[id];
      if (receta !== undefined) recetas[id] = receta;
    }
  }

  return {
    estado: "ok",
    dias: respuesta.dias,
    msTranscurridos: respuesta.msTranscurridos,
    recetas,
    catalogoDisponible: vista !== null,
    respuesta,
    traza,
  };
}
