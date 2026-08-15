/**
 * Puerta de entrada al motor. **Sólo navegador.**
 *
 * Regla de la casa, y no cambia porque el motor haya cruzado del servidor al
 * cliente: si el motor no puede, la interfaz lo dice. No se genera un plan de
 * mentira ni se rellena con datos de ejemplo. Un producto de nutrición que
 * enseña números falsos cuando algo falla pierde justo lo único que vende.
 *
 * Por eso hay tres desenlaces y no dos (ver `ResultadoPlan`): que el motor
 * conteste "no llego" es un resultado del producto y tiene pantalla propia; que
 * el motor reviente o se pase del tiempo es un fallo nuestro y tiene otra.
 *
 * Qué queda de la versión anterior y qué no:
 *
 *  - Ya no hay `fetch`, ni `SOLVER_URL`, ni `process.env`, ni catálogo leído del
 *    disco con `node:fs`. El catálogo compilado y la vista de presentación
 *    entran en el bundle como JSON (49 KB en crudo): cero peticiones, cero
 *    rutas absolutas que `basePath` pueda romper, y la versión del catálogo
 *    queda atada al hash del bundle.
 *  - `MS_LIMITE_GENERACION` sigue exportándose desde aquí porque sigue siendo
 *    el mismo corte que la interfaz le declara al usuario. Ahora lo aplica el
 *    cliente del worker con `terminate()`, que es lo único capaz de parar un
 *    bucle síncrono de JavaScript.
 *  - `recetasDelPlan` también sobrevive, reexportada del motor: la usa quien
 *    quiera saber qué recetas salen en un plan sin recorrerlo a mano.
 *
 * El worker lo crea el cliente del motor, no este fichero. Que llegue al
 * navegador empaquetado y no en crudo depende del bundler: ver la nota sobre
 * `--webpack` en `next.config.ts`.
 */

import { crearClienteMotor } from "@planeat/motor/cliente";
import catalogoCompilado from "@planeat/motor/catalogo-compilado";
import recetasVista from "@planeat/motor/recetas-vista";
import type { ClienteMotor } from "@planeat/motor/cliente";
import type {
  CatalogoSerializado,
  ResultadoPlan as ResultadoMotor,
  VistaRecetas,
} from "@planeat/motor";

import type { ResultadoPlan } from "./tipos";

export { MS_LIMITE_GENERACION, recetasDelPlan } from "@planeat/motor";
export type { Progreso } from "@planeat/motor";

/**
 * Los dos JSON compilados, ya tipados.
 *
 * La anotación no es decorativa: es el único punto donde se comprueba que lo
 * que `npm run motor:catalogo` ha escrito encaja con lo que el motor espera
 * leer. `cargarCatalogo` vuelve a validarlo en runtime —el orden de las
 * columnas no se puede comprobar con tipos— y lanza si no cuadra.
 */
const catalogo: CatalogoSerializado = catalogoCompilado;
const vista: VistaRecetas = recetasVista;

/**
 * Un cliente para toda la pestaña.
 *
 * El cliente ya impone "una generación en vuelo": pedir otra cancela la
 * anterior. Tener uno por componente rompería esa garantía —la portada y la
 * vista del plan podrían generar a la vez— y además duplicaría el worker y la
 * copia del catálogo transferida.
 *
 * Se crea perezosamente y nunca durante el render: `crearClienteMotor` no
 * arranca el worker, pero este módulo se importa también desde el prerender del
 * export estático, donde no hay `Worker` ni `window`.
 */
let cliente: ClienteMotor | null = null;

export function clienteMotor(): ClienteMotor {
  cliente ??= crearClienteMotor(catalogo, { vista });
  return cliente;
}

/**
 * Resultado del motor → resultado de la interfaz.
 *
 * El motor distingue cuatro desenlaces y la interfaz tiene tres pantallas. El
 * que sobra es `objetivo_invalido`, y traducirlo a `error_solver` no es
 * colapsar dos cosas distintas por pereza: en esta app el objetivo **no lo
 * escribe el usuario**. Lo calculamos nosotros con `calcularObjetivoDelDia` a
 * partir de un formulario que ya ha pasado `validar()`, y le aplicamos los
 * ajustes de la pantalla de sobre-restricción. Si el motor dice que ese
 * objetivo no se puede leer, el fallo es de nuestro código, que es exactamente
 * lo que `error_solver` cuenta en pantalla ("no es cosa de lo que has pedido").
 * El mensaje del motor viaja en el detalle técnico, plegado, sin adornar.
 *
 * Si algún día el usuario escribe su objetivo a mano, esto deja de ser cierto y
 * hay que darle pantalla propia a `objetivo_invalido`.
 */
export function aResultadoDeVista(resultado: ResultadoMotor): ResultadoPlan {
  switch (resultado.estado) {
    case "ok":
      return {
        estado: "ok",
        dias: resultado.dias,
        msTranscurridos: resultado.msTranscurridos,
        recetas: resultado.recetas,
        catalogoDisponible: resultado.catalogoDisponible,
        seed: resultado.respuesta.seed,
      };

    case "sobre_restriccion":
      return {
        estado: "sobre_restriccion",
        fallo: resultado.fallo,
        totalCatalogo: resultado.totalCatalogo,
      };

    case "objetivo_invalido":
      return {
        estado: "sin_servicio",
        motivo: "error_solver",
        detalle: `El motor ha rechazado el objetivo que le he construido: ${resultado.mensaje}`,
      };

    case "sin_servicio":
      return {
        estado: "sin_servicio",
        motivo: resultado.motivo === "tiempo_agotado" ? "tiempo_agotado" : "error_solver",
        detalle: resultado.detalle,
      };
  }
}
