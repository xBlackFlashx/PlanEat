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
      <h2 className="text-xl font-semibold tracking-tight">Lista de la compra</h2>
      <p className="mt-1 text-sm text-text-2">Para los 7 días, ya sumada.</p>
      <p className="text-sm text-text-2">
        {items.length} {items.length === 1 ? "ingrediente distinto" : "ingredientes distintos"}.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        {[...grupos.entries()].map(([categoria, itemsDelGrupo]) => (
          <div key={categoria}>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-text-2">
              {NOMBRE_CATEGORIA[categoria] ?? categoria}
            </h3>
            <ul className="mt-2 flex flex-col gap-1.5">
              {itemsDelGrupo.map((item) => (
                <li
                  key={item.alimentoId}
                  className="border-b border-line py-1.5 text-[15px] last:border-0"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span>
                        {item.nombre}
                        {item.enRecetas > 1 && (
                          <span className="ml-2 text-sm text-text-2">
                            (en {item.enRecetas} recetas)
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums text-text-2" data-numeric>
                        {cantidadCompra(item.gramos, item.piezas)}
                      </span>
                    </div>
                    {item.desglose && (
                      <ul className="flex flex-col gap-0.5 pl-3 text-sm text-text-2">
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
