# deflake-round-3 — codebase recon

Three parallel read-only explorers over the arc's terrain (2026-08-13, base = dev @ #365).
Structured per the blueprint recon contract: what exists, reuse/adapt, conventions, collisions.

## 1. CI aggregator / duplicate-run trap

**Mechanism (fully root-caused).** The three aggregator jobs — `pr-quick.yml:271-295`
(`quality-status`), `pr-smoke-e2e.yml:122-141` (`smoke-e2e-status`),
`pr-network-e2e.yml:235-257` (`network-e2e-status`) — share one copy-pasted inline shell
loop under `if: always()` that `exit 1`s when any `needs.*.result` is `"failure"` **or**
`"cancelled"`. `always()` is load-bearing (without it, paths-filter-skipped deps would leave
the required check hanging "Expected" forever — the pre-2026-06-24 bug). But it also means a
concurrency-cancelled run's status job still executes, and a plain `run:` step can conclude
only success/failure — so the duplicate concludes FAILURE on the same head SHA and can win
required-check resolution (the trap ledgered in
`implementations-plan/deflake-round-2/lessons/phase-1-observability.md:25-35` and
`certification.md:29-35` — five run sets observed at labeled-PR open).

**Event fan-out source.** All three PR workflows subscribe
`types: [opened, reopened, synchronize, labeled, unlabeled, ready_for_review]` with
per-workflow concurrency groups keyed on `head_ref`, `cancel-in-progress: true`. A
`gh pr create --label a --label b` fires `opened` + one `labeled` per label; each delivery
cancels the prior in-flight run; the LAST event's run survives and is the genuine gate.

**Same pattern elsewhere (drift risk).** The identical loop exists 5×: the three above,
`actionlint.yml:82-101` (`Status`, NOT required, not subscribed to `labeled` → not exposed
to the open-burst), `release.yml:534-580` (not PR-triggered, `cancel-in-progress: false` →
not exposed).

**Reuse candidates.**
- `release.yml:258-263` idiom: `!contains(needs.*.result, 'cancelled')` as a first-class
  expression building block.
- The unit-tested CI-logic convention: pure decision fn + colocated bun test + thin
  injectable-IO runner + `import.meta.main` CLI guard
  (`scripts/release/auto-unstick.ts`/`auto-unstick-run.ts`/`*.test.ts`;
  `scripts/ci-cd/behavior-gating.test.ts`). Root `package.json` wires `test:release` /
  `test:ci-gating`; `_unit-tests.yml:27-48` runs them dir-guarded.
- actionlint CI covers `.github/workflows/**` changes (reviewdog, fail_on_error); shellcheck
  job globs `.githooks apps/extension/scripts scripts` — any new script is auto-covered.
  Local: `bun run lint:actions`.

**The design fork (for the plan + audits).** A cancelled aggregator cannot simply pass:
if the ONLY run is cancelled (human abort), a skipped/success conclusion would satisfy the
required check and let an untested head merge — gate weakening. Candidates:
- **(F1) supersession probe**: on cancelled deps, query the runs API for a strictly newer
  run of the same workflow + head branch; if one exists, that run owns the gate → conclude
  non-failure ("superseded by run N"); if none → `exit 1` (genuine lone cancellation stays
  red).
- **(F2) `if: !cancelled()`** on the status job: duplicates conclude skipped — but a lone
  human-cancelled run ALSO concludes skipped, and skipped satisfies required checks →
  rejected as gate-weakening unless combined with F1's probe (which an `if:` expression
  cannot do).
- **(F3) event-side dedup**: suppress the `labeled`-at-open burst (e.g. `decide` no-ops
  `labeled` events whose PR `created_at` is within seconds of the event) — reduces run
  churn but leaves the aggregator defect in place for every other cancellation path;
  cosmetic, not causal.

## 2. Fixed-wait inventory (apps/extension/tests/e2e)

`page.waitForTimeout` count: **zero** — that antipattern class is already gone. The tree's
overwhelming majority is Class B (bounded waits on causal predicates, house style).

**Class A — bare clocks:**

