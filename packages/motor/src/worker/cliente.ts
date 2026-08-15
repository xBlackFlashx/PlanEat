/**
 * Cliente del worker. Es el sustituto exacto de `apps/web/src/lib/solver.ts`:
 * misma máquina de estados, sin HTTP.
 *
 * La regla de la casa no cambia al mover el motor al navegador, y está escrita
 * en el fichero al que éste reemplaza: **si el motor no puede, la interfaz lo
 * dice**. No se genera un plan de mentira ni se rellena con datos de ejemplo.
 * Un producto de nutrición que enseña números falsos cuando algo falla pierde
 * justo lo único que vende.
 *
 * Lo que sí cambia son los desenlaces. La web tenía tres y ahora hay **cuatro**,
 * porque colapsaba «tu objetivo está mal formado» dentro de `sin_servicio`: un
 * rango de proteína invertido no es una avería nuestra ni una sobre-restricción,
 * y mandar a relajar filtros a quien tiene el mínimo por encima del máximo es
 * mandarlo a arreglar lo que no está roto. El cuarto estado sale de la clase de
 * error que ya distingue el worker; aquí sólo se traduce.
 *
 * Tres cosas que este fichero decide y conviene no deshacer:
 *
 *  - **Una generación en vuelo.** Pedir otra cancela la anterior por token. El
 *    plan viejo ya no lo quiere nadie.
 *  - **El corte de 20 s vive aquí.** Es el mismo presupuesto que la interfaz le
 *    promete al usuario (docs/diseno-producto.md §3.2) y el que aplicaba el
 *    `AbortSignal.timeout` del `fetch`. Sin servidor, la única forma de hacerlo
 *    cumplir es `terminate()`: el worker no puede pararse a sí mismo porque
 *    mientras genera no lee mensajes.
 *  - **Sin `Worker` se genera igual, en el hilo que haya.** Es el camino de los
 *    tests en Node. No emite progreso, y no por pereza: las cuatro etapas
 *    saldrían todas dentro del mismo tick, antes de que nadie pueda pintar un
 *    fotograma. Una barra que va de 0 a 100 sin que se vea nada por el camino es
 *    teatro, y el motivo de existir de esa pantalla es no hacer teatro.
 */

import { cargarCatalogo, transferibles } from "../catalogo.ts";
import { MS_LIMITE_GENERACION } from "../constantes.ts";
import { generarPlan, recetasDelPlan } from "../index.ts";
import type { CatalogoCompilado, CatalogoSerializado } from "../catalogo.ts";
import type { ResultadoPlan } from "../index.ts";
import type { Progreso, RespuestaGeneracion, SolicitudGeneracion, Traza } from "../tipos.ts";
import type { RecetaVista, VistaRecetas } from "../../herramientas/compilar-catalogo.ts";
import type { AlWorker, DelWorker } from "./motor.worker.ts";

/**
 * El resultado se **reexporta**, no se redefine.
 *
 * El borrador de la spec declaraba aquí un `ResultadoPlan` más estrecho (sin
 * `recetas`, sin `totalCatalogo`), y tener dos tipos con el mismo nombre y
 * distinta forma obligaría a la web a traducir entre ellos justo en el punto
 * donde el port promete que no tiene que cambiar nada. Es además la regla que
 * `tipos.ts` impone para el dominio: un tipo, un sitio.
 */
export type { MotivoSinServicio, ResultadoPlan } from "../index.ts";

// ---------------------------------------------------------------------------
// El canal
// ---------------------------------------------------------------------------

/**
 * Lo que el cliente necesita de un worker, y ni un método más.
 *
 * No se pasa un `Worker` directamente por dos razones. La primera es que en
 * Node no existe el tipo y probar el protocolo —tokens obsoletos, corte de
 * tiempo, worker que no arranca— exigiría un navegador; con esta interfaz el
 * test escribe un canal de mentira sin tocar una sola API del DOM. La segunda
 * es que así todo el trato con `MessageEvent`, `ErrorEvent` y el clonado
 * estructurado queda encerrado en `canalDeWorker`, que es el único sitio del
 * fichero donde hace falta una aserción de tipo.
 */
export interface CanalWorker {
  enviar(mensaje: AlWorker, transferibles?: readonly Transferable[]): void;
  alRecibir(escucha: (mensaje: DelWorker) => void): void;
  /** El worker no arrancó (script que no carga, `basePath` mal resuelto…). */
  alFallar(escucha: (motivo: string) => void): void;
  cerrar(): void;
}

/**
 * El canal de verdad. `new URL('./motor.worker.ts', import.meta.url)` va escrito
 * literalmente y no se puede sacar a una variable: es el patrón que el bundler
 * reconoce estáticamente para emitir el worker como un asset con hash y con el
 * `basePath: '/PlanEat'` ya aplicado. Una ruta absoluta a `public/` da 404 en
 * GitHub Pages, que es el despliegue para el que existe todo este port.
 */
