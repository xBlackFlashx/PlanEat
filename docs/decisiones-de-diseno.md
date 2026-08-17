# Decisiones de diseño

Registro de por qué el sistema visual es como es. Si una decisión se revierte,
se anota aquí en lugar de borrarla — el historial de lo descartado vale tanto
como lo elegido.

Los tokens viven en `apps/web/src/app/globals.css`. Ningún componente declara un
color literal. La referencia viva es `/sistema`.

---

## Acento de marca: berenjena `#6b3a5b` (revisado a índigo `#4338ca`)

**Revisado.** No se borra la decisión original porque el motivo de fondo sigue
vigente: se anota la nueva encima, como pide la cabecera de este documento.

**Descartado a propósito, entonces y ahora:**

- *Verde menta / verde salud.* Es el color por defecto de toda app de nutrición
  y fitness. Comunica "clínico" antes que "comida", y no diferencia nada.
- *Coral / salmón.* Es el acento de Eat This Much y de media categoría.
- *Azul corporativo.* Legible pero sin relación con el dominio.
- *Verde/teal de "salud" genérico.* Motivo nuevo, añadido en la revisión: una
  búsqueda de paletas para "producto de nutrición" devuelve casi siempre
  verde o teal como acento. Aquí ese hueco ya está ocupado por el macro de
  grasa (`--fat`); ponerlo también de marca haría indistinguibles el color de
  la interfaz y el color de un dato, justo el error que la sección de
  Macronutrientes existe para evitar.

Berenjena era un color de comida real (berenjena, remolacha, vino), cálido, y
no lo usaba ningún competidor directo. Se revisa igualmente porque un pedido
explícito de rediseño completo (color, tipografía, distribución) es la
ocasión de comprobar si sigue siendo la mejor opción, no sólo de conservarla
por inercia.

**Índigo** cumple las mismas dos condiciones duras —no coincide con ningún
macro, no es el verde/coral/azul-corporativo ya descartados— y añade una
tercera: es un tono que ninguna paleta de "salud" genérica ofrece por
defecto (la búsqueda de referencia sobre 192 paletas del catálogo devolvió
verde o teal en prácticamente todos los resultados para "nutrición"), así
que sigue sin parecerse a ningún competidor directo ni a la plantilla por
defecto de la categoría.

Contraste verificado con la misma fórmula WCAG del Anexo A.2 de
`diseno-producto.md` (relative luminance, no una herramienta de terceros):

| Par | Claro | Oscuro |
|---|---|---|
| `--on-brand` sobre `--brand` (botón) | 7,90:1 | 6,78:1 |
| `--brand` sobre `--bg` (enlace) | 7,40:1 | 7,52:1 |
| `--brand` sobre `--brand-soft` (etiqueta de chip) | 6,72:1 | 6,23:1 |

Las superficies neutras se revisan a la vez (ver "Superficies", debajo): un
fondo cálido y un acento frío convivían mal.

## Superficies: gris frío de índigo, no gris puro (revisado de "neutro cálido")

**Revisado junto con el acento.** Un gris neutro puro se sigue leyendo como
"no elegido" — eso no cambia —, pero el sesgo cálido que acompañaba a la
berenjena (`#faf8f4` en claro, `#171512` en oscuro) chocaba con un acento
frío como el índigo. El sesgo ahora es frío, hacia el mismo índigo
(`#f7f7fb` en claro, `#0e0e16` en oscuro): la superficie sigue sin ser gris
puro, sigue evitando el aspecto de panel de administración, y ahora
acompaña al acento en vez de tironear contra él.

`--text-3`, la única superficie de texto con margen estrecho, se recalculó
igual: 5,02:1 sobre `--surface` y 4,70:1 (sólo texto grande) sobre `--bg` en
claro — con margen sobre el mínimo AA, no al límite como antes.

Las tarjetas de comida se separan **por fondo, no por sombra**. La sombra queda
reservada a elementos flotantes: popovers, diálogos, arrastre. Esto no cambia
con la revisión.

