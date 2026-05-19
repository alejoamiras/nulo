# Puppeteer → Playwright migration — plan (Claude pass)

## TL;DR

We propose a **time-boxed 1-day spike** (port the simplest smoke test + simplest network test, head-to-head against Puppeteer) before committing to migrating ~3,000 LOC of fixtures and 63 test files. The migration is plausible — Playwright supports MV3 extensions via `chromium.launchPersistentContext`, exposes service workers, and has auto-waiting locators that may eliminate `patchPagePolling` + `clickByTestId` plumbing. But the **primary motivating problem** (cumulative-load timeouts on the full network suite) is *partially* a function of one shared Aztec sandbox process and *partially* a function of the extension's IndexedDB accumulating across tests in one Chrome user-data-dir. Playwright doesn't help with the first; it *might* help with the second if we run each test in a fresh `BrowserContext`, but this is gated on whether the unpacked extension survives context teardown/re-launch (untested). If the spike validates both the helper-LOC reduction *and* the per-context isolation, GO. Otherwise abandon and keep Puppeteer.

**Success criteria for the spike:**
1. Smoke test ported & passing with `≥30%` fewer fixture lines (proxy: `clickByTestId`, `patchPagePolling`, `typeIntoInput` become unnecessary).
2. Network test ported & passing without the `protocolTimeout: 300_000` band-aid (defaults work).
3. A simple A/B benchmark — 5 dapp tests run sequentially in one Puppeteer context vs in 5 fresh Playwright contexts — shows tail-test wall-clock parity or better, with no IndexedDB pile-up on the Playwright side (verified by inspecting `chrome.storage.local` size).

If 2 of 3 succeed, GO. If 0–1, abandon.

## Why we're even considering this

From the previous session and the network-suite README (`packages/extension/tests/e2e/README.md:121`): the full network suite is 46/66 passing locally, 18 known failures bucketed in `implementations-plan/network-test-triage/plan.md`. Independent of those 18, cumulative-load timeouts cause tests in the latter half of the run to fail at 15s `waitForPopup` boundaries that pass cleanly when the test runs alone. Bumping those boundaries to 30s shifted the failure set but did not reduce it — the issue is wall-clock starvation under one shared sandbox + accumulating extension state.

Two distinct Playwright affordances are interesting:

1. **`BrowserContext`-per-test isolation.** Playwright's idiomatic pattern is one `chromium.launchPersistentContext({ args: ['--load-extension=…'] })` per worker, with optional `context.close()` + relaunch between tests. If the extension can be cleanly re-mounted on a fresh user-data-dir per test, the IndexedDB pile-up disappears. **Hypothesis to validate in the spike: this is feasible and meaningfully faster on the tail tests.**

2. **Auto-waiting locators may obsolete the CDP-regression helpers.** `packages/extension/tests/e2e/README.md:103` describes the regression: Puppeteer's CDP element-handle path hangs with `Runtime.callFunctionOn timed out`. The workaround is `clickByTestId` / `typeIntoInput` / `patchPagePolling`. Playwright drives Chrome via a different protocol surface (its own CDP-over-WebSocket implementation with auto-retry and built-in actionability checks). It's plausible — but unverified — that the regression doesn't reproduce there. **Hypothesis to validate: Playwright's `page.getByTestId(...).click()` works on the same flows where `handle.click()` hangs.**

## What the migration touches

| Surface | LOC | Migration effort |
|---|---|---|
| `tests/e2e/fixtures/extension.ts` | 905 | High — 8 fixtures, custom `patchPagePolling`, `clickByTestId`, `typeIntoInput`, `replaceInputValue`, `clickButtonByText`, `clickSelector`, `openPopup` with fast-path/fallback handshake, `isTargetDetachError` |
| `tests/e2e/fixtures/popups.ts` | 271 | Medium — `waitForPopup` via `browser.targets()` → `context.on("page", …)`; `waitForMainFrame` polling-loop probably becomes unnecessary; per-popup `patchPagePolling` removed |
| `tests/e2e/fixtures/helpers.ts` | 1036 | High — heavy reliance on `clickByTestId`, `typeIntoInput`, `replaceInputValue`, custom UI flows |
| `tests/e2e/fixtures/playground.ts` | 148 | Low — page evaluations, no CDP-handle paths |
| `tests/e2e/fixtures/aztec.ts` | 424 | None — pure Aztec SDK, no Puppeteer |
| `tests/e2e/fixtures/dappSession.ts` | 76 | Low |
| `tests/e2e/fixtures/passkey.ts` | 157 | Medium — passkey emulation uses CDP `WebAuthn` domain; need to verify Playwright's `CDPSession` exposure |
| `tests/e2e/fixtures/aztec-private-fpc-bridge.ts` | 126 | None |
| **Test files** | 63 files | Most are pure-page tests (no direct Puppeteer import) — they would migrate by virtue of the fixture migration. The 12 files that import `from "puppeteer"` directly need type-only updates. |
| `vitest.e2e.config.ts` | 41 | Low — keep vitest as the runner, swap `pool: "forks"` semantics if needed |
| `vitest.e2e.network.config.ts` | 25 | Low — same |
| `package.json` | 1 line | Add `playwright`, keep `puppeteer` until Phase 5 |

