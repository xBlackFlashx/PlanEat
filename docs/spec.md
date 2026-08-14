# Especificación de Producto — Plataforma de Planificación Automática de Comidas

> Documento de arquitectura de producto. Base: investigación sobre Eat This Much (ETM) y el mercado de meal planning. Objetivo: construir un producto propio, comercializable, sin reutilizar código, diseño, textos ni marca de terceros.
>
> **Nota de honestidad:** las cifras de mercado, precios de APIs de terceros y estimaciones de ingresos que aparecen aquí provienen de fuentes públicas de fiabilidad desigual. Todo lo marcado como *[verificar]* debe confirmarse antes de comprometer presupuesto.

---

# 1. Qué es Eat This Much (análisis)

## 1.1 Definición funcional

Eat This Much no es un contador de calorías: es un **generador algorítmico de planes de comidas**. Invierte la dirección temporal de la categoría. Un tracker es *descriptivo y ex-post* (registras lo que comiste y descubres si fallaste); ETM es *prescriptivo y ex-ante* (el sistema decide qué vas a comer de modo que los objetivos se cumplan por construcción).

El propio producto lo articula así en su ficha de Google Play: *"Normal calorie trackers force you to add foods into your diary one by one. By the end of the day, there's no guarantee that you'll be anywhere near your nutrition targets. With our automatic meal planner, there's nothing to track because everything is already entered for you."*

La consecuencia estratégica es que ETM no compite en la misma categoría que MyFitnessPal aunque comparta el 60% de las features. **El tracker termina en el registro; ETM continúa hacia receta → lista de la compra → despensa → sobras → escalado familiar → pedido a domicilio.** Esa cadena aguas abajo es donde está el valor real y donde está el paywall.

## 1.2 Cadena de valor completa

```
Perfil físico (edad, sexo, peso, altura, %grasa, actividad)
    ↓ Mifflin-St Jeor × factor actividad × ajuste objetivo
Objetivo nutricional (kcal + P/C/G + fibra/sodio/colesterol)
    ↓ + tipo de dieta + exclusiones + tiempo de cocina + presupuesto + nº comensales
MOTOR DE GENERACIÓN (solver con restricciones múltiples)
    ↓
Plan de comidas (día o semana, jerarquía Día → Comida → Alimento)
    ↓ agregación de ingredientes, consolidación, resta de despensa
Lista de la compra
    ↓ export
Instacart / Amazon Fresh / Walmart
```

Cada flecha hacia abajo es un multiplicador de retención. El usuario que llega por "calculadora de calorías" y termina haciendo la compra semanal desde la app tiene un coste de cambio altísimo.

## 1.3 Motor de cálculo de objetivos

Transparente y estándar de la industria:

- **BMR (Mifflin-St Jeor):** `10·W(kg) + 6.25·H(cm) − 5·A(años) + s`, con `s = +5` (hombre) / `s = −161` (mujer).
- **TDEE:** BMR × factor de actividad — Sedentario 1.2, Ligero 1.375, Moderado 1.55, Muy activo 1.725, Extremo 1.9.
- **Ajuste:** −20% para pérdida, +15% para ganancia.
- El % de grasa corporal se usa para estimar masa magra y de ahí derivar la recomendación proteica.
- Los rangos de macros son **deliberadamente amplios** ("intentionally loose") para preservar variedad en el generador. Este detalle es importante: no son targets exactos, son restricciones con holgura.

## 1.4 Capacidades núcleo

| Capacidad | Descripción | Free/Premium |
|---|---|---|
| Generador algorítmico | Cumple kcal + macros simultáneamente. Regeneración por comida o día. Bloqueo de comidas. | Free (1 día) |
| Nutrition Profiles | Contenedores reutilizables de objetivos: kcal, C/G/P, fibra mín, sodio máx, colesterol máx. Asignables a días concretos (carb cycling). | Free (1 perfil) / Premium (por día) |
| Meal Types | Por comida: tiempo disponible, cocinar sí/no, complejidad, tamaño (Tiny 50% / Small 75% / Normal 100% / Big 125% / Huge 150%), nº de comensales | Free |
| Recurring Foods | "Always" (siempre, cantidad fija) / "Often" (mucho más frecuente). Modo exclusivo: el generador solo usa tu lista. Sobreescribe exclusiones. | Free |
| Exclusiones | Matching por keyword sobre título **e** ingredientes. Lista predefinida + custom. **No es un sistema clínico de alergias.** | Free |
| Recetas/alimentos propios | Custom Foods (nutrición manual), Custom Recipes (nutrición calculada), Personalized Recipes (tu versión persistente de una receta del catálogo) | Free |
| Collections | Agrupaciones compartibles y seguibles. Como "Recurring Collection" acotan el universo del generador. | Free |
| Planificación semanal | Algoritmo distinto, más pesado. Genera 7-14 días, **considera la lista de la compra final para reutilizar ingredientes**, prioriza despensa. Corre automáticamente 1 día antes del "grocery shopping day". | Premium |
| Lista de la compra | Automática desde el plan. Cantidades exactas, sustituciones conservadoras para acortarla, resta de despensa, export PDF/email/Instacart. | Premium |
| Despensa virtual | Trackea lo que tienes y lo descuenta. Prioriza consumirlo. Reportan 80-90% de eficiencia de uso de ingredientes. | Premium |
| Leftovers Patterns | Origen → destinos → duración. "Cocina una vez, come varias". Standard y alternos (Dinner / Dinner B). | Premium |
| Familia | (a) escalado de raciones por comida; (b) Family Account Linking (beta) con control total mutuo y agregación de listas. | Premium |
| Tracking | Secundario. Checkbox por comida, barcode scan, parseo de etiquetas por foto (iOS), peso. Los ítems marcados quedan bloqueados y el resto del día se recalcula alrededor. | Free |

## 1.5 Modelo de negocio

| Tier | Precio | Qué desbloquea |
|---|---|---|
| Free | $0 | Plan de **un solo día**, tracking, todas las dietas, custom foods/recipes, 1 plan guardado |
| Premium | **$5/mes con anual ($59.99/año)** o $14.99/mes. Trial 14 días, devolución 30 días | Semana completa, lista de la compra, despensa, sobras automáticas, layout por día, 20 planes guardados, PDF, familia |
| Professional | $49/mes (≤10 clientes) / $59/mes (ilimitado + login de cliente), facturado trimestralmente | Dashboard multi-cliente, marca propia, permisos, notas |
| Partner API | Precio a medida | Generación de planes vía REST, ~7.000 recetas curadas, listas estructuradas |

**El paywall está en el eje temporal, y eso es lo más inteligente del modelo.** El usuario gratuito experimenta el algoritmo cada día pero sigue sufriendo el problema original (tener que decidir y volver cada mañana). La carencia es estructural, no un banner. No necesitan ser agresivos con el upsell.

Existen múltiples SKUs vivos en App Store ($8.99 y $14.99 mensual; $47.99 / $49.99 / $53.99 / $59.99 / $84.99 anual), indicando tests de precio, promociones estacionales y grandfathering.

## 1.6 Motor de adquisición

Abrumadoramente SEO orgánico (~74% del tráfico desktop, ~75.000 keywords, ~600k visitas/mes *[verificar]*), sobre tres activos programáticos:

1. **Calculadoras gratuitas sin login** (calorie, BMR, TDEE, deficit, macro, protein) que convierten intención informacional en transaccional dentro de la misma página.
2. **Base de datos de alimentos indexable**: >900.000 registros, URL por alimento (`/calories/{slug}-{id}`) y — el detalle más agresivo — un sitemap de *quantities* que genera una URL por **cada cantidad/unidad de cada alimento** (`?a=0.333:5`). Multiplica ~900k alimentos en millones de URLs.
3. **Landings programáticas de dieta**: 640 URLs en `/diet-plan/{kcal}/{dieta}`, con **planes de muestra reales** generados por el producto y revisados por dietista. SEO y demo de producto a coste marginal cero.

Complementos: blog que rankea para búsquedas de competidores ("Best MyFitnessPal Alternatives"), referidos bidireccionales ($9-15 de crédito), afiliados, gift codes.

## 1.7 Arquitectura técnica observada

- **Backend Django + django-tastypie** (no DRF). API `/api/v1/` con 85 recursos y schemas autodescriptivos, **legible sin autenticación** para lectura.
- **Dos frontends SvelteKit independientes**: marketing con SSR (`x-sveltekit-page: true`, cacheado en edge 4h) y producto en `/app/*` como **SPA pura estática** (mismo shell byte-a-byte en todas las rutas, MD5 idéntico).
- Datos nutricionales **propios**, no API externa en runtime. Modelo polimórfico con discriminador `source` ∈ {UsdaFood, BrandedFood, Recipe, CustomFood}. El panel de 85 nutrientes (aminoácidos completos, carotenoides, azúcares individuales, betaína, colina) es literalmente el dump de **USDA SR Legacy**.
- Cloudflare delante de todo, CloudFront+S3 para imágenes. Stripe, Amplitude, Bugsnag, GTM, AppsFlyer.
- Batching cliente `/api/denested-batch/` con debounce de 50ms para resolver el N+1 que genera el modelo hipermedia de Tastypie.
- Cabecera `Vary: Backend-Version` → despliegues canary/blue-green o compatibilidad de contrato con apps nativas.
- Recurso `gptrecipereview` en la API: usan un LLM para revisión/validación de recetas, aunque no lo mencionan en ningún sitio público.

## 1.8 Fortalezas

1. **El solver es el foso, no los datos.** La base de alimentos es commodity (USDA es dominio público). Lo difícil es satisfacer simultáneamente macros + micros + dieta + exclusiones + tiempo + presupuesto + despensa + comensales + patrones de sobras. La propia empresa admite que la intersección despensa × targets × preferencias es demasiado pequeña para resolverla.
2. **Value-before-signup**: generador funcional embebido en la home. Plan real sin cuenta, con 3 campos. Registro pedido exactamente cuando topas con un límite que ya deseas superar.
3. **El bucle cerrado** plan → lista → despensa → pedido. Ningún tracker lo tiene.
4. **Agency sobre la automatización**: nada generado es inmutable. Regenerar una comida sin rehacer el plan, alternativas, swap entre días, lock, recurring. *"Our meal planner is a guide, not a rigid prescription."*
5. **Eficiencia de capital brutal**: ~7 personas, bootstrapped desde 2012, sin VC, rankeando para 75.000 keywords.

## 1.9 Debilidades (= tu oportunidad)

Este es el material más útil de todo el análisis.

| Debilidad | Evidencia | Severidad |
|---|---|---|
| **La lista de la compra no cierra el bucle** | Los usuarios reportan listas "HUGE", no agrupables por categoría ni tienda, y coste real ~2x el estimado. El generador optimiza variedad **sin penalizar el número de ingredientes únicos**, lo que rompe el valor prometido aguas abajo. | Crítica |
| **Despensa pobre** | No puede generar planes solo desde la despensa (limitación reconocida). Los usuarios recompran cosas que ya tienen. Sin drag&drop en despensa. | Alta |
| **Onboarding móvil de 17 pantallas con paywall inmediato** | Explota coste hundido. La web hace lo contrario (plan en 3 campos). Incoherencia de producto. | Alta |
| **La automatización no ahorra tanto tiempo como promete** | Usuarios editan el plan para que encaje con horario/presupuesto/gustos. Repetición de recetas hacia la semana 3-4. | Alta |
| **Cero localización real** | UI en 3 idiomas **solo en móvil**; alimentos y recetas no traducidos; catálogo, marcas, restaurantes e integraciones 100% EE.UU.; precios en USD. **El mercado europeo y latinoamericano está esencialmente vacío.** | Crítica (oportunidad) |
| Sin log de ejercicio ni importación de wearables | Sync solo de salida a Apple Health / Health Connect. No importa de MyFitnessPal, Fitbit, Garmin, Whoop, Oura. | Media |
| Sin targets de micronutrientes | Solo kcal, C/G/P, fibra, sodio, colesterol. Nada de saturadas, potasio, hierro, vitaminas. | Media |
| Sin filtro por electrodoméstico/método | Airfryer, olla lenta, sin horno. Reconocido y no implementado. Workaround: excluir la keyword "grilled". | Media |
| **Alergias como exclusión por keyword** | No hay severidad, trazas ni garantía. Riesgo real de seguridad presentado como feature. | Alta (riesgo, no oportunidad — no lo repliques) |
| Sin modo embarazo/lactancia | Decisión deliberada por riesgo clínico. | Baja |
| Family linking sin permisos granulares | "Full control over each other's meals and settings". Beta. De facto permite compartir suscripción. | Media |
| Presupuesto cualitativo, no numérico | Solo un selector "low". No hay presupuesto en euros ni precios reales de supermercado. | Alta (oportunidad) |
| Sin IA generativa visible | Ninguna mención pública en 2026, salvo el recurso interno `gptrecipereview`. | Media |
| Sin horas reales | El plan es una pila vertical de comidas nominales (Breakfast/Lunch/Dinner). No hay ayuno intermitente, ni ventanas horarias, ni sincronización con entrenamiento. | Media |
| Estética "de ingenieros" | Utilitaria, densa, sin webfonts, radios de 0.3rem. Resta deseo en una categoría emocional. | Media |
| Publicidad AdSense dentro del producto de contenido | Las fichas de receta se sienten "sitio de contenido", no producto. | Baja |

---

# 2. Panorama competitivo y posicionamiento

## 2.1 Mapa del mercado

El mercado se divide en cuatro cuadrantes según **quién decide qué comes** y **hasta dónde llega la cadena de valor**.

