import Link from "next/link";

import type { VistaRecetas } from "@planeat/motor";
import recetasVista from "@planeat/motor/recetas-vista";

import { DiaReal } from "@/components/dia-real";
import { Generador } from "@/components/generador";
import { IconoFlecha } from "@/components/iconos";
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
 * subrayado. Nada compite con el formulario: no hay carrusel, no hay vídeo, y
 * el collage de fotos del hero vive en su propia columna junto al titular
 * (2026-08-19, pedido explícito de más color/imágenes) — nunca a pantalla
 * completa detrás del texto ni sobre el formulario, que sigue siendo su
 * propia caja separada más abajo.
 */

const vista: VistaRecetas = recetasVista;

/** Tres platillos reales y vistosos del catálogo, no una tirada aleatoria en
 * cada visita — mismo criterio que `dia-real.tsx`: fijos a propósito. */
const FOTOS_HERO = [
  { id: "salmon_espinacas_aguacate", clase: "col-span-1 row-span-2" },
  { id: "quinoa_tofu_pimiento", clase: "col-span-1 row-span-1" },
  { id: "batido_platano_avena", clase: "col-span-1 row-span-1" },
] as const;

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

/**
 * Texturas y animación de entrada de la portada.
 *
 * Todo el movimiento y todo el color aquí sale de los tokens de
 * globals.css (--dur-*, --ease-*, --brand, --fat, --line-strong,
 * --shadow-pop) — nada literal. `color-mix(in oklab, TOKEN X%, transparent)`
 * es una variante de opacidad de un token existente, no un color nuevo.
 *
 * Cubierto por el reset de `prefers-reduced-motion` de globals.css (bloque
 * `@layer base`, selector universal `*`): ese bloque ya fuerza
 * `animation-duration`/`transition-duration` a 0,01 ms con `!important`
 * sobre cualquier elemento, así que `.pe-pilar` queda cubierto sin duplicar
 * la media query aquí.
 */
const ESTILOS_PORTADA = `
  .pe-hero {
    position: relative;
    isolation: isolate;
    overflow: hidden;
  }
  .pe-hero::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background-image:
      radial-gradient(60% 55% at 12% 8%, color-mix(in oklab, var(--brand) 12%, transparent), transparent 70%),
      radial-gradient(55% 45% at 100% 0%, color-mix(in oklab, var(--fat) 8%, transparent), transparent 70%),
      radial-gradient(color-mix(in oklab, var(--line-strong) 55%, transparent) 1px, transparent 1px);
    background-size: auto, auto, 22px 22px;
  }

  .pe-cta-textura {
    position: relative;
    isolation: isolate;
    overflow: hidden;
  }
  .pe-cta-textura::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background-image: radial-gradient(color-mix(in oklab, var(--brand) 25%, transparent) 1px, transparent 1px);
    background-size: 20px 20px;
  }

  @keyframes pe-entrada-pilar {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .pe-pilar {
    animation: pe-entrada-pilar var(--dur-media) var(--ease-entrada) backwards;
  }
`;

export default function Portada() {
  return (
    <div className="flex min-h-full flex-col">
      <style>{ESTILOS_PORTADA}</style>

      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <span className="text-lg font-semibold tracking-tight">PlanEat</span>
          <div className="flex items-center gap-3">
            <a
              href="#generador"
              className="hidden min-h-11 items-center rounded-[var(--radius)] bg-brand px-4 text-sm font-medium text-on-brand transition-colors dur-rapida ease-suave hover:bg-brand-hover sm:inline-flex"
            >
              Planea tu comida
            </a>
            <NavCuenta />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="pe-hero mx-auto grid max-w-4xl items-center gap-8 rounded-[var(--radius-lg)] border border-line bg-surface px-6 py-10 sm:px-10 sm:py-14 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <h1 className="voz-1 text-balance">Tu semana, resuelta.</h1>
            <p className="mt-4 text-pretty text-[17px] leading-relaxed text-text-2">
              Qué comer y qué comprar, sin listas de sesenta ingredientes.
            </p>
          </div>

          {/* Collage de fotos reales del catálogo — decorativo pero con
              `alt` real: son platillos de verdad, no relleno. Oculto por
              debajo de `lg` para no competir con el titular ni empujar el
              formulario fuera del primer pantallazo en móvil. */}
          <div className="relative hidden aspect-square grid-cols-2 grid-rows-2 gap-3 lg:grid">
            {FOTOS_HERO.map(({ id, clase }, indice) => {
              const receta = vista.recetas[id];
              if (!receta?.imagenUrl) return null;
              return (
                <div key={id} className={`relative overflow-hidden rounded-[var(--radius-lg)] border border-line ${clase}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={receta.imagenUrl}
                    alt={receta.titulo}
                    className="h-full w-full object-cover"
                    loading={indice === 0 ? "eager" : "lazy"}
                    fetchPriority={indice === 0 ? "high" : "auto"}
                  />
                </div>
              );
            })}
            <span className="pointer-events-none absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-energia px-3 py-1 text-xs font-semibold text-on-energia shadow-[var(--shadow-pop)]">
              Fotos reales, no maqueta
            </span>
          </div>
        </div>

        <div id="generador" className="mx-auto mt-8 max-w-2xl scroll-mt-14">
          <Generador />
        </div>

        <DiaReal />

        <section className="mx-auto mt-16 w-full max-w-[1120px] border-t border-line pt-10 sm:mt-24">
          <h2 className="t-1">En qué se diferencia</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {PILARES.map((pilar, indice) => (
              <div
                key={pilar.titulo}
                className="pe-pilar rounded-[var(--radius-lg)] border border-line bg-surface p-5 transition-colors dur-rapida ease-suave hover:border-line-strong hover:bg-surface-2 sm:p-6"
                style={{ animationDelay: `calc(${indice} * var(--dur-rapida))` }}
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
          <div className="pe-cta-textura rounded-[var(--radius-lg)] bg-brand-soft p-6 text-center sm:p-10">
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
              className="group mt-6 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius)] bg-brand px-6 font-medium text-on-brand transition-[transform,box-shadow,background-color] dur-rapida ease-suave hover:-translate-y-0.5 hover:bg-brand-hover hover:shadow-[var(--shadow-pop)] focus-visible:-translate-y-0.5"
            >
              Planea tu próxima comida
              <IconoFlecha
                tam={18}
                className="transition-transform dur-rapida ease-suave group-hover:translate-x-1"
              />
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
