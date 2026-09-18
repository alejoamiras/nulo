# Phase 3 — Browser seam, Chrome only

## What shipped

`tests/e2e/fixtures/browser/` is the one place the suite names a browser.

- `chrome.ts` owns the launch args, the `protocolTimeout` bump, the artifact-mode host-resolver rule and the `chrome-extension://` scheme. It is the only file allowed to close a browser.
- `index.ts` selects the driver from `NULO_E2E_BROWSER` and **throws** on a value it cannot drive. Falling back to Chrome would let a Firefox lane report a pass for a browser that never started — the exact failure the advisory lanes in phase 7 exist to detect.
- `ExtensionContext` gains `close()`. `browser.close()` is enough for Chrome and will not be for Firefox, where a geckodriver process and a profile directory outlive the browser.

Rewrite counts: **34** `ctx.browser.close()` → `ctx.close()` across 14 files; **10** `extensionUrl()` call sites plus **3** `EXTENSION_SCHEME` substitutions across 7 files. (An earlier draft said 17 scheme sites — that was the raw grep count, which included comments and the exempt standalone tool. The review caught it.) Both rewrites were done mechanically and then read back, not hand-edited site by site.

`global-setup.ts` gains the `EXTENSION_PATH` seam that `global-setup-smoke.ts` has carried since the release workflow needed it.

## The guard, and the fail-open the review found

`scripts/e2e/browser-seam.test.ts` scans `tests/e2e/**.ts` and fails on an executable scheme literal or a direct browser close outside `fixtures/browser/chrome.ts` and `scripts/check-derivation-parity.ts` (a standalone tool that launches its own Chrome and owns no `ExtensionContext`).

A guard that scans a clean tree passes whether or not its scanner works, which is how a dead guard survives for a year. So the file also feeds the scanner synthetic sources and asserts what it flags.

**The first implementation was a hand-rolled text scan, and it failed open.** Comment stripping cannot simply split on `//` — that sequence is inside the very literal being searched for — so the strip was one regex whose string alternatives came first. The foreign review broke it with a construct already in the tree: `PUPPETEER_PREFIXED_SELECTOR_RE = /^(?:text|xpath|aria|pierce)\//` at `fixtures/extension.ts`. A regex ending in `\//` looks like the start of a line comment, so everything after it on that line was blanked; appending `; await ctx.browser.close()` there produced **zero violations**. Reproduced, not theorised.

A second review round then found four more bypasses that need no type information at all — `(ctx.browser)` as an alias initializer, `(ctx.browser as Browser).close()`, the `satisfies` form, and `ctx.browser!.close()`. Wrappers that change nothing at runtime must not change what the scan sees, so receivers and alias initializers are now both normalised through one `unwrap` before inspection. The scan also **refuses source it cannot parse** rather than accepting a partial tree: an unterminated regex swallows whatever follows it, and a clean report over a half-read file is the fail-open in another costume.

**A trap in the fixtures themselves.** Two of those cases first appeared to survive the fix. They had not: at the top level of a module TypeScript reads `await (x)` as a *call to a function named `await`*, so the receiver of `.close()` was that call, not the expression inside the parentheses. A third case had been passing for the same wrong reason — `await (ctx).browser.close()` matched because `await(ctx).browser` is itself a property access named `browser`. Every fixture is now wrapped in an `async function`, the way real test code is written, so the tree under test is the tree the suite actually contains. A test fixture that does not parse the way production source parses proves nothing about production source.

The scan walks the **TypeScript AST** (`typescript` is a declared devDependency of `apps/extension`, so no phantom import). Strings and template fragments are literal nodes, so a comment or a regex can never be mistaken for one; closes are `CallExpression`s, so the three other escapes the review listed — a close split across lines, `ctx.browser?.close()`, and a local alias `const b = ctx.browser; b.close()` — are all caught, and each is pinned as its own case. What it still cannot see is an alias that crosses a function or file boundary; that needs type information the scan deliberately does not build, and the limitation is stated in the file.

**The coverage floor was also too weak.** `files > 50` would still have passed with the entire 93-file network tree missing (64 files remain without it). It now names a file from each subtree and requires the network directory to be genuinely walked.

## `agent.sh` had nine `dist/chrome` literals, not one

The browser plumbing first changed only the build script and the RPC-URL bundle assertion. A CI-surface sweep found **eight more**: the migration-fixture stamp check, both token-seed marker checks, the Presto-required stamp, the proverless stamp, the fee-multiplier check, and two error strings. On a Firefox run each would have grepped a stale Chrome bundle — passing against the wrong artifact, or fataling on a directory the run never built. All nine now read `$DIST_DIR`.

## Selector validation moved ahead of the side effects

`NULO_E2E_BROWSER` was validated when `fixtures/browser/index.ts` was first imported — which happens in a worker, *after* the network global setup has already booted anvil, a node and a playground. `resolveBrowserKind()` now lives in `fixtures/browser/selection.ts`, a module with no driver import (so pulling it in costs nothing), and both global setups call it at module scope. An unusable selector now fails before the sandbox, not minutes into it.

The driver registry is `Partial<Record<BrowserKind, BrowserDriver>>` with a throw on a missing entry. The first draft mapped `firefox` to the Chrome driver to satisfy the total `Record` — which is exactly the silent-Chrome-fallback this seam exists to prevent.

## Lint encounters worth keeping

- `noExcessiveCognitiveComplexity` (error, not warning) killed the first hand-rolled character-by-character comment scanner. The single-regex form is both simpler and under the gate — the rule was right.
- `noExportsInTest` forbids exporting from a `*.test.ts`. The scanner and its synthetic cases therefore live in one file rather than a helper plus a test.
- `noTemplateCurlyInString` fires on source text held in a double-quoted fixture string. Suppressed with a reason at that one line.

Warning count moved 30 → 31 and the complexity baseline held; the one new warning is the suppressed fixture string above.

## The smoke suite needs the fixture-armed build, and says so loudly

The first local run of `bun run test:e2e` failed one case — `fixture-arming contract: unarmed runs are allowed ONLY against a release artifact`. Nothing to do with the seam: a plain `bun run build` omits the fixture stamps, and the smoke job builds with them (`_extension-smoke-e2e.yml`). The gate command below therefore builds with CI's exact flags and runs with `NULO_E2E_MIGRATION_FIXTURE=1`. Running the bare command against a bare build is a false red, and the contract test exists precisely to make that loud rather than silent.

## Gate

`bun run lint` → 0 errors · `bun run typecheck` → 0 · `vitest run scripts/` → 28 passed (7 new).

Full Chrome smoke, against a build made with `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 build:chrome` and run with `NULO_E2E_MIGRATION_FIXTURE=1`: **32 files passed, 1 skipped; 123 tests passed, 6 skipped, 0 failed.**

The two Chrome CI dispatches are held until the arc's review findings are applied, since the plan binds their acceptance to an exact SHA and any later commit on this arc invalidates them.
