# Audit (independent, opus) — `journal-stage-restructure/plan.md`

**Verdict:** `approve-with-fixes`

Plan is structurally sound and well-grounded in actual code. Vue mechanism is exactly the right idiom — there is precedent (`data-tx-status`) one line away from where the new attribute lands. Phase ordering is sensible, blast radius is honest, rollback path is real. Two findings are blocking; the rest are tightening.

The two blockers:

1. **Coverage-gap framing is materially wrong.** `fee-methods.test.ts` does NOT assert on-chain mining. It asserts a "Transaction submitted" toast. Fix the framing OR add a real mining check somewhere.
2. **The component test stub for `TransactionCardLayout` (in `TransactionAwaitingCard.test.ts:10-23`) will silently swallow the new `data-stage` attribute** unless the stub is updated too. The plan's Phase A test cases will pass against the stub regardless of whether the real layout binds the attribute. A test passing against a stub that doesn't model the attribute under test is no test.

Findings, numbered. file:line refs throughout.

---

## 1. Factual accuracy — VERIFIED with one correction + one omission

**Correct facts (spot-checked against repo HEAD on `feat/accelerator-server-ci`):**

- FSM doc-comment exists at `packages/extension/src/wallet/services/execution/service.ts:387` (the comment-block that names the stages). VERIFIED.
- `markJournal` call sites VERIFIED literally line-for-line:
  - `service.ts:470` → `{ stage: "simulating" }` VERIFIED
  - `service.ts:512` → `{ stage: "proving", enteredProveAt: Date.now() }` VERIFIED
  - `service.ts:519` → `{ stage: "submitting", txHash: ... }` VERIFIED
  - `service.ts:560` → `{ stage: "succeeded", txHash }` VERIFIED
  - `service.ts:567` → `{ stage: "failed" }` VERIFIED
- `:data-testid="testId"` lives at `packages/extension/src/components/composite/activity/TransactionCardLayout.vue:92`. VERIFIED.
- `stage: { type: String, default: null }` is at `packages/extension/src/components/composite/activity/TransactionAwaitingCard.vue:49`. VERIFIED, currently consumed only by the cancel-button hide rule at `:76` (`v-if="cancellable && jobId && stage !== 'submitting'"`).
- E2E precedent at `packages/extension/tests/e2e/network/cancel-mid-prove.test.ts:111` and `concurrent-sendtx.test.ts:138` uses `tx-awaiting-card` selector stage-agnostically. VERIFIED.

**Correction — the FSM is bigger than the plan claims.** Plan §3 says the FSM is `pending → simulating → proving → submitting → succeeded | failed | cancelled`. The authoritative type at `packages/wallet-core/src/jobs/types.ts:27` is:

```ts
export type JobStage = "queued" | "pending" | "simulating" | "proving" | "submitting" | "succeeded" | "failed" | "cancelled"
```

`"queued"` is real (see `concurrent-sendtx.test.ts:158` which asserts `stages.toContain("queued")`). The Phase B `JournalStage` type union MUST include all 8 stages, not just 7. Otherwise the helper rejects a perfectly valid wait target on the per-session FIFO path.

**Omission — there is already an established `data-tx-*` pattern.** The plan would be stronger if §3 noted that `TransactionCardLayout.vue:93-96` *already* renders `data-tx-amount-display`, `data-tx-transfer-type`, `data-tx-status`, `data-tx-hash` via the *exact* `:data-X="prop"` pattern the plan proposes for `data-stage`. The `TransactionCardLayout.test.ts:79-89` cases at lines 68-90 demonstrate that Vue 3.x already auto-omits the attribute when the prop is `undefined`. This precedent eliminates Q1 entirely — there is no `$attrs`/`inheritAttrs` quirk to discover, the pattern is in production.

---

## 2. Phase A Vue mechanism — CORRECT, with caveat on prop default

`:data-stage="stage"` on the `<Flex>` root of `TransactionCardLayout.vue` is the right Vue 3.x idiom. No `inheritAttrs: false` handling needed. Vue 3 auto-omits attribute bindings whose value is `null` or `undefined` from the rendered DOM (documented in the file itself at `TransactionCardLayout.vue:42`: "Vue omits `null`/`undefined` data-attribute bindings"). The `TransactionCardLayout.test.ts:83-89` case verifies this behavior empirically for the sibling `data-tx-*` props.

