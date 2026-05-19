# E2E stabilization + speed audit — FINAL (post-codex-audit + local-first revision)

Supersedes `plan-consolidated.md`. Folds in codex audit findings from `audit-codex.md` (session `019e26f8`) and the user's local-first iteration constraint. Net changes from consolidated:

- **Local-first iteration (user's revision).** All stabilization work iterates locally via `bun run e2e:agent` (network) and `bun run --cwd packages/extension test:e2e` (smoke). CI is the FINAL substrate-confirmation step before each PR opens — never the iteration loop. CI runs are slow (smoke ~6-8 min, network ~30-45 min) and expensive; one CI run per phase, not many. Where the substrate matters (macOS vs Linux), prefer a Linux container (Lima/Docker/colima) — codex flagged macOS as wrong substrate for replicating hosted-runner conditions, but a worktree-local macOS run is the right first-pass quick signal.
- **S1 split** — only the `security` test has a credible mechanism (file-fixture password-rotation contamination). `appearance` skip is treated as **defensive until reproven** (no credible race after re-reading `setTheme` + `app.vue:42-54`).
- **S4 runner-upgrade option removed** — GH "larger runners" require Team/Enterprise plan; this repo is user-owned. Profile-first stays. If profiling shows it's inherent CI slowness on a small runner, the fix is timeout-bump or `process.env.CI` gate, not a runner upgrade.
- **Phase 3 number corrections** — `navigateToSettings` is 26 smoke sites (not 11); `refreshBalances` cost is in fixture loops not test calls; `openPopup` is 75 smoke sites; `retry:2→1` is directionally right but `~10 min win` is unevidenced.
- **New speed candidate** — `waitForTxConfirmation()` hard 10s sleep at `helpers.ts:623-624` (larger than several entries on my prior list).
- **Speed-fix risk reclassified** — `navigateToSettings → waitForSelector` is **medium** risk, not low. There's no generic per-route selector contract; adding one is a small refactor.
- **PR-A scope clarified** — "un-skip 18 network + (defensive smoke from Phase 0)" instead of the buggy "14 of the smoke skips" wording.

## TL;DR

- **28 tests quarantined** = 20 network (18 PR-#77 + 2 pre-existing) + 8 smoke (PR-#77). Slow has 1 separately-skipped, valid, out of scope.
- **Most quarantines are defensive**, not real bugs. PR #70's wallet/helper fixes are still present in `src/popup/app.vue:131-160` and `fixtures/helpers.ts:147-263`. Codex confirmed.
- **Real fixes likely needed:** S2 (consoleErrors brittleness), S3 (`stopServiceWorker` returns immediately after `Runtime.terminateExecution`), S4 (chain timing on hosted runner), S1-security (file-fixture contamination).
- **Real wins on speed:** start with `retry: 2 → 1` smoke-wide + the hard `setTimeout` sleeps. `openPopup` triple-nav is bigger than it looks (103 invocations) but risk is unmeasured.

## Verified inventory

**Network (20 skips)**

| File | Tests | Cluster | Origin |
|---|---|---|---|
| transfers.test.ts | 8 | A | PR #77 |
| fee-methods.test.ts | 5 | A+B | PR #77 |
| token-management.test.ts | 1 | A | PR #77 |
| contacts-sender.test.ts | 3 | C/D | PR #77 |
| data-registerSender.test.ts | 1 | E | PR #77 |
| batch-partial-failure.test.ts:29 | 1 | F (architectural — defer) | pre-PR-#77 |
| connect-locked-queue.test.ts:19 | 1 | G (90s drain-timing) | pre-PR-#77 |

**Smoke (8 skips, all PR-#77)**

| File | Test | Cluster |
|---|---|---|
| appearance.test.ts:70 | theme persists across navigation | S1-appearance (defensive until reproven) |
| security.test.ts:79 | auto-lock TTL change persists | S1-security (file-fixture contamination) |
| contacts.test.ts:91 | delete contact | S2 (brittle consoleErrors) |
| sw-resilience.test.ts:52,93,125,186 | 4 SW-respawn tests | S3 (helper timing) |
| passkey-backup.test.ts:167 | full-backup export modal | S4 (chain slowness on hosted runner) |

## Phase 0 — Baseline reality check (local-first)

**Goal:** separate defensive quarantines from real failures locally, before spending a single CI minute. CI confirms only after local iteration is stable.

### 0.1 — Local working branch + un-skip-all commit

1. Branch `e2e/stabilization-baseline` off `dev`.
2. Mechanically convert every `test.skip` in `tests/e2e/` (except `slow/` and the two pre-existing F/G skips) back to `test.skipIf(!hasConfig)` for network or `test(...)` for smoke. **One commit.** No other code changes.

### 0.2 — Local smoke baseline (~30-40 min)

Run smoke 3× back-to-back on a worktree:

```bash
bun run --cwd packages/extension test:e2e
```

Capture per-test outcome (pass / hard-fail / flake) into `phase0-baseline.md`. For tests that fail, also run isolated:

```bash
bun run --cwd packages/extension test:e2e tests/e2e/<file>.test.ts -t "<title>"
```

3× to estimate per-test flake rate.

### 0.3 — Local network baseline (~1-1.5 hr)

Run via the parallel-safe agent (allocates fresh ports per run — cold-start semantics preserved):

```bash
bun run e2e:agent
```

3× total. For failures, isolate per file:

```bash
bun run e2e:agent tests/e2e/network/<file>.test.ts
```

5× per failing file to estimate flake rate. **Optionally** use a second worktree to parallelize while still respecting sandbox isolation (per `packages/extension/tests/e2e/README.md`).

### 0.4 — Substrate sanity check (optional, ~30 min)

If many tests pass locally but we suspect hosted-runner divergence (e.g. `passkey-backup` chain), run the same baseline in a Linux container:

```bash
# Lima example (or colima/Docker equivalent)
limactl shell default bash -lc 'cd ~/code/nulo && bun run --cwd packages/extension test:e2e tests/e2e/passkey-backup.test.ts'
```

This is the ONLY place codex's "macOS is wrong substrate" feedback applies — for the small set of tests we suspect are platform-specific. Don't run the whole suite in a container as the default.

### 0.5 — Output: `phase0-baseline.md`

Matrix structure (local-only; CI runs happen per-PR later):

```
Cluster  Test                              Local 3×          Isolated 5× (if needed)  Verdict
S1-app   appearance: theme persists        3/3 pass          —                        defensive (un-skip)
S1-sec   security: auto-lock TTL           1/3 fail          2/5 pass                 file-fixture contamination
S2       contacts: delete contact          3/3 pass          —                        defensive (un-skip)
S3       sw-resilience (4 tests)           5/12 fail         8/20 pass                helper timing — fix needed
S4       passkey backup                    3/3 pass (~15s)   —                        macOS-fast; CI substrate TBD per-PR
A        transfers (8)                     8/8 × 3           —                        defensive (un-skip)
B        fee-methods (5)                   4/5 × 3 (rotate)  5/5 each iso             defensive + 1 rotating
C        contacts-sender migrate           2/2 × 3           —                        defensive
D        contacts-sender chip              1/1 × 3           —                        defensive
E        data-registerSender               1/1 × 3           —                        defensive
F        batch-partial-failure             —                 —                        architectural — keep skip
G        connect-locked-queue              —                 —                        needs queued signal — keep skip
```

Verdicts:
- **defensive (un-skip)** — restore `test.skipIf(!hasConfig)`/`test(...)`. No fix needed.
- **real flake / contamination / chain** — Phase 1 cluster work.
- **hosted-only** — local passes, CI fails → substrate-specific. Maps to S4-like fixes (timeout, env-gate, profiling).
- **architectural / queued-signal** — defer, separate PR.

**Anti-scope:** no code fixes in Phase 0. Output is the matrix.

**Budget:** ~2-3 hr local. CI runs happen per-PR later, not in Phase 0.

---

## Phase 1 — Smoke stabilization

Order: smallest-risk first; each fix unblocks the next.

### S2 (1 test, ~30 min) — drop brittle consoleErrors assertion

**Surface:** `contacts.test.ts:91-99` final assertions on `consoleErrors`/`pageErrors`.

**Fix:** add `isBenignDisconnectError(msg)` helper to `fixtures/extension.ts` (next to `isTargetDetachError` at lines 847-859). Filter the same patterns from the SW disconnect on popup teardown. Apply across all smoke tests asserting on consoleErrors (~9 tests).

**Validation:** 5× local (worktree + Linux container if substrate-relevant). 1× CI confirmation before PR opens. Pass rate 5/5.

### S1-security (1 test, ~1 hr) — eliminate file-fixture contamination

**Surface:** `security.test.ts:79` uses `registeredExtension` (file-scoped) after a previous test rotated the password + locked the wallet. Codex confirmed via `fixtures/extension.ts:205-224` that this is the only S1 mechanism that holds up.

**Fix:** switch test to `registeredExtensionPerTest` (per-test scope; same registration). Adds ~5s for fresh profile registration. Acceptable.

**Validation:** 5× local (worktree + Linux container if substrate-relevant). 1× CI confirmation before PR opens.

### S1-appearance (0 tests immediately) — defensive, un-skip first

**Surface:** `appearance.test.ts:70`. Codex's read: `setTheme()` returns after `html[theme]` flips; no credible race. Treat as defensive.

**Action:** un-skip in PR-A (Phase 0 mechanical). If it flakes after un-skip, re-investigate in a follow-up PR with actual data.

### S3 (4 tests, ~3-4 hr) — harden SW-respawn helper

**Surface:** `stopServiceWorker` at `sw-resilience.test.ts:7-19` returns immediately after `Runtime.terminateExecution`. The next `openPopup → goto(popupUrl)` races the SW death.

**Fix:**
1. After `Runtime.terminateExecution`, wait until `chrome.storage.session.get("nulo:liveness")` is undefined (proves the session storage was wiped — SW genuinely terminated).
2. Then `browser.waitForTarget(t => t.type() === "service_worker" && t.url().includes(ext.extensionId))` to ensure a fresh SW target exists before the test continues.
3. `openPopup` already does `goto(popup) → about:blank → goto(popup)` triple-nav; extend the `isTargetDetachError` swallow pattern (`extension.ts:847-859`) to the navigation step itself.

**Validation:** 10× local. 1× CI confirmation before PR. 0 flakes tolerated locally; if CI flakes after a clean local 10×, treat as a substrate divergence and instrument before merging.

### S4 (1 test, ~4-6 hr OR ~30 min) — profile first

**Path A (recommended): profile the 11-service backup chain.** Add per-step timing logs around `handleBackup` in `export/full.vue`. Identify the dominant cost:
- Sequential service calls that could parallel
- PBKDF2 re-derivations
- SHA hash on a single big buffer at the end

If chain is inherently slow on the hosted runner (small 2-vCPU), accept and either:
- Bump test timeout to 180s (vitest option) + add diagnostic logs for future regressions, OR
- Gate behind `process.env.CI_FAST !== "true"` and run on a self-hosted larger runner — **only if** the user has access; otherwise see below.

**Path B (fallback): timeout bump.** 30 min. Loses the profiling artifact.

**Note from codex:** GH "larger runners" (`runs-on: ubuntu-latest-large`) require **organization/enterprise** plan. This repo (`alejoamiras/nulo`) is **user-owned** → larger runners not available without plan change.

**Validation:** local profile + iterate; final 1× CI confirms the test passes in <90s (Path A) or <180s (Path B fallback).

---

## Phase 2 — Network stabilization

### 2.1 — Un-skip 18 PR-#77 quarantines (mechanical, single PR)

Restore `test.skipIf(!hasConfig)` for the 18 PR-#77 skips. Remove `// biome-ignore lint/correctness/noUnusedVariables: kept for un-skip` comments. Remove `// SKIP: cluster X` block comments.

**Expected outcome** (codex confirms PR #70 fixes still in place): ~14-18 pass cleanly. Rotating-flake set may need `retry: 1` scope added.

**Validation:** Phase 0's local-first matrix is the green-light gate. Once local 3× is clean per file (with `bun run e2e:agent <file>`), 1× full local network suite confirms cumulative-load behavior, then 1× CI as final substrate check before PR-A opens.

### 2.2 — F (batch-partial-failure) stays skipped

Architectural mismatch (canonical 2D-D3) tracked in test comment. Out of scope. File separate issue.

### 2.3 — G (connect-locked-queue) — separate small PR

Wallet-bridge emits a deterministic "queued" event when discovery is parked behind a lock. Test consumes that. **Could fold into PR-D (S3)** since both touch SW lifecycle, but tractable separately. ~3-4 hr.

### 2.4 — Cumulative-load rotating-flake

`retry: 1` is already scoped on `multi-account-from` + `meta-getChainInfo`. After un-skip if Phase 0 surfaces new rotating victims, expand scope only to those specific tests. **Do not bump global retries.**

Wait for upstream `@aztec/aztec.js` IndexedDB → KV migration to materially reduce surface. Track separately.

---

## Phase 3 — Speed audit (separate PR series, AFTER Phase 1+2)

### 3.1 — Verified counts (codex corrections)

- 576 `timeout:` invocations
- ~75 explicit `setTimeout(r, N)` sleeps
- `openPopup`: **75 smoke / 103 total** invocations
- `navigateToSettings`: **26 smoke / 32 total** call sites

### 3.2 — Wins (ranked, with codex's verification notes)

| Rank | Win | Mechanism | Saved | Risk |
|---|---|---|---|---|
| 1 | `retry: 2 → 1` smoke-wide (`vitest.e2e.config.ts:38`) | Surfaces real flakes; real bugs fail thrice anyway | Cumulative, unevidenced (likely several min on flake-hit runs but no baseline) | Low (real bugs still surface) |
| 2 | `waitForTxConfirmation` hard 10s sleep (`helpers.ts:623-624`) | Replace with state-driven wait on tx-confirmed event/state | ~10s × tx-using tests | Medium — surfaces real proveTx timing if any |
| 3 | `sendTransfer` 5s post-fee-estimation sleep (`helpers.ts:602-604`) | Drop; validate against transfer suite | ~25s × 5 call sites | Medium — surfaces PXE sync race if any |
| 4 | `refreshBalances` 500ms + 2s padding in **fixture loops** (`fixtures/helpers.ts:391-400`, `432-445`; loops at `extension.ts:323-344,407-420,541-550`) | Wait on balance-loaded signal | ~2.5s × every fixture refresh cycle | Low-Medium |
| 5 | `navigateToSettings` 200ms × 26 smoke sites (`helpers.ts:108-110`) | Replace with `waitForSelector` of landed-page testid | ~5.2s smoke, ~6.4s total | **Medium** — no generic per-route selector contract; needs small refactor + per-page testid additions |
| 6 | `openPopup` triple-nav (`fixtures/extension.ts:676-684`) — 75 smoke / 103 total invocations | Investigate dropping one of the 3 navs (SW handshake may be reliable now) | ~500ms × 75 ≈ 37s smoke if it works | **Medium-High** — was added to fix a real SW handshake issue; needs measurement |
| 7 | `feeJuiceImportedExtension` 5s polling cadence (`extension.ts:553`) → tighten to 1.5s like `tokenReadyExtension` | Symmetry with PR #70's tightening | ~30s worst case | Low |

### 3.3 — Anti-list (do NOT touch)

- `protocolTimeout: 300_000` on Puppeteer launch — safety net.
- `hookTimeout: 300_000` on network config — fixture-cycle floor.
- `tokenReadyExtension` 60s balance poll — already tightened in PR #70.
- 5s `waitForSelector` timeouts — upper bounds, not waits.

### 3.4 — Speed audit deliverable

`phase3-speed-findings.md` with: inventory matrix (verified counts), the 7 wins with measured before/after on a single LOCAL smoke run, observed side effects (real bugs surfaced).

**Validation cadence:** every speed change measured locally first (3× before, 3× after, capture wall-time delta). CI is the final confirmation per PR — not for iteration. If CI delta diverges from local, that's a signal of substrate-dependent behavior and we hold the PR.

---

## Phase 4 — Lock-in

1. **Promote `Smoke e2e / Status` to required on `dev`.** Trigger: Phase 1 lands + the next 10 normal-traffic PRs on `dev` keep the gate green (observation, not synthetic re-runs). CI.md update.
2. **`tests/e2e/README.md` "Known failures + triage"** — drop section. One-line pointer to closure doc.
3. **Retry-policy contract documented:** max 5% of tests may carry scoped `retry`. Above that is a real bug to fix.
4. **CLAUDE.md** — verify the test-taxonomy table remains accurate after Phases 1+2.

---

## PR strategy (revised)

7 stacked PRs onto `dev`, each independently reviewable + revertible:

1. **PR-A** — un-skip the 18 PR-#77 network tests + the smoke skips Phase 0 marks "defensive" (`appearance`, possibly others). Mechanical. Land if CI shows ≥97% pass-rate.
2. **PR-B** — S2 fix: `isBenignDisconnectError` filter helper.
3. **PR-C** — S1-security fix: switch to `registeredExtensionPerTest`.
4. **PR-D** — S3 fix: `stopServiceWorker` hardening + `isTargetDetachError` extension.
5. **PR-E** — S4 decision: profile + chain optimization OR timeout-bump.
6. **PR-F** — Phase 3 speed audit (the 7 wins with measured numbers). Could split if any win is risky.
7. **PR-G** — Phase 4 lock-in: smoke required on dev, docs, retry policy.

Plus 2 deferred:
- **PR-H** — F (batch-partial-failure architectural fix) in wallet-bridge.
- **PR-I** — G (connect-locked-queue queued-signal) IF not folded into PR-D.

---

## Open questions for the user (final, per codex audit)

**Q1 — Phase 0 baseline approach.** Local-only: 3× full smoke + 3× full network locally via `bun run e2e:agent`, isolated 5× reruns for failures, Linux container only where substrate-specific (passkey-backup). **No Phase-0 CI run** — CI is exercised per PR, not in baseline. **Approved.**

**Q2 — PR strategy.** 7 stacked PRs (A-G) onto `dev`. My lean: **stacked**. **OK?**

**Q3 — Passkey backup (S4) path.** Profile-first (Path A, 4-6 hr) — even if chain ends up inherently slow, profiling artifact is reusable. **Approve?**

**Q4 — SW-resilience tests** stay first-class (codex confirmed not redundant). **Approve helper hardening over nightly-only or delete?**

**Q5 — `retry: 2 → 1` smoke-wide.** Drop in PR-F. My lean: drop. Codex says directionally right but the `~10 min` win claim was unevidenced — I'll measure as part of PR-F. **OK to drop in PR-F?**

**Q6 — Smoke required-on-`dev`.** After PR-A green + the next 10 normal-traffic PRs keep the gate green (observation, no synthetic CI runs). **OK?**

**Q7 — R1 (PXE-guard serialization) investigation.** Codex says current setup is fine; PR #70 surface is intact. **Defer (my lean) or sink time?**

**Q8 — Test deletion threshold.** If Phase 0 surfaces a redundant + flaky test, may I delete with PR-description rationale? **Yes/no?**

**Q9 — Rotating-flake.** Wait for upstream `@aztec/aztec.js` IndexedDB → KV migration. **OK?**

---

## Anti-scope (what this plan does NOT do)

- No CI workflow redesign (gating + labels stay).
- No fixture architecture refactor.
- No retry-as-flake-hider.
- No new wallet runtime changes outside what S2/S3/S4/G demand.
- Speed-audit changes NEVER ship with stabilization changes (separate signal).

## Audit lineage

- `plan-primary.md` — my v0 draft.
- `parallel-claude-plan.md` — independent claude draft.
- `plan-consolidated.md` — first merge.
- `audit-codex.md` — codex critical review (session `019e26f8`).
- `plan-final.md` (this file) — post-audit revision.
