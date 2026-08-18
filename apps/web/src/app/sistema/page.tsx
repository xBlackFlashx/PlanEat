import type { Metadata } from "next";
import Link from "next/link";
import { MacroBar } from "@/components/macro-bar";
import { NavCuenta } from "@/components/nav-cuenta";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "Sistema de diseño",
  description: "Referencia viva de los tokens y primitivas de PlanEat.",
};

/**
 * Referencia viva del sistema. Sirve para verificar que cada token funciona en
 * ambos temas antes de usarlo en producto. No se enlaza desde la app pública.
 *
 * Regla de esta página: sólo enseña lo que existe de verdad en globals.css. Si
 * alguna vez muestra una escala que el producto no usa, engaña en el único
 * sitio donde no puede permitírselo.
 *
 * Contrastes: son los del Anexo A.2 de docs/diseno-producto.md, recalculados
 * sobre los valores actuales de globals.css con la fórmula de WCAG 2.1. Están
 * escritos a mano porque calcularlos en el cliente obligaría a leer los colores
 * ya resueltos por `light-dark()`, y esta página es un componente de servidor.
 * Si alguien cambia un token de color, tiene que actualizar su número aquí.
 */

type Muestra = {
  token: string;
  clase: string;
  nombre: string;
  /** Contraste contra `--bg` en cada tema. */
  claro: number;
  oscuro: number;
  nota?: string;
};

const SUPERFICIES: Muestra[] = [
  { token: "--bg", clase: "bg-bg", nombre: "Fondo", claro: 1, oscuro: 1 },
  {
    token: "--surface",
    clase: "bg-surface",
    nombre: "Superficie",
    claro: 1.05,
    oscuro: 1.09,
  },
  {
    token: "--surface-2",
    clase: "bg-surface-2",
    nombre: "Superficie 2",
    claro: 1.05,
    oscuro: 1.24,
  },
  {
    token: "--surface-3",
    clase: "bg-surface-3",
    nombre: "Superficie 3",
    claro: 1.18,
    oscuro: 1.47,
  },
];

const MACROS: Muestra[] = [
  {
    token: "--protein",
    clase: "bg-protein",
    nombre: "Proteína",
    claro: 4.94,
    oscuro: 7.36,
    nota: "Cumple AA (4,5:1) como texto en ambos temas. Se usa igual sólo como marca gráfica.",
  },
  {
    token: "--carb",
    clase: "bg-carb",
    nombre: "Carbohidratos",
    claro: 4.8,
    oscuro: 11.22,
    nota: "Cumple AA en ambos temas — el sistema anterior no llegaba a 3:1 en claro. Aun así lleva etiqueta directa en la barra de macros, por claridad, no por falta de contraste.",
  },
  {
    token: "--fat",
    clase: "bg-fat",
    nombre: "Grasa",
    claro: 5.45,
    oscuro: 6.88,
    nota: "Cumple AA en ambos temas.",
  },
];

const ESTADOS: Muestra[] = [
  {
    token: "--brand",
    clase: "bg-brand",
    nombre: "Marca",
    claro: 5.24,
    oscuro: 9.74,
    nota: "Cómodo en ambos temas, también como texto.",
  },
  {
    token: "--danger",
    clase: "bg-danger",
    nombre: "Error",
    claro: 4.62,
    oscuro: 6.77,
    nota: "Cumple AA como texto en ambos temas.",
  },
  {
    token: "--warning",
    clase: "bg-warning",
    nombre: "Aviso",
    claro: 4.8,
    oscuro: 11.22,
    nota: "Cumple AA como texto en ambos temas. Mismo hex que --carb, a propósito.",
  },
];

const TEXTOS: Muestra[] = [
  {
    token: "--text",
    clase: "bg-text",
    nombre: "Texto",
    claro: 17.06,
    oscuro: 17.09,
    nota: "Cumple AAA (7:1). Es el que llevan las cifras nutricionales.",
  },
  {
    token: "--text-2",
    clase: "bg-text-2",
    nombre: "Texto 2",
    claro: 7.24,
    oscuro: 12.61,
    nota: "Cumple AAA. Es el secundario por defecto sobre el fondo de página.",
  },
  {
    token: "--text-3",
    clase: "bg-text-3",
    nombre: "Texto 3",
    claro: 5.19,
    oscuro: 7.3,
    nota: "5,19:1 en claro, 7,30:1 en oscuro: cumple AA sobre --bg en los dos temas (mejora sobre el sistema anterior, que se quedaba en 4,47:1 en claro). No llega a AAA en claro — las cifras siguen yendo en --text o --text-2, nunca aquí.",
  },
  {
    token: "--line",
    clase: "bg-line",
    nombre: "Línea",
    claro: 1.18,
    oscuro: 1.47,
    nota: "Decorativa. Nunca como único indicador de foco, selección o estado.",
  },
];

