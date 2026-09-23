# Repo map — extension services A: `{account,account-integrity,account-state,auth-registry,backup,passkey,profile,profile-deletion}` + storage/config/utils/crypto + storage facade

## 1. Module inventory

| Module | Path | Purpose | LOC |
|---|---|---|---|
| `profile` service | `apps/extension/src/wallet/services/profile/service.ts` | Facade over profile CRUD, unlock/lock, export/import/restore, password change, integrity/deletion delegate wiring. The security-critical core. | 2691 |
| `profile` session manager | `.../profile/session-manager.ts` | In-memory `ActiveSession` + persisted `Session` mirror in `chrome.storage.session`; TTL alarms, strict-mode bearer gating, silent restore. | 859 |
| `profile` spec | `.../profile/spec.ts` | `Profile`/`Session`/`ActiveSession`/`RestoreSecret` shapes, RPC `Methods`/`Events`. | 391 |
| `profile` repository | `.../profile/repository.ts` | CRUD over `nulo:core:profiles` (`EntityStorage`, `requireKeyIdentityMatch: true`). | 108 |
| `profile` tombstone repo | `.../profile/tombstone-repository.ts` | Delete-in-progress markers over raw `storage.local` (`nulo:core:profile-tombstones`), fail-closed reservation. | 93 |
| `profile` restore-pending repo | `.../profile/restore-pending-repository.ts` | Restore-in-progress markers (`nulo:core:restore-pending`) gating unlock against torn imports. | 93 |
| `profile` deletion state | `.../profile/profile-deletion-state.ts` | In-memory reserved-id set + per-profile deletion epoch fence (D13). | 77 |
| `profile` passkey recovery coordinator | `.../profile/passkey-recovery-coordinator.ts` | Wraps `PasskeyService` into create/recover/confirm. | 118 |
| `profile` require-active-profile | `.../profile/require-active-profile.ts` | `getActiveProfile()`-or-throw guard. | 33 |
| `profile` client | `.../profile/client.ts` | Popup-side `ProfileServiceClient`. | 120 |
| `account` service | `.../account/service.ts` | Account CRUD, derivation, export/import (file-based), imported-key sealing, backup/restore, purge. | 856 |
| `account` spec | `.../account/spec.ts` | `Account`/`AccountType`, composite row-id codec, `ImportedAccountKey`. | 245 |
| `account` imported-keys repo | `.../account/imported-keys-repository.ts` | Imported accounts' encrypted signing keys, 1:1 with Account rows. | 67 |
| `account-integrity` coordinator | `.../account-integrity/coordinator.ts` | Re-derives every stored account address; blocks/withholds session on mismatch. | 192 |
| `account-integrity` blocked-repository | `.../account-integrity/blocked-repository.ts` | Blocked/verified-stamp repos over raw `storage.local`. | 71 |
| `account-integrity` types | `.../account-integrity/types.ts` | Schemas, `accountSetDigest`, `AccountIntegrityDelegate`. | 63 |
| `account-state` service | `.../account-state/service.ts` | PXE-registered senders/accounts/contracts bookkeeping. | 462 |
| `account-state` normalize | `.../account-state/normalize.ts` | Backup slice normalization with caps/skips. | 225 |
| `auth-registry` service | `.../auth-registry/service.ts` | Public authwit tracking/revocation, registry enable/disable, chain sync. | 524 |
| `passkey` service | `.../passkey/service.ts` | WebAuthn ceremony host (PATH A materialize / PATH B window). | 133 |
| `passkey` spec | `.../passkey/spec.ts` | `RP_ID` (frozen), timeouts, request shapes. | 81 |
| `passkey` check-rp-id | `.../passkey/check-rp-id.ts` | RP-ID drift detector + manifest validator (build-time gate). | 174 |
| `backup` migration registry | `.../backup/backup-migration-registry.ts` | `BACKUP_SLICE_REGISTRY`, compat-epoch/schema-version constants, normalize/denormalize. | 484 |
| `backup` migrator | `.../backup/backup-migrator.ts` | `migrateBackupData` — in-memory scratch-store migration via real `Migrator`. | 198 |
| `backup` row-map migration | `.../backup/row-map-migration.ts` | `defineRowMapMigration` DSL. | 372 |
| `profile-deletion` coordinator | `.../profile-deletion/coordinator.ts` | Awaited, idempotent cross-service purge cascade. | 139 |
| `restore-fence.ts` | `.../services/restore-fence.ts` | Deletion-epoch fence for slice-restore writers. | 44 |
| `restore-rows.ts` / `purge-rows.ts` / `require-owned-row.ts` / `id-allocators.ts` | `.../services/` | Per-row restore loop; delete-before-emit purge + raw malformed sweep; fail-closed ownership guard; id allocators. | 35 / 97 / 17 / 75 |
| `wallet/storage/migrations` | `.../wallet/storage/migrations/index.ts` | `BASELINE_VERSION`, `realMigrations` (empty), `backupMigrations`, blocked/degraded codecs. | 142 |
| `wallet/config` | `.../wallet/config/{config,store,index}.ts` | `ConfigSchema` (incl. `strictSecurityMode` AUDIT A1), `ConfigStore`. | 70+101+16 |
| `wallet/utils` | various | Passkey ceremony/label, create-passkey-profile retry, offscreen lifecycle, auth-registry helpers, CAIP, `simulate`, onboarding-tab, raw-row decode, serialization. | ~1200 |
| `utils/storage.ts` | `apps/extension/src/utils/storage.ts` | Migration-aware UI facade over `chrome.storage.local`. | 81 |