```
                    LLEGA HASTA LA COMPRA/COCINA
                              ▲
                              │
   Mealime, Plan to Eat   ┌───┼───┐   EAT THIS MUCH
   Paprika, Whisk         │   │   │   PlateJoy
   (recetario + lista)    │   │   │   (algoritmo + lista + despensa)
                          │   │   │
  DECIDE EL USUARIO ◄─────┼───┼───┼─────► DECIDE EL ALGORITMO
                          │   │   │
   MyFitnessPal           │   │   │   Noom, Zoe, Lifesum Premium
   Cronometer, LoseIt     │   │   │   (coaching prescriptivo, sin logística)
   Yazio, FatSecret       └───┼───┘
   (tracking puro)            │
                              ▼
                    TERMINA EN EL REGISTRO
```

| Producto | Qué hace | Precio aprox. *[verificar]* | Debilidad explotable |
|---|---|---|---|
| **Eat This Much** | Generación algorítmica + logística completa | $5/mes anual | Solo EE.UU., lista de la compra rota, UX densa |
| **MyFitnessPal** | Tracking + BD de alimentos gigante | ~$20/mes premium | No planifica nada. Es trabajo manual puro |
| **Cronometer** | Tracking con precisión de micronutrientes | ~$50/año | Nicho quantified-self, no planifica |
| **Yazio** | Tracking + planes de recetas fijos, fuerte en Europa/DACH | ~€30/año | Planes son plantillas estáticas, no solver |
| **Lifesum** | Tracking + planes temáticos, fuerte en Europa | ~€45/año | Sin optimización de macros ni lista de la compra real |
| **Mealime** | Recetario con filtros + lista de la compra, UX excelente | ~$50/año | **No optimiza macros**. Eliges tú, no cumple objetivos |
| **PlateJoy** | Planes personalizados, muy caro, orientado a salud | ~$99/6 meses | Precio prohibitivo, menos automático de lo que parece |
| **Plan to Eat** | Recetario propio + lista de la compra | ~$50/año | 100% manual, es un organizador |
| **Noom / Zoe** | Coaching conductual/metabólico | $60-200/mes | No resuelven "qué ceno hoy" |
| Apps de supermercado (Mercadona, Carrefour, Continente) | Compra online | — | Cero planificación nutricional |

## 2.2 Los tres huecos reales

**Hueco 1 — Geográfico (el más grande y el más barato de atacar).**
No existe un ETM europeo. El catálogo de ETM son marcas y restaurantes estadounidenses; las integraciones son Instacart/AmazonFresh/Walmart; las traducciones son de UI y solo en móvil. Un producto con catálogo de marcas españolas/europeas, precios reales de supermercados locales, recetas de la dieta mediterránea real (no la caricatura), unidades métricas nativas y contenido en español no tiene competencia directa de este tipo. **Yazio y Lifesum tienen la geografía pero no el motor; ETM tiene el motor pero no la geografía.**

**Hueco 2 — Economía real de la compra.**
ETM tiene un selector cualitativo "low budget" y sus usuarios reportan gastar el doble de lo estimado. Un producto que optimice **coste real en euros** con precios de supermercado, que minimice explícitamente el número de ingredientes únicos y de envases, y que muestre "esta semana: 47,80 € / presupuesto 50 €" resuelve el dolor #1 declarado del planificador de comidas y es objetivamente medible.

**Hueco 3 — Despensa-primero y desperdicio cero.**
ETM admite que no puede generar planes desde la despensa. Ese problema **sí es resoluble** si cambias la formulación: en vez de "encuentra recetas que satisfagan simultáneamente targets Y despensa" (intersección vacía), formúlalo como **optimización multiobjetivo con penalización blanda** por ingrediente no disponible, y ordena por fecha de caducidad. Es una decisión de diseño del solver, no una barrera algorítmica.

## 2.3 Posicionamiento recomendado

> **Producto:** planificador automático de comidas que optimiza simultáneamente tus objetivos nutricionales, **tu presupuesto real en euros** y **lo que ya tienes en casa**.
>
> **Promesa:** "Tu semana resuelta: qué comer, cuánto cuesta y qué comprar. Sin listas de 60 ingredientes."
>
> **Mercado inicial:** España (y por extensión LatAm hispanohablante en fase 2), con catálogo, precios, recetas y unidades nativas.
>
> **Anti-posicionamiento explícito:** no somos un contador de calorías. No somos un recetario. No somos coaching.

Los tres pilares diferenciales medibles y defendibles:

1. **Coste real, no cualitativo.** Presupuesto en euros como restricción de primera clase del solver.
2. **Lista de la compra corta por diseño.** El número de ingredientes únicos es un término de la función objetivo, no una consecuencia.
3. **Despensa-primero real.** Generación con penalización blanda + priorización por caducidad.

Todo lo demás (generador de macros, tracking, recetas custom, exclusiones) es **paridad de categoría**: obligatorio tenerlo, inútil para diferenciarse.

---

# 3. Alcance del producto propio

## 3.1 Principio de corte

El MVP debe demostrar **una** hipótesis: *que un solver que optimiza nutrición + coste + despensa produce planes que la gente sigue durante 4 semanas*. Todo lo que no sirva para validar eso se corta.

Corolario duro: **el MVP no lleva app móvil nativa**. Web responsive instalable como PWA. La app nativa cuesta 3-4 meses adicionales, duplica superficie de bugs, e introduce las comisiones de las stores (15-30%) antes de saber si el producto funciona. ETM funcionó 3 años en web antes de tener app decente.

## 3.2 MVP (lanzamiento comercial mínimo)

### Núcleo — obligatorio
- **Cálculo de objetivos**: Mifflin-St Jeor + factor de actividad + ajuste de objetivo. Salida: kcal, proteína (g/kg de peso o de masa magra), grasa (g), carbohidratos (resto), fibra mínima.
- **Onboarding de 4 pantallas máximo**, con resultado antes del registro.
- **Motor de generación diario**: selección de recetas + escalado continuo de porciones para cumplir kcal ± 3% y macros ± 10-15%.
- **Motor de generación semanal** con optimización de reutilización de ingredientes y coste.
- **Re-roll granular**: regenerar día completo, comida individual, o pedir 5 alternativas para un slot. Bloquear comidas.
- **Edición manual**: sustituir una receta, cambiar la ración, mover una comida a otro día, añadir un alimento suelto.
- **Lista de la compra** agregada por categoría de supermercado, con cantidades consolidadas, conversión a formatos de venta reales ("1 brick de 1 L" no "347 ml"), y **coste estimado total**.
- **Despensa mínima viable**: marcar lo comprado como "en casa"; la lista descuenta; el generador da bonus a lo que caduca antes.
- **Tracking pasivo**: marcar comida como consumida. Barra de progreso del día. Añadir algo fuera de plan buscando en el catálogo.
- **Catálogo de recetas propio**: 350-450 recetas producidas, con nutrición calculada desde ingredientes, foto, tiempo, dificultad, tags de dieta y alérgenos.
- **Preferencias**: tipo de dieta (6 presets), exclusiones de ingredientes/alérgenos, tiempo disponible por comida, nº de comidas al día (2-5), nº de comensales, presupuesto semanal en euros.
- **Cuenta + suscripción**: registro por email/OAuth, Stripe Checkout, portal de gestión, trial.

### Marketing/adquisición — obligatorio desde el día 1
- **Generador público sin registro** (versión limitada: un día, dieta y kcal, sin macros específicos).
- **3 calculadoras SEO**: calorías/TDEE, macros, déficit.
- **Landings programáticas** por (dieta × rango calórico), con plan de muestra real generado por el propio motor. Esto es gratis: ya tienes el motor.

### Explícitamente FUERA del MVP
- App móvil nativa · Escaneo de código de barras · Sobras/batch cooking automático · Cuentas familiares enlazadas · Tier profesional B2B · Integración con supermercados online · Sync con Apple Health/Health Connect · Colecciones compartibles · Recetas creadas por usuario · Micronutrientes más allá de fibra/sodio · Perfiles nutricionales múltiples por día · Referidos · Multi-idioma.

**Justificación de los cortes más discutibles:**

- *Sobras/batch cooking fuera*: es un diferenciador de ETM y es muy demandado, pero requiere que el modelo de plan soporte instancias de receta vinculadas a múltiples slots con estado compartido. Es una complicación estructural del modelo de datos y del solver. Se diseña el esquema para admitirlo (campo `batch_group_id`), pero no se implementa la UI ni la lógica de generación hasta v1.
- *Barcode fuera*: solo tiene sentido con un catálogo de productos de marca completo y una app nativa. Ambas cosas están fuera del MVP.
- *Recetas de usuario fuera*: introduce moderación, cálculo nutricional sobre ingredientes arbitrarios, y almacenamiento de imágenes. Alto coste, cero validación de la hipótesis central.
- *Familia fuera*: multiplica la complejidad del solver (targets distintos por persona sobre la misma receta) por un factor grande. En ETM es un workaround, no una solución real.

## 3.3 v1 (meses 4-9 post-lanzamiento, priorizado por señal de uso)

1. **App móvil (Expo/React Native)** compartiendo la capa de datos. Detonante: >40% del uso en móvil web.
2. **Batch cooking / sobras**: patrones origen→destino con duración, ración multiplicada, aviso de conservación.
3. **Precios reales por supermercado**: mapeo de ingredientes a SKUs de 2-3 cadenas, precio actualizado, comparación de cesta.
4. **Escaneo de código de barras** + catálogo de marca (vía Open Food Facts, ver §7).
5. **Perfiles nutricionales por día** (día de entreno / descanso, ciclado de carbohidratos).
6. **Recetas y alimentos propios del usuario**, con cálculo nutricional automático.
7. **Filtro por electrodoméstico y técnica** (airfryer, olla lenta, sin horno, una sola sartén). Hueco explícito de ETM, barato de implementar si etiquetas bien las recetas desde el principio.
8. **Modo hogar**: raciones distintas por miembro sobre la misma receta, lista agregada.
9. **Ventanas horarias** y ayuno intermitente (16:8, 5:2). Hueco de ETM.
10. **Export de lista** a PDF/email y a la app de compra online de al menos una cadena.

## 3.4 Futuro (v2+, no comprometido)

- Tier profesional B2B para dietistas y entrenadores (dashboard multi-cliente, marca propia). **Alto ARPU pero producto distinto**: no lo abordes hasta tener B2C estable.
- API para partners.
- Sync bidireccional con wearables y ajuste dinámico de calorías por actividad real.
- Micronutrientes completos y detección de deficiencias.
- Asistente conversacional ("cámbiame la cena del jueves por algo sin horno y más barato").
- Modo restricción médica supervisada (renal, diabetes, FODMAP clínico) — **requiere validación clínica y cambia el perfil regulatorio, ver §11**.
- Expansión a otros mercados EU (catálogo por país).

---

# 4. Flujos de usuario

## 4.1 Onboarding (objetivo: primer plan visible en < 60 segundos, sin cuenta)

```
[Landing / calculadora / landing programática de dieta]
   │
   ▼
P1 · Objetivo + cuerpo          (1 pantalla, 6 campos)
   objetivo: perder / mantener / ganar
   sexo · edad · altura · peso · actividad (5 niveles, con microcopy
   "elige tu semana típica, no la más ambiciosa")
   │
   ▼
P2 · Cómo comes                 (1 pantalla)
   tipo de dieta (chips) · nº de comidas/día · comensales
   │
   ▼
P3 · Qué evitas                 (1 pantalla, saltable)
   alérgenos comunes (chips) + campo libre de exclusiones
   AVISO explícito: "esto filtra por ingredientes declarados,
   no sustituye la lectura de etiquetas"
   │
   ▼
>>> GENERA Y MUESTRA UN DÍA COMPLETO, REAL, SIN CUENTA <<<
   con objetivos calculados, coste estimado del día, macros
   │
   ├── El usuario puede re-rollear el día 2-3 veces
   │
   ▼
P4 · Muro suave: "Guarda este plan y genera tu semana"
   → registro (email mágico / Google / Apple)
   │
   ▼
P5 · Post-registro: presupuesto semanal + día de la compra
   (2 campos, aquí ya hay compromiso)
   │
   ▼
Primera generación semanal + tour contextual de 3 puntos
```

**Reglas de diseño del onboarding:**
- Nunca más de 6 campos por pantalla.
- El resultado llega **antes** del registro y **antes** del paywall. Lo contrario (17 pantallas + paywall, como ETM móvil) convierte a corto plazo y destruye retención.
- Datos que ETM pide y aquí se difieren: % de grasa corporal (opcional, en ajustes), tiempo de cocina por comida (default sensato: 30 min entre semana, 45 fin de semana), macros específicos (avanzado).
- Estimación por defecto de % grasa corporal por sexo/edad/IMC en lugar de preguntar. Se puede refinar después.

## 4.2 Generación de plan

```
Trigger: automático (día antes de la compra) | manual ("Generar semana")
   │
   ▼
1. Resolver contexto
   perfil nutricional activo → targets por día
   layout semanal → slots (día, tipo de comida, tamaño relativo, comensales)
   preferencias → filtros duros (dieta, exclusiones, tiempo, técnica)
   despensa → inventario con caducidades
   presupuesto → límite semanal blando
   historial → penalización de repetición (últimos 21 días)
   │
   ▼
2. Construir pool de candidatos (una vez, cacheado)
   filtro duro sobre el catálogo → 300-1500 recetas viables
   si el pool < 40 recetas → devolver DIAGNÓSTICO al usuario, no un plan malo
      ("tus exclusiones de huevo, lácteos y gluten dejan 22 recetas.
        Sugerimos relajar X")
   │
   ▼
3. Generar N=6 candidatos por día (paralelo)
   Etapa A: selección combinatoria por composición de macros
   Etapa B: escalado continuo de porciones vía LP
   Score: error nutricional + coste + desperdicio + repetición + afinidad
   │
   ▼
4. Ensamblar la semana (búsqueda local)
   minimizar: Σ error_día + λ·|ingredientes únicos| + μ·coste + ν·repetición
   → esto es lo que produce listas de la compra CORTAS
   │
   ▼
5. Persistir plan + seed + versión del algoritmo (reproducibilidad)
   │
   ▼
6. Mostrar: semana + resumen (kcal media, macros, coste total vs presupuesto,
   nº de ingredientes, % de despensa aprovechado)
```

