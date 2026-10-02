# Cluster C — execution service

## Cluster verdict

This cluster is well above the codebase's median quality: it has clearly been through multiple audit/refactor passes (codex round references, byte-preservation notes, `implementations-plan/` cross-refs), and most files are dense-but-justified — heavy comment weight documents genuine invariants (cancel races, chain-identity drift, fee-payload mutation order), not restated code. The bulk of the ~8.9k lines is irreducible security/correctness logic. That said, six concrete, mechanical duplications survived the refactor passes: a repeated `try { task.complete() } catch { task.fail() }` wrapper around every fee-strategy/coordinator/builder call (~10 sites), a repeated "resolve instance+artifact or throw 'Contract not found'" ladder (6 sites across 3 files), an exact duplicate `recordTransaction` closure in `dapp-send-executor.ts`, a genuinely redundant double contract-resolution in `ViewExecutor.executeSimulateUtility`, a 4-way switch in `OperationPlanner` whose branches are config-shaped, and a triplicated decode/log block in `batched-view-simulation.ts`. Total removable: roughly **150–180 LOC**, all low-to-medium risk given the existing test coverage. The single biggest lever is the task-wrapper extraction (F2) — purely mechanical, touches the most files, and is a template the team can reuse anywhere else `StepContent`/`WrappedTask` appears.

## Findings

### F1 [duplication] Identical `recordTransaction` closure duplicated in `DappSendExecutor`

**Where:**
- `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:450-467` (`executeSendTransaction`)
- `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:567-585` (`executeAztecSendTx`)

**Evidence** (both sites, byte-identical):
```ts
recordTransaction: async (hash) => {
    await this.deps.addTransaction(
        origin,
        network.chainId,
        account.address.toString(),
        txCalls,
        nonce.toString(),
        feePaymentMethod,
        hash,
        primaryEndpointUrl(network),
        getEstimatedFee(txRequest),
        getGasDetails(txRequest),
        fence,
        op.networkId,
    )
    if (pendingPublicAuthwits.length > 0) {
        await this.deps.recordPendingAuthwits(account.address.toString(), pendingPublicAuthwits, hash)
    }
},
```

**Refactor:** Extract a private method on `DappSendExecutor`, e.g. `private recordSentTx(ctx: { origin, network, account, txCalls, nonce, feePaymentMethod, txRequest, fence, networkId, pendingPublicAuthwits }): (hash: string) => Promise<void>`, and pass `recordTransaction: this.recordSentTx({...})` at both call sites. Lives in the same file — no layer change.

**LOC delta:** -15

**Risk / tests:** low — mechanical extraction, same argument order/values. Covered by `dapp-send-executor.test.ts`.

**Confidence:** high

---

### F2 [duplication] `try { …; task.complete() } catch { task.fail(error); throw }` wrapper repeated ~10 times

**Where:**
- `apps/extension/src/wallet/services/execution/execution-coordinator.ts:117-131` (`simulateTxTask`), `:140-155` (`proveTxTask`)
- `apps/extension/src/wallet/services/execution/tx-request-builder.ts:124-206` (`buildStandard`), `:373-460` (`buildNoFrom`)
- `apps/extension/src/wallet/services/execution/fee/fee-juice-strategy.ts:23-61`
- `apps/extension/src/wallet/services/execution/fee/fee-juice-with-claim-strategy.ts:23-42`
- `apps/extension/src/wallet/services/execution/fee/embedded-strategy.ts:23-49`
- `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:121-190` (`buildAndEstimateSponsoredFastPath`), `:192-285` (`buildAndEstimateTwoPass`)

**Evidence** (shape repeated verbatim, e.g. `fee/embedded-strategy.ts:31-49`):
```ts
const task = startEstimateTask(this.deps.tasks, ctx.parentTask)
try {
    const built = await this.deps.txBuilder.buildStandard(ctx.op, embeddedMethod, task)
    ...
    task.complete()
    return { ...built, feePaymentMethod: embeddedMethod }
} catch (error) {
    task.fail(error)
    throw error
}
```
The team already extracted the ternary itself into `startEstimateTask` (`fee/fee-strategy.ts:342-345`) but never went the extra step to wrap the try/catch.

