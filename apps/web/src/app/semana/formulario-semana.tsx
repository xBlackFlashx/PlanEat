"use client";

/**
 * Formulario de la semana Pro.
 *
 * A diferencia del asistente de la portada (`generador.tsx`), este es un
 * formulario de ajustes de una sola pantalla: quien llega aquí ya tiene
 * cuenta y ya sabe lo que quiere, no necesita que se lo guíen paso a paso.
 *
 * El formulario se queda montado tras generar —arriba del resultado— para
 * que ajustar y volver a pedir sea un solo tap, no una vuelta atrás.
 */

import { useState } from "react";

import { CampoAutocompletar } from "@/components/campo-autocompletar";
import estilos from "@/components/planeat.module.css";
import { PlanDia } from "@/components/plan-dia";
import { SinServicio } from "@/components/sin-servicio";
import { SobreRestriccion } from "@/components/sobre-restriccion";
import { ALIMENTOS, NOMBRE_CATEGORIA, alimentosPorCategoria } from "@/lib/alimentos";
import { CATEGORIAS_ALERGENO } from "@/lib/categorias-alergeno";
import { gramos } from "@/lib/formato";
import type { ItemListaCompra } from "@/lib/lista-compra";
import {
  ACTIVIDADES,
  DIETAS,
  FORMULARIO_POR_DEFECTO,
  NOMBRE_ALERGENO,
  OBJETIVOS,
  SEXOS,
  calcularObjetivoDelDia,
  hayErrores,
  validar,
  type AjustesObjetivo,
  type DatosFormulario,
  type ErroresFormulario,
} from "@/lib/perfil";
import type { MotivoSinServicio } from "@/lib/tipos";
import type { Alergeno } from "@planeat/shared";
import type { MotivoSinServicio as MotivoSinServicioMotor, ResultadoPlan } from "@planeat/motor";

interface Resultado {
  estado: ResultadoPlan;
  lista: ItemListaCompra[];
}

const ALERGENOS_OPCIONES = Object.entries(NOMBRE_ALERGENO).map(([valor, etiqueta]) => ({
  valor: valor as Alergeno,
  etiqueta,
}));

const ALIMENTOS_OPCIONES = ALIMENTOS.map((a) => ({ valor: a.id, etiqueta: a.nombre }));

/** Alimentos agrupados por la categoría real del catálogo (`alimento.categoria`,
 * la misma que agrupa `ListaCompra` más abajo), con el nombre legible de
 * `NOMBRE_CATEGORIA`. Nada de una taxonomía nueva: si el catálogo suma una
 * categoría, aparece sola en cuanto algún alimento la use. */
const CATEGORIAS_ALIMENTO: Record<string, readonly string[]> = Object.fromEntries(
  Array.from(alimentosPorCategoria(), ([categoria, alimentos]) => [
    NOMBRE_CATEGORIA[categoria] ?? categoria,
    alimentos.map((a) => a.id),
  ]),
);

interface PropsFilaCategorias<T extends string> {
  etiqueta: string;
  categorias: Record<string, readonly T[]>;
  seleccionados: readonly string[];
  alCambiar: (valores: T[]) => void;
}

/**
 * Chips de categoría encima de un `CampoAutocompletar`: pulsar una añade de
 * golpe TODOS sus miembros que aún falten (unión, sin duplicar los ya
 * elegidos); volver a pulsarla —cuando ya están los miembros completos— los
 * quita todos. No sustituye la búsqueda libre, que sigue debajo para casos
 * sueltos que no encajan en ninguna categoría.
 *
 * "Activa" significa "todos los miembros de la categoría están
 * seleccionados", no "alguno lo está": a medias no se lee como un filtro
 * aplicado, y `aria-pressed` tiene que decir la verdad de ese estado binario.
 */
