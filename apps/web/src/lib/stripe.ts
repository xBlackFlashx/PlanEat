import Stripe from "stripe";

/**
 * No hay cuenta de Stripe todavía (ver SETUP.md), así que las tres variables
 * de entorno están vacías por defecto. El cliente se crea perezosamente y
 * `stripeConfigurado()` es la comprobación que usan las rutas para devolver
 * un error explicable en vez de reventar con un mensaje de la librería que no
 * dice qué variable falta.
 */
let cliente: Stripe | null = null;

export function stripeConfigurado(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID_PRO);
}

export function obtenerStripe(): Stripe {
  const clave = process.env.STRIPE_SECRET_KEY;
  if (!clave) {
    throw new Error(
      "STRIPE_SECRET_KEY no está configurada. Ver SETUP.md § Stripe para crear la cuenta y las llaves.",
    );
  }
  cliente ??= new Stripe(clave);
  return cliente;
}