**Refactor:** Add a `runTaskStep<T>(task: WrappedTask, fn: () => Promise<T>): Promise<T>` next to `startEstimateTask` in `fee/fee-strategy.ts`, or a sibling `task-span.ts`:
```ts
export async function runTaskStep<T>(task: WrappedTask, fn: () => Promise<T>): Promise<T> {
    try {
        const result = await fn()
        task.complete()
        return result
    } catch (error) {
        task.fail(error)
        throw error
    }
}
```
Each of the 6 fee-strategy call sites collapses to `return runTaskStep(task, async () => { ...body... })`. `execution-coordinator.ts`'s `simulateTxTask`/`proveTxTask` fit directly; `sendTxTask` (which re-classifies the error before `task.fail`) needs the raw form left alone or a variant with an optional `classify` hook — leave it out of scope. `tx-request-builder.ts`'s two methods wrap ~80-line bodies; still mechanically identical, worth doing for consistency even though the per-site saving is smaller there.

**LOC delta:** -35 to -45 (10 sites × ~4 boilerplate lines saved, minus the ~8-line new helper)

**Risk / tests:** low — pure mechanical wrap, no behavior change (task.complete/fail ordering preserved exactly). Covered by `execution-coordinator.test.ts`, `fee-strategy-clamp.test.ts`, `fee-structural-parity.test.ts`, `strategies-structural.test.ts`, `tx-request-builder.pins.test.ts`.

**Confidence:** high

---

### F3 [duplication] "Resolve instance+artifact or throw 'Contract not found'/'Contract artifact not found'" repeated 6 times across 3 files

**Where:**
- `apps/extension/src/wallet/services/execution/tx-request-builder.ts:322-329` (`resolveNoFromCall`) — already has a named twin at `:546-556` (`requireArtifact`, used by the `call`/`encoded_call` action-processing helpers)
- `apps/extension/src/wallet/services/execution/authwit-discoverer.ts:142-149` (`computeCallMessageHash`) and `:191-198` (`computeEncodedCallMessageHash`)
- `apps/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:609-612` and `:650-652` (both arms of `classifyCall`)

**Evidence** (one of six, `authwit-discoverer.ts:191-198`):
```ts
const instance = instances.get(content.to)
if (!instance) {
    throw new Error("Contract not found")
}
const artifact = artifacts.get(instance.currentContractClassId.toString())
if (!artifact) {
    throw new Error("Contract artifact not found")
}
```
`tx-request-builder.ts` already named this exact shape `requireArtifact` (lines 546-556) — it just isn't reused by the other 5 sites, including the *other* method in the same file.

