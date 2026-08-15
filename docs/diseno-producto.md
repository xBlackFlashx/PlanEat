# Dirección de diseño de producto — PlanEat

Documento de dirección, no de inspiración. Quien implemente el flujo del generador
debería poder seguirlo sin tomar ninguna decisión visual por su cuenta. Donde hay
una elección, está tomada y justificada. Donde hay una duda, está marcada como
pendiente y dice qué hay que verificar.

**Lo que este documento NO toca:** los tokens de color de `globals.css`. La
berenjena de marca, la triada Okabe-Ito y las superficies cálidas están decididas
en `docs/decisiones-de-diseno.md` y aquí se dan por firmes. Todo lo demás —
tipografía, ritmo, tarjetas, fotografía, densidad, movimiento, gráficos y voz —
se define aquí.

**Alcance:** el flujo del generador. Portada con generador público, estado de
generación, plan del día, panel de alternativas, ficha de receta, y el estado de
sobre-restricción que cuelga de todos ellos. Vista semanal, lista de la compra,
despensa, progreso y ajustes quedan fuera; se anotan sólo cuando una decisión de
aquí las condiciona.

**Referencias que gobiernan:** `docs/spec.md` §9 (principios, tres capas,
pantallas, accesibilidad), §4.1–4.3 (flujos), §2.3 (posicionamiento);
`packages/shared/src/types.ts` (contrato); `docs/decisiones-de-diseno.md`.

---

## 0. Sobre las dos skills de diseño aplicadas

Este documento se escribió aplicando `ui-ux-pro-max` y `dataviz`. Dos notas de
honestidad sobre cómo se usaron.

**`ui-ux-pro-max`.** Su generador automático de sistemas (`--design-system`)
devolvió, para la consulta de este producto: patrón *App Store Style Landing*,
estilo *Flat Design*, acento `#EC4899` (rosa) y tipografía *Playfair Display SC +
Karla*. **Se descarta entero, y por motivos concretos:** el patrón está pensado
para vender descargas de una app nativa, y `spec.md` §3.1 corta explícitamente la
app nativa del MVP; el acento rosa colisiona con la berenjena de marca ya
decidida; *Playfair Display SC* en versalitas es una tipografía de carta de
restaurante, no de producto que se usa a diario. Lo que sí se aplica de esa skill
es su parte útil y verificable: las diez categorías de reglas por prioridad
(accesibilidad, interacción táctil, rendimiento, layout, tipografía/color,
animación, formularios, navegación, datos) y su lista de comprobación previa a la
entrega. Están incorporadas a lo largo del documento y resumidas en el Anexo B.

**`dataviz`.** Su método sí se aplica literalmente, incluida la regla central: *el
color no se razona, se computa*. Se ejecutó su validador sobre la triada de macros
en claro y en oscuro; los resultados están en el Anexo A y cambian dos decisiones
del §4. También se aplican sus especificaciones fijas de marca (grosor, huecos de
superficie, extremos redondeados) y su regla de que el texto nunca lleva el color
de la serie.

---

## 1. Concepto

### 1.1 El problema, planteado con precisión

Hay que servir a la vez a alguien que quiere saber si le sobran ocho gramos de
proteína en la cena y a alguien a quien la palabra "macro" le hace cerrar la
pestaña. La tentación es un interruptor "principiante / avanzado". Es la solución
equivocada por tres razones:

1. **Obliga a autoclasificarse antes de haber visto nada.** El principiante no
   sabe si es principiante; sabe que quiere comer mejor. Pedirle que elija un modo
   es pedirle que confiese.
2. **Parte el producto en dos y duplica el coste de todo** — dos versiones de cada
   pantalla, dos rutas de QA, dos conjuntos de bugs.
3. **Impide el único movimiento que importa: aprender.** El principiante que usa
   esto tres semanas empieza a mirar la barra de colores. Un modo que le esconde la
   barra le impide llegar ahí. El producto tiene que ser el sitio donde aprende,
   no el sitio donde se le protege de aprender.

### 1.2 La solución: una sola pantalla, tres profundidades, resueltas por posición y por plegado

Las tres capas de `spec.md` §9.3 no son tres vistas ni tres modos. Son **tres
alturas del mismo bloque**, siempre en el mismo orden, en todas las pantallas
donde aparezca información nutricional. El principiante lee la primera línea y ha
terminado. El avanzado sigue leyendo hacia abajo. Nadie configura nada.

| | Capa 1 — Narrativa | Capa 2 — Visual | Capa 3 — Referencia |
|---|---|---|---|
| **Qué es** | Una frase con la conclusión | Barra de macros + veredicto | Tabla del Reg. 1169/2011 |
| **Visibilidad** | Siempre visible, siempre primera | Siempre visible, inmediatamente debajo | Plegada (`<details>`), un tap |
| **Altura que ocupa** | 1–2 líneas (~44 px) | ~40 px | 0 px plegada |
| **A quién sirve** | Todos. Es el producto para el 80 % | Al que revisa | Al que audita |
| **Coste para quien no la usa** | Ninguna: es la conclusión que quería | ~40 px y cero decisiones | Cero |

La razón de que esto funcione y un interruptor no: **la capa 2 no cuesta atención
porque no lleva chrome**. Sin ejes, sin cuadrícula, sin leyenda separada, sin
título. Es una cinta de colores de diez píxeles con tres etiquetas al lado. Quien
no sabe leerla la ve como un elemento gráfico agradable; quien sabe leerla obtiene
el reparto exacto y el desvío contra el objetivo. **El mismo píxel hace los dos
trabajos.** Ese es el eje del diseño de este producto.

### 1.3 Qué ve exactamente cada uno en la misma pantalla

Plan del día, cabecera. Es la misma pantalla, el mismo DOM, sin ninguna
bifurcación.

| Línea | Lo que ve el principiante | Lo que ve el avanzado |
|---|---|---|
| **1.** `Martes 12 · ≈ 2 140 kcal` | Cuántas calorías tiene el día | Cuántas y con qué precisión (el `≈` dice que está redondeado a la decena) |
| **2.** `✓ Cuadra` + tres puntos de color, uno lleno, uno lleno, uno hueco | Un tick. Va bien | Proteína y carbohidratos dentro de rango, grasa fuera. Diagnóstico completo en tres puntos de 8 px |
| **3.** `El día cuadra. Te falta un poco de grasa; con la cena se arregla.` | La frase entera. Es todo lo que necesita | La confirma de un vistazo y salta |
| **4.** La barra de macros, 10 px, con la marca de objetivo | Una cinta de colores que se llena a lo largo del día | El reparto exacto, la posición contra el objetivo y la banda de tolerancia |
| **5.** `Proteína 148 g · Carbohidratos 210 g · Grasa 62 g` | Números que puede ignorar | Los números |
| **6.** `▸ Ver tabla nutricional` | No lo abre nunca | Lo abre y no vuelve a cerrarlo |

Nadie ha elegido un modo. Nadie ha visto una pantalla distinta.

### 1.4 El sustituto honesto del interruptor: la memoria de plegado

Lo único que se personaliza es **si la capa 3 está plegada**, y no se pregunta: se
observa. Si el usuario abre la tabla nutricional, se queda abierta la próxima vez.
Reglas:

- La memoria es **por tipo de bloque** (`tabla-nutricional`, `desglose-coste`), no
  global, y se guarda en `localStorage`. Nunca en el perfil del servidor: no es un
  dato del usuario, es una preferencia del navegador.
- **Sólo afecta a lo que está plegado, nunca a lo que se muestra.** Ningún dato
  aparece o desaparece por esta memoria. Las capas 1 y 2 son inamovibles.
- Es reversible con el mismo tap que la abrió. No hay ajuste que la controle.
- La primera visita siempre empieza plegada.

Esto es el producto adaptándose por uso, no el usuario configurando el producto.
Es la diferencia entera.

### 1.5 Corolarios que hay que respetar en todas las pantallas

1. **Nunca un número sin su conclusión al lado.** Si en algún sitio hay un dato
   nutricional sin capa 1 encima, falta trabajo.
2. **Nunca una conclusión sin su dato debajo.** Si en algún sitio hay una frase sin
   la barra, el avanzado deja de confiar.
3. **El orden vertical no cambia jamás.** Conclusión → visual → referencia. En la
   cabecera del día, en cada comida, en la ficha de receta, en cada tarjeta de
   alternativa. Se aprende una vez.
4. **El orden de los macros no cambia jamás:** Proteína → Carbohidratos → Grasa. En
   la barra, en las etiquetas, en la tabla, en el lector de pantalla.

---

## 2. Identidad visual

### 2.1 Personalidad

Tres adjetivos, y hay que poder señalarlos en cualquier captura:

**Cálido** — el neutro tiene sesgo amarillo, los radios son generosos, la
fotografía es de comida real con luz de ventana. **Competente** — los números están
alineados, la precisión declarada es honesta, nada baila al actualizarse.
**Sin prisa** — hay aire, no hay contadores, no hay nada parpadeando, nada te
apremia.

Y tres anti-adjetivos, cada uno con su prohibición operativa:

- **No clínico.** Ningún icono médico. Ningún gráfico con cuadrícula visible.
  Ningún porcentaje de cumplimiento. Ninguna tipografía condensada de panel.
- **No gamificado.** Sin rachas, sin medallas, sin barras que se "completan" con
  celebración, sin confeti, sin notificaciones de vergüenza.
- **No panel de control.** Sin KPI en fila arriba de todo. Sin selectores de rango
  de fechas donde no hacen falta. La unidad es el día, no el trimestre.

Un contraste útil para calibrar: el producto se parece más a una **carta de menú
bien tipografiada** que a un cuadro de mandos. Los datos están, y están completos,
pero están al servicio de algo que se va a comer.

### 2.2 Tipografía

