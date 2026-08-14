import Link from "next/link";
import { calcularObjetivo } from "@planeat/shared";
import { MacroBar } from "@/components/macro-bar";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Portada. Por ahora es un esqueleto: establece el sistema visual y muestra el
 * cálculo de objetivos ya funcionando. El generador público sin registro —el
 * primer vertical real— es el siguiente paso del roadmap.
 */

// Perfil de ejemplo para demostrar que el cálculo de objetivos ya funciona.
const objetivoDemo = calcularObjetivo({
  sexo: "hombre",
  edad: 32,
  peso: 78,
  altura: 178,
  actividad: "moderado",
  objetivo: "perder",
});

export default function Home() {
  const centro = (r: { min: number; max: number }) => (r.min + r.max) / 2;

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold tracking-tight">PlanEat</span>
          <div className="flex items-center gap-3">
            <Link
              href="/sistema"
              className="text-sm text-text-2 underline-offset-4 hover:text-text hover:underline"
            >
              Sistema de diseño
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-brand">
          En construcción
        </p>
        <h1 className="max-w-2xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
          Tu plan de comidas, resuelto
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-text-2">
          Planes que cuadran con tus objetivos, tu presupuesto y lo que ya tienes
          en casa. Sin registrar nada plato a plato.
        </p>

        <section className="mt-14 max-w-md rounded-xl border border-line bg-surface p-6">
          <h2 className="text-sm font-semibold text-text">
            Objetivo diario calculado
          </h2>
          <p className="mt-1 mb-5 text-sm text-text-3">
            Hombre, 32 años, 78 kg, 178 cm, actividad moderada, quiere perder
            peso.
          </p>
          <MacroBar
            kcal={objetivoDemo.kcal}
            objetivoKcal={objetivoDemo.kcal}
            panel={{
              proteinaG: centro(objetivoDemo.proteinaG),
              carbohidratoG: centro(objetivoDemo.carbohidratoG),
              grasaG: centro(objetivoDemo.grasaG),
            }}
          />
          <p className="mt-5 border-t border-line pt-4 text-sm text-text-3">
            Calculado con Mifflin-St Jeor. Es una estimación poblacional, no
            consejo médico.
          </p>
        </section>

        <section className="mt-16 border-t border-line pt-8">
          <h2 className="text-sm font-semibold text-text">Siguiente paso</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-2">
            El motor de generación de planes — fase 1 del roadmap. El contrato
            HTTP del solver ya está definido en{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">
              services/solver
            </code>
            ; falta implementar las cuatro etapas descritas en{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">
              docs/spec.md
            </code>{" "}
            §6.
          </p>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-5xl px-6 py-6 text-sm text-text-3">
          PlanEat · esqueleto del proyecto
        </div>
      </footer>
    </div>
  );
}
