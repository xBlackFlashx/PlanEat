/**
 * El prefijo bajo el que se sirve el sitio, en un solo sitio.
 *
 * En GitHub Pages la app vive en `/PlanEat`, no en la raíz. `next/link` y el
 * cargador de assets aplican el `basePath` por su cuenta, así que la inmensa
 * mayoría del código no se entera y no debe enterarse. Este módulo existe sólo
 * para los tres o cuatro sitios donde escribimos una URL a mano y Next no puede
 * ayudarnos: hoy, el `action` del formulario de la portada.
 *
 * El valor lo inyecta `next.config.ts` en tiempo de build a partir de
 * `PLANEAT_BASE_PATH`. En local es la cadena vacía y todo esto es la identidad.
 */

/** Sin barra final. Cadena vacía cuando el sitio se sirve en la raíz. */
export const RUTA_BASE = process.env.NEXT_PUBLIC_RUTA_BASE ?? "";

/**
 * Una ruta interna, prefijada. Se le pone barra final porque el export usa
 * `trailingSlash: true` y `/plan` sin barra obliga a un salto extra en Pages.
 */
export function rutaDe(ruta: `/${string}`): string {
  const conBarra = ruta.endsWith("/") ? ruta : `${ruta}/`;
  return `${RUTA_BASE}${conBarra}`;
}
