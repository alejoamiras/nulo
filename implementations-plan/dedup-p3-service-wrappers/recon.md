# Recon — dedup-p3-service-wrappers

Phase 0.4 for this plan is the dedup ledger (`implementations-plan/dedup-ledger/ledger.md`, evidence under
`reports/`), re-verified against this worktree on 2026-09-07 (branch `worktree-dedup-p3-service-wrappers`,
on top of P2 / PR #566). No further agents were fanned out. Counts below are `grep` results in the tree.

## Reuse map

| Id | Capability | Existing code (verified) | Verdict | Sites |
|---|---|---|---|---|
| D1 | typed RPC passthrough client | `definePassthroughsExhaustive` (`@nulo/extension-messaging/background`), used by 16 of 23 `client.ts` files | reuse-as-is | `profile/client.ts`: 22 hand-written `return this.request(...)` forwards |
| G1 | validate → request → validate | `validateParams`/`validateResult` + `NetworkMethodSchemas` (`network/spec.ts`) | adapt: one private `call<K>()` on the client | `network/client.ts`: 16 methods |
| D2 | prefixed raw-row codec (key, parse, scan, corrupt-id partition) | none shared; four classes (`TombstoneRepository`, `RestorePendingRepository`, `AccountIntegrityBlockedRepository`, `AccountIntegrityVerifiedStampRepository`) hand-roll it (searched `startsWith(prefix)`, `safeParse(JSON.parse`) | build new: `RawPrefixedStore<T>` in `apps/extension/src/wallet/utils/raw-prefixed-store.ts`, per-repo wrappers keep their public API and fail-closed semantics | 3 files, 4 classes |
| D3 | passkey credential → recovery record | none; byte-identical 6-line tail ×4 | adapt: private `toRecovery(credential)` | `profile/passkey-recovery-coordinator.ts` (5 `deriveMasterSecret` calls, 4 tails) |
| D4 | PXE call with the service's error envelope | none; identical try/catch ×5 (`"PXE request failed"` ×5) | adapt: private `viaPxe(networkId, action, fn)` | `account-state/service.ts` |
| C1 | record a sent tx | none; byte-identical closure ×2 | adapt: private `recordSentTx(ctx)` | `execution/dapp-send-executor.ts` |
| C2 | run a step under a task span | `startEstimateTask` (`execution/fee/fee-strategy.ts`) covers the start only | adapt: `runTaskStep(task, fn)` in `execution/task-step.ts`; sites whose catch does more than `task.fail(error); throw error` stay | `execution-coordinator.ts` (3 `task.fail`), `tx-request-builder.ts` (2), `fee/*-strategy.ts` (5); `rpc-cancel.ts`'s 2 are its own contract, excluded |
| C5 | transfer type → token fn | `TOKEN_FN_DESCRIPTORS` + `createTokenFn` exist; the 4-case switch is config-shaped | adapt: `TRANSFER_FN_BY_TYPE` table | `execution/operation-planner.ts` (4 cases) |
| C6 | decode ABI values or log | none; ×3 (`Failed to decode` ×3) | adapt: `decodeInto(...)` module-private | `execution/helpers/batched-view-simulation.ts` |
| F1 | tolerant field reads on a note | none; 8 `private safe*` one-liners | adapt: two module-level `safeString(read)`/`safeNumber(read)` | `note/service.ts` |
| F2 | resolve the 9 token fn kinds | `TOKEN_FN_DESCRIPTORS`, `getTokenFnCandidates`, `getDefaultTokenFn`, `TokenFnKind` exist | adapt: loop over the kind list into two maps; the `TokenInterface` literal stays explicit | `token/service.ts` `parseTokenInterface` (9 pairs) |
| F3 | delete a balance row and invalidate it | none; ×3 (`invalidatedBalanceIds.add` ×3) | adapt: private `deleteAndInvalidate(row, emitAs)`; loops keep their filters and epoch fence | `token-balance/service.ts` |
| E4 | stop watching a window handle | none; byte-identical block ×2 | adapt: private `stopWatching(handle)` | `window-manager/window-manager.ts` |
| E6 | log, terminate, return false | none; ×3 | adapt: local `terminateWith(msg)` | `wallet-sdk/session-established.ts` |
| X4 | epoch-fenced poll scheduler | none; ×2 | adapt: private `startPollScheduler(key, poll, label)`; both epoch comments move onto it | `incoming-transfer/service.ts` |
| B1 | flag-gated scope check | `grantsOfType`, `inAddressList` exist; 5 bodies repeat | adapt: two checker factories (`contractsAddressChecker(method, flag)`, `addressBookChecker(method)`), exported names and error strings unchanged | `wallet-bridge/method-scope-checkers.ts` |
| B2 | registry projection | none; six reducers | adapt: `deriveRecord`/`deriveSet` module-private; six exported names unchanged | `wallet-bridge/method-descriptors.ts` |
| B3 | dispatcher logging | `ILogger.log(source, level, …)` only | adapt: private `logDebug`/`logWarn` | `wallet-bridge/dispatcher.ts` (7 `"wallet-sdk",` calls) |
| B5 | require a dApp session | none; ×6 | adapt: private `requireSession(dappSession, ctx)` | `wallet-bridge/dispatcher.ts` |
| A1 | prefix scan of entity rows | none; ×5 (`const path = \`${this.root}@\`` ×5) | adapt: private `scopedEntries()` | `wallet-core/src/storage/entity_storage.ts` |
| A3 | listener bag for test fakes | none; push/splice ×12 across two files | build new: `createListenerBag<T>()` in `wallet-core/src/testing/listener-bag.ts`; the messaging harness wraps it into the Chrome `{addListener, removeListener}` shape | `wallet-core/src/testing/fake-browser-api.ts`, `extension-messaging/src/testing/transport-harness.ts` |
| H2 | wait for profile activation | `awaitProfileActivation` (`composables/unlockWait.ts`, 3-signal) ⊃ `waitForProfileActive` (2-signal) | reuse-as-is: delete the subset and its test; `import.vue` repoints | `composables/waitForProfileActive.ts` (+ test), `popup/pages/import.vue` |
| H4 | C1 composable lifecycle | the folder's convention (`dispose()` exposed, parent calls it) | adapt: return `{ showFullscreen, start, dispose }`; `PopupCard.vue` keeps the order | `composables/fullscreenPopupSetting.ts` (5 lifecycle hooks) |
| I1 | block until a session key clears | none; ×3 | build new: `waitForStorageRelease(key, opts)` in `src/e2e/storage-gate.ts` (e2e-only module) | three `src/e2e/chrome-storage-*-gate.ts` |
| I2 | compression format ↔ ext/mime | none; 3 switches | adapt: one `COMPRESSION_FORMATS` table | `utils/files.ts` |

## Conventions to match

- Package order `wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension`; every new piece lives beside its only consumers (no new cross-package edge).
- `client.ts` files: declaration-merged interface + `definePassthroughsExhaustive` name list; the factory's type check fails to compile when a `Methods` key is missing from the list.
- Frozen error strings (`"Contract not found"`, `"Scope violation: …"`, `"PXE request failed"`, `"No dApp session found for origin …"`, `"Transfer type not supported"`) are asserted by tests; every refactor keeps them byte-for-byte.
- Complexity budgets: no new `biome-ignore`; a function brought under budget loses its directive and the manifest is regenerated in the same PR.

## Collision / dedup risks

- D2's four repositories were audited for "a corrupt row still blocks / still reserves its id"; the shared codec must expose the raw id set separately from the parsed payloads so those call sites keep reading the raw set.
- C2 must not touch `rpc-cancel.ts` or any catch that calls `maybeRethrowAsRpcCancel` (its header forbids reshaping those catch sites).
- H2: `import.vue` currently receives `Error("Profile activation timeout")`; `awaitProfileActivation` rejects with `UnlockTimeoutError` / `BootstrapFailedError` — the page's catch must be checked for message-text coupling before the swap.
- I1's gates are e2e-only seams; the helper must stay under `src/e2e/` so the production bundle's negative grep keeps passing.
