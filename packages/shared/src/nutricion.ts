/**
 * Cálculo de objetivos nutricionales.
 *
 * Fórmulas estándar de la industria, deliberadamente transparentes: el usuario
 * debe poder auditar de dónde sale su número. Nada aquí es propietario.
 *
 * AVISO: son estimaciones poblacionales, no consejo médico. Ver el descargo en
 * docs/legal.md antes de exponer estos valores en producto.
 */

import type {
  NivelActividad,
  Objetivo,
  ObjetivoNutricional,
  PerfilFisico,
  Sexo,
} from "./types";

/** Multiplicadores sobre el metabolismo basal para estimar el gasto total. */
export const FACTOR_ACTIVIDAD: Record<NivelActividad, number> = {
  sedentario: 1.2,
  ligero: 1.375,
  moderado: 1.55,
  activo: 1.725,
  muy_activo: 1.9,
};

/** Ajuste sobre el gasto total según el objetivo. */
export const AJUSTE_OBJETIVO: Record<Objetivo, number> = {
  perder: -0.2,
  mantener: 0,
  ganar: 0.15,
};

/**
 * Metabolismo basal por Mifflin-St Jeor (1990).
 *
 * Es la fórmula con menor error medio en población general y el estándar de
 * facto. Sobrestima en personas con obesidad y subestima en muy musculadas;
 * cuando hay porcentaje de grasa disponible, `calcularObjetivo` usa masa magra
 * para la proteína por ese motivo.
 */
export function metabolismoBasal(params: {
  sexo: Sexo;
  pesoKg: number;
  alturaCm: number;
  edad: number;
}): number {
  const { sexo, pesoKg, alturaCm, edad } = params;
  const base = 10 * pesoKg + 6.25 * alturaCm - 5 * edad;
  return base + (sexo === "hombre" ? 5 : -161);
}

/** Gasto energético total diario. */
export function gastoTotal(perfil: PerfilFisico): number {
  const bmr = metabolismoBasal({
    sexo: perfil.sexo,
    pesoKg: perfil.peso,
    alturaCm: perfil.altura,
    edad: perfil.edad,
  });
  return bmr * FACTOR_ACTIVIDAD[perfil.actividad];
}

/** Suelo de seguridad: por debajo de esto no se emite un objetivo. */
export const KCAL_MINIMAS: Record<Sexo, number> = {
  hombre: 1500,
  mujer: 1200,
};

export interface OpcionesObjetivo {
  /**
   * Gramos de proteína por kg. Sobre masa magra si hay % de grasa, sobre peso
   * total en caso contrario. Por defecto 1,8 — rango razonable para alguien
   * activo que quiere preservar masa muscular en déficit.
   */
  proteinaPorKg?: number;
  /** Fracción de las kcal que aporta la grasa. Por defecto 0,3. */
  fraccionGrasa?: number;
}

/**
 * Deriva el objetivo diario completo a partir del perfil.
 *
 * Los macros salen como rango con holgura ±12 % (±8 % en proteína, que es la
 * restricción que más importa) porque el solver necesita margen para producir
 * variedad. Un objetivo exacto produce planes repetitivos o insatisfacibles.
 */
export function calcularObjetivo(
  perfil: PerfilFisico,
  opciones: OpcionesObjetivo = {},
): ObjetivoNutricional {
  const { proteinaPorKg = 1.8, fraccionGrasa = 0.3 } = opciones;

  const tdee = gastoTotal(perfil);
  const objetivoKcalBruto = tdee * (1 + AJUSTE_OBJETIVO[perfil.objetivo]);
  const kcal = Math.round(
    Math.max(objetivoKcalBruto, KCAL_MINIMAS[perfil.sexo]),
  );

  // La proteína se ancla a masa magra cuando se conoce: es el mejor predictor
  // de la necesidad real y evita sobreestimar en personas con obesidad.
  const pesoReferencia =
    perfil.porcentajeGrasa != null
      ? perfil.peso * (1 - perfil.porcentajeGrasa)
      : perfil.peso;

  const proteinaG = pesoReferencia * proteinaPorKg;
  const grasaG = (kcal * fraccionGrasa) / 9;
  const carbohidratoG = Math.max(
    0,
    (kcal - proteinaG * 4 - grasaG * 9) / 4,
  );

  return {
    kcal,
    toleranciaKcal: 0.03,
    proteinaG: rango(proteinaG, 0.08),
    carbohidratoG: rango(carbohidratoG, 0.12),
    grasaG: rango(grasaG, 0.12),
    // 14 g por cada 1000 kcal — recomendación de la EFSA redondeada.
    fibraMinG: Math.round((kcal / 1000) * 14),
  };
}

function rango(centro: number, tolerancia: number) {
  return {
    min: Math.round(centro * (1 - tolerancia)),
    max: Math.round(centro * (1 + tolerancia)),
  };
}

/** Redondeo honesto para mostrar en UI: "≈ 2.140 kcal", no "2.137,4 kcal". */
export function kcalPresentables(kcal: number): number {
  return Math.round(kcal / 10) * 10;
}
