# Phase 3 — page

Gate run 2026-09-06, all green. Fast layers: `typecheck` exit 0, `test` 10 passed, `bun run lint` exit 0 (after two `noDescendingSpecificity` warnings were cleared by reordering `.cta` above the hero slugs and widening `footer a:hover` to `footer .wrap a:hover`), `build` exit 0, `! grep -q '{{' dist/index.html` true (no template token survived).

Browser pass against `vite preview` on port 4175 (Playwright, Chromium):

| Check | Result |
|---|---|
| Response header | `Content-Security-Policy: default-src 'self'; …` served by preview (from `_headers` via `preview.headers`) |
| Console | 0 errors, 0 warnings, no CSP violation |
| Cold-load fonts | `SpaceGrotesk-latin` 200, `JetBrainsMono-latin` 200, `InterVariable` 200; Material Symbols never requested |
| CLS | 0.0041 |
| Hero frame | 10,441 characters at 1400 wide; 56 columns at 390 |
| Keyboard | Skip link → NULO → How it works → Tools → Add to Chrome → Pause → hero Add to Chrome, each with a 2px solid outline |
| Pause | frame changes while running; identical across 1 s while paused; label flips to Play; resumes |
| Record | 16 rows after 12 s of streaming (cap holds) |
| 4× CPU throttle at 390×844 | no long tasks (> 50 ms) in 5 s |
| Reduced motion | hero is a still frame (identical across 800 ms); Pause removed; box placed on the still subject (top 72%) |

Two fixes came out of the screenshots: the reduced-motion path never positioned the tracking box (it sat at its HTML default while the still frame's subject was lower), so the still layout now calls the same `placeBox` the loop uses; and at phone width the plate covered the bottom camera labels and clipped REC, so on ≤ 900 px the plate anchors to the bottom of the hero and the bottom slugs and the box are hidden.

Font decision (plan § Trade-offs): InterVariable (352 kB) is fetched once and cached immutable; CLS stayed at 0.004 with `font-display: swap`, so no preload is added.
