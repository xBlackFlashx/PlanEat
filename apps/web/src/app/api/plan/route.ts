/**
 * Proxy al solver.
 *
 * La app web no habla con el motor desde el navegador: pasa por aquí. Tres
 * motivos concretos y no de estilo — la URL del solver no se publica al
 * cliente; el catálogo de recetas se lee en el servidor y se adjunta a la
 * respuesta (el contrato sólo devuelve identificadores); y el objetivo
 * nutricional se calcula aquí a partir del perfil, de modo que nadie pueda
 * pedir un plan con un objetivo arbitrario.
 *
 * Códigos de salida:
 *   200 · hay plan, o el motor ha contestado honestamente que no llega. Las dos
 *         cosas son resultados del producto y las dos tienen pantalla propia.
 *   400 · el formulario no es válido. Se devuelven los errores por campo.
 *   503 · el motor no está. Se dice cuál es el motivo, sin datos de relleno.
 */

import { NextResponse } from "next/server";

import {
  aplicarAjustes,
  calcularObjetivoDelDia,
  construirSolicitud,
  hayErrores,
  leerFormulario,
  validar,
  type AjustesObjetivo,
} from "@/lib/perfil";
import { generarPlan } from "@/lib/solver";

/** Nunca se cachea: cada petición monta un día distinto. */
export const dynamic = "force-dynamic";

interface CuerpoPeticion {
  campos?: Record<string, unknown>;
  recetasRecientes?: unknown;
  ajustes?: Record<string, unknown>;
}

function comoTextos(objeto: Record<string, unknown> = {}): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(objeto)) {
    if (valor != null) salida[clave] = String(valor);
  }
  return salida;
}

/** Los ajustes llegan del cliente: se saneen antes de tocar el objetivo. */
function comoAjustes(bruto: Record<string, unknown> = {}): AjustesObjetivo {
  const ajustes: AjustesObjetivo = {};

  const kcal = Number(bruto.kcal);
  if (Number.isFinite(kcal) && kcal >= 800 && kcal <= 6000) ajustes.kcal = Math.round(kcal);

  const proteina = Number(bruto.proteinaMaxG);
  if (Number.isFinite(proteina) && proteina >= 20 && proteina <= 400) {
    ajustes.proteinaMaxG = Math.round(proteina);
  }

  if (typeof bruto.dieta === "string") {
    ajustes.dieta = bruto.dieta as AjustesObjetivo["dieta"];
  }
  if (bruto.sinMinimoFibra === true) ajustes.sinMinimoFibra = true;

  return ajustes;
}

export async function POST(peticion: Request) {
  let cuerpo: CuerpoPeticion;
  try {
    cuerpo = (await peticion.json()) as CuerpoPeticion;
  } catch {
    return NextResponse.json(
      { errores: { edad: "No he entendido la petición. Vuelve a enviar el formulario." } },
      { status: 400 },
    );
  }

  const datos = leerFormulario(comoTextos(cuerpo.campos));
  const errores = validar(datos);
  if (hayErrores(errores)) {
    return NextResponse.json({ errores }, { status: 400 });
  }

  const recetasRecientes = Array.isArray(cuerpo.recetasRecientes)
    ? cuerpo.recetasRecientes.filter((id): id is string => typeof id === "string").slice(0, 50)
    : [];

  const ajustes = comoAjustes(cuerpo.ajustes);

  const resultado = await generarPlan(
    construirSolicitud(datos, { recetasRecientes, ajustes }),
  );

  // El objetivo viaja de vuelta, ya con los ajustes aplicados: la pantalla de
  // sobre-restricción calcula sus tres salidas sobre lo último que se ha
  // pedido, no sobre el cálculo original. Si no, la segunda vez propondría lo
  // mismo que la primera.
  const objetivo = aplicarAjustes(calcularObjetivoDelDia(datos).objetivo, ajustes);

  return NextResponse.json(
    { resultado, objetivo },
    { status: resultado.estado === "sin_servicio" ? 503 : 200 },
  );
}
