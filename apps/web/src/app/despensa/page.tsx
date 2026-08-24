import type { Metadata } from "next";
import Link from "next/link";

import { LogoPlanEat } from "@/components/logo";
import { NavCuenta } from "@/components/nav-cuenta";
import { ThemeToggle } from "@/components/theme-toggle";

import { DespensaCliente } from "./despensa-cliente";

/**
 * "Qué puedo cocinar con esto" — pública, sin sesión, igual que `/plan`: el
 * cruce de ingredientes contra el catálogo es aritmética sobre
 * `recetas-vista.json`, ya en el navegador, sin motor de optimización ni
 * servidor de por medio (ver `src/lib/despensa.ts`).
 *
 * No guarda nada entre visitas todavía: es una calculadora, no un inventario
 * persistente. `docs/diseno-producto.md` describe una "Despensa" que se
 * llena sola al marcar la compra como hecha — eso es una función más grande,
 * separada, que esta página no implementa.
 */

export const metadata: Metadata = {
  title: "Qué puedo cocinar",
  description: "Dinos qué tienes en casa y te decimos qué puedes preparar.",
};

export default function PaginaDespensa() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
          >
            <LogoPlanEat className="text-lg font-semibold tracking-tight" />
          </Link>
          <div className="flex items-center gap-3">
            <NavCuenta />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <noscript>
          <section className="mx-auto max-w-xl rounded-[var(--radius-lg)] bg-surface p-6 sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight">
              Necesito JavaScript para cruzar tus ingredientes.
            </h1>
            <p className="mt-3 text-[17px] leading-relaxed text-text-2">
              El cruce contra el catálogo corre en tu navegador. Sin
              JavaScript no puedo calcularlo.
            </p>
          </section>
        </noscript>

        <DespensaCliente />
      </main>
    </div>
  );
}
