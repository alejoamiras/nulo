# Puppeteer → Playwright migration plan (consolidated, post-Codex review)

> **Status: PARKED.** Spike executed 2026-05-17 (~45 min, well under the 4–6h budget). All three theories tested; conclusion is that the cumulative-load failure mode lives in the shared Aztec sandbox, not in browser or Node-process state. Browser-automation migration would not help. **See `spike-results.md` for the full writeup.** This plan is kept as the record of the analysis path that led to the spike; do NOT use it as an implementation roadmap.
>
> **Source artifacts:** `claude-plan.md` (Claude initial), `agent-plan.md` (independent subagent), Codex critical review session `019e3796-57bf-75d1-a7c1-72248bcc1332` (response at `/var/folders/p9/.../codex-MnSIvLmK/response.md`).
> **Key reshape from Codex review:** the spike is now a **2×2 control matrix** (runtime × fixture scope), not a 1×2 A/B, because the original design confounded "Playwright fixed it" with "fresh browser state fixed it regardless of runtime". If Puppeteer-per-test-fresh alone resolves the cumulative-load, **we do NOT migrate** — we fix fixture scope on the existing runtime and save ~7–9 days.

## TL;DR

We propose a **3-stage decision flow** before committing to a multi-day migration:

1. **Pre-flight triage (60–90 min):** run `implementations-plan/network-test-triage/plan.md` Phase 0 to rule out wallet/PXE-side bottlenecks. If failures are wallet-bug-shaped, abandon the migration; fix the bugs instead.
2. **Spike step A — Puppeteer-only control (~1.5h):** on the SAME victim test, run today's Puppeteer file-scope fixture vs Puppeteer with a per-test fresh `puppeteer.launch`. **If per-test-fresh on Puppeteer fixes cumulative-load**, stop — change fixture scope on the existing runtime, no migration needed.
3. **Spike step B — Full 2×2, only if step A doesn't resolve it (~3h):** add the two Playwright cells. Only proceed to migration if Playwright shows a benefit Puppeteer-per-test cannot achieve (helper-LOC retired AND/OR per-test cost meaningfully lower).

**If GO**, 5-phase migration, ~7–9 working days end-to-end + 2-week soak. **Key structural change from v1:** single test tree with runtime-swappable fixtures (NOT dual-tree `*-pw.ts` parallel files — codex flagged this as churn bait).

**Headline risks codex surfaced:**
- The Aztec sandbox is shared across spike runs, so sequential measurements naturally warm it. The 2×2 must use cold sandboxes per cell or alternating order (ABBA/BAAB) to control for warmup confound.
- Playwright's `BrowserContext.newCDPSession()` only supports `Page | Frame`, **not service workers**. This is a real blocker for the WebAuthn / passkey port (`fixtures/passkey.ts:78` uses Puppeteer's generic Target API + CDPSession on the SW target). Treat passkey as a separate risk track, not "port last".
- The MV3 + Playwright extension story is: persistent context required, headless extension testing via `channel: 'chromium'` with bundled Chromium. Earlier draft incorrectly named this `headless: "chromium"`.

**Migration is reversible** through end of Phase 4. Single test tree means rollback is `git revert` on the runtime adapter PR rather than tree merges.

---

## 1. Why we're considering this

From the previous session and `packages/extension/tests/e2e/README.md:121`: the full network suite is **46/66 passing locally**. The 18 known failures are tracked in `implementations-plan/network-test-triage/plan.md` and bucketed into 5 root-cause clusters.

Independent of those 18, the suite exhibits **cumulative-load timeouts**: tests in the latter half of the run fail at 15s `waitForPopup` boundaries that pass cleanly in isolation. The previous session bumped these to 30s; result was that 5 originally-failing tests passed but 7 different tests timed out at the new boundary — confirming the issue is load-bound, not test-specific.

**Two distinct Playwright affordances were the original draw:**

1. **Per-test fresh extension launch.** Playwright's idiomatic pattern with unpacked extensions is `chromium.launchPersistentContext(userDataDir, { args: ['--load-extension=…'] })`. If we run a fresh launch per dapp test, IndexedDB and SW state cannot accumulate.
2. **Possible bypass of CDP regression workarounds** (`extension.ts:590-905`).

**Codex's correction:** affordance (1) is not Playwright-specific. Puppeteer can launch per-test too. **The right experiment is whether per-test isolation fixes it at all, regardless of runtime.** Only if it does AND Playwright also retires meaningful helper LOC does the migration pay back.