**Diagnóstico de fallo (crítico, y donde ETM falla).** Cuando el solver no alcanza los targets, ETM deja comidas vacías o incumple silenciosamente y publica artículos de ayuda sobre ello. Aquí, el sistema debe **explicar la restricción que ata**:

> "No consigo llegar a 180 g de proteína con 1.600 kcal usando solo tus 4 recetas recurrentes. Opciones: (a) subir a 1.750 kcal, (b) bajar a 155 g de proteína, (c) permitir recetas fuera de tus recurrentes."

Esto se obtiene de las variables de holgura del LP y de qué restricción está activa. Es barato de implementar y es una diferencia de calidad percibida enorme.

## 4.3 Ajuste y re-roll

Principio rector: **editar debe costar lo mismo que generar**. Si el usuario corrige el 30% del plan, la UI de edición es tan crítica como el algoritmo.

| Acción | Alcance | Comportamiento |
|---|---|---|
| Re-roll de comida | 1 slot | Nueva receta manteniendo el resto del día; **el resto del día se re-escala** para compensar el hueco nutricional |
| Ver alternativas | 1 slot | Panel con 6 opciones ordenadas por score, mostrando delta de kcal/macros/coste y si usa despensa |
| Re-roll de día | 1 día | Respeta comidas bloqueadas y comidas ya consumidas |
| Re-roll de semana | 7 días | Confirmación si hay compra ya hecha |
| Bloquear (pin) | comida o día | Inmune a regeneraciones |
| Sustituir manual | 1 slot | Buscador de catálogo, filtrado por lo que encaja nutricionalmente (ordenado por "encaje", no alfabético) |
| Cambiar ración | 1 receta | Slider con recálculo en vivo de macros del día y coste |
| Mover | drag & drop | Entre slots y entre días. Drop targets discretos, nunca canvas libre (funciona en táctil) |
| Marcar "no me gusta" | receta | Baja permanente del pool + señal de preferencia |
| Fijar recurrente | receta/alimento | "Siempre" (cantidad fija) u "Frecuente" |

**Regla de seguridad UX:** una vez la lista de la compra está marcada como "comprada", las regeneraciones de esa semana requieren confirmación explícita y advierten del desperdicio. (ETM eliminó el swipe-to-regenerate por esto exactamente.)

## 4.4 Tracking

El tracking es *pasivo por adherencia*: seguir el plan equivale a registrar.

```
Vista día
  ├─ [✓] por comida (o por alimento, al desplegar)
  ├─ Barra de progreso: kcal consumidas / objetivo, con segmentos de macro
  ├─ Marcar como consumido → esa comida se BLOQUEA
  │     y el resto del día se puede recalcular alrededor
  └─ "Comí otra cosa" → buscador → sustituye el slot
        el sistema muestra el delta y ofrece recalcular la cena
```

Efectos colaterales que hay que implementar bien:
- Marcar comida consumida → sus ingredientes salen de la lista de la compra pendiente y se descuentan de la despensa.
- Registro de peso (entrada manual, gráfica de tendencia con media móvil de 7 días — nunca el dato crudo, que asusta).
- **Sin log de ejercicio en MVP.** Se resuelve con perfiles nutricionales por día en v1.

## 4.5 Lista de la compra

Este es el flujo donde se gana o se pierde contra ETM.

```
Plan semanal confirmado
   │
   ▼
1. Agregación: Σ ingredientes de todas las recetas del rango
   normalizado a gramos/ml canónicos
   │
   ▼
2. Consolidación semántica
   "cebolla", "cebolla morada", "cebolla dulce" → decisión explícita:
   ¿consolidar o mantener? (regla por familia de ingrediente)
   │
   ▼
3. Resta de despensa
   necesito 420 g arroz, tengo 300 g → comprar 120 g
   │
   ▼
4. Conversión a UNIDADES DE COMPRA REALES  ← lo que ETM no hace bien
   120 g arroz → "1 paquete de 500 g" (y avisa: sobran 380 g)
   347 ml leche → "1 brick de 1 L"
   3 huevos → "1 docena"
   → genera automáticamente entradas de despensa post-compra
   │
   ▼
5. Agrupación por sección de supermercado
   Frescos · Carnicería · Pescadería · Lácteos · Despensa · Congelados ·
   Panadería · Bebidas · Limpieza
   (orden configurable, porque cada supermercado tiene su recorrido)
   │
   ▼
6. Coste estimado por ítem y total, con margen de incertidumbre honesto
   "48-56 € estimado" no "51,34 €"
   │
   ▼
7. Edición: añadir, eliminar, marcar como "ya lo tengo"
   Hover/tap en un ítem → "para: lentejas del martes, ensalada del jueves"
   │
   ▼
8. Modo compra: checklist offline, agrupada, tipografía grande
   │
   ▼
9. Al finalizar → "Mover comprado a despensa" (un tap, cantidades ya en
   formato de envase)
```

**Métricas que este flujo debe optimizar y mostrar:**
- Nº de ingredientes únicos de la semana (objetivo: < 35 para 1 persona, < 45 para 2).
- % del plan cubierto por despensa existente.
- Coste estimado vs presupuesto.
- Desperdicio previsto (gramos comprados y no planificados para consumir).

---

# 5. Modelo de datos

## 5.1 Diagrama de relaciones

```
User ──1:1── UserProfile
  │
  ├──1:N── NutritionProfile ──1:N── MealSlotTemplate (layout semanal)
  ├──1:N── FoodPreference (exclusiones, recurrentes, ratings)
  ├──1:N── MealPlan ──1:N── PlanDay ──1:N── PlanMeal ──1:N── PlanItem
  ├──1:N── PantryItem
  ├──1:N── GroceryList ──1:N── GroceryLine
  ├──1:N── WeightEntry
  └──1:1── Subscription

Recipe ──1:N── RecipeIngredient ──N:1── Food
Food ──1:N── FoodPortion  (definiciones de unidades domésticas)
Food ──1:1── NutrientPanel (jsonb)
Food ──N:1── FoodCategory (sección de supermercado)
Food ──1:N── PurchaseFormat (formatos de venta reales + precio)
```

## 5.2 Entidades

### `food` — alimento/ingrediente atómico

| Campo | Tipo | Notas |
|---|---|---|
| `id` | bigint PK | |
| `source` | enum | `usda` \| `ciqual` \| `bedca` \| `off` \| `custom` \| `manual` |
| `source_ref` | text | fdc_id, código de barras, etc. Para trazabilidad de licencia |
| `name_es` / `name_en` | text | |
| `slug` | text UNIQUE | Para URLs SEO |
| `category_id` | FK | Categoría nutricional |
| `aisle_id` | FK | **Sección de supermercado** — distinto de la categoría nutricional |
| `is_ingredient` | bool | ¿Se puede usar en una receta? (la Coca-Cola no) |
| `is_branded` | bool | |
| `brand` | text NULL | |
| `density_g_per_ml` | numeric NULL | Para conversiones volumen↔peso |
| `edible_fraction` | numeric | Peso neto / peso bruto (plátano 0.64). **Crítico para la lista de la compra** |
| `yield_factor_cooked` | numeric NULL | 100 g arroz crudo → 260 g cocido |
| `nutrients` | jsonb | Panel por 100 g. Ver §5.4 |
| `allergen_tags` | text[] | Los 14 alérgenos del Reglamento UE 1169/2011 |
| `diet_tags` | text[] | `vegan`, `vegetarian`, `gluten_free`, `keto_ok`... derivados |
| `default_price_cents_per_kg` | int NULL | Fallback de coste |
| `perishability_days` | int | Vida útil típica tras compra. Alimenta la priorización de despensa |
| `search_vector` | tsvector | Índice de búsqueda full-text en español |

### `food_portion` — unidades domésticas

| Campo | Tipo | Notas |
|---|---|---|
| `food_id` | FK | |
| `label` | text | "unidad mediana", "cucharada", "taza", "loncha", "rebanada" |
| `grams` | numeric | **Todo se normaliza a gramos.** Regla de oro |
| `is_default` | bool | Unidad mostrada por defecto |
| `applies_to` | enum | `raw` \| `cooked` |

### `purchase_format` — cómo se vende realmente

| Campo | Tipo | Notas |
|---|---|---|
| `food_id` | FK | |
| `label` | text | "brick 1 L", "paquete 500 g", "bandeja 6 uds" |
| `grams` | numeric | Contenido neto |
| `price_cents` | int NULL | |
| `retailer` | text NULL | `mercadona` \| `carrefour` \| null (genérico) |
| `price_updated_at` | timestamptz | |

> Esta tabla es la que ETM no tiene y es la que hace que su lista de la compra sea inútil. Sin ella no puedes decir "compra 1 paquete de arroz", solo "compra 120 g de arroz".

### `recipe`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | bigint PK | |
| `owner_id` | FK NULL | NULL = catálogo global |
| `title` · `slug` · `description` | text | |
| `servings` | int | Raciones base de la receta |
| `prep_minutes` · `cook_minutes` | int | |
| `complexity` | smallint | 1-5 |
| `requires_cooking` | bool | |
| `appliances` | text[] | `oven`, `stovetop`, `airfryer`, `slow_cooker`, `none` |
| `meal_types` | text[] | `breakfast`, `lunch`, `dinner`, `snack` |
| `diet_tags` · `allergen_tags` | text[] | Derivados de ingredientes + revisión manual |
| `cuisine` | text | |
| `steps` | jsonb | Array de pasos, con `duration_s` opcional para modo cocina |
| `image_url` | text | |
| **`nutrients_per_serving`** | jsonb | **Denormalizado**, calculado desde ingredientes. El solver lo lee de aquí |
| **`macro_unit_vector`** | numeric[4] | `[kcal, P, C, G]` por ración **normalizado a norma 1**. Ver §6 |
| `cost_cents_per_serving` | int | Denormalizado |
| `unique_ingredient_count` | smallint | Denormalizado. Alimenta la penalización de lista larga |
| `perishable_ingredient_ids` | bigint[] | Denormalizado. Acelera el matching de despensa |
| `min_scale` / `max_scale` | numeric | Escalado permitido (default 0.6 / 1.8). Una tortilla no se escala a 0.2 |
| `status` | enum | `draft` \| `reviewed` \| `published` |
| `reviewed_by` | text NULL | Trazabilidad del revisor (dietista) |

> **Los cinco campos denormalizados son la clave de rendimiento del solver.** Se recalculan por trigger o job cuando cambia un ingrediente. Sin ellos, cada evaluación de candidato requiere un JOIN + agregación.

### `recipe_ingredient`

| Campo | Tipo | Notas |
|---|---|---|
| `recipe_id` · `food_id` | FK | |
| `quantity` · `unit` | numeric, text | Unidad de la receta ("2 cucharadas") |
| `grams` | numeric | **Canónico**, resuelto en el guardado |
| `state` | enum | `raw` \| `cooked` — determina qué panel nutricional aplicar |
| `is_optional` | bool | Los opcionales no entran en la lista de la compra por defecto |
| `substitutable_group` | text NULL | "aceite", "vinagre" — permite sustituciones en la consolidación |
| `display_order` | smallint | |

### `nutrition_profile`

| Campo | Tipo |
|---|---|
| `user_id` · `name` | FK, text |
| `kcal` | int |
| `protein_g` · `carbs_g` · `fat_g` | numeric |
| `protein_tol` · `carbs_tol` · `fat_tol` | numeric (default 0.15) |
| `fiber_min_g` · `sodium_max_mg` · `sat_fat_max_g` | numeric NULL |
| `is_default` | bool |

### `meal_plan` / `plan_day` / `plan_meal` / `plan_item`

| Entidad | Campos clave |
|---|---|
| `meal_plan` | `user_id`, `start_date`, `end_date`, `status` (draft/active/archived), `generator_version`, `seed`, `score_breakdown` jsonb, `estimated_cost_cents` |
| `plan_day` | `plan_id`, `date`, `nutrition_profile_id`, `is_locked`, `achieved` jsonb (kcal/macros reales) |
| `plan_meal` | `day_id`, `meal_type`, `position`, `target_kcal_share`, `is_locked`, `eaten_at` NULL, `servings_for` (nº comensales) |
| `plan_item` | `meal_id`, `recipe_id` NULL, `food_id` NULL, `scale` numeric, `grams` numeric, `is_locked`, `eaten` bool, `batch_group_id` uuid NULL, `source` (generated/manual/leftover) |

> `plan_item` es polimórfico: apunta a receta **o** a alimento suelto. `batch_group_id` está previsto desde el MVP aunque la funcionalidad de batch cooking llegue en v1 — evita una migración dolorosa.

### `pantry_item`

| Campo | Tipo | Notas |
|---|---|---|
| `user_id` · `food_id` | FK | |
| `grams` | numeric | Cantidad restante |
| `expires_on` | date NULL | Prioriza consumo |
| `acquired_at` | timestamptz | |
| `auto_deduct` | bool | Si se descuenta al marcar comidas como consumidas |

### `grocery_list` / `grocery_line`

