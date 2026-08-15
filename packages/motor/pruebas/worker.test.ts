/**
 * El worker y su cliente: `src/worker/motor.worker.ts` y `src/worker/cliente.ts`.
 *
 * Aquí no se prueba el motor —de eso van los otros catorce ficheros de
 * `pruebas/`— sino el **protocolo**, que es lo único que estos dos módulos
 * añaden y lo único que puede romperse sin que ningún plan salga mal:
 *
 *  - **El respaldo síncrono da lo mismo que el motor directo.** Es el camino de
 *    Node, donde no hay `Worker`, y también la red de seguridad de un navegador
 *    antiguo. Si divergiera, los tests estarían validando un motor que el
 *    usuario no ejecuta.
 *  - **El token descarta lo obsoleto.** El worker no se entera de que lo hemos
 *    cancelado mientras genera —su bucle de eventos está bloqueado—, así que el
 *    resultado viejo llega igual. Pintarlo sería enseñar el plan de unos filtros
 *    que ya no están en pantalla.
 *  - **El corte de 20 s existe y recrea el worker.** Sin `AbortSignal` de
 *    `fetch`, es lo único que impide una espera infinita.
 *  - **Los cuatro estados son cuatro.** `objetivo_invalido` y `sin_servicio` se
 *    separan aquí por primera vez; si vuelven a colapsarse, este fichero lo dice.
 *
 * Ningún test toca el DOM. El cliente admite una fábrica de canal precisamente
 * para esto: un canal de mentira (`canalManual`) para controlar el tiempo y el
 * orden, y un canal que corre el manejador REAL del worker en este mismo hilo
 * (`canalEnProceso`) para que el protocolo se ejercite de punta a punta.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { cargarCatalogo } from "../src/catalogo.ts";
import { generarPlan } from "../src/index.ts";
import { crearClienteMotor } from "../src/worker/cliente.ts";
import { crearManejador } from "../src/worker/motor.worker.ts";
import type { CatalogoCompilado, CatalogoSerializado } from "../src/catalogo.ts";
import type { ResultadoPlan } from "../src/index.ts";
import type {
  ObjetivoNutricional,
  Progreso,
  RespuestaGeneracion,
  RestriccionesGeneracion,
  SolicitudGeneracion,
  Traza,
} from "../src/tipos.ts";
import type { VistaRecetas } from "../herramientas/compilar-catalogo.ts";
import type { CanalWorker } from "../src/worker/cliente.ts";
import type { AlWorker, DelWorker } from "../src/worker/motor.worker.ts";

// ---------------------------------------------------------------------------
// Andamios
// ---------------------------------------------------------------------------

const AQUI = dirname(fileURLToPath(import.meta.url));
const HOY = "2026-08-15";
/** Fija el plan: sin semilla, dos generaciones no se pueden comparar. */
const SEED = "123456789012345678";

function leerJson<T>(ruta: string): T {
  return JSON.parse(readFileSync(ruta, "utf8")) as T;
}

const DATOS = leerJson<CatalogoSerializado>(resolve(AQUI, "../datos/catalogo-compilado.json"));
const VISTA = leerJson<VistaRecetas>(resolve(AQUI, "../datos/recetas-vista.json"));

/** El catálogo del test es suyo: el que se transfiere al worker se desacopla. */
function catalogo(): CatalogoCompilado {
  return cargarCatalogo(DATOS);
}

function objetivo(cambios: Partial<ObjetivoNutricional> = {}): ObjetivoNutricional {
  return {
    kcal: 2000,
    toleranciaKcal: 0.05,
    proteinaG: { min: 120, max: 160 },
    carbohidratoG: { min: 180, max: 250 },
    grasaG: { min: 55, max: 80 },
    fibraMinG: 20,
    ...cambios,
  };
}

function solicitud(
  nDias = 2,
  cambiosObjetivo: Partial<ObjetivoNutricional> = {},
): SolicitudGeneracion {
  const restricciones: RestriccionesGeneracion = {
    dieta: "omnivora",
    alergenosExcluidos: [],
    ingredientesExcluidos: [],
    slots: ["desayuno", "comida", "cena"],
    comensales: 1,
  };
  return {
    objetivos: Array.from({ length: nDias }, () => objetivo(cambiosObjetivo)),
    restricciones,
  };
}