## 2. Entrypoints

**Service ports** (`Service<Methods,Events>` from `@nulo/extension-messaging/background`; Port transport gated by `isTrustedInternalSender`):
- `ProfileService` — `profile/service.ts:70-93`: `getActiveProfile, getProfiles, generateProfileId, createProfile, createPasskeyProfile, unlockProfile, unlockPasskeyProfile, getPasskeyCredentialId, lockActiveProfile, refreshSession, changeProfileName, changeProfilePassword, confirmProfileOperation, deleteProfile, importPasskey, importMnemonic, exportPlain, exportBackupMaterial, getProfileDekSealed, exportMnemonic, restore, finalizeRestore` + `backup`/`restore` overrides (`service.ts:2160`/`2164`).
- `AccountService` — `account/service.ts:52-65`: `getAccounts, getAccount, createAccount, ensureDefaultAccount, changeAccountName, changeAccountVisibility, exportAccount, importAccount, previewImportAccount, backupImportedKeys, restoreImportedKeys, reconcileImportedAccounts` + `backup`/`restore` (`:661`/`667`). NOT RPC-exposed (in-process only): `getAccountContract` (`:334`, used by `ExecutionService`/`TokenService`), `getAccountsByAddress`, `getAccountsRaw`, `rawAddressesForProfile`, `purgeForProfile`, `clearChainState`, `provisionDefaultAccount`.
- `AccountStateService` — `account-state/service.ts:32-38`: `getAccounts, getSenders, getSendersAcrossActiveNetworks, addSender, deleteSender, getContracts` + backup/restore (`:150`/`258`).
- `AuthRegistryService` — `auth-registry/service.ts:40-46`: `getAuthwits, revokeAuthwits, getRegistryEnabled, setRegistryEnabled, syncRegistry` + backup/restore (`:405`/`451`). Internal: `purgeForAccounts`, `recordPendingAuthwits`, `reconcileAuthwits`.
- `PasskeyService` — `passkey/service.ts:55`: `getPendingRequest, resolvePasskeyRequest, rejectPasskeyRequest`. Internal: `materializeCredential` (PATH A, carries `CryptoKey`), `createKey`/`getKey` (PATH B, no production callers).
- `AccountIntegrityCoordinator` (`account-integrity/coordinator.ts:40`) and `ProfileDeletionCoordinator` (`profile-deletion/coordinator.ts:28`) — bare `IService`, **no RPC surface**; register as delegates on `ProfileService` (`coordinator.ts:68` `setIntegrityDelegate`, `profile-deletion/coordinator.ts:79` `setDeletionDelegate`).

