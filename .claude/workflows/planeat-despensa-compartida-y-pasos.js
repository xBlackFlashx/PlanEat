export const meta = {
  name: 'planeat-despensa-compartida-y-pasos',
  description: 'Prioriza más la despensa compartida entre recetas + añade ingredientes con cantidad y pasos de preparación a la ficha de receta',
  phases: [
    { title: 'Despensa compartida', detail: 'Medir y subir la prioridad de reutilización de ingredientes entre recetas' },
    { title: 'Ficha de receta', detail: 'Cantidades por ingrediente y pasos de preparación en el panel de receta' },
    { title: 'Verificación', detail: 'typecheck, lint, tests y build tras ambos cambios' },
  ],
}

const PROMPT_DESPENSA = `Trabajas en el repo PlanEat (~/PlanEat), un generador de planes de comida (Next.js + un motor de optimización dual: referencia en Python bajo services/solver/, puerto en TypeScript bajo packages/motor/, que deben coincidir cifra a cifra). NO hagas commit ni push, es trabajo local.

CONTEXTO COMPLETO — lee esto con cuidado, ya hay historia real detrás:
El usuario lleva TRES rondas pidiendo menos variedad de ingredientes en el plan semanal. En las dos anteriores, dentro de esta misma sesión, se subió el peso W_SOL del término de "solape semanal" del scoring: primero de 1.2 a 2.0, después de 2.0 a 3.2 (valor actual en services/solver/app/solver/__init__.py y packages/motor/src/constantes.ts). Ambas veces se midió con un script ya existente, services/solver/scripts/medir_w_sol.py, que genera decenas de semanas completas por valor candidato y compara — pareado, mismo perfil+semilla — el conteo de ingredientes distintos contra la tasa de días "Cuadra" (los tres macros dentro de rango). La ÚLTIMA vez se eligió 3.2 como techo porque valores más altos (3.4, 4.0) degradaban la tasa de Cuadra más de lo que parecía razonable (-5 a -7 puntos porcentuales) frente a la reducción de ingredientes que daban.

El usuario ahora dice explícitamente que 3.2 SIGUE sin ser suficiente: "por ejemplo 40 ingredientes son muchos... tengo que comprar ingredientes casi por platillo, hay varios que coinciden pero muchos otros no. Trata de hacer una regla en la cual dé prioridad a que se relacionen más los ingredientes entre recetas." y "el punto es que se puedan tener recetas que se hagan con solo una despensa". Esto es una señal real de prioridad: el usuario prefiere una despensa compartida MÁS agresiva aunque cueste algo de precisión nutricional — el criterio de "no bajar más de 2-3 puntos de Cuadra" que se usó antes ya no aplica tal cual; esta vez hay margen para aceptar una degradación bastante mayor con tal de conseguir una reducción real y notoria.

DÓNDE ESTÁ LA LÓGICA: services/solver/app/solver/scoring.py, función score_slot, bloque "(d) Solape semanal". El término "sol" es COBERTURA: fracción de los ingredientes de la receta candidata que YA están en ctx.bits_semana (ingredientes ya comprometidos esta semana). La fórmula final:
  s = W_FIT*fit + W_ESC*esc + W_DESP*desp + W_SOL*sol + W_AFIN*afin - peso_coste*cost - W_REP*pen_rep
Pesos actuales (services/solver/app/solver/__init__.py, "# §2.2"): W_FIT=4.0, W_ESC=2.0, W_DESP=1.5, W_SOL=3.2, W_AFIN=0.0.

TAREA — en dos pasos, en orden:

1. AMPLÍA la búsqueda de W_SOL con un criterio de aceptación más permisivo que las veces anteriores. Reutiliza (o adapta si hace falta) services/solver/scripts/medir_w_sol.py para probar valores por encima de 3.2 (por ejemplo 3.6, 4.0, 4.5, 5.0, 5.5 — hasta donde tenga sentido) y mide, para cada uno, el conteo de ingredientes distintos por semana Y la tasa de "Cuadra", pareado contra el 3.2 actual. Esta vez el criterio de corte NO es "que la tasa de Cuadra baje lo mínimo posible": es "el valor más alto que siga dando un plan usable" — usable quiere decir que la mayoría de los días sigan resolviendo (no exijas que se mantenga por encima de ningún umbral concreto de puntos porcentuales como la vez pasada; usa tu criterio, pero no aceptes un valor que deje la tasa de Cuadra por debajo de, digamos, un tercio de los días, eso ya no sería un producto usable). Documenta la tabla de resultados igual que las veces anteriores.

2. SI el ajuste de W_SOL por sí solo no logra una reducción que consideres realmente notoria (bajar de ~40 a un número claramente menor, no un par de unidades), tienes permiso explícito para proponer un cambio estructural en la fórmula de scoring, no sólo el peso — por ejemplo (son ideas, no una receta cerrada — usa tu criterio de ingeniero, mide antes de decidir):
   - penalizar directamente el número de ingredientes NUEVOS (no comprometidos todavía) que introduce una receta candidata, no sólo premiar la fracción ya cubierta — la cobertura por sí sola infla el score de recetas pequeñas de forma desproporcionada y puede no ser el lever más directo;
   - revisar si el término de solape debería tener más peso relativo específicamente en los primeros 1-2 días de la semana (que son los que "fijan" la despensa que el resto de días puede reaprovechar) frente a los últimos días.
   Si tocas la fórmula (no sólo el peso), tiene que implementarse EN LOS DOS MOTORES en paralelo (services/solver/app/solver/scoring.py Y packages/motor/src/scoring.ts) con paridad exacta — sigue el mismo patrón de comentarios §2.2 ya presente en ambos ficheros, y prepárate para que el volcado de paridad (packages/motor/pruebas/datos/) tenga que regenerarse y los tests de paridad puedan necesitar ajuste. Sé conservador: un cambio de fórmula mal portado entre los dos motores es el fallo más caro que puede tener este proyecto (ver comentarios de "el fallo más caro del port" repetidos por el código). Si decides NO tocar la fórmula (porque el ajuste de peso ya bastó), no hace falta que toques scoring.ts en absoluto.

Aplica el valor final elegido en AMBOS sitios, idéntico: services/solver/app/solver/__init__.py y packages/motor/src/constantes.ts.

Regenera TODO lo derivado, en este orden exacto, desde services/solver/: .venv/bin/python scripts/construir_catalogo.py, luego volcar_referencia_catalogo.py, volcar_scoring.py <ruta que use el proyecto>, exportar_fixtures.py, volcar_paridad.py --salida ../../packages/motor/pruebas/datos/ — y luego, desde la raíz: npm run motor:catalogo.

Corre pytest -q (services/solver) y npm test (raíz). Repara cualquier literal hardcodeado que rompa con el patrón ya usado en esta sesión: sonda contra el dato real (nunca adivinar), y si algún escenario de test de invariantes de pool/candidatos deja de cumplirse por el cambio, busca una combinación/semilla nueva que sí lo cumpla — no debilites la aserción. Revisa services/solver/app/solver/__init__.py: el comentario del módulo dice "si cambias una constante, cambia también VERSION_GENERADOR" — decide con tu criterio si este cambio lo amerita (las dos rondas anteriores de W_SOL en esta sesión NO subieron la versión; sé consistente con ese precedente salvo que cambies la fórmula estructural, no sólo el peso, en cuyo caso sí conviene subirla en los dos motores).

RESTRICCIÓN DE ALCANCE: services/solver/**, packages/motor/src/scoring.ts y packages/motor/src/constantes.ts (sólo si tocas la fórmula), packages/motor/pruebas/** (sólo lo que haga falta para que pasen los tests), y los ficheros derivados de la regeneración. NO toques apps/web ni packages/motor/herramientas/compilar-catalogo.ts — otro agente trabaja ahí en paralelo (después de ti) sobre la ficha de receta.

Al terminar, reporta en texto plano: la tabla de medición completa, el valor final de W_SOL y por qué, si tocaste o no la fórmula estructural y por qué, y confirmación de que pytest y npm test pasan.`

