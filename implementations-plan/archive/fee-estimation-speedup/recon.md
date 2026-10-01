# Recon — fee-estimation-speedup

Phase 0.4 codebase recon, consolidated from five read-only exploration passes (two problem-mapping, three solution-surface) against `dev`. All `@aztec/*` pins at **5.0.1** here and in the upstream reference (`aztec-kit`).

## The problem, quantified

Every fee estimate is one or more **full local ACVM simulations** (`pxe.simulateTx`), serialized behind the exclusive per-`(profileId, chainId)` PXE write lock (`packages/aztec-runtime/src/pxe/service.ts:831-860`) *and* upstream `@aztec/pxe`'s own internal `SerialQueue`. Parallelizing is off the table; only reducing sim count helps.

Per "estimating fee" spinner today (default fee method = private/sponsored FPC → `FpcStrategy`):

| Flow | buildStandard | simulateTx | Notes |
|---|---|---|---|
| Send estimate, `fpc` | 2 | 2 | two-pass strategy (`fee/fpc-strategy.ts:36-87`) |
| dApp op estimate, `fpc` | 3 | 3 | + authwit-discovery pre-pass (`authwit-discoverer.ts:73-130`) |
| dApp confirm, `fpc` | 3 | 3 | zero reuse — full re-run before proving (`dapp-send-executor.ts:415-434`) |
| Send confirm, `fj`/`fpc` | 0 | 0 | `TransferEstimateReuse` hit |

Plus, on **every** `simulateTx`/`proveTx`: an unconditional `[SYNC-DEBUG]` pair — `pxe.getSyncedBlockHeader()` + `node.getBlockNumber()` (a real node RPC) — purely to print a debug line (`packages/aztec-runtime/src/pxe/service.ts:415-424, 452-459`), ungated.

Upstream reference (`@aztec/wallets` `EmbeddedWallet.sendTx`, consumed by aztec-kit): **one** stubbed kernel-less sim whose result is read twice — `offchainEffects` → authwits, `gasUsed` → gas limits — then one `proveTx`. No UI-facing estimate at all.

## Load-bearing facts (verified, file:line)

