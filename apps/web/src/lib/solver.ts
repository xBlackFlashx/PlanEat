/**
 * Cliente del servicio solver. **Sólo servidor.**
 *
 * Regla de la casa: si el solver no está levantado, la interfaz lo dice. No se
 * genera un plan de mentira ni se rellena con datos de ejemplo. Un producto de
 * nutrición que enseña números falsos cuando falla el backend pierde justo lo
 * único que vende.
 *
 * Por eso hay tres desenlaces y no dos (ver `ResultadoPlan`): que el solver
 * conteste "no llego" es un resultado del producto y tiene pantalla propia; que
 * el solver no conteste es un fallo nuestro y tiene otra.
 */

import type { DiaPlan, RespuestaGeneracion, SolicitudGeneracion } from "@planeat/shared";

import { cargarCatalogo } from "./catalogo";
import type { RecetaResumen, ResultadoPlan } from "./tipos";

const URL_POR_DEFECTO = "http://localhost:8000";

/**
 * 20 s: el mismo corte que la interfaz declara al usuario en el estado de
 * generación (docs/diseno-producto.md §3.2). Si se cambia aquí, hay que
 * cambiarlo allí; por eso se exporta.
 */
export const MS_LIMITE_GENERACION = 20_000;

function urlDelSolver(): string {
  return (process.env.SOLVER_URL ?? URL_POR_DEFECTO).replace(/\/+$/, "");
}

/** Comprobación mínima de forma: una respuesta rara no debe llegar a la vista. */
function pareceRespuesta(dato: unknown): dato is RespuestaGeneracion {
  if (typeof dato !== "object" || dato === null) return false;
  const posible = dato as { ok?: unknown; dias?: unknown; fallo?: unknown };
  if (posible.ok === true) return Array.isArray(posible.dias);
  if (posible.ok === false) return typeof posible.fallo === "object" && posible.fallo !== null;
  return false;
}

/** Recetas que aparecen en el plan, en orden de aparición y sin repetir. */
export function recetasDelPlan(dias: DiaPlan[]): string[] {
  const vistas = new Set<string>();
  for (const dia of dias) {
    for (const comida of dia.comidas) {
      for (const item of comida.items) vistas.add(item.recetaId);
    }
  }
  return [...vistas];
}

async function adjuntarRecetas(dias: DiaPlan[]): Promise<{
  recetas: Record<string, RecetaResumen>;
  catalogoDisponible: boolean;
}> {
  const catalogo = await cargarCatalogo();
  if (!catalogo) return { recetas: {}, catalogoDisponible: false };

  const recetas: Record<string, RecetaResumen> = {};
  for (const id of recetasDelPlan(dias)) {
    const receta = catalogo.recetas.get(id);
    if (receta) recetas[id] = receta;
  }
  return { recetas, catalogoDisponible: true };
}

export async function generarPlan(
  solicitud: SolicitudGeneracion,
): Promise<ResultadoPlan> {
  let respuesta: Response;

  try {
    respuesta = await fetch(`${urlDelSolver()}/v1/plan/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(solicitud),
      cache: "no-store",
      signal: AbortSignal.timeout(MS_LIMITE_GENERACION),
    });
  } catch (error) {
    const agotado =
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      estado: "sin_servicio",
      motivo: agotado ? "tiempo_agotado" : "sin_conexion",
      detalle: agotado
        ? `El motor no ha contestado en ${MS_LIMITE_GENERACION / 1000} segundos.`
        : `No hay nadie escuchando en ${urlDelSolver()}.`,
    };
  }

  let cuerpo: unknown = null;
  try {
    cuerpo = await respuesta.json();
  } catch {
    cuerpo = null;
  }

  // El esqueleto del servicio contesta 501 mientras el motor no exista. Eso no
  // es una sobre-restricción del usuario: es que no hay motor. Se distingue.
  const culpable =
    typeof cuerpo === "object" && cuerpo !== null
      ? (cuerpo as { fallo?: { restriccionCulpable?: string } }).fallo?.restriccionCulpable
      : undefined;

  if (respuesta.status === 501 || culpable === "motor_no_implementado") {
    return {
      estado: "sin_servicio",
      motivo: "motor_no_implementado",
      detalle:
        "El servicio responde, pero el motor de generación todavía no está implementado (fase 1 del roadmap).",
    };
  }

  // 422 es "la petición está mal formada". La petición la construimos
  // nosotros a partir del perfil, así que eso es un fallo nuestro y no una
  // sobre-restricción del usuario, aunque el cuerpo tenga la misma forma. Se
  // enseña como avería, no como resultado.
  if (respuesta.status === 422) {
    const mensaje =
      typeof cuerpo === "object" && cuerpo !== null
        ? ((cuerpo as { fallo?: { mensaje?: string } }).fallo?.mensaje ?? "")
        : "";
    return {
      estado: "sin_servicio",
      motivo: "error_solver",
      detalle: mensaje
        ? `El motor ha rechazado el objetivo que le he mandado: ${mensaje}`
        : "El motor ha rechazado la petición por mal formada (422).",
    };
  }

  if (!pareceRespuesta(cuerpo)) {
    return {
      estado: "sin_servicio",
      motivo: respuesta.ok ? "respuesta_ilegible" : "error_solver",
      detalle: respuesta.ok
        ? "El motor ha contestado algo que no encaja con el contrato."
        : `El motor ha devuelto un ${respuesta.status}.`,
    };
  }

  if (!cuerpo.ok) {
    const catalogo = await cargarCatalogo();
    return {
      estado: "sobre_restriccion",
      fallo: cuerpo.fallo,
      totalCatalogo: catalogo?.total ?? null,
    };
  }

  const { recetas, catalogoDisponible } = await adjuntarRecetas(cuerpo.dias);
  return {
    estado: "ok",
    dias: cuerpo.dias,
    msTranscurridos: cuerpo.msTranscurridos,
    recetas,
    catalogoDisponible,
  };
}