**Decisión: dos fuentes, con reparto estricto de trabajo.**

| Papel | Fuente | Uso exacto | Prohibido |
|---|---|---|---|
| **Trabajo** | **Geist Sans** (variable, ya cargada) | Toda la UI, todo el cuerpo, **todos los números** | — |
| **Voz** | **Instrument Serif** (regular 400 e itálica) | Sólo: H1 de portada, título de ficha de receta, titular del estado de sobre-restricción, y la cifra héroe del veredicto de sobre-restricción | Nunca en UI. Nunca en un número de dato. Nunca por debajo de 24 px. Nunca en negrita |
| **Mono** | **Geist Mono** (ya cargada) | Nada en el flujo del generador. Reservada para códigos de plan en soporte | — |

Por qué. Geist se queda porque ya está, es variable, tiene `tabular-nums` y es
competente sin ser característica — exactamente lo que se quiere de la fuente que
lleva los datos. Le falta calidez, y esa carencia se resuelve con **una sola voz**
en un puñado de sitios, no cambiando la fuente de trabajo. *Instrument Serif* es
una serif de contraste moderado, ligeramente estrecha, con personalidad editorial
y sin la pomposidad de Playfair. Es gratuita (OFL en Google Fonts —
**verificar la licencia en el repositorio oficial antes de producir material de
marketing**, ver Anexo C) y se sirve autoalojada vía `next/font`, sin petición a
un tercero.

Alternativas descartadas: *Playfair Display* (lee a boda), *Calistoga* (lee a
cartel de food truck), *Söhne* (excelente, pero de pago y no justificable antes de
tener ingresos), *sólo Geist* (funciona, pero el producto queda correcto y sin
memoria — la portada no se distingue de cualquier SaaS).

**Escala tipográfica.** Razón 1,2 en móvil y 1,25 en escritorio. Nada por debajo
de 12 px. El cuerpo se queda en 16 px en móvil, lo que además evita el auto-zoom
de iOS en los campos.

| Token | Móvil | Escritorio | Interlínea | Peso | Tracking | Uso |
|---|---|---|---|---|---|---|
| `voz-1` | 34 | 46 | 1,05 | 400 serif | −0,01em | H1 de portada |
| `voz-2` | 26 | 32 | 1,10 | 400 serif | −0,005em | Título de receta, titular de sobre-restricción |
| `t-1` | 24 | 28 | 1,20 | 600 | −0,01em | Título de pantalla (`Martes 12`) |
| `t-2` | 19 | 21 | 1,25 | 600 | −0,005em | Nombre de comida (`Comida`, `Cena`) |
| `t-3` | 16 | 17 | 1,30 | 600 | 0 | Título de receta dentro de una tarjeta |
| `cuerpo` | 16 | 16 | 1,55 | 400 | 0 | Prosa, capa 1, pasos de receta |
| `cuerpo-sm` | 14 | 14 | 1,50 | 400 | 0 | Secundario, metadatos, ayudas |
| `etiqueta` | 13 | 13 | 1,35 | 500 | +0,01em | Etiquetas de macro, badges |
| `micro` | 12 | 12 | 1,30 | 500 | +0,04em, versalita | Secciones. **Uso muy restringido: máximo dos por pantalla** |
| `cifra-heroe` | 40 | 56 | 1,00 | 600 tabular | −0,02em | kcal del día, cifra de sobre-restricción |
| `cifra` | hereda | hereda | hereda | 600 tabular | 0 | Todo número en línea con texto |

Reglas de aplicación:

- **Toda cifra usa `tabular-nums`** (ya implementado con `.tnum`, `[data-numeric]`
  y tablas). Se mantiene incluso en la cifra héroe, aunque no esté en columna:
  la decisión ya está tomada en `decisiones-de-diseno.md` y la consistencia vale
  más que el medio punto de estética.
- Medida de línea: **62–70 caracteres** en prosa. Ancho máximo de columna de
  lectura 680 px (pasos de receta, textos legales). Ancho máximo del plan 1 120 px.
- La versalita (`micro`) sólo en cabeceras de sección de la lista de la compra y en
  el badge de "en casa". En ningún otro sitio.
- Nunca dos pesos distintos en la misma línea salvo cifra + unidad
  (`**148** g`, con `g` en `--text-3`).

### 2.3 Ritmo de espaciado

Base 4. Escala cerrada: **4 · 8 · 12 · 16 · 24 · 32 · 48 · 64**. Si hace falta un
valor que no está, es que la jerarquía está mal.

| Valor | Se usa exactamente para |
|---|---|
| 4 | Icono ↔ su etiqueta. Punto de color ↔ nombre del macro |
| 8 | Elementos dentro de una misma fila. Cifra ↔ unidad |
| 12 | Elementos apilados dentro de una tarjeta. Capa 1 ↔ capa 2 |
| 16 | Padding interno de tarjeta en móvil. Separación entre items de una comida |
| 24 | Padding interno de tarjeta en escritorio. Separación entre bloques de comida |
| 32 | Separación entre secciones de una pantalla |
| 48 | Separación entre bloques mayores. Respiro antes del pie |
| 64 | Sólo portada: entre el generador y la prueba social |

Márgenes laterales: **16** a 375 px, **24** a 768 px, **32** a 1 024 px y más.

Regla de agrupación (y es la que más se incumple): **la separación entre grupos
tiene que ser mayor que la separación dentro del grupo, y por al menos un escalón
completo.** Un item de comida separado 16 de otro item exige que el bloque de
comida esté separado 24 o más del siguiente bloque. Si los dos valores son iguales,
la jerarquía desaparece aunque los títulos sean distintos.

### 2.4 Tratamiento de tarjetas

Cuatro niveles, y sólo cuatro. **Las tarjetas se separan por fondo, no por
sombra** — decisión ya tomada, aquí se detalla.

| Nivel | Qué es | Fondo | Borde | Radio | Sombra |
|---|---|---|---|---|---|
| **0** | La página | `--bg` | — | — | — |
| **1** | Bloque de comida, tarjeta de alternativa, cabecera del día | `--surface` | ninguno | `--radius-lg` (14) | ninguna |
| **2** | Item dentro de un bloque | transparente | separador de 1 px `--line` entre items | `--radius-sm` (7) al hacer hover | ninguna |
| **3** | Flotante: panel de alternativas, popover de actividad, diálogo | `--surface` | 1 px `--line` | `--radius-lg` | `--shadow-pop` |

**Nunca borde y sombra a la vez** salvo en el nivel 3, donde el borde existe para
que el panel no se disuelva en el tema oscuro (donde la sombra apenas se ve).

Estados de una tarjeta o item:

| Estado | Tratamiento | Qué NO se hace |
|---|---|---|
| Reposo | Nivel 2, sin fondo | — |
| Hover | Fondo `--surface-2`, 120 ms | Elevar, escalar, mover el layout |
| Pulsado | `transform: scale(0.98)`, 80 ms, se revierte al soltar | Cambiar padding o tamaño real |
| Foco (teclado) | El `:focus-visible` global (2 px `--brand`, offset 2) | Suprimirlo nunca, ni en acciones que aparecen al hacer hover |
| Fijado ("pin") | Icono de candado a la izquierda del título + borde izquierdo de 2 px `--brand-line` | Cambiar el fondo — se confundiría con selección |
| Consumido | Check en `--brand` + título a `--text-3` | Tachar el texto. Comer no es una tarea completada |
| Sustituyéndose | La fila mantiene su altura y hace crossfade | Colapsar y reexpandir |

Las acciones por item aparecen en `:hover` **y en `:focus-within`** — sin lo
segundo el patrón es inaccesible por teclado (`spec.md` §9.4). En pantallas
táctiles (`@media (hover: none)`) están **siempre visibles**, colapsadas en un
botón `⋯` de 44 × 44 px.

### 2.5 Fotografía

La fotografía es lo que separa este producto de una hoja de cálculo. Es también la
partida más cara del catálogo, así que las reglas son estrictas para que 400
fotos parezcan una sola biblioteca.

**Dirección de arte, no negociable:**

- Plato terminado, en la vajilla, listo para comer. Nunca ingredientes crudos
  dispuestos artísticamente. Nunca el proceso.
- **Luz natural lateral o a 45°**, una sola fuente, sombra suave presente y
  visible. Nada de luz plana de estudio ni de flash cenital.
- **Un único juego de vajilla** en toda la biblioteca: platos de gres mate en tono
  crema y en tono berenjena apagado, que son los dos neutros de la marca. Fondo:
  madera clara o superficie de piedra clara. Nunca mármol blanco brillante.
- **Sin manos, sin cubiertos en movimiento, sin props de estilismo** (ramitas
  sueltas, sal derramada, servilletas arrugadas). Sin filtros de color, sin viñeteo,
  sin desenfoque artificial añadido.
- **La ración de la foto es la ración del plan.** Esta no es una regla estética,
  es la regla de honestidad de `spec.md` §9.1.5: si la foto enseña el doble de lo
  que el plan sirve, el producto miente en el único sitio donde el usuario puede
  comprobarlo.

**Geometría por contexto:**

| Contexto | Proporción | Tamaño renderizado | Notas |
|---|---|---|---|
| Item del plan del día | 1:1 | 56 px móvil · 64 px escritorio | Radio `--radius-sm`. Es un identificador, no una imagen |
| Tarjeta de alternativa | 4:3 | ancho completo de la tarjeta (≈ 352 px) | Radio superior `--radius`, inferior 0 |
| Cabecera de ficha de receta | 3:2 | ancho completo, alto máximo 480 px | Radio `--radius-lg` en escritorio; a sangre en móvil |
| Portada (prueba real) | 3:2 | dentro del bloque de plan de ejemplo | Nunca a pantalla completa detrás del formulario |

**Reglas técnicas:**

