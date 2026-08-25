export const meta = {
  name: 'planeat-identidad-visual',
  description: 'Logo SVG para PlanEat, hero "Tu semana, resuelta" animado, y pase de identidad visual (banners/backgrounds) en la página',
  phases: [
    { title: 'Dirección de arte', detail: 'Leer el sistema de diseño real y fijar la dirección del logo y la identidad' },
    { title: 'Implementar', detail: 'Logo SVG + hero animado + backgrounds/identidad, en paralelo' },
    { title: 'Verificación', detail: 'tsc, lint, tests, build y revisión visual en claro/oscuro en el navegador' },
  ],
}

const CONTEXTO = `Trabajas en el repo PlanEat. IMPORTANTE — entorno de esta sesión:
- Repo real: /Users/victorbau_v/PlanEat (ahí corre un dev server Next.js en http://localhost:3999). PERO esta sesión está aislada: los tool calls Edit/Write directos sobre /Users/victorbau_v/PlanEat/** son RECHAZADOS. Trabaja SIEMPRE en el worktree /Users/victorbau_v/PlanEat/.claude/worktrees/stateful-crafting-stallman (mismo árbol, rama worktree-stateful-crafting-stallman) con Edit/Write, y al final copia cada archivo tocado al checkout real con cp vía Bash (cp SÍ funciona; verifica con grep tras cada copia). El dev server recarga solo.
- NO hagas commit ni push.
- PlanEat: app de planes de comida para México. Next.js en apps/web. Verde como color de marca ("brand" token), modo claro y oscuro (tokens CSS en apps/web/src/app/globals.css, el tema se alterna con data attribute — revisa cómo antes de tocar color alguno).
- Sistema de diseño documentado en docs/diseno-producto.md y apps/web/design-system/planeat/ — LÉELOS antes de diseñar: el resultado debe sentirse una evolución de esa identidad (verde, limpio, fotos reales de comida, densidad baja), no un rediseño ajeno.
- Página principal: apps/web/src/app/page.tsx (hero "Tu semana, resuelta." + collage de fotos + generador). Estilos de motion en apps/web/src/components/planeat.module.css y utilidades/tokens en globals.css. La app respeta prefers-reduced-motion (hay infra para eso — búscala y úsala).
- El logo actual es solo texto: <span>PlanEat</span> en las cabeceras (page.tsx y otras — grep "PlanEat" en apps/web/src para encontrar todas).
- NO hay GEMINI_API_KEY: nada de generación de imágenes por IA. Todo visual nuevo debe ser SVG/CSS hecho a mano, inline o como componente React.`

// ---------------------------------------------------------------------------
phase('Dirección de arte')

const PROMPT_DIRECCION = `${CONTEXTO}

TU TAREA (solo lectura + decisión, no edites nada): lee docs/diseno-producto.md, apps/web/design-system/planeat/MASTER.md y pages/*.md, globals.css (tokens reales de color/tipografía/radio/duración) y page.tsx completo. Con eso define una dirección de arte concreta y accionable para tres piezas:

1. LOGO: propone 3 conceptos de logomarca SVG para "PlanEat" (símbolo + wordmark). Deben funcionar a 24px de alto en la barra de navegación, en claro y oscuro (currentColor o tokens), y sentirse de la marca actual (verde, comida, planificación semanal). Para cada concepto: descripción del símbolo, cómo se integra con el wordmark, y por qué encaja. Elige UNO como recomendado y justifica.

2. HERO ANIMADO: cómo animar "Tu semana, resuelta." + su entorno para que se sienta dinámico sin romper la sobriedad del sistema (revisa qué animaciones YA existen en planeat.module.css y qué duraciones/eases usan los tokens). Propón una coreografía concreta de entrada (qué elemento, qué transform/opacity, qué delay) + un detalle vivo sutil persistente (no wobble infinito molesto), y cómo degradar con prefers-reduced-motion.

3. IDENTIDAD DE FONDOS/BANNERS: un lenguaje de fondo reutilizable (p.ej. patrón sutil, gradientes de marca, formas orgánicas SVG — decide tú mirando lo que ya hay: la portada ya tiene un patrón de puntos y un gradiente en el hero) aplicable a la portada, /precios y cabeceras de sección, con tokens nuevos si hacen falta (definidos en los DOS temas).

Devuelve un documento de dirección en texto plano con decisiones CONCRETAS (nombres de archivo a tocar, tokens a crear con valores para claro y oscuro, specs de animación con duraciones/eases de los tokens existentes) que tres agentes implementadores puedan seguir sin re-decidir nada.`

const direccion = await agent(PROMPT_DIRECCION, { label: 'direccion-arte', phase: 'Dirección de arte' })

// ---------------------------------------------------------------------------
phase('Implementar')

const BASE_IMPL = `${CONTEXTO}

DIRECCIÓN DE ARTE YA DECIDIDA (síguela, no re-decidas; si algo es inviable al implementarlo, resuélvelo con el criterio más cercano a lo decidido y repórtalo):
${'${direccion}'}`

