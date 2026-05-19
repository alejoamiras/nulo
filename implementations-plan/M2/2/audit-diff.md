# M2.2 plan — audit diff

What changed in `plan.md` after the codex + agent audits.

## Changes

1. **Sub-PR order: `a → b, c → d → e → f → g` → `a || c → e → d → b → f → g`** (both audits flagged as blocker). FeeStrategy depends on TxRequestBuilder; TxRequestBuilder depends on AuthwitDiscoverer. a and c can be parallelized across developers.

2. **`FeeEstimateResult` widened from 3 fields to the 8-field bundle** (both audits blocker). Callers at service.ts:340, 663, 1280 destructure an 8-tuple today. Plan now returns `{ txRequest, simulatedTx, gasDetails, feePaymentMethod, account, network, node, pxe, nonce, txCalls }`.

3. **`FeeStrategyContext` gains `buildMode: "standard" | "no_from"`** (codex) — the strategy must know which TxRequestBuilder path to drive. Only FeeStrategy.Embedded accepts `"no_from"`; others throw.

4. **NoFrom no longer conflated with Embedded strategy** (agent + codex alignment). Plan's earlier implicit claim that "FeeStrategy.Embedded drives DefaultEntrypoint" was too narrow. Fix: TxRequestBuilder (M2.2-d) owns BOTH `buildStandard` AND `buildNoFrom` + the NoFrom-specific discovery/scope logic at service.ts:1358-1405. FeeStrategy.Embedded sets `buildMode: "no_from"` to drive the NoFrom path; it doesn't contain the logic itself.

5. **GasBalanceCache ownership: coordinator → facade** (codex). `getGasBalances` is a public RPC (spec.ts:41), not a send-pipeline step. Plan now specifies: facade owns the method body + the cache; coordinator may share the cache or call `invalidateForAccount`.

6. **Error-string preservation: by call site, not collaborator-wide** (codex). Specific example: `"Contract artifact not found for class ${classId}"` at service.ts:2419 is FORMATTED differently from the bare `"Contract artifact not found"` — both must survive verbatim. Add a `test/snapshot` driver.

7. **Preview / shared-builder consumers section ADDED** (codex finding #5): `executeSimulateTransaction`, `executeAztecSimulateTx`, `executeAztecProfileTx`, `executeSimulateViews` are NOT part of ExecutionCoordinator's send pipeline. They consume TxRequestBuilder (M2.2-d) directly, return without proving/sending, and stay on the facade.

8. **Internal `executeSendTransaction`** (service.ts:660-688) explicitly tracked (codex). `AuthRegistryService` calls it directly for revokeAuthwits / setRegistryEnabled. M2.2-f converts it to `coordinator.execute({ kind: "send_transaction", ... })` — document in PR description.

9. **M2.2-g parallel-run scoped to TxExecutionRequest diffing ONLY** (both audits, blocker). Proving + sending uses the authoritative pipeline exclusively. Comparator canonicalizes + hashes first; detailed diff only on mismatch. Shadow pipeline runs asynchronously.

10. **Golden fixture matrix: 9 pipeline shapes, not 4 × 22** (codex). Explicit list added to M2.2-g. Read-only/pass-through ops are redundant.

11. **FPC 2-pass registry-double-write noted as side-benefit** (agent). Current code calls `trackAuthwit` inside `buildTxRequest`; FPC calls buildTxRequest twice → double write. Post-M2.2-e moves tracking post-send, dedupping. Mention as side-benefit in M2.2-e PR description.

12. **Codex Q3 confirmed**: zero mid-flow popup reads of registry state. Side-effect timing change is safe.

## Still open / decisions at execution time

- Planner's `plan(op)` dispatcher style (big switch vs dispatch map).
- GasBalanceCache location inside `execution/` — new file vs inline on facade. Plan recommends new file.
- Whether to split M2.2-b into interface+helpers (landed early) + impls (land after d). Allowed if M2.2-b gets too big; default: single PR.
- Parallel-run comparator hash function (canonical JSON string vs dedicated serializer).

## Verdict flip

Codex: No Go → Go (after 5 fixes, all incorporated).
Agent: Go with 3 must-fix → all incorporated.
