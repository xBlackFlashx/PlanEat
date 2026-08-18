"use client";

/**
 * Ficha de la receta, en panel de nivel 3.
 *
 * **Nunca un modal a pantalla completa** (docs/spec.md §9.4): en escritorio es
 * un panel lateral de 400 px sin velo — el plan sigue visible y legible detrás,
 * que es el punto entero —, y en móvil una hoja inferior con velo.
 *
 * Se usa `<dialog>` nativo por accesibilidad, no por comodidad: trae la trampa
 * de foco, el cierre con `Escape`, el fondo inerte y la devolución del foco al
 * elemento que lo abrió. Reimplementar eso a mano sale siempre peor.
 *
 * ## La foto, cuando la hay — y el mismo hueco cuando no
 *
 * `docs/diseno-producto.md` §3.5 pide abrir con una foto 3:2 y §2.6 fija la
 * densidad en «baja: la foto manda». Las 91 recetas del catálogo ya traen
 * `imagenUrl` (`services/solver/data/imagenes.json`, vía
 * `services/solver/scripts/buscar_imagenes.py`), así que en el caso normal la
 * cabecera es la foto real del plato con su `aspect-ratio` declarado — la
 * causa número uno de CLS en productos con foto (§2.5).
 *
 * Pero el campo es `null` cuando falta (una receta nueva sin foto todavía, o
 * un checkout que no ha corrido el script), y ese caso no puede quedar en un
 * placeholder gris con un icono de plato. La salida: preguntarse qué hace la
 * foto en una ficha de receta — decir de qué está hecho el plato antes de que
 * leas nada — y notar que **eso el catálogo siempre lo tiene**, con o sin
 * foto: la lista de ingredientes resuelta a nombres legibles. Sin imagen, es
 * ella quien ocupa el sitio de la foto: título en la voz serif y, debajo, los
 * ingredientes reales como bloque de lectura. Es información, no relleno; se
 * sostiene sin imagen; y no miente sobre nada.
 *
 * ## Lo que la ficha decide enseñar
 *
 * Los datos del catálogo escalados a la ración que sirve el plan. Lo que el
 * catálogo no declara aparece como «sin declarar»: en un producto de nutrición,
 * un cero inventado es peor que un hueco. Y `revisadaPor` —que hoy vale `null`
 * en las 36 recetas— se enseña **como aviso, no como silencio**: según
 * `docs/spec.md` la revisión por dietista es condición para publicar, así que
 * su ausencia es información de producto de primer orden, no un campo vacío que
 * convenga disimular.
 */

import { useEffect, useId, useRef } from "react";

import { gramos, kcal as formatearKcal, minutos, racion } from "@/lib/formato";
import { nombreAlergeno } from "@/lib/perfil";
import type { RecetaResumen } from "@/lib/tipos";

import { BarraReparto } from "./barra-reparto";
import { DetallePlegable } from "./detalle-plegable";
import { IconoAviso, IconoCambiar, IconoCerrar, IconoReloj } from "./iconos";
import estilos from "./planeat.module.css";
import { TablaNutricional } from "./tabla-nutricional";

/**
 * La foto, el día que la haya. `imagenUrl` es `null` para una receta sin foto
 * en `data/imagenes.json` (ver `services/solver/scripts/buscar_imagenes.py`):
 * media docena de píxeles rotos en la cabecera es peor que no tener cabecera.
 */
function imagenDe(receta: RecetaResumen): string | null {
  return receta.imagenUrl;
}

interface PropsPanelReceta {
  receta: RecetaResumen | null;
  factorRacion: number;
  alCerrar: () => void;
  alCambiarReceta?: (recetaId: string) => void;
}

