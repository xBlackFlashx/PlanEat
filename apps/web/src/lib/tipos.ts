/**
 * Tipos de la interfaz que no están en el contrato compartido.
 *
 * El contrato (`@planeat/shared`) devuelve `recetaId`, no recetas. La interfaz
 * necesita el título y el tiempo para poder dibujar un día, así que el motor
 * enriquece la respuesta con un resumen de cada receta sacado del catálogo de
 * presentación (`packages/motor/datos/recetas-vista.json`). Si esa vista no
 * está disponible, `recetas` viene vacío y la pantalla lo dice: no se inventa
 * ni un título ni una cifra.
 *
 * Antes del port, `RecetaResumen` se declaraba aquí y el servidor la construía
 * leyendo el catálogo del solver del disco. Ahora la misma forma vive en el
 * motor, que es quien la compila: se **reexporta**, no se vuelve a escribir.
 * Dos declaraciones estructuralmente idénticas compilan sin quejarse y
 * divergen el día que una gana un campo.
 */

import type { DiaPlan, FalloGeneracion } from "@planeat/shared";
import type { RecetaVista } from "@planeat/motor";

/** Lo que la interfaz necesita saber de una receta para dibujarla. */
export type RecetaResumen = RecetaVista;

/**
 * Por qué no hay plan cuando no lo hay por causas nuestras, no del usuario.
 *
 * Sin backend, el motor sólo puede fallar de dos maneras (`error_motor` y
 * `tiempo_agotado`, ver `@planeat/motor`), y aquí se traducen a `error_solver`
 * y `tiempo_agotado`. Los otros tres describían modos de fallo de un `fetch`
 * que ya no existe y **se conservan a propósito**: `sin-servicio.tsx` tiene un
 * `Record<MotivoSinServicio, …>` exhaustivo con su texto escrito, y borrarlos
 * de aquí sería romper un fichero de otro para ahorrar tres líneas muertas.
 */
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
 * · `sobre_restriccion` — el motor ha contestado que no llega. **No es un
 *   error**: es un resultado, y tiene pantalla propia.
 * · `sin_servicio` — el fallo es nuestro. Se dice tal cual, sin datos falsos.
 *
 * El motor distingue un cuarto desenlace (`objetivo_invalido`) que aquí no
 * aparece, y no por descuido: ver `aResultadoDeVista` en `solver.ts`.
 */
export type ResultadoPlan =
  | {
      estado: "ok";
      dias: DiaPlan[];
      msTranscurridos: number;
      recetas: Record<string, RecetaResumen>;
      /** Falso cuando no se ha podido leer el catálogo: la vista lo refleja. */
      catalogoDisponible: boolean;
      /**
       * Semilla con la que se generó, en decimal y como **cadena**: son 63 bits
       * y un `number` sólo garantiza 53. Es lo que hace que un plan concreto se
       * pueda volver a generar, y por eso viaja a la query de `/plan`.
       */
      seed: string;
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
