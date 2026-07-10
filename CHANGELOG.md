# Changelog

## 1.2.0 — 2026-07-10

**Dashboard redesign — from admin panel to coaching report.**

- **New single-column editorial layout** (report schema 2.2, ink theme: warm paper + deep green, light/dark). The verdict comes first, evidence one click away.
- **Real 9-dimension radar chart** in the hero, with hover scores — replacing the decorative hexagons.
- **Key Reads section**: the core diagnosis as a pull-quote plus two headline cards — strongest signal and main bottleneck (`highlights` in the schema; renderer derives from max/min dimension scores when absent).
- **Action Plan**: the first suggestion is spotlighted as "do this first"; remaining suggestions collapse to one-line rows (new per-suggestion `summary` field, falls back to the first sentence of `body`).
- **Unified scorecard**: three category blocks with expandable dimension rows (formula baseline, evidence adjustment, reasoning, deltas) — replacing the separate scorecards + nine-card dimension wall.
- **Appendix**: session trails, tooling/platform metrics, and evidence atoms are collapsed by default.
- Category palette validated for color-vision deficiency and contrast in both light and dark modes; grade colors (S–D) now appear only on the grade letter and chips.
- Backward compatible: 2.1 report JSON renders unchanged; missing 2.2 fields degrade gracefully with a banner note.

## 1.1.0 — 2026-07-07

- Modern rollout format support (function_call/function_call_output join by `call_id`), format-drift detector.
- Evidence pipeline: id-addressable atoms, workflow episodes, critical incidents, self-baseline.
- Typed suggestions with recipes, `verifyBy`, anti-generic rule; conditional AGENTS.md draft.
- Session kinds (interactive / automation / subagent), automation profile, honest N/A.
- Local history: score trend and per-dimension deltas from the second run.
- Fixture-based regression test suite.

## 1.0.0 — 2026-06-05

- Initial release: 9 dimensions × 3 categories, deterministic parser + model adjustment + single-file HTML dashboard, transparent rubric, 100% local.
