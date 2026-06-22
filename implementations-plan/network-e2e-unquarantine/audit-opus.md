# Tier-B audit — `network-e2e-unquarantine` plan

**Verdict:** `approve-with-fixes`

Plan is sound in its top-level shape (phase order, scope, rollback story) and rests on real verified facts about accelerator-server. Six issues need to land before the PR opens. Three are factual errors in the plan (would still ship working code, but cite wrong premises). Three are real omissions in cleanup, sequencing, or acceptance.

---

## Findings

### 1. (high) Factual error in §4.4 — `multi-account-from` uses `dappConnectedExtension`, NOT a per-test fixture

`packages/extension/tests/e2e/network/multi-account-from.test.ts:35` consumes `dappConnectedExtension`, which is **file-scoped** (`packages/extension/tests/e2e/fixtures/extension.ts:359` — `{ scope: "file" }`). The plan §4.4 calls it "per-test grant (`dappConnectedExtension`)" — that's wrong twice over: (a) the fixture is file-scoped, and (b) it doesn't pre-grant anything, the test grants the cap in-body at line 44.

Why this matters for the audit, not just nitpicking the prose:

- The plan's "Migration would require building `dappConnectedExtensionWithMultiAccountTransactionCap`" implies the existing fixture's one-account limit is the blocker. **It isn't.** The blocker is that this test wants to grant 1-or-2 accounts depending on `accountIds.length` (line 52: `accountIds.slice(0, Math.min(2, accountIds.length))`). The `dappConnectedExtensionWithTransactionCap` fixture (`fixtures/extension.ts:486-499`) selects `accountIds[0]` only — it would silently lose the 2nd grant.
- Building `dappConnectedExtensionWithMultiAccountTransactionCap` as Phase 4.4b is fine, but it should be specified as "iterate over `accountIds` slicing the first 2", not "make it grant N accounts."

**Fix:** correct the language in §4.4 — file-scoped, in-test grant — and clarify that the fallback fixture wouldn't be a generic "MultiAccount" variant but specifically "first-two-of-N." Otherwise a future contributor implementing 4.4b will overdesign.

### 2. (high) Phase 4.4 acceptance signal is wrong — single CI run can't separate cold-tail flake from real success

§4.4 says: "Acceptance signal: 3 consecutive CI passes. If it still flakes: Bump the 30s `waitForPopup(..., "capabilities", { timeout: 30_000 })` at line 44 to 60s." But:

- `vitest.e2e.network.config.ts:35` sets `retry: 2`, so each test gets 3 attempts per CI run. A flaky test that passes on the 2nd or 3rd attempt is invisible at the gate level.
- The H-OP-3 root cause (`puppeteer's waitForTarget 500ms polling`) is a *probabilistic* miss-window. Whether 3-of-3 CI runs pass is a noisy signal of whether the underlying flake rate is acceptable.

The accelerator-server-ci plan's lessons doc (`implementations-plan/accelerator-server-ci/lessons/phase-1.md:135-140`) records that PR #67 run 1 had `sim-profileTx` fail at exactly this 30s `waitForPopup` cliff — and the recommendation there was "migrate to pre-grant fixture." That's the same prescription `multi-account-from` would need. The plan's bet is that accelerator's load reduction shifts the popup-mount latency curve enough that the bare 30s budget passes. That bet is plausible but not measured.

**Fix:** require Phase 4.4 to publish a metric: capture the actual `waitForPopup` duration on first CI run and use it as the gate. If P95 ≥ 20s, bake the fixture migration into the PR rather than chasing 3-of-3 green by luck.

### 3. (medium) The fixture migration in §4.3 should be split out of `tx-sendTx-multicall` — Q1 deserves resolution BEFORE merge, not during

Plan §4.3 bundles two changes into one commit: (a) remove `skipDeferredSlow` gate, (b) migrate to `dappConnectedExtensionWithTransactionCap`. Q1 in §8 admits ambiguity about whether the new fixture's 1-account pre-grant is compatible with multicall semantics (multicall does multiple txs FROM that 1 account — should be fine, "but verify").

