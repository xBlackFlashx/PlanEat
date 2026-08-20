---
workflow: product-launch-video
flow: automation
storyboard: no
message: "PlanEat tiene una identidad visual nueva: verde de confianza nutricional, tipografía Poppins/Inter, y una paleta de macros azul/ámbar/violeta, con soporte completo de tema claro/oscuro."
destination: youtube
aspect: 1920x1080
language: es
audience: "usuarios y visitantes de PlanEat"
length: 35s
angle: "reveal directo del rediseño — sin comparación antes/después"
---

## Intent

Mostrar el rediseño visual completo de PlanEat (app de planes de comida) tal
cual se ve hoy: pantallas reales capturadas de la app corriendo en
`http://localhost:3999`, no visuales inventados. Es un reveal de producto,
silencioso o con música de fondo ligera — sin voz en off. El tono sigue la
propia marca: preciso, sin exagerar, sin imagenería de stock.

## Assets

- No hay assets propios del usuario (logo, clips, música) más allá de la app
  misma. Capturar la app en vivo es la fuente de material.
- /Users/victorbau_v/PlanEat/apps/web/design-system/planeat/MASTER.md — spec
  de diseño del rediseño (tokens de color, tipografía) a usar como referencia
  de marca para el propio video (Paso 2, en vez de un preset genérico
  sin relación).

## Customizations

- Qué capturar, en este orden:
  1. Portada (`/`) — titular "Tu semana, resuelta." y el generador con los
     campos subrayados en verde.
  2. Sección "Un día real, no una maqueta" — las tres tarjetas de comida
     (desayuno/comida/cena) con barras de macros azul/ámbar/violeta.
  3. Un plan generado real (flujo del generador → "Ver mi día") hasta el
     veredicto "✓ Cuadra" en verde con la barra de macros del día.
  4. `/sistema` (Sistema de diseño) — swatches de marca/macros/texto y la
     escala tipográfica Poppins/Inter.
  5. Opcional si aporta valor: el toggle de tema claro/oscuro en acción.

## Notes

- No hay que capturar ni reconstruir el look anterior (índigo): el ángulo es
  reveal directo, no antes/después.
- La app corre en local (`localhost:3999`, dev server ya activo) — no es un
  dominio público.
