# Planning leg — OPUS (independent, deep-code-research)

Compact faithful record. Full reasoning folded into `plan.md`. This leg's unique value = load-bearing facts it verified in code that reshape the plan.

## Load-bearing facts it established (file:line)
- `emit()` = `sendEvent` (UI fan-out) **+** `EventHandler.invoke` which is synchronous and **discards** async handlers' promises (`packages/extension-messaging/src/core/base-service.ts:128`, `packages/wallet-core/src/utils/event-handler.ts:22`). Every awaitedness loss is at this one boundary.
- Only already-awaited cascade = `NetworkService.purgeChain` → `registerChainPurgeSubscriber` (`network/service.ts:589`). But those subscribers themselves `emit(...)` → fire-and-forget again, so the LEAF cleanups (tx/authwit/incoming/token-balance delete) are never awaited even inside purgeChain.
- `deleteProfile` (`profile/service.ts:560`) runs inside `runExclusive` (facade lock, **non-reentrant**), deletes the row, `emit("onProfileDeleted")`, returns while subscribers still run.
- `restore` reuses the freed profile id (`profile/service.ts:901`) — no tombstone consulted → successor-clobber + resurrection window.
- **CRITICAL constraint (corrects codex): the master secret is NOT available at account restore.** Import order: `profileService.restore` (row, NO session — late activation) → account/token/… restore → `finalizeRestore` (opens session). `deriveAccountSecret → sessionManager.getSecret` throws `"Profile locked"` (`session-manager.ts:172`). So "derive/verify address from (secret,chainId,type,index) at the restore boundary" is **impossible** without restructuring late-activation.
- Account addresses are **chain-distinct**: `deriveAccountSecret = poseidon2([master, chainId, type, index])` (`account/service.ts:200`). ⇒ token-balance/authwit slices (carry `account`, no independent forgeable chainId) need only address-membership; only the **tx** slice needs a `(chainId,address)` tuple.
- All schemas exist (`TxSchema`/`AccountSchema`/`TokenSchema`/`TokenBalanceRawSchema`/`AuthwitSchema`) and are the read-codec, but `restore()` writers bypass them; `EntityStorage.decodeRow` keeps-but-returns-undefined on invalid (`entity_storage.ts:61`) → codec-hidden malformed rows (finding H).
- PXE `clearChainState` resolves `onerror`/`onblocked` as success (`packages/aztec-runtime/src/pxe/service.ts`).
- **Facade-lock deadlock risk:** an awaited `onProfileDeleted` subscriber that re-enters `getActiveProfile()`→`runExclusive` deadlocks. The awaited cascade MUST run OUTSIDE the facade lock.

## Phase structure (9) — adopted as plan.md's spine
1 validated-restore substrate + `{ok,row|error}` (H) · 2 tx create-only under a new tx lock (B) · 3 broaden provenance to ALL account-owned slices + `(chainId,address)` tuple + canonicalization (A/F) · 4 one-pass network remap + split helper (E) · 5 index-pair token relink + token write-validation (G) · 6 `onTokenDeleted` carries authoritative `profileId` (C) · 7 PXE deletion honesty (D-privacy) · 8 awaited deletion coordinator + durable tombstones (D core) · 9 coverage completion + unconditional e2e contract.

## Top risks it named
1. Facade-lock reentrancy/ordering in the coordinator (deadlock vs race) — two-phase: row-delete under lock, awaited cascade lock-free, tombstone gates id-reuse.
2. Restart-resume convergence + init ordering — resume must run AFTER `services.start()`, not in `init`; validate tombstone shape as hostile-adjacent.
3. Finding-F derive-verify gap — can't derive at restore boundary; canonicalize + tuple-gate instead; residual = valid-format-but-non-derivable address imports into the USER'S OWN profile as inert phantom (getAccountContract throws on use).

## Asks (owner decisions) + Opus recommendation
1. F depth: defer full derive-verify (needs post-finalizeRestore sweep) — **rec defer** (self-profile-only, inert).
2. Coordinator ownership: private method on ProfileService vs new service — **rec private-method**.
3. Fire-and-forget `onProfileDeleted` cleanup subs: remove vs retain as idempotent backstops — **rec remove**.
4. Tombstone payload: persist full `{addresses,tokenIds}` snapshot vs re-snapshot on resume — **rec persist**.
5. New tombstone root `nulo:core:profile-tombstones` — confirm not a block-listed backup root (delete-path state, not exported).

## Entropy-adding naive fixes it flagged (converges with codex)
- B: global create-only `EntityStorage.set` breaks `updateTx`/rename/etc. → restore-LOCAL only.
- D: global awaited `EventHandler.invoke` → facade-lock deadlock + changes hot-path semantics → separate coordinator.
- A: "address exists in storage globally" re-opens the pre-existing-foreign-account hole → use the just-restored set.
- E: even "fixed" sequential remap still cascade-aliases → full-map single pass.
- G: contract-only/new-side-only key regresses #275 → index-pairing REPLACES composite key, preserves dropped-balance diagnostics.
