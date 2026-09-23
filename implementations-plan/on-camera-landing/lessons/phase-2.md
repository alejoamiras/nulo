# Phase 2 — renderer, DOM layer, preview headers

Gate run 2026-09-06, all green: `typecheck` exit 0; `test` 10 passed across 3 files (`feed.test.ts` ×5, `headers.test.ts` ×2, the resolver ×3); `bun run lint` exit 0 after one formatter fix (a line the formatter wanted joined).

What the tests pin: exact shape and alphabet of a frame; determinism per seed and time and change over 5 s; an all-space frame at gain 0; the subject raising mean density in its neighbourhood; `quantize` reproducing the Bayer 4×4 threshold pattern for a constant mid-grey; the `_headers` parser keeping only the `/*` block and values that contain colons.

Lessons:
- The subject assertion first demanded a full ramp level of lift; the 9×5 window is wider than the blob, so the honest margin is about half a level (+0.62 measured). Thresholds in perceptual tests need a measurement behind them, not a round number.
- `bunx biome check apps/landing` must run from the repo root: from inside `apps/landing` the path resolves to `apps/landing/apps/landing` and Biome reports an internal I/O error rather than "not found".
- `feed-dom.ts` keeps every function under the budgets by splitting measure / size / draw / record / clock / loop / pause; `mountPage` is the only place that knows the order. Grid caps 240×80, retention 16 rows, one rAF at ~30 fps, off-screen and hidden-tab skips, reduced motion = one still frame redrawn on resize and no Pause button.
