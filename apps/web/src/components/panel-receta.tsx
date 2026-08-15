"use client";

/**
 * Ficha de la receta, en panel de nivel 3.
 *
 * **Nunca un modal a pantalla completa** (docs/spec.md §9.4): en escritorio es
 * un panel lateral de 400 px sin velo — el plan sigue visible y legible detrás,
 * que es el punto entero —, y en móvil una hoja inferior con velo.
 *
 * Se usa `<dialog>` nativo por accesibilidad, no por comodidad: trae la trampa
 * de foco, el cierre con `Escape`, el fondo inerte y la devolución del foco al
 * elemento que lo abrió. Reimplementar eso a mano sale siempre peor.
 *
 * La ficha muestra los datos del catálogo escalados a la ración que sirve el
 * plan. Lo que el catálogo no declara aparece como «sin declarar»: en un
 * producto de nutrición, un cero inventado es peor que un hueco.
 */

import { useEffect, useRef } from "react";

import { gramos, kcal as formatearKcal, minutos, racion } from "@/lib/formato";
import { nombreAlergeno } from "@/lib/perfil";
import type { RecetaResumen } from "@/lib/tipos";

import { BarraReparto } from "./barra-reparto";
import { IconoCambiar, IconoCerrar, IconoReloj } from "./iconos";
import estilos from "./planeat.module.css";
import { TablaNutricional } from "./tabla-nutricional";

interface PropsPanelReceta {
  receta: RecetaResumen | null;
  factorRacion: number;
  alCerrar: () => void;
  alCambiarReceta?: (recetaId: string) => void;
}

export function PanelReceta({
  receta,
  factorRacion,
  alCerrar,
  alCambiarReceta,
}: PropsPanelReceta) {
  const dialogo = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const nodo = dialogo.current;
    if (!nodo) return;
    if (receta && !nodo.open) nodo.showModal();
    if (!receta && nodo.open) nodo.close();
  }, [receta]);

  if (!receta) {
    return <dialog ref={dialogo} className={estilos.panel} onClose={alCerrar} />;
  }

  const escalar = (valor: number) => valor * factorRacion;
  const panel = {
    proteinaG: escalar(receta.porRacion.proteinaG),
    carbohidratoG: escalar(receta.porRacion.carbohidratoG),
    grasaG: escalar(receta.porRacion.grasaG),
  };
  // Capa 1 de la ficha: la conclusión antes que los datos.
  const frase = `Esta ración aporta unas ${formatearKcal(
    escalar(receta.porRacion.kcal),
  )} kcal y ${gramos(panel.proteinaG)} g de proteína.`;

  return (
    <dialog
      ref={dialogo}
      className={estilos.panel}
      onClose={alCerrar}
      aria-labelledby="titulo-ficha"
    >
      <div className="flex max-h-[88dvh] flex-col lg:h-dvh lg:max-h-none">
        <header className="flex items-start justify-between gap-3 border-b border-line p-4 sm:p-6">
          <div>
            <h2 id="titulo-ficha" className="text-xl font-semibold tracking-tight">
              {receta.titulo}
            </h2>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-2">
              <span className="inline-flex items-center gap-1.5">
                <IconoReloj tam={16} />
                <span className="tabular-nums" data-numeric>
                  {minutos(receta.minutos)}
                </span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums" data-numeric>
                {racion(factorRacion)}
              </span>
            </p>
          </div>

          <button
            type="button"
            onClick={alCerrar}
            className={`${estilos.pulsable} grid size-11 shrink-0 place-items-center rounded-[var(--radius-sm)] text-text-2 hover:bg-surface-2 hover:text-text`}
          >
            <IconoCerrar />
            <span className="sr-only">Cerrar la ficha</span>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* Capa 1 y capa 2, en el mismo orden que en todas partes. */}
          <p className="text-[15px] leading-snug text-text-2">{frase}</p>
          <BarraReparto panel={panel} conclusion={frase} className="mt-3" />

          <h3 className="mt-8 text-base font-semibold">Ingredientes</h3>
          {receta.ingredientes.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2">
              {receta.ingredientes.map((ingrediente) => (
                <li
                  key={ingrediente}
                  className="border-b border-line pb-2 text-[15px] last:border-0"
                >
                  {ingrediente}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-text-2">
              El catálogo no trae la lista de ingredientes de esta receta.
            </p>
          )}
          <p className="mt-3 text-sm leading-relaxed text-text-2">
            Las cantidades por ingrediente y los pasos de elaboración todavía no
            los expone el servicio: la ficha completa llega con la vista de
            receta.
          </p>

          <h3 className="mt-8 text-base font-semibold">Alérgenos declarados</h3>
          <p className="mt-2 text-[15px]">
            {receta.alergenos.length > 0
              ? receta.alergenos.map(nombreAlergeno).join(", ")
              : "Ninguno de los catorce de declaración obligatoria."}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-text-2">
            Filtramos por los ingredientes declarados en nuestro catálogo. No
            sustituye leer la etiqueta del producto que compres.
          </p>

          <div className="mt-8">
            <TablaNutricional
              encabezadoValor="Esta ración"
              filas={[
                {
                  etiqueta: "Valor energético",
                  valor: receta.conocido.kcal ? escalar(receta.porRacion.kcal) : null,
                  unidad: "kcal",
                },
                {
                  etiqueta: "Grasas",
                  valor: receta.conocido.grasaG ? escalar(receta.porRacion.grasaG) : null,
                  unidad: "g",
                },
                {
                  etiqueta: "Hidratos de carbono",
                  valor: receta.conocido.carbohidratoG
                    ? escalar(receta.porRacion.carbohidratoG)
                    : null,
                  unidad: "g",
                },
                {
                  etiqueta: "Fibra alimentaria",
                  valor: receta.conocido.fibraG ? escalar(receta.porRacion.fibraG) : null,
                  unidad: "g",
                },
                {
                  etiqueta: "Proteínas",
                  valor: receta.conocido.proteinaG
                    ? escalar(receta.porRacion.proteinaG)
                    : null,
                  unidad: "g",
                },
                {
                  etiqueta: "Sal",
                  // Conversión legal sal = sodio × 2,5 (Reg. UE 1169/2011).
                  valor: receta.conocido.sodioMg
                    ? (escalar(receta.porRacion.sodioMg) * 2.5) / 1000
                    : null,
                  unidad: "g",
                },
              ]}
              nota={
                receta.revisadaPor
                  ? `Ficha revisada por ${receta.revisadaPor}.`
                  : "Esta receta todavía no la ha revisado un dietista. Los valores salen del cálculo sobre los ingredientes del catálogo."
              }
            />
          </div>

          {receta.porRacion.fibraG > 0 && (
            <p className="mt-4 text-sm text-text-2">
              Fibra de esta ración:{" "}
              <span className="tabular-nums" data-numeric>
                {gramos(escalar(receta.porRacion.fibraG))} g
              </span>
              .
            </p>
          )}
        </div>

        {alCambiarReceta && (
          <footer className="border-t border-line p-4 sm:p-6">
            <button
              type="button"
              onClick={() => {
                alCambiarReceta(receta.id);
                alCerrar();
              }}
              className={`${estilos.pulsable} flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover`}
            >
              <IconoCambiar tam={18} />
              Cambiar esta receta
            </button>
            <p className="mt-2 text-sm leading-relaxed text-text-2">
              Vuelvo a montar el día entero evitándola. Todavía no puedo cambiar
              una sola comida sin tocar el resto.
            </p>
          </footer>
        )}
      </div>
    </dialog>
  );
}
