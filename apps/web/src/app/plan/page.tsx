import type { Metadata } from "next";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { VistaPlan } from "@/components/vista-plan";
import { fechaLarga } from "@/lib/formato";
import {
  calcularObjetivoDelDia,
  construirSolicitud,
  hayErrores,
  leerFormulario,
  validar,
} from "@/lib/perfil";
import { generarPlan } from "@/lib/solver";

/**
 * Vista del plan del día, renderizada en servidor.
 *
 * Es el destino del formulario de la portada cuando no hay JavaScript, y es
 * también una URL compartible: el perfil viaja en la query, así que el mismo
 * enlace devuelve el mismo tipo de día. No hay sesión ni base de datos todavía;
 * cuando las haya, esta página leerá el plan guardado y la query se quedará
 * como camino de entrada sin cuenta.
 *
 * El trabajo pesado ocurre aquí, en el servidor: se calcula el objetivo, se
 * pide el plan al motor y se adjunta el catálogo. El cliente sólo recibe datos.
 */

export const metadata: Metadata = {
  title: "Tu día",
  description: "Un día completo de comidas que cuadra con tus objetivos.",
};

/** La query cambia en cada visita: esta página nunca se prerrenderiza. */
export const dynamic = "force-dynamic";

export default async function PaginaPlan({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const crudos = await searchParams;
  const datos = leerFormulario(crudos);
  const errores = validar(datos);
  const { objetivo } = calcularObjetivoDelDia(datos);

  const resultado = hayErrores(errores)
    ? null
    : await generarPlan(construirSolicitud(datos));

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

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {resultado == null ? (
          <section className="mx-auto max-w-xl rounded-[var(--radius-lg)] bg-surface p-6 sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight">
              Me falta algún dato para montar el día.
            </h1>
            <ul className="mt-4 flex flex-col gap-2">
              {Object.entries(errores).map(([campo, mensaje]) => (
                <li key={campo} className="text-[15px] leading-snug text-danger">
                  {mensaje}
                </li>
              ))}
            </ul>
            <Link
              href="/"
              className="mt-6 inline-flex min-h-12 items-center rounded-[var(--radius)] bg-brand px-5 font-medium text-on-brand hover:bg-brand-hover"
            >
              Volver al generador
            </Link>
          </section>
        ) : (
          <>
            <h1 className="sr-only">
              Tu día
              {resultado.estado === "ok" && resultado.dias[0]
                ? `: ${fechaLarga(resultado.dias[0].fecha)}`
                : ""}
            </h1>
            <VistaPlan datos={datos} resultado={resultado} objetivo={objetivo} />
          </>
        )}
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