const PROMPT_LOGO = `${CONTEXTO}

DIRECCIÓN DE ARTE YA DECIDIDA (implementa el concepto RECOMENDADO de logo; no re-decidas):
${direccion}

TU TAREA: crea el componente de logo SVG (p.ej. apps/web/src/components/logo.tsx — nombre a tu criterio siguiendo las convenciones del proyecto) e intégralo en TODAS las cabeceras donde hoy aparece "PlanEat" como texto plano (grep en apps/web/src; también revisa el footer si existe, y el <title>/favicon: si hay un favicon.ico o icon en apps/web/src/app, genera también un icon.svg de Next.js con el símbolo del logo). El logo debe: verse nítido a 24-28px de alto, funcionar en claro y oscuro con tokens/currentColor, tener aria-label adecuado, y no romper el layout de ninguna cabecera (revisa las páginas /,  /precios, /entrar, /registro, /semana, /sistema si tienen cabecera propia).

RESTRICCIÓN: NO toques page.tsx más allá de la línea de la cabecera donde va el logo (otro agente trabaja en el hero y los fondos de esa página en paralelo — coordina el conflicto tocando SOLO la línea del span "PlanEat" y sus imports). Al terminar: npx tsc --noEmit en apps/web y npx eslint sobre los archivos tocados, y copia los archivos al checkout real con cp. Reporta qué archivos tocaste y el concepto implementado.`

const PROMPT_HERO = `${CONTEXTO}

DIRECCIÓN DE ARTE YA DECIDIDA (implementa la coreografía del hero tal cual; no re-decidas):
${direccion}

TU TAREA: implementa el hero animado de la portada (apps/web/src/app/page.tsx sección hero + planeat.module.css / globals.css para keyframes). Reglas: usa las duraciones/eases de los tokens existentes; entrada una sola vez (no loop molesto); el detalle vivo persistente debe ser sutil; degrada correctamente con prefers-reduced-motion usando la infraestructura que el proyecto ya tiene; el texto "Tu semana, resuelta." debe seguir siendo seleccionable/accesible (nada de convertirlo en imagen). Server components: page.tsx probablemente es server component — si necesitas client, aísla en un componente pequeño.

RESTRICCIÓN: NO toques la línea de la cabecera con el span/logo "PlanEat" (otro agente pone el logo ahí) y NO toques /precios (otro agente hace los fondos). En page.tsx limítate al bloque del hero y sus estilos. Al terminar: npx tsc --noEmit en apps/web, eslint de los tocados, copia al checkout real con cp, y VERIFICA EN VIVO en el navegador (mcp__claude-in-chrome__*, cárgalas con ToolSearch "select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__browser_batch,mcp__claude-in-chrome__tabs_close_mcp" si están deferred) que la animación se ve bien en localhost:3999 en claro Y oscuro. Reporta qué implementaste y qué viste.`

const PROMPT_FONDOS = `${CONTEXTO}

DIRECCIÓN DE ARTE YA DECIDIDA (implementa el lenguaje de fondos tal cual; no re-decidas):
${direccion}

TU TAREA: implementa el lenguaje de fondos/identidad en: (a) la portada FUERA del bloque hero y de la línea del logo de la cabecera (secciones "Un día real", "En qué se diferencia", fondo general de página) — en page.tsx/globals.css; (b) /precios (apps/web/src/app/precios/page.tsx y tarjetas-precio.tsx si aplica); (c) cualquier token nuevo va definido para claro Y oscuro en globals.css siguiendo el patrón de tokens existente. Contraste AA mínimo sobre los fondos nuevos.

RESTRICCIÓN: en page.tsx NO toques el bloque del hero ("Tu semana, resuelta." y su contenedor inmediato) ni la línea del span/logo de la cabecera — otros dos agentes trabajan ahí; si tu cambio de fondo de página envuelve el hero, hazlo desde fuera (body/main/clases de sección). Al terminar: npx tsc --noEmit en apps/web, eslint de los tocados, copia al checkout real con cp, verifica en vivo en el navegador (mismas herramientas Chrome que arriba) en claro y oscuro. Reporta qué implementaste.`

const [logo, hero, fondos] = await parallel([
  () => agent(PROMPT_LOGO, { label: 'logo-svg', phase: 'Implementar' }),
  () => agent(PROMPT_HERO, { label: 'hero-animado', phase: 'Implementar' }),
  () => agent(PROMPT_FONDOS, { label: 'fondos-identidad', phase: 'Implementar' }),
])

// ---------------------------------------------------------------------------
phase('Verificación')

const PROMPT_VERIFICAR = `${CONTEXTO}

Tres agentes acaban de implementar en paralelo: (1) logo SVG nuevo en las cabeceras, (2) hero "Tu semana, resuelta." animado, (3) lenguaje de fondos/identidad en portada y /precios. Sus reportes:

=== LOGO ===
${'${logo}'}
=== HERO ===
${'${hero}'}
=== FONDOS ===
${'${fondos}'}

VERIFICA TODO JUNTO. En el worktree: 1) npm run typecheck (raíz), 2) npm run lint, 3) npm test, 4) cd apps/web && npm run build. Si algo falla, arréglalo con el cambio mínimo (y copia el arreglo al checkout real con cp).

Después, confirma que el checkout real (/Users/victorbau_v/PlanEat) recibió TODOS los archivos tocados por los tres agentes (compara con diff cada archivo reportado entre worktree y checkout real; copia con cp los que falten). Luego, en el NAVEGADOR (localhost:3999, herramientas mcp__claude-in-chrome__*): revisa /, /precios y /entrar en modo claro Y oscuro; confirma que el logo se ve nítido en la cabecera, que el hero anima al cargar y queda estable, que los fondos se ven intencionales (no rotos ni con texto ilegible), y que nada del generador se rompió (pasa el paso 1 del asistente al menos). Haz screenshots con save_to_disk de / en claro y en oscuro y reporta sus rutas.

Reporta: estado de los 4 comandos, qué arreglaste si algo, y qué viste en el navegador (con las rutas de los screenshots).`

const verificacion = await agent(
  PROMPT_VERIFICAR.replace('${logo}', String(logo)).replace('${hero}', String(hero)).replace('${fondos}', String(fondos)),
  { label: 'verificacion', phase: 'Verificación' }
)

return { direccion, logo, hero, fondos, verificacion }
