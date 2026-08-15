"use client";

/**
 * La capa 3, plegada, con memoria de uso.
 *
 * `<details>` nativo: trae la semántica, el teclado y el estado abierto/cerrado
 * sin código. Encima se le añade lo único que se personaliza en todo el
 * producto — si queda abierto la próxima vez —, y no se pregunta: se observa
 * (docs/diseno-producto.md §1.4).
 */

import type { ReactNode } from "react";

import { useMemoriaPlegado, type TipoBloquePlegable } from "@/lib/memoria-plegado";

interface PropsDetallePlegable {
  tipo: TipoBloquePlegable;
  resumen: string;
  children: ReactNode;
}

export function DetallePlegable({ tipo, resumen, children }: PropsDetallePlegable) {
  const [abierto, recordar] = useMemoriaPlegado(tipo);

  return (
    <details
      className="group"
      open={abierto}
      onToggle={(evento) => recordar(evento.currentTarget.open)}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-text-2 transition-colors hover:text-text [&::-webkit-details-marker]:hidden">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 transition-transform duration-150 group-open:rotate-90"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
        {resumen}
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  );
}
