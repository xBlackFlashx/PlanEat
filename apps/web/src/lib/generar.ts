"use client";

/**
 * Pedirle un día al motor, desde React.
 *
 * Existe para que la portada y `/plan` pidan el plan exactamente igual. Antes
 * las dos hacían su propio `fetch("/api/plan")` con su propio manejo de errores
 * y sus propios estados, y ya habían empezado a divergir (una traducía el 503,
 * la otra no). Ahora hay un solo camino y una sola política.
 *
 * Lo que este módulo decide, y conviene no deshacer:
 *
 *  - **El objetivo se calcula aquí, no lo trae nadie.** Salía del route handler
 *    porque era lo que impedía pedir un plan con un objetivo arbitrario. Sin
 *    servidor ya no hay nada que proteger —el motor corre en la máquina del
 *    usuario— pero el saneado de los ajustes sigue existiendo: son los límites
 *    de seguridad del producto (800–6000 kcal, 20–400 g de proteína), no una
 *    defensa contra ataques.
 *  - **El progreso es del motor.** `estado-generacion.tsx` marcaba el primer
 *    paso como hecho porque no tenía de dónde sacar la verdad. Ahora la tiene:
 *    las cuatro etapas reales llegan por el worker y se pasan tal cual.
 *  - **Nunca lanza.** Todo lo que puede salir mal sale como un `ResultadoPlan`.
 *    Una excepción aquí dejaría la pantalla de generación girando para siempre.
 */

import { useCallback, useRef, useState } from "react";
import type { ObjetivoNutricional } from "@planeat/shared";

import {
  aplicarAjustes,
  calcularObjetivoDelDia,
  construirSolicitud,
  type AjustesObjetivo,
  type DatosFormulario,
} from "./perfil";
import { aResultadoDeVista, clienteMotor } from "./solver";
import type { Progreso } from "./solver";
import type { ResultadoPlan } from "./tipos";

/**
 * Saneado de los ajustes que acepta el usuario en la pantalla de
 * sobre-restricción. Port literal de `comoAjustes` del route handler borrado.
 *
 * Los rangos son los límites de seguridad del producto: por debajo de 800 kcal
 * o por encima de 6000 no hay un plan que enseñar, hay un problema médico.
 */
export function sanearAjustes(bruto: AjustesObjetivo): AjustesObjetivo {
  const ajustes: AjustesObjetivo = {};

  if (bruto.kcal !== undefined && Number.isFinite(bruto.kcal) && bruto.kcal >= 800 && bruto.kcal <= 6000) {
    ajustes.kcal = Math.round(bruto.kcal);
  }

  const proteina = bruto.proteinaMaxG;
  if (proteina !== undefined && Number.isFinite(proteina) && proteina >= 20 && proteina <= 400) {
    ajustes.proteinaMaxG = Math.round(proteina);
  }

  if (bruto.dieta !== undefined) ajustes.dieta = bruto.dieta;
  if (bruto.sinMinimoFibra === true) ajustes.sinMinimoFibra = true;

  return ajustes;
}

/** Lo que se le puede pedir a una generación concreta. */
export interface PeticionPlan {
  datos: DatosFormulario;
  /** Recetas a penalizar por repetición, de más reciente a más antigua. */
  recetasRecientes?: string[];
  ajustes?: AjustesObjetivo;
  /** Semilla en decimal. Con ella, el mismo plan sale otra vez igual. */
  seed?: string;
}

export interface PlanGenerado {
  resultado: ResultadoPlan;
  /**
   * El objetivo **con los ajustes ya aplicados**. Vuelve junto al resultado
   * porque la pantalla de sobre-restricción calcula sus tres salidas sobre lo
   * último que se ha pedido: si le diéramos el cálculo original, la segunda vez
   * propondría lo mismo que la primera.
   */
  objetivo: ObjetivoNutricional;
}

