"use client";

/**
 * El plan y sus tres desenlaces, en un solo sitio.
 *
 * Existe para que la portada y la página `/plan` se comporten exactamente
 * igual: mismo plan, mismo estado de sobre-restricción, mismo mensaje cuando el
 * motor no está, y las mismas acciones. Dos implementaciones divergirían en la
 * segunda semana.
 *
 * Aquí vive también la única política de reintento del producto: cambiar una
 * receta o pedir otro día es volver a pedirle el día al motor penalizando lo
 * que ya se ha visto. Mientras el contrato no admita fijar comidas, esto es lo
 * que se puede hacer sin mentir, y la interfaz lo dice con esas palabras.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ObjetivoNutricional } from "@planeat/shared";

import { aParametros, slotsDe } from "@/lib/perfil";
import type { AjustesObjetivo, DatosFormulario } from "@/lib/perfil";
import type { ResultadoPlan } from "@/lib/tipos";

import { EstadoGeneracion } from "./estado-generacion";
import { PlanDia } from "./plan-dia";
import { SinServicio } from "./sin-servicio";
import { SobreRestriccion } from "./sobre-restriccion";
import estilos from "./planeat.module.css";

/** Por debajo de esto no se monta esqueleto: parpadearía. */
const MS_ANTES_DEL_ESQUELETO = 400;

interface PropsVistaPlan {
  datos: DatosFormulario;
  resultado: ResultadoPlan;
  objetivo: ObjetivoNutricional;
  /** Compás 4: sólo cuando el plan acaba de generarse ante los ojos del usuario. */
  animarCuadre?: boolean;
}