This concern is empirically resolvable in 5 minutes by reading the multicall path: multicall produces one `BatchCall`, the SDK serializes it into one tx, one prove, one submission — a single `transaction` cap grant against the one selected account satisfies the gate. The fixture is fine. The plan should resolve Q1 by reading the code, **not** by treating the first CI run as the gate.

**Fix:** flip Q1 to "RESOLVED via source read" before opening the PR. The "fall back to keeping per-test grant + bumping the cap-popup wait to 60s" escape hatch is fine to keep documented, just don't gate merge on first-CI-as-resolution.

### 4. (medium) Phase order should swap 4.3 and 4.4 — `multi-account-from` is the canary, not `tx-sendTx-multicall`

The plan's phase order is risk-incremental on *proving cost*. But §4.4 explicitly notes the dominant risk for `multi-account-from` is **cap-popup backpressure**, not proving. That's the *same* risk source as the `sim-profileTx` flake seen in PR #67's first CI run.

If accelerator's load reduction doesn't fully fix H-OP-3 (and we have no measurement that it does), the most informative thing to learn early is whether the cap-popup wait still flakes under the lower-load regime. `multi-account-from` is the cleanest test of that — it stacks the cap-popup wait against the rest of a typical test body. Learning the cap-popup answer with a single phase first lets us decide whether to (a) defer Phase 4.5 (sim-methods is the *fix* for the same class) or (b) cut Phase 4.5 in earlier as a structural mitigation.

**Suggested reordering:**

```
4.1 cancel-mid-prove waits 90→30 (proving canary, lowest risk)
4.2 tx-sendTx-default (proving canary, medium risk — same class as 4.1)
4.5 sim-methods fixture migration (proves the pre-grant pattern works under accelerator)
4.3 tx-sendTx-multicall (un-quarantine + fixture migration — relies on 4.5's signal)
4.4 multi-account-from (highest risk — cap-popup class)
4.6 cleanup
```

Rationale: 4.5 is mechanical (the plan even says so). Landing it before 4.3 makes 4.3 a pure un-quarantine + tested-pattern application rather than two unknowns at once. And it gives 4.4 the cap-popup-class evidence it needs to decide whether 4.4b should land upfront.

Counter-argument the original order has going for it: §4.5 (`sim-profileTx`) is currently flaky-but-passing-with-retry, while §4.3 is gated. The user may want gated-test recovery prioritized over flake-reduction. If so, swap 4.5 to land between 4.3 and 4.4 instead of between 4.2 and 4.3.

### 5. (medium) Cleanup completeness — three leakage paths the plan misses

§4.6 lists 4 cleanup targets. Grep against the repo turns up these additional references the plan doesn't account for:

a. `implementations-plan/e2e-stabilization/plan.md:36, 145, 151, 227, 240` — multiple references to `NULO_E2E_SKIP_DEFERRED_SLOW` in the historical e2e-stabilization plan. Per CLAUDE.md "implementation plans" rule, plans are committed artifacts that future contributors read. The references here aren't wrong (they describe the past state), but adding the resolution note (§4.6 already does this for `network-followups/slow-tests-hypotheses.md`) to `e2e-stabilization/plan.md` matches the same discipline.

b. `implementations-plan/e2e-stabilization/lessons/phase-4.md:37, 47` — two references to `NULO_E2E_SKIP_DEFERRED_SLOW` and `skipDeferredSlow` in the lessons doc that describe the same un-quarantine future. Append a resolution backlink.

c. `implementations-plan/e2e-stabilization/audit-codex-v2-2026-05-26.md` + `audit-opus-v2-2026-05-26.md` — codex and opus audit transcripts containing the env var in repro instructions. These are historical-record-immutable per the plan-style rules; leave them alone.

The CLAUDE.md guidance is clear that audit transcripts are time-capsules. So (a) and (b) are the legitimate adds; (c) stays.

