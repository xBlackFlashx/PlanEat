"use client";

/**
 * La parte de `/plan` que depende de la query, y por tanto del navegador.
 *
 * Con `output: "export"` no hay petición de la que leer la query en tiempo de
 * render: el HTML se genera una sola vez en el build y es el mismo para todos.
 * Así que la query se lee aquí, con `useSearchParams()`, y el plan se genera
 * aquí, con el motor dentro de un Web Worker.
 *
 * Dos decisiones de producto que sobreviven al port intactas:
 *
 * · **La URL es el estado.** El perfil viaja en la query y el enlace se puede
 *   compartir. Lo nuevo es el `seed`: en cuanto hay plan se escribe en la
 *   dirección, y con él el enlace deja de devolver «un día parecido» para
 *   devolver **ese** día. Se escribe con `replaceState` y no navegando, porque
 *   añadir una entrada al historial por cada plan convertiría el botón «atrás»
 *   en una ruleta.
 * · **Si el motor no puede, se dice.** `pedirPlan` nunca lanza: los tres
 *   desenlaces salen como `ResultadoPlan` y cada uno tiene su pantalla. Aquí no
 *   hay ningún camino que acabe en un plan de relleno.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ObjetivoNutricional } from "@planeat/shared";

import { EstadoGeneracion } from "@/components/estado-generacion";
import { VistaPlan } from "@/components/vista-plan";
import { fechaLarga } from "@/lib/formato";
import { useGeneracion } from "@/lib/generar";
import {
  aParametros,
  calcularObjetivoDelDia,
  hayErrores,
  leerFormulario,
  slotsDe,
  validar,
} from "@/lib/perfil";
import type { ResultadoPlan } from "@/lib/tipos";

/** Resultado y objetivo van juntos: el segundo explica el primero. */
interface Generado {
  resultado: ResultadoPlan;
  objetivo: ObjetivoNutricional;
}

export function PlanCliente() {
  const parametros = useSearchParams();
  // La query como cadena: es lo único estable de `useSearchParams` entre
  // renders, y sirve de clave para no rehacer el trabajo derivado.
  const consulta = parametros.toString();

  const datos = useMemo(
    () => leerFormulario(Object.fromEntries(new URLSearchParams(consulta))),
    [consulta],
  );
  const errores = useMemo(() => validar(datos), [datos]);

  /**
   * El perfil, normalizado, sin el `seed`. Es lo que decide si hay que volver a
   * generar: escribir la semilla en la URL cambia `consulta` pero no cambia lo
   * que el usuario ha pedido, y regenerar por eso sería un bucle.
   */
  const clavePerfil = useMemo(() => aParametros(datos).toString(), [datos]);
  const semillaPedida = parametros.get("seed") ?? undefined;

  const [generado, setGenerado] = useState<Generado | null>(null);
  const { progreso, generar } = useGeneracion();

  /** Último perfil para el que ya se ha lanzado una generación. */
  const lanzadoPara = useRef<string | null>(null);

  useEffect(() => {
    if (hayErrores(errores)) return;
    if (lanzadoPara.current === clavePerfil) return;
    lanzadoPara.current = clavePerfil;

    // Sin bandera de cancelación a propósito: el cliente del motor admite una
    // sola generación en vuelo y, al sustituirla, la promesa de la anterior
    // **no se resuelve nunca** (así lo documenta `ClienteMotor.cancelar`). No
    // hay resultado obsoleto contra el que defenderse.
    void generar({ datos, seed: semillaPedida }).then((nuevo) => {
      setGenerado(nuevo);
      if (nuevo.resultado.estado === "ok") publicarSemilla(nuevo.resultado.seed);
    });
  }, [clavePerfil, datos, errores, generar, semillaPedida]);

  if (hayErrores(errores)) {
    return (
      <section className="mx-auto max-w-xl rounded-[var(--radius-lg)] bg-surface p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Me falta algún dato para montar el día.
        </h1>
        <ul className="mt-4 flex flex-col gap-2">
          {Object.entries(errores).map(([campo, mensaje]) => (
            <li key={campo} className="text-[15px] leading-snug text-danger">
              {mensaje}
            </li>
          ))}
        </ul>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-12 items-center rounded-[var(--radius)] bg-brand px-5 font-medium text-on-brand hover:bg-brand-hover"
        >
          Volver al generador
        </Link>
      </section>
    );
  }

  // Mientras no haya nada que enseñar, se enseña el día montándose. Aquí sí se
  // monta desde el primer instante y sin el retardo de 400 ms de la portada:
  // esta pantalla llega vacía, así que no hay nada que pueda parpadear.
  if (generado === null) {
    // El objetivo de la cinta sale del perfil, no del resultado: durante la
    // espera todavía no hay resultado, y es justo ese objetivo el que el
    // motor está persiguiendo.
    return (
      <EstadoGeneracion
        slots={slotsDe(datos)}
        progreso={progreso}
        objetivo={calcularObjetivoDelDia(datos).objetivo}
      />
    );
  }

  return (
    <>
      <h1 className="sr-only">
        Tu día
        {generado.resultado.estado === "ok" && generado.resultado.dias[0]
          ? `: ${fechaLarga(generado.resultado.dias[0].fecha)}`
          : ""}
      </h1>
      {/* A partir de aquí manda `VistaPlan`: las regeneraciones («otro día»,
          «cambiar receta») son suyas, con su propio esqueleto y su deshacer. */}
      <VistaPlan
        datos={datos}
        resultado={generado.resultado}
        objetivo={generado.objetivo}
        animarCuadre
        alGenerar={publicarSemilla}
      />
    </>
  );
}

/**
 * Deja la semilla del plan en la barra de direcciones.
 *
 * `replaceState` en vez de `router.replace`: no queremos ni una entrada más en
 * el historial ni un re-render del árbol de rutas por escribir un parámetro que
 * describe lo que ya se está viendo.
 */
function publicarSemilla(seed: string): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get("seed") === seed) return;
  url.searchParams.set("seed", seed);
  window.history.replaceState(null, "", url);
}
