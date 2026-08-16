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
 * · **La prosa es la interfaz.** Los campos van embebidos en una frase, no
 *   apilados en una columna de etiquetas. Las etiquetas existen, están
 *   asociadas y están ocultas visualmente: un lector de pantalla oye "Edad",
 *   no "campo de texto".
 * · **Se valida al perder el foco, nunca al teclear.** Corregir a alguien
 *   mientras escribe su peso es la peor manera de recibirle.
 */

import { useId, useRef, useState } from "react";
import type { ObjetivoNutricional } from "@planeat/shared";

import { kcal as formatearKcal } from "@/lib/formato";
import { useGeneracion } from "@/lib/generar";
import {
  ACTIVIDADES,
  DIETAS,
  FORMULARIO_POR_DEFECTO,
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
import { rutaDe } from "@/lib/rutas";
import type { ResultadoPlan } from "@/lib/tipos";

import { EstadoGeneracion } from "./estado-generacion";
import estilos from "./planeat.module.css";
import { VistaPlan } from "./vista-plan";

type Fase = "formulario" | "esperando" | "resultado";

export function Generador() {
  const idBase = useId();
  const [datos, setDatos] = useState<DatosFormulario>(FORMULARIO_POR_DEFECTO);
  const [errores, setErrores] = useState<ErroresFormulario>({});
  const [fase, setFase] = useState<Fase>("formulario");
  const [resultado, setResultado] = useState<ResultadoPlan | null>(null);
  const [objetivo, setObjetivo] = useState<ObjetivoNutricional | null>(null);
  const { mostrarEsqueleto, progreso, generar } = useGeneracion();

  const formulario = useRef<HTMLFormElement>(null);
  const zonaResultado = useRef<HTMLDivElement>(null);

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

  const enviar = async (evento: React.FormEvent<HTMLFormElement>) => {
    evento.preventDefault();

    const encontrados = validar(datos);
    setErrores(encontrados);
    if (hayErrores(encontrados)) {
      // El foco va al primer campo inválido, en orden visual.
      const primero = (Object.keys(encontrados) as CampoFormulario[])[0];
      formulario.current
        ?.querySelector<HTMLElement>(`[name="${primero}"]`)
        ?.focus();
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
  const erroresVisibles = (Object.keys(errores) as CampoFormulario[]).filter(
    (campo) => errores[campo],
  );

  return (
    <div className="flex flex-col gap-8">
      <form
        ref={formulario}
        method="get"
        action={rutaDe("/plan")}
        onSubmit={enviar}
        className="rounded-[var(--radius-lg)] bg-surface p-5 sm:p-8"
      >
        {/* Tres grupos con micro-etiqueta y divisor, no tres párrafos sueltos:
            la prosa sigue siendo el campo (§9.1.1), pero necesita bordes
            visibles para leerse como tres preguntas y no como un bloque. */}
        <div className="flex flex-col gap-6 sm:gap-7">
          <div>
            <p className="micro text-text-3">Tu perfil</p>
            <p className="mt-2 text-xl leading-[2.1] sm:text-2xl sm:leading-[2.2]">
              Soy{" "}
              <CampoElegir
                id={idDe("sexo")}
                name="sexo"
                etiqueta="Sexo"
                valor={datos.sexo}
                opciones={SEXOS}
                alCambiar={(valor) => cambiar("sexo", valor as DatosFormulario["sexo"])}
              />{" "}
              de{" "}
              <CampoNumero
                id={idDe("edad")}
                name="edad"
                etiqueta="Edad en años"
                valor={datos.edad}
                invalido={Boolean(errores.edad)}
                alCambiar={(valor) => cambiar("edad", valor)}
                alSalir={() => validarCampo("edad")}
              />{" "}
              años, mido{" "}
              <CampoNumero
                id={idDe("altura")}
                name="altura"
                etiqueta="Altura en centímetros"
                valor={datos.altura}
                invalido={Boolean(errores.altura)}
                alCambiar={(valor) => cambiar("altura", valor)}
                alSalir={() => validarCampo("altura")}
              />{" "}
              cm y peso{" "}
              <CampoNumero
                id={idDe("peso")}
                name="peso"
                etiqueta="Peso en kilogramos"
                valor={datos.peso}
                invalido={Boolean(errores.peso)}
                alCambiar={(valor) => cambiar("peso", valor)}
                alSalir={() => validarCampo("peso")}
              />{" "}
              kg.
            </p>
          </div>

          <div className="border-t border-line pt-6 sm:pt-7">
            <p className="micro text-text-3">Movimiento y objetivo</p>
            <p className="mt-2 text-xl leading-[2.1] sm:text-2xl sm:leading-[2.2]">
              Me muevo{" "}
              <CampoElegir
                id={idDe("actividad")}
                name="actividad"
                etiqueta="Nivel de actividad"
                valor={datos.actividad}
                opciones={ACTIVIDADES}
                alCambiar={(valor) =>
                  cambiar("actividad", valor as DatosFormulario["actividad"])
                }
              />{" "}
              y quiero{" "}
              <CampoElegir
                id={idDe("objetivo")}
                name="objetivo"
                etiqueta="Objetivo"
                valor={datos.objetivo}
                opciones={OBJETIVOS}
                alCambiar={(valor) => cambiar("objetivo", valor as DatosFormulario["objetivo"])}
              />
              .
            </p>

            {/* Microcopy de calibración, justo donde está el sesgo: la gente
                elige la semana que le gustaría tener, no la que tiene. */}
            <p className="mt-3 text-sm leading-relaxed text-text-2">
              <span className="font-medium text-text">{actividad.ayuda}.</span>{" "}
              Elige tu semana típica, no la más ambiciosa.
            </p>
          </div>

          <div className="border-t border-line pt-6 sm:pt-7">
            <p className="micro text-text-3">Cómo comes</p>
            <p className="mt-2 text-xl leading-[2.1] sm:text-2xl sm:leading-[2.2]">
              Como{" "}
              <CampoElegir
                id={idDe("dieta")}
                name="dieta"
                etiqueta="Tipo de dieta"
                valor={datos.dieta}
                opciones={DIETAS}
                alCambiar={(valor) => cambiar("dieta", valor as DatosFormulario["dieta"])}
              />{" "}
              en{" "}
              <CampoElegir
                id={idDe("comidas")}
                name="comidas"
                etiqueta="Comidas al día"
                valor={String(datos.comidas)}
                opciones={[
                  { valor: "3", etiqueta: "3" },
                  { valor: "4", etiqueta: "4" },
                  { valor: "5", etiqueta: "5" },
                ]}
                alCambiar={(valor) => cambiar("comidas", Number(valor))}
              />{" "}
              comidas.
            </p>
          </div>
        </div>

        {/* Los errores aparecen bajo la frase completa, no bajo cada campo:
            partirían la prosa. Siempre proponen la corrección. */}
        {erroresVisibles.length > 0 && (
          <div role="alert" className="mt-6 flex flex-col gap-1">
            {erroresVisibles.map((campo) => (
              <p key={campo} className="text-[15px] leading-snug text-danger">
                {errores[campo]}
              </p>
            ))}
          </div>
        )}

        <button
          type="submit"
          disabled={fase === "esperando"}
          className={`${estilos.pulsable} mt-7 flex h-13 min-h-13 w-full items-center justify-center rounded-[var(--radius)] bg-brand px-6 text-[17px] font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60`}
        >
          {fase === "esperando" ? "Montando tu día…" : "Ver mi día"}
        </button>

        <p className="mt-3 text-center text-sm text-text-2">
          Sin registro. Tarda unos segundos.
        </p>

        {/* Lo que se va a pedir, antes de pedirlo. Nunca un número sin su
            conclusión al lado. */}
        <p className="mt-6 border-t border-line pt-4 text-sm leading-relaxed text-text-2">
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
// Campos
// ---------------------------------------------------------------------------

interface PropsCampoNumero {
  id: string;
  name: string;
  etiqueta: string;
  valor: number;
  invalido: boolean;
  alCambiar: (valor: number) => void;
  alSalir: () => void;
}

/**
 * Campo numérico embebido en la frase. Sin caja: un subrayado que se refuerza
 * al enfocar. `inputMode="numeric"` saca el teclado numérico en móvil sin la
 * pesadilla de accesibilidad de `type="number"` (rueda del ratón, flechas
 * fantasma y validación del navegador en otro idioma).
 */
function CampoNumero({
  id,
  name,
  etiqueta,
  valor,
  invalido,
  alCambiar,
  alSalir,
}: PropsCampoNumero) {
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {etiqueta}
      </label>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={Number.isFinite(valor) ? String(valor) : ""}
        aria-invalid={invalido || undefined}
        onChange={(evento) => {
          const limpio = evento.target.value.replace(/[^\d]/g, "").slice(0, 3);
          alCambiar(limpio === "" ? Number.NaN : Number.parseInt(limpio, 10));
        }}
        onBlur={alSalir}
        className={`${estilos.campoEnLinea} mx-0.5 inline-block h-11 w-[3.2ch] bg-transparent text-center font-semibold tabular-nums text-text ${
          invalido ? "border-b-danger" : ""
        }`}
        data-numeric
      />
    </>
  );
}

interface PropsCampoElegir {
  id: string;
  name: string;
  etiqueta: string;
  valor: string;
  opciones: readonly { valor: string; etiqueta: string }[];
  alCambiar: (valor: string) => void;
}

/**
 * Elección embebida en la frase. Es un `<select>` nativo a propósito: en móvil
 * abre la rueda del sistema, funciona con teclado y con lector de pantalla sin
 * una línea de código, y no hay ningún menú a medida que pueda quedarse a
 * medio implementar. La flecha se dibuja aparte porque `appearance: none`
 * quita la del sistema.
 */
function CampoElegir({ id, name, etiqueta, valor, opciones, alCambiar }: PropsCampoElegir) {
  return (
    <span className="relative mx-0.5 inline-grid max-w-full items-center align-middle">
      <label htmlFor={id} className="sr-only">
        {etiqueta}
      </label>
      {/* Un `<select>` se dimensiona por su opción más larga, así que "de todo"
          arrastraba el ancho de "bajo en carbohidratos" y dejaba un subrayado
          suelto en mitad de la frase. Este gemelo invisible lleva el texto de la
          opción elegida y es quien fija el ancho de la celda; el select se
          estira encima. Efecto: el subrayado mide lo que mide la palabra.

          `invisible` es `visibility: hidden`, no `display: none` ni `opacity: 0`,
          y las tres cosas son distintas aquí: sin ocupar espacio no dimensiona
          nada, y siendo transparente se seguiría viendo el texto duplicado
          detrás del select. Faltaba, y el resultado era que cada campo de la
          portada enseñaba su valor dos veces, ligeramente desplazado. */}
      <span
        aria-hidden="true"
        className="invisible col-start-1 row-start-1 h-11 whitespace-pre pr-5 font-semibold leading-[2.75rem]"
      >
        {opciones.find((opcion) => opcion.valor === valor)?.etiqueta ?? ""}
      </span>
      <select
        id={id}
        name={name}
        value={valor}
        onChange={(evento) => alCambiar(evento.target.value)}
        className={`${estilos.campoEnLinea} col-start-1 row-start-1 h-11 w-full max-w-full cursor-pointer appearance-none truncate bg-transparent pr-5 font-semibold text-text`}
      >
        {opciones.map((opcion) => (
          <option key={opcion.valor} value={opcion.valor} className="bg-surface text-text">
            {opcion.etiqueta}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-0.5 text-text-3"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}
