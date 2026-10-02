# b06-network-pxe-transport — codex

Scope read:

- Orientation: `CLAUDE.md`, `ARCHITECTURE.md`, `implementations-plan/lessons.md`; supplied `_outer.md`, `packages-high.md`, and relevant `packages-low.md` map sections; quality-run leads; both prior bug reports and the August 24 adjudication.
- `apps/extension/src/wallet/services/network/{service,client,spec}.ts`
- `apps/extension/src/wallet/services/pxe/{client,shallow-port}.ts`
- `apps/extension/src/offscreen/index.ts`, `apps/extension/src/presto/{client,config}.ts`, `apps/extension/src/wallet/utils/offscreen.ts`
- `packages/aztec-runtime/src/pxe/{service,client,chain-runtime,chain-coordinates,opfs-store,proxy,descriptors,public-events,artifact-registry,artifact-class-id,known-artifacts,effective-class,note-schemas,async-memo,lifecycle-coordinator,stale-anchor}.ts`
- `packages/extension-messaging/README.md`; `src/background/{client,service}.ts`, `src/offscreen/{client,service}.ts`, `src/core/{base-client,base-service,error-response,decode,initialization,sender-auth,service-client-factory}.ts`, `src/{errors,utils,zod-helpers}.ts`
- `packages/wallet-core/src/utils/{lock,rw-guard}.ts`, `packages/wallet-core/src/jobs/{fsm,error,types}.ts`
- Immediate handoff sections: `apps/extension/src/stores/app.store.ts`, `apps/extension/src/wallet/services/account-state/service.ts`, `apps/extension/src/wallet/services/profile/{service,require-active-profile}.ts`, `apps/extension/src/wallet/services/execution/{service,view-executor}.ts`, account/transaction error specifications, `apps/extension/src/utils/chain-ids.ts`, and `packages/wallet-bridge/src/dispatcher.ts`.
- Relevant tests: network `service.test.ts`; execution `view-executor.test.ts`; PXE `boundary-refactor.pins.test.ts` and `client-recovery.pins.test.ts`; messaging `base-client-readiness.test.ts`.
- Installed dependency contract excerpts: `packages/aztec-runtime/node_modules/@aztec/pxe/src/pxe.ts`, its private-execution oracle, and embedded Noir source in `@aztec/noir-contracts.js/artifacts/token_contract-Token.json`.

Verification was source-based. No files were modified and no tests or services were run.

## b06-network-pxe-transport-X-1: [Major] Changing Local Network’s endpoint causes false chain-mismatch status and incomplete exports

**Title:** Local Network status loses the local-chain identity override.

**Severity:** Major.

**Repro confidence:** High.

**Type:** wrong result.

**Counter-example:** Start with the seeded Local Network (`kind: "local"`, `chainId: 0`, `l1ChainId: 31337`). Change its primary endpoint from `http://localhost:8080` to a working local node at `http://localhost:18080`. The node reports the matching L1 identity and a rollup version whose XOR composite is nonzero—for example, `31337 ^ 1 = 31336`. `updateEndpoint()` accepts this because it supplies the `"local"` hint. Subsequently, `getNodeStatus()` returns `InvalidChain` for the same healthy endpoint. Exporting account state then omits this network’s contracts and senders.

**Violated invariant:** Local Network uses wallet chain ID `0` independently of its configured URL. Endpoint mutation honors this at `apps/extension/src/wallet/services/network/service.ts:647`; the sibling bounded status probe explicitly honors it at `:753`.

**Failing path:**

1. `apps/extension/src/wallet/services/network/service.ts:647` — `updateEndpoint()` probes with `peek.kind`, accepting the local endpoint.
2. `apps/extension/src/wallet/services/network/service.ts:734` — `getNodeStatus()` calls `_getChainId(primary.rpcUrl)` without `network.kind`.
3. `apps/extension/src/wallet/services/network/service.ts:1008` — without the hint or original seed URL, `_probeChainIdentity()` falls through to the XOR composite at `:1010`.
4. `apps/extension/src/wallet/services/network/service.ts:735` — compares that nonzero composite against stored `0`, returning `InvalidChain`.

