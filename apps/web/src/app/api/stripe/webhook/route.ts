import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { prisma } from "@/lib/prisma";
import { obtenerStripe, stripeConfigurado } from "@/lib/stripe";

/**
 * Traduce el `status` de una suscripción de Stripe al vocabulario propio.
 * `en_gracia` es `past_due`: Stripe sigue reintentando el cobro y el acceso
 * Pro no se corta todavía (ver `tierEfectivo`) — cortarlo en el primer
 * reintento fallido penalizaría una tarjeta caducada por un día, no un
 * impago real.
 */
function estadoDeStripe(status: Stripe.Subscription.Status): "activa" | "en_gracia" | "cancelada" | "impago" {
  switch (status) {
    case "active":
    case "trialing":
      return "activa";
    case "past_due":
      return "en_gracia";
    case "unpaid":
    case "incomplete_expired":
      return "impago";
    default:
      return "cancelada";
  }
}

function finPeriodoDe(subscription: Stripe.Subscription): Date | null {
  const item = subscription.items.data[0];
  const segundos = item?.current_period_end;
  return typeof segundos === "number" ? new Date(segundos * 1000) : null;
}

async function sincronizarSuscripcion(
  userId: string,
  customerId: string,
  subscription: Stripe.Subscription,
) {
  await prisma.suscripcion.upsert({
    where: { userId },
    update: {
      tier: "PRO",
      estado: estadoDeStripe(subscription.status),
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      finPeriodoActual: finPeriodoDe(subscription),
    },
    create: {
      userId,
      tier: "PRO",
      estado: estadoDeStripe(subscription.status),
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      finPeriodoActual: finPeriodoDe(subscription),
    },
  });
}

/**
 * Webhook de Stripe. Sin `STRIPE_WEBHOOK_SECRET` responde 501: mejor decir
 * claramente que no está configurado que fingir procesar un evento que no
 * puede verificar.
 *
 * Lee el cuerpo como texto plano, no como JSON — `constructEvent` verifica la
 * firma sobre los bytes exactos que mandó Stripe, y un `request.json()`
 * seguido de `JSON.stringify()` no reproduce el mismo texto byte a byte.
 */
export async function POST(request: Request) {
  if (!stripeConfigurado() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "El webhook de Stripe todavía no está configurado. Ver SETUP.md § Stripe." },
      { status: 501 },
    );
  }

  const firma = request.headers.get("stripe-signature");
  if (!firma) {
    return NextResponse.json({ error: "Falta la cabecera stripe-signature." }, { status: 400 });
  }

  const cuerpo = await request.text();
  const stripe = obtenerStripe();

  let evento: Stripe.Event;
  try {
    evento = stripe.webhooks.constructEvent(cuerpo, firma, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    return NextResponse.json(
      { error: `Firma inválida: ${error instanceof Error ? error.message : String(error)}` },
      { status: 400 },
    );
  }

  switch (evento.type) {
    case "checkout.session.completed": {
      const session = evento.data.object;
      const userId = session.client_reference_id;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (!userId || !customerId || !subscriptionId) break;

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await sincronizarSuscripcion(userId, customerId, subscription);
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = evento.data.object;
      const customerId =
        typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      const existente = await prisma.suscripcion.findUnique({ where: { stripeCustomerId: customerId } });
      if (!existente) break; // Cliente de Stripe sin usuario nuestro asociado: nada que sincronizar.
      await sincronizarSuscripcion(existente.userId, customerId, subscription);
      break;
    }

    default:
      break; // El resto de eventos de la cuenta no cambian el tier de nadie.
  }

  return NextResponse.json({ recibido: true });
}
