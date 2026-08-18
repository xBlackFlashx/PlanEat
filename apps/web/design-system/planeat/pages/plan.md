# Page Override: /plan

> Overrides MASTER.md for this route only. Master's color/type/spacing tokens still apply.

**Components in scope:** `plan-cliente.tsx`, `vista-plan.tsx`, `plan-dia.tsx`, `dia-real.tsx`, `panel-receta.tsx`, `macro-bar.tsx`, `barra-progreso-dia.tsx`, `barra-reparto.tsx`, `tabla-nutricional.tsx`, `bloque-nutricional.tsx`, `veredicto.tsx`, `sobre-restriccion.tsx`, `detalle-plegable.tsx`, `estado-generacion.tsx`.

## Correction, 2026-08-17

The first version of this file described a "7-day bento grid" pattern for this page. That was wrong — written before reading the actual components, corrected after. `PlanDia` renders **one day** (sticky compacting header, meal list, undo-capable regeneration). `resultado.dias` is looped in `VistaPlan`, but the shipped product is deliberately a **single-day MVP**: `app/page.tsx`'s own doc-comment says the goal is "que un desconocido vea un día real generado... en menos de sesenta segundos", and the README lists persistence/multi-day/shopping-list explicitly as not built yet. Don't design a 7-card week grid for data the product doesn't generate.

## What's already here — read before touching layout or copy

Checked against the real code (`plan-dia.tsx`, `vista-plan.tsx`, `estado-generacion.tsx`), not assumed. This page's UX is at least as carefully reasoned as the visual system MASTER.md describes, and in the same style: every choice has a documented reason, usually an anti-dishonesty one.

- **`estado-generacion.tsx` progress is driven by real Web Worker events, never a fake timer or percentage.** Four steps, each marked done only when the engine actually says so ("ninguna interfaz de este producto llega al 100% antes que el motor"). Recipe titles land progressively as the engine closes each day, staggered 90ms, and the component explicitly refuses to invent a title it doesn't have yet.
- **A 400ms minimum-duration-before-mount rule already exists** ("no se monta si la respuesta llega antes de 400ms") — it's the caller's job (`mostrarEsqueleto` in `useGeneracion`), not this component's, so don't add a second one here.
- **No seed/debug info is shown in the generation screen, on purpose** — nothing in the component suggests this was an oversight; it fits the "show only what's real" philosophy. Don't add a seed display without confirming that's actually wanted, not just technically possible.
- Sticky header that compacts on scroll (mobile only) — `useCabeceraCompacta` in `plan-dia.tsx`.
- Meal-change and "otro día" share one retry policy: regenerate penalizing what's been seen, 7s/5s auto-dismissing toast, one level of undo (`vista-plan.tsx`).
- Recipe detail opens as a native `<dialog>` sheet/panel (bottom sheet on mobile, side panel on desktop), not a route change — this already **is** "modal over content, glass allowed" from MASTER.md's scoped exception. No change needed.
- `role="status" aria-live="polite"` live regions, hover-and-focus-within revealed per-item actions, always-visible on touch.

## Scope actually executed here (2026-08-17 redesign)

Visual-identity only, per MASTER.md: new color tokens + Poppins/Inter pairing. No structural change to any of the flows above — spot-checked in browser in both themes: macro bar segments (protein/carb/fat), the "Cuadra" verdict chip (now legitimately green + check icon), and the generation-progress screen all render correctly with the new palette. If a real structural UX change is wanted here, it needs its own scoping pass against a concrete problem in this list — not a generic "redesign the flow" pass, which risks breaking things that are already deliberately built this way.
