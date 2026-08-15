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

/**
 * Panel nutricional **por 100 g** de producto comestible: lo que dice la
 * etiqueta de un alimento.
 *
 * Un campo ausente y un campo a `null` significan lo mismo aquí —«no lo
 * sabemos»— y hay que admitir las dos escrituras porque hay dos productores: el
 * catálogo, que omite la clave, y el JSON del solver, que la serializa a `null`.
 * Aceptar sólo una de las dos obligaba a los consumidores a elegir entre
 * `?? null` y `!== undefined` según de dónde viniera el dato, que es la clase de
 * detalle que se olvida justo en el sitio donde importa.
 */
export interface PanelPor100g {
  kcal: number;
  proteinaG: number;
  carbohidratoG: number;
  grasaG: number;
  grasaSaturadaG?: number | null;
  azucaresG?: number | null;
  fibraG?: number | null;
  salG?: number | null;
}

/**
 * @deprecated Nombre histórico de `PanelPor100g`. Se conserva porque el mismo
 * tipo se usaba para dos cosas incompatibles —el panel por 100 g de un alimento
 * y los totales de un día— y sólo una de las dos se llamaba así con propiedad.
 * Los totales viven ahora en `TotalesNutricionales`. Migrar los usos y borrarlo.
 */
export type PanelNutricional = PanelPor100g;

/**
 * Totales **ya servidos**: la suma de las raciones de una comida o de un día.
 *
 * No es un `PanelPor100g` por más que se le parezca, y confundirlos costó un
 * bug real: la UI leía `totales.salG`, que el solver no emite ni puede emitir
 * (no tiene sal por receta, tiene sodio). Aquí `fibraG` y `sodioMg` son
 * requeridos y anulables a propósito: `null` es una afirmación —«este total no
 * es fiable, no lo enseñes como si lo fuera»— y ausentarlos dejaría que un
 * total parcial se leyera como total, que es exactamente la mentira que §8.5
 * prohíbe. `sodioMg` en miligramos porque es la unidad de la columna 5 del
 * motor; convertir a sal (×2,5/1000) es cosa de la presentación.
 */
export interface TotalesNutricionales {
  kcal: number;
  proteinaG: number;
  carbohidratoG: number;
  grasaG: number;
  /** `null` si menos del 80 % de las kcal tienen fibra conocida. */
  fibraG: number | null;
  /** `null` si algún item del total no declara sodio. */
  sodioMg: number | null;
}

export interface Alimento {
  id: string;
  nombre: string;
  fuente: FuenteNutricional;
  /** Identificador en la fuente original. Permite reingesta sin refactorizar. */
  fuenteRef: string;
  panel: PanelPor100g;
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
  totales: TotalesNutricionales;
}

export interface DiaPlan {
  /** ISO 8601, `YYYY-MM-DD`. */
  fecha: string;
  comidas: ComidaPlan[];
  totales: TotalesNutricionales;
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

/**
 * Plan generado, con todo lo necesario para volver a generarlo.
 *
 * Los cinco campos de debajo de `msTranscurridos` viajaban hasta ahora en
 * cabeceras HTTP (`X-PlanEat-Seed`, `X-PlanEat-Catalogo`, `X-PlanEat-Generador`,
 * `X-PlanEat-Pool`; ver `services/solver/app/main.py`). Al mover el motor al
 * navegador desaparece el servidor y con él las cabeceras: sin traerlos al
 * payload, un plan guardado o compartido deja de ser reproducible y el fallo es
 * indepurable en soporte, que es justo contra lo que avisaba el docstring del
 * endpoint. Se replican en `schemas.py` para que los dos motores sigan hablando
 * el mismo contrato mientras convivan.
 */
export interface RespuestaOk {
  ok: true;
  dias: DiaPlan[];
  msTranscurridos: number;
  /**
   * Semilla usada, en decimal y como **cadena**. Son 63 bits: un `number` sólo
   * garantiza 53 y el redondeo ocurriría en silencio —al serializar a JSON, al
   * pasar por la query de la URL o en un `parseInt`—, dejando el plan
   * irreproducible sin que nada falle. Tipar esto como `number` en cualquier
   * punto del monorepo es el bug que toda la disciplina de semillas evita.
   */
  seed: string;
  /** Hash del catálogo con el que se generó. Sin él, «mismo seed» no dice nada. */
  versionCatalogo: string;
  /** Versión del algoritmo. El motor del navegador y el de Python NO coinciden. */
  versionGenerador: string;
  /** Recetas admisibles tras los filtros duros. Diagnóstico, no decoración. */
  pool: number;
  /**
   * El pool se quedó corto por lo corto del catálogo, no por los filtros del
   * usuario (puerta 3 de §6.0). El plan es válido; la UI puede avisar de que la
   * variedad está limitada, pero no debe culpar de ello a quien lo pidió.
   */
  catalogoEstrecho: boolean;
}

export interface RespuestaError {
  ok: false;
  fallo: FalloGeneracion;
}

export type RespuestaGeneracion = RespuestaOk | RespuestaError;
