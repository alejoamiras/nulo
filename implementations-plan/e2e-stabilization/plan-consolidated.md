# E2E stabilization + speed audit — consolidated plan

Consolidation of `plan-primary.md` (mine) + `parallel-claude-plan.md`. Divergences resolved by re-grepping the source. **This is the plan codex will audit.**

## TL;DR

- **26 quarantined tests is a miscount.** Network has **20** skipped (18 from PR #77 + 2 pre-existing); smoke has **8** from PR #77. Total = **28**.
- **The dossier's framing is partly stale.** PR #77's skip comments cite mechanisms that don't match the current code (e.g., `delete contact`'s comment says "waitForToast race" but `deleteContact` helper has no `waitForToast` at `helpers.ts:332-388`). Reclassify before touching anything.
- **Network suite has ~zero CI evidence the skips were needed.** PR #77's network-e2e job ran but skipped all 67 tests because the path-filter + label gate didn't trigger (parallel claude verified via run `25859472608` logs). The 18 PR-#77 skips were defensive on local; we don't have CI signal they actually fail on hosted runners.
- **PR #70's wallet/helper fixes are still in place** (`app.vue:131-162`, `helpers.ts:switchToNetwork`, `addContact` chip-wait, Toggle.vue data attrs). So un-skip-and-run is the right next step.
- **The user's "lots of timeouts → slow" hypothesis is partly miscalibrated.** Big timeouts wrap real PXE/argon2/SW round-trips and are justified. The recoverable time is in **small `setTimeout(r, N)` padding sleeps** (~15-20 sites) and `retry: 2` smoke-wide masking real flakes.

## Verified inventory (against repo HEAD `de7bec0`)

**Network skips (20 total):**

| File | Test | Cluster | Origin |
|---|---|---|---|
| transfers.test.ts (8 tests) | balance, pub→pub, pub→priv, priv→pub, priv→priv, token-detail-balances, send-from-token-detail, tx-history | A | PR #77 |
| fee-methods.test.ts (5 tests) | sponsored-default, sponsored-transfer, public-FJ, private-FJ, gas-balance-non-zero | A+B | PR #77 |
| token-management.test.ts (1) | delete imported token | A | PR #77 |
| contacts-sender.test.ts (3) | delete-confirm-unregister, edit-migrates-sender, edit-flip-off-drops | C/D | PR #77 |
| data-registerSender.test.ts (1) | silent path adds sender | E | PR #77 |
| batch-partial-failure.test.ts:29 | preserves per-leg result shape | F (architectural mismatch — canonical 2D-D3) | pre-PR-#77 |
| connect-locked-queue.test.ts:19 | discovery queued while locked, drained on unlock | G (90s drain-timing flake) | pre-PR-#77 |

