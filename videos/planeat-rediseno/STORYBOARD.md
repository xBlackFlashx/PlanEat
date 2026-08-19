---
format: 1920x1080
duration: 33s
message: "PlanEat tiene una identidad visual nueva: verde de confianza nutricional, Poppins + Inter, y una paleta de macros azul/ámbar/violeta, con soporte claro/oscuro completo."
arc: Cover → Product tour (portada) → Feature reveal (un día real) → Feature reveal (plan + veredicto) → Design-system reveal (/sistema) → Brand outro
audience: usuarios y visitantes de PlanEat
mode: autonomous
music: none
---

## Video direction

- **Palette system** (from `frame.md`, roles not raw hex): `bg` white canvas for every title/outro card; `primary` (#047857 green) carries every accent — eyebrow-style labels, the one accent-line, the outro wordmark; `text` near-black for any headline; `text-muted` for any sub-line. The captured screenshots carry their OWN pixels (already the redesigned green/blue/amber/violet PlanEat palette) — never recolor or filter them; the video's chrome (title cards, canvas around a screenshot) is the only place `frame.md` tokens apply directly.
- **Motion grammar + reveal model**: long-tail `power3` settles everywhere, no bounce/overshoot. This video has **no voiceover** (silent, `music: none`) — reveals pace to an even internal rhythm instead of a spoken cue: nothing dumps at t=0, each frame builds across its duration in 2–3 windows, and the LAST ~30–40% of every frame is a held read (content resolved, at most subtle jitter). Same anti-front-load discipline as a narrated video, just clocked to the shot's own duration instead of a VO track.
- **Rhythm / held-frame allocation**: Frame 1 (cover) and Frame 6 (outro) are calm, mostly-static holds by design (titlecard-reveal / logo-assemble-lockup are breather shapes). Frame 4 (the "Cuadra" verdict) is the video's climax — its camera move lands and HOLDS still on the verdict card for the back half; that stillness is deliberate, not a missed opportunity for more motion.
- **Negative list**: no synthetic cursor, no fake click/hover interaction anywhere — every screenshot is a real, already-rendered state (this is a show-it-as-is capture, not a UI reconstruction); no recoloring/filtering the captured screenshots; no browser chrome/URL bar added around a screenshot; no lazy breathing/looping; no particle/gradient "AI" decoration (off-brand for this product); no pan/push in a frame's back half beyond the one deliberate camera move already named for that frame.

## Frame 1 — Cover

- scene: Título de marca sobre fondo limpio — "PlanEat" + una línea de tagline anunciando el rediseño
- voiceover: ""
- duration: 3s
- transition_in: cut
- status: animated
- src: compositions/frames/01-cover.html
- type: hook
- persuasion: Future pacing
- beat: curiosity
- blueprint: titlecard-reveal (Adapt)
- asset_candidates:
- focal: none (pure typography — frame.md tokens only)
- roles: —
- sfx: none

Adapt: keep the signature single-restrained-move card reveal; no product/proof card follows in this frame (the "product" is the rest of the video) — just the wordmark + tagline as one calm beat, not the blueprint's full multi-card chain.

Scene 1 (0.0–1.2s): solid white canvas; "PlanEat" wordmark (Poppins, `text` role, centered, ~30% of frame width) fades + slides up into center on a long-tail settle — Centered template, low density on purpose.
Scene 2 (1.2–3.0s): a short tagline line ("Nueva identidad visual.", Inter, `text-muted`) reveals directly beneath the wordmark via a soft crossfade, then both hold dead still — at most subtle jitter on the wordmark. No camera move.

narrativeRole: Abre con la marca sola, sin UI todavía — establece que lo que viene es un reveal de identidad, no un tutorial de producto.
keyMessage: PlanEat, de nuevo.

## Frame 2 — Portada

- scene: La portada real — "Tu semana, resuelta." y el generador con los campos subrayados en verde
- voiceover: ""
- duration: 6s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/02-portada.html
- type: product_intro
- persuasion: Show-don't-tell proof
- beat: clarity
- blueprint: device-surface-showcase (Reproduce)
- asset_candidates: capture/screenshots/home-full-page.png — home page (`/`) full scroll: hero "Tu semana, resuelta." + generador con campos subrayados en verde
- focal: capture/screenshots/home-full-page.png
- roles: home-full-page.png = cutout (held hero surface, no browser chrome added)
- sfx: none (fully-silent project — no SFX provider available; the zoom-through's visual weight carries the beat alone)

Reproduce: one real screen held as the hero surface, slow considered camera move revealing detail, no cursor.

Scene 1 (0.0–2.0s): the screenshot's TOP crop (hero headline + first form field) enters centered, slightly scaled up (~105%), settling on a long-tail decel — Centered/full-bleed, ~70% of frame, thin white margin.
Scene 2 (2.0–5.2s): slow **push/focus** camera move (`multi-phase-camera`) drifts the crop downward at a measured pace to reveal the rest of the generator form (the green-underlined fields) — this is the frame's one camera move, not a back-half re-push.
Scene 3 (5.2–6.0s): motion settles, holds on the fully-visible form — still, at most subtle jitter.

narrativeRole: Primer contacto con la app real, en el sitio donde el usuario realmente aterriza.
keyMessage: Así se ve la portada ahora.

## Frame 3 — Un día real

- scene: Las tres tarjetas de comida (desayuno/comida/cena) con barras de macros azul/ámbar/violeta
- voiceover: ""
- duration: 6s
- transition_in: push-slide RIGHT
- status: animated
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

## Frame 4 — El plan cuadra

- scene: Un día generado real, con el veredicto "✓ Cuadra" en verde y la barra de macros del día
- voiceover: ""
- duration: 7s
- transition_in: crossfade
- status: animated
- src: compositions/frames/04-plan-cuadra.html
- type: feature_showcase
- persuasion: Statistical proof
- beat: confidence
- blueprint: device-surface-showcase (Adapt)
- asset_candidates: capture/screenshots/plan-full-page.png — `/plan` con un día generado real: tres comidas a la izquierda, tarjeta de resumen a la derecha con "✓ Cuadra" en verde y barra de macros del día
- focal: capture/screenshots/plan-full-page.png
- roles: plan-full-page.png = cutout (held hero surface)
- sfx: none (fully-silent project — no SFX provider available; the hold itself carries the climax)

Adapt: instead of a scroll-reveal, this frame's one camera move is a **zoom-to-target** (`coordinate-target-zoom`) that travels from the full layout to the verdict card specifically — this IS the video's climax, so the move earns a genuine held landing rather than just another pan.

Scene 1 (0.0–2.2s): the full screenshot (both columns — meal list + summary card) enters centered, slightly scaled down (~95%) so both columns read at once — Split/asymmetric, full layout visible, low motion.
Scene 2 (2.2–5.5s): **zoom-to-target** (`coordinate-target-zoom`) — the camera scales + counter-translates toward the summary card's "✓ Cuadra" region on the right, arriving framed and legible; this is the frame's only camera move.
Scene 3 (5.5–7.0s): hard hold on the verdict card, green check + macro bar fully legible — dead still, at most subtle jitter. This is the deliberate climax hold named in Video direction.

narrativeRole: El momento de mayor peso semántico del nuevo verde de marca — "cuadra" ya no compite con ningún macro.
keyMessage: Verde significa que el día cuadra. Nada más lo usa.

## Frame 5 — El sistema detrás

- scene: Swatches de marca y macros, y la escala tipográfica Poppins/Inter, de la página /sistema
- voiceover: ""
- duration: 7s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/05-sistema.html
- type: feature_showcase
- persuasion: Authority by association
- beat: trust
- blueprint: device-surface-showcase (Adapt)
- asset_candidates: capture/screenshots/sistema-full-page.png — página completa: tipografía, superficies, marca y estados; capture/screenshots/sistema-scroll-032.png — swatches de macronutrientes (protein/carb/fat) con sus ratios de contraste
- focal: capture/screenshots/sistema-full-page.png
- roles: sistema-full-page.png = cutout (the scrolling document surface); sistema-scroll-032.png = supporting (the macro-swatch crop the scroll lands on)
- sfx: none (this beat is deliberately quieter than Frame 4's climax)

Adapt: `/sistema` is a genuinely long page — use the **3D page-scroll reveal** move (`3d-page-scroll`) instead of a flat push, since that's exactly what it's built for (a tall document whose sections reveal via simulated scroll). Starts on the typography scale (top of `full-page.png`), scrolls down to land on the macro swatches (matching `scroll-032.png`'s content).

Scene 1 (0.0–2.0s): the full-page screenshot mounts as a tilted 3D surface (slight perspective, per the blueprint's signature), framed on its TOP section — the Poppins/Inter type scale — Centered-tilted, ~65% of frame.
Scene 2 (2.0–5.5s): **3D page-scroll reveal** (`3d-page-scroll`) — the surface's internal content scrolls downward at a measured pace past the color-token tables, landing framed on the macronutrient swatches (protein/carb/fat) — the frame's one camera/scroll move.
Scene 3 (5.5–7.0s): settle flat (perspective eases back toward front-on) and hold on the macro swatches, legible and still.

narrativeRole: Sube un nivel de abstracción — muestra que el look no es solo una pantalla bonita, es un sistema con reglas.
keyMessage: No es un color. Es un sistema, y cada pieza está medida.

## Frame 6 — Outro

- scene: Wordmark "PlanEat" centrado, cierre de marca
- voiceover: ""
- duration: 4s
- transition_in: crossfade
- status: animated
- src: compositions/frames/06-outro.html
- type: brand_outro
- persuasion: Future pacing
- beat: inevitability
- blueprint: logo-assemble-lockup (Adapt)
- asset_candidates:
- focal: none (pure typography — frame.md tokens only)
- roles: —
- sfx: none

Adapt: no separate logo mark exists (PlanEat's brand IS its wordmark, per `frame.md`/capture notes) — the "assemble" signature becomes the wordmark's own letters settling into place, not icon pieces converging onto a mark.

Scene 1 (0.0–1.6s): white canvas; "PlanEat" (Poppins, `text` role, large, centered) settles into frame on a long-tail decel from a slightly lower/smaller start — Centered, high hierarchy, nothing else on screen.
Scene 2 (1.6–4.0s): the accent-line (small `primary`-green rule) draws in beneath the wordmark on a self-draw move, then everything holds dead still to the final frame — this frame's exit is the render's actual end, so the hold carries to black/end rather than another transition.

narrativeRole: Cierre limpio en la marca — sin CTA transaccional, porque no hay nada que comprar (el propio producto lo dice: "gratis porque no hay nada que vender").
keyMessage: PlanEat.
