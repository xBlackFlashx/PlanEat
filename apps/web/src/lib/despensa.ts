/**
 * "Qué puedo cocinar con esto" — cruza los alimentos que el usuario dice
 * tener contra el catálogo de recetas, en el navegador, sin motor de
 * optimización de por medio: es un cálculo de cobertura por receta, no un
 * problema de asignación semanal.
 */

import type { IngredienteVista, RecetaVista, VistaRecetas } from "@planeat/motor";

export interface RecetaConCobertura {
  receta: RecetaVista;
  /** Fracción [0,1] de los ingredientes de la receta ya cubiertos. */
  cobertura: number;
  /** Los ingredientes de la receta que el usuario todavía no tiene. */
  faltantes: IngredienteVista[];
}

/**
 * Recetas del catálogo ordenadas por cuánto ya cubre `disponibles`, de mayor
 * a menor cobertura y, en empate, por menos faltantes. Una receta sin
 * ingredientes conocidos no se ofrece (cobertura indefinida, no cero: cero
 * sugeriría "no tienes nada de esto" cuando en realidad no hay nada que
 * comparar).
 */
export function recetasQuePuedoHacer(
  disponibles: readonly string[],
  vista: VistaRecetas,
): RecetaConCobertura[] {
  const tengo = new Set(disponibles);
  const resultado: RecetaConCobertura[] = [];

  for (const receta of Object.values(vista.recetas)) {
    if (receta.ingredientes.length === 0) continue;
    const faltantes = receta.ingredientes.filter((i) => !tengo.has(i.alimentoId));
    const cobertura = (receta.ingredientes.length - faltantes.length) / receta.ingredientes.length;
    resultado.push({ receta, cobertura, faltantes });
  }

  resultado.sort((a, b) => b.cobertura - a.cobertura || a.faltantes.length - b.faltantes.length);
  return resultado;
}
