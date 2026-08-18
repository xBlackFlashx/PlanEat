"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Tier } from "@/generated/prisma/client";

/**
 * Override manual del tier de un usuario desde el panel.
 *
 * Esto convive con el webhook de Stripe (`/api/stripe/webhook` o equivalente)
 * a propósito, no por descuido: el webhook es la fuente de verdad cuando hay
 * cobro real de por medio, pero soporte necesita poder dar/quitar Pro a mano
 * sin depender de Stripe (pruebas, cortesías, resolver un ticket) — de ahí
 * este segundo camino, más tosco y auditado por quien lo pulsa.
 */
export async function cambiarTier(userId: string, nuevoTier: Tier): Promise<void> {
  // Defensa en profundidad: la UI que llama a esta acción sólo se renderiza
  // para un admin, pero una Server Action es un endpoint HTTP propio y nada
  // impide invocarla directamente. Se vuelve a comprobar aquí.
  const session = await auth();
  if (!session || !session.user || !session.user.esAdmin) {
    throw new Error("No autorizado.");
  }

  const estado = nuevoTier === "PRO" ? "activa" : "cancelada";

  await prisma.suscripcion.upsert({
    where: { userId },
    update: { tier: nuevoTier, estado },
    create: { userId, tier: nuevoTier, estado },
  });

  revalidatePath("/admin/usuarios");
}
