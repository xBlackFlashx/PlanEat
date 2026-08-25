"use client";

import { useMemo, useState } from "react";

import type { VistaRecetas } from "@planeat/motor";
import recetasVista from "@planeat/motor/recetas-vista";

import { CampoAutocompletar } from "@/components/campo-autocompletar";
import { IconoCuadra } from "@/components/iconos";
import { ALIMENTOS } from "@/lib/alimentos";
import { recetasQuePuedoHacer } from "@/lib/despensa";
import { minutos as formatearMinutos } from "@/lib/formato";

const vista: VistaRecetas = recetasVista;

const ALIMENTOS_OPCIONES = ALIMENTOS.map((a) => ({ valor: a.id, etiqueta: a.nombre }));

export function DespensaCliente() {
  const [tengo, setTengo] = useState<string[]>([]);
  const [soloCompletas, setSoloCompletas] = useState(false);

  const resultado = useMemo(() => recetasQuePuedoHacer(tengo, vista), [tengo]);
  const visibles = soloCompletas ? resultado.filter((r) => r.cobertura === 1) : resultado;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="voz-1 text-balance">Qué puedo cocinar con esto.</h1>
        <p className="mt-3 text-pretty text-[17px] leading-relaxed text-text-2">
          Dinos qué tienes a la mano y te enseñamos qué recetas del catálogo
          puedes preparar, ordenadas por cuánto ya te falta comprar.
        </p>
      </div>

      <div className="rounded-[var(--radius-lg)] bg-surface p-4 sm:p-6">
        <CampoAutocompletar
          name="tengo"
          etiqueta="Ingredientes que tienes"
          placeholder="Escribe para buscar, por ejemplo «huevo»…"
          opciones={ALIMENTOS_OPCIONES}
          seleccionados={tengo}
          alCambiar={setTengo}
        />

        {tengo.length > 0 && (
          <label className="mt-4 flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-[15px] text-text-2">
            <input
              type="checkbox"
              checked={soloCompletas}
              onChange={(evento) => setSoloCompletas(evento.target.checked)}
              className="size-4 accent-brand"
            />
            Solo lo que puedo hacer ya, sin comprar nada más
          </label>
        )}
      </div>

      {tengo.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] bg-surface p-6 text-[15px] leading-relaxed text-text-2 sm:p-8">
          Aquí aparecerán las recetas que puedes preparar en cuanto elijas qué
          tienes arriba.
        </p>
      ) : visibles.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] bg-surface p-6 text-[15px] leading-relaxed text-text-2 sm:p-8">
          Con exactamente eso todavía no cubres ninguna receta completa.
          Desmarca &quot;solo lo que puedo hacer ya&quot; para ver qué tan
          cerca estás.
        </p>
      ) : (
        <ul role="list" className="flex flex-col gap-3">
          {visibles.map(({ receta, cobertura, faltantes }) => (
            <li
              key={receta.id}
              className="flex items-center gap-3 rounded-[var(--radius-lg)] bg-surface p-3 sm:p-4"
            >
              {receta.imagenUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- ver panel-receta.tsx: sitio estático sin optimizador.
                <img
                  src={receta.imagenUrl}
                  alt=""
                  className="size-14 shrink-0 rounded-[var(--radius-sm)] object-cover sm:size-16"
                  style={{ aspectRatio: "1 / 1" }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="grid size-14 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-surface-2 text-lg font-semibold text-text-2 sm:size-16"
                  style={{ aspectRatio: "1 / 1" }}
                >
                  {receta.titulo.slice(0, 1).toUpperCase()}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p className="text-pretty text-[16px] font-semibold leading-snug">
                  {receta.titulo}
                </p>
                <p className="mt-0.5 text-sm text-text-2">
                  {formatearMinutos(receta.minutos)}
                </p>
              </div>

              {cobertura === 1 ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand">
                  <IconoCuadra tam={14} />
                  Tienes todo
                </span>
              ) : (
                <p className="shrink-0 max-w-[45%] text-right text-sm text-text-2">
                  Te falta: {faltantes.map((i) => i.nombre).join(", ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