export function VistaPlan({
  datos,
  resultado: resultadoInicial,
  objetivo: objetivoInicial,
  animarCuadre = false,
}: PropsVistaPlan) {
  const [resultado, setResultado] = useState(resultadoInicial);
  const [objetivo, setObjetivo] = useState(objetivoInicial);
  const [regenerando, setRegenerando] = useState(false);
  const [mostrarEsqueleto, setMostrarEsqueleto] = useState(false);
  const [aviso, setAviso] = useState("");
  const [recienGenerado, setRecienGenerado] = useState(animarCuadre);
  /** El día anterior, para poder deshacer. Nada generado es inmutable. */
  const [anterior, setAnterior] = useState<ResultadoPlan | null>(null);

  // Lo ya visto se penaliza por repetición en la siguiente petición.
  const vistas = useRef<string[]>([]);
  const ajustesAcumulados = useRef<AjustesObjetivo>({});

  const pedirPlan = useCallback(
    async (opciones: {
      evitar?: string;
      ajustes?: AjustesObjetivo;
      mensaje?: string;
    }) => {
      if (opciones.evitar) {
        vistas.current = [
          opciones.evitar,
          ...vistas.current.filter((id) => id !== opciones.evitar),
        ].slice(0, 30);
      }
      if (opciones.ajustes) {
        ajustesAcumulados.current = { ...ajustesAcumulados.current, ...opciones.ajustes };
      }

      setRegenerando(true);
      setAviso("Montando tu día.");
      const temporizador = window.setTimeout(
        () => setMostrarEsqueleto(true),
        MS_ANTES_DEL_ESQUELETO,
      );

      try {
        const respuesta = await fetch("/api/plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            campos: Object.fromEntries(aParametros(datos)),
            recetasRecientes: vistas.current,
            ajustes: ajustesAcumulados.current,
          }),
        });

        const cuerpo = (await respuesta.json()) as {
          resultado?: ResultadoPlan;
          objetivo?: ObjetivoNutricional;
        };

        if (cuerpo.resultado) {
          // Sólo se puede deshacer hacia un día que existió de verdad.
          setAnterior(resultado.estado === "ok" ? resultado : null);
          setResultado(cuerpo.resultado);
          setRecienGenerado(true);
          if (cuerpo.objetivo) setObjetivo(cuerpo.objetivo);
          setAviso(
            cuerpo.resultado.estado === "ok"
              ? opciones.mensaje ?? "Listo, tienes otro día."
              : "No he podido montar el día.",
          );
        } else {
          setResultado({
            estado: "sin_servicio",
            motivo: "respuesta_ilegible",
            detalle: `El proxy ha devuelto un ${respuesta.status} sin resultado.`,
          });
          setAviso("No he podido montar el día.");
        }
      } catch {
        setResultado({
          estado: "sin_servicio",
          motivo: "sin_conexion",
          detalle: "La petición al proxy no ha llegado a salir del navegador.",
        });
        setAviso("No he podido conectar.");
      } finally {
        window.clearTimeout(temporizador);
        setMostrarEsqueleto(false);
        setRegenerando(false);
      }
    },
    [datos, resultado],
  );

  // El aviso se retira solo: 7 s cuando lleva [Deshacer], 5 s cuando no.
  useEffect(() => {
    if (!aviso) return;
    const id = window.setTimeout(() => setAviso(""), anterior ? 7000 : 5000);
    return () => window.clearTimeout(id);
  }, [aviso, anterior]);

  return (
    <div>
      {/* Región viva permanente: existe siempre en el DOM para que el lector de
          pantalla anuncie el cambio, y nunca roba el foco. */}
      <div role="status" aria-live="polite">
        {aviso && (
          <div
            className={`${estilos.aparicion} fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md items-center justify-between gap-4 rounded-[var(--radius)] border border-line bg-surface p-3 pl-4 shadow-[var(--shadow-pop)]`}
          >
            <p className="text-sm leading-snug text-text">{aviso}</p>
            {anterior && (
              <button
                type="button"
                onClick={() => {
                  setResultado(anterior);
                  setAnterior(null);
                  setAviso("Deshecho. Tienes el día de antes.");
                }}
                className={`${estilos.pulsable} inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-sm)] px-3 text-sm font-semibold text-brand hover:bg-brand-soft`}
              >
                Deshacer
              </button>
            )}
          </div>
        )}
      </div>

      {mostrarEsqueleto ? (
        <EstadoGeneracion slots={slotsDe(datos)} />
      ) : resultado.estado === "ok" ? (
        <div className={estilos.aparicion}>
          {resultado.dias.map((dia, indice) => (
            <PlanDia
              key={dia.fecha || indice}
              dia={dia}
              recetas={resultado.recetas}
              catalogoDisponible={resultado.catalogoDisponible}
              animarCuadre={recienGenerado}
              regenerando={regenerando}
              alCambiarReceta={(recetaId) =>
                pedirPlan({
                  evitar: recetaId,
                  mensaje: "He vuelto a montar el día evitando esa receta.",
                })
              }
              alPedirOtroDia={() => pedirPlan({ mensaje: "Listo, tienes otro día." })}
            />
          ))}

          {!resultado.catalogoDisponible && (
            <p className="mt-6 rounded-[var(--radius)] border border-line bg-surface-2 p-4 text-sm leading-relaxed text-text-2">
              El plan es real, pero no he podido leer el catálogo de recetas, así
              que faltan los títulos y los tiempos. Los totales que ves los ha
              calculado el motor.
            </p>
          )}
        </div>
      ) : resultado.estado === "sobre_restriccion" ? (
        <SobreRestriccion
          fallo={resultado.fallo}
          objetivo={objetivo}
          datos={datos}
          totalCatalogo={resultado.totalCatalogo}
          ocupado={regenerando}
          alAplicar={(ajustes) =>
            pedirPlan({ ajustes, mensaje: "Vuelvo a intentarlo con ese cambio." })
          }
        />
      ) : (
        <SinServicio
          motivo={resultado.motivo}
          detalle={resultado.detalle}
          ocupado={regenerando}
          alReintentar={() => pedirPlan({})}
        />
      )}
    </div>
  );
}
