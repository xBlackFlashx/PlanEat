"use client";

/**
 * Estado de generación — «el día se pone la mesa».
 *
 * Es el único momento del producto en que el usuario mira y no puede hacer
 * nada, así que merece un gesto propio, y ese gesto tiene que **informar**, no
 * entretener (docs/diseno-producto.md §3.2 y §5.4).
 *
 * Lo que cambia con el motor dentro del navegador: hasta el port, los cuatro
 * pasos estaban cableados (`hecho = indice === 0`) porque no había forma de
 * saber por dónde iba el trabajo, y la pantalla mentía educadamente. Ahora el
 * motor corre en un Web Worker y emite `Progreso` por etapa y por día, así que
 * **todo lo que se ve aquí sale de un dato**: qué paso está en curso, cuándo
 * empieza el barrido y qué platos tiene ya el día. Nada se estima por reloj.
 *
 * La coreografía, atada a §5.4 y a lo que el worker es capaz de contar:
 *
 * - **Compás 1 · Objetivos.** La cinta superior dibuja los tres segmentos en su
 *   color al 25 % de opacidad, de izquierda a derecha. Es el objetivo, no el
 *   resultado, y por eso está a un cuarto de opacidad: la barra real del día
 *   arranca luego desde justo ahí (`barra-progreso-dia.tsx`, compás 4). Sólo
 *   ocurre si quien monta esta pantalla pasa `objetivo`; sin él la cinta es un
 *   carril vacío, que es lo honesto: los anchos del objetivo no se adivinan.
 * - **Compás 2 · Candidatas.** El barrido empieza cuando el motor dice que el
 *   pool está construido, no antes. Desfase de 140 ms entre filas, bucle de
 *   1 100 ms, y puede durar lo que haga falta sin mentir porque no promete un
 *   porcentaje. Esa es la razón entera de que no haya barra de progreso.
 * - **Compás 3 · Raciones.** El momento crítico: `Progreso.titulos` trae los
 *   títulos reales del día que el motor acaba de cerrar, y cada fila del
 *   esqueleto **se convierte en su plato en el sitio**, escalonada 90 ms. La
 *   espera termina cuando hay algo que leer, no cuando termina la animación.
 * - **Compás 4 · Cuadre.** No es de este componente: lo hace la barra del día
 *   al aparecer el plan. Aquí sólo se marca el paso como *en curso*, nunca como
 *   hecho: ninguna interfaz de este producto llega al 100 % antes que el motor.
 *
 * Cuatro decisiones que hay que respetar si se toca esto:
 *
 * 1. **No es un esqueleto genérico.** Es la forma del día del usuario, con los
 *    nombres reales de sus comidas ya escritos. Un esqueleto abstracto dice
 *    "espera"; éste dice "estoy montando *esto*".
 * 2. **No hay barra de porcentaje**, y los pasos hechos son los que de verdad
 *    han ocurrido. Sin noticias del motor sólo se da por empezado el primero.
 * 3. **No se monta si la respuesta llega antes de 400 ms.** Un esqueleto que
 *    parpadea es peor que ningún esqueleto. De eso se encarga quien lo usa.
 * 4. **Con `prefers-reduced-motion` no se monta la animación**, no se acelera.
 *    El reset global de `globals.css` convertiría el barrido en bucle en un
 *    parpadeo, que es justo lo que la preferencia intenta evitar (§5.5). La
 *    línea de estado sigue diciendo lo mismo: es información, no decoración.
 */

import { useEffect, useState } from "react";
import type { ObjetivoNutricional, SlotComida } from "@planeat/shared";

import type { Progreso } from "@/lib/solver";
import { useMovimientoReducido } from "@/lib/memoria-plegado";
import { segmentos, type PanelMacros } from "@/lib/nutricion-ui";
import { NOMBRE_SLOT } from "@/lib/perfil";

import estilos from "./planeat.module.css";

