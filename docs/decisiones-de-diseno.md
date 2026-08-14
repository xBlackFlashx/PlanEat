# Decisiones de diseño

Registro de por qué el sistema visual es como es. Si una decisión se revierte,
se anota aquí en lugar de borrarla — el historial de lo descartado vale tanto
como lo elegido.

Los tokens viven en `apps/web/src/app/globals.css`. Ningún componente declara un
color literal.

---

## Acento de marca: berenjena `#6b3a5b`

**Descartado a propósito:**

- *Verde menta / verde salud.* Es el color por defecto de toda app de nutrición
  y fitness. Comunica "clínico" antes que "comida", y no diferencia nada.
- *Coral / salmón.* Es el acento de Eat This Much y de media categoría.
- *Azul corporativo.* Legible pero sin relación con el dominio.

Berenjena es un color de comida real (berenjena, remolacha, vino), es cálido,
funciona sobre crema y sobre fondo oscuro, y no lo usa ningún competidor
directo. En oscuro se aclara a `#d4a3c2` para mantener contraste sobre el fondo.

## Superficies: neutro cálido, no gris puro

Un gris neutro puro se lee como "no elegido". Las superficies tienen un sesgo
cálido (`#faf8f4` en claro, `#171512` en oscuro) que acompaña al acento y evita
el aspecto de panel de administración.

Las tarjetas de comida se separan **por fondo, no por sombra**. La sombra queda
reservada a elementos flotantes: popovers, diálogos, arrastre.

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
aplicado por la clase `.tnum`, por `[data-numeric]` y por defecto en tablas.

Sin esto, las columnas de gramos se desplazan lateralmente al actualizarse y el
producto se ve amateur en el momento exacto en que el usuario está evaluando si
confiar en los números.

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

El patrón implementado cubre los tres estados reales del usuario:

1. `:root` define la paleta clara completa.
2. `@media (prefers-color-scheme: dark)` la redefine, acotado con
   `:root:not([data-theme="light"])` para que una elección explícita de claro
   gane sobre el sistema.
3. `:root[data-theme="dark"]` la redefine de nuevo para que el interruptor gane
   en la otra dirección.

El script de `layout.tsx` aplica el tema guardado antes del primer pintado; sin
él, quien tenga elegido oscuro ve un destello claro en cada carga.

## Forma y movimiento

- Radios de 10 px. Suficiente calidez sin parecer un juguete.
- Transiciones de 150 ms. Por debajo se sienten bruscas; por encima, lentas.
- `prefers-reduced-motion` respetado globalmente.

---

## Pendiente de decidir

- Tipografía definitiva. Ahora usa Geist (la que trae el andamiaje). La
  especificación sugiere valorar Instrument Sans o Söhne según licencia y
  presupuesto. No es urgente, pero conviene resolverlo antes de producir
  material de marketing.
- Micro-interacción del estado de generación. Es el único momento en que el
  usuario mira y no puede hacer nada; merece personalidad propia.
- Tratamiento visual de la ficha de receta, donde la densidad baja y la foto
  manda. Es el punto donde el sistema actual está menos probado.