/**
 * Un resultado de verdad con el que alimentar a los canales de mentira.
 *
 * Sale del manejador real —no se fabrica a mano— porque un `RespuestaOk`
 * inventado probaría que el cliente sabe copiar el objeto que le den, no que
 * sepa traducir lo que el worker emite.
 */
function resultadoDelWorker(): { respuesta: RespuestaGeneracion; traza: Traza } {
  const salidas: DelWorker[] = [];
  const manejar = crearManejador((m) => salidas.push(m));
  manejar({ tipo: "catalogo", datos: catalogo() });
  manejar({
    tipo: "generar",
    token: 1,
    solicitud: solicitud(1),
    opciones: { hoy: HOY, seed: SEED },
  });
  const emitido = salidas.find((m) => m.tipo === "resultado");
  assert.ok(emitido !== undefined && emitido.tipo === "resultado");
  return { respuesta: emitido.respuesta, traza: emitido.traza };
}

/**
 * ¿Sigue esta promesa sin resolverse?
 *
 * Es la única forma de afirmar «esto NO se ha entregado», que es justo lo que
 * dicen los tests de cancelación. El plazo es de un tick largo: todas las
 * entregas de este fichero son síncronas o de microtarea, así que si no ha
 * llegado en 5 ms es que no va a llegar.
 */
async function sigueEnVuelo(promesa: Promise<ResultadoPlan>): Promise<boolean> {
  const testigo = await Promise.race([
    promesa,
    new Promise<"pendiente">((r) => {
      setTimeout(() => r("pendiente"), 5).unref();
    }),
  ]);
  return testigo === "pendiente";
}

// ---------------------------------------------------------------------------
// Canales de mentira
// ---------------------------------------------------------------------------

/** Canal que no contesta a nada: el test decide qué llega y cuándo. */
interface CanalManual {
  canal: CanalWorker;
  enviados: AlWorker[];
  entregar: (mensaje: DelWorker) => void;
  fallar: (motivo: string) => void;
  cerrado: () => boolean;
}

function canalManual(): CanalManual {
  const enviados: AlWorker[] = [];
  let recibir: ((mensaje: DelWorker) => void) | null = null;
  let fallo: ((motivo: string) => void) | null = null;
  let cerrado = false;
  return {
    canal: {
      enviar(mensaje) {
        enviados.push(mensaje);
      },
      alRecibir(escucha) {
        recibir = escucha;
      },
      alFallar(escucha) {
        fallo = escucha;
      },
      cerrar() {
        cerrado = true;
      },
    },
    enviados,
    entregar: (mensaje) => recibir?.(mensaje),
    fallar: (motivo) => fallo?.(motivo),
    cerrado: () => cerrado,
  };
}

/**
 * Canal que corre el manejador REAL del worker en este hilo.
 *
 * Es lo más cerca del navegador que se puede llegar sin navegador: los mismos
 * mensajes, el mismo manejador y el mismo motor. Lo único que no reproduce es la
 * asincronía del `postMessage`, y a propósito: el cliente no depende del orden
 * de entrega más allá de que la petición se registre antes de enviarse, que es
 * exactamente lo que un canal síncrono comprueba de la forma más severa posible.
 */
function canalEnProceso(): CanalWorker {
  let recibir: ((mensaje: DelWorker) => void) | null = null;
  const manejar = crearManejador((mensaje) => recibir?.(mensaje));
  return {
    enviar(mensaje) {
      manejar(mensaje);
    },
    alRecibir(escucha) {
      recibir = escucha;
    },
    alFallar() {
      // Un manejador en proceso no puede «no arrancar».
    },
    cerrar() {
      // Ni se puede terminar: no hay hilo que matar.
    },
  };
}

// ---------------------------------------------------------------------------
// El respaldo síncrono
// ---------------------------------------------------------------------------

