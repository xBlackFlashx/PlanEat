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
 *
 * Jerarquía deliberada: "Suscríbete" es la conversión que le interesa al
 * negocio, así que es el único botón lleno (`BOTON_DESTACADO`). "Entrar" es
 * un botón, pero discreto (`BOTON_DISCRETO`, mismo lenguaje que
 * `ThemeToggle`: borde, sin relleno) — necesita leerse como acción, no como
 * texto suelto, pero sin competir con Suscríbete. "Admin"/"Salir"/el correo
 * siguen como enlace de texto plano (`ENLACE`): son utilidad de cuenta, no
 * llamadas a la acción.
 */
const ENLACE = "text-sm text-text-2 underline-offset-4 hover:text-text hover:underline";

const BOTON_DESTACADO =
  "inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-medium text-on-brand transition-colors dur-rapida ease-suave hover:bg-brand-hover";

const BOTON_DISCRETO =
  "inline-flex min-h-11 items-center rounded-lg border border-line px-3.5 text-sm text-text-2 transition-colors dur-rapida ease-suave hover:bg-surface-2 hover:text-text";

/** Insignia dorada del estado Pro. Píldora, para que se note distinta de
 * "Admin"/"Salir" (enlace de texto plano) aunque ahora comparta protagonismo
 * visual con "Suscríbete" (también destacado, mismo motivo: conversión). */
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
        <Link href="/precios" className={BOTON_DESTACADO}>
          Suscríbete
        </Link>
        <Link href="/entrar" className={BOTON_DISCRETO}>
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
        <Link href="/precios" className={BOTON_DESTACADO}>
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