export function PanelReceta({
  receta,
  factorRacion,
  alCerrar,
  alCambiarReceta,
}: PropsPanelReceta) {
  const dialogo = useRef<HTMLDialogElement>(null);
  // Un plan de varios días monta un `PanelReceta` por día. Con el id literal
  // que había antes, el documento acababa con varios `titulo-ficha` y el
  // `aria-labelledby` apuntaba al primero que encontrara.
  const idTitulo = useId();
  const idIngredientes = useId();

  useEffect(() => {
    const nodo = dialogo.current;
    if (!nodo) return;
    if (receta && !nodo.open) nodo.showModal();
    if (!receta && nodo.open) nodo.close();
  }, [receta]);

  /**
   * Clic fuera de la ficha = cerrar.
   *
   * Un `<dialog>` no cierra solo al pulsar el fondo. En escritorio el velo es
   * transparente a propósito, así que sin esto el usuario ve su plan, intenta
   * tocarlo, no pasa nada y no hay nada que sugiera de qué salir. El evento
   * llega con `target` = el propio `<dialog>` sólo cuando el clic cae en el
   * área que no ocupa su contenido, que es exactamente el fondo.
   *
   * Sigue sin ser lo que pide §3.5 —allí el plan de detrás es *usable*, no sólo
   * visible, y eso exige `show()` en vez de `showModal()` y una trampa de foco
   * escrita a mano—. Esto es la mitad barata del arreglo, y la otra mitad queda
   * anotada aquí para que no parezca resuelta.
   */
  const alPulsarFondo = (evento: React.MouseEvent<HTMLDialogElement>) => {
    if (evento.target === dialogo.current) alCerrar();
  };

  if (!receta) {
    return (
      <dialog ref={dialogo} className={estilos.panel} onClose={alCerrar} />
    );
  }

  const escalar = (valor: number) => valor * factorRacion;
  const panel = {
    proteinaG: escalar(receta.porRacion.proteinaG),
    carbohidratoG: escalar(receta.porRacion.carbohidratoG),
    grasaG: escalar(receta.porRacion.grasaG),
  };
  // Capa 1 de la ficha: la conclusión antes que los datos.
  const frase = `Esta ración aporta unas ${formatearKcal(
    escalar(receta.porRacion.kcal),
  )} kcal y ${gramos(panel.proteinaG)} g de proteína.`;

  const imagen = imagenDe(receta);

  return (
    <dialog
      ref={dialogo}
      className={estilos.panel}
      onClose={alCerrar}
      onClick={alPulsarFondo}
      aria-labelledby={idTitulo}
    >
      <div className="flex max-h-[88dvh] flex-col lg:h-dvh lg:max-h-none">
        {/* Cabecera: el sitio de la foto. Fondo propio para que se lea como un
            bloque y no como el primer párrafo del cuerpo. */}
        <header className="relative shrink-0 border-b border-line bg-surface-2">
          {/* El `aspect-ratio` va declarado siempre, aunque hoy nunca haya
              imagen: es la causa número uno de CLS en productos con foto
              (§2.5). `alt` describe el plato, no el plano. */}
          {imagen && (
            /* No es `next/image` a propósito: el sitio se publica estático
               (`output: "export"`, sin optimizador detrás) y `images.unoptimized`
               ya está puesto en `next.config.ts`, así que `next/image` no
               optimizaría nada y en cambio obligaría a declarar `remotePatterns`
               para un host que todavía no existe. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imagen}
              alt={receta.titulo}
              className={estilos.fotoFicha}
              fetchPriority="high"
            />
          )}

          <button
            type="button"
            onClick={alCerrar}
            className={`${estilos.pulsable} absolute right-2 top-2 z-10 grid size-11 place-items-center rounded-[var(--radius-sm)] bg-surface-2 text-text-2 hover:bg-surface-3 hover:text-text`}
          >
            <IconoCerrar />
            <span className="sr-only">Cerrar la ficha</span>
          </button>

          <div className="p-4 pr-14 sm:p-6 sm:pr-16">
            {/* `voz-2` es la utilidad del sistema (globals.css): 26 → 32 px en
                Instrument Serif a peso 400. Es uno de los cuatro únicos sitios
                del producto donde aparece la serif (§2.2), y el único de los
                cuatro que vive dentro de un componente reutilizable. */}
            <h2 id={idTitulo} className="voz-2 text-pretty">
              {receta.titulo}
            </h2>

            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-2">
              <span className="inline-flex items-center gap-1.5">
                <IconoReloj tam={16} />
                <span className="tabular-nums" data-numeric>
                  {minutos(receta.minutos)}
                </span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums" data-numeric>
                {racion(factorRacion)}
              </span>
            </p>

            {/* Aquí es donde iría la foto, y es lo que hace su trabajo: de qué
                está hecho el plato, antes de leer un solo número. */}
            {receta.ingredientes.length > 0 ? (
              <>
                <h3 id={idIngredientes} className="sr-only">
                  Ingredientes
                </h3>
                <ul
                  role="list"
                  aria-labelledby={idIngredientes}
                  className="mt-4 text-pretty text-[17px] leading-relaxed text-text-2 sm:text-[18px]"
                >
                  {receta.ingredientes.map((ingrediente, indice) => (
                    <li key={ingrediente} className="inline">
                      {ingrediente}
                      {/* El punto medio va pegado a la palabra anterior con un
                          espacio duro y suelto detrás: así nunca empieza una
                          línea, que es como se lee un separador huérfano. */}
                      {indice < receta.ingredientes.length - 1 && (
                        <span aria-hidden="true" className="text-text-3">
                          {" · "}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-4 text-[15px] leading-relaxed text-text-2">
                El catálogo no trae la lista de ingredientes de esta receta.
              </p>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* Trazabilidad de la revisión. Va arriba porque condiciona cómo hay
              que leer todo lo que viene después (docs/spec.md: la revisión por
              dietista es condición para publicar). Hoy sale en las 36 recetas
              del catálogo, y eso es exactamente lo que hay que enseñar. */}
          {receta.revisadaPor ? (
            <p className="text-sm leading-relaxed text-text-2">
              Ficha revisada por{" "}
              <span className="font-medium text-text">{receta.revisadaPor}</span>.
            </p>
          ) : (
            <div className="flex items-start gap-2.5 rounded-[var(--radius)] bg-warning-soft p-3 text-warning">
              <span className="mt-0.5 shrink-0">
                <IconoAviso tam={18} />
              </span>
              <p className="text-sm leading-relaxed">
                <span className="font-medium">Sin revisar por un dietista.</span>{" "}
                Los valores están calculados a partir de los ingredientes del
                catálogo; nadie los ha comprobado plato a plato todavía.
              </p>
            </div>
          )}

          {/* Capa 1 y capa 2, en el mismo orden que en todas partes. */}
          <p className="mt-6 text-[15px] leading-snug text-text-2">{frase}</p>
          <BarraReparto panel={panel} conclusion={frase} className="mt-3" />

          <h3 className="mt-8 text-base font-semibold">Alérgenos declarados</h3>
          <p className="mt-2 text-[15px]">
            {receta.alergenos.length > 0
              ? receta.alergenos.map(nombreAlergeno).join(", ")
              : "Ninguno de los catorce de declaración obligatoria."}
          </p>

          {/* Capa 3, plegada y con memoria. La tabla completa es referencia: el
              que la quiere la abre y se le recuerda abierta; el que no, no paga
              su densidad en cada ficha que mira. */}
          <div className="mt-8 border-t border-line pt-2">
            <DetallePlegable tipo="ficha-receta" resumen="Ver tabla nutricional completa">
              <TablaNutricional
                encabezadoValor="Esta ración"
                filas={[
                  {
                    etiqueta: "Valor energético",
                    valor: receta.conocido.kcal ? escalar(receta.porRacion.kcal) : null,
                    unidad: "kcal",
                  },
                  {
                    etiqueta: "Grasas",
                    valor: receta.conocido.grasaG ? escalar(receta.porRacion.grasaG) : null,
                    unidad: "g",
                  },
                  {
                    etiqueta: "Hidratos de carbono",
                    valor: receta.conocido.carbohidratoG
                      ? escalar(receta.porRacion.carbohidratoG)
                      : null,
                    unidad: "g",
                  },
                  {
                    etiqueta: "Fibra alimentaria",
                    valor: receta.conocido.fibraG ? escalar(receta.porRacion.fibraG) : null,
                    unidad: "g",
                  },
                  {
                    etiqueta: "Proteínas",
                    valor: receta.conocido.proteinaG
                      ? escalar(receta.porRacion.proteinaG)
                      : null,
                    unidad: "g",
                  },
                  {
                    etiqueta: "Sal",
                    // Conversión legal sal = sodio × 2,5 (Reg. UE 1169/2011).
                    valor: receta.conocido.sodioMg
                      ? (escalar(receta.porRacion.sodioMg) * 2.5) / 1000
                      : null,
                  unidad: "g",
                  },
                ]}
              />
            </DetallePlegable>
          </div>

          {/* Un solo descargo, al pie y sin plegar (§3.5, punto 9). Antes eran
              tres párrafos repartidos por la ficha diciendo cada uno una parte
              de lo mismo: densidad alta y ninguno se leía. */}
          <p className="mt-8 border-t border-line pt-4 text-sm leading-relaxed text-text-3">
            Los alérgenos salen de los ingredientes declarados en nuestro
            catálogo y no sustituyen a leer la etiqueta del producto que compres.
            Las cantidades por ingrediente y los pasos de elaboración están en el
            catálogo original pero todavía no llegan hasta aquí: llegan con la
            vista de receta completa.
          </p>
        </div>

        {alCambiarReceta && (
          <footer className="shrink-0 border-t border-line p-4 sm:p-6">
            <button
              type="button"
              onClick={() => {
                alCambiarReceta(receta.id);
                alCerrar();
              }}
              className={`${estilos.pulsable} flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover`}
            >
              <IconoCambiar tam={18} />
              Cambiar esta receta
            </button>
            <p className="mt-2 text-sm leading-relaxed text-text-2">
              Vuelvo a montar el día entero evitándola. Todavía no puedo cambiar
              una sola comida sin tocar el resto.
            </p>
          </footer>
        )}
      </div>
    </dialog>
  );
}