1. **All sims are already kernel-less.** `@aztec/pxe` defaults `skipKernels: true` (`node_modules/@aztec/pxe/src/pxe.ts:1195-1234`); Nulo never overrides it to `false`. Switching which sim's `gasUsed` we read changes stub-vs-real exposure only, never kernelled-vs-kernel-less.
2. **`TxSimulationResult` exposes both derivations off one object**: `offchainEffects` getter (= `collectOffchainEffects(privateExecutionResult)`) and `gasUsed` (`node_modules/@aztec/stdlib/src/tx/simulated_tx.ts:82-158`).
3. **`buildStandard` already applies `forEstimation` gas sizing on every call.** `NuloAccount.buildTxExecutionRequest` (`packages/aztec-runtime/src/account/nulo-account.ts:116-157`) unconditionally calls `completeFeeOptions({forEstimation: true})` — Nulo's byte-for-byte port of upstream (`packages/aztec-runtime/src/account/fee-options.ts:60-90`); `GasSettings.forEstimation` confirmed at 5.0.1 (`node_modules/@aztec/stdlib/src/gas/gas_settings.ts:139-157`).
4. **Both shipped FPC handlers ignore `maxFee` entirely.** `PrivateFpcHandler.getFeePayload` → `pay_fee`, `args: []`; `DefaultSponsoredFpcHandler` → `sponsor_unconditionally`, `args: []` (`fee/handlers/private-fpc-handler.ts:23-32`, `fee/handlers/default-sponsored-fpc-handler.ts:18-27`). `getTotalGas()`/`getTeardownGas()` are hardcoded constants. FPC Pass 1 exists only to seed Pass 2's `gasSettings` — which fact 3 makes redundant. **Contrast**: dApp-*embedded* FPCs (`EmbeddedStrategy` + `embedded-fpc-cap.ts`) DO assert `gasLimits × maxFeesPerGas ≤ budget` on-chain — the collapse must not claim to generalize to that path (it doesn't touch it).
5. **Why discovery stubs the account**: the stub account class is the *mechanism* that turns unverifiable authwit checks into `CallAuthorizationRequest` offchain effects instead of hard in-circuit asserts. A sim intended to *discover* authwits must be stubbed; a sim with real authwits already attached must not be (today's strategy sims run unstubbed + validated because discovery pre-spliced the authwit actions).
6. **In-repo stance on stub gas**: "The discovery result is ONLY used to read offchain effects — never for proving or gas estimation" (`dapp-send-executor.ts:549-570`, NO_FROM path pays for a second unstubbed sim). **Upstream disagrees**: `EmbeddedWallet` sizes gas straight off the stubbed sim with a 10% pad (`node_modules/@aztec/wallets/src/embedded/embedded_wallet.ts:96,112-155,198`; aztec-kit sets pad to 0). Neither codebase quantifies the delta. Genuine open decision.
7. **`stubAccountAddresses` plumbing is end-to-end already** (`ipxe.ts:44`, `client.ts:252-258`, `spec.ts:62`, `service.ts:445-504` forcing `skipKernels: true` with the override) — but `SimulateTxFn`/`ExecutionCoordinator.simulateTxTask` (`fee-strategy.ts:74-79`, `execution-coordinator.ts:92-108`) drop the third arg, so no fee strategy can request a stub today. Concrete wiring gap.
8. **`FeeEstimate extends BuiltStandardTx`** already carries `{txRequest, node, pxe, account, network, nonce, txCalls, pendingPublicAuthwits}` (`tx-request-builder.ts:69-82`) — everything a reuse entry stashes.
9. **`TransferFeeEstimate.estimateId` exists on the wire type** (`packages/wallet-bridge/src/fee.ts:57-64`) but `estimateOperationFee` never populates it, and no per-op identity survives to confirm: the execute window keys estimates by array index, `approve()` → `approveInteraction(requestId, Operation[])` carries no op ids, and `closeWindow(true)` fires while `executeAndResolve` is fire-and-forget — **the estimate token must be baked into the `Operation[]` payload itself**.
10. **The reuse carve-out is explicit**: `service.ts:123-133` — "Scope: Send-page transfer flow only. dApp paths … carve out per audit-codex-v3."
11. **Estimate cancellation gap**: `cancelJob` RPC exists popup→SW (`client.ts:18`, `service.ts:359-361`, `execution-lane.ts:148-190`) but is journal-record-gated; estimates create no journal record → silent no-op. No `AbortSignal` marshalling exists in `packages/extension-messaging`. An estimate-keyed cancel registry (id-based RPC, same pattern) is the only viable shape. Cancellation can stop *the next stage from starting*; it cannot kill an in-flight ACVM run.
12. **SYNC-DEBUG can't be flag-gated cheaply**: `ILogger` (`packages/wallet-core/src/logger/interfaces.ts:30-32`) has no `isEnabled`/`getLevel` predicate — the level filter (`apps/extension/src/wallet/logger/store.ts:27-30`) runs *after* the RPCs fire. Deletion is lower-risk than adding predicate plumbing. No test asserts on those lines.
13. **Composition tests are OFF the table for fee estimation.** `tests/COMPOSITION-TESTS.md`: shallow PXE ∧ bb-free ∧ no simulate/prove semantics; the `FpcService` worked example (zero composition tests, e2e only) is the direct analog. Sim-count assertions live at the **unit** layer.
14. **The unit idiom already exists**: `fee/strategies-structural.test.ts` asserts `buildStandard`/`simulateTxTask` `toHaveBeenCalledTimes(N)` per strategy with per-pass `mockResolvedValueOnce` identity + arg-order pins; `fee/fee-structural-parity.test.ts` pins gas-slot transposition; `transfer-executor.test.ts:121` pins the reuse path ("planner + buildAndEstimate skipped"); `transfer-estimate-reuse.test.ts` covers every rejection-ladder exit as a separate test.
15. **Network e2e gate mapping**: prover-ON canary pair = `tests/e2e/network/transfers.test.ts` (Sponsored-FPC-paid, on-chain confirmed) + `tx-sendTx-default.test.ts` (dApp execute window → real proof → node acceptance). Run singly: `bun run e2e:agent tests/e2e/network/<file>.test.ts`. `fee-methods.test.ts` has directly-relevant but currently-skipped cases (cluster A+B triage). The smoke suite has **zero** Send-page/fee coverage.
16. **The `fpc` two-pass mutation discipline is audit-pinned**: `fpc-strategy.ts` header — action-array `unshift`/`splice` + `originalActions` restore is "intentional and load-bearing … Do NOT refactor to a non-mutating shape without re-verifying the TxExecutionRequest bytes match."
17. **Discovery's throwaway build hardcodes `PREEXISTING_FEE_JUICE`** regardless of the real fee method (`authwit-discoverer.ts:77`), and `AuthwitDiscoverer`'s other exports (`computeCallMessageHash` etc.) are consumed independently by `TxRequestBuilder` — the discoverer split must not disturb those.
18. **`TransferEstimateReuse` mechanics**: single-shot consume (`cache.delete` before validation), 5-min TTL, opportunistic eviction, rejection ladder = input byte-match (explicit-switch fingerprint, never `JSON.stringify` — codex-audit-pinned) → profile → endpoint identity → base-fee fingerprint (re-fetches `predictedWorstMinFees`) → pending-tx set. Eligibility `fj`/`fpc` only; `fjwc` (action-mutating build) and `embedded` (divergent path) excluded; NO_FROM has no nonce and its own inline discovery — stays out.

## Reuse-as-is

- `TransferEstimateReuse` validation ladder + deps-injection shape + `fingerprintBaseFee`/`fingerprintFeeSettings` (payment-method-aware, reusable verbatim).
- `TxSimulationResult.offchainEffects` / `collectOffchainEffects` as the extraction mechanism, whichever sim produces the result.
- `finalizeGasLimits`/`suggestGasLimits` single-pass helpers (`fee-strategy.ts`) — FPC calls them directly once collapsed, same shape as `fjwc`.
- `strategies-structural.test.ts` / `transfer-executor.test.ts` / `transfer-estimate-reuse.test.ts` idioms for all new pins.
- `cancelJob`'s design pattern (id-keyed registry, journal-transition-first ordering, `rpc-cancel.ts` boundary translation) for the estimate-cancel path.
- Existing `stubAccountAddresses` end-to-end plumbing below the coordinator.

## Adapt-with-changes

- `FpcStrategy.buildAndEstimate` → single `buildStandard(EXTERNAL)` with fee payload pre-included + one sim + `finalizeGasLimits` (mirrors `fjwc` shape). Keep the `originalActions` splice discipline for the final action shape; placeholder `maxFee` is provably inert for both shipped handlers (fact 4).
- `AuthwitDiscoverer` → split "run stubbed sim" from "extract effects → `AddPrivateAuthwitAction[]`" so the extractor runs on any `TxSimulationResult`.
- `SimulateTxFn` + `ExecutionCoordinator.simulateTxTask` → carry `stubAccountAddresses` (fold into opts).
- `TransferEstimateReuseEntry` → parallel `Operation`-shaped entry (same snapshot fields; new canonical action-graph fingerprint — explicit-switch over every `Action` kind, byte-stable).
- `estimateOperationFee` → populate `estimateId` (stash-on-eligible pattern from `transfer-executor.ts:270-317`); `execute/index.vue` threads per-op `estimateId` inside the `Operation[]` at approve; `executeAztecSendTx` `tryConsume` **inside** the slot/journal scaffold.
- `useFeeEstimation`/`useFeeEstimationMap` → cancel-on-refire via the new estimate-cancel RPC.

## Collision / dedup risks

- No stable per-op id in the wire protocol; window-closes-before-confirm timing forces payload-embedded tokens (fact 9).
- Action-graph fingerprint: arbitrary call/capsule/authwit graphs; a `JSON.stringify` shortcut reproduces the exact bug class the codex audit blocked before (fact 18).
- Same-batch drift: `executeOperations` runs multiple ops sequentially in one approval; op #1 broadcasting between estimate(#2) and confirm(#2) must trip the `pendingHashes` ladder step — verify same-batch, not just cross-request.
- Slot asymmetry: estimates run unslotted, confirms slotted — reuse-consume must live inside `runInSlot`'s frozen ordering.
- `strategies-structural.test.ts` + `fee-structural-parity.test.ts` are pinned tripwires — deliberate matching updates, never incidental breakage.
- `ExecutionFence` is captured at confirm-authorization time and must never ride a reuse entry.
- `EmbeddedStrategy`/NO_FROM keep their discovery opt-outs; eligibility stays `fj`/`fpc` standard-mode.

## Environment facts

- GitHub **stacked PRs** are in public preview (2026-07-30) with the official `github/gh-stack` CLI extension (not yet installed; `gh extension install github/gh-stack`). Required checks apply to mid-stack PRs per the changelog. Compatibility with `dev`'s squash-only-for-feature-PRs ruleset is unverified — verify before committing to stack-merge; classic chained PRs are the fallback.
- Validation commands: `bun run lint` · `bun run typecheck:all` · `bun run test` (all unit/component/composition) · single file via `bun run --cwd apps/extension vitest run <path>` · `bun run test:e2e` (smoke; no fee coverage) · `bun run e2e:agent [file]` (network) · `bun run audit:vue` (pre-PR UI gate).
