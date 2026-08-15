import type { Metadata, Viewport } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import "./globals.css";

/**
 * Reparto estricto de dos fuentes (docs/diseno-producto.md §2.2, decidido en
 * docs/decisiones-de-diseno.md). Ambas OFL 1.1 y autoalojadas por next/font en
 * `_next/static/media`: el sitio publicado no pide nada a un tercero, que es
 * requisito para un export estático en Pages.
 *
 * Geist hace el TRABAJO: toda la interfaz, todo el cuerpo y todos los números.
 * Se queda porque cumple la restricción que manda sobre el gusto — trae la
 * feature OpenType `tnum` de verdad: cada dígito se sustituye por su variante
 * `.tf` de 600/1000 em, frente a las anchuras proporcionales de partida (el «1»
 * mide 384 y el «0» 663). Sin eso, `font-variant-numeric: tabular-nums` no
 * haría nada y la tabla nutricional bailaría a cada actualización.
 *
 * Instrument Serif pone la VOZ en cuatro sitios y en ninguno más. No es
 * variable: son dos ficheros estáticos, redonda e itálica, de ~20 KB cada uno.
 *
 * Geist Mono ya NO se carga. Era una familia entera descargada en todas las
 * rutas para una sola etiqueta `<code>` de /sistema; `--font-mono` cae ahora en
 * la mono del sistema (ver globals.css).
 */
const fuenteTrabajo = Geist({
  variable: "--fuente-trabajo",
  subsets: ["latin"],
});

const fuenteVoz = Instrument_Serif({
  variable: "--fuente-voz",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: {
    default: "PlanEat — Tu plan de comidas, resuelto",
    template: "%s · PlanEat",
  },
  description:
    "Planes de comida que cuadran con tus objetivos, tu presupuesto y lo que ya tienes en casa.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f4" },
    { media: "(prefers-color-scheme: dark)", color: "#171512" },
  ],
};

/**
 * Aplica el tema guardado antes del primer pintado. Sin esto, quien tenga
 * elegido "oscuro" ve un destello claro en cada carga.
 */
const themeInit = `
try {
  var t = localStorage.getItem("planeat-theme");
  if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
} catch (e) {}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      className={`${fuenteTrabajo.variable} ${fuenteVoz.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
