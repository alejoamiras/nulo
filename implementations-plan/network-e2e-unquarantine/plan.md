# Un-quarantine + unskip network-e2e tests

**Verdict (1 line):** 1 PR, 6 phases (reordered per dual audit), ~4 hours implementation + 1–2 CI acceptance iterations. Follow-up to [`accelerator-server-ci`](../accelerator-server-ci/plan.md) (PR #67) — does not start until that lands on `dev`.

**Audit cycle:** [`audit-codex.md`](./audit-codex.md) (`approve-with-fixes`) + [`audit-opus.md`](./audit-opus.md) (`approve-with-fixes`). Both flagged the same two structural issues — phase ordering should put `sim-methods` first for cleaner cap-popup-class attribution, and the `multi-account-from` fixture migration should land upfront rather than deferred. Both applied. Plus prose corrections (H-OP-3 mechanism, file-scope, multicall chunking, Q3 framing). Details in §12 "Audit response log."

**Status update (revised):** the partial resolution recorded throughout this doc graduated to **full resolution** via [`../journal-stage-restructure/plan.md`](../journal-stage-restructure/plan.md). The 3 affected tests (`tx-sendTx-default`, `multi-account-from`, `tx-sendTx-multicall`) are now un-quarantined via journal-stage assertion (`waitForSendTxProvingStage()`); the `NULO_E2E_SKIP_DEFERRED_SLOW` gate is removed from CI. The fixture migrations + NO_WAIT improvements from this plan stayed as strict-better foundations.

## 1. Goal

Restore network-e2e to a "zero skips, zero artificially-bumped waits" state. The accelerator integration (PR #67) removes the bb.wasm proving variability that motivated quarantining 3 tests + bumping `cancel-mid-prove` waits. With native proving and the existing pre-grant fixture pattern (built during PRs #63/#64), the artificial gates are no longer load-bearing.

## 2. Locked-in scoping decisions

| | |
|---|---|
| Scope | All 5 items (3 quarantines + cancel-mid-prove waits + sim-methods fixture migration) |
| PR strategy | Follow-up PR after PR #67 merges to `dev` |
| Dependency | Blocked on PR #67 |
| Acceptance | 3 consecutive 6/6 green CI runs (matches the gate codex set for PR #67) |

## 3. What's actually skipped/loosened today

Verified by grep against `packages/extension/tests/e2e/network/` + `.github/workflows/_network-e2e.yml`.

| Test file | State | Mechanism | Hypothesized root cause |
|---|---|---|---|
| `tx-sendTx-default.test.ts` | Quarantined on CI | `test.skipIf(!hasConfig \|\| skipDeferredSlow)` + `_network-e2e.yml` env `NULO_E2E_SKIP_DEFERRED_SLOW=1` | Slow runner-pool variability — wallet `buildAndEstimateTxRequest → proveTxTask → sendTxTask` chain >180s on slow runners (PR #66) |
| `tx-sendTx-multicall.test.ts` | Quarantined on CI | Same env gate | bb.wasm `proveTx` cold-start cost per fresh Chrome (H-OP-1) |
| `multi-account-from.test.ts` | Quarantined on CI | Same env gate | Cap-popup target-creation backpressure under cumulative load (H-OP-3) |
| `cancel-mid-prove.test.ts:113,118` | Waits loosened | Hardcoded `waitForSelector` timeouts 30s → 90s | Same prover variability (PR #66) |
| `sim-methods.test.ts:25` (`sim-profileTx (#24)`) | NOT quarantined but flaky | Uses `dappConnectedExtensionPerTest` (per-test grant); cap-popup cold-tax on slow runners | Same cap-popup mechanism as `multi-account-from`; surfaced during PR #67's first CI run |

## 4. Phase-by-phase implementation

Each phase is a discrete commit (or small group). The PR squash-merges so the commit log on `dev` is one line; the commit organization here exists so we can revert any phase in isolation if needed during acceptance.

**Phase order is deliberately attribution-driven** (both audits' insight): we run the cap-popup-class fix (`sim-methods` fixture migration) FIRST so the signal from later proving-class phases isn't muddied by residual H-OP-3-family flake. Then proving-class canaries in increasing risk. Then the cap-popup-class un-quarantine (`multi-account-from`) once the fixture pattern is proven safe on this branch. Then cleanup.

Order: `4.A sim-methods → 4.B cancel-mid-prove → 4.C tx-sendTx-default → 4.D tx-sendTx-multicall → 4.E multi-account-from → 4.F cleanup`. The original numeric "4.1–4.5" labels were dropped to remove the implication that the original ordering was sound; the new letter labels are conceptual.

### Phase 4.A — Migrate `sim-methods.test.ts` to pre-grant fixture (cap-popup-class signal)

**File:** `packages/extension/tests/e2e/network/sim-methods.test.ts`

The 3 test cases (`simulateTx`, `profileTx`, `executeUtility`) currently use `dappConnectedExtensionPerTest` and grant the `accounts` bundle in-test (lines 30–47). Migrate to `dappConnectedExtensionWithAccountsCap` (same pattern as `register-token.test.ts` post-PR #63). Strip the in-test grant block; the fixture handles it under `hookTimeout`.

**Why this phase first** (audit consolidation): both audits flagged this. `sim-methods > sim-profileTx (#24)` failed at exactly the 30s `waitForPopup` cliff on PR #67's first CI run, and the lessons doc tagged this as "non-accelerator flake — migrate to pre-grant fixture." Doing this phase first proves the pre-grant pattern works under accelerator-enabled CI. Subsequent proving-class phases then have a clean attribution signal.

**Risk:** Low. The migration is mechanical and the fixture is battle-tested by `register-token.test.ts`.

**Acceptance signal:** CI green on this commit alone; specifically, `sim-methods.test.ts` lands in shard 5/5 per the deterministic SHA-1 distribution and we want shard 5/5 green 3 consecutive runs. Capture the new `dappConnectedExtensionWithAccountsCap` `phase()` setup-duration into the run log; if any phase lands close to its 60s `waitForSelector` budget on these runs, that's a leading indicator the migration hides a deeper problem (opus catch).

### Phase 4.B — Restore `cancel-mid-prove` waits to 30s (lowest-risk proving canary)

**File:** `packages/extension/tests/e2e/network/cancel-mid-prove.test.ts`

Revert lines 113, 118 from `timeout: 90_000` to `timeout: 30_000`. Drop the prose comment that explains the bump (it's no longer accurate).

**Wait-class clarification** (opus catch): the 30s waits in this test are on the **wallet popup** (`openPopup()` returns, then `waitForSelector('[data-testid="tx-awaiting-card"]', ...)`), NOT a cap popup. The cap popup was already closed earlier in the test by `approveCapabilities`. So the timing budget covers ONLY the wallet's journal `awaiting` UI transition fired post-simulate, pre-prove — which on native bb completes in ≤2s, not 30+.

**Risk:** Low. Accelerator's native bb proves complete in seconds, well under 30s.

**Acceptance signal:** 3 consecutive CI passes. If flake on attempt 1, consider 45s as a compromise; if still flake, investigate the wallet popup mount path itself (separate from the cap-popup class we'll have already validated via Phase 4.A).

### Phase 4.C — Un-quarantine `tx-sendTx-default` (the proving canary)

**File:** `packages/extension/tests/e2e/network/tx-sendTx-default.test.ts`

Remove the `skipDeferredSlow` constant + the `|| skipDeferredSlow` predicate from `test.skipIf`. Drop the obsolete comment block lines 9–22 about the quarantine rationale. Keep the `dappConnectedExtensionWithTransactionCap` fixture, the 240s timeout, and the `waitForPgResult(..., 180_000)` budget — those remain reasonable upper bounds even with accelerator.

**Risk:** Medium. This was the test we most recently quarantined, with fresh measurement data (>180s on slow runners pre-accelerator). Accelerator should drop the wallet chain to <30s.

**Acceptance signal:** Test passes on the first 3 CI runs. The diagnostic `console.log` line we added in PR #66 (`[tx-sendTx-default] waitForPgResult settled in Xms`) stays — it gives us real data on accelerator's per-test prove duration. Eventual feed-in to the stage-timing instrumentation that PR #67's plan §11 flagged as a follow-up (opus's reminder).

### Phase 4.D — Un-quarantine `tx-sendTx-multicall`

**File:** `packages/extension/tests/e2e/network/tx-sendTx-multicall.test.ts`

Same pattern as Phase 4.C: remove `skipDeferredSlow` gate + drop the comment block lines 9–13. **Also**: migrate the test from `dappConnectedExtensionPerTest` to `dappConnectedExtensionWithTransactionCap` (pre-grant pattern). The test's body currently grants the `transaction` bundle in-test; with the fixture, that grant moves into `hookTimeout` (300s) instead of the test budget. Strip the cap-grant block from the test body.

**Multicall internals** (codex catch — original plan misstated the prove count):
- `tx-sendTx-multicall.test.ts:23-26` runs 2 cases:
  - `#32 multicall` (3 calls): playground builds one `ExecutionPayload`, one `wallet.sendTx()` (`packages/playground/src/sections/transactions.ts:126`), single prove. Budget plenty.
  - `#33 multicall-chunked` (7 calls): same one-sendTx call, BUT the wallet's `nulo-account.ts` recursive chunking (5-call wrap, per CLAUDE.md) likely produces multiple inner prove steps. Exact count is wallet-internal and not established by reading the playground alone.
- Native bb single prove on CI runner is ~5s based on PR #67 acceptance numbers. Even if chunked produces 3 inner proves serialized by accelerator-server's `Semaphore::new(1)`, total wall-time should be ~15s. Test budget is 240s — well within.

**Fixture compatibility check** (Q1 resolution — was deferred, now resolved here per opus + codex): `dappConnectedExtensionWithTransactionCap` (`fixtures/extension.ts:486-499`) pre-grants the `transaction` bundle for a single account. Multicall does N calls FROM THAT ONE GRANTED ACCOUNT — not N accounts. The single-account fixture is the right shape; multicall's batch semantics are within one wallet's authority.

**Risk:** Medium. Plumbing is well-tested via `tx-sendTx-default`'s prior use of the same fixture, but multicall-chunked is the largest single-test prove footprint in the suite.

**Acceptance signal:** 3 consecutive CI passes; ideally with zero retry-usage (vitest `retry: 2` would mask a single-failure-passes-on-retry pattern).

### Phase 4.E — Un-quarantine `multi-account-from` (+ bake fixture migration in)

**Files:**
- `packages/extension/tests/e2e/network/multi-account-from.test.ts` — un-quarantine
- `packages/extension/tests/e2e/fixtures/extension.ts` — add `dappConnectedExtensionWithFirstTwoAccountsCap` fixture variant

**Factual corrections** (opus + codex catches):
- The test uses `dappConnectedExtension` (NOT `dappConnectedExtensionPerTest`), which is **file-scoped** (`fixtures/extension.ts:359` — `{ scope: "file" }`). Since this is the only test in the file, file-scope ≈ per-test in practice — but the prose mattered for fixture-design implications.
- The H-OP-3 framing as "puppeteer waitForTarget polls every 500ms missing fast-mount" is **wrong** (codex). `browser.waitForTarget` is event-driven (puppeteer-core's `Browser.js:91`); our helper `waitForPopup` at `popups.ts:19` just snapshots existing targets then delegates. The real failure mode is "popup target creation/readiness exceeds the 30s timeout under load," not a polling miss-window. Same family (popup mount latency under cumulative load), different precise mechanism.

**Why bake fixture migration in upfront** (both audits): the original plan deferred this to a hypothetical "Phase 4.4b" only if needed. Both auditors argued for upfront-migration because:
1. The acceptance gate (`3 consecutive 6/6 green`) is too coarse to distinguish "true fix" from "got lucky" given vitest's `retry: 2` (3 attempts per test).
2. The mechanical work is small and the iteration round saved if it fixes the issue is worth more than the residual change-risk.

**New fixture: `dappConnectedExtensionWithFirstTwoAccountsCap`**

Mirrors `dappConnectedExtensionWithTransactionCap` (`fixtures/extension.ts:452-505`), but in the `approveCapabilities` block:
```ts
const granted = accountIds.slice(0, Math.min(2, accountIds.length))
                          .filter((a): a is string => !!a)
if (granted.length === 0) throw new Error("capabilities popup returned no accounts")
await approveCapabilities(capPopup, { accounts: granted })
```
Returns `{ ...ctx, playgroundPage, accountAddresses: granted }` (note plural; the test asserts wallet uses `accountAddresses[0]` regardless of dApp's `opts.from`).

**Risk:** Higher than other phases. The new fixture introduces a new code path; even mechanical, mistakes are possible. Mitigation: the existing `dappConnectedExtensionWithTransactionCap` is the template; diff is ~5 lines.

**Acceptance signal:** 3 consecutive CI passes, **zero retries used on this specific test** (stricter signal — vitest's `retry: 2` would otherwise mask occasional misses on cumulative load). If retries are used: investigate whether accelerator's load reduction is insufficient and consider additional measures (e.g. `--max-concurrency=1` for this file).

### Phase 4.F — Workflow + docs cleanup

Drop the now-dead infra; preserve historical context.

**Files (live config — must change):**
- `.github/workflows/_network-e2e.yml` — remove the `NULO_E2E_SKIP_DEFERRED_SLOW: "1"` env line + the comment block above it.
- `packages/extension/scripts/e2e/docker-ci-like.sh:120` — remove `export NULO_E2E_SKIP_DEFERRED_SLOW=1` + adjacent comment.
- `packages/extension/tests/e2e/README.md` — drop the "Quarantined tests" line ~109 AND the `NULO_E2E_SKIP_DEFERRED_SLOW=1` repro example at line ~115 (opus catch).

**Files (planning archive — append resolution-note treatment):**
- `implementations-plan/network-followups/slow-tests-hypotheses.md` — append closing section pointing at this plan + the accelerator-server-ci plan as the resolution path.
- `implementations-plan/e2e-stabilization/plan.md` — append resolution note matching the same discipline (opus catch — multiple historical references at lines 36, 145, 151, 227, 240).
- `implementations-plan/e2e-stabilization/lessons/phase-4.md` — append resolution backlink (opus catch — references at lines 37, 47).

**Files (preserve as immutable history — don't touch):**
- `implementations-plan/e2e-stabilization/audit-codex-v2-2026-05-26.md`, `audit-opus-v2-2026-05-26.md` — audit transcripts are time-capsules per CLAUDE.md plan-style rules.
- `implementations-plan/accelerator-server-ci/plan.md` and other accelerator plan refs — historical context from this PR's parent.

**Sanity-check before closing the PR:** `grep -rn "NULO_E2E_SKIP_DEFERRED_SLOW\|skipDeferredSlow" .` should return only the audit-transcript matches.

## 5. File catalog

| File | Change | Why |
|---|---|---|
| `packages/extension/tests/e2e/network/cancel-mid-prove.test.ts` | -2 timeouts (90s → 30s) + drop bumped-wait comment | Phase 4.1 |
| `packages/extension/tests/e2e/network/tx-sendTx-default.test.ts` | -`skipDeferredSlow` constant, -gate, -comment block | Phase 4.2 |
| `packages/extension/tests/e2e/network/tx-sendTx-multicall.test.ts` | -gate, -comment, +fixture migration | Phase 4.3 |
| `packages/extension/tests/e2e/network/multi-account-from.test.ts` | -gate, -comment | Phase 4.4 |
| `packages/extension/tests/e2e/network/sim-methods.test.ts` | +fixture migration (per-test grant → pre-grant) | Phase 4.5 |
| `.github/workflows/_network-e2e.yml` | -env var + comment block | Phase 4.6 |
| `packages/extension/scripts/e2e/docker-ci-like.sh` | -env export | Phase 4.6 |
| `packages/extension/tests/e2e/README.md` | Drop quarantine subsection | Phase 4.6 |
| `implementations-plan/network-followups/slow-tests-hypotheses.md` | Append resolution note | Phase 4.6 |

**NOT modified:**
- The cap-popup machinery (no fixture changes for `multi-account-from` per Phase 4.4's risk note; would only happen as a Phase 4.4b if needed).
- Wallet code in `packages/aztec-runtime/` or `packages/extension/src/` — pure test-and-infra changes.
- Any test that was already passing.

## 6. Test plan

The plan IS a test-shape change, so "test plan" here means "what CI runs we use as acceptance signals."

| Stage | Signal | Pass criterion |
|---|---|---|
| Per-phase development | Run `bun run e2e:agent tests/e2e/network/<file>` locally with accelerator desktop app running | Single test passes on local |
| Per-phase development | Run `NULO_E2E_SKIP_DEFERRED_SLOW=` (unset) `bun run e2e:agent tests/e2e/network/<file>` | Passes locally without the quarantine env |
| PR pre-push | `bun run audit:vue` | typecheck + test + lint + build all green |
| First CI run | `gh pr checks <PR>` | All 6 jobs (5 shards + heavy) green |
| Acceptance gate | 2 more CI runs via `gh workflow run pr-network-e2e.yml --ref <branch>` | 3 consecutive 6/6 green = mergeable |

No new tests are added. The change is purely "stop hiding tests we already had."

## 7. Security & Adversarial Considerations

Limited surface — this PR doesn't change the wallet's production code, doesn't add binaries, doesn't change CI permissions.

**Threat model**: an attacker landing a PR that secretly re-quarantines a test (or re-adds the env gate) to hide a regression. Mitigation: reviewer reads the diff. The quarantine env var is gone after Phase 4.6, so re-adding it requires diff edits across both `_network-e2e.yml` AND a test file's import block — visible.

**Supply chain**: no new dependencies.

**Adversarial review questions for PR review:**

1. After cleanup, is there any path for a test to be silently skipped under CI? — `skipIf(!hasConfig)` remains everywhere (that's the aztecConfig injection check, working as designed). No `xfail`, no broad `.skip()` blocks.
2. Could the fixture migration in 4.3/4.5 accidentally weaken test coverage? — The fixture grants the SAME capability in setup that the test was granting in-body. No behavior change at the wallet/dApp surface, just where the time is spent (hookTimeout vs test budget).
3. Could removing `NULO_E2E_SKIP_DEFERRED_SLOW` break local dev? — Locally the env was unset anyway; the variable only had effect on CI. No local-dev path depends on it.

## 8. Open questions (post-audit-consolidation)

Per opus + codex feedback, Q1 + Q3 are resolved here rather than deferred to first CI run. Q2 stays empirical. Q4 stays manual-grep hygiene.

| # | Question | Status |
|---|---|---|
| Q1 | Does `dappConnectedExtensionWithTransactionCap` work for `tx-sendTx-multicall`? | **RESOLVED via source-read (Phase 4.D body):** playground builds 1 `ExecutionPayload`, calls `wallet.sendTx()` once. Multicall does N calls FROM the granted account, not N accounts. Single-account fixture is the right shape. Multicall-chunked variant (#33) may internally chunk into multiple inner proves via `nulo-account.ts` 5-call wrap; native bb keeps total wall-time well under 240s budget. |
| Q2 | Will `multi-account-from` pass with accelerator? Its root cause was popup-mount-under-load (H-OP-3 reframed), NOT proving. | **EMPIRICAL — first CI run resolves**, BUT we de-risked by baking the `dappConnectedExtensionWithFirstTwoAccountsCap` fixture in upfront (Phase 4.E). If the fixture migration doesn't fix it, we know the issue isn't cap-popup-cold-path. |
| Q3 | What exactly does the `cancel-mid-prove` 30s budget cover? | **RESOLVED via source-read (Phase 4.B body):** waits are on the **wallet popup** (after `openPopup`), not the cap popup (which already closed earlier in the test). Native bb prove-start = ≤2s; 30s budget is generous. Cap-popup-mount latency is independent and doesn't apply to this wait. |
| Q4 | Should `skipDeferredSlow` env-var resurrection be guarded? | **Out of scope** — final `grep` sanity-check in Phase 4.F. Adding a pre-commit guard (mirroring `scripts/check-no-brand.sh`) is a worthwhile follow-up; note in lessons doc when closing this PR. |

## 8b. Attribution clarification (codex's cross-cutting catch)

The original plan mixed two classes of fix into one ambiguous "things that flake":

1. **Proving-class** — the WASM-throttled prove-time variability. Fixed by accelerator (PR #67's contribution). Tests in this class: `tx-sendTx-default`, `tx-sendTx-multicall`, `cancel-mid-prove`. Acceptance is "the un-quarantine just works."
2. **Cap-popup-class** — popup-mount-latency under cumulative test load. NOT proving. Fixed by the pre-grant fixture pattern (PRs #63 + #64's contribution). Tests in this class: `sim-methods > sim-profileTx`, `multi-account-from`. Acceptance is "the fixture migration moves cold path out of test budget."

Phase order respects this: 4.A proves the cap-popup-class fixture pattern still works under accelerator-CI; 4.B–4.D test proving-class with clean signal; 4.E applies the cap-popup-class fixture to the last gated test.

## 8c. Acceptance gate notes (opus catch)

`vitest.e2e.network.config.ts:35` sets `retry: 2` (3 attempts per test). A test that passes on attempt 2 or 3 is invisible at the green-check level. The general gate stays "3 consecutive 6/6 green CI runs," but Phase 4.E (the highest-risk un-quarantine) ALSO requires **zero retries used on `multi-account-from`** as a stricter cap-popup-class signal. Capture retry counts via vitest's reporter output and include in the per-acceptance-run check.

For Phase 4.A and Phase 4.E (the two fixture-migration phases), also log the new fixture's `phase()` setup-duration on each acceptance run. If any phase lands close to its 60s `waitForSelector` budget on any of the 3 runs, that's a leading indicator the migration hides a deeper problem.

## 9. Rollback path

**Per-phase commits make per-phase revert trivial.** If Phase 4.4 (multi-account-from) is the only one that flakes, revert just that commit and re-open the PR.

**Full rollback** (if the whole PR was a mistake): `git revert <merge-commit-sha>` restores the quarantine env var, the test gates, and the bumped waits. No data migration needed.

**Mid-PR escape hatch** (if the canary Phase 4.2 reveals accelerator's gains were less than expected): stop after Phase 4.2; keep the rest quarantined; reassess.

## 10. Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Incremental — one test at a time across multiple PRs | Locked: user picked all-5 in one PR. Per-PR review overhead is multiplicative for 5 PRs with very similar diffs. |
| Bundle into PR #67 before merge | Locked: PR #67 stays focused on "land accelerator". Coupling "accelerator works" with "these specific tests pass with accelerator" complicates review + bisect. |
| Spike-first: un-quarantine in a throwaway commit on PR #67 just to see if it works, then revert + open this PR | Adds round trips. We already have strong indirect evidence (PR #67's network-e2e jobs ran ~4–5× faster than baseline) that accelerator delivers. Direct measurement happens naturally during Phase 4.2's first CI run anyway. |
| Build a `dappConnectedExtensionWithMultiAccountTransactionCap` upfront for `multi-account-from` | Scope creep + premature optimization. Only build if Phase 4.4's first run shows the existing per-test grant still flakes. |
| Increase the existing `30_000` cap-popup timeouts globally as a defensive measure | Hides the signal — if accelerator-enabled CI still hits cap-popup flake, we want to know, not paper over. The wait bumps were always a workaround, not the fix. |
| Convert tests to `xfail` instead of removing the gate | Same as above — hides signal. The point of un-quarantining is to start seeing real CI signal again. |

## 11. Specific asks for codex + opus audit (closed)

Both audits returned `approve-with-fixes`. Findings folded into the plan above; see §12 for the per-finding response log.

## 12. Audit response log

| Finding source | Severity | Status |
|---|---|---|
| Opus #1: factual error — `dappConnectedExtension` is file-scoped, not per-test; fixture variant wouldn't be "MultiAccount" but "FirstTwoOfN" | high | **APPLIED** (§4.E factual correction + new fixture name `dappConnectedExtensionWithFirstTwoAccountsCap`) |
| Opus #2: Phase 4.4 acceptance signal can't separate cold-tail flake from real success given vitest `retry: 2` | high | **APPLIED** (§8c — Phase 4.E now requires zero retries used as stricter gate; fixture migration baked in upfront per #4 below) |
| Opus #3 / Codex #3: multicall fixture compatibility (Q1) should be resolved by source-read NOW, not via first CI run | medium | **APPLIED** (§8 Q1 resolved via source-read; included in §4.D body) |
| Opus #4 / Codex #1: phase order — sim-methods should land earlier for cleanest cap-popup-class signal | medium | **APPLIED** (new order: 4.A sim-methods → 4.B cancel-mid-prove → 4.C tx-sendTx-default → 4.D tx-sendTx-multicall → 4.E multi-account-from → 4.F cleanup) |
| Opus #5: §4.6 cleanup misses `e2e-stabilization/plan.md`, `lessons/phase-4.md`, and `e2e/README.md:115` repro line | medium | **APPLIED** (§4.F expanded with explicit live/archive/immutable split) |
| Opus #6 + #8c: acceptance-gate add diagnostic for fixture-setup duration capture | medium | **APPLIED** (§8c) |
| Opus #8: Q3 framing wrong — waits are on wallet popup, not cap popup | low | **APPLIED** (§4.B + §8 Q3 rewritten) |
| Codex #1: same as opus #4 (phase order) | high | **APPLIED** (same as above) |
| Codex #2: H-OP-3 "500ms polling" mechanism wrong — `browser.waitForTarget` is event-driven | medium | **APPLIED** (§4.E mechanism reframed) |
| Codex #3: multicall sequential-proves model unverified | medium | **APPLIED** (§4.D body explains playground builds 1 `ExecutionPayload`; chunking is wallet-internal; cited `transactions.ts` + `nulo-account.ts`) |
| Codex #4: bake multi-account fixture upfront for one-shot PR | medium | **APPLIED** (§4.E — fixture variant added to plan, no longer deferred) |
| Codex #5: §4.6 historical refs (accelerator-server-ci/plan.md, e2e-stabilization/plan.md) | low | **NOTED** (§4.F preserves audit transcripts as immutable; appends resolution notes to the planning archive) |
| Codex cross-cutting: attribution — proving-class vs cap-popup-class need different sequencing | high | **APPLIED** (§8b new section) |
| Opus extras (retry:2 noise, file-scope ≈ per-test in practice, expected_sha256 conflict-resolution caveat, prove-duration log line stays) | low-info | **NOTED** in respective sections |

## 13. Specific asks for any future audit pass

Following implementation, the next codex pass should verify:

(a) The `dappConnectedExtensionWithFirstTwoAccountsCap` fixture diff against `dappConnectedExtensionWithTransactionCap` for correctness.

(b) The Phase 4.F final `grep` output for any missed references.

(c) Whether the 3-of-3 acceptance gate was actually achieved (vs "passed eventually after retries").

(d) Whether the §4.6 historical-doc resolution-note treatment is reasonable, or whether some references warrant in-line replacement vs. backlink.
