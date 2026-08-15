/**
 * Lectura del catálogo de recetas. **Sólo servidor.**
 *
 * El contrato del solver devuelve identificadores de receta, no recetas. Para
 * dibujar un día hace falta el título, el tiempo y los ingredientes, y hoy la
 * única fuente de esos datos es el catálogo del propio servicio
 * (`services/solver/data/`). Se lee aquí, en el servidor, y el proxy adjunta el
 * resumen de las recetas que aparecen en el plan.
 *
 * Si el fichero no está donde se espera, esto devuelve `null` y la interfaz lo
 * dice. No hay títulos de relleno ni valores nutricionales inventados: en un
 * producto de nutrición eso es una mentira con consecuencias.
 *
 * Cuando el catálogo viva en base de datos, este módulo se sustituye entero sin
 * tocar nada más: el resto del código sólo conoce `RecetaResumen`.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { SlotComida } from "@planeat/shared";

import type { RecetaResumen } from "./tipos";

/** Orden de columnas de `nutr` y `conocido` en el catálogo del solver. */
const NUTRIENTES = [
  "kcal",
  "proteina",
  "carbohidrato",
  "grasa",
  "fibra",
  "sodio",
] as const;

interface FilaCatalogo {
  id: string;
  titulo: string;
  racionesBase: number;
  nutr: number[];
  conocido: boolean[];
  minutos: number;
  alergenos: string[];
  slots: SlotComida[];
  ingredientes: string[];
  costeCents?: number;
  costeConocido?: boolean;
  revisadaPor?: string | null;
}

export interface Catalogo {
  recetas: Map<string, RecetaResumen>;
  /** Total de recetas del catálogo. Da contexto a la pantalla de sobre-restricción. */
  total: number;
}

/**
 * Rutas candidatas, en orden. `process.cwd()` es `apps/web` con `next dev` y
 * `next start`, pero puede ser la raíz del repositorio según cómo se lance.
 */
function rutasCandidatas(fichero: string): string[] {
  const explicita = process.env.PLANEAT_DATOS_SOLVER;
  const candidatas = [
    ...(explicita ? [path.join(explicita, fichero)] : []),
    path.resolve(process.cwd(), "../../services/solver/data", fichero),
    path.resolve(process.cwd(), "services/solver/data", fichero),
  ];
  return candidatas;
}

async function leerPrimeroQueExista(fichero: string): Promise<string | null> {
  for (const ruta of rutasCandidatas(fichero)) {
    try {
      return await readFile(ruta, "utf8");
    } catch {
      // Se prueba la siguiente. Que no esté no es excepcional en despliegue.
    }
  }
  return null;
}

async function leerNombresDeIngredientes(): Promise<Map<string, string>> {
  const nombres = new Map<string, string>();
  const bruto = await leerPrimeroQueExista("ingredientes.json");
  if (!bruto) return nombres;
  try {
    const datos = JSON.parse(bruto) as {
      ingredientes?: { id: string; nombre: string }[];
    };
    for (const ingrediente of datos.ingredientes ?? []) {
      nombres.set(ingrediente.id, ingrediente.nombre);
    }
  } catch {
    // Un catálogo de nombres ilegible no debe tumbar la vista del plan.
  }
  return nombres;
}

function aResumen(fila: FilaCatalogo, nombres: Map<string, string>): RecetaResumen {
  const valor = (nutriente: (typeof NUTRIENTES)[number]) =>
    fila.nutr[NUTRIENTES.indexOf(nutriente)] ?? 0;
  const seSabe = (nutriente: (typeof NUTRIENTES)[number]) =>
    fila.conocido?.[NUTRIENTES.indexOf(nutriente)] ?? false;

  return {
    id: fila.id,
    titulo: fila.titulo,
    minutos: fila.minutos,
    slots: fila.slots ?? [],
    alergenos: fila.alergenos ?? [],
    ingredientes: (fila.ingredientes ?? []).map((id) => nombres.get(id) ?? id),
    porRacion: {
      kcal: valor("kcal"),
      proteinaG: valor("proteina"),
      carbohidratoG: valor("carbohidrato"),
      grasaG: valor("grasa"),
      fibraG: valor("fibra"),
      sodioMg: valor("sodio"),
    },
    conocido: {
      kcal: seSabe("kcal"),
      proteinaG: seSabe("proteina"),
      carbohidratoG: seSabe("carbohidrato"),
      grasaG: seSabe("grasa"),
      fibraG: seSabe("fibra"),
      sodioMg: seSabe("sodio"),
    },
    costeCents: fila.costeConocido ? (fila.costeCents ?? null) : null,
    revisadaPor: fila.revisadaPor ?? null,
  };
}

let cache: Promise<Catalogo | null> | null = null;

async function cargar(): Promise<Catalogo | null> {
  const bruto = await leerPrimeroQueExista("catalogo.jsonl");
  if (!bruto) return null;

  const nombres = await leerNombresDeIngredientes();
  const recetas = new Map<string, RecetaResumen>();

  for (const linea of bruto.split("\n")) {
    const limpia = linea.trim();
    if (!limpia) continue;
    try {
      const fila = JSON.parse(limpia) as FilaCatalogo;
      if (!fila.id) continue;
      recetas.set(fila.id, aResumen(fila, nombres));
    } catch {
      // Una línea corrupta se salta: el resto del catálogo sigue siendo válido.
    }
  }

  if (recetas.size === 0) return null;
  return { recetas, total: recetas.size };
}

/** Cacheado en memoria del proceso: el catálogo no cambia entre peticiones. */
export function cargarCatalogo(): Promise<Catalogo | null> {
  cache ??= cargar().catch(() => null);
  return cache;
}
