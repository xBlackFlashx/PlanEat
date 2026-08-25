/**
 * El formulario del generador público, como datos.
 *
 * Este módulo es puro y se usa en los dos lados: el cliente lo utiliza para
 * validar antes de enviar y el servidor para validar lo que llega por la URL
 * (el formulario funciona sin JavaScript, así que el servidor no puede confiar
 * en la validación del navegador).
 *
 * Regla de producto: los campos vienen precargados con valores medianos. El
 * usuario corrige, no rellena (docs/diseno-producto.md §3.1).
 */

import {
  type Alergeno,
  calcularObjetivo,
  gastoTotal,
  AJUSTE_OBJETIVO,
  KCAL_MINIMAS,
  type NivelActividad,
  type Objetivo,
  type ObjetivoNutricional,
  type PerfilFisico,
  type Sexo,
  type SlotComida,
  type SolicitudGeneracion,
  type TipoDieta,
} from "@planeat/shared";

// ---------------------------------------------------------------------------
// Vocabulario de la interfaz
// ---------------------------------------------------------------------------

export const SEXOS: { valor: Sexo; etiqueta: string }[] = [
  { valor: "mujer", etiqueta: "mujer" },
  { valor: "hombre", etiqueta: "hombre" },
];

export const OBJETIVOS: { valor: Objetivo; etiqueta: string }[] = [
  { valor: "perder", etiqueta: "adelgazar" },
  { valor: "mantener", etiqueta: "mantenerme" },
  { valor: "ganar", etiqueta: "ganar músculo" },
];

/**
 * Microcopy de calibración del nivel de actividad. Es el punto exacto donde
 * está el sesgo: el usuario elige la semana que le gustaría tener, no la que
 * tiene (docs/spec.md §4.1).
 */
export const ACTIVIDADES: {
  valor: NivelActividad;
  etiqueta: string;
  ayuda: string;
}[] = [
  {
    valor: "sedentario",
    etiqueta: "casi nada",
    ayuda: "Trabajo sentado, poco o ningún ejercicio",
  },
  {
    valor: "ligero",
    etiqueta: "poco",
    ayuda: "Algo de movimiento, 1 o 2 días de ejercicio suave",
  },
  {
    valor: "moderado",
    etiqueta: "lo normal",
    ayuda: "Ejercicio moderado 3 o 4 días",
  },
  {
    valor: "activo",
    etiqueta: "bastante",
    ayuda: "Entreno duro 5 o 6 días",
  },
  {
    valor: "muy_activo",
    etiqueta: "mucho",
    ayuda: "Entreno a diario, o trabajo físico",
  },
];

export const DIETAS: { valor: TipoDieta; etiqueta: string }[] = [
  { valor: "omnivora", etiqueta: "de todo" },
  { valor: "mediterranea", etiqueta: "mediterráneo" },
  { valor: "vegetariana", etiqueta: "vegetariano" },
  { valor: "vegana", etiqueta: "vegano" },
  { valor: "pescetariana", etiqueta: "pescetariano" },
  { valor: "baja_en_carbohidratos", etiqueta: "bajo en carbohidratos" },
];

/**
 * Los catorce alérgenos de declaración obligatoria, escritos como se leen.
 *
 * El identificador del catálogo va sin acentos y con guiones bajos por razones
 * técnicas; enseñárselo así al usuario en la pantalla donde comprueba si algo
 * le sienta mal sería descuidado justo donde no toca.
 */
