"use client";

/**
 * `BarraProgresoDia` — cuánto del objetivo del día llevas.
 *
 * Trabajo del gráfico: razón contra un límite, con composición. **No suma el
 * 100 %**, así que sí tiene carril, sí tiene marca de objetivo y sí tiene banda
 * de tolerancia (docs/diseno-producto.md §4.3).
 *
 * La decisión importante es la **escala fija**: el carril entero equivale
 * siempre a `objetivo.kcal × 1,25`, de modo que la marca de objetivo cae
 * siempre al 80 % del ancho. Si el carril se escalara al máximo de cada día, la
 * marca bailaría de sitio y habría que leer un número para saber dónde está.
 * Con la posición fija, a los tres días el usuario sabe si su día va bien por
 * dónde llega la cinta, sin leer nada. Ese es el mecanismo por el que el
 * principiante entiende su día sin números.
 *
 * Es componente de cliente sólo por el compás 4 del estado de generación: la
 * barra entra con los anchos del objetivo y se mueve hasta los reales. Es la
 * única barra del producto que crece, y aquí el crecimiento es el mensaje.
 */

import { useEffect, useState } from "react";
import type { ObjetivoNutricional } from "@planeat/shared";

import { etiquetaAccesible, kcalDerivadas, segmentos, type PanelMacros } from "@/lib/nutricion-ui";

import estilos from "./planeat.module.css";

/** El carril entero vale esto por el objetivo. La marca cae en 1/1,25 = 80 %. */
const FACTOR_CARRIL = 1.25;
const POSICION_OBJETIVO = 1 / FACTOR_CARRIL;

interface PropsBarraProgreso {
  panel: PanelMacros;
  objetivo: ObjetivoNutricional;
  conclusion: string;
  alto?: number;
  /**
   * Compás 4: monta con el reparto del objetivo y se mueve a los anchos reales.
   * Sólo en la aparición de un plan recién generado, nunca en una recarga.
   */
  animarCuadre?: boolean;
  className?: string;
}

function repartoDelObjetivo(objetivo: ObjetivoNutricional): PanelMacros {
  const centro = (rango: { min: number; max: number }) => (rango.min + rango.max) / 2;
  return {
    proteinaG: centro(objetivo.proteinaG),
    carbohidratoG: centro(objetivo.carbohidratoG),
    grasaG: centro(objetivo.grasaG),
  };
}

export function BarraProgresoDia({
  panel,
  objetivo,
  conclusion,
  alto = 10,
  animarCuadre = false,
  className,
}: PropsBarraProgreso) {
  const [cuadrada, setCuadrada] = useState(!animarCuadre);

  useEffect(() => {
    if (cuadrada) return;
    // Dos fotogramas: el primero pinta el estado inicial, el segundo dispara
    // la transición. Con uno solo el navegador agrupa los dos estilos y no hay
    // transición que ver.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setCuadrada(true)));
    return () => cancelAnimationFrame(id);
  }, [cuadrada]);

  const partesReales = segmentos(panel);
  const partesObjetivo = segmentos(repartoDelObjetivo(objetivo));
  const partes = cuadrada ? partesReales : partesObjetivo;

  const kcalMostradas = cuadrada ? kcalDerivadas(panel) : objetivo.kcal;
  const techo = objetivo.kcal * FACTOR_CARRIL;
  const razon = techo > 0 ? kcalMostradas / techo : 0;
  const desbordado = razon > 1;
  const anchoRelleno = Math.min(1, razon);

  const tolerancia = objetivo.toleranciaKcal;

  return (
    <div className={className}>
      <div
        role="img"
        aria-label={etiquetaAccesible(panel, conclusion)}
        className={`${estilos.barra} relative w-full bg-surface-3`}
        style={{ height: alto, borderRadius: alto / 2 }}
      >
        {/* Relleno: los tres macros apilados, con el hueco de 2 px. */}
        <div
          className="absolute inset-y-0 left-0 flex overflow-hidden"
          style={{
            width: `${anchoRelleno * 100}%`,
            borderRadius: alto / 2,
            gap: 2,
            opacity: cuadrada ? 1 : 0.25,
            transition: "width var(--dur-cuadre) var(--ease-suave), opacity var(--dur-cuadre) var(--ease-suave)",
          }}
        >
          {partes.map((parte) => (
            <div
              key={parte.clave}
              className={estilos.segmento}
              style={{
                flexGrow: parte.fraccion,
                flexBasis: 0,
                minWidth: parte.fraccion > 0 ? 3 : 0,
                backgroundColor: parte.color,
              }}
            />
          ))}
        </div>

        {/* Banda de tolerancia: dos líneas de 1 px a ±tolerancia de la marca. */}
        {[-1, 1].map((lado) => (
          <span
            key={lado}
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-line-strong"
            style={{ left: `${POSICION_OBJETIVO * (1 + lado * tolerancia) * 100}%` }}
          />
        ))}

        {/* Marca de objetivo: 2 px, con 2 px de superficie a cada lado para no
            fundirse con el relleno. Siempre en el mismo sitio. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 box-border border-x-2 border-surface bg-text-2"
          style={{ left: `calc(${POSICION_OBJETIVO * 100}% - 3px)`, width: 6 }}
        />

        {/* Desbordamiento: el relleno se para en el borde y aparece la punta.
            La palabra correspondiente la pone la capa 1, no este icono. */}
        {desbordado && (
          <span
            aria-hidden="true"
            className="absolute right-0 top-1/2 -translate-y-1/2"
            style={{
              width: 0,
              height: 0,
              borderTop: "5px solid transparent",
              borderBottom: "5px solid transparent",
              borderLeft: "6px solid var(--warning)",
            }}
          />
        )}
      </div>
    </div>
  );
}