## Colores de macronutriente: triada Okabe-Ito

| Macro | Claro | Oscuro |
|---|---|---|
| Proteína | `#0072b2` | `#56b4e9` |
| Carbohidratos | `#e69f00` | `#f0b73e` |
| Grasa | `#009e73` | `#3fc9a0` |

Tomados de la paleta de Okabe e Ito, diseñada específicamente para ser
distinguible en deuteranopia y protanopia. No es una elección estética: entre el
7 y el 8 % de los hombres tiene alguna deficiencia de visión del color, y estos
tres tonos aparecen juntos en cada pantalla del producto.

Requisitos que cumplen y hay que preservar si alguien los cambia:

1. Distinguibles entre sí en deuteranopia y protanopia.
2. Ninguno coincide con el acento de marca.
3. Funcionan sobre fondo claro y oscuro.
4. Son los mismos en todo el producto: se aprenden una vez, sin leyenda.

**Sin cambios en la revisión a índigo.** Los tres tonos Okabe-Ito no se tocan:
cambiar un color validado contra deuteranopia y protanopia sin un motivo
funcional invalidaría esa validación sin necesidad. Lo único recalculado son
los tintes `*-soft` (el fondo suave de cada franja), porque cambiaron las
superficies contra las que se miden — ver "Superficies" arriba.

**Pendiente:** verificarlos con un simulador de daltonismo sobre capturas reales
de la vista de plan, no sólo sobre las muestras de `/sistema`.

## "Éxito" no usa verde

El verde ya significa *grasa* en este producto. Un toast verde de confirmación
junto a una barra de macros crea ambigüedad justo donde el usuario está
aprendiendo el código de color.

Los estados de éxito usan el acento de marca con un icono. El rojo queda
reservado en exclusiva a error.

## Números tabulares, siempre

Toda cifra nutricional o de precio lleva `font-variant-numeric: tabular-nums`,
aplicado por la clase `.tnum`, por `[data-numeric]`, por defecto en tablas y por
la utilidad `.cifra`, que además pone el peso 600.

Sin esto, las columnas de gramos se desplazan lateralmente al actualizarse y el
producto se ve amateur en el momento exacto en que el usuario está evaluando si
confiar en los números.

**Medido, no supuesto** (Chrome sin cabeza sobre el sitio ya construido, Geist a
15 px, anchura del texto):

| Texto | Con `tabular-nums` | Sin ella |
|---|---|---|
| `1111111111` | 90,00 px | 52,20 px |
| `0000000000` | 90,00 px | 100,81 px |
| `1.111 kcal` | 71,25 px | 55,88 px |
| `1.847 kcal` | 71,25 px | 66,70 px |

Es decir: dos valores consecutivos de la misma celda cambian de anchura casi
11 px al actualizarse si la fuente no aplica `tnum`. `/sistema` enseña las
cuatro filas juntas para que el fallo sea visible y no haya que fiarse de esta
tabla.

## Barra apilada, nunca donut

Para el reparto de macros:

- La barra permite marcar el objetivo en el eje. El donut no.
- La barra funciona a 320 px de ancho. El donut se vuelve ilegible.
- La barra se compacta en móvil sin perder información.

Y no se oculta en móvil: es justo donde más se consulta.

**Regla general:** si un gráfico necesita leyenda separada, ha fallado. Las
etiquetas van dentro o al lado, con su color.

## Tema oscuro desde el primer commit

No es una preferencia estética. La app se usa en la cocina, de noche y con el
móvil en la mano. Retrofitear un tema oscuro sobre componentes que asumen fondo
claro cuesta aproximadamente el triple que construirlo desde el inicio.

El patrón cubre los tres estados reales del usuario, y la regla que los ordena
es que **la elección explícita gana sobre el sistema en ambas direcciones**.

### Cómo se implementa (revisado)

