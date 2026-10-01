# Phase 1 — ExecutionService PXE injectable (client level)

## What landed
- `ExecutionService` gained a defaulted constructor param `pxeClientFactory: (logger) => PxeServiceClient = DEFAULT_PXE_CLIENT_FACTORY`; `init()` now does `this.pxeService = this.pxeClientFactory(this.logger)` instead of `new PxeServiceClient(...)`. One construction site — `this.pxeService` already fanned out to coordinator/executors/builder, so nothing else changed.
- `DEFAULT_PXE_CLIENT_FACTORY` is exported so the construction seam is unit-testable without `init()` + a full `ServiceCollection`.
- New test `service.pxe-seam.test.ts` pins that the default factory builds the real `PxeServiceClient` (codex flagged: the existing suite bypasses construction via private-field injection, so it doesn't cover this).

## Key finding (shapes Phase 2 + the rollout)
`PxeServiceClient extends PxeServiceClientBase extends ServiceClient` — the `ServiceClient` base wires `chrome.runtime` in its constructor. So a fake **cannot subclass** `PxeServiceClient` in vitest. The spike will therefore have the fake implement the used method subset and **cast** it (`as unknown as PxeServiceClient`) at the factory — the house style already does this (`execution-coordinator.test.ts:42` casts `as unknown as IPXE`). For the 8-service ROLLOUT the right move (codex) is to extract a local `ExecutionPxePort` interface that `PxeServiceClient` satisfies, so consumers type to the port and the cast disappears. Deferred — out of spike scope.

## Gate — MET
- `bun run --cwd packages/extension vitest run src/wallet/services/execution/` → 277 passed (+7 todo, 1 skipped), incl. the new seam test. Existing tests green = DI is behavior-preserving.
- `bun run --cwd packages/extension typecheck` → exit 0.
- `bunx biome check` (changed files) → clean.

LESSONS_FILE=implementations-plan/execution-pxe-injection-spike/lessons/phase-1.md