- `aspect-ratio` declarado siempre. Sin excepción. Es la causa número uno de CLS
  en productos con foto.
- AVIF con respaldo WebP. `srcset` con 1× y 2×. `loading="lazy"` en todo lo que no
  esté en el primer pliegue; la foto de cabecera de la ficha de receta va con
  `fetchpriority="high"`.
- **Nunca texto encima de una foto** sin una capa de contraste. En este flujo, la
  única foto con texto encima es la de portada, y lleva un degradado vertical desde
  `--bg` opaco abajo.
- **Placeholder cuando falta la foto:** bloque `--surface-2` con la inicial del
  plato centrada en `--text-3` a `t-2`. Nunca un icono de cámara rota, nunca un
  logotipo, nunca una foto de archivo genérica.
- `alt` descriptivo del plato, no del plano: `"Lentejas con chorizo en un plato
  hondo"`, no `"Foto de receta"`. Si la foto es puramente decorativa junto a un
  título que ya dice lo mismo, `alt=""`.

### 2.6 Densidad por pantalla

`spec.md` §9.1.8 dice "densidad media, no máxima". Aquí está calibrado.

| Pantalla | Densidad | Fotos | Cuerpo | Elementos visibles sin scroll (móvil) |
|---|---|---|---|---|
| Portada | **Baja** | 1 (prueba real, bajo el pliegue) | 17 | El titular, la frase-formulario, un botón. Nada más |
| Estado de generación | **Mínima** | ninguna | 16 | Un bloque centrado. Cero acciones |
| Plan del día | **Media** | miniatura 1:1 por item | 16 | Cabecera + 2 bloques de comida completos |
| Panel de alternativas | **Media-baja** | 4:3 grande | 16 | 1,5 tarjetas — la media tarjeta indica que hay más |
| Ficha de receta | **Baja** | 3:2 de cabecera | 17 en los pasos | Foto + título + metadatos + inicio de ingredientes |
| Sobre-restricción | **Mínima** | ninguna | 17 | Titular, frase, cifra, tres botones |
| *(Lista de la compra, vista semana)* | *Alta, sin foto* | — | 15 | *Fuera del alcance de este documento* |

La regla que hay detrás: **la densidad es inversa a la carga emocional**. La
portada y la ficha de receta venden un antojo; el plan del día es consulta; la
lista de la compra es ejecución. La densidad sube según baja el deseo y sube la
prisa.

---

## 3. Pantalla por pantalla

Para cada una: objetivo, estructura vertical, qué se ve en el primer segundo, y
los estados. Los estados no son opcionales; una pantalla sin sus estados no está
terminada.

### 3.1 Portada con generador público

**Objetivo único:** que un desconocido vea un día real generado en menos de
sesenta segundos, sin cuenta. Todo lo demás en esta página es secundario.

**Estructura vertical (móvil, en orden):**

1. Barra superior mínima: logotipo a la izquierda, `Entrar` a la derecha. 56 px.
   Sin menú de navegación. No hay nada que navegar antes del resultado.
2. **H1 en `voz-1`**, dos líneas máximo.
3. Subtítulo en `cuerpo`, `--text-2`, una línea.
4. **El generador, como una frase editable.** Ver abajo.
5. Botón primario de ancho completo, 52 px de alto.
6. Bajo el botón, en `cuerpo-sm` y `--text-3`: `Sin registro. Tarda unos segundos.`
7. *(pliegue)*
8. El plan de ejemplo real, generado por el motor, con sus tres capas completas.
9. Los tres pilares diferenciales (coste real · lista corta · despensa primero),
   en tres bloques de texto. Sin iconos decorativos.
10. Precio, FAQ, pie legal.

**El generador conversacional.** Es un `<form>` real, con `<label>` reales
asociados y visualmente ocultos, presentado como prosa:

> Soy [**mujer** ▾] de [**32**] años, mido [**168**] cm y peso [**64**] kg.
> Me muevo [**poco** ▾] y quiero [**mantenerme** ▾].

- Los campos numéricos son `<input inputmode="numeric">` de ancho fijo a tres
  caracteres, sin caja: subrayado de 2 px en `--brand-line` que pasa a `--brand`
  al enfocar. Peso 600, tabular.
- Las elecciones de ≤ 4 opciones (sexo, objetivo) son grupos de píldoras en línea
  dentro de un `<fieldset>` con `<legend>` oculta. La de 5 opciones (actividad) es
  un popover con cinco filas, cada una con su microcopy de calibración.
- **Los campos vienen precargados con valores medianos.** El usuario corrige, no
  rellena. Esto elimina el pánico de la página en blanco y hace que el botón sea
  pulsable desde el primer instante.
- Validación **al perder el foco**, nunca por tecleo. El error aparece bajo la
  frase completa, no bajo el campo (rompería la prosa), en `--danger`, con
  `role="alert"`, y siempre propone la corrección.

**El primer segundo:** el titular, y luego el subrayado del primer campo. El botón
es lo tercero. Nada más compite: no hay imagen de héroe a pantalla completa
encima del formulario en móvil, no hay carrusel, no hay vídeo.

**Estados:**

| Estado | Tratamiento |
|---|---|
| Por defecto | Precargado y válido. El botón está activo desde el principio |
| Campo fuera de rango | Mensaje bajo la frase con la corrección propuesta. El botón sigue activo; se valida al pulsar y se enfoca el primer campo inválido |
| Objetivo bajo el suelo de seguridad | El cálculo se emite con `KCAL_MINIMAS` y se muestra la nota del §6.7. No se bloquea al usuario |
| Enviando | El botón pasa a estado de carga con su etiqueta cambiada; se deshabilita. La secuencia del §3.2 se monta debajo |
| Sin JavaScript | El formulario funciona como envío clásico y devuelve el día renderizado en servidor. Es un producto SEO: tiene que funcionar |
| Ya tiene sesión | El generador se sustituye por un enlace a su plan de hoy. No se le hace repetir el onboarding |

### 3.2 Estado de generación

**Objetivo:** ocupar entre dos y ocho segundos en los que el usuario mira y no
puede hacer nada, **sin mentir sobre el progreso y sin desperdiciar el momento.**
Es el único punto del producto donde la marca puede tener un gesto propio. El
diseño del movimiento está en el §5.4; aquí queda la estructura.

**Dónde ocurre.** No es una pantalla nueva. Se monta **en el sitio exacto donde va
a aparecer el resultado**, con su altura reservada. No hay navegación, no hay
cambio de URL, no hay CLS.

**Estructura del bloque (320 px móvil / 420 px escritorio, centrado):**

1. Arriba, la **cinta de macros vacía**: 10 px de alto, `--surface-3`, radio 5.
2. Debajo, **una fila por comida del layout del usuario**, con la altura exacta de
   las filas de item que después aparecerán (72 px). A la izquierda, el nombre real
   del slot ya escrito en `--text-3`: `Desayuno`, `Comida`, `Cena`. No es un
   esqueleto abstracto: es la forma de su día.
3. Abajo, **la línea de estado**: `role="status"`, `aria-live="polite"`, `cuerpo-sm`,
   `--text-2`. Cambia de texto según el paso.

**No hay barra de porcentaje.** Un porcentaje aquí sería inventado, y el usuario lo
detecta en cuanto se queda clavado en el 80 %. Hay **cuatro pasos honestos**
ligados al pipeline real de `spec.md` §4.2 — objetivos, pool de candidatas,
porcionado, cuadre — con los completados marcados con un check y el actual
resaltado. El paso 4 nunca se marca hasta que la respuesta ha llegado.

**Estados:**

| Estado | Tratamiento |
|---|---|
| Respuesta en < 400 ms | **No se monta nada.** El plan aparece con un fade de 200 ms. Un esqueleto que parpadea es peor que ningún esqueleto |
| Normal (0,4–6 s) | La secuencia completa del §5.4 |
| Lento (> 6 s) | Se añade una línea bajo el estado: `Sigue en marcha. A veces el día cuesta más de cuadrar.` No se cambia nada más |
| Muy lento (> 20 s) | Se corta y se muestra error con reintento. Los datos del formulario se conservan |
| Error de red | Mensaje + `[Reintentar]`. El formulario se conserva intacto |
| Sobre-restricción (`ok: false`) | Se transiciona al §3.6 con un crossfade de 320 ms. **No es un error**: es un resultado |
| Re-roll dentro del plan | No se cambia de pantalla. Sólo el bloque afectado entra en esqueleto, con su altura exacta. El resto del plan permanece legible e interactivo |
| `prefers-reduced-motion` | Ver §5.5. La línea de estado sigue cambiando: es información, no decoración |

### 3.3 Plan del día

**Objetivo:** que un día completo se lea de un vistazo (`spec.md` §9.1.2) y que
cualquier corrección cueste un tap (§9.1.3).

**Estructura vertical:**

1. **Cabecera pegajosa.** Contiene las cuatro capas del §1.3 completas: fecha +
   kcal héroe, veredicto (icono + palabra + tres puntos), frase de capa 1, barra de
   macros. Alto ≈ 112 px en móvil.
   - **Al hacer scroll se compacta a 56 px** conservando lo que más se consulta:
     kcal, veredicto y la barra reducida a 6 px. La frase y las etiquetas se
     desvanecen. La compactación es por opacidad y altura, con `will-change: height`
     y sin reflow del contenido de abajo (la cabecera es `position: sticky` y el
     cuerpo no se mueve).
2. **Un bloque de nivel 1 por comida.** Cabecera del bloque: nombre del slot en
   `t-2` a la izquierda, kcal del slot tabular a la derecha, y `⋯` de acciones del
   slot. Dentro, los items.
3. **Item:** miniatura 1:1 · título en `t-3` · subtítulo en `cuerpo-sm`/`--text-3`
   con tiempo y ración · kcal a la derecha, tabular · `⋯`. Alto de fila 72 px.
