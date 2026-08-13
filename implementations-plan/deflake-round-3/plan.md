# deflake-round-3 — plan (v4, post dual-audit + 3 codex final-pass iterations)

**Tier**: `/blueprint mid`. Dual audit: codex REJECT (F1 unsafe, root-cause claims
under-evidenced, import split unmeasured) + fable CONDITIONAL APPROVE (same core findings
independently); then a fresh-context codex final pass that rejected three more times
(non-discriminating experiment → mirror finality → boundary-only stall signal) before
conditional-approving v4. See `audit-codex.md` / `audit-fable.md` / `audit-codex-final.md`
and the Decision ledger. **Worktree**: `deflake-round-3`; PR branches `deflake-r3/<slug>`.

**Goal (owner-set)**: close the tight-fixed-wait flake class, fix the duplicate-aggregator
CI trap, restore SW-lifecycle e2e coverage; stacked PRs into dev through NORMAL gates;
Phase-6 certification on the final PR. Hard rules: timeout/bound raises banned as flake
fixes; causal signals only; gates never weakened (a red suite must never become
mergeable); network e2e solo `NULO_E2E_RETRY=0` (+`NULO_E2E_PROVERLESS=1` full local
sweeps); armed-build discipline; ledger discipline; no silent scope growth.

**Scope refinements surfaced to owner** (audit-driven, in-spirit of the goal):
1. `auth.vue` gains a small PRODUCT behavior fix, not just observability: the password
   submit is enabled today on password content alone, before async profile hydration — an
   early submit calls `unlockProfile(undefined, …)` and fails silently for real users too.
   Fix = disable submit until the hydration attempt completes; that disabled→enabled
   transition IS the causal e2e signal. (Codex High; the pure data-attribute variant would
   leave a live user-facing bug in place.)
2. `useFullBackupImport` + `import.vue` gain observability-only additions (a
   `restoreStage` ref advancing at real stage boundaries, exposed as `data-restore-stage`,
   plus a testid on the happy-path "Finishing import…" button) — no staged signal exists
   in the DOM today, and `restoreStatus` is flat `"progress"` across the whole leg.
3. Item 1's LITERAL success criterion ("aggregators conclude neutral/cancelled when
   concurrency-cancelled") is subordinated to its intent: labeled-PR opens must stop
   leaving losing FAILURE check-runs, WITHOUT any wrong-ALLOW path. If measurement (below)
   shows the safe fix is eliminating the duplicate runs rather than changing what a
   cancelled run concludes, that is what ships, and the deviation is reported.
4. `withFreshBalanceRow` polish is deferred OUT of the arc (both audits: 22 refs across 7
   network files + fixtures behind a 25-45 min gate = bisection-killing churn in a
   flake-reduction arc). `MINT_AMOUNT` + `assertPgError` stay (additive).

## Success criteria (v2)

