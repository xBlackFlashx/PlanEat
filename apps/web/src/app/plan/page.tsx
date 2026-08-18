import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { NavCuenta } from "@/components/nav-cuenta";
import { ThemeToggle } from "@/components/theme-toggle";

import { PlanCliente } from "./plan-cliente";

/**
 * Vista del plan del día.
 *
 * Sigue siendo una **URL compartible**, y eso es producto, no implementación:
 * el perfil viaja en la query, así que el mismo enlace devuelve el mismo tipo
 * de día. Con el motor en el navegador se añade el `seed`, que lo hace además
 * *reproducible*: mismo enlace, mismo plan, receta por receta. Este día suelto
 * sigue sin sesión ni base de datos a propósito — es el camino de entrada sin
 * cuenta — aunque el resto de la app ya tenga las dos (ver `/semana` para el
 * plan Pro guardado por usuario).
 *
 * El trabajo pesado sigue ocurriendo en el navegador, no en el servidor: el
 * motor es un Web Worker (`src/lib/solver.ts`). Este fichero es el cascarón
 * —lo único que se puede prerenderizar sin conocer la query— y todo lo que
 * depende de ella baja a `plan-cliente.tsx`.
 *
 * El reparto no es de gusto: `export const metadata` y `"use client"` no pueden
 * convivir en el mismo fichero, y `useSearchParams()` sin frontera de
 * `<Suspense>` hace fallar el build.
 */

export const metadata: Metadata = {
  title: "Tu día",
  description: "Un día completo de comidas que cuadra con tus objetivos.",
};

export default function PaginaPlan() {
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
        {/*
          Sin JavaScript no hay plan, y se dice. Antes esta página se
          renderizaba en el servidor y el formulario de la portada funcionaba
          por GET de principio a fin; el motor vive ahora en el navegador y ese
          camino ha muerto. Lo que no se hace es quedarse en blanco ni enseñar
          un día de ejemplo: eso sería exactamente la mentira que el resto del
          producto se niega a contar.

          Va antes que el `<Suspense>` para que sea lo primero que se lee, y
          fuera del árbol de cliente para que exista en el HTML estático.
        */}
        <noscript>
          <section className="mx-auto max-w-xl rounded-[var(--radius-lg)] bg-surface p-6 sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight">
              Necesito JavaScript para montar tu día.
            </h1>
            <p className="mt-3 text-[17px] leading-relaxed text-text-2">
              El motor que calcula el plan corre aquí, en tu navegador: no hay
              servidor que lo haga por ti. Sin JavaScript no puedo generarlo, y
              prefiero decírtelo a enseñarte un día inventado.
            </p>
            <p className="mt-3 text-[17px] leading-relaxed text-text-2">
              Tus datos no se pierden: están en la dirección de esta página. Si
              activas JavaScript y recargas, el día sale.
            </p>
          </section>
        </noscript>

        <Suspense fallback={<EsperandoLaQuery />}>
          <PlanCliente />
        </Suspense>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-[1120px] px-4 py-8 sm:px-6 lg:px-8">
          <p className="max-w-2xl text-sm leading-relaxed text-text-2">
            Son estimaciones a partir de fórmulas poblacionales
            (Mifflin-St Jeor). No son consejo médico. Filtramos por los
            ingredientes declarados en nuestro catálogo: no sustituye leer la
            etiqueta del producto que compres.
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * Lo que se ve entre que llega el HTML estático y React lee la query. Son
 * milisegundos, así que no monta el estado de generación —que es la forma del
 * día del usuario y aquí todavía no se sabe cuál es—, sólo reserva el sitio
 * para que no haya salto de layout.
 */
function EsperandoLaQuery() {
  return <div aria-hidden="true" className="min-h-[420px]" />;
}