/** Los cuatro pasos del pipeline real (docs/spec.md §4.2). */
const PASOS = [
  "Calculando tu objetivo del día",
  "Buscando recetas que encajan",
  "Ajustando las raciones",
  "Cuadrando el día",
] as const;

/**
 * Las cuatro etapas que emite el motor, en el orden en que ocurren. El índice
 * en esta tupla es el índice del paso en `PASOS`: son la misma lista contada
 * dos veces, una para la máquina y otra para la persona.
 */
const ETAPAS: readonly Progreso["etapa"][] = ["objetivos", "pool", "porcionado", "cuadre"];

/** Índice del paso «Ajustando las raciones», el único que va por días. */
const PASO_PORCIONADO = 2;

const MS_ESPERA_LARGA = 6_000;

/** Desfase del barrido entre filas (§5.4, compás 2). */
const MS_DESFASE_BARRIDO = 140;

/** Desfase de la aparición de los títulos entre filas (§5.4, compás 3). */
const MS_DESFASE_TITULO = 90;

/**
 * Reparto del objetivo para la cinta del compás 1.
 *
 * Es el centro de cada rango, igual que en `barra-progreso-dia.tsx`. Está
 * duplicado y no importado porque allí la función es privada del módulo y ese
 * fichero es de otro agente: exportarla sería editárselo. Candidata a subir a
 * `lib/nutricion-ui.ts` cuando los dos ficheros estén en la misma mano.
 */
function repartoDelObjetivo(objetivo: ObjetivoNutricional): PanelMacros {
  const centro = (rango: { min: number; max: number }) => (rango.min + rango.max) / 2;
  return {
    proteinaG: centro(objetivo.proteinaG),
    carbohidratoG: centro(objetivo.carbohidratoG),
    grasaG: centro(objetivo.grasaG),
  };
}

/**
 * Lo último que dijo el motor sobre los platos del día, y de qué mensaje salió.
 * `fuente` es la identidad de la lista que produjo `titulos`: comparar por
 * referencia es lo que permite saber si hay noticias nuevas sin recorrer nada.
 */
interface MemoriaTitulos {
  fuente: readonly string[] | undefined;
  titulos: readonly string[];
  /**
   * Cuántas veces han cambiado los títulos. Sólo el primer relevo se escalona:
   * en un plan de varios días los siguientes llegan a ráfagas de milisegundos y
   * reanimar la escalera en cada uno sería un parpadeo, no una coreografía.
   */
  relevos: number;
}

interface PropsEstadoGeneracion {
  slots: SlotComida[];
  /**
   * Lo último que ha dicho el motor. `undefined` mientras no haya dicho nada
   * —los primeros milisegundos, o un camino sin worker— y entonces sólo se da
   * por hecho el paso que calcula esta misma interfaz.
   */
  progreso?: Progreso | null;
  /**
   * El objetivo del día, si quien monta la pantalla ya lo tiene calculado.
   *
   * Es opcional a propósito: la cinta del compás 1 enseña **el reparto del
   * objetivo**, y sin ese dato la alternativa sería inventarse tres anchos.
   * Antes que eso, carril vacío.
   */
  objetivo?: ObjetivoNutricional | null;
}