**LOC savings projection (if the auto-wait hypothesis pans out):** ~250–400 LOC of helpers become a one-line `locator.click()` call. ~60 LOC of `patchPagePolling` is deleted. The fast-path/fallback `openPopup` block (lines 676-732) likely simplifies — Playwright's `context.waitForEvent("page")` doesn't need the same `chrome.storage.session.get("nulo:liveness")` paranoia.

**Effort estimate (if GO after spike):**
- Phase 1 (smoke + new fixture layer): 2 days
- Phase 2 (rebuild custom helpers as Playwright equivalents): 1 day
- Phase 3 (port network suite in 3 batches): 3 days
- Phase 4 (parallel-isolation experiment): 1 day
- Phase 5 (remove Puppeteer, final cleanup): 0.5 day
- **Total: ~7–8 working days** + cycle buffer for surprises.

## Phase 0 — Spike (1 day, time-boxed)

Before touching the real suite, build a branch `spike/playwright` that:

1. Adds `playwright` (just the package, NOT `@playwright/test`) as a dev dep alongside `puppeteer`. We keep vitest as the test runner — Playwright's test runner is incompatible with our fixture model.
2. Creates `tests/e2e/fixtures/extension.pw.ts` that mirrors the surface of `extension.ts` but uses `chromium.launchPersistentContext`:
   ```ts
   const context = await chromium.launchPersistentContext(userDataDir, {
     headless,
     args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, …]
   })
   const sw = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker")
   const extensionId = new URL(sw.url()).host
   ```
3. Ports **`tests/e2e/registration.test.ts`** (the simplest smoke test — just opens the popup and registers) to Playwright. Measure: setup LOC, wall-clock, did we need any custom helpers?
4. Ports **`tests/e2e/network/meta-getChainInfo.test.ts`** (simplest network test — pre-grant `basic` cap, call `getChainInfo`, assert ok). Measure: same metrics, plus did `waitForPopup` translate cleanly via `context.waitForEvent("page", …)`?
5. **The A/B run for the cumulative-load hypothesis.** Pick 5 dapp tests that pass individually but cluster-fail in the full suite. Wrap them in a tiny harness:
   - **Puppeteer path:** one `browser` instance, run all 5 sequentially in the same context. Record per-test wall-clock + whether each passes.
   - **Playwright path:** new `context` per test (close + relaunch). Record same metrics.
   
   If Playwright tail-tests pass when Puppeteer tail-tests timeout, the hypothesis holds.

**Go/no-go gate at end of Phase 0:**
- **GO** if: smoke port works without any `patchPagePolling`-equivalent helper, AND the A/B shows ≥1 dapp test passing under Playwright that fails under Puppeteer cluster.
- **NO-GO** if: smoke port still requires custom click/wait helpers AND A/B is parity-or-worse. Document why in this plan, archive `agent-plan.md` + `claude-plan.md`, abandon.

## Phase 1 — Dual-runtime fixtures (2 days, only if GO)

Goal: smoke suite fully on Playwright; network suite still on Puppeteer.