4. **Pie del día:** coste estimado **en rango** (`14–17 € estimado`) y el enlace
   a la tabla nutricional del día completo (capa 3).
5. En escritorio, la cabecera del día ocupa una columna lateral pegajosa de 320 px
   a la derecha y las comidas quedan en la columna principal. El orden del DOM no
   cambia: la cabecera va primero y se recoloca con grid.

**El primer segundo:** la frase de capa 1 y la cifra de kcal. **No la barra.** La
barra es el segundo golpe de vista, y es deliberado: el principiante ya ha
terminado de leer antes de llegar a ella.

**Estados:**

| Estado | Tratamiento |
|---|---|
| Cargando | Esqueleto con la estructura real: la cabecera con su altura y tres bloques con sus filas. Nunca un spinner centrado |
| Vacío (usuario ha borrado todo) | Tarjeta de nivel 1 con `Este día está sin nada.` + botón `Generar el día`. Nunca una pantalla en blanco |
| Fallo parcial de un slot | El bloque de esa comida muestra el diagnóstico en su sitio (versión reducida del §3.6) y **el resto del día se queda visible y usable** |
| Sobre-restricción total | Se navega al §3.6 |
| Día pasado o consumido | La cabecera se atenúa a `--text-2`, los checks permanecen, las acciones de re-generación desaparecen (no se deshabilitan: se quitan) |
| Compra ya hecha esta semana | Las acciones de regeneración siguen ahí pero piden confirmación explícita con el aviso de desperdicio (§6.6) |
| Tras un cambio con re-escalado | Los números afectados hacen el "tick" del §5.3.5 y sale el toast con `[Deshacer]` |

### 3.4 Panel de alternativas

**Objetivo:** elegir entre seis opciones sin perder de vista el día. `spec.md` §9.4
lo dice y es la regla que más se incumple en la categoría: **nunca un modal a
pantalla completa.**

**Geometría:**

- **Escritorio (≥ 1024 px):** panel lateral derecho de 400 px, nivel 3, que empuja
  o se superpone al contenido sin oscurecerlo. **Sin scrim.** El plan sigue
  visible y legible detrás; ese es el punto entero.
- **Tablet y móvil:** hoja inferior al 88 vh, nivel 3, con scrim de
  `rgb(0 0 0 / 0.4)`. Se cierra con arrastre hacia abajo, con la `×` de 44 × 44,
  con `Escape` y tocando el scrim. Las cuatro salidas, siempre.

**Contenido:**

1. Cabecera: `Alternativas para la comida del martes`, y debajo, en `cuerpo-sm` y
   `--text-3`, qué se está sustituyendo.
2. Seis tarjetas de nivel 1, ordenadas **por encaje, nunca alfabéticamente**.
   Cada una: foto 4:3 · título en `t-3` · tiempo y dificultad · **el delta**
   (§4.6) · badges (`en casa`, coste).
3. Al final, una fila de escape: `¿No te convence?` con las dos restricciones que
   más están filtrando y un botón para relajar cada una.

**Por qué el delta y no el valor absoluto:** el usuario no está evaluando la
receta contra su objetivo, está evaluándola **contra la que ya tiene**. El valor
absoluto le obliga a hacer la resta mentalmente. El delta es el dato de decisión.

**Estados:**

| Estado | Tratamiento |
|---|---|
| Cargando | Seis esqueletos con la geometría exacta de las tarjetas, incluida la caja de la foto con su `aspect-ratio` |
| Menos de 6 opciones | Se muestran las que hay, sin rellenar con peores, y la fila de escape sube a posición prominente |
| Ninguna opción | Versión reducida del §3.6 dentro del panel, con las mismas tres salidas |
| Elección hecha | El panel se cierra (150 ms), el item hace crossfade, el resto del día se re-escala con el "tick", y sale el toast con `[Deshacer]` |
| Error de red | Dentro del panel, mensaje + `[Reintentar]`. El panel no se cierra |

### 3.5 Ficha de receta

**Objetivo:** que apetezca, y que se pueda cocinar con el móvil apoyado en la
encimera. Densidad baja, la foto manda. Es el punto donde el sistema está menos
probado (`decisiones-de-diseno.md`) y por eso aquí se especifica más.

**Estructura vertical:**

1. **Foto 3:2**, a sangre en móvil, con radio en escritorio.
2. **Título en `voz-2`** (la serif). Es uno de los cuatro sitios donde aparece.
3. Fila de metadatos: `25 min` · `Fácil` · `2 raciones`, separados por puntos
   medios en `--text-3`.
4. **Selector de raciones**, que recalcula ingredientes y macros en vivo. En
   escritorio queda pegajoso en la columna lateral; en móvil, justo aquí.
5. **Las tres capas completas**, en su orden de siempre.
6. **Ingredientes.** Lista con **doble unidad simultánea**: la unidad doméstica
   primero, en `--text` peso 500 (es la que se usa al cocinar), y los gramos
   después en `--text-3`: `2 cucharadas · 25 g`. Los ingredientes no escalables
   (`escalable: false`, p. ej. la sal) no cambian al mover el selector y llevan una
   marca discreta que lo explica al pulsar.
7. **Pasos numerados.** Columna de 680 px, `cuerpo` a 17 px, interlínea 1,6. Los
   números en `--brand` a la izquierda, fuera del flujo del texto.
8. Botón `Modo cocina`.
9. Al pie, el aviso fijo de alérgenos del §6.7. Siempre. Sin plegar.

**Modo cocina:** un paso a la vez, tipografía a 22/26 px, `--text` a máximo
contraste, botones de anterior/siguiente de 56 px de alto, Wake Lock activo, y un
indicador `Paso 3 de 7`. Se sale con un botón visible, nunca sólo con gesto.

**El primer segundo:** la foto y el título. Los macros son lo tercero.

**Estados:**

| Estado | Tratamiento |
|---|---|
| Sin foto | Placeholder del §2.5. El título sube y ocupa más aire |
| Contiene un alérgeno que el usuario excluye | Banner `--danger-soft` con texto `--danger` **arriba del todo**, con `role="alert"`. La receta **no se oculta** — ocultarla impide entender por qué el sistema la propuso |
| Sin revisar por dietista (`revisadaPor` vacío) | No se publica. En entornos internos, banner `--warning-soft` visible |
| Ración fuera de rango razonable | El selector se limita a 0,5×–4×. Fuera de ahí las cantidades dejan de ser cocinables |
| Cargando | La foto reserva su `aspect-ratio`; título e ingredientes en esqueleto. Los pasos se cargan en diferido |
| Error 404 | Página propia con enlace de vuelta al día. Nunca un genérico del framework |

### 3.6 Estado de sobre-restricción

**Pantalla dedicada, no un toast** (`spec.md` §9.4). Mapea uno a uno con
`FalloGeneracion`.

**Estructura:**

1. **Titular en `voz-2`**: `Con lo que me has dicho, no llego.`
2. **La frase del solver** (`fallo.mensaje`) en `cuerpo` a 17 px. Es el texto que
   el backend genera desde las variables de holgura del LP; se muestra tal cual.
3. **La cifra, en `cifra-heroe`**, con contexto inmediato debajo:
   `22 recetas encajan con tus filtros` / `Necesito unas 40 para montar variedad
   sin repetir.` Junto a la cifra, una micro-barra de proporción (§4.7). **Nunca un
   donut.**
4. **Las sugerencias como tres botones que ejecutan el cambio**, no que lo
   explican. `fallo.sugerencias` viene como texto; la UI lo convierte en acciones
   parametrizadas. Un botón que dice `Subir a 1 750 kcal` sube a 1 750 kcal y
   regenera. Si sólo abre los ajustes, hemos fallado.
5. Al pie, en `--text-3`: `Ninguna de estas opciones se guarda hasta que la elijas.`

**El primer segundo:** el titular. La cifra es lo segundo. Los botones, lo tercero.

**Tono, y es lo más importante de esta pantalla:** el sistema asume la
responsabilidad. `No llego`, no `Tus filtros son demasiado restrictivos`. El
usuario ha pedido algo legítimo; el solver no ha podido. Esa asimetría es una
decisión de producto, no una cortesía.

---

## 4. Visualización de datos

Aplicando el método de `dataviz`: primero la forma, después el color, y el color se
valida ejecutando el validador. Los resultados de esa ejecución están en el
Anexo A y **cambian dos decisiones de esta sección**.

### 4.1 Evaluación de la primitiva actual

`apps/web/src/components/macro-bar.tsx`. Lo que está bien, y hay bastante:
barra apilada en vez de donut, colores exclusivamente por token, etiquetas al lado
en vez de leyenda separada, `role="img"` con `aria-label`, `tabular-nums`, y una
variante compacta. La base es correcta.

Ahora los ocho problemas, en orden de gravedad:

**1 — El componente hace dos gráficos distintos a la vez, y por eso no puede hacer
bien ninguno.** Este es el problema de fondo del que salen los demás.

- **Reparto** (*part-to-whole*): cómo se divide la energía de esta comida entre
  los tres macros. **Siempre suma el 100 %.** No tiene carril de fondo. No tiene
  objetivo: el reparto no se compara con nada, se lee.
- **Progreso** (*ratio contra un límite*): cuánto del objetivo del día llevas.
  **No suma el 100 %.** Necesita carril, necesita marca de objetivo y necesita
  banda de tolerancia.

`MacroBar` dibuja un reparto y recibe `objetivoKcal`. Por eso el objetivo acaba
convertido en una nota de texto en vez de en una marca en el eje — **que es
literalmente la razón documentada por la que se eligió barra sobre donut.** La
decisión de diseño está escrita y no está implementada.

→ **Se parte en dos componentes: `BarraReparto` y `BarraProgresoDia`.**

