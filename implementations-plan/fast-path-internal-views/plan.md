# Extend public-static fast path to internal `batchedViewSimulation`

## 1. Summary

PR #56 (deprecate-simulate-views) extracted `batchedViewSimulation` as the single internal entry point for view-shaped reads (balance-projector + `#computeGasBalances`). It preserves the original three-arm concurrency:

| Arm | Calls | Path |
|---|---|---|
| 1 | PUBLIC + PRIVATE tx-typed | bundled into one `ExecutionPayload` → `pxe.simulateTx({ simulatePublic: true })` |
| 2 | UTILITY | launched eagerly → `pxe.executeUtility`, awaited serially after arm 1 |

What it does **not** do: pull PUBLIC + `isStatic` calls out of the kernel and route them direct-to-node via upstream's `simulateViaNode` (PR 8c "public-static fast path"). That optimization is wired only into the dApp-facing `executeAztecSimulateTx` codepath (`service.ts:1576` → `fast-path.ts:runFastPath`). Internal balance reads still pay the kernel-setup cost AND compete for the global `ReadWriteGuard` in `pxe/service.ts:330-345` — the same lock prove holds.

This PR extends the helper with a **mixed-payload fast path** (user-locked: split prefix + remainder, run in parallel, merge per-index). UTILITY arm unchanged. No new public surface; transparent at the helper level. All current internal callers benefit automatically.

### Bundled scope

- **Helper deps extension** — bundle `chainInfo` + `getContractName` lazily so the fast arm has what `simulateViaNode` needs without inflating the helper's `Deps` interface for callers that never hit the fast path.
- **Shared block-header anchor util** — pull the `pxe.getSyncedBlockHeader() ?? node.getBlockHeader()` fallback out of `fast-path.ts` into a tiny `helpers/block-header-anchor.ts` so both helpers use the same anchor and we don't reinvent the fallback twice.
- **Unit tests + skipIf integration test** — pin the 4-arm routing decision (was 3-arm), the chain-state anchor invariant, the silent-fallback path, and the parity contract via a real-sandbox `RUN_NETWORK_E2E` test that runs balance-projector through the helper twice (once forcing slow path, once allowing fast path) and asserts identical encoded values.

