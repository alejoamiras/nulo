# Cluster D — identity services (profile/account/passkey/auth-registry/account-integrity/account-state/profile-deletion)

## Cluster verdict

This cluster is markedly higher quality than typical "LLM under time pressure" code: `profile/service.ts` (2691 lines) and `profile/session-manager.ts` (859 lines) in particular read as heavily and repeatedly audited (dozens of named invariants — "D13", "F-B24", "codex audit", "final-audit condition") with almost no incidental duplication given their size — most of the apparent repetition (the `captureRowFence` → unseal → `zeroize` dance repeated across unlock/export/restore paths) is *load-bearing* lock-discipline and buffer-ownership bookkeeping, not sloppiness, and collapsing it would raise real risk in a security-critical file for small LOC savings. The genuine, safe-to-fix waste is concentrated in three places: (1) `profile/client.ts` hand-writes 22 RPC passthrough methods when 16 of the cluster's 23 sibling clients (4 of them in this very cluster) already use the codebase's own `definePassthroughsExhaustive` factory built exactly for this; (2) four small repository classes (tombstones, restore-pending markers, integrity-blocked, integrity-verified-stamp) each hand-roll an identical "`${ROOT}@${id}` key, JSON.stringify/parse, zod `safeParse`, prefix-scan" pattern; (3) a handful of same-shape sibling methods (`changeAccountName`/`changeAccountVisibility`, the five `AccountStateService` PXE passthroughs, `PasskeyRecoveryCoordinator`'s four recovery methods) that differ only in one field/call. Biggest lever: the `client.ts` conversion (single biggest, lowest-risk win). Total realistically removable: **roughly 220–280 LOC**, essentially all in wrapper/boilerplate code, none of it touching the crypto/locking core.

## Findings

### F1 [inconsistency] `profile/client.ts` hand-writes RPC passthroughs the codebase already auto-generates
- **Where:** `apps/extension/src/wallet/services/profile/client.ts:21-113` (22 one-line forwarding methods); compare `apps/extension/src/wallet/services/account/client.ts:24-35`, `account-state/client.ts:21-29`, `auth-registry/client.ts:27-34`, `passkey/client.ts:15-19` (all already converted); the factory itself at `packages/extension-messaging/src/core/service-client-factory.ts:1-59`.
- **Evidence:** `profile/client.ts` today:
  ```ts
  public getActiveProfile(): Promise<ProfileInfo | undefined> {
      return this.request("getActiveProfile")
  }
  public getProfiles(): Promise<ProfileInfo[]> {
      return this.request("getProfiles")
  }
  // ... 20 more identical one-liners
  ```
  vs. the sibling `account/client.ts` in the same cluster:
  ```ts
  export interface AccountServiceClient extends MethodsSpec<Methods> {}
  export class AccountServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> { ... }
  definePassthroughsExhaustive<Methods>()(AccountServiceClient.prototype, [
      "getAccounts", "getAccount", "createAccount", ...
  ])
  ```
  The factory's own doc comment states the exact problem: *"The extension service clients are almost all pure forwarders... That body is identical across ~110 methods in ~18 clients — pure boilerplate whose only per-method content is the name."* 16 of the 23 `client.ts` files in `apps/extension/src/wallet/services/` already use it; `profile/client.ts` is one of only 7 holdouts, and the only one in this cluster.
- **Refactor:** Replace the 22 hand-written passthrough methods (`getActiveProfile` … `finalizeRestore`) with `definePassthroughsExhaustive<Methods>()(ProfileServiceClient.prototype, [ ...22 names... ])` plus the `interface ProfileServiceClient extends MethodsSpec<Methods> {}` declaration-merge, exactly matching the sibling clients. Keep the constructor, the five `EventHandler` fields, and the hand-rolled `subscribeActiveProfile` convenience method (it is not a pure passthrough). Lives entirely in `profile/client.ts` — extension layer, no package-boundary change.
- **LOC delta:** ~-70 (93 lines of forwards → ~25: the interface line + the exhaustive-call name list).
- **Risk / tests:** Low. The factory provides a compile-time exhaustiveness check (`Exclude<keyof M, T[number]> extends never`) that fails to compile if a method is dropped, so this can't silently lose an RPC method. `apps/extension/src/wallet/services/profile/spec.test.ts` and any test exercising `ProfileServiceClient` methods (popup composables, e2e) would catch a signature regression at compile time before runtime.
- **Confidence:** High.

### F2 [duplication] Four raw-storage repositories hand-roll the same key/parse/scan pattern
- **Where:** `apps/extension/src/wallet/services/profile/tombstone-repository.ts:41-111`, `apps/extension/src/wallet/services/profile/restore-pending-repository.ts:37-121`, `apps/extension/src/wallet/services/account-integrity/blocked-repository.ts:20-50` and `:59-82` (two classes in one file).
- **Evidence:** `TombstoneRepository`:
  ```ts
  private key(id: string): string { return `${PROFILE_TOMBSTONE_ROOT}@${id}` }
  public async validPayloads(): Promise<Tombstone[]> {
      const all = await this.storage.get()
      const prefix = `${PROFILE_TOMBSTONE_ROOT}@`
      const out: Tombstone[] = []
      for (const [k, v] of Object.entries(all)) {
          if (!k.startsWith(prefix)) continue
          const parsed = this.parse(v)
          if (parsed) out.push(parsed)
      }
      return out
  }
  private parse(raw: unknown): Tombstone | undefined {
      if (typeof raw !== "string") return undefined
      try {
          const p = TombstoneSchema.safeParse(JSON.parse(raw))
          return p.success ? p.data : undefined
      } catch { return undefined }
  }
  ```
  `RestorePendingRepository` reimplements the identical `key()`, the identical prefix-scan-then-`safeParse`-then-partition in `validMarkers()`/`corruptIds()`, and the identical try/catch-around-`JSON.parse`+`safeParse` in `get()`. `AccountIntegrityBlockedRepository`/`AccountIntegrityVerifiedStampRepository` repeat the same `key()` + try/catch/safeParse `get()` a third and fourth time. All four exist specifically because `EntityStorage` auto-purges rows that fail to decode, and each of these needs the opposite (fail-closed: a corrupt row must still count as present/reserved) — that rationale is identical across all four, only the schema and the "what corrupt means" story per-repo differ.
- **Refactor:** Extract a small generic `RawPrefixedStore<T>` (constructor takes `StorageArea`, root string, `z.ZodType<T>`) exposing `key(id)`, `set(id, value)`, `remove(id)`, `get(id): Promise<T | undefined>`, `allIds(): Promise<Set<string>>` (raw, undecoded), `validPayloads(): Promise<T[]>`, `corruptIds(): Promise<string[]>`. Natural home: alongside `EntityStorage`/`ValueStorage` in `packages/wallet-core/src/storage/` (same layer, same `StorageArea` port, parallel naming). Each of the four repositories keeps its own domain-specific method names (`reservedIds`, `write`, `clearIfSame`, `isBlocked`, `deleteIfSame`) as thin wrappers delegating to a private `RawPrefixedStore` instance — the compare-and-delete methods (`clearIfSame`, `deleteIfSame`) stay bespoke since their equality fields differ per repo.
- **LOC delta:** ~-60 to -80 (four ~15-25 line parse/scan blocks collapse into one ~35-line shared class + thin per-repo wrappers).
- **Risk / tests:** Low-medium — these are pure storage-codec helpers, but the "corrupt row still blocks/reserves" behavior is safety-critical (explicitly called out as audited: "Both plan auditors flagged auto-repair as unsafe"). Any refactor must preserve fail-closed semantics exactly. Covered by `apps/extension/src/wallet/services/profile/tombstone-repository.test.ts`, `restore-pending-repository.test.ts`, and `account-integrity/blocked-repository.test.ts` if present (not verified — test files were out of scope for this review; confirm these exist before refactoring, or add coverage first).
- **Confidence:** High.

### F3 [duplication] `PasskeyRecoveryCoordinator`'s four recovery methods share an identical tail
- **Where:** `apps/extension/src/wallet/services/profile/passkey-recovery-coordinator.ts:59-69` (`createForNewProfile`), `:75-85` (`recoverByCredentialId`), `:90-100` (`recoverUnknown`), `:112-122` (`recoverFromCredentialData`).
- **Evidence:** each method differs only in how `credential` is obtained, then repeats verbatim:
  ```ts
  const secret = await credential.deriveMasterSecret()
  const dekWrapKey = await credential.deriveDekWrapKey()
  return {
      credentialId: credential.id,
      secret,
      dekWrapKey,
      userHandle: credential.userHandle,
  }
  ```
  (present at lines 61-68, 77-84, 92-99, 114-121 — four times, byte-identical).
- **Refactor:** Extract a private `private async toRecovery(credential: PasskeyCredential): Promise<PasskeyRecovery>` doing the shared 6-line body. Each public method becomes a one-liner, e.g. `return this.toRecovery(await this.passkeys.getKey(credentialId))`. Lives in the same file (`profile/passkey-recovery-coordinator.ts`).
- **LOC delta:** ~-22 (4×~10-line methods → 1×6-line helper + 4×3-line callers).
- **Risk / tests:** Low — pure data-shape assembly, no branching or security decision changes (same calls, same order, same fields). Covered by `profile/passkey-recovery-coordinator.test.ts` if present, and transitively by profile create/unlock/import passkey flows.
- **Confidence:** High.

### F4 [duplication] `AccountStateService`'s five PXE methods share an identical try/catch wrapper
- **Where:** `apps/extension/src/wallet/services/account-state/service.ts:61-71` (`getAccounts`), `:73-83` (`getSenders`), `:118-130` (`addSender`), `:132-143` (`deleteSender`), `:145-155` (`getContracts`).
- **Evidence:**
  ```ts
  public async getAccounts(networkId: string): Promise<string[]> {
      await this.ensureInitialized()
      const network = await this.networkService.getNetwork(networkId)
      try {
          const accounts = await this.pxeService.getRegisteredAccounts(networkInfoFrom(network))
          return accounts.map((x) => x.address.toString())
      } catch (error) {
          this.logError("Failed to fetch registered accounts", getErrorMessage(error))
          throw new Error("PXE request failed")
      }
  }
  ```
  `getSenders`/`addSender`/`deleteSender`/`getContracts` repeat exactly this shape (`ensureInitialized` → `getNetwork` → try pxe call, map/emit → catch → `logError("Failed to ...")` → `throw new Error("PXE request failed")`), varying only the PXE call and the log verb.
- **Refactor:** Extract a private helper:
  ```ts
  private async viaPxe<T>(networkId: string, action: string, fn: (info: NetworkInfo) => Promise<T>): Promise<T> {
      const network = await this.networkService.getNetwork(networkId)
      try {
          return await fn(networkInfoFrom(network))
      } catch (error) {
          this.logError(`Failed to ${action}`, getErrorMessage(error))
          throw new Error("PXE request failed")
      }
  }
  ```
  Each public method becomes `await this.ensureInitialized(); return this.viaPxe(networkId, "fetch registered accounts", async (info) => (await this.pxeService.getRegisteredAccounts(info)).map(x => x.address.toString()))`. Keep the `.map()`/emit logic inside the callback so failures there are still caught identically to today (preserves exact current behavior). Lives in `account-state/service.ts`.
- **LOC delta:** ~-25 to -30.
- **Risk / tests:** Low — mechanical extraction, no branching change, same error message shape. Any `account-state/service.test.ts` covering these five RPCs would catch a regression.
- **Confidence:** High.

### F5 [duplication] `AccountService.changeAccountName` / `changeAccountVisibility` are the same shape
- **Where:** `apps/extension/src/wallet/services/account/service.ts:303-318` (`changeAccountName`) and `:320-338` (`changeAccountVisibility`).
- **Evidence:**
  ```ts
  public async changeAccountName(profileId: string, chainId: number, address: string, name: string): Promise<Account | undefined> {
      return this.tupleLocks.withLock(accountRowId(profileId, chainId, address), async () => {
          const account = await this.storage.get(accountRowId(profileId, chainId, address))
          if (account?.profileId !== profileId || account.chainId !== chainId) return undefined
          if (account.name !== name) {
              account.name = name
              await this.storage.set(accountRowIdOf(account), account)
              this.emit("onAccountUpdated", account)
          }
          return account
      })
  }
  ```
  `changeAccountVisibility` is byte-identical except `name`→`visible` throughout.
- **Refactor:** Extract a private generic `private async patchAccountField<K extends "name" | "visible">(profileId: string, chainId: number, address: string, field: K, value: Account[K]): Promise<Account | undefined>` with the shared lock/read/compare/write/emit body; both public methods become one-line callers. Lives in `account/service.ts`.
- **LOC delta:** ~-16.
- **Risk / tests:** Low. Any account-editing e2e/unit test on name or visibility toggling covers this.
- **Confidence:** High.

### F6 [duplication, smaller] Imported-account signing-key unseal/copy/wipe dance repeated twice
- **Where:** `apps/extension/src/wallet/services/account/service.ts:381-401` (`loadImportedAccountContract`) and `:429-441` (`exportAccount`'s imported branch).
- **Evidence:**
  ```ts
  let skBytes: Uint8Array<ArrayBuffer> | undefined
  let skCopy: Buffer | undefined
  try {
      skBytes = await unsealImportedSigningKeyV2(dek, account.chainId, account.address, keyRow.encryptedSigningKey)
      skCopy = Buffer.from(skBytes)
      const signingKey = GrumpkinScalar.fromBuffer(skCopy)
      ...
  } finally {
      zeroize(dek)
      if (skBytes) zeroize(skBytes)
      if (skCopy) zeroize(skCopy)
  }
  ```
  `exportAccount` repeats the same three-variable unseal→copy→`GrumpkinScalar.fromBuffer` dance with the same three-way zeroize in its `finally`, differing only in which error type wraps a failure.
- **Refactor:** Extract a helper `private async unsealSigningKeyScalar(dek, chainId, address, encryptedSigningKey): Promise<GrumpkinScalar>` doing the unseal + copy + `fromBuffer` + zeroize-of-intermediates, throwing a plain error on failure; each call site wraps that throw in its own error type (`ImportedAccountUnusableError` in one, a plain rethrow in the other). Lives in `account/service.ts`.
- **LOC delta:** ~-12 to -16.
- **Risk / tests:** Low-medium — touches key material handling, though it is a straightforward extraction of an already self-contained sequence (no invariant reordering). Covered by account import/export tests exercising imported (non-derived) accounts.
- **Confidence:** Medium.

### F7 [duplication, flagged low-priority] `auth-registry/service.ts`'s task lifecycle wrapper repeats 6 times
- **Where:** `apps/extension/src/wallet/services/auth-registry/service.ts:210-249` (`revokeAuthwits`), `:258-296` (`setRegistryEnabled`), `:301-310` (`syncRegistry`), `:346-355` (`syncAuthwits`), `:358-379` (`syncAuthwit`), `:382-402` (`syncStatus`).
- **Evidence:** every one of the six follows `const task = ...; try { ...; task.complete() } catch (error) { [maybeRethrowAsRpcCancel(error, task)]; task.fail(error); throw error }`. A codebase-wide grep shows this `task.complete()`/`.fail(error)` idiom appears 42 times across `apps/extension/src/wallet/services/` — not unique to this cluster.
- **Refactor:** Add a `run<T>(fn: () => Promise<T>): Promise<T>` method to `WrappedTask` (`apps/extension/src/wallet/services/task/wrapped-task.ts` — outside this cluster, but a small, shared, non-cluster-specific class) that does the try/complete/catch/fail/rethrow; auth-registry's 6 sites become `return task.run(() => { ... })`. The two sites that also call `maybeRethrowAsRpcCancel` need it invoked inside the catch before `task.fail` — either pass an optional `onError` hook or keep those two sites manual and only convert the 4 that don't need it.
- **LOC delta:** ~-15 to -20 within this cluster (larger if applied codebase-wide, which is out of scope here).
- **Risk / tests:** Medium — `apps/extension/src/wallet/services/execution/rpc-cancel.ts`'s own header explicitly warns: *"If you refactor a catch site, preserve the call [`maybeRethrowAsRpcCancel`] — silently dropping it brings back the wrong-toast UX bug."* Any change here must keep that call intact and is worth a second pass by someone who owns the task/execution layer, since `WrappedTask` is shared infrastructure used well outside this cluster.
- **Confidence:** Medium — real duplication, but the payoff-to-blast-radius ratio is worse than F1-F5, and it reaches into a shared class outside cluster D. Lower priority; do F1-F5 first.

### F8 [duplication, not recommended] `ProfileService`'s "authenticate password + revalidate fence" skeleton, 3x
- **Where:** `apps/extension/src/wallet/services/profile/service.ts:1746-1815` (`exportBackupMaterial`), `:1833-1866` (`exportImportedKeysDek`), `:1623-1669` (`exportPlain`, partially — it branches into `exportPasskeyCredential` first).
- **Evidence:** all three begin with `captureRowFence` → passkey-type-reject → `secretBox.unseal(password, sealedTriple(profile))` → `if (!unsealed) throw InvalidPasswordError()` → `if (await profileFenceBroken(id, capturedEpoch)) throw new Error("Invalid profile id")`, ~5-6 identical lines each (~15-18 total).
- **Refactor:** A shared `private async unsealPasswordProfileVerified(id, profile, password, capturedEpoch)` returning `{secret, entropy}` is mechanically possible.
- **LOC delta:** ~-10 to -15 only.
- **Risk / tests:** **High** — this is the most heavily audited file in the cluster (see the dense "codex audit"/"final-audit"/"P3 rider" annotations throughout `profile/service.ts`); each of the three sites has slightly different post-unseal behavior (one runs `assertEntropyMasterPair`, one doesn't; zeroize sets differ; error messages differ) and multiple prior audit rounds have clearly already scrutinized exactly this code. The LOC payoff is small and the risk of subtly changing a security invariant is real.
- **Confidence:** Medium. **Recommendation: skip** — value/risk ratio doesn't clear the bar for a security-critical, already-audited file.

## Not worth it

- `ImportedKeysRepository.liveRows()` (`account/imported-keys-repository.ts:40-46`) and `AccountService.liveRows()` (`account/service.ts:100-106`) are byte-identical 6-line functions — only 2 occurrences and each is well under the 20-line "only-twice" exemption threshold, so per the review's own rule this isn't worth a shared abstraction.
- `account/service.ts`'s next-index computation (`array_max(sameType.map(x => +x.index)) + 1`) appears in both `createAccountInternal` (line 264) and `importAccount` (line 485) — only 2 lines each, below the value bar.
- `account-state/service.ts`'s chain-dedup block (`seenChainIds` Set + filter) appears in `getSendersAcrossActiveNetworks` (lines 97-102) and `backup` (lines 165-170) — 6 lines × 2 = 12 total, just under the 15-line bar; a pure `dedupeByChainId(networks)` helper would be trivial but doesn't clear the threshold on its own.
- `profile/session-manager.ts` (859 lines) — read in full; despite its size, no duplicated logic found. Every method is distinct (open/close/refresh/restore/alarm-fire/TTL-apply each have genuinely different bracketing rules); this is dense but not verbose.
- `passkey/check-rp-id.ts`'s hand-rolled comment-stripping lexer (lines 121-167) looks like a candidate for a library, but it's an explicitly scoped, complexity-budget-accepted state machine (per CLAUDE.md's justified-baseline list) serving a narrow 2-3-file CI check — not worth swapping for a dependency.
- `ProfileDeletionCoordinator` and `AccountIntegrityCoordinator` both implement the same `IService` shape (`name`/`dependencies`/`start()`) but their bodies are entirely different orchestration logic — no shared extraction available beyond the interface itself.
- `profile/service.ts`'s repeated 3-line `if (profile.type === "passkey") throw new Error("Operation not supported for passkey profile")` guard (4 occurrences) is too small (3 lines) to be worth extracting on its own.
