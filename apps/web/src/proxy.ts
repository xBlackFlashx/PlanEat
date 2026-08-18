import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/lib/auth.config";

/**
 * `NextAuth(authConfig)`, NO el `auth` de `@/lib/auth.ts`: ese otro importa el
 * proveedor Credentials, que importa Prisma, que no corre en el runtime Edge
 * del middleware. Ver la nota completa en `auth.config.ts`.
 *
 * Sólo comprueba "hay sesión" y, para /admin, "esAdmin" — las dos caben en el
 * JWT y no piden base de datos. El tier Pro, que sí puede cambiar sin que el
 * usuario vuelva a entrar, se comprueba con Prisma dentro de la
 * página/ruta de servidor correspondiente (`/semana`, `/api/generar-semana`),
 * no aquí.
 */
const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const { pathname } = request.nextUrl;
  const autenticado = Boolean(request.auth);
  const esAdmin = Boolean(request.auth?.user?.esAdmin);

  const requiereSesion = pathname.startsWith("/semana") || pathname.startsWith("/api/generar-semana");
  const requiereAdmin = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");

  if (requiereAdmin && !esAdmin) {
    const url = request.nextUrl.clone();
    url.pathname = autenticado ? "/" : "/entrar";
    if (!autenticado) url.searchParams.set("volver", pathname);
    return NextResponse.redirect(url);
  }

  if (requiereSesion && !autenticado) {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.searchParams.set("volver", pathname);
    return NextResponse.redirect(url);
  }
});

export const config = {
  matcher: ["/semana/:path*", "/admin/:path*", "/api/generar-semana/:path*", "/api/admin/:path*"],
};
