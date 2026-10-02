# Recon — bootstrap-route-decouple (Phase 0.4)

Base: dev @ `d5eda02` (includes #356, the e2e-deflake arc). Main-agent inline trace (§A) +
three Explore fan-outs (§B token-balance, §C restore-atomicity, §D e2e/env/timeouts).

## §A — Main-agent inline trace: the import critical path (root-cause correction)

Traced end-to-end this session; the load-bearing citations:

- **Popup bootstrap is storage-bound.** `useProfileBootstrap.bootstrapActiveProfile`
  (`apps/extension/src/composables/useProfileBootstrap.ts:67-90`): `getProfiles` (storage),
  `initNetworks` (storage; seeds carry hardcoded chainIds — `network/service.ts:82-109,204-235`;
  `syncNetworkStatus` is chain-bound but NOT awaited, `useProfileBootstrap.ts:49`), `initAccount`
  → `ensureDefaultAccount` (storage + local derivation, `account/service.ts:139-170`),
  `setupActiveAccount` (storage, `app.store.ts:63-96`), `syncTransactions` → SW storage read
  (`transaction/service.ts:128-130`), final lock-wins `getActiveProfile` re-read (storage under
  the profile facade mutex).
- **RPC dispatch is not gated on service startup**: `BaseService.handleRequest` invokes directly
  (`packages/extension-messaging/src/core/base-service.ts:81-126`); only methods calling
  `ensureInitialized` wait, and `TransactionService.getTransactions` does not.
- **The import critical path** (`useFullBackupImport.restoreBackup`,
  `apps/extension/src/composables/useFullBackupImport.ts:208-722`):
  trust gates (checksum → compat-epoch → schema-version) → in-memory migration →
  `profileService.restore` → `networkService.restore` (+ active-network pointer) →
  `accountService.restore` (+ provenance filters) → `tokenService.restore` (+ balance re-link) →
  loop: transaction/token-balance/auth-registry/fpc/contact/config `.restore` (all storage) →
  **`profileService.finalizeRestore`** (session open — storage+crypto only,
  `profile/service.ts` `finalizeRestore` under `runExclusive`; EMITS `onActiveProfileChanged`,
  so the popup bootstrap runs CONCURRENTLY from here) →
  **`accountStateService.restore(slice, createdNetworks)` (AWAITED — the chain-RPC-bound leg)**
  → `restoreStatus = "finished"` → if no errors, `completeImport` → `waitForProfileActive(30s)`
  → `router.push("/popup/general")`.
- **The chain-RPC dependency**: `AccountStateService.restore`
  (`wallet/services/account-state/service.ts:211-270`) calls `pxeService.registerSender` /
  `registerContract` per item; the offscreen boot for a network's first PXE touch runs
  `createChainRuntime` → **`await node.getL1ContractAddresses()`**
  (`packages/aztec-runtime/src/pxe/chain-runtime.ts:157`) before the store even opens. Per-item
  failures are caught into `restoreError` (`account-state/service.ts:240-245,261-269`).
- **PXE client default ceiling ~90s/call** (`packages/aztec-runtime/src/pxe/client.ts:94-103` —
  overrides only proveTx/clears to 30min; the default is referenced as "the default 90s
  ceiling"). Exact default number: §D.
- **The no-auto-route gap**: `isRestoreHasErrors` → the flow skips `completeImport`
  (`useFullBackupImport.ts:686-700`); the import page renders Continue + View Errors
  (`popup/pages/import.vue:308-321`) and waits for a click. Clicking Continue calls
  `completeImport(importedProfile)` (`import.vue:166` Enter path, `:311` button) — by then the
  session is open and the bootstrap has flipped `isLogined`, so `waitForProfileActive` resolves
  instantly.
- **Error-record shape (AUDIT-CORRECTED — adapt, not reuse-as-is)**: `collectRestoreErrors`'s
  account-state branch consumes per-SENDER/per-CONTRACT `restoreError` only
  (`utils/full-backup-helpers.ts:77-85`); item-level `restoreError` is DROPPED (both auditors —
  the original recon phrasing here planted plan Fact 5's error). Synthesized skips need either
  child-level errors or a collector top-level check (plan adopts the latter + guards).
  `toRestoreError` normalizes to string (`utils/restore-error.ts:13`).
- **Unlock / cold-open / SW-restart-recovery / network-switch** are all storage-bound on this
  tree (auth.vue unlock → bootstrap; `hydrateKnownProfile`; network watcher) — no RPC gate.
- **Existing network-down surface**: header status dot (`components/Header.vue:241`, driven by
  `appStore.networkStatus` ← `getNodeStatus`, `app.store.ts:144-153`).

## §B — Token-balance pipeline + TokenCard (Explore agent, sonnet)

**Pipeline files**: `wallet/services/token-balance/{service,balance-job-queue,balance-projector,
balance-repository,spec}.ts`. Trigger: `refreshTokenBalance(id)` → `queue.enqueue`
(`service.ts:142-148`); also `requestBalanceRefresh` (causal-ack, `service.ts:160-177`),
settled-tx refresh (`service.ts:268-312`).

**The swallow point (the ledgered gap, confirmed)**: `BalanceJobQueue.syncBatch`
(`balance-job-queue.ts:120-184`) — on projector `kind === "error"`: `tasks.failTask(...); continue`
(`:142-144`) — **no `repo.set`, row (incl. `updatedAt`) untouched**. Pinned by test
`balance-job-queue.test.ts:243-258` ("projector error surfaces as task failure; no storage
write") — that test MUST be consciously updated by the fix. Outer catch (`:166-178`) same shape.
The only failure signal is a TaskService record — **in-memory `Map`, never persisted, 60-min TTL,
lost on SW restart** (`task/service.ts:32,145-154,219-221`; `task/spec.ts:6`). No retry anywhere.
No failure event: `onTokenBalanceUpdated` fires only on success (`balance-job-queue.ts:164`).

**Row schema (additive-safe)**: `TokenBalanceRaw` `{id, token, account, publicBalance?,
privateBalance?, updatedAt}` + zod `TokenBalanceRawSchema` (plain `z.object`, strip-unknown)
(`spec.ts:11-28`). Storage root `nulo:core:token-balances@${id}` (`spec.ts:9`). Adding optional
fields is additive both directions (`EntityStorage.decodeRow` keeps-but-hides invalid rows,
`packages/wallet-core/src/storage/entity_storage.ts:61-83`). Shape-pinning tests to update:
`storage-codecs.test.ts:95-101` corpus (add the new field to the `full` fixture),
`balance-repository.test.ts`, `service.test.ts:141-153` (restore path).

**Gas-pipeline contrast (the shape to mirror)**: `execution/gas-balance-reader.ts` —
`legWithRetry` single retry after 1.5s (`:216-229,33`); degraded-cache marks entry pre-stale
(`:208-209`). `stores/balances.store.ts` — slices carry `status: "idle"|"fetching"|"ready"|
"degraded"`, `lastError?: string`, `retryDebt`, SWR display retention (`:52-72,437-450`), backoff
`INIT_RETRY_BACKOFF_MS = [5000,10000,20000,30000]` (`:116,559-599`). NOTE: gas failure record is
in-memory; the token row is chrome.storage-persisted — the failure fields go ON the row.
Best persisted-failure-schema precedent: `JobError`/`JobErrorSchema`
(`operation-journal/spec.ts:202-206`).

**TokenCard dead branch (confirmed)**: `isUpdating` arrives as an AD-HOC mutated field on the
`tokenBalance` object (not a declared prop) — set/cleared by TokensView task handlers
(`TokensView.vue:80-89,106-117,136-145,169,290`). The "Refreshing balance..." description branch
(`TokenCard.vue:63-71`, line 67) renders only inside the `isInitialSync`-gated loading block
(template `:104`), unreachable when `isUpdating` is set post-initial-sync → NO visual difference.
Pinned by `TokenCard.test.ts:82-93` ("no loader") — rewrite when adding the DOM state. NOTE:
`isMinting`'s description has the same dead-branch issue (flag; out of scope unless trivial).

**Reuse-as-is**: `JobError` schema shape for a `lastError` field; `TokenImportRow.vue` failed
pattern (red `close-circle`, `.failed { opacity: 0.7 }`, `data-testid="token-import-failed"`,
parent 30s retention `TokensView.vue:42,52-64`); `GasBalanceCard.vue` pulsing `.refreshing_dot`
(`data-testid="gas-balance-refreshing"`, style `:191-200`) + `.amount_stale { opacity: 0.55 }`
(`:240-242`).

**Existing testids**: `token-balance-loading`, `token-catching-up`, `token-balance-shimmer`,
`token-import-failed`, `balance-amount`, `gas-balance-refreshing`. No `token-balance-failed` /
`token-refreshing` yet — greenfield naming.

**Collisions flagged**: (1) failure commit should decide whether to reuse `onTokenBalanceUpdated`
or add a failure event — `TokensView.onBalanceUpdated` (`:179-184`) is the only popup-side row
refresher; (2) the ad-hoc `isUpdating`/`isMinting` mutation convention (not declared props) —
follow for minimal diff, flag as smell; (3) BalanceView has its own independent
`isRefreshingBalance` blink (`BalanceView.vue:158,175-214,255-261`, template `:336`).

## §C — Restore-atomicity boot check (Explore agent, sonnet)

**Restore ordering is popup-side JS, no SW transaction**: every `.restore()` is an independent
round-trip; rollback = closure variables `createdProfileId`/`finalizeStarted`
(`useFullBackupImport.ts:319-324,702-719`) — if the POPUP context dies (not just the SW), no
rollback fires at all. The observed torn shape (ledger entry 3; e2e comment in
`backup-restore-sw-restart.test.ts:170-229`): profile+account rows survive un-finalized with
token/balance slices missing (census `{tokenRows:0, accountRows:2}`).

**No restore-in-progress marker exists.** The only in-flight machinery is the DELETION tombstone
(`PROFILE_TOMBSTONE_ROOT = "nulo:core:profile-tombstones"`, `profile/tombstone-repository.ts:4`
— written under the facade lock before the row delete, cleared after full purge). A torn-restore
profile is indistinguishable from a normal needs-unlock profile to every read path
(`ProfileService.getProfiles`, `service.ts:234-238`); on reopen the popup routes to auth and a
NORMAL unlock succeeds into the broken state — and `initAccount`'s `ensureDefaultAccount`
(`useProfileBootstrap.ts:53-60`) **silently mints a brand-new default account** where accounts
are missing (the silent-repair failure mode to intercept).

**Marker placement (recommended)**: SW-side — write a `restore-pending` raw key inside
`ProfileService.restore()` under the SAME `runExclusive` write that lands the profile row
(`profile/service.ts:1284,1332-1353`), clear it inside `finalizeRestore`'s success path
(`service.ts:1477,1513-1528`), and delete it with `deleteProfile`. Exactly the tombstone
precedent; survives popup death. Page-side marker = same fragility as the existing rollback.

**Detection machinery to mirror (reuse-as-is patterns)**: `AccountIntegrityCoordinator`
(`account-integrity/coordinator.ts`) — registered last (`runtime.ts:249`),
`setIntegrityDelegate` pre-session-open chokepoint (`profile/service.ts:771`, called inside
`openSessionVerified` under the facade lock) + fire-and-forget `verifyRestoredSessionOnce` boot
one-shot (`coordinator.ts:63-86`, exposes `bootVerification` for tests); durable raw-storage
blocked record (`blocked-repository.ts:17-50`, fail-closed, never auto-removed); stamp repo to
skip re-checks. UI: `AccountIntegrityBarrier.vue` — dumb observational overlay reading raw
storage + `onChanged`, auth/register routes exempted (`:17`), mounted `popup/app.vue:268`.
`MigrationBarrier` is the boot-fails-closed precedent (`runtime.ts:118-155`).

**Torn invariants detectable WITHOUT a marker** (weaker, heuristic — the marker is the precise
signal): profile with zero networks (composable guarantees ≥1, `useFullBackupImport.ts:406-415`);
networks but zero accounts (no guard exists — and unlock silently repairs); token-balance rows
with dangling token/account refs; account-state registrations present with zero token-balance
rows for that chain (the observed shape). Authoritative slice manifest:
`backup/backup-migration-registry.ts:191-212`.

**Collisions flagged**: needs its OWN storage root (`nulo:core:restore-*` — never reuse
integrity/tombstone roots, the barriers prefix-filter); must NOT reuse `deletionState.isReserved`
(would hide the profile instead of surfacing); a second full-screen barrier can double-block /
race `AccountIntegrityBarrier` (same route-exemption tension: the heal path is delete+re-import
via settings); boot sweep can race a LIVE mid-restore marker (a legitimately in-flight import) —
detection must not false-positive on an active restore; `useFullBackupImport` is dual-shell
(popup + onboarding) so any barrier may need `onboarding/app.vue` mounting too (only
MigrationBarrier is mounted there today, `:89`). Test shape: real `ServiceCollection` +
`FakeBrowserApi` + `svc()` composition harness (`account-integrity/coordinator.test.ts:1-19`).

## §D — E2E + env wiring + timeout facts (Explore agent, sonnet)

**Timeout ground truth (three independent envelopes)**:
- Node RPC: `DEFAULT_REQUEST_TIMEOUT_MS = 60_000` per attempt (AbortController,
  `packages/aztec-runtime/src/utils/fetch.ts:18,34-77`) × `retry(makeBackoff([1,2,3]))` = 4
  attempts, worst case **~246s per node call** on a HANGING RPC; **connection-refused fails in
  ~ms** (+ ≤6s backoff between attempts).
- Popup→SW messaging default: **60s** (`extension-messaging/src/background/client.ts:17,43`).
  ⇒ TODAY, a hanging-RPC import dies at ~60s when the popup's `accountStateService.restore`
  RPC times out → outer catch → "Import failed" + `restoreStatus=""` — a THIRD parked/dishonest
  shape (import storage-succeeded + session open, UI claims failure).
- SW→offscreen default: **90s** (`extension-messaging/src/offscreen/client.ts:20,37`); PXE
  client overrides only proveTx/clears to 30min (`aztec-runtime/src/pxe/client.ts:69,94-103`).
- `getNodeStatus(networkId)` → `_getChainId` → `createNode(rpcUrl).getNodeInfo()`
  (`network/service.ts:544-558,836-847`) — inherits the FULL node envelope; no caller budget.
  `NodeFactory.createNode` has no timeout param (`ports/node-factory-port.ts:23-25`; single
  call site lint-enforced; FakeNodeFactory double at `core/testing/fake-node-factory.ts`).
- **`withTimeout(promise, ms, label)` exists** — `stores/balances.store.ts:123-137`,
  auto-imported repo-wide; races the await WITHOUT cancelling underlying work (documented).
  Sibling budget precedents: `INIT_FETCH_TIMEOUT_MS = 20_000`, backoff `[5s,10s,20s,30s]`.

**Env-pin pattern**: `E2E_DEFAULT_ACTIVE_TESTNET` reads `import.meta.env.VITE_NULO_E2E_DEFAULT_NET`
(`network/service.ts:80`); sibling `VITE_LOCAL_NETWORK_RPC_URL ?? "http://localhost:8080"`
(`:72`) is the direct template for a `VITE_NULO_E2E_TESTNET_RPC_URL`. No vite `envPrefix`
customization needed. Smoke CI sets pins at `.github/workflows/_smoke-e2e.yml:70-75`; agent.sh
stamps them for network builds (`scripts/e2e/agent.sh:66-104`). Never-ships guard for URL pins =
absence-of-env + `?? <prod literal>` (no bundle-grep exists for URL literals; the stamp-grep
guard is for marker strings).

**KEY FINDING — the env override may be unnecessary**: `buildSyntheticBackup`
(`tests/e2e/helpers/import-drivers.ts:287-336`) embeds `network[0].rpcUrl`
(default `process.env.AZTEC_NODE_URL ?? localhost:8080`) — **the account-state registration leg
dials the RESTORED network's rpcUrl (from the backup), not the seeded active network**, so a
synthetic backup carrying a dead URL fully controls the dialed endpoint with ZERO product lines.
Canonical refused literal: **`http://localhost:1`** (`endpoints.test.ts:159-162` — reliably
refuses cross-platform; passes `isAllowedRpcUrl` http+loopback,
`aztec-node-factory-adapter.ts:41-45`). For the BLACKHOLE variant: no listener precedent exists
in e2e; `net.createServer().listen(0)` (OS-assigned port) avoids the parallel-agent port-collision
concern. Check whether buildSyntheticBackup supports an account-state slice; extend test-side if
not.

**Smoke conventions**: build `dist/chrome` via `build:chrome` with the e2e pins
(`global-setup-smoke.ts:8-11`; local re-arm recipe in e2e-testing SKILL.md:298-299); vitest
smoke `retry: 2` hardcoded, `testTimeout: 60_000` default — per-test override needed
(`vitest.e2e.config.ts:19-41`); helpers mandatory (`clickByTestId`/`replaceInputValue`/
`patchPagePolling` — tests/e2e/README.md:139-158); route waits poll `location.hash` + trajectory
recorder pattern (`backup-roundtrip.test.ts:124-135`). Budget comments verbatim: file budget
900s = export 120s + import nav 300s + convergence 240s (`:33-37`); driver 300s = "30s bounded
recovery + slow-runner restore + margin" (`import-drivers.ts:179-182`); `waitForActiveAccount`
240s = node-client 60s×backoff envelope (`:194-200`) — don't conflate the two rationales
(dual-audit-caught attribution).

**Collisions flagged**: implementing the RPC override/dead-RPC e2e RESOLVES e2e-deflake Fix 1's
OPEN item — update that ledger, don't fork it; `NodeFactory.createNode` signature changes ripple
to interface + adapter + FakeNodeFactory in lockstep (avoid — probe popup-side instead);
`_getChainId` is shared by 4 call sites — never mutate its timeout default; the new dead-RPC
test must use per-test isolation fixtures (not the shared `registeredExtension`) and must pass
WITHOUT vitest retries (no disguised raises).

## Consolidated reuse map (feeds the draft + every audit)

- **Reuse as-is**: `collectRestoreErrors` account-state branch; Continue/View-Errors screen;
  `withTimeout`; `http://localhost:1`; `buildSyntheticBackup`/`writeBackupToTemp`/import
  drivers; `JobError` schema shape; TokenImportRow failed pattern; GasBalanceCard refreshing
  dot + stale dim; tombstone-repository write-under-lock pattern; AccountIntegrityCoordinator
  delegate + boot-one-shot + barrier idiom; composition-harness test shape.
- **Adapt**: `useFullBackupImport.restoreBackup` (preflight + budget + skip synthesis);
  `BalanceJobQueue.syncBatch` error path (persist failure record);
  `TokenBalanceRaw`/schema/Info (+ optional failure field); TokenCard (isUpdating dot + failed
  state); `ProfileService.restore`/`finalizeRestore`/`deleteProfile` (restore-pending marker);
  smoke `backup-roundtrip.test.ts` post-submit wait (causal Continue branch); import.vue
  (testids for Continue/View Errors).
- **Do NOT touch**: `_getChainId` defaults; `NodeFactory.createNode` signature; trust-gate
  order/rollback bookkeeping/P7 discipline in `useFullBackupImport`; deletion tombstones;
  `deletionState.isReserved` semantics; CI gates; the 90s smoke bound.
