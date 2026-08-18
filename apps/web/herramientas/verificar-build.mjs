/**
 * Comprueba que el build de servidor no lleva un Web Worker sin transpilar.
 * Corre tras cada `next build`.
 *
 * Antes del paso a Vercel esta comprobación vivía en `verificar-export.mjs` y
 * validaba tres cosas del export estático (rutas HTML, basePath, worker sin
 * compilar). Con servidor real las dos primeras dejan de aplicar: ya no hay
 * `out/` ni `basePath`, y las rutas autenticadas no son HTML estático. Lo que
 * sigue siendo real es el riesgo del worker — ver la nota del bundler en
 * `next.config.ts` — así que es lo único que se conserva, apuntando a
 * `.next/static` en vez de `out/_next/static`.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SALIDA = path.resolve(import.meta.dirname, "../.next/static");

/**
 * Extensiones de código fuente. Nada de esto puede acabar servido tal cual: si
 * aparece, es que el bundler ha copiado un módulo en vez de compilarlo.
 */
const FUENTES = new Set([".ts", ".tsx", ".mts", ".cts", ".jsx"]);

const problemas = [];

async function ficheros(directorio) {
  const encontrados = [];
  for (const entrada of await readdir(directorio, { withFileTypes: true, recursive: true })) {
    if (entrada.isFile()) encontrados.push(path.join(entrada.parentPath, entrada.name));
  }
  return encontrados;
}

const estaticos = await ficheros(SALIDA);
for (const fichero of estaticos) {
  if (FUENTES.has(path.extname(fichero))) {
    problemas.push(
      `${path.relative(SALIDA, fichero)} es código fuente sin compilar. ` +
        "El bundler lo ha copiado en vez de empaquetarlo (¿un Web Worker con Turbopack?).",
    );
  }
}

if (problemas.length > 0) {
  console.error("\nEl build NO es publicable:\n");
  for (const problema of problemas) console.error(`  · ${problema}`);
  console.error("");
  process.exit(1);
}

console.log("Build verificado: sin fuentes sin compilar en .next/static.");