The H3 anti-hypothesis (Aztec/PXE side bottleneck) remains, and is what the pre-flight triage rules out.

---

## 2. What the migration touches (verified line counts and paths)

### Source files (verified, errors from v1 corrected)

| File | LOC | Migration effort |
|---|---|---|
| `packages/extension/tests/e2e/fixtures/extension.ts` | 905 | High — 8 vitest fixtures, custom `patchPagePolling:590-650`, `clickByTestId:861-891`, `typeIntoInput:757`, `replaceInputValue:794-822`, `clickButtonByText:764-781`, `clickSelector:828-851`, `openPopup:653-733` (fast-path/fallback handshake), `isTargetDetachError:893-905` |
| `packages/extension/tests/e2e/fixtures/helpers.ts` | 1036 | High — ~30 UI flows, `closeStuckPopup` |
| `packages/extension/tests/e2e/fixtures/popups.ts` | 271 | Medium — `waitForPopup:19-69` via `browser.targets()` |
| `packages/extension/tests/e2e/fixtures/playground.ts` | 148 | Low — `callExpectingNoPopup` reads `targets()` |
| `packages/extension/tests/e2e/fixtures/passkey.ts` | 157 | **HIGH** (revised up per codex) — `passkey.ts:78` uses `browser.on('targetcreated')` + `target.createCDPSession()` on a SW target. Playwright's `newCDPSession` only supports `Page|Frame`. Needs separate design pass. |
| `packages/extension/tests/e2e/fixtures/dappSession.ts` | 76 | Low |
| `packages/extension/tests/e2e/fixtures/aztec.ts` | 424 | None — pure Aztec SDK |
| `packages/extension/tests/e2e/fixtures/aztec-private-fpc-bridge.ts` | 126 | None |
| **63 test files** total | varies | 18 smoke (verified `find tests/e2e -maxdepth 1 -name "*.test.ts" | wc -l` = 18) + 45 network |

**MV3 manifest reference (corrected):** `packages/extension/manifest/manifest.config.ts:25` defines `background.service_worker: "src/wallet/index.ts"`. (v1 incorrectly cited `manifest.chrome.config.ts:25-27`.)

**Test files with direct `import type { Page } from "puppeteer"`** (12 total across smoke + network):
- Smoke: `import-paths.test.ts`, `passkey-paths.test.ts`, `passkey-backup.test.ts`, `sw-resilience.test.ts`, `sw-restart-network.test.ts`, `security-backup.test.ts`
- Network: cross-check via `grep`

**Test files with direct `browser.targets()` reads (need inline porting):**
- `network/cap-request-repeat-noPopup.test.ts:39, :44`
- `network/connect-locked-queue.test.ts:33`
- `network/connect-deny.test.ts:41`
- `network/session-tabClose.test.ts:42, :53`
- `network/session-tabNavigate.test.ts:43, :53`
- `network/session-reconnect.test.ts:63`

### Vitest runtime facts (corrected)

- `vitest.e2e.network.config.ts:11-17` — `fileParallelism: false`, `testTimeout: 30_000`, `hookTimeout: 300_000`, single `globalSetup`. (Verified.)
- `vitest.e2e.config.ts` (smoke) — `testTimeout: 60_000`, `hookTimeout: 90_000`, `pool: "forks"`, `singleFork: false`, `isolate: true`, `retry: 2`. (v1 incorrectly attributed the network values to smoke.)
- `tests/e2e/global-setup.ts` — `project.provide("extensionPath" | "playgroundUrl" | "aztecTestConfig", …)`; consumed via `inject("…")` in fixtures.

### MV3 + Playwright constraints (corrected per Codex)

- Playwright's `chromium.launchPersistentContext` is the only path for unpacked MV3 extensions. (Verified plausible; spike confirms.)
- **Headless extension testing via `channel: 'chromium'`** (not `headless: "chromium"` as v1 said). The recommended package is **`playwright`** (bundled Chromium), not `playwright-core` — codex flagged that `playwright-core` adds browser-binary plumbing for no gain.
- **`BrowserContext.newCDPSession()` only supports `Page | Frame`, NOT service workers.** This is significant for `passkey.ts:78` which today creates a CDPSession on a SW target.

---

## 3. Hypotheses, success criteria, abandon criteria (reshaped)

### Hypotheses