export const NOMBRE_ALERGENO: Record<Alergeno, string> = {
  gluten: "gluten",
  crustaceos: "crustáceos",
  huevos: "huevos",
  pescado: "pescado",
  cacahuetes: "cacahuates",
  soja: "soya",
  lacteos: "lácteos",
  frutos_de_cascara: "frutos de cáscara",
  apio: "apio",
  mostaza: "mostaza",
  sesamo: "ajonjolí",
  sulfitos: "sulfitos",
  altramuces: "altramuces",
  moluscos: "moluscos",
  paprika: "paprika",
  vainilla: "vainilla",
  sal: "sal",
  miel: "miel",
  mayonesa: "mayonesa",
  vinagre: "vinagre",
  pesto: "pesto",
  mermelada: "mermelada",
  tofu: "tofu",
  tempeh: "tempeh",
  salsa: "salsa",
  azafran: "azafrán",
  clavo: "clavo",
  anis: "anís",
  cardamomo: "cardamomo",
  nuez_moscada: "nuez moscada",
  azucar: "azúcar",
  catsup: "cátsup",
  mole: "mole",
  hummus: "hummus",
  guacamole: "guacamole",
  cajeta: "cajeta",
  chocolate: "chocolate",
  cacao: "cacao",
  gelatina: "gelatina",
  seitan: "seitán",
  proteina: "proteína",
  cafe: "café",
  te: "té",
  huevo: "huevo",
  pollo: "pollo",
  pavo: "pavo",
  res: "res",
  cerdo: "cerdo",
  cordero: "cordero",
  conejo: "conejo",
  pato: "pato",
  codorniz: "codorniz",
  ternera: "ternera",
  bistec: "bistec",
  filete: "filete",
  costilla: "costilla",
  chuleta: "chuleta",
  jamon: "jamón",
  tocino: "tocino",
  salchicha: "salchicha",
  chorizo: "chorizo",
  cecina: "cecina",
  carne: "carne",
  higado: "hígado",
  atun: "atún",
  salmon: "salmón",
  sardina: "sardina",
  trucha: "trucha",
  tilapia: "tilapia",
  bacalao: "bacalao",
  merluza: "merluza",
  robalo: "robalo",
  huachinango: "huachinango",
  mojarra: "mojarra",
  camaron: "camarón",
  langosta: "langosta",
  cangrejo: "cangrejo",
  pulpo: "pulpo",
  calamar: "calamar",
  ostion: "ostión",
  almeja: "almeja",
  mejillon: "mejillón",
  cacahuate: "cacahuate",
  almendra: "almendra",
  nuez: "nuez",
  pistache: "pistache",
  avellana: "avellana",
  macadamia: "macadamia",
  castana: "castaña",
  nuezpecana: "nuezpecana",
  pinon: "piñón",
  chia: "chía",
  linaza: "linaza",
  ajonjoli: "ajonjolí",
  girasol: "girasol",
  pepita: "pepita",
  canamo: "cáñamo",
  amaranto: "amaranto",
  manzana: "manzana",
  platano: "plátano",
  naranja: "naranja",
  mandarina: "mandarina",
  limon: "limón",
  lima: "lima",
  toronja: "toronja",
  uva: "uva",
  fresa: "fresa",
  frambuesa: "frambuesa",
  zarzamora: "zarzamora",
  arandano: "arándano",
  cereza: "cereza",
  durazno: "durazno",
  nectarina: "nectarina",
  ciruela: "ciruela",
  pera: "pera",
  mango: "mango",
  papaya: "papaya",
  pina: "piña",
  sandia: "sandía",
  melon: "melón",
  kiwi: "kiwi",
  guayaba: "guayaba",
  granada: "granada",
  higo: "higo",
  datil: "dátil",
  coco: "coco",
  maracuya: "maracuyá",
  lichi: "lichi",
  carambola: "carambola",
  pitahaya: "pitahaya",
  tuna: "tuna",
  mamey: "mamey",
  zapote: "zapote",
  guanabana: "guanábana",
  chirimoya: "chirimoya",
  tejocote: "tejocote",
  tamarindo: "tamarindo",
  membrillo: "membrillo",
  persimon: "persimón",
  grosella: "grosella",
  acerola: "acerola",
  rambutan: "rambután",
  lechuga: "lechuga",
  espinaca: "espinaca",
  acelga: "acelga",
  col: "col",
  kale: "kale",
  arugula: "arúgula",
  berro: "berro",
  brocoli: "brócoli",
  coliflor: "coliflor",
  zanahoria: "zanahoria",
  jitomate: "jitomate",
  tomate: "tomate",
  pepino: "pepino",
  calabaza: "calabaza",
  calabacita: "calabacita",
  chayote: "chayote",
  berenjena: "berenjena",
  pimiento: "pimiento",
  chile: "chile",
  jalapeno: "jalapeño",
  serrano: "serrano",
  poblano: "poblano",
  habanero: "habanero",
  cebolla: "cebolla",
  ajo: "ajo",
  nopal: "nopal",
  rabano: "rábano",
  betabel: "betabel",
  esparrago: "espárrago",
  alcachofa: "alcachofa",
  poro: "poro",
  jicama: "jícama",
  ejote: "ejote",
  elote: "elote",
  champinon: "champiñón",
  hongo: "hongo",
  coles: "coles",
  endivia: "endivia",
  escarola: "escarola",
  quelite: "quelite",
  verdolaga: "verdolaga",
  huauzontle: "huauzontle",
  frijol: "frijol",
  lenteja: "lenteja",
  garbanzo: "garbanzo",
  chicharo: "chícharo",
  haba: "haba",
  soya: "soya",
  alubia: "alubia",
  edamame: "edamame",
  arroz: "arroz",
  avena: "avena",
  trigo: "trigo",
  maiz: "maíz",
  cebada: "cebada",
  centeno: "centeno",
  quinoa: "quinoa",
  mijo: "mijo",
  sorgo: "sorgo",
  espelta: "espelta",
  bulgur: "bulgur",
  cuscus: "cuscús",
  farro: "farro",
  papa: "papa",
  camote: "camote",
  yuca: "yuca",
  name: "ñame",
  malanga: "malanga",
  tapioca: "tapioca",
  leche: "leche",
  queso: "queso",
  yogur: "yogur",
  crema: "crema",
  mantequilla: "mantequilla",
  requeson: "requesón",
  jocoque: "jocoque",
  kefir: "kéfir",
  cuajada: "cuajada",
  ricotta: "ricotta",
  mozzarella: "mozzarella",
  manchego: "manchego",
  cheddar: "cheddar",
  parmesano: "parmesano",
  gouda: "gouda",
  cottage: "cottage",
  panela: "panela",
  pan: "pan",
  tortilla: "tortilla",
  tostada: "tostada",
  bolillo: "bolillo",
  telera: "telera",
  baguette: "baguette",
  bagel: "bagel",
  croissant: "croissant",
  galleta: "galleta",
  granola: "granola",
  cereal: "cereal",
  pasta: "pasta",
  espagueti: "espagueti",
  macarron: "macarrón",
  fideo: "fideo",
  lasana: "lasaña",
  aguacate: "aguacate",
  aceituna: "aceituna",
  oliva: "oliva",
  aceite: "aceite",
  manteca: "manteca",
  tahini: "tahini",
  cilantro: "cilantro",
  perejil: "perejil",
  albahaca: "albahaca",
  oregano: "orégano",
  romero: "romero",
  tomillo: "tomillo",
  menta: "menta",
  hierbabuena: "hierbabuena",
  eneldo: "eneldo",
  laurel: "laurel",
  salvia: "salvia",
  estragon: "estragón",
  curcuma: "cúrcuma",
  jengibre: "jengibre",
  canela: "canela",
  pimienta: "pimienta",
  comino: "comino",
};

