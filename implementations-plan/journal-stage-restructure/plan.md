# Restructure to journal-stage assertions

**Verdict (1 line):** 1 PR, 6 phases (A–F), ~6 hours implementation + 1–2 CI iterations. Follow-up to PR #67 (`feat/accelerator-server-ci`) — un-quarantines tx-sendTx-default, multi-account-from, tx-sendTx-multicall by replacing the "wait on dApp's full sendTx promise" assertion (slow because of WASM kernel-prove tail) with "wait for wallet's journal stage to advance to `proving`" (fast because we stop at pipeline entry, not completion).

**Audit cycle:** [`audit-codex.md`](./audit-codex.md) + [`audit-opus.md`](./audit-opus.md) — both `approve-with-fixes`. Convergent findings on (a) coverage gap was framed wrong (BLOCKER), (b) Phase A tests must extend `TransactionCardLayout.test.ts` not just `TransactionAwaitingCard.test.ts`, (c) FSM has 8 stages including `queued`, (d) Phase D must exclude `tx-sendTx-reject`. Codex additionally caught the JobStage type reuse + retry/gate conflict + suggested a focused helper. All applied. Details in [§12](#12-audit-response-log).

## 1. Goal

Replace the slow-path assertion pattern in popup-shape e2e tests with a fast-path assertion against the wallet's existing journal FSM stage transitions (`pending → queued → simulating → proving → submitting → succeeded`). The wallet already emits these stages via `markJournal()` in `execution/service.ts`; we expose the current stage as a `data-stage` attribute on the existing `tx-awaiting-card` UI component so tests can assert on it.

The structural payoff: popup-shape tests stop being gated by the WASM kernel-prove tail (which `accelerator-server` 1.0.1 doesn't cover) on slow CI runners. We assert "wallet entered the prove stage" instead of "wallet completed prove + submitted to node" — a narrowly weaker but well-bounded coverage trade-off. See [§7](#7-coverage-trade-off-explicit) for the honest accounting.

## 2. Locked-in scoping decisions

| | |
|---|---|
| Tests to restructure | The 3 currently-quarantined (`tx-sendTx-default`, `multi-account-from`, `tx-sendTx-multicall` both `#32` + `#33`) + opportunistic sweep: `tx-sendTx-noFrom`, `tx-sendTx-feePayer`, `tx-sendTx-sponsoredFpc` qualify. **`tx-sendTx-reject` excluded** — negative path, rejects before approval, no prove tail. |
| Coverage gap | **Accepted with corrected framing.** What we lose: "dApp-initiated sendTx path completes post-simulate (kernel proofs + chonk + submit)." On-chain mining is covered by `transfers.test.ts` via `waitForTxConfirmation()` (wallet-UI-driven send path, same prove stack). See [§7](#7-coverage-trade-off-explicit). |
| Stage exposure mechanism | `data-stage="{stage}"` attribute on the existing `tx-awaiting-card` root element (rendered by `Flex.vue:75`). Small Vue prop pass-through following the existing `data-tx-status` precedent at `TransactionCardLayout.vue:93-96`. |
| Helper signature | **Focused, single-purpose**: `waitForSendTxProvingStage(walletPopup)`. Not a generic stringly helper — codex's defensive suggestion. Future tests that want a different stage must add a new helper, visible in diff. |
| Stage choice | `"proving"`. Confirms wallet successfully simulated + entered the prove stage. Also the longest-lived stage under the current failure mode (long window for the selector to land cleanly). |
| Type union | Import `JobStage` from `packages/wallet-core/src/jobs/types.ts:27` — don't duplicate. The FSM has 8 stages including `"queued"`. |
| PR strategy | Single PR off `dev`. Wallet UI change is contained (~5 LOC) so blast radius is small. |

## 3. Recon facts (verified by both audits)

| | |
|---|---|
| FSM stages | `pending → queued → simulating → proving → submitting → succeeded \| failed \| cancelled` (8 stages). Documented at `service.ts:387`; canonical type at `packages/wallet-core/src/jobs/types.ts:27` (`JobStage`). |
| markJournal call sites | `service.ts:470` (simulating), `:512` (proving), `:519` (submitting), `:560` (succeeded), `:567` (failed). |
| Current testid binding | `tx-awaiting-card` rendered by `TransactionAwaitingCard.vue` → `TransactionCardLayout.vue:92` (`:data-testid="testId"` on the root `Flex` component). |
| `stage` already a prop | `TransactionAwaitingCard.vue:49` accepts `stage: String`. Currently consumed only by the cancel-button hide rule (`stage !== "submitting"`). We pass it through to `TransactionCardLayout`. |
| Existing `data-*` precedent | `TransactionCardLayout.vue:93-96` already binds `data-tx-amount-display`, `data-tx-transfer-type`, `data-tx-status`, `data-tx-hash` on the root via explicit props. `:data-stage="stage"` follows the exact same pattern. |
| Component tests | `TransactionCardLayout.test.ts` exists with `data-tx-status` test cases at lines 63 + 83 (mirror for `data-stage`). `TransactionAwaitingCard.test.ts:10` stubs the layout — won't catch a broken root binding alone. |
| Vue 3 attribute behavior | Vue 3 auto-omits `null`/`undefined` data attributes (validated empirically at `TransactionCardLayout.test.ts:83`). No `inheritAttrs: false` needed; the explicit-prop pattern is the local idiom. |
| Popup UI usage | `RecentActivityView.vue:626` + `:677` already pass `op.progress?.stage` straight through to `TransactionAwaitingCard`. No change needed in the popup wiring. |
| E2E precedent | `cancel-mid-prove.test.ts:111`, `concurrent-sendtx.test.ts:138` already use `tx-awaiting-card` selector (stage-agnostic). Restructure adds stage-specific variants. |
| Playground send semantics | All `sendTx-*` playground buttons use `wait: "NO_WAIT"` (`packages/playground/src/sections/transactions.ts:77`). So even today's tests don't assert on-chain mining — only "wallet's pipeline completed enough to settle the promise." See [§7](#7-coverage-trade-off-explicit) for what this means for the gap. |
| On-chain mining coverage | `transfers.test.ts:61, 77, 95, 111` use `waitForTxConfirmation()` (`helpers.ts:678`) via the wallet's UI-driven send flow. That's where end-to-end mining is actually asserted. |

## 4. Phase-by-phase implementation

Order is risk-incremental: UI change first (smallest blast, easiest to validate) → assertion helpers → tests → un-quarantine + cleanup.

### Phase A — Expose `data-stage` on `tx-awaiting-card`

**Files:**
- `packages/extension/src/components/composite/activity/TransactionCardLayout.vue` — add `stage: String` prop; bind `:data-stage="stage"` on root next to existing `:data-testid="testId"` (line 92) + the existing `data-tx-*` bindings (lines 93–96).
- `packages/extension/src/components/composite/activity/TransactionAwaitingCard.vue` — pass the existing `stage` prop through: `<TransactionCardLayout ... :stage="stage" />`.
- `packages/extension/src/components/composite/activity/TransactionCardLayout.test.ts` — add 2 unit cases mirroring the existing `data-tx-status` pattern (lines 63 + 83):
  1. `data-stage` matches the stage prop (e.g. `"proving"` → root has `data-stage="proving"`).
  2. When `stage` is `null`/`undefined`, `data-stage` attribute is absent (Vue 3 omits it, per `TransactionCardLayout.test.ts:83` precedent).
- `packages/extension/src/components/composite/activity/TransactionAwaitingCard.test.ts` — add 1 integration case verifying the prop is wired through (since this file stubs the layout at line 10, the assertion is "the stub received the stage prop", not "the root DOM has the attribute"). Real binding contract is covered in `TransactionCardLayout.test.ts`.

**Why split the test responsibility**: codex + opus both flagged that putting all cases in `TransactionAwaitingCard.test.ts` alone would silently pass against a broken root-attribute binding because the file's stub at line 10 doesn't render `data-stage`. The contract belongs in `TransactionCardLayout.test.ts` where the real binding lives.

**Why this phase first**: the UI change is small + independently testable. If a reviewer (or codex) flags an issue, we know before touching tests.

**Risk**: Low. Single attribute add following an exactly-matching local precedent (`data-tx-status`). No behavior change.

### Phase B — Focused `waitForSendTxProvingStage` helper

**File**: `packages/extension/tests/e2e/fixtures/popups.ts` (or wherever the wallet-popup helpers live — verify during implementation).

Add a single-purpose helper:
```ts
/**
 * Wait for the wallet's journal-driven `tx-awaiting-card` to reach the
 * `"proving"` stage. The card is rendered by `TransactionAwaitingCard.vue`
 * and exposes the stage via `data-stage` (added in Phase A).
 *
 * Use this in popup-shape sendTx tests instead of waiting on the dApp's
 * full `sendTx` promise — the promise can take >300s on slow CI runners
 * (WASM kernel-prove tail not covered by accelerator-server 1.0.1).
 * The `"proving"` stage transition fires post-simulate, pre-prove-
 * completion, so it's fast (<30s) AND validates that the wallet
 * successfully built + simulated the tx the dApp requested.
 *
 * Intentionally NOT a generic `waitForJournalStage(walletPopup, stage)`
 * helper: codex audit defensive design. Future tests wanting a different
 * stage must add a new helper, which is visible in PR review (an
 * adversarial weakening to "pending" or "simulating" would require a
 * named function change, not just a string parameter swap).
 */
export async function waitForSendTxProvingStage(
  walletPopup: Page,
  options: { timeout?: number } = {},
): Promise<void> {
  const { timeout = 30_000 } = options
  await walletPopup.waitForSelector(
    `[data-testid="tx-awaiting-card"][data-stage="proving"]`,
    { timeout },
  )
}
```

No `JournalStage` type union introduced. The helper is `sendTx`-specific and the stage is fixed at `"proving"`. Other journal-stage assertions (if needed by other features in the future) can import the canonical `JobStage` from `packages/wallet-core/src/jobs/types.ts:27`.

**Why a focused helper, not a generic one**: codex's defensive design argument. A generic `waitForJournalStage(walletPopup, "proving")` allows a future adversarial PR to weaken the assertion via a single-string change (`"proving"` → `"pending"`). A focused `waitForSendTxProvingStage()` requires renaming the function, which is much louder in diff.

**Risk**: Low. Pure test infrastructure.

### Phase C — Restructure the 3 quarantined tests (the canaries)

| Test | Restructure |
|---|---|
| `tx-sendTx-default.test.ts` | Replace `waitForPgResult(page, "sendTx", seqTx, 180_000)` + `expect(["ok", "error"]).toContain(result.status)` (lines 76–84) with: open wallet popup; `await waitForSendTxProvingStage(walletPopup)`. Drop diagnostic `console.log`. Remove `skipDeferredSlow` gate. Budget can drop to ~60s. |
| `multi-account-from.test.ts` | Same pattern. The from-account assertion at lines 57–60 stays (popup-shape). Replace `waitForPgResult(... 120_000)` with `waitForSendTxProvingStage(walletPopup)`. Remove `skipDeferredSlow` gate. Budget can drop to ~90s. |
| `tx-sendTx-multicall.test.ts` | Same pattern for both `#32` (3 calls) + `#33` (7 calls chunked). Payload row count assertion at line 60 stays. Replace `waitForPgResult(... 180_000)` with `waitForSendTxProvingStage(walletPopup)`. Remove `skipDeferredSlow` gate. **Also drop `retry: 1` at line 39** (per audit gate consistency — see §6). Budget can drop to ~90s. |

**Why "proving" not "simulating"**: "proving" is one stage later — confirms the wallet successfully simulated + entered prove. Stronger signal than "simulating" for the same cost (both are fast UI transitions; the SLOW thing is the prove COMPLETING, which we don't wait for). If a test wanted even faster + weaker, "simulating" is one selector change away.

**Risk**: Medium. Restructured assertion is structurally weaker than the prior pattern (we no longer validate end-to-end). Compensated by `fee-methods.test.ts` carrying e2e coverage for transfer flows.

### Phase D — Opportunistic restructure (per-test verdict, audit-confirmed)

Both audits surveyed the 4 candidates I listed. Explicit verdicts:

| Test | Restructure? | Reason |
|---|---|---|
| `tx-sendTx-noFrom.test.ts:60` | ✅ Yes | Popup-shape first + `expect(["ok", "error"])` after approve. Same anti-pattern as the 3 quarantined. |
| `tx-sendTx-feePayer.test.ts:60` | ✅ Yes | Same pattern. |
| `tx-sendTx-sponsoredFpc.test.ts:61` | ✅ Yes | Same pattern. |
| `tx-sendTx-reject.test.ts:58` | ❌ **NO — do not restructure** | Negative path: test rejects in the execute popup at line 56 BEFORE approval. Wallet never enters `proving` stage. The `waitForPgResult(..., 30_000)` IS the assertion target. Restructuring would break the test's purpose. |

For the 3 yes-restructure tests: apply the same Phase C pattern (replace `waitForPgResult` with `waitForSendTxProvingStage`).

**Coverage NOT lost in Phase D**: these 3 tests currently pass cleanly on CI; they don't currently flake. The restructure is preventive (in case slow runner pool variability ever bites them) and consistency (one assertion pattern across the popup-shape sendTx family).

**Decision rule going forward**: same as Phase C — wait-for-dApp-promise is fine when the test's deliberate goal is "tx settled" (e.g. reject negative path, `transfers.test.ts` mining assertion, `fee-methods.test.ts` toast). For "popup shape" tests, use the stage helper.

**Risk**: Low. The 3 yes-tests share a literal code shape; restructure is mechanical. The 1 no-test is explicitly excluded.

### Phase E — Un-quarantine the 3 tests + workflow cleanup

**Files:**
- `packages/extension/tests/e2e/network/tx-sendTx-default.test.ts` — remove `skipDeferredSlow` constant + gate + comment block (already done in Phase C if I'm consistent, but list here so it's explicit).
- `packages/extension/tests/e2e/network/multi-account-from.test.ts` — same.
- `packages/extension/tests/e2e/network/tx-sendTx-multicall.test.ts` — same.
- `.github/workflows/_network-e2e.yml` — remove `NULO_E2E_SKIP_DEFERRED_SLOW: "1"` env + comment block.
- `packages/extension/scripts/e2e/docker-ci-like.sh` — remove `export NULO_E2E_SKIP_DEFERRED_SLOW=1`.
- `packages/extension/tests/e2e/README.md` — drop the "Quarantined tests" paragraph + repro example.

**Sanity check**: `grep -rn "NULO_E2E_SKIP_DEFERRED_SLOW\|skipDeferredSlow"` should return only historical audit-transcript matches (per the same discipline applied in the previous unquarantine work).

**Risk**: Low. Pure removal of dead infra after the assertion restructure makes it possible.

### Phase F — Planning archive: resolution notes

**Files:**
- `implementations-plan/network-followups/slow-tests-hypotheses.md` — append "Fully resolved" note pointing at this plan + the journal-stage restructure pattern.
- `implementations-plan/e2e-stabilization/plan.md` — same.
- `implementations-plan/e2e-stabilization/lessons/phase-4.md` — same; reaffirm the journal-stage redesign codex originally proposed was the right call.
- `implementations-plan/network-e2e-unquarantine/plan.md` — append note that the "partial resolution" graduated to "full resolution" via this PR.

**Risk**: None. Docs only.

## 5. File catalog

| File | Change | Phase | Why |
|---|---|---|---|
| `packages/extension/src/components/composite/activity/TransactionCardLayout.vue` | +1 prop, +1 attr binding | A | Expose `data-stage` on root |
| `packages/extension/src/components/composite/activity/TransactionAwaitingCard.vue` | Pass existing `stage` prop through | A | Wire to layout |
| `packages/extension/src/components/composite/activity/TransactionAwaitingCard.test.ts` | +2 cases | A | Unit-test the new attribute |
| `packages/extension/tests/e2e/fixtures/popups.ts` (or equivalent) | +~30 lines | B | New `waitForJournalStage` helper + `JournalStage` type |
| `packages/extension/tests/e2e/network/tx-sendTx-default.test.ts` | Restructure assertion; drop quarantine | C+E | The canary |
| `packages/extension/tests/e2e/network/multi-account-from.test.ts` | Restructure assertion; drop quarantine | C+E | Same pattern |
| `packages/extension/tests/e2e/network/tx-sendTx-multicall.test.ts` | Restructure assertion (both cases); drop quarantine | C+E | Same pattern |
| Other `tx-sendTx-*.test.ts` (per audit) | Restructure where applicable | D | Opportunistic |
| `.github/workflows/_network-e2e.yml` | Drop env var + comment | E | Cleanup |
| `packages/extension/scripts/e2e/docker-ci-like.sh` | Drop env export | E | Cleanup |
| `packages/extension/tests/e2e/README.md` | Drop quarantine paragraph | E | Cleanup |
| `implementations-plan/network-followups/slow-tests-hypotheses.md` | Append resolution note | F | Archive |
| `implementations-plan/e2e-stabilization/plan.md` | Append resolution note | F | Archive |
| `implementations-plan/e2e-stabilization/lessons/phase-4.md` | Append resolution note | F | Archive |
| `implementations-plan/network-e2e-unquarantine/plan.md` | Append resolution note | F | Archive |

**NOT modified:**
- Wallet runtime / business logic — purely UI prop pass-through + tests.
- `chain-runtime.ts`, accelerator config — untouched.
- `fee-methods.test.ts` — kept as the e2e coverage anchor.
- `cancel-mid-prove.test.ts` — already uses a stage-aware pattern (cancel button visibility is FSM-gated); no restructure needed.
- `concurrent-sendtx.test.ts` — uses `tx-awaiting-card` for in-flight op COUNTING, not for stage assertion. Different concern.

## 6. Test plan

| Layer | Test | What confirms |
|---|---|---|
| Component | `TransactionCardLayout.test.ts` +2 cases (real binding) | `data-stage` attribute lands on the root `Flex`; absent when null |
| Component | `TransactionAwaitingCard.test.ts` +1 case (integration: stub receives the prop) | The prop wiring through `TransactionAwaitingCard` works |
| Unit / lint | `bun run audit:vue` | typecheck + test + lint + build clean |
| Local e2e | `bun run e2e:agent tests/e2e/network/tx-sendTx-default.test.ts tests/e2e/network/multi-account-from.test.ts tests/e2e/network/tx-sendTx-multicall.test.ts tests/e2e/network/tx-sendTx-noFrom.test.ts tests/e2e/network/tx-sendTx-feePayer.test.ts tests/e2e/network/tx-sendTx-sponsoredFpc.test.ts` (one go) | All 6 restructured tests pass on WASM locally |
| Local e2e | Per-shard: `bun run e2e:agent --shard=N/5` for shards containing the touched tests | Cumulative-load signal |
| CI acceptance | Full 5-shard + heavy matrix, **3 consecutive 6/6 green runs** | Production-grade gate |
| CI acceptance | **Zero retries used on the 3 previously-quarantined tests** across all 3 runs | Stricter signal for the new pattern. Achievable because Phase C drops `retry: 1` on `tx-sendTx-multicall` (resolving the codex-flagged conflict between this gate and the file's prior retry policy). The other 2 (default, multi-account-from) don't have `retry`. |

## 7. Coverage trade-off (explicit)

The plan originally framed this as "fee-methods.test.ts carries e2e tx-mines coverage so the gap is acceptable." **Both audits independently flagged that framing as materially wrong**. Corrected analysis:

### What today's quarantined tests actually assert

Today's tests wait on the dApp's `wallet.sendTx()` promise to settle. But the playground's `sendTx` buttons use `wait: "NO_WAIT"` (`packages/playground/src/sections/transactions.ts:77`), so the promise settles **after submit, before mining**. Today's assertion is:

> "Wallet built tx + simulated + completed kernel proofs + completed chonk proof + broadcast to node."

NOT "tx mined on-chain." Today's tests never verified mining.

### What restructured tests assert

> "Wallet built tx + simulated + entered the prove stage."

### Narrow gap: "wallet's dApp-driven sendTx path completes post-simulate"

The narrow loss is specifically: did the wallet COMPLETE the kernel-prove chain + chonk + broadcast successfully (today: yes; restructured: not verified)?

### What covers this gap elsewhere

| What | Where |
|---|---|
| On-chain mining (end-to-end) | `transfers.test.ts:61, 77, 95, 111` via `waitForTxConfirmation()` in `helpers.ts:678`. Uses the wallet's UI-driven send flow (not the dApp's sendTx, but the SAME kernel-prove + chonk + submit stack). |
| `AcceleratorProver.createChonkProof` integration | PR #67 unit tests (`chain-runtime.test.ts`). |
| Wallet popup toast on submission | `fee-methods.test.ts:110, 174` (asserts "Transaction submitted" UI toast). |

So the narrow gap is "the *dApp-initiated* sendTx submit path's full pipeline completion." Not mining. Not kernel-prove correctness. Not chonk integration. Those are all covered elsewhere.

### Why this is still an acceptable trade-off

The wallet's full prove+submit pipeline correctness is exercised by `transfers.test.ts` end-to-end via the wallet's own UI flow. The dApp-driven path uses the same stack on the wallet side (the bg-script handler is shared); only the entry point (popup vs UI) differs. The restructured tests still verify the entry-point + popup-shape parts of the dApp path. The "completes" part is covered structurally by transfers.

If a future PR breaks the dApp path's pipeline specifically (not the wallet UI path), tests in this PR won't catch it. That's the real residual risk. Mitigation: PR review + the un-quarantined tests still run on the heavy job (so if they catastrophically broke we'd notice). Accepted per locked scoping.

## 8. Security & adversarial considerations

Limited surface — wallet UI prop add + test changes. Threat model:

- **Adversarial PR that quietly weakens an assertion**: a future PR could change `waitForJournalStage(walletPopup, "proving")` to `waitForJournalStage(walletPopup, "pending")` — silently weakening the test from "wallet processed and entered prove" to "wallet received the op." Mitigation: reviewer reads the diff (the stage string is visible inline). For the 3 currently-restructured tests, codify the choice of "proving" in the helper's JSDoc + plan §4.C reasoning. A more aggressive defense (e.g. requiring tests to assert at least `proving`) isn't worth the lint complexity.
- **Adversarial PR that re-introduces the dApp-promise assertion**: visible in diff as `waitForPgResult(...sendTx...)` reappearing. PR reviewers should treat any new `waitForPgResult` for `sendTx` in popup-shape tests as a flag.
- **Re-quarantine attack**: the same `skipDeferredSlow` re-introduction defense from the prior plans applies — visible in workflow YAML diff.
- **No new code paths in production**: the `data-stage` attribute is consumed only by tests. Production users don't read DOM data attributes.
- **No supply chain change**: no new deps.

The Vue component change is the only production-build delta. The new attribute lands on the rendered DOM but is byte-trivial and not security-relevant.

## 9. Open questions

| # | Question | Resolution plan |
|---|---|---|
| Q1 | Does `TransactionCardLayout.vue`'s root binding properly forward `data-stage` to the rendered DOM, or do we need `inheritAttrs: false` handling? | Phase A implementation — verify via component test. If `inheritAttrs` quirk surfaces, the test fails loudly. |
| Q2 | Does the wallet popup auto-open after the dApp's `approveExecute`, or do we need to drive `openPopup` in the restructured tests? | Phase C implementation — mirror what `cancel-mid-prove.test.ts:112` does (`openPopup(dappConnectedExtension)`). Established pattern. |
| Q3 | Are there race windows where the wallet emits `proving` BEFORE the `tx-awaiting-card` is mounted in the popup (e.g. journal event fires before DOM render)? | Phase B + C implementation — the existing `cancel-mid-prove.test.ts:111` `waitForSelector('tx-awaiting-card')` already handles this implicitly. Our 30s budget gives mount + journal-event-replay headroom. |
| Q4 | For the opportunistic audit (Phase D): which `tx-sendTx-*` tests qualify as popup-shape vs end-to-end? | Phase D — explicit per-test decision; document each in the PR description. |

## 10. Rollback path

Per-phase commits → per-phase revert. If the data-stage attribute somehow regresses production UI (it shouldn't — it's a no-op for users), Phase A's commit reverts cleanly. Test restructure reverts independently — a failed Phase C commit can be reverted while keeping Phase A's UI change (Phase A is strictly additive).

**Full rollback**: `git revert <merge-commit-sha>` restores everything including the quarantine gate. Other PRs that depend on the new helper would need rebasing, but at the time of merge there are none.

**Mid-implementation escape hatch**: if Phase C's first CI run reveals that "proving" is somehow unstable on slow runners (e.g. simulate takes >30s on CI even though it should be fast), drop to `"simulating"` as the assertion stage. One-line change per test.

## 11. Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Wait for the upstream accelerator-server to cover init/inner/reset/tail kernel proofs | Couples our timeline to upstream. Restructuring tests is a thing we can do now. Once upstream covers more endpoints, the restructured tests still work (they assert on stage transitions, not the prove mechanism). |
| Bump test budgets to 600s+ + bump `protocolTimeout` to 600s+ | Already tried in PR #67 — the WASM kernel-prove tail exceeds even those budgets on slow runners. Kicking the can. |
| Add `console.log` in `markJournal`, scrape wallet console from tests | More brittle (string parsing vs typed DOM); needs wallet behavior change in a more invasive way; the data-attribute approach is the documented Vue idiom for this kind of signal. |
| Per-stage testids (`tx-stage-simulating`, `tx-stage-proving`, etc.) | More testids; tests don't need attribute selectors. Same review cost. Slightly less elegant since stages are an FSM, not independent UI components. The `data-stage` attribute on a single card matches the existing pattern (one card, multiple states). |
| Restructure cancel-mid-prove too | Out of scope per user's locked scope. Its current pattern (wait for `tx-awaiting-cancel` button visibility, which is FSM-gated) is already a journal-aware assertion. |
| Add belt-and-suspenders slow-path opt-in tests gated by env var | User chose "accept the gap" — fee-methods.test.ts is enough e2e coverage. Adding optional slow tests is scope creep that nobody will run. |
| Spike-first | The plan is contained enough that the implementation IS the spike. Phase A is a single attribute add; if it doesn't work, the cost is small. |

## 12. Audit response log

Both audits returned `approve-with-fixes`. All findings folded into the plan above.

| Finding source | Severity | Status |
|---|---|---|
| Codex #1 + Opus #1: coverage framing materially wrong — fee-methods doesn't assert mining | **HIGH** | **APPLIED** — §7 fully rewritten with corrected analysis. User re-confirmed gap acceptance on the corrected framing. |
| Codex #3 + Opus #2: Phase A tests belong in `TransactionCardLayout.test.ts` (where the real binding lives), not solely in `TransactionAwaitingCard.test.ts` (which stubs the layout) | medium | **APPLIED** — §4 Phase A split test responsibility: 2 cases in TransactionCardLayout (the contract), 1 integration case in TransactionAwaitingCard (prop wiring). |
| Codex #4 + Opus #3: FSM has 8 stages including `"queued"`; helper should reuse `JobStage` from `packages/wallet-core/src/jobs/types.ts:27` not invent a new union | medium | **APPLIED** — §3 documents 8 stages. §4 Phase B no longer introduces a `JournalStage` union (the focused helper doesn't need one). Future generic uses import canonical `JobStage`. |
| Codex #2 + Opus #4 / Phase D: `tx-sendTx-reject` MUST stay (negative path, never enters `proving`) | medium | **APPLIED** — §4 Phase D has explicit per-test verdict table. `reject` marked "do not restructure." |
| Codex #5: acceptance gate ("zero retries") conflicts with `retry: 1` on `tx-sendTx-multicall.test.ts:39` | low | **APPLIED** — §4 Phase C drops the retry as part of the multicall restructure. §6 gate is consistent. |
| Codex #6 (recommended): tighten helper to `waitForSendTxProvingStage()` (focused, single-purpose) over generic `waitForJournalStage(stage)` | low (defensive design) | **APPLIED** — §4 Phase B rewritten. User explicitly approved this tightening. |
| Codex confirms Phase A Vue mechanism is correct; Opus empirically validates null-attr omission | confirm | **APPLIED** — §3 cites existing `data-tx-status` precedent + Vue 3 docs. |
| Codex + Opus confirm `"proving"` is the right stage choice | confirm | **APPLIED** — §2 + §4 Phase C explain reasoning. |

## 13. Specific asks for any future audit pass

Following implementation, the next codex pass should verify:

(a) The Phase A unit tests in `TransactionCardLayout.test.ts` actually catch a broken `:data-stage` binding (introduce a deliberate breakage temporarily to verify the test fails).

(b) The 6 restructured tests' wall-times on CI (should be well under their pre-quarantine 180s budgets — ideally <60s per test).

(c) The Phase F final `grep` for any missed `NULO_E2E_SKIP_DEFERRED_SLOW` / `skipDeferredSlow` references.

(d) Whether `tx-sendTx-reject` was indeed left untouched (verify by reading the file).
