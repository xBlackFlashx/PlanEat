/**
 * `DiaReal` — la prueba, no la promesa.
 *
 * Sección de portada, debajo del generador. Enseña un desayuno, una comida y
 * una cena reales del catálogo (`recetasVista.total` recetas) —no una
 * maqueta ni datos de ejemplo inventados— y la misma barra de progreso que ve
 * quien genera un plan de verdad, con el perfil por defecto del formulario
 * (`FORMULARIO_POR_DEFECTO`). La frase de capa 1 sale de `fraseDelDia`, la
 * misma función que usa el resultado real: no hay una segunda copia de la
 * lógica de veredicto escrita a mano para el marketing.
 *
 * Es componente de servidor: el catálogo entra como JSON al bundle (igual que
 * en `lib/solver.ts`) y no hace falta el motor ni el worker para sumar tres
 * paneles y compararlos con un objetivo.
 */

import type { SlotComida } from "@planeat/shared";
import type { VistaRecetas } from "@planeat/motor";
import recetasVista from "@planeat/motor/recetas-vista";

import { kcal, minutos } from "@/lib/formato";
import { calcularVeredicto, fraseDelDia, sumarPaneles } from "@/lib/nutricion-ui";
import { calcularObjetivoDelDia, FORMULARIO_POR_DEFECTO, NOMBRE_SLOT } from "@/lib/perfil";

import { BarraProgresoDia } from "./barra-progreso-dia";
import { BarraReparto } from "./barra-reparto";
import { IconoReloj } from "./iconos";
import estilos from "./planeat.module.css";

const vista: VistaRecetas = recetasVista;

/** Un desayuno, una comida y una cena reales del catálogo. Fijas a propósito:
 * es la misma prueba para todo el mundo, no una tirada aleatoria en cada
 * visita. */
const TARJETAS: { slot: SlotComida; id: string }[] = [
  { slot: "desayuno", id: "avena_yogur_arandanos" },
  { slot: "comida", id: "curry_garbanzos" },
  { slot: "cena", id: "pollo_arroz_brocoli" },
];

export function DiaReal() {
  const recetas = TARJETAS.map((t) => ({ ...t, receta: vista.recetas[t.id] })).filter(
    (t): t is { slot: SlotComida; id: string; receta: NonNullable<(typeof vista.recetas)[string]> } =>
      t.receta != null,
  );

  // Si el catálogo compilado cambiara de ids sin actualizar esto, la sección
  // desaparece en vez de enseñar una tarjeta a medias.
  if (recetas.length !== TARJETAS.length) return null;

  const totales = sumarPaneles(recetas.map((r) => r.receta.porRacion));
  const { objetivo } = calcularObjetivoDelDia(FORMULARIO_POR_DEFECTO);
  const veredicto = calcularVeredicto(totales, objetivo);
  const frase = fraseDelDia(totales, objetivo, veredicto);

  return (
    <section className="mx-auto mt-16 w-full max-w-[1120px] border-t border-line pt-10 sm:mt-24">
      <h2 className="t-1">Un día real, no una maqueta</h2>
      <p className="mt-3 max-w-2xl text-pretty leading-relaxed text-text-2">
        Estas tres recetas y esta barra de progreso son un desayuno, una
        comida y una cena reales, sacadas del mismo catálogo de {vista.total}{" "}
        recetas que usa el generador, con sus minutos y sus gramos ya
        calculados. No es una ilustración de lo que podría salir: es lo que
        sale.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {recetas.map(({ slot, receta }) => (
          <article
            key={receta.id}
            className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface"
          >
            {/* Foto real de Pexels, la misma que ve quien genera un plan de
                verdad (panel-receta.tsx) — refuerza "no es una ilustración"
                con una imagen real, no sólo con la frase. `aspect-ratio`
                fijo aunque `imagenUrl` pudiera faltar: evita CLS. */}
            <div className="relative">
              {receta.imagenUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={receta.imagenUrl}
                  alt={receta.titulo}
                  className={estilos.fotoFicha}
                  loading="lazy"
                />
              ) : (
                <div className={`${estilos.fotoFicha} bg-surface-2`} />
              )}
              <span className="absolute left-3 top-3 rounded-full bg-energia px-2.5 py-1 text-xs font-semibold text-on-energia">
                Foto real
              </span>
            </div>

            <div className="p-5 sm:p-6">
              <p className="micro text-text-3">{NOMBRE_SLOT[slot]}</p>
              <h3 className="t-3 mt-1.5 text-pretty">{receta.titulo}</h3>

              <p className="mt-2 flex items-center gap-1.5 text-sm text-text-2">
                <IconoReloj tam={14} />
                <span className="tabular-nums" data-numeric>
                  {minutos(receta.minutos)}
                </span>
              </p>

              <p className="cifra-heroe mt-4 text-text">
                {kcal(receta.porRacion.kcal)}
                <span className="ml-1.5 text-base font-normal text-text-3">
                  kcal
                </span>
              </p>

              <BarraReparto
                panel={receta.porRacion}
                conclusion={`${receta.titulo}, ${kcal(receta.porRacion.kcal)} kcal por ración`}
                altura="cinta"
                etiquetas={false}
                className="mt-4"
              />
            </div>
          </article>
        ))}
      </div>

      <div className="mt-4 rounded-[var(--radius-lg)] border border-line bg-surface-2 p-5 sm:p-6">
        <p className="t-3">Cómo va el día</p>
        <p className="mt-2 text-pretty leading-relaxed text-text-2">{frase}</p>
        <BarraProgresoDia
          panel={totales}
          objetivo={objetivo}
          conclusion={frase}
          alto={12}
          className="mt-4"
        />
        <p className="mt-3 text-sm leading-relaxed text-text-2">
          Ejemplo calculado con el perfil por defecto: mujer, 32 años,
          actividad ligera, mantener peso. Con tus datos, las cifras cambian.
        </p>
      </div>
    </section>
  );
}
