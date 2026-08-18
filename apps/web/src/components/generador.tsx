"use client";

/**
 * Generador público. Sin registro, sin navegación, resultado en la misma
 * pantalla.
 *
 * El principio que manda aquí es «resultado antes que formulario»
 * (docs/spec.md §9.1.1): cada pantalla que se interpone antes del primer plan
 * es conversión que se pierde y, sobre todo, es una promesa que el usuario aún
 * no tiene motivos para creer.
 *
 * Decisiones que no son de estilo:
 *
 * · **Es un formulario de verdad.** `<form method="get" action="…/plan/">` con
 *   `<label>` reales asociados a cada campo. Con JavaScript el día se genera
 *   aquí mismo, sin salir de la página; sin JavaScript el navegador envía por
 *   GET y aterriza en `/plan` con el perfil en la URL.
 *
 *   Eso ya no devuelve un plan, y hay que decirlo con todas las letras: desde
 *   que el motor corre en el navegador (`packages/motor`) no hay servidor que
 *   pueda montar el día, así que `/plan` sin JavaScript enseña un `<noscript>`
 *   que lo explica. Se conserva el envío por GET porque llevar al usuario a una
 *   página que le dice la verdad —con sus datos ya en la URL, listos para
 *   cuando active JavaScript— es mejor que un botón que no hace nada.
 * · **Los campos vienen rellenos con valores medianos.** El usuario corrige, no
 *   rellena. Eso quita el pánico de la página en blanco y hace que el botón sea
 *   pulsable desde el primer instante.
 * · **Se valida al perder el foco, nunca al teclear.** Corregir a alguien
 *   mientras escribe su peso es la peor manera de recibirle.
 * · **El asistente por pasos es una mejora progresiva, no el formulario.**
 *   Los cuatro pasos viven SIEMPRE en el DOM, dentro del mismo `<form>`: lo
 *   único que cambia entre el modo sin JavaScript y el modo con JavaScript es
 *   si se ocultan con `hidden` o no. `hidden` no saca un campo del envío —sólo
 *   `disabled` lo haría—, así que el GET de reserva sigue llevando el
 *   formulario completo aunque el asistente nunca haya llegado a montarse.
 *   Sin eso, "más dinámico" se pagaría con el propio fallback que este
 *   componente existe para proteger.
 */

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { Alergeno, ObjetivoNutricional } from "@planeat/shared";

import { ALIMENTOS } from "@/lib/alimentos";
import { kcal as formatearKcal } from "@/lib/formato";
import { useGeneracion } from "@/lib/generar";
import {
  ACTIVIDADES,
  DIETAS,
  FORMULARIO_POR_DEFECTO,
  NOMBRE_ALERGENO,
  OBJETIVOS,
  SEXOS,
  calcularObjetivoDelDia,
  hayErrores,
  slotsDe,
  validar,
  type CampoFormulario,
  type DatosFormulario,
  type ErroresFormulario,
} from "@/lib/perfil";
import type { ResultadoPlan } from "@/lib/tipos";

import { CampoAutocompletar } from "./campo-autocompletar";
import { EstadoGeneracion } from "./estado-generacion";
import { IconoFlecha } from "./iconos";
import estilos from "./planeat.module.css";
import { VistaPlan } from "./vista-plan";

const ALERGENOS_OPCIONES = Object.entries(NOMBRE_ALERGENO).map(([valor, etiqueta]) => ({
  valor: valor as Alergeno,
  etiqueta,
}));

const ALIMENTOS_OPCIONES = ALIMENTOS.map((a) => ({ valor: a.id, etiqueta: a.nombre }));

const COMIDAS_OPCIONES = [
  { valor: "3", etiqueta: "3" },
  { valor: "4", etiqueta: "4" },
  { valor: "5", etiqueta: "5" },
] as const;

/**
 * Falso en el servidor y en el primer pintado del cliente; verdadero a
 * partir de ahí. Con `useSyncExternalStore` y no con `useState` + `useEffect`
 * —el mismo motivo que `useMovimientoReducido` en `lib/memoria-plegado.ts`—:
 * no hay nada externo a lo que suscribirse, sólo dos fotografías distintas
 * (servidor vs. cliente), que es justo lo que ese tercer argumento resuelve
 * sin disparar un `setState` dentro de un efecto.
 */
