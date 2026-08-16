"use client";

/**
 * Memoria de plegado — el sustituto honesto del interruptor
 * "principiante / avanzado" (docs/diseno-producto.md §1.4).
 *
 * Si el usuario abre la tabla nutricional, se queda abierta la próxima vez. No
 * se le pregunta: se observa. Reglas que este módulo respeta:
 *
 * · Es por tipo de bloque, no global.
 * · Vive en `localStorage`, nunca en el perfil: es una preferencia del
 *   navegador, no un dato del usuario.
 * · Sólo afecta a lo que está plegado, jamás a lo que se muestra. Las capas 1
 *   y 2 son inamovibles, así que ningún dato aparece o desaparece por esto.
 * · El servidor siempre lo pinta plegado; el navegador lo abre en cuanto
 *   hidrata si esa era la preferencia.
 *
 * Se usa `useSyncExternalStore` y no `useEffect` porque `localStorage` y
 * `matchMedia` son exactamente eso: estado que vive fuera de React. Sincronizar
 * con `setState` dentro de un efecto provoca un render en cascada y es lo que
 * React 19 desaconseja explícitamente.
 */

import { useCallback, useSyncExternalStore } from "react";

export type TipoBloquePlegable = "tabla-nutricional" | "ficha-receta" | "exclusiones";

const PREFIJO = "planeat-plegado:";

const oyentes = new Set<() => void>();

function avisar() {
  for (const oyente of oyentes) oyente();
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  // Otra pestaña puede cambiar la preferencia: se refleja aquí también.
  window.addEventListener("storage", oyente);
  return () => {
    oyentes.delete(oyente);
    window.removeEventListener("storage", oyente);
  };
}

function leer(tipo: TipoBloquePlegable): boolean {
  try {
    return window.localStorage.getItem(PREFIJO + tipo) === "abierto";
  } catch {
    // Modo privado o almacenamiento bloqueado: se queda plegado y ya está.
    return false;
  }
}

export function useMemoriaPlegado(
  tipo: TipoBloquePlegable,
): [boolean, (abierto: boolean) => void] {
  const abierto = useSyncExternalStore(
    suscribir,
    useCallback(() => leer(tipo), [tipo]),
    () => false,
  );

  const recordar = useCallback(
    (siguiente: boolean) => {
      try {
        window.localStorage.setItem(PREFIJO + tipo, siguiente ? "abierto" : "plegado");
      } catch {
        // Sin persistencia, pero la sesión actual sigue funcionando.
      }
      avisar();
    },
    [tipo],
  );

  return [abierto, recordar];
}

/**
 * `prefers-reduced-motion`, consultado de verdad.
 *
 * El reset global de `globals.css` fija `animation-duration: 0.01 ms`, que
 * sirve para transiciones pero convierte una animación en bucle en un
 * parpadeo — justo el efecto que la preferencia intenta evitar, y un riesgo
 * real para usuarios fotosensibles. Los componentes con movimiento en bucle
 * consultan esto y **no montan** la animación (docs/diseno-producto.md §5.5).
 */
const CONSULTA_MOVIMIENTO = "(prefers-reduced-motion: reduce)";

function suscribirMovimiento(oyente: () => void) {
  const consulta = window.matchMedia(CONSULTA_MOVIMIENTO);
  consulta.addEventListener("change", oyente);
  return () => consulta.removeEventListener("change", oyente);
}

export function useMovimientoReducido(): boolean {
  return useSyncExternalStore(
    suscribirMovimiento,
    () => window.matchMedia(CONSULTA_MOVIMIENTO).matches,
    // En el servidor no hay preferencia que consultar: se asume que sí hay
    // movimiento y el cliente corrige antes de pintar la animación.
    () => false,
  );
}