**2 — Faltan los huecos de superficie.** Los tres segmentos se tocan. La
especificación de marcas de `dataviz` exige **2 px de hueco en color de superficie
entre rellenos contiguos**. La validación (Anexo A) confirma que el peor par
adyacente pasa (ΔE 11,4 en protanopia en claro), pero pasa *con margen ajustado*, y
a 10 px de alto el hueco es lo que convierte "pasa" en "se lee sin esfuerzo".

**3 — La tolerancia está codificada a mano.** La línea que decide si el desvío se
pinta en `--warning` usa `objetivoKcal * 0.03` literal. El contrato ya trae
`ObjetivoNutricional.toleranciaKcal`. Peor: **los tres macros tienen su propio
`Rango` (`proteinaG`, `carbohidratoG`, `grasaG`) y el componente los ignora por
completo.** Sin ellos no se puede calcular el veredicto del §4.5.

**4 — El color es el único canal de estado.** El desvío pasa de `--text-3` a
`--warning` sin icono ni palabra. Infringe `spec.md` §9.5 y la regla de estado de
`dataviz`. El color nunca puede ser el único canal.

**5 — El `aria-label` da la capa 2, no la capa 1.** Un lector de pantalla oye
`"Proteína: 148 gramos. Carbohidratos: 210 gramos..."` — la lectura de un gráfico,
no su conclusión. Debe oír la frase de capa 1 y, si acaso, los gramos después.

**6 — El título "Reparto de macros" es chrome que no aporta.** En la cabecera del
día el contexto ya lo dice y ocupa una línea entera. Debe ser opcional y estar
apagado por defecto.

**7 — Dos fuentes para el mismo número.** Los anchos salen de `kcalTotales`
(derivado de los macros) y la cifra grande sale de `kcal` (del panel). Los dos
pueden discrepar por redondeo, fibra o alcohol. Hay que decidirlo y documentarlo:
**los anchos salen de las kcal derivadas de macros** (suman 100 % por
construcción) **y la cifra grande es `panel.kcal`**. Se acepta una discrepancia de
hasta el 2 % y nunca se muestran los dos números juntos como si fueran el mismo.

**8 — El redondeo no usa el redondeo honesto del dominio.** Usa `Math.round`
mientras `packages/shared/src/nutricion.ts` exporta `kcalPresentables()` para
redondear a la decena. `2 137` es falsa precisión; `≈ 2 140` es honesto.

### 4.2 `BarraReparto` — especificación

*Trabajo: parte-sobre-el-todo. Colores: categóricos (identidad).*

| Propiedad | Valor |
|---|---|
| Alturas | `cinta` 6 px · `normal` 10 px · `detalle` 14 px |
| Radio | 5 px (mitad del alto) en los dos extremos **exteriores**; interiores cuadrados |
| Hueco entre segmentos | **2 px del color de la superficie contenedora**, no del carril |
| Carril | **Ninguno.** Un reparto siempre suma el 100 % |
| Orden | **Proteína → Carbohidratos → Grasa. Fijo. Nunca por magnitud** |
| Colores | `--protein` · `--carb` · `--fat` |
| Anchos | Proporción de kcal derivadas de macros (4/4/9 kcal por gramo) |
| Segmento < 3 % | Se dibuja con un mínimo de 3 px para que no desaparezca; se marca en el `aria-label` como aproximado |
| Etiquetas | Punto de 8 px del color + nombre en `--text-2` + gramos en `--text` peso 600 tabular. **En variante `cinta`, sin etiquetas** |
| Accesible | `role="img"` + `aria-label` con la conclusión primero |

**El color nunca va en el texto.** Verificado: `--carb` (`#e69f00`) tiene **2,12:1**
contra `--bg` en claro. Como texto es ilegible. La identidad la da el punto de
color **al lado** del texto, nunca el texto coloreado. (Anexo A.)

### 4.3 `BarraProgresoDia` — especificación

*Trabajo: razón contra un límite, con composición. Colores: categóricos + una
marca neutra.*

| Propiedad | Valor |
|---|---|
| Carril | `--surface-3`, alto 10 px, radio 5 |
| **Escala del carril** | **Fija: el carril entero equivale a `objetivo.kcal × 1,25`** |
| Marca de objetivo | Línea vertical de **2 px en `--text-2`**, a toda la altura del carril, **siempre al 80 % del ancho** |
| Banda de tolerancia | Dos líneas de **1 px en `--line-strong`** a ±`toleranciaKcal` de la marca |
| Relleno | Los tres macros apilados en su orden fijo, con el hueco de 2 px |
| Desbordamiento (> 125 %) | El relleno se detiene en el borde y aparece una **punta de flecha** de 6 px en `--warning` pegada al extremo, más la palabra en la capa 1 |
| Anillo de superficie | La marca de objetivo lleva 2 px de superficie a cada lado para no fundirse con el relleno |

**La decisión de la escala fija es la más importante de esta sección.** Si el
carril se escalara al máximo de cada día, la marca de objetivo bailaría de sitio y
habría que leer un número para saber dónde está. Con la escala fija a 1,25× **la
marca está siempre en el mismo punto de la pantalla**, y a los tres días el usuario
sabe si va bien por dónde llega la cinta, sin leer nada. Es el mecanismo concreto
por el que el principiante entiende su día sin números. Ninguna otra decisión de
este documento le sirve tanto.

### 4.4 El progreso del día a lo largo del día

La barra de progreso muestra **lo consumido**, no lo planificado, en cuanto el
usuario marca su primera comida. Antes de eso muestra lo planificado. La
diferencia se señala así:

| Momento | Tratamiento |
|---|---|
| Nada consumido aún | Los tres segmentos al **100 % de opacidad**. Capa 1: `Tu día planificado` |
| Algo consumido | Lo consumido a 100 %; lo que queda del plan, en el mismo color pero al **28 % de opacidad**, separado por el hueco de 2 px. Capa 1: `Llevas X de Y` |
| Todo consumido | Todo a 100 %. La marca de objetivo se mantiene |

Dos rellenos del mismo color a distinta opacidad, no dos colores: **no son dos
categorías, son la misma categoría en dos estados.** Meter un cuarto color aquí
rompería el vocabulario de tres que el usuario acaba de aprender.

Para **el peso** en la pantalla de progreso (fuera de este alcance, pero la regla
se fija ahora): línea de media móvil de 7 días a 2 px en `--brand`, y el dato crudo
detrás como puntos de 6 px al 30 % de opacidad. **Nunca sólo el dato crudo**
(`spec.md` §9.4). Y ni una racha.

### 4.5 "Cuadra / no cuadra" sin números

Esto es un **estado**, no una serie. Por tanto usa la paleta de estado —
reservada, con icono y palabra siempre — y **jamás los colores de macro**.

**Tres estados. No cinco.** Cinco niveles son un juicio moral disfrazado de
precisión.

| Estado | Condición | Color | Forma | Palabra |
|---|---|---|---|---|
| **Cuadra** | kcal dentro de ±`toleranciaKcal` **y** los tres macros dentro de su `Rango` | `--brand` | Círculo con check | `Cuadra` |
| **Casi** | kcal dentro de tolerancia pero ≥ 1 macro fuera de rango; **o** kcal fuera de tolerancia pero dentro de 2× | `--warning` | Círculo medio relleno | `Casi` |
| **No cuadra** | kcal fuera de 2× tolerancia; **o** el solver devolvió `ok: false` | `--danger` | Círculo con línea horizontal | `No cuadra` |

**Reglas, todas obligatorias:**

1. **Nunca el color solo.** Siempre icono **y** palabra. La forma del icono
   distingue los tres estados en escala de grises.
2. **"Cuadra" usa `--brand`, no verde.** El verde ya significa *grasa* en este
   producto (`decisiones-de-diseno.md`). Esto se preserva.
3. **Ningún porcentaje de cumplimiento. Ninguna nota. Ninguna racha.** Existe la
   tentación de un "87 % de adherencia". Es exactamente la gamificación
   culpabilizadora que `spec.md` §9.4 prohíbe.
4. **"Casi" es el estado emocional por defecto del producto.** Los rangos de
   `calcularObjetivo()` traen ±8 % en proteína y ±12 % en el resto precisamente
   porque un día real no cuadra al gramo. Un producto que dice "no cuadra" a
   menudo enseña a ignorarlo.
5. El estado se anuncia con `role="status"` **sólo cuando cambia por una acción
   del usuario**, nunca en la carga inicial.

**Los tres puntos: la pieza donde las dos capas ocupan el mismo píxel.** Junto al
icono, tres puntos de 8 px, uno por macro, en su color, en el orden fijo.

- **Relleno** = ese macro está dentro de su `Rango`.
- **Anillo hueco** (2 px de trazo, centro en color de superficie) = está fuera.

El principiante lo lee como un adorno junto al tick. El avanzado obtiene un
diagnóstico completo de los tres macros en 32 píxeles, sin abrir nada. La
distinción es **relleno frente a hueco**, es decir forma, no color: sigue siendo
legible en escala de grises. Y no necesita leyenda porque los mismos tres colores
están en la barra que hay justo debajo.

**La versión narrada, que es la que lee el principiante,** sale de la misma
condición: ver plantillas en §6.4.

### 4.6 El delta en el panel de alternativas

*Trabajo: polaridad (más o menos que la actual). Colores: divergente + neutro.*

- **Un solo eje.** Una micro-barra divergente en un carril de 64 × 6 px, con el
  cero en el centro marcado con 1 px de `--line-strong`.
- La barra sale del centro hacia la izquierda (menos kcal) o hacia la derecha (más)
  **en `--text-2`, no en color de macro**: aquí no se codifica identidad, se
  codifica magnitud contra cero.
