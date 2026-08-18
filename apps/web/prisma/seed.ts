import "dotenv/config";
import bcrypt from "bcryptjs";

import { prisma } from "../src/lib/prisma";

/**
 * Siembra el único administrador, desde ADMIN_EMAIL / ADMIN_PASSWORD.
 *
 * Idempotente: si el correo ya existe, lo promueve a admin y actualiza la
 * contraseña en vez de fallar por duplicado — así `npm run db:seed` sirve
 * tanto para el primer arranque como para recuperar el acceso si se pierde
 * la contraseña.
 */
async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Faltan ADMIN_EMAIL y/o ADMIN_PASSWORD en el entorno. Revisa .env (ver .env.example).",
    );
  }
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD debe tener al menos 8 caracteres.");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, esAdmin: true },
    create: { email, passwordHash, esAdmin: true, nombre: "Admin" },
  });

  console.log(`Admin listo: ${admin.email} (id ${admin.id})`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
