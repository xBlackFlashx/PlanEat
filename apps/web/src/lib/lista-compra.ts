import type { DiaPlan } from "@planeat/shared";
import type { PorcionesRecetas } from "@planeat/motor";

/**
 * Una variante dentro de un item agrupado por `grupoCompra` (ver
 * `ItemListaCompra.desglose`). Nunca se funden sus gramos con los de otra
 * variante: son productos con densidad/uso distintos (200 g de claras no son
 * 200 g de huevo entero), sólo comparten cabecera de compra.
 */
/** Estimación en piezas de un gramaje, cuando `ingredientes.json` declara un
 * `gramosPorPieza` para ese alimento (un huevo, un plátano, una tortilla...).
 * Es una estimación de compra, no una cifra exacta: por eso vive aparte de
 * `gramos`, que sigue siendo la cifra de verdad para quien la prefiera. */
export interface PiezasEstimadas {
  /** Redondeado, mínimo 1 — no tiene sentido "comprar 0 piezas" de algo que
   * sí aparece en el plan. */
  cantidad: number;
  /** "pieza" salvo que `ingredientes.json` declare otra (p.ej. "tallo", "tortilla"). */
  unidad: string;
}

export interface DesgloseListaCompra {
  nombre: string;
  gramos: number;
  enRecetas: number;
  /** Sólo cuando esta variante concreta tiene su propio `gramosPorPieza`. */
  piezas?: PiezasEstimadas;
}

export interface ItemListaCompra {
  alimentoId: string;
  nombre: string;
  categoria: string;
  /** Gramos totales para la semana entera, redondeados al gramo. Cuando hay
   * `desglose`, es sólo el total del componente base (el que da nombre al
   * grupo) — nunca una suma con las demás variantes, que no comparten unidad
   * comparable. */
  gramos: number;
  /** En cuántas recetas distintas del plan aparece este ingrediente. Es la
   * cifra que hace tangible "ingredientes compartidos": una lista con pocos
   * items en 3+ recetas es justo lo que el término de solape (§2.2d) del
   * motor está optimizando. Cuando hay `desglose`, cuenta sólo las recetas
   * del componente base, en línea con `gramos`. */
  enRecetas: number;
  /**
   * Presente cuando este item agrupa varias variantes de compra que
   * `ingredientes.json` marca con el mismo `grupoCompra` (p.ej. "Huevo" y
   * "Clara de huevo": se compran juntas, aunque tengan paneles nutricionales
   * distintos). Ausente en el caso normal, y también cuando el plan sólo usa
   * una de las variantes del grupo — no hay nada que desglosar.
   */
  desglose?: DesgloseListaCompra[];
  /**
   * Estimación de compra en piezas del componente base (los `gramos` de
   * arriba), sólo cuando `ingredientes.json` declara `gramosPorPieza` para
   * ese alimento. Ausente para todo lo que se compra por peso o volumen
   * (arroz, aceite, especias, carne suelta...) — ahí "piezas" no significa
   * nada y la cifra en gramos sigue siendo la única.
   */
  piezas?: PiezasEstimadas;
}

/** `Math.round`, pero nunca 0: si el ingrediente aparece en el plan, la
 * compra mínima es una pieza entera, no "cero piezas". */
function piezasDe(gramos: number, gramosPorPieza: number, unidad: string | undefined): PiezasEstimadas {
  return { cantidad: Math.max(1, Math.round(gramos / gramosPorPieza)), unidad: unidad ?? "pieza" };
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
/** Acumulado por alimentoId real (nunca por `grupoCompra`): agrupar variantes
 * distintas pasa en un segundo paso, después de sumar cada una por separado. */
interface ComponenteAcumulado {
  alimentoId: string;
  nombre: string;
  categoria: string;
  grupoCompra: string | undefined;
  gramosPorPieza: number | undefined;
  unidadPieza: string | undefined;
  gramos: number;
  recetasVistas: Set<string>;
}

export function listaDeLaCompra(
  dias: readonly DiaPlan[],
  porciones: PorcionesRecetas,
): ItemListaCompra[] {
  const acumulado = new Map<string, ComponenteAcumulado>();

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
              grupoCompra: ingrediente.grupoCompra,
              gramosPorPieza: ingrediente.gramosPorPieza,
              unidadPieza: ingrediente.unidadPieza,
              gramos,
              recetasVistas: new Set([item.recetaId]),
            });
          }
        }
      }
    }
  }

  // Segundo paso: agrupa por `grupoCompra` (o por el propio alimentoId si no
  // tiene) para que variantes que se compran juntas —huevo entero y clara de
  // huevo— aparezcan bajo una sola cabecera. Sus gramos NUNCA se funden: cada
  // variante es un producto con densidad/uso distinto (ver `DesgloseListaCompra`).
  const grupos = new Map<string, ComponenteAcumulado[]>();
  for (const componente of acumulado.values()) {
    const clave = componente.grupoCompra ?? componente.alimentoId;
    const delGrupo = grupos.get(clave);
    if (delGrupo) delGrupo.push(componente);
    else grupos.set(clave, [componente]);
  }

  const items: ItemListaCompra[] = [];
  for (const [clave, componentes] of grupos) {
    if (componentes.length === 1) {
      // Sin agrupación real: el plan sólo usa una variante de este grupo (o el
      // ingrediente no pertenece a ninguno). Se enseña tal cual, sin desglose
      // vacío ni cabecera forzada a otro nombre.
      const c = componentes[0]!;
      items.push({
        alimentoId: c.alimentoId,
        nombre: c.nombre,
        categoria: c.categoria,
        gramos: Math.round(c.gramos),
        enRecetas: c.recetasVistas.size,
        ...(c.gramosPorPieza === undefined
          ? {}
          : { piezas: piezasDe(c.gramos, c.gramosPorPieza, c.unidadPieza) }),
      });
      continue;
    }

    // El componente "base" es el que da nombre al grupo: aquél cuyo propio
    // alimentoId es la clave de agrupación (p.ej. "huevo" dentro del grupo
    // "huevo"). Si por lo que sea no está presente, se cae al primero — no
    // debería pasar con el catálogo de hoy, pero es mejor que reventar.
    const base = componentes.find((c) => c.alimentoId === clave) ?? componentes[0]!;
    items.push({
      alimentoId: clave,
      nombre: base.nombre,
      categoria: base.categoria,
      gramos: Math.round(base.gramos),
      enRecetas: base.recetasVistas.size,
      ...(base.gramosPorPieza === undefined
        ? {}
        : { piezas: piezasDe(base.gramos, base.gramosPorPieza, base.unidadPieza) }),
      desglose: componentes.map((c) => ({
        nombre: c.nombre,
        gramos: Math.round(c.gramos),
        enRecetas: c.recetasVistas.size,
        ...(c.gramosPorPieza === undefined
          ? {}
          : { piezas: piezasDe(c.gramos, c.gramosPorPieza, c.unidadPieza) }),
      })),
    });
  }

  return items.sort(
    (a, b) => a.categoria.localeCompare(b.categoria, "es") || a.nombre.localeCompare(b.nombre, "es"),
  );
}
