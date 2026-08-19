# Frame packet: 03-dia-real

## Project inputs

- Project: /Users/victorbau_v/PlanEat/videos/planeat-rediseno
- Design tokens: /Users/victorbau_v/PlanEat/videos/planeat-rediseno/frame.md
- RULES_DIR: /Users/victorbau_v/.agents/skills/hyperframes-animation/rules

## Assigned storyboard block

## Frame 3 — Un día real

- scene: Las tres tarjetas de comida (desayuno/comida/cena) con barras de macros azul/ámbar/violeta
- voiceover: ""
- duration: 6s
- transition_in: push-slide RIGHT
- status: outline
- src: compositions/frames/03-dia-real.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: clarity
- blueprint: grid-card-assemble (Adapt)
- asset_candidates: capture/screenshots/home-scroll-030.png — sección "Un día real, no una maqueta": tres tarjetas de comida con barra de macros apilada
- focal: capture/screenshots/home-scroll-030.png
- roles: home-scroll-030.png = cutout (the three-card row, held as one flat surface)
- sfx: none (fully-silent project — no SFX provider available; the clip-path wipe's own pacing carries the arrival)

Adapt: the source is ONE flat screenshot, not three separable card assets — there is no isolated image per meal card to animate independently. Simulate the grid's "cards arrive in sequence" signature move with a progressive left-to-right **clip-path wipe** in 3 steps (one per card's horizontal third) instead of true independent elements. Keep the arrival-in-sequence feeling; do not collapse it into one instant reveal.

Scene 1 (0.0–1.8s): white canvas; the screenshot's card row enters with only its LEFT third visible (clip-path masks the rest) — Rule-of-thirds, left-aligned, ~50% of frame.
Scene 2 (1.8–3.6s): the clip-path widens to reveal the middle card, then (3.6–5.2s) widens again to reveal the right card — each widen on a long-tail settle, reading as one card "arriving" after another.
Scene 3 (5.2–6.0s): full row visible, the three macro-bar colors (blue/amber/violet) hold clean and still — no further motion.

narrativeRole: Primera prueba visual de la paleta de macros nueva, en su hábitat natural (tarjetas reales del catálogo).
keyMessage: Proteína, carbohidratos y grasa — de un vistazo, sin leyenda.
