import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { obtenerStripe, stripeConfigurado } from "@/lib/stripe";

/**
 * Crea una sesión de Stripe Checkout para pasar a Pro.
 *
 * Sin cuenta de Stripe todavía (ver SETUP.md), así que hoy responde 501 con
 * un mensaje claro en vez de un error de la librería. El botón "Pasar a Pro"
 * de `/precios` lee ese mensaje y lo enseña tal cual — no hay nada que
 * fingir mientras tanto.
 */
export async function POST() {
  if (!stripeConfigurado()) {
    return NextResponse.json(
      {
        error:
          "El cobro con Stripe todavía no está configurado en este entorno. " +
          "Ver SETUP.md § Stripe.",
      },
      { status: 501 },
    );
  }

  const sesion = await auth();
  if (!sesion?.user) {
    return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  }

  const usuario = await prisma.user.findUnique({
    where: { id: sesion.user.id },
    include: { suscripcion: true },
  });
  if (!usuario) {
    return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
  }

  const stripe = obtenerStripe();
  const origen = new URL(process.env.NEXT_PUBLIC_URL_APP ?? "http://localhost:3000");

  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_ID_PRO, quantity: 1 }],
    // Si ya tiene stripeCustomerId (canceló y vuelve) se reusa: evita
    // duplicar clientes en el dashboard de Stripe por cada intento.
    ...(usuario.suscripcion?.stripeCustomerId
      ? { customer: usuario.suscripcion.stripeCustomerId }
      : { customer_email: usuario.email }),
    client_reference_id: usuario.id,
    success_url: `${origen.origin}/semana?checkout=ok`,
    cancel_url: `${origen.origin}/precios?checkout=cancelado`,
  });

  if (!checkout.url) {
    return NextResponse.json({ error: "Stripe no devolvió una URL de checkout." }, { status: 502 });
  }

  return NextResponse.json({ url: checkout.url });
}
