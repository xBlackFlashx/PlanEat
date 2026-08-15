/**
 * Las tres capas, montadas.
 *
 * No son tres vistas ni tres modos: son **tres alturas del mismo bloque**,
 * siempre en el mismo orden — conclusión → visual → referencia. El principiante
 * lee la primera línea y ha terminado; el avanzado sigue bajando. Nadie
 * configura nada y nadie ve una pantalla distinta (docs/diseno-producto.md §1).
 *
 * El orden vertical no cambia jamás, ni aquí ni en ningún otro sitio del
 * producto donde haya un dato nutricional.
 */

import type { ObjetivoNutricional, PanelNutricional } from "@planeat/shared";

import { gramos, kcal as formatearKcal, numero } from "@/lib/formato";
import {
  MACROS,
  calcularVeredicto,
  fraseDeLaComida,
  fraseDelDia,
  segmentos,
} from "@/lib/nutricion-ui";

import { BarraProgresoDia } from "./barra-progreso-dia";
import { BarraReparto } from "./barra-reparto";
import { DetallePlegable } from "./detalle-plegable";
import { TablaNutricional, type FilaNutricional } from "./tabla-nutricional";
import { SelloVeredicto } from "./veredicto";

// ---------------------------------------------------------------------------
// Bloque del día
// ---------------------------------------------------------------------------

interface PropsBloqueDia {
  totales: PanelNutricional;
  objetivo: ObjetivoNutricional;
  /** Compás 4 del estado de generación. Sólo en el plan recién generado. */
  animarCuadre?: boolean;
  /** En la cabecera compacta se ocultan frase y etiquetas, no el dato. */
  compacto?: boolean;
}

export function BloqueNutricionalDia({
  totales,
  objetivo,
  animarCuadre = false,
  compacto = false,
}: PropsBloqueDia) {
  const veredicto = calcularVeredicto(totales, objetivo);
  const frase = fraseDelDia(totales, objetivo, veredicto);
  const partes = segmentos(totales);

  return (
    <div className="flex flex-col gap-3">
      {/* Capa 1 — la conclusión. Primero, siempre. */}
      <SelloVeredicto veredicto={veredicto} />
      {!compacto && <p className="text-[15px] leading-snug text-text-2">{frase}</p>}

      {/* Capa 2 — el dato, sin chrome: sin ejes, sin cuadrícula, sin leyenda. */}
      <BarraProgresoDia
        panel={totales}
        objetivo={objetivo}
        conclusion={frase}
        alto={compacto ? 6 : 10}
        animarCuadre={animarCuadre}
      />

      {!compacto && (
        <>
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
            {partes.map((parte) => {
              const rango = parte.rango(objetivo);
              return (
                <li key={parte.clave} className="flex items-center gap-1.5 text-[13px]">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: parte.color }}
                  />
                  <span className="text-text-2">{parte.etiqueta}</span>
                  <span className="font-semibold tabular-nums text-text" data-numeric>
                    {gramos(parte.gramos)}
                    <span className="font-normal text-text-3"> g</span>
                  </span>
                  {/* El rango es una cifra nutricional, no una unidad: va en
                      `--text-2`. `--text-3` no llega a AAA y docs/spec.md §9.5
                      pide AAA justo en las cifras nutricionales. */}
                  <span className="tabular-nums text-text-2" data-numeric>
                    de {gramos(rango.min)}–{gramos(rango.max)}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Capa 3 — la referencia. Plegada, a un tap, con memoria. */}
          <DetallePlegable tipo="tabla-nutricional" resumen="Ver tabla nutricional">
            <TablaNutricional
              encabezadoValor="Este día"
              encabezadoReferencia="Tu objetivo"
              filas={filasDelDia(totales, objetivo)}
              nota="Orden del Reglamento (UE) 1169/2011. Los valores del día son la suma de las raciones servidas. El catálogo semilla no declara todavía grasas saturadas, azúcares ni sal por receta: por eso figuran como sin declarar en lugar de como cero."
            />
          </DetallePlegable>
        </>
      )}
    </div>
  );
}

function filasDelDia(
  totales: PanelNutricional,
  objetivo: ObjetivoNutricional,
): FilaNutricional[] {
  const rango = (clave: "proteinaG" | "carbohidratoG" | "grasaG") => {
    const macro = MACROS.find((m) => m.clave === clave)!;
    const r = macro.rango(objetivo);
    return `${gramos(r.min)}–${gramos(r.max)} g`;
  };

  return [
    {
      etiqueta: "Valor energético",
      valor: totales.kcal,
      unidad: "kcal",
      referencia: `${formatearKcal(objetivo.kcal)} kcal ±${numero(objetivo.toleranciaKcal * 100)} %`,
    },
    { etiqueta: "Grasas", valor: totales.grasaG, unidad: "g", referencia: rango("grasaG") },
    {
      etiqueta: "de las cuales saturadas",
      valor: totales.grasaSaturadaG ?? null,
      unidad: "g",
      sangrada: true,
    },
    {
      etiqueta: "Hidratos de carbono",
      valor: totales.carbohidratoG,
      unidad: "g",
      referencia: rango("carbohidratoG"),
    },
    {
      etiqueta: "de los cuales azúcares",
      valor: totales.azucaresG ?? null,
      unidad: "g",
      sangrada: true,
    },
    {
      etiqueta: "Fibra alimentaria",
      valor: totales.fibraG ?? null,
      unidad: "g",
      referencia: `${gramos(objetivo.fibraMinG)} g mínimo`,
    },
    {
      etiqueta: "Proteínas",
      valor: totales.proteinaG,
      unidad: "g",
      referencia: rango("proteinaG"),
    },
    { etiqueta: "Sal", valor: totales.salG ?? null, unidad: "g" },
  ];
}

// ---------------------------------------------------------------------------
// Bloque de una comida
// ---------------------------------------------------------------------------

interface PropsBloqueComida {
  totales: PanelNutricional;
  kcalDelDia: number;
}

/**
 * En una comida la capa 2 es un **reparto**, no un progreso: una comida suelta
 * no se compara con el objetivo del día, se lee. La comparación contra el
 * objetivo vive en la cabecera, una sola vez.
 */
export function BloqueNutricionalComida({ totales, kcalDelDia }: PropsBloqueComida) {
  const frase = fraseDeLaComida(totales, kcalDelDia);

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm leading-snug text-text-2">{frase}</p>
      <BarraReparto panel={totales} conclusion={frase} altura="normal" />
    </div>
  );
}
