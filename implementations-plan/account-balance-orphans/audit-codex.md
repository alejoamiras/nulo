# audit-codex.md — codex-leg plan audit (account-balance-orphans)

Codex `gpt-5.6-sol` @ xhigh, read-only sandbox, blueprint-mid dual-audit leg, run against the
committed `plan.md` + `recon.md` and cited source at `origin/dev` @ `9103dea0`.
Session `01a05831-3c23-7ce2-9026-66f9c227dddf`. Paths rewritten repo-relative. All codex-unique
claims (tuple purge scope, occupancy-set gap, duplicate-pair hole, refreshBalances 30-min
hardcode, identity-site inventory, fail-fast feasibility) were independently re-verified against
source by the main agent before adoption (see `lessons/phase-0.md`). Verbatim response follows.

---

Neither Outline A nor B is approvable verbatim. The architectural direction is A, but it needs four material corrections: chain-aware account scopes, service-owned restore stamping, complete identity enforcement, and purge-before-delete ordering.

## Facts

1. **Medium — Fact 1 is only partly true.** The three account-removal paths are correctly identified, but chain-purge balance cleanup is not crash-safe “fully deleted.” `TokenService.clearChainState` emits `onTokenDeleted` after deleting each token ([token/service.ts:162-174](apps/extension/src/wallet/services/token/service.ts:162)); `EventHandler.invoke` does not await the async balance subscriber ([event-handler.ts:47-61](packages/wallet-core/src/utils/event-handler.ts:47)). A worker death can therefore leave a hidden token-orphan balance. A’s full identity prevents later wrong-token reattachment, which further supports A over B.

2. **Low — Fact 2 verified.** `reconcileImportedAccounts` returns deleted addresses ([account/service.ts:785-796](apps/extension/src/wallet/services/account/service.ts:785)) and its only production caller is the restore finalizer ([useFullBackupImport.ts:909-918](apps/extension/src/composables/useFullBackupImport.ts:909)).

3. **Low — Fact 3 verified.** Token balances subscribe to profile/account-add/token/transaction events, but not `onAccountDeleted` ([token-balance/service.ts:131-136](apps/extension/src/wallet/services/token-balance/service.ts:131)). The live subscribers are AuthRegistry ([auth-registry/service.ts:93-99](apps/extension/src/wallet/services/auth-registry/service.ts:93)), Transaction ([transaction/service.ts:108-113](apps/extension/src/wallet/services/transaction/service.ts:108)), and IncomingTransfer ([incoming-transfer/service.ts:265-275](apps/extension/src/wallet/services/incoming-transfer/service.ts:265)).

4. **Low — Fact 4 verified.** Local subscriber promises are ignored by `EventHandler.invoke`, and `Service.emit` merely invokes it synchronously ([base-service.ts:129-133](packages/extension-messaging/src/core/base-service.ts:129)). The coordinator instead directly awaits dependent purges before parent deletion ([coordinator.ts:109-130](apps/extension/src/wallet/services/profile-deletion/coordinator.ts:109)).

5. **High — Fact 5 is true but incomplete in a way that breaks both outlines.** Shared addresses are possible across profiles, but the same imported signing key is also importable on multiple chains in the same profile: address recomputation is independent of `chainId`, while duplicate rejection examines only the selected `(profileId, chainId)` rows ([account/service.ts:441-448](apps/extension/src/wallet/services/account/service.ts:441)). Imported-key storage is likewise keyed by full `(profileId, chainId, address)` ([imported-keys-repository.ts:26-36](apps/extension/src/wallet/services/account/imported-keys-repository.ts:26)). Therefore A’s `account + profileId` predicate and B’s all-profile-token join can delete balances for a surviving account on another chain. The purge target must be the full `(profileId, chainId, address)` tuple.

6. **Low — Fact 6 verified in substance, with drifted line citations.** The policy is explicitly pre-production/no migrations ([CLAUDE.md:90-97](CLAUDE.md:90)); `realMigrations` is empty at [migrations/index.ts:21-26](apps/extension/src/wallet/storage/migrations/index.ts:21), not the cited `:18,22`.