export function EstadoGeneracion({ slots, progreso, objetivo }: PropsEstadoGeneracion) {
  const movimientoReducido = useMovimientoReducido();
  const [esperaLarga, setEsperaLarga] = useState(false);

  /**
   * Los títulos del último día que el motor ha cerrado.
   *
   * Hay que recordarlos porque el mensaje siguiente (`cuadre`) ya no los trae,
   * y una fila que recupera su nombre de plato para volver a perderlo se lee
   * como un fallo. Se hace con el patrón de «ajustar el estado cuando cambian
   * las props» —comparando contra la última lista vista, durante el render— y
   * no con un efecto: un `setState` dentro de un `useEffect` provoca un render
   * en cascada y es lo que React 19 desaconseja explícitamente.
   */
  const [memoriaTitulos, setMemoriaTitulos] = useState<MemoriaTitulos>({
    fuente: undefined,
    titulos: [],
    relevos: 0,
  });

  /**
   * Etapa en curso; todo lo anterior está hecho de verdad y nada posterior se
   * adelanta. Sin noticias del motor se asume la primera *empezada* —no
   * terminada—, que es lo único que se sabe con certeza en ese instante. Una
   * etapa que no reconozcamos cae en −1 y no marca nada, que es preferible a
   * inventarle una posición.
   */
  const enCursoIndice = progreso == null ? 0 : ETAPAS.indexOf(progreso.etapa);
  const deDias = progreso?.deDias ?? 1;
  const dia = progreso?.dia ?? 0;

  const titulosDelMotor = progreso?.titulos;
  const numeroDeSlots = slots.length;

  if (memoriaTitulos.fuente !== titulosDelMotor) {
    // El motor descarta los ids que la vista no sabe traducir, así que la lista
    // puede venir más corta que el día. Si no cuadra una a una no sabemos qué
    // título es de qué comida, y colocar el segundo plato en la primera fila es
    // peor que no enseñar ninguno: entonces se conserva lo último bueno.
    const siguientes =
      titulosDelMotor !== undefined && titulosDelMotor.length === numeroDeSlots
        ? titulosDelMotor
        : memoriaTitulos.titulos;
    setMemoriaTitulos({
      fuente: titulosDelMotor,
      titulos: siguientes,
      relevos: memoriaTitulos.relevos + (siguientes === memoriaTitulos.titulos ? 0 : 1),
    });
  }
  const titulos = memoriaTitulos.titulos;

  useEffect(() => {
    const id = window.setTimeout(() => setEsperaLarga(true), MS_ESPERA_LARGA);
    return () => window.clearTimeout(id);
  }, []);

  // Compás 2: sólo cuando el motor ha dicho que ya hay candidatas que barrer.
  const barriendo = enCursoIndice >= 1 && !movimientoReducido;

  // El escalonado del compás 3 se hace una vez, en el primer relevo de títulos.
  // No se ata a `progreso.dia` a propósito: el motor emite `porcionado` y
  // `cuadre` casi seguidos, React puede agruparlos en un solo render y entonces
  // la condición ya sería falsa cuando los títulos aparecen — la escalera no
  // llegaría a verse nunca.
  const escalonarTitulos = !movimientoReducido && memoriaTitulos.relevos <= 1;

  const anuncio =
    enCursoIndice < 0
      ? "Montando tu día."
      : `Paso ${enCursoIndice + 1} de ${PASOS.length}: ${PASOS[enCursoIndice]}` +
        (enCursoIndice === PASO_PORCIONADO && deDias > 1
          ? `, día ${dia + 1} de ${deDias}.`
          : ".");

  return (
    <section
      aria-busy="true"
      className="mx-auto w-full max-w-[420px] rounded-[var(--radius-lg)] bg-surface p-4 sm:p-6"
    >
      {/* Compás 1. La cinta de macros es el sitio exacto donde va a aparecer la
          barra del día: la altura se reserva, no hay salto de layout. Con
          objetivo enseña su reparto al 25 %; sin él, carril vacío. */}
      {objetivo ? (
        <div
          aria-hidden="true"
          className={`${estilos.cintaObjetivo} flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-surface-3`}
        >
          {segmentos(repartoDelObjetivo(objetivo)).map((parte) => (
            <div
              key={parte.clave}
              style={{
                flexGrow: parte.fraccion,
                flexBasis: 0,
                minWidth: parte.fraccion > 0 ? 3 : 0,
                backgroundColor: parte.color,
              }}
            />
          ))}
        </div>
      ) : (
        <div className="h-2.5 w-full rounded-full bg-surface-3" />
      )}

      {/* Una fila por comida, con la altura exacta de las filas de item que
          vendrán después. Las dos líneas se dibujan desde el principio aunque
          la de abajo esté vacía: así el título del compás 3 aterriza en su
          sitio sin mover el nombre del slot ni un píxel. */}
      <ul className="mt-6 flex flex-col gap-2">
        {slots.map((slot, indice) => {
          const titulo = titulos[indice];
          const cuajada = titulo !== undefined && titulo !== "";
          return (
            <li
              key={slot}
              className={`${estilos.filaEsqueleto} relative flex h-[72px] flex-col justify-center gap-1 overflow-hidden rounded-[var(--radius-sm)] px-3`}
            >
              {/* El barrido es una capa aparte, no el fondo de la fila. Así,
                  cuando llega el título, se retira con una opacidad de 150 ms
                  en vez de congelarse a mitad de recorrido: cortar un degradado
                  en seco se ve como un fallo de renderizado (§5.4, regla 2 de
                  honestidad temporal). Cuesta menos que los 300 ms que la
                  regla concede para terminar el ciclo, y resuelve lo mismo. */}
              {barriendo && (
                <span
                  aria-hidden="true"
                  className={`${estilos.barrido} ${cuajada ? estilos.barridoRetirado : ""}`}
                  style={{ animationDelay: `${indice * MS_DESFASE_BARRIDO}ms` }}
                />
              )}

              <span className="relative text-[13px] font-medium text-text-3">
                {NOMBRE_SLOT[slot]}
              </span>

              <span className="relative block min-h-[22px] text-pretty text-[16px] font-semibold leading-[22px]">
                {cuajada && (
                  <span
                    className={escalonarTitulos ? estilos.tituloCuaja : undefined}
                    style={
                      escalonarTitulos
                        ? { animationDelay: `${indice * MS_DESFASE_TITULO}ms` }
                        : undefined
                    }
                  >
                    {titulo}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Los cuatro pasos. Se leen, no se anuncian: la lista entera cambiaría
          de contenido en cada etapa y un lector de pantalla la releería de
          arriba abajo cuatro veces. Lo que se anuncia es la frase de abajo. */}
      <ol className="mt-6 flex flex-col gap-2">
        {PASOS.map((paso, indice) => {
          const hecho = indice < enCursoIndice;
          const enCurso = indice === enCursoIndice;
          return (
            <li
              key={paso}
              className={`flex items-center gap-2 text-sm ${
                hecho || enCurso ? "text-text-2" : "text-text-3"
              }`}
            >
              <span
                aria-hidden="true"
                className={`grid size-4 shrink-0 place-items-center rounded-full border ${
                  hecho
                    ? "border-brand bg-brand text-on-brand"
                    : enCurso
                      ? "border-brand"
                      : "border-line-strong"
                }`}
              >
                {hecho && (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m5 13 5 5 9-11" />
                  </svg>
                )}
              </span>
              {paso}
              {/* El día sólo se dice cuando hay más de uno: «día 1 de 1» es
                  ruido con pinta de dato. */}
              {indice === PASO_PORCIONADO && enCurso && deDias > 1 && (
                <span className="tabular-nums text-text-3" data-numeric>
                  · día {dia + 1} de {deDias}
                </span>
              )}
              {hecho && <span className="sr-only">(hecho)</span>}
              {enCurso && <span className="sr-only">(en curso)</span>}
            </li>
          );
        })}
      </ol>

      {/* Única región viva de la pantalla, y dice una frase corta por cambio.
          Anuncia exactamente lo mismo con movimiento reducido que sin él. */}
      <div role="status" aria-live="polite">
        <p className="sr-only">{anuncio}</p>
        {esperaLarga && (
          <p className="mt-4 text-sm leading-relaxed text-text-2">
            Sigue en marcha. A veces el día cuesta más de cuadrar.
          </p>
        )}
      </div>
    </section>
  );
}