const PROMPT_FICHA = `Trabajas en el repo PlanEat (~/PlanEat), app Next.js de generación de planes de comida. NO hagas commit ni push, es trabajo local. Otro agente acaba de terminar de tocar el scoring del motor (services/solver/**, packages/motor/src/scoring.ts, packages/motor/src/constantes.ts) — no toques esos archivos, pero SÍ vas a tocar packages/motor/herramientas/compilar-catalogo.ts, que es tuyo. Hay un servidor de desarrollo corriendo en http://localhost:3999 — verifica en vivo con las herramientas de navegador Chrome (mcp__claude-in-chrome__*; si aparecen "deferred", cárgalas primero con ToolSearch usando "select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__tabs_create_mcp").

CONTEXTO: el usuario pide "en las recetas da una descripción de cómo se prepararía cada receta del platillo" — quiere ver los pasos de preparación (y, de paso, las cantidades reales por ingrediente) en la ficha de receta (el panel modal que se abre al hacer clic en "Ver la ficha de X", componente apps/web/src/components/panel-receta.tsx).

YA HICE la investigación de datos, no la repitas — usa esto directamente:
- Las 240 recetas de services/solver/data/recetas.json YA TIENEN un campo "pasos": string[] con instrucciones de preparación reales (nunca vacío, verificado: 240/240 recetas lo tienen). También cada ingrediente de cada receta ya trae "descripcion" (texto legible como "5 cdas · 50 g" o "1 huevo") además de "gramos".
- El panel-receta.tsx ACTUAL tiene un descargo literal, al pie, que dice: "Las cantidades por ingrediente y los pasos de elaboración están en el catálogo original pero todavía no llegan hasta aquí: llegan con la vista de receta completa." — o sea, es un hueco YA DOCUMENTADO en el propio código, no algo que tengas que descubrir. Tu trabajo es cerrarlo y borrar ese descargo (ya no aplica una vez lo implementes).
- El problema es de PLOMERÍA, no de contenido: el tipo RecetaVista (packages/motor/herramientas/compilar-catalogo.ts, interfaz exportada ~línea 124) tiene "ingredientes: string[]" — sólo nombres, sin cantidad — y NO tiene ningún campo de pasos. La función vistaDeRecetas (misma archivo, ~línea 718) construye esa vista leyendo "catalogo.jsonl" (el intermedio que genera construir_catalogo.py), y ESE intermedio NUNCA lleva "descripcion" por ingrediente ni "pasos" — esos dos campos SÓLO sobreviven en el recetas.json crudo. La prueba de que esto es viable: la función porcionesDeReceta (mismo archivo, ~línea 743, usada para la lista de la compra) YA lee recetas.json directamente para rescatar los gramos por ingrediente que catalogo.jsonl tampoco lleva — es el mismo patrón exacto que necesitas replicar, y el llamador en la función principal() (~línea 895-919) YA carga recetasJson en una variable y se la pasa a porcionesDeReceta — sólo te falta pasarle esa misma variable también a vistaDeRecetas.

TAREA:
1. Cambia la firma de vistaDeRecetas para que también reciba recetasJson (el recetas.json crudo ya parseado), igual que porcionesDeReceta. Actualiza la llamada en principal() para pasárselo (ya está cargado ahí, sólo falta enchufarlo).
2. Dentro de vistaDeRecetas, construye un lookup id→{pasos, ingredientesConDescripcion} a partir de recetasJson (mismo estilo de lectura defensiva — comoObjeto/comoLista/comoTexto — que ya usa leerInfoIngredientes/porcionesDeReceta en este mismo archivo, no uses "as" a lo bruto).
3. Cambia la interfaz RecetaVista: el campo "ingredientes: string[]" pasa a ser una lista de objetos con nombre Y descripción de cantidad (tú decides el nombre del campo y su forma exacta — mantenlo simple, por ejemplo algo como { nombre: string; cantidad: string }). Añade un campo nuevo "pasos: string[]". Actualiza vistaDeRecetas para rellenar ambos a partir del lookup del paso 2, con fallback sensato si una receta no aparece en el lookup (no debería pasar, pero no revientes el build entero por eso — usa el mismo criterio defensivo que ya tiene el resto del archivo).
4. Busca TODOS los consumidores actuales de RecetaVista.ingredientes como string[] antes de cambiar el tipo (ya hice una pasada y sólo encontré apps/web/src/components/panel-receta.tsx usándolo así — apps/web/src/lib/lista-compra.ts usa un "receta.ingredientes" DISTINTO, de RecetaConGramos/PorcionesRecetas, no toques ese) — confírmalo tú mismo con tu propia búsqueda antes de romper nada.
5. En apps/web/src/components/panel-receta.tsx: actualiza el bloque que hoy sólo enseña receta.ingredientes.map(...) como una lista de nombres separados por "·" para que muestre también la cantidad de cada ingrediente (respeta el estilo de prosa/densidad baja que ya tiene esa sección — no lo conviertas en una tabla si no hace falta, usa tu criterio de diseño con las clases/tokens que ya existen en el archivo). Añade una sección nueva de "Preparación" (o el título que te parezca más natural en el tono del resto de la ficha) con los pasos como lista ordenada (<ol>), en algún punto sensato del cuerpo desplazable del panel (revisa cómo está organizado el resto del archivo — hay una sección de trazabilidad de revisión, la tabla nutricional en un DetallePlegable, etc. — coloca los pasos donde mejor encajen en ese flujo de lectura). BORRA el descargo que dice "están en el catálogo original pero todavía no llegan hasta aquí" — ya no es verdad.

Regenera lo que haga falta: desde la raíz, npm run motor:catalogo (esto solo depende de tu cambio en compilar-catalogo.ts, no debería hacer falta tocar nada de Python ya que ni recetas.json ni ingredientes.json cambian de contenido, sólo cambia qué extrae el compilador — confírmalo tú mismo en vez de asumir). Corre npm test (raíz) y arregla cualquier fixture/test de packages/motor/pruebas/compilar-catalogo.test.ts (u otro que compare RecetaVista campo a campo) que dependa de la forma vieja del campo "ingredientes" — con el mismo criterio de esta sesión: nunca inventar un valor, verificar contra el dato real.

RESTRICCIÓN DE ALCANCE: packages/motor/herramientas/compilar-catalogo.ts, apps/web/src/components/panel-receta.tsx, packages/motor/pruebas/compilar-catalogo.test.ts (y cualquier otro test que de verdad dependa de este cambio, verificado por ti, no adivinado), y los ficheros derivados de motor:catalogo. NO toques services/solver/, packages/motor/src/scoring.ts ni constantes.ts — son de otro agente que trabajó ahí antes que tú.

Verifica en vivo en el navegador (localhost:3999): abre / o /semana, genera un plan, abre la ficha de una receta cualquiera ("Ver la ficha de..."), confirma que aparecen las cantidades junto a cada ingrediente y una sección de pasos de preparación con contenido real (no vacía), y que el descargo viejo ya no aparece. Corre npx tsc --noEmit en apps/web y npm run lint desde la raíz antes de terminar.

Al terminar, reporta en texto plano: la forma exacta que le diste al nuevo campo de ingredientes y al de pasos, confirmación de tests/typecheck/lint en verde, y qué viste al abrir una ficha de receta real en el navegador.`

