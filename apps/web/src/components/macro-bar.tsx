/**
 * Barra de macronutrientes. **Sustituida. No usar en pantallas nuevas.**
 *
 * Este componente hacía dos gráficos distintos a la vez —un reparto
 * (parte sobre el todo, suma 100 %) y un progreso (razón contra un límite, no
 * suma 100 %)— y por eso no podía hacer bien ninguno de los dos: recibía
 * `objetivoKcal` pero dibujaba un reparto, así que el objetivo acababa
 * degradado a una nota de texto en vez de a una marca en el eje, que es
 * literalmente la razón documentada por la que se eligió barra sobre donut.
 *
 * El análisis completo está en docs/diseno-producto.md §4.1. La sustitución son
 * dos componentes con un trabajo cada uno:
 *
 *   · `components/barra-reparto.tsx`      — el reparto.
 *   · `components/barra-progreso-dia.tsx` — el progreso contra el objetivo.
 *
 * Se conserva porque `/sistema` lo usa como muestra del sistema de diseño y esa
 * página es de otro ámbito. Cuando se actualice, este fichero se borra.
 *
 * Capa 2 de las tres capas de presentación nutricional (docs/spec.md §9.3).
 *
 * Decisiones de diseño, no arbitrarias:
 * · Barra apilada y no donut: permite marcar el objetivo en el eje y funciona
 *   en anchos pequeños. El donut no hace ninguna de las dos cosas.
 * · Sin leyenda separada: las etiquetas van al lado con su color. Si un gráfico
 *   necesita leyenda, ha fallado.
 * · No se oculta en móvil, se compacta. Es justo donde más se consulta.
 */

import type { PanelNutricional } from "@planeat/shared";

interface MacroBarProps {
  panel: Pick<PanelNutricional, "proteinaG" | "carbohidratoG" | "grasaG">;
  /** Si se pasa, se dibuja la marca de objetivo y el texto de desvío. */
  objetivoKcal?: number;
  kcal: number;
  /** `compacta` omite los gramos por macro: para vista semanal densa. */
  variante?: "normal" | "compacta";
}

const MACROS = [
  { clave: "proteinaG", etiqueta: "Proteína", color: "var(--protein)", kcalPorG: 4 },
  { clave: "carbohidratoG", etiqueta: "Carbohidratos", color: "var(--carb)", kcalPorG: 4 },
  { clave: "grasaG", etiqueta: "Grasa", color: "var(--fat)", kcalPorG: 9 },
] as const;

export function MacroBar({
  panel,
  kcal,
  objetivoKcal,
  variante = "normal",
}: MacroBarProps) {
  const segmentos = MACROS.map((m) => {
    const gramos = panel[m.clave];
    return { ...m, gramos, kcal: gramos * m.kcalPorG };
  });

  const kcalTotales = segmentos.reduce((s, x) => s + x.kcal, 0) || 1;

  const desvio =
    objetivoKcal != null ? Math.round(kcal - objetivoKcal) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-text-2">Reparto de macros</span>
        <span className="text-sm tabular-nums text-text" data-numeric>
          <strong className="font-semibold">{Math.round(kcal)}</strong>
          <span className="text-text-3"> kcal</span>
          {desvio !== null && (
            <span
              className={
                Math.abs(desvio) <= objetivoKcal! * 0.03
                  ? "text-text-3"
                  : "text-warning"
              }
            >
              {" · "}
              {desvio > 0 ? "+" : ""}
              {desvio} vs objetivo
            </span>
          )}
        </span>
      </div>

      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="img"
        aria-label={segmentos
          .map((s) => `${s.etiqueta}: ${Math.round(s.gramos)} gramos`)
          .join(". ")}
      >
        {segmentos.map((s) => (
          <div
            key={s.clave}
            style={{
              width: `${(s.kcal / kcalTotales) * 100}%`,
              backgroundColor: s.color,
            }}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {segmentos.map((s) => (
          <div key={s.clave} className="flex items-center gap-1.5 text-sm">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-text-2">{s.etiqueta}</span>
            {variante === "normal" && (
              <span className="tabular-nums font-medium text-text" data-numeric>
                {Math.round(s.gramos)} g
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