**Smoke skips (8 total, all PR #77):**

| File | Test | Cluster |
|---|---|---|
| appearance.test.ts:70 | theme persists across navigation away and back | S1 |
| security.test.ts:79 | auto-lock TTL change persists across navigation | S1 |
| contacts.test.ts:91 | delete contact | S2 |
| sw-resilience.test.ts:52,93,125,186 | 4 SW-respawn tests | S3 |
| passkey-backup.test.ts:167 | passkey full-backup export | S4 |

Slow `mint-token.test.ts:7` is a legitimate skip (faucet UI removed; covered by `network/tokens.test.ts`) — **not in scope**.

## Reclassified clusters (correcting PR #77's skip comments)

### S1 — appearance + security navigation tests (NOT a navigation race)

**Sibling-test contradiction**: `appearance.test.ts:25` "animations toggle persists across navigation" uses the same `navigateByHash → /about → back` pattern and is NOT skipped. If `navigateByHash` had a generic race, the sibling would flake too.

**Per-test real mechanism (parallel claude's read, accepted):**

- **`appearance.test.ts:70`** — between `setTheme(page, "light")` and the subsequent `navigateByHash`, the theme write is in-flight via SW RPC. On the slow hosted runner the RPC isn't done before nav fires; the back-nav reads `nulo:ui:theme` from storage and sees the prior value. Mechanism: **un-awaited SW-write race**, not navigation race.
- **`security.test.ts:79`** — file-scoped fixture is on its third test after a `change password + lock` flow. `ensureUnlocked(page, NEW_PASSWORD)` enters the new password, but the SW SessionManager may still be clearing the old passhash asynchronously. The popup lands on `/popup/auth` instead of `/popup/general`. Mechanism: **password-rotation state contamination across file-scoped tests**.

### S2 — "delete contact" (STALE skip comment)

**`deleteContact` helper at `helpers.ts:332-388` does NOT use `waitForToast`.** It waits for the row to disappear via `waitForFunction(!document.querySelector(rowSelector))`. The skip comment is bit-rotted.

**Real mechanism**: the test's final assertion `expect(registeredExtension.consoleErrors).toEqual([])` is brittle to teardown noise (SW disconnect errors after popup close). The non-skipped sibling at `contacts.test.ts:103` does the same flow without that assertion and passes. Mechanism: **brittle consoleErrors assertion**, not a helper race.

### S3 — SW respawn (4 tests — NOT redundant)

PR #77 claimed redundancy with `security.test.ts` + `registration.test.ts`. We both re-read those files and reject the claim:

- `:52` (lock → kill → unlock → general) — security.test.ts only tests in-page Lock button, not SW kill. Catches storage migration regressions.
- `:93` (strict-mode ON: SW death wipes session) — **no equivalent anywhere**. This IS the strict-mode contract.
- `:125` (strict-mode OFF: bearer survives SW death) — **no equivalent anywhere**. Opposite branch.
- `:186` (regression pin for c67e4f0's setInterval-vs-while-loop liveness gap) — pure regression pin; CLAUDE.md endorses these.

Mechanism (real): `Runtime.terminateExecution` returns immediately but the SW is still alive enough to interfere with the next `openPopup → page.goto(popupUrl)`. Puppeteer trips with "Navigating frame was detached" / "LifecycleWatcher disposed".

### S4 — passkey full-backup (slow product chain, not test bug)

Failed run shows 290s elapsed before the 90s `waitForFunction` budget tripped. Local: 10-15s for the same chain. **5-10x runner slowdown is real** for the 11-service backup chain + SHA hash.

But two open questions before deciding the fix:
1. Is the chain itself optimizable (sequential RPCs that could be parallel; redundant PBKDF2 re-derivations)?
2. Is `runs-on: ubuntu-latest-large` (4-vCPU) actually available on this account's GH plan? My plan-primary recommended this; parallel claude flagged it as needing verification.

### A/B — network token + fee-methods cascade (defensive, likely passes today)

PR #70 fixed the unifying root cause (`ensureDefaultAccount` in network watcher at `app.vue:131-162`). The fix is **still present** in the current source. Reading `plan-reconciled.md`'s R1/R2 framing now: it was **superseded** by `phase0-findings.md` and isn't load-bearing for current behavior.

**Expected outcome on un-skip:** all 14 of these pass cleanly on a fresh local + hosted CI run.

### C/D — contacts-sender migrate / chip (defensive, likely passes today)

PR #70 also addressed these via `Toggle.vue data-toggle-disabled` + `addContact` chip-wait + `AztecAddress.random()` test data. All still present.

**Expected outcome on un-skip:** all 3 pass.

### E — data-registerSender (defensive, likely passes today)

PR #70 bumped `callExpectingNoPopup` timeout from 30s → 60s for the cold-PXE registerSender path. Still present.

**Expected outcome on un-skip:** passes.

### F — batch-partial-failure (architectural; defer)

Comment says "ARCHITECTURAL-MISMATCH(canonical 2D-D3)" with the real fix in `wallet-bridge` (emptyBatchResult per-method shaping). **Out of scope** for this stabilization push. File as a separate follow-up.

### G — connect-locked-queue (separate root)

Comment says "discovery queue drain timing is brittle (90s timeout); needs a deterministic 'queued' signal from the extension before unlock". Real wallet-side fix: emit a deterministic "queued" event when discovery is parked. **Could fold into S3** (also touches SW lifecycle) or defer as a separate small PR.

---

## Phase 0 — Baseline reality check

**Goal:** separate "the skip was defensive" from "the test still really breaks" without any code change.

### 0.1 — Local Linux reruns (single host, ~30 min)

Use Lima / Docker / GitHub-hosted-runner-image (Ubuntu 24.04) to mirror the CI substrate. For each skip cluster, run the un-skipped test in isolation, capture: pass/fail, wall time, first error line, `consoleErrors`/`pageErrors` state.

```bash
# Smoke per-test (un-skip first via local stash)
bun run --cwd packages/extension test:e2e tests/e2e/appearance.test.ts -t "theme persists"
bun run --cwd packages/extension test:e2e tests/e2e/security.test.ts -t "auto-lock TTL"
bun run --cwd packages/extension test:e2e tests/e2e/contacts.test.ts -t "delete contact"
bun run --cwd packages/extension test:e2e tests/e2e/sw-resilience.test.ts
bun run --cwd packages/extension test:e2e tests/e2e/passkey-backup.test.ts -t "modal appears"

# Network per-file (un-skip first via local stash)
bun run e2e:agent tests/e2e/network/transfers.test.ts
bun run e2e:agent tests/e2e/network/fee-methods.test.ts
bun run e2e:agent tests/e2e/network/token-management.test.ts
bun run e2e:agent tests/e2e/network/contacts-sender.test.ts
bun run e2e:agent tests/e2e/network/data-registerSender.test.ts
```

### 0.2 — Hosted CI reruns (1-2 hr CI time)

Throwaway branch `e2e/stabilization-baseline` with all 28 skips removed (kept in `_unskip` git stash so we don't lose the originals). Force smoke + network gates via labels `e2e:smoke` + `e2e:network`. Watch:

- Run smoke 5× on hosted: pass/flake-rate per test.
- Run network 3× on hosted: pass/flake-rate per test.

Cheap probe to differentiate hosted-only failures from inherent flakes.

### 0.3 — Output

`phase0-baseline.md` in this directory with a matrix:

```
Cluster  Test                       Local 5×   CI 5×   Verdict
S1       appearance: theme persists 5/5       3/5     real flake (hosted-amplified)
S1       security: auto-lock TTL    4/5       4/5     real flake (file-scope contamination)
S2       contacts: delete contact   5/5       5/5     defensive (un-skip)
S3       sw-resilience (4 tests)    20/20     8/20    hosted-only — needs helper hardening
S4       passkey backup             1/1@45s   0/1@290 hosted-only — chain too slow
A        transfers (8)              8/8       8/8     defensive (un-skip)
B        fee-methods (5)            5/5       4/5     defensive + 1 rotating-flake
C        contacts-sender migrate    2/2       2/2     defensive
D        contacts-sender chip       1/1       1/1     defensive
E        data-registerSender        1/1       1/1     defensive
F        batch-partial-failure      n/a       n/a     architectural — defer
G        connect-locked-queue       1/1@flake n/a    needs queued-signal fix
```

**Anti-scope of Phase 0:** don't fix anything. The matrix decides what Phase 1/2 must do.

**Decision gate:** if matrix is mostly "defensive (un-skip)" → land Phase 1+2 small. If mostly "real flake" → re-instrument like phase0-findings did.

---

## Phase 1 — Smoke stabilization (4 clusters)

Order chosen so each fix unblocks the next; smallest-risk-first.

### S2 (1 test, ~30 min) — drop brittle consoleErrors assertion

Surface: `contacts.test.ts:91-99`. Either:

- **Option A (preferred):** filter `consoleErrors` for known-benign SW disconnect noise via a helper `isBenignDisconnectError(msg)` — matches the existing `isTargetDetachError` shape in `fixtures/extension.ts:847-859`. Apply to ALL smoke tests' consoleErrors assertions; one helper, many beneficiaries.
- **Option B:** drop the consoleErrors assertion entirely on this test, rely on the row-disappearance signal as proof.

**Lean: Option A.** Reusable; tightens assertions across the suite instead of looser.

**Validation:** 5× local + 5× CI runs. 0 flakes.

### S1 (2 tests, ~2-3 hr) — synchronize SW write + isolate the security test

Per-test fix:

- **`appearance.test.ts:70`** — after `setTheme(page, "light")`, add `await page.waitForFunction(async () => (await chrome.storage.local.get("nulo:ui:theme"))["nulo:ui:theme"] === "light")` with a 5s budget. Mechanism: explicit wait for the SW write to land in storage before navigating away.
- **`security.test.ts:79`** — switch from `registeredExtension` (file-scoped, polluted) to `registeredExtensionPerTest`. Eliminates the post-rotation state contamination. Cost: +~5s for the per-test profile registration. Acceptable.

**Open question for codex audit:** does `setTheme` already wait for the SW write internally? If yes, the bug is at the SW handler; if no, the test is right to add the wait.

**Validation:** 5× local + 5× CI runs. 0 flakes.

### S3 (4 tests, ~3-4 hr) — harden SW-respawn helper

`stopServiceWorker` at `sw-resilience.test.ts:10-20` returns immediately after `Runtime.terminateExecution`. Add a wait for the SW to actually be dead before the test continues. Two complementary probes:

1. Wait until `chrome.storage.session.get("nulo:liveness")` is undefined (session storage wiped means the SW genuinely terminated).
2. Wait for a fresh service-worker target to appear via `browser.waitForTarget` AFTER the wipe is observed.

Then `openPopup` after respawn already does the `goto(popup) → about:blank → goto(popup)` double-load; ensure it tolerates `isTargetDetachError` like `clickByTestId` does (`extension.ts:847-859`).

**Validation:** 10× local + 10× CI runs. 0 flakes.

### S4 (1 test, ~4-6 hr OR ~30 min) — decide based on profiling

Two paths, decision gate at first hour of work:

- **Path A (profile first, 4-6 hr):** instrument the 11-service backup chain to log per-step latency. Identify the dominant cost. Optimize what's optimizable. Outcome: either a perf PR (good byproduct) or "the chain is inherently slow."
- **Path B (timeout bump, 30 min):** accept "hosted runner is too slow," bump test timeout to 180s, add per-step diagnostic logs for the next regression. Don't unblock CI in S4 if Path A is feasible.

**Recommended:** Path A. Even if the chain ends up being inherently slow, the profiling artifact is reusable and the diagnostic logs help future debugging.

**Open question for user:** if Path A reveals a perf opportunity, do we want to take it now or defer to a separate perf PR?

**Validation:** test passes within timeout consistently on hosted CI.

---

## Phase 2 — Network stabilization (5 clusters + 2 defer)

### 2.1 — Un-skip all 18 PR-#77 quarantines (likely a single PR)

Restore `test.skipIf(!hasConfig)` (or just `test(...)` if no config gate is needed). Remove the `// biome-ignore lint/correctness/noUnusedVariables: kept for un-skip` comments. Remove the `// SKIP: cluster X` block comments.

**Expected outcome (Phase 0.2 confirms):** ~14-18 pass cleanly. ~0-4 are hosted-only flakes. For hosted-only flakes, identify which: rotating-load-flake (add to `retry: 1` scope) or new regression (Phase 0.3 → root cause).

### 2.2 — Defer F (batch-partial-failure)

Architectural mismatch tracked in the test's own comment. Open a separate issue + small wallet-bridge PR. NOT this PR's surface.

### 2.3 — Address G (connect-locked-queue) separately

Emit a deterministic "queued" event from the extension when discovery is parked behind a lock. Test consumes that event instead of polling for 90s. Tractable; ~3-4 hr if folded with S3 SW work. **My lean:** fold with S3.

### 2.4 — Rotating-flake under cumulative load

From `full-suite-findings.md`: 2-3 tests rotate flaky per full-run; `retry: 1` already scoped on `multi-account-from` + `meta-getChainInfo`.

**Decision tree (consolidated from both plans):**

| Option | Cost | Risk | Verdict |
|---|---|---|---|
| Wait for upstream `@aztec/aztec.js` IndexedDB → KV migration | 0 dev | Upstream ETA unknown | **Wait. Track upstream.** |
| Per-file aztec sandbox restart | +21 min/full-run | Loses cumulative-state cross-test signal | Skip |
| Grouped batches with restart between groups | +2.5 min/full-run | Loses some cross-test signal | Defer; revisit if upstream KV migration doesn't land |
| Expand scoped `retry: 1` to the rotating-flake set | 0 dev; +30-60s when retry fires | Hides real bugs as retry rate climbs | **Use as fallback only.** |

**Recommended:** ship un-skip + keep current `retry: 1` scope. Re-evaluate in 30 days.

---

## Phase 3 — Speed audit (after Phase 1+2 stable)

**Hard rule: do NOT ship speed-audit changes in the same PR as un-skip changes.** Separate signal.

### 3.1 — Inventory (verified counts)

- **576 `timeout:` invocations** across e2e tests
- **~75 explicit `setTimeout(r, N)` sleeps**
- Top timeout-value breakdown (parallel claude's grep, verified):

| Value | Count | Typical use |
|---|---|---|
| 5_000 | 118 | DOM mount waits |
| 10_000 | 83+23 | hash + popup waits |
| 15_000 | 44+13 | navigation, post-mutation |
| 30_000 | 20+16 | SW round-trips |
| 60_000 | 15+6 | importToken, FPC auto-discovery |
| 90_000 | 18 | passkey-backup |
| 120_000 | 12+3 | transfers, big flows |
| 180_000 | 11+2 | transfer wrappers |
| 300_000 | 3 | fee-juice fixture hooks |
| 360_000 | 2 | tokenReady balance |

### 3.2 — Biggest wins (consolidated from both plans, ranked)

| Rank | Win | Mechanism | Saved | Risk |
|---|---|---|---|---|
| 1 | Drop `retry: 2` smoke-wide → `retry: 1` (vitest.e2e.config.ts:38) | Surfaces real flakes faster; real bugs fail thrice anyway | ~10 min cumulative CI when any flake fires | Low — surfaces real bugs as bugs |
| 2 | `navigateToSettings` 200ms sleep × 11 sites (helpers.ts:110) → `waitForSelector` of landed-page testid | State-driven instead of guess | ~2.2s × tests-with-settings-nav | Low |
| 3 | `refreshBalances` 500ms + 2s padding (helpers.ts:437,445) → `waitForFunction` on a balance-loaded signal | Eliminates 2.5s of guessing per refresh | ~2.5s × ~10 tests | Low |
| 4 | `sendTransfer` 5s post-fee-estimation sleep (helpers.ts:604) → drop, validate against transfer suite | Verifies whether PXE-sync is real or padding | ~25s × 5 transfer tests | Medium — surfaces a real PXE-sync race if one exists |
| 5 | `openPopup` triple-nav (extension.ts:676-679) — investigate eliminating one of the 3 goto calls | The double-`goto(popup) + about:blank` was a SW handshake workaround. If SW first-popup is reliable now, drop one nav. | ~500ms × every test | Medium — needs durability across CI runs |
| 6 | `feeJuiceImportedExtension` 5s polling cadence (extension.ts:553) → match the tightened 1.5s of `tokenReadyExtension` | Symmetry with PR #70's tightening | ~30s in worst case | Low |

**Realistic total saving:**
- Smoke wall-clock: ~30-45s (out of ~5 min) = ~10-15% on smoke.
- Network wall-clock: ~30-60s (out of ~25 min) = ~2-4% on network (most time is real PXE work).
- CI wall-clock: bigger win on smoke retries reduction (when any flake fires).

### 3.3 — Anti-list (not worth touching)

- `protocolTimeout: 300_000` on Puppeteer launch — safety net, not the bottleneck.
- `hookTimeout: 300_000` on network config — fixture-cycle minimum.
- `tokenReadyExtension` 60s balance poll — already tightened in PR #70.
- The `5_000` timeouts on `waitForSelector` — these are upper bounds, not waits.

### 3.4 — Output

`phase3-speed-findings.md` with: inventory matrix, the 6 wins with measured before/after, the side-effects observed.

---

## Phase 4 — Lock-in

1. **Promote `Smoke e2e / Status` to required on `dev`** (currently advisory). Trigger: 10 PRs through the gate after Phase 1 lands. CI.md update.
2. **`tests/e2e/README.md` "Known failures + triage"** — drop entirely (no more known failures). Replace with a one-line pointer to this plan's closure doc.
3. **CLAUDE.md** — no behavior change needed. Spot-check that the test-taxonomy table is still accurate after Phase 1+2.
4. **Codex audit closure file** — `audit-codex.md` at this directory after the audit, mirroring the `network-test-triage` pattern.
5. **Retry-policy contract documented** — max 5% of tests may carry scoped `retry`. Above that, the bug is real.

---

## PR strategy (consolidated)

7 PRs stacked onto `dev`. Each independently reviewable + revertible:

1. **PR-A** — un-skip 18 PR-#77 network tests + 14 of the smoke skips (those Phase 0 marked "defensive"). Single mechanical change. If hosted CI shows ≥97% pass-rate (matches `full-suite-findings.md`), land.
2. **PR-B** — S2 fix (consoleErrors filter helper).
3. **PR-C** — S1 fixes (theme-write wait, security perTest fixture).
4. **PR-D** — S3 fix (stopServiceWorker hardening + isTargetDetachError on openPopup).
5. **PR-E** — S4 decision (profile-then-act OR timeout bump).
6. **PR-F** — Phase 3 speed audit changes (the 6 wins, with measured numbers).
7. **PR-G** — Phase 4 lock-in (smoke required on dev, docs, retry policy).

Plus 2 deferred:
- **PR-H (out of scope, separate)** — F (batch-partial-failure architectural fix).
- **PR-I (out of scope, separate)** — G (connect-locked-queue queued-signal) IF not folded into PR-D.

---

## Open questions for the user (deduped + sharpened)

**Q1 — Phase 0 baseline approach.** Throwaway PR with `e2e:smoke` + `e2e:network` labels for hosted-CI signal? OR local Linux container reruns? My lean: **both**. CI for the substrate truth; local for cheap fast iteration. ~2 hr total.

**Q2 — PR strategy.** 7 stacked PRs (A through G) onto `dev`, or 1-3 grouped fix-everything PRs? My lean: **7 stacked**. Past pattern in this repo (M6, network-triage) shows stacked PRs land cleaner.

**Q3 — Passkey backup (S4) path.** Profile-first (Path A, 4-6 hr) or timeout bump (Path B, 30 min)? My lean: **Path A**. Even if the chain is inherently slow, the profiling artifact is reusable.

**Q4 — SW-resilience tests.** PR #77 said "excellent locally for development." Is "run sw-resilience nightly only" (GitHub Actions scheduled workflow) a valid middle ground if helper hardening doesn't fully eliminate the flake? My lean: **no**. We should be able to make these deterministic; nightly-only is a step backwards.

**Q5 — `retry: 2` smoke-wide.** Drop to `retry: 1` (my preference; surfaces real bugs faster) or keep `retry: 2` (current; conservative)? Want your call before Phase 3.

**Q6 — Smoke required-on-`dev` promotion.** After PR-A lands green, flip the branch protection rule? Or wait for 20+ green runs? My lean: **flip after PR-A green + 10 PRs through the gate**.

**Q7 — `R1 (PXE-guard serialization)` investigation.** Phase 0 of the prior triage showed it's real but NOT the dominant fault. Defer (my lean) OR sink time now? Multi-day rabbit hole in `@nulo/aztec-runtime`.

**Q8 — Test deletion threshold.** Phase 0 may surface a test that's redundant + flaky (e.g., one of the transfer cases if covered by another scenario). Permission to delete with PR-description rationale, or always preserve?

**Q9 — Rotating-flake-under-cumulative-load.** Wait for upstream `@aztec/aztec.js` IndexedDB → KV migration (my lean), or address now via grouped-batches?

---

## What this plan is NOT

- Not a fix-design for clusters at file:line level — Phase 0 may obsolete some predictions.
- Not a `.github/workflows/` redesign — gating + labels may move; structure stays.
- Not a fixture-architecture refactor — fixtures work.
- Not a retry-as-flake-hider — retries stay scoped + justified.

## Divergence log (where the two source plans differed)

| Topic | plan-primary | parallel-claude | Resolution in this plan |
|---|---|---|---|
| Network skip count | 18 | 20 (incl 2 pre-existing) | **20** — verified via grep |
| S1 mechanism | navigateByHash race | SW write race + state contamination | **parallel-claude wins**; sibling-test contradiction is decisive |
| S2 mechanism | waitForToast race | stale comment; brittle consoleErrors | **parallel-claude wins**; helper has no waitForToast |
| S3 redundancy | not redundant | not redundant | agreed |
| S4 fix | runner upgrade ($3/mo) | profile-first | **parallel-claude wins**; profiling has reusable artifact |
| Speed audit emphasis | helper sleeps, openPopup triple-nav | helper sleeps + retry:2 drop | **merged**; retry:2 → 1 is the biggest single CI-wall-clock win |
| Phase 0 tactic | un-skip + 5× local + CI | un-skip + per-test local + throwaway PR CI | **merged** to both |
| Smoke required promotion | yes after PR-A | yes after PR-A + 10 PRs | **after PR-A + 10 PRs** (parallel claude's pacing wins) |