| Site | Duration | Hoping for |
|---|---|---|
| `fixtures/helpers.ts:734` (`sendTransfer`, `PXE_ANCHOR_SYNC_WORKAROUND_MS`) | 5s | PXE anchor catch-up before proveTx — documented pinned workaround for a real wallet bug; NO product signal exists. Stays, as the documented exception. |
| `fiat-display.test.ts:45` | 150ms | toggle re-render; the tree's own `togglePrivacySetting` (`helpers.ts:969-988`) already does this causally via `data-toggle-active`. |
| `network/incoming-transfers.test.ts:60` | 3s | page mount + IncomingTransferServiceClient connect + first fetch. |
| `network/connect-locked-queue.test.ts:32` | 1.5s | SW enqueue (absence assert — popup must NOT open). |
| `network/in-flight-send-guard.test.ts:68` | 1s | switch refusal (absence assert; false-PASS risk if guard takes >1s). |
| `network/account-switch-isolation.test.ts:456` | 3s | late-broadcast settle (observer armed pre-switch; sleep = observation window). |

**Class C — weak predicates:**
- **`ensureUnlocked` (`helpers.ts:82-85`) — the named instance, mechanism found.**
  `auth-password-input` renders unconditionally at mount; profile hydration
  (`getLastActiveProfileId` + `getProfiles`, `auth.vue:126-136`) is async. Submit before
  `appStore.profile.id` lands → `unlockProfile(undefined, password)` → swallowed catch →
  route never leaves `/popup/auth` → the post-condition wait (line 91, 10s) times out.
  Likely THE CI-load flake mechanism (run 31730802901), not a tight budget. Ready signal:
  profile-hydration completion — `AuthProfilePill` (`data-testid="auth-profile"`) name is
  empty until hydration; a dedicated readiness data-attribute on auth.vue is the
  testid-rule-clean signal (precedent: `data-dropdown-open`, round 2).
- `import-paths.test.ts:194-216`: bespoke in-page poll duplicating `revealSecretKey`'s
  `waitForFunction` pattern — dedupe.
- `onboarding-tab.test.ts:56-63`: real predicate, but an unbounded `while(true)` poll with
  no own deadline/failure message — add a bounded budget.

**`importFullBackup` (`helpers/import-drivers.ts:142-184`) — the named 300s instance.**
One `waitForHash(successHash, 300_000)` spans two legs the app distinguishes internally,
and a sibling driver ALREADY splits them: `import-dead-rpc.test.ts:201-209`
(`continueThroughErrorsScreen`) waits restore-leg-done (DOM) then routing with its own
budget. Signals per leg:
- Restore leg: submit button (`shell.submitTestId("full-backup")`) is
  `v-if="restoreStatus !== 'finished'"` (`import.vue:287`) — disappearance = restore done
  (errors path: `import-full-backup-continue-btn` appears instead);
  `chrome.storage.session["nulo:core:session"]` is populated by `finalizeRestore` before
  `restoreStatus` flips (same key `lockWallet` already polls — in-convention);
  `nulo:core:restore-pending@<id>` presence→absence brackets the leg (needs id plumbing).
- Routing leg: `completeImportWithRecovery` (`waitForProfileActive` 30s at `import.vue:80`;
  recovery re-hydrate) → land on `successHash` or `/popup/auth`. `waitForHash` remains the
  terminal check, scoped to ~30-40s, failing with a NAMED stage.

**Collision/blast radius.** `ensureUnlocked`: 7 test files across BOTH suite configs
(direct + via `reopenAndRecoverAfterImport`). `importFullBackup`: 5 files across both
suites (smoke's `backup-migration.test.ts` runs no live network — fast restore leg, same
split inherited). `lockWallet` upstream: 8 files. Any helper change must validate both
smoke and network suites.

**Deferred-polish surfaces (fold where touched).**
- `waitForFreshBalanceRow` + `captureBalanceBaseline`: 9 call sites, all the identical
  baseline→action→wait sandwich; folding means the helper owns an action closure
  (`withFreshBalanceRow(page, opts, action)`) — mechanical, touches
  `fixtures/extension.ts` fixtures too.