- **La escala es compartida entre las seis tarjetas** y se calcula como el máximo
  `|delta|` de las seis, redondeado hacia arriba. Si cada tarjeta se escalara a su
  propio máximo, la comparación entre tarjetas sería falsa — y comparar es lo único
  que se hace en este panel.
- Debajo, en texto: `+12 g P · −8 g C · +3 g G`, cada uno precedido de su punto de
  color de 6 px. Aquí sí es identidad.
- **Nunca dos ejes.** Nunca un segundo carril con otra escala al lado.

### 4.7 La micro-barra de proporción (sobre-restricción)

*Trabajo: una razón única. Forma: medidor, no gráfico.*

Carril de 120 × 6 px en `--surface-3`, relleno en `--warning` a la proporción
`recetasCandidatas / total`, y una marca de 2 px en `--text-2` en el umbral de
viabilidad (40 recetas). Directamente etiquetada: `22 de 1 240`. **Nunca un donut
de dos porciones** — es el anti-patrón canónico.

### 4.8 Reglas transversales

Aplican a cualquier gráfico que se añada al producto, hoy o después.

1. Orden de macros fijo, siempre: **Proteína, Carbohidratos, Grasa.**
2. **El color sigue a la entidad, nunca a su magnitud ni a su posición.** Un filtro
   que cambie qué se muestra no repinta lo que queda.
3. **El texto nunca lleva el color de la serie.** La identidad va en un punto o
   swatch al lado.
4. **Nunca leyenda separada.** Etiqueta al lado con su punto (regla ya establecida
   en `decisiones-de-diseno.md`).
5. **Nunca donut. Nunca doble eje. Nunca degradado dentro de un relleno de datos.**
   Nunca cuadrícula visible: el objetivo y la tolerancia son las únicas referencias
   que este producto necesita.
6. **Toda visualización tiene equivalente textual.** La barra lleva `aria-label`
   con la conclusión; la capa 3 es la vista de tabla obligatoria.
7. **Los datos son legibles en el fotograma 1.** Ninguna animación de entrada
   impide leer un gráfico. La única excepción, deliberada, es el estado de
   generación (§5.4), donde el crecimiento *es* el mensaje.
8. Toda cifra, `tabular-nums`. Toda cifra de kcal, pasada por `kcalPresentables()`.
   Todo precio, en rango.

---

## 5. Movimiento

### 5.1 Tokens de movimiento

Los actuales (`--dur: 150ms`, `--ease`) se conservan y se amplían. Todo tiempo del
producto sale de esta tabla; ningún componente declara una duración propia.

| Token | Valor | Se usa para |
|---|---|---|
| `--dur-rapida` | 120 ms | Cambio de color: hover, foco, borde |
| `--dur` *(existe)* | 150 ms | Estados de componente, revelados pequeños, salidas |
| `--dur-media` | 220 ms | Entrada de panel, hoja, popover, crossfade de contenido |
| `--dur-lenta` | 320 ms | Transición entre pantalla y resultado |
| `--dur-cuadre` | 500 ms | Sólo el compás 4 del estado de generación |
| `--ease` *(existe)* | `cubic-bezier(.4,0,.2,1)` | Por defecto |
| `--ease-entrada` | `cubic-bezier(0,0,.2,1)` | Entradas: desacelera al llegar |
| `--ease-salida` | `cubic-bezier(.4,0,1,1)` | Salidas: acelera al irse |
| `--ease-suave` | `cubic-bezier(.2,.8,.2,1)` | Panel lateral, hoja y el cuadre de la barra. Da sensación de resorte sin resorte |

**Regla de asimetría:** la salida dura aproximadamente el 65 % de la entrada. Un
panel que entra en 220 ms sale en 150 ms. Una salida lenta se percibe como el
producto estorbando.

### 5.2 Qué NO se anima. Nunca

Esta lista va primero porque es la que más valor tiene:

- **Los números de kcal como contador ascendente.** Es falsa precisión en
  movimiento e impide leer durante la animación.
- **La barra de macros en la carga inicial de la página.** El dato tiene que estar
  ahí en el primer fotograma.
- **El scroll.** Nada de *scroll-jacking*, nada de parallax, nada de revelados al
  hacer scroll dentro de la aplicación. (En la portada de marketing, con extrema
  moderación y sólo opacidad.)
- **Nada que provoque reflow.** Se anima `transform` y `opacity`. La única
  excepción autorizada es el ancho de los segmentos de la barra de macros, aislada
  con `contain: layout paint`.
- **El hover de una tarjeta con elevación o desplazamiento.** Cambia el color de
  fondo y ya. Mover el layout bajo el cursor es la causa clásica de la sensación de
  producto inestable.
- **Ningún elemento en bucle infinito** salvo el barrido del compás 2 de la
  generación, que termina en cuanto llega la respuesta.

### 5.3 Qué sí se anima, y por qué

Lista cerrada. Si no está aquí, no se anima.

| # | Qué | Cómo | Duración | Por qué |
|---|---|---|---|---|
| 1 | Estados interactivos | `background-color`, `color`, `border-color` | `--dur-rapida` | Confirma que el elemento responde |
| 2 | Pulsación | `scale(0.98)`, se revierte al soltar | 80 ms | Acuse táctil inmediato (< 100 ms) |
| 3 | Panel de alternativas | Escritorio: `translateX(16px)→0` + opacidad. Móvil: `translateY(24px)→0` | `--dur-media` entrando, `--dur` saliendo, `--ease-suave` | Continuidad espacial: viene del borde por el que va a volver |
| 4 | Sustitución de un item | Crossfade en su sitio, altura de fila fija | `--dur-media` | Sustituir no es navegar: el sitio no cambia |
| 5 | **Re-escalado del resto del día** | Los números afectados: opacidad `1→0,4→1` + `translateY(-2px)→0` | `--dur` | **Sin esto el usuario no ve el efecto colateral.** Es la animación más importante del producto después de la generación |
| 6 | Anchos de la barra de macros al cambiar el dato | `width` con `--ease-suave` | `--dur-media` | Hace visible la relación causa-efecto entre el cambio y el reparto |
| 7 | Entrada de listas | Opacidad + `translateY(8px)`, escalonado 40 ms, máximo 6 elementos | 180 ms cada uno, ≤ 420 ms en total | Da orden de lectura. Más de 6 y se convierte en espera |
| 8 | Estado de generación | Ver §5.4 | — | — |
| 9 | Toasts | Entran `translateY(12px)` + opacidad; salen sólo con opacidad | 180 ms / 120 ms | Auto-cierre a 5 s, o 7 s si llevan `[Deshacer]` |

Todas son **interrumpibles**: un tap durante una animación la cancela y aplica el
estado final de inmediato. Ninguna bloquea la entrada.

### 5.4 El estado de generación

Es el único momento en que el usuario mira y no puede hacer nada. Merece un gesto
propio, y ese gesto tiene que **informar**, no entretener.

**Concepto: el día se pone la mesa.** No es un spinner ni un esqueleto genérico:
es una previsualización del artefacto que se está construyendo. El usuario mira la
forma de su propio día llenarse, con los nombres de sus comidas ya escritos. Un
esqueleto genérico dice "espera". Este dice "estoy montando *esto*".

**La coreografía, en cuatro compases atados al pipeline real:**

| Compás | Se dispara con | Qué pasa | Duración | Curva |
|---|---|---|---|---|
| **1 · Objetivos** | Objetivos calculados (≈ 200 ms, casi inmediato) | La cinta superior dibuja los tres segmentos en su color **al 25 % de opacidad**, de izquierda a derecha. Es el objetivo, no el resultado | 400 ms | `--ease-entrada` |
| **2 · Candidatas** | Pool construido | Cada fila de comida recibe un barrido: un degradado `--surface-2 → --surface-3 → --surface-2` la recorre de izquierda a derecha, en bucle, **desfasado 140 ms entre filas** | 1 100 ms por ciclo | lineal |
| **3 · Raciones** | Llega el plan | El barrido se detiene y el **título real de cada receta aparece, de arriba abajo, con 90 ms entre filas**: opacidad `0→1` + `translateY(6px)→0` | 200 ms por fila | `--ease-entrada` |
| **4 · Cuadre** | Inmediatamente después | La cinta pasa de 25 % a 100 % de opacidad **y sus tres anchos se mueven desde los del objetivo hasta los reales** | `--dur-cuadre` | `--ease-suave` |
| **Cierre** | — | Aparece el veredicto (icono + palabra + tres puntos) con un fade | 200 ms | `--ease-entrada` |

El compás 3 es el momento crítico del diseño: **es donde el usuario deja de
esperar y empieza a leer.** Por eso los títulos aparecen antes de que la barra
cuadre, y no al revés. La espera termina cuando hay algo que leer, no cuando
termina la animación.

El compás 4 es la única barra de todo el producto que crece. Aquí el crecimiento
*es* el mensaje: "hemos movido las raciones hasta que cuadró". En cualquier otro
sitio sería decoración; aquí es la explicación del algoritmo en 500 ms.

**Honestidad temporal — las cuatro reglas:**

1. **Nunca se retrasa el resultado para que la animación se luzca.** Si el backend
   responde en 300 ms, no se monta nada: el plan aparece con un fade de 200 ms.
2. **Si la respuesta llega a mitad del compás 2, el barrido termina su ciclo actual
   (máximo 300 ms más) y salta al 3.** Cortar un barrido a la mitad se ve como un
   fallo de renderizado.
3. **El compás 2 puede durar indefinidamente sin mentir**, porque no promete un
   porcentaje. Esa es la razón entera de que no haya barra de progreso.
4. **El paso 4 de la línea de estado no se marca hasta que la respuesta ha
   llegado.** Ninguna interfaz de este producto llega al 100 % antes que el backend.