test("sin Worker, el cliente genera el mismo plan que generarPlan directo", async () => {
  assert.equal(typeof Worker, "undefined", "este test sólo dice algo si Node no tiene Worker");

  const sol = solicitud();
  const cliente = crearClienteMotor(DATOS, { vista: VISTA });
  const porCliente = await cliente.generar(sol, undefined, { hoy: HOY, seed: SEED });
  const directo = generarPlan(sol, catalogo(), { hoy: HOY, seed: SEED, vista: VISTA });

  assert.equal(porCliente.estado, "ok");
  assert.equal(directo.estado, "ok");
  if (porCliente.estado !== "ok" || directo.estado !== "ok") return;

  // El plan entero, byte a byte. Los milisegundos NO entran: son la única cosa
  // que cambia entre dos ejecuciones del mismo motor con la misma semilla, y
  // compararlos convertiría este test en uno que falla los martes.
  assert.deepEqual(porCliente.dias, directo.dias);
  assert.deepEqual(porCliente.recetas, directo.recetas);
  assert.equal(porCliente.catalogoDisponible, true);
  assert.equal(porCliente.respuesta.seed, directo.respuesta.seed);
  assert.equal(porCliente.respuesta.versionCatalogo, directo.respuesta.versionCatalogo);
  assert.equal(porCliente.respuesta.versionGenerador, directo.respuesta.versionGenerador);
  assert.equal(porCliente.respuesta.pool, directo.respuesta.pool);
  assert.deepEqual(porCliente.traza.erroresPorDia, directo.traza.erroresPorDia);

  cliente.destruir();
});

test("sin vista, el respaldo síncrono lo dice en vez de inventarse los títulos", async () => {
  const cliente = crearClienteMotor(DATOS);
  const resultado = await cliente.generar(solicitud(1), undefined, { hoy: HOY, seed: SEED });
  assert.equal(resultado.estado, "ok");
  if (resultado.estado !== "ok") return;
  assert.equal(resultado.catalogoDisponible, false);
  assert.deepEqual(resultado.recetas, {});
  cliente.destruir();
});

// ---------------------------------------------------------------------------
// El protocolo, con el manejador real al otro lado
// ---------------------------------------------------------------------------

test("con canal, el plan cruza el protocolo entero y sale igual que el síncrono", async () => {
  const sol = solicitud();
  const cliente = crearClienteMotor(DATOS, { vista: VISTA, crearCanal: canalEnProceso });
  const porWorker = await cliente.generar(sol, undefined, { hoy: HOY, seed: SEED });
  const directo = generarPlan(sol, catalogo(), { hoy: HOY, seed: SEED, vista: VISTA });

  assert.equal(porWorker.estado, "ok");
  if (porWorker.estado !== "ok" || directo.estado !== "ok") return;
  assert.deepEqual(porWorker.dias, directo.dias);
  assert.deepEqual(porWorker.recetas, directo.recetas);
  cliente.destruir();
});

test("el progreso son las cuatro etapas reales, con títulos y no con ids", async () => {
  const cliente = crearClienteMotor(DATOS, { vista: VISTA, crearCanal: canalEnProceso });
  const visto: Progreso[] = [];
  const resultado = await cliente.generar(solicitud(3), (p) => visto.push(p), {
    hoy: HOY,
    seed: SEED,
  });
  assert.equal(resultado.estado, "ok");

  const etapas = visto.map((p) => p.etapa);
  assert.deepEqual(
    [...new Set(etapas)],
    ["objetivos", "pool", "porcionado", "cuadre"],
    "las etapas llegan en el orden del motor y llegan las cuatro",
  );
  // Una por día cerrado: es la única etapa que emite varios mensajes, y es lo
  // que hace que la barra avance porque avanza el trabajo y no porque pase el
  // tiempo. Antes del port esto era `hecho = indice === 0`.
  const dias = visto.filter((p) => p.etapa === "porcionado").map((p) => p.dia);
  assert.deepEqual(dias, [0, 1, 2]);
  assert.ok(
    visto.every((p) => p.deDias === 3),
    "todos los mensajes saben cuántos días tiene el plan",
  );

  const conTitulos = visto.filter((p) => p.titulos !== undefined);
  assert.ok(conTitulos.length > 0, "el porcionado trae el mejor candidato provisional");
  const titulos = new Set(Object.values(VISTA.recetas).map((r) => r.titulo));
  for (const p of conTitulos) {
    for (const t of p.titulos ?? []) {
      assert.ok(titulos.has(t), `«${t}» no es un título del catálogo: se está colando un id`);
    }
  }
  cliente.destruir();
});

test("un gancho de progreso que lanza no deja la generación colgada", async () => {
  const cliente = crearClienteMotor(DATOS, { vista: VISTA, crearCanal: canalEnProceso });
  const resultado = await cliente.generar(
    solicitud(1),
    () => {
      throw new Error("la vista ha reventado al pintar el paso");
    },
    { hoy: HOY, seed: SEED },
  );
  // Se pierde el rótulo, no el plan: una promesa sin resolver dejaría la
  // pantalla girando para siempre, que es el peor desenlace de todos.
  assert.equal(resultado.estado, "ok");
  cliente.destruir();
});

