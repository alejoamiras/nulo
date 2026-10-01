# Playwright migration plan (independent — agent A)

## TL;DR

We're proposing a time-boxed (~4-hour) Playwright spike to validate whether `chromium.launchPersistentContext` plus per-test `BrowserContext` isolation buys us measurably better cumulative-load behaviour than today's Puppeteer suite, plus how many of the 4-5 CDP workaround helpers Playwright's native locator/auto-wait makes obsolete. Success = local network suite green at ≥80% pass rate without manual timeout bumping AND ≥40% of `fixtures/extension.ts:590-905` custom-helper LOC retired. If the spike doesn't hit both, abandon; the cumulative-load failure mode is almost certainly Aztec-sandbox-side, not Chrome-side, so Playwright doesn't help and we eat 3-5 days for ~zero gain. Risk: the entire migration is reversible — Puppeteer stays as a sibling dependency through Phase 4.

---

## 1. Read of the codebase (what we're migrating)

The Puppeteer-bound surface, by line count (from `wc -l` in `packages/extension/tests/e2e/fixtures/`):

| File | LOC | What Playwright would touch |
|---|---|---|
| `fixtures/extension.ts` | 905 | `launchExtension`, `openPopup`, `patchPagePolling`, `clickByTestId`, `typeIntoInput`, `replaceInputValue`, `clickSelector`, `clickButtonByText`, `waitForHash`, fixture bodies (8 `test.extend` blocks) |
| `fixtures/helpers.ts` | 1036 | every helper depends on `Page` from `puppeteer`; ~30 UI flows |
| `fixtures/popups.ts` | 271 | `waitForPopup` uses `browser.targets()` + `waitForTarget` (popup discovery), `waitForMainFrame`, popup approve/reject |
| `fixtures/playground.ts` | 148 | `openPlayground`, `waitForPgResult`, `snapshotResultSeq`, `callExpectingNoPopup` (uses `ctx.browser.targets()`) |
| `fixtures/passkey.ts` | 157 | CDP `WebAuthn.enable` / `addVirtualAuthenticator`, per-popup `targetcreated` listener |
| `fixtures/dappSession.ts` | 76 | only touches `chrome.storage.local` via `page.evaluate` — protocol-neutral |
| `fixtures/aztec.ts` | 424 | Aztec SDK only, NO browser code — unaffected |
| `fixtures/aztec-private-fpc-bridge.ts` | 126 | Aztec SDK only — unaffected |

Plus 6 test files (`packages/extension/tests/e2e/*.test.ts`) that directly `import type { Page } from "puppeteer"`:
- `import-paths.test.ts:1`, `passkey-paths.test.ts:1`, `passkey-backup.test.ts:1`, `sw-resilience.test.ts:1`, `sw-restart-network.test.ts:1`, `security-backup.test.ts:1`.

And direct `browser.targets()` reads in tests (no fixture intermediation):
- `network/cap-request-repeat-noPopup.test.ts:39, :44` — popup-absence assertion
- `network/connect-locked-queue.test.ts:33`
- `network/connect-deny.test.ts:41`
- `network/session-tabClose.test.ts:42, :53`
- `network/session-tabNavigate.test.ts:43, :53`
- `network/session-reconnect.test.ts:63`

The `targets()` API is the single most exotic Puppeteer surface we use; Playwright's analogue is `context.pages()` + `context.serviceWorkers()` + `context.on("page")` / `context.waitForEvent("page")`. None map 1:1.

Vitest harness facts (load-bearing):
- `vitest.e2e.network.config.ts:11-17` — `fileParallelism: false`, `testTimeout: 30_000`, `hookTimeout: 300_000`, single `globalSetup`.
- `vitest.e2e.config.ts:27-41` — smoke uses `pool: "forks"`, `singleFork: false`, `isolate: true`, `retry: 2`. Each smoke test file runs in its own worker process; Chrome state isolation is at the file boundary, not the test boundary.
- `tests/e2e/global-setup.ts:148, :181, :379, :425` — `project.provide("extensionPath" | "playgroundUrl" | "aztecTestConfig", …)`; test code reads via `inject("…")` in `fixtures/extension.ts:17`, `fixtures/playground.ts:17`, `fixtures/extension.ts:288, :357, :435`.
- `manifest.chrome.config.ts:19, :25-27` — Confirms MV3 + service-worker module background. This rules out the easier MV2 background-page path for fresh-context loading; MV3 imposes Chrome's documented constraint that extensions only load into persistent (non-incognito) contexts.

MV3 + service-worker means **Playwright's `chromium.launchPersistentContext(userDataDir, { args: ["--load-extension=…", "--disable-extensions-except=…"], headless: false-or-chromium-channel })` is the ONLY supported way to load this extension**. There is NO `BrowserContext`-per-test path for an unpacked MV3 extension. Playwright's own docs (the maintained chromium-channel-extension recipe) require a single persistent context shared across the suite. We can launch fresh `launchPersistentContext` PER TEST (= fresh user-data-dir, fresh extension load, fresh SW) but cannot fork a non-persistent `context.newContext()` and have the extension active there. **This is the single biggest constraint and the one the spike must validate.**