- **H0 (the cheap one — codex insisted this be first):** Per-test fresh browser launch (regardless of runtime) eliminates the cumulative-load failure mode. If TRUE under Puppeteer, **no migration needed**.
- **H1 (only if H0 is FALSE or partially true):** Playwright per-test fresh `launchPersistentContext` further improves the situation by faster cold-boot, better target/SW handling, or other runtime-specific affordance.
- **H2 (secondary):** Playwright's auto-waiting locators + non-CDP protocol path bypass the regression that motivated `clickByTestId` / `typeIntoInput` / `patchPagePolling` / `replaceInputValue` / `closeStuckPopup`. At least 2 of these 5 helpers collapse to native primitives.
- **H3 (anti-hypothesis to falsify in pre-flight):** The cumulative-load bottleneck is Aztec/PXE-side, not extension-side. Pre-flight triage Phase 0 rules out.

### Success criteria

| Stage | Metric | Decision |
|---|---|---|
| Pre-flight Phase 0 | Failure pattern correlates with extension state, not wallet bugs | Continue. Else abandon migration. |
| Spike step A | Puppeteer per-test fresh on victim test: ≥9/10 passes | **If yes: STOP. Migrate fixture scope only.** Skip migration. |
| Spike step B | Playwright cells show measurable benefit OVER Puppeteer per-test (helper LOC ≥40% retired AND/OR per-test cost meaningfully lower) | GO migration. Else stop, ship fixture-scope-only fix. |
| Phase 3 cap/connect/meta gate | Pass rate ≥ Puppeteer per-test fresh baseline on same 13-file subset, NOT a fixed 80% number | Continue. Else stop and reassess. |

### Abandon criteria (any one triggers no-go)

1. Pre-flight triage Phase 0 concludes failures are wallet/PXE-side.
2. Spike step A: Puppeteer-per-test-fresh fixes the cumulative-load → no Playwright value to capture; ship the fixture-scope fix instead.
3. Spike step B: Playwright shows no incremental helper-LOC reduction AND no incremental per-test cost win over Puppeteer per-test.
4. `chromium.launchPersistentContext` produces SW-boot failures >10% of the time.
5. Spike exceeds 6h (1.5× budget) with no decisive data.
6. Passkey port (revised per codex): if the `newCDPSession` SW limitation cannot be worked around with reasonable effort, full migration may need to be deferred until passkey is resolved separately.

---

## 4. Pre-flight: network-test-triage Phase 0 (60–90 min)

> Note codex's critique: Phase 0 is good for classifying the 18 known failures but not directly designed to prove the cumulative-load root cause. We use it as cheap insurance — if it surfaces a wallet bug we'd otherwise miss, we save the migration cost. We do NOT rely on it alone to commit to or skip the migration; that decision is at the end of the spike.

Outputs to capture in `pre-flight-findings.md`:
- Which of the 5 known-failure clusters from `network-test-triage/plan.md` look wallet-side vs infrastructure-side.
- For the cumulative-load tail-tests (the ones bumping 15s → 30s shifted): are they in any known cluster, or are they a separate phenomenon?
- Best available evidence on whether the failures correlate with extension storage growth, SW restart count, or Aztec sandbox state. (This is hard to measure rigorously in 90 min; we accept lower confidence here.)

---

## 5. Spike phase (~4.5h, time-boxed)

Throwaway branch `spike/playwright`. Nothing merges. Output is `spike-results.md` alongside this plan.

### 5.1 Step A — Puppeteer-only 2-cell control (~1.5h)

**This is the key reshape from codex.** Before spending time on Playwright, prove that the cumulative-load issue isn't just a fixture-scope choice on the existing runtime.

Setup:
- Pick 1 victim test file. Suggest `tests/e2e/network/cap-request-repeat-noPopup.test.ts` (small, uses heavy `dappConnectedExtension` fixture, has direct `browser.targets()` reads, in the cluster that flakes).
- Implement a sibling fixture `dappConnectedExtensionPerTestFreshPup` that does what `dappConnectedExtension` does but with a fresh `puppeteer.launch` per test instead of `{ scope: "file" }`. (`fixtures/extension.ts:237-252` is the file-scope original; we want a clone with `{ scope: "test" }` semantics and per-test browser teardown.)
- Pick 5 dapp tests from `network-test-triage/plan.md` Clusters A/B that are canonical cumulative-load victims. Use the same 5 for both cells.

Run protocol:
- **Cell P-file:** today's `dappConnectedExtension` (file-scoped). Run the 5-test sequence 3× from a cold Aztec sandbox each time.
- **Cell P-test:** new per-test-fresh-launch fixture. Run the same 5-test sequence 3× from a cold Aztec sandbox each time.
- **Order control:** alternate cell order across the 6 runs (P-file P-test P-test P-file P-file P-test) to control for sandbox-warmup confound. Codex flagged that strict sequential runs in one direction inherently let Aztec warm up.

