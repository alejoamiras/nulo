# Phase 8 — one metadata read

## I1 — verified
The metadata getters' descriptors build `isStatic: true` ABIs; impl 0 is `PUBLIC`, impl 1 is `PRIVATE`
(`token/functions/descriptors.ts`, `metadataDescriptor`). `batchedViewSimulation` therefore serves them:
- impl 0 → the whole batch is the PUBLIC + static + no-hidden-sender leading prefix → ONE direct-to-node
  `simulateViaNode` ("pure PUBLIC+isStatic batch → simulateViaNode only", "fast-arm dispatches once total
  per helper invocation" in `batched-view-simulation.test.ts`).
- impl 1, a missing anchor, or a fee-options failure → ONE combined `pxe.simulateTx` ("all-private calls →
  1 simulateTx", "block-header anchor missing → silent FULL fallback").
Before: three sequential `simulate(...)` calls, each its own `getNodeInfo` + `buildTxExecutionRequest` +
a turn in the PXE's serial queue.

## What shipped
- `fetchTokenMetadata` builds the present getters' calls and issues one `batchedViewSimulation`; the
  fallbacks (`<name>`, `<symbol>`, `0`, fee-juice constants) and the per-getter `unpackResult` decoding
  are unchanged. `persistToken` / `parseTokenInterface` untouched.
- `buildViewCall(contract, viewFn, args)` in `wallet/utils/fn.ts` — the utility-by-name /
  tx-by-selector call shape that `BalanceProjector.enqueueCall` had inline; both now share it.
- `simulate(...)` (and `extractReturnValues`) deleted from `wallet/utils/fn.ts`: the metadata read was
  its only caller.

## Decisions
1. **Deps are built inline, not through `getViewSimulationDeps`.** That helper resolves the ACTIVE
   profile; `fetchTokenMetadata` takes an explicit `profileId` (the seeder passes the one it fenced), and
   swapping it for "whoever is active now" would be a behavior change on a security-relevant path.
2. **`TokenService` owns a `ContractResolver`.** It is stateless (logger only). Reaching for the
   execution service's instance would be a dependency cycle — `ExecutionService` depends on `TokenService`.
3. **Decoding equivalence.** The old path flattened every nested return value of the simulated tx before
   `unpackResult`; the helper hands `unpackResult` the call's own values. For a getter that makes no
   nested call these are the same fields.
4. Precondition unchanged: the contract is registered in the PXE by `parseTokenInterface`
   (`ensureRegistered`) before the read, which both the old and the new path need.

## Attempts
1. Test fixture: a field-compressed string needs a zero top byte ("greater or equal to field modulus").
2. `std::bad_cast` from `poseidon2Hash`: a real `FunctionSelector` is Barretenberg, which the unit layer
   does not load. Mocked `fromNameAndParameters` exactly as `balance-projector.test.ts` does.

## Gate (as written in plan.md)
- `bun run typecheck:all` — exit 0
- `bun run lint` — exit 0
- `bun run --cwd apps/extension test src/wallet/services/token src/wallet/services/execution` — exit 0
  (60 files passed, 1 skipped; 822 tests passed, 7 todo — the `token` filter also matches `token-balance`)