test("el catálogo se manda una vez por worker, no una por petición", async () => {
  const manual = canalManual();
  const cliente = crearClienteMotor(DATOS, { crearCanal: () => manual.canal });

  const primera = cliente.generar(solicitud(1));
  cliente.cancelar();
  const segunda = cliente.generar(solicitud(1));

  const catalogos = manual.enviados.filter((m) => m.tipo === "catalogo");
  assert.equal(catalogos.length, 1);
  assert.equal(manual.enviados.filter((m) => m.tipo === "generar").length, 2);

  assert.ok(await sigueEnVuelo(primera));
  assert.ok(await sigueEnVuelo(segunda));
  cliente.destruir();
});

// ---------------------------------------------------------------------------
// Cancelación por token
// ---------------------------------------------------------------------------

test("un resultado de un token cancelado se descarta", async () => {
  const manual = canalManual();
  const cliente = crearClienteMotor(DATOS, { vista: VISTA, crearCanal: () => manual.canal });

  const vieja = cliente.generar(solicitud(1), undefined, { hoy: HOY, seed: SEED });
  cliente.cancelar();
  const nueva = cliente.generar(solicitud(1), undefined, { hoy: HOY, seed: SEED });

  const generados = manual.enviados.filter((m) => m.tipo === "generar");
  const tokenViejo = generados[0]?.token ?? -1;
  const tokenNuevo = generados[1]?.token ?? -1;
  assert.notEqual(tokenViejo, tokenNuevo);
  assert.ok(
    manual.enviados.some((m) => m.tipo === "cancelar" && m.token === tokenViejo),
    "al worker se le avisa por si la petición vieja sigue en su cola",
  );

  // El worker estaba generando cuando lo cancelamos: su resultado llega igual.
  const { respuesta, traza } = resultadoDelWorker();
  manual.entregar({ tipo: "resultado", token: tokenViejo, respuesta, traza });

  assert.ok(await sigueEnVuelo(nueva), "el resultado obsoleto no puede resolver la petición viva");
  assert.ok(await sigueEnVuelo(vieja), "ni resucitar la cancelada");

  manual.entregar({ tipo: "resultado", token: tokenNuevo, respuesta, traza });
  const resultado = await nueva;
  assert.equal(resultado.estado, "ok");
  cliente.destruir();
});

test("el worker no ejecuta un token que ya venía cancelado", () => {
  const salidas: DelWorker[] = [];
  const manejar = crearManejador((m) => salidas.push(m));

  manejar({ tipo: "catalogo", datos: catalogo() });
  assert.deepEqual(salidas, [{ tipo: "listo" }]);

  // El orden importa: éste es el caso que la cancelación por token SÍ puede
  // atajar, el de la petición que aún no ha empezado. La que ya está corriendo
  // no se entera —el hilo está bloqueado— y de ésa se encarga el `terminate()`.
  manejar({ tipo: "cancelar", token: 7 });
  manejar({ tipo: "generar", token: 7, solicitud: solicitud(1), opciones: { hoy: HOY, seed: SEED } });
  assert.equal(salidas.length, 1, "un token cancelado no genera nada, ni progreso");

  manejar({ tipo: "generar", token: 8, solicitud: solicitud(1), opciones: { hoy: HOY, seed: SEED } });
  assert.ok(
    salidas.some((m) => m.tipo === "resultado" && m.token === 8),
    "el token siguiente no hereda la cancelación",
  );
});

// ---------------------------------------------------------------------------
// El corte de tiempo
// ---------------------------------------------------------------------------

test("si el worker no contesta, el corte da sin_servicio y tiempo_agotado", async () => {
  const canales: CanalManual[] = [];
  const cliente = crearClienteMotor(DATOS, {
    msLimite: 25,
    crearCanal: () => {
      const nuevo = canalManual();
      canales.push(nuevo);
      return nuevo.canal;
    },
  });

  const resultado = await cliente.generar(solicitud(1));
  assert.equal(resultado.estado, "sin_servicio");
  if (resultado.estado !== "sin_servicio") return;
  assert.equal(resultado.motivo, "tiempo_agotado");
  assert.ok(resultado.detalle.length > 0, "el detalle se enseña plegado: no puede estar vacío");

  // `terminate()`: es lo ÚNICO que para un bucle síncrono dentro de un worker.
  assert.equal(canales.length, 1);
  assert.equal(canales[0]?.cerrado(), true);

  // Y la siguiente petición levanta un worker limpio con su catálogo otra vez,
  // porque los buffers del anterior se transfirieron y ya no existen aquí.
  const otra = cliente.generar(solicitud(1));
  assert.equal(canales.length, 2);
  assert.equal(canales[1]?.enviados[0]?.tipo, "catalogo");
  assert.ok(await sigueEnVuelo(otra));
  cliente.destruir();
});

