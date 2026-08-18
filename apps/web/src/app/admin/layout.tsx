import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Admin",
  description: "Panel de administración de PlanEat.",
};

const ENLACE = "text-sm text-text-2 hover:text-text hover:underline";

/**
 * Defensa en profundidad: el middleware (`src/middleware.ts`) ya bloquea
 * cualquier visita a `/admin/*` sin JWT autenticado + `esAdmin`, así que en
 * teoría nunca se llega aquí sin serlo. "En teoría" no basta en un panel que
 * puede cambiar el tier de pago de cualquier usuario — se repite la
 * comprobación en el propio layout de servidor, que sí puede consultar la
 * sesión sin las limitaciones del runtime Edge del middleware.
 */
export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || !session.user || !session.user.esAdmin) redirect("/");

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-2 px-4 sm:px-6 lg:px-8">
          <span className="text-sm font-semibold tracking-tight">Admin · PlanEat</span>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <Link href="/admin" className={ENLACE}>
              Resumen
            </Link>
            <Link href="/admin/generaciones" className={ENLACE}>
              Generaciones
            </Link>
            <Link href="/admin/usuarios" className={ENLACE}>
              Usuarios
            </Link>
            <Link href="/admin/parametros" className={ENLACE}>
              Parámetros
            </Link>
          </nav>
          <Link href="/" className={`ml-auto ${ENLACE}`}>
            Volver al sitio
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
