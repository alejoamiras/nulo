# Codex audit trail — fix-execution-journal (Arc 2)

Mid-tier dual audit: codex xhigh + Fable Plan agent on the plan (both conditional approve, conditions reconciled); one bounded codex xhigh complete-arc-diff pass (initial + 2 fix rounds -> converged).

## Plan audit — codex xhigh (conditional approve)

### B-02

Core `runInSlot` reuse is correct, but `hooks: undefined` is incomplete. `grantPublicAuthwit` explicitly passes `{ originKey: ctx.origin }`; `executeOperations` receives it but drops it for `send_transaction`. Thread hooks through `ExecutionService.executeSendTransaction` and `DappSendExecutor.executeSendTransaction`, otherwise grants share the `__no_origin__` capacity bucket and lose per-origin fairness. UI auth-registry calls legitimately have no hooks.

Without a queued ID, `claimOrCreateJournal` calls the same `beginJournal` with identical network, account, origin, calls, and fence. Journal shape/title/subtitle remain unchanged; controller registration merely moves inside the claim helper. Keep the transaction/authwit closure unchanged. Journal creation moving until after slot acquisition is the intended slot contract.

The callback must retain `markJournal(simulating) → checkCancelled → build → proveAndSend`; ordinary failures remain `pending → simulating → failed`. The scaffold’s earlier post-claim cancellation check only affects cancellation races.

Replace the existing contradictory “ZERO slots—preserve” characterization test. An acquire assertion can RED today, but also pin `originKey` forwarding and release-after-prove.

### B-03

Correct. `start()` executes synchronously until its first await, so a cutoff captured as its first statement precedes the delayed alarm creation and later RPC-listener installation. A row created during that delay has `createdAt >= cutoff` and is protected; prior rows with `createdAt < cutoff` are swept.

An old row created in the same millisecond, or timestamped in the future after clock rollback, is conservatively skipped. That is safer than failing a live operation; periodic reaping eventually handles ordinary equality cases after grace, though large backward clock movement can delay it.

Pass the captured local cutoff into `reap()`. Computing it inside `reap()` would misclassify rows created between `start()` and the sweep. The RED test should gate `alarms.create`, create the live row while `start()` is suspended, then release it; also seed an older row.

### B-19

The proposed regex remains too broad: bare `not supported` and `unimplemented` can describe argument/state failures. Pinned Aztec 5.0.1 emits JSON-RPC `-32601` with `Method not found: …`; its client exposes the code as `error.cause.code`, and BaseWallet checks that code or `"Method not found"`.

Mirror that predicate inline. Add a `cause.code === -32601` fallback test. Dropping bare `"not found"` is correct fail-closed behavior; a nonconforming ancient node may lose fallback availability, but must not silently underprice fees. The `"block not found"` test is genuinely RED today.

No finding is mis-scoped or a non-bug.

conditional approve (conditions)
---

## Complete-arc-diff audit — codex xhigh

### Round 0 — initial (conditional: F-B19-01 null-safe, F-PIN-01 pin gaps)

F-B19-01 — Low. [fee-juice.ts:54](packages/bridge-core/src/fee-juice.ts:54) dereferences `.cause` before optional chaining. A node throwing `null`/`undefined` gets masked by a `TypeError`; the cast provides no runtime safety. Match BaseWallet with an outer optional chain.

F-PIN-01 — Low. The B-02 pins do not prove two reconciled requirements:

- [service.characterization.test.ts:148](apps/extension/src/wallet/services/execution/service.characterization.test.ts:148) only proves release eventually occurred; releasing before `proveAndSend` would pass. Assert invocation order.
- [dapp-send-executor.test.ts:222](apps/extension/src/wallet/services/execution/dapp-send-executor.test.ts:222) injects hooks directly into the executor, so it does not pin [ExecutionService’s forwarding seam](apps/extension/src/wallet/services/execution/service.ts:534).

No other code finding: the no-queued claim delegates to the same `beginJournal` and controller registration; journal-ID binding, failure handling, transaction recording, and pending-authwit recording remain intact. Hooks reach `acquireSlot`; batches hold no outer slot, so no re-entrant deadlock was found.

B-03’s pre-`services.start()` cutoff closes the startup window. Equal/future-dated prior rows are conservatively deferred to periodic grace-based reaping; periodic ticks remain unchanged. B-19’s fallback predicate is otherwise correctly narrow.

Both affected package typechecks and Biome passed. Vitest could not start because the read-only environment rejected its cache writes.

conditional approve (conditions)
### Round 1 — after fixes (F-PIN-01a partial: prove-settlement)

F-PIN-01a — Low, partially resolved. `mock.invocationCallOrder` proves `proveAndSend` was invoked before release, but not that its promise settled first. A buggy `const p = proveAndSend(...); releaseSlot(); return await p` still passes. Use a deferred `proveAndSend`, assert release is absent while pending, then resolve and assert release.

F-B19-01 and F-PIN-01b are resolved; no remaining production-code finding.

Verdict: conditional approve.
### Round 2 — converged

Deferred-prove pin correctly proves the slot remains held until settlement. All prior findings are resolved; no remaining findings.

converged