function canalDeWorker(): CanalWorker {
  const worker = new Worker(new URL("./motor.worker.ts", import.meta.url), {
    type: "module",
  });
  return {
    enviar(mensaje, transferir) {
      worker.postMessage(mensaje, transferir === undefined ? [] : [...transferir]);
    },
    alRecibir(escucha) {
      worker.addEventListener("message", (evento: MessageEvent) => {
        // Frontera del clonado estructurado: al otro lado todo es `unknown`. El
        // único emisor de este canal es `motor.worker.ts`.
        escucha(evento.data as DelWorker);
      });
    },
    alFallar(escucha) {
      worker.addEventListener("error", (evento: ErrorEvent) => {
        escucha(evento.message === "" ? "El worker del motor no ha arrancado." : evento.message);
      });
    },
    cerrar() {
      worker.terminate();
    },
  };
}

// ---------------------------------------------------------------------------
// Superficie pública
// ---------------------------------------------------------------------------

/** Opciones de generación que el contrato del worker deja pasar. */
export interface OpcionesGeneracion {
  /** `YYYY-MM-DD`. Sólo alimenta `DiaPlan.fecha`. */
  hoy?: string;
  /** Semilla en decimal. **Cadena**: son 63 bits y no caben en un `number`. */
  seed?: string;
}

export interface ClienteMotor {
  /**
   * Pide un plan. **Nunca lanza y nunca resuelve con datos inventados.**
   *
   * `alAvanzar` va en segundo lugar posicional porque es lo que declara la spec
   * del port y porque es el argumento que casi todas las llamadas pasan; `hoy`
   * y `seed` quedan detrás, que son las dos únicas opciones que el protocolo
   * del worker transporta.
   */
  generar(
    solicitud: SolicitudGeneracion,
    alAvanzar?: (progreso: Progreso) => void,
    opciones?: OpcionesGeneracion,
  ): Promise<ResultadoPlan>;
  /**
   * Descarta la generación en curso. La promesa que devolvió `generar` **no se
   * resuelve**: los cuatro estados describen desenlaces del motor y ninguno
   * dice «te lo has pedido tú», así que inventar un quinto o mentir con uno de
   * los cuatro sería peor que no contestar a quien ya no está escuchando.
   */
  cancelar(): void;
  /** Cierra el worker. El cliente queda inservible a propósito. */
  destruir(): void;
}

/** Opciones del cliente, todas con defecto. */
export interface OpcionesCliente {
  /**
   * `datos/recetas-vista.json`. Sin ella el plan sale igual —el motor sólo
   * necesita el catálogo compilado— pero la UI se queda sin títulos ni
   * ingredientes y lo dice (`catalogoDisponible: false`), en vez de
   * inventárselos.
   */
  vista?: VistaRecetas | null;
  /** El corte duro. Se toca en los tests y en ningún otro sitio. */
  msLimite?: number;
  /** Fábrica del canal. Existe para poder probar el protocolo sin navegador. */
  crearCanal?: () => CanalWorker;
}

// ---------------------------------------------------------------------------
// Traducciones
// ---------------------------------------------------------------------------

/**
 * Ids de receta → títulos legibles. Copia deliberada de `titulosDe` de
 * `index.ts`.
 *
 * No se reutiliza aquella porque es privada de aquel módulo y es de otro agente
 * del port: exportarla sería editar un fichero que no me toca. La duplicación
 * está anotada y es candidata a desaparecer cuando el port se cierre.
 *
 * Lo que sí es una decisión y no una copia: un id sin traducción se **descarta**
 * en vez de enseñarse. `pollo_arroz_brocoli` en pantalla parece un fallo del
 * producto; no tener texto parece lo que es.
 */
function titulosDe(
  ids: readonly string[] | undefined,
  vista: VistaRecetas | null,
): string[] | undefined {
  if (ids === undefined || vista === null) return undefined;
  const titulos: string[] = [];
  for (const id of ids) {
    const receta = vista.recetas[id];
    if (receta !== undefined) titulos.push(receta.titulo);
  }
  return titulos.length > 0 ? titulos : undefined;
}

/**
 * Respuesta del contrato → resultado de producto. Es el equivalente de las
 * últimas veinte líneas de `generarPlan` (`index.ts`), que el camino del worker
 * no puede reutilizar porque allí el motor y la vista viven en el mismo hilo y
 * aquí no: el motor está al otro lado del `postMessage` y la vista se queda en
 * el principal, que es quien la necesita para dibujar el plan.
 */
