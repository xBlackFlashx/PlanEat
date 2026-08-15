/**
 * El worker que aloja el motor. Sustituye al proceso FastAPI de
 * `services/solver/app/main.py`: mismo trabajo, otro sitio y sin red por medio.
 *
 * Existe por tres razones, y sólo la primera es de rendimiento:
 *
 * 1. La generación es **síncrona y bloqueante** —cientos de milisegundos de
 *    bucles sobre typed arrays— y en el hilo principal congela el scroll, las
 *    animaciones y hasta el cursor de texto. En un móvil de gama media eso no es
 *    «va lento»: es una página que parece rota.
 * 2. Da un botón de parada de verdad. Sin worker no hay forma de abortar un
 *    `for` de JavaScript; con worker, `terminate()` desde el hilo principal.
 * 3. Hace **honesto** el progreso. `estado-generacion.tsx` marcaba el paso hecho
 *    con `hecho = indice === 0`, es decir, mentía educadamente porque no tenía
 *    de dónde sacar la verdad. Ahora el motor emite sus cuatro etapas reales
 *    (§4.2) y un mensaje por día cerrado, con los ids del mejor candidato
 *    provisional, y la pantalla puede escribir lo que de verdad está pasando.
 *
 * Lo que este fichero **no** hace, a propósito:
 *
 *  - No decodifica el catálogo. Llega ya compilado y con los buffers
 *    transferidos (ver `AlWorker`), así que la validación —que puede lanzar—
 *    ocurre en el hilo principal, donde el cliente puede convertirla en una
 *    pantalla y no en un worker que muere en silencio.
 *  - No conoce títulos ni ingredientes. Emite ids de receta; quien tiene la
 *    vista de presentación es el hilo principal, que además la necesita para
 *    dibujar el plan. Meter 36 cadenas en el bundle del worker para un rótulo
 *    que se ve medio segundo no sale a cuenta (misma decisión que `index.ts`).
 *  - No aplica el corte de 20 s. No puede: mientras genera, su bucle de eventos
 *    está bloqueado y no leería el mensaje. El corte lo aplica el cliente con
 *    `terminate()`, que es el único sitio desde el que se puede hacer cumplir.
 */

import { ObjetivoInvalido, generar } from "../index.ts";
import type { CatalogoCompilado } from "../catalogo.ts";
import type {
  Progreso,
  RespuestaGeneracion,
  SolicitudGeneracion,
  Traza,
} from "../tipos.ts";

// ---------------------------------------------------------------------------
// Protocolo
// ---------------------------------------------------------------------------

/**
 * Del hilo principal al worker.
 *
 * `catalogo` viaja **compilado** (`CatalogoCompilado`) y no serializado, que es
 * lo que decía el borrador de la spec. La razón es que `CatalogoSerializado`
 * son `number[]`: el clonado estructurado los copia elemento a elemento y no
 * hay nada que transferir. La forma compilada son quince `ArrayBuffer` que se
 * transfieren sin copiar (`transferibles()` de `catalogo.ts` existe justo para
 * esto y su docstring documenta esta llamada), y de paso el fallo más caro del
 * port —un catálogo compilado con otro orden de columnas— revienta en el hilo
 * principal, donde hay a quién contárselo.
 *
 * Ojo: transferir DESACOPLA los buffers del emisor. El cliente vuelve a
 * compilar el catálogo cada vez que crea un worker; es un decodificado de 36
 * filas y ocurre una vez por worker.
 */
export type AlWorker =
  | { tipo: "catalogo"; datos: CatalogoCompilado }
  | {
      tipo: "generar";
      token: number;
      solicitud: SolicitudGeneracion;
      opciones?: { hoy?: string; seed?: string };
    }
  | { tipo: "cancelar"; token: number };

/**
 * Del worker al hilo principal. Todo mensaje que no sea `listo` lleva el token
 * de la generación a la que pertenece: es lo que permite al cliente tirar los
 * resultados de una petición que el usuario ya ha sustituido por otra.
 */
export type DelWorker =
  | { tipo: "listo" }
  | { tipo: "progreso"; token: number; progreso: Progreso }
  | { tipo: "resultado"; token: number; respuesta: RespuestaGeneracion; traza: Traza }
  | {
      tipo: "error";
      token: number;
      /**
       * Las dos clases NO son la misma cosa y por eso viajan separadas:
       * `objetivo_invalido` es «tu objetivo no se puede leer» (culpa del
       * llamante, pantalla propia) y `error_motor` es «hemos fallado nosotros».
       * Colapsarlas es exactamente lo que hacía la web con el 422 del backend.
       */
      clase: "objetivo_invalido" | "error_motor";
      mensaje: string;
    };

/** Cómo saca el manejador sus mensajes. En el worker real, `postMessage`. */
export type Emisor = (mensaje: DelWorker) => void;

// ---------------------------------------------------------------------------
// El manejador
// ---------------------------------------------------------------------------

