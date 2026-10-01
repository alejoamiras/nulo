bugs found: 2 high, 3 medium

## Findings

- [transaction/service.ts:303](/home/homelab/Projects/nulo/nulo-review-275/apps/extension/src/wallet/services/transaction/service.ts:303) — **high** — Live hash collisions overwrite another profile’s transaction. Craft a schema-valid tx whose account passed the new filter but whose `hash` equals an existing victim tx. Line 310 calls unconditional `EntityStorage.set`; it does not fail on collision, contrary to the plan’s claim. The victim history disappears and the malicious row replaces it. Fix: under a transaction-service lock, use `contains(hash)` and return a restore error without writing; ideally add create-only storage semantics.

- [auth-registry/service.ts:431](/home/homelab/Projects/nulo/nulo-review-275/apps/extension/src/wallet/services/auth-registry/service.ts:431) — **high** — The foreign-account graft fixed for transactions remains open for authwits. Put an `auth-registry` row whose `account` is a victim profile’s address into the backup. Restore reallocates its ID and writes it verbatim at line 442; `getAuthwits(account)` then displays it in the victim profile. Deleting the imported profile does not purge it because only imported accounts emit deletion events. This corrupts the victim’s revocation index and can consume its tracked-authwit limit. Fix: filter every account-owned slice against the successfully imported account set, preferably at each service’s restore boundary.

- [useFullBackupImport.ts:417](/home/homelab/Projects/nulo/nulo-review-275/apps/extension/src/composables/useFullBackupImport.ts:417) — **medium** — Network remaps can cascade. If old `A` collides with live storage, restore assigns random `R`; if a later source network’s old ID is `R`, the later `R→S` pass rewrites both original-`R` rows and already-remapped `A→R` rows to `S`. `getRandomHex(8)` supplies only 32 random bits, and a large backup can include many guessed later IDs. Result: account-state from two networks is grafted onto `S`. Fix: construct the complete index-paired old→new map, then rewrite each original row exactly once; also exclude every source ID during allocation.

- [useFullBackupImport.ts:441](/home/homelab/Projects/nulo/nulo-review-275/apps/extension/src/composables/useFullBackupImport.ts:441) — **medium** — “Successfully imported” means only “storage write did not throw.” A complete account row with address `" "` succeeds, and a matching tx passes. Likewise, an account on chain 1 permits a tx for the same address on chain 2 because only address is checked; activity lookup ignores chain. Fix: have `AccountService.restore` schema-validate, canonicalize and derive/verify the address from `(secret, chainId, type, index)`, then authorize transactions by `(chainId, canonicalAddress)` and a successfully restored chain.

- [token/service.ts:558](/home/homelab/Projects/nulo/nulo-review-275/apps/extension/src/wallet/services/token/service.ts:558) — **medium** — P3 operates on tokens that were never write-validated. A token with `chainId: "1:"` and otherwise complete fields is reported successful, its balance is relinked, and both rows are written. On the next read, `TokenSchema` rejects the token because `chainId` is not numeric, leaving a cleanly reported but orphaned balance. Fix: `TokenSchema.parse` before allocation/write and use actual numeric IDs/types in the relinker.

## Improvements

- Replace sequential remaps with immutable mapping tables and one traversal.
- Use tuple/nested-map keys instead of delimiter strings.
- Surface security drops as non-blocking, user-visible warnings; console-only logging should not claim a complete restore.
- Return explicit `{ ok, row/error }` results rather than trusting an input-carryable `restoreError` property.

## Attacks that failed

- `NetworkService.restore` does return exactly one result per input, in order; migration cannot desynchronize pairing because the same post-migration array is passed and indexed.
- Direct hostile `profileId` grafts on top-level rows are closed by the unconditional remap.
- P3 delimiter collisions become ambiguous and are dropped, not grafted. The `as string` cast performs no runtime coercion; missing/numeric-mismatched token IDs are dropped and recorded.
- No append-induced double counting was found: only token-balance intentionally has pre-restore and restore-result diagnostics.