**Fix:** add `implementations-plan/e2e-stabilization/plan.md` and `implementations-plan/e2e-stabilization/lessons/phase-4.md` to the §4.6 file list with the "append resolution note" treatment. Also update the §4.6 README change to clarify which `e2e/README.md` paragraph — line 109 has the quarantine bullet, line 115 has the env in the repro command-line example. Both need to come out.

### 6. (low) Acceptance gate "3 consecutive 6/6 green" is right for un-quarantine, slightly miscalibrated for fixture migration

The 3-consecutive-green gate works well for "did we restore a test we trust." It's less informative for "did we introduce a fixture change that might add a new class of flake."

Phase 4.5 introduces a fixture migration. Phase 4.3 introduces a fixture migration. Both could pass 3-of-3 today and produce a new flake on PR #75 next week when shard distribution shifts. The strict acceptance gate isn't wrong per se, but the plan should add one diagnostic capture:

**Suggested add to §6:** capture and log the new `dappConnectedExtensionWithTransactionCap` setup phase duration (each `phase()` call in the fixture is already wrapped — `fixtures/extension.ts:455-461`) on the first 3 acceptance runs. If the cap-popup setup phase ever lands close to its 60s waitForSelector budget on any of the 3 runs, that's a leading indicator the migration didn't fix the underlying load problem.

### 7. (low) Q4 in §8 — "lint out `skipDeferredSlow` references" — the grep is the lint; codify it

Q4 says "Phase 4.6 grep should be comprehensive; add a final `grep -r NULO_E2E_SKIP_DEFERRED_SLOW` sanity-check before closing out the PR." That's a manual step. Per CLAUDE.md "Workflow-level: actionlint + shellcheck run when workflow YAML or shell scripts change" — the same discipline applies here. The legacy-brand pre-commit hook (`scripts/check-no-brand.sh` per CLAUDE.md) is the existing precedent for a guard hook against ghosts of removed code.

Out of scope for this PR (would be its own follow-up: "extend pre-commit guard to forbid resurrected env vars"), but worth recording in the lessons doc when this PR closes so a future contributor sees the option exists. Not a blocker.

### 8. (low) Q3 in §8 — the `cancel-mid-prove` budget reasoning is fragile

§4.1 reverts 30s → 90s on `cancel-mid-prove.test.ts:113, 118`. Q3 in §8 says "Tested under WASM at 30s and failed; with accelerator the prove-start is faster, but cap-popup mount is independent."

But the lessons doc (`implementations-plan/accelerator-server-ci/lessons/phase-1.md:135-140`) records the exact same 30s cap-popup mount latency was the cause of `sim-profileTx` flake on PR #67's first run. So the relevant question is: is the prove-start UI transition (which the 30s budget gates) bound by the same cap-popup mount class? Looking at the test (`cancel-mid-prove.test.ts:112-118`):

```
const walletPopup = await openPopup(...)   // popup mount
await walletPopup.waitForSelector('[data-testid="tx-awaiting-card"]', { timeout: 30/90s })
```

The wait starts AFTER `openPopup` returns (which has its own 2s + 30s fallback per `extension.ts:983-1000`). So the 30s budget covers ONLY the journal's `awaiting` UI transition after Vue mount completes. That transition fires when the wallet's `executeOperations` reaches the journal stage — which is post-simulate, pre-prove. Native bb prove start should be ≤2s, not 30+. **Plan §4.1 is correct**; Q3's framing as "cap-popup mount is independent" muddles the analysis. The cap popup is the dApp's request popup that *already closed* by the time we get to `openPopup`. The 30s waits in this test are on the WALLET popup, opened separately.

**Fix:** rewrite Q3 to clarify the wait is on the wallet popup (post-`approveExecute`), not a cap popup. Otherwise reviewers may waste time on a non-existent concern.

---

## On the questions §11 asks

(a) **Phase ordering**: see Finding #4 — swap recommended.

(b) **Phase 4.4 risk / fixture migration upfront**: see Finding #2. Plan's bet is defensible but the acceptance gate is too coarse to detect failure. Make 4.4 publish a metric so the "build the fixture in 4.4b" decision rests on data, not on whether 3 CI runs happened to land on slow runners.

