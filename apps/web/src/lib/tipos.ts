/**
 * Tipos de la interfaz que no están en el contrato compartido.
 *
 * El contrato (`@planeat/shared`) devuelve `recetaId`, no recetas. La interfaz
 * necesita el título y el tiempo para poder dibujar un día, así que el proxy
 * enriquece la respuesta con un resumen de cada receta leído del catálogo. Si
 * el catálogo no está disponible, `recetas` viene vacío y la vista lo dice: no
 * se inventa ni un título ni una cifra.
 */

import type { DiaPlan, FalloGeneracion, SlotComida } from "@planeat/shared";

/** Lo que la interfaz necesita saber de una receta para dibujarla. */
export interface RecetaResumen {
  id: string;
  titulo: string;
  minutos: number;
  slots: SlotComida[];
  alergenos: string[];
  /** Nombres legibles de los ingredientes, ya resueltos. */
  ingredientes: string[];
  /** Por ración base. La ración servida es esto por `factorRacion`. */
  porRacion: {
    kcal: number;
    proteinaG: number;
    carbohidratoG: number;
    grasaG: number;
    fibraG: number;
    sodioMg: number;
  };
  /** Marca por nutriente: `false` significa "no lo sé", no "cero". */
  conocido: {
    kcal: boolean;
    proteinaG: boolean;
    carbohidratoG: boolean;
    grasaG: boolean;
    fibraG: boolean;
    sodioMg: boolean;
  };
  costeCents: number | null;
  /** Trazabilidad de la revisión por dietista. Hoy es `null` en todo el catálogo. */
  revisadaPor: string | null;
}

/** Por qué no hay plan cuando no lo hay por causas nuestras, no del usuario. */
export type MotivoSinServicio =
  | "sin_conexion"
  | "motor_no_implementado"
  | "error_solver"
  | "tiempo_agotado"
  | "respuesta_ilegible";

/**
 * Resultado de pedir un plan. Tres desenlaces, y son distintos entre sí:
 *
 * · `ok` — hay día.
 * · `sobre_restriccion` — el solver ha contestado que no llega. **No es un
 *   error**: es un resultado, y tiene pantalla propia.
 * · `sin_servicio` — el fallo es nuestro. Se dice tal cual, sin datos falsos.
 */
export type ResultadoPlan =
  | {
      estado: "ok";
      dias: DiaPlan[];
      msTranscurridos: number;
      recetas: Record<string, RecetaResumen>;
      /** Falso cuando no se ha podido leer el catálogo: la vista lo refleja. */
      catalogoDisponible: boolean;
    }
  | {
      estado: "sobre_restriccion";
      fallo: FalloGeneracion;
      /**
       * Cuántas recetas tiene el catálogo entero. Da contexto a la cifra de
       * candidatas. `null` si no se ha podido leer: entonces la vista enseña
       * la cifra sola, sin proporción inventada.
       */
      totalCatalogo: number | null;
    }
  | { estado: "sin_servicio"; motivo: MotivoSinServicio; detalle: string };