// ---------------------------------------------------------------------------
// Los cuatro estados
// ---------------------------------------------------------------------------

test("un objetivo mal formado es objetivo_invalido, no una avería", async () => {
  const cliente = crearClienteMotor(DATOS, { vista: VISTA, crearCanal: canalEnProceso });
  // Rango invertido: ni es culpa del motor ni se arregla relajando filtros.
  const resultado = await cliente.generar(
    solicitud(1, { proteinaG: { min: 160, max: 120 } }),
    undefined,
    { hoy: HOY, seed: SEED },
  );
  assert.equal(resultado.estado, "objetivo_invalido");
  if (resultado.estado !== "objetivo_invalido") return;
  assert.match(resultado.mensaje, /invertido/);
  cliente.destruir();
});

test("una avería del motor es sin_servicio con motivo error_motor", async () => {
  const manual = canalManual();
  const cliente = crearClienteMotor(DATOS, { crearCanal: () => manual.canal });
  const espera = cliente.generar(solicitud(1));
  const token = manual.enviados.filter((m) => m.tipo === "generar")[0]?.token ?? -1;
  manual.entregar({ tipo: "error", token, clase: "error_motor", mensaje: "se ha roto por dentro" });

  const resultado = await espera;
  assert.equal(resultado.estado, "sin_servicio");
  if (resultado.estado !== "sin_servicio") return;
  assert.equal(resultado.motivo, "error_motor");
  assert.equal(resultado.detalle, "se ha roto por dentro");
  cliente.destruir();
});

test("un worker que no arranca es una avería, no un plan vacío", async () => {
  const manual = canalManual();
  const cliente = crearClienteMotor(DATOS, { crearCanal: () => manual.canal });
  const espera = cliente.generar(solicitud(1));
  manual.fallar("Failed to fetch dynamically imported module");

  const resultado = await espera;
  assert.equal(resultado.estado, "sin_servicio");
  if (resultado.estado !== "sin_servicio") return;
  assert.equal(resultado.motivo, "error_motor");
  assert.equal(manual.cerrado(), true, "un worker que no arranca se cierra, no se reintenta");
  cliente.destruir();
});

test("el worker sin catálogo lo dice en vez de generar sobre la nada", () => {
  const salidas: DelWorker[] = [];
  const manejar = crearManejador((m) => salidas.push(m));
  manejar({ tipo: "generar", token: 1, solicitud: solicitud(1) });
  assert.equal(salidas.length, 1);
  const primera = salidas[0];
  assert.equal(primera?.tipo, "error");
  if (primera?.tipo !== "error") return;
  assert.equal(primera.clase, "error_motor");
});

test("una sobre-restricción llega como resultado, no como error", async () => {
  const cliente = crearClienteMotor(DATOS, { vista: VISTA, crearCanal: canalEnProceso });
  // 5.900 kcal con macros de 2.000: el catálogo semilla no puede, y eso es un
  // resultado del producto con pantalla propia, no una avería nuestra.
  const resultado = await cliente.generar(solicitud(1, { kcal: 5900 }), undefined, {
    hoy: HOY,
    seed: SEED,
  });
  assert.equal(resultado.estado, "sobre_restriccion");
  if (resultado.estado !== "sobre_restriccion") return;
  assert.equal(resultado.totalCatalogo, VISTA.total);
  assert.ok(resultado.fallo.sugerencias.length > 0, "la pantalla necesita salidas concretas");
  cliente.destruir();
});

test("un cliente destruido no genera: lo dice y no vuelve a abrir el worker", async () => {
  const cliente = crearClienteMotor(DATOS, { crearCanal: canalEnProceso });
  cliente.destruir();
  const resultado = await cliente.generar(solicitud(1));
  assert.equal(resultado.estado, "sin_servicio");
});