7. **Medium — Fact 7’s mechanism is verified, but “recreates each pair” is best-effort rather than guaranteed.** Codec failures are kept but hidden ([entity_storage.ts:95-141](packages/wallet-core/src/storage/entity_storage.ts:95)); reconcile runs during init and profile switches ([token-balance/service.ts:142-150](apps/extension/src/wallet/services/token-balance/service.ts:142), [token-balance/service.ts:378-397](apps/extension/src/wallet/services/token-balance/service.ts:378)). But per-row creation failures are caught and skipped ([token-balance/service.ts:284-296](apps/extension/src/wallet/services/token-balance/service.ts:284)), so quota or storage failures can leave the repair incomplete.

8. **Medium — Fact 8 is overstated.** Creation directly holds the full `Token` ([token-balance/service.ts:236-253](apps/extension/src/wallet/services/token-balance/service.ts:236)); `restore()` currently holds only the balance row and threaded `profileId` ([token-balance/service.ts:537-559](apps/extension/src/wallet/services/token-balance/service.ts:537)). It can derive chain and contract through `tokenService.getTokensRaw(profileId)` ([token/service.ts:186-189](apps/extension/src/wallet/services/token/service.ts:186)), but it does not already possess them without a lookup or composable stamping.

9. **Medium — Fact 9 needs an authority correction.** Relinking currently derives its chain map from attacker-controlled old token rows and uses successful new-token results only for the replacement ID ([useFullBackupImport.ts:282-307](apps/extension/src/composables/useFullBackupImport.ts:282)). Successful `newTokens` are parsed persisted tokens ([token/service.ts:714-730](apps/extension/src/wallet/services/token/service.ts:714)), so any relink-side chain check must use `newTokens[i].chainId`, not `oldTokens[i].chainId`.

10. **Medium — Fact 10’s conclusion is correct, but compat epoch is not merely “key-derivation-only.”** It covers account-contract/KDF generation and required password-backup shape ([backup-migration-registry.ts:68-76](apps/extension/src/wallet/services/backup/backup-migration-registry.ts:68)). No bump is nevertheless needed: backup schema version follows `realMigrations` ([backup-migrator.ts:70-74](apps/extension/src/wallet/services/backup/backup-migrator.ts:70)), and balance identity remains anchored on numeric `id` ([backup-migration-registry.ts:197-205](apps/extension/src/wallet/services/backup/backup-migration-registry.ts:197)).

11. **Low — Fact 11 verified.** `purgeForTokens` performs typed and raw passes under the balance lock and fences typed IDs before deletion ([token-balance/service.ts:459-478](apps/extension/src/wallet/services/token-balance/service.ts:459)).

12. **Low — Fact 12 verified for production consumers.** UI RPCs receive `TokenBalanceInfo`; raw rows remain inside the token-balance module and the backup registry. The projector is also an internal raw-row consumer ([balance-projector.ts:51-76](apps/extension/src/wallet/services/token-balance/balance-projector.ts:51)).

13. **Medium — Fact 13 is inaccurate.** Unlock passes `10` minutes ([auth.vue:171-174](apps/extension/src/popup/pages/auth.vue:171)), but `refreshBalances` ignores that parameter and hardcodes 30 minutes ([core.ts:142-165](apps/extension/src/utils/core.ts:142)). Token detail and manual refresh are real ([tokens/[id].vue:61-84](apps/extension/src/popup/pages/tokens/[id].vue:61), [TokensView.vue:301-302](apps/extension/src/popup/components/modules/general/TokensView.vue:301)), but none is guaranteed to occur. “Bounded” should be described as user-action-dependent, not time-bounded.

Additional source-backed findings:

- **High — Outline A’s reconcile repair does not work as written.** Even if `reconcile-pairs.ts` reports an identity-mismatched row as missing, `ensurePairsHoldingLock` reconstructs a token-id/address-only occupancy set and skips creation ([token-balance/service.ts:275-287](apps/extension/src/wallet/services/token-balance/service.ts:275)). That set must use the same full identity key.

