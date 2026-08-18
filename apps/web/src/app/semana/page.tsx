import type { Metadata } from "next";
import Link from "next/link";

import { NavCuenta } from "@/components/nav-cuenta";
import { ThemeToggle } from "@/components/theme-toggle";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lunesDeLaSemana } from "@/lib/semana";
import { tierEfectivo } from "@/lib/suscripcion";

import { FormularioSemana } from "./formulario-semana";

export const metadata: Metadata = {
  title: "Tu semana Pro",
  description: "Un plan de 7 días con su lista de la compra, a partir de tu perfil.",
};

export default async function PaginaSemana() {
  const sesion = await auth();

  // El middleware ya redirige a /entrar si no hay sesión; esto es sólo la
  // defensa de este fichero por si algún día se llega aquí de otra forma.
  if (!sesion?.user) {
    return (
      <Cascaron>
        <section className="rounded-[var(--radius-lg)] bg-surface p-6 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Necesito que entres.</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-text-2">
            Esta página es de tu cuenta.
          </p>
          <Link
            href="/entrar"
            className="mt-6 inline-flex h-13 min-h-13 items-center justify-center rounded-[var(--radius)] bg-brand px-6 text-[17px] font-semibold text-on-brand hover:bg-brand-hover"
          >
            Entrar
          </Link>
        </section>
      </Cascaron>
    );
  }

  const suscripcion = await prisma.suscripcion.findUnique({
    where: { userId: sesion.user.id },
  });
  const tier = tierEfectivo(suscripcion);

  if (tier !== "PRO") {
    return (
      <Cascaron>
        <section className="rounded-[var(--radius-lg)] bg-surface p-6 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Esto es del plan Pro.</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-text-2">
            La semana completa —7 días cuadrados y su lista de la compra en un
            solo sitio— es para cuentas Pro. El generador del día sigue siendo
            gratis y sin cuenta.
          </p>
          <Link
            href="/precios"
            className="mt-6 inline-flex h-13 min-h-13 items-center justify-center rounded-[var(--radius)] bg-brand px-6 text-[17px] font-semibold text-on-brand hover:bg-brand-hover"
          >
            Ver PlanEat Pro
          </Link>
        </section>
      </Cascaron>
    );
  }

  const planExistente = await prisma.planSemana.findUnique({
    where: {
      userId_semanaDelDia: {
        userId: sesion.user.id,
        semanaDelDia: lunesDeLaSemana(new Date()),
      },
    },
  });

  return (
    <Cascaron>
      <h1 className="text-2xl font-semibold tracking-tight">Tu semana</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-text-2">
        Ajusta tu perfil y genera 7 días de comidas que cuadran, con la lista
        de la compra ya sumada.
      </p>
      {planExistente && (
        <p className="mt-3 text-sm text-text-2">
          Ya tienes un plan generado para la semana de esta fecha. Generar de
          nuevo lo sustituye.
        </p>
      )}

      <div className="mt-8">
        <FormularioSemana />
      </div>
    </Cascaron>
  );
}

function Cascaron({ children }: { children: React.ReactNode }) {
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

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
