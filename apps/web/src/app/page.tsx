import Link from "next/link";

import { DiaReal } from "@/components/dia-real";
import { Generador } from "@/components/generador";
import { MotoresConfianza } from "@/components/motores-confianza";
import { NavCuenta } from "@/components/nav-cuenta";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Portada con generador público.
 *
 * Objetivo único: que un desconocido vea un día real generado en menos de
 * sesenta segundos y sin cuenta. Todo lo demás en esta página es secundario y
 * vive por debajo del pliegue.
 *
 * En el primer segundo se ve el titular y, justo después, el primer campo
 * subrayado. Nada compite: no hay imagen a pantalla completa sobre el
 * formulario, no hay carrusel, no hay vídeo.
 */

const PILARES = [
  {
    titulo: "Hecho para México",
    texto:
      "Ingredientes y recetas pensados para lo que se compra aquí, con los nombres que se usan aquí. No es una traducción de un catálogo de otro país.",
  },
  {
    titulo: "La lista, corta",
    texto:
      "El plan se monta favoreciendo recetas que comparten ingredientes. Un plan que necesita sesenta cosas distintas es un plan que no se cocina.",
  },
  {
    titulo: "Lo que ya tienes, primero",
    texto:
      "Lo que hay en casa entra en el plan antes que lo que hay que comprar. Es la diferencia entre planificar y volver a llenar el refrigerador.",
  },
];

export default function Portada() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <span className="text-lg font-semibold tracking-tight">PlanEat</span>
          <div className="flex items-center gap-3">
            <Link
              href="/sistema"
              className="hidden text-sm text-text-2 underline-offset-4 hover:text-text hover:underline sm:inline"
            >
              Sistema de diseño
            </Link>
            <a
              href="#generador"
              className="hidden min-h-11 items-center rounded-[var(--radius)] bg-brand px-4 text-sm font-medium text-on-brand hover:bg-brand-hover sm:inline-flex"
            >
              Generar mi día
            </a>
            <NavCuenta />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <h1 className="voz-1 text-balance">Tu semana, resuelta.</h1>
          <p className="mt-4 text-pretty text-[17px] leading-relaxed text-text-2">
            Qué comer, cuánto cuesta y qué comprar. Sin listas de sesenta
            ingredientes.
          </p>
        </div>

        <div id="generador" className="mx-auto mt-8 max-w-2xl scroll-mt-14">
          <Generador />
        </div>

        <DiaReal />

        <section className="mx-auto mt-16 w-full max-w-[1120px] border-t border-line pt-10 sm:mt-24">
          <h2 className="t-1">En qué se diferencia</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {PILARES.map((pilar) => (
              <div
                key={pilar.titulo}
                className="rounded-[var(--radius-lg)] border border-line bg-surface p-5 sm:p-6"
              >
                <h3 className="t-3">{pilar.titulo}</h3>
                <p className="mt-2 text-pretty leading-relaxed text-text-2">
                  {pilar.texto}
                </p>
              </div>
            ))}
          </div>
        </section>

        <MotoresConfianza />

        <section className="mx-auto mt-16 w-full max-w-[1120px] border-t border-line pt-10 sm:mt-24">
          <div className="rounded-[var(--radius-lg)] bg-brand-soft p-6 text-center sm:p-10">
            <h2 className="t-1">El día suelto, sin cuenta ni tarjeta</h2>
            <p className="mx-auto mt-3 max-w-xl text-pretty leading-relaxed text-text-2">
              Genera un día completo cuantas veces quieras, sin registrarte y
              sin letra pequeña. Si además quieres la semana entera resuelta
              con su lista de la compra, eso sí es Pro — compáralo en{" "}
              <Link href="/precios" className="font-medium text-text underline-offset-4 hover:underline">
                Precios
              </Link>
              .
            </p>
            <a
              href="#generador"
              className="mt-6 inline-flex min-h-11 items-center rounded-[var(--radius)] bg-brand px-6 font-medium text-on-brand hover:bg-brand-hover"
            >
              Generar mi día
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-[1120px] px-4 py-8 sm:px-6 lg:px-8">
          <p className="max-w-2xl text-sm leading-relaxed text-text-2">
            Los objetivos se calculan con fórmulas poblacionales
            (Mifflin-St Jeor) y son estimaciones, no consejo médico. El filtro
            de alérgenos usa los ingredientes declarados en nuestro catálogo y
            no sustituye leer la etiqueta del producto que compres.
          </p>
          {/* `--text-2` y no `--text-3`: sobre `--bg` en tema claro el tercer
              nivel de texto se queda en 4,47:1, tres centésimas por debajo de
              AA. Medido, no supuesto (docs/diseno-producto.md, anexo A). */}
          <p className="mt-4 text-sm text-text-2">PlanEat</p>
        </div>
      </footer>
    </div>
  );
}