const despensa = await agent(PROMPT_DESPENSA, { label: 'despensa', phase: 'Despensa compartida' })
const ficha = await agent(PROMPT_FICHA, { label: 'ficha', phase: 'Ficha de receta' })

phase('Verificación')
const PROMPT_VERIFICAR = `Trabajas en el repo PlanEat (~/PlanEat). Dos agentes acaban de terminar, en secuencia, dos tandas de cambios SIN COMMITEAR sobre el árbol de trabajo local:
- Uno subió/ajustó el peso (y posiblemente la fórmula) del término de solape semanal del scoring: services/solver/app/solver/__init__.py, services/solver/app/solver/scoring.py, packages/motor/src/constantes.ts, packages/motor/src/scoring.ts (estos dos últimos sólo si tocó la fórmula), y regeneró todo el pipeline derivado.
- Otro añadió cantidades por ingrediente y pasos de preparación a la ficha de receta: packages/motor/herramientas/compilar-catalogo.ts (tipo RecetaVista y vistaDeRecetas), apps/web/src/components/panel-receta.tsx, y regeneró vía npm run motor:catalogo.

Verifica que TODO junto sigue sano. No hagas commit ni push. Corre, en este orden, y reporta el resultado real de cada uno:
1. cd services/solver && pytest -q
2. desde la raíz: npm test
3. desde apps/web: npx tsc --noEmit
4. desde la raíz: npm run lint
5. cd apps/web && npm run build

Si algo falla, diagnostica la causa real y arréglalo con el cambio mínimo necesario, sin revertir el trabajo de ninguno de los dos agentes salvo que sea estrictamente necesario — y en ese caso explica qué revertiste y por qué. Además, genera tú mismo un plan semanal real en el navegador (localhost:3999, sesión Pro: pro@planeat.local / prueba-pro-1234 en /entrar, luego /semana) y reporta cuántos ingredientes distintos salen y si la ficha de una receta muestra cantidades y pasos. Reporta en texto plano el estado de cada uno de los 5 comandos, qué tuviste que arreglar si algo, y lo que viste al generar el plan real.`
const verificacion = await agent(PROMPT_VERIFICAR, { label: 'verificacion', phase: 'Verificación' })

return { despensa, ficha, verificacion }