---

## 2. Hypothesis statement & success criteria

### Hypothesis (what we're actually testing)

**H1 (primary):** The cumulative-load failure mode (5/7 tests passing one run, different 5/7 the next when timeouts bump 15→30s) is caused by the Chrome user-profile / extension IndexedDB state accumulating across ~43 dapp tests that share a single Puppeteer browser launched once per file-fixture. If we launch a fresh `chromium.launchPersistentContext` per test (= fresh IndexedDB, fresh SW boot, fresh extension state), the cumulative load goes away — at the cost of paying SW-boot time (~3-8s per `launchExtension` today) on every dapp test.

**H2 (secondary):** Playwright's auto-waiting + native locator click bypass the CDP `Runtime.callFunctionOn timed out` regression. The 5 CDP workaround helpers in `fixtures/extension.ts` (`clickByTestId:861-891`, `clickSelector:828-851`, `typeIntoInput:757-759`, `replaceInputValue:794-822`, `patchPagePolling:590-650`) and the related `closeStuckPopup` in `fixtures/helpers.ts:318-331` exist BECAUSE Puppeteer's elementHandle path hangs. If Playwright's protocol path doesn't trip the same regression, all six helpers collapse to native `locator.click()` / `locator.fill()` / Playwright's built-in waiters.

**H3 (anti-hypothesis):** The bottleneck is Aztec-sandbox-side (PXE block sync, LMDB latency, sequencer state). The README acknowledges this is "infra-bound until Aztec moves off IndexedDB." If H3 is correct, fresh-context-per-test won't help — the extension's IndexedDB is fresh but the sandbox PXE still degrades, and we paid a 5-day port for nothing.

### Success criteria (must hit BOTH)