/** Formatea con coma decimal, que es lo que toca en castellano. */
function ratio(n: number) {
  return `${n.toFixed(2).replace(".", ",")}:1`;
}

function Seccion({
  titulo,
  nota,
  children,
}: {
  titulo: string;
  nota: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-16">
      <h2 className="t-2 text-text">{titulo}</h2>
      {/* --text-2 y no --text-3: este párrafo vive sobre --bg, donde --text-3
          se queda en 4,47:1 y no llega a AA. */}
      <p className="cuerpo-sm mt-2 mb-5 max-w-2xl text-text-2">{nota}</p>
      {children}
    </section>
  );
}

function Muestras({ items }: { items: Muestra[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((c) => (
        <li
          key={c.token}
          className="rounded-lg border border-line bg-surface p-4"
        >
          <div
            className={`${c.clase} h-14 rounded-sm border border-line`}
            aria-hidden="true"
          />
          <p className="t-3 mt-3 text-text">{c.nombre}</p>
          <code className="etiqueta block font-mono text-text-3">
            {c.token}
          </code>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="etiqueta text-text-3">Claro</dt>
            <dd className="cifra etiqueta text-text">{ratio(c.claro)}</dd>
            <dt className="etiqueta text-text-3">Oscuro</dt>
            <dd className="cifra etiqueta text-text">{ratio(c.oscuro)}</dd>
          </dl>
          {c.nota ? (
            <p className="cuerpo-sm mt-3 text-text-3">{c.nota}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const ESCALA = [
  { clase: "voz-1", valor: "34 → 46 px · 1,05 · 400 Poppins", texto: "Tu día, resuelto" },
  { clase: "voz-2", valor: "26 → 32 px · 1,10 · 400 Poppins", texto: "Lentejas con verduras" },
  { clase: "t-1", valor: "24 → 28 px · 1,20 · 600", texto: "Martes 12" },
  { clase: "t-2", valor: "19 → 21 px · 1,25 · 600", texto: "Comida" },
  { clase: "t-3", valor: "16 → 17 px · 1,30 · 600", texto: "Ensalada de garbanzos" },
  { clase: "cuerpo", valor: "16 px · 1,55 · 400", texto: "Prosa, capa 1 y pasos de receta." },
  { clase: "cuerpo-sm", valor: "14 px · 1,50 · 400", texto: "Secundario, metadatos y ayudas." },
  { clase: "etiqueta", valor: "13 px · 1,35 · 500", texto: "Proteína · Carbohidratos · Grasa" },
  { clase: "micro", valor: "12 px · 1,30 · 500 · versal", texto: "Lista de la compra" },
];

const RADIOS = [
  { clase: "rounded-sm", token: "--radius-sm", valor: "7 px", uso: "Controles pequeños e items de lista" },
  { clase: "rounded-base", token: "--radius", valor: "10 px", uso: "Botones y campos" },
  { clase: "rounded-lg", token: "--radius-lg", valor: "14 px", uso: "Tarjetas, hojas y paneles" },
];

const DURACIONES = [
  { clase: "dur-rapida", valor: "120 ms", uso: "Color: hover, foco, borde" },
  { clase: "dur-media", valor: "220 ms", uso: "Entrada de panel, hoja, crossfade" },
  { clase: "dur-lenta", valor: "320 ms", uso: "Transición de pantalla a resultado" },
  { clase: "dur-cuadre", valor: "500 ms", uso: "Sólo el compás 4 del estado de generación" },
];

const CURVAS = [
  { clase: "ease-entrada", valor: "cubic-bezier(0, 0, .2, 1)", uso: "Lo que entra" },
  { clase: "ease-salida", valor: "cubic-bezier(.4, 0, 1, 1)", uso: "Lo que sale, ≈65 % de la entrada" },
  { clase: "ease-suave", valor: "cubic-bezier(.2, .8, .2, 1)", uso: "Recolocación de layout" },
];

export default function SistemaDeDiseno() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="t-3 tracking-tight">
            PlanEat
          </Link>
          <div className="flex items-center gap-3">
            <NavCuenta />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6">
        <h1 className="t-1 tracking-tight">Sistema de diseño</h1>
        <p className="cuerpo mt-3 mb-14 max-w-2xl text-text-2">
          Referencia viva de los tokens. Alterna el tema con el botón de arriba:
          todo lo de esta página debe seguir siendo legible en los dos. Y
          pruébala también con el interruptor del sistema operativo en el estado
          contrario al elegido aquí — la elección explícita tiene que ganar en
          ambas direcciones, y ese es justo el caso que se rompe sin que nadie se
          entere.
        </p>

        <Seccion
          titulo="Tipografía"
          nota="Dos fuentes con reparto estricto. Inter hace el trabajo: toda la interfaz, todo el cuerpo y todos los números — se mantiene igual tras el rediseño porque trae la feature OpenType «tnum» de verdad, y eso es una restricción técnica, no de marca. Poppins pone la voz (sustituye a Space Grotesk), y sólo en cuatro sitios: el titular de portada, el título de una ficha de receta, el titular de sobre-restricción y su cifra héroe. Nunca en interfaz, nunca en un número, nunca por debajo de 24 px, nunca en negrita. Las dos son OFL 1.1 y se sirven desde el propio dominio."
        >
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {ESCALA.map((e) => (
              <li
                key={e.clase}
                className="flex flex-col gap-2 p-5 sm:flex-row sm:items-baseline sm:gap-6"
              >
                <div className="sm:w-44 sm:shrink-0">
                  <code className="etiqueta block font-mono text-text">
                    .{e.clase}
                  </code>
                  <span className="etiqueta block text-text-3">{e.valor}</span>
                </div>
                <p className={`${e.clase} min-w-0 text-text`}>{e.texto}</p>
              </li>
            ))}
            <li className="flex flex-col gap-2 p-5 sm:flex-row sm:items-baseline sm:gap-6">
              <div className="sm:w-44 sm:shrink-0">
                <code className="etiqueta block font-mono text-text">
                  .cifra-heroe
                </code>
                <span className="etiqueta block text-text-3">
                  40 → 56 px · 1,00 · 600 tabular
                </span>
              </div>
              <p className="cifra-heroe text-text">1.847</p>
            </li>
          </ul>
        </Seccion>

        <Seccion
          titulo="Números tabulares"
          nota="Inter trae la feature OpenType «tnum» de verdad: sustituye cada dígito por una variante de anchura fija. Sin ella las columnas de gramos se desplazan a cada actualización. Las dos filas de abajo son el mismo texto: la de arriba con tabular-nums, la de abajo sin ella. Si se ven iguales, la fuente no está cargando."
        >
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full">
              <caption className="sr-only">
                Comparación de cifras con y sin números tabulares
              </caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="etiqueta p-4 text-left text-text-3">
                    Variante
                  </th>
                  <th scope="col" className="etiqueta p-4 text-right text-text-3">
                    Energía
                  </th>
                  <th scope="col" className="etiqueta p-4 text-right text-text-3">
                    Proteína
                  </th>
                  <th scope="col" className="etiqueta p-4 text-right text-text-3">
                    Grasa
                  </th>
                </tr>
              </thead>
              <tbody className="cuerpo">
                <tr className="border-b border-line">
                  <th scope="row" className="p-4 text-left font-normal text-text-2">
                    tabular-nums
                  </th>
                  <td className="cifra p-4 text-right tabular-nums text-text">1.111 kcal</td>
                  <td className="cifra p-4 text-right tabular-nums text-text">111 g</td>
                  <td className="cifra p-4 text-right tabular-nums text-text">39 g</td>
                </tr>
                <tr className="border-b border-line">
                  <th scope="row" className="p-4 text-left font-normal text-text-2">
                    tabular-nums
                  </th>
                  <td className="cifra p-4 text-right tabular-nums text-text">1.847 kcal</td>
                  <td className="cifra p-4 text-right tabular-nums text-text">142 g</td>
                  <td className="cifra p-4 text-right tabular-nums text-text">61 g</td>
                </tr>
                <tr className="border-b border-line">
                  <th scope="row" className="p-4 text-left font-normal text-text-2">
                    proporcional
                  </th>
                  <td className="p-4 text-right font-semibold proportional-nums text-text-2">
                    1.111 kcal
                  </td>
                  <td className="p-4 text-right font-semibold proportional-nums text-text-2">
                    111 g
                  </td>
                  <td className="p-4 text-right font-semibold proportional-nums text-text-2">
                    39 g
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="p-4 text-left font-normal text-text-2">
                    proporcional
                  </th>
                  <td className="p-4 text-right font-semibold proportional-nums text-text-2">
                    1.847 kcal
                  </td>
                  <td className="p-4 text-right font-semibold proportional-nums text-text-2">
                    142 g
                  </td>
                  <td className="p-4 text-right font-semibold proportional-nums text-text-2">
                    61 g
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Seccion>

        <Seccion
          titulo="Superficies"
          nota="Gris neutro (slate), sin sesgo de matiz: con la marca ahora en verde, un gris frío o cálido «tiraría» hacia o contra ese verde y competiría con él en vez de dejarlo respirar. Las tarjetas de comida se separan por fondo, no por sombra. El número es el contraste de cada superficie contra el fondo de página; son diferencias de superficie, no de texto, y por eso son pequeñas a propósito."
        >
          <Muestras items={SUPERFICIES} />
        </Seccion>

        <Seccion
          titulo="Texto y líneas"
          nota="Contraste contra el fondo de página en cada tema. La especificación pide AAA (7:1) en las cifras nutricionales: sólo --text y --text-2 lo cumplen, así que ninguna cifra puede ir en --text-3."
        >
          <Muestras items={TEXTOS} />
        </Seccion>

        <Seccion
          titulo="Macronutrientes"
          nota="Azul / ámbar / violeta. Reemplaza la triada Okabe-Ito del sistema anterior (rediseño completo, 2026-08-17). Elegida evitando el eje rojo-verde —el más común en daltonismo— y evitando coincidir con el verde de marca, pero es un juicio de diseño, no una validación de laboratorio como lo era Okabe-Ito: por eso la barra de macros sigue llevando etiquetas directas obligatorias, ahora por prudencia y no sólo por contraste — si alguien las quita, la paleta pierde su única red de seguridad real."
        >
          <Muestras items={MACROS} />
        </Seccion>

        <Seccion
          titulo="Marca y estados"
          nota="La marca es verde (rediseño completo, 2026-08-17: reemplaza el índigo anterior). Es el match de dominio para un producto de nutrición — «Calorie & Nutrition Counter» en vez de un genérico «SaaS de confianza» — y esta vez SÍ hay un token de «éxito» de facto: el macro de grasa se movió a violeta, así que el verde ya no coincide con ningún macronutriente y la ambigüedad que forzaba a evitarlo en el sistema anterior desaparece. El éxito reutiliza --brand con icono, igual que antes; lo que cambia es que ahora puede ser literalmente verde sin colisionar. El rojo sigue reservado a error."
        >
          <Muestras items={ESTADOS} />
        </Seccion>

        <Seccion
          titulo="Forma"
          nota="Tres radios. Suficiente calidez sin parecer un juguete. Las clases cortas existen desde el pulido del sistema: antes había que escribir rounded-[var(--radius-lg)] porque los tokens de forma no estaban expuestos a Tailwind. Los componentes todavía usan la forma larga; migrarlos queda pendiente."
        >
          <ul className="grid gap-4 sm:grid-cols-3">
            {RADIOS.map((r) => (
              <li key={r.clase} className="rounded-lg border border-line bg-surface p-4">
                <div
                  className={`${r.clase} h-14 border border-line-strong bg-surface-2`}
                  aria-hidden="true"
                />
                <code className="etiqueta mt-3 block font-mono text-text">
                  .{r.clase}
                </code>
                <code className="etiqueta block font-mono text-text-3">
                  {r.token} · {r.valor}
                </code>
                <p className="cuerpo-sm mt-2 text-text-3">{r.uso}</p>
              </li>
            ))}
          </ul>

          <div className="mt-4 rounded-lg border border-line bg-surface p-6">
            <p className="etiqueta text-text-3">
              La única sombra del sistema, reservada a flotantes: popovers,
              diálogos, arrastre.
            </p>
            <div className="mt-4 flex items-center gap-4">
              <div
                className="rounded-base bg-surface p-4 shadow-pop"
                aria-hidden="true"
              >
                <span className="cuerpo-sm text-text-2">shadow-pop</span>
              </div>
              <code className="etiqueta font-mono text-text-3">
                --shadow-pop
              </code>
            </div>
          </div>
        </Seccion>

        <Seccion
          titulo="Movimiento"
          nota="Ningún componente declara una duración propia. La regla de asimetría es que la salida dura aproximadamente el 65 % de la entrada. Pasa el puntero por encima de las muestras para ver cada duración; con prefers-reduced-motion activo no debería moverse ninguna."
        >
          <ul className="grid gap-4 sm:grid-cols-2">
            {DURACIONES.map((d) => (
              <li
                key={d.clase}
                className={`rounded-lg border border-line bg-surface p-4 transition-colors ${d.clase} ease-suave hover:bg-brand-soft`}
              >
                <code className="etiqueta block font-mono text-text">
                  .{d.clase}
                </code>
                <span className="cifra etiqueta text-text-2">{d.valor}</span>
                <p className="cuerpo-sm mt-2 text-text-3">{d.uso}</p>
              </li>
            ))}
          </ul>

          <ul className="mt-4 grid gap-4 sm:grid-cols-3">
            {CURVAS.map((c) => (
              <li key={c.clase} className="rounded-lg border border-line bg-surface p-4">
                <code className="etiqueta block font-mono text-text">
                  .{c.clase}
                </code>
                <code className="etiqueta block font-mono text-text-3">
                  {c.valor}
                </code>
                <p className="cuerpo-sm mt-2 text-text-3">{c.uso}</p>
              </li>
            ))}
          </ul>
        </Seccion>

        <Seccion
          titulo="Foco de teclado"
          nota="Contorno de 2 px en el acento de marca, con 2 px de separación. Tabula hasta los tres controles de abajo: cada uno tiene un radio distinto y el contorno debe seguir su forma sin deformarla. Si el círculo se convierte en un cuadrado redondeado, ha vuelto el defecto que tenía la regla de foco."
        >
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface p-6">
            <button
              type="button"
              className="cuerpo-sm rounded-base bg-brand px-5 py-3 font-medium text-on-brand"
            >
              Radio base
            </button>
            <button
              type="button"
              className="cuerpo-sm rounded-lg border border-line-strong px-5 py-3 font-medium text-text"
            >
              Radio grande
            </button>
            <button
              type="button"
              className="cuerpo-sm size-12 rounded-full border border-line-strong font-medium text-text"
              aria-label="Control redondo de prueba"
            >
              ●
            </button>
          </div>
        </Seccion>

        <Seccion
          titulo="Barra de macros"
          nota="Capa 2 de las tres de presentación nutricional. Apilada y nunca donut: la barra permite marcar el objetivo en el eje, funciona a 320 px de ancho y se compacta en móvil sin perder información. Y no se oculta en móvil, que es donde más se consulta."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-surface p-6">
              <MacroBar
                kcal={1980}
                objetivoKcal={2000}
                panel={{ proteinaG: 142, carbohidratoG: 198, grasaG: 66 }}
              />
              <p className="cuerpo-sm mt-4 text-text-3">Dentro de objetivo.</p>
            </div>
            <div className="rounded-lg border border-line bg-surface p-6">
              <MacroBar
                kcal={2340}
                objetivoKcal={2000}
                panel={{ proteinaG: 118, carbohidratoG: 268, grasaG: 89 }}
              />
              <p className="cuerpo-sm mt-4 text-text-3">
                Desviado: el aviso aparece solo al superar el ±3 %.
              </p>
            </div>
          </div>
        </Seccion>

        <p className="cuerpo-sm max-w-2xl text-text-2">
          Lo que esta página todavía no verifica, para que nadie lo dé por
          comprobado: la triada de macros no se ha pasado por un simulador de
          daltonismo sobre capturas reales de la vista de plan —las muestras de
          aquí no tienen la geometría real—, y los contrastes de arriba están
          calculados, no medidos sobre lo que pinta el navegador.
        </p>
      </main>
    </div>
  );
}
