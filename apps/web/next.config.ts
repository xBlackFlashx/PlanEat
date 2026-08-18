import type { NextConfig } from "next";

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
 * Lo grave no es que falle, es CÓMO falla: el build sale en verde y el sitio
 * carga. Sólo se rompe al pulsar "Ver mi día", en el navegador del usuario.
 * Con webpack el worker se emite como un chunk con hash, que es justo lo que
 * documenta el `canalDeWorker` del motor.
 *
 * `herramientas/verificar-build.mjs` corre después de cada build y falla si
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
   * Server real en Vercel: el generador gratis (Día real) sigue corriendo en
   * el navegador vía Web Worker exactamente igual que antes — eso no cambia,
   * y `@planeat/motor` no necesita servidor para esa ruta.
   *
   * Lo que sí necesita servidor es todo lo nuevo: cuentas, el plan Pro
   * semanal (gate de servidor, no de cliente — un `tier` comprobado sólo en
   * el navegador se falsea con las herramientas de desarrollador), Stripe y
   * el panel de administración. Por eso ya no se exporta como sitio
   * estático: `output: "export"` es incompatible con rutas de API, sesiones
   * y webhooks. GitHub Pages queda retirado como destino; ver SETUP.md.
   */
};

export default nextConfig;