Immediate consumers:
- `apps/extension/src/stores/app.store.ts:495` publishes the incorrect status.
- `apps/extension/src/wallet/services/account-state/service.ts:221` skips the chain during backup.
- `apps/extension/src/wallet/services/account-state/service.ts:101` skips its senders during cross-network sender export.

**Expected vs actual behavior:** A reachable replacement endpoint on Local Network remains `Active`, and its recovery material remains exportable. Instead, status becomes `InvalidChain` and export paths omit that chain’s state.

**Recommended fix:** Pass the existing kind hint: `_getChainId(primary.rpcUrl, network.kind)`.

**Instances:** Root defect: `apps/extension/src/wallet/services/network/service.ts:734`. Affected consumers: `apps/extension/src/stores/app.store.ts:495`; `apps/extension/src/wallet/services/account-state/service.ts:101` and `:221`.

## b06-network-pxe-transport-X-2: [Major] Transaction profiling omits the sender required for private-log emission

**Title:** `profileTx` does not provide `senderForTags`.

**Severity:** Major.

**Repro confidence:** High.

**Type:** bad error path.

**Counter-example:** An authorized dApp profiles a valid, registered upstream Token’s `transfer_to_private(recipient, 1n)` using account A, sufficient balance, `profileMode: "gates"`, and `skipProofGeneration: true`. Nulo constructs scopes beginning with A, but forwards no `senderForTags`. The transfer prepares a partial note with on-chain private delivery and no sender override. Its sender lookup returns `None`, causing the contract assertion beginning `"Sender for tags is not set"` to fail.

**Violated invariant:** Private-log-emitting transaction execution requires the wallet’s sender address. Nulo documents and supplies `scopes[0]` for this purpose in the sibling `proveTx` and `simulateTx` paths at `packages/aztec-runtime/src/pxe/service.ts:481` and `:582`. Profiling runs the same private execution and needs the same input.

**Failing path:**

1. `apps/extension/src/wallet/services/execution/view-executor.ts:403` — `executeAztecProfileTx()` calls profiling with scopes `[accountAddress, ...additionalScopes]`.
2. `packages/aztec-runtime/src/pxe/client.ts:300` — `PxeServiceClientBase.profileTx()` forwards the request over RPC.
3. `packages/aztec-runtime/src/pxe/service.ts:621` — `PxeService.profileTx()` constructs upstream options containing only `profileMode`, `skipProofGeneration`, and `scopes`.
4. Installed upstream `packages/aztec-runtime/node_modules/@aztec/pxe/src/pxe.ts:1107` receives `senderForTags === undefined` and passes it into private execution at `:1138`. Its private-execution oracle returns `Option.none()` at `src/contract_function_simulator/oracle/private_execution_oracle.ts:195`, triggering the bundled contract’s sender assertion.

**Expected vs actual behavior:** Profiling returns a `TxProfileResult` for the valid transaction. Instead, it rejects during private execution, even though Nulo’s simulation and proving siblings supply the required sender.

**Recommended fix:** Add `senderForTags: scopes[0]` to the upstream profiling options, matching the established account-first scope convention.

**Instances:** Root omission: `packages/aztec-runtime/src/pxe/service.ts:621`. Production entry supplying the account-first scopes: `apps/extension/src/wallet/services/execution/view-executor.ts:403`.

## Leads adjudicated

- **q04 — `setActiveNetwork` without a primary endpoint: rejected.** The conditional write can accept an already-inconsistent stored row, but no normal-operation producer of that row was established. Network creation constructs a matching primary endpoint; deletion protects the primary and last endpoint; primary selection requires an existing endpoint. A permissive read codec alone is insufficient evidence.
- **q13 — plain-`Error` subclasses lose identity across RPC: rejected.** The flattening is real and explicitly documented. Neither `ImportedAccountUnusableError` nor `TxConfirmationTimeoutError` has a production client-side identity check that consequently fails; their messages survive. The imported-account identity check found is in-process, before serialization.

