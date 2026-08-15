/**
 * Las tres capas de presentación nutricional, en lógica.
 *
 * docs/spec.md §9.3 y docs/diseno-producto.md §1.2, §4.5 y §6.4. Aquí vive el
 * veredicto (capa 1 en forma de estado) y las plantillas de frase (capa 1 en
 * forma de texto). Los componentes sólo pintan lo que sale de aquí, para que la
 * misma condición produzca siempre la misma palabra.
 *
 * Reglas que este módulo garantiza:
 * · El orden de los macros es Proteína → Carbohidratos → Grasa. Siempre.
 * · Tres estados de veredicto, nunca cinco.
 * · Ningún porcentaje de cumplimiento, ninguna nota, ninguna racha.
 */

import type { ObjetivoNutricional, PanelNutricional, Rango } from "@planeat/shared";

import { gramos, kcal as formatearKcal, numero } from "./formato";

// ---------------------------------------------------------------------------
// Macros
// ---------------------------------------------------------------------------

export type ClaveMacro = "proteinaG" | "carbohidratoG" | "grasaG";

export interface DefinicionMacro {
  clave: ClaveMacro;
  /** Etiqueta del gráfico. */
  etiqueta: string;
  /** El mismo concepto en prosa, en minúscula (§6.4). */
  enProsa: string;
  /** Token de color. Ningún componente escribe un literal. */
  color: string;
  /** El rango correspondiente dentro del objetivo. */
  rango: (objetivo: ObjetivoNutricional) => Rango;
  kcalPorGramo: number;
}

/** Orden fijo. No se reordena por magnitud ni por nada. */
export const MACROS: readonly DefinicionMacro[] = [
  {
    clave: "proteinaG",
    etiqueta: "Proteína",
    enProsa: "proteína",
    color: "var(--protein)",
    rango: (o) => o.proteinaG,
    kcalPorGramo: 4,
  },
  {
    clave: "carbohidratoG",
    etiqueta: "Carbohidratos",
    enProsa: "carbohidratos",
    color: "var(--carb)",
    rango: (o) => o.carbohidratoG,
    kcalPorGramo: 4,
  },
  {
    clave: "grasaG",
    etiqueta: "Grasa",
    enProsa: "grasa",
    color: "var(--fat)",
    rango: (o) => o.grasaG,
    kcalPorGramo: 9,
  },
] as const;

export type PanelMacros = Pick<PanelNutricional, ClaveMacro>;

export interface SegmentoMacro extends DefinicionMacro {
  gramos: number;
  /** kcal derivadas del macro (4/4/9). Es lo que da los anchos de la barra. */
  kcalDerivadas: number;
  /** Fracción del total derivado, 0–1. Los tres suman 1. */
  fraccion: number;
}

/**
 * Los anchos salen SIEMPRE de las kcal derivadas de los macros, nunca de
 * `panel.kcal`: así suman el 100 % por construcción. La cifra grande es
 * `panel.kcal`. Los dos números pueden discrepar un poco (redondeo, fibra,
 * alcohol) y por eso nunca se muestran juntos como si fueran el mismo.
 */
export function segmentos(panel: PanelMacros): SegmentoMacro[] {
  const crudos = MACROS.map((macro) => {
    const g = Math.max(0, panel[macro.clave] ?? 0);
    return { ...macro, gramos: g, kcalDerivadas: g * macro.kcalPorGramo };
  });
  const total = crudos.reduce((suma, s) => suma + s.kcalDerivadas, 0);
  return crudos.map((s) => ({
    ...s,
    fraccion: total > 0 ? s.kcalDerivadas / total : 0,
  }));
}

export function kcalDerivadas(panel: PanelMacros): number {
  return MACROS.reduce(
    (suma, macro) => suma + Math.max(0, panel[macro.clave] ?? 0) * macro.kcalPorGramo,
    0,
  );
}

// ---------------------------------------------------------------------------
// Veredicto — "cuadra / casi / no cuadra", sin números
// ---------------------------------------------------------------------------

export type EstadoVeredicto = "cuadra" | "casi" | "no_cuadra";

export interface PuntoMacro {
  macro: DefinicionMacro;
  /** Relleno = dentro de su rango. Anillo hueco = fuera. */
  dentro: boolean;
  /** Gramos que faltan (negativo) o sobran (positivo) hasta el rango. */
  desvio: number;
}

export interface Veredicto {
  estado: EstadoVeredicto;
  /** La palabra. Va siempre junto al icono: el color nunca va solo. */
  palabra: string;
  puntos: PuntoMacro[];
  /** kcal de más (positivo) o de menos (negativo) respecto al objetivo. */
  desvioKcal: number;
  /** Tolerancia absoluta en kcal, ya resuelta. */
  toleranciaKcal: number;
}

/**
 * Se compara en gramos enteros, que es como se muestran.
 *
 * Si no, un día con 103,4 g de carbohidratos y un rango de 81–103 se pinta
 * como «103 g de 81–103» con el punto hueco al lado: el usuario ve una cifra
 * dentro del rango marcada como fuera, y con razón deja de fiarse. La regla es
 * que el veredicto no puede contradecir a los números impresos.
 */