| Entidad | Campos clave |
|---|---|
| `grocery_list` | `user_id`, `plan_id`, `date_from`, `date_to`, `status`, `estimated_cost_cents`, `is_manually_edited` |
| `grocery_line` | `list_id`, `food_id`, `needed_grams`, `pantry_grams`, `buy_grams`, `purchase_format_id`, `quantity` (nº envases), `aisle_id`, `estimated_cost_cents`, `checked` bool, `source_meal_ids` bigint[] (para el "¿para qué es esto?") |

### `food_preference`

| Campo | Tipo | Notas |
|---|---|---|
| `user_id` | FK | |
| `kind` | enum | `exclude_keyword` \| `exclude_food` \| `block_recipe` \| `like` \| `recurring_always` \| `recurring_often` |
| `target_id` / `keyword` | FK NULL / text NULL | |
| `meal_types` | text[] NULL | Aplicable solo a ciertas comidas |
| `quantity_grams` | numeric NULL | Para recurrentes "always" |

## 5.3 Manejo de unidades y porciones (la trampa silenciosa)

Esta es la fuente de bugs número uno en productos de nutrición. Reglas no negociables:

1. **El gramo es la única unidad canónica.** Todo se almacena en gramos. Las unidades domésticas son una capa de *presentación* y de *entrada*, nunca de almacenamiento.
2. **Volumen → peso requiere densidad.** 1 taza de harina ≠ 1 taza de azúcar. `density_g_per_ml` es obligatorio para cualquier alimento que se mida por volumen. Sin densidad, prohíbe la entrada en ml.
3. **Crudo vs cocinado.** 100 g de arroz crudo tienen ~355 kcal; 100 g de arroz cocido ~130 kcal. El campo `state` en `recipe_ingredient` determina qué panel se aplica. Si el panel disponible es de crudo y la receta especifica cocido, se aplica `yield_factor_cooked`. **Muestra siempre al usuario en qué estado está la cantidad.**
4. **Peso bruto vs neto.** La receta usa 100 g de plátano pelado; la lista de la compra debe pedir 156 g de plátano con piel (`edible_fraction = 0.64`). Confundir esto hace que las listas se queden cortas sistemáticamente.
5. **Escalado con límites.** `min_scale`/`max_scale` por receta. Algunas recetas no escalan de forma continua (huevos, latas). Marcar ingredientes `discrete_unit` que se redondean a enteros y absorbiendo el error en el escalado del resto.
6. **Presentación.** Redondeo inteligente: 156 g de plátano → "1 plátano grande"; 12,3 g de aceite → "1 cucharada". Muestra siempre unidad doméstica **y** gramaje ("2 cdas · 25 g"). Acepta fracciones en la entrada (`1 1/2`) y renderiza con glifos tipográficos.
7. **Métrico por defecto**, imperial como opción. Al revés que ETM.

## 5.4 Panel de nutrientes (`jsonb`)

MVP: 12 campos por 100 g. Ampliable sin migración gracias a jsonb.

```json
{
  "kcal": 165, "protein_g": 31.0, "carbs_g": 0, "fat_g": 3.6,
  "sat_fat_g": 1.0, "fiber_g": 0, "sugar_g": 0, "sodium_mg": 74,
  "cholesterol_mg": 85, "potassium_mg": 256, "calcium_mg": 15, "iron_mg": 1.0
}
```

Índices sobre expresiones para el filtrado del solver:
```sql
CREATE INDEX idx_recipe_kcal ON recipe (((nutrients_per_serving->>'kcal')::numeric));
CREATE INDEX idx_recipe_diet ON recipe USING GIN (diet_tags);
CREATE INDEX idx_recipe_allergen ON recipe USING GIN (allergen_tags);
```

---

# 6. El motor de planificación (núcleo técnico)

## 6.1 Formulación del problema

**Dado:**
- Un conjunto de slots $S = \{s_1, \dots, s_m\}$ (día, tipo de comida, cuota calórica relativa, comensales).
- Un catálogo de recetas $R$ filtrado por restricciones duras → pool $P \subseteq R$, con $|P| \approx 300\text{–}1500$.
- Targets por día $d$: $T_d = (T^{kcal}_d, T^{P}_d, T^{C}_d, T^{G}_d)$ con tolerancias, más $T^{fibra}_d$ (mínimo) y $T^{Na}_d$ (máximo).
- Despensa $\Pi$ con cantidades y caducidades, presupuesto semanal $B$, historial reciente $H$.

**Decidir:**
- Asignación $x_{s,r} \in \{0,1\}$: qué receta va en qué slot.
- Escala $\sigma_{s} \in [\ell_r, u_r]$: factor de porción continuo.

**Minimizar:**

$$
\underbrace{\sum_{d}\sum_{n \in N} w_n \cdot \left| \frac{A_{d,n} - T_{d,n}}{T_{d,n}} \right|}_{\text{error nutricional}}
+ \lambda \cdot \underbrace{|\mathcal{I}(\text{plan})|}_{\text{ingredientes únicos}}
+ \mu \cdot \underbrace{\max(0, C - B)}_{\text{exceso de presupuesto}}
$$
$$
- \gamma \cdot \underbrace{\text{cobertura de despensa}}_{\text{ponderada por caducidad}}
+ \nu \cdot \underbrace{\text{penalización de repetición}}_{\text{vs. últimos 21 días}}
- \rho \cdot \underbrace{\text{afinidad}}_{\text{likes / recurrentes}}
$$

**Sujeto a:** restricciones duras ya aplicadas en el filtrado del pool (dieta, alérgenos, tiempo máximo, electrodoméstico, bloqueos del usuario).

## 6.2 Por qué NO un MILP puro

Es tentador modelar todo como programación entera mixta con OR-Tools o Gurobi. **No lo hagas.** Razones concretas:

1. **Escala.** 1.500 recetas × 28 slots = 42.000 variables binarias, más 28 continuas, más big-M para vincular escala y selección, más variables auxiliares para contar ingredientes únicos (una binaria por ingrediente distinto, ~600 más). El modelo es resoluble pero tarda decenas de segundos a minutos. Inaceptable para una UX de re-roll instantáneo.
2. **Soluciones degeneradas.** El óptimo matemático de "acierta los macros al mínimo coste" es siempre el mismo: pechuga de pollo, arroz y aceite, siete días seguidos. La variedad y el placer no son expresables como restricción lineal sin hacks (y los hacks — límites de repetición, cuotas de categoría — hacen el modelo aún más lento).
3. **El re-roll necesita aleatoriedad.** Un solver determinista devuelve la misma solución. El usuario que pulsa "otra vez" espera algo distinto. Necesitas estocasticidad controlada, que es antinatural en MILP.
4. **La calidad es subjetiva y no lineal.** "Que este desayuno pegue con esta cena" no tiene formulación lineal.

Donde MILP/CP-SAT **sí** aporta: en la subestructura donde el problema es genuinamente combinatorio y pequeño — el ensamblado semanal con minimización de ingredientes únicos sobre un conjunto ya reducido de ~6 candidatos por día (6^7 = 280k combinaciones). Ahí CP-SAT resuelve en <1 s. Opcional, no obligatorio.

## 6.3 Arquitectura recomendada: dos etapas + ensamblado

### Idea central

**La selección y el porcionado son problemas distintos y deben resolverse por separado.**

- El **escalado continuo** ya resuelve la *magnitud* (calorías). Multiplicar una receta por 1.3 arregla las kcal.
- Lo que el escalado **no** puede arreglar es la *composición*. Si necesitas 40% de calorías de proteína y la receta aporta 12%, ningún factor de escala lo soluciona.

Por tanto: **la selección debe emparejar por composición normalizada de macros; el porcionado se resuelve después, exactamente, con programación lineal.**

### Etapa A — Selección (heurística, estocástica)

Para cada slot, se calcula el vector de macros objetivo residual y se normaliza. Cada receta tiene precalculado su `macro_unit_vector`. La distancia relevante es **coseno sobre el vector de fracciones calóricas de proteína/carbohidrato/grasa** — invariante a escala, que es exactamente la propiedad que necesitamos.

Sobre esa distancia se aplican los demás términos del score (coste, despensa, repetición, afinidad) y se muestrea con **selección softmax con temperatura** en lugar de tomar el máximo. La temperatura es el mando de variedad: baja = planes óptimos y repetitivos, alta = planes variados y menos precisos. **Exponla al usuario como "variedad" — es un control que ETM no ofrece.**

### Etapa B — Porcionado (LP exacto, óptimo)

Con las recetas del día ya fijadas (típicamente 3-5 items), el problema de encontrar las porciones óptimas es un **programa lineal de goal programming con norma L1**, con ~5 variables de escala y ~8 variables de holgura. Se resuelve en microsegundos.

$$
\min \sum_{n} w_n (u_n^+ + u_n^-) \quad \text{s.a.} \quad \sum_i \sigma_i a_{n,i} - u_n^+ + u_n^- = T_n, \quad \sigma_i \in [\ell_i, u_i], \quad u^\pm \ge 0
$$

Esto es **óptimo**, no heurístico. Es la parte del sistema que garantiza que los macros se cumplen tan bien como es matemáticamente posible dadas las recetas elegidas.

### Etapa C — Reparación

Si el error residual del LP supera el umbral, se identifica la receta que más contribuye al desequilibrio (la de mayor distancia composicional al residuo) y se sustituye. Máximo 3 iteraciones.

### Etapa D — Ensamblado semanal

Genera K candidatos por día (independientes), luego optimiza la combinación con búsqueda local / recocido simulado sobre el objetivo global que **sí incluye** el término de ingredientes únicos y el presupuesto. Esta etapa es la que produce listas de la compra cortas.

## 6.4 Pseudocódigo

