# Phase 4 — dApp estimate→confirm reuse

## What shipped

- **`operation-fingerprint.ts`**: canonical, type-tagged, length-prefixed encoder over the post-planner/pre-discovery/pre-payload action set + FULL FeeOptions (incl. `teardownGasLimits` + `maxPriorityFeesPerGas`) + `executionMode` + `opts.from` + wallet FeeSettings. Exhaustive `never`-guarded switches (action kinds AND authwit-content kinds); strict nested-value allowlist with reject-unsupported (`null` ⇒ reuse-ineligible, never a lossy hash); depth-capped.
- **`operation-estimate-reuse.ts`**: the generalized cache — audited transfer-cache philosophy (single-shot, TTL, lazy fail-closed ladder) + the audit-pinned additions: consume-time chain-identity re-assert (injected `assertLiveChainIdentity` closure — the reused request skips `buildStandard`'s live assert), resolved-FPC identity snapshot revalidation `{id,type,address,chainId,isProtocol}`, post-send bookkeeping fields (`txCalls`, `pendingPublicAuthwits`) on the entry, live handles excluded.
- **Executor**: `estimateOperationFee` stashes (best-effort) + returns `estimateId`; `executeAztecSendTx` consumes inside `runInSlot` after the `simulating` transition — a hit skips discovery + build and re-resolves all four live handles; the post-send tail (`addTransaction` + `recordPendingAuthwits`) runs identically on hit and miss.
- **Envelope**: `approveInteraction(id, ops, origin, estimateIds?)` — popup-privileged 4th arg, index-aligned; `executeOperations` threads per-op ids. `packages/wallet-bridge` untouched (audit F-5/boundary requirement).
- **Popup**: approve collects ids from the estimate map + hands off cancellation; reject calls `cancelAll` explicitly (window teardown alone isn't guaranteed to run dispose — F-10 eviction happens via the cancel registry's settled-stash mapping).
- **Eligibility narrowed vs the plan text**: `aztec_sendTx` standard-mode fj/fpc ONLY. `send_transaction` is additionally excluded (discovered during implementation): its confirm path (`executeSendTransaction`) skips authwit discovery entirely today, so consuming a discovery-inclusive estimate would CHANGE its confirm behavior — exactly what this plan promised not to do. Recorded for the codex post-impl audit to weigh.

## Gotchas

- The service-side `defineRpcMethods` list is a THIRD registration surface for a new RPC (spec Methods + client passthrough list + service rpcMethods) — the two compile-time exhaustiveness guards cover spec/client only.
- Biome `format` errors (not just lint rules) fail `bun run lint` — run `bunx biome format --write` on new files before gating.
- Three DappSendExecutor test harnesses (unit, invariant, characterization) construct full deps objects and all needed the new fields.

## Gate result: PASS

- Targeted: `operation-fingerprint.test.ts` 8/8, `operation-estimate-reuse.test.ts` 14/14 (every ladder exit incl. same-batch pending drift, chain-identity drift, FPC in-place-edit drift, single-shot), `dapp-send-executor.test.ts` 30/30 (consume-hit pin: discovery+build skipped AND `recordPendingAuthwits` called with the entry's grants — the fable F-3 silent-break scenario; miss→full-pipeline; no-id→no-consume).
- `bun run lint` exit 0 · `bun run typecheck:all` 13/13 · `bun run test` 305 files / 3813 passed.
- **Milestone network e2e**: `bun run e2e:agent tests/e2e/network/tx-sendTx-default.test.ts tests/e2e/network/tx-sendTx-sponsoredFpc.test.ts` → 2 files / 2 tests passed in 139 s (real approve flow: estimate in the execute window → estimateIds envelope → consume-or-rebuild → real proof accepted).
