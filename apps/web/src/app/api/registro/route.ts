import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Alta de cuenta. Auth.js no trae registro — sólo inicio de sesión — así que
 * es una ruta propia. Sin verificación de correo en esta versión: el único
 * motivo para tener cuenta hoy es pagar el plan Pro, y Stripe ya exige un
 * correo válido en el checkout. Añadir verificación antes de eso sería
 * fricción sin nada real que proteger todavía.
 */
export async function POST(request: Request) {
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const { email, password, nombre } = (cuerpo ?? {}) as Record<string, unknown>;

  if (typeof email !== "string" || !CORREO_RE.test(email)) {
    return NextResponse.json({ error: "Correo no válido." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 8 caracteres." },
      { status: 400 },
    );
  }

  const existente = await prisma.user.findUnique({ where: { email } });
  if (existente) {
    return NextResponse.json({ error: "Ya existe una cuenta con ese correo." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      nombre: typeof nombre === "string" && nombre.trim() !== "" ? nombre.trim() : null,
    },
  });

  return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
}
