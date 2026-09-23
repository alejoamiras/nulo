# Phase 5 — console-capture truth (B2)

## Probe evidence (env-gated `_probe-console-capture.test.ts`, NULO_E2E_CONSOLE_PROBE=1)

Run 1 (armed smoke build, solo):

```
✓ console.error is invisible to page console but lands in the SW log ring  5598ms
✓ uncaught throw and unhandled rejection each reach pageerror              1851ms
✗ built popup HTML keeps the sniffer script before the entry script  (probe logic bug)
```

- **Channel 1 CONFIRMED**: a popup `console.error("NULO-PROBE-<nonce>")`
  never appears in `page.on("console")` (1.5s settle), and the SAME nonce is
  read back from the SW's session-storage log ring via `readSwLogTrail`
  within the 10s poll (the 2s LoggerStore debounce honored). The sniffer
  reroute is the mechanism, empirically.
- **Channel 2 CONFIRMED**: an uncaught throw AND a separate unhandled
  rejection each land in `page.on("pageerror")` — the native uncaught path
  survives the entry-point handlers. `pageErrors` is the reliable channel
  for THROWN/unhandled errors (and only those).
- **Probe test 3's failure was the probe's own heuristic**, not a build
  regression: the built HTML's first script is `/theme-boot.js` — the
  DELIBERATE render-blocking pre-paint theme setter (documented in the
  source `popup/index.html`), which contains ZERO `console.` calls (grepped
  in source + build). The sniffer is script #2, ahead of every app chunk —
  the ordering guarantee holds. Probe fixed: theme-boot allowlisted + a new
  belt asserting theme-boot stays console-free (anything it logged would
  hit the native console pre-patch).

## Run 2 (fixed probe, same dist)

```
✓ tests/e2e/_probe-console-capture.test.ts (3 tests) 8254ms
  ✓ console.error is invisible to page console but lands in the SW log ring 6155ms
  ✓ uncaught throw and unhandled rejection each reach pageerror 1875ms
  (+ built-HTML order + theme-boot console-free belt)
Tests 3 passed (3) — EXIT:0
```

All three channels confirmed. Documentation landed: both fixture comment
blocks upgraded to the root-caused truth; ledger re-disposition + skill
section follow in this phase's commit.