| Metric | Today (Puppeteer) | Spike target | Why this bar |
|---|---|---|---|
| Local full network suite pass rate, single run (`bun run e2e:agent`) | ~46/66 = 70% | ≥80% (≥53/66) | Below 80%, fresh-context didn't help meaningfully. Note 18 failures pre-exist per `network-test-triage/plan.md` — fix those separately, but the migration should not REGRESS pass rate. |
| Custom-helper LOC retired from `fixtures/extension.ts:590-905` | 0 (315 LOC) | ≥40% (≥126 LOC retired) | If `patchPagePolling` + at least one of `clickByTestId`/`replaceInputValue` collapses, we're seeing real protocol differences. Less than 40% means Playwright hits the same regressions and we gained nothing structural. |
| Smoke suite (`bun run test:e2e`, 19 files) wall-clock | baseline X | ≤1.25× X | Fresh-context-per-test inflates per-test cost. If we exceed 25% slower, fresh-context-per-file is the correct setting (which means H1 wasn't really fresh-per-test). |
| One representative test that fails under cumulative load today (e.g. `network/cap-request-repeat-noPopup.test.ts` or `network/cap-request-basic.test.ts`) passes in isolation AND in suite | passes in isolation, fails in suite | passes in BOTH | The whole point of H1. |

**Optional bonus criteria (nice-to-have, not gating):**
- `fileParallelism: true` works under Playwright (today blocked by `vitest.e2e.network.config.ts:16`).
- `retry: 1` per-test (today: `retry: 2` smoke-only, `retry: 1` per-test on `meta-getChainInfo.test.ts:22`) can be dropped suite-wide.

### Abandon criteria (any one triggers go-no-go = "abandon migration")

A. Spike port of ONE smoke test takes >2× the corresponding Puppeteer LOC AND doesn't simplify any helper.
B. `chromium.launchPersistentContext` per-test produces SW-boot failures (no `nulo:liveness`) more than 10% of the time.
C. The picked cumulative-load victim test (`cap-request-repeat-noPopup.test.ts` or another nominated) still fails in the suite after porting.
D. Helper count goes UP, not down (Playwright's locator-strict-mode + auto-wait can be its own gotcha against a Vue Transition-heavy popup).

---

## 3. Spike phase (T+0 → T+~4h)

The spike is a single throwaway branch (`spike/playwright`). Nothing merges. Output is a 1-page memo with the metrics above. Do not modify any production helper.

### Spike step 1 — install (15 min)

Add `playwright-core` (NOT `@playwright/test`; we want to keep vitest's runner so all fixture / `inject()` plumbing in `fixtures/extension.ts:17, 288, 357, 435` keeps working). Justification: `@playwright/test` would force us to migrate vitest fixtures to Playwright fixtures simultaneously — too much churn for a spike, and would lose vitest's `globalSetup` → `provide`/`inject` channel we use for `aztecTestConfig`.

`packages/extension/package.json` — add to devDependencies: `"playwright-core": "^1.49.0"` next to `"puppeteer": "^24.43.0"` (do NOT remove puppeteer). Run `bun install`. Confirm the Chromium binary works — Playwright's bundled Chromium has the Chrome flags we use (`--disable-renderer-backgrounding` etc) already; bring-your-own-Chrome via `executablePath` is optional.

### Spike step 2 — minimal `launchExtensionPW` (45 min)

Write a tiny module (NOT in `fixtures/extension.ts`) at `packages/extension/tests/e2e/fixtures/_spike/extension-pw.ts`:

- `launchExtensionPW()` calls `chromium.launchPersistentContext(userDataDir, { headless: false, args: [...same as launchExtension in fixtures/extension.ts:28-42 INCLUDING the three anti-throttle flags] })`. Note: MV3 + `--load-extension` requires `headless: false` historically; Playwright's `chromium.launchPersistentContext` with `headless: "chromium"` (the new headless mode) supports extensions in v1.41+. Confirm in the spike.
- Discover extension ID via `context.serviceWorkers()` — if non-empty, use first; else `context.waitForEvent("serviceworker")` (Playwright's analogue of Puppeteer's `browser.waitForTarget(type === "service_worker")` at `fixtures/extension.ts:54-57`).
- Liveness wait: identical predicate to `fixtures/extension.ts:70-80` but via `page.waitForFunction` (Playwright's signature is slightly different — supports `polling` as a number directly, no rAF default).
- Test it: in a vitest file, `launchExtensionPW()` → assert extension ID is a 32-char hex.

### Spike step 3 — port one smoke test (45 min)

Pick `tests/e2e/registration.test.ts:13` ("create profile with password", 74 LOC). Why: it exercises `clickByTestId`, `typeIntoInput`, `waitForHash`, `openPopup`, hash-router transitions, and reads `chrome.storage.local` (`registration.test.ts:66-69`). It's the densest small smoke test.

Port it AS-IS using Playwright `Locator` APIs:
- Replace `clickByTestId(page, "register-create-btn")` with `await page.getByTestId("register-create-btn").click()`.
- Replace `typeIntoInput(page, "Strong password", testPassword)` with `await page.getByPlaceholder("Strong password").fill(testPassword)`.
- Replace `waitForHash(page, "#/popup/general", 15_000)` with `await page.waitForFunction(h => location.hash === h, "#/popup/general", { timeout: 15_000 })`.
- Replace `page.waitForSelector('[data-testid="balance-amount"]', { visible: true, timeout: 10_000 })` with `await page.getByTestId("balance-amount").waitFor({ state: "visible", timeout: 10_000 })`.
- KEEP the `chrome.storage.local` `page.evaluate` block at `registration.test.ts:66-69` verbatim — protocol-neutral.

Run this single test ~10 times in sequence. Pass rate target: 100%. Measure: wall-clock vs Puppeteer baseline for the same test.

**If a `Runtime.callFunctionOn timed out`-style hang reappears, the Puppeteer regression follows us to Playwright. That is data — record it and proceed to Step 5; do not paper over it.**

### Spike step 4 — port one cumulative-load victim (60 min)

Pick `tests/e2e/network/cap-request-repeat-noPopup.test.ts` (47 LOC). Why: it uses `dappConnectedExtension` (the heaviest fixture), reads `browser.targets()` directly at `cap-request-repeat-noPopup.test.ts:39, :44`, and is in the cluster that flakes under cumulative load.

Replace `browser.targets()` with `context.pages()` + a filter for `t.url().startsWith("chrome-extension://") && t.url().includes("/src/popup/index.html")`. Playwright tracks pages from creation, not via a unified "targets" abstraction.

Replace `waitForPopup(ctx, "capabilities")` (which today uses `browser.waitForTarget` at `fixtures/popups.ts:35`) with `context.waitForEvent("page", { predicate: p => p.url().includes("#/windows/capabilities"), timeout: 15_000 })`. Note the subtle difference: Puppeteer's `waitForTarget` resolves once on a matching target whether it's new OR pre-existing (which is why `fixtures/popups.ts:29-34` builds a `preExisting` set to filter); Playwright's `waitForEvent("page")` only fires on NEW pages.

This change actually SIMPLIFIES `waitForPopup` — the `preExisting` snapshot disappears. Record LOC delta.

Run this test in two modes:
- **Mode A — file-scoped fixture (today's default):** one `launchExtensionPW` for the file. Should pass (or fail identically to today's flake).
- **Mode B — per-test fresh context:** one `launchExtensionPW` per test invocation, in a fresh user-data-dir. Should pass 100% — that's the H1 test.

If Mode B passes 100% but Mode A fails 30-50% of the time, **H1 is supported**. If Mode B also fails, **H1 is rejected** — the bottleneck is Aztec-side.

### Spike step 5 — measure & write up (30 min)

Output a `spike-results.md` with:
- LOC delta on the two ported tests (before / after).
- Per-test wall-clock on 10 runs (median, p99).
- Pass rate on cumulative-load test across 5 full-file runs.
- Which custom helpers became unnecessary vs which had to be reimplemented.
- A go-or-no-go recommendation with one paragraph of reasoning.

### Decision gate

```
GO criteria (must hit ALL):
  - Mode B (per-test fresh context) on the picked victim test: ≥9/10 passes
  - Ported registration.test.ts LOC: ≤ Puppeteer original LOC × 1.1
  - At least 2 of {clickByTestId, typeIntoInput, patchPagePolling, replaceInputValue, closeStuckPopup} fully replaced by native Playwright primitives
  - Mode A pass rate is no WORSE than Puppeteer-equivalent

NO-GO if ANY of:
  - Per-test fresh-context doesn't fix the cumulative-load flake (H1 rejected)
  - Wall-clock blow-up: smoke suite >1.5× Puppeteer baseline
  - Any custom helper still required AND no other helper dropped
  - Spike took >6h (the 4h budget × 1.5 grace) and we still don't have data
```

---

## 4. If GO — phased migration

All phases land on `dev` via individual PRs. Each phase has a gating command and an explicit rollback.

### Phase 1 — dual-deps + Playwright fixture skeleton (~1 day)

Goal: introduce Playwright alongside Puppeteer, with the new fixture module in parallel to the old. Nothing in `tests/e2e/` changes yet.

Concrete edits:
- `packages/extension/package.json` — add `"playwright-core": "^1.49.0"` to devDependencies. Do NOT remove `puppeteer`.
- New file `packages/extension/tests/e2e/fixtures/extension-pw.ts` — Playwright-native `launchExtensionPW`, `openPopupPW`, plus the 8 fixture definitions (`extension`, `registeredExtension`, …) re-exported as `testPW`. Mirror the layout of `fixtures/extension.ts` exactly so a test file ports by swapping `from "../fixtures/extension"` to `from "../fixtures/extension-pw"`.
- New file `packages/extension/tests/e2e/fixtures/popups-pw.ts`, `helpers-pw.ts`, `playground-pw.ts` — Playwright equivalents.
- `packages/extension/vitest.e2e.network.config.ts` — add a sibling `vitest.e2e.network.pw.config.ts` (same content, points the include glob at `tests/e2e/network-pw/**/*.test.ts`).
- `packages/extension/package.json` scripts — add `"test:e2e:pw": "vitest run --config vitest.e2e.network.pw.config.ts"`. Existing `test:e2e` and `e2e:agent` are untouched.
- New directory `packages/extension/tests/e2e/network-pw/` — empty, populated in Phase 3.

Phase-1 acceptance: `bun run typecheck`, `bun run lint` pass. `bun run test:e2e:pw` runs and exits 0 (zero tests). Old `bun run test:e2e` and `bun run e2e:agent` unaffected.

**Rollback cost:** trivial — delete the new files, remove the dep, drop the config.

### Phase 2 — rebuild custom helpers as Playwright equivalents (~1-1.5 days)

Goal: a complete `*-pw.ts` fixture surface that any test file can opt into.

For each Puppeteer helper, decide:
- (R) Replaced by Playwright native primitive
- (P) Ported with adjustments
- (D) Deleted, no longer needed

The expected categorization (validate against spike data):

| Helper | Category | Replacement |
|---|---|---|
| `patchPagePolling` (`fixtures/extension.ts:590-650`) | **D** | Playwright `page.waitForFunction` accepts `polling: number` natively and does not default to rAF. The CSS-selector rewrite branch is also unnecessary — `page.locator(sel).waitFor()` is uniform across plain CSS and pierce/xpath. |
| `clickByTestId` | **R** | `page.getByTestId(id).click()`. Playwright auto-waits for the element to be actionable. The "topmost / last visible" heuristic in `fixtures/extension.ts:865-873` becomes `getByTestId(id).last()` if needed; otherwise locator strict mode may catch ambiguous matches. |
| `clickSelector` | **R** | `page.locator(sel).last().click()` |
| `clickButtonByText` | **R** | `page.getByRole("button", { name: text }).click()` |
| `typeIntoInput(page, placeholder, text)` | **R** | `page.getByPlaceholder(placeholder).fill(text)` |
| `replaceInputValue(page, sel, value)` | **P** | Initial replacement: `page.locator(sel).last().fill(value)`. If Vue's v-model still requires the explicit `input` + `change` event dispatch (which `replaceInputValue:806-808` does), wrap as `locator.evaluate(el => { ... })` — keep ~15 LOC, drop the rest. The microtask flush at `:817-818` is likely unnecessary because Playwright's `.fill` already settles before returning. |
| `closeStuckPopup` (`fixtures/helpers.ts:318-331`) | **D-or-P** | Hypothesis: if Playwright's renderer-backgrounding is less aggressive (auto-attaches `page.bringToFront`-equivalent), Vue `<Transition>` doesn't stick mid-leave. If it still does, port verbatim (the helper is content-side, not protocol-side). Verify in Phase 3 batch 1. |
| `waitForHash` | **P** | Identical, swap to Playwright's `page.waitForFunction` signature (positional `polling` is now a number in the options bag). |
| `openPopup` (`fixtures/extension.ts:653-733`) | **P** | `context.newPage()` + `page.goto(popupUrl)`. KEEP the fast-path-then-fallback pattern at `:711-727` — it's a wallet-side handshake workaround, not a protocol artifact. |
| `waitForPopup` (`fixtures/popups.ts:19-69`) | **P** | Replace `browser.waitForTarget` with `context.waitForEvent("page", { predicate, timeout })`. The `preExisting` snapshot at `:29-34` is no longer needed (Playwright's `page` event only fires on NEW pages). The `waitForMainFrame` helper at `:71-82` is likely unnecessary — Playwright's `Page` is only resolved after the main frame is wired. |
| `waitForPopupClosed` (`fixtures/popups.ts:87-94`) | **R** | `page.waitForEvent("close", { timeout })` |
| `callExpectingNoPopup` (`fixtures/playground.ts:119-148`) | **P** | Replace `ctx.browser.targets()` with `ctx.context.pages()`. Same shape. |
| `setupPasskeyVirtualAuth` (`fixtures/passkey.ts`) | **P** | Playwright exposes CDP via `context.newCDPSession(page)`. Same `WebAuthn.enable` / `addVirtualAuthenticator` calls. The per-popup `targetcreated` listener becomes `context.on("page", ...)`. The architectural note at `fixtures/passkey.ts:15-30` about per-FrameTreeNode authenticator scope is Chromium-side, NOT protocol-side — survives unchanged. |
| `inject("aztecTestConfig")`, `inject("playgroundUrl")`, `inject("extensionPath")` | unchanged | These are vitest's `provide`/`inject` channel. As long as we keep vitest as the test runner (Phase 1's decision), they keep working. |

`fixtures/aztec.ts` and `fixtures/aztec-private-fpc-bridge.ts` need ZERO changes — they have no browser code.

`fixtures/dappSession.ts:13, :29-56` imports `ExtensionContext` and uses `openPopup(ctx)`; one-line change to use the PW version.

Phase-2 acceptance: `bun run typecheck` passes for both PW and Puppeteer fixture trees. No tests use the PW tree yet.

**Rollback cost:** delete the `*-pw.ts` files; rest of repo untouched.

### Phase 3 — port the test suites in batches

The 63 test files (19 smoke + 44 network) port file-by-file via search-and-replace of the import path. Group into batches so a regression in one batch doesn't gate the next.

Order is chosen to expose maximum risk early (port the cluster MOST representative of the bottleneck first):

#### Phase 3.1 — smoke suite (1 day)
19 files at `tests/e2e/*.test.ts`. No Aztec sandbox, no `dappConnectedExtension`. Lowest risk. Gives us a clean signal whether Playwright's protocol path works for the wallet popup UI at all.

Gating: `bun run test:e2e:pw` for the smoke suite at 100% pass × 3 runs. If green, port files into `tests/e2e-pw/` and update CI's `Smoke e2e` workflow to point at the new config. If red, fix or revert that file only.

Note: `tests/e2e/passkey-paths.test.ts` (215 LOC) and `tests/e2e/passkey-backup.test.ts` (435 LOC) use `setupPasskeyVirtualAuth`. Port these LAST in Phase 3.1 since they're the highest CDP-dependence in the smoke suite.

#### Phase 3.2 — connection / capability network tests (1 day)
The `cap-*` tests (`cap-request-*` × 6 files, plus `connect-*` × 3, `meta-*` × 4). These are the smallest network tests (~30-50 LOC each) and the ones MOST affected by the cumulative-load issue per the motivation. If Playwright's fresh-context-per-test fixes them, we've validated H1 at scale.

Gating: `bun run e2e:agent --config vitest.e2e.network.pw.config.ts tests/e2e/network-pw/cap-*` at ≥95% pass × 3 full runs (= 18 file invocations). 

If pass rate stays below 80%, **stop and reassess**. Either H1 is wrong (no Playwright fix), or per-test fresh-context isn't enough (next phase fileParallelism may help, but if not, abandon).

#### Phase 3.3 — heavy fixture tests (1-1.5 days)
`transfers.test.ts` (uses `tokenReadyExtension`), `fee-methods.test.ts` (uses `feeJuiceImportedExtension`), `tx-sendTx-*` × 5, `sim-methods.test.ts`, `authwit-variants.test.ts`, `multi-account-from.test.ts`. These exercise the most expensive fixture lifecycles and are the most likely place a SW-boot regression surfaces.

Gating: `bun run e2e:agent --config vitest.e2e.network.pw.config.ts` (all network-pw tests) at ≥80% pass × 3 runs (matches the network-test-triage baseline of 46/66).

#### Phase 3.4 — sessions + miscellaneous (~0.5 day)
`session-*` × 4, `contacts-sender.test.ts`, `data-*` × 3, `contracts-*` × 3, `wallet-locked-mid-session.test.ts`, `concurrency-rapid-fire.test.ts`, etc. Most use `browser.targets()` direct reads which we'll port to `context.pages()` inline (these were too small to deserve a fixture).

Gating: same as 3.3.

### Phase 4 — exercise the cumulative-load hypothesis at the harness level (~0.5 day)

This is the phase where we lock in the actual H1 win.

Concrete edits:
- `packages/extension/vitest.e2e.network.pw.config.ts` — set `fileParallelism: true` (default in vitest), expect 2-4 worker processes. Verify the per-worktree port-pack from `parallel-e2e-isolation/plan.md` still holds (it does — each worker is a fork inside the same worktree, sharing the one Aztec sandbox; but H1 says we don't need fresh sandboxes, we need fresh extensions).
- Convert the 5 file-scoped fixtures (`extension`, `registeredExtension`, `dappConnectedExtension`, `localNetworkExtension`, `tokenReadyExtension`, `feeJuiceReadyExtension`, `feeJuiceImportedExtension`) from `{ scope: "file" }` (today's pattern at `fixtures/extension.ts:203, 213, 224, 251, 282, 351, 429, 567`) to `{ scope: "test" }` selectively for the cap-* and sim-* suites that flake.
- Re-run the full network suite. Target: ≥80% pass × 3 runs. If we land here we've achieved the spike's premise at scale.

Gating: `bun run e2e:agent` × 3 consecutive runs, no manual cleanup between runs, all at ≥80%.

**Rollback cost:** flip `fileParallelism` back to `false` + revert the fixture scope changes. Code path is preserved.

### Phase 5 — remove Puppeteer + cleanup (~0.5 day)

Concrete edits:
- `packages/extension/package.json` — remove `"puppeteer": "^24.43.0"`.
- Delete `packages/extension/tests/e2e/fixtures/extension.ts`, `helpers.ts`, `popups.ts`, `playground.ts`, `passkey.ts` (the originals).
- Rename `extension-pw.ts` → `extension.ts`, etc. Update imports across the test suite (one-liner sed).
- Delete `tests/e2e/network/` directory; rename `network-pw/` → `network/`. Update `vitest.e2e.network.config.ts:11` glob.
- Delete `vitest.e2e.network.pw.config.ts`.
- `packages/extension/tests/e2e/README.md` — update the "Helper conventions (CDP regression workarounds)" section. The table at README.md:90-95 becomes mostly obsolete; replace with the Playwright equivalents (probably one-paragraph each — most workarounds are gone).
- `tests/e2e/scripts/check-derivation-parity.ts:1-3` — port from `puppeteer` import to `playwright-core`. (This is a standalone script, not a test.)

Gating: `bun run audit:vue` + `bun run test:e2e` + `bun run e2e:agent` all green. Three full-suite runs at ≥80%.

**Rollback cost:** non-trivial. After this PR lands, going back means re-introducing `puppeteer` and either reverting to a tagged commit or rewriting the Puppeteer fixtures from scratch. Keep the Puppeteer fixtures alive through Phase 4 for exactly this reason.

---

## 5. Risks & unknowns

### Architectural risks

**MV3 service-worker lifecycle under Playwright.** Puppeteer's `browser.waitForTarget(t => t.type() === "service_worker")` at `fixtures/extension.ts:54-57` is the load-bearing call that gives us the extension ID. Playwright exposes `context.serviceWorkers()` and `context.waitForEvent("serviceworker")`. The SW lifecycle (idle suspend, cold respawn) is Chromium-controlled, not protocol-controlled — both Puppeteer and Playwright observe the same lifecycle, just via different APIs. The risk is in the EDGE — `sw-resilience.test.ts:10-20` uses `browser.waitForTarget` + `target.createCDPSession()` + `Runtime.terminateExecution` to kill the SW. Playwright's `context.newCDPSession(serviceWorker)` works against the SW object, but the API shape differs. Validate in Phase 3.1.

**Headless mode for extensions.** Puppeteer 24 + headless `true` (the default per `fixtures/extension.ts:25`) supports MV3 via "new headless mode." Playwright's `chromium.launchPersistentContext` historically required `headless: false` for extensions; v1.41+ supports `headless: "chromium"` for extensions in CI. Verify on the spike. If headed-only is required, CI workflow needs `xvfb-run` (which we may already have or need to add).

**Per-test `launchPersistentContext` cost.** Today's `launchExtension` at `fixtures/extension.ts:16-84` takes ~3-8s for SW liveness (`liveness wait: 30_000` budget at `:79`). If we run it per-test for the ~43 dapp tests, we add 2-6 minutes to the network suite wall-clock. Acceptable if pass rate jumps to 80%+. If pass rate doesn't improve, this cost is dead weight.

**File-scoped fixture sharing inside a single context.** Today's `dappConnectedExtension` at `fixtures/extension.ts:237-252` runs once per file and shares the connected dapp state across N tests in the file. Under per-test fresh contexts, the playground re-connect runs per test, including the 2 approval popup chains (discover + verify) at `connectPlayground:138-159`. Add 5-10s per test. The user-decided contract from `network-test-triage/plan.md` and from previous parallel-isolation work is that fresh-state-per-test is correct ONLY for files that mutate cap state (today via `dappConnectedExtensionPerTest`); blanket per-test for the whole suite is a 5-10× wall-clock blow-up. **Pick test-scope per FILE selectively in Phase 4.**

### Behavioural unknowns

**Does `closeStuckPopup` (`fixtures/helpers.ts:318-331`) still need to exist?** The Vue `<Transition>` mid-leave stick is rAF-throttling under offscreen renderer per the comment at `:317-318`. Playwright's renderer attachment differs (it pipes via the DevTools target system more aggressively than Puppeteer's CDP-direct path). The spike will tell us. If it goes away, ~15 helpers in `helpers.ts` (the ones that call `closeStuckPopup`) get simpler.

**Locator strict mode under stacked popups.** Puppeteer's `clickByTestId` at `fixtures/extension.ts:865-873` deliberately picks `candidates[candidates.length - 1]` (the topmost / freshest in a stacked-popup chain). Playwright's `getByTestId(id)` defaults to strict mode and throws when N>1 matches. We'd port to `getByTestId(id).last()` — that's a global pattern across ~30 helpers. If we don't, we'll get strict-mode violations that look like real bugs.

**Vue v-model + `replaceInputValue`'s microtask flush.** `replaceInputValue:817-818` awaits two `Promise.resolve()` to flush Vue's reactivity before returning. Playwright's `locator.fill()` may not bridge this — verify by porting `replaceInputValue` to `locator.fill()` and running a test that does `fill(a) → fill(b) → click(submit)` (e.g. `tests/e2e/registration.test.ts:38-42`). If the submit click lands while disabled is still true, the microtask flush wasn't preserved — keep the helper as a Playwright `locator.evaluate` thin wrapper.

**`browser.targets()` semantics under Playwright.** Five test files and one helper read `targets()` directly. Playwright doesn't have a unified "targets" abstraction — pages, service workers, and background pages are different APIs. The five tests at `network/cap-request-repeat-noPopup.test.ts:39, 44`, `network/connect-locked-queue.test.ts:33`, etc. test "no new popup appeared" — they need `context.pages()` filtered by URL. Port inline; this is mechanical.

**WebAuthn fixture compatibility.** `fixtures/passkey.ts:78-157` is dense CDP work. Playwright supports `context.newCDPSession(page).send("WebAuthn.enable", ...)` — same protocol, different API entry. The architectural note at `:15-30` about per-FrameTreeNode authenticator scope survives unchanged (it's a Chromium-side constraint). Port shouldn't be hard; do it in Phase 3.1 with `passkey-*.test.ts`.

### Test-infrastructure unknowns

**Vitest + Playwright interop.** We're NOT migrating to `@playwright/test`'s runner. We KEEP vitest. The `inject("aztecTestConfig")`-style provide-from-globalSetup channel (used at `fixtures/extension.ts:288, 357, 435`, `fixtures/playground.ts:17`) survives because vitest's `provide`/`inject` is runner-agnostic. `playwright-core` is just a browser-automation library; no runner involved. Risk: low.

**Smoke suite's `pool: "forks"` + per-test fresh context.** `vitest.e2e.config.ts:28-33` already runs each smoke FILE in its own forked worker. Adding per-test fresh `launchPersistentContext` inside that = nested isolation. Wall-clock impact may be material (today smoke runs in ~2-3 minutes; could become 5-7 minutes). Acceptable as long as CI doesn't time out at the workflow level.

---

## 6. Estimated effort

| Phase | Estimate | Cumulative |
|---|---|---|
| Spike | 4-6 hours | 4-6h |
| Phase 1 (deps + skeleton) | 0.5-1 day | 1.5d |
| Phase 2 (helpers PW versions) | 1.5 days | 3d |
| Phase 3.1 (smoke 19 files) | 1 day | 4d |
| Phase 3.2 (cap-* 13 files) | 1 day | 5d |
| Phase 3.3 (heavy fixtures 12 files) | 1.5 days | 6.5d |
| Phase 3.4 (rest 19 files) | 0.5 day | 7d |
| Phase 4 (fileParallelism + scope) | 0.5 day | 7.5d |
| Phase 5 (cleanup) | 0.5 day | 8d |
| **Total if GO** | | **7-9 days** |

Plus an unbudgeted 1-2 days of slippage absorbing CDP/MV3 edge cases — the helpers at `extension.ts:861-905`, the popup-stuck-transition workarounds, and the WebAuthn fixture are the most likely culprits.

**Compared to the alternative — fix the existing flakes per `network-test-triage/plan.md` first.** That plan's Phase 0 is ~65 minutes of diagnostics and the resulting fixes are estimated at 1-3 days for wallet-side bugs. If the cumulative-load problem is actually `importToken` PXE introspection slowness (Cluster A in that plan), then fixing that ONE root cause delivers the same pass-rate improvement without a Playwright migration.

**Strong recommendation: do the network-test-triage Phase 0 BEFORE starting the Playwright spike.** It's 65 minutes and it tells us whether the bottleneck is the browser layer or the wallet/PXE layer. If Cluster A is a wallet PXE bug, Playwright doesn't fix it. If Phase 0 says "no wallet bug, it's pure load," then Playwright spike is justified.

---

## 7. Reversibility

| Phase | Reversibility cost |
|---|---|
| Spike | Zero — throwaway branch, no merge |
| Phase 1 | Trivial — delete 4 files, drop one dep |
| Phase 2 | Trivial — delete the new `*-pw.ts` files |
| Phase 3.x | Medium — each batch is its own PR; revert individual PRs as needed. Old Puppeteer tests still exist in `tests/e2e/` |
| Phase 4 | Trivial — flip `fileParallelism` flag |
| Phase 5 | **Hard** — Puppeteer dep dropped, fixtures deleted. Going back means resurrecting via git or rewriting. **Hold Phase 5 for ~2 weeks after Phase 4 lands; merge only after at least one full Aztec version bump cycle proves the new path is stable across upstream churn.** |

The migration is structured so that any single phase can be reverted independently. The Puppeteer fixtures stay alive as a sibling tree through Phase 4. If post-Phase-4 the cumulative-load metrics regress for any reason (Aztec version bump, Chromium version bump), we flip CI back to `test:e2e` (Puppeteer) and `e2e:agent` (Puppeteer) by reverting one PR.

---

## 8. Out of scope (anti-scope)

- Replacing vitest with `@playwright/test`'s test runner. Massive churn; the runner gives us per-test parallelism but loses our `globalSetup` → `provide` plumbing and our 4 existing vitest configs.
- Changing the `aztec.ts` Aztec SDK helpers or anything in the `setupPreFundedAccount` flow. Those are protocol-neutral.
- Changing the per-worktree port-isolation infrastructure from `parallel-e2e-isolation/`. The lockfile, port allocator, and `e2e:agent` script all survive verbatim.
- Migrating the storybook tests. Out of scope.
- "While we're at it" refactors of the wallet under test. The migration is mechanical; behaviour changes go in separate PRs.
- Replacing the `closeStuckPopup` content-side hack with a wallet-side Vue Transition fix. Tempting but: the wallet behaviour is fine for real users (not headless rAF-throttled); fixing it would be wallet UX churn for a test-only need.

---

## 9. Open questions for the user

1. **Should we run `network-test-triage` Phase 0 BEFORE the Playwright spike?** It's 65 min and gives us hard data on whether the bottleneck is wallet-side. My recommendation: yes — without it, the spike is a guess. Estimated savings if Phase 0 shows wallet bug: 7-9 days.

2. **Spike pass threshold for the cumulative-load victim test.** I propose "≥9/10 passes in Mode B." Is that the right bar, or do we want "10/10 across 3 file runs"?

3. **Do we keep `@playwright/test` reserved as a future migration?** If we land on `playwright-core` + vitest now and the model proves stable, do we ever want to flip to `@playwright/test`'s built-in fixtures + parallelism? My instinct: no — vitest is already our runner across components, unit, and e2e; consistency wins.

4. **For tests that read `chrome.storage` directly (e.g. `registration.test.ts:66-69`, `fixtures/dappSession.ts:34-49`), do we want a Playwright-native `BrowserContext.storageState()` approach?** Probably not — `page.evaluate(() => chrome.storage.local.get(…))` is identical in both libraries and the existing pattern is fine.

5. **Phase 5 timing.** Hold for 1-2 weeks of Phase-4 soak, or merge immediately after Phase 4 if metrics are green for 3 consecutive nightly runs? My instinct: 2 weeks. The Puppeteer fallback is cheap insurance.
