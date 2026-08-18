import type { NextAuthConfig } from "next-auth";

/**
 * La mitad de la configuración de Auth.js que es segura para el runtime Edge
 * del middleware: sin proveedores, sin Prisma.
 *
 * `middleware.ts` importa ESTE fichero, no `auth.ts`. El motivo no es
 * cosmético: `auth.ts` registra el proveedor Credentials, cuyo `authorize`
 * importa `prisma.ts`, que a su vez importa `@prisma/client` — y ese runtime
 * usa `node:crypto`, `node:fs`, `node:os`… ninguno existe en Edge. Webpack
 * empaqueta el grafo de imports entero aunque el middleware nunca llegue a
 * llamar a `authorize` (sólo lee el JWT ya firmado), así que basta con que la
 * importación exista para que el build de Edge reviente. Separar la
 * configuración es el patrón que documenta el propio Auth.js para este caso.
 */
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/entrar" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.esAdmin = (user as { esAdmin?: boolean }).esAdmin ?? false;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.esAdmin = Boolean(token.esAdmin);
      }
      return session;
    },
  },
};
