/**
 * Los alimentos que el motor puede excluir de verdad.
 *
 * `alimentos-vista` no es un fichero aparte: es el campo `alimentos` de
 * `recetas-vista.json`, el mismo JSON que ya se importa para las fichas de
 * receta. Vive aquí porque no hay un segundo sitio en la app que lo lea, y
 * porque es el único punto que debe decidir "vista de recetas → vista de
 * alimentos" en vez de que cada componente repita el mismo `import` y el
 * mismo cast a `VistaRecetas`.
 *
 * Sólo cubre los 66 alimentos citados por alguna receta del catálogo, no los
 * 73 de `ingredientes.json`: excluir un alimento que ninguna receta usa no
 * cambiaría ningún plan, así que ofrecerlo en el selector sería una opción
 * que parece hacer algo y no hace nada.
 */

import type { VistaRecetas } from "@planeat/motor";
import recetasVista from "@planeat/motor/recetas-vista";

const vista: VistaRecetas = recetasVista;

export const ALIMENTOS = vista.alimentos;

export const NOMBRE_ALIMENTO: Map<string, string> = new Map(
  ALIMENTOS.map((a) => [a.id, a.nombre]),
);

/** Nombre legible de cada categoría de `ingredientes.json`. Si el catálogo
 * trae una categoría nueva, se enseña tal cual en vez de desaparecer. */
export const NOMBRE_CATEGORIA: Record<string, string> = {
  despensa: "Despensa",
  verduleria: "Verdulería",
  fruteria: "Frutería",
  carniceria: "Carnicería",
  pescaderia: "Pescadería",
  lacteos: "Lácteos",
  huevos: "Huevos",
  conservas: "Conservas",
  refrigerados: "Refrigerados",
  panaderia: "Panadería",
};

/** Alimentos agrupados por categoría, en el orden en que aparece cada grupo
 * por primera vez en `ALIMENTOS` (que ya viene alfabético por id). */
export function alimentosPorCategoria(): Map<string, typeof ALIMENTOS> {
  const grupos = new Map<string, typeof ALIMENTOS>();
  for (const alimento of ALIMENTOS) {
    const grupo = grupos.get(alimento.categoria);
    if (grupo) grupo.push(alimento);
    else grupos.set(alimento.categoria, [alimento]);
  }
  return grupos;
}
