# Page Override: /sistema

> Overrides MASTER.md for this route only.

**Components in scope:** `motores-confianza.tsx` (+ whatever else lives under `app/sistema/page.tsx`).

## Layout pattern: Data-Dense Dashboard (BI/Analytics)

This page's job (per README) is to make the Python-vs-TypeScript engine parity legible: 2.576 pure-function cases bit-for-bit, 2.171 solver instances with p95(E_ts − E_py) = 0. That's a trust/credibility page for a technical claim, not a feature showcase — treat it like `data-dense-dashboard`, not `bento-box-grid`.

- KPI row at top: 3-4 cards — "casos función pura" (2.576, bit-exact), "instancias porcionador" (2.171), "p95 diferencia" (0), "última verificación" (from `volcar_paridad.py` run). Numbers first, prose after — this page's entire argument is the numbers.
- Below: the two-engine comparison as an actual comparison table (the README's own `| | services/solver | packages/motor |` table), not prose paragraphs — reuse the `data-dense-dashboard` table spec (13px, sticky header, `--table-row-height: 36px`).
- Link out to `DIVERGENCIAS.md` / `REPRODUCIBILIDAD.md` content inline via `detalle-plegable` (progressive disclosure) rather than dumping full markdown — this is already a dense page, don't make it a wall of text.
- Color: KPI "0 diferencia" and "bit-exact" states use `--color-status-ok`; do not invent a separate "engineering green" — reuse the semantic token so it reads consistently with `/plan`'s budget-ok state.

## Anti-patterns specific to this page

- No hero imagery, no marketing copy tone — this page's credibility comes from precision, not persuasion.
- No glass/blur — same legibility reasoning as `/plan`.