Measure: per-test wall-clock + pass/fail for each of the 30 runs (5 tests × 6 runs).

**Decision logic:**
- **Cell P-test fixes cumulative-load (≥14/15 pass rate, vs Cell P-file ≤8/15):** STOP. Don't migrate to Playwright. Ship a Puppeteer fixture-scope conversion PR (selective `{ scope: "test" }` on the flake-prone files). Estimate: 1–2 days, not 7–9.
- **Both cells fail similarly:** H3 (Aztec bottleneck) is supported. Don't migrate. Pursue triage plan or Aztec-side fixes.
- **Cell P-test fixes some but not all, OR per-test cost is prohibitive (>10× wall-clock):** proceed to step B to evaluate whether Playwright offers a better trade.

### 5.2 Step B — Add Playwright cells, complete the 2×2 (~3h, only if step A indicates Playwright might help)

Install the right package:
- `packages/extension/package.json` — add `"playwright": "^1.49.0"` (bundled Chromium). Codex flagged: prefer `playwright` over `playwright-core` to avoid browser-binary plumbing. Run `bun install`. The bundled Chromium downloads automatically on `bunx playwright install chromium` if needed.

Build minimal Playwright fixture at `packages/extension/tests/e2e/fixtures/_spike/extension-pw.ts`:
- `launchExtensionPW()` calls `chromium.launchPersistentContext(userDataDir, { headless, channel: 'chromium', args: [...same flags as extension.ts:28-42] })`. **Use `channel: 'chromium'` per codex correction**, not `headless: "chromium"`.
- Verify whether `headless: true` works at all for MV3 extensions in current Playwright. If only `headless: false` works, CI workflows need `xvfb-run`.
- Discover extension ID via `context.serviceWorkers()` or `context.waitForEvent("serviceworker")`.
- Replicate `chrome.storage.session["nulo:liveness"]` predicate.

Add two cells to the matrix:
- **Cell PW-file:** Playwright with one `launchPersistentContext` per file (file-scoped fixture analog).
- **Cell PW-test:** Playwright per-test fresh `launchPersistentContext`.

Run protocol: same 5 tests, 3× per cell, alternate cell order across cells. Cold sandbox each batch ideally; if not feasible, alternate order is the minimum.

Also port one smoke test (`tests/e2e/registration.test.ts`) to Playwright to measure helper-LOC retirement on the smoke side. This validates H2.

**Decision matrix (after step B):**

| Step A result | Step B result | Action |
|---|---|---|
| P-test fixes it | (irrelevant) | Fixture-scope fix, no migration |
| P-test doesn't fix | PW-test fixes it AND ≥40% helper LOC retired | GO migration |
| P-test doesn't fix | PW-test fixes it but no helper LOC win | Borderline — discuss before committing |
| P-test doesn't fix | PW-test also doesn't fix | Bottleneck is Aztec/elsewhere; no migration value |

### 5.3 Step C — Measure & write up (30 min)

`spike-results.md` contains:
- Pre-flight findings summary
- 2×2 matrix results: per-cell pass rate, wall-clock median + p99
- LOC delta on the smoke port + the network victim
- Which helpers were retired in the Playwright cells
- One-paragraph go/no-go recommendation with reasoning

---

## 6. If GO — phased migration (revised structure)

