"use client";

/**
 * Campo de texto con sugerencias en vivo y selección múltiple en chips.
 *
 * Sustituye a la rejilla de casillas de `CampoChips` para los dos catálogos
 * que ya no caben cómodos en pantalla sin buscar (alérgenos son pocos, pero
 * el listado de alimentos son más de cien): escribir "toma" y ver aparecer
 * "Tomate" y "Tomate triturado" es más rápido que rastrear una cuadrícula.
 *
 * Sigue siendo un formulario de verdad (docs de `generador.tsx`): cada
 * seleccionado se serializa como `<input type="hidden" name={name}>`, así que
 * el envío por GET sin JavaScript sigue llevando la exclusión completa. Lo
 * único que este componente necesita de JavaScript es el propio filtrado en
 * vivo — sin él, el campo de texto no ofrece nada, pero tampoco rompe el
 * envío de lo ya elegido.
 */

import { useEffect, useId, useRef, useState } from "react";

import { IconoCerrar } from "./iconos";
import estilos from "./planeat.module.css";

export interface OpcionAutocompletar {
  valor: string;
  etiqueta: string;
}

interface PropsCampoAutocompletar {
  name: string;
  etiqueta: string;
  placeholder: string;
  opciones: readonly OpcionAutocompletar[];
  seleccionados: readonly string[];
  alCambiar: (valores: string[]) => void;
  /** Cuántas sugerencias enseñar como mucho. Más de esto es scroll, no ayuda. */
  limite?: number;
}

/** Sin acentos y en minúsculas, para que "jalapeno" encuentre "jalapeño". */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Con catálogos de cien y pico alimentos, dos letras dejan una lista larga
 * que no ayuda más que la caja vacía. Tres es el punto en que "toma" ya
 * descarta casi todo menos "Tomate"/"Tomate triturado". */
const MINIMO_CARACTERES = 3;

export function CampoAutocompletar({
  name,
  etiqueta,
  placeholder,
  opciones,
  seleccionados,
  alCambiar,
  limite = 8,
}: PropsCampoAutocompletar) {
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [resaltado, setResaltado] = useState(-1);
  const raiz = useRef<HTMLDivElement>(null);
  const idLista = useId();

  const buscado = normalizar(texto);
  const sugerencias =
    buscado.length < MINIMO_CARACTERES
      ? []
      : opciones
          .filter((o) => !seleccionados.includes(o.valor) && normalizar(o.etiqueta).includes(buscado))
          .slice(0, limite);

  // Cierra el listado al perder el foco del componente entero, no del input:
  // un clic en una sugerencia dispara `blur` del input antes que su propio
  // `click`, y cerrar ahí se comería la selección.
  useEffect(() => {
    function alPulsarFuera(evento: MouseEvent) {
      if (raiz.current && !raiz.current.contains(evento.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", alPulsarFuera);
    return () => document.removeEventListener("mousedown", alPulsarFuera);
  }, []);

  function agregar(valor: string) {
    if (!seleccionados.includes(valor)) alCambiar([...seleccionados, valor]);
    setTexto("");
    setAbierto(false);
    setResaltado(-1);
  }

  function quitar(valor: string) {
    alCambiar(seleccionados.filter((v) => v !== valor));
  }

  function alTeclear(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === "Escape") {
      setAbierto(false);
      return;
    }
    // `Enter` nunca puede escapar de este campo hacia el envío del
    // formulario, pase lo que pase con `sugerencias`. Antes el
    // `preventDefault()` vivía dentro del `if (sugerencias.length === 0)
    // return` de más abajo: con tecleo rápido (o una escritura automatizada
    // que no espera a React entre pulsaciones) el cierre de este manejador
    // podía ver todavía la lista de la búsqueda ANTERIOR — vacía— en el
    // instante en que llegaba el `Enter`, así que el `return` madrugaba, el
    // evento no se interceptaba y el formulario del asistente se enviaba
    // solo. Aquí no hay nada que enviar: como mucho, se elige una sugerencia.
    if (evento.key === "Enter") {
      evento.preventDefault();
      const elegida = sugerencias[resaltado] ?? sugerencias[0];
      if (elegida) agregar(elegida.valor);
      return;
    }
    if (sugerencias.length === 0) return;
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setResaltado((i) => (i + 1) % sugerencias.length);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setResaltado((i) => (i <= 0 ? sugerencias.length - 1 : i - 1));
    }
  }

  return (
    <div ref={raiz} className="relative">
      {/* La selección real, para el envío sin JavaScript. No son casillas
          porque no hay nada que marcar o desmarcar en pantalla: ya están
          fuera, como chips. */}
      {seleccionados.map((valor) => (
        <input key={valor} type="hidden" name={name} value={valor} />
      ))}

      {seleccionados.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label={`${etiqueta} seleccionados`}>
          {seleccionados.map((valor) => {
            const opcion = opciones.find((o) => o.valor === valor);
            return (
              <li key={valor}>
                <span className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius)] border border-brand-line bg-brand-soft py-1 pl-3 pr-1.5 text-sm font-medium text-brand">
                  {opcion?.etiqueta ?? valor}
                  <button
                    type="button"
                    onClick={() => quitar(valor)}
                    aria-label={`Quitar ${opcion?.etiqueta ?? valor}`}
                    className={`${estilos.pulsable} flex h-6 w-6 items-center justify-center rounded-full text-brand hover:bg-brand/15`}
                  >
                    <IconoCerrar tam={14} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <input
        type="text"
        role="combobox"
        aria-expanded={abierto && sugerencias.length > 0}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-label={etiqueta}
        placeholder={placeholder}
        value={texto}
        onChange={(evento) => {
          setTexto(evento.target.value);
          setAbierto(true);
          setResaltado(-1);
        }}
        onFocus={() => setAbierto(true)}
        onKeyDown={alTeclear}
        className="h-12 w-full rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-brand"
      />

      {abierto && buscado !== "" && (
        <ul
          id={idLista}
          role="listbox"
          className="absolute z-10 mt-1.5 w-full overflow-hidden rounded-[var(--radius)] border border-line bg-surface shadow-[var(--shadow-pop)]"
        >
          {buscado.length < MINIMO_CARACTERES ? (
            <li className="px-3.5 py-2.5 text-sm text-text-2">
              Escribe al menos {MINIMO_CARACTERES} letras para buscar.
            </li>
          ) : sugerencias.length === 0 ? (
            <li className="px-3.5 py-2.5 text-sm text-text-2">Sin coincidencias.</li>
          ) : (
            sugerencias.map((opcion, indice) => (
              <li key={opcion.valor} role="option" aria-selected={indice === resaltado}>
                <button
                  type="button"
                  onClick={() => agregar(opcion.valor)}
                  onMouseEnter={() => setResaltado(indice)}
                  className={`block w-full px-3.5 py-2.5 text-left text-[15px] ${
                    indice === resaltado ? "bg-surface-2 text-text" : "text-text-2"
                  }`}
                >
                  {opcion.etiqueta}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