**Caveat — prop default `null` vs `undefined`.** The other `tx*` props in `TransactionCardLayout.vue` default to `undefined` (lines 50-53: `default: undefined`). The plan should mirror that — `stage: { type: String, default: undefined }` rather than `default: null`. Both result in attribute omission, but staying consistent with the file's existing convention is the cheaper review.

For the `TransactionAwaitingCard.vue` side, the `stage` prop there already defaults to `null` (line 49). That's fine — that prop predates the `tx-*` convention. Just don't blindly copy `null` to the new `TransactionCardLayout` prop; use `undefined`.

---

## 3. Phase A test cases — BLOCKER: stub silently swallows the attribute

The proposed Phase A test cases (plan §4.A) live in `TransactionAwaitingCard.test.ts`, which stubs `TransactionCardLayout` with a hand-written template (`TransactionAwaitingCard.test.ts:10-23`):

```ts
TransactionCardLayout: {
  template: `
    <div :data-testid="testId">
      <span class="title">{{ title }}</span>
      ...
    </div>
  `,
  props: ["title", "icon", "amount", "amountSymbol", "testId"],
},
```

This stub does **not** declare a `stage` prop and does **not** render `:data-stage`. If the Phase A unit tests call `mountCard({ stage: "proving" })` and assert `data-stage="proving"` on a `[data-testid="tx-awaiting-card"]` root, the test will fail — not because the binding is wrong, but because the stub never propagated the prop.

Worse: if the plan author works around the failure by adding `stage` to the stub's props list AND rendering `:data-stage="stage"` in the stub template, the test then validates the **stub** rather than the real `TransactionCardLayout`. The unit test would still pass even if `TransactionAwaitingCard.vue` failed to pass `stage` through to the layout (e.g. typo in `:stage="stage"`).

**Fix:** add the Phase A cases to **both** test files:

1. `TransactionCardLayout.test.ts` — mirror the existing `data-tx-status` cases (lines 68-98) for `data-stage`. This validates the layout's binding directly without stubbing it away.
2. `TransactionAwaitingCard.test.ts` — extend the `TransactionCardLayout` stub at lines 10-23 to include `stage` in its props array AND render `:data-stage="stage"` in its template. Then add cases that verify `TransactionAwaitingCard` forwards its incoming `stage` prop to the layout.

This split mirrors the existing testing strategy: the layout owns the binding logic, the awaiting-card owns the pass-through.

---

## 4. Phase C assertion stage — `"proving"` is correct, but verify Q3 race honestly

The plan's choice of `"proving"` over `"simulating"` is defensible AND is the right call. Reasoning:

- `"simulating"` fires before `buildAndEstimateTxRequest` (`service.ts:470`). Simulate runs real `simulateTx` calls in the FPC strategies — multiple seconds on a cold PXE. Asserting on `"simulating"` validates that the wallet *received* the dApp's intent but not that it processed the inputs at all. Weak.
- `"proving"` fires AFTER `buildAndEstimateTxRequest` completes (`service.ts:512`). Entering `proving` means: (a) inputs parsed, (b) account contract found, (c) fee strategy resolved, (d) simulate succeeded, (e) `TxExecutionRequest` built. That's the actual interesting work for popup-shape tests.
- `"submitting"` requires the prove to COMPLETE — which is the WASM kernel-prove tail we're trying to escape. Don't.

**HOWEVER**, the Q3 race concern is real and the plan dismisses it too quickly. Here's the failure mode:

The wallet's journal subscription pushes new ops to RecentActivityView, which renders a `TransactionAwaitingCard` per op. There is a finite delay between (a) `markJournal({ stage: "proving" })` writing to storage, (b) the subscription firing, (c) Vue diffing the render. On a slow CI runner, the *entry* into `proving` is fast; the dApp's sendTx promise resolves much later. But the **time from `proving` entry to the test seeing `data-stage="proving"` in the DOM** depends on:

1. `chrome.storage.local` write completing (instant)
2. Storage event firing in popup window (cross-process; not instant on CPU-pressured CI)
3. journal subscription handler running, deduping, updating the Pinia store
4. Vue reactivity tick, RecentActivityView re-render
5. DOM commit

Empirically this should be sub-second, but `concurrent-sendtx.test.ts:138` uses a 10s budget specifically to absorb this lag under load. The plan's 30s budget is plenty, but the plan should:

