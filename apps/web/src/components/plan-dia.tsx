"use client";

/**
 * Plan del día. Jerarquía Día → Comida → Item.
 *
 * Objetivo: que un día completo se lea de un vistazo y que cualquier corrección
 * cueste un tap (docs/spec.md §9.1.2 y §9.1.3).
 *
 * Lo que se ve en el primer segundo es la frase de la capa 1 y la cifra de
 * kcal. **No la barra**: la barra es el segundo golpe de vista, y es
 * deliberado — el principiante ya ha terminado de leer antes de llegar a ella.
 *
 * Las acciones por item se revelan en `:hover` **y** en `:focus-within`, y en
 * pantallas táctiles están siempre visibles. Sin lo segundo el patrón es
 * inaccesible por teclado.
 */

import { useEffect, useRef, useState } from "react";
import type { ComidaPlan, DiaPlan, ItemPlan } from "@planeat/shared";

import {
  fechaCorta,
  fechaLarga,
  kcal as formatearKcal,
  minutos,
  racion as formatearRacionTexto,
  rangoPrecio,
} from "@/lib/formato";
import { NOMBRE_SLOT, ORDEN_SLOTS } from "@/lib/perfil";
import type { RecetaResumen } from "@/lib/tipos";

import { BloqueNutricionalComida, BloqueNutricionalDia } from "./bloque-nutricional";
import { IconoCambiar, IconoFicha } from "./iconos";
import { PanelReceta } from "./panel-receta";
import estilos from "./planeat.module.css";

interface PropsPlanDia {
  dia: DiaPlan;
  recetas: Record<string, RecetaResumen>;
  catalogoDisponible: boolean;
  /** Compás 4: la barra entra desde el reparto del objetivo. */
  animarCuadre?: boolean;
  /** Vuelve a montar el día evitando la receta indicada. */
  alCambiarReceta?: (recetaId: string) => void;
  /** Vuelve a montar el día entero. */
  alPedirOtroDia?: () => void;
  regenerando?: boolean;
}

