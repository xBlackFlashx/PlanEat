"use client";

import { useCallback, useSyncExternalStore } from "react";

type Tema = "light" | "dark";

const EVENTO_CAMBIO = "planeat-theme-change";

/**
 * El tema vive fuera de React: lo escribe el script de `layout.tsx` antes del
 * primer pintado y puede cambiarlo el sistema operativo. `useSyncExternalStore`
 * es la forma correcta de leerlo — mantiene el botón sincronizado sin provocar
 * renders en cascada desde un efecto.
 */
function subscribe(onChange: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  window.addEventListener(EVENTO_CAMBIO, onChange);
  return () => {
    mq.removeEventListener("change", onChange);
    window.removeEventListener(EVENTO_CAMBIO, onChange);
  };
}

function getSnapshot(): Tema {
  const explicito = document.documentElement.dataset.theme as Tema | undefined;
  if (explicito) return explicito;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** En servidor no hay preferencia observable; React resincroniza tras hidratar. */
function getServerSnapshot(): Tema {
  return "light";
}

export function ThemeToggle() {
  const tema = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const alternar = useCallback(() => {
    const siguiente: Tema = tema === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = siguiente;
    try {
      localStorage.setItem("planeat-theme", siguiente);
    } catch {
      // Modo privado o almacenamiento bloqueado: el tema sigue funcionando
      // durante la sesión, sólo no persiste entre visitas.
    }
    window.dispatchEvent(new Event(EVENTO_CAMBIO));
  }, [tema]);

  return (
    <button
      type="button"
      onClick={alternar}
      // `min-h-11` = 44 px: el mínimo táctil de docs/spec.md §9.5. El borde
      // sigue midiendo lo mismo que antes, lo que crece es la zona pulsable.
      className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
      aria-label={
        tema === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"
      }
    >
      {tema === "dark" ? "Claro" : "Oscuro"}
    </button>
  );
}
