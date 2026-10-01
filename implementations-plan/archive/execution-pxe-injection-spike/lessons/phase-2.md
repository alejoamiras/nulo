# Phase 2 — Dumb fake client + composition harness

## What landed
`service.composition.test.ts` — an in-process harness that boots the REAL ExecutionService graph via `ServiceCollection.start()`, mirroring the existing precedent (`ProfileService.integration.test.ts`, `IncomingTransferService.scenarios.test.ts`): dep stubs are plain objects `{ name: XService.name, dependencies: [], <called methods>, async start(){} }` added via `collection.add(stub as never)`. The PXE is the Phase-1 factory → a `fakePxeClient` whose `getPXE()` returns a dumb `fakeIPXE` (just `proveTx`, cast `as unknown as IPXE`). Node/journal/task are light stubs.

## KEY FINDING (changes the rollout order)
`executeTransfer`'s FRESH-build path (`buildStandard`) is **deep** to fake — `tx-request-builder.ts:112-171` validates the node's chain identity (`getNodeInfo`), resolves contracts via PXE, and builds the txRequest via the account contract + artifacts. Faking all that = "a second wallet" (codex's #1 failure mode). **The unlock:** `TransferExecutor.execute(req, precomputedEstimateId)` has a fast path (`transfer-executor.ts:136-168`) that REUSES a cached built txRequest and SKIPS `buildStandard` entirely. So the composition test seeds `estimateReuse.stash(id, entry)` with a fully-matching entry (`tryConsume` validates byte-for-byte against the req + node base-fee + endpoint + profile + pending — all controllable; `fingerprintFeeSettings`/`fingerprintBaseFee` are exported) → `executeTransfer` reaches `proveAndSend` with NO buildStandard. ⇒ **Rollout implication: the execution path's FRESH-build is the hardest target; bring it under the layer LAST (or via seeded pre-built txRequests). The zero-test services the coverage agent flagged (Token/Fpc/DappSession) are the right FIRST targets — their boundary really is just PXE/node/storage.**

## Non-prod boundary (codex condition #3) — proven, not by convention
The fakes live in the `*.test.ts` itself, so they're unreachable from prod entrypoints. Proven: `bun run --cwd packages/extension build:chrome` (exit 0) then `grep -r FAKE_IPXE_BUNDLE_MARKER dist` → **0 files**.

## Gate — MET
execution dir 278 tests green · typecheck 0 · biome clean (after `--write` line-wrap) · build:chrome 0 + marker absent from `dist`.

LESSONS_FILE=implementations-plan/execution-pxe-injection-spike/lessons/phase-2.md
