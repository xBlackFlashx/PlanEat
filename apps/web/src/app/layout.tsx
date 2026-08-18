import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";

import { ProveedorSesion } from "@/components/proveedor-sesion";

/**
 * Reparto estricto de dos fuentes (docs/diseno-producto.md §2.2, revisado en
 * docs/decisiones-de-diseno.md). Ambas OFL 1.1 y autoalojadas por next/font en
 * `_next/static/media`: el sitio publicado no pide nada a un tercero, que es
 * requisito para un export estático en Pages.
 *
 * Rediseño completo 2026-08-17: Poppins sustituye a Space Grotesk como voz de
 * marca (design-system/planeat/MASTER.md — moodboard "modern, professional,
 * friendly"). Inter se queda intacto en el papel de trabajo — no es una
 * concesión al sistema anterior, es una restricción técnica que sigue
 * mandando sobre el gusto: trae la feature OpenType `tnum` de verdad,
 * comprobado sobre el fichero de la fuente y no supuesto por reputación.
 * Poppins no se ha verificado para ese uso y no lo necesita, porque nunca
 * lleva una cifra.
 *
 * Inter hace el TRABAJO: toda la interfaz, todo el cuerpo y todos los números.
 * Sin `tnum` real, `font-variant-numeric: tabular-nums` no haría nada y la
 * tabla nutricional bailaría a cada actualización.
 *
 * Poppins pone la VOZ en cuatro sitios y en ninguno más: no es variable en
 * Google Fonts, así que se carga sólo el peso 400 que la escala usa.
 */
const fuenteTrabajo = Inter({
  variable: "--fuente-trabajo",
  subsets: ["latin"],
});

const fuenteVoz = Poppins({
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
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
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
      <body className="min-h-full flex flex-col">
        <ProveedorSesion>{children}</ProveedorSesion>
      </body>
    </html>
  );
}