(c) **§4.6 cleanup completeness**: see Finding #5. Three additional references the plan missed (one is the e2e/README.md repro line, two are e2e-stabilization plan + lessons docs).

(d) **Acceptance gate "3 consecutive 6/6 green"**: right strictness for the un-quarantine bits, slightly miscalibrated for fixture-migration bits. See Finding #6 for the diagnostic add.

(e) **Q1–Q4 resolution timing**:
- Q1 — resolve BEFORE merge (5 minutes of source-reading; Finding #3).
- Q2 — empirical, defensible as "first CI run resolves it" (the bet is the H-OP-3 mitigation; the data is the metric, not the green light).
- Q3 — rewrite NOW (the framing is wrong; Finding #8).
- Q4 — already non-blocking, defer to lessons doc.

(f) **What might have been missed**:

- The vitest `retry: 2` config (`vitest.e2e.network.config.ts:35`) makes the green/red signal lossy — every test gets 3 attempts. The acceptance gate doesn't distinguish "passed first try" from "passed after 2 retries." Consider gating on **zero retries used on Phase 4.4** specifically as a stricter signal for the cap-popup class.
- The `dappConnectedExtension` is file-scoped — sharing browser state across tests in the same file. This means once `multi-account-from` lands a stable test, IT'S the only test in `multi-account-from.test.ts`, so the file-scope is functionally per-test anyway. **No actual risk** but worth noting in the plan so readers don't get confused (related to Finding #1).
- The accelerator-server-ci plan §11 (Measurement) flagged "wallet stage timing for un-quarantine target tests" as a follow-up PR. The current plan doesn't reference this, but the `[tx-sendTx-default] waitForPgResult settled in Xms` console.log in `tx-sendTx-default.test.ts:102` is the same idea on a smaller scale. Verify that line stays through Phase 4.2 — the plan does say "Keep the diagnostic `console.log`" but uses the past-tense PR #66 framing; reaffirm it's load-bearing for Phase 11's eventual stage instrumentation.
- The `expected_sha256` in `_network-e2e.yml:135` (`d701837...`) is now load-bearing for both the parent PR AND this PR. If this PR touches the network workflow at all and CI sees a SHA mismatch, the gate fails for unrelated-looking reasons. **Not a real concern** because §4.6 only removes env, doesn't touch the install action, but worth flagging that any conflict-resolution against `dev` post-PR-67 needs to preserve the SHA literally.

---

## Disagreements with the plan as written

1. The phase order (Finding #4) — I'd reorder.
2. The fixture-migration as a follow-up rather than upfront (Finding #2) — defensible if metrics gate the decision, indefensible if it's just "we hope it works."
3. Q1 as an open question (Finding #3) — should be resolved by source-reading, not by CI gate.
4. The framing of Q3 (Finding #8) — wait classes are different than described.

## Where the plan is right that I want to underline

- Scope (5 items, no SDK changes, no production code) is well-bounded.
- Splitting into 6 commits within one PR for revertable bisect — good.
- Rejected alternatives (§10) — sound. "Convert to xfail" rejection is particularly important; xfail would hide the un-quarantine signal that's the entire point.
- The blast-radius reasoning behind 1-PR over 5-PRs is right; per-PR overhead for nearly identical diffs would be wasteful and would mask cross-test interactions.
- Security section is appropriately scoped — limited surface, real threats called out (re-quarantine attack, fixture-migration weakening coverage). Mitigations are reasonable.

---

## What to do before opening the PR

1. Fix Finding #1 — correct the §4.4 prose about which fixture and the multi-account fallback shape.
2. Decide on Finding #4 — reorder phases or write a paragraph defending the original order.
3. Resolve Q1 by source-reading and flip its status (Finding #3).
4. Rewrite Q3 to clarify wait classes (Finding #8).
5. Add the §4.6 file list additions (Finding #5).
6. Add the diagnostic capture for fixture-setup duration (Finding #6).
7. Decide whether to make Phase 4.4 metric-gated (Finding #2). At minimum, document the metric to capture even if it doesn't gate merge.