- **Medium — hostile backups can create duplicate canonical pairs.** Backup normalization rejects duplicate row IDs, not duplicate `(token, account)` pairs ([backup-migration-registry.ts:281-291](apps/extension/src/wallet/services/backup/backup-migration-registry.ts:281)); relink preserves every accepted row ([useFullBackupImport.ts:298-325](apps/extension/src/composables/useFullBackupImport.ts:298)); restore allocates and writes each one ([token-balance/service.ts:552-563](apps/extension/src/wallet/services/token-balance/service.ts:552)). Add pair-level deduplication or reconcile duplicate cleanup.

- **Medium — the new method is an internal RPC.** A composable cannot call it unless it is added to the service allowlist and client passthrough; the current allowlist contains only three balance methods ([token-balance/service.ts:35-37](apps/extension/src/wallet/services/token-balance/service.ts:35), [token-balance/client.ts:27-33](apps/extension/src/wallet/services/token-balance/client.ts:27)). It is not a dApp wallet RPC, but the plan should acknowledge and validate this destructive extension-RPC boundary.

## Inferences

1. **Medium — Inference 1 is unsafe as stated.** For every repaired row, allocation rescans the physical key space ([id-allocators.ts:17-36](apps/extension/src/wallet/services/id-allocators.ts:17)); each enqueue creates an uncapped in-memory Task and uses an array-front insertion ([balance-job-queue.ts:126-134](apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:126), [queue.ts:25-36](packages/wallet-core/src/utils/queue.ts:25)). A large old store therefore causes quadratic allocation/queue work, doubles storage until cleanup, and can repeatedly retry after quota failure. Pre-production reduces exposure, but the plan needs the legacy raw sweep and a many-row transition test.

2. **High — Inference 2 is unsafe with relink-only stamping.** A backup import already running under an older composable can reconnect to a newly updated worker and send rows without the new fields. The new service would reject them at its stricter parse. Make `TokenBalanceService.restore()` the invariant owner: load the target profile’s restored tokens, resolve `tb.token`, and construct `{...tb, id, profileId, chainId: token.chainId, contract: token.contract}` with derived fields last. Relink should still remap IDs and use the successful new token’s chain for its account-chain check. The composable already overwrites all `profileId` fields and threads the created ID ([useFullBackupImport.ts:718-725](apps/extension/src/composables/useFullBackupImport.ts:718), [useFullBackupImport.ts:883-894](apps/extension/src/composables/useFullBackupImport.ts:883)); service-side derivation makes that defense complete rather than caller-dependent.

3. **High — Inference 3 is too narrow.** The proposed list and queue filters themselves are safe, but identity enforcement must cover every raw-row decision:

   - single-row `getTokenBalance` currently returns any decodable row whose numeric token ID resolves ([service.ts:156-163](apps/extension/src/wallet/services/token-balance/service.ts:156));
   - `refreshTokenBalance`, `requestBalanceRefresh`, and account refresh can enqueue an identity-mismatched row ([service.ts:180-220](apps/extension/src/wallet/services/token-balance/service.ts:180));
   - token-update and transaction handlers select rows by numeric token ID ([service.ts:425-435](apps/extension/src/wallet/services/token-balance/service.ts:425), [service.ts:499-513](apps/extension/src/wallet/services/token-balance/service.ts:499));
   - the projector resolves the successor token and may perform view work before the queue’s write-time guard runs ([balance-projector.ts:58-76](apps/extension/src/wallet/services/token-balance/balance-projector.ts:58));
   - changing `backup()` to `row.profileId` alone would export identity-mismatched debris; it needs an authoritative full-identity join, not just the profile field ([service.ts:526-535](apps/extension/src/wallet/services/token-balance/service.ts:526)).

   Use one shared row↔token identity predicate in all these paths, including `ensurePairsHoldingLock`.

