"use client";

/**
 * Estado de generación — «el día se pone la mesa».
 *
 * Es el único momento del producto en que el usuario mira y no puede hacer
 * nada, así que merece un gesto propio, y ese gesto tiene que **informar**, no
 * entretener (docs/diseno-producto.md §3.2 y §5.4).
 *
 * Cuatro decisiones que hay que respetar si se toca esto:
 *
 * 1. **No es un esqueleto genérico.** Es la forma del día del usuario, con los
 *    nombres reales de sus comidas ya escritos. Un esqueleto abstracto dice
 *    "espera"; éste dice "estoy montando *esto*".
 * 2. **No hay barra de porcentaje.** Sería inventada, y el usuario lo detecta
 *    en cuanto se queda clavada en el 80 %. Hay pasos, y sólo se marcan los que
 *    de verdad han ocurrido: el paso 1 lo calcula esta misma interfaz, así que
 *    se marca de verdad; los demás son del motor y no se fingen.
 * 3. **No se monta si la respuesta llega antes de 400 ms.** Un esqueleto que
 *    parpadea es peor que ningún esqueleto. De eso se encarga quien lo usa.
 * 4. **Con `prefers-reduced-motion` no se monta la animación**, no se acelera.
 *    El reset global de `globals.css` convertiría el barrido en bucle en un
 *    parpadeo, que es justo lo que la preferencia intenta evitar.
 */

import { useEffect, useState } from "react";
import type { SlotComida } from "@planeat/shared";

import { useMovimientoReducido } from "@/lib/memoria-plegado";
import { NOMBRE_SLOT } from "@/lib/perfil";

import estilos from "./planeat.module.css";

/** Los cuatro pasos del pipeline real (docs/spec.md §4.2). */
const PASOS = [
  "Calculando tu objetivo del día",
  "Buscando recetas que encajan",
  "Ajustando las raciones",
  "Cuadrando el día",
] as const;

const MS_ESPERA_LARGA = 6_000;

interface PropsEstadoGeneracion {
  slots: SlotComida[];
}

export function EstadoGeneracion({ slots }: PropsEstadoGeneracion) {
  const movimientoReducido = useMovimientoReducido();
  const [esperaLarga, setEsperaLarga] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setEsperaLarga(true), MS_ESPERA_LARGA);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <section
      aria-busy="true"
      className="mx-auto w-full max-w-[420px] rounded-[var(--radius-lg)] bg-surface p-4 sm:p-6"
    >
      {/* La cinta de macros, vacía. Es el sitio exacto donde va a aparecer la
          barra del día: la altura se reserva, no hay salto de layout. */}
      <div className="h-2.5 w-full rounded-full bg-surface-3" />

      {/* Una fila por comida, con la altura exacta de las filas de item que
          vendrán después y el nombre real del slot ya escrito. */}
      <ul className="mt-6 flex flex-col gap-2">
        {slots.map((slot, indice) => (
          <li
            key={slot}
            className={`flex h-[72px] items-center rounded-[var(--radius-sm)] px-3 ${
              movimientoReducido ? "bg-surface-2" : estilos.filaEsqueleto
            }`}
            style={
              movimientoReducido
                ? undefined
                : { animationDelay: `${indice * 140}ms` }
            }
          >
            <span className="text-[15px] font-medium text-text-3">
              {NOMBRE_SLOT[slot]}
            </span>
          </li>
        ))}
      </ul>

      {/* Línea de estado. Es información, no decoración: se anuncia igual con
          movimiento reducido que sin él. */}
      <div role="status" aria-live="polite" className="mt-6">
        <ol className="flex flex-col gap-2">
          {PASOS.map((paso, indice) => {
            const hecho = indice === 0;
            const enCurso = indice === 1;
            return (
              <li
                key={paso}
                className={`flex items-center gap-2 text-sm ${
                  hecho || enCurso ? "text-text-2" : "text-text-3"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`grid size-4 shrink-0 place-items-center rounded-full border ${
                    hecho
                      ? "border-brand bg-brand text-on-brand"
                      : enCurso
                        ? "border-brand"
                        : "border-line-strong"
                  }`}
                >
                  {hecho && (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m5 13 5 5 9-11" />
                    </svg>
                  )}
                </span>
                {paso}
                {hecho && <span className="sr-only">(hecho)</span>}
                {enCurso && <span className="sr-only">(en curso)</span>}
              </li>
            );
          })}
        </ol>

        {esperaLarga && (
          <p className="mt-4 text-sm leading-relaxed text-text-2">
            Sigue en marcha. A veces el día cuesta más de cuadrar.
          </p>
        )}
      </div>
    </section>
  );
}
