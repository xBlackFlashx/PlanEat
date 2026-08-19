import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authConfig } from "@/lib/auth.config";
import { prisma } from "@/lib/prisma";
import { tierEfectivo } from "@/lib/suscripcion";

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

        // Mismo cálculo que la puerta de `/api/generar-semana`: `tierEfectivo`
        // ya sabe que `suscripcion.tier` a secas no basta (impago pendiente
        // de webhook, periodo vencido…).
        //
        // Compromiso conocido, igual que ya existe hoy con `esAdmin`: la
        // sesión es JWT, así que este tier se fija en el login y NO se
        // refresca solo si el usuario pasa a Pro (o deja de serlo) a mitad de
        // sesión — el webhook de Stripe actualiza la tabla `Suscripcion`, no
        // el JWT ya emitido. Por eso las rutas que de verdad importan (como
        // `/api/generar-semana`) no confían en `session.user.tier` y vuelven
        // a consultar la base de datos.
        const suscripcion = await prisma.suscripcion.findUnique({ where: { userId: user.id } });
        const tier = tierEfectivo(suscripcion);

        return { id: user.id, email: user.email, name: user.nombre, esAdmin: user.esAdmin, tier };
      },
    }),
  ],
});