**Who may call**: any same-extension context passing `isTrustedInternalSender` (`packages/extension-messaging/src/core/sender-auth.ts:17`). Callers: popup/onboarding pages/composables and the offscreen document (`apps/extension/src/offscreen/index.ts:5,101` opens a `ProfileServiceClient`). dApp-triggered reads go through wallet-bridge's dispatcher **in-process** in the SW, calling `AccountService`/`ProfileService` methods directly (bypassing the Port gate): `execution/service.ts:275,322,869`, `execution/view-executor.ts:87,253,339`, `execution/tx-request-builder.ts:216,377`, `token/service.ts:696` call `accountService.getAccountContract(...)`.

**Alarms**: `SESSION_TTL_ALARM_NAME = "nulo:core:session:ttl"` (`session-manager.ts:78`, scheduled/cleared `:836-858`, fired `onAlarmFired` `:798`). Migration engine runs at SW boot (`runtime.ts:329`).

**Windows**: passkey ceremony `src/popup/windows/passkey/index.vue` (PATH B via `WindowManager.openAndAwait`, `passkey/service.ts:119`); `MigrationBarrier.vue`.

## 3. Trust boundaries

**Sender/origin checks:**
- `isTrustedInternalSender` — `packages/extension-messaging/src/core/sender-auth.ts:17-23`: `sender.id !== chrome.runtime.id` → reject; else `sender.url === undefined || sender.url.startsWith(chrome.runtime.getURL(""))`. Gates every `Service.onConnect` (`background/service.ts:39-45`).
- RPC allowlist (D10) — `packages/extension-messaging/src/core/base-service.ts:94`.
- RP-ID drift gate — `passkey/check-rp-id.ts` (build-time via `scripts/check-rp-id.ts`); `host_permissions` must contain `https://nulo.sh/` (`passkey/spec.ts:21`).
- Passkey credential↔profile binding — `profile/service.ts:770` (`unlockPasskeyProfile`: `recovery.credentialId !== snapshot.credentialId` → reject), `:786` (post-lock re-check), `:1691` (`exportPasskeyCredential`).
- Row key-identity guard — `profile/repository.ts:46` (`requireKeyIdentityMatch: true`); `account/spec.ts:44-59` (`parseAccountRowId`) byte-canonical JSON round-trip.
- Cross-profile ownership — `require-owned-row.ts:12-17`; `account/service.ts:322,337` inline `profileId`/`chainId` checks.
- Deletion-epoch fence (D13) — `restore-fence.ts:19-44`; used `account/service.ts:672,717,764`, auth-registry restore.

**Secrets:**
- **Password** — `unlockProfile(id, password)` (`profile/spec.ts:203`, `service.ts:589`) → `PasswordSecretBox.unseal` (`service.ts:597`); never persisted.
- **PRF output / credentialId** — `PasskeyCredentialData` via `unlockPasskeyProfile`/`createPasskeyProfile`/`importPasskey`/`restore` (`profile/spec.ts:196-360`); `PasskeyService.materializeCredential` (`passkey/service.ts:86-88`) → `PasskeyRecoveryCoordinator.toRecovery` (`passkey-recovery-coordinator.ts:96-100`) derives `secret` + `dekWrapKey`.
- **Master secret (`Fr`)** — in-memory only as `SessionManager.activeSession.secret` (`session-manager.ts:97,142`); zeroized scratch via `zeroize()` (`profile/service.ts:572-580`, `653-659`, `1116-1122` etc.).
- **`chrome.storage.session`** `SESSION_STORAGE_ROOT = "nulo:core:session"` (`session-manager.ts:72`) holds `{profile, bearer?, since, lockedAt?}` — never the raw `Fr`. `bearer` = `SessionSecretBox`-wrapped master, written only when `passhash !== undefined && !strictSecurityMode && profile.type === "password" && dek !== undefined` (`session-manager.ts:267`). **"Session withheld"** = `openSessionVerified` refusing `sessionManager.open(...)` (`profile/service.ts:1200-1273`, `account-integrity/coordinator.ts:130-135`).
- **Imported-keys DEK** — `Profile.dekSealed` (`profile/spec.ts:63-66`); unsealed in `ActiveSession.dek` (`profile/spec.ts:143-148`); consumed by `AccountService` (`account/service.ts:373,467,422`).
- **Seed/mnemonic** — `createProfile` (`service.ts:532-534`: 32 CSPRNG bytes → `getMnemonic` → `deriveMasterFromMnemonic`) or `importMnemonic` (`:1606-1620`). Stored sealed as `Profile.entropy` (`spec.ts:78-80`); `exportMnemonic(id, password)` (`:1879-1917`) re-derives words and asserts words↔master pairing (`assertEntropyMasterPair`, `:1926`). `exportPlain`/`exportBackupMaterial` pairing-check before returning (`:1652-1656`, `1767`).
- **Zeroization**: `account/service.ts:392-395,432-434,520-522`; `session-manager.ts:283-289` documents the named-and-wiped pattern.