function traducir(
  respuesta: RespuestaGeneracion,
  traza: Traza,
  vista: VistaRecetas | null,
  totalCatalogo: number,
): ResultadoPlan {
  if (!respuesta.ok) {
    return {
      estado: "sobre_restriccion",
      fallo: respuesta.fallo,
      totalCatalogo: vista?.total ?? totalCatalogo,
      traza,
    };
  }

  const recetas: Record<string, RecetaVista> = {};
  if (vista !== null) {
    for (const id of recetasDelPlan(respuesta.dias)) {
      const receta = vista.recetas[id];
      if (receta !== undefined) recetas[id] = receta;
    }
  }

  return {
    estado: "ok",
    dias: respuesta.dias,
    msTranscurridos: respuesta.msTranscurridos,
    recetas,
    catalogoDisponible: vista !== null,
    respuesta,
    traza,
  };
}

function averia(detalle: string): ResultadoPlan {
  return { estado: "sin_servicio", motivo: "error_motor", detalle };
}

// ---------------------------------------------------------------------------
// El cliente
// ---------------------------------------------------------------------------

/** Una petición viva: lo que hace falta para resolverla o para tirarla. */
interface EnVuelo {
  token: number;
  resolver: (resultado: ResultadoPlan) => void;
  alAvanzar?: (progreso: Progreso) => void;
  temporizador: ReturnType<typeof setTimeout>;
}

/**
 * Crea el cliente. No arranca el worker todavía.
 *
 * El worker se crea en la primera generación y no aquí porque este constructor
 * corre durante el render de React —donde en un export estático puede no haber
 * `Worker` aún— y porque un usuario que abre la página y no genera nada no
 * tiene por qué pagar la descarga del bundle del motor.
 *
 * `datos` es el JSON compilado, no el catálogo ya decodificado: hay que
 * conservarlo entero porque transferir el catálogo al worker **desacopla** sus
 * buffers, y cada worker nuevo (tras un corte de 20 s, por ejemplo) necesita
 * volver a compilarlo desde este JSON.
 */