1. MEASURED, then disposed: the duplicate FAILURE check-run does not by itself block a
   merge (P1, PR #367), so no gate-semantics change ships. What ships is the removal of
   duplicate quality runs that never had work to do — verified live on #367
   (`quality-status`: one check-run; smoke/network: the usual duplicate pair) — plus a
   written correction of the round-2 mechanism and the still-unexplained residue. P2 is
   moot; P3 is confirmed from #360's history. Smoke and network keep their duplicates,
   which the measurement shows to be noisy rather than blocking. actionlint green.
2. Fixed-wait inventory classified + ledgered (incl. Class-B poll intervals enumerated and
   excluded); `ensureUnlocked` causal via the auth submit-gating fix; `importFullBackup`
   instrumented with real stage transitions, per-stage envelopes measured in both modes,
   named-stage diagnostics on failure, early-fail ONLY where the product owns a deadline
   (300s outer backstop unchanged — no bound raised, no blind split, no inactivity window
   masquerading as a signal); same-class finds fixed per the table.
3. sw-resilience: a death/respawn primitive proven empirically FIRST (the repo documents
   `Runtime.terminateExecution` leaving a zombie target — `migration.test.ts:28`), then
   un-skip all four with local solo retry=0 proof ×2; CI reds get evidence-driven triage;
   re-skip only with a ledgered mechanism.
4. `verify-cert-run.sh` + `watch-pr-checks.sh` in `apps/extension/scripts/e2e/`,
   parameterized, shellcheck-clean.
5. Ledger/skills/index updated (A4 driver → deferred-by-owner) + final owner report.

## Architecture & Implementation

### Item 1 — duplicate-aggregator trap (PR-1, `deflake-r3/ci-aggregator`)

**Phase 1a — no-regret source elimination (ships regardless of measurement):**
- Drop `labeled` + `unlabeled` from `pr-quick.yml` `types:` — quality is not label-gated
  (its `decide`/filters never read labels), so its label-burst runs are pure waste. Smoke
  + network KEEP both types (their gates are label-driven).
- Arc/tooling convention (docs + this arc's own practice): open PRs UNLABELED, then one
  `gh pr edit --add-label a,b` — collapses the open-burst for the label-gated workflows to
  the label-edit deliveries only.

**Phase 1b — measurement (blocking gate for 1c).** Three probes on a throwaway PR + a
scratch branch (a probe PR's own branch carries its workflow definitions, so variants can
be exercised without touching dev):
- **P1 — durability**: labeled open-burst on current YAML → poll
  `/commits/<sha>/check-runs` + `gh pr view --json mergeStateStatus` continuously from
  open through survivor completion. Does the duplicate FAILURE block only until the
  survivor lands (transient), or in steady state? Selects the 1c row.
- **P2 — queue-replacement property**: with the `cancel-in-progress` expression variant on
  the probe branch, fire a label burst fast enough to replace a still-QUEUED run → assert
  the replaced run produced NO job-level check-runs at all (the property source
  elimination v2 rests on).
- **P3 — per-SHA association property**: push SHA-A, then SHA-B before A's run finishes →
  A's run is push-cancelled and its aggregator concludes FAILURE against SHA-A; assert
  SHA-B's mergeability is unaffected (checks associate per-SHA).
Raw timelines + verdicts → `lessons/phase-1.md` + ledger. P2/P3 refuted → the STOP row.

**Phase 1c — OUTCOME (measured 2026-08-13, PR #367): the "transient" row.** The duplicate
FAILURE check-run does NOT durably block — `mergeStateStatus` went BLOCKED → CLEAN the
moment the survivor's SUCCESS landed, with the duplicate's FAILURE still present on the
SHA. Round-2's `completed_at` data shows why the premise was wrong in the first place: a
cancelled run's aggregator finishes in ~3-5s while the run it duplicates is still
executing, so the FAILURE is ALWAYS the earlier check-run and can never win
latest-per-name. Full evidence + the ordering table: `lessons/phase-1.md`.

**Therefore: 1a ships, and nothing else.** No `cancel-in-progress` expression, no
aggregate-status script, no `actions: read`, no change to how any gate concludes. P2
(queue-replacement) and P3 (per-SHA association) existed only to de-risk the
`cancel-in-progress` variant; P2 is moot and P3 is answered by #360's history (its
push-cancelled head `6ffa7b306f` carried three FAILURE aggregators and the PR merged
anyway on a later head). The pre-committed table is honoured exactly: measurement selected
the row that ships the least.

**Deviation from the goal's literal criterion (surfaced, not silent):** success criterion
(1) asked for aggregators to conclude neutral/cancelled "so a labeled-PR open can no
longer leave a losing FAILURE check-run". The measurement falsifies the premise — such a
check-run loses nothing, because it never wins resolution. The intent (labeled-PR opens
must not block merges) holds today without any gate-semantics change. What the duplicates
DO cost is runner minutes and a confusing transient red, which is what 1a removes for the
one workflow that never needed label triggers at all.

### Item 2 — fixed-wait class (PR-2 smoke-surface, PR-3 network-surface)

**PR-2 (`deflake-r3/auth-ready-waits`, label e2e:smoke):**
- **auth.vue product fix** (scope refinement 1): `hydrationSettled` ref set in a `finally`
  around the whole onMounted hydration ("attempt completed" — fable HIGH-4), AND the
  submit/continuation gate requires `hydrationSettled && profile?.id` (final pass High:
  settled-alone still lets the missing/stale-profile branches submit into the swallowed
  TypeError — the gate must make that path UNREACHABLE, not preserved). Root carries
  `data-auth-ready` reflecting `hydrationSettled` (e2e readiness); the ENABLED submit
  additionally implies a valid profile. First-run-no-profile is not orphaned by the gate:
  that path redirects to registration before auth renders (`popup/index.ts:83`).
  Component pins across all four branches: password profile (enabled after settle),
  passkey profile (correct form only after settle), stale/not-found id (submit stays
  disabled; no TypeError reachable), hydration rejection (settled flips, submit disabled).
  e2e: `ensureUnlocked` waits `[data-auth-ready="true"]` then the ENABLED submit;
  stage-named failures.
- **Ledger correction (codex High):** the recorded 5s-selector red (run 31730802901)
  happened BEFORE any fill/submit — hydration cannot explain that incident; its causal
  chain (truthy post-restart liveness gate → wait started against a dead worker) was
  fixed by round 2. The ledger entry gets re-attributed; the hydration race is a SEPARATE
  live defect this PR fixes at product root.
- `fiat-display.test.ts:45` → `data-toggle-active` pattern; `import-paths.test.ts:194-216`
  → blessed bounded waitForFunction (dedupe with revealSecretKey's); `onboarding-tab.test.ts:56-63`
  → own deadline + named failure.

**PR-3 (`deflake-r3/import-staged-waits`, labels e2e:smoke+e2e:network):**
- **Sub-phase 3a — observability BEFORE measurement** (final pass High: restoreStatus is
  flat "progress", so nothing measurable exists until the stage signal lands): add the
  `restoreStage` ref + `data-restore-stage` binding + stage-timestamped console logs
  FIRST; then run the two heavy import tests solo in BOTH modes (proverless + default,
  named files) to get per-stage envelopes on this hardware; record in lessons. No
  behavior selection before this data exists.
- **Stall detector on GRANULAR stages, not on restoreStatus** (fable HIGH-5 + final pass
  High: `restoreStatus` sits at `"progress"` for the entire restore, so status-transition
  stall = a disguised shorter timeout). The restore leg has real sequential stages
  (`useFullBackupImport.ts` restoreBackup: profile restore → token restore → per-service
  restore loop → finalizeRestore → account-state restore → bounded chain-sync tail) —
  a new `restoreStage` ref advances at each boundary (observability-only) and import.vue
  binds it as `data-restore-stage` on the root; plus the finishing-button testid
  (`import-full-backup-finishing`, new). **Sub-phase 3b — behavior selection, stage-by-stage** (final pass rounds 2-3 High: a
  boundary-only stage signal cannot justify an inactivity window — internal progress
  helps only if it is EXPOSED and CONSUMED): early failure is restricted to stages with a
  PRODUCT-OWNED deadline (the chain-sync tail's bounded 45s budget is the one known
  instance — the test may fail that stage when the product's own deadline + margin
  lapses); every other stage is DIAGNOSTICS-ONLY — the stage attribute names where the
  run died, and the unchanged 300s outer wait remains the sole failure criterion there.
  (Exposing per-slice progress counters to earn more early-fail stages is ledgered as an
  optional follow-up, not this arc.) Positive
  signals only (the submit button's absence is satisfiable by the pre-pick state — banned
  class). Failures name the stalled stage + dump hash/stage. **Precommitted**: a single
  legitimate stage near/over the cap is a product/resource diagnosis (surfaced to owner),
  NOT a stall-window choice.
- Class-A network sites per recon: `incoming-transfers.test.ts:60` → causal ready signal
  (investigate existing loading/ready state first; a data attribute only if nothing
  exists); absence-window sleeps (`connect-locked-queue`, `in-flight-send-guard`,
  `account-switch-isolation`) keep their windows + gain rationale pins and, where
  available, a positive anchor first. `sendTransfer`'s PXE_ANCHOR_SYNC_WORKAROUND_MS
  stays (documented product-bug pin) — ledger exception row.
- Polish folded here: `MINT_AMOUNT` (+ `"1,000"` display companion) in
  `fixtures/constants.ts`; `assertPgError` mirror in `fixtures/playground.ts` collapsing
  the ~11 manual error-side sites. (`withFreshBalanceRow`: deferred OUT — ledger.)
- Full classification table → ledger (A/C dispositions + B-interval enumeration note).

### Item 3 — sw-resilience (PR-4, `deflake-r3/sw-resilience-unskip`, label e2e:smoke)

- **Prototype the death primitive FIRST** (codex High: `migration.test.ts:28` documents a
  zombie target after `Runtime.terminateExecution`; puppeteer's `waitForTarget` waits for
  appearance — a naive "target gone" wait may hang): empirically test, in a scratch run,
  which of {poll `browser.targets()` for SW-target absence, `Target.closeTarget`, CDP
  `ServiceWorker.stopWorker`} actually yields a confirmable death + clean respawn. The
  proven primitive goes into the file's `stopServiceWorker` (+ the identical helpers in
  `sw-restart-network.test.ts`/canary IF identical — sweep, don't fork). Respawn side:
  `openPopup`'s bounded frame-detach retry (extension.ts:1003-1024) is the existing
  mitigation — cited, not reinvented.
- Test 4 hygiene: use the file's `waitForLiveness`/`readLiveness` (not its inline copy);
  per-test `retry: 0` (a retry-pass would mask the exact timing regression it pins —
  strictly gate-tightening).
- Un-skip all four; local proof: full armed smoke solo `--retry=0` ×2 green + the file
  alone ×3 before the PR opens.

### Item 4 + close-out (PR-5, `deflake-r3/close-out`, labels both)

- `apps/extension/scripts/e2e/verify-cert-run.sh` (parameterized Phase-6 qualifying
  checker: runs API, per-job log greps for retry markers/exit-86, agent count) +
  `watch-pr-checks.sh` (terminal-state watcher). Conventions: `#!/usr/bin/env bash`,
  `set -euo pipefail`, header docs, self-locating root; shellcheck auto-covers.
- Close-out docs: ledger flips + classification table + A4-driver → deferred-by-owner;
  e2e-testing skill lessons; index.md; final lessons + owner report.

### File-level change map (v2 delta vs v1: auth submit gating, import testids/attr, no
withFreshBalanceRow, trigger-only CI edits)

| File | Change |
|---|---|
| `.github/workflows/pr-quick.yml` | drop `labeled`/`unlabeled` from `types:` (1a) |
| `.github/workflows/pr-smoke-e2e.yml`, `pr-network-e2e.yml` | `cancel-in-progress` expression (1c durable-block row only); aggregator jobs, names, permissions UNTOUCHED |
| `apps/extension/src/popup/pages/auth.vue` + component test | hydrationSettled + submit gating (settled && profile?.id) + data-auth-ready + 4 branch pins |
| `apps/extension/src/composables/useFullBackupImport.ts` | restoreStage ref (observability) |
| `apps/extension/src/popup/pages/import.vue` | finishing-button testid + data-restore-stage binding |
| `apps/extension/tests/e2e/fixtures/helpers.ts` | ensureUnlocked staged causal waits |
| `apps/extension/tests/e2e/helpers/import-drivers.ts` | stall-detector importFullBackup |
| `apps/extension/tests/e2e/fixtures/{playground,constants}.ts` | assertPgError; MINT_AMOUNT |
| per-site test files (fiat-display, import-paths, onboarding-tab, incoming-transfers, connect-locked-queue, in-flight-send-guard, account-switch-isolation) | class fixes / rationale pins |
| `apps/extension/tests/e2e/sw-resilience.test.ts` (+restart/canary sweep) | proven death primitive; test-4 hygiene; un-skip ×4 |
| `apps/extension/scripts/e2e/*.sh` | NEW ×2 |
| ledger / skill / index / lessons | close-out |

## Decision ledger (v2)

| Decision | Choice | Rejected | Why |
|---|---|---|---|
| Duplicate-aggregator trap | measurement-first: 1a trigger trim always; then 1c = nothing (transient) / source elimination v2 — event-conditional `cancel-in-progress` (durable) / stop+replan (inconclusive or property refuted) | F1 duplicate-success (wrong-ALLOW under undocumented resolution); F2 bare `!cancelled()`; survivor-mirror incl. recursive chasing (no re-list achieves future-event finality — a later delivery can always create a run the mirror already answered for) | the only gate-safe move is preventing duplicate FAILURE check-runs from EXISTING; nothing may depend on which same-name check "wins" |
| pr-quick label types | drop labeled/unlabeled | keep for symmetry | quality never reads labels; its burst is pure waste (fable HIGH-3.1) |
| auth readiness | product fix: submit gated on finally-set hydrationSettled + data-auth-ready | data-attribute only (leaves live user bug — codex); profile-present ready (never flips on empty branches — fable HIGH-4) | causal signal = the fixed behavior itself |
| ensureUnlocked ledger red | re-attribute to the round-2 liveness fix's causal chain | keep hydration attribution | the red was the pre-fill selector wait; hydration can't explain it (codex High) |
| importFullBackup | measure restore leg → GRANULAR restoreStage transitions + stage-stall detector + 300s outer backstop | blind 240/60 split (fable HIGH-5); restoreStatus-based stall (final pass High: status is flat "progress" — a disguised shorter timeout); bound raise (banned) | stall-between-real-stages is the causal criterion; near-cap legit stage = product diagnosis, precommitted |
| withFreshBalanceRow | defer OUT of arc (ledger note) | fold in PR-3 | 22 refs/7 files + fixtures behind long gates = bisection killer (both audits) |
| sw death-confirm | empirical primitive prototype first | assume waitForTarget-gone | zombie-target evidence in-repo; waitForTarget waits for appearance (codex High, fable MEDIUM-6) |
| test-4 retry | per-test retry:0 | suite retry | both audits: sound |
| Scripts home | `apps/extension/scripts/e2e/` | repo-root | smoke-surface filter + existing conventions |
| actionlint/release aggregators | untouched, ledgered follow-up | migrate now | unexposed (both audits agree) |

## Phases & gates

| Phase | Content | Gate |
|---|---|---|
| 1 (PR-1) | 1a + 1b measurement + 1c variant | `bun test scripts/ci-cd/` (if scripted) + `bun run lint:actions` + scratch-branch probes: open-burst observation AND deliberately-red-survivor steady-state check (wrong-ALLOW witness — codex Low) |
| 2 (PR-2) | auth product fix + smoke class fixes | `bun run audit:vue` + full armed smoke solo `--retry=0` (explicit CLI flag — smoke config defaults retry:2) |
| 3 (PR-3) | import measurement → stage-stall detector + network class fixes + additive polish | typecheck/lint + solo network sweep `NULO_E2E_RETRY=0` (proverless FULL sweep, then the default-mode leg as NAMED import-test files — agent.sh refuses a bare full default run when proverless-only files exist) + armed smoke `--retry=0` |
| 4 (PR-4) | death primitive + un-skip | armed smoke solo `--retry=0` ×2 + file alone ×3 |
| 5 (PR-5) | scripts + docs | shellcheck + Phase-6 certification (3 qualifying greens, frozen tree) |

Every PR: codex iterate-until-approve + dual-lens review (fixes separate commit);
post-impl codex audit on the stack net diff before PR-5 merges.

## Security & Adversarial Considerations

- **Gate integrity**: rule order (failure first, always) + lone-cancel-stays-red pinned in
  unit tests; fail-closed on every API error path; probe identity (if shipped) pinned to
  head SHA + head repository + PR number — a fork reusing our branch name cannot green a
  victim SHA (codex Critical 2); the deliberately-red-survivor probe is a standing
  verification, not a demo.
- **Token scope UNCHANGED**: the CI item ships trigger-expression edits only — no new
  permissions, no API calls, no scripts, no change to how any gate concludes.
- **auth.vue change**: pinned behavior fix (submit gating) — the pins prove the disabled
  gate and the settled-flag lifecycle; no auth logic beyond gating is touched.
- **import.vue changes**: testid + data attribute only, no logic.
- **Test changes cannot weaken acceptance**: stall windows sized from measurement with the
  UNCHANGED 300s outer backstop; absence windows unchanged; retry only tightened.

## Validation layers (repo-real)

`bun run lint` / `typecheck` / `audit:vue`, `bun test scripts/ci-cd/`,
`bun run lint:actions`, armed `test:e2e --retry=0` smoke solo, `e2e:agent` network solo
(`NULO_E2E_RETRY=0`, proverless + default), scratch-branch CI probes (phase 1), Phase-6
certification on PR-5.
