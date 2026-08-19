"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";

import { IconoCorona } from "./iconos";

/**
 * Navegación de cuenta para la cabecera pública.
 *
 * Vive junto al `ThemeToggle` en las tres cabeceras existentes. Tres estados
 * según `useSession()`: cargando (nada, para no dar salto de layout mientras
 * llega la sesión), sin sesión (Entrar + Suscríbete) y con sesión (Admin si
 * `esAdmin`, el correo y Salir, más Suscríbete o la insignia Pro según el
 * tier).
 */
const ENLACE = "text-sm text-text-2 underline-offset-4 hover:text-text hover:underline";

/** Insignia dorada del estado Pro. Píldora, no enlace de texto plano: se
 * nota a propósito distinta de "Suscríbete", que sí sigue el mismo patrón
 * que "Admin"/"Salir". */
const INSIGNIA_PRO =
  "inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-sm font-semibold text-on-gold transition-colors dur-rapida ease-suave hover:bg-gold-hover";

export function NavCuenta() {
  const { data: sesion, status } = useSession();

  if (status === "loading") {
    return null;
  }

  if (status === "unauthenticated" || !sesion?.user) {
    return (
      <div className="flex items-center gap-3">
        <Link href="/precios" className={ENLACE}>
          Suscríbete
        </Link>
        <Link href="/entrar" className={ENLACE}>
          Entrar
        </Link>
      </div>
    );
  }

  const esPro = sesion.user.tier === "PRO";

  return (
    <div className="flex items-center gap-3">
      {esPro ? (
        <Link
          href="/precios"
          className={INSIGNIA_PRO}
          aria-label="Cuenta Pro activa — ver precios"
        >
          <IconoCorona tam={16} />
          Pro
        </Link>
      ) : (
        <Link href="/precios" className={ENLACE}>
          Suscríbete
        </Link>
      )}
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