export function nombreAlergeno(id: string): string {
  return NOMBRE_ALERGENO[id as Alergeno] ?? id.replace(/_/g, " ");
}

/** Nombre real de cada franja. Nunca "slot" en la interfaz (glosario, §6.2). */
export const NOMBRE_SLOT: Record<SlotComida, string> = {
  desayuno: "Desayuno",
  almuerzo: "Almuerzo",
  comida: "Comida",
  merienda: "Merienda",
  cena: "Cena",
};

/** Orden cronológico. No se altera nunca. */
export const ORDEN_SLOTS: SlotComida[] = [
  "desayuno",
  "almuerzo",
  "comida",
  "merienda",
  "cena",
];

/**
 * Número de comidas → qué franjas. Se añaden por el orden en que la gente las
 * añade de verdad: primero la merienda, después el almuerzo de media mañana.
 */
export const LAYOUTS: Record<number, SlotComida[]> = {
  1: ["comida"],
  2: ["comida", "cena"],
  3: ["desayuno", "comida", "cena"],
  4: ["desayuno", "comida", "merienda", "cena"],
  5: ["desayuno", "almuerzo", "comida", "merienda", "cena"],
};

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

export interface DatosFormulario {
  sexo: Sexo;
  edad: number;
  altura: number;
  peso: number;
  actividad: NivelActividad;
  objetivo: Objetivo;
  dieta: TipoDieta;
  comidas: number;
  /** Alérgenos a excluir. Filtra por seguridad alimentaria (`mAlergeno`). */
  alergenosExcluidos: Alergeno[];
  /** Ids de `apps/web/src/lib/alimentos.ts` a excluir. Filtra por gusto. */
  ingredientesExcluidos: string[];
}