**Backup trust gates:**
1. Checksum over original body — `apps/extension/src/composables/useFullBackupImport.ts:93-100` (`EncryptionKey.getHashHex(JSON.stringify(backup))`); comment `:87-92` "accidental-integrity detection only".
2. `compat-epoch` hard reject — `useFullBackupImport.ts:104` via `isSupportedCompatEpoch` (`backup-migration-registry.ts:82-84`, `CURRENT_COMPAT_EPOCH = 4` at `:76`).
3. `backup-schema-version` range — `useFullBackupImport.ts:113-127`, `maxBackupSchemaVersion()` (`backup-migrator.ts:63-68`).
4. Migrate — `useFullBackupImport.ts:136` → `migrateBackupData` (`backup-migrator.ts:81-116`): `normalizeBackupData` (unknown slice → reject, `registry.ts:254-264`) → `preflightPending` (`backup-migrator.ts:127-198`) → real `Migrator` over `MemoryStorageArea` → `denormalizeBackupData`. Never recomputes post-migration checksum (`backup-migrator.ts:19-23`).
5. Block-listed roots: `nulo:core:profiles`, `nulo:core:auth-registry-enabled` — `registry.ts:225-233`, enforced `backup-migrator.ts:186-191`.
6. `master-key` is a top-level blob field, never a slice (`backup-migrator.ts:15-16`, `README.md:21`); flows only into `ProfileService.restore` (`profile/service.ts:2164`).

**External calls**: `account/service.ts:267,485` → `NetworkService.resolveVerifiedL1ChainId`/`getL1ChainIdStored` (auth gate before probe, `service.ts:254-259`).

**Storage writes:**

| Key | Area | Shape | Owner |
|---|---|---|---|
| `nulo:core:profiles@<id>` | local | `Profile` (sealed guard/secret/entropy/dekSealed/envelopeMac or credentialId) | `profile/repository.ts:24` |
| `nulo:core:profile-tombstones@<id>` | local | `Tombstone` | `tombstone-repository.ts:6-24` |
| `nulo:core:restore-pending@<id>` | local | `{profileId, pxeGeneration, at}` | `restore-pending-repository.ts:6-29` |
| `nulo:core:session` | **session** | `Session` (`profile, bearer?, passhash?[deprecated], since, lockedAt?`) | `session-manager.ts:72` |
| `nulo:core:account-integrity-blocked@<profileId>` | local | `AccountIntegrityBlocked` | `account-integrity/types.ts:4,36-47` |
| `nulo:core:account-integrity-verified@<profileId>` | local | `{walletVersion, accountSetDigest}` | `types.ts:5,12-13` |
| `nulo:core:accounts@<accountRowId>` | local | `Account` (`profileId,chainId,address,index,type,l1ChainId,name,visible`) | `account/spec.ts:10,135-150` |
| `nulo:core:imported-account-keys@<accountRowId>` | local | `ImportedAccountKey` (`encryptedSigningKey`) | `account/spec.ts:89,97-110` |
| `nulo:core:auth-registry@<id>` | local | `Authwit` | `auth-registry/spec.ts:8,24-53` |
| `nulo:core:auth-registry-enabled@<account>` | local | `boolean` | `auth-registry/spec.ts:15,56` |
| `nulo:config` | local | `Config` | `config/store.ts:10` |
| `nulo:schema:version` / `:running` / `:attempts` | local | engine-owned | `packages/wallet-core/src/migration/migrator.ts:42-52` |
| `nulo:schema:blocked` / `:degraded` / `:retry-requested` | local | status codecs | `wallet/storage/migrations/index.ts:45-50` |