function desvioContraRango(valor: number, rango: Rango): number {
  const v = Math.round(valor);
  const min = Math.round(rango.min);
  const max = Math.round(rango.max);
  if (v < min) return v - min;
  if (v > max) return v - max;
  return 0;
}

export function calcularVeredicto(
  totales: PanelNutricional,
  objetivo: ObjetivoNutricional,
): Veredicto {
  const tolerancia = objetivo.kcal * objetivo.toleranciaKcal;
  const desvioKcal = totales.kcal - objetivo.kcal;

  const puntos: PuntoMacro[] = MACROS.map((macro) => {
    const desvio = desvioContraRango(totales[macro.clave] ?? 0, macro.rango(objetivo));
    return { macro, dentro: desvio === 0, desvio };
  });

  const macrosDentro = puntos.every((p) => p.dentro);
  const kcalDentro = Math.abs(desvioKcal) <= tolerancia;
  const kcalDentroDelDoble = Math.abs(desvioKcal) <= tolerancia * 2;

  let estado: EstadoVeredicto;
  if (kcalDentro && macrosDentro) estado = "cuadra";
  else if (kcalDentroDelDoble) estado = "casi";
  else estado = "no_cuadra";

  return {
    estado,
    palabra: estado === "cuadra" ? "Cuadra" : estado === "casi" ? "Casi" : "No cuadra",
    puntos,
    desvioKcal,
    toleranciaKcal: tolerancia,
  };
}

// ---------------------------------------------------------------------------
// Capa 1 — la frase. Es lo que lee el 80 % de la gente
// ---------------------------------------------------------------------------

/** Plantillas de docs/diseno-producto.md §6.4. Sin exclamaciones y sin elogio. */
export function fraseDelDia(
  totales: PanelNutricional,
  objetivo: ObjetivoNutricional,
  veredicto: Veredicto,
): string {
  const fuera = veredicto.puntos.filter((p) => !p.dentro);
  const desvio = Math.round(veredicto.desvioKcal);

  if (veredicto.estado === "cuadra") {
    return `El día cuadra: ${formatearKcal(totales.kcal)} kcal, con los tres macros dentro de tu rango.`;
  }

  if (veredicto.estado === "casi") {
    if (fuera.length > 0) {
      const peor = fuera.reduce((a, b) => (Math.abs(b.desvio) > Math.abs(a.desvio) ? b : a));
      const cantidad = gramos(Math.abs(peor.desvio));
      const resto = fuera.length > 1 ? "el resto anda cerca" : "lo demás cuadra";
      return peor.desvio < 0
        ? `Casi. Te faltan ${cantidad} g de ${peor.macro.enProsa} para tu rango; ${resto}.`
        : `Casi. Te pasas ${cantidad} g de ${peor.macro.enProsa}; ${resto}.`;
    }
    const tol = Math.round(objetivo.toleranciaKcal * 100);
    return desvio > 0
      ? `Te pasas ${numero(desvio)} kcal de tu objetivo. Con un margen del ±${tol} % no es nada raro.`
      : `Te quedas ${numero(-desvio)} kcal por debajo de tu objetivo. Con un margen del ±${tol} % no es nada raro.`;
  }

  return desvio > 0
    ? `Este día se pasa ${numero(desvio)} kcal de tu objetivo. Puedes cambiar una comida o ajustar el objetivo.`
    : `Este día se queda a ${numero(-desvio)} kcal de tu objetivo. Puedes cambiar una comida o ajustar el objetivo.`;
}

/** Capa 1 de una comida: qué parte del día cubre y qué proteína aporta. */
export function fraseDeLaComida(
  totales: PanelNutricional,
  kcalDelDia: number,
): string {
  if (kcalDelDia <= 0) {
    return `Aporta ${gramos(totales.proteinaG)} g de proteína.`;
  }
  const pct = Math.round((totales.kcal / kcalDelDia) * 100);
  return `Esta comida cubre el ${numero(pct)} % de tus calorías del día y aporta ${gramos(
    totales.proteinaG,
  )} g de proteína.`;
}

/**
 * Etiqueta accesible de una barra de macros: primero la conclusión, después los
 * datos. Un lector de pantalla no debe oír la lectura del gráfico antes que su
 * significado.
 */
export function etiquetaAccesible(panel: PanelMacros, conclusion: string): string {
  const detalle = segmentos(panel)
    .map((s) => `${s.etiqueta}, ${gramos(s.gramos)} gramos`)
    .join("; ");
  return `${conclusion} Reparto: ${detalle}.`;
}

/** Suma paneles. Se usa para los totales del día cuando hacen falta a mano. */
export function sumarPaneles(paneles: PanelNutricional[]): PanelNutricional {
  return paneles.reduce<PanelNutricional>(
    (acumulado, panel) => ({
      kcal: acumulado.kcal + panel.kcal,
      proteinaG: acumulado.proteinaG + panel.proteinaG,
      carbohidratoG: acumulado.carbohidratoG + panel.carbohidratoG,
      grasaG: acumulado.grasaG + panel.grasaG,
      fibraG: (acumulado.fibraG ?? 0) + (panel.fibraG ?? 0),
    }),
    { kcal: 0, proteinaG: 0, carbohidratoG: 0, grasaG: 0, fibraG: 0 },
  );
}
