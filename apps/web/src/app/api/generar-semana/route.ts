import { NextResponse } from "next/server";

import { generarPlan } from "@planeat/motor";
import type { AjustesObjetivo, DatosFormulario } from "@/lib/perfil";
import { construirSolicitudSemana, validar } from "@/lib/perfil";

import { auth } from "@/lib/auth";
import { CATALOGO, PORCIONES_RECETAS, VISTA_RECETAS } from "@/lib/catalogo-servidor";
import { listaDeLaCompra } from "@/lib/lista-compra";
import { prisma } from "@/lib/prisma";
import { lunesDeLaSemana } from "@/lib/semana";
import { tierEfectivo } from "@/lib/suscripcion";

/**
 * Genera el plan Pro semanal, server-side.
 *
 * Por qué no es el mismo camino que el generador gratis (`src/lib/generar.ts`,
 * que corre en un Web Worker del navegador): un gate de tier comprobado sólo
 * en el cliente se salta con las herramientas de desarrollador — cambiar una
 * variable en memoria y listo. Aquí el tier se lee de la base de datos en
 * cada petición, así que la única forma de conseguir un plan de 7 días es
 * tener de verdad una suscripción activa.
 */
export async function POST(request: Request) {
  const sesion = await auth();
  if (!sesion?.user) {
    return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  }

  const suscripcion = await prisma.suscripcion.findUnique({
    where: { userId: sesion.user.id },
  });
  if (tierEfectivo(suscripcion) !== "PRO") {
    return NextResponse.json(
      { error: "El plan semanal es de PlanEat Pro. Ve a /precios para activarlo." },
      { status: 403 },
    );
  }

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const datos = (cuerpo as { datos?: unknown } | null)?.datos as DatosFormulario | undefined;
  if (!datos) {
    return NextResponse.json({ error: "Falta el perfil (datos)." }, { status: 400 });
  }
  const errores = validar(datos);
  if (Object.keys(errores).length > 0) {
    return NextResponse.json({ error: "Perfil inválido.", errores }, { status: 400 });
  }
  // `ajustes` es lo que manda `SobreRestriccion` cuando el usuario acepta una
  // de las tres correcciones tras un "no llego" — el mismo contrato que ya
  // usa el generador gratis, para poder reutilizar ese componente tal cual.
  const ajustes = (cuerpo as { ajustes?: unknown } | null)?.ajustes as AjustesObjetivo | undefined;

  const solicitud = construirSolicitudSemana(datos, { ajustes });
  const resultado = generarPlan(solicitud, CATALOGO, { vista: VISTA_RECETAS });

  await prisma.generacionPlan.create({
    data: {
      userId: sesion.user.id,
      tier: "PRO",
      dias: solicitud.objetivos.length,
      slots: solicitud.restricciones.slots.length,
      dieta: solicitud.restricciones.dieta,
      ok: resultado.estado === "ok",
      restriccionCulpable: resultado.estado === "sobre_restriccion" ? resultado.fallo.restriccionCulpable : null,
      msTranscurridos: resultado.estado === "ok" ? resultado.msTranscurridos : 0,
    },
  });

  if (resultado.estado !== "ok") {
    const status = resultado.estado === "sobre_restriccion" ? 200 : 502;
    return NextResponse.json({ estado: resultado }, { status });
  }

  const lista = listaDeLaCompra(resultado.dias, PORCIONES_RECETAS);

  const semanaDelDia = lunesDeLaSemana(new Date());
  await prisma.planSemana.upsert({
    where: { userId_semanaDelDia: { userId: sesion.user.id, semanaDelDia } },
    update: { respuestaJson: JSON.stringify(resultado.respuesta) },
    create: {
      userId: sesion.user.id,
      semanaDelDia,
      respuestaJson: JSON.stringify(resultado.respuesta),
    },
  });

  return NextResponse.json({
    estado: resultado,
    lista,
  });
}