Out of scope:
- Microbenchmark harness (user-locked).
- ConfigService flag (user-locked: transparent at helper level).
- Touching the dApp `aztec_simulateTx` codepath (already optimized).
- Optimizing the UTILITY arm (upstream `simulateViaNode` doesn't accept utility-typed calls; `pxe.executeUtility` is the only path).
- Cross-batch block-header caching (potential follow-up; not load-bearing).

## 2. State of the world (recon)

| Layer | Location | Status |
|---|---|---|
| Internal helper | `packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:84-187` | 3-arm: pxe.simulateTx (PUBLIC+PRIVATE) + executeUtility parallel arm |
| Helper deps | `helpers/batched-view-simulation.ts:71-77` | `BatchedViewSimulationDeps`: pxe, node, account, contractResolver, logger |
| Deps bundler | `helpers/get-view-simulation-deps.ts` | Resolves the 5 deps from service container |
| Fast-path orchestrator (dApp side) | `execution/fast-path.ts:166-226` | Uses upstream `simulateViaNode` + `buildMergedSimulationResult`. Block-header fallback at `:182-187` |
| Caller — dApp `aztec_simulateTx` | `execution/service.ts:1576` | Already on fast path. `getContractName: async () => undefined` (used only for error messages) |
| Caller — balance projector | `services/token-balance/balance-projector.ts:130-145` | BATCH_SIZE=12 chunks → batchedViewSimulation. Mixed public+private+utility shapes |
| Caller — gas balance public | `service.ts:1305-1343` | Single PUBLIC + isStatic call (`balance_of_public` on FeeJuice) |
| Caller — gas balance private | `service.ts:1347-1370` | Single UTILITY call on PrivateFPC (`balance_of`) |
| IPXE | `packages/aztec-runtime/src/pxe/ipxe.ts:49` | `getSyncedBlockHeader(): Promise<BlockHeader>` already on surface (used by fast-path.ts) |
| Upstream | `@aztec/wallet-sdk@4.2.0/src/base-wallet/utils.ts:170-203` | `simulateViaNode` signature pinned. `MAX_ENQUEUED_CALLS_PER_CALL = 16` (constants.gen.ts) |

### Verified facts

- `IPXE.getSyncedBlockHeader()` is on Nulo's PXE surface (no extension needed).
- `MAX_ENQUEUED_CALLS_PER_CALL = 16` upstream. balance-projector chunks at `BATCH_SIZE = 12`. Under limit → no inner chunking required (simulateViaNode also batches itself).
- Existing fast-path call site at `service.ts:1576` passes `getContractName: async () => undefined` — confirms no real name resolver needed (it's used only for upstream's error-message strings).
- `simulateViaNode` returns `TxSimulationResult[]` (one per batch); each `result.publicOutput.publicReturnValues` is `Fr[][]` in original call order within the batch.
- Upstream's `buildMergedSimulationResult` is **prefix-based** ("optimized calls are always a leading prefix, return values are simply concatenated"). Our helper unpacks per-index already → we don't need `buildMergedSimulationResult` at all. We index directly into both arms' results.

### Why we don't reuse `runFastPath` wholesale

`runFastPath` is shaped around dApp `aztec_simulateTx`'s output contract (returns `TxSimulationResult`). Our helper produces per-call `encoded[]` + `decoded[]`. Different output. We replicate the parallel-arm primitive (`simulateViaNode` + `pxe.simulateTx` in `Promise.all`) but unpack into our shape directly.

What we DO share: the block-header anchor fallback. That moves into a new tiny `helpers/block-header-anchor.ts` and gets called by both `runFastPath` (refactor `fast-path.ts:182-187` to call it) and the new fast arm in `batchedViewSimulation`.

## 3. Design — the 4-arm helper

After classification (current loop at `batched-view-simulation.ts:122-131`), partition `txCalls` into two sub-batches:

```
txCalls →
  fastTxCalls   = txCalls.filter(tuple => tuple[0].type === PUBLIC && tuple[0].isStatic)
  slowTxCalls   = txCalls.filter(tuple => !(tuple[0].type === PUBLIC && tuple[0].isStatic))
```

Then dispatch:

```
   ┌── fastTxCalls.length > 0  ──→ simulateViaNode(node, ..., blockHeader, ...)
   │                                                                          ├── Promise.all
   ├── slowTxCalls.length > 0  ──→ account.buildTxExecutionRequest + pxe.simulateTx
   │
   └── utility[]                ──→ already launched eagerly, awaited last (unchanged)
```

Unpack per-tuple `(originalCall, originalIndex, slotIndex, returnTypes)` into `encoded[originalIndex]` + `decoded[originalIndex]` — same shape as today, just sourcing from a different arm based on the tuple's classification.

### Fast arm prerequisites

`simulateViaNode(node, calls, fromAddr, chainInfo, gasSettings, blockHeader, skipFeeEnforcement, getContractName)`:

| Param | Source | Notes |
|---|---|---|
| `node` | `deps.node` | already in deps |
| `calls` | `fastTxCalls.map(t => t[0])` | already-classified FunctionCall instances |
| `fromAddr` | `deps.account.address` | already in deps |
| `chainInfo` | `await node.getNodeInfo()` → `{ chainId: Fr(l1ChainId), version: Fr(rollupVersion) }` | cheap, fetched once per fast-arm invocation. Could be hoisted to deps later; lazy for now |
| `gasSettings` | `await completeFeeOptions({ node, gasSettings: undefined, forEstimation: true })` | mirrors fast-path.ts:190-194. For views, no opts.fee → undefined → defaults |
| `blockHeader` | `await getBlockHeaderAnchor(deps.pxe, deps.node)` | shared util (extracted from fast-path.ts) |
| `skipFeeEnforcement` | `true` | hardcoded for views, mirrors existing simulateTx call at `batched-view-simulation.ts:150` |
| `getContractName` | `async () => undefined` | mirrors existing service.ts:1576 use; upstream only uses for error-message strings |

### Failure modes + fallback policy

1. **Block-header anchor missing** (both `pxe.getSyncedBlockHeader` and `node.getBlockHeader` throw/return null) → **silent full fallback**: move all fastTxCalls back into slowTxCalls and run the original 3-arm path. User sees same correctness, slightly slower refresh.
2. **`completeFeeOptions` or `node.getNodeInfo` throws** → silent full fallback (same as #1).
3. **`simulateViaNode` throws `SimulationError`** → **propagate**. This is a real contract revert — the standard arm would produce the same error 3-5s later. Don't waste time retrying.
4. **`simulateViaNode` throws non-`SimulationError`** (network blip, RPC mismatch, etc.) → silent full fallback (same as #1).

Fallback path implementation: a single try/catch around the fast-arm prep + dispatch. On catch, re-add fastTxCalls to slowTxCalls and continue with the original simulateTx flow. Logged via `logger?.log(LOG_SOURCE, LogLevel.Warn, ...)` so we can spot regressions.

### Concurrency invariant preserved

Today: utility[] launches eagerly before simulateTx (lines 117-131), then simulateTx awaits (149-152), then utility[] awaits serially (176-184).

After: utility[] launches eagerly before BOTH simulateTx AND simulateViaNode. Both tx arms run in `Promise.all` parallel. Utility awaits serially after both. The pinned `parallel-launch + serial-await` test invariant (`batched-view-simulation.test.ts` "concurrency invariant" case) needs an additional assertion: simulateViaNode and simulateTx must both have started before any utility await completes.

## 4. File-by-file changes

### NEW

**`packages/extension/src/wallet/services/execution/helpers/block-header-anchor.ts`** (~25 lines)
```ts
export async function getBlockHeaderAnchor(pxe: IPXE, node: AztecNode): Promise<BlockHeader | undefined> {
  try {
    return await pxe.getSyncedBlockHeader()
  } catch {
    return (await node.getBlockHeader()) ?? undefined
  }
}
```
Pure. No service-container. Trivially unit-testable.

**`packages/extension/src/wallet/services/execution/helpers/block-header-anchor.test.ts`** (~6 cases)
- PXE succeeds → its header returned, node not called
- PXE throws → node fallback called
- PXE throws + node returns null → returns undefined
- PXE throws + node throws → throws (caller treats as "no anchor → fall back")
  - Actually: spec for the helper is "returns undefined on no anchor available". Throw from node should be caught too and return undefined. Pinned in test.

### MODIFIED

**`packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts`** (+~80 lines net, mostly inside the existing function body)
- Imports: `simulateViaNode` from `@aztec/wallet-sdk/base-wallet`, `completeFeeOptions` from `@nulo/aztec-runtime/account`, `getBlockHeaderAnchor` from `./block-header-anchor`, types: `ChainInfo`, `BlockHeader`, `GasSettings`.
- After current classification loop (post line 131): partition `txCalls` into `fastTxCalls` + `slowTxCalls`.
- New inner async block for the fast arm:
  - prep: `getBlockHeaderAnchor` → `node.getNodeInfo` → `completeFeeOptions` (all under one try/catch)
  - dispatch: `simulateViaNode(...)`
  - on any non-SimulationError throw: log + re-add fastTxCalls to slowTxCalls, mark fast-arm "skipped", continue
- Promise.all([fastArm, slowArm]) where:
  - fastArm = `simulateViaNode` promise OR `Promise.resolve([])` if fastTxCalls empty or fallback triggered
  - slowArm = current simulateTx invocation OR `Promise.resolve(null)` if slowTxCalls empty
- Unpack:
  - For each fastTxCall tuple: `encoded[i] = fastResults.flatMap(r => r.publicOutput?.publicReturnValues ?? [])[fastSlotIndex]`
  - For each slowTxCall tuple: existing public/private return unpacking (lines 154-170), indexed against slow-arm-only slot indices
- UTILITY arm + decode loop (lines 176-184): unchanged.
- Docstring rewrite: 3-arm → 4-arm. Update concurrency-invariant statement.

**`packages/extension/src/wallet/services/execution/fast-path.ts`** (refactor only, no behavior change)
- Replace inline block-header fallback at `:182-187` with `await getBlockHeaderAnchor(pxe, node)`. Same control flow (null → return null caller-side). Reduces fast-path.ts by ~6 lines and pins the shared anchor.

### NEW tests

**`helpers/batched-view-simulation.test.ts`** — extend (current ~13 cases, add ~8 more):
1. Pure PUBLIC+isStatic batch → simulateViaNode called once, pxe.simulateTx NOT called.
2. Pure PRIVATE batch → pxe.simulateTx called, simulateViaNode NOT called.
3. Mixed PUBLIC+isStatic + PRIVATE batch → both called in parallel (assert Promise.all by ordering: spy returns deferred promises, assert both spies invoked before either resolves).
4. PUBLIC-non-static call → goes to slow arm, simulateViaNode NOT called.
5. Mixed batch with UTILITY → utility launched eagerly BEFORE both tx arms, utility awaited LAST.
6. Block-header anchor missing → silent full fallback to standard simulateTx. simulateViaNode never called.
7. simulateViaNode throws SimulationError → error propagates, standard arm result discarded.
8. simulateViaNode throws generic Error → silent fallback to standard, fastTxCalls run through simulateTx instead. Warning logged.
9. completeFeeOptions throws → silent fallback (pinned at the prep step, distinct from sim-arm throw).
10. Empty batch → no calls (existing test, just re-pin under new code path).

**`helpers/batched-view-simulation.integration.test.ts`** — convert one `test.todo` to a real `describe.skipIf(!process.env.RUN_NETWORK_E2E)` case:
- Deploy a Token contract on the sandbox.
- Mint to two accounts, set distinct balances.
- Call batchedViewSimulation with [balance_of_public(A), balance_of_public(B)] — both should route fast.
- Assert encoded values match what `pxe.simulateTx` would return (run the same calls through `pxe.simulateTx` directly as control, compare Fr arrays).
- Add a second invocation forcing a private call into the batch (balance_of_private as UTILITY); assert public arm still routes fast, utility routes via executeUtility, encoded indices line up.

**`helpers/block-header-anchor.test.ts`** — net-new, 4 cases as listed above.

## 5. Test plan summary

| Layer | Where | What |
|---|---|---|
| Unit — helper routing | `batched-view-simulation.test.ts` | +8 cases pinning 4-arm decision, fallback paths, concurrency |
| Unit — anchor util | `block-header-anchor.test.ts` | 4 cases pinning PXE → node fallback semantics |
| Integration — real sandbox | `batched-view-simulation.integration.test.ts` | 2 cases (pure-public-static parity + mixed parity) gated on `RUN_NETWORK_E2E` |
| Existing | `fast-path.test.ts` | should pass unchanged after the refactor to use `getBlockHeaderAnchor` |
| Existing | `balance-projector.test.ts` | should pass unchanged (helper is transparent — no shape change) |
| E2E | `tests/e2e/` smoke + network suites | should pass unchanged. Balance refresh and gas-balance display are exercised; values must match pre-PR |

Run gates locally: `bun run audit:vue` + `bun run --filter '@nulo/extension' test:components` + `RUN_NETWORK_E2E=1 bun --filter '@nulo/extension' test src/wallet/services/execution/helpers/batched-view-simulation.integration.test.ts`.

## 6. Security & Adversarial Considerations

Drawn from the global checklist (CLAUDE.md "Security & Adversarial mindset").

### Threat model

- **Helper is internal-only.** No new RPC surface, no new dApp interaction. Callers are balance-projector (token-list-derived, user-curated) and `#computeGasBalances` (fee-juice + FPC, both system-known).
- **Inputs**: contract address + method/selector + arg arrays, all pre-resolved by callers from the user's own token list or system constants.
- **Outputs**: balance integers consumed by UI display + gas-affordability checks.
- **Trust boundary**: the helper trusts artifacts returned by `contractResolver.resolveArtifacts` and the `FunctionType + isStatic` classification on each `FunctionAbi`.

### Risks + mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Chain-state divergence between fast and slow arms** | MEDIUM | Both arms anchor at the same `BlockHeader` (fast arm explicitly via `simulateViaNode`'s `blockHeader` param; slow arm via PXE's synced state, which `getSyncedBlockHeader` returns). Small race window if PXE syncs between calls — same window upstream's `BaseWallet.simulateTx` accepts. Document in helper docstring. |
| **Class-rehydration regression** (PR 8c hit this twice — `s.isPublicStatic is not a function`) | LOW | We're SW-internal, no port crossing. Calls arrive as already-constructed `FunctionCall` instances (built inside `enqueueCall` at `:207-243`). Add explicit unit case: assert `fc.isStatic === true && fc.type === FunctionType.PUBLIC` holds on the FunctionCall instances we route to fast arm. |
| **Misclassification → state mutation routed to fast path** | LOW | Noir compiler enforces `static` keyword at compile time. A PUBLIC+isStatic Noir function provably cannot mutate state. If we trust the artifact (we do — same trust the slow path has), classification is sound. |
| **`getContractName` callback** | NIT | Hardcoded `async () => undefined`, identical to fast-path.ts:1576 use. Only consumed by upstream for error-message string interpolation. Not a security boundary. |
| **`gasSettings` injection** | LOW | `completeFeeOptions({ gasSettings: undefined, forEstimation: true })` — no caller-controlled input. For dApp `aztec_simulateTx` the dApp can influence; for our helper, hardcoded path. Safe. |
| **PXE write-lock starvation reduction** | POSITIVE | Fast-path balance reads bypass `pxe/service.ts:330-345`'s `ReadWriteGuard`. During an in-flight prove, balance refresh no longer blocks. Net security/UX win. |
| **Empty / malformed fastResults** | LOW | Guard the unpack: if `fastResults.flatMap(...).length !== fastTxCalls.length` → log error and silent-fallback the affected indices to undefined (matches today's behavior on decode failure at `:165-169`). Pin in unit test. |
| **MAX_ENQUEUED_CALLS_PER_CALL = 16 vs balance-projector BATCH_SIZE = 12** | NIT | Under limit. `simulateViaNode` auto-chunks if exceeded. No action needed; document in plan as "verified". |
| **Supply chain** | NIT | Uses `@aztec/wallet-sdk@4.2.0` (`simulateViaNode`) — already in `bun.lock`, already pinned, already used by fast-path.ts. No new dependency. |
| **Least-privilege bypass via kernel skip** | LOW | Fast path bypasses kernel — kernel-side authz (msg.sender, authwits) isn't executed. For `isStatic` reads this is correct: static functions can't read or assert msg.sender meaningfully. Slow arm still runs kernel for all non-static calls. |

### Adversarial framing

- **"What would an attacker target?"** — None of the callers expose user-controlled contract addresses to dApp surface. balance-projector reads only from the user's curated token list (user added these). gas-balance reads only system-known addresses (FeeJuice canonical + FPC discovered via FpcService).
- **"What are we trusting that we shouldn't?"** — `simulateViaNode` correctness (upstream wallet-sdk); artifact `isStatic` flag honesty (Noir compiler). Both are well-trodden trust boundaries that the slow path already trusts.
- **"Where are crypto/least-privilege weaknesses?"** — None introduced. Crypto unchanged. Least-privilege strictly improved (fast arm bypasses kernel for reads that don't need it).
- **"Supply-chain"** — no new deps. Verifies 7-day min-age policy unchanged.

## 7. Open questions

1. **Caching block-header across sub-batches?** balance-projector chunks 50-token list into 5×12 batches; each currently re-fetches `getSyncedBlockHeader`. Cheap call but 5 round-trips. Worth a single-request cache passed via deps? **Recommended**: skip in this PR; if profiling shows it dominates, follow up.
2. **Hoist `chainInfo` to `getViewSimulationDeps`?** Same question — one call vs N. Same answer: skip for v1, follow up if measurable.
3. **Should `fast-path.ts:runFastPath` be refactored to also use the partition-style?** No — runFastPath's contract is "leading prefix only" because upstream's `buildMergedSimulationResult` is prefix-based. Our helper has its own unpack so we can be free-form. Different contracts. Leave runFastPath alone except for the anchor refactor.

## 8. Rollout

- Branch: `feat/fast-path-internal-views` off latest `dev` (post-#56-merge).
- Single squash-merge PR to `dev`. No flag (transparent helper change). Bisectable.
- Title: `feat(execution): route public-static internal view calls through node fast path`.
- Validation gate before push: `bun run audit:vue` + `bun run --filter '@nulo/extension' test:components` + `RUN_NETWORK_E2E=1 bun --filter '@nulo/extension' test ...integration.test.ts`.
- Post-merge: watch the next manual balance-refresh smoke (popup → token list → wait for balances) — expected to be visibly faster, especially during/after a prove. No regressions in displayed amounts.

## 9. ASCII status tracker (Tier B)

```
[✓] 0. Clarifying questions               (mixed-merge / transparent / unit+skipIf / Tier B full)
[✓] 1. Pre-draft technical verification   (IPXE.getSyncedBlockHeader, simulateViaNode sig, MAX const, callers)
[▶] 2. Draft main plan + ELI5
[ ] 3. Parallel opus + codex audits       (both must include adversarial ask)
[ ] 4. Consolidate v2 plan                (adopted vs rejected)
[ ] 5. Final codex review                 (one critical pass on plan-v2)
[ ] 6. Approval gate                      (user explicit Go)
[ ] 7. Implementation                     (per file-by-file above)
[ ] 8. Post-impl codex review             (diff + summary, adversarial)
[ ] 9. Fix loop                           (triage + close)
```