All phases land on `dev` via individual PRs. **Single test tree** (codex's correction) — fixtures are runtime-swappable, tests don't move. Each phase has a gating command and explicit rollback.

### Phase 1 — runtime adapter + Playwright fixture skeleton (~1.5 days)

Goal: introduce a thin runtime adapter that lets `fixtures/extension.ts` (and friends) switch between Puppeteer and Playwright internals, while keeping the export surface stable. Tests don't move; their imports don't change.

Concrete edits:
- `packages/extension/package.json` — add `"playwright": "^1.49.0"`. Keep `puppeteer`.
- New file `packages/extension/tests/e2e/fixtures/_runtime/runtime.ts` — exports types (`Page`, `BrowserContext`-ish) abstracted from the underlying runtime. Single source of truth for "what is a Page in this codebase".
- New file `_runtime/runtime-pup.ts` — Puppeteer implementation. Imports `puppeteer`.
- New file `_runtime/runtime-pw.ts` — Playwright implementation. Imports `playwright`.
- `fixtures/extension.ts` — switch from direct `puppeteer` import to `_runtime/runtime.ts` adapter. The adapter picks the underlying runtime by env (`E2E_RUNTIME=puppeteer|playwright`, default `puppeteer`).
- Same swap for `popups.ts`, `helpers.ts`, `playground.ts`, `dappSession.ts`.
- **NOT for `passkey.ts`** — see Phase 1.5 below; passkey needs its own track.

Gating: `bun run typecheck`, `bun run lint`, full `bun run audit:vue`, full `bun run test:e2e`, full `bun run e2e:agent` — all green at parity with main branch (no behaviour change yet; the runtime is still Puppeteer by default).

Rollback cost: trivial — revert the adapter PR.

### Phase 1.5 — passkey-WebAuthn separate risk track (parallel to Phase 1, ~2 days)

Codex's correction: passkey-WebAuthn is NOT a "port last and assume fine" item. It's a separate risk track because:
- `fixtures/passkey.ts:78` uses `browser.on('targetcreated')` + `target.createCDPSession()` against a SW target.
- Playwright's `BrowserContext.newCDPSession()` only supports `Page | Frame`. NO documented SW-target CDP session.

This phase produces a design memo at `implementations-plan/playwright-migration/passkey-design.md`:
- Can the SW-side CDP work be moved to the popup page (which IS a Page)?
- Does Playwright's virtual authenticator API (`browserContext.addInitScript` + `WebAuthn` automation if available) cover what we need?
- If neither works, can we keep Puppeteer for passkey tests only (smoke `pool: "forks"` already isolates files)?

Gating: design memo lands BEFORE Phase 3.1 ports any passkey test. If the memo concludes "Playwright cannot drive the passkey flow", we defer passkey migration to a follow-up project.

### Phase 2 — Playwright runtime implementation + helper rebuild (~1.5 days)

Goal: `_runtime/runtime-pw.ts` is complete; running `E2E_RUNTIME=playwright bun run test:e2e` exercises Playwright on all smoke fixtures and tests.

Helper R/P/D categorization (validated by spike data):

| Helper | Cat. | Replacement |
|---|---|---|
| `patchPagePolling` (extension.ts:590-650) | **D** | Playwright `page.waitForFunction` accepts `polling: number` natively. Validate in spike. |
| `clickByTestId` (extension.ts:861-891) | **R** | `page.getByTestId(id).last().click()` — `.last()` matches the topmost-in-stacked-popup heuristic |
| `clickSelector` (extension.ts:828-851) | **R** | `page.locator(sel).last().click()` |
| `clickButtonByText` (extension.ts:764-781) | **R** | `page.getByRole("button", { name: text }).click()` |
| `typeIntoInput` (extension.ts:757) | **R** | `page.getByPlaceholder(ph).fill(text)` |
| `replaceInputValue` (extension.ts:794-822) | **P** | Try `page.locator(sel).last().fill(value)` first. If Vue v-model needs `input`+`change` dispatch (extension.ts:806-808) or microtask flush (extension.ts:817-818), wrap in `locator.evaluate`. |
| `closeStuckPopup` (helpers.ts) | **D-or-P** | Verify in Phase 3.1. If Playwright doesn't reproduce the rAF-throttled Vue Transition stick, D. Else port verbatim (content-side, not protocol-side). |
| `waitForHash` (extension.ts:744-746) | **P** | `page.waitForFunction(h => location.hash === h, hash, { timeout, polling: 200 })` |
| `openPopup` (extension.ts:653-733) | **P** | `context.newPage()` + `page.goto(popupUrl)`. **KEEP fast-path-then-fallback** at :711-727 — wallet-side handshake workaround. |
| `waitForPopup` (popups.ts:19-69) | **P** | `context.waitForEvent("page", { predicate, timeout })`. Drop `preExisting` snapshot (Playwright only fires on new pages). Drop `waitForMainFrame` (:71-82) — Playwright `Page` resolves after main frame is wired. |
| `waitForPopupClosed` (popups.ts:87-94) | **R** | `page.waitForEvent("close", { timeout })` |
| `callExpectingNoPopup` (playground.ts:119-148) | **P** | `ctx.context.pages()` instead of `ctx.browser.targets()` |
| `isTargetDetachError` (extension.ts:893-905) | **D** | Playwright's `locator.click()` race-tolerates target close |
| `inject("aztecTestConfig" / "playgroundUrl" / "extensionPath")` | unchanged | Runner-agnostic vitest channel |

Gating: `bun run typecheck` + `E2E_RUNTIME=playwright bun run test:e2e` 100% pass × 3 runs.

Rollback cost: trivial — `E2E_RUNTIME` defaults to `puppeteer`; deletion of `runtime-pw.ts` is a one-PR revert.

### Phase 3 — port tests in 3 batches under Playwright runtime (~2.5 days total)

Important reshape from codex: **selective per-test scope conversion happens INSIDE each batch, not deferred to Phase 4.** Each batch's gate is "Playwright runtime + per-test scope (where appropriate) hits parity with the spike baseline on the same files".

#### Phase 3.1 — smoke (1 day, 18 files)

Verified count: 18 files (`accounts, appearance, auth-flows, contacts, endpoints, import-paths, navigation, passkey-backup, passkey-paths, profile-rename, registration, security-backup, security-reset, security, settings-crud, sw-resilience, sw-restart-network, wallet-lock`).

Approach: flip `E2E_RUNTIME=playwright` for the smoke CI job (or a parallel job during migration). Test files don't change; the runtime adapter switches the internals.

For `passkey-paths.test.ts` and `passkey-backup.test.ts`: gated on Phase 1.5's design memo. If memo says "Playwright can't drive passkey", these two files stay on Puppeteer via per-file runtime override (or are skipped in the PW CI job until passkey is resolved).

Gating: `E2E_RUNTIME=playwright bun run test:e2e` 100% × 3 runs.

#### Phase 3.2 — connection / capability network tests + selective scope conversion (1 day, ~13 files)

The H1 proof point at scale. `cap-request-*` × 6, `connect-*` × 3, `meta-*` × 4.

**Critical (codex's reshape):** measure the **Puppeteer baseline on these 13 files** before porting (a "control run"). Then port them under Playwright runtime, applying `{ scope: "test" }` selectively for files that mutate cap state. The gate is **relative improvement over the Puppeteer baseline on the same 13 files**, not a fixed 80% number.

Gating: Playwright runtime pass rate on these 13 files ≥ Puppeteer-baseline + ≥10 percentage points on cumulative-load failures, repeatable across 3 cold-start runs.

If pass rate is at parity but not better: STOP and reassess — the migration isn't capturing the value we hypothesized.

#### Phase 3.3 — heavy fixtures + sessions/misc combined (~1.5 days, ~31 files)

Combine v1's separate 3.3 and 3.4 into one batch since they're now both "the rest". `transfers.test.ts`, `fee-methods.test.ts`, `tx-sendTx-*` × 5, `sim-methods.test.ts`, `authwit-variants.test.ts`, `multi-account-from.test.ts`, `tokens.test.ts`, `cancel-mid-prove.test.ts`, `batch-*` × 2, `concurrency-rapid-fire.test.ts`, `session-*` × 4, `contacts-sender.test.ts`, `data-*` × 3, `contracts-*` × 3, `wallet-locked-mid-session.test.ts`, `err-scope-and-cap.test.ts`, `networks.test.ts`, `send-amount-clamp.test.ts`, `token-management.test.ts`.

Port the inline `browser.targets()` reads → `context.pages()` filtered by URL. Mechanical.

Gating: full PW network at ≥ Puppeteer-baseline + ≥5pp improvement, × 3 runs.

### Phase 4 — `fileParallelism: true` experiment (~0.5 day, OPTIONAL)

Codex's reshape: this is its own experiment, not "the same as scope conversion". Per-test scope was Phase 3.2's win; this is asking whether parallel workers help further.

Concrete edits:
- `vitest.e2e.network.config.ts` — flip `fileParallelism: true`, expect 2-4 worker processes.
- Verify the per-worktree port-pack from `parallel-e2e-isolation/plan.md` survives.
- Expect Aztec sandbox contention to be the new bottleneck.

Gating: full network ≥ Phase 3.3 pass rate, × 3 runs, without manual cleanup between.

If parallelism doesn't help OR makes things worse (Aztec contention dominates), revert and skip — this phase is not load-bearing.

### Phase 5 — remove Puppeteer + cleanup (~0.5 day, after 2-week soak)

Held for ~2 weeks of Phase 3.3/4 soak. Merge only after at least one Aztec version bump cycle proves stability.

Concrete edits:
- `package.json` — remove `puppeteer`.
- Delete `_runtime/runtime-pup.ts`.
- Delete `E2E_RUNTIME` env switch; runtime defaults to Playwright permanently.
- Update `packages/extension/tests/e2e/README.md` — replace "Helper conventions (CDP regression workarounds)" section.
- `tests/e2e/scripts/check-derivation-parity.ts:1-3` — port `puppeteer` import.
- Settle the passkey track: either remove the per-file Puppeteer override (if Phase 1.5 resolved) or document the Puppeteer-only carve-out for passkey tests.

Gating: `bun run audit:vue` + `bun run test:e2e` + `bun run e2e:agent`, all green, 3 full-suite runs.

Rollback cost: hard (Puppeteer dep gone). Soak makes this acceptable.

---

## 7. Risks & unknowns (revised)

### Architectural risks (revised per Codex)

**Playwright SW lifecycle differences.** `extension.ts:54-57` uses `browser.waitForTarget(t => t.type() === "service_worker")`. Playwright exposes `context.serviceWorkers()` and `context.waitForEvent("serviceworker")`. **Critical caveat from Codex: `context.newCDPSession()` only accepts `Page | Frame`** — `sw-resilience.test.ts:10-20` and `passkey.ts:78` both want CDP against the SW target and may not have a direct Playwright equivalent. Phase 1.5 design memo addresses passkey; sw-resilience needs its own check in Phase 3.1.

**Headless mode for extensions (corrected).** Playwright's docs (per codex's check, as of May 2026) recommend `channel: 'chromium'` for extensions; new-headless support details vary by version. Spike validates which headless mode loads MV3 cleanly. If CI requires headed, `xvfb-run` is the standard fix.

**Per-test `launchPersistentContext` cost.** Today's `launchExtension` (`extension.ts:16-84`) takes ~3-8s for SW liveness (`:79` 30s budget). Per-test for ~43 dapp tests adds 2-6 min wall-clock. Acceptable if pass rate jumps. Phase 3.2's selective scope conversion (not blanket) limits exposure.

**File-scoped fixture semantics.** `dappConnectedExtension` (`extension.ts:237-252`) shares connected dapp state across N tests in a file. Per-test would re-run `connectPlayground` including 2 popup approvals (`:138-159`), adding 5-10s per test. Selective application only.

### Behavioural unknowns

**`closeStuckPopup` necessity.** Verify in Phase 3.1.

**Locator strict mode.** `clickByTestId` picks `candidates[candidates.length - 1]`. Playwright `getByTestId(id)` defaults to strict mode. Port pattern: `.last()`. ~30 call sites. Single search-and-replace pass during Phase 2.

**Vue v-model + microtask flush.** Verify with `fill(a) → fill(b) → click(submit)` chain. If submit fires before disabled flips, keep helper as `locator.evaluate` wrapper.

**WebAuthn / passkey CDP-on-SW.** Codex's biggest single risk callout. See Phase 1.5.

### Test-infrastructure unknowns

**Vitest + Playwright interop.** We keep vitest. `inject(...)` survives because vitest `provide`/`inject` is runner-agnostic.

**`pool: "forks"` + per-test fresh context (smoke).** Smoke already runs each file in a fork. Adding per-test fresh context = nested isolation. Wall-clock impact may be material.

**`protocolTimeout: 300_000`.** Puppeteer-specific. Playwright uses per-call timeouts. For "argon2 + bb.js cold-boot exceeds 3 min" hangs, push per-call timeouts higher.

**Cross-worktree parallel runs.** `e2e/README.md:50-70` orphan-cleanup grep matches `chrome.*--load-extension=$EXTENSION_PATH`, which is runtime-agnostic. Verify in spike.

**CI cost.** Hosted CI is fresh-container-per-job; cumulative-load benefit is irrelevant there. Time CI before/after each phase.

---

## 8. Estimated effort (revised)

| Phase | Estimate | Cumulative |
|---|---|---|
| Pre-flight triage Phase 0 | 60–90 min | 1.5h |
| Spike step A (Puppeteer-only 2-cell control) | 1.5h | 3h |
| Spike step B (full 2×2, only if needed) | 3h | 6h |
| Phase 1 (runtime adapter) | 1.5 days | 2d |
| Phase 1.5 (passkey design memo) — parallel | (overlaps) | 2d |
| Phase 2 (Playwright runtime + helpers) | 1.5 days | 3.5d |
| Phase 3.1 (smoke, 18 files) | 1 day | 4.5d |
| Phase 3.2 (cap/connect/meta + scope conv) | 1 day | 5.5d |
| Phase 3.3 (heavy + sessions + misc) | 1.5 days | 7d |
| Phase 4 (parallelism experiment, optional) | 0.5 day | 7.5d |
| Phase 5 (cleanup after 2-week soak) | 0.5 day | 8d |
| **Total if GO** | | **~8 working days + 2-week soak** |

**Alternative cost frame (codex's central point):**
- If pre-flight Phase 0 says "wallet bug": ~7-9 days saved by NOT migrating.
- If spike step A says "Puppeteer per-test fresh fixes it": ~6-7 days saved by shipping fixture-scope-only fix instead of full migration. (Step A is 1.5h; the fix is ~1-2 days.)

---

## 9. Reversibility (revised)

| Phase | Rollback cost |
|---|---|
| Pre-flight | Zero |
| Spike step A | Zero (throwaway branch) |
| Spike step B | Zero (throwaway branch) |
| Phase 1 (runtime adapter) | Trivial — revert one PR; `E2E_RUNTIME=puppeteer` is the default until Phase 5 |
| Phase 1.5 (passkey memo) | Zero (doc-only) |
| Phase 2 (PW runtime impl) | Trivial — delete `runtime-pw.ts` |
| Phase 3.x | Medium — each batch is its own PR. **Single test tree** means rollback is reverting the runtime-flip PR + scope-conversion PR, not directory merges (the v1 dual-tree design's biggest weakness, flagged by codex) |
| Phase 4 (parallelism) | Trivial — flip the flag |
| Phase 5 (cleanup) | Hard — Puppeteer dep gone. Soak buffers this. |

---

## 10. Anti-scope

- Replacing vitest with `@playwright/test`'s runner.
- Changing Aztec SDK helpers or `setupPreFundedAccount`.
- Changing per-worktree port-isolation infrastructure.
- Migrating Storybook tests.
- "While we're at it" refactors of the wallet under test.
- Replacing `closeStuckPopup` with a wallet-side Vue Transition fix.

---

## 11. Open questions (for user)

1. **Spike step A acceptance threshold for "Puppeteer per-test fresh fixes it".** Plan suggests ≥14/15 (5 tests × 3 runs). Is that strict enough?
2. **If step A succeeds, what's the scope of the fixture-scope-only PR?** All `dappConnectedExtension` users → `dappConnectedExtensionPerTest`, or only the cumulative-load victims? Recommendation: selective, matching the spike's victim set.
3. **Phase 1.5 timeline.** Parallel to Phase 1 — but if passkey design memo blocks for >2 days, do we defer the passkey-port subset and proceed with the rest? Recommendation: yes; passkey can lag the main migration.
4. **Phase 4 (parallelism) — keep optional or commit to running it?** Codex flagged this introduces Aztec-contention as a new variable. Recommendation: keep optional, only run if Phase 3.3 leaves measurable headroom.

---

## 12. Appendix — what Codex caught (v1 → v2 reshape diff)

Codex's review found:
- **Critical structural fix:** 1×2 A/B (Mode A/Mode B) was confounded; v2 uses 2×2 (runtime × scope) with order alternation.
- **Critical insight:** if Puppeteer-per-test-fresh alone resolves cumulative-load, the migration is not needed. v2 makes this the first decision gate.
- **Factual errors (v1 → v2):**
  - Smoke files: 19 → 18 (verified via `find ... | wc -l`).
  - Manifest path: `manifest.chrome.config.ts:25-27` → `manifest/manifest.config.ts:25`.
  - Smoke vitest config timeouts: `30_000 / 300_000` → `60_000 / 90_000`.
  - Headless extension syntax: `headless: "chromium"` → `channel: 'chromium'`.
  - Package name: `playwright-core` → `playwright` (bundled Chromium recommended).
- **Risk reframe:** WebAuthn / passkey port is HIGH risk (Playwright `newCDPSession` doesn't support SW targets), not low. v2 carves out Phase 1.5 as a separate design pass.
- **Phase ordering:** selective scope conversion moved from Phase 4 to inside spike + Phase 3.2 (which is where it's load-bearing). `fileParallelism: true` becomes its own (optional) Phase 4.
- **Dual-tree antipattern:** v1's `tests/e2e/network-pw/` parallel directory + `*-pw.ts` parallel fixtures was churn bait. v2 keeps a single test tree with runtime-swappable fixtures via an `_runtime/` adapter.
- **Phase 3.2 gate:** v1 had internally inconsistent gates (≥95% × 3 AND stop-if-<80%). v2 replaces with: measure Puppeteer baseline on same 13-file subset, gate on relative improvement + repeatability.