/**
 * La lógica del worker, separada del worker.
 *
 * Está fuera del enganche a `addEventListener` para poder probarla: en Node no
 * hay `Worker`, y un fichero que sólo se puede ejercitar arrancando un
 * navegador no se prueba nunca. Aquí dentro está todo lo que hay que probar
 * —orden de mensajes, catálogo ausente, tokens cancelados, traducción de
 * excepciones a clases de error— y el enganche de abajo son cuatro líneas sin
 * decisiones.
 *
 * El manejador es **estrictamente secuencial**: mientras `generar` corre, este
 * hilo no lee ningún mensaje más. De ahí sale la única limitación honesta de la
 * cancelación (ver `cancelar`).
 */
export function crearManejador(emitir: Emisor): (mensaje: AlWorker) => void {
  let cat: CatalogoCompilado | null = null;

  /**
   * Tokens cancelados que todavía no han llegado a ejecutarse.
   *
   * Sólo sirve para las peticiones que están **en la cola**: si el token que se
   * cancela es el que se está generando ahora mismo, este mensaje no se lee
   * hasta que la generación termine, y para entonces ya no hay nada que
   * cancelar. Ése es el caso que resuelve el `terminate()` del cliente.
   */
  const cancelados = new Set<number>();

  return (mensaje: AlWorker): void => {
    switch (mensaje.tipo) {
      case "catalogo": {
        cat = mensaje.datos;
        // No gatea nada: el orden de los `postMessage` está garantizado y el
        // cliente encola la petición justo detrás del catálogo. Se emite para
        // que quien depure sepa que el worker arrancó y recibió los datos.
        emitir({ tipo: "listo" });
        return;
      }

      case "cancelar": {
        cancelados.add(mensaje.token);
        return;
      }

      case "generar": {
        const { token, solicitud } = mensaje;
        const cancelado = cancelados.has(token);
        // Poda: los tokens del cliente son crecientes, así que cualquiera
        // anterior al que acaba de llegar ya no puede ejecutarse nunca. La
        // corrección no depende de que sean crecientes; el tamaño del conjunto,
        // sí, y un Set que sólo crece en una pestaña abierta toda la tarde es
        // una fuga pequeña pero real.
        for (const t of cancelados) {
          if (t <= token) cancelados.delete(t);
        }
        if (cancelado) return;

        if (cat === null) {
          emitir({
            tipo: "error",
            token,
            clase: "error_motor",
            mensaje:
              "El worker ha recibido una petición antes que el catálogo. No genero " +
              "un plan sin catálogo: sería inventármelo.",
          });
          return;
        }

        let respuesta: RespuestaGeneracion;
        let traza: Traza;
        try {
          ({ respuesta, traza } = generar(solicitud, cat, {
            hoy: mensaje.opciones?.hoy,
            seed: mensaje.opciones?.seed,
            alAvanzar: (progreso: Progreso) => {
              emitir({ tipo: "progreso", token, progreso });
            },
          }));
        } catch (error) {
          // `generar` sólo promete lanzar `ObjetivoInvalido`; lo demás es un
          // fallo nuestro. Se distinguen aquí y no en el cliente porque aquí
          // está la excepción viva: cruzar el `postMessage` la convertiría en
          // una cadena y perdería la clase.
          emitir({
            tipo: "error",
            token,
            clase: error instanceof ObjetivoInvalido ? "objetivo_invalido" : "error_motor",
            mensaje: error instanceof Error ? error.message : String(error),
          });
          return;
        }

        emitir({ tipo: "resultado", token, respuesta, traza });
        return;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Enganche
// ---------------------------------------------------------------------------

/**
 * `postMessage` del ámbito del worker, declarado aquí.
 *
 * `tsconfig.json` incluye a la vez las librerías `DOM` y `WebWorker` —el motor
 * se compila una sola vez para los dos ámbitos— y las dos declaran un
 * `postMessage` global distinto: el de `Window` exige `targetOrigin`, el del
 * worker no. Declararlo en el módulo lo deja tipado como lo que de verdad hay
 * aquí dentro, que además es el único `postMessage` que este fichero puede
 * ejecutar, y de paso obliga a que sólo salgan mensajes del protocolo.
 */
declare function postMessage(mensaje: DelWorker): void;

/**
 * En el navegador el módulo se engancha solo al cargarse. En Node no existe
 * `addEventListener` global y este bloque no hace nada: el fichero se importa
 * en los tests para ejercitar `crearManejador`, que es donde está la lógica.
 *
 * `typeof` sobre un identificador no declarado es seguro (no lanza
 * `ReferenceError`), que es justo por lo que la comprobación se escribe así.
 */
if (typeof addEventListener === "function") {
  const manejar = crearManejador((mensaje: DelWorker) => {
    postMessage(mensaje);
  });
  addEventListener("message", (evento: MessageEvent) => {
    // El clonado estructurado no transporta tipos: al otro lado del canal todo
    // es `unknown` y esta aserción es la frontera. El único emisor de este
    // canal es `cliente.ts`, que sólo escribe `AlWorker`.
    const mensaje = evento.data as AlWorker;
    manejar(mensaje);
  });
}