function FilaCategorias<T extends string>({
  etiqueta,
  categorias,
  seleccionados,
  alCambiar,
}: PropsFilaCategorias<T>) {
  return (
    <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label={`Categorías rápidas de ${etiqueta}`}>
      {Object.entries(categorias).map(([nombre, miembros]) => {
        const activa = miembros.every((m) => seleccionados.includes(m));
        return (
          <button
            key={nombre}
            type="button"
            aria-pressed={activa}
            onClick={() => {
              if (activa) {
                alCambiar(seleccionados.filter((v) => !miembros.includes(v as T)) as T[]);
              } else {
                const faltantes = miembros.filter((m) => !seleccionados.includes(m));
                alCambiar([...seleccionados, ...faltantes] as T[]);
              }
            }}
            className={`${estilos.pulsable} flex min-h-9 items-center rounded-[var(--radius)] border px-3 text-sm font-medium hover:-translate-y-0.5 ${
              activa
                ? "border-brand bg-brand text-on-brand"
                : "border-line bg-surface text-text-2 hover:border-line-strong"
            }`}
          >
            {nombre}
          </button>
        );
      })}
    </div>
  );
}

export function FormularioSemana() {
  const [datos, setDatos] = useState<DatosFormulario>(FORMULARIO_POR_DEFECTO);
  const [errores, setErrores] = useState<ErroresFormulario>({});
  const [cargando, setCargando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function generar(datosAEnviar: DatosFormulario, ajustes?: AjustesObjetivo) {
    setCargando(true);
    setErrorGeneral(null);
    try {
      const respuesta = await fetch("/api/generar-semana", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ajustes ? { datos: datosAEnviar, ajustes } : { datos: datosAEnviar }),
      });
      const cuerpo = (await respuesta.json().catch(() => null)) as {
        estado?: ResultadoPlan;
        lista?: ItemListaCompra[];
        error?: string;
      } | null;

      if (!respuesta.ok || !cuerpo?.estado) {
        setErrorGeneral(cuerpo?.error ?? "No se pudo generar tu semana.");
        setResultado(null);
        return;
      }

      setResultado({ estado: cuerpo.estado, lista: cuerpo.lista ?? [] });
    } catch {
      setErrorGeneral("No he podido conectar. Comprueba tu conexión e inténtalo de nuevo.");
      setResultado(null);
    } finally {
      setCargando(false);
    }
  }

  function alEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    const erroresValidacion = validar(datos);
    setErrores(erroresValidacion);
    if (hayErrores(erroresValidacion)) return;
    void generar(datos);
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={alEnviar} className="rounded-[var(--radius-lg)] bg-surface p-6 sm:p-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text-2">Sexo</span>
            <select
              value={datos.sexo}
              onChange={(e) =>
                setDatos((d) => ({ ...d, sexo: e.target.value as DatosFormulario["sexo"] }))
              }
              className="h-12 rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-brand"
            >
              {SEXOS.map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>
                  {opcion.etiqueta}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text-2">Edad</span>
            <input
              type="number"
              value={datos.edad}
              onChange={(e) => setDatos((d) => ({ ...d, edad: Number(e.target.value) }))}
              className="h-12 rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-brand"
            />
            {errores.edad && (
              <span role="alert" className="text-sm text-danger">
                {errores.edad}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text-2">Altura (cm)</span>
            <input
              type="number"
              value={datos.altura}
              onChange={(e) => setDatos((d) => ({ ...d, altura: Number(e.target.value) }))}
              className="h-12 rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-brand"
            />
            {errores.altura && (
              <span role="alert" className="text-sm text-danger">
                {errores.altura}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text-2">Peso (kg)</span>
            <input
              type="number"
              value={datos.peso}
              onChange={(e) => setDatos((d) => ({ ...d, peso: Number(e.target.value) }))}
              className="h-12 rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-brand"
            />
            {errores.peso && (
              <span role="alert" className="text-sm text-danger">
                {errores.peso}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text-2">Actividad</span>
            <select
              value={datos.actividad}
              onChange={(e) =>
                setDatos((d) => ({
                  ...d,
                  actividad: e.target.value as DatosFormulario["actividad"],
                }))
              }
              className="h-12 rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-brand"
            >
              {ACTIVIDADES.map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>
                  {opcion.etiqueta} — {opcion.ayuda}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text-2">Objetivo</span>
            <select
              value={datos.objetivo}
              onChange={(e) =>
                setDatos((d) => ({ ...d, objetivo: e.target.value as DatosFormulario["objetivo"] }))
              }
              className="h-12 rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-brand"
            >
              {OBJETIVOS.map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>
                  {opcion.etiqueta}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text-2">Dieta</span>
            <select
              value={datos.dieta}
              onChange={(e) =>
                setDatos((d) => ({ ...d, dieta: e.target.value as DatosFormulario["dieta"] }))
              }
              className="h-12 rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-brand"
            >
              {DIETAS.map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>
                  {opcion.etiqueta}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text-2">Comidas al día</span>
            <select
              value={datos.comidas}
              onChange={(e) => setDatos((d) => ({ ...d, comidas: Number(e.target.value) }))}
              className="h-12 rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-brand"
            >
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
            </select>
          </label>
        </div>

        <div className="mt-6">
          <label className="text-sm font-medium text-text-2">Alergias e intolerancias</label>
          <div className="mt-1.5">
            <FilaCategorias
              etiqueta="alérgenos"
              categorias={CATEGORIAS_ALERGENO}
              seleccionados={datos.alergenosExcluidos}
              alCambiar={(nuevos) => setDatos((d) => ({ ...d, alergenosExcluidos: nuevos }))}
            />
            <CampoAutocompletar
              name="alergeno"
              etiqueta="Buscar un alérgeno a excluir"
              placeholder="Escribe para buscar, por ejemplo «lácteos»…"
              opciones={ALERGENOS_OPCIONES}
              seleccionados={datos.alergenosExcluidos}
              alCambiar={(nuevos) =>
                setDatos((d) => ({ ...d, alergenosExcluidos: nuevos as Alergeno[] }))
              }
            />
          </div>
        </div>

        <div className="mt-5">
          <label className="text-sm font-medium text-text-2">Otros alimentos que evitas</label>
          <div className="mt-1.5">
            <FilaCategorias
              etiqueta="alimentos"
              categorias={CATEGORIAS_ALIMENTO}
              seleccionados={datos.ingredientesExcluidos}
              alCambiar={(nuevos) => setDatos((d) => ({ ...d, ingredientesExcluidos: nuevos }))}
            />
            <CampoAutocompletar
              name="evitar"
              etiqueta="Buscar un alimento a evitar"
              placeholder="Escribe para buscar, por ejemplo «camarón»…"
              opciones={ALIMENTOS_OPCIONES}
              seleccionados={datos.ingredientesExcluidos}
              alCambiar={(nuevos) => setDatos((d) => ({ ...d, ingredientesExcluidos: nuevos }))}
            />
          </div>
        </div>

        {errorGeneral && (
          <p role="alert" className="mt-6 text-sm text-danger">
            {errorGeneral}
          </p>
        )}

        <button
          type="submit"
          disabled={cargando}
          className="mt-6 flex h-13 min-h-13 items-center justify-center rounded-[var(--radius)] bg-brand px-6 text-[17px] font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
        >
          {cargando ? "Generando tu semana…" : "Generar mi semana"}
        </button>
      </form>

      {resultado && (
        <ResultadoSemana
          resultado={resultado}
          datos={datos}
          cargando={cargando}
          alAplicarAjustes={(ajustes) => void generar(datos, ajustes)}
          alReintentar={() => void generar(datos)}
        />
      )}
    </div>
  );
}

interface PropsResultado {
  resultado: Resultado;
  datos: DatosFormulario;
  cargando: boolean;
  alAplicarAjustes: (ajustes: AjustesObjetivo) => void;
  alReintentar: () => void;
}

function ResultadoSemana({
  resultado,
  datos,
  cargando,
  alAplicarAjustes,
  alReintentar,
}: PropsResultado) {
  const estado = resultado.estado;

  if (estado.estado === "ok") {
    return (
      <div className="flex flex-col gap-6">
        <ListaCompra items={resultado.lista} />
        <div className="flex flex-col gap-6">
          {estado.dias.map((dia) => (
            <PlanDia
              key={dia.fecha}
              dia={dia}
              recetas={estado.recetas}
              catalogoDisponible={estado.catalogoDisponible}
            />
          ))}
        </div>
      </div>
    );
  }

  if (estado.estado === "sobre_restriccion") {
    return (
      <SobreRestriccion
        fallo={estado.fallo}
        objetivo={calcularObjetivoDelDia(datos).objetivo}
        datos={datos}
        totalCatalogo={estado.totalCatalogo}
        alAplicar={alAplicarAjustes}
        ocupado={cargando}
      />
    );
  }

  if (estado.estado === "objetivo_invalido") {
    return (
      <section className="rounded-[var(--radius-lg)] bg-surface p-6 sm:p-8">
        <p className="text-[17px] leading-relaxed text-text-2">{estado.mensaje}</p>
      </section>
    );
  }

  return (
    <SinServicio
      motivo={motivoLegible(estado.motivo)}
      detalle={estado.detalle}
      alReintentar={alReintentar}
      ocupado={cargando}
    />
  );
}

/**
 * `SinServicio` habla el vocabulario de 5 motivos de `@/lib/tipos`, heredado
 * de cuando el motor vivía detrás de un `fetch` (ver ese fichero). El motor
 * en proceso sólo conoce dos, y se traducen igual que ya hace
 * `apps/web/src/lib/solver.ts` para el generador gratis: mismo componente,
 * mismo texto, sin duplicar la pantalla para la ruta Pro.
 */
function motivoLegible(motivo: MotivoSinServicioMotor): MotivoSinServicio {
  return motivo === "tiempo_agotado" ? "tiempo_agotado" : "error_solver";
}

/** Piezas cuando el alimento las tiene ("≈ 3 piezas"), gramos si no ("350 g").
 * El "≈" es a propósito: es una estimación de compra, no la cifra exacta —
 * esa sigue siendo `gramos`, que el usuario puede ver contando piezas × peso
 * medio si quiere el detalle. */
function cantidadCompra(gramosTotales: number, piezas: ItemListaCompra["piezas"]): string {
  if (!piezas) return `${gramos(gramosTotales)} g`;
  return `≈ ${piezas.cantidad} ${piezas.unidad}${piezas.cantidad === 1 ? "" : "s"}`;
}

/**
 * Icono de sección de la lista de la compra. Misma familia que `iconos.tsx`
 * (trazo 1,75, extremos redondeados, caja de 24, `currentColor`) pero vive
 * aquí y no allí: son formas de pasillo de supermercado, no del flujo del
 * generador, y no tiene sentido que el resto de la app pueda importarlas.
 * Puramente decorativo (`aria-hidden`) — el nombre de la sección, en `micro`
 * al lado, es quien lleva el significado; por eso una categoría nueva que
 * `NOMBRE_CATEGORIA` no reconozca cae en la forma genérica de despensa en vez
 * de dejar el hueco vacío. */
function IconoCategoria({ categoria, tam = 16 }: { categoria: string; tam?: number }) {
  const trazo = (children: React.ReactNode) => (
    <svg
      width={tam}
      height={tam}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );

  switch (categoria) {
    case "verduleria":
      return trazo(
        <>
          <path d="M6 20c8 0 12-6 12-14-8 0-12 6-12 14Z" />
          <path d="M6.5 19.5C8 15 10.5 11.5 15 9" />
        </>,
      );
    case "fruteria":
      return trazo(
        <>
          <path d="M12 8.5c-3.3 0-5.5 2.4-5.5 5.8S9 19.5 12 19.5s5.5-2.4 5.5-5.2S15.3 8.5 12 8.5Z" />
          <path d="M12 8.5V6" />
          <path d="M12 6c1.2-1.6 3-1.4 3.2.2" />
        </>,
      );
    case "carniceria":
      return trazo(
        <>
          <path d="M9.5 14.5c-2.2 2.2-2.6 5-1 6.6 1.6 1.6 4.4 1.2 6.6-1" />
          <path d="M9.5 14.5c-3.3-3.3-3.6-8.3.2-11 3.4-2.4 7.6-.6 8.3 3.2.7 3.9-2.2 7.1-5.8 7.8" />
        </>,
      );
    case "pescaderia":
      return trazo(
        <>
          <path d="M3 12c4.2-4 10.6-4 14.8 0-4.2 4-10.6 4-14.8 0Z" />
          <path d="M17.8 12 21 9.3v5.4L17.8 12Z" />
          <path d="M7.6 11.1h.01" />
        </>,
      );
    case "lacteos":
      return trazo(
        <>
          <path d="M9.5 3h5l1 4h-7l1-4Z" />
          <path d="M8.5 7h7v12.5a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5V7Z" />
        </>,
      );
    case "huevos":
      return trazo(<path d="M12 4C9 8 6.8 12.3 6.8 15.4a5.2 5.2 0 0 0 10.4 0C17.2 12.3 15 8 12 4Z" />);
    case "conservas":
      return trazo(
        <>
          <path d="M7.5 8.5h9V19a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V8.5Z" />
          <path d="M7.5 8.5V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v2.5" />
        </>,
      );
    case "refrigerados":
      return trazo(<path d="M12 3v18M4.9 7.5l14.2 9M19.1 7.5 4.9 16.5" />);
    case "panaderia":
      return trazo(
        <>
          <path d="M5 13.2c0-5.4 3.1-9.7 7-9.7s7 4.3 7 9.7-3.1 6.3-7 6.3-7-.9-7-6.3Z" />
          <path d="M8.2 13.2h7.6" />
        </>,
      );
    case "despensa":
    default:
      return trazo(
        <>
          <path d="M4 9h16l-1.4 10.3a1.5 1.5 0 0 1-1.5 1.2H6.9a1.5 1.5 0 0 1-1.5-1.2L4 9Z" />
          <path d="M8 9V6.5A4 4 0 0 1 12 2.5a4 4 0 0 1 4 4V9" />
        </>,
      );
  }
}

function ListaCompra({ items }: { items: ItemListaCompra[] }) {
  if (items.length === 0) return null;

  const grupos = new Map<string, ItemListaCompra[]>();
  for (const item of items) {
    const grupo = grupos.get(item.categoria);
    if (grupo) {
      grupo.push(item);
    } else {
      grupos.set(item.categoria, [item]);
    }
  }

  return (
    <section className="rounded-[var(--radius-lg)] bg-surface p-6 sm:p-8">
      <h2 className="t-1">Lista de la compra</h2>
      <p className="mt-1 cuerpo-sm text-text-2">
        Para los 7 días, ya sumada ·{" "}
        <span className="tabular-nums" data-numeric>
          {items.length}
        </span>{" "}
        {items.length === 1 ? "ingrediente distinto" : "ingredientes distintos"}
      </p>

      <div className="mt-6 flex flex-col gap-7">
        {[...grupos.entries()].map(([categoria, itemsDelGrupo]) => (
          <div key={categoria}>
            <div className="flex items-center gap-2 border-b border-line pb-2">
              <span
                aria-hidden="true"
                className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-surface-2 text-text-2"
              >
                <IconoCategoria categoria={categoria} />
              </span>
              <h3 className="micro text-text-2">{NOMBRE_CATEGORIA[categoria] ?? categoria}</h3>
              <span className="ml-auto tabular-nums micro text-text-3" data-numeric>
                {itemsDelGrupo.length}
              </span>
            </div>
            <ul className="mt-1 flex flex-col">
              {itemsDelGrupo.map((item) => (
                <li
                  key={item.alimentoId}
                  className="border-b border-line py-2.5 text-[15px] last:border-0"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-text">
                        {item.nombre}
                        {item.enRecetas > 1 && (
                          <span className="ml-1.5 cuerpo-sm text-text-3">
                            (en {item.enRecetas} recetas)
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 cifra text-text" data-numeric>
                        {cantidadCompra(item.gramos, item.piezas)}
                      </span>
                    </div>
                    {item.desglose && (
                      <ul className="mt-0.5 flex flex-col gap-1 border-l border-line pl-3 cuerpo-sm text-text-2">
                        {item.desglose.map((variante) => (
                          <li
                            key={variante.nombre}
                            className="flex items-baseline justify-between gap-3"
                          >
                            <span>
                              {variante.nombre}
                              {variante.enRecetas > 1 && ` (en ${variante.enRecetas} recetas)`}
                            </span>
                            <span className="shrink-0 tabular-nums" data-numeric>
                              {cantidadCompra(variante.gramos, variante.piezas)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
