import type { Metadata } from "next";
import Link from "next/link";

import type { VistaRecetas } from "@planeat/motor";
import recetasVista from "@planeat/motor/recetas-vista";

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
const vista: VistaRecetas = recetasVista;
const FOTO_HERO_ID = "ensalada_pollo_cesar";

export default async function PaginaPrecios() {
  const sesion = await auth();
  const recetaHero = vista.recetas[FOTO_HERO_ID];

  let tierActual: "FREE" | "PRO" | null = null;
  if (sesion?.user) {
    const suscripcion = await prisma.suscripcion.findUnique({
      where: { userId: sesion.user.id },
    });
    tierActual = tierEfectivo(suscripcion);
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line bg-[linear-gradient(180deg,var(--surface-2)_0%,transparent_100%)]">
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
        {/* Hero: textura sutil de dos degradados radiales sobre los tokens de
         * marca y dorado ya existentes, puramente decorativa. Suavizada con
         * `color-mix` (antes usaba `--brand-soft`/`--gold-soft` a plena
         * intensidad): con la textura global nueva de `globals.css` (mismo
         * rincón superior-izquierdo, mismo verde de marca) esta capa local ya
         * no necesita cargar sola todo el acento — sólo lo remata — y a plena
         * intensidad competía con ella, sobre todo en oscuro, donde
         * `--brand-soft` es un verde bastante saturado sobre `--bg` casi
         * negro. */}
        <div className="relative grid items-center gap-8 overflow-hidden rounded-[var(--radius-lg)] px-4 py-8 sm:px-8 sm:py-12 lg:grid-cols-[1.2fr_0.8fr]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(900px_360px_at_15%_-10%,color-mix(in_oklab,var(--brand-soft)_55%,transparent),transparent),radial-gradient(650px_280px_at_100%_-20%,color-mix(in_oklab,var(--gold-soft)_55%,transparent),transparent)]"
          />
          <div className="max-w-2xl">
            <h1 className="voz-1 text-balance">
              Un plan gratis de verdad, y un Pro que ahorra tiempo de compra.
            </h1>
            <p className="mt-4 text-pretty text-[17px] leading-relaxed text-text-2">
              El generador de un día es gratis y completo, sin cuenta. Pro
              añade la semana entera y la lista de la compra ya sumada.
            </p>
          </div>

          {/* Foto real, difuminada hacia el borde para que acompañe sin
              competir con las tarjetas de precio justo debajo. Oculta por
              debajo de `lg` — en pantallas chicas el titular y las tarjetas
              ya llenan el primer pantallazo. */}
          {recetaHero?.imagenUrl && (
            <div
              className="hidden aspect-[4/3] overflow-hidden rounded-[var(--radius-lg)] border border-line lg:block"
              style={{ maskImage: "linear-gradient(110deg, black 55%, transparent 100%)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={recetaHero.imagenUrl}
                alt={recetaHero.titulo}
                className="h-full w-full object-cover"
                loading="eager"
                fetchPriority="high"
              />
            </div>
          )}
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
