# q02-wallet-profile-state — claude

Scope read: apps/extension/src/wallet/services/profile/{service.ts (all flows: create/unlock/import/export/change-password/restore/finalize), session-manager.ts (skim), repository.ts, tombstone-repository.ts, restore-pending-repository.ts, passkey-recovery-coordinator.ts}; account/{service.ts, imported-keys-repository.ts}; account-state/service.ts (restore half); account-integrity/blocked-repository.ts; contact/service.ts; config/service.ts; legal/service.ts; purge-rows.ts, restore-rows.ts, restore-fence.ts, require-owned-row.ts, id-allocators.ts; wallet/utils/raw-row.ts; jscpd-production.md rows for the cluster; both prior reports (grep for cluster paths). Not read in depth: backup/*, passkey/*, profile-deletion/coordinator.ts, account-integrity/coordinator.ts, wallet/storage/migrations (engine lives in packages; files are migration/registry code).

## q02-wallet-profile-state-C-1: Profile-row construction + open-session tail copied at six creation sites

- **Smell:** Duplicate Code (with Shotgun Surgery consequence).
- **Maintenance impact:** structural. Blast radius: 1 file, 6 sites, the auth-critical row shape (MAC, fingerprint, DEK slot). Change frequency: `profile/service.ts` 25 commits total, all 25 since 2026-06-01; several were security riders that touched exactly these constructors (fingerprint, envelope MAC v3, `pxeGeneration`, DEK).
- **Evidence:** the same "assert not duplicate wallet -> allocate id -> seal -> seal DEK -> MAC -> build `Profile` literal -> persist -> open session" sequence exists as:
  - password, create: `profile/service.ts:605-627` (jscpd 34 tokens-lines lead 606-639)
  - password, import: `service.ts:2159-2178`
  - password, restore: `service.ts:2393-2434` (same literal plus the marker-then-row writer instead of persist)
  - passkey, create: `service.ts:761-775`
  - passkey, import: `service.ts:2211-2234`
  - passkey, restore: `service.ts:2581-2599`
  Each repeats the identical `Profile` object literal (`id, name, type, pxeGeneration: mintPxeGeneration(), dekSealed, walletFingerprint, ...` plus `guard/secret/entropy/envelopeMac` for password or `credentialId` for passkey) and the `computeEnvelopeMacV3(id, secret, dek, this.macEnvelopeV3(encrypted, dekSealed, walletFingerprint))` call. The code itself counts them: `service.ts:~740` comment "the SIXTH row-construction site — every creation path mints a DEK + fingerprint". The two password create/import bodies (`605-627` vs `2159-2178`) differ only by `allowDuplicate` (false vs param) and whether seal happens inside or outside the lock.
- **Why it harms future change:** adding a field to `Profile` (a new MAC input, a schema version, a second fingerprint) or changing allocation order means editing six literals; forgetting one produces a profile kind whose row fails the MAC/fingerprint gate only at its first unlock, which is exactly the "MAC computed after id is final" invariant that must hold in all three password sites.
- **Smallest safe refactoring:** Extract Function x2, private to `ProfileService` (or a sibling `profile-row-factory.ts` next to `repository.ts`, no new layer): `buildPasswordRow({id, name, secret, dek, passhash/encrypted, dekSealed, walletFingerprint})` (owns the MAC call and literal) and `buildPasskeyRow({id, name, credentialId, dekSealed, walletFingerprint})`. Then fold create/import password into one `createPasswordProfileHoldingLock(name, secret, entropy, passhash, allowDuplicate)` (create becomes seal-then-call; `importPasswordProfile` already is that shape). Restore keeps its own id loop and marker writer but calls the same builders.
- **What disappears:** ~55-70 lines; one of the two password create bodies; 6 literals -> 2.
- **Instances:** `profile/service.ts:605-627, 2159-2178, 2393-2434, 761-775, 2211-2234, 2581-2599`.

## q02-wallet-profile-state-C-2: Password-gated reveal/export methods repeat one guard-unseal-fence-zeroize skeleton

- **Smell:** Duplicate Code / Composable-extraction analog ("Template Method" opportunity: Fowler's Form Template Method).
- **Maintenance impact:** structural. Blast radius: 4 public methods of the most security-sensitive surface, 1 file; change frequency: same file, 25 commits since June, and 3 of the last security riders touched these (pairing check, fence revalidation, DEK export).
- **Evidence:** all do `await this.ensureInitialized(); captureRowFence(id); if (profile.type === "passkey") throw "Operation not supported for passkey profile"; secretBox.unseal(password, sealedTriple(profile)); try { if (!unsealed) throw <wrong-password>; fence re-check; ...reveal...} finally { zeroize(unsealed.secret); zeroize(unsealed.entropy); ...}`:
  - `exportMnemonic` `service.ts:1965-2003` (re-check wrapped in `runExclusive`)
  - `exportBackupMaterial` `service.ts:1816-1898` (adds `assertEntropyMasterPair`, passhash, DEK)
  - `exportImportedKeysDek` `service.ts:1919-1955`
  - `exportPlain` password arm `service.ts:1685-1732` and `confirmProfileOperation` `service.ts:1195-1242` (same unseal + `profileFenceBroken` + flatten-to-`Error(getErrorMessage)` tail)
  The jscpd leads `1820-1827 vs 1919-1927` and `1820-1826 vs 1965-1971` are the opening eight lines. The skeleton already drifted: the wrong-password error is `InvalidPasswordError` in four and a hard-coded legacy string `"Invalid profile old password"` in `exportMnemonic` only; the fence re-check is lock-free in three and under `runExclusive` in `exportMnemonic`/`confirmProfileOperation`; `exportImportedKeysDek` skips the entropy pairing check that `exportPlain`/`exportBackupMaterial` run.
- **Why it harms future change:** a new fail-closed rule (for example "also refuse while a restore-pending marker exists", or a changed error contract) must be applied by hand to 5 bodies, and the existing drift shows that is already being missed (pairing check absent in one, error string in another).
- **Smallest safe refactoring:** Extract Function with a callback: `private async withUnsealedPasswordProfile<T>(id, password, reveal: (u: {secret, entropy}, profile) => Promise<T>, opts?: {wrongPassword?: () => Error})` owning ensureInitialized, fence capture, passkey refusal, unseal, null check, fence re-check, pairing check (opt-out flag where deliberate) and the zeroize `finally`. Each public method shrinks to its `reveal` body. Keep the `"Invalid profile old password"` string as an explicit option so the pinned UI contract is visible at one site.
- **What disappears:** ~90 lines of guard/try/finally; the silent drift.
- **Instances:** `profile/service.ts:1195-1242, 1685-1732, 1816-1898, 1919-1955, 1965-2003`.

## q02-wallet-profile-state-C-3: "Live row" guard and "open session, warn if degraded" tail re-spelled ~20 and 4 times

- **Smell:** Duplicate Code / Shotgun Surgery (changing the tombstone rule touches every site).
- **Maintenance impact:** structural. Blast radius: 1 file, ~20 guards; change frequency as above (the tombstone/epoch machinery was the most recently reworked area).
- **Evidence (a) live-row guard:** `getProfileOrThrowHoldingLock` + `isReserved(id)` -> `"Invalid profile id"` is centralized for the fenced paths (`captureRowFence`, `service.ts:325-332`) but hand-spelled in `snapshotForUnlock` (`355`), `unlockProfile` phase 3 (`676-685`), `unlockPasskeyProfile` phase 3 (`834-840`), `getProfileDekSealed` (`1909`), `getProfileDek` (`1960`), `getProfileSecret` (`2123`), `getPxeGeneration` (`2137`), `finalizeRestore` (`2662-2669`), `exportPasskeyCredential` (`1796-1804`), `deleteProfile` (`1470`). Two variants exist (row-present + not-reserved, or reserved only), chosen per site with no stated reason beyond comments.
  **(b) degraded tail:** `openSessionVerified(row, secret, passhash, dek ?? undefined); if (!dek) this.emit("onImportedKeysDegraded", this.getProfileInfo(row)); return this.getProfileInfo(row)` appears at `service.ts:702-706, 851-855, 2726-2730, 2787-2791`. The "a degraded open MUST emit the warning" rule (the long comment at `695-701`) is restated, not enforced, at each.
- **Why it harms future change:** a fifth open path (for example a future recovery flow) can open derived-only without the user-visible warning, and a change to what "tombstoned" means needs ~10 edits that only integration tests would catch.
- **Smallest safe refactoring:** (a) Extract Function `requireLiveRowHoldingLock(id)` = `getProfileOrThrowHoldingLock` + reserved check; have `captureRowFence`, `snapshotForUnlock`, both unlock phase-3 blocks and `finalizeRestore` call it. (b) Extract Function `openAndWarnIfDegradedHoldingLock(row, secret, passhash|undefined, dek|null): Promise<ProfileInfo>`.
- **What disappears:** ~60 lines; the warning rule lives once.
- **Instances:** (a) `profile/service.ts:325-332, 355, 676-685, 834-840, 1470, 1796-1804, 1909, 1960, 2123, 2137, 2662-2669`; (b) `702-706, 851-855, 2726-2730, 2787-2791`.

## q02-wallet-profile-state-C-4: Four raw-storage "fail-closed marker" repositories share one hand-rolled shape

- **Smell:** Duplicate Code / Alternative Classes with Different Interfaces (same job, different method names: `write`/`set`, `delete`/`clear`/`remove`, `validPayloads`/`validMarkers`).
- **Maintenance impact:** structural. Blast radius: 4 classes in 3 service dirs (+1 more outside the cluster: `operation-journal/service.ts` also calls `decodeRow`); change frequency: low-moderate (8 commits since June across the three files) but every one is a security invariant ("corrupt row must still block/reserve, never be removed").
- **Evidence:** identical private `key(id) = `${ROOT}@${id}``, `JSON.stringify` write, `get` via `decodeRow(schema, res[key])`, `clear` via `storage.remove(key)`, and (Tombstone, RestorePending) identical triple `validX()` loop (`for (const [,,v] of prefixedEntries(await this.storage.get(), `${ROOT}@`)) { decodeRow ...; if valid push }`) and `corruptIds()` (`prefixedEntries(...).filter(decodeRow !== valid).map(id)`):
  - `profile/tombstone-repository.ts:38-93`
  - `profile/restore-pending-repository.ts:44-93`
  - `account-integrity/blocked-repository.ts:19-47` (key/get/set/clear) and its second class `49-70` (key/get/set/clear again)
  `TombstoneRepository.validPayloads` vs `RestorePendingRepository.validMarkers` and the two `corruptIds` are line-for-line the same apart from root and schema. Each header comment re-explains "deliberately NOT an EntityStorage" because there is no shared name for the idiom.
- **Why it harms future change:** the next fail-closed marker (there have been three in a year) is another 50-line copy; a fix to the shared invariant (for example a key-prefix edge case, or a corrupt-row telemetry change) has to be replicated and the copies are judged by tests per class.
- **Smallest safe refactoring:** Extract Class `RawMarkerStore<T>(storage, root, schema)` in `apps/extension/src/wallet/utils/raw-row.ts`'s neighbour (same layer as `decodeRow`, so no layering change) exposing `set(id, v)`, `get(id): RawRowState<T>`, `remove(id)`, `ids()`, `validValues()`, `corruptIds()`. The four classes become thin typed wrappers that keep only their own semantics (`clearIfSame`, `deleteIfSame`, `isBlocked`). Alternative home is `@nulo/wallet-core/storage` next to `prefixedEntries`, only if another package needs it.
- **What disappears:** ~100 lines and the per-class copies of `key()`/loops; the four header essays collapse to one.
- **Instances:** `profile/tombstone-repository.ts:38-93`, `profile/restore-pending-repository.ts:44-93`, `account-integrity/blocked-repository.ts:19-70`; related caller outside cluster: `operation-journal/service.ts` (uses `decodeRow`, not verified for the same shape).

## q02-wallet-profile-state-C-5: AccountService row-identity gate and signing-key load duplicated in account/service.ts (and the repository)

- **Smell:** Duplicate Code (plus a one-site drift that is a latent bug, see bugs list).
- **Maintenance impact:** local to `account/service.ts` + `imported-keys-repository.ts`, but security-adjacent; `account/service.ts` 23 commits since 2026-06-01.
- **Evidence (a) identity gate:** "row body must agree with the key on profileId, chainId AND address" is written out as:
  - `account/service.ts:180` (`getAccount`, returns undefined)
  - `account/service.ts:339-341` (`getAccountContract`, throws `"unknown account address"`)
  - `account/service.ts:408-411` (`exportAccount`, same throw; jscpd lead 334-341 vs 406-411)
  - `account/imported-keys-repository.ts:29-30` (`ImportedKeysRepository.get`)
  - `account/service.ts:322` (`patchAccountField`), which checks only profileId + chainId (the drift).
  **(b) signing-key load:** `unsealImportedSigningKeyV2(...) -> Buffer.from(skBytes) -> GrumpkinScalar.fromBuffer(skCopy) -> finally zeroize(skBytes, skCopy, dek)` exists at `account/service.ts:378-400` (`loadImportedAccountContract`) and `425-446` (`exportAccount`); the second's comment says "See loadImportedAccountContract", i.e. a known copy.
- **Why it harms future change:** a change to the composite identity (a fourth field) or to the wipe discipline around the scalar must be made in 4-5 and 2 places; the wipe sequence is the thing most easily done wrong.
- **Smallest safe refactoring:** (a) Extract Function `rowMatchesKey(row, profileId, chainId, address)` (or `ownedAccountRow(row, key)`) in `account/spec.ts` beside `accountRowId`/`parseAccountRowId`, used by the service methods and the repository. (b) Extract Function `unsealSigningKey(dek, chainId, address, encrypted): Promise<GrumpkinScalar>` owning the two wipes (caller still owns the DEK).
- **What disappears:** ~25 lines; the `patchAccountField` drift becomes impossible.
- **Instances:** `account/service.ts:180, 322, 339, 409, 378-400, 425-446`; `account/imported-keys-repository.ts:29-30`.

## q02-wallet-profile-state-C-6: Restore-slice scaffold (epoch capture cast + lock + restoreRows + assertRestoreEpoch) repeated per service; config restore still hand-rolls the loop

- **Smell:** Duplicate Code (RECURRING in part, prior: q-2026-08-16 "restoreRows bypassed" finding, `audit/quality/2026-08-16-extension-mid/report.md:167`; `account/service.ts` restore and the id-reroll variant were fixed since, `config/service.ts` was not).
- **Maintenance impact:** cosmetic/local; low churn. Blast radius: 7 services (4 in cluster).
- **Evidence:** the hostile-row cast `rows.map((r) => (r as { profileId?: unknown } | null)?.profileId)` fed to `captureRestoreEpochs` is pasted at `contact/service.ts:287-290`, `account/service.ts:674-677, 766-769`, and `token/service.ts:858-861` (outside cluster); the other four callers pass `[profileId]`. Then each does `lock.withLock(() => restoreRows(rows, async (row) => { ...parse...; assertRestoreEpoch(deletion, epochs, row.profileId); write }))`. `config/service.ts:64-87` is the one restore that still hand-rolls try/catch -> `{...cp, restoreError: toRestoreError(err)}` instead of `restoreRows` (the allowlist `continue` is the only reason; it can be a `.filter` first).
- **Why it harms future change:** low; the risk is the ordering rule ("capture at method entry, before any await") being broken by a new restore writer that copies a neighbour.
- **Smallest safe refactoring:** Add `captureRestoreEpochsForRows(deletion, rows)` to `restore-fence.ts` (does the cast once, same module as the function it wraps); switch `config.restore` to `restoreRows(configProps.filter(allowlisted), ...)` with the skip logged in the filter.
- **What disappears:** ~15 lines and 4 casts; one of the last hand-rolled restore loops in the cluster.
- **Instances:** `contact/service.ts:287-290`, `account/service.ts:674-677, 766-769`, `token/service.ts:858-861`, `config/service.ts:64-87`.

## Non-findings considered

- `account-state/service.ts` sender vs contract registration (`prepareSenderRegistration` / `prepareContractRegistration`): parallel but already share `iterateRegistrations`, `classifyRestoreFailure`, `finalizeRestoreItem`; the guard ladders legitimately differ (contract has a precheck and pxe-provided skip). Not worth a generic.
- `profile/service.ts` `createPasskeyProfile` vs `importPasskeyProfile`: their row literals are covered by C-1; the pre-lock id/ceremony ordering differs on purpose (prompt must not hold the lock).
- `contact/service.ts` `updateContact`/`deleteContact`/`getContact` repeating `ensureInitialized + requireActiveProfile + requireOwnedRow`: 3 lines each, the active-vs-caller profile choice is documented as deliberately visible in `require-owned-row.ts`.
- `addContact` compensating-delete-on-deletion-race: the only site in the cluster using `captureExecutionFence` + post-write compensation; no second copy in cluster to consolidate.
- `id-allocators.ts`, `purge-rows.ts`, `restore-rows.ts`: already the extracted shared helpers from the prior dedup run; the prior "id-reroll hand-rolled 3x" finding is fixed in contact (`preferOrReallocId`); the remaining hand-rolled allocator in `profile/service.ts:2408` (`while contains||isReserved -> generateUniqueId`) and `nextUnreservedId` (`1346-1348`) differ in semantics (reserved-aware, source-id-preferring) and cost ~3 lines.
- `ProfileService.getProfileInfo` (`2242-2247`) vs `SessionManager.toInfo` (`725-729`): same 3-line projection, below threshold; unify only if either is touched.
- `ProfileService` as a Large Class (2,797 LOC): documented-accepted in the prior audit, and the accepted complexity directives cover its long methods; C-1..C-3 are the concrete, dedup-shaped reductions that shrink it without a split.
- `legal/service.ts`, `config/service.ts` (aside from C-6), `passkey/*`, `profile-deletion/coordinator.ts`, `account-integrity/coordinator.ts`, `backup/*`: read headers/skimmed, no semantic duplication found beyond the above; the backup migrators are a documented deliberately-declarative DSL.
- jscpd lead `profile/service.ts:675-685 vs 831-841`: two unlock phase-3 tails; covered by C-3(a); the wider bodies differ (password/passkey checks).
- jscpd leads `profile/client.ts:17-23 vs service.ts:107-113` and `contact/service.ts:131-136 vs 153-158`: generic service scaffolding (events/`requireOwnedRow` line) under threshold and documented triad convention.

## Incidental bugs noticed (for the bugs run)

- `apps/extension/src/wallet/services/account/service.ts:322-330` — `patchAccountField` validates only `profileId`/`chainId`, not `address`, then writes via `accountRowIdOf(account)`. Counter-example: a row stored at key(P,C,A) whose body says address B (transplanted row; the sibling readers at `180/339/409` reject exactly this): `changeAccountName(P,C,A,"x")` passes the gate, mutates the row and `storage.set(key(P,C,B), ...)`, overwriting account B's real row with A's body and leaving the transplant in place. Requires storage-writer access, so low severity, but it is the one account path that skips the identity gate the others enforce.
- `apps/extension/src/wallet/services/profile/service.ts:1965-1985` (`exportMnemonic`) — on wrong password throws the hard-coded `"Invalid profile old password"` while its sibling exports throw `InvalidPasswordError`; a caller/UI matching on `InvalidPasswordError` (as `auth.vue` does for unlock) never recognizes the export-seed wrong-password case. Pinned intentionally per its comment, so only a bug if the export-seed UI does not match the legacy string; verify in the bugs run.

## Cross-rebuttal (claude on codex)

### 1. Codex's findings
- **X-1 (six profile-row constructors): agree.** Same as my C-1; the six sites match (`profile/service.ts:606, 763, 2162, 2222, 2413, 2590`). Codex's commit evidence (`152b1083` touched six literals, `d56d6a85` touched three MAC calls) strengthens it. It rates the impact "Local", and I rate it structural. The auth-critical row shape makes structural the better call. Codex's password-builder-first plan is sensible. It also lists the passkey-restore site (2590), which I under-cited.
- **X-2 (config restore bypasses `restoreRows`): agree, same as my C-6.** I re-read `config/service.ts:62-84` against `restore-rows.ts:22-34`. The loop and the `{...row, restoreError}` fallback are identical in shape. The allowlist check can be a `.filter` before `restoreRows`, which keeps the skipped-key omission. One nit: the `restoreRows` header says errors return "the ORIGINAL input row", and that holds here because `TIn` is `ConfigProp`. Codex scopes this to config alone and misses the `captureRestoreEpochs` cast duplicated at `contact/service.ts:287`, `account/service.ts:674, 766` and `token/service.ts:858`.
- **X-3 (ProfileService Large Class / Divergent Change): partially agree.** The smell is real, since the file is 2,797 lines and every recent commit touches it. It is weaker as a dedup finding. The prior audit documented the class as accepted, with the long-method directives already covered. The proposed `PendingRestoreContexts` extraction is narrow and safe. The "Instances" list of 18 line numbers spans the whole class and shows no duplication. I would downgrade it to a hygiene or optional move, not a structural finding. Its only dedup-shaped payoff is the pending-map lifecycle, and I did not investigate that.

### 2. What Codex missed that I still stand by
- **C-2** (password-gated reveal/export skeleton): Codex dismissed it as a non-finding because error identities, check order and buffer ownership differ. I agree those differ, so a single generic helper would be wrong. The repeated skeleton (guard, unseal, fence, zeroize) still warrants a helper with explicit hooks. The divergent points can stay at the call sites, and the existing integration pin (`service.integration.test.ts:3055-3082`) makes that safe to try. I stand by it at moderate confidence.
- **C-3** (live-row guard repeated ~20 times, and the "open session, warn if degraded" tail 4 times): Codex reports neither. It is the highest-count duplication in the cluster, and the guard is mechanical.
- **C-4** (four raw-storage fail-closed marker repositories): Codex judged these intentionally distinct because their deletion predicates and lookup semantics differ, though they already share `decodeRow`. I partly concede, since what is left after `decodeRow` is thin. I stand by the claim that the shared shape is hand-rolled four times, at low to moderate confidence.
- **C-5** (AccountService row-identity gate and signing-key load, duplicated in `account/service.ts`): Codex has nothing on it. I stand by it.

### 3. What both missed
1. **Ad-hoc id allocation in `profile/service.ts:2408` and `:1346-1348` (`nextUnreservedId`).** Both loops use the `while contains || isReserved -> generateUniqueId` shape, and `id-allocators.ts` already has the shared allocators. Smell: Duplicate Code, a partly adopted extraction. The reserved-aware semantics do differ, so extending `nextRandomId` with a reservation predicate is a judgment call, not an obvious fix. Low confidence; a cheap refactor if either site is touched.
2. **`ProfileService.getProfileInfo` (`:2242-2247`) and `SessionManager.toInfo` (`:725-729`).** Both hand-write the same projection from a profile row to `ProfileInfo`. Smell: Duplicate Code, a Shotgun Surgery seed if `ProfileInfo` gains a field. Below the gate on cost, but one of the two call sites should delegate to the other.
