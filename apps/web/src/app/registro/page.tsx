import type { Metadata } from "next";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";

import { FormularioRegistro } from "./formulario-registro";

export const metadata: Metadata = {
  title: "Crear cuenta",
  description: "Crea tu cuenta de PlanEat para el plan Pro.",
};

export default function PaginaRegistro() {
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

      <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Crear cuenta</h1>
        <p className="mt-2 text-[15px] text-text-2">
          Para el plan Pro semanal y su lista de la compra. Gratis sigue sin
          cuenta.
        </p>
        <FormularioRegistro />
        <p className="mt-6 text-sm text-text-2">
          ¿Ya tienes cuenta?{" "}
          <Link href="/entrar" className="font-medium text-text underline-offset-4 hover:underline">
            Entra
          </Link>
        </p>
      </main>
    </div>
  );
}
