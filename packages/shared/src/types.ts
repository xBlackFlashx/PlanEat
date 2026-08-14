/**
 * Tipos de dominio de PlanEat.
 *
 * Estos tipos son el contrato entre la app web y el servicio solver. Cualquier
 * cambio aquí obliga a revisar `services/solver/app/schemas.py`.
 */

// ---------------------------------------------------------------------------
// Perfil y objetivos
// ---------------------------------------------------------------------------

export type Sexo = "hombre" | "mujer";

/** Multiplicadores estándar sobre el metabolismo basal. */
export type NivelActividad =
  | "sedentario"
  | "ligero"
  | "moderado"
  | "activo"
  | "muy_activo";

export type Objetivo = "perder" | "mantener" | "ganar";

export interface PerfilFisico {
  sexo: Sexo;
  edad: number;
  /** Kilogramos. */
  peso: number;
  /** Centímetros. */
  altura: number;
  actividad: NivelActividad;
  objetivo: Objetivo;
  /** Fracción 0–1. Opcional: si está, la proteína se calcula sobre masa magra. */
  porcentajeGrasa?: number;
}

/**
 * Objetivo nutricional de un día. Los macros se expresan como rango, no como
 * valor exacto: el solver necesita holgura para producir variedad, y una
 * precisión falsa destruye la confianza del usuario.
 */
export interface ObjetivoNutricional {
  kcal: number;
  /** Tolerancia relativa sobre kcal. 0.03 = ±3 %. */
  toleranciaKcal: number;
  proteinaG: Rango;
  carbohidratoG: Rango;
  grasaG: Rango;
  fibraMinG: number;
  sodioMaxMg?: number;
}

export interface Rango {
  min: number;
  max: number;
}

// ---------------------------------------------------------------------------
// Alimentos y recetas
// ---------------------------------------------------------------------------

export type FuenteNutricional = "usda" | "ciqual" | "openfoodfacts" | "propia";

/** Panel nutricional por 100 g de producto comestible. */
export interface PanelNutricional {
  kcal: number;
  proteinaG: number;
  carbohidratoG: number;
  grasaG: number;
  grasaSaturadaG?: number;
  azucaresG?: number;
  fibraG?: number;
  salG?: number;
}

export interface Alimento {
  id: string;
  nombre: string;
  fuente: FuenteNutricional;
  /** Identificador en la fuente original. Permite reingesta sin refactorizar. */
  fuenteRef: string;
  panel: PanelNutricional;
  /** Formatos reales de compra, para convertir la lista a algo comprable. */
  formatosCompra?: FormatoCompra[];
  alergenos: Alergeno[];
  categoriaSupermercado?: string;
}

export interface FormatoCompra {
  descripcion: string;
  gramos: number;
  precioEstimadoCents?: number;
}

/** Los 14 alérgenos de declaración obligatoria en la UE (Reg. 1169/2011). */
export type Alergeno =
  | "gluten"
  | "crustaceos"
  | "huevos"
  | "pescado"
  | "cacahuetes"
  | "soja"
  | "lacteos"
  | "frutos_de_cascara"
  | "apio"
  | "mostaza"
  | "sesamo"
  | "sulfitos"
  | "altramuces"
  | "moluscos";

export type TipoDieta =
  | "omnivora"
  | "vegetariana"
  | "vegana"
  | "pescetariana"
  | "baja_en_carbohidratos"
  | "mediterranea";

export interface Ingrediente {
  alimentoId: string;
  gramos: number;
  /** Texto tal y como se muestra: "2 cdas · 25 g". */
  descripcion: string;
  /** Si es falso, el escalado de raciones no altera esta cantidad (ej. sal). */
  escalable: boolean;
}

export interface Receta {
  id: string;
  titulo: string;
  ingredientes: Ingrediente[];
  pasos: string[];
  minutosPreparacion: number;
  minutosCoccion: number;
  racionesBase: number;
  dietas: TipoDieta[];
  alergenos: Alergeno[];
  slotsAdmitidos: SlotComida[];
  imagenUrl?: string;
  /** Trazabilidad de la revisión por dietista. Sin esto no se publica. */
  revisadaPor?: string;
  revisadaEn?: string;
  /**
   * Reservado para batch cooking (v1). Se define ahora para no migrar el
   * esquema después; la lógica de generación aún no lo usa.
   */
  batchGroupId?: string | null;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type SlotComida =
  | "desayuno"
  | "almuerzo"
  | "comida"
  | "merienda"
  | "cena";

export interface ItemPlan {
  recetaId: string;
  /** Multiplicador continuo sobre las raciones base. El solver lo optimiza. */
  factorRacion: number;
  /** Un item bloqueado no se regenera. */
  bloqueado: boolean;
}

export interface ComidaPlan {
  slot: SlotComida;
  items: ItemPlan[];
  totales: PanelNutricional;
}

export interface DiaPlan {
  /** ISO 8601, `YYYY-MM-DD`. */
  fecha: string;
  comidas: ComidaPlan[];
  totales: PanelNutricional;
  objetivo: ObjetivoNutricional;
}

export interface Plan {
  id: string;
  usuarioId: string;
  dias: DiaPlan[];
  creadoEn: string;
}

// ---------------------------------------------------------------------------
// Contrato con el servicio solver
// ---------------------------------------------------------------------------

export interface RestriccionesGeneracion {
  dieta: TipoDieta;
  alergenosExcluidos: Alergeno[];
  ingredientesExcluidos: string[];
  slots: SlotComida[];
  /** Minutos disponibles por slot. Ausente = sin límite. */
  minutosMaxPorSlot?: Partial<Record<SlotComida, number>>;
  comensales: number;
  presupuestoSemanalCents?: number;
  /** Alimentos ya en casa: el solver les da prioridad. */
  despensaAlimentoIds?: string[];
  /** Recetas usadas recientemente, para penalizar repetición. */
  recetasRecientes?: string[];
}

export interface SolicitudGeneracion {
  objetivos: ObjetivoNutricional[];
  restricciones: RestriccionesGeneracion;
  /** Fija la aleatoriedad para poder reproducir un plan en soporte y en tests. */
  seed?: number;
}

/**
 * Cuando el solver no encuentra solución, devuelve qué restricción ata en lugar
 * de un error genérico. La UI lo convierte en salidas concretas para el usuario.
 */
export interface FalloGeneracion {
  restriccionCulpable: string;
  mensaje: string;
  recetasCandidatas: number;
  sugerencias: string[];
}

export type RespuestaGeneracion =
  | { ok: true; dias: DiaPlan[]; msTranscurridos: number }
  | { ok: false; fallo: FalloGeneracion };