```python
# ═══════════════════════════════════════════════════════════════
# ENTRADA
# ═══════════════════════════════════════════════════════════════
# ctx: perfil, targets/día, layout de slots, preferencias,
#      despensa, presupuesto, historial, seed

WEIGHTS = {"kcal": 3.0, "protein": 2.5, "carbs": 1.0, "fat": 1.0,
           "fiber": 0.5, "sodium": 0.3}

# ───────────────────────────────────────────────────────────────
# 0. POOL DE CANDIDATOS  (una vez por generación, cacheado)
# ───────────────────────────────────────────────────────────────
def build_pool(ctx):
    key = hash((ctx.diet, ctx.exclusions, ctx.appliances, ctx.max_time))
    if pool := cache.get(key):
        return pool

    pool = query("""
        SELECT id, nutrients_per_serving, macro_unit_vector,
               cost_cents_per_serving, unique_ingredient_count,
               perishable_ingredient_ids, meal_types, min_scale, max_scale
        FROM recipe
        WHERE status = 'published'
          AND diet_tags @> %(required)s
          AND NOT (allergen_tags && %(excluded_allergens)s)
          AND NOT (ingredient_ids && %(excluded_foods)s)
          AND prep_minutes + cook_minutes <= %(max_time)s
          AND (appliances && %(available)s OR appliances = '{}')
          AND id <> ALL(%(blocked)s)
    """, ctx)

    if len(pool) < MIN_POOL:                    # ← diagnóstico, no plan malo
        raise OverConstrained(analyze_binding_constraints(ctx))

    cache.set(key, pool, ttl=3600)
    return pool


# ───────────────────────────────────────────────────────────────
# 1. SCORE DE UN CANDIDATO PARA UN SLOT
# ───────────────────────────────────────────────────────────────
def score(recipe, slot, residual, ctx):
    # (a) ENCAJE COMPOSICIONAL — el término que de verdad importa.
    #     Comparamos fracciones calóricas, NO cantidades absolutas,
    #     porque el escalado de la etapa B arregla la magnitud.
    fit = cosine_similarity(recipe.macro_unit_vector,
                            normalize(residual.macro_vector))

    # (b) ENCAJE CALÓRICO — ¿el escalado necesario cae en rango?
    needed = residual.kcal * slot.kcal_share / recipe.kcal_per_serving
    scale_ok = 1.0 if recipe.min_scale <= needed <= recipe.max_scale \
                   else max(0.0, 1 - abs(clamp(needed, recipe) - needed))

    # (c) DESPENSA — bonus por ingredientes que ya tengo,
    #     ponderado por urgencia de caducidad
    pantry = sum(urgency(ctx.pantry[i])
                 for i in recipe.perishable_ingredient_ids
                 if i in ctx.pantry) / max(1, recipe.unique_ingredient_count)

    # (d) SOLAPE con lo ya comprado esta semana (lista corta)
    overlap = jaccard(recipe.ingredient_ids, ctx.week_ingredients_so_far)

    # (e) COSTE normalizado al presupuesto por comida
    cost_pen = max(0, recipe.cost_cents_per_serving - ctx.budget_per_meal) \
               / max(1, ctx.budget_per_meal)

    # (f) REPETICIÓN — decaimiento exponencial de 21 días
    rep_pen = sum(0.85 ** days_ago
                  for days_ago in ctx.history.get(recipe.id, []))

    # (g) AFINIDAD explícita del usuario
    aff = ctx.affinity.get(recipe.id, 0.0)

    return (4.0*fit + 2.0*scale_ok + 1.5*pantry + 1.2*overlap
            + 0.8*aff - 1.5*cost_pen - 2.0*rep_pen)


# ───────────────────────────────────────────────────────────────
# 2. ETAPA A — SELECCIÓN ESTOCÁSTICA POR SLOT
# ───────────────────────────────────────────────────────────────
def select_day(day, pool, ctx, rng, temperature):
    residual = day.targets.copy()
    chosen = []

    # Slots grandes primero: dominan el presupuesto nutricional
    for slot in sorted(day.slots, key=lambda s: -s.kcal_share):
        if slot.locked:
            chosen.append(slot.existing); residual -= slot.existing.nutrients
            continue

        cands = [r for r in pool if slot.meal_type in r.meal_types
                                 and r.id not in {c.id for c in chosen}]
        scored = [(r, score(r, slot, residual, ctx)) for r in cands]
        top    = nlargest(25, scored, key=itemgetter(1))

        # Muestreo softmax: variedad controlable, no argmax determinista
        pick = rng.choices([r for r, _ in top],
                           weights=softmax([s for _, s in top], temperature))[0]
        chosen.append(pick)
        residual -= pick.nutrients_per_serving   # aproximación a escala 1.0

    return chosen


# ───────────────────────────────────────────────────────────────
# 3. ETAPA B — PORCIONADO ÓPTIMO (LP, goal programming L1)
# ───────────────────────────────────────────────────────────────
def solve_portions(recipes, targets):
    """
    Variables : sigma_i  (escala por receta)
                u_n+, u_n- (desviación por nutriente)
    Objetivo  : min  SUM_n w_n * (u_n+ + u_n-)
    Restr.    : SUM_i sigma_i * a[n][i] - u_n+ + u_n- = T_n
                lo_i <= sigma_i <= hi_i ;  u_n+, u_n- >= 0
    Tamaño    : ~5 vars de escala + ~12 de holgura -> < 1 ms con HiGHS
    """
    n_r, nutrients = len(recipes), list(WEIGHTS)
    lp = LinearProgram()

    sigma = [lp.var(lb=r.min_scale, ub=r.max_scale) for r in recipes]
    up    = {n: lp.var(lb=0) for n in nutrients}
    un    = {n: lp.var(lb=0) for n in nutrients}

    for n in nutrients:
        lp.constraint(
            sum(sigma[i] * recipes[i].nutrients[n] for i in range(n_r))
            - up[n] + un[n] == targets[n]
        )
    # Restricciones asimétricas: sodio solo penaliza por exceso,
    # fibra solo por defecto
    lp.constraint(un["sodium"] == 0)
    lp.constraint(up["fiber"]  == 0)

    lp.minimize(sum(WEIGHTS[n] * (up[n] + un[n]) / max(1, targets[n])
                    for n in nutrients))

    sol = lp.solve()          # HiGHS
    return [sol[s] for s in sigma], sol.objective


# ───────────────────────────────────────────────────────────────
# 4. ETAPA C — REPARACIÓN
# ───────────────────────────────────────────────────────────────
def generate_day(day, pool, ctx, rng, temperature=0.7):
    best = None
    for attempt in range(3):
        recipes = select_day(day, pool, ctx, rng, temperature)
        scales, err = solve_portions(recipes, day.targets)

        if best is None or err < best.err:
            best = Candidate(recipes, scales, err)
        if err <= ctx.error_threshold:
            break

        # Sustituye la receta que más desequilibra la composición
        worst = argmax(recipes, key=lambda r: composition_distance(r, day.targets))
        pool_local = [r for r in pool if r.id != worst.id]
        pool = pool_local
    return best


# ───────────────────────────────────────────────────────────────
# 5. ETAPA D — ENSAMBLADO SEMANAL (lista de la compra corta)
# ───────────────────────────────────────────────────────────────
def generate_week(ctx, seed):
    rng, pool = Random(seed), build_pool(ctx)

    # K candidatos independientes por día (paralelizable)
    K = 6
    cands = {d: [generate_day(d, pool, ctx, rng) for _ in range(K)]
             for d in ctx.days}

    def global_cost(combo):
        nutri  = sum(c.err for c in combo.values())
        ingr   = len(set().union(*(c.ingredient_ids for c in combo.values())))
        cost   = sum(c.cost for c in combo.values())
        recipes= [r.id for c in combo.values() for r in c.recipes]
        rep    = len(recipes) - len(set(recipes))
        return (nutri
                + LAMBDA * ingr                       # ← lista corta
                + MU * max(0, cost - ctx.budget)      # ← presupuesto
                + NU * rep)                           # ← variedad

    # Arranque greedy + recocido simulado
    combo = {d: cands[d][0] for d in ctx.days}
    cur   = global_cost(combo)
    T     = 1.0
    for _ in range(400):
        d   = rng.choice(ctx.days)
        alt = rng.choice(cands[d])
        old, combo[d] = combo[d], alt
        new = global_cost(combo)
        if new < cur or rng.random() < exp((cur - new) / T):
            cur = new
        else:
            combo[d] = old
        T *= 0.99

    return Plan(combo, seed=seed, version=GENERATOR_VERSION)
```

## 6.5 Rendimiento

**Presupuestos objetivo (p95):**

| Operación | Objetivo | Cómo se consigue |
|---|---|---|
| Re-roll de una comida | < 120 ms | Pool cacheado + LP de 5 vars + sin ensamblado |
| Generar un día | < 300 ms | 3 intentos × (selección + LP) |
| Generar una semana | < 2.5 s | 42 días-candidato en paralelo + 400 iteraciones de SA |
| Alternativas para un slot | < 200 ms | Top-25 del pool, LP por cada uno |

**Técnicas concretas:**

1. **Denormalización agresiva.** `macro_unit_vector`, `cost_cents_per_serving`, `unique_ingredient_count` y `perishable_ingredient_ids` precalculados en la fila de `recipe`. Cero JOINs durante la generación.
2. **Pool en memoria.** 5.000 recetas × ~250 B = 1,25 MB. Cabe entero en el proceso. Recárgalo en caliente cada N minutos o por evento de invalidación. La generación **nunca** toca la base de datos.
3. **Vectorización.** El scoring de 1.500 candidatos es un producto matriz-vector. Con NumPy son ~200 µs; en un bucle Python, 40 ms. Diferencia de 200×.
4. **Caché del pool filtrado** por hash de (dieta, exclusiones, electrodomésticos, tiempo máximo). La mayoría de usuarios comparten configuraciones. TTL 1 h, invalidación por publicación de recetas.
5. **Paralelismo.** Los K×7 candidatos de día son independientes. `ProcessPoolExecutor` o `asyncio` + workers.
6. **HiGHS, no PuLP+CBC.** El overhead de escribir/leer ficheros LP de CBC domina el tiempo en problemas pequeños. HiGHS vía `highspy` o `scipy.optimize.linprog(method="highs")` resuelve en memoria.
7. **Generación asíncrona para la semana.** La semanal corre en cola (job) con notificación push/email, igual que ETM. La diaria es síncrona.
8. **Determinismo.** Guarda `seed` + `generator_version` en el plan. Permite reproducir bugs y hacer A/B de versiones del algoritmo sobre planes históricos.

## 6.6 Extensiones previstas (diseño, no implementación MVP)

- **Batch cooking:** en la etapa D, permitir que un candidato marque un `batch_group` que ocupa N slots con la misma receta escalada ×N. La penalización de repetición se desactiva dentro del grupo. Restricción adicional: los slots deben caer dentro de la ventana de conservación de la receta.
- **Despensa-primero real:** ejecutar una primera pasada con $\gamma$ (peso de despensa) muy alto y tolerancias de macro relajadas, luego una segunda con los pesos normales. Presentar al usuario como "modo vaciar nevera".
- **Multi-persona:** targets distintos por comensal sobre la misma receta. Formulación: la receta se elige para el hogar, pero cada persona tiene su propio $\sigma$. Requiere que el LP tenga una variable de escala por (receta × persona). Sigue siendo pequeño.

---

# 7. Fuente de datos nutricionales

## 7.1 Decisión: base propia ingerida por lotes, no API en runtime

Igual que ETM, y por las mismas razones: latencia (el solver evalúa miles de recetas), coste (llamadas por request son inviables), disponibilidad (dependencia crítica de un tercero) y control (necesitas campos derivados como `edible_fraction` o `aisle_id` que ninguna API proporciona).

## 7.2 Recomendación principal

### Ingredientes genéricos (la base del solver)

**USDA FoodData Central — Foundation Foods + SR Legacy + FNDDS.**

| Aspecto | Detalle |
|---|---|
| Licencia | **Dominio público** (obra del gobierno de EE.UU.). Uso comercial libre, sin atribución obligatoria (aunque es buena práctica) |
| Coste | 0 € |
| Acceso | Descargas masivas en CSV/JSON desde el portal FDC. API con key gratuita en api.data.gov (~1.000 req/h) — úsala solo para actualizaciones incrementales |
| Cobertura | ~8.000 alimentos base con panel de hasta 150 nutrientes, incluidos aminoácidos y ácidos grasos individuales |
| Pega | Nombres y alimentos con sesgo estadounidense. Requiere **traducción y curación** para el mercado español |

**Complemento europeo: CIQUAL (ANSES, Francia)** bajo *Licence Ouverte / Etalab 2.0*, que permite reuso comercial con atribución. ~3.185 alimentos con composición europea y nombres más cercanos a la dieta mediterránea. *[Verificar la versión vigente de la licencia antes de usar.]*

**BEDCA (España)**: la más adecuada culturalmente, pero su licencia de uso es restrictiva y no está claramente habilitada para explotación comercial. *[Requiere consulta legal / solicitud de permiso antes de incorporarla.]* No la incluyas en el MVP.

### Productos de marca (v1, no MVP)

**Open Food Facts.**

| Aspecto | Detalle |
|---|---|
| Licencia | Base de datos bajo **ODbL 1.0**; imágenes bajo CC BY-SA |
| Coste | 0 € |
| Cobertura | Millones de productos, con **excelente cobertura española y europea** (mucho mejor que USDA Branded para tu mercado). Códigos de barras incluidos |
| Riesgo | ODbL tiene cláusula de **share-alike sobre bases de datos derivadas**. Servir un plan de comidas es un "Produced Work" (requiere aviso de atribución, no share-alike), pero *distribuir* tu base de datos derivada sí obligaría a publicarla bajo ODbL |

> **Esto es lo más importante de esta sección:** mantén la base OFF en un **espacio de nombres separado** de tu catálogo curado (columna `source`, tablas o esquemas distintos). Si mezclas OFF con datos propietarios en una sola tabla, corres el riesgo de que el conjunto entero se considere derivado y quede sujeto a ODbL. Consulta con un abogado especializado antes de lanzar con OFF integrado. Por eso está en v1, no en MVP.

### Calidad de datos: no es opcional

OFF y, en menor medida, USDA Branded contienen datos introducidos por usuarios con errores groseros (kcal que no cuadran con macros, cantidades en unidades equivocadas). Pipeline de validación obligatorio:

```
kcal_calculadas = 4·P + 4·C + 9·G + 7·alcohol + 2·fibra
if |kcal_declaradas − kcal_calculadas| / kcal_declaradas > 0.20 → cuarentena
if P + C + G + agua + ceniza > 105 g por 100 g → cuarentena
if cualquier macro < 0 o > 100 → rechazo
```

Solo los alimentos que pasan validación entran en el pool del solver. Los demás quedan disponibles para tracking manual con aviso.

## 7.3 Plan B

**Si USDA se vuelve inaccesible o insuficiente:**

| Opción | Licencia/coste *[verificar precios actuales]* | Cuándo usarla |
|---|---|---|
| **CIQUAL en solitario** | Etalab 2.0, gratis | Suficiente para un MVP europeo. ~3.000 alimentos cubren el 95% de las recetas caseras |
| **FatSecret Platform API** | Tier básico gratuito con límites; tiers de pago | Buena cobertura internacional, incluye España |
| **Nutritionix** | De pago, por volumen | Fuerte en restaurantes de EE.UU. Poco útil para España |
| **Edamam Food Database** | Tier gratuito limitado + planes de pago | Correcta, pero condiciones de reuso de datos restrictivas: **léelas con cuidado** si vas a persistir los datos |
| **Spoonacular** | De pago por request | Incluye recetas, pero **su licencia prohíbe construir un producto competidor de recetas**. Evítala como fuente estructural |

**Regla de arquitectura defensiva:** aísla la fuente detrás de una interfaz `NutritionSource` con `search()`, `getById()`, `getNutrients()`. Persiste `source` + `source_ref` en cada fila. Cambiar de proveedor debe ser un job de reingesta, no una refactorización.

## 7.4 Estrategia de recetas (la partida más cara y el verdadero activo)

**No existe una fuente libre y comercialmente usable de recetas de calidad con datos nutricionales.** Esto es un hecho incómodo del mercado y hay que planificarlo como una inversión, no como una integración.

### Qué NO hacer
- **No scrapear sitios de recetas.** Aunque la lista de ingredientes como tal tiene protección débil por derecho de autor, los pasos redactados, las fotos y la selección/estructura de la base sí están protegidos, y los ToS lo prohíben. En la UE, además, existe el **derecho *sui generis* del fabricante de bases de datos** (Directiva 96/9/CE), que protege la extracción sustancial de una base **con independencia de la originalidad de su contenido**. Es un riesgo legal directo y evitable.
- **No usar la API de ETM ni extraer su catálogo.** Sus Términos de Servicio prohíben explícitamente el scraping y compilar datos "usables por un producto o servicio competitivo". Es la vía más rápida a una demanda.
- **No publicar recetas generadas por LLM sin revisión humana.** Riesgo de proporciones absurdas, tiempos imposibles y — grave — errores de seguridad alimentaria.

### Qué SÍ hacer: producción propia asistida