## 4. Dependency graph (handoff edges)

- `profile/service.ts` → repository, session-manager, passkey-recovery-coordinator, restore-pending-repo, tombstone-repo, profile-deletion-state, `profile-deletion/types` (interface), `account-integrity/{blocked-repository,types}`, `passkey/service.ts`, `@nulo/wallet-crypto`. **Delegate edges**: `AccountIntegrityCoordinator.start()` → `setIntegrityDelegate` (`coordinator.ts:68` → `service.ts:1187`, consumed `openSessionVerified` `:1231`); `ProfileDeletionCoordinator.start()` → `setDeletionDelegate` (`:79` → `service.ts:1182`, consumed `deleteProfile` `:1402,1422,1450`). **Event**: `onActiveProfileChanged` (`session-manager` `onChange` wired `service.ts:268`) → popup stores + `wallet-sdk/background.ts:554`.
- `session-manager.ts` → `SessionSecretBox`, `verifyEnvelopeMacV3`, `zeroize`, `AlarmDispatcher`, `Lock`, `ValueStorage`. `runExclusive` injected by `ProfileService` (`service.ts:270`).
- `account/service.ts` → `ProfileService`, `requireActiveProfile`, `network/service.ts`, restore-fence/rows, purge-rows, `NuloAccount`, `buildAccountExport`, `V5_REGIME`, `@nulo/wallet-crypto`, imported-keys-repo. `raiseRuntimeMismatch` (`:536`) → `profileService.persistIntegrityBlockIfLive`/`lockProfileIfActive`.
- `account-integrity/coordinator.ts` → `AccountService`, `ProfileService`, `NuloAccount`, `V5_REGIME`, `deriveAccountSeed`.
- `account-state/service.ts` → `PxeServiceClient`, `network/service.ts`, `e2e/restore-gate.ts`, normalize.
- `auth-registry/service.ts` → restore-fence/rows, `execution/service.ts` + `rpc-cancel.ts`, profile, network, account, purge-rows, task, transaction, `wallet/utils/auth-registry.ts`.
- `backup/backup-migrator.ts` → `Migrator`, `MemoryStorageArea`, `wallet/storage/migrations`, registry, row-map-migration.
- `backup/backup-migration-registry.ts` → every backup-bearing spec.
- `passkey/service.ts` → `PasskeyCredential`, id-allocators, `window-manager`.
- `profile-deletion/coordinator.ts` → account, auth-registry, contact, dapp-session, fpc, incoming-transfer, network, operation-journal, profile, pxe, token-balance, token, transaction ("started LAST"). `deleteProfile` → `delegate.snapshot(id)` then `delegate.runFor(id, snapshot)` (`profile/service.ts:1422,1450` → `coordinator.ts:86-131`).
- `wallet/storage/migrations/index.ts` → `@nulo/wallet-core/migration`, `@/e2e/{config,backup-migration-fixture,migration-fixture}`.
- `utils/storage.ts` → `SCHEMA_RUNNING_KEY`; enforced by `storage-facade-ban.test.ts`.