/** Medianas de la población adulta española, redondeadas. */
export const FORMULARIO_POR_DEFECTO: DatosFormulario = {
  sexo: "mujer",
  edad: 32,
  altura: 165,
  peso: 65,
  actividad: "ligero",
  objetivo: "mantener",
  dieta: "omnivora",
  comidas: 3,
  alergenosExcluidos: [],
  ingredientesExcluidos: [],
};

export const LIMITES = {
  edad: { min: 18, max: 99 },
  altura: { min: 120, max: 230 },
  peso: { min: 35, max: 250 },
} as const;

export type CampoFormulario = keyof DatosFormulario;

/** Errores por campo. Cada mensaje propone la corrección (§6.7). */
export type ErroresFormulario = Partial<Record<CampoFormulario, string>>;

export function validar(datos: DatosFormulario): ErroresFormulario {
  const errores: ErroresFormulario = {};

  if (!Number.isFinite(datos.edad) || datos.edad < LIMITES.edad.min || datos.edad > LIMITES.edad.max) {
    errores.edad =
      "Introduce una edad entre 18 y 99. Este producto no está pensado para menores.";
  }

  if (!Number.isFinite(datos.altura)) {
    errores.altura = "Falta la altura, en centímetros: 168, no 1,68.";
  } else if (datos.altura < 100) {
    errores.altura = "La altura en centímetros: 168, no 1,68.";
  } else if (datos.altura < LIMITES.altura.min || datos.altura > LIMITES.altura.max) {
    errores.altura = `¿${Math.round(datos.altura)} cm? Compruébalo — acepto entre 120 y 230.`;
  }

  if (!Number.isFinite(datos.peso)) {
    errores.peso = "Falta el peso, en kilogramos.";
  } else if (datos.peso < LIMITES.peso.min || datos.peso > LIMITES.peso.max) {
    errores.peso = `¿${Math.round(datos.peso)} kg? Compruébalo — acepto entre 35 y 250.`;
  }

  return errores;
}

export function hayErrores(errores: ErroresFormulario): boolean {
  return Object.keys(errores).length > 0;
}

// ---------------------------------------------------------------------------
// Lectura desde la URL (el formulario envía por GET cuando no hay JavaScript)
// ---------------------------------------------------------------------------

type ParametrosCrudos = Record<string, string | string[] | undefined>;

function texto(crudos: ParametrosCrudos, clave: string): string | undefined {
  const valor = crudos[clave];
  return Array.isArray(valor) ? valor[0] : valor;
}

