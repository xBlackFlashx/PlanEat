import type { Metadata } from "next";
import Link from "next/link";
import { MacroBar } from "@/components/macro-bar";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "Sistema de diseño",
  description: "Referencia viva de los tokens y primitivas de PlanEat.",
};

/**
 * Referencia viva del sistema. Sirve para verificar que cada token funciona en
 * ambos temas antes de usarlo en producto. No se enlaza desde la app pública.
 */

const SUPERFICIES = [
  { token: "--bg", clase: "bg-bg", nombre: "Fondo" },
  { token: "--surface", clase: "bg-surface", nombre: "Superficie" },
  { token: "--surface-2", clase: "bg-surface-2", nombre: "Superficie 2" },
  { token: "--surface-3", clase: "bg-surface-3", nombre: "Superficie 3" },
];

const MACROS = [
  { token: "--protein", clase: "bg-protein", nombre: "Proteína" },
  { token: "--carb", clase: "bg-carb", nombre: "Carbohidratos" },
  { token: "--fat", clase: "bg-fat", nombre: "Grasa" },
];

const ESTADOS = [
  { token: "--brand", clase: "bg-brand", nombre: "Marca" },
  { token: "--danger", clase: "bg-danger", nombre: "Error" },
  { token: "--warning", clase: "bg-warning", nombre: "Aviso" },
];

function Muestras({
  titulo,
  nota,
  items,
}: {
  titulo: string;
  nota: string;
  items: { token: string; clase: string; nombre: string }[];
}) {
  return (
    <section className="mb-12">
      <h2 className="text-sm font-semibold text-text">{titulo}</h2>
      <p className="mt-1 mb-4 max-w-2xl text-sm leading-relaxed text-text-3">
        {nota}
      </p>
      <div className="flex flex-wrap gap-3">
        {items.map((c) => (
          <div key={c.token} className="w-40">
            <div
              className={`${c.clase} h-14 rounded-lg border border-line`}
              aria-hidden="true"
            />
            <p className="mt-2 text-sm font-medium text-text">{c.nombre}</p>
            <code className="font-mono text-xs text-text-3">{c.token}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function SistemaDeDiseno() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            PlanEat
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">
          Sistema de diseño
        </h1>
        <p className="mt-3 mb-12 max-w-2xl leading-relaxed text-text-2">
          Referencia viva de los tokens. Alterna el tema con el botón de arriba:
          todo lo de esta página debe seguir siendo legible en ambos.
        </p>

        <Muestras
          titulo="Superficies"
          nota="Neutro cálido, no gris puro. Las tarjetas de comida se separan por fondo, no por sombra: la sombra queda reservada a elementos flotantes."
          items={SUPERFICIES}
        />

        <Muestras
          titulo="Macronutrientes"
          nota="Triada Okabe-Ito, diseñada para ser distinguible en deuteranopia y protanopia. Son los mismos tres tonos en todo el producto, se aprenden una vez. Ninguno coincide con el acento de marca."
          items={MACROS}
        />

        <Muestras
          titulo="Marca y estados"
          nota="El acento de marca es berenjena: evita a propósito el verde-menta clínico de las apps de salud. «Éxito» no usa verde porque colisionaría con el color de grasa — se resuelve con el acento de marca y un icono."
          items={ESTADOS}
        />

        <section className="mb-12">
          <h2 className="text-sm font-semibold text-text">Escala tipográfica</h2>
          <p className="mt-1 mb-4 max-w-2xl text-sm leading-relaxed text-text-3">
            Toda cifra nutricional o de precio usa números tabulares. Sin ellos,
            las columnas de gramos bailan al actualizarse y el producto se ve
            amateur.
          </p>
          <div className="space-y-3 rounded-xl border border-line bg-surface p-6">
            <p className="text-4xl font-semibold tracking-tight">
              Título de pantalla
            </p>
            <p className="text-xl font-semibold tracking-tight">
              Encabezado de sección
            </p>
            <p className="text-base text-text-2">
              Texto de cuerpo, el tamaño por defecto de lectura.
            </p>
            <p className="text-sm text-text-3">
              Texto auxiliar y notas al pie.
            </p>
            <p className="tabular-nums text-base" data-numeric>
              1.847 kcal · 142 g · 38,50 €
            </p>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-sm font-semibold text-text">
            Barra de macros
          </h2>
          <p className="mt-1 mb-4 max-w-2xl text-sm leading-relaxed text-text-3">
            Capa 2 de las tres de presentación nutricional. Apilada y no donut:
            permite marcar el objetivo y funciona en anchos pequeños.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-6">
              <MacroBar
                kcal={1980}
                objetivoKcal={2000}
                panel={{ proteinaG: 142, carbohidratoG: 198, grasaG: 66 }}
              />
              <p className="mt-4 text-sm text-text-3">Dentro de objetivo.</p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-6">
              <MacroBar
                kcal={2340}
                objetivoKcal={2000}
                panel={{ proteinaG: 118, carbohidratoG: 268, grasaG: 89 }}
              />
              <p className="mt-4 text-sm text-text-3">
                Desviado: el aviso aparece solo al superar el ±3 %.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