**Rendimiento:** compases 1–3 sólo con `transform`, `opacity` y `background-position`
(el barrido). El compás 4 anima `width` sobre tres elementos dentro de un
contenedor con `contain: layout paint`; a tres elementos es despreciable. Si se
mide jank en dispositivos lentos, la alternativa es tres capas absolutas con
`scaleX` y `transform-origin: left`.

### 5.5 `prefers-reduced-motion`

**Advertencia técnica, y hay que actuar sobre ella.** El reset global de
`globals.css` fija `animation-duration: 0.01ms` y `animation-iteration-count: 1`.
Para transiciones funciona. **Para el barrido en bucle del compás 2 no basta:** un
degradado que recorre su ciclo en 0,01 ms produce un parpadeo, que es exactamente
el efecto que la preferencia intenta evitar y un riesgo real para usuarios
fotosensibles.

**Regla:** el componente de generación **consulta la media query y no monta la
animación**, en lugar de confiar en el reset global. El reset global es una red de
seguridad, no la implementación.

Con movimiento reducido, la secuencia se sustituye por:

- La línea de estado **sigue cambiando de texto**. Es información, no movimiento, y
  no se retira nunca.
- Las filas de comida quedan estáticas en `--surface-2`. Sin barrido.
- Los títulos aparecen como **cambio instantáneo de contenido**, sin escalonado y
  sin desplazamiento.
- La cinta de macros se dibuja **directamente en su estado final**. Sin crecimiento.
- Los toasts aparecen y desaparecen sólo con opacidad.
- Los tres puntos del veredicto se dibujan ya en su estado final.

**El `aria-live` anuncia exactamente lo mismo en los dos casos.** La accesibilidad
no depende del movimiento, ni al revés.

---

## 6. Microcopy

### 6.1 Las cuatro reglas de la voz

**1. El sistema habla en primera persona y asume la responsabilidad.**
`No consigo llegar a 180 g de proteína con 1 600 kcal`, nunca `No has configurado
bien tus objetivos`. El fallo es del solver. El usuario ha pedido algo legítimo.

**2. Primero la conclusión, después el dato.**
`Te sobra proteína en la cena` antes que `142 g / rango 118–138 g`. Es la capa 1
llevada al texto de interfaz, no sólo al de nutrición.

**3. Ningún adjetivo de mérito.**
Nada de "¡Perfecto!", "¡Genial!", "¡Buen trabajo!". **El producto no juzga lo que
comes.** `Cuadra` es una descripción, no un elogio — y por eso mismo `No cuadra`
no es un reproche. En cuanto una de las dos caras se vuelve emocional, la otra
también, y el producto empieza a dar vergüenza al usuario. Esa línea no se cruza.

**4. Español de España, tuteo, sin imperativos de coach.**
`Puedes cambiarlo cuando quieras`, no `¡Cámbialo ya!`. Cero signos de exclamación
en todo el producto, incluidos los errores. Cero emoji en la interfaz.

**Y la prohibición explícita:** sin rachas, sin medallas, sin niveles, sin
"has roto tu racha de 12 días", sin notificaciones de vergüenza. Si hay un
contador, es descriptivo y sin celebración: `Llevas 9 de los últimos 14 días con
plan seguido.` Punto. Ni felicitación ni reproche.

### 6.2 Glosario fijo

Mismo concepto, misma palabra, siempre. Sin sinónimos "para que no se repita".

| Concepto | Se dice | No se dice |
|---|---|---|
| Producir el plan | **Generar** (botón) · **Montar tu día** (en curso) | Crear, Calcular, Optimizar |
| Cambiar una receta por otra | **Cambiar** | Swap, Sustituir, Re-roll, Rerodar |
| Ver otras opciones | **Alternativas** | Sugerencias, Similares, Parecidas |
| Proteger de la regeneración | **Fijar** | Bloquear, Pin, Anclar |
| El resultado cumple los objetivos | **Cuadra** | Correcto, Óptimo, Perfecto, Conseguido |
| El objetivo del día | **Tu objetivo** | Target, Meta diaria, Goal |
| Lo que ya tienes | **En casa** (badge) · **Despensa** (sección) | Inventario, Stock |
| Energía | **kcal** en cifras · **calorías** en prosa | cals, Cal, calorias |
| Franja de comida | El nombre real: **Desayuno, Comida, Cena…** | Slot, Franja, Toma |
| Cantidad servida | **Ración** | Porción, Serving |

### 6.3 Portada

**Titular elegido** (sale directamente del posicionamiento de `spec.md` §2.3):

> # Tu semana, resuelta.
> Qué comer, cuánto cuesta y qué comprar. Sin listas de sesenta ingredientes.

**Alternativas descartadas, para quien quiera montar un test A/B:**

- `Come bien sin pensarlo.` — Bonito y vacío. No dice qué hace el producto.
- `El planificador que también mira tu presupuesto.` — Diferencia bien, pero
  compara con una categoría que el visitante puede no conocer.
- `Deja de tirar comida.` — Fuerte, pero pone el desperdicio como problema
  principal cuando el motivo real de entrada es comer mejor.

**Botón:** `Ver mi día`. No `Empezar gratis` (habla de negocio, no de valor), no
`Generar plan` (habla del sistema, no del usuario).

**Bajo el botón:** `Sin registro. Tarda unos segundos.`

**Microcopy del selector de actividad** (es el punto exacto donde está el sesgo,
`spec.md` §4.1 — el usuario elige la semana que le gustaría tener):

> Elige tu semana típica, no la más ambiciosa.
>
> - **Casi nada** — trabajo sentado, poco o ningún ejercicio
> - **Poco** — algo de movimiento, 1 o 2 días de ejercicio suave
> - **Normal** — ejercicio moderado 3 o 4 días
> - **Bastante** — entreno duro 5 o 6 días
> - **Mucho** — entreno a diario, o trabajo físico

### 6.4 Nutrición — plantillas de capa 1

Estas son las frases que lee el 80 % de los usuarios. Son la interfaz.

**Por comida:**
> Esta comida cubre el {pct} % de tus calorías del día y aporta {p} g de proteína.

**Por día, según el veredicto del §4.5:**

| Estado | Plantilla |
|---|---|
| Cuadra | `El día cuadra: {kcal} kcal, con los tres macros dentro de tu rango.` |
| Casi (falta) | `Casi. Te faltan {n} g de {macro} para tu rango; lo demás cuadra.` |
| Casi (sobra) | `Casi. Te pasas {n} g de {macro}; lo demás cuadra.` |
| Casi (kcal) | `Te pasas {n} kcal de tu objetivo. Con un margen del ±{tol} % no es nada raro.` |
| No cuadra | `Este día se queda a {n} kcal de tu objetivo. Puedes cambiar una comida o ajustar el objetivo.` |

**Progreso a lo largo del día:**
> Llevas {a} de {b} kcal. Te quedan la merienda y la cena.

**Nota sobre `{macro}`:** siempre en minúscula y en prosa — `proteína`,
`carbohidratos`, `grasa`. Nunca `PROT`, nunca `P`, nunca abreviado en una frase.
Las abreviaturas viven en las etiquetas del gráfico, no en el texto.

### 6.5 Estado de generación

Los cuatro pasos, en `role="status"`:

1. `Calculando tu objetivo del día`
2. `Buscando recetas que encajan` → cuando llega el dato:
   `1 240 recetas encajan con lo que comes`
3. `Ajustando las raciones`
4. `Cuadrando el día`

Espera larga (> 6 s), añadido debajo, no sustituyendo:
> Sigue en marcha. A veces el día cuesta más de cuadrar.

Corte por tiempo (> 20 s):
> Se me ha hecho largo y lo he parado. Tus datos siguen aquí.
> `[Volver a intentarlo]`

Fallo de red:
> No he podido conectar. Tus datos siguen aquí.
> `[Reintentar]`

### 6.6 El plan no cuadra

**Sobre-restricción (mapeo directo a `FalloGeneracion`):**

> ## Con lo que me has dicho, no llego.
>
> *{fallo.mensaje}* — p. ej.: "No consigo llegar a 180 g de proteína con 1 600 kcal
> usando sólo tus recetas recurrentes."
>
> ### 22
> recetas encajan con tus filtros. Necesito unas 40 para montar variedad sin
> repetir.
>
> `[Subir a 1 750 kcal]` `[Bajar a 155 g de proteína]` `[Permitir recetas fuera de mis recurrentes]`
>
> Ninguna de estas opciones se guarda hasta que la elijas.

Los botones salen de `fallo.sugerencias` y **ejecutan el cambio**. Se redactan en
infinitivo desde el punto de vista del usuario (`Subir a…`), no en imperativo del
sistema (`Sube a…`).

**Sin alternativas para un slot:**
> No encuentro más opciones que encajen aquí. Casi siempre es el tiempo de cocina.
> `[Dar 15 minutos más]` `[Quitar el límite de tiempo]`

**Una comida ha fallado dentro de un día que sí ha salido:**
> No he encontrado cena que cuadre con lo que queda del día. El resto está listo.
> `[Ver por qué]` `[Cambiar el resto del día]`

### 6.7 Confirmaciones, avisos y errores

**Toasts** (5 s; 7 s si llevan `[Deshacer]`; `aria-live="polite"`; nunca roban el
foco):

- `Cambiada la comida. He reajustado la cena para que el día siga cuadrando.` `[Deshacer]`
- `Fijada. No la tocaré al regenerar.`
- `Fuera. No te la volveré a proponer.` `[Deshacer]`
- `Movido al jueves.` `[Deshacer]`
- `Guardado. Tienes 12 productos en casa.`

**Confirmación destructiva** (regenerar con la compra hecha, `spec.md` §4.3):

> ### Ya has hecho la compra de esta semana.
> Si regenero, 9 ingredientes que compraste dejan de usarse.
>
> `[Mejor no]` (primario, `--brand`) · `Regenerar igualmente` (texto en `--danger`)

