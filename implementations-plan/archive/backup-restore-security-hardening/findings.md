# Backup-restore security hardening — verified findings (blueprint input)

Source: 3 parallel adversarial codex `gpt-5.6-sol` (xhigh) re-reviews of the merged PR #275 (`a1242ed`), + code-review. Raw transcripts in `reviews/`. Every finding below was **verified against the code by hand** (file:line confirmed), not just asserted.

**Framing correction this supersedes:** PR #275 closed ONE instance (transactions) of the foreign-account-graft bug CLASS and characterized the deletion cascade as "orphan-leak, not cross-profile corruption." Both are wrong: the graft is open for 2 more slices, and the delete path has active cross-profile destruction. The goal of this plan is ONE comprehensive PR that closes the whole class + the cascade — NOT more partial fixes.

## HIGH

### A — foreign-account graft is fixed for transactions ONLY
- `useFullBackupImport.ts:441` applies the imported-account provenance filter to the `transaction` slice only. `auth-registry` + `token-balance` are restored unfiltered in the generic loop (`:560`).
- `auth-registry/service.ts:442` writes `{ ...authwit, id }` verbatim — attacker-supplied `account` kept. `getAuthwits(victimAddress)` then shows it in the victim profile; deleting the imported profile does NOT purge it (only imported accounts emit deletion events). Corrupts the victim's revocation index + consumes its tracked-authwit limit.
- `token-balance` rows carry an `account` field → same graft.
- **Fix direction:** filter EVERY account-owned slice by the successfully-imported-account set — ideally enforced at each service's `restore` boundary, not only in the composable. (codex #1 HIGH, corroborated by #3.)