/** Un parámetro repetido (`?alergeno=gluten&alergeno=lacteos`) como lista. */
function lista(crudos: ParametrosCrudos, clave: string): string[] {
  const valor = crudos[clave];
  if (valor === undefined) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function enteroOPorDefecto(bruto: string | undefined, porDefecto: number): number {
  if (bruto == null || bruto.trim() === "") return porDefecto;
  // Se acepta la coma decimal: quien escribe "1,68" merece un mensaje, no un NaN.
  const limpio = bruto.replace(",", ".").replace(/[^\d.-]/g, "");
  const valor = Number.parseFloat(limpio);
  return Number.isFinite(valor) ? Math.round(valor) : Number.NaN;
}

function unoDe<T extends string>(
  bruto: string | undefined,
  admitidos: readonly T[],
  porDefecto: T,
): T {
  return admitidos.includes(bruto as T) ? (bruto as T) : porDefecto;
}

/** Nunca lanza: devuelve el formulario relleno y los errores por separado. */
export function leerFormulario(crudos: ParametrosCrudos): DatosFormulario {
  return {
    sexo: unoDe(texto(crudos, "sexo"), ["mujer", "hombre"] as const, FORMULARIO_POR_DEFECTO.sexo),
    edad: enteroOPorDefecto(texto(crudos, "edad"), FORMULARIO_POR_DEFECTO.edad),
    altura: enteroOPorDefecto(texto(crudos, "altura"), FORMULARIO_POR_DEFECTO.altura),
    peso: enteroOPorDefecto(texto(crudos, "peso"), FORMULARIO_POR_DEFECTO.peso),
    actividad: unoDe(
      texto(crudos, "actividad"),
      ACTIVIDADES.map((a) => a.valor),
      FORMULARIO_POR_DEFECTO.actividad,
    ),
    objetivo: unoDe(
      texto(crudos, "objetivo"),
      OBJETIVOS.map((o) => o.valor),
      FORMULARIO_POR_DEFECTO.objetivo,
    ),
    dieta: unoDe(
      texto(crudos, "dieta"),
      DIETAS.map((d) => d.valor),
      FORMULARIO_POR_DEFECTO.dieta,
    ),
    comidas: [1, 2, 3, 4, 5].includes(enteroOPorDefecto(texto(crudos, "comidas"), 3))
      ? enteroOPorDefecto(texto(crudos, "comidas"), 3)
      : 3,
    // Alérgenos desconocidos se descartan aquí (vocabulario cerrado, ver
    // `NOMBRE_ALERGENO`). Los ids de alimento NO se validan contra el
    // catálogo: `bitsDe` en `packages/motor/src/pool.ts` ya los ignora en
    // silencio si no existen, y duplicar esa validación aquí sólo daría dos
    // sitios que mantener de acuerdo.
    alergenosExcluidos: lista(crudos, "alergeno").filter(
      (a): a is Alergeno => a in NOMBRE_ALERGENO,
    ),
    ingredientesExcluidos: lista(crudos, "evitar"),
  };
}

/** Los mismos datos, de vuelta a la URL. Sirve para compartir y para reintentar. */
export function aParametros(datos: DatosFormulario): URLSearchParams {
  const parametros = new URLSearchParams({
    sexo: datos.sexo,
    edad: String(datos.edad),
    altura: String(datos.altura),
    peso: String(datos.peso),
    actividad: datos.actividad,
    objetivo: datos.objetivo,
    dieta: datos.dieta,
    comidas: String(datos.comidas),
  });
  for (const alergeno of datos.alergenosExcluidos) parametros.append("alergeno", alergeno);
  for (const id of datos.ingredientesExcluidos) parametros.append("evitar", id);
  return parametros;
}

// ---------------------------------------------------------------------------
// Del formulario a la solicitud del solver
// ---------------------------------------------------------------------------

export function aPerfilFisico(datos: DatosFormulario): PerfilFisico {
  return {
    sexo: datos.sexo,
    edad: datos.edad,
    peso: datos.peso,
    altura: datos.altura,
    actividad: datos.actividad,
    objetivo: datos.objetivo,
  };
}

export interface ObjetivoCalculado {
  objetivo: ObjetivoNutricional;
  /**
   * Cierto cuando el cálculo caía por debajo del suelo de seguridad y se ha
   * subido hasta él. Hay que decírselo al usuario, no aplicarlo en silencio.
   */
  sueloAplicado: boolean;
}

export function calcularObjetivoDelDia(datos: DatosFormulario): ObjetivoCalculado {
  const perfil = aPerfilFisico(datos);
  const objetivo = calcularObjetivo(perfil);
  const bruto = gastoTotal(perfil) * (1 + AJUSTE_OBJETIVO[perfil.objetivo]);
  return {
    objetivo,
    sueloAplicado: bruto < KCAL_MINIMAS[perfil.sexo],
  };
}

export function slotsDe(datos: DatosFormulario): SlotComida[] {
  return LAYOUTS[datos.comidas] ?? LAYOUTS[3];
}

/**
 * Ajustes que el usuario acepta desde la pantalla de sobre-restricción.
 *
 * No son campos del formulario: son las tres salidas concretas que se le
 * ofrecen cuando el solver no llega. Se aplican sobre el objetivo calculado,
 * no sobre el perfil — el perfil del usuario no se toca porque su cuerpo no ha
 * cambiado.
 */
export interface AjustesObjetivo {
  /** Nuevo techo de kcal del día. */
  kcal?: number;
  /** Nuevo máximo de proteína en gramos. El mínimo se arrastra si hace falta. */
  proteinaMaxG?: number;
  /** Dieta alternativa: relajar el filtro que más aprieta. */
  dieta?: TipoDieta;
  /** Quitar el mínimo de fibra. */
  sinMinimoFibra?: boolean;
}

export interface OpcionesSolicitud {
  /** Recetas a penalizar por repetición: lo que se usa al pedir otro día. */
  recetasRecientes?: string[];
  seed?: number;
  ajustes?: AjustesObjetivo;
}

export function aplicarAjustes(
  objetivo: ObjetivoNutricional,
  ajustes: AjustesObjetivo = {},
): ObjetivoNutricional {
  const proteinaMax = ajustes.proteinaMaxG ?? objetivo.proteinaG.max;
  return {
    ...objetivo,
    kcal: ajustes.kcal ?? objetivo.kcal,
    proteinaG: {
      min: Math.min(objetivo.proteinaG.min, proteinaMax),
      max: proteinaMax,
    },
    fibraMinG: ajustes.sinMinimoFibra ? 0 : objetivo.fibraMinG,
  };
}

export function construirSolicitud(
  datos: DatosFormulario,
  opciones: OpcionesSolicitud = {},
): SolicitudGeneracion {
  const { objetivo } = calcularObjetivoDelDia(datos);
  return {
    objetivos: [aplicarAjustes(objetivo, opciones.ajustes)],
    restricciones: {
      dieta: opciones.ajustes?.dieta ?? datos.dieta,
      alergenosExcluidos: datos.alergenosExcluidos,
      ingredientesExcluidos: datos.ingredientesExcluidos,
      slots: slotsDe(datos),
      comensales: 1,
      // Ordenada de más reciente a más antigua: el término de penalización de
      // repetición del solver depende de ese orden.
      recetasRecientes: opciones.recetasRecientes ?? [],
    },
    ...(opciones.seed != null ? { seed: opciones.seed } : {}),
  };
}

/** Días de una semana de plan Pro. */
export const DIAS_SEMANA_PRO = 7;

/**
 * La misma solicitud que `construirSolicitud`, pero con `objetivos` repetido
 * `DIAS_SEMANA_PRO` veces. El motor decide él solo cómo repartir la variedad
 * entre días — es lo que hace el término de solape semanal (§2.2d) — así que
 * aquí no hay más diferencia con el día suelto que la longitud del array: no
 * se calculan siete objetivos distintos porque las kcal del día de un mismo
 * perfil no cambian de un día para otro.
 */
export function construirSolicitudSemana(
  datos: DatosFormulario,
  opciones: OpcionesSolicitud = {},
): SolicitudGeneracion {
  const { objetivo } = calcularObjetivoDelDia(datos);
  const objetivoAjustado = aplicarAjustes(objetivo, opciones.ajustes);
  return {
    objetivos: Array.from({ length: DIAS_SEMANA_PRO }, () => objetivoAjustado),
    restricciones: {
      dieta: opciones.ajustes?.dieta ?? datos.dieta,
      alergenosExcluidos: datos.alergenosExcluidos,
      ingredientesExcluidos: datos.ingredientesExcluidos,
      slots: slotsDe(datos),
      comensales: 1,
      recetasRecientes: opciones.recetasRecientes ?? [],
    },
    ...(opciones.seed != null ? { seed: opciones.seed } : {}),
  };
}
