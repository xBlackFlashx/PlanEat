import type { DiaPlan } from "@planeat/shared";
import type { PorcionesRecetas } from "@planeat/motor";

export interface ItemListaCompra {
  alimentoId: string;
  nombre: string;
  categoria: string;
  /** Gramos totales para la semana entera, redondeados al gramo. */
  gramos: number;
  /** En cuántas recetas distintas del plan aparece este ingrediente. Es la
   * cifra que hace tangible "ingredientes compartidos": una lista con pocos
   * items en 3+ recetas es justo lo que el término de solape (§2.2d) del
   * motor está optimizando. */
  enRecetas: number;
}

/**
 * Agrega los ingredientes de un plan de varios días en una lista de la
 * compra, sumando gramos por alimento.
 *
 * Los gramos por receta vienen de `receta-ingredientes.json`
 * (`PorcionesRecetas`), NO del catálogo compilado: ese sólo lleva bitsets de
 * qué alimentos aparecen, no cuánto. Ver `porcionesDeReceta` en
 * `packages/motor/herramientas/compilar-catalogo.ts`.
 *
 * Una receta sin entrada en `porciones` (no debería pasar si el catálogo está
 * al día) se omite en vez de inventar un gramaje — la regla de todo este
 * producto: un hueco se dice, no se rellena.
 */
export function listaDeLaCompra(
  dias: readonly DiaPlan[],
  porciones: PorcionesRecetas,
): ItemListaCompra[] {
  const acumulado = new Map<string, ItemListaCompra & { recetasVistas: Set<string> }>();

  for (const dia of dias) {
    for (const comida of dia.comidas) {
      for (const item of comida.items) {
        const receta = porciones.recetas[item.recetaId];
        if (!receta || receta.racionesBase <= 0) continue;

        for (const ingrediente of receta.ingredientes) {
          // `gramos` en la receta es para racionesBase raciones completas:
          // se reparte y se escala por el factor que de verdad se sirvió.
          const gramos = (ingrediente.gramos / receta.racionesBase) * item.factorRacion;

          const existente = acumulado.get(ingrediente.alimentoId);
          if (existente) {
            existente.gramos += gramos;
            existente.recetasVistas.add(item.recetaId);
          } else {
            acumulado.set(ingrediente.alimentoId, {
              alimentoId: ingrediente.alimentoId,
              nombre: ingrediente.nombre,
              categoria: ingrediente.categoria,
              gramos,
              enRecetas: 0,
              recetasVistas: new Set([item.recetaId]),
            });
          }
        }
      }
    }
  }

  return [...acumulado.values()]
    .map(({ recetasVistas, ...resto }) => ({
      ...resto,
      gramos: Math.round(resto.gramos),
      enRecetas: recetasVistas.size,
    }))
    .sort(
      (a, b) => a.categoria.localeCompare(b.categoria, "es") || a.nombre.localeCompare(b.nombre, "es"),
    );
}
