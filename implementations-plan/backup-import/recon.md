# Recon: backup-import

Base `48a97f4a` (`dev` `a7b1ff62` plus #718, the same tree as `f32b1e0a`), re-checked after the
round-1 audits against `85c4d20f` (#719 merged), whose changed files were read with `git show`.
Read-only. `importChainSync.test.ts` holds 11 tests (source count; the draft's run of them is not
re-run here). #719 changes no file under `apps/extension/src` that this plan touches; it adds
`keepChainAccountState` (`tests/e2e/helpers/backup-export.ts:53-63`) and its two call sites.

**Superseded after round 1**: rows 1 and 3 of the reuse map and the first convention below
proposed dropping rebuilt contracts inside the normalizer and deleting the service's `"protocol"`
arm. The plan does the opposite (plan § B1): the entries stay; one leaf predicate serves
`registrableNetworkIds`, and the service keeps its network-first throwing parse and compares the
parsed value.

**Corrected after the final codex pass**: a fresh balance read cannot prove an import restored a
network, because the read registers what it needs by itself
(`apps/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:269-281`); the
new spec reads back a restored sender instead. The service resolves, not rejects, on a
registration failure (`account-state/service.ts:321-326`), so retry eligibility reads the
resolved result too. A Retry keeps the normalizer's violation rows (`normalize.ts:157-198`).

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| One trust boundary for the hostile account-state slice, shared by the popup's tail and the service | `normalizeAccountStateSlice`, `apps/extension/src/wallet/services/account-state/normalize.ts:96-123`, with `mergeItemChildren` `:149-171` (where each contract is admitted) | **superseded** (plan § B1): **reuse-as-is**; the entries stay (the first reading was to drop rebuilt contracts while children merge) |
| "Which networks have work" (drives the probe and the registration call) | `registrableNetworkIds`, `normalize.ts:206-208` | **adapt**: counts only senders and contracts the leaf predicate does not mark PXE-provided, so a network holding only those is neither probed nor booted |
| The protocol-contract skip (address ≤ 6) | `precheckContractAddress`, `account-state/service.ts:464-476`, branch at `:405` | **superseded** (plan § B1): **adapt**: the service keeps its network check and throwing parse, then compares the parsed value through `isPxeProvidedAddress`; the ≤ 6 rule moves verbatim into the leaf module (the first reading deleted the service's arm) |
| The addresses the PXE preloads | `@aztec/standard-contracts` address-only leaf exports (`package.json` exports `:11-14`): `auth-registry/constants`, `multi-call-entrypoint/constants`, `handshake-registry/constants` (with `HISTORICAL_STANDARD_HANDSHAKE_REGISTRY_ADDRESSES`); already a declared dependency (`apps/extension/package.json:49`) and already imported by `apps/extension/src/wallet/utils/auth-registry.ts:2` | **reuse-as-is** |
| Proof that the set matches what the PXE preloads | `getDefaultStandardPreloadedContracts`, `@aztec/standard-contracts@5.2.0 dest/preloaded/index.js:8-20`, built "without performing any hash computations" (`dest/make_standard_contract.js:5-8`), so it is bb-free and can run in vitest | **reuse-as-is** in a pin test |
| Connectivity preflight per network | `preflightNetworkConnectivity`, `apps/extension/src/composables/importPreflight.ts:67-81` (already concurrent, 3 workers, one shared deadline) | **reuse-as-is**, called once per network with one id |
| Bounded registration with a single record | `runImportChainSync`, `apps/extension/src/composables/importChainSync.ts:48-110`: ONE `restore` call over every network (`:95-103`), a timeout marks every network (`:108`) | **adapt**: one pipeline per network (its probe, then its registration call as soon as the probe answers, raced at the shared remainder), recorded once after all settle; `record` tagged `"violations"` or `"outcomes"`; returns the retryable ids, a resolved connectivity-class failure included (`isConnectivityErrorMessage`, `normalize.ts:213-219`) |
| Per-launch deadline on the service side | `AccountStateService.restore`, `account-state/service.ts:278-333` (clamp `:290-292`, `expired` checked before every launch `:378`, `:410`) | **reuse-as-is**: it already accepts any subset of items |
| Cross-chain concurrency in the PXE host | `withPxeWrite`, `packages/aztec-runtime/src/pxe/service.ts:989-1013`: a shared per-profile barrier READ plus a per-(profile, chain) WRITE guard (`getChainGuard`, `:189`) | **reuse-as-is**: two chains' registrations do not serialize |
| Skip-record shapes and copy | `skippedNetworkRecord` and the three `ACCOUNT_STATE_SKIP_*` constants, `normalize.ts:39-41`, `:223-225` | **reuse-as-is**: no new copy |
| The errors sink | `recordRestoreErrors` (appends), `apps/extension/src/composables/useFullBackupImport.ts:763-774`; `collectAccountStateErrors`, `apps/extension/src/utils/full-backup-helpers.ts:341-375`; `isRestoreHasErrors` counts keys (`useFullBackupImport.ts:750`) | **reuse-as-is** for the first run; a Retry rebuilds the account-state key from kept violation rows plus outcome rows, and deletes it when empty |
| Unit harness for the tail | `makeDeps` / `run` in `importChainSync.test.ts:18-47` (fake timers, per-call recording) | **reuse-as-is**: the new cases give `restoreImpl` per-network behaviour |
| Unit harness for the service | `restore-surface.pins.test.ts:15-58` (fake `pxeService` with `registerContract` spy) | **reuse-as-is** |
| Browser reproduction of a stalled PXE boot | `import-dead-rpc.test.ts` STATEFUL case (`:306-330`): a stub answers the probe, then blackholes `aztec_getL1ContractAddresses`; `interceptRpc` redirect (`tests/e2e/fixtures/browser/index.ts:29`), Chrome only (`import-dead-rpc.test.ts:274`) | **reuse-as-is** for the uncommitted capture spec (P3, P4) |
| Retry after a stall (option B only) | none: `grep -rn "retry" apps/extension/src/composables/importChainSync.ts full-backup-restore.ts useFullBackupImport.ts` finds only the rollback retry (`ROLLBACK_MAX_ATTEMPTS`, `full-backup-restore.ts:55`) and comments about re-reading a backup after a failed attempt (`useFullBackupImport.ts:344`, `:416`); nothing re-runs the tail | **build new** (O1 (B), now recommended and built): `retryAccountStateStage` beside `restoreAccountStateStage` (`full-backup-restore.ts:435-456`), re-running `runImportChainSync` over the retained items of the retryable networks |
| Replay safety for Retry | upstream `addContractInstance` (address-keyed `set`, `@aztec/pxe@5.2.0 dest/storage/contract_store/contract_store.js:102-105`); `addSender` returns early for a known sender (`dest/storage/tagging_store/tagging_secret_sources_store.js:25-32`) | **reuse-as-is**: a replayed registration writes the same values |
| The Retry button's host screens | popup `import.vue:270-285` and onboarding `import.vue:205-222`, both through `useProfileImportFlow` (`:382-420`) | **adapt**: one button each, members passed through |
| RPC stub for the stall | `startStub` and the node-info answer, local to `tests/e2e/import-dead-rpc.test.ts:172`, `:315` | **adapt**: move to `tests/e2e/helpers/rpc-stub.ts`, chain-parameterized, for the new network spec |
| Backup re-seal after doctoring | the same two lines after `backup-restore-integrity.test.ts:153` and `backup-migration-roundtrip.test.ts:112` at `85c4d20f` | **adapt**: one `sealPlainBackup` in `helpers/backup-export.ts`, also used by `crash-truth.ts` and the new spec |
| Proof the healthy network was restored | the Senders page (`popup/pages/settings/advanced/account-state/senders/index.vue:44`, `getSenders` for the active network; rows `sender-row` with `data-sender-address`, `:103`), as `tests/e2e/network/senders-advanced.test.ts:34-41` waits for it | **reuse-as-is**: the new spec reads back a sender only the restore can register |
| A fresh balance read after import | `captureBalanceBaseline` and `waitForFreshBalanceRow`, used by `backup-restore-integrity.test.ts` step 5 | **reuse-as-is** in the new spec, as a usability check only (it registers what it reads) |
| Disabled buttons while Retry runs | onboarding's mount harness, `apps/extension/src/onboarding/pages/import.test.ts:1-40`; the popup page has none | **adapt**: one onboarding case; the popup's assertion runs in the stall spec |
| Deferral to the first network switch (option C only) | none: no persisted pending-slice key under `apps/extension/src/wallet/services/account-state/`, and no switch hook that registers backup content | **build new**, only if the owner picks C (not recommended: a new persisted key holding hostile, multi-megabyte artifacts, with its own deletion and purge lifecycle) |

## Conventions to match

- The normalizer is "the ONE trust boundary both consumers share" (`normalize.ts:1-9`) and never
  adds a per-entry record (bounded violations only). **Superseded** as a placement argument (plan
  § B1): the classification is a leaf module both consumers call, deriving nothing from slice
  content except the parsed address. Protocol contracts are skipped silently (no result entry,
  `restore-surface.pins.test.ts:61-79`); preloaded ones follow suit.
- The tail never throws and records through one structural point (`importChainSync.ts:9-14`).
  Per-network pipelines keep that for one tail run: normalizer violations keep their own earlier
  record (`:54`), every pipeline settles by the shared deadline, then one `record` call carries
  every network's outcome, and no pipeline touches the sink. The two calls are tagged so a Retry
  replaces outcomes only.
- Hostile-input comparisons parse before they compare (`precheckContractAddress` parses with
  `AztecAddress.fromStringUnsafe(...).toBigInt()`); a parse failure keeps today's error path.
- Complexity: `runImportChainSync` is a production function at 62 lines; the per-network launch
  goes in its own helper so neither function passes 80 lines or cognitive 15.
- No logging is added above `debug`. The existing warn lines are not payload-free: the service's
  registration-failure line interpolates the truncated exception text (`service.ts:342`), and the
  sink warns with the projected records (`useFullBackupImport.ts:771`); the budget line
  (`service.ts:437-440`) names the network id and counts. The plan adds nothing to either.
- Tests colocated, fake timers as in `importChainSync.test.ts:49-55`; the service harness stubs
  `pxeService` directly.

## Collision and dedup risks

- **`useFullBackupImport.test.ts:944-971`** asserts ONE `restore` call carrying both networks'
  items. Per-network calls make it two; its real subject (items take the seeded id of their
  chain) is kept by asserting each call's items.
- **The e2e restore gate** (`apps/extension/src/e2e/chrome-storage-restore-gate.ts:39-56`) holds
  every `restore` call that reaches `waitAt("account-state")`. `network/backup-restore-sw-restart`
  (`:371-374`) arms it and kills the worker once held; with several calls, each holds and all die
  with the worker. Its scenario B stays a local gate.
- **#719's filter** (`keepChainAccountState`, `tests/e2e/helpers/backup-export.ts:53-63` at
  `85c4d20f`; called at `backup-restore-integrity.test.ts:153` and
  `backup-migration-roundtrip.test.ts:112`) stays: after this plan a stalled public network still
  ends on the errors screen (partial, not total), and `importFullBackup` waits for the success
  route. Start from #719's merged state. `backup-restore-sw-restart` exports unfiltered through
  `helpers/crash-truth.ts:113-136` and is `@requires-proverless` (`:36`) and Chrome-only (`:89`);
  the plan applies the same filter there.
- **Other wave-2 plans**: none named as overlapping in the brief. The two import pages gain the
  Retry button (O1 (B)); `apps/extension/src/components/composite/import/ImportFullBackupForm.vue`
  is touched only if the owner picks O2's named copy.
- **Chrome-only file list**: `apps/extension/tests/e2e/FIREFOX.md:28`, `:42` and CLAUDE.md § In CI
  name the Chrome-only files; the new stall spec joins them (`CHROME_ONLY.cdpFetch`).
- **Dedup**: the protocol rule exists once today (`service.ts:475`) and moves into the leaf
  module, it is not copied; the service keeps only its parse.
  The preloaded addresses come from upstream constants, not a second hand-kept list; the pin test
  ties them to `getDefaultStandardPreloadedContracts`.
- **Bundle**: the popup gains `@aztec/standard-contracts/handshake-registry/constants`, which
  computes one `sha256ToField` at load (`dest/handshake-registry/constants.js`). The package is
  already bundled (SW side), so the third-party notices do not change; P1's build confirms it.