```
1. DEFINIR el esqueleto del catálogo (matriz de cobertura)
   6 dietas × 4 tipos de comida × 3 niveles de tiempo × 4 perfiles de macro
   → identifica los ~90 huecos que el solver necesita cubrir
   Prioriza por: cobertura de macros extremos (alta proteína/baja grasa
   es el hueco crítico) y por versatilidad de ingredientes

2. GENERAR borradores con LLM con salida estructurada
   Prompt con: ingredientes del catálogo YA existente (fuerza reutilización,
   que es lo que acorta la lista de la compra), rango de macros objetivo,
   tiempo, técnica, nº de ingredientes MÁXIMO (≤8)
   Coste: céntimos por receta

3. CALCULAR nutrición desde la base de ingredientes (nunca del LLM)
   El LLM propone ingredientes y cantidades; los nutrientes salen de tu BD

4. VALIDAR automáticamente
   - kcal por ración en rango razonable
   - macros consistentes
   - todos los ingredientes existen en el catálogo y son comprables
   - tiempo total coherente con los pasos

5. REVISAR con dietista titulada (freelance, ~€15-25/h)
   Debe firmar la revisión. Trazabilidad en `reviewed_by`.
   Ritmo realista: 15-25 recetas/hora de revisión

6. FOTOGRAFIAR
   Opción A: sesión propia por lotes (~€8-15/receta con food stylist)
   Opción B: fotos generadas por IA — MÁS BARATO PERO OJO:
     · verifica los términos del proveedor sobre uso comercial
     · en la UE, la Directiva de prácticas comerciales desleales
       puede afectar si la imagen no representa el producto real
     · recomendación: IA para v0 de catálogo interno, foto real
       para las recetas que aparecen en marketing/SEO
   Opción C: stock con licencia comercial (Pexels/Unsplash) — genérico,
       no coincide con la receta. Aceptable como fallback

7. ITERAR con señal de uso
   Las recetas con muchos re-rolls o "no me gusta" se retiran o rehacen
```

**Presupuesto realista para 400 recetas de MVP:**

| Partida | Estimación |
|---|---|
| Generación LLM + tooling | 150 - 400 € |
| Revisión dietista (~20 h) | 300 - 500 € |
| Fotografía (IA/mixta) | 500 - 2.500 € |
| Tiempo propio de curación y carga | 60 - 100 h |
| **Total en efectivo** | **~1.000 - 3.500 €** |

Es la inversión más rentable del proyecto: el catálogo es tu activo diferencial, es propietario, y mejora con el uso. **Empieza a construirlo el día 1, en paralelo al desarrollo, no después.**

### Cuántas recetas necesitas realmente

Cálculo mínimo: 4 semanas sin repetición notable × 3 comidas × 7 días = 84 recetas distintas **por perfil de dieta**. Con 6 dietas y solapamiento (una receta vegana sirve también a vegetarianos y a "cualquier cosa"), 350-450 recetas dan cobertura suficiente para el MVP. Por debajo de 250, la repetición aparece en la semana 2 y matas la retención. Por encima de 800 no notas mejora hasta que no tienes filtros muy específicos.

---

# 8. Stack recomendado

## 8.1 Recomendación

| Capa | Elección | Justificación específica para *esta* app |
|---|---|---|
| **Frontend + marketing** | **Next.js 15 (App Router) + TypeScript + Tailwind CSS** | La adquisición es SEO programático: necesitas cientos de landings server-rendered e ISR (`/plan/{kcal}/{dieta}`, `/alimentos/{slug}`). Next hace SSR/ISR y SPA en el mismo proyecto. Route groups `(marketing)` estático y `(app)` cliente. Evitas el desdoblamiento de ETM en dos builds |
| **UI** | Componentes propios sobre **Radix UI primitives** + Tailwind | Radix da accesibilidad (focus trap, ARIA, teclado) sin imponer estética. **No uses una librería con look reconocible**: el diseño debe ser propio |
| **Estado servidor** | **TanStack Query** | Cachés stale-while-revalidate, invalidación optimista para el re-roll, sincronización entre pestañas. Es lo que ETM implementó a mano con BroadcastChannel |
| **API CRUD** | **Route Handlers de Next + tRPC** (o REST si prefieres) | tRPC da tipos end-to-end sin generación de código. Reduce bugs de contrato, que en un modelo de datos con 20 entidades son constantes |
| **ORM** | **Drizzle ORM** | SQL-first, tipado, migraciones legibles. Prisma es más cómodo pero su capa de query genera SQL subóptimo y aquí hay agregaciones pesadas (lista de la compra) |
| **Motor de planificación** | **Servicio Python separado: FastAPI + NumPy + HiGHS (`highspy` o `scipy.optimize.linprog`) + OR-Tools CP-SAT (opcional, etapa D)** | **La decisión técnica más importante.** El ecosistema de optimización numérica de Python no tiene equivalente en JS. NumPy vectoriza el scoring 200×. HiGHS es el mejor LP libre. Aislarlo como servicio permite escalarlo, versionarlo y perfilarlo independientemente del CRUD |
| **Base de datos** | **PostgreSQL 16** (Neon o Supabase, **región EU**) | Relacional puro con agregaciones complejas. `jsonb` para paneles de nutrientes extensibles sin migración. Arrays + GIN para tags de dieta/alérgenos. `tsvector` para búsqueda en español con stemming. `pgvector` disponible para similitud de recetas en v1. Neon da branching de BD (test con datos reales) y escala a cero |
| **Colas / jobs** | **Inngest** o **Trigger.dev** | Generación semanal, emails, reingesta de datos nutricionales, recálculo de denormalizados. Serverless-friendly, retries y observabilidad incluidos. Evitas montar Redis+BullMQ+worker en el MVP |
| **Auth** | **Supabase Auth** (si BD en Supabase) o **Auth.js** | Magic link + Google + Apple. Apple Sign-In será obligatorio cuando publiques en App Store. Evita Clerk en el MVP: su precio por MAU escala mal en freemium con muchos usuarios gratuitos |
| **Pagos** | **Stripe** (Checkout + Billing + Customer Portal + **Stripe Tax**) | Stripe Tax resuelve el IVA europeo por país (OSS), que es obligatorio para servicios digitales B2C en la UE y es un dolor real. Cuando llegue la app móvil: **RevenueCat** para unificar IAP de Apple/Google con Stripe |
| **Imágenes** | **Cloudflare R2** + `next/image` | R2 no cobra egress, que domina el coste con catálogos de fotos |
| **Email** | **Resend** (transaccional) + plantillas React Email | El email semanal con el plan y la lista es un mecanismo de retención de primer orden |
| **Observabilidad** | **Sentry** (errores) + **PostHog** (producto, EU cloud) | PostHog en su región EU evita transferencias internacionales de datos de comportamiento |
| **Hosting** | Next en **Vercel**; servicio Python en **Fly.io** o **Railway**, región `cdg`/`mad`; BD **Neon EU** | |
| **Móvil (v1)** | **Expo (React Native)** compartiendo tipos y cliente API vía monorepo | |

## 8.2 Por qué un servicio Python separado (y no todo en TypeScript)

Es la única complejidad arquitectónica que recomiendo asumir en el MVP, y merece justificación:

1. **Ecosistema numérico.** NumPy/SciPy/HiGHS/OR-Tools no tienen equivalente serio en JavaScript. `glpk.js` y `highs-js` (WASM) existen pero son órdenes de magnitud más lentos y peor mantenidos. El scoring vectorizado de 1.500 candidatos es la operación caliente del producto.
2. **Perfil de recursos distinto.** El solver es CPU-bound con picos de segundos. El CRUD es I/O-bound. Escalarlos juntos desperdicia dinero y produce timeouts en serverless. El solver quiere una máquina con CPU dedicada; la API quiere edge.
3. **Frontera de versionado limpia.** El motor evolucionará mucho más rápido que el modelo de datos. Un contrato HTTP versionado (`POST /v1/plan/generate`) permite desplegar y hacer A/B del algoritmo sin tocar la app.
4. **Coste del acoplamiento: bajo.** Un solo endpoint síncrono para día/alternativas y uno asíncrono para semana. Contrato definido con Pydantic + tipos TS generados desde el JSON Schema.

**Cuándo NO hacerlo:** si eres un desarrollador solo, sin experiencia en Python, y el time-to-market pesa más que la calidad del solver. En ese caso, ve al plan alternativo.

## 8.3 Alternativa: monolito TypeScript

| Capa | Elección |
|---|---|
| Todo | **Next.js + TypeScript**, solver incluido como módulo del servidor |
| LP | `highs-js` (WASM) o resolución analítica: para ≤5 recetas, el LP L1 puede resolverse con mínimos cuadrados con restricciones de caja mediante proyección iterativa, en TS puro |
| Cómputo pesado | Route handlers en runtime Node (no Edge) + jobs en Inngest |
| BD/Auth | Supabase (Postgres + Auth + Storage en un proveedor) |
| Hosting | Vercel + Supabase EU |

**Ventajas:** un lenguaje, un despliegue, un repo, un tipo de test. Time-to-market 3-4 semanas menor. Menor carga cognitiva para un equipo de 1-2 personas.
**Desventajas:** el solver será más lento (estimo 3-8× en el scoring) y más difícil de mejorar. Con catálogos <2.000 recetas y usuarios <10.000, probablemente **no lo notarás**. Es una alternativa perfectamente legítima para validar.

**Tercera opción, para completar:** Django + Django-Ninja + Celery, todo en Python, con frontend Next separado. Es lo que hizo ETM (Django) y funciona, pero pagas el coste de dos repos y pierdes el tipado end-to-end.

## 8.4 Coste de infraestructura estimado *[verificar precios actuales]*

| Fase | Componentes | Coste/mes |
|---|---|---|
| Desarrollo (mes 0-3) | Neon free/launch, Fly.io shared-cpu-1x, Vercel Hobby→Pro, R2, Resend free | **20 - 40 €** |
| Lanzamiento (<2.000 usuarios) | Neon Launch, Fly 1×shared-2x, Vercel Pro, Sentry Team, PostHog free tier, Resend | **90 - 160 €** |
| Tracción (10-20k usuarios, ~1k pagando) | Neon Scale, Fly 2× dedicated-1x, Vercel Pro, PostHog paid, Sentry | **350 - 700 €** |

Con 1.000 suscriptores a 49 €/año ≈ 4.080 €/mes de ingresos brutos, la infraestructura es el 10-17%. Sostenible. La partida dominante seguirá siendo tu tiempo y la producción de recetas.

---

# 9. Diseño y UX

> **Restricción explícita: no se replica el sistema visual de Eat This Much.** Nada de su paleta, sus tokens, su tipografía de sistema sin personalidad, ni sus textos. Lo que sí se toma son *principios de interacción* observados, que son ideas de dominio público sobre cómo se estructura la información de un plan de comidas.

## 9.1 Principios de diseño

1. **Resultado antes que formulario.** El usuario ve un plan real antes de crear una cuenta y antes de configurar nada. Cada pantalla adicional antes del primer resultado es una pérdida medible de conversión.
2. **El día es la unidad de consumo, no el plato.** A diferencia de una app de recetas (una receta enorme por pantalla), aquí la vista por defecto debe permitir leer un día completo de un vistazo. La receta es un detalle al que se entra, no la pantalla principal.
3. **Editar cuesta lo mismo que generar.** Si el usuario va a corregir el 30% del plan, la UI de swap/lock/mover es tan crítica como el algoritmo. Todas las acciones de edición: un tap, sin navegación, sin modal bloqueante.
4. **Tres capas de profundidad para los datos nutricionales** (ver §9.3).
5. **Honestidad sobre la incertidumbre.** "48-56 €" en lugar de "51,34 €". "≈ 2.140 kcal" cuando hay estimación. La falsa precisión destruye confianza en cuanto el usuario compara con la realidad.
6. **La automatización siempre tiene salida.** Nada generado es inmutable. Lock, swap, alternativas, edición manual, desactivar el generador. Este es el principio no negociable de cualquier producto algorítmico.
7. **Explicar los fallos, no ocultarlos.** Cuando el solver no llega, di qué restricción ata y ofrece tres salidas concretas.
8. **Densidad media, no máxima.** La comida es una categoría emocional. Fotos grandes en la ficha de receta y en las alternativas; densidad alta solo en lista de la compra y vista semanal.

## 9.2 Dirección visual propia (sugerida, no prescriptiva)

- **Paleta base:** neutro cálido (crema/papel) en claro, gris cálido profundo en oscuro. Un único color de acento **de marca** para acciones primarias. Evita deliberadamente el verde-menta clínico de las apps de salud y el coral de ETM.
- **Colores semánticos de macro:** tres tonos fijos, aprendidos una vez, usados en todo el producto sin leyenda. Requisitos: (a) distinguibles en deuteranopia y protanopia — verifícalo con un simulador; (b) ninguno debe coincidir con el acento de marca ni con los estados de error/éxito; (c) funcionar en claro y oscuro. Elige tú los tonos concretos; no reutilices los de ningún competidor.
- **Tipografía:** una fuente variable con carácter para títulos (Inter Display, Instrument Sans, Söhne, Geist — según licencia y presupuesto) y números tabulares obligatorios (`font-variant-numeric: tabular-nums`) para todas las cifras nutricionales y de precio. Sin números tabulares, las columnas de gramos bailan y se ven amateur.
- **Radios y sombras:** radios medios (8-12 px) para dar calidez sin parecer un juguete. Sombras reservadas a elementos flotantes (popovers, diálogos, drag). Las tarjetas de comida se separan por fondo, no por sombra.
- **Modo oscuro desde el día 1.** Se usa en la cocina y de noche. Retrofitearlo cuesta el triple.
- **Movimiento:** transiciones de 120-180 ms. Una micro-interacción con personalidad en el estado de generación (es el momento en que el usuario mira y no puede hacer nada) — pero propia, no un homenaje a nada existente.

## 9.3 Presentación de datos nutricionales: tres capas

Este es el patrón de dominio más importante y aplica a cualquier producto de nutrición.

**Capa 1 — Narrativa (para el 80% de usuarios).** Una frase en lenguaje natural con la conclusión, no el dato: *"Esta comida cubre el 34% de tus calorías del día y aporta 42 g de proteína."* El usuario casual no quiere una tabla, quiere saber si va bien.

