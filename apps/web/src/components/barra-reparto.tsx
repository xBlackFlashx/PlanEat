/**
 * `BarraReparto` — cómo se reparte la energía entre los tres macros.
 *
 * Trabajo del gráfico: parte sobre el todo. **Siempre suma el 100 %**, así que
 * no tiene carril, no tiene marca de objetivo y no se compara con nada: se lee.
 * Para comparar contra el objetivo del día está `BarraProgresoDia`, que es otro
 * gráfico distinto (docs/diseno-producto.md §4.1).
 *
 * Especificación (§4.2):
 * · Alturas: cinta 6 px · normal 10 px · detalle 14 px.
 * · Hueco de 2 px del color de la superficie entre segmentos — no un borde.
 *   El hueco es lo que separa; un trazo añadiría tinta que no es dato.
 * · Orden Proteína → Carbohidratos → Grasa. Fijo. Nunca por magnitud.
 * · Etiqueta directa siempre visible en las variantes con etiquetas: la
 *   validación de contraste del naranja (2,19:1) obliga a ello. Si alguien
 *   quita las etiquetas, la paleta deja de cumplir.
 * · El texto nunca lleva el color de la serie. La identidad va en el punto.
 */

import { etiquetaAccesible, segmentos, type PanelMacros } from "@/lib/nutricion-ui";
import { gramos } from "@/lib/formato";

import estilos from "./planeat.module.css";

const ALTURAS = { cinta: 6, normal: 10, detalle: 14 } as const;

interface PropsBarraReparto {
  panel: PanelMacros;
  /** La conclusión que oye un lector de pantalla antes que los datos. */
  conclusion: string;
  altura?: keyof typeof ALTURAS;
  /** La variante `cinta` no lleva etiquetas: se usa dentro de otra cosa. */
  etiquetas?: boolean;
  className?: string;
}

export function BarraReparto({
  panel,
  conclusion,
  altura = "normal",
  etiquetas = true,
  className,
}: PropsBarraReparto) {
  const partes = segmentos(panel);
  const alto = ALTURAS[altura];
  const vacia = partes.every((parte) => parte.fraccion === 0);

  return (
    <div className={className}>
      <div
        role="img"
        aria-label={etiquetaAccesible(panel, conclusion)}
        className={`${estilos.barra} flex w-full overflow-hidden`}
        style={{ height: alto, borderRadius: alto / 2, gap: 2 }}
      >
        {vacia ? (
          <div className="w-full bg-surface-3" />
        ) : (
          partes.map((parte) => (
            <div
              key={parte.clave}
              className={estilos.segmento}
              style={{
                // El crecimiento proporcional deja que el hueco de 2 px salga
                // del ancho, en vez de desbordar la barra.
                flexGrow: parte.fraccion,
                flexBasis: 0,
                // Un segmento diminuto no puede desaparecer del todo.
                minWidth: parte.fraccion > 0 ? 3 : 0,
                backgroundColor: parte.color,
              }}
            />
          ))
        )}
      </div>

      {etiquetas && (
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {partes.map((parte) => (
            <li key={parte.clave} className="flex items-center gap-1.5 text-[13px]">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: parte.color }}
              />
              <span className="text-text-2">{parte.etiqueta}</span>
              <span className="font-semibold tabular-nums text-text" data-numeric>
                {gramos(parte.gramos)}
                <span className="font-normal text-text-3"> g</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