- Land Phase B with the 30s default already in place (which it does)
- Add a single CI run where the test asserts on `"proving"` and ALSO logs the elapsed time from `approveExecute` → selector match. If the median is <2s, drop the budget. If 5+ seconds, document why and leave 30s.

Also: **the `proving` stage on `cancel-mid-prove.test.ts:111` is observable today**. The test already passes (it was un-quarantined in commit `bd3479b`). That's the strongest evidence available that the propagation works.

**Minor — `enteredProveAt`.** `service.ts:512` emits `{ stage: "proving", enteredProveAt: Date.now() }`. The new helper waits on the *stage*, ignoring `enteredProveAt`. That's correct — `enteredProveAt` is the prove-deadline-tracking field for the GC, not a stage substate. Just noting that the helper doesn't need to read it.

---

## 5. Phase D opportunistic scope — narrowed list

I read each candidate. Verdict per file:

| Test | File | Verdict | Reason |
|---|---|---|---|
| `tx-sendTx-noFrom.test.ts` | network/ | **RESTRUCTURE** | Asserts on `execute-op-fee-set-badge` popup-shape (`:61-62`). The `waitForPgResult(..., 120_000)` at `:66` is the slow-path tail the plan targets. Same anti-pattern, same fix. |
| `tx-sendTx-feePayer.test.ts` | network/ | **RESTRUCTURE** | Asserts `execute-op-fee-set-badge` popup-shape (`:60-61`), then `waitForPgResult(..., 120_000)` at `:65`. Same anti-pattern. |
| `tx-sendTx-sponsoredFpc.test.ts` | network/ | **RESTRUCTURE with care** | Asserts on a NULL popup-shape — the only real assertion is `expect(["ok", "error"]).toContain(result.status)` at `:66` after `approveExecute({ feeMethod: "sponsored" })`. The test's whole purpose is to exercise the user-override fee path. Restructuring to wait on `"proving"` still validates: (a) trigger click landed, (b) sponsored option clicked, (c) wallet successfully entered prove with that fee method. That covers the test's intent. SAFE to restructure. |
| `tx-sendTx-reject.test.ts` | network/ | **DO NOT TOUCH** | This is the negative path. `rejectExecute(execPopup)` at `:56` aborts BEFORE any proving happens. `waitForPgResult(..., 30_000)` at `:58` asserts `result.status === "error"`. The wallet never enters `proving` — restructuring would assert on a stage that legitimately never arrives. The current 30s timeout is fast (reject is instant) and the test is not flaky. |

So Phase D's real list is 3 restructures (`noFrom`, `feePayer`, `sponsoredFpc`) and 1 explicit skip (`reject`). The plan should name `tx-sendTx-reject` explicitly in §4.D as "DO NOT restructure" rather than leaving it as a candidate — the next reader will otherwise re-evaluate it from scratch.

**Decision rule sharpening:** the plan's rule ("popup-shape target = restructure; end-to-end target = keep") is too soft. Tighten to: **"if the test's only post-approveExecute assertion is `expect([\"ok\", \"error\"]).toContain(result.status)`, restructure. If the test asserts on `result.status === \"error\"` (negative path) OR reads `resultJson`/`errorJson` body, keep."** This rule is mechanically checkable.

---

## 6. Coverage gap — BLOCKER: plan misrepresents `fee-methods.test.ts`

The plan claims `fee-methods.test.ts` "actually asserts on-chain mining via balance checks." It does not. The 5 tests in that file:

1. **"sponsored FPC is default fee method"** (`fee-methods.test.ts:12`) — opens SendPopup, asserts the fee-method trigger text contains "Sponsored". No mining.
2. **"transfer with sponsored FPC fee"** (`:41`) — calls `sendTransfer()` helper; the helper's terminal assertion is unknown but probably also a toast. No balance-delta check visible here.
3. **"transfer with public Fee Juice"** (`:61`) — terminates with `await waitForToast(page, "Transaction submitted", 60_000)` (`:111`). Toast appearance ≠ on-chain mining.
4. **"transfer with private Fee Juice"** (`:124`) — terminates with `await waitForToast(page, "Transaction submitted", 60_000)` (`:174`). Toast appearance ≠ on-chain mining.
5. **"gas balance card shows non-zero FeeJuice"** (`:185`) — asserts `gas-balance-public` text contains "FJ" and is not "0 FJ". This is the PRE-EXISTING balance from the fixture (`feeJuiceImportedExtension` pre-funds the account on-chain), NOT a delta after the test's actions. Even mining a tx in this test wouldn't be observed by this assertion.

