"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Crea o actualiza un parámetro de producto. Defensa en profundidad: re-verifica admin. */
export async function guardarParametro(clave: string, valor: string, descripcion: string): Promise<void> {
  const session = await auth();
  if (!session || !session.user || !session.user.esAdmin) {
    throw new Error("No autorizado.");
  }

  const claveLimpia = clave.trim();
  if (claveLimpia === "") throw new Error("La clave no puede estar vacía.");

  await prisma.parametro.upsert({
    where: { clave: claveLimpia },
    update: { valor, descripcion },
    create: { clave: claveLimpia, valor, descripcion },
  });

  revalidatePath("/admin/parametros");
}
