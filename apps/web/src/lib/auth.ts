import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authConfig } from "@/lib/auth.config";
import { prisma } from "@/lib/prisma";

/**
 * La configuración completa, con el proveedor Credentials — que sí toca
 * Prisma — encima de `authConfig`. Este fichero SÓLO se importa desde código
 * que corre en Node (rutas de API, Server Components): nunca desde
 * `middleware.ts`. Ver el porqué en `auth.config.ts`.
 *
 * No hay `@auth/prisma-adapter`: está pensado para proveedores OAuth y sesión
 * en base de datos, exige un modelo `User` con la forma exacta que él define
 * (`emailVerified`, `image`, …) y una tabla `Session`/`Account` que aquí no
 * existen y no hacen falta. Con un solo proveedor Credentials y sesión JWT (la
 * única estrategia que Auth.js admite para Credentials sin adaptador) basta
 * con consultar `prisma.user` a mano dentro de `authorize`.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Correo", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credenciales) {
        const email = credenciales?.email;
        const password = credenciales?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valido = await bcrypt.compare(password, user.passwordHash);
        if (!valido) return null;

        return { id: user.id, email: user.email, name: user.nombre, esAdmin: user.esAdmin };
      },
    }),
  ],
});
