/**
 * Capa 3 — referencia.
 *
 * Se usa el formato de tabla que el usuario ya sabe leer: el orden del
 * Reglamento (UE) 1169/2011 — valor energético, grasas, hidratos de carbono,
 * fibra, proteínas, sal. No se inventa una visualización propia para datos
 * exhaustivos (docs/spec.md §9.3).
 *
 * Lo que no se sabe se dice. Un guion en la columna significa "el catálogo no
 * declara este valor", no "cero": en nutrición esa diferencia importa.
 */

import { gramos, kcal as formatearKcal } from "@/lib/formato";

export interface FilaNutricional {
  etiqueta: string;
  /** `null` = no declarado. Nunca se sustituye por un cero. */
  valor: number | null;
  unidad: string;
  /** Texto del objetivo o del rango, ya formateado. */
  referencia?: string;
  /** Sangrada: "de las cuales", "de los cuales". */
  sangrada?: boolean;
}

interface PropsTabla {
  filas: FilaNutricional[];
  /** Cabecera de la columna de valores: "Este día", "Una ración"… */
  encabezadoValor: string;
  encabezadoReferencia?: string;
  /** Nota al pie sobre la procedencia o las lagunas de los datos. */
  nota?: string;
}

export function TablaNutricional({
  filas,
  encabezadoValor,
  encabezadoReferencia,
  nota,
}: PropsTabla) {
  const conReferencia = encabezadoReferencia != null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="py-2 pr-3 font-medium text-text-2">
              Información nutricional
            </th>
            <th scope="col" className="py-2 pl-3 text-right font-medium text-text-2">
              {encabezadoValor}
            </th>
            {conReferencia && (
              <th scope="col" className="py-2 pl-3 text-right font-medium text-text-2">
                {encabezadoReferencia}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={fila.etiqueta} className="border-b border-line last:border-0">
              <th
                scope="row"
                className={`py-2 pr-3 font-normal ${
                  fila.sangrada ? "pl-4 text-text-2" : "text-text"
                }`}
              >
                {fila.etiqueta}
              </th>
              <td
                className="py-2 pl-3 text-right font-semibold tabular-nums text-text"
                data-numeric
              >
                {fila.valor == null ? (
                  <span className="font-normal text-text-2">sin declarar</span>
                ) : (
                  <>
                    {/* Toda cifra de kcal pasa por el redondeo honesto: si la
                        cabecera dice «≈ 1 610», la tabla no puede decir 1 611. */}
                    {fila.unidad === "kcal" ? formatearKcal(fila.valor) : gramos(fila.valor)}
                    <span className="font-normal text-text-3"> {fila.unidad}</span>
                  </>
                )}
              </td>
              {conReferencia && (
                <td className="py-2 pl-3 text-right tabular-nums text-text-2" data-numeric>
                  {fila.referencia ?? "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {nota && <p className="mt-3 text-sm leading-relaxed text-text-2">{nota}</p>}
    </div>
  );
}
