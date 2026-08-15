import type { NextConfig } from "next";

/**
 * Prefijo bajo el que se sirve el sitio.
 *
 * GitHub Pages publica el proyecto en `https://xblackflashx.github.io/PlanEat`,
 * es decir, bajo un subdirectorio y no en la raíz del dominio. El workflow de
 * `.github/workflows/pages.yml` fija `PLANEAT_BASE_PATH=/PlanEat` para el build
 * de producción.
 *
 * En local la variable no está y el prefijo es la cadena vacía: la app se sigue
 * sirviendo en `/`. La documentación de Next recomienda fijar `basePath`
 * incondicionalmente —se inlinea en el bundle y no se puede cambiar sin
 * recompilar—, pero eso obligaría a desarrollar en `localhost:3000/PlanEat`, y
 * un `next dev` que no responde en la raíz es fricción diaria a cambio de un
 * riesgo que el propio workflow ya cubre: allí la variable es explícita y el
 * paso de verificación comprueba que los assets salen prefijados.
 *
 * Se normaliza: sin barra final, y con barra inicial. `basePath: "/"` es un
 * valor inválido para Next, así que la raíz se expresa como cadena vacía.
 */
const rutaBase = (process.env.PLANEAT_BASE_PATH ?? "")
  .trim()
  .replace(/\/+$/, "")
  .replace(/^(?!\/)(.+)$/, "/$1");

/**
 * Nota sobre el bundler, que no cabe en `package.json` porque JSON no admite
 * comentarios y es donde está el `--webpack`.
 *
 * `dev` y `build` fuerzan webpack en vez del Turbopack por defecto de Next 16,
 * y es por una sola razón: **Turbopack no empaqueta Web Workers**. Ante un
 * `new Worker(new URL('./motor.worker.ts', import.meta.url), …)` no genera un
 * chunk; copia el fichero fuente tal cual a `_next/static/media/` y deja en el
 * bundle la URL de esa copia. Comprobado en Next 16.3.1 con las dos
 * extensiones, `.ts` y `.js`, y con el worker tanto dentro de `src/` como en
 * `node_modules/@planeat/motor`: el resultado siempre es un fichero sin
 * transpilar y con imports sin resolver.
 *
 * Lo grave no es que falle, es CÓMO falla: el build sale en verde, el export
 * genera las tres rutas y el sitio carga. Sólo se rompe al pulsar "Ver mi día",
 * en el navegador del usuario. Con webpack el worker se emite como un chunk con
 * hash y con el `basePath` ya aplicado, que es justo lo que documenta el
 * `canalDeWorker` del motor.
 *
 * `herramientas/verificar-export.mjs` corre después de cada build y falla si
 * vuelve a colarse un fuente sin transpilar en la salida. Cuando Turbopack
 * soporte workers, se quita el `--webpack` y esa comprobación lo confirma.
 */
const nextConfig: NextConfig = {
  // Los paquetes internos se distribuyen como TypeScript sin compilar: son
  // workspaces, no paquetes publicados. `@planeat/motor` además importa con
  // extensión `.ts` explícita y trae el worker, así que tiene que pasar por el
  // pipeline de la app.
  transpilePackages: ["@planeat/shared", "@planeat/motor"],

  typedRoutes: true,

  /**
   * Sitio estático: HTML, CSS y JS, sin servidor. Es lo que hace posible
   * publicar en Pages, y lo que obliga a que la generación de planes corra en
   * el navegador (ver `src/lib/solver.ts`).
   */
  output: "export",

  /**
   * `/plan` se emite como `plan/index.html` en vez de `plan.html`. Es la forma
   * que GitHub Pages resuelve sin ambigüedad, y la que hace que el `action` del
   * formulario de la portada apunte a algo que existe en el disco publicado.
   */
  trailingSlash: true,

  ...(rutaBase === "" ? {} : { basePath: rutaBase, assetPrefix: rutaBase }),

  /**
   * No hay servidor que optimice imágenes. Hoy no se usa `next/image` en
   * ninguna pantalla, pero dejarlo declarado evita que el día que se use el
   * build falle con un error que no dice nada sobre el export.
   */
  images: { unoptimized: true },

  /**
   * El prefijo, disponible también en el cliente.
   *
   * `next/link` antepone el `basePath` solo, pero el `action` del formulario de
   * la portada es un atributo HTML plano que Next no reescribe. En vez de
   * repetir el literal por el código, se lee de aquí (`src/lib/rutas.ts`).
   */
  env: { NEXT_PUBLIC_RUTA_BASE: rutaBase },
};

export default nextConfig;
