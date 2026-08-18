import { cargarCatalogo } from "@planeat/motor";
import type {
  CatalogoCompilado,
  CatalogoSerializado,
  PorcionesRecetas,
  VistaRecetas,
} from "@planeat/motor";

import catalogoJson from "@planeat/motor/catalogo-compilado";
import porcionesJson from "@planeat/motor/receta-ingredientes";
import recetasVistaJson from "@planeat/motor/recetas-vista";

/**
 * El mismo catálogo compilado que usa el generador del navegador, cargado una
 * vez por proceso de servidor en vez de una vez por request —
 * `cargarCatalogo` no es carísimo, pero no hay motivo para repetirlo en cada
 * llamada a `/api/generar-semana`.
 */
const catalogoSerializado: CatalogoSerializado = catalogoJson;
const vistaRecetas: VistaRecetas = recetasVistaJson;
const porcionesRecetas: PorcionesRecetas = porcionesJson;

export const CATALOGO: CatalogoCompilado = cargarCatalogo(catalogoSerializado);
export const VISTA_RECETAS: VistaRecetas = vistaRecetas;
export const PORCIONES_RECETAS: PorcionesRecetas = porcionesRecetas;