**Capa 2 — Visual (para el usuario que revisa).** Barra segmentada de macros con los tres colores semánticos, valores absolutos y objetivo. **Barra apilada, no donut**: la barra permite comparar contra el objetivo (una marca en el eje) y funciona en anchos pequeños, el donut no. Regla: si el gráfico necesita leyenda, ha fallado — etiqueta dentro o al lado.

**Capa 3 — Referencia (para el usuario obsesivo).** Tabla completa, colapsada por defecto, accesible con un tap. Aquí conviene **usar el formato de etiqueta nutricional que el usuario ya sabe leer** — en la UE, la tabla del Reglamento 1169/2011 (valor energético, grasas, de las cuales saturadas, hidratos, de los cuales azúcares, fibra, proteínas, sal) por 100 g **y** por ración. No inventes una visualización propia para datos exhaustivos.

## 9.4 Pantallas y patrones necesarios

| Pantalla | Patrones clave |
|---|---|
| **Landing / generador público** | Formulario conversacional en línea (campos numéricos embebidos en una frase). Segmented control tipo píldora para elecciones ≤4 opciones (objetivo, sexo, unidades). Resultado inline, sin navegación |
| **Onboarding** | Máximo 4 pantallas, indicador de progreso honesto, todos los campos con valores por defecto sensatos. Microcopy que calibra expectativas en el punto exacto del sesgo (nivel de actividad) |
| **Plan — vista día** | Jerarquía Día → Comida → Item. Cada nivel con su total calórico alineado a la derecha, en números tabulares. Foto pequeña por receta. Barra de macros del día fija arriba. Acciones por item reveladas en hover **y `:focus-within`** (sin `:focus-within` el patrón es inaccesible por teclado) |
| **Plan — vista semana** | Grid 7 columnas en escritorio, carrusel de días en móvil. Densidad alta: solo título + kcal. Coste total y contador de ingredientes únicos en la cabecera — **son las métricas diferenciales, hazlas visibles** |
| **Panel de alternativas** | Se abre lateral (no modal a pantalla completa), 6 opciones con foto, delta de kcal/macros vs. la actual, badge "usas lo que tienes en casa", coste. Nunca oculta el plan |
| **Ficha de receta** | Foto grande, tiempo, dificultad, ingredientes con **doble unidad simultánea** ("2 cdas · 25 g"), selector de raciones que recalcula en vivo, pasos numerados, modo cocina (pantalla siempre encendida, tipografía grande, un paso a la vez) |
| **Lista de la compra** | Agrupada por sección de supermercado, orden configurable. Por línea: nombre, formato de compra real, cantidad, precio estimado, checkbox grande (target táctil ≥44 px). Tap en el ítem → "para qué es". Modo compra: alto contraste, sin distracciones, funciona offline |
| **Despensa** | Lista simple con caducidad y semáforo. Acción masiva "mover comprado a despensa". Botón "cocinar con lo que tengo" — es el gancho emocional |
| **Progreso** | Peso con media móvil de 7 días (nunca el dato crudo). Adherencia (% de comidas seguidas). Gasto semanal vs. presupuesto. **Nada de rachas agresivas ni gamificación culpabilizadora** |
| **Ajustes** | Agrupados por intención, no por entidad técnica. Evita el problema de ETM ("Meal Layout" vs "Meal Settings"): nómbralos por lo que el usuario quiere lograr — "Cuándo como", "Qué evito", "Cuánto quiero gastar" |
| **Estado de sobre-restricción** | Pantalla dedicada, no un toast. Muestra la restricción que ata, cuántas recetas quedan, y tres botones de acción concreta |

## 9.5 Accesibilidad (mínimos no negociables)

- Primitivas HTML nativas siempre que existan: `<details>` para acordeones, `<dl>` para pares etiqueta-valor, `<fieldset>/<legend>` para grupos de radios, tablas reales con `scope`.
- `:focus-visible` en todo elemento interactivo, incluidas las acciones reveladas en hover.
- Objetivos táctiles ≥44×44 px (ETM se queda en 40 px — no copies ese error).
- Contraste AA mínimo; AAA en las cifras nutricionales.
- `prefers-reduced-motion` respetado.
- Drag & drop **siempre** con alternativa por menú contextual y por teclado. El drag es un atajo, nunca el único camino.
- El gráfico de macros **no se oculta en móvil** (error de ETM): se transforma en barra horizontal compacta. Es justo donde más se necesita.

---

# 10. Modelo de negocio

## 10.1 Estructura de precios recomendada

| Tier | Precio | Contenido |
|---|---|---|
| **Gratis** | 0 € | Plan de **hasta 3 días** rodantes · Tracking completo · Todas las dietas · Exclusiones · 1 plan guardado · Calculadoras · Lista de la compra **solo de esos 3 días, sin optimizar ni agrupar** |
| **Plus** | **4,99 €/mes con anual (49 €/año)** · 9,99 €/mes suelto | Semana completa (hasta 14 días) · **Lista de la compra optimizada** (agrupada, con formatos de compra y coste) · Despensa · Presupuesto en euros · Layout por día de la semana · 20 planes guardados · Email semanal · PDF/export · Batch cooking *(v1)* · Hogar hasta 4 personas *(v1)* |
| **Pro** *(v2, no antes)* | 39-59 €/mes | Multi-cliente, marca propia, permisos, notas |

**Decisiones y su porqué:**

- **3 días gratis, no 1 (como ETM).** Un solo día no permite experimentar el valor real —que es la logística de la semana— y produce una experiencia gratuita frustrante. Tres días permiten ver una lista de la compra pequeña real, entender el producto, y aun así sentir con claridad que falta la semana. Es una hipótesis a testear: mide activación a 7 días y conversión a 30 días contra la variante de 1 día.
- **La lista de la compra optimizada es el paywall más fuerte**, no la semana. Es tu diferenciador y es exactamente donde ETM falla. El usuario gratuito ve la lista cruda (una lista de ingredientes sin agrupar ni convertir a envases) y la de pago ve la lista útil. La diferencia es autoevidente y no necesita explicación.
- **Anclaje anual agresivo (49 € vs 120 €).** El ratio 2,4× empuja al anual, que es lo que sostiene el negocio en una categoría con churn estacional brutal (enero-marzo concentra el grueso de las altas y el abandono llega en abril).
- **Precio en euros, con localización por país vía Stripe.** IVA gestionado con Stripe Tax + registro OSS. En LatAm, precios ajustados por paridad de poder adquisitivo (aproximadamente 40-60% del precio EU).
- **Trial de 7 días con tarjeta**, no 14. Trials largos en categorías de hábito diluyen la urgencia. Alternativa a testear: sin trial, con **garantía de devolución de 30 días sin preguntas** (reduce fricción de entrada sin diluir urgencia y, según la experiencia de la categoría, la tasa de reembolso real es baja).

## 10.2 Estrategia de conversión

**El momento de conversión no es un banner: es una carencia estructural.** Diseña estos tres momentos:

1. **Día 3, al agotar el plan gratuito.** No un paywall genérico: una pantalla que muestre la semana ya generada, difuminada, con el coste total y el número de ingredientes visibles. *"Tu semana está lista: 47 € y 31 ingredientes. Desbloquéala."* Enseñar el resultado, no la feature.
2. **Al pulsar "Lista de la compra" en gratuito.** Muestra la lista cruda real (no la bloquees) y al lado el "antes/después": la misma lista agrupada por sección, con formatos de envase y precio. La diferencia visual hace todo el trabajo.
3. **Al añadir el tercer ítem a despensa.** El usuario que empieza a inventariar ha comprado la premisa del producto.

**Palancas complementarias:**
- **Email semanal con el plan y la lista** (a los de pago) es la principal herramienta de retención. A los gratuitos, un resumen semanal con "esto es lo que te habríamos planificado".
- **Referidos bidireccionales**: un mes gratis para ambos. Barato, y con la ventaja de que los referidos convierten mejor.
- **Winback estacional**: campaña en la primera semana de enero y en la de septiembre (los dos picos de la categoría).
- **Precio de recuperación de churn**: al cancelar, ofrecer pausa de 1-3 meses antes que descuento. La pausa retiene mejor que el descuento y no canibaliza precio.

## 10.3 Métricas de negocio a instrumentar desde el día 1

| Métrica | Definición | Objetivo orientativo |
|---|---|---|
| Activación | % de registrados que generan una semana completa en 48 h | > 45% |
| Time-to-first-plan | Desde landing hasta primer plan visible | < 60 s |
| **Adherencia semana 1** | % de comidas planificadas marcadas como consumidas | > 50% |
| **Retención D30 / D90** | Usuarios activos a 30 y 90 días | **La métrica que decide si el negocio existe.** No hay dato público de ETM |
| Conversión free→paid a 30 días | | 3-6% (rango típico del sector) |
| Churn mensual de pago | | < 6% mensual en anual, < 12% en mensual |
| **Re-rolls por plan** | Media de regeneraciones antes de aceptar | **Proxy inverso de calidad del solver.** > 4 = el algoritmo falla |
| **Ingredientes únicos por semana** | | < 35 (1 persona). Es tu KPI diferencial |
| Desviación coste real vs estimado | Encuesta post-compra | < 15% |

---

# 11. Riesgos y consideraciones legales

## 11.1 Licencias de datos

| Fuente | Licencia | Restricción operativa |
|---|---|---|
| USDA FoodData Central | Dominio público | Ninguna. Atribución recomendada por buena práctica |
| CIQUAL (ANSES) | Licence Ouverte / Etalab 2.0 | Atribución obligatoria y visible *[verificar versión vigente]* |
| BEDCA | Restrictiva / no clara para uso comercial | **No usar sin permiso escrito** |
| Open Food Facts | ODbL 1.0 (datos) + CC BY-SA (imágenes) | **Share-alike si distribuyes base derivada.** Aísla en esquema propio. Atribución obligatoria. Consulta legal antes de integrar |
| APIs comerciales (Edamam, Spoonacular, Nutritionix) | Contractual | Muchas **prohíben persistir datos** o construir productos competidores. Lee el contrato completo antes de usar |
| Recetas de terceros | Derecho de autor + **derecho *sui generis* de bases de datos (Dir. 96/9/CE)** | No scrapear. Producción propia |
| **Eat This Much** | ToS prohíben scraping y compilar datos "usables por un producto o servicio competitivo" | **Riesgo legal directo y evitable. No tocar bajo ningún concepto** |

**Acción concreta:** mantén un `LICENSES.md` con la procedencia de cada lote de datos y la columna `source`/`source_ref` en cada fila. Si un día tienes que purgar una fuente, es una query. Si no lo hiciste, es una reconstrucción.

## 11.2 Riesgo regulatorio: producto sanitario

**El riesgo más subestimado.** En la UE, el Reglamento 2017/745 (MDR) puede considerar software como producto sanitario si está destinado a **diagnóstico, prevención, seguimiento, predicción, pronóstico, tratamiento o alivio de una enfermedad**. Un planificador de comidas de bienestar general no lo es. Un producto que dice "controla tu diabetes" o "planes para insuficiencia renal" **sí puede serlo**, con la consiguiente obligación de marcado CE, sistema de gestión de calidad y evaluación clínica.

**Regla operativa:**
- Prohibido en marketing y en producto: "trata", "cura", "controla tu [enfermedad]", "reduce tu colesterol", "para diabéticos".
- Permitido: "herramienta de planificación", "bienestar general", "para tus objetivos nutricionales".
- Disclaimer visible en onboarding, footer, y en cualquier pantalla de objetivos: *"Esta aplicación es una herramienta de planificación de comidas para bienestar general. No es un dispositivo médico ni sustituye el consejo de un profesional sanitario. Consulta a tu médico o dietista-nutricionista antes de cambiar significativamente tu alimentación, especialmente si tienes alguna condición de salud."*
- **No implementes modos de embarazo, lactancia, pediatría ni patología** sin asesoría clínica formal. ETM los excluye deliberadamente y tiene razón.
- Marketing sujeto además al **Reglamento (CE) 1924/2006** sobre declaraciones nutricionales y de propiedades saludables: no puedes afirmar beneficios de salud no autorizados.

## 11.3 Alérgenos: el riesgo de daño real

Este es el único punto donde puede haber consecuencias físicas. ETM trata las alergias como exclusión por keyword y lo presenta sin advertencia suficiente. **No repliques eso.**

Medidas obligatorias:
1. Etiquetado explícito de los **14 alérgenos del Anexo II del Reglamento (UE) 1169/2011** por receta e ingrediente, con revisión humana en el catálogo curado.
2. Aviso en el punto de configuración de exclusiones, no enterrado en los términos: *"El filtrado se basa en los ingredientes declarados de nuestro catálogo. No podemos garantizar la ausencia de trazas ni la composición de los productos concretos que compres. Si tienes una alergia grave, verifica siempre las etiquetas."*
3. Reconfirmación del aviso cuando se marca un alérgeno de riesgo alto (frutos secos, cacahuete, marisco).
4. **Nunca** uses lenguaje como "libre de", "seguro para alérgicos", "garantizado sin".
5. Los alimentos importados de fuentes de terceros (OFF) no se usan para filtrado de alérgenos sin verificación.

## 11.4 Privacidad y datos de salud

**GDPR aplica plenamente.** Peso, altura, objetivos corporales, restricciones dietéticas relacionadas con patología y datos de composición corporal son, en conjunto, **datos relativos a la salud (art. 9 RGPD, categoría especial)**.