export function crearClienteMotor(
  datos: CatalogoSerializado,
  opciones: OpcionesCliente = {},
): ClienteMotor {
  const vista = opciones.vista ?? null;
  const msLimite = opciones.msLimite ?? MS_LIMITE_GENERACION;
  const crearCanal = opciones.crearCanal;

  let canal: CanalWorker | null = null;
  let enVuelo: EnVuelo | null = null;
  let siguienteToken = 1;
  let destruido = false;
  /** El catálogo del camino síncrono. Éste no se transfiere nunca. */
  let compiladoLocal: CatalogoCompilado | null = null;

  /** ¿Hay worker de verdad? El canal inyectado manda sobre el entorno. */
  function hayWorker(): boolean {
    return crearCanal !== undefined || typeof Worker !== "undefined";
  }

  function cerrarCanal(): void {
    canal?.cerrar();
    canal = null;
  }

  /** Resuelve la petición viva y la olvida. Idempotente por construcción. */
  function resolverEnVuelo(resultado: ResultadoPlan): void {
    const viva = enVuelo;
    if (viva === null) return;
    enVuelo = null;
    clearTimeout(viva.temporizador);
    viva.resolver(resultado);
  }

  function alRecibir(mensaje: DelWorker): void {
    if (mensaje.tipo === "listo") return;
    const viva = enVuelo;
    // Aquí es donde el token gana su sueldo: el resultado de una petición que el
    // usuario ya sustituyó llega igual —el worker no se enteró de que lo
    // cancelamos porque estaba generando— y se tira sin más. Enseñarlo sería
    // pintar el plan de unos filtros que ya no están en pantalla.
    if (viva === null || mensaje.token !== viva.token) return;

    switch (mensaje.tipo) {
      case "progreso": {
        const avisar = viva.alAvanzar;
        if (avisar === undefined) return;
        try {
          avisar({ ...mensaje.progreso, titulos: titulosDe(mensaje.progreso.titulos, vista) });
        } catch {
          // Un gancho de progreso que lanza no puede llevarse por delante la
          // generación: dejaría la promesa colgada y la pantalla girando para
          // siempre, que es el peor desenlace posible de todos. El plan sigue su
          // camino y llega; lo único que se pierde es un rótulo.
        }
        return;
      }
      case "resultado": {
        resolverEnVuelo(traducir(mensaje.respuesta, mensaje.traza, vista, datos.n));
        return;
      }
      case "error": {
        resolverEnVuelo(
          mensaje.clase === "objetivo_invalido"
            ? { estado: "objetivo_invalido", mensaje: mensaje.mensaje }
            : averia(mensaje.mensaje),
        );
        return;
      }
    }
  }

  /**
   * Levanta el canal si hace falta y le manda el catálogo.
   *
   * El catálogo se recompila para cada worker (ver `crearClienteMotor`) y viaja
   * con sus quince buffers transferidos, sin copiar. No se espera a `listo`: el
   * orden de entrega de los `postMessage` está garantizado, así que la petición
   * que se encola justo detrás llega detrás.
   */
  function asegurarCanal(): CanalWorker {
    if (canal !== null) return canal;
    // El catálogo se compila ANTES de crear el worker: si el JSON está torcido,
    // `cargarCatalogo` lanza, y hacerlo con un worker ya arrancado dejaría un
    // hilo vivo que nadie va a terminar nunca.
    const cat = cargarCatalogo(datos);
    const nuevo = crearCanal === undefined ? canalDeWorker() : crearCanal();
    nuevo.alRecibir(alRecibir);
    nuevo.alFallar((motivo) => {
      // Un worker que no arranca no va a arrancar en la siguiente petición: se
      // cierra para que la próxima cree uno limpio.
      cerrarCanal();
      resolverEnVuelo(averia(motivo));
    });
    nuevo.enviar({ tipo: "catalogo", datos: cat }, transferibles(cat));
    canal = nuevo;
    return nuevo;
  }

  /**
   * El camino sin worker: se genera en el hilo que haya y se bloquea.
   *
   * Aquí no hay corte de 20 s y no puede haberlo: no existe forma de
   * interrumpir un bucle síncrono de JavaScript desde dentro. Es aceptable
   * porque este camino es el de los tests en Node, no el del usuario.
   */
  function generarSinWorker(
    solicitud: SolicitudGeneracion,
    opcionesGen: OpcionesGeneracion,
  ): ResultadoPlan {
    if (compiladoLocal === null) compiladoLocal = cargarCatalogo(datos);
    return generarPlan(solicitud, compiladoLocal, {
      hoy: opcionesGen.hoy,
      seed: opcionesGen.seed,
      vista,
    });
  }

  function cancelar(): void {
    const viva = enVuelo;
    if (viva === null) return;
    enVuelo = null;
    clearTimeout(viva.temporizador);
    // Se avisa al worker por si la petición sigue en su cola: entonces ni
    // llegará a empezar. Si ya está generando, este mensaje no se lee hasta que
    // termine y el resultado se tirará por token al llegar. La promesa de `viva`
    // queda sin resolver, que es lo que documenta `ClienteMotor.cancelar`.
    canal?.enviar({ tipo: "cancelar", token: viva.token });
  }

  return {
    generar(solicitud, alAvanzar, opcionesGen = {}) {
      if (destruido) {
        return Promise.resolve(averia("El cliente del motor ya está cerrado."));
      }
      // Una generación en vuelo: pedir otra descarta la anterior.
      cancelar();

      if (!hayWorker()) {
        try {
          return Promise.resolve(generarSinWorker(solicitud, opcionesGen));
        } catch (error) {
          // `generarPlan` no lanza; `cargarCatalogo`, sí, y un catálogo torcido
          // es una avería nuestra como cualquier otra.
          return Promise.resolve(averia(error instanceof Error ? error.message : String(error)));
        }
      }

      let activo: CanalWorker;
      try {
        activo = asegurarCanal();
      } catch (error) {
        return Promise.resolve(averia(error instanceof Error ? error.message : String(error)));
      }

      const token = siguienteToken++;
      return new Promise<ResultadoPlan>((resolver) => {
        const temporizador = setTimeout(() => {
          // El corte duro. `terminate()` es lo único que para un bucle síncrono
          // dentro de un worker; el siguiente `generar` levantará uno limpio y
          // le volverá a mandar el catálogo.
          cerrarCanal();
          const viva = enVuelo;
          enVuelo = null;
          viva?.resolver({
            estado: "sin_servicio",
            motivo: "tiempo_agotado",
            detalle: `El motor no ha contestado en ${Math.round(msLimite / 1000)} segundos.`,
          });
        }, msLimite);
        // `unref` sólo existe en Node: allí un temporizador de 20 s mantendría
        // vivo el proceso de los tests después de que todo haya terminado. En el
        // navegador el objeto que devuelve `setTimeout` es un número y no hay
        // nada que desreferenciar.
        if (typeof temporizador === "object" && typeof temporizador.unref === "function") {
          temporizador.unref();
        }
        enVuelo = { token, resolver, alAvanzar, temporizador };
        activo.enviar({
          tipo: "generar",
          token,
          solicitud,
          opciones: { hoy: opcionesGen.hoy, seed: opcionesGen.seed },
        });
      });
    },

    cancelar,

    destruir() {
      cancelar();
      cerrarCanal();
      destruido = true;
    },
  };
}