/** Pide un día. Nunca lanza. */
export async function pedirPlan(
  peticion: PeticionPlan,
  alAvanzar?: (progreso: Progreso) => void,
): Promise<PlanGenerado> {
  const ajustes = sanearAjustes(peticion.ajustes ?? {});
  const objetivo = aplicarAjustes(calcularObjetivoDelDia(peticion.datos).objetivo, ajustes);
  const solicitud = construirSolicitud(peticion.datos, {
    recetasRecientes: peticion.recetasRecientes ?? [],
    ajustes,
  });

  const resultado = await clienteMotor().generar(solicitud, alAvanzar, {
    seed: peticion.seed,
  });

  return { resultado: aResultadoDeVista(resultado), objetivo };
}

// ---------------------------------------------------------------------------
// El gancho
// ---------------------------------------------------------------------------

/** Por debajo de esto no se monta el esqueleto: parpadearía. */
export const MS_ANTES_DEL_ESQUELETO = 400;

export interface EstadoGeneracionPlan {
  generando: boolean;
  /** Cierto sólo cuando la espera ha pasado de `MS_ANTES_DEL_ESQUELETO`. */
  mostrarEsqueleto: boolean;
  /** La última etapa que el motor ha comunicado. `null` antes de la primera. */
  progreso: Progreso | null;
  generar: (peticion: PeticionPlan) => Promise<PlanGenerado>;
}

/**
 * Estado de una generación en curso: si está en marcha, si toca enseñar el
 * esqueleto y por dónde va el motor.
 *
 * No guarda el resultado a propósito. Quien llama ya tiene su propia máquina de
 * estados alrededor del plan (fases, deshacer, aviso) y meterle otra aquí
 * dentro obligaría a sincronizar dos.
 */
export function useGeneracion(): EstadoGeneracionPlan {
  const [generando, setGenerando] = useState(false);
  const [mostrarEsqueleto, setMostrarEsqueleto] = useState(false);
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const temporizador = useRef<number | null>(null);

  /**
   * Los títulos sobreviven a las etapas que no los traen.
   *
   * `Progreso.titulos` sólo viaja cuando el motor cierra un día; las etapas
   * posteriores (`cuadre`) llegan sin ellos. Guardando el mensaje tal cual, el
   * compás 3 de la coreografía —las filas del esqueleto convirtiéndose en los
   * platos reales, `docs/diseno-producto.md` §5.4— se perdía justo en el caso
   * intermedio: motor rápido, pero ensamblado y serialización lentos. Cuando el
   * esqueleto por fin montaba a los 400 ms, el último mensaje ya era `cuadre` y
   * las filas salían sin nombre.
   *
   * Se arrastra el último `titulos` no vacío en vez de acumularlos todos: lo que
   * la pantalla enseña es el día en curso, no el histórico.
   */
  const acumularProgreso = useCallback((nuevo: Progreso) => {
    setProgreso((anterior) =>
      nuevo.titulos?.length || !anterior?.titulos?.length
        ? nuevo
        : { ...nuevo, titulos: anterior.titulos },
    );
  }, []);

  const generar = useCallback(async (peticion: PeticionPlan): Promise<PlanGenerado> => {
    // El temporizador anterior se cancela ANTES de armar el nuevo. Pedir un
    // plan mientras hay otro en vuelo cancela el primero, y la promesa de una
    // generación cancelada **no se resuelve nunca** (así lo documenta
    // `ClienteMotor.cancelar`): su `finally` no llega a correr, así que su
    // temporizador quedaría suelto y montaría el esqueleto 400 ms después de
    // que todo hubiera terminado, sin nada que lo volviera a quitar.
    if (temporizador.current !== null) window.clearTimeout(temporizador.current);

    setGenerando(true);
    setProgreso(null);
    temporizador.current = window.setTimeout(
      () => setMostrarEsqueleto(true),
      MS_ANTES_DEL_ESQUELETO,
    );

    try {
      return await pedirPlan(peticion, acumularProgreso);
    } finally {
      if (temporizador.current !== null) window.clearTimeout(temporizador.current);
      temporizador.current = null;
      setMostrarEsqueleto(false);
      setGenerando(false);
    }
  }, [acumularProgreso]);

  return { generando, mostrarEsqueleto, progreso, generar };
}