**Refactor:** Move `requireArtifact(instances, artifacts, address): ContractArtifact` (throwing exactly `"Contract not found"` / `"Contract artifact not found"`) into `contract-resolver.ts` as a plain exported function (distinct from the class's own `resolveInstance`/`resolveArtifact`, which throw differently-worded, async, PXE-hitting variants for a different contract). Import it in `authwit-discoverer.ts` and `batched-view-simulation.ts`; `tx-request-builder.ts` drops its private copy and imports the shared one. `service.ts:891-898` (`executeAztecCreateAuthWit`) uses a structurally different PXE-direct lookup — leave it alone.

**LOC delta:** -20

**Risk / tests:** low — the error strings are frozen and unchanged, only the ladder is shared. Covered by `tx-request-builder.pins.test.ts`, `authwit-discoverer.test.ts`, `batched-view-simulation.test.ts`.

**Confidence:** high

---

### F4 [duplication/verbosity] `ViewExecutor.executeSimulateUtility` resolves the same instance+artifact twice

**Where:** `apps/extension/src/wallet/services/execution/view-executor.ts:91-100`

**Evidence:**
```ts
const registeredContracts = new Set<string>((await pxe.getContracts()).map((x) => x.toString()))
if (!registeredContracts.has(op.contract)) {
    const [_, instance] = await this.deps.resolver.resolveInstance(pxe, op.contract)
    const [__, artifact] = await this.deps.resolver.resolveArtifact(pxe, instance.currentContractClassId.toString())
    this.deps.logDebug("Register contract")
    await pxe.registerContract({ instance, artifact })
}

const [_, instance] = await this.deps.resolver.resolveInstance(pxe, op.contract)
const [__, artifact] = await this.deps.resolver.resolveArtifact(pxe, instance.currentContractClassId.toString())
```
The `instance`/`artifact` pair is resolved once inside the `if` (to decide/perform registration) and unconditionally again immediately after — an unnecessary extra PXE round-trip whenever the contract wasn't already registered, not just a style issue.

**Refactor:** Resolve `instance`/`artifact` once above the `if`, use the same values both to decide registration and to build the call:
```ts
const [, instance] = await this.deps.resolver.resolveInstance(pxe, op.contract)
const [, artifact] = await this.deps.resolver.resolveArtifact(pxe, instance.currentContractClassId.toString())
const registeredContracts = new Set<string>((await pxe.getContracts()).map((x) => x.toString()))
if (!registeredContracts.has(op.contract)) {
    this.deps.logDebug("Register contract")
    await pxe.registerContract({ instance, artifact })
}
```

**LOC delta:** -5 (plus removes a redundant round-trip)

**Risk / tests:** low — behavior-preserving; `view-executor.test.ts` exercises `executeSimulateUtility`.

**Confidence:** high

---

### F5 [duplication] Four-branch transfer-type switch in `OperationPlanner.buildTransferOperation` is config-shaped

**Where:** `apps/extension/src/wallet/services/execution/operation-planner.ts:124-166`

**Evidence** (one of four near-identical branches):
```ts
case TransferType.Private: {
    if (!token.transferPrivateFn) {
        throw new Error("Transfer type not supported")
    }
    fn = createTokenFn(TOKEN_FN_DESCRIPTORS.transferPrivate, token.transferPrivateFn.name, token.transferPrivateFn.impl)
    args = fn.buildArgs(accountAddress, recipientAddress, amount)
    break
}
```
The other three branches (`PrivateToPublic`, `Public`, `PublicToPrivate`) repeat the exact same shape, differing only in the token field name and the `TOKEN_FN_DESCRIPTORS` entry.

**Refactor:** Replace with a lookup table keyed by `TransferType`:
```ts
const TRANSFER_FN_BY_TYPE: Record<TransferType, { field: keyof Token; descriptor: (typeof TOKEN_FN_DESCRIPTORS)[keyof typeof TOKEN_FN_DESCRIPTORS] }> = {
    [TransferType.Private]: { field: "transferPrivateFn", descriptor: TOKEN_FN_DESCRIPTORS.transferPrivate },
    [TransferType.PrivateToPublic]: { field: "transferPrivateToPublicFn", descriptor: TOKEN_FN_DESCRIPTORS.transferPrivateToPublic },
    [TransferType.Public]: { field: "transferPublicFn", descriptor: TOKEN_FN_DESCRIPTORS.transferPublic },
    [TransferType.PublicToPrivate]: { field: "transferPublicToPrivateFn", descriptor: TOKEN_FN_DESCRIPTORS.transferPublicToPrivate },
}
```
then a single lookup + null-check + `createTokenFn` + `buildArgs` in place of the switch. Preserve the exact `"Transfer type not supported"` / `"Invalid transfer type"` strings.

**LOC delta:** -30

**Risk / tests:** low — `operation-planner.test.ts` has one happy-path test per `TransferType` plus the not-supported/invalid-type cases (lines 84-195), so a behavior change in any branch would be caught.

**Confidence:** high

---

### F6 [duplication] Decode-then-log-on-failure block triplicated in `batched-view-simulation.ts`

**Where:**
- `apps/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:446-463` (`unpackFastArm`)
- `apps/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:486-501` (`unpackSlowArm`)
- `apps/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:514-528` (`awaitUtilityResults`)

**Evidence** (one of three):
```ts
try {
    decoded[tuple.originalIndex] = decodeFromAbi(tuple.returnTypes, values)
} catch (error) {
    logger?.log(
        LOG_SOURCE,
        LogLevel.Error,
        "Failed to decode fast-arm simulation results",
        tuple.returnTypes,
        { returnValueCount: values.length },
        getErrorMessage(error),
    )
}
```
The other two sites are identical except for the log message string and one uses `Array.isArray(values) ? values.length : 0` instead of `values.length`.

**Refactor:** Extract `function decodeInto(decoded: AbiDecoded[], index: number, types: AbiType[], values: Fr[], logger: ILogger | undefined, label: string): void` doing the try/catch + log, called from all three sites with their own label string.

**LOC delta:** -18

**Risk / tests:** low — pure log-and-continue path, no control-flow change. Covered by `batched-view-simulation.test.ts` and `batched-view-mixed-arm.pins.test.ts`.

**Confidence:** high

---

### F7 [duplication] `CollectingDiscoveryProbe.extractEffects` duplicates `AuthwitDiscoverer.discoverPrivateAuthwits`'s effect-processing loop

**Where:**
- `apps/extension/src/wallet/services/execution/discovery-probe.ts:57-95`
- `apps/extension/src/wallet/services/execution/authwit-discoverer.ts:101-129`

**Evidence** — both do: `collectOffchainEffects` → early-return on empty → `node.getNodeInfo()` + `assertLiveChainIdentity` → build `chainInfo` → loop effects in a try/catch computing a `CallAuthorizationRequest` + `computeAuthWitMessageHash` → push an `add_private_authwit` action. `discovery-probe.ts`'s own header says: *"Byte-mirrors `AuthwitDiscoverer.discoverPrivateAuthwits`' effect loop."* — the duplication is acknowledged, not accidental.

**Refactor:** Extract the shared body (effects → chainInfo → per-effect try/catch → action) into a function taking the crypto seam (`fromFields`/`computeMessageHash`) and an optional `seen: Set<string>` for dedup (empty set for the discoverer, since it has no pre-existing dedup need — behavior-neutral to add). Lives in `authwit-discoverer.ts` or a new `authwit-effects.ts`, imported by `discovery-probe.ts`.

**LOC delta:** -20

**Risk / tests:** medium — this is security-sensitive authwit-hash derivation; keep the crypto-injection seam and the live-chain-identity assert byte-identical. Covered by `authwit-discoverer.test.ts` and `discovery-probe.test.ts`, but a refactor here should be reviewed carefully given the "byte-mirrors" contract note.

**Confidence:** medium

---

### F8 [inconsistency] `TransferEstimateReuse.tryConsume` inlines its reject-and-log 7 times; `OperationEstimateReuse.tryConsume` already factored the same idiom into a `reject()` helper

**Where:**
- `apps/extension/src/wallet/services/execution/transfer-estimate-reuse.ts:150-234` (7 sites, e.g. `:156-158`, `:170-172`, `:180-182`)
- `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:177-180` (the `reject()` helper, used at every ladder step)

**Evidence** (transfer-estimate-reuse.ts, repeated pattern):
```ts
this.deps.logDebug(`tryConsumeTransferEstimate ${estimateId}: stale (TTL)`)
return undefined
```
vs. operation-estimate-reuse.ts's already-DRY form:
```ts
private reject(reason: string): undefined {
    this.deps.logDebug(`operation estimate reuse rejected: ${reason}`)
    return undefined
}
```

**Refactor:** Give `TransferEstimateReuse` the same private `reject(reason)` helper and replace its 7 `logDebug(...); return undefined` pairs with `return this.reject("...")`. Purely a logging-plumbing DRY — the validation ladder itself (order, values compared) is untouched, respecting the file's own "each cache keeps its own validation ladder" design note.

**LOC delta:** -10

**Risk / tests:** low — log-message wording changes slightly (drops the `tryConsumeTransferEstimate ${estimateId}:` prefix unless preserved in the new helper); keep the prefix to avoid a log-format regression. Covered by `transfer-estimate-reuse.test.ts`.

**Confidence:** medium

## Not worth it

- `new Gas(nodeInfo.txsLimits.gas.daGas, nodeInfo.txsLimits.gas.l2Gas)` appears 3× in `tx-request-builder.ts` — a single-line expression; extracting a helper would cost more than it saves.
- `TransferExecutor`'s local `markJournal` closure (`transfer-executor.ts:106-113`) structurally resembles `ExecutionLane.markJournal` (`execution-lane.ts:425-432`) but `mark-failed-unless-cancelled.ts`'s own header explicitly documents why the transfer path can't share it (different error-kind tagging, no lane dependency) — intentional divergence, not an oversight.
- `EstimateCancelRegistry.unsettledCount` and `ExecutionMutex.isLocked` are production methods with zero non-test callers (test-only per the dead-code rule), but both are ≤7 lines and explicitly labeled "test/diagnostic surface" in their own doc comments — below the 20-line dead-code bar and clearly deliberate.
- `GasBalanceReader.readPublic`/`readPrivate` share one decode one-liner (`result.encoded[0]?.[0] ? ... : null`) — too small (1 line × 2) to be worth a shared helper.
- The `fee/*-strategy.ts` files' `ctx.op.actions` mutation (`unshift`/`splice`) looks like copy-paste across `fpc-strategy.ts`'s two methods and `fee-juice-with-claim-strategy.ts`, but each mutates a different shape for a different reason (claim payload vs FPC fee payload vs two-pass fee finalize) and the file's own header calls this out as "CAUTION — audited" load-bearing behavior — not a dedup candidate.
- The three estimate-reuse validation ladders (`transfer-estimate-reuse.ts`, `operation-estimate-reuse.ts`) already went through one dedup pass (`estimate-reuse-shared.ts` factors out the TTL cache + pending-hash compare); the remaining per-ladder differences (fingerprint source, FPC identity, chain-identity re-assert) are explicitly documented as intentionally divergent and pinned by tests — not further duplication.
