"use client";

/**
 * Estado de sobre-restricción. **Pantalla dedicada, no un toast**
 * (docs/spec.md §9.4). Mapea uno a uno con `FalloGeneracion`.
 *
 * Lo más importante de esta pantalla no es su composición: es el tono. El
 * sistema asume la responsabilidad — «no llego», nunca «tus filtros son
 * demasiado restrictivos». El usuario ha pedido algo legítimo; el que no ha
 * podido es el solver. Esa asimetría es una decisión de producto, no una
 * cortesía, y no se cambia sin discutirlo.
 *
 * Y no es un error: es un resultado. Por eso no lleva icono de error, ni rojo
 * de alarma, ni un `role="alert"` que interrumpa.
 */

import type { FalloGeneracion, ObjetivoNutricional } from "@planeat/shared";

import { accionesDeFallo } from "@/lib/acciones-fallo";
import { numero } from "@/lib/formato";
import type { AjustesObjetivo, DatosFormulario } from "@/lib/perfil";

import { IconoFlecha } from "./iconos";
import estilos from "./planeat.module.css";

/** Recetas que hacen falta para montar variedad sin repetir (docs/spec.md §4.2). */
const UMBRAL_VIABILIDAD = 40;

interface PropsSobreRestriccion {
  fallo: FalloGeneracion;
  objetivo: ObjetivoNutricional;
  datos: DatosFormulario;
  totalCatalogo: number | null;
  alAplicar: (ajustes: AjustesObjetivo) => void;
  ocupado?: boolean;
}

export function SobreRestriccion({
  fallo,
  objetivo,
  datos,
  totalCatalogo,
  alAplicar,
  ocupado = false,
}: PropsSobreRestriccion) {
  const { acciones, sugerenciasSoloTexto } = accionesDeFallo(fallo, objetivo, datos);

  return (
    <section
      className={`${estilos.aparicion} mx-auto w-full max-w-xl rounded-[var(--radius-lg)] bg-surface p-6 sm:p-8`}
    >
      <h2 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-3xl">
        Con lo que me has dicho, no llego.
      </h2>

      {/* El texto del motor, tal cual: sale de las variables de holgura del LP
          y explica qué restricción ata. No se reescribe aquí. */}
      <p className="mt-4 text-[17px] leading-relaxed text-text-2">{fallo.mensaje}</p>

      {/* La cifra, con su contexto inmediato debajo. */}
      <div className="mt-8">
        <p className="text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl" data-numeric>
          {numero(fallo.recetasCandidatas)}
        </p>
        <p className="mt-2 text-[15px] leading-relaxed text-text-2">
          {totalCatalogo != null ? (
            <>
              recetas encajan con tus filtros, de {numero(totalCatalogo)} que tengo.
            </>
          ) : (
            <>recetas encajan con tus filtros.</>
          )}{" "}
          Necesito unas {numero(UMBRAL_VIABILIDAD)} para montar variedad sin
          repetir.
        </p>

        {/* Micro-barra de proporción. Un medidor, no un gráfico. Nunca un donut
            de dos porciones: es el anti-patrón canónico. */}
        {totalCatalogo != null && totalCatalogo > 0 && (
          <div
            role="img"
            aria-label={`${numero(fallo.recetasCandidatas)} de ${numero(
              totalCatalogo,
            )} recetas encajan; el umbral está en ${UMBRAL_VIABILIDAD}.`}
            className="relative mt-4 h-1.5 w-[120px] overflow-hidden rounded-full bg-surface-3"
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-warning"
              style={{
                width: `${Math.min(100, (fallo.recetasCandidatas / totalCatalogo) * 100)}%`,
              }}
            />
            <span
              aria-hidden="true"
              className="absolute inset-y-0 w-0.5 bg-text-2"
              style={{
                left: `${Math.min(100, (UMBRAL_VIABILIDAD / totalCatalogo) * 100)}%`,
              }}
            />
          </div>
        )}
      </div>

      {/* Las salidas. Cada botón ejecuta su cambio y vuelve a generar. */}
      <ul className="mt-8 flex flex-col gap-2">
        {acciones.map((accion) => (
          <li key={accion.etiqueta}>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => alAplicar(accion.ajustes)}
              className={`${estilos.pulsable} flex min-h-12 w-full items-center justify-between gap-3 rounded-[var(--radius)] border border-brand-line bg-brand-soft px-4 text-left text-[15px] font-medium text-text hover:border-brand disabled:opacity-50`}
            >
              {accion.etiqueta}
              <IconoFlecha tam={18} />
            </button>
          </li>
        ))}
      </ul>

      {sugerenciasSoloTexto.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-text-2">
            Lo que además me sugiere el motor
          </h3>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-text-2">
            {sugerenciasSoloTexto.map((sugerencia) => (
              <li key={sugerencia}>{sugerencia}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-8 text-sm text-text-2">
        Ninguna de estas opciones se guarda hasta que la elijas.
      </p>
    </section>
  );
}
