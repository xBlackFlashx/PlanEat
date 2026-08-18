import type { Metadata } from "next";
import Link from "next/link";

import { NavCuenta } from "@/components/nav-cuenta";
import { TarjetasPrecio } from "@/components/tarjetas-precio";
import { ThemeToggle } from "@/components/theme-toggle";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { tierEfectivo } from "@/lib/suscripcion";

export const metadata: Metadata = {
  title: "Precios",
  description: "Compara el plan gratis y el plan Pro de PlanEat.",
};

/**
 * El tier se calcula aquí, en el servidor, y no en el cliente: la sesión JWT
 * no lleva el tier (puede cambiar sin volver a iniciar sesión), así que se
 * lee la suscripción real de la base de datos en cada carga.
 */
export default async function PaginaPrecios() {
  const sesion = await auth();

  let tierActual: "FREE" | "PRO" | null = null;
  if (sesion?.user) {
    const suscripcion = await prisma.suscripcion.findUnique({
      where: { userId: sesion.user.id },
    });
    tierActual = tierEfectivo(suscripcion);
  }

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
          <div className="flex items-center gap-3">
            <NavCuenta />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <h1 className="voz-1 text-balance">
            Un plan gratis de verdad, y un Pro que ahorra tiempo de compra.
          </h1>
          <p className="mt-4 text-pretty text-[17px] leading-relaxed text-text-2">
            El generador de un día es gratis y completo, sin cuenta. Pro añade
            la semana entera y la lista de la compra ya sumada.
          </p>
        </div>

        <div className="mt-10">
          <TarjetasPrecio tierActual={tierActual} />
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-[1120px] px-4 py-8 sm:px-6 lg:px-8">
          <p className="max-w-2xl text-sm leading-relaxed text-text-2">
            Los precios se muestran en pesos mexicanos (MXN), IVA no incluido.
            Puedes cancelar el plan Pro cuando quieras.
          </p>
        </div>
      </footer>
    </div>
  );
}
