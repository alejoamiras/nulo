# Phase 3 — Browser seam, Chrome only

## What shipped

`tests/e2e/fixtures/browser/` is the one place the suite names a browser.

- `chrome.ts` owns the launch args, the `protocolTimeout` bump, the artifact-mode host-resolver rule and the `chrome-extension://` scheme. It is the only file allowed to close a browser.
- `index.ts` selects the driver from `NULO_E2E_BROWSER` and **throws** on a value it cannot drive. Falling back to Chrome would let a Firefox lane report a pass for a browser that never started — the exact failure the advisory lanes in phase 7 exist to detect.
- `ExtensionContext` gains `close()`. `browser.close()` is enough for Chrome and will not be for Firefox, where a geckodriver process and a profile directory outlive the browser.

Rewrite counts: **34** `ctx.browser.close()` → `ctx.close()` across 14 files; **17** scheme literals → `extensionUrl()` (14) or `EXTENSION_SCHEME` (3) across 7 files. Both were done mechanically and then read back, not hand-edited site by site.

`global-setup.ts` gains the `EXTENSION_PATH` seam that `global-setup-smoke.ts` has carried since the release workflow needed it.

## The guard, and why it has its own tests

`scripts/e2e/browser-seam.test.ts` scans `tests/e2e/**.ts` and fails on an executable scheme literal or a direct browser close outside `fixtures/browser/chrome.ts` and `scripts/check-derivation-parity.ts` (a standalone tool that launches its own Chrome and owns no `ExtensionContext`).

A guard that scans a clean tree passes whether or not its scanner works, which is how a dead guard survives for a year. So the file also feeds the scanner synthetic sources and asserts it flags an executable literal and a `ctx.browser.close()`, ignores both inside line and block comments, and leaves `extensionUrl(...)` / `ctx.close()` alone.

**Comment stripping cannot split on `//`** — that is inside the very literal being searched for. The strip is one regex whose string alternatives come first, so a scheme literal is consumed as a string before its `//` can open a comment, and comment bodies are blanked while newlines survive so reported line numbers still match the file.

## Lint encounters worth keeping

- `noExcessiveCognitiveComplexity` (error, not warning) killed the first hand-rolled character-by-character comment scanner. The single-regex form is both simpler and under the gate — the rule was right.
- `noExportsInTest` forbids exporting from a `*.test.ts`. The scanner and its synthetic cases therefore live in one file rather than a helper plus a test.
- `noTemplateCurlyInString` fires on source text held in a double-quoted fixture string. Suppressed with a reason at that one line.

Warning count moved 30 → 31 and the complexity baseline held; the one new warning is the suppressed fixture string above.

## Gate

`bun run lint` → 0 errors · `bun run typecheck` → 0 · `vitest run scripts/` → 28 passed (7 new). Chrome build + full Chrome smoke, then the two CI dispatches, are recorded below when they land.