1. Promote `extension.pw.ts` to `extension.ts` style and rename old `extension.ts` → `extension.pup.ts`. Export both, gate by an env flag (`E2E_RUNTIME=playwright|puppeteer`).
2. Add `tests/e2e/fixtures/popups.pw.ts` — `waitForPopup` becomes:
   ```ts
   async function waitForPopup(ctx, kind, opts) {
     const page = await ctx.context.waitForEvent("page", {
       predicate: (p) => p.url().includes(`#/windows/${kind}`),
       timeout: opts.timeout ?? 15_000,
     })
     await page.waitForLoadState("domcontentloaded")
     return page
   }
   ```
   No `patchPagePolling`, no `waitForMainFrame`.
3. Port all 18 smoke tests file-by-file. Each port = 1 commit. Gate each commit with `bun run test:e2e` (smoke suite only).
4. Land the smoke port behind `E2E_RUNTIME=playwright` env. Old code path stays alive for rollback.

**Gating command at phase end:** `E2E_RUNTIME=playwright bun run test:e2e` passes 18/18 with no regressions vs the Puppeteer-mode baseline. If smoke parity is achieved, proceed to Phase 2.

## Phase 2 — Helper rebuild (1 day)

Goal: replace each Puppeteer-specific helper with a Playwright idiom. Tracked per-helper:

| Puppeteer helper (extension.ts) | Playwright replacement |
|---|---|
| `clickByTestId(page, id)` | `await page.getByTestId(id).click()` |
| `clickSelector(page, sel)` | `await page.locator(sel).click()` |
| `clickButtonByText(page, t)` | `await page.getByRole("button", { name: t }).click()` |
| `typeIntoInput(page, ph, v)` | `await page.getByPlaceholder(ph).fill(v)` |
| `replaceInputValue(page, s, v)` | `await page.locator(s).fill(v)` |
| `patchPagePolling(page)` | **deleted** — Playwright's `expect(locator).toBeVisible()` is non-rAF by default |
| `waitForHash(page, h)` | `await page.waitForURL(`**#${h}`)` (or evaluate-based, since Playwright's URL matchers normalize differently) |
| `closeStuckPopup(page)` | **try deleting first** — Vue Transition stuck-mid-state issue may not reproduce |
| `isTargetDetachError(err)` | **delete** — Playwright's `locator.click()` race-tolerates target close |

Each deletion = a commit. Each commit re-runs `bun run test:e2e` to prove no regression.

## Phase 3 — Network suite port (3 days, in batches)

The 45 network tests cluster naturally by fixture. Port in this order to maximize early signal:

**Batch 3a (1 day) — minimal-state tests, 12 files**
- `meta-*` (4 files), `cap-*` (7 files), `connect-*` (3 files)
- These exercise the discover/verify/capabilities popup path heavily — best test of `waitForPopup` translation
- Gate: `bun run e2e:agent tests/e2e/network/{meta,cap,connect}-*.test.ts`

**Batch 3b (1 day) — sendTx + sim tests, 15 files**
- `tx-*` (6 files), `sim-*` (1 file), `send-*` (1 file), `batch-*` (2 files), `concurrency-*` (1 file), `cancel-*` (1 file), `multi-account-*` (1 file), `tokens.test.ts`, `authwit-*` (1 file)
- These exercise the execute popup, the in-flight tx-awaiting card, and the cancel flow
- Gate: per-file run, then group run

**Batch 3c (1 day) — data + session + edge tests, 18 files**
- `data-*` (3 files), `session-*` (4 files), `contacts-*` (1 file), `contracts-*` (3 files), `transfers.test.ts`, `token-management.test.ts`, `wallet-locked-*` (1 file), `err-*` (1 file), `networks.test.ts`, `fee-methods.test.ts`, `cap-request-locked-*` (rare path)
- Mix of silent and popup paths
- Gate: per-file run, then `bun run e2e:agent` full

**At phase end:** `bun run e2e:agent` runs cleanly under Playwright on the same baseline (46/66 expected). The 18 known failures in `network-test-triage/plan.md` should be unchanged — if Playwright actually fixes any of them, that's bonus signal; if Playwright introduces new failures, debug and add to triage.

## Phase 4 — Parallel-isolation experiment (1 day)

The real prize: validate the cumulative-load hypothesis on the full suite.

1. Set `fileParallelism: true` in `vitest.e2e.network.config.ts`. Don't expect this to "just work" — the Aztec sandbox is shared across the whole vitest run, and parallel files would all hit one PXE. **The right experiment is fork-per-file isolation while keeping `fileParallelism: false`:**
   ```ts
   pool: "forks",
   poolOptions: { forks: { singleFork: false, isolate: true } },
   ```
   This is what smoke already does (`vitest.e2e.config.ts:21-30`). Combined with Playwright's per-context lifecycle, each test file would get a fresh Node worker, a fresh `BrowserContext`, a fresh user-data-dir, a fresh IndexedDB — but the same Aztec sandbox.
2. Measure: do the tail-test failures from `network-test-triage/plan.md` go away? Or do they stay because the Aztec sandbox itself is the bottleneck?
3. Record findings in `network-test-triage/plan.md` regardless of outcome.

**Most likely outcomes:**
- (a) Some tail failures disappear, others remain → IndexedDB *was* part of the problem, Aztec sandbox *is also* part. Net win.
- (b) All tail failures persist → Aztec sandbox is the only bottleneck. Playwright migration was useful for helper-LOC but not for cumulative-load. Document and accept.
- (c) New failures appear → likely fork-process re-init costs (extension cold-boot, SW liveness) — needs tuning.

## Phase 5 — Cleanup (0.5 day)

1. Remove `puppeteer` from `packages/extension/package.json`.
2. Delete `extension.pup.ts`, `popups.pup.ts`, and any `.pup.ts` files.
3. Delete `E2E_RUNTIME` env gate.
4. Delete unused custom helpers from `helpers.ts` (the ones Phase 2 replaced).
5. Update `packages/extension/tests/e2e/README.md` — replace the "Helper conventions (CDP regression workarounds)" section with whatever subset still applies.
6. Run `bun run audit:vue` + `bun run e2e:agent` one final time.

## Risks & unknowns (call out before spike)

1. **MV3 extension lifetime across context close/relaunch.** Playwright docs assert `launchPersistentContext` supports loading unpacked extensions, but reuse semantics (does the SW survive a context close? does `chrome.storage.local` persist across user-data-dir reuse?) are not deeply documented. The spike must explicitly test "close context → relaunch with same userDataDir → SW still registered, storage persisted." If not, the per-context isolation pattern requires per-test user-data-dirs (slower but workable).

2. **Vitest + Playwright interop.** We are NOT moving to `@playwright/test`'s runner. Vitest stays. This is supported but unusual — most Playwright docs assume `test.describe`. The `playwright` (vs `@playwright/test`) package gives us raw `chromium` / `firefox` / `webkit` exports without the test runner. No known blocker, but verify in the spike.

3. **`inject("aztecTestConfig")` from `global-setup.ts`.** This is vitest-native — should be untouched by the runtime swap. Verify.

4. **WebAuthn / passkey emulation.** `passkey.ts` (157 LOC) uses Puppeteer's CDP session to enable the `WebAuthn` domain. Playwright exposes `context.newCDPSession(page)` — the API maps cleanly, but the in-page test virtual authenticator needs re-validation. Two of the smoke tests (`passkey-backup.test.ts`, `passkey-paths.test.ts`) are blocked on this.

5. **Headless mode.** Puppeteer 24's `headless: true` runs the new headless implementation. Playwright defaults to headless = true with a different rendering path. Anti-throttle flags (`--disable-renderer-backgrounding`, `--disable-features=CalculateNativeWinOcclusion`) may or may not still be needed. Spike should test both with and without.

6. **`protocolTimeout: 300_000`.** This is a Puppeteer-specific knob for CDP hang resilience. Playwright has `slowMo` and `timeout` per call but no analogous protocol-level timeout. If we run into "wallet's argon2 + bb.js cold-boot exceeds 3 minutes" hangs, we'd need to push the per-call timeout higher rather than the protocol-level one. Likely fine but verify.

7. **Cross-worktree parallel runs.** Current setup (`e2e/README.md:50-70`) supports two worktrees running `bun run e2e:agent` simultaneously via port allocation + lockfiles. Chrome orphan cleanup uses `pkill -f "chrome.*--load-extension=$EXTENSION_PATH"`. Playwright's Chromium uses the same `--load-extension` arg, so the orphan-cleanup grep still matches. Verify in the spike.

8. **CI cost.** Hosted CI runs are already on fresh containers, so the cumulative-load benefit is irrelevant there. If migration adds wall-clock to CI without local benefit, that's a net loss. Time CI before/after.

## Reversibility

Migration is fully reversible until the start of Phase 5. Phase 1–4 keep both `puppeteer` and `playwright` installed and gated by `E2E_RUNTIME`. Phase 5 is the point of no return. Even then, `git revert` brings Puppeteer back — the only "lost" cost is the 0.5 day of cleanup.

## Recommendation

**Run the 1-day spike. Then decide.** The cost of the spike is bounded; the value is decisive evidence about the hypothesis. Without the spike, this remains speculation — and the previous session's whack-a-mole on timeout bumps is a cautionary tale about acting on speculation in this codebase.

## Open questions to resolve before spike

1. Do we want the spike branch to live as a PR draft, or as a local branch with a writeup-only output? Recommend draft PR — easier to share artifacts (LOC diff, A/B output) for Codex review.
2. Pick the 5 A/B dapp tests deliberately, not arbitrarily. Suggest: 5 tests from `network-test-triage/plan.md` clusters A or B (the fixture-cascade clusters) — they're the canonical cumulative-load victims.
3. Should the spike include both `playwright` (raw `chromium` import) AND `@playwright/test` (full runner) as alternative paths? Recommend NO — vitest-as-runner is non-negotiable here; the runner swap would be its own multi-day project.
