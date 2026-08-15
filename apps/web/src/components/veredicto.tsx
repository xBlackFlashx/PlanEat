/**
 * El veredicto del día: "Cuadra / Casi / No cuadra".
 *
 * Tres estados, nunca cinco: cinco niveles son un juicio moral disfrazado de
 * precisión. Reglas duras (docs/diseno-producto.md §4.5):
 *
 * · Nunca el color solo. Siempre icono **y** palabra, y la forma del icono
 *   distingue los tres estados en escala de grises.
 * · "Cuadra" usa el acento de marca, no verde: el verde ya significa *grasa*
 *   en este producto.
 * · Ningún porcentaje de cumplimiento, ninguna nota, ninguna racha. Es una
 *   descripción, no un elogio — y por eso "No cuadra" tampoco es un reproche.
 *
 * Los tres puntos de la derecha son la pieza donde las dos capas ocupan el
 * mismo píxel: el principiante los lee como un adorno junto al tick; quien sabe
 * leerlos obtiene el diagnóstico de los tres macros en 32 px sin abrir nada.
 * La distinción es relleno frente a hueco — forma, no color.
 */

import type { Veredicto } from "@/lib/nutricion-ui";

import { IconoCasi, IconoCuadra, IconoNoCuadra } from "./iconos";

const PRESENTACION = {
  cuadra: { Icono: IconoCuadra, color: "text-brand" },
  casi: { Icono: IconoCasi, color: "text-warning" },
  no_cuadra: { Icono: IconoNoCuadra, color: "text-danger" },
} as const;

interface PropsSelloVeredicto {
  veredicto: Veredicto;
  /** Los tres puntos por macro. Se ocultan en sitios donde ya hay barra al lado. */
  puntos?: boolean;
  tam?: number;
}

export function SelloVeredicto({ veredicto, puntos = true, tam = 20 }: PropsSelloVeredicto) {
  const { Icono, color } = PRESENTACION[veredicto.estado];

  const fuera = veredicto.puntos.filter((punto) => !punto.dentro);
  const resumenPuntos =
    fuera.length === 0
      ? "Los tres macros están dentro de tu rango."
      : `Fuera de rango: ${fuera.map((punto) => punto.macro.enProsa).join(", ")}.`;

  return (
    <p className="flex items-center gap-2">
      <span className={`flex items-center gap-1.5 font-semibold ${color}`}>
        <Icono tam={tam} />
        {veredicto.palabra}
      </span>

      {puntos && (
        <>
          <span aria-hidden="true" className="flex items-center gap-1">
            {veredicto.puntos.map((punto) => (
              <span
                key={punto.macro.clave}
                className="block size-2 rounded-full"
                style={
                  punto.dentro
                    ? { backgroundColor: punto.macro.color }
                    : {
                        // Anillo hueco: el centro toma el color de la superficie
                        // que hay debajo, no un gris inventado.
                        boxShadow: `inset 0 0 0 2px ${punto.macro.color}`,
                      }
                }
              />
            ))}
          </span>
          <span className="sr-only">{resumenPuntos}</span>
        </>
      )}
    </p>
  );
}
