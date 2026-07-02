# Codex audit — ExecutionService PXE-injection spike (xhigh)

Session `019ee004`. Verdict: **conditional approve**. All conditions adopted (see plan.md "Codex audit" section). Paths rewritten repo-relative.

## Findings

- **Prod-fake guard too weak for a rollout pattern.** `packages/extension/tsconfig.json` includes all `src/**/*.ts`, so a fake under `src/testing` is isolated from production only by convention, not by the type/build graph. The repo already documents that test-only branches need explicit bundle hygiene (`packages/extension/src/wallet/runtime.ts:120`). "Default factory + grep" is weaker than that precedent.
- **Assumptions overstated the abstraction boundary.** `ExecutionService` does not consume PXE only through `IPXE`: `TxRequestBuilder` is typed to `PxeServiceClient` and calls `getPXE(...)` (`packages/extension/src/wallet/services/execution/tx-request-builder.ts:88`), `ViewExecutor` depends on the concrete client (`view-executor.ts:50`), and the facade directly calls client-level methods `getContractInstance`/`getContractArtifact`/`registerContract`/`registerSender`/`registerAccount` (`service.ts:466+`). `IPXE` is sufficient only for the prove/simulate leg.
- **"Behavior-preserving, proven by existing execution unit tests" not established.** Part of the suite bypasses `ServiceCollection.start()` and private-field-injects internals (`service.characterization.test.ts:12`), so it does not exercise the new construction/init seam.
- **`cancel-mid-prove` is a good story only via the real `ExecutionService.executeTransfer` + `cancelJob`** — otherwise it re-tests what `execution-coordinator.test.ts:120` already pins. A dumb shaped `TxProvingResult` suffices for transfer-only cancel, but NOT for dApp-send, which reads `provedTx.publicInputs` + `getOffchainEffects()` (`dapp-send-executor.ts:378`).

## Facts / Inferences / Asks (codex)
- Facts confirmed: coordinator cancel checkpoint real + after prove (`execution-coordinator.ts:164`); `cancelJob` journals-first then aborts (`execution-lane.ts:136`).
- Inferences: `IPXE`-level faking safe only for the narrow transfer proof. `PxeServiceClientBase`-factory seam is acceptable for the spike; the better long-term seam is a local `ExecutionPxePort` (rollout, not spike).
- Asks: pin the story to `executeTransfer`/`cancelJob`; state the test does not validate real PXE/PXEProxy; strengthen the prod-fake guard beyond grep.

## Verdict (verbatim)
`conditional approve (with conditions: scope the spike to transfer/cancel via the real service API; do not present IPXE as the full ExecutionService seam; and add a stronger non-prod boundary for FakeIPXE than "grep no prod import".)`

All three conditions + the construction-seam finding are adopted in plan.md (verified against code before adopting).