- `MINT_AMOUNT = 1000n * 10n ** 18n`: 15+ raw literals (fixtures + expected-raw math);
  companion display const `"1,000"`.
- `assertPgError` mirror: ~11 manual `status === "error"` + hand-dug `errorJson` sites;
  additive export next to `assertPgOk` (`fixtures/playground.ts:138-148`), zero collision.

**Conventions to hold:** data-attribute waits (not class/text scraping); strictly-newer /
presence-TRANSITION signals (never bare truthy — round 2's law); the blessed-helper rule
(`tests/e2e/README.md:139-158` — no raw `page.click`/`waitForFunction` outside helpers);
testid-only selectors; the repo's existing practice of DELETING Class-A sleeps once a
caller-side causal wait is proven (navigateToSettings/navigateByHash precedent).

## 3. sw-resilience un-skip + scripts promotion

**The four skipped tests** (`sw-resilience.test.ts`, all under the file-scoped
`registeredExtension` fixture; file already matches the smoke include glob
`vitest.e2e.config.ts:11-12` — un-skip needs no config change):

| # | Line | Un-skip condition stated | Status |
|---|---|---|---|
| 1-3 | :66/:108/:141 | "helper waits on something deterministic" | **Met** — round 2's strictly-newer `waitForLiveness` (:21-50). |
| 4 | :203 | "navigation-after-respawn helper waits on a stable signal" | **NOT met** — `stopServiceWorker` (:9-19) returns right after `Runtime.terminateExecution` without confirming death; next `openPopup → goto` races the boundary ("Navigating frame was detached"). `openPopup` has a bounded frame-detach retry (`extension.ts:1004-1019`), but the floated hardening (`browser.waitForTarget` for SW-target-gone, `e2e-stabilization/plan-primary.md:170`) was never done. |

Heartbeat mechanics: `nulo:liveness` written immediately on boot (`runtime.ts:308`, the
c67e4f0 regression fix) then every 10s (`:315`, `HEARTBEAT_INTERVAL_MS=10_000` `:84`) —
post-respawn liveness resolves well under 10s, so test 4's 10s bound tests real behavior
but has zero CI slack; test 4 also re-implements the liveness poll inline (:225-237)
instead of using the file's helper, and under smoke `retry: 2` its timing-strict assert
could pass-on-retry (masking). Baselines: previously reliably green in isolated runs
(6.4/1.8/1.6/3.6s — `e2e-stabilization/phase0-baseline.md:32-35`); the flake was
hosted-CI/full-suite-load.

Ledger has NO live entry for this file (skipped through the whole mining window) —
un-skipping is a fresh data point, not a re-opened flake. Older e2e-stabilization docs
recommend fix-don't-delete; nothing pins the skip.

**Scripts promotion.** Home: `apps/extension/scripts/e2e/` (populated: `agent.sh`,
`docker-ci-like.sh`, `resolve-ports.ts` + test, `classify-exit.ts` + test).
Conventions: `#!/usr/bin/env bash` + `set -euo pipefail` + heavy header comments; agent.sh
self-locates repo root via `cd "$(dirname "$0")/../.."`; TS scripts use `#!/usr/bin/env bun`
+ pure-logic/thin-CLI split + colocated bun tests. Shellcheck CI auto-covers any new
`.sh` under `apps/extension/scripts/**` or `scripts/**`. NOTE: a repo-root `scripts/e2e/`
would NOT trip the smoke-surface paths filter (`apps/extension/**` does) — extension-local
home keeps CI semantics simplest. Session scripts to promote exist only in the session
scratchpad (verify-cert-run, watch-pr, canary-rerun/watch shapes) — they get rewritten
parameterized, not copied.

**Smoke CI context.** `_smoke-e2e.yml` `smoke` job: ubuntu-latest, `timeout-minutes: 20`,
`bun run --cwd apps/extension test:e2e`, `pool: "forks"`, `retry: 2`. Un-skipped tests run
unconditionally whenever smoke runs; a tests/e2e-only change DOES trip the smoke-surface
filter (whole-package `apps/extension/**` glob).