The "Transaction submitted" toast (`waitForToast`) fires when the wallet submits the tx to the node, NOT when the tx mines. It corresponds roughly to FSM `submitting → succeeded`, which on most paths means the node accepted the bundle, NOT that a block was produced and the state-tree was updated.

**Fix options:**

- **Option A — rewrite the plan's framing**: in §2 strike "carries the e2e 'tx mines' coverage" and replace with "carries the e2e 'wallet submits with each fee method' coverage". Acknowledge openly that **no test in the network suite currently asserts a tx mined and produced state changes**. That's information the user should have when accepting the gap.
- **Option B — add a real mining check somewhere**: in a follow-up (NOT in this PR), add an assertion to one of the fee-methods tests that reads the recipient's balance AFTER the transfer and verifies the delta. This is not in scope for the user's locked decision but is the honest coverage closure.
- **Option C — minimum honest claim**: in §2, replace the coverage-gap row with: *"`fee-methods.test.ts` runs the full submit-to-node path for sponsored / public-FJ / private-FJ fee methods. No test in this suite asserts on-chain mining (balance delta). Accepted."*

This is the single most important fix in the audit. The user's "accept the gap" decision was made with the wrong understanding of what fee-methods actually covers.

---

## 7. Security & adversarial — adequate, with one concrete tightening

The plan's §7 is honest about the assertion-strength regression risk and identifies the right defenses (visible diff, plan reasoning). The "future PR weakens `proving` → `pending`" attack is real and the plan's stated mitigation (reviewer reads diff) is the practical answer — no realistic lint can distinguish a deliberate weakening from a legitimate test of an earlier stage.

**One concrete tightening** the plan doesn't propose: **lint the helper call sites for stage hardcoding**. Add a small unit test (NOT a lint rule, which would need more infrastructure) at `packages/extension/tests/e2e/fixtures/popups.test.ts` (or similar) that uses a regex over the test files:

```ts
test("waitForJournalStage calls in network/ assert on 'proving' or stronger", () => {
  // Grep all *.test.ts under packages/extension/tests/e2e/network/
  // For each `waitForJournalStage(...)` call, parse the stage argument
  // Assert: stage ∈ {"proving", "submitting", "succeeded"}, NOT {"pending", "queued", "simulating"}
  // Allow `// stage-weakening-ok: <reason>` escape hatch
})
```

This is a 30-LOC test that codifies the "no silent weakening" rule. A future PR that weakens to `"pending"` either fails this test OR commits the escape-hatch comment (which is reviewable).

**Other minor adversarial vectors not in the plan but worth noting:**

- The new `data-stage` attribute appears in the production DOM. A malicious dApp could read it via `document.querySelector` from a content-script-injected iframe (none exists today, but the surface increases). The stage value reveals timing information about the wallet's pipeline — a side-channel for inferring whether a user is mid-proving. **Low severity** because the timing is already visible via the spinner UI and the wallet doesn't render the popup over any cross-origin context. Worth one line in §7 acknowledging.
- The attribute lives on the in-flight card only, never on the settled `TransactionCard`. Confirmed by reading both files. Good.

---

## 8. Phase E cleanup targets — VERIFIED present

- `.github/workflows/_network-e2e.yml:97` — `NULO_E2E_SKIP_DEFERRED_SLOW: "1"` present. ✓
- `packages/extension/scripts/e2e/docker-ci-like.sh:121` — `export NULO_E2E_SKIP_DEFERRED_SLOW=1` present. ✓
- `packages/extension/tests/e2e/README.md:117` — quarantine paragraph present. ✓

All three cleanup targets exist on the current branch (they were removed in commit `2c59c1e` then re-added in revert `12eb681`).

Plan's `grep -rn "NULO_E2E_SKIP_DEFERRED_SLOW\|skipDeferredSlow"` post-cleanup sanity check is the right discipline.

---

## 9. RecentActivityView — `stage` already wired, no production change needed

`packages/extension/src/popup/components/modules/general/RecentActivityView.vue:626` and `:677` already pass `:stage="op.progress?.stage ?? null"` to the in-flight `TransactionAwaitingCard`. So the production wiring chain (journal → store → `RecentActivityView` → `TransactionAwaitingCard` → `TransactionCardLayout`) is already complete from the `stage` source to two layers above where the plan adds the binding.

**But — three orphan-fallback `TransactionAwaitingCard` renders DO NOT pass `:stage`**:

- `:633-641` (orphan executingTask)
- `:642` (token-awaiting fallback)
- `:680-688` (orphan, mirror)
- `:689` (account-awaiting fallback)

For these, `stage` is `null` and `data-stage` will be absent. That's fine for the journal-driven tests (they target the journal-rendered card, not the orphan fallback), but the unit test in Phase A should explicitly cover "stage absent when prop is null" — the plan §4.A item #2 covers this. ✓

---

## 10. Helper placement — `popups.ts` is wrong location

The plan suggests `packages/extension/tests/e2e/fixtures/popups.ts` for the helper. Reading that file (top of the file: "Helpers for driving the extension's approval popup windows from e2e tests"), it owns the *approval window* helpers (`approveExecute`, `approveCapabilities`, `rejectExecute`, etc.) — NOT general wallet-popup helpers.

The journal-stage helper drives the **wallet's own popup** (RecentActivityView), not an approval window. Better location:

- `packages/extension/tests/e2e/fixtures/extension.ts` — already exports `openPopup` (the wallet popup opener); the new helper is conceptually a sibling.
- OR a new file `packages/extension/tests/e2e/fixtures/journal.ts` — single-responsibility module for journal-stage e2e helpers. Cheapest to maintain. Future helpers (`readJournalStages`, `assertJournalTerminal`) would land here.

This is bikeshed but the plan says "verify during implementation" so flagging.

---

## 11. Cross-cutting — risk items + small polish

**Risk items:**

- **Vitest `retry: 1` on multicall test** (`tx-sendTx-multicall.test.ts:39`). The plan's §6 acceptance criterion says "Zero retries used on the 3 restructured tests across 3 runs." Multicall currently has `retry: 1` per-test. After restructure, the plan should DROP that to `retry: 0` (or omit) to make the strict-signal criterion actually enforceable.
- **The 240s test timeout in `tx-sendTx-default.test.ts:33`** is currently for the slow path. After restructure, drop to 60s as plan says — but DON'T drop it to less than 60s. Popup-open latency on CI cold-start is observably 15-30s (see `popups.ts:24` comment about the "15s cliff"). 30s for the helper + 30s headroom = 60s is right.
- **Phase F (planning archive) is the easiest place to introduce stale absolute paths** per the CLAUDE.md rule. When appending resolution notes, use repo-relative paths.

**Small polish:**

- Plan §11 listing audit questions duplicates §3-7 — not a defect, just verbose. Future plans can drop the trailing "asks" section when the audit transcript itself answers them.
- §10 "Rejected alternatives" includes "Wait for accelerator-server upstream to cover more proof methods." Correct rejection. Worth adding: even when accelerator-server DOES cover more methods, the restructured tests still work unchanged (they assert on stage transitions, not the prove mechanism). The restructure is a permanent improvement, not a workaround.

---

## Summary of required fixes

| Severity | Fix |
|---|---|
| **Blocker** | Phase A unit tests: extend the `TransactionCardLayout` stub in `TransactionAwaitingCard.test.ts:10-23` AND add direct cases to `TransactionCardLayout.test.ts` mirroring the existing `data-tx-status` cases. |
| **Blocker** | §2 coverage-gap row: rewrite the framing — `fee-methods.test.ts` does NOT assert on-chain mining; it asserts a "Transaction submitted" toast. |
| **High** | §3 `JournalStage` type: include all 8 stages (`queued`, `pending`, `simulating`, `proving`, `submitting`, `succeeded`, `failed`, `cancelled`), not just 7. |
| **High** | §4.D explicit verdicts: `tx-sendTx-reject` → DO NOT restructure. Tighten the decision rule. |
| Medium | §4.A prop default: use `default: undefined` not `default: null` for the new layout prop, mirroring existing `tx-*` props. |
| Medium | §7 add the "stage-not-weaker-than-proving" lint-via-test mechanism. |
| Low | Helper file location — `extension.ts` or new `journal.ts`, not `popups.ts`. |
| Low | Drop `retry: 1` on multicall after restructure so the §6 "zero retries" gate has teeth. |

Plan is approve-with-fixes. None of the fixes are architectural — they tighten honesty, broaden a type, and prevent a silent-stub failure mode. The structural decision (journal-stage assertion instead of dApp-promise wait) is the right call and has demonstrated precedent in `cancel-mid-prove.test.ts`.