## Routed to security

None confirmed.

## Non-findings considered

- **Missing-primary-endpoint lead:** requires an inconsistent row without a demonstrated normal-use creation path.
- **Plain-error identity lead:** no demonstrated incorrect client behavior; message-only transport is the documented fallback.
- **Prior B-07:** OPFS opens now quarantine timed-out workers and refuse a second same-directory open.
- **Prior B-15:** request deadlines now cover transport readiness; synchronous port-open failures terminate without a retry loop.
- **Prior B-17:** PONG waits for service readiness, timeout closes are joined, and Firefox frame generations fence stale readiness messages.
- **Prior B-18:** chain purge now advances its epoch at both ends of successful destruction.
- **Prior N-11:** ownership tickets prevent stale lock release; the network lock disables its watchdog for intentionally long purge operations.
- **PXE state retained across profile switches:** explicitly intentional; runtime/store coordinates include both profile and chain.
- **Submitted-transaction endpoint caching:** retaining the submission URL after endpoint changes is intentional.
- **Network/profile lock inversion candidate:** profile deletion runs the purge outside its facade lock.
- **Late or duplicate RPC responses:** settlement removes the pending entry and clears its timers; subsequent settlement is inert.
- **Chromium ghost-document READY race:** explicitly accepted in `apps/extension/src/wallet/utils/offscreen.ts:340`; no greater impact established.
- **Registered-contract upgrade fallback:** the unsupported-upgrade limitation is explicitly documented in `packages/aztec-runtime/src/pxe/effective-class.ts`.

## Cross-rebuttal (codex on claude)

**1. Overconfident / wrong in Claude’s findings**

- **b06-network-pxe-transport-C-1 — Partially agree.** The defect is confirmed: `getNodeStatus()` omits the local-kind hint at `apps/extension/src/wallet/services/network/service.ts:734`. I retain **Major**, because `apps/extension/src/wallet/services/account-state/service.ts:221` consequently excludes a healthy chain’s contracts and senders from backups; this affects recovery, beyond the incorrect indicator. Confidence: **high** on mechanism, **moderate** on severity.

**2. Rejected leads**

- **Missing primary endpoint — agree with rejection.** Normal mutations preserve the invariant: primary selection checks membership at `apps/extension/src/wallet/services/network/service.ts:713`, and endpoint deletion protects the last/primary endpoint at `:693` and `:696`.
- **Plain-error identity loss — agree with rejection, but correct the rationale.** Claude’s “nothing anywhere discriminates on the class” is inaccurate: `apps/extension/src/wallet/services/account/service.ts:391` checks `instanceof ImportedAccountUnusableError`. That check occurs before serialization, so it does not establish the proposed RPC bug.

**3. What Claude missed that I found**

- **b06-network-pxe-transport-X-2 — still confirmed, Major; confidence: high.** `packages/aztec-runtime/src/pxe/service.ts:621` omits `senderForTags` when calling upstream `profileTx`, although the caller supplies account-first scopes at `apps/extension/src/wallet/services/execution/view-executor.ts:406`. Profiling a valid Token `transfer_to_private(recipient, 1n)` with sufficient balance reaches private-log emission without a sender and fails its sender assertion. The installed PXE passes the missing value into private execution at `packages/aztec-runtime/node_modules/@aztec/pxe/src/pxe.ts:1138`; its oracle returns `None` at `src/contract_function_simulator/oracle/private_execution_oracle.ts:195`. Supplying `scopes[0]`, as Nulo’s simulate/prove siblings do, closes the omission.

**4. What BOTH missed**

No additional issue met the concrete-counter-example threshold in this light pass.