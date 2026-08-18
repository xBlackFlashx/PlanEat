"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";

/**
 * Navegación de cuenta para la cabecera pública.
 *
 * Vive junto al `ThemeToggle` en las tres cabeceras existentes. Tres estados
 * según `useSession()`: cargando (nada, para no dar salto de layout mientras
 * llega la sesión), sin sesión (Entrar + Precios) y con sesión (Precios,
 * Admin si `esAdmin`, el correo y Salir).
 */
const ENLACE = "text-sm text-text-2 underline-offset-4 hover:text-text hover:underline";

export function NavCuenta() {
  const { data: sesion, status } = useSession();

  if (status === "loading") {
    return null;
  }

  if (status === "unauthenticated" || !sesion?.user) {
    return (
      <div className="flex items-center gap-3">
        <Link href="/precios" className={ENLACE}>
          Precios
        </Link>
        <Link href="/entrar" className={ENLACE}>
          Entrar
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Link href="/precios" className={ENLACE}>
        Precios
      </Link>
      {sesion.user.esAdmin ? (
        <Link href="/admin" className={ENLACE}>
          Admin
        </Link>
      ) : null}
      <span className="hidden text-sm text-text-2 sm:inline">
        {sesion.user.email}
      </span>
      <button type="button" onClick={() => signOut()} className={ENLACE}>
        Salir
      </button>
    </div>
  );
}
