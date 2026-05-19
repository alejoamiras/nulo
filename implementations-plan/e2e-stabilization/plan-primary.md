# E2E stabilization + speed plan — primary draft

**Authors:** primary investigator (this draft); parallel claude (separate doc); awaiting codex audit before consolidation.

## Goal

Take the two e2e suites from "advisory with 26 quarantined tests" to "stable, complete, fast, required on `main` + `dev`."

Stabilization is mandatory; speed is a follow-up audit AFTER stabilization is rock solid (user's explicit ordering).

## Current state (verified against repo HEAD `de7bec0`)

**Test counts (verified by grep):**
- Network suite: 44 test files, ~66 tests total. **18 hard-skipped** (`test.skip`, not `test.skipIf`).
- Smoke suite: 18 test files. **8 hard-skipped**.
- Slow suite (gated separately): 1 file, 1 skipped (legacy faucet test, valid skip).

**Quarantined tests — full inventory:**

| Suite | File | Test | Cluster | Quarantine reason (per PR #77) |
|---|---|---|---|---|
| smoke | appearance.test.ts:70 | "theme persists across navigation away and back" | S1 | popup-internal navigation race |
| smoke | security.test.ts:79 | "auto-lock TTL change persists across navigation" | S1 | same root |
| smoke | contacts.test.ts:91 | "delete contact" | S2 | popup-internal waitForToast race |
| smoke | sw-resilience.test.ts:52 | "extension survives SW stop+respawn..." | S3 | Puppeteer "Navigating frame was detached" |
| smoke | sw-resilience.test.ts:93 | "strict mode default ON ... respawn" | S3 | same root |
| smoke | sw-resilience.test.ts:125 | "strict mode OFF ... silent restore" | S3 | same root |
| smoke | sw-resilience.test.ts:186 | "regression: liveness signal lands within HEARTBEAT_INTERVAL_MS" | S3 | same root |
| smoke | passkey-backup.test.ts:167 | "passkey full-backup export: modal + status card + CTAs" | S4 | hosted CI 5-10x slower than local; 90s timeout still blew past |
| network | transfers.test.ts (8 tests) | balance, pub→pub, pub→priv, priv→pub, priv→priv, token-detail-balances, send-from-token-detail, tx-history | A | tokenReadyExtension importToken cascade |
| network | fee-methods.test.ts (5 tests) | sponsored-default, sponsored-transfer, public-FJ, private-FJ, gas-balance-non-zero | A+B | + feeJuiceImportedExtension cascade |
| network | token-management.test.ts (1 test) | "delete imported token from settings" | A | importToken cascade |
| network | contacts-sender.test.ts (3 tests) | delete-confirm-unregister-sender, edit-migrates-sender, edit-flip-off-drops-both | C/D | wallet RPC-cancellation bug + same root |
| network | data-registerSender.test.ts (1 test) | "silent path adds sender to PXE" | E | playground RPC timeout vs end-to-end latency |

**Also notable:**
- `multi-account-from.test.ts` + `meta-getChainInfo.test.ts` — passing but with scoped `retry: 1` for cumulative-load flake.
- Slow `mint-token.test.ts` — legitimately skipped (faucet UI was removed; replaced by `network/tokens.test.ts`).

**Config snapshot:**
- Smoke (`vitest.e2e.config.ts`): `testTimeout: 60s`, `hookTimeout: 90s`, `pool: forks` (isolate: true), `fileParallelism: false`, `retry: 2`.
- Network (`vitest.e2e.network.config.ts`): `testTimeout: 30s`, `hookTimeout: 5min` (for `tokenReadyExtension` builds), `fileParallelism: false`, no global retry.

**Helper layer (`fixtures/extension.ts` + `helpers.ts`):**
- `clickByTestId`, `clickSelector`, `typeIntoInput`, `replaceInputValue` — workarounds for a Chrome/CDP regression that hangs on element-handle.click()/type. Synthetic in-page click via `page.evaluate(el => el.click())` instead.
- `patchPagePolling(page)` — overrides Puppeteer's default `'raf'` polling with time-based `polling: 200` because rAF throttles in offscreen/unfocused tabs.
- `closeStuckPopup` — force-removes `#popup` teleport children + dim backdrop after the post-mutation signal lands. Works around Vue `<Transition>` getting stuck mid-enter/mid-leave under headless Chrome rAF throttling.
- `switchToLocalNetwork` — fixed in PR #70 to wait for both header text change AND `nulo:ui:activeAccount` settle.
- `addContact` — fixed in PR #59 + #70 (untick register-sender by default; wait for chip when `registerAsSender: true`).
- `openPopup` — double-navigation (popup → about:blank → popup) workaround for the SW first-popup handshake.

## What prior work has already proven (don't repeat)

From `implementations-plan/network-test-triage/`:
- **R1 (PXE-guard serialization)**: `aztec-runtime/src/pxe/service.ts:314-345` serializes all PXE access. Under cold-PXE conditions the queue accumulates. PR #70 confirmed: `parseTokenInterface` is fast (5.2s) and `simulateTx` is ~3.6s — NOT a 60s-timeout-causing problem on its own. R1 still exists but Phase 0 showed it's not the dominant fault under PR #70's fixes.
- **R2 (RPC disconnect cancel)**: `extension-messaging/background/client.ts:77-83` rejects pending requests on `disconnect()`. PR #70 fix #6 (`switchToNetwork` snapshot+change-wait) + fix #7 (`addContact` chip-wait) addressed the surfaces where this bit us. Disconnect still cancels pending; we live with it via helper discipline.
- **Phase 0 unifying root cause**: `app.vue:131-150` network watcher didn't auto-create accounts on chain switch with empty account list. PR #70 fix #1 added `ensureDefaultAccount` after re-fetch. This was the dominant fault and is fixed.
- **Wallet bugs from PR #70 (#1-#5)** were real and remain fixed (verified by git blame on current source).
- **Helper bugs (#6-#11)** all landed and remain in place.

So if Phase 0 baseline (below) shows the 18 network tests still fail, the cause is **new** — load-cumulative, hosted-runner-specific, or a regression in something downstream.

## Phase 0 — Baseline reality check (1–2 hr)

**Hypothesis:** the 26 tests are split between (a) genuinely-still-broken, (b) defensively quarantined because they happened to fail once during CI bringup. Phase 0 separates them.

### Steps

**0.1 — Local smoke baseline.** Remove `test.skip` → `test.skipIf(!hasConfig)` (or just `test(...)` for smoke) for all 8 smoke quarantines. Run `bun run --cwd packages/extension test:e2e` 5 times. Capture per-test outcome.

Cost: ~5 min × 5 = 25 min if all pass; could be longer with hangs.

**0.2 — Local network baseline.** Same un-quarantine for all 18 network tests. Run `bun run e2e:agent` 3 times. Capture per-test outcome.

Cost: ~15 min × 3 = 45 min.

**0.3 — Hosted CI baseline (smoke).** Push a temp branch with same un-quarantine; trigger `Smoke e2e` via `e2e:smoke` label. Compare against local.

Cost: 1 CI run, ~6-8 min wall.

**0.4 — Hosted CI baseline (network).** Same as 0.3, label `e2e:network`. 1 run.

Cost: 1 CI run, ~30-45 min wall.

**0.5 — Output**: `phase0-baseline.md` in this directory, with a table:

```
Test                                    Local 5×    CI 1×    Verdict
appearance.test.ts: theme persists      5/5 pass    pass     defensive (un-skip)
contacts.test.ts: delete contact        4/5 pass    fail     real flake (S2 confirm)
transfers.test.ts: balance              3/3 pass    fail     hosted-only (S?? new)
...
```

Verdicts:
- **defensive** — un-quarantine immediately, no fix needed.
- **real flake (local)** — fix the test/helper.
- **real flake (CI-only)** — investigate runner-specific cause (memory, IO, parallelism).
- **deterministic fail** — old fix bit-rotted; need to re-root-cause.

### Why this is non-negotiable
Without 0.1–0.4 we'd be planning fixes for tests that may already work. The whole problem here is "we don't know which is which because we've been moving fast." Phase 0 is the empirical answer.

### Cost guardrail
If 0.1 or 0.2 show >5 test hangs that cost >30 min each, abort and call user. Don't burn an afternoon waiting on `test.skip` removals that need helper hardening before they can even start.

---

## Phase 1 — Smoke stabilization (8 tests, 4 clusters)

**Order chosen so each fix unblocks the next.**

### Cluster S1 — popup-internal navigation race (2 tests)

**Files:** `appearance.test.ts:70`, `security.test.ts:79`

**Symptom:** After `navigateByHash("#/popup/settings/about")` → `navigateByHash("#/popup/settings/appearance")` (or `/security`), the assertion that `document.documentElement.getAttribute("theme")` is still `"light"` (S1.appearance) or that `auto-lock-input` still reads `45` (S1.security) sometimes fails. PR #59 fixed by swapping `/privacy` (non-existent) for `/about` (real page); flakes returned in PR #77.

**Hypotheses to test in Phase 0:**
1. The pattern `navigateByHash → assert on the navigated-to page` doesn't wait for the page's `onMounted` to finish. The theme/auto-lock value lives in `<script setup>` post-load; reading too early sees the previous page's leftover state.
2. CSS Module hot-swap during route change leaves a stale `<style module>` block that briefly applies the wrong theme.
3. The waitForHash helper resolves on hash change, but the Vue router-view re-renders async after.

**Fix surfaces:**
- `helpers.ts navigateByHash` — currently does `page.evaluate(() => { window.location.hash = "..." })` then `waitForFunction(hash === expected)`. Add: wait for the new page's deterministic mount signal (a testid that's unique to the landed page).
- Each test that does navigate-away-and-back: wait for the away-page's mount before navigating back.

**Validation:**
- Unit: none (Vue Router behavior, not unit-testable).
- E2E: run S1 tests 10× back-to-back. Pass rate must be 10/10.

**Decision matrix:**
- If Phase 0 shows defensive → un-skip.
- If Phase 0 shows real flake → harden `navigateByHash` to wait for landed-page mount, then un-skip.

### Cluster S2 — waitForToast race (1 test)

**File:** `contacts.test.ts:91` — "delete contact"

**Symptom:** After `deleteContact(page, "ToDelete")`, the next assertion (no console errors / no page errors) sometimes fires before the toast / state mutation has settled.

**Hypotheses to test:**
1. `deleteContact` helper returns before the toast appears; subsequent error-list checks see a pending error pushed by the in-flight RPC.
2. Toast text changed; helper still scans for old text. (Less likely — `addContact` had this exact bug in PR #59 and the fix moved off toast text to deterministic state.)

**Fix surface:**
- `helpers.ts deleteContact` — verify it waits for `[data-testid="contact-row"][data-contact-name="ToDelete"]` to NOT be present, not for toast text. Toast was the bug in PR #59 for addContact.
- If helper is fine, look upstream: does `contactService.deleteContact` resolve before `chrome.storage.local` is flushed?

**Validation:**
- E2E: 10× run.
- Optional unit: contact service test that asserts deleteContact's `chrome.storage.local` mutation completes before the promise resolves.

### Cluster S3 — SW respawn flake (4 tests)

**File:** `sw-resilience.test.ts:52,93,125,186`

**Symptom:** After `Runtime.terminateExecution` on the SW target, the next `openPopup` step fails with Puppeteer "Navigating frame was detached" or "LifecycleWatcher disposed."

**Background:** PR #77 quarantined these 4 with the note that "user-visible lock/unlock + strict-mode contracts are already covered by `security.test.ts` + `registration.test.ts`." That's a partial cover, but:
- Test :52 (SW survival cycle: lock → kill → unlock → general) — covers an explicit recovery path not in other tests.
- Test :93 (strict-mode default ON cold restore) — covers strict-mode security contract, real defense-in-depth assertion. **Not covered elsewhere.**
- Test :125 (strict-mode OFF silent restore) — same contract, opposite branch. **Not covered elsewhere.**
- Test :186 (heartbeat-timing regression) — pins commit c67e4f0's setInterval-vs-while-loop fix. **Pure regression pin; if SW respawn helper is hardened, this is cheap to keep.**

**Decision:** these are valuable, not redundant. Don't delete; fix the helper.

**Fix surface:**
- `openPopup` after SW kill — currently does 2× `goto(popupUrl)` with `about:blank` between. Under SW respawn, the SW target may detach between the first and second goto, and Puppeteer trips. Need a "wait for SW target to re-appear" step BEFORE `openPopup`.
- `stopServiceWorker` helper (sw-resilience.test.ts:10-20) — could optionally `await browser.waitForTarget(t => t.type() === "service_worker" && ...)` AFTER the terminate, so the test starts the new popup with a known-good SW.

**Validation:**
- E2E: run each test 10× back-to-back. Pass rate 10/10.
- Test :186 explicitly asserts liveness lands < 10s of respawn — a real regression pin worth preserving.

**Edge case:** if the helper hardening is too fragile (CDP race we can't fully eliminate), env-gate these 4 tests behind `process.env.CI_HOST !== "github-hosted-small"` or similar. The tests stay green on local + bigger runners; we file a follow-up for a deterministic helper.

### Cluster S4 — hosted-CI slowness (1 test)

**File:** `passkey-backup.test.ts:167` — "passkey full-backup export: modal appears + status card + CTAs become available"

**Symptom:** Local ~10-15s, hosted CI 90s+, blown past 90s `waitForFunction` + 120s test timeout.

**Hypothesis:** the test does an 11-service RPC chain + SHA hash. Each RPC is a SW round-trip. On a 2-core hosted runner under puppeteer/vitest pressure, each round-trip can balloon to multiple seconds.

**Three options:**
1. **Env-gate to local only** (cheapest): `test.skipIf(process.env.CI)("passkey full-backup export", ...)`. Loses CI coverage for this flow.
2. **Shrink the chain** (medium): the 11-service chain is inherent to the feature; the SHA hash is cheap. The chain is what's expensive. Could mock parts of it for the test ONLY — but that defeats the e2e.
3. **Move to larger CI runner** (cost-bearing): use `runs-on: ubuntu-latest-4-core` (or equivalent self-hosted) ONLY for this test file. Estimated extra cost: $0.016/min × 2 min ≈ $0.03/run × ~100 PRs/mo = $3/mo. Trivial.

**Recommended:** option (3). The test exercises a critical security primitive (full-backup export with passkey). Losing CI coverage is unacceptable; mocking defeats the point; paying $3/mo for a beefier runner on one file is right.

**Implementation sketch:**
- Split `passkey-backup.test.ts` into its own workflow leg, or add a per-test directive that vitest can't honor — so in practice it'll be a small workflow that runs only that file on a beefier runner, OR we lift to a separate self-hosted runner.
- Cleaner: keep the test in the smoke suite, add `e2e-large` workflow that runs on `runs-on: ubuntu-latest-4-core` and includes only the passkey-backup file. Use a label/path-filter so it doesn't run on every PR.

**Validation:**
- Run on a 4-core runner: target <60s wall.
- Confirm test fully exercises the 11-service chain (don't shortcut).

---

## Phase 2 — Network stabilization (18 tests)

### Pre-Phase-2 — re-confirm Phase 0 dataset

Network un-skip + 3× local runs (Phase 0.2) is the source of truth.

**Two scenarios after Phase 0:**

#### Scenario A — all 18 pass un-quarantined locally + on hosted CI

Most likely scenario given PR #70's findings. Action:
1. Un-skip all 18 tests (`test.skip` → `test.skipIf(!hasConfig)`).
2. Remove the `biome-ignore lint/correctness/noUnusedVariables: kept for un-skip` comments — they're no longer needed once `hasConfig` is used.
3. Update README "Known failures + triage" section to remove the 18-test bucket.
4. Add per-test `retry: 1` only on the tests that show flake (probably the cumulative-load rotating set).
5. Done.

Validation: full network suite locally 3× + hosted CI 2×. Must hit ≥97% pass rate; rotating flakes acceptable if covered by retry.

#### Scenario B — some/all 18 fail un-quarantined

For each failure, re-run Phase 0 instrumentation:
- R1 (PXE serialization) probe: log `withPxeRead/Write` queue depth + latency.
- R2 (RPC cancel) probe: log `client.ts disconnect()` REJECT-PENDING events.
- Account-state probe: log `appStore.account` populated state on chain switch.
- importToken-specific probe: log NewTokenPopup's handleAddToken branches.

This is exactly what Phase 0 of the prior triage did. Cost: instrumentation ~30 min revertible; runs ~20 min total. Output: a new bucket of failures with mechanism notes.

Then per-cluster fix as in the prior triage.

### Cumulative-load rotating flake

Acknowledged separately by PR #70: 2-3 tests rotate per single-run when 43 files run back-to-back. PR #70 pinned `retry: 1` on the two consistent flake-victims (`multi-account-from`, `meta-getChainInfo`) but the rotation continues elsewhere.

**Decision tree:**

1. **Wait for upstream aztec.js IndexedDB → KV migration** (zero work, indefinite ETA). Track upstream; reassess when it lands.
2. **Per-file aztec-sandbox restart** (high work, big cost). Anvil + aztec sandbox cold-start is ~30s each; 43 files × 30s = +21 minutes per full network run. Probably unacceptable.
3. **Group tests into smaller batches** with restart between groups (medium work). E.g., 5 groups of ~8 files, restart between groups, +2.5min total. **Tractable.**
4. **Scoped `retry: 1` on the empirically flaky set** (low work, in place already for 2 files). Could expand to the rotating-flake set if Phase 0 surfaces them.

**Recommended:** combination of (3) for the inherent cumulative-load surface + (4) for residual rotating flakes. Document a contract: max 5% of tests allowed `retry: 1`; tests above that threshold are real bugs to fix.

### Per-cluster details (from prior triage, may be moot after Phase 0)

I'm not duplicating the cluster details — `plan-reconciled.md` and `phase0-findings.md` have them. Phase 2 of THIS plan assumes Phase 0 confirms most of those fixes still hold and the question is just "un-skip" vs "re-root-cause."

### Validation

For each cluster un-skipped:
- Run the file 5× in isolation (`bun run e2e:agent <path>`). Pass rate 5/5.
- Run the full suite 2× (`bun run e2e:agent`). Each individual file passes ≥2/2; rotating flakes covered by retry.
- Hosted CI: full network suite passes 2× consecutively.

---

## Phase 3 — Speed audit

**Only after stabilization is locked in.** This phase has high blast radius — a sleep replaced by a state-driven wait can expose a real race. Don't combine with Phase 1/2.

### Inventory tactic

Run these to catalog the surface:

```bash
# All explicit timeouts in fixtures + helpers + tests
grep -rn "timeout: " packages/extension/tests/e2e/ --include="*.ts"

# All setTimeout sleeps
grep -rn "setTimeout" packages/extension/tests/e2e/ --include="*.ts"

# All polling configs
grep -rn "polling:" packages/extension/tests/e2e/ --include="*.ts"
```

(Initial scan: 251 `timeout:`/`setTimeout` occurrences across fixtures + tests. ~55 explicit timeouts in fixtures alone.)

### Categorize each

For each `timeout: N`:
- **Justified** — wraps a multi-step user flow (e.g., register profile is 7 steps, 15s timeout is right).
- **Defensive padding** — could be replaced with a state-driven `waitForFunction` that resolves immediately on success. E.g., `await new Promise(r => setTimeout(r, 200))` after a button click is almost always replaceable.
- **Over-budget polling** — `polling: 500` where `polling: 100` would do (with no perf cost; just sees the change sooner).
- **Parallelizable** — sequential `await` chains where the next op doesn't depend on the prior's result.

### Specific easy wins to verify

From a quick scan of `fixtures/extension.ts`:
- `launchExtension` SW-liveness wait: `timeout: 30_000, polling: 500`. Can polling drop to 250? Likely yes (negligible CPU cost).
- `connectPlayground` connect-button wait: bumped to `30_000` in PR #70 to absorb cold playground load. Acceptable; not a speed win without addressing the cold-load itself.
- `openPopup` triple-navigation: `goto(popup) → goto(about:blank) → goto(popup)`. Each `goto` is a couple of hundred ms. If we can fix the SW handshake without the triple-nav, that's a real win (~500ms per test × ~50 tests = ~25s on the smoke suite).
- `tokenReadyExtension` balance poll: `40 × 1500ms = 60s` already tightened in PR #70. Could be `60 × 1000ms` for the same budget with more responsive happy-path detection.

From `helpers.ts` (truncated initial scan):
- `lockWallet` waitForFunction at `timeout: 60_000` — high but justified (SW round-trip + isLogined watcher chain).
- `setTimeout(r, 200)` in `navigateToSettings` between segments — defensive; replace with deterministic state-on-mount check.
- `setTimeout(r, 50)` × 2 (in replaceInputValue's Vue microtask flush) — already minimal but justified by the noted race.

### Estimate of biggest wins

| Win | Before | After | Saved | Tests touched |
|---|---|---|---|---|
| openPopup remove triple-nav | ~500ms × ~50 tests | ~50ms × ~50 tests | ~22s smoke | all |
| Replace navigateToSettings 200ms sleep with state-on-mount | ~200ms × ~30 tests | ~10ms × ~30 tests | ~6s | many |
| polling: 500 → 250 on liveness | 250-500ms avg | 125-250ms avg | ~1s × tests | bootstrap-only |
| Drop hookTimeout: 300_000 fallback default to 60_000 in network config (only fixture-build hooks need 5min) | n/a | n/a | makes flakes loud sooner | network |
| tokenReady balance poll: 40×1.5s → 60×1s | up to 60s on slow path | up to 60s on slow path | no win, BUT faster happy-path | network |
| Drop redundant `await new Promise(r => setTimeout(r, 200))` chains in form helpers | ~200ms × multiple | 0 | dependent on grep | many |

Realistic total saving on smoke: **~30-45s wall-clock** (out of currently ~4-6 min). Smoke goes from ~5 min to ~4 min on CI.

On network: **less impactful** because most time is spent in genuine PXE/anvil/aztec work. Maybe 30s-1min off the full ~25min run. Diminishing returns.

### Speed-audit deliverable

A `phase3-speed-findings.md` with:
- Inventory table (every `timeout` / `setTimeout` / `polling` with category + recommendation).
- Top-N wins ranked by saved-ms × times-invoked.
- Anti-list: things NOT to touch (e.g., `protocolTimeout: 300_000` on browser.launch — safety net, not a perf issue).

Then a small PR (or two) implementing the wins. Each individual change measured against a baseline run.

---

## Phase 4 — Lock-in

1. Promote `Smoke e2e / Status` from advisory to required on `dev` (currently only required on `main` per `.github/README.md`).
2. Update CLAUDE.md's "Quality gates" table to reflect post-stabilization state.
3. Delete the `implementations-plan/network-test-triage/` (or move to a "historical" subdir) — once superseded.
4. Delete this plan's working files after merge; keep only a closure document if useful.
5. Document the retry-policy contract: max 5% of tests may carry scoped `retry`. Above that, file as real bug.

---

## What success looks like (per user)

- All quarantined tests either: un-skipped + passing, or deleted with a recorded reason, or env-gated with explicit justification.
- Smoke + network both required CI gates on `dev` + `main`.
- Each test is **succinct + valuable**. No 10-test-for-same-behavior duplication. Failures are caught.
- Speed audit yields a measurable wall-clock reduction (target 20-30% on smoke; ~5% on network — most network time is real PXE work).

## Open questions for the user (decisions needed before Phase 0 starts)

1. **Aztec.js IndexedDB → KV migration timing.** Should we wait, or address the rotating-flake-under-cumulative-load now? If now, my recommendation is grouped-batch runs with sandbox restart between groups (option 3 above). **OK?**

2. **Hosted CI runner sizing for passkey-backup.** S4 cluster recommendation is to upgrade the runner for that one file (~$3/mo). Alternative: env-gate to local-only (loses CI coverage). **Pay for the runner?**

3. **Test deletion threshold.** None of the 26 quarantined tests look redundant after analysis, but you said "we don't over create 10 tests for the same behavior." If during Phase 0 I find redundancy (e.g., a transfer-type case that's covered by another scenario), **can I delete with a note in the PR description, or always preserve?**

4. **R1 (PXE-guard serialization) investigation.** Multi-day rabbit hole in `@nulo/aztec-runtime`. Current evidence: it's real but not test-blocking after PR #70's fixes. **Defer or investigate now?** My instinct: defer; revisit after upstream KV migration lands.

5. **PR strategy.** Stack of small PRs (one per cluster) into `dev`, or one big "e2e stabilization" PR? My instinct: **stacked PRs** (S1 → S2 → S3 → S4 → A → B/C/D/E → Speed). Each lands independently; easier to revert; each carries its own e2e validation. **OK?**

6. **Retry policy.** Currently smoke has `retry: 2` global + 2 scoped retries on network. After stabilization, my recommendation: **smoke `retry: 0` globally + per-test scoped retries with justification; network keeps `retry: 1` scoped on the rotating-flake set.** **OK?**

7. **Promote smoke to required on `dev`.** Currently advisory. After Phase 1 lands, my recommendation is **required on `dev` + `main`** (no reason to gate `main` only). **OK?**

8. **Self-analysis.md:427 confirmed.** The races are documented in this very worktree at `wallets-architecture-research/nulo/self-analysis.md:427` as "three known e2e flakes still in master": `contacts > edit + delete contact` (waitForToast race), `appearance > theme persists across nav` (navigateByHash race), `security > auto-lock TTL change` (same root). These predate M6. PR #59 fixed the *symptoms* (route swap, addContact untick) but the underlying `waitForToast` + `navigateByHash` races remain. So S1+S2 are **real product/test races to fix**, not defensive quarantines.

## What this plan is NOT

- Not a fix design for clusters A/B/C/D/E in detail — `plan-reconciled.md` already has that, and Phase 0 may obsolete some of it.
- Not a CI workflow redesign — the `.github/workflows/` shape is fine; only gating + labels may move.
- Not a fixture-architecture refactor — fixtures work; we add hardening, not redesign.
- Not a retry-as-flake-hider mechanism — retries stay scoped + justified.
