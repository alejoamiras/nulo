# Extend public-static fast path to internal `batchedViewSimulation` — v2

Supersedes [plan.md](plan.md). Consolidates [audit-opus.md](audit-opus.md) + [audit-codex.md](audit-codex.md).

## Audit verdicts on v1

Both **needs-rework** with overlapping BLOCKERs:

| | Opus | Codex |
|---|---|---|
| Verdict | needs-rework | needs-rework |
| Indexing math | BLOCKER (B2) | BLOCKER (B2 — `NestedProcessReturnValues`, not `Fr[][]`) |
| Lock-sharing | BLOCKER (B1) | HIGH (H2) |
| Filter-vs-prefix safety | (missed) | BLOCKER (B1 — must be leading prefix) |
| Fallback orchestration | HIGH (H1 — masks contract bugs) | HIGH (H1 — inconsistent with allSettled) |
| Block-header race | HIGH (H2) | MEDIUM (M1) |
| Origin-equality after partition | HIGH (H3) | (missed) |
| `executeUtility` lock | HIGH (H4) | HIGH (H2) |
| `getNodeInfo` shared-fate | (missed) | HIGH (H4) |
| `MAX_ENQUEUED_CALLS_PER_CALL` | (silently accepted 16) | HIGH (H3 — in 4.2.0 it's 32) |
| Trust boundary breadth | MEDIUM (M4) | MEDIUM (M2 — also dApp-registered artifacts) |
| `hideMsgSender` flag | (missed) | MEDIUM (M3) |
| Kernel-skip wording | MEDIUM (M1) | (agrees with rewrite) |

Combined: 2 BLOCKERs, 5 HIGHs, 5 MEDIUMs, 3 NITs. All adopted below except where explicitly defended in the REJECT section.

---

## 1. Consolidated design (the real plan)

### 1a. The two BLOCKER fixes change the shape

**Fix B1 (codex)** — restrict optimization to leading prefix, not arbitrary filter:

- Today, balance-projector enqueues `balance_of_private` (UTILITY) THEN `balance_of_public` (PUBLIC+isStatic) per token (`balance-projector.ts:110-122`). After leading-prefix-only filtering, the prefix is empty — no PUBLIC+isStatic at index 0 — and the optimization never triggers.
- **Plan change**: rebuild the chunk enqueue as a **two-pass** loop: first pass over all balances enqueues every PUBLIC call; second pass enqueues every PRIVATE call. Result: chunk becomes `[pub_1, pub_2, …, pub_N, priv_1, priv_2, …, priv_N]` — the leading prefix is the full public-balance arm (up to 12 fast-eligible calls).
- **Per-token swap is NOT equivalent.** A naive in-loop swap produces `[pub_1, priv_1, pub_2, priv_2, …]`, where the leading prefix is just `[pub_1]` — 1 fast call out of 24. The two-pass loop is load-bearing for the optimization to actually deliver.
- This is also semantically more honest: the helper's contract is now identical to upstream's (`extractOptimizablePublicStaticCalls` — leading prefix of public-static).

**Fix B2 (both)** — unpack uses `NestedProcessReturnValues.values`, not raw `Fr[][]`:

```ts
// Existing slow-arm pattern (line 163) — model for fast arm:
const values = (call.type === FunctionType.PUBLIC ? publicReturn[j] : privateReturn[j]).values ?? []

// Fast arm: mirror the same shape.
const fastReturns: NestedProcessReturnValues[] = fastResults.flatMap(r => r.publicOutput?.publicReturnValues ?? [])
// ... for each fast tuple at fast-arm slot k:
const values = fastReturns[k]?.values ?? []
encoded[originalIndex] = values
```

Plus dual-indexing fix — partition produces two index spaces (fast: 0..N-1; slow: re-numbered publicCallIndex/privateCallIndex). Hoist `flatMap` out of the per-tuple loop.

### 1b. Updated 4-arm orchestration (corrects opus H4, codex H2)

```
1. Classify into utility[] + leadingPrefixFastCalls[] + slowTxCalls[]
   (Important: fast partition is LEADING PREFIX of PUBLIC+isStatic, not arbitrary filter.)

2. If leadingPrefixFastCalls.length > 0:
     a. await getBlockHeaderAnchor(pxe, node)  ← READ lock, must complete before utility writes queue
        If undefined → silent FULL fallback (drop fast arm, put all calls through slow path).
     b. Eagerly launch utility[] AFTER the anchor read returns.
     c. Promise.allSettled([
          simulateViaNode(node, leadingPrefixFastCalls, ..., blockHeader, ...),
          slowTxCalls.length > 0 ? buildSlowArm() : Promise.resolve(null)
        ])
     d. Branch on fast-arm settlement:
          - fulfilled: unpack fast results into encoded[]/decoded[]. If slow-arm also fulfilled, unpack it too.
          - rejected with SimulationError: propagate (real contract revert).
          - rejected with other Error: WARN-log with (chainId, contract, selector); discard slow-arm
            result; build a new payload from leadingPrefixFastCalls + slowTxCalls and run a full
            standard pxe.simulateTx. Counter incremented (test-pinned to NOT fire on happy path).
3. Else (no fast prefix): unchanged original 3-arm path.
4. Utility arm: await serially as today (note in JSDoc that this is sequential with slow arm due to
   shared withPxeWrite lock — corrects PR #56's misleading "in parallel" comment).
```

Anchor-before-utility ordering (codex H2) is load-bearing: if utility is queued first (writer), the anchor read waits behind it on `ReadWriteGuard`.

**Rerun invariant (codex Phase-5 medium)**: a full rerun on fast-arm generic-Error rejection **does NOT recreate or re-await utility promises**. Utility was launched exactly once before the arm dispatch; the original promise array stays intact and is awaited at the end. The rerun rebuilds only the tx payload (`leadingPrefixFastCalls ++ slow`) and re-invokes `pxe.simulateTx` against that combined payload. Pinned by a unit test that asserts: on fast-arm generic-Error path, utility promise creation count === 1 (not 2).

**SimulationError + utility caveat (codex Phase-5 medium)**: if the fast arm rejects with `SimulationError` and we propagate, launched utility promises are never awaited. This matches today's pre-PR behavior (`batched-view-simulation.ts:136` — any throw before the utility-await loop leaves them un-awaited). Not new, but documented in JSDoc to prevent future "fix" attempts that introduce different semantics.

### 1c. `node.getNodeInfo()` propagates (codex H4)

The existing `node.getNodeInfo()` call is shared-fate with the slow arm (`account.buildTxExecutionRequest` uses it transitively). Don't catch — let it propagate. Mirror `fast-path.ts:170`. The silent-fallback catch is narrowed to: `getBlockHeaderAnchor`, `completeFeeOptions`, and `simulateViaNode` non-SimulationError throws only.

### 1d. Realistic concurrency story (opus B1 + upstream SerialQueue finding)

The earlier "POSITIVE PXE lock-starvation reduction" claim was overstated. Two layers of serialization exist:

1. **Nulo's outer layer**: `withPxeRead` / `withPxeWrite` via `ReadWriteGuard` (`packages/aztec-runtime/src/pxe/service.ts:87` chainGuards).
2. **Upstream PXE's inner layer**: a single `SerialQueue` (`@aztec/pxe@4.2.0/src/pxe.ts:169, 246`) that EVERY call goes through (`executeUtility`, `simulateTx`, `getSyncedBlockHeader`, `proveTx`, ...). Upstream comment (`pxe.ts:1058-1060`): *"we disable concurrent executions since those might execute oracles which read and write to the PXE stores (e.g. to the capsules), and we need to prevent concurrent runs from interfering with one another."* Tracked upstream as Aztec issue #12636.

Implication: **any wallet-layer lock arrangement is moot for inter-method concurrency**. Even if we downgraded `executeUtility` to `withPxeRead`, upstream's SerialQueue would still serialize it with `simulateTx`. Don't try.

Corrected framing — the real concurrency win comes from **the fast arm bypassing PXE entirely** (it calls `node.simulatePublicCalls`):

| Batch shape | Fast arm | Slow arm | Net vs today |
|---|---|---|---|
| Pure PUBLIC+isStatic (e.g. gas-balance) | direct-to-node, **bypasses upstream PXE queue** | empty | **Big win** — no PXE queue position required at all |
| Public-static prefix + private/non-static tail | direct-to-node (TRUE parallel work) | still queues behind upstream SerialQueue for slow tail | **Small win** — fast arm overlaps with slow arm's queue-wait + work |
| No public-static prefix (e.g. balance-projector pre-reorder, or all-private chunks) | not triggered | unchanged | Neutral (zero overhead — early-return before any prep) |

The bundled balance-projector two-pass enqueue (1a above) is what unlocks the mixed-batch case for balance refresh.

**JSDoc requirement**: helper docstring must document the upstream SerialQueue so future contributors don't attempt the "downgrade executeUtility to withPxeRead" optimization (it's unsafe per upstream's own comment, AND moot per the queue). Reference: Aztec issue #12636.

### 1e. Honest block-header race documentation (opus H2, codex M1)

Drop the "same block" wording. Replace in helper JSDoc + plan §6:

> The fast arm pins to a `BlockHeader` snapshot via `getSyncedBlockHeader`. The slow arm has no `blockHeader` parameter; it uses PXE's internal synced state at the moment `pxe.simulateTx` runs, which may have advanced by 1+ blocks during the parallel window. For balance reads this race is benign and matches the existing inter-chunk skew (`balance-projector` already accepts different chunks observing different blocks). Pinned by a unit test asserting we DO NOT claim atomicity.

### 1f. `hideMsgSender` is silently ignored by fast arm (codex M3)

`simulateViaNode` builds `PublicCallRequest` without honoring `hideMsgSender` (`utils.ts:93`). The helper today preserves the flag for slow-arm calls (`batched-view-simulation.ts:235, 278`). After this PR, fast-eligible calls drop the flag.

For our two internal callers, `msg.sender` is not load-bearing for PUBLIC+isStatic balance reads (the static keyword forbids reading any per-caller state in a way that would matter). But the helper's contract changes:

- **New contract**: "for fast-eligible (PUBLIC+isStatic) calls, `hideSender` / `hideMsgSender` is ignored." Documented in JSDoc.
- **Runtime guard**: by the time partition runs, calls are already constructed `FunctionCall` instances (`batched-view-simulation.ts:230, 273`). Check `FunctionCall.hideMsgSender === true` (the constructor field, not the raw `CallAction.hideSender` or `EncodedCallAction.hideMsgSender` input fields — those were already collapsed into the FunctionCall during enqueue). If true on a PUBLIC+isStatic call, the partition breaks the prefix at that point. Conservative: never silently drop the caller's flag.
- Test pin: construct a FunctionCall with `hideMsgSender: true && type: PUBLIC && isStatic: true` → partition routes it to slow arm, fast arm receives prefix up to that point only.

### 1g. Trust boundary acknowledgement (codex M2, opus M4)

Threat model update: artifacts come from `contractResolver.resolveArtifacts`, which can include dApp-supplied artifacts registered via the `registerContract` path (`service.ts:1474` — accepts dApp artifact when class-id matches). A malicious dApp could register a contract whose ABI sets `isStatic: true` on a state-mutating Noir function. The fast arm would then execute that function via node-direct simulation, bypassing the entrypoint authz hop.

Impact: limited to balance display. The fast arm returns view values; it cannot produce a signed tx. User sees wrong balance on UI but no on-chain effect. Mitigation: explicit acknowledgement in §6; not gated on this PR.

### 1h. Kernel-skip wording correction (opus M1)

`simulateViaNode` does run the kernel — it constructs a synthetic `PrivateCircuitPublicInputs` with an empty private trace (`utils.ts:103-127`). What it skips is **real private execution + the wallet entrypoint hop**. Updated wording everywhere ("entrypoint-skip" not "kernel-skip").

### 1i. `MAX_ENQUEUED_CALLS_PER_CALL` correction (codex H3)

The bun-cache constants module that ships with `@aztec/wallet-sdk@4.2.0` is `@aztec/constants@4.2.0`, which exports `MAX_ENQUEUED_CALLS_PER_CALL = 32` (`constants.gen.ts:50`). My v1 fact-check read the wrong cached version (`@aztec/constants@1.2.1`). Conclusion unchanged: balance-projector's `BATCH_SIZE = 12` is comfortably under 32.

---

## 2. Updated file-by-file

### NEW

**`packages/extension/src/wallet/services/execution/helpers/block-header-anchor.ts`** (~25 lines)

```ts
/** PXE-synced header, falling back to node head, returning undefined on
 *  any failure. Callers treat undefined as "no anchor — fall back to
 *  standard path." */
export async function getBlockHeaderAnchor(pxe: IPXE, node: AztecNode): Promise<BlockHeader | undefined> {
  try {
    return await pxe.getSyncedBlockHeader()
  } catch {
    try {
      return (await node.getBlockHeader()) ?? undefined
    } catch {
      return undefined
    }
  }
}
```

Returns `undefined` (not throws) on double-failure — pins opus N1 ambiguity.

**`helpers/block-header-anchor.test.ts`** — 4 cases (PXE succeeds; PXE throws → node returns header; PXE throws + node returns null → undefined; PXE throws + node throws → undefined).

### MODIFIED

**`packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts`**

Sequence inside the helper (rough sketch — actual structure follows existing code style):

1. Existing: contract resolution + registration + ensureRegistered (unchanged).
2. Existing: classify into `txCalls` and `utility[]` queues — BUT defer launching utility until after step 4.
3. NEW: scan `txCalls` for a leading prefix of `FunctionCall` instances satisfying `fc.type === FunctionType.PUBLIC && fc.isStatic === true && fc.hideMsgSender !== true`. Partition into `leadingFast` (the prefix) + `slow` (the rest). Re-number publicCallIndex/privateCallIndex separately for slow only. (`FunctionCall` only carries `hideMsgSender` — the raw `CallAction.hideSender` / `EncodedCallAction.hideMsgSender` input fields were already collapsed during `enqueueCall` at `:230, 273`.)
4. NEW: if `leadingFast.length > 0`:
   - `await getBlockHeaderAnchor(pxe, node)` — if undefined → unset partition (everything goes slow).
5. Launch `utility[]` eagerly (after anchor read, before tx-arm dispatch).
6. NEW: `Promise.allSettled([fastArm, slowArm])` where:
   - `fastArm = leadingFast.length > 0 ? simulateViaNode(...) : Promise.resolve([])`
   - `slowArm = slow.length > 0 ? doStandardArm(slow) : Promise.resolve(null)`
7. Branch on fast-arm settlement (per §1b orchestration).
8. Unpack fast results: `fastReturns[k]?.values ?? []` per fast tuple (re-indexed against fastReturns).
9. Unpack slow results: existing pattern (lines 154-170), using re-numbered slow-arm slot indices.
10. Existing: await utility[] serially, decode each.

Helper JSDoc rewritten:
- 3-arm → 4-arm shape diagram
- Concurrency invariant: REMOVES the misleading "in parallel kernel-side" claim (executeUtility shares withPxeWrite + the upstream PXE `SerialQueue`). New phrasing: "Utility calls are launched eagerly so the JS-side `Promise` is created before the tx-arm await, but actual execution is serialized at two layers: Nulo's outer `withPxeWrite` and upstream PXE's `SerialQueue` (`@aztec/pxe@4.2.0/src/pxe.ts:328-336`). Tracked upstream as Aztec issue #12636. Do NOT downgrade the outer lock to `withPxeRead` — upstream's queue would serialize regardless AND utility calls *can* mutate PXE state per the upstream comment."
- Block-header race acknowledgement (per §1e).
- `hideMsgSender` contract change (per §1f).
- "Entrypoint-skip" not "kernel-skip" (per §1h).

**`packages/extension/src/wallet/services/token-balance/balance-projector.ts`**

Replace the per-token interleaved enqueue at `:100-122` with a **two-pass loop over `balances`**:

```ts
// Pass 1: enqueue every PUBLIC call across all balances.
for (let i = 0; i < balances.length; i++) {
  const token = await this.tokens.getTokenRaw(balances[i].token)
  if (token.balanceOfPublicFn) {
    const fn = BalanceOfPublicFn.new(token.balanceOfPublicFn.name, token.balanceOfPublicFn.impl)
    await this.enqueueCall(calls, fn, token, account, i, /*isPrivate*/ false)
  } else {
    perBalance[balances[i].id].publicBalance = "0"
  }
}
// Pass 2: enqueue every PRIVATE call across all balances.
for (let i = 0; i < balances.length; i++) {
  const token = await this.tokens.getTokenRaw(balances[i].token)
  if (token.balanceOfPrivateFn) {
    const fn = BalanceOfPrivateFn.new(token.balanceOfPrivateFn.name, token.balanceOfPrivateFn.impl)
    await this.enqueueCall(calls, fn, token, account, i, /*isPrivate*/ true)
  } else {
    perBalance[balances[i].id].privateBalance = "0"
  }
}
```

Result: chunk is `[pub_0, pub_1, …, pub_{N-1}, priv_0, priv_1, …, priv_{N-1}]`. Leading PUBLIC+isStatic prefix = full public arm, fast-path triggers cleanly.

Note: `perBalance` initialization (`:100-107`) needs to run before either pass — hoist that out into its own first loop. The `getTokenRaw` call gets executed twice per token; cache the lookups in a small `Map<balanceId, Token>` to avoid the duplicate fetch.

Test: balance-projector.test.ts — add an explicit ordering test that asserts the global enqueue order across a 3-token fixture (all PUBLIC enqueued before any PRIVATE), not just per-token.

**`packages/extension/src/wallet/services/execution/fast-path.ts`**

Refactor `:182-187` to call `getBlockHeaderAnchor(pxe, node)`. Behavior-equivalent.

### NEW tests

**`helpers/batched-view-simulation.test.ts`** — extend (current ~13, add ~10 more, total ~23):

1. Leading prefix of PUBLIC+isStatic only → simulateViaNode called once, simulateTx NOT called.
2. Mixed: 3 PUBLIC+isStatic prefix + 2 PRIVATE → both arms in parallel, both contribute to encoded[].
3. Mixed: PRIVATE first + PUBLIC+isStatic after → prefix is empty, fast arm NOT triggered, today's path runs unchanged.
4. Mixed: PUBLIC+isStatic + PUBLIC-non-static + more PUBLIC+isStatic → prefix breaks at non-static, fast arm gets only the first run.
5. `hideSender: true` on a PUBLIC+isStatic call → breaks the prefix, that call goes slow (preserve flag honor).
6. All-utility batch → no tx-arm, no fast-arm, unchanged.
7. All-public-static + utility queued → fast arm runs, slow arm null, utility launches after anchor read.
8. Block-header anchor missing → silent FULL fallback. simulateViaNode never called. Fast tuples go through slow arm.
9. simulateViaNode throws SimulationError → propagates. Slow-arm result discarded.
10. simulateViaNode throws generic Error → WARN logged with (contract, selector). Full rerun through standard `pxe.simulateTx`. Counter pinned to NOT increment on happy paths.
11. completeFeeOptions throws → silent FULL fallback (pre-dispatch failure).
12. node.getNodeInfo throws → propagates (shared-fate, no catch).
13. Per-tuple unpack correctness on mixed 3-public-static + 2-private batch → assert encoded[i] matches expected per i.
14. Origin-equality branch after partitioning to private-only slow payload → assert correct nested-shape branch (opus H3 pin).
15. Concurrency ordering: anchor read completes BEFORE utility launch BEFORE fast/slow arm dispatch (test via Promise ordering + spy timeline).
16. Hoist check: flatMap called once, not per fast tuple (assert via spy call count).
17. Rerun invariant: on fast-arm generic-Error path, utility promise creation count === 1 (NOT re-launched during the full rerun).
18. (concurrency test #15 implementation note) Implement #15 with **deferred promises** (`let resolveFast: (v: any) => void; const fastPromise = new Promise(r => resolveFast = r)`) and **spy timelines** (per-spy `lastCallTime: Date.now()` or push to a global order array). Do NOT use `setTimeout`/`vi.useFakeTimers` or rely on natural settlement ordering — those produce flaky tests. The assertion is over invocation order, not wall-clock or settlement timing.

**`helpers/batched-view-simulation.integration.test.ts`** — 2 cases gated on `RUN_NETWORK_E2E`:

- Pure-public-static (gas-balance shape) on a real sandbox; assert encoded values match what `pxe.simulateTx` would return for the same call. Compare `Fr` arrays only, NOT gas/stats (codex REJECT — gas WILL differ).
- Mixed (public-static prefix + private tail) on a real sandbox; same parity assertion.

**`helpers/block-header-anchor.test.ts`** — 4 cases as listed.

**`token-balance/balance-projector.test.ts`** — pin the **global** two-pass enqueue order across multiple tokens. Fixture: 3 tokens each with both PUBLIC + PRIVATE balance fns. Assert: dispatched `calls` array contains all 3 PUBLIC calls (indices 0, 1, 2) BEFORE any PRIVATE calls (indices 3, 4, 5). Existing per-token mapping assertions (`balance-projector.test.ts:156`) continue to pass — they don't assume interleaving order.

---

## 3. Updated test plan summary

| Layer | Where | What |
|---|---|---|
| Unit — helper routing | `batched-view-simulation.test.ts` | +10 cases (prefix vs filter, hideSender, fallback paths, concurrency ordering, indexing correctness, origin-equality) |
| Unit — anchor util | `block-header-anchor.test.ts` | 4 cases, undefined-on-double-failure |
| Unit — projector enqueue | `balance-projector.test.ts` | pin: public-before-private enqueue order |
| Integration — sandbox parity | `batched-view-simulation.integration.test.ts` | 2 RUN_NETWORK_E2E cases (pure-static + mixed); encoded/decoded comparison only |
| Existing | `fast-path.test.ts` | should pass after anchor refactor (no behavior change) |
| E2E | `tests/e2e/` smoke + network | should pass unchanged (balance display values unchanged) |

Gates: `bun run audit:vue` + `bun run --filter '@nulo/extension' test:components` + `RUN_NETWORK_E2E=1 bun --filter '@nulo/extension' test ...integration.test.ts`.

---

## 4. Security & Adversarial — consolidated

| Risk | Severity | Mitigation |
|---|---|---|
| Indexing bug silently swaps balances | (was BLOCKER, FIXED) | Re-numbered indices + unit test #13 |
| Arbitrary filter changes execution semantics | (was BLOCKER, FIXED) | Leading-prefix-only + projector reorder |
| Mixed batches don't bypass write lock | KNOWN | Documented in §1d. Win is via fast-arm parallel work, not slow-arm speedup |
| Fast/slow arm chain-state race | LOW | Documented (§1e). Inter-chunk skew already exists |
| `hideMsgSender` flag silently dropped | LOW | Routed to slow arm if set (§1f); runtime guard + test pin |
| Malicious dApp-registered artifact lies about isStatic | LOW | Acknowledged (§1g). View-only impact, no on-chain effect |
| Silent fallback masks real contract bugs | (was HIGH, FIXED) | WARN log + counter, distinguishes infra from contract |
| Fallback orchestration with allSettled | (was HIGH, FIXED) | Explicit second-pass rerun on fast-arm reject (§1b) |
| `executeUtility` shares write lock | KNOWN | JSDoc corrected (§1d); test pinning kept honest |
| Supply-chain | NIT | No new deps. `simulateViaNode` already in @aztec/wallet-sdk@4.2.0 |

### Adversarial framing

- **Attack surface**: callers (balance-projector + gas-balance) are SW-internal. The dApp-supplied artifact path is the one non-trivial trust boundary (§1g) — limited impact.
- **What we're trusting**: Noir `static` keyword enforcement (compiler), `simulateViaNode` correctness (upstream), artifact authenticity (PXE contract registry). All boundaries the slow path already trusts.
- **Least-privilege**: fast path skips the wallet entrypoint hop for public-static reads (correct — static functions can't authenticate). Slow path runs the entrypoint for any non-static call.
- **Supply-chain**: no new dep; relies on `@aztec/wallet-sdk@4.2.0`'s existing exports.

---

## 5. Rejected audit findings (defended)

- **Codex's "leading-prefix only" stays, but balance-projector reorders to make it triggerable** (not "abandon the optimization for the generic helper"). The leading-prefix discipline + projector reorder is the cleanest design.
- **Opus's recommendation to refactor `executeUtility` to `withPxeRead`** — **rejected outright** after verifying upstream. Upstream PXE puts every operation through a single `SerialQueue` (`@aztec/pxe@4.2.0/src/pxe.ts:328-336`) and explicitly forbids concurrent execution because utility calls *can* mutate PXE stores (capsules). Downgrading our outer lock would be both unsafe (upstream's comment contradicts opus's stateless premise) and moot (upstream serializes regardless). Documented in JSDoc + plan-v2 §1d to prevent re-attempt. Aztec issue #12636 tracks any future upstream relaxation.
- **Compare encoded/decoded only in parity tests** (codex REJECT) — accepted from opus REJECT too. Don't compare gas/stats.
- **`SimulationError` propagation** — accepted from both audits.
- **`getNodeInfo` shared-fate** (codex H4) — accepted; let it propagate.
- **Block-header anchor extraction** — accepted; shared util is correct.

---

## 6. Updated ASCII status tracker

```
[✓] 0. Clarifying questions
[✓] 1. Pre-draft technical verification
[✓] 2. Draft main plan + ELI5
[✓] 3. Parallel opus + codex audits           (both: needs-rework)
[✓] 4. Consolidate v2 plan                    (this document)
[✓] 5. Final codex review                     (ship-with-changes; 1 HIGH + 3 MEDIUMs patched in v2 inline)
[▶] 6. Approval gate                          (awaiting user explicit Go)
[ ] 7. Implementation                         (per file-by-file above)
[ ] 8. Post-impl codex review                 (diff + summary, adversarial)
[ ] 9. Fix loop                               (triage + close)
```

## 7. Decisions locked at the Phase 6 approval gate

1. **Balance-projector two-pass enqueue** — **bundled** in this PR. Load-bearing for the optimization to trigger; one bisectable PR is cleaner than splitting.
2. **executeUtility lock downgrade** — **dropped entirely** (was opus's suggestion). Verified against upstream: `@aztec/pxe@4.2.0/src/pxe.ts:328-336` puts every PXE operation through a single SerialQueue and explicitly forbids concurrent execution. The change would be both unsafe and moot. Documented in helper JSDoc to prevent re-attempt; Aztec issue #12636 tracked there too.
