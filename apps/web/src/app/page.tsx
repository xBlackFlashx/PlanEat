import Link from "next/link";

import { Generador } from "@/components/generador";
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
    titulo: "El coste, delante",
    texto:
      "Cada día trae su coste estimado en ingredientes, siempre como rango. La comida tiene precio y esconderlo hasta el supermercado no ayuda a nadie.",
  },
  {
    titulo: "La lista, corta",
    texto:
      "El plan se monta favoreciendo recetas que comparten ingredientes. Un plan que necesita sesenta cosas distintas es un plan que no se cocina.",
  },
  {
    titulo: "Lo que ya tienes, primero",
    texto:
      "Lo que hay en casa entra en el plan antes que lo que hay que comprar. Es la diferencia entre planificar y volver a llenar la nevera.",
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
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-balance text-[34px] font-semibold leading-[1.05] tracking-tight sm:text-5xl">
            Tu semana, resuelta.
          </h1>
          <p className="mt-4 text-pretty text-[17px] leading-relaxed text-text-2">
            Qué comer, cuánto cuesta y qué comprar. Sin listas de sesenta
            ingredientes.
          </p>
        </div>

        <div className="mx-auto mt-8 max-w-2xl">
          <Generador />
        </div>

        <section className="mx-auto mt-16 max-w-2xl border-t border-line pt-10 sm:mt-24">
          <h2 className="text-2xl font-semibold tracking-tight">
            En qué se diferencia
          </h2>
          <dl className="mt-6 flex flex-col gap-8">
            {PILARES.map((pilar) => (
              <div key={pilar.titulo}>
                <dt className="text-[17px] font-semibold">{pilar.titulo}</dt>
                <dd className="mt-1.5 text-pretty leading-relaxed text-text-2">
                  {pilar.texto}
                </dd>
              </div>
            ))}
          </dl>
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
