# Asset Descriptions (consolidated — 3 pages captured)

⚠️ GEMINI_API_KEY not set — descriptions below are catalog-derived (alt text, headings, section context, filename), not Vision-generated.

This is a **show-it-as-is** capture of three routes of the same Next.js app (PlanEat), merged into one canonical inventory because the CLI captures one URL per run. Source URLs: `http://localhost:3999/` (home), `http://localhost:3999/plan` (plan — captured with the form's own defaults, which auto-generate a real plan, no interaction needed), `http://localhost:3999/sistema` (design-system reference page).

PlanEat has no photography and no real logo mark — the brand is a plain text wordmark ("PlanEat", semibold, no icon) in every page's header. The `logo-11f217b6.svg` candidate below is a false positive from the capture heuristic (probably the checkmark icon near the header, not a brand mark) — do not use it as a logo.

## Screenshots (the primary visual source — captured pages are the visual source of truth per this route's brief)

Flat, uniquely-named files directly under `screenshots/` — the stager only resolves basenames at this level. (`screenshots/{home,plan,sistema}/` also holds the same files for human browsing; always cite the flat name below in `asset_candidates`, never the subfolder path.)

- `screenshots/home-full-page.png` — home page (`/`), full scroll, 1x @ 1920w. Hero "Tu semana, resuelta." + the generator form with green-underlined fields.
- `screenshots/home-scroll-030.png`, `screenshots/home-scroll-061.png` — home page scrolled: the "Un día real, no una maqueta" demo section (three meal cards — desayuno/comida/cena — each with a stacked macro bar in blue/amber/violet) and the "Cómo va el día" summary card.
- `screenshots/plan-full-page.png` — `/plan` with a real generated day (default profile, no query params needed): three meal cards (Desayuno/Comida/Cena) on the left, and the day-summary card on the right with **"✓ Cuadra"** in green + icon, the day's macro bar, and per-macro grams vs. range.
- `screenshots/sistema-full-page.png`, `screenshots/sistema-scroll-032.png` — `/sistema`: typography scale (Poppins voz-1/voz-2, Inter t-1..t-3), tabular-numbers comparison table, surface swatches, text/line swatches, **macronutrient swatches (protein/carb/fat)** (the `scroll-032` crop), **marca-y-estados swatches (brand/error/aviso)**, shape/radius samples, motion duration/easing samples, keyboard-focus demo, and a live macro-bar pair.
- `screenshots/{home,plan,sistema}/contact-sheet.jpg` — one labeled grid per page, reference only (not for `asset_candidates`).

## SVG icons (small, decorative/functional — not brand assets)

- svgs/svg-a990b616*.svg, svgs/svg-eba53de7.svg — small UI icons (theme toggle, ficha/change icons) from the home page.
- svgs/svg-0f21c983*.svg, svgs/svg-5eb7ac9d.svg, svgs/svg-8445f046*.svg — small UI icons from `/plan` (checkmark for "Cuadra", change/ficha icons on meal rows).
- svgs/logo-11f217b6.svg — **not a real logo**, see note above.

No downloaded raster images/photos exist in either capture — the product has none; every visual placeholder in the app is a colored initial-letter avatar (e.g. "Y", "S", "E" circles), not a photo.
