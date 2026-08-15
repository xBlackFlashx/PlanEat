/**
 * Comprueba que el export estático es publicable. Corre tras cada `next build`.
 *
 * No es un test de humo por gusto: este build tiene dos formas de romperse **en
 * verde**, las dos descubiertas montándolo, y las dos invisibles hasta que un
 * usuario abre el sitio en producción.
 *
 *  1. El worker sin empaquetar. Turbopack no genera un chunk para
 *     `new Worker(new URL(…))`: copia el fuente a `_next/static/media/` y lo
 *     sirve tal cual. TypeScript sin transpilar en el navegador, y el motor
 *     nunca arranca. Ver la nota del bundler en `next.config.ts`.
 *  2. El `basePath` mal aplicado. Es un valor que se inlinea en tiempo de build
 *     y no falla en ningún sitio: simplemente todos los assets dan 404 en
 *     GitHub Pages, con la página cargando y en blanco.
 *
 * Se comprueba sobre el HTML emitido, no sobre la configuración, porque lo que
 * importa es lo que se publica y no lo que se pretendía publicar.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SALIDA = path.resolve(import.meta.dirname, "../out");

/** Las tres rutas del producto. Sin las tres, no hay sitio que desplegar. */
const RUTAS = ["index.html", "plan/index.html", "sistema/index.html"];

/**
 * Extensiones de código fuente. Nada de esto puede acabar servido tal cual: si
 * aparece, es que el bundler ha copiado un módulo en vez de compilarlo.
 */
const FUENTES = new Set([".ts", ".tsx", ".mts", ".cts", ".jsx"]);

const problemas = [];

/** El prefijo con el que se construyó, tal y como lo verá el navegador. */
const rutaBase = (process.env.PLANEAT_BASE_PATH ?? "").trim().replace(/\/+$/, "");

async function ficheros(directorio) {
  const encontrados = [];
  for (const entrada of await readdir(directorio, { withFileTypes: true, recursive: true })) {
    if (entrada.isFile()) encontrados.push(path.join(entrada.parentPath, entrada.name));
  }
  return encontrados;
}

// --- 1. Las tres rutas existen y tienen HTML de verdad --------------------
const htmls = new Map();
for (const ruta of RUTAS) {
  try {
    const contenido = await readFile(path.join(SALIDA, ruta), "utf8");
    if (!contenido.includes("<!DOCTYPE html>") && !contenido.includes("<!doctype html>")) {
      problemas.push(`out/${ruta} existe pero no parece HTML.`);
    }
    htmls.set(ruta, contenido);
  } catch {
    problemas.push(`Falta out/${ruta}. El export no ha generado esa ruta.`);
  }
}

// --- 2. Ningún fuente sin compilar entre los assets -----------------------
const estaticos = await ficheros(path.join(SALIDA, "_next", "static"));
for (const fichero of estaticos) {
  if (FUENTES.has(path.extname(fichero))) {
    problemas.push(
      `${path.relative(SALIDA, fichero)} es código fuente sin compilar. ` +
        "El bundler lo ha copiado en vez de empaquetarlo (¿un Web Worker con Turbopack?).",
    );
  }
}

// --- 3. Los assets apuntan a donde se va a servir el sitio ----------------
const indice = htmls.get("index.html") ?? "";
const prefijoEsperado = `${rutaBase}/_next/`;
if (indice !== "" && !indice.includes(prefijoEsperado)) {
  problemas.push(
    `El HTML no referencia ningún asset bajo "${prefijoEsperado}". ` +
      `PLANEAT_BASE_PATH=${JSON.stringify(rutaBase)} no se ha aplicado.`,
  );
}
// La comprobación de arriba pasaría también con basePath vacío y assets en
// "/_next/", porque "/PlanEat/_next/" contiene "/_next/" sólo si el prefijo es
// vacío. Ésta es la que descarta el caso contrario: assets en la raíz cuando se
// esperaba un prefijo.
if (rutaBase !== "" && / (?:src|href)="\/_next\//.test(indice)) {
  problemas.push(
    `Hay assets en "/_next/" sin el prefijo ${rutaBase}. En GitHub Pages darían 404.`,
  );
}

if (problemas.length > 0) {
  console.error("\nEl export NO es publicable:\n");
  for (const problema of problemas) console.error(`  · ${problema}`);
  console.error("");
  process.exit(1);
}

console.log(
  `Export verificado: ${RUTAS.length} rutas, assets bajo "${rutaBase || "/"}", sin fuentes sin compilar.`,
);
