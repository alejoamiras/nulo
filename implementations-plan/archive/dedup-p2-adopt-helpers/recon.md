# Recon — dedup-p2-adopt-helpers

Phase 0.4 for this plan is the dedup ledger itself: fourteen cluster reviewers read every non-test source
file in scope and jscpd ran over the same tree (`implementations-plan/dedup-ledger/ledger.md`,
transcripts with quoted evidence under `reports/`). No further agents were fanned out. The reuse map below
restates the 17 P2 rows as capability → existing code → verdict, with every helper re-verified against
the worktree on 2026-09-07 (branch `worktree-dedup-p2-adopt-helpers`, on top of P1 / PR #561).

## Reuse map

| Capability | Existing code (verified) | Verdict | Sites |
|---|---|---|---|
| error → message string | `errorMessageFromUnknown` — `packages/wallet-core/src/utils/errors.ts:8`, exported by `@nulo/wallet-core/utils` | reuse-as-is | X2: 39 inline `err instanceof Error ? err.message : String(err)` sites in 30 files (`grep -rnE 'instanceof Error \? \w+\.message : String\(\w+\)'`, tests excluded), incl. `packages/wallet-core/src/migration/migrator.ts:454` (`message()`), `migration/staging.ts:17`, `base/index.ts:85`, `packages/extension-messaging/src/core/base-client.ts:211`, 7 in `packages/aztec-runtime/src` |
| deferred promise | `deferred<T>()` — `packages/wallet-core/src/utils/rw-guard.ts:20-26`, module-private today (native `Promise.withResolvers()` is typed by TS 6.0.3 but the Firefox floor is unpinned) | adapt: promote to `packages/wallet-core/src/utils/deferred.ts`, exported | X3: `packages/wallet-core/src/utils/rw-guard.ts:20-26` (`deferred<T>()`), `apps/extension/src/wallet/services/execution/execution-mutex.ts:114-118`, `wallet-sdk/session-baton.ts:26-30`, `window-manager/window-manager.ts:69-75`, `wallet/utils/offscreen.ts:10-13`, `wallet-sdk/background.ts:779-783` |
| base64 ⇄ bytes | `toBase64`/`fromBase64` — `packages/wallet-core/src/utils/encoding.ts:21,34`, re-exported at `@/wallet/utils` | reuse-as-is | X6: `src/composables/useFullBackupImport.ts:391` (decode), `src/wallet/services/dapp-session/integrity.ts:50-52` (encode only — its decoder stays permissive on purpose; secret-key sites in account/profile services deliberately excluded) |
| copy + toast | `copyToClipboard` — `apps/extension/src/utils/clipboard.ts:30` (primitive); `copyAddressToClipboard` — `src/components/header-copy-address.ts:11` (one wrapper, one caller) | adapt: add `copyWithToast(value, openToast, successLabel, opts?)` beside the primitive; the address wrapper delegates to it | X1: 17 `copyToClipboard(` SFC/composable sites, each repeating the same `failure: { label: "Couldn't copy", icon: "warning", duration: 3_000 }` branch |
| collision-free random id | `nextRandomId(storage: { contains(id): Promise<boolean> }, length = 8)` — `apps/extension/src/wallet/services/id-allocators.ts:39` | adapt: add a sync sibling `randomIdNotIn(taken: (id) => boolean, length)` in the same file for all three sites (`startNewTask` and `openAndAwait` are synchronous; the dApp-interaction loop is synchronous inside a lock) | E1: `window-manager/window-manager.ts:65-68`, `task/service.ts:47-50`, `dapp-interaction/service.ts:371-374` |
| supersedable-run fence | `createRunFence()` — `apps/extension/src/composables/runFence.ts:13` (adopters: `popup/network-switch.ts`, `RecentActivityView.vue`) | reuse-as-is | H3: `src/composables/useProfileBootstrap.ts:43,124-127`. J5 (`export/account.vue`, `export/full.vue`, `accounts/import.vue`) SKIPPED: those pages capture without incrementing, `begin()` increments — not the same fence |
| new-password validity + hint | none — the 4-branch hint and the ≥8-and-matching predicate are inlined in 6 files (searched `strengthHint`, `passwordHint`, `isAllowedToContinue`, "At least 8 characters") | build new: `apps/extension/src/utils/password.ts` (`isNewPasswordValid`, `newPasswordHint`) — justified by 6 verbatim copies | H1: `useProfileCreateFlow.ts:50-65`, `useProfileImportFlow.ts:281-289`, `useFullBackupImport.ts:743-751`, `settings/security/change-password.vue:54-66`, `composite/import/ImportSecretForm.vue:27-31`, `ImportFullBackupForm.vue:26-30` |
| resolve instance+artifact or throw | `requireArtifact(instances, artifacts, address)` — `execution/tx-request-builder.ts:546` (module-private) | adapt: move to `execution/contract-resolver.ts` as an exported function, error strings frozen | C3: `tx-request-builder.ts:322-329`, `authwit-discoverer.ts:142-149,191-198`, `helpers/batched-view-simulation.ts:609-612,650-652` |
| reject-and-log in an estimate-reuse ladder | `OperationEstimateReuse.reject(reason)` — `execution/operation-estimate-reuse.ts:177-180` | adapt: same private helper on `TransferEstimateReuse`, keeping the `tryConsumeTransferEstimate ${estimateId}:` prefix | C8: `execution/transfer-estimate-reuse.ts:150-234` (7 sites) |
| incoming-card props | none shared; two verbatim copies; both callers already import `receivedLabel`/`resolveReceivedType` from `apps/extension/src/utils/received-display.ts:30,45` | adapt: `buildIncomingCardProps(inc, token, amountFiat)` in `received-display.ts` | L4: `general/RecentActivityView.vue:246-256`, `activity/TransactionsList.vue:83-93` |
| "fee comes embedded from the dApp" predicate | the booleans live inline in wallet-bridge's `requiresFeeSelection` (`packages/wallet-bridge/src/operation-validation.ts:29`), repeated in `dapp-interaction/materialize.ts:84`, `execute/index.vue:295-329` and `OperationCard.vue:73-78` | adapt: export `isEmbeddedFeePayment(op)` from wallet-bridge beside the gate; the popup shim re-exports it | K2 |
| log-data formatting | `formatLogData` — `src/components/JsonViewer/logs-format.ts:44` | reuse-as-is | M7: `components/JsonViewer/logs-csv.ts:52` `computeData()` |
| logger fan-out with context | `LoggerStore.logWithContext` — `src/wallet/logger/store.ts` | reuse-as-is (`log()` delegates) | G2 |
| FunctionCall construction in `simulate()` | the two branches build the identical call | hoist | G3: `src/wallet/utils/fn.ts` |
| patch one account field | `changeAccountName` / `changeAccountVisibility` — `src/wallet/services/account/service.ts` | adapt: private `patchAccountField(id, field, value)` | D5 |
| read a storage map with `{}` default | three inline `(await storageLocalGet(K))[K] \|\| {}` | local `readMap(K)` helper in the SFC | L6: `modules/send/FeeSettingsCard.vue` |

## Conventions to match

- Package order `wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension`; helpers live in the lowest layer that has every consumer above it. Nothing here adds a new cross-package dependency.
- Extension UI layers L0–L6 / C0–C1: `utils/password.ts` and `utils/clipboard.ts` are plain modules importable by composables and SFCs alike; `recent-activity-rows.ts` and `operation-validation.ts` are colocated L4/L5 helpers already unit-tested.
- Tests colocate as `<name>.test.ts`; new helpers get one small test file each; call-site tests already exist and stay the regression net.

## Collision / dedup risks

- X2 must target `errorMessageFromUnknown`, not `getErrorMessage` (line 29 of the same file): the latter carries a documented type-lie and an `"Unknown error"` fallback that must not change.
- H1's helper overlaps M5 (P5 will also touch the import forms' password-toggle button); P5 reuses `utils/password.ts` rather than re-adding a hint.
- J5 must reuse `createRunFence()`; the pages reviewer proposed a new `useGenerationFence()` composable — rejected as a second copy of the same idea.
