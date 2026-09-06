# Post-implementation codex loop

`code_review` is off; the loop is the review. Model GPT-6 Astra at `high`, read-only, over `git diff bde7fc7c...HEAD -- apps/landing bun.lock` plus plan, recon and the round-1 plan audit.

## Round 1 — VERDICT: findings (no High)

Adopted, all verified in the code and then in the browser:

| Finding | Fix | Evidence |
|---|---|---|
| Pause left the record interval, the clock and the CSS blink running (also while the tab was hidden) | shared `Run` state gates loop, record and clock; `html.is-paused` pauses the two CSS animations | counter and clock static for 2.2 s while paused; `animationPlayState: paused`; resume advances |
| `visible()` read `getBoundingClientRect` for every feed every frame | IntersectionObserver per host sets `feed.visible` | — |
| The mini feed (11/13 px type) was sized from the hero's 12/14 px cell | each feed measures its own cell | mini `pre` width 536 = host 536 |
| The box was placed as a % of the host; the subject lives in the capped grid | box placed in px from the hero grid | 2560 px viewport: box at 1390 px inside a 1728 px grid |
| `.bar nav a:hover` recoloured the button's text to bone over a white hover | `:not(.btn)` | hover colour `rgb(10, 9, 8)` |
| Bayer test re-derived its expectation from the production matrix | literal fixture `["1222","2232","2212","3222"]` | test green |
| Header test claimed colon-in-value coverage without one | `Link: <https://…>; rel=preload` in the fixture | test green |
| Clock mixed a UTC date with local time | local date getters | — |
| Comments narrating code; the "solid plate" rule overstated (headings use a halo, per the approved prototype) | trimmed; rule reworded in page.css and README | — |

Rejected: none. Committed as `fix(landing): pause covers every motion; per-feed cell metrics; box follows the capped grid`.