**La acción segura es la primaria visualmente.** La destructiva es un enlace de
texto en `--danger`, no un botón rojo grande. Un botón rojo grande y llamativo se
pulsa por inercia.

**Errores de campo** (bajo la frase, `role="alert"`, siempre con la corrección):

- `Introduce una edad entre 18 y 99. Este producto no está pensado para menores.`
- `¿310 kg? Compruébalo — acepto entre 35 y 250.`
- `La altura en centímetros: 168, no 1,68.`

**Suelo de seguridad calórico** (usa `KCAL_MINIMAS` de `nutricion.ts`):

> Tu objetivo salía por debajo de 1 200 kcal. Lo dejo ahí: bajar más no es seguro
> sin supervisión médica.

**Estados vacíos:**

- Día vacío: `Este día está sin nada.` `[Generar el día]`
- Despensa vacía: `Aquí aparecerá lo que ya tienes en casa. Se llena solo cuando
  marques la compra como hecha.`
- Sin planes guardados: `Todavía no has guardado ningún plan. El de hoy se guarda
  con un tap.`

**Avisos obligatorios** — texto fijo, no se reescribe ni se abrevia ni se pliega:

- **Alérgenos** (en la ficha de receta y en el paso de exclusiones):
  `Filtramos por los ingredientes declarados en nuestro catálogo. No sustituye
  leer la etiqueta del producto que compres.`
- **Nutrición** (donde se muestre el objetivo calculado):
  `Son estimaciones a partir de fórmulas poblacionales (Mifflin-St Jeor). No son
  consejo médico.`
- **Precio**: siempre en rango, nunca exacto. `48–56 € estimado`, jamás `51,34 €`.
  (`spec.md` §9.1.5.)

---

## Anexo A — Hallazgos verificados

Estos números salen de ejecutar herramientas, no de estimarlos. Se documentan
porque cambian decisiones y porque habrá que reproducirlos si alguien toca los
tokens.

**A.1 — Validador de paleta de `dataviz` sobre la triada de macros.**

Tema claro (`#0072b2`, `#e69f00`, `#009e73`):

- Banda de luminosidad: **PASA**
- Suelo de croma: **PASA**
- Separación en daltonismo: **PASA** — peor par adyacente grasa ↔ carbohidratos,
  ΔE 11,4 en protanopia y 27,6 en tritanopia
- Suelo de visión normal: **PASA** — peor par ΔE 24,2
- Contraste contra superficie: **AVISO** — `#e69f00` a 2,19:1, por debajo de 3:1

El aviso **no se dismisses**: obliga a que la barra lleve etiquetas directas
visibles y vista de tabla. Ambas cosas están especificadas en §4.2 y §1.2, así que
la paleta queda conforme. **Si alguien quita las etiquetas de la barra, la paleta
deja de cumplir.** Es la razón real por la que las etiquetas no son opcionales.

Tema oscuro (`#56b4e9`, `#f0b73e`, `#3fc9a0`):

- Banda de luminosidad: **FALLA** — los tres por encima de la banda 0,43–0,77
  (0,735 / 0,811 / 0,752), el amarillo con claridad
- Separación en daltonismo: **PASA** — peor par ΔE 11,0 protan
- Contraste contra superficie: **PASA** — los tres por encima de 3:1

**Lectura y decisión:** la banda del validador está calibrada para marcas sobre
superficie clara. Sobre `#171512` la claridad alta es lo que produce el contraste,
y las otras cinco comprobaciones pasan. **No se cambian los tokens.** Se anota
como desviación aceptada y consciente, con dos mitigaciones que ya están en el
documento: los huecos de superficie de 2 px (§4.2) y el uso de altura fina (6–14 px)
en lugar de bloques grandes. Queda como pendiente de comprobación visual real
(Anexo C).

**A.2 — Contrastes WCAG de los tokens (calculados sobre `globals.css`).**

Hallazgos que importan:

| Token | Claro vs `--bg` | Oscuro vs `--bg` | Consecuencia |
|---|---|---|---|
| `--text-3` | **4,47:1** | 6,09:1 | **Se queda a un pelo de AA (4,5) sobre `--bg` en tema claro.** Regla: `--text-3` sólo sobre `--surface` (4,74:1), o en texto ≥ 18,66 px sobre `--bg`. Para metadatos pequeños sobre el fondo de la página, usar `--text-2` |
| `--carb` | 2,12:1 | 10,02:1 | Nunca como texto en claro. Como marca, exige etiqueta directa |
| `--fat` | 3,23:1 | 8,74:1 | Válido como marca (≥ 3:1), nunca como texto en claro |
| `--protein` | 4,89:1 | 7,90:1 | Válido como marca; como texto sólo cumpliría AA, y la regla es no usarlo |
| `--brand` | 8,31:1 | 8,52:1 | Cómodo en ambos |
| `--warning` | 5,21:1 | 9,52:1 | Cumple AA en ambos |
| `--danger` | 6,16:1 | 8,09:1 | Cumple AA en ambos |
| `--line` | 1,26:1 | 1,37:1 | Sólo decorativo. **Nunca como único indicador** de foco, selección o estado |

`spec.md` §9.5 pide **AAA (7:1) en las cifras nutricionales**: se cumple con
`--text` (16,49 claro / 15,64 oscuro), que es lo que llevan las cifras. `--text-2`
(9,06 / 10,98) también cumple. **`--text-3` no cumple AAA: no puede llevar cifras
nutricionales**, sólo unidades y etiquetas junto a una cifra que sí las cumple.

---

## Anexo B — Lista de comprobación antes de dar por terminada una pantalla

Adaptada de la lista de `ui-ux-pro-max`, recortada a lo que aplica a web y a este
producto.

**Accesibilidad**
- [ ] `:focus-visible` en todo lo interactivo, incluidas las acciones que aparecen
      en hover (`:focus-within` obligatorio en el contenedor)
- [ ] Ningún estado comunicado sólo por color: siempre icono o palabra
- [ ] Objetivos táctiles ≥ 44 × 44 px, con `hitSlop` equivalente si el icono es menor
- [ ] Cifras nutricionales con contraste ≥ 7:1
- [ ] Jerarquía de encabezados secuencial, sin saltos
- [ ] Primitivas nativas: `<details>`, `<dl>`, `<fieldset>/<legend>`, `<table scope>`
- [ ] Errores con `role="alert"`; cambios de estado con `role="status"`
- [ ] Orden de foco = orden visual; foco al contenido tras cambiar de vista

**Datos**
- [ ] Orden de macros: proteína, carbohidratos, grasa. Sin excepción
- [ ] Ninguna cifra sin capa 1 encima; ninguna capa 1 sin capa 2 debajo
- [ ] `tabular-nums` en toda cifra; `kcalPresentables()` en toda kcal
- [ ] Precios en rango
- [ ] Etiquetas directas presentes en toda barra de macros
- [ ] Ninguna leyenda separada, ningún donut, ningún doble eje

**Movimiento**
- [ ] Toda duración sale de un token
- [ ] Sólo `transform` y `opacity`, salvo la excepción documentada de la barra
- [ ] Salida ≈ 65 % de la entrada
- [ ] Toda animación es interrumpible y no bloquea la entrada
- [ ] Probado con `prefers-reduced-motion` activo. **Ningún bucle infinito
      sobrevive con duración 0,01 ms**

**Layout**
- [ ] Probado a 375, 768, 1024 y 1440 px
- [ ] Sin scroll horizontal a 375 px
- [ ] `aspect-ratio` en toda imagen; CLS medido
- [ ] El contenido pegajoso reserva su espacio
- [ ] Todos los espaciados salen de la escala 4/8/12/16/24/32/48/64
- [ ] Separación entre grupos > separación dentro del grupo, por un escalón completo

**Temas**
- [ ] Ambos temas revisados por separado, no inferidos uno del otro
- [ ] Bordes y separadores visibles en los dos
- [ ] Estados de hover, foco y deshabilitado distinguibles en los dos

---

## Anexo C — Pendientes y lo que no se ha podido verificar

Se declara para que nadie lo dé por resuelto.

1. **Licencia de Instrument Serif.** Figura como OFL en Google Fonts. **No se ha
   verificado en el repositorio oficial de la fuente.** Hay que confirmarlo antes
   de producir material de marketing. Si no encajara, la sustituta directa es
   *Newsreader* (OFL, también en Google Fonts, misma función editorial).
2. **La banda de luminosidad del tema oscuro** (Anexo A.1). La decisión es no tocar
   los tokens, pero está pendiente la comprobación que ya pedía
   `decisiones-de-diseno.md`: capturas reales de la vista de plan pasadas por un
   simulador de deuteranopia y protanopia, en los dos temas. Las muestras de
   `/sistema` no bastan porque no tienen la geometría real.
3. **Ninguna medición de rendimiento.** Los `contain`, las duraciones y la
   alternativa de `scaleX` del §5.4 son criterio de ingeniería, no medida. Hay que
   perfilar el compás 4 en un dispositivo lento real antes de darlo por bueno.
4. **La dirección de arte fotográfica no está probada.** Las reglas del §2.5 son
   coherentes y producibles, pero nadie ha hecho todavía un lote de prueba de diez
   platos. Hasta que exista, el coste y el aspecto real del catálogo son una
   estimación.
5. **Los tres estados del veredicto no están validados con usuarios.** La hipótesis
   de que "Casi" es el estado emocional correcto por defecto es razonada, no
   medida. Es lo primero que hay que preguntar en las primeras entrevistas.
6. **La memoria de plegado (§1.4) no tiene datos detrás.** Es una apuesta sobre
   cómo se comporta el usuario que aprende. Instrumentarla desde el día 1: cuántos
   abren la capa 3, cuántos la reabren, cuántos la vuelven a plegar.