| Requisito | Implementación concreta |
|---|---|
| Base legal | **Consentimiento explícito** (art. 9.2.a) separado del consentimiento general, con checkbox no premarcado en el onboarding para el tratamiento de datos de salud |
| Minimización | No pidas % de grasa corporal ni patologías si no las usas. Estima lo que puedas |
| Residencia | Todo el stack en **región UE**: Neon EU, Fly `mad`/`cdg`, PostHog EU Cloud, Vercel con funciones en `fra1`/`cdg1` |
| Subencargados | DPA firmado con Vercel, Neon, Fly, Stripe, Sentry, PostHog, Resend, Cloudflare. Inventario en el registro de actividades |
| Transferencias internacionales | Si algún subencargado procesa en EE.UU., verificar Data Privacy Framework o SCC. Documentar |
| RAT (art. 30) | Registro de actividades de tratamiento desde el día 1 |
| **EIPD/DPIA (art. 35)** | **Probablemente obligatoria**: tratamiento a gran escala de datos de categoría especial. Hazla antes del lanzamiento |
| Derechos ARCO-POL | Export de datos en JSON (portabilidad) y borrado real en cascada, ambos autoservicio |
| Retención | Política escrita: borrado de cuentas inactivas a los 24-36 meses previo aviso |
| Menores | Prohibir <16 años (o el límite del Estado miembro; en España, 14). Verificación por declaración de edad |
| Cookies | Banner con consentimiento previo real (LSSI-CE + RGPD): analítica no esencial bloqueada hasta aceptación. PostHog en modo cookieless por defecto ayuda |
| DPO | No obligatorio de inicio para una empresa pequeña, pero revisa el art. 37 si el tratamiento de datos de salud crece a "gran escala" |

**HIPAA: no aplica** salvo que vendas a *covered entities* estadounidenses (aseguradoras, proveedores sanitarios) y actúes como *business associate*. Si algún día abres el tier B2B a dietistas de EE.UU. que manejan información de pacientes, **entonces** entra en escena y requiere BAA con todos los subencargados. Manténlo fuera del alcance por ahora, conscientemente.

## 11.5 Riesgos de negocio

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| **Retención pobre a 90 días** (riesgo #1 de la categoría) | Alta | Crítico | Instrumenta adherencia desde el día 1. Si D30 < 20%, el problema es el producto, no el marketing. Lucha contra la fatiga de repetición: catálogo grande, control de variedad expuesto, sugerencias estacionales |
| **Catálogo de recetas insuficiente** | Alta | Crítico | 400 recetas mínimo antes de abrir. Producción continua como proceso, no proyecto |
| **Coste de adquisición > LTV** | Media | Crítico | Con ARPU ~49 €/año y churn del 40% anual, el LTV es ~90-110 €. El CAC pagado en fitness supera fácilmente eso. **El SEO orgánico no es una opción, es la única vía viable.** Empieza a publicar contenido y landings programáticas el mes 1, no el mes 10 |
| **Estacionalidad brutal** | Alta | Alto | 40-50% de las altas anuales en enero-marzo. Planifica caja para el valle de verano. Anual > mensual para amortiguar |
| Precios de supermercado desactualizados | Alta | Medio | Muestra rangos, no cifras exactas. Marca la fecha de actualización. Empieza con precios de referencia genéricos, no con SKUs por cadena |
| Competidor grande copia el diferencial | Media | Medio | Tu ventaja es la localización y la velocidad, no una patente. Construye el catálogo y la comunidad |
| Un solo desarrollador (bus factor) | Alta | Alto | Documenta el motor. El servicio Python debe ser reproducible con `docker compose up` |
| Dependencia de Stripe/Apple para cobros | Baja | Alto | Cuando llegue móvil, las comisiones de store (15-30%) reducen el margen. Empuja la suscripción vía web donde sea permisible según las políticas vigentes de cada tienda *[verificar reglas actuales, cambian con frecuencia]* |
| Contenido generado por IA percibido como de baja calidad | Media | Medio | Revisión humana obligatoria, dietista acreditada visible, fotos reales en las recetas de escaparate |

---

# 12. Roadmap de implementación

Supuesto: **1-2 desarrolladores full-time** + dietista freelance a tiempo parcial. Ajusta proporcionalmente.

## Fase 0 — Datos y fundamentos (semanas 1-4)

**Por qué primero:** sin catálogo no hay motor que probar, y sin motor no hay producto. El dato es el camino crítico y el que menos depende de decisiones de UI.

- [ ] Decidir mercado inicial y confirmar las fuentes nutricionales (§13).
- [ ] Repo monorepo (Turborepo): `apps/web`, `apps/planner`, `packages/db`, `packages/types`.
- [ ] Esquema Postgres completo (§5) con Drizzle + migraciones. Región EU.
- [ ] **Pipeline de ingesta USDA + CIQUAL**: descarga masiva → normalización a 100 g → validación de coherencia → traducción de nombres → asignación de `aisle_id`, `edible_fraction`, `density_g_per_ml`, `perishability_days`.
- [ ] Tabla `food_portion` poblada para los ~800 ingredientes de cocina más comunes (esto es trabajo manual y es inevitable).
- [ ] **Arrancar producción de recetas**: pipeline LLM → cálculo nutricional → validación → cola de revisión. Objetivo al final de la fase: 80 recetas publicadas.
- [ ] Herramienta interna de administración de recetas (puede ser fea; es interna).

**Salida:** base de datos con ~8.000 ingredientes validados y 80 recetas publicadas con nutrición calculada.

## Fase 1 — Motor de planificación (semanas 5-9)

**Por qué segundo:** es el riesgo técnico más alto. Si el motor no produce planes buenos, todo lo demás es irrelevante. Descúbrelo antes de invertir en UI.

- [ ] Servicio FastAPI con contrato versionado.
- [ ] Filtrado de pool + caché + detección de sobre-restricción con diagnóstico.
- [ ] Scoring vectorizado con NumPy.
- [ ] Etapa A: selección softmax con temperatura.
- [ ] Etapa B: LP de porcionado con HiGHS.
- [ ] Etapa C: reparación iterativa.
- [ ] Etapa D: ensamblado semanal con recocido simulado y objetivo global.
- [ ] **Banco de pruebas**: 40 perfiles sintéticos (dietas × objetivos × restricciones) × 30 generaciones cada uno. Métricas automáticas: error de macros, ingredientes únicos, coste, tasa de repetición, latencia p95, tasa de fallo.
- [ ] Endpoints: `POST /v1/day`, `POST /v1/week` (async), `POST /v1/alternatives`.

**Criterio de salida (no negociable):** error de kcal < 3%, error de macros < 12%, ingredientes únicos semanales < 40, p95 de día < 300 ms, p95 de semana < 3 s, tasa de fallo < 2%. **Si no se cumple, no avances.**

## Fase 2 — Aplicación MVP (semanas 10-17)

- [ ] Next.js con route groups, Auth, layout base y sistema de diseño propio (tokens, componentes primitivos, modo oscuro).
- [ ] Onboarding de 4 pantallas + generador público sin registro.
- [ ] Vista día y vista semana.
- [ ] Re-roll (comida/día/semana), lock, panel de alternativas, sustitución manual, cambio de ración, drag & drop con alternativa accesible.
- [ ] Ficha de receta + modo cocina.
- [ ] Tracking: marcar consumido, progreso del día, añadir fuera de plan, peso.
- [ ] **Lista de la compra completa**: agregación, consolidación, resta de despensa, conversión a formatos de compra, agrupación por sección, coste estimado, modo compra offline.
- [ ] Despensa mínima.
- [ ] Ajustes: dieta, exclusiones, tiempo, comidas/día, comensales, presupuesto.
- [ ] Jobs: generación semanal programada, email semanal.
- [ ] **Catálogo a 250 recetas.**

**Salida:** producto usable de extremo a extremo. Beta cerrada con 30-50 personas reales durante 4 semanas.

## Fase 3 — Monetización y lanzamiento (semanas 18-22)

- [ ] Stripe: Checkout, Billing Portal, Stripe Tax, webhooks, gestión de estados de suscripción (trial, activa, morosa, cancelada, en pausa).
- [ ] Gating de features por tier con degradación elegante (nunca una pantalla en blanco).
- [ ] Los tres momentos de conversión (§10.2).
- [ ] Emails transaccionales y de ciclo de vida.
- [ ] **SEO**: landings programáticas (dieta × kcal) con planes de muestra generados por el motor, 3 calculadoras, fichas de alimento indexables, sitemaps, JSON-LD (`Recipe`, `NutritionInformation`), ISR.
- [ ] Legal: términos, privacidad, cookies, disclaimers, DPIA, RAT, DPAs firmados.
- [ ] Analítica: PostHog con el embudo completo y las métricas de §10.3.
- [ ] **Catálogo a 400 recetas.**
- [ ] Rendimiento: Core Web Vitals en verde (es un factor de ranking y tu canal es SEO).

**Salida: lanzamiento público.**

## Fase 4 — Iteración sobre datos reales (meses 6-9)

Priorizado estrictamente por lo que digan las métricas, no por lo que apetezca construir:

- Si D30 < 20% → problema de variedad o de calidad de plan. Ataca catálogo y motor.
- Si conversión < 2% → problema de paywall o de propuesta de valor. Ataca los momentos de conversión.
- Si re-rolls > 4 por plan → problema de solver. Ataca el scoring y las señales de preferencia.
- Si el uso móvil > 40% → construye la app Expo.

Después, en orden: batch cooking → precios reales por cadena → barcode + catálogo de marca → perfiles por día → recetas de usuario → modo hogar.

---

# 13. Preguntas abiertas

Decisiones que bloquean el arranque y que solo tú puedes tomar.

## Estratégicas

1. **¿Cuál es el mercado inicial exacto?** España, España+LatAm, o EU multi-país. Determina el idioma, el catálogo de ingredientes, las recetas, la moneda, el IVA y todo el SEO. **Es la decisión más cara de cambiar después.** Mi recomendación: España primero, en profundidad, y LatAm como expansión de contenido (no de catálogo) en fase 2.
2. **¿Cuál es el presupuesto real de arranque en efectivo?** El rango de producción de recetas (1.000-3.500 €) más 6-9 meses de infraestructura (~1.000 €) más legal (DPIA + revisión de términos: 800-2.500 €) marca el suelo. Si el presupuesto es < 2.000 €, el catálogo se hace con IA y revisión propia, y las fotos son generadas — con las advertencias de §7.4.
3. **¿A tiempo completo o parcial?** El roadmap de 22 semanas asume dedicación completa. A tiempo parcial, multiplica por 2,5.
4. **¿Tienes acceso a un dietista-nutricionista colegiado?** Es necesario para la revisión del catálogo, para la credibilidad de marketing y para reducir el riesgo regulatorio. Si no, presupuesta 300-800 € para contratar uno freelance.

## Producto

5. **¿El diferencial principal es el coste o la despensa?** Ambos son buenos, pero el mensaje de marketing solo admite uno como principal. "Come bien por 50 € a la semana" y "Cocina con lo que ya tienes" apelan a públicos distintos. Yo apostaría por **coste**, porque es medible, urgente y demostrable en la landing.
6. **¿3 días gratis o 1?** Recomiendo 3 y testear. Pero es una hipótesis con consecuencias de ingresos, decídela conscientemente.
7. **¿Web-only en el lanzamiento?** Confirma que aceptas lanzar sin app nativa. Si tu público objetivo es exclusivamente móvil, cambia el roadmap (y añade 3-4 meses).
8. **¿Qué haces con las restricciones médicas?** Diabetes, hipertensión, celiaquía y colesterol alto son los casos de uso más demandados y los que más riesgo regulatorio traen. Decide ahora si los excluyes explícitamente (recomendado para el MVP) o si inviertes en validación clínica.
9. **¿Habrá LLM en el producto de cara al usuario?** Un asistente conversacional ("cámbiame la cena por algo sin horno") es un diferenciador claro frente a ETM, que no tiene nada de IA visible. Pero añade coste variable por usuario, latencia e imprevisibilidad. Mi recomendación: LLM en el *backoffice* (generación y revisión de recetas) desde el día 1; en el producto, no antes de v1.

## Técnicas

10. **¿Python separado o monolito TypeScript?** Depende de tu comodidad con Python y de tu tolerancia a la complejidad de despliegue. Si dudas, empieza en TypeScript: puedes extraer el solver a Python después, si el contrato está bien aislado.
11. **¿Integras Open Food Facts?** Es la mejor cobertura de productos españoles y es gratis, pero implica una consulta legal sobre ODbL. Decide si asumes ese coste ahora o difieres el escaneo de barcode a v1.
12. **¿De dónde salen los precios?** Genéricos por categoría (barato, impreciso), scraping de cadenas (riesgo legal y de mantenimiento), datos abiertos de precios, o entrada manual del usuario. **Sin una respuesta a esto, tu diferenciador principal no existe.** Es la pregunta técnica más importante de la lista.
13. **¿Nombre y dominio?** Debe funcionar en español, no colisionar con marcas registradas en las clases relevantes (9, 42, 44), y tener `.com` o `.es` disponible. Verifica en la OEPM y la EUIPO antes de invertir en identidad visual.

## Comerciales

14. **¿Cuál es el canal de adquisición inicial mientras el SEO madura?** El SEO tarda 6-12 meses en dar tráfico significativo. ¿Contenido en redes, comunidad, colaboración con dietistas/entrenadores, o ads de arranque? Sin respuesta, el lanzamiento es al vacío.
15. **¿Persigues el tier B2B?** Es alto ARPU (39-59 €/mes) y bajo volumen, con un ciclo de venta y unas necesidades de producto completamente distintas. Puede ser un salvavidas de caja temprano o una distracción fatal. Decídelo, pero no lo construyas antes de tener B2C funcionando.