La primera versión usaba tres bloques de declaraciones: `:root` con la paleta
clara, un `@media (prefers-color-scheme: dark)` acotado con
`:root:not([data-theme="light"])`, y un `:root[data-theme="dark"]`. Funcionaba,
pero los dos últimos eran **34 líneas duplicadas carácter a carácter**:
cualquier retoque de un color oscuro había que hacerlo dos veces y nada lo
verificaba.

Ahora la paleta se escribe **una sola vez** con `light-dark()`, y los tres
estados son tres declaraciones de `color-scheme`:

| Estado | `color-scheme` | Resultado |
|---|---|---|
| Sin `data-theme` | `light dark` | manda el sistema |
| `data-theme="light"` | `light` | gana la elección, aunque el sistema esté en oscuro |
| `data-theme="dark"` | `dark` | gana la elección, aunque el sistema esté en claro |

El patrón de tres estados queda intacto — es literalmente el mismo, expresado en
tres líneas en vez de en tres bloques.

**Y resuelve de paso un defecto que estaba en la primera pantalla:** no había
ninguna declaración de `color-scheme`. Sin ella, los controles nativos —la rueda
del `<select>` del generador, las barras de scroll, el autofill— se pintaban en
claro sobre el tema oscuro. El `<select>` nativo se eligió precisamente porque
abre la rueda del sistema; había que decirle al sistema de qué color es.

**Descartado:**

- *Dejar los dos bloques duplicados con un comentario cruzado.* Es lo que
  proponía la auditoría como mínimo aceptable. Se descarta porque un comentario
  no impide el olvido: sigue siendo un cambio que hay que hacer dos veces.
- *Extraer la paleta oscura a un fichero importado dos veces.* Quita la
  duplicación en el fuente pero no en la salida, y añade un fichero cuyo único
  motivo de existir es una limitación de la cascada.
- *La variante `dark:` de Tailwind.* Sólo mira `prefers-color-scheme`, así que
  ignoraría la elección explícita. No se usa en ningún componente y no debe
  usarse: todo color sale de un token, y el token ya sabe en qué tema está.

**Lo que se paga y hay que saber:** `light-dark()` es Baseline desde 2024
(Chrome 123, Safari 17.5, Firefox 120). En un navegador anterior los colores
quedan sin valor y la página se ve sin estilar, no medio estilada. Es un riesgo
asumido para un producto que se publica en 2026; si algún día hay que soportar
navegadores de 2023, la salida es volver a los dos bloques duplicados, no un
apaño intermedio.

**Verificado** en Chrome sin cabeza sobre el sitio ya exportado, midiendo el
color calculado en los cuatro cruces posibles de sistema × elección: los cuatro
dan el fondo, el texto, el acento y la sombra correctos, y `color-mix()`
—que Tailwind usa para `bg-surface/95`— resuelve bien con `light-dark()` dentro.

El script de `layout.tsx` aplica el tema guardado antes del primer pintado; sin
él, quien tenga elegido oscuro ve un destello claro en cada carga.

## Tipografía: Inter para el trabajo, Space Grotesk para la voz (revisado de Geist / Instrument Serif)

**Revisado.** La decisión original (Geist / Instrument Serif) queda íntegra
más abajo, marcada como histórica: el reparto de papeles — una fuente hace
todo el trabajo, otra pone la voz en un puñado de sitios — no cambia, sólo
las dos familias concretas.

| Papel | Fuente | Uso exacto |
|---|---|---|
| **Trabajo** | Inter (variable, 100–900) | Toda la interfaz, todo el cuerpo, **todos los números** |
| **Voz** | Space Grotesk 400 | Sólo cuatro sitios: H1 de portada, título de ficha de receta, titular de sobre-restricción y su cifra héroe |

Las mismas cuatro restricciones que mandaban sobre el gusto la vez anterior,
comprobadas otra vez sobre el fichero real de cada fuente descargado de
Google Fonts (`fontTools.ttLib`, tabla `GSUB` y `cmap`; no supuesto por
reputación):

1. **Números tabulares de verdad.** Inter trae la feature OpenType `tnum`
   —confirmado en la tabla `GSUB` del fichero, junto a `pnum`, `dnom`, `numr`,
   `frac`—, así que `font-variant-numeric: tabular-nums` sigue funcionando.
2. **Licencia libre y servible desde `next/font` sin coste ni gestión.** Las
   dos son **OFL 1.1** (`github.com/rsms/inter`,
   `github.com/floriankarsten/space-grotesk`), autoalojadas en
   `_next/static/media`.
3. **Legible a 13–15 px en móvil.** Inter está diseñada específicamente para
   interfaz de pantalla, con x-height alta; es donde mejor está.
4. **Castellano completo.** Comprobado sobre el `cmap` de ambos ficheros:
   cubren `á é í ó ú ü ñ` y sus mayúsculas, y además `¿ ¡ « » — €`.

**Por qué género distinto en la voz, no otro serif.** Las dos candidatas
serif que ya se habían descartado (Playfair Display por "lee a boda",
Calistoga por "lee a cartel de food truck") fallaban por el mismo motivo:
tono equivocado para un producto que dice explícitamente "no somos un
recetario". Una tercera candidata serif corría el mismo riesgo. Space
Grotesk cambia de género —grotesca de display, no serif— y con eso se sale
de esa familia de problemas en vez de esquivarla por casualidad. Sigue
siendo **una sola voz en un puñado de sitios**, el mismo mecanismo de
antes: el contraste con Inter no viene de serif contra sans, viene de la
geometría distintiva de Space Grotesk (el descendente de la «g», la «S»)
contra una grotesca de interfaz neutra.

**Descartado (revisión):**

- *Playfair Display, Calistoga.* Se reafirma el descarte anterior — mismo
  motivo, ver arriba.
- *Emparejamientos con una tercera familia mono para etiquetas de dato*
  (p. ej. Space Grotesk + Inter + JetBrains Mono). Un fichero de fuente más
  para un uso que `tabular-nums` sobre Inter ya resuelve es exactamente el
  motivo por el que se retiró Geist Mono (ver abajo); no se repite el error.

**Sin mono.** Sigue sin cargarse ninguna: nada en `src/` la necesita todavía.
Motivo histórico (Geist Mono): se cargaba en todas las rutas para una sola
etiqueta `<code>` de `/sistema`. §2.2 reservaba una mono para "códigos de
plan en soporte"; cuando eso exista, se carga y se anota aquí.

<details>
<summary>Decisión original (Geist / Instrument Serif), histórica</summary>

**Decidida** en su momento. Antes estaba en "pendiente de decidir" con Geist
puesta por defecto del andamiaje de Next. `diseno-producto.md` §2.2 ya había
razonado el reparto; aquí se cerró con las comprobaciones que faltaban.

| Papel | Fuente | Uso exacto |
|---|---|---|
| Trabajo | Geist (variable, 100–900) | Toda la interfaz, todo el cuerpo, todos los números |
| Voz | Instrument Serif 400 + itálica | Los mismos cuatro sitios de la tabla de arriba |

1. Números tabulares: Geist traía `tnum` (sus cifras proporcionales de
   partida median 384/663 milésimas de eme el «1» y el «0»).
2. Licencia OFL 1.1 verificada en `github.com/vercel/geist-font` y
   `github.com/Instrument/instrument-serif`.
3. Legible a 13–15 px en móvil.
4. Castellano completo.

Descartadas entonces: *Söhne* (de pago, no justificado sin ingresos),
*Playfair Display* ("lee a boda"), *Calistoga* ("lee a cartel de food
truck"), *sólo Geist* (correcto pero sin memoria de marca), *Newsreader*
(sustituta de reserva que dejó de hacer falta).

</details>

### Escala tipográfica: once tokens, una clase por token

Los once tokens de §2.2 (`voz-1`, `voz-2`, `t-1`, `t-2`, `t-3`, `cuerpo`,
`cuerpo-sm`, `etiqueta`, `micro`, `cifra-heroe`, `cifra`) existen ahora como
utilidades con el nombre exacto de la tabla. Antes no existían y cada componente
inventaba su tamaño con un valor arbitrario: `text-[34px]`, `text-[17px]`,
`text-[15px]` en siete sitios, `text-[13px]`, `text-[19px]`…

Son `@utility` y no claves `--text-*` de Tailwind porque cuatro de ellos llevan
algo que una clave `--text-*` no sabe expresar: la familia distinta de la voz, la
versal de `micro` y los números tabulares de las cifras. Partirlos en "una clave
para el tamaño y una clase para lo demás" daba dos vocabularios para lo mismo y
garantizaba que alguien usara la mitad.

**Desviación consciente:** la tabla de §2.2 da dos columnas, móvil y escritorio.
Aquí el tamaño es fluido con `clamp()` entre esos dos valores exactos,
interpolando de 375 px a 1024 px de ancho de ventana. El motivo es práctico: con
dos columnas cada componente tendría que escribir `t-1 sm:t-1-escritorio`, que
es justo la verbosidad que veníamos a quitar, y basta que alguien olvide la
mitad para que la escala se rompa en silencio. Los extremos son los de la tabla
—comprobados en navegador a 375, 1024 y 1440 px—; lo que cambia es que entre
medias interpola en vez de saltar. La parte fija va en `rem` para que el texto
siga respondiendo al tamaño de fuente del navegador (WCAG 1.4.4).

**`micro` usa versal, no versalita.** §2.2 pedía versalita. Ni Geist ni Inter
traen tabla `smcp` — comprobado sobre el fichero de cada fuente con
`fontTools`: las features de Inter son `calt ccmp dnom frac locl numr pnum
tnum`, sin `smcp` igual que Geist. Sin ella, `font-variant-caps` sólo puede
sintetizar la versalita escalando las mayúsculas, y a 12 px eso se ve sucio y
desigual. Se usa versal con tracking abierto, que es lo que la versalita
venía a conseguir aquí: distinguir la cabecera de sección sin subir de
tamaño. Si algún día la voz de marca pide versalita de verdad, hay que
cambiar de fuente de trabajo, no forzar ésta.

## Forma y movimiento

- Radios de 10 px (7 y 14 los otros dos escalones). Suficiente calidez sin
  parecer un juguete.
- Transiciones de 150 ms genéricas, más la tabla de `diseno-producto.md` §5.1:
  120 / 220 / 320 / 500 ms. Ningún componente declara una duración propia.
- Regla de asimetría: la salida dura ≈ 65 % de la entrada.
- `prefers-reduced-motion` respetado globalmente.

**Los tokens de forma y movimiento ya están expuestos a Tailwind.** No lo
estaban, y por eso todo el código escribe `rounded-[var(--radius-lg)]` en vez de
una clase corta. Ahora existen `rounded-sm` / `rounded-base` / `rounded-lg`,
`ease-entrada` / `ease-salida` / `ease-suave` y `dur-rapida` / `dur-media` /
`dur-lenta` / `dur-cuadre`, más `shadow-pop`.

Dos detalles que no son obvios y conviene no descubrir a golpes:

- **Los radios pisan a propósito las claves homónimas de Tailwind.** Declarar
  `--radius-sm: 7px` y `--radius-lg: 14px` hace que `rounded-sm` y `rounded-lg`
  signifiquen los radios de este sistema y no los de la librería. Es deliberado:
  un sistema de diseño no puede tener dos escalas de radio compitiendo.
- **Las duraciones se declaran a mano** porque Tailwind no tiene espacio de
  nombres para `duration-*`: sólo acepta números. Cada clase escribe también
  `--tw-duration`, igual que hace la utilidad `duration-*` de la librería, para
  que `transition` no la pise.

El bloque usa `@theme static` y no `:root`, y eso importa: sin `static`, Tailwind
sólo emite las variables cuyas clases ve usadas, y `planeat.module.css` es un
CSS Module que Tailwind no escanea y que consume `var(--dur-media)`,
`var(--ease-suave)`, `var(--radius-lg)` y `var(--shadow-pop)` directamente. Sin
`static` se caerían sin que nada fallara en el build.

## Las reglas base van dentro de `@layer base`

No es cosmético y arregla dos defectos reales. Tailwind mete sus utilidades en
`@layer utilities`, y en la cascada **cualquier declaración sin capa gana a
cualquier declaración en capa, con independencia de la especificidad**. Con las
reglas globales fuera de toda capa pasaban dos cosas:

1. `:focus-visible` llevaba un `border-radius: var(--radius-sm)` que machacaba la
   clase `rounded-*` del elemento enfocado con teclado. El botón principal
   pasaba de 10 a 7 px al tabular, y un `rounded-full` habría pasado de círculo a
   cuadrado redondeado.
2. El `outline-none` de la zona de resultado perdía contra el `outline` de
   `:focus-visible`. Al enviar el formulario con Enter aparecía un rectángulo
   berenjena de 2 px alrededor de todo el plan, justo en el momento en que
   aparece.

Metidas en `base`, las utilidades vuelven a ganar y los dos desaparecen. Además
se quitó el `border-radius` de la regla de foco, que sobraba de todas formas: el
`outline` ya sigue la forma del elemento en los navegadores actuales.
Comprobado en navegador: al enfocar, el botón de radio base sigue en 10 px, el
redondo sigue redondo, y un contenedor con `outline-none` no dibuja contorno.

El reset de `prefers-reduced-motion` también vive en `base`, y ahí gana más que
fuera: para las declaraciones `!important` el orden de capas se invierte, así que
desde `base` vence incluso a un `!important` que viniera de una utilidad.

---

## Pendiente de decidir

- Micro-interacción del estado de generación. Es el único momento en que el
  usuario mira y no puede hacer nada; merece personalidad propia.
- Tratamiento visual de la ficha de receta, donde la densidad baja y la foto
  manda. Es el punto donde el sistema actual está menos probado.
- Estado deshabilitado. Hoy se resuelve con `disabled:opacity-60` sobre el botón
  de marca: `--on-brand` sobre `--brand` da 8,82:1 a plena opacidad y al 60 %
  cae a aproximadamente 3:1, por debajo de AA para 17 px. Hace falta un par de
  tokens `--brand-disabled` / `--on-brand-disabled` con contraste medido, en vez
  de opacidad. Toca componentes, así que no se ha hecho en el pulido del sistema.

## Pendiente de limpieza (decidido, no aplicado)

Lo de aquí abajo ya está decidido; sólo falta pasar por los componentes, y no se
ha hecho porque hay más de un agente trabajando dentro del árbol.

- **Migrar los valores arbitrarios a las clases nuevas.** Los componentes siguen
  escribiendo `rounded-[var(--radius-lg)]`, `text-[17px]`, `text-[15px]`… Las
  utilidades cortas y los once tokens tipográficos ya existen; nadie los usa
  todavía fuera de `/sistema`.
- **Aplicar la voz en sus cuatro sitios.** Hoy los cuatro están en Geist
  semibold: H1 de portada, título de ficha de receta, titular de
  sobre-restricción y su cifra héroe. La clase `voz-1` / `voz-2` está lista y
  lleva la familia dentro, para que sea imposible pedir el tamaño de la voz y
  quedarse con la fuente de trabajo.
- **Retirar los escalones de radio sobrantes de Tailwind** (`rounded-md`,
  `rounded-xl`…). Se pueden borrar con `--radius-*: initial`, pero eso rompe en
  silencio cualquier componente que los use, así que primero hay que migrarlos.
- **`viewport.themeColor` sólo reacciona a `prefers-color-scheme`.** Si el
  usuario elige claro con el sistema en oscuro, el color del cromo del navegador
  se queda oscuro. Se arregla desde el script de tema, no desde el CSS.