4. **High — Inference 4 is false.** Full token identity does not establish that the account still exists. `getTokenBalances` filters only through the token map ([service.ts:165-176](apps/extension/src/wallet/services/token-balance/service.ts:165)), while reconcile simply ignores rows outside the desired pair set rather than deleting them ([reconcile-pairs.ts:91-103](apps/extension/src/wallet/services/token-balance/reconcile-pairs.ts:91)). A crash after account deletion therefore recreates the original orphan exactly. Worse, the current finalizer catches reconciliation errors as non-fatal and proceeds to finalize ([useFullBackupImport.ts:909-923](apps/extension/src/composables/useFullBackupImport.ts:909)); an awaited purge placed inside that catch could fail and still commit the import.

## Asks

a. **High — Choose revised Outline A, not B.** Required row identity is the durable architecture. B preserves every schema workaround and remains vulnerable to temporal numeric-ID reuse, which the current reconcile explicitly calls unsolvable from this schema ([reconcile-pairs.ts:56-61](apps/extension/src/wallet/services/token-balance/reconcile-pairs.ts:56)). Revised A must:

- purge full `(profileId, chainId, address)` scopes;
- derive all three scope fields inside `restore()`;
- use one identity predicate across reconcile, ensure, reads, refreshes, queue/projector, token handlers, and backup;
- reject or collapse duplicate canonical balance pairs.

The existing balance lock and invalidation fence are correct for restore/purge and in-flight projection serialization ([service.ts:79-86](apps/extension/src/wallet/services/token-balance/service.ts:79), [service.ts:547-564](apps/extension/src/wallet/services/token-balance/service.ts:547)). They do not generically prevent a brand-new creation that starts after a purge. In this concrete restore path that is acceptable because account restore emits no add events ([account/service.ts:638-691](apps/extension/src/wallet/services/account/service.ts:638)) and the imported profile is not activated until finalize ([useFullBackupImport.ts:900-923](apps/extension/src/composables/useFullBackupImport.ts:900)). Document that scope rather than claiming the lock solves arbitrary later creators.

b. **Low — Store all three fields: `profileId`, `chainId`, and `contract`.** `profileId` scopes ownership; `chainId` distinguishes the valid same-profile/same-address multi-chain case; `contract` distinguishes a different asset after token-ID reuse. Token updates already prohibit changing profile, chain, or contract ([token/service.ts:385-415](apps/extension/src/wallet/services/token/service.ts:385)), so they form a stable asset identity.

c. **Medium — Delete provably stale rows now.** During active-profile reconciliation, delete and fence a row when `row.profileId` is the target profile, its numeric token ID currently resolves to a live token, and its chain/contract identity mismatches that token. Leave foreign-profile rows and rows whose token ID has no live token. Then create the canonical missing pair. Fail-closed filtering alone leaves traps for future consumers and backup export.

d. **Medium — Raw-sweep exact pre-schema rows.** Under the balance lock and before reconciliation, delete syntax-valid rows that match the legacy balance shape but lack the three new fields, using the physical storage ID and numeric key-identity check. `purgeMalformedRows` already provides snapshot-byte rechecking and deletion by the true storage ID ([purge-rows.ts:58-83](apps/extension/src/wallet/services/purge-rows.ts:58)); the repository already exposes it ([balance-repository.ts:83-90](apps/extension/src/wallet/services/token-balance/balance-repository.ts:83)). This should be an idempotent startup baseline cleanup, not a numbered migration.

e. **High — Split to list → purge → delete, and make it fail-fast.** Have AccountService first return keyless imported account scopes as `{profileId, chainId, address}` without mutation; await the tuple-scoped balance purge; then call an AccountService deletion method that rechecks key absence before deleting and emitting. Any failure before finalize must escape to the existing outer rollback path, not be swallowed by the current non-fatal catch. A crash before purge changes nothing; a crash after purge but before account deletion leaves a keyless account without stale balance data, which is the safer dependency ordering.

f. **Low — Confirm `mid`.** The corrected design still has one high blast-radius dimension but no migration, cryptographic, external-protocol, or irreversible production-data change. The repository’s current pre-production policy makes `mid` appropriate ([CLAUDE.md:90-97](CLAUDE.md:90)).

conditional approve (with conditions: adopt revised A with full profile/chain/address purge targets, service-owned restore derivation, complete identity enforcement, stale/legacy cleanup, and fail-fast list→purge→delete ordering)