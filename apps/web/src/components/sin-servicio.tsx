"use client";

/**
 * Cuando el fallo es nuestro.
 *
 * Distinto de la sobre-restricción, y a propósito: allí el usuario ha pedido
 * algo que no cabe; aquí no hemos podido ni intentarlo. Lo único que no se hace
 * nunca en esta pantalla es rellenar el hueco con un plan de ejemplo. Un
 * producto de nutrición que enseña números inventados cuando falla el backend
 * pierde lo único que vende.
 *
 * El detalle técnico se muestra, plegado: quien está levantando el servicio en
 * local necesita saber qué ha pasado, y a quien no le interesa no le estorba.
 */

import type { MotivoSinServicio } from "@/lib/tipos";

import { IconoAviso, IconoCambiar } from "./iconos";
import estilos from "./planeat.module.css";

const TEXTOS: Record<MotivoSinServicio, { titular: string; explicacion: string }> = {
  sin_conexion: {
    titular: "No he podido conectar con el motor.",
    explicacion:
      "Tus datos siguen aquí. Si estás en local, el servicio del solver tiene que estar levantado.",
  },
  motor_no_implementado: {
    titular: "El motor todavía no genera planes.",
    explicacion:
      "El servicio responde y el contrato ya es estable, pero las cuatro etapas de generación están sin implementar. Prefiero decírtelo a enseñarte un día inventado.",
  },
  error_solver: {
    titular: "El motor ha fallado al montar tu día.",
    explicacion: "No es cosa de lo que has pedido. Tus datos siguen aquí.",
  },
  tiempo_agotado: {
    titular: "Se me ha hecho largo y lo he parado.",
    explicacion: "Tus datos siguen aquí. A veces el día cuesta más de cuadrar.",
  },
  respuesta_ilegible: {
    titular: "El motor ha contestado algo que no entiendo.",
    explicacion:
      "La respuesta no encaja con el contrato. Es un fallo nuestro, no de lo que has pedido.",
  },
};

interface PropsSinServicio {
  motivo: MotivoSinServicio;
  detalle: string;
  alReintentar?: () => void;
  ocupado?: boolean;
}

export function SinServicio({
  motivo,
  detalle,
  alReintentar,
  ocupado = false,
}: PropsSinServicio) {
  const { titular, explicacion } = TEXTOS[motivo];

  return (
    <section
      className={`${estilos.aparicion} mx-auto w-full max-w-xl rounded-[var(--radius-lg)] border border-line bg-surface p-6 sm:p-8`}
    >
      <p className="flex items-center gap-2 text-warning">
        <IconoAviso tam={20} />
        <span className="text-sm font-semibold">Sin plan</span>
      </p>

      <h2 className="mt-3 text-2xl font-semibold leading-tight tracking-tight">
        {titular}
      </h2>
      <p className="mt-3 text-[17px] leading-relaxed text-text-2">{explicacion}</p>

      {alReintentar && (
        <button
          type="button"
          onClick={alReintentar}
          disabled={ocupado}
          className={`${estilos.pulsable} mt-6 inline-flex min-h-12 items-center gap-2 rounded-[var(--radius)] bg-brand px-5 font-medium text-on-brand hover:bg-brand-hover disabled:opacity-50`}
        >
          <IconoCambiar tam={18} />
          {ocupado ? "Probando otra vez…" : "Volver a intentarlo"}
        </button>
      )}

      <details className="group mt-6">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-text-2 hover:text-text [&::-webkit-details-marker]:hidden">
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
          Ver el detalle técnico
        </summary>
        <p className="pb-2 pl-6 text-sm leading-relaxed text-text-2">{detalle}</p>
      </details>
    </section>
  );
}