### B — transaction hash-collision overwrites a victim's tx
- `transaction/service.ts:310` `await this.txs.set(tx.hash, tx)` is an unconditional upsert; `EntityStorage.set` writes `${root}@${hash}` on the profile-shared `nulo:core:txs` root. Attacker sets `tx.hash` = a known victim tx hash (on-chain observable) + a self-owned `account` (passes the provenance filter) → the victim's row is overwritten and vanishes from the victim's activity.
- The plan's Assumptions noted the hash-keying but missed that upsert ⇒ cross-profile overwrite.
- **Fix direction:** create-only semantics — `contains(hash)` under the tx lock, skip-and-record on collision (a restore must never overwrite an existing tx). (codex #1 HIGH.)

### C — `onTokenDeleted` wipes the WRONG profile's incoming-transfer history
- `token/utils.ts:3` `getTokenInfo`/`TokenInfo` strips `profileId`. `token/service.ts:544` `onProfileDeleted` deletes the deleted profile's tokens, emitting `onTokenDeleted(TokenInfo)` (no profileId).
- `incoming-transfer/service.ts:479` `onTokenDeleted` reads `getActiveProfile()` — the WRONG profile — resolves its network, and deletes incoming-transfer records + resets trust to `unknown` for `(activeProfile, network, contract)`. Deleting an inactive profile that shares a `(chainId, contract)` with the active one destroys the ACTIVE profile's transfer history + trust. Deterministic; no SW-kill needed.
- **Fix direction:** carry authoritative `profileId` in `onTokenDeleted` (extend `TokenInfo` or the event payload) and scope IncomingTransfer cleanup to it; add an inactive-profile regression test. (codex #2 HIGH.)

### D — deletion cascade is not awaited: successor-clobber + active tx resurrection
- `EventHandler.invoke` (`packages/wallet-core/src/utils/event-handler.ts:22`) is synchronous + discards async-handler promises. `deleteProfile` (`profile/service.ts:568`) emits cleanup and RETURNS while listeners still run. Restore reuses the freed profile ID (`profile/service.ts:901`). Trigger: await delete → immediately restore same backup → late callbacks filtering that ID delete the NEW generation's networks/accounts/tokens/FPCs/contacts/dApp-sessions/incoming-transfers/journal/PXE. token-balance + auth-registry cleanup are themselves nested fire-and-forget.
- Resurrection is ACTIVE, not just displayed: deterministic address derivation (`account/service.ts:103,200`) + address-only reads (`transaction/service.ts:87`) resurface orphan txs; pending survivors are polled every second, rewritten, emitted (`:80,:179`); rows lacking `submittedEndpointUrl` query the CURRENT profile's node — leaking the old tx hash to the wrong RPC (`:199`).
- PXE deletion treats IndexedDB `error`/`blocked` as success (`packages/aztec-runtime/src/pxe/service.ts:468`). So "profile deleted" gives NO privacy-erasure guarantee.
- codex confirmed no `onChainPurged` consumer / later awaited subscriber depends on tx cleanup — the narrow ordering claim from #275 holds, but the cascade as a whole does not.
- **Fix direction (the "awaited deletion coordinator"):** tombstone/retain the profile until cleanup succeeds; snapshot the exact `Account[]`; pass their positive address set to AWAITED tx/auth/incoming cleanup before deleting account rows; await token-balance cleanup from authoritative tokens; critical local-deletion failures ABORT and stay retryable (not log-and-continue); resume tombstones after restart. (codex #2 HIGH; supersedes #275's deferred "P4".)

## MEDIUM

### E — network remap cascade-aliasing (32-bit id space)
- `useFullBackupImport.ts:417` remaps per-id sequentially. If old `A` collides with live storage → random `R`; if a later source network's old id IS `R`, the `R→S` pass rewrites BOTH original-`R` rows and already-remapped `A→R` rows → two networks' account-state grafts onto `S`. `getRandomHex(8)` = 32 random bits; a large backup can seed many guessed later ids. (Two reviewers flagged; NOT "astronomical.")
- **Fix:** build the complete index-paired old→new map first, rewrite each original row exactly once; exclude every source id during allocation. (codex #1 MED + #3.)

### F — "successfully imported" == "write didn't throw"; allow-set is address-only
- `useFullBackupImport.ts:441` authorizes txs by address alone → a tx for the same address on a DIFFERENT chain than the imported account passes. A complete account row with address `" "` (whitespace) "succeeds" and its tx passes.
- **Fix:** `AccountService.restore` schema-validates + canonicalizes + derives/verifies the address from `(secret, chainId, type, index)`; authorize txs (and account-owned slices) by `(chainId, canonicalAddress)` + a successfully-restored chain. (codex #1 MED + #3.)

### G — P3 relinks write-unvalidated tokens
- A token with `chainId: "1:"` + otherwise complete fields is reported "successful", its balance relinked, both rows written; next read `TokenSchema` rejects the token → cleanly-reported orphaned balance. (codex #1 MED.)
- **Fix:** `TokenSchema.parse` before allocation/write; numeric ids/types in the relinker.

### H — write-side validation gap (defense in depth)
- `account/service.ts:227`, `token/service.ts:558`, `transaction/service.ts:303`, `token-balance/service.ts:277` write attacker rows without schema-parsing inside the per-row error capture → malformed rows persist and become codec-hidden on read.
- **Fix:** parse with each service's schema at the restore boundary; return explicit `{ ok, row | error }`.

## Test coverage to add (codex #3)
- Provenance: a tx whose `account` is a PRE-EXISTING foreign account (in storage, not imported this restore) — the exact codex-caught case, currently unpinned by unit tests.
- Chain-provenance: import `(chain 1, A)`, supply a tx `(chain 2, A)` → must drop.
- Index-pairing: 3+ networks mixing changed-success / failed / unchanged-success + ambiguous display fields → assert `[M1, N2, N3, M4]` and `createdNetworks` = results 1/3/4.
- Legit unchanged-profile no-op: root id `P`, all children owned by `P`, restore returns `P` → all slices semantically identical, import finishes.
- Schema-real integration: complete `TokenSchema` / `TokenBalanceRawSchema` rows through a real service + positive raw-storage reads after restore.
- E2e: make the arming/contract test UNCONDITIONAL in required CI so an absent sandbox FAILS rather than skips both tests vacuously.
- Replace `cross-profile-isolation.test.ts:409`'s hand-rolled subscriber loop with a real `NetworkService.deleteNetwork` call.

## Structural improvements (codex #1/#3)
- Index-pair token relinking (like networks) → deletes the whole composite-key + skip-and-record path AND fixes "one duplicate token failing drops a good balance."
- Split `remapIdInBackupData` into `normalizeAllIds()` + `remapMatchingId(oldId, newId)` — the optional arg + `(newId, oldId)` order is a footgun.
- Explicit `{ ok, row/error }` restore results instead of an input-carryable `restoreError` property.

## Reviewer convergence (confidence signal)
- A (broader graft) + F (chain/validation): reviews #1 AND #3.
- E (cascade aliasing): reviews #1 AND #3.
- D (deletion cascade HIGH, release-blocking): review #2 + the original post-impl codex pass.
- #275's applied fixes (index-pairing, unconditional profileId, delimiter-safe composite key, append-merge): all THREE reviews' "attacks that failed" confirm they hold — the hardening BUILDS ON them, does not revert them.
