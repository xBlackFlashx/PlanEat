import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PanelFotoAuth } from "@/components/panel-foto-auth";
import { ThemeToggle } from "@/components/theme-toggle";

import { FormularioEntrar } from "./formulario-entrar";

export const metadata: Metadata = {
  title: "Entrar",
  description: "Entra a tu cuenta de PlanEat.",
};

export default function PaginaEntrar() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center text-lg font-semibold tracking-tight underline-offset-4 hover:underline"
          >
            PlanEat
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <div className="grid flex-1 lg:grid-cols-2">
        <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center px-4 py-16 sm:px-6">
          <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
          <p className="mt-2 text-[15px] text-text-2">
            Sólo hace falta cuenta para el plan Pro semanal. El generador del
            día sigue sin pedirte nada.
          </p>
          <Suspense>
            <FormularioEntrar />
          </Suspense>
          <p className="mt-6 text-sm text-text-2">
            ¿No tienes cuenta?{" "}
            <Link href="/registro" className="font-medium text-text underline-offset-4 hover:underline">
              Crea una
            </Link>
          </p>
        </main>

        <PanelFotoAuth
          recetaId="salteado_pollo_verduras"
          frase="Un plan real, con recetas reales — no una lista genérica de sesenta ingredientes."
        />
      </div>
    </div>
  );
}