## 5. Frameworks / libs
`@nulo/wallet-crypto` (WebCrypto + `@aztec/foundation` 5.2.0); `zod ^4.4.3` row schemas (`AccountSchema`, `AuthwitSchema`, `TombstoneSchema`, `RestorePendingSchema`, `AccountIntegrityBlockedSchema`, `VerifiedStampSchema`, `ConfigSchema`, `ImportedAccountKeySchema`); `@nulo/extension-messaging` v0.2.0 (`Service`/`ServiceClient`, `WalletError` hierarchy: `AccountAddressInconsistencyError`, `DuplicateWalletError`, `InvalidPasswordError`, `ProfileIdConflictError`, `RestoreTornError`); `@nulo/wallet-core/storage` (raw-key repos bypass `EntityStorage` per `raw-row.ts`'s tri-state contract); `@nulo/wallet-core/migration`; `@aztec/foundation`, `@nulo/aztec-runtime/account`, `@aztec/standard-contracts/auth-registry/constants`, `@aztec/stdlib`.

## 6. Test surfaces
Thin: `profile/service.ts` (2691) has no `service.test.ts` — `service.integration.test.ts` (2797, 125 tests) + `session-manager.test.ts` (1008/58), `session-manager.fence.test.ts` (357/8), `passkey-recovery-coordinator.test.ts` (260/11), `repository.test.ts`. `passkey/service.ts` → `service.test.ts` 38 LOC / 1 test (PATH B thin). `account-integrity/coordinator.default-deriver.test.ts` 98/2. No client tests for passkey/account-state/auth-registry clients.
Well-covered: `backup/footprint-coverage.test.ts` (426/18), `backup-migration-core.pins.test.ts` (311/29), `backup-migration-registry.test.ts`, `backup-migrator.test.ts`, `account/service.test.ts` (572/34) + `import-export.test.ts`, `auth-registry/service.test.ts` (342/21), `cross-profile-isolation.test.ts` (479/18), `check-rp-id.test.ts` (118/16).

## 7. Generated / fixture / test-only
`composition-harness.ts` test-only. `e2e/migration-fixture.ts`, `e2e/backup-migration-fixture.ts` conditionally wired (`E2E_MIGRATION_FIXTURE`, `VITE_NULO_E2E_MIGRATION_FIXTURE=1`, tree-shaken + grep-guarded). `migrations/template.ts` dead by design. `e2e/{restore-gate,storage-gate,proof-gate,incoming-poll-gate,chrome-storage-*}.ts` NOOP in prod; `account-state/service.ts:49` `RestoreGate` defaults to `NOOP_RESTORE_GATE`.

## 8. Security-relevant invariants (quoted)
- `config/config.ts:21-26` AUDIT A1: strict security mode ON by default; "flipping it to `false` is an explicit security regression that requires audit / security sign-off." Frozen by `config.test.ts`.
- `session-manager.ts:19`: raw `Fr` "NEVER persisted"; `:236` "(F-11)".
- `passkey/spec.ts:7-15`: RP_ID crypto-bound; changing bricks all credentials.
- `backup-migration-registry.ts:11-14`: "a backup blob is ATTACKER-CONTROLLED input — its checksum is accidental-integrity detection, not authentication."
- `row-map-migration.ts:5-16`: "WHY NO AUTHOR FUNCTIONS — DO NOT 'IMPROVE' THIS (rejected 4× in audit)".
- `backup/README.md:21`: "`master-key` never enters the scratch store, results, or error reasons".
- Frozen storage roots: `profile/repository.ts:22-24`, `account/spec.ts:8-9`, `auth-registry/spec.ts:6-8`, `config/store.ts:7-9`.
- `profile/service.ts:295-298`: `getProfileOrThrowHoldingLock` "deliberately blind to a deletion reservation" (pinned quirk).
- `account/spec.ts:62-67` (A4): imported-key failure is per-account, never profile-wide; `profile/service.ts:637-642`, `account/service.ts:362-366`.
- `account-integrity/coordinator.ts:26-38`: "withhold/close the session, persist a blocking record… pure KDF + descriptor + artifact — no PXE, no node".
- `base-service.ts:22-23`, `:94` D10 RPC-surface guard.
- `sender-auth.ts:1-15` F-09.
- `profile-deletion-state.ts:1-17` D13.
- `utils/storage.ts:1-11` UI storage barrier, enforced by `storage-facade-ban.test.ts`.
- CLAUDE.md pre-production migration rule.
