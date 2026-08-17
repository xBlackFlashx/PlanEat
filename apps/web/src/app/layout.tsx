import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

/**
 * Reparto estricto de dos fuentes (docs/diseno-producto.md §2.2, revisado en
 * docs/decisiones-de-diseno.md). Ambas OFL 1.1 y autoalojadas por next/font en
 * `_next/static/media`: el sitio publicado no pide nada a un tercero, que es
 * requisito para un export estático en Pages.
 *
 * Sustituyen a Geist e Instrument Serif como parte de la revisión de marca:
 * mismo reparto de papeles, otras dos familias.
 *
 * Inter hace el TRABAJO: toda la interfaz, todo el cuerpo y todos los números.
 * Cumple la restricción que manda sobre el gusto — trae la feature OpenType
 * `tnum` de verdad, comprobado sobre el fichero de la fuente y no supuesto
 * por reputación: cada dígito tiene su variante tabular. Sin eso,
 * `font-variant-numeric: tabular-nums` no haría nada y la tabla nutricional
 * bailaría a cada actualización.
 *
 * Space Grotesk pone la VOZ en cuatro sitios y en ninguno más. Variable
 * (300–700), un solo fichero.
 */
const fuenteTrabajo = Inter({
  variable: "--fuente-trabajo",
  subsets: ["latin"],
});

const fuenteVoz = Space_Grotesk({
  variable: "--fuente-voz",
  subsets: ["latin"],
  weight: ["400"],
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
    { media: "(prefers-color-scheme: light)", color: "#f7f7fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e16" },
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