export function PlanDia({
  dia,
  recetas,
  catalogoDisponible,
  animarCuadre = false,
  alCambiarReceta,
  alPedirOtroDia,
  regenerando = false,
}: PropsPlanDia) {
  const [fichaAbierta, setFichaAbierta] = useState<RecetaResumen | null>(null);
  const [factorFicha, setFactorFicha] = useState(1);
  const [sentinela, compactada] = useCabeceraCompacta();

  const comidas = [...dia.comidas].sort(
    (a, b) => ORDEN_SLOTS.indexOf(a.slot) - ORDEN_SLOTS.indexOf(b.slot),
  );

  const coste = costeDelDia(comidas, recetas);

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-8">
      {/* Sentinela: cuando sale de pantalla, la cabecera se compacta. */}
      <div aria-hidden="true" ref={sentinela} className="h-px lg:hidden" />

      {/* Cabecera del día. En escritorio se recoloca a la columna lateral con
          grid; el orden del DOM no cambia. */}
      <header
        // El fondo de la cabecera es `--surface` y no `--bg` por contraste:
        // `--text-3` da 4,47:1 sobre `--bg` en tema claro —por debajo de AA— y
        // 4,74:1 sobre `--surface`. Las unidades de la cabecera van en ese
        // token, así que la superficie no es una elección estética.
        className={`${estilos.cabeceraDia} sticky top-0 z-20 -mx-4 border-b border-line bg-surface/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:top-6 lg:col-start-2 lg:row-start-1 lg:mx-0 lg:rounded-[var(--radius-lg)] lg:border lg:bg-surface lg:px-6 lg:backdrop-blur-none ${
          compactada ? "py-2" : "py-4 lg:py-6"
        }`}
      >
        {/* En móvil, fecha y cifra comparten línea de base. En la columna
            lateral de escritorio no caben en 320 px sin partir la fecha, así
            que ahí se apilan. */}
        <div className="flex items-baseline justify-between gap-3 lg:flex-col lg:items-start lg:gap-1">
          <h2 className="text-lg font-semibold tracking-tight">
            <span className="lg:hidden">{fechaCorta(dia.fecha)}</span>
            <span className="hidden lg:inline">{fechaLarga(dia.fecha)}</span>
          </h2>
          <p className="tabular-nums" data-numeric>
            <span className="text-text-3">≈ </span>
            <span
              className={`font-semibold tracking-tight ${
                compactada ? "text-xl" : "text-2xl lg:text-4xl"
              }`}
            >
              {formatearKcal(dia.totales.kcal)}
            </span>
            <span className="text-text-3"> kcal</span>
          </p>
        </div>

        <div className={compactada ? "mt-2" : "mt-3"}>
          <BloqueNutricionalDia
            totales={dia.totales}
            objetivo={dia.objetivo}
            animarCuadre={animarCuadre}
            compacto={compactada}
          />
        </div>
      </header>

      {/* Las comidas. */}
      <div className="lg:col-start-1 lg:row-start-1">
        <ol className="mt-6 flex flex-col gap-6">
          {comidas.map((comida, indice) => (
            <li
              key={comida.slot}
              className={`${estilos.entrada} rounded-[var(--radius-lg)] bg-surface p-4 sm:p-6`}
              style={{ animationDelay: `${Math.min(indice, 5) * 40}ms` }}
            >
              <BloqueComida
                comida={comida}
                kcalDelDia={dia.totales.kcal}
                recetas={recetas}
                catalogoDisponible={catalogoDisponible}
                alVerFicha={(receta, factor) => {
                  setFactorFicha(factor);
                  setFichaAbierta(receta);
                }}
                alCambiarReceta={alCambiarReceta}
                regenerando={regenerando}
              />
            </li>
          ))}
        </ol>

        {/* Pie del día: coste en rango, nunca exacto. */}
        <footer className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
          <p className="text-sm text-text-2">
            {coste == null ? (
              "El coste de este día no se puede estimar: faltan precios en el catálogo."
            ) : (
              <>
                <span className="tabular-nums font-semibold text-text" data-numeric>
                  {rangoPrecio(coste)}
                </span>{" "}
                estimado en ingredientes
              </>
            )}
          </p>

          {alPedirOtroDia && (
            <button
              type="button"
              onClick={alPedirOtroDia}
              disabled={regenerando}
              className={`${estilos.pulsable} inline-flex min-h-11 items-center gap-2 rounded-[var(--radius)] border border-line-strong px-4 text-sm font-medium text-text hover:bg-surface-2 disabled:opacity-50`}
            >
              <IconoCambiar tam={18} />
              {regenerando ? "Montando otro día…" : "Montar otro día"}
            </button>
          )}
        </footer>
      </div>

      <PanelReceta
        receta={fichaAbierta}
        factorRacion={factorFicha}
        alCerrar={() => setFichaAbierta(null)}
        alCambiarReceta={alCambiarReceta}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloque de una comida
// ---------------------------------------------------------------------------

interface PropsBloqueComida {
  comida: ComidaPlan;
  kcalDelDia: number;
  recetas: Record<string, RecetaResumen>;
  catalogoDisponible: boolean;
  alVerFicha: (receta: RecetaResumen, factorRacion: number) => void;
  alCambiarReceta?: (recetaId: string) => void;
  regenerando: boolean;
}

function BloqueComida({
  comida,
  kcalDelDia,
  recetas,
  catalogoDisponible,
  alVerFicha,
  alCambiarReceta,
  regenerando,
}: PropsBloqueComida) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[19px] font-semibold tracking-tight">
          {NOMBRE_SLOT[comida.slot]}
        </h3>
        <p className="tabular-nums text-sm" data-numeric>
          <span className="font-semibold text-text">{formatearKcal(comida.totales.kcal)}</span>
          <span className="text-text-3"> kcal</span>
        </p>
      </div>

      <ul className="my-4 flex flex-col">
        {comida.items.map((item) => (
          <ItemComida
            key={`${item.recetaId}-${item.factorRacion}`}
            item={item}
            receta={recetas[item.recetaId]}
            catalogoDisponible={catalogoDisponible}
            // Con un solo item, su kcal es la kcal de la comida, que ya está
            // arriba a la derecha. Repetir el mismo número a diez píxeles no
            // informa: ensucia.
            mostrarKcal={comida.items.length > 1}
            alVerFicha={alVerFicha}
            alCambiarReceta={alCambiarReceta}
            regenerando={regenerando}
          />
        ))}
      </ul>

      <BloqueNutricionalComida totales={comida.totales} kcalDelDia={kcalDelDia} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------

interface PropsItem {
  item: ItemPlan;
  receta: RecetaResumen | undefined;
  catalogoDisponible: boolean;
  mostrarKcal: boolean;
  alVerFicha: (receta: RecetaResumen, factorRacion: number) => void;
  alCambiarReceta?: (recetaId: string) => void;
  regenerando: boolean;
}

function ItemComida({
  item,
  receta,
  catalogoDisponible,
  mostrarKcal,
  alVerFicha,
  alCambiarReceta,
  regenerando,
}: PropsItem) {
  // Sin catálogo no hay título ni kcal del item. Se dice, no se inventa.
  const titulo = receta?.titulo ?? "Receta sin ficha disponible";
  const kcalItem = receta ? receta.porRacion.kcal * item.factorRacion : null;
  const racion = formatearRacionTexto(item.factorRacion);

  return (
    <li
      className={`${estilos.filaItem} flex items-center gap-3 border-b border-line py-3 last:border-0`}
    >
      {/* Placeholder de foto: la inicial del plato. Nunca un icono de cámara
          rota ni una foto de archivo genérica (§2.5). */}
      <span
        aria-hidden="true"
        className="grid size-14 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-surface-2 text-lg font-semibold text-text-2 sm:size-16"
        style={{ aspectRatio: "1 / 1" }}
      >
        {titulo.slice(0, 1).toUpperCase()}
      </span>

      <div className="min-w-0 flex-1">
        {/* El título se parte en dos líneas antes que recortarse. "Merluza al
            horno con patatas" no puede quedar en "Merluza…": el usuario no
            sabe qué va a cenar. */}
        <p className="text-pretty text-[16px] font-semibold leading-snug">{titulo}</p>
        <p className="mt-0.5 text-sm text-text-2">
          {receta ? (
            <>
              <span className="tabular-nums" data-numeric>
                {minutos(receta.minutos)}
              </span>
              {" · "}
              <span className="tabular-nums" data-numeric>
                {racion}
              </span>
            </>
          ) : catalogoDisponible ? (
            `Identificador ${item.recetaId}`
          ) : (
            "No he podido leer el catálogo de recetas"
          )}
        </p>
      </div>

      {mostrarKcal && kcalItem != null && (
        <p className="shrink-0 tabular-nums text-sm" data-numeric>
          <span className="font-semibold">{formatearKcal(kcalItem)}</span>
          <span className="text-text-3"> kcal</span>
        </p>
      )}

      <div className="flex shrink-0 items-center">
        {/* En pantallas estrechas sólo cabe una acción sin comerse el título,
            así que ahí "Cambiar" vive dentro de la ficha —que es el patrón de
            colapsar las acciones en un solo punto de entrada táctil— y desde
            `sm` aparece también aquí, revelada por hover o por foco. */}
        {alCambiarReceta && (
          <button
            type="button"
            onClick={() => alCambiarReceta(item.recetaId)}
            disabled={regenerando}
            className={`${estilos.acciones} ${estilos.pulsable} hidden size-11 place-items-center rounded-[var(--radius-sm)] text-text-2 hover:bg-surface-2 hover:text-text disabled:opacity-50 sm:grid`}
          >
            <IconoCambiar />
            <span className="sr-only">Cambiar {titulo}</span>
          </button>
        )}

        {receta && (
          <button
            type="button"
            onClick={() => alVerFicha(receta, item.factorRacion)}
            className={`${estilos.pulsable} grid size-11 place-items-center rounded-[var(--radius-sm)] text-text-2 hover:bg-surface-2 hover:text-text`}
          >
            <IconoFicha />
            <span className="sr-only">Ver la ficha de {titulo}</span>
          </button>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Utilidades locales
// ---------------------------------------------------------------------------

/**
 * Coste del día en céntimos, o `null` si falta el precio de alguna receta. Se
 * prefiere no decir nada a decir un número incompleto.
 */
function costeDelDia(
  comidas: ComidaPlan[],
  recetas: Record<string, RecetaResumen>,
): number | null {
  let total = 0;
  for (const comida of comidas) {
    for (const item of comida.items) {
      const receta = recetas[item.recetaId];
      if (!receta || receta.costeCents == null) return null;
      total += receta.costeCents * item.factorRacion;
    }
  }
  return total > 0 ? Math.round(total) : null;
}

/**
 * La cabecera se compacta al hacer scroll. Sólo en móvil: en escritorio la
 * cabecera vive en una columna lateral pegajosa y no estorba a nadie.
 */
function useCabeceraCompacta(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const sentinela = useRef<HTMLDivElement>(null);
  const [activa, setActiva] = useState(false);

  useEffect(() => {
    const nodo = sentinela.current;
    if (!nodo) return;

    const esEscritorio = () => window.matchMedia("(min-width: 1024px)").matches;

    const observador = new IntersectionObserver(
      ([entrada]) => setActiva(!entrada.isIntersecting && !esEscritorio()),
      { threshold: 0 },
    );
    observador.observe(nodo);
    return () => observador.disconnect();
  }, []);

  return [sentinela, activa];
}
