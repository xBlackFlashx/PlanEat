/**
 * Formateo de cifras para la interfaz.
 *
 * No se usa `Intl` a propósito: el mismo número tiene que salir idéntico en el
 * servidor y en el cliente, y la disponibilidad de ICU en Node no está
 * garantizada en todos los despliegues. Un desajuste aquí es un error de
 * hidratación en la cifra más visible del producto.
 *
 * El separador de millares es un espacio fino inseparable (U+202F): es la forma
 * correcta en español y no parte la cifra al final de una línea.
 */

import { kcalPresentables } from "@planeat/shared";

const ESPACIO_FINO = " ";

/** Agrupa millares. `2140` → `2 140`. */
export function numero(valor: number): string {
  const entero = Math.round(valor);
  const signo = entero < 0 ? "−" : "";
  const digitos = Math.abs(entero).toString();
  let salida = "";
  for (let i = 0; i < digitos.length; i++) {
    if (i > 0 && (digitos.length - i) % 3 === 0) salida += ESPACIO_FINO;
    salida += digitos[i];
  }
  return signo + salida;
}

/** Con signo explícito, para deltas. `+12` / `−8`. */
export function numeroConSigno(valor: number): string {
  const entero = Math.round(valor);
  if (entero === 0) return "0";
  return (entero > 0 ? "+" : "") + numero(entero);
}

/**
 * kcal para mostrar. Redondea a la decena con `kcalPresentables()` del paquete
 * compartido: `2 137` es falsa precisión, `2 140` es honesto.
 */
export function kcal(valor: number): string {
  return numero(kcalPresentables(valor));
}

/** Gramos enteros. La precisión decimal en un macro es ruido. */
export function gramos(valor: number): string {
  return numero(valor);
}

/** Precio en rango, nunca exacto (docs/spec.md §9.1.5). */
export function rangoPrecio(cents: number): string {
  const euros = cents / 100;
  const min = Math.floor(euros * 0.92);
  const max = Math.ceil(euros * 1.08);
  return `${numero(min)}–${numero(max)}${ESPACIO_FINO}€`;
}

/** `1` → `1 ración`; `1,5` → `1 ración y media`; el resto, con un decimal. */
export function racion(factor: number): string {
  if (Math.abs(factor - 1) < 0.02) return "1 ración";
  if (Math.abs(factor - 1.5) < 0.02) return "1 ración y media";
  if (Math.abs(factor - 0.5) < 0.02) return "media ración";
  return `${factor.toFixed(1).replace(".", ",")} raciones`;
}

/** Minutos de cocina. */
export function minutos(valor: number): string {
  return `${numero(valor)}${ESPACIO_FINO}min`;
}

/** `2026-08-14` → `Viernes 14 de agosto`. Sin `Intl`, por lo mismo de arriba. */
const DIAS = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function fechaLarga(iso: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!partes) return iso;
  const [, a, m, d] = partes;
  // Mediodía UTC: evita que el desfase horario mueva el día.
  const fecha = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d), 12));
  return `${DIAS[fecha.getUTCDay()]} ${Number(d)} de ${MESES[Number(m) - 1]}`;
}

/** Versión corta para la cabecera pegajosa: `Viernes 14`. */
export function fechaCorta(iso: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!partes) return iso;
  const [, a, m, d] = partes;
  const fecha = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d), 12));
  return `${DIAS[fecha.getUTCDay()]} ${Number(d)}`;
}
