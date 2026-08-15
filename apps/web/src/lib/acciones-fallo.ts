/**
 * De un `FalloGeneracion` a tres botones que **ejecutan** el cambio.
 *
 * La regla de la pantalla de sobre-restricción es que un botón que dice
 * "Subir a 1 750 kcal" sube a 1 750 kcal y vuelve a generar. Si sólo abriera
 * los ajustes, habríamos fallado (docs/diseno-producto.md §3.6).
 *
 * El contrato entrega `sugerencias` como texto libre. Aquí se intenta leer de
 * ese texto la cifra que propone el motor, y si se consigue, el botón lleva
 * **la propuesta del motor con su número exacto**. Si no se consigue leerla, no
 * se inventa: esa sugerencia se muestra como texto y su hueco lo ocupa una
 * acción calculada a partir del objetivo del usuario, que también es real.
 *
 * Siempre salen exactamente tres acciones, y ninguna se guarda hasta que el
 * usuario la elige.
 */

import type { FalloGeneracion, ObjetivoNutricional } from "@planeat/shared";

import { kcal as formatearKcal, gramos } from "./formato";
import type { AjustesObjetivo, DatosFormulario } from "./perfil";

export interface AccionDeFallo {
  etiqueta: string;
  ajustes: AjustesObjetivo;
  /** Cierto si la propuesta la ha hecho el motor y no esta interfaz. */
  delMotor: boolean;
}

/** Números escritos como `1 750`, `1.750` o `1750`. */
function primerNumero(texto: string, patron: RegExp): number | null {
  const encontrado = patron.exec(texto);
  if (!encontrado) return null;
  const limpio = encontrado[1].replace(/[^\d]/g, "");
  const valor = Number.parseInt(limpio, 10);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

function leerSugerencia(texto: string): AjustesObjetivo | null {
  const kcalPropuestas = primerNumero(texto, /([\d][\d\s.,]*)\s*kcal/i);
  if (kcalPropuestas) return { kcal: kcalPropuestas };

  const proteinaPropuesta = primerNumero(
    texto,
    /([\d][\d\s.,]*)\s*g(?:ramos)?\s+de\s+prote/i,
  );
  if (proteinaPropuesta) return { proteinaMaxG: proteinaPropuesta };

  if (/fibra/i.test(texto)) return { sinMinimoFibra: true };
  if (/dieta|vegan|vegetarian|pescetarian|carbohidrato/i.test(texto)) {
    return { dieta: "omnivora" };
  }
  return null;
}

/** Acciones calculadas por la interfaz cuando el motor no propone una cifra. */
function accionesCalculadas(
  objetivo: ObjetivoNutricional,
  datos: DatosFormulario,
): AccionDeFallo[] {
  const kcalMas = Math.round((objetivo.kcal * 1.1) / 10) * 10;
  const proteinaMenos = Math.round(objetivo.proteinaG.max * 0.9);

  const acciones: AccionDeFallo[] = [
    {
      etiqueta: `Subir a ${formatearKcal(kcalMas)} kcal`,
      ajustes: { kcal: kcalMas },
      delMotor: false,
    },
    {
      etiqueta: `Bajar a ${gramos(proteinaMenos)} g de proteína`,
      ajustes: { proteinaMaxG: proteinaMenos },
      delMotor: false,
    },
  ];

  if (datos.dieta !== "omnivora") {
    acciones.push({
      etiqueta: "Permitir recetas de todo",
      ajustes: { dieta: "omnivora" },
      delMotor: false,
    });
  } else if (objetivo.fibraMinG > 0) {
    acciones.push({
      etiqueta: "Quitar el mínimo de fibra",
      ajustes: { sinMinimoFibra: true },
      delMotor: false,
    });
  } else {
    acciones.push({
      etiqueta: `Subir a ${formatearKcal(objetivo.kcal * 1.2)} kcal`,
      ajustes: { kcal: Math.round((objetivo.kcal * 1.2) / 10) * 10 },
      delMotor: false,
    });
  }

  return acciones;
}

/** Qué palanca toca una acción: kcal, proteína, dieta o fibra. */
function palanca(accion: AccionDeFallo): string {
  return Object.keys(accion.ajustes).sort().join("+");
}

export function accionesDeFallo(
  fallo: FalloGeneracion,
  objetivo: ObjetivoNutricional,
  datos: DatosFormulario,
): { acciones: AccionDeFallo[]; sugerenciasSoloTexto: string[] } {
  const acciones: AccionDeFallo[] = [];
  const sugerenciasSoloTexto: string[] = [];

  for (const sugerencia of fallo.sugerencias ?? []) {
    const ajustes = leerSugerencia(sugerencia);
    if (ajustes && acciones.length < 3) {
      acciones.push({ etiqueta: sugerencia, ajustes, delMotor: true });
    } else {
      sugerenciasSoloTexto.push(sugerencia);
    }
  }

  // Sólo se rellena con palancas que el motor no haya tocado ya. Si el motor
  // propone subir a 2 100 kcal, esta interfaz no puede proponer al lado subir a
  // 3 880: serían dos cifras contradictorias para la misma decisión.
  const palancasUsadas = new Set(acciones.map(palanca));
  for (const calculada of accionesCalculadas(objetivo, datos)) {
    if (acciones.length >= 3) break;
    if (palancasUsadas.has(palanca(calculada))) continue;
    palancasUsadas.add(palanca(calculada));
    acciones.push(calculada);
  }

  return { acciones: acciones.slice(0, 3), sugerenciasSoloTexto };
}