function useHidratado(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

type Fase = "formulario" | "esperando" | "resultado";

interface Paso {
  id: string;
  titulo: string;
  /** Campos que este paso valida antes de dejar avanzar. */
  campos: readonly CampoFormulario[];
}

const PASOS: readonly Paso[] = [
  { id: "perfil", titulo: "Tu perfil", campos: ["edad", "altura", "peso"] },
  { id: "movimiento", titulo: "Movimiento y objetivo", campos: [] },
  { id: "dieta", titulo: "Cómo comes", campos: [] },
  { id: "evitas", titulo: "Qué evitas", campos: [] },
];

export function Generador() {
  const idBase = useId();
  const [datos, setDatos] = useState<DatosFormulario>(FORMULARIO_POR_DEFECTO);
  const [errores, setErrores] = useState<ErroresFormulario>({});
  const [fase, setFase] = useState<Fase>("formulario");
  const [resultado, setResultado] = useState<ResultadoPlan | null>(null);
  const [objetivo, setObjetivo] = useState<ObjetivoNutricional | null>(null);
  const { mostrarEsqueleto, progreso, generar } = useGeneracion();

  // Modo asistente: falso hasta que React se hidrata. En el primer pintado
  // —con o sin JavaScript— los cuatro pasos están todos visibles y apilados,
  // que es el propio fallback (ver comentario de cabecera). Sólo después de
  // montar se activan `hidden`, la barra de progreso y los botones Atrás/
  // Siguiente. El salto de "cuatro tarjetas" a "una tarjeta" que eso produce
  // dura un fotograma y es el precio de que el modo sin JavaScript exista de
  // verdad, no una aproximación.
  const hidratado = useHidratado();
  const [paso, setPaso] = useState(0);
  // De dónde "viene" la tarjeta que entra: la lee `.paso` en línea, en el
  // `style` del contenedor, así que tiene que ser estado —no un ref, que no
  // se puede leer durante el render— y cambia en el mismo evento que mueve
  // `paso`, así que React los agrupa en un solo repintado.
  const [direccion, setDireccion] = useState<"adelante" | "atras">("adelante");

  const formulario = useRef<HTMLFormElement>(null);
  const zonaResultado = useRef<HTMLDivElement>(null);
  const pasoActivoRef = useRef<HTMLHeadingElement>(null);
  const montado = useRef(false);

  // El foco sigue al paso activo, igual que ya sigue al resultado más abajo
  // —pero no en el primer render: robarle el foco a la página nada más
  // cargar sería peor que no anunciar nada.
  useEffect(() => {
    if (!montado.current) {
      montado.current = true;
      return;
    }
    pasoActivoRef.current?.focus();
  }, [paso]);

  const { objetivo: objetivoPrevisto, sueloAplicado } = calcularObjetivoDelDia(datos);
  const actividad = ACTIVIDADES.find((a) => a.valor === datos.actividad)!;

  const cambiar = <C extends CampoFormulario>(campo: C, valor: DatosFormulario[C]) => {
    setDatos((previos) => ({ ...previos, [campo]: valor }));
    // Un campo que se corrige deja de estar en error de inmediato: mantener el
    // mensaje mientras el usuario arregla lo que le hemos pedido es hostil.
    setErrores((previos) => ({ ...previos, [campo]: undefined }));
  };

  const validarCampo = (campo: CampoFormulario) => {
    const nuevos = validar(datos);
    setErrores((previos) => ({ ...previos, [campo]: nuevos[campo] }));
  };

  const irA = (indice: number, sentido: "adelante" | "atras") => {
    setDireccion(sentido);
    setPaso(indice);
  };

  const irSiguiente = () => {
    const campos = PASOS[paso]!.campos;
    if (campos.length > 0) {
      const encontrados = validar(datos);
      const propios = Object.fromEntries(
        campos.map((campo) => [campo, encontrados[campo]]),
      ) as ErroresFormulario;
      setErrores((previos) => ({ ...previos, ...propios }));
      if (campos.some((campo) => propios[campo])) {
        formulario.current
          ?.querySelector<HTMLElement>(`[name="${campos.find((c) => propios[c])}"]`)
          ?.focus();
        return;
      }
    }
    irA(paso + 1, "adelante");
  };

  const enviar = async (evento: React.FormEvent<HTMLFormElement>) => {
    evento.preventDefault();

    const encontrados = validar(datos);
    setErrores(encontrados);
    if (hayErrores(encontrados)) {
      // El foco va al primer campo inválido, en orden visual — y si ese
      // campo vive en un paso que no es el activo, el asistente salta ahí
      // primero: sólo `edad`/`altura`/`peso` pueden fallar, y viven en el
      // paso 0, así que basta con volver a él.
      const primero = (Object.keys(encontrados) as CampoFormulario[])[0]!;
      if (hidratado && paso !== 0) irA(0, "atras");
      window.requestAnimationFrame(() => {
        formulario.current
          ?.querySelector<HTMLElement>(`[name="${primero}"]`)
          ?.focus();
      });
      return;
    }

    setFase("esperando");

    // `generar` no lanza: todo desenlace, incluido el fallo del motor, vuelve
    // como un `ResultadoPlan`. Por eso aquí no hay `try`: no habría nada que
    // capturar, y un `catch` vacío sólo serviría para esconder un fallo real.
    const { resultado: generado, objetivo: usado } = await generar({ datos });

    setResultado(generado);
    setObjetivo(usado);
    setFase("resultado");
    // Tras cambiar de vista, el foco va al contenido nuevo.
    window.requestAnimationFrame(() => zonaResultado.current?.focus());
  };

  const idDe = (campo: string) => `${idBase}-${campo}`;
  const esUltimoPaso = paso === PASOS.length - 1;
  const erroresDelPaso = PASOS[paso]!.campos.filter((campo) => errores[campo]);

  return (
    <div className="flex flex-col gap-8">
      <form ref={formulario} method="get" action="/plan" onSubmit={enviar}>
        {hidratado && (
          <BarraProgreso
            pasoActual={paso}
            pasos={PASOS}
            alIrA={(indice) => irA(indice, indice < paso ? "atras" : "adelante")}
          />
        )}

        <div
          className="rounded-[var(--radius-lg)] bg-surface p-5 shadow-[var(--shadow-pop)] sm:p-8"
          style={{ ["--paso-desde" as string]: direccion === "adelante" ? "16px" : "-16px" }}
        >
          <div hidden={hidratado && paso !== 0} className={hidratado ? estilos.paso : undefined}>
            <PasoCampo titulo="Tu perfil" activo={hidratado && paso === 0} refTitulo={pasoActivoRef}>
              <div className="flex flex-col gap-5">
                <CampoPildoras
                  id={idDe("sexo")}
                  etiqueta="Sexo"
                  name="sexo"
                  valor={datos.sexo}
                  opciones={SEXOS}
                  alCambiar={(valor) => cambiar("sexo", valor as DatosFormulario["sexo"])}
                />

                <div className="grid grid-cols-3 gap-3">
                  <CampoNumeroTarjeta
                    id={idDe("edad")}
                    name="edad"
                    etiqueta="Edad"
                    sufijo="años"
                    valor={datos.edad}
                    error={errores.edad}
                    alCambiar={(valor) => cambiar("edad", valor)}
                    alSalir={() => validarCampo("edad")}
                  />
                  <CampoNumeroTarjeta
                    id={idDe("altura")}
                    name="altura"
                    etiqueta="Altura"
                    sufijo="cm"
                    valor={datos.altura}
                    error={errores.altura}
                    alCambiar={(valor) => cambiar("altura", valor)}
                    alSalir={() => validarCampo("altura")}
                  />
                  <CampoNumeroTarjeta
                    id={idDe("peso")}
                    name="peso"
                    etiqueta="Peso"
                    sufijo="kg"
                    valor={datos.peso}
                    error={errores.peso}
                    alCambiar={(valor) => cambiar("peso", valor)}
                    alSalir={() => validarCampo("peso")}
                  />
                </div>
              </div>
            </PasoCampo>
          </div>

          <div hidden={hidratado && paso !== 1} className={hidratado ? estilos.paso : undefined}>
            <PasoCampo
              titulo="Movimiento y objetivo"
              activo={hidratado && paso === 1}
              refTitulo={pasoActivoRef}
              separador={!hidratado}
            >
              <div className="flex flex-col gap-6">
                <div>
                  <p className="etiqueta text-text-3">¿Cuánto te mueves?</p>
                  <div className="mt-2">
                    <CampoPildoras
                      id={idDe("actividad")}
                      etiqueta="Nivel de actividad"
                      name="actividad"
                      valor={datos.actividad}
                      opciones={ACTIVIDADES}
                      alCambiar={(valor) =>
                        cambiar("actividad", valor as DatosFormulario["actividad"])
                      }
                    />
                  </div>
                  {/* Microcopy de calibración, justo donde está el sesgo: la
                      gente elige la semana que le gustaría tener, no la que
                      tiene. */}
                  <p className="mt-3 text-sm leading-relaxed text-text-2">
                    <span className="font-medium text-text">{actividad.ayuda}.</span>{" "}
                    Elige tu semana típica, no la más ambiciosa.
                  </p>
                </div>

                <div>
                  <p className="etiqueta text-text-3">¿Qué quieres conseguir?</p>
                  <div className="mt-2">
                    <CampoPildoras
                      id={idDe("objetivo")}
                      etiqueta="Objetivo"
                      name="objetivo"
                      valor={datos.objetivo}
                      opciones={OBJETIVOS}
                      alCambiar={(valor) =>
                        cambiar("objetivo", valor as DatosFormulario["objetivo"])
                      }
                    />
                  </div>
                </div>
              </div>
            </PasoCampo>
          </div>

          <div hidden={hidratado && paso !== 2} className={hidratado ? estilos.paso : undefined}>
            <PasoCampo
              titulo="Cómo comes"
              activo={hidratado && paso === 2}
              refTitulo={pasoActivoRef}
              separador={!hidratado}
            >
              <div className="flex flex-col gap-6">
                <div>
                  <p className="etiqueta text-text-3">¿Qué tipo de dieta sigues?</p>
                  <div className="mt-2">
                    <CampoPildoras
                      id={idDe("dieta")}
                      etiqueta="Tipo de dieta"
                      name="dieta"
                      valor={datos.dieta}
                      opciones={DIETAS}
                      alCambiar={(valor) => cambiar("dieta", valor as DatosFormulario["dieta"])}
                    />
                  </div>
                </div>

                <div>
                  <p className="etiqueta text-text-3">¿En cuántas comidas repartes el día?</p>
                  <div className="mt-2">
                    <CampoPildoras
                      id={idDe("comidas")}
                      etiqueta="Comidas al día"
                      name="comidas"
                      valor={String(datos.comidas)}
                      opciones={COMIDAS_OPCIONES}
                      alCambiar={(valor) => cambiar("comidas", Number(valor))}
                    />
                  </div>
                </div>
              </div>
            </PasoCampo>
          </div>

          <div hidden={hidratado && paso !== 3} className={hidratado ? estilos.paso : undefined}>
            <PasoCampo
              titulo="Qué evitas"
              activo={hidratado && paso === 3}
              refTitulo={pasoActivoRef}
              separador={!hidratado}
            >
              <div>
                <p className="text-sm text-text-2">
                  Filtra por seguridad alimentaria, no sustituye leer la etiqueta
                  del producto que compres.
                </p>

                <div className="mt-4">
                  <label htmlFor={idDe("alergenos")} className="text-sm font-medium text-text-2">
                    Alergias e intolerancias
                  </label>
                  <div className="mt-1.5" id={idDe("alergenos")}>
                    <CampoAutocompletar
                      name="alergeno"
                      etiqueta="Buscar un alérgeno a excluir"
                      placeholder="Escribe para buscar, por ejemplo «lácteos»…"
                      opciones={ALERGENOS_OPCIONES}
                      seleccionados={datos.alergenosExcluidos}
                      alCambiar={(nuevos) => cambiar("alergenosExcluidos", nuevos as Alergeno[])}
                    />
                  </div>
                </div>

                <div className="mt-5">
                  <label htmlFor={idDe("evitar")} className="text-sm font-medium text-text-2">
                    Otros alimentos que evitas
                  </label>
                  <div className="mt-1.5" id={idDe("evitar")}>
                    <CampoAutocompletar
                      name="evitar"
                      etiqueta="Buscar un alimento a evitar"
                      placeholder="Escribe para buscar, por ejemplo «camarón»…"
                      opciones={ALIMENTOS_OPCIONES}
                      seleccionados={datos.ingredientesExcluidos}
                      alCambiar={(nuevos) => cambiar("ingredientesExcluidos", nuevos)}
                    />
                  </div>
                </div>
              </div>
            </PasoCampo>
          </div>

          {/* Los errores del paso activo, nunca los de un paso oculto: un
              mensaje sobre un campo que no se ve no se puede corregir. */}
          {erroresDelPaso.length > 0 && (
            <div role="alert" className="mt-6 flex flex-col gap-1">
              {erroresDelPaso.map((campo) => (
                <p key={campo} className="text-[15px] leading-snug text-danger">
                  {errores[campo]}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Lo que se va a pedir, antes de pedirlo. Nunca un número sin su
            conclusión al lado. Vive fuera de las tarjetas de paso: es la
            única franja que no cambia al navegar el asistente. */}
        <p className="mt-6 text-sm leading-relaxed text-text-2">
          Con esos datos tu día sale en{" "}
          <span className="font-semibold tabular-nums text-text" data-numeric>
            ≈ {formatearKcal(objetivoPrevisto.kcal)} kcal
          </span>{" "}
          repartidas en {slotsDe(datos).length} comidas. Son estimaciones a partir
          de fórmulas poblacionales (Mifflin-St Jeor). No son consejo médico.
        </p>

        {sueloAplicado && (
          <p className="mt-3 text-sm leading-relaxed text-warning">
            Tu objetivo salía por debajo del suelo de seguridad. Lo dejo ahí:
            bajar más no es seguro sin supervisión médica.
          </p>
        )}

        <div className="mt-6 flex items-center gap-3">
          {hidratado && paso > 0 && (
            <button
              type="button"
              onClick={() => irA(paso - 1, "atras")}
              className={`${estilos.pulsable} flex h-13 min-h-13 shrink-0 items-center gap-2 rounded-[var(--radius)] border border-line-strong px-5 text-[17px] font-medium text-text hover:bg-surface-2`}
            >
              <IconoFlecha tam={18} className="rotate-180" />
              Atrás
            </button>
          )}

          {hidratado && !esUltimoPaso ? (
            <button
              type="button"
              onClick={irSiguiente}
              className={`${estilos.pulsable} flex h-13 min-h-13 flex-1 items-center justify-center gap-2 rounded-[var(--radius)] bg-brand px-6 text-[17px] font-semibold text-on-brand hover:bg-brand-hover`}
            >
              Siguiente
              <IconoFlecha tam={18} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={fase === "esperando"}
              className={`${estilos.pulsable} flex h-13 min-h-13 flex-1 items-center justify-center rounded-[var(--radius)] bg-brand px-6 text-[17px] font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60`}
            >
              {fase === "esperando" ? "Montando tu día…" : "Ver mi día"}
            </button>
          )}
        </div>

        <p className="mt-3 text-center text-sm text-text-2">
          Sin registro. Tarda unos segundos.
        </p>
      </form>

      {/* El resultado se monta aquí, en el sitio exacto donde va a aparecer.
          No hay navegación, no hay cambio de URL, no hay salto de layout. */}
      <div ref={zonaResultado} tabIndex={-1} className="scroll-mt-6 outline-none">
        {mostrarEsqueleto && (
          <EstadoGeneracion slots={slotsDe(datos)} progreso={progreso} objetivo={objetivoPrevisto} />
        )}

        {fase === "resultado" && resultado && objetivo && (
          <VistaPlan
            datos={datos}
            resultado={resultado}
            objetivo={objetivo}
            animarCuadre
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estructura del asistente
// ---------------------------------------------------------------------------

interface PropsBarraProgreso {
  pasoActual: number;
  pasos: readonly Paso[];
  alIrA: (indice: number) => void;
}

/**
 * Los pasos ya completados son pulsables —volver atrás no debería costar
 * pulsar "Atrás" tantas veces como pasos se avanzaron—, pero nunca los
 * futuros: no hay nada que revisar en un paso que no se ha rellenado
 * todavía, y dejarlo pulsable invitaría a saltarse la validación del paso 0.
 */
function BarraProgreso({ pasoActual, pasos, alIrA }: PropsBarraProgreso) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between">
        <p className="etiqueta text-text-3">
          Paso {pasoActual + 1} de {pasos.length}
        </p>
        <p className="etiqueta text-text-3">{pasos[pasoActual]!.titulo}</p>
      </div>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={pasos.length}
        aria-valuenow={pasoActual + 1}
        aria-valuetext={`Paso ${pasoActual + 1} de ${pasos.length}: ${pasos[pasoActual]!.titulo}`}
        className="mt-2 flex h-1.5 gap-1.5"
      >
        {pasos.map((paso, indice) => (
          <button
            key={paso.id}
            type="button"
            disabled={indice > pasoActual}
            onClick={() => alIrA(indice)}
            aria-label={`Ir al paso ${indice + 1}: ${paso.titulo}`}
            className={`${estilos.progresoRelleno} h-full flex-1 rounded-full ${
              indice <= pasoActual ? "bg-brand" : "bg-surface-3"
            } ${indice < pasoActual ? "cursor-pointer" : indice === pasoActual ? "" : "cursor-default"}`}
          />
        ))}
      </div>
    </div>
  );
}

interface PropsPasoCampo {
  titulo: string;
  activo: boolean;
  refTitulo: React.RefObject<HTMLHeadingElement | null>;
  /** Divisor superior: sólo hace falta cuando los cuatro pasos están
      apilados (fallback sin JavaScript) — en el asistente sólo hay una
      tarjeta visible y no hay nada de lo que separarse. */
  separador?: boolean;
  children: React.ReactNode;
}

function PasoCampo({ titulo, activo, refTitulo, separador = false, children }: PropsPasoCampo) {
  return (
    <div className={separador ? "border-t border-line pt-6 sm:pt-7" : undefined}>
      <h3 ref={activo ? refTitulo : undefined} tabIndex={-1} className="t-2 outline-none">
        {titulo}
      </h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------

interface PropsCampoNumeroTarjeta {
  id: string;
  name: string;
  etiqueta: string;
  sufijo: string;
  valor: number;
  error?: string;
  alCambiar: (valor: number) => void;
  alSalir: () => void;
}

/**
 * Campo numérico en formato tarjeta: etiqueta visible arriba, cifra grande
 * centrada, sufijo debajo. Sustituye al campo embebido en la frase —ya no hay
 * frase— pero conserva el subrayado que se refuerza al enfocar
 * (`.campoEnLinea`) y el `inputMode="numeric"` que saca el teclado numérico en
 * móvil sin la pesadilla de accesibilidad de `type="number"`.
 */
function CampoNumeroTarjeta({
  id,
  name,
  etiqueta,
  sufijo,
  valor,
  error,
  alCambiar,
  alSalir,
}: PropsCampoNumeroTarjeta) {
  return (
    <div>
      <label htmlFor={id} className="etiqueta block text-center text-text-3">
        {etiqueta}
      </label>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={Number.isFinite(valor) ? String(valor) : ""}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(evento) => {
          const limpio = evento.target.value.replace(/[^\d]/g, "").slice(0, 3);
          alCambiar(limpio === "" ? Number.NaN : Number.parseInt(limpio, 10));
        }}
        onBlur={alSalir}
        className={`${estilos.campoEnLinea} mt-1 h-12 w-full bg-transparent text-center text-2xl font-semibold tabular-nums text-text ${
          error ? "border-b-danger" : ""
        }`}
        data-numeric
      />
      <p className="mt-1 text-center text-sm text-text-3">{sufijo}</p>
      {error && (
        <p id={`${id}-error`} className="sr-only">
          {error}
        </p>
      )}
    </div>
  );
}

interface PropsCampoPildoras {
  id: string;
  etiqueta: string;
  name: string;
  valor: string;
  opciones: readonly { valor: string; etiqueta: string }[];
  alCambiar: (valor: string) => void;
}

/**
 * Elección única como radios vestidos de píldora. Mismo patrón accesible que
 * la selección múltiple de `CampoAutocompletar` —`input` real oculto, el foco
 * se dibuja en la etiqueta—, pero de selección única: la marcada lleva el
 * color de marca a fondo lleno, no el tinte suave, para que se lea como "la
 * respuesta" y no como "un filtro activado".
 *
 * Reemplaza al `<select>` nativo de la versión en prosa: fuera de una frase,
 * un grupo de píldoras se lee y se toca mejor que un desplegable, y no
 * necesita el gemelo invisible que el `<select>` usaba para no arrastrar su
 * ancho a la opción más larga.
 */
function CampoPildoras({ id, etiqueta, name, valor, opciones, alCambiar }: PropsCampoPildoras) {
  return (
    <div id={id} role="radiogroup" aria-label={etiqueta} className="flex flex-wrap gap-2">
      {opciones.map((opcion) => {
        const marcado = opcion.valor === valor;
        return (
          <label
            key={opcion.valor}
            className={`${estilos.pildora} ${estilos.pulsable} flex min-h-11 cursor-pointer items-center rounded-[var(--radius)] border px-4 text-[15px] font-medium has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand ${
              marcado
                ? "border-brand bg-brand text-on-brand"
                : "border-line bg-surface text-text-2 hover:border-line-strong"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={opcion.valor}
              checked={marcado}
              onChange={() => alCambiar(opcion.valor)}
              className="sr-only"
            />
            {opcion.etiqueta}
          </label>
        );
      })}
    </div>
  );
}
