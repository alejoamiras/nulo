# Backup-restore security hardening — plan (deep)

**Status:** consolidated from 3 planning legs (codex `gpt-5.6-sol` xhigh, Opus, main) → decision ledger below → PENDING contradiction-check + double audit + final codex pass. · **Tier: deep** (security-sensitive HIGH + cross-subsystem blast radius HIGH + novel awaited-deletion-coordinator). · **ONE comprehensive PR** on `feat/backup-restore-security-hardening` → `dev`. Closes the whole foreign-account-graft CLASS + the un-awaited deletion cascade that PR #275 only partially addressed.

## Goal
Fix ALL verified findings in [`findings.md`](./findings.md) (A–H + the test-coverage list + structural improvements) in one coherent PR. After this PR: a restored row can only ever bind to an account THIS restore just created on the chain it was created on; deletion is atomic, awaited, and privacy-erasing. Do NOT revert #275's four applied fixes (index-pairing, unconditional `profileId` remap, delimiter-safe composite key, append-merge) — build on them.

## Load-bearing facts that shape the design (verified in code, file:line)
- `emit()` = `sendEvent` (UI fan-out) **+** `EventHandler.invoke`, which is synchronous and **discards** every async handler's promise (`packages/extension-messaging/src/core/base-service.ts:128`, `packages/wallet-core/src/utils/event-handler.ts:22`). Every awaitedness loss in the delete cascade is at this one boundary.
- The only already-awaited cascade is `NetworkService.purgeChain` → `registerChainPurgeSubscriber` (`network/service.ts:589`), but its subscribers re-`emit(...)` fire-and-forget, so the LEAF cleanups (tx/authwit/incoming/token-balance delete) are never awaited even inside purgeChain.
- `deleteProfile` (`profile/service.ts:560`) runs inside `runExclusive` (facade lock, **non-reentrant**), deletes the row, emits, and returns while subscribers still run. `restore` reuses the freed id with no tombstone (`profile/service.ts:901`).
- **The master secret is NOT available at account restore** (late activation: session opens only at `finalizeRestore`, AFTER all slice restores). `deriveAccountSecret → sessionManager.getSecret` throws `"Profile locked"` (`session-manager.ts:172`). ⇒ crypto derive-verify of the address at the restore boundary is impossible without restructuring late-activation.
- Account addresses are **chain-distinct** (`poseidon2([master, chainId, type, index])`, `account/service.ts:200`). ⇒ token-balance/authwit slices (carry `account`, no forgeable chainId) need only address-membership; only the **tx** slice needs a `(chainId,address)` tuple.
- Restore writers bypass the zod schemas; `EntityStorage.decodeRow` keeps-but-hides invalid rows (`entity_storage.ts:61`) → codec-hidden malformed rows (finding H). `EntityStorage.contains(id)` EXISTS (`entity_storage.ts:85`) → tx create-only is a direct `contains(hash)`→skip.
- PXE `clearChainState` resolves IndexedDB `onerror`/`onblocked` as success → "profile deleted" gives no erasure guarantee.

## Architecture decisions (decision ledger)
| # | Decision | Options | Chosen | Why |
|---|---|---|---|---|
| D1 | Awaited-deletion mechanism | (a) make `EventHandler.invoke` awaited globally · (b) **dedicated awaited coordinator calling explicit leaf-cleanup methods, `EventHandler` unchanged** | **(b)** | BOTH legs. (a) changes hot-path semantics for every subscriber AND **deadlocks** — `deleteProfile` holds the non-reentrant facade lock; an awaited subscriber re-entering `getActiveProfile()`→`runExclusive` re-enters it. The awaited cascade MUST run outside the facade lock. (b) reuses the trusted `purgeChain` shape. |
| D2 | tx hash-collision fix | global create-only `set` · **restore-local `contains(hash)`→skip under a tx lock** | **restore-local** | Both legs: global create-only breaks `updateTx`/rename/every legit upsert. `EntityStorage.contains` exists. `TransactionService` has no lock today → add one (mirror Token/Auth). |
| D3 | Provenance enforcement site | composable-only (as #275) · **service `restore` boundaries authoritative + composable pre-filters all 3 account-owned slices** | **both layers** | Services become authoritative (can't be forgotten per-slice); composable pre-filter is defense-in-depth + drives the UX (security-filter warning, not `restoreErrorLog`). |
| D4 | Finding-F address verification | crypto derive-verify at restore · **canonicalize (`AztecAddress.fromString`) + `(chainId,address)` tuple allow-set; defer derive-verify** | **canonicalize + tuple, defer** | Derive-verify is IMPOSSIBLE at the boundary (secret unavailable — late activation). Canonicalization kills the `" "`-address hole; tuple keying kills the cross-chain-tx hole. Residual: valid-format-but-non-derivable address imports into the USER'S OWN profile as inert phantom (`getAccountContract` throws on use). **Flag to audit** — the derive-verify sweep is a documented follow-up, not this PR. |
| D5 | Restore result shape | keep input-carryable `restoreError` · **`RestoreResult<T> = {ok:true,row} \| {ok:false,error}`** | **discriminated union** | codex leg: a hostile backup row can plant a `restoreError` field to impersonate a failure. Explicit results close that + are the substrate for per-row schema-parse (H). |
| D6 | Coordinator ownership | new `ProfileDeletionCoordinator` service · **private orchestration on `ProfileService`** | **ProfileService-owned** (lean) | Opus: avoids a new node in the topological startup graph; ProfileService already orchestrates deletion. **Re-confirm in audit** (codex leaned a separate service). |
| D7 | Fire-and-forget `onProfileDeleted` cleanup subs | remove (coordinator is sole path) · **retain as idempotent backstops** | **retain as idempotent backstops** (lean) | The lesson from #275: removing a redundant cleanup path WIDENED a gap. With the coordinator awaited + tombstone gating id-reuse, the old subs become harmless idempotent no-ops but survive as a safety net if the coordinator is interrupted pre-tombstone-clear. **Re-confirm in audit** (both legs leaned remove; I diverge on defense-in-depth grounds). |
| D8 | Tombstone payload | re-snapshot surviving rows on resume · **persist full `{addresses, tokenIds}` snapshot** | **persist snapshot** | Required for restart durability: resume must finish even after account rows are already deleted. |
| D9 | `onTokenDeleted` payload | widen `TokenInfo` with `profileId` · **dedicated `TokenDeleted = TokenInfo & {profileId}` payload** | **dedicated payload** | `TokenInfo` is deliberately profile-stripped for the RPC surface; a dedicated event payload minimizes blast radius. |
| D10 | PXE `blocked` handling | treat as success · **bounded-timeout retry then reject; `error` rejects immediately** | **bounded timeout** | codex Ask b + Opus Phase 7. A hung delete must not hang the coordinator forever, but must not be silently reported as erased. |

**Unresolved for the contradiction-check/audit:** D4 (defer derive-verify — is the residual acceptable?), D6 (coordinator ownership), D7 (retain vs remove backstops). These are the three genuine forks; everything else is settled by cross-leg convergence.

## Phases (each ends with a real Validation gate; tests must FAIL on pre-fix code)

### Phase 1 — validated-restore substrate + `RestoreResult<T>` (finding H; structural) ☐
- Introduce `RestoreResult<T>` in `packages/wallet-core/src/base`. Add `validateAndRestoreRows(rows, schema, writeOne)` (or extend `restore-rows.ts`) that `schema.safeParse`es each row INSIDE the per-row capture → parse failure routes to the error branch WITHOUT writing (keep best-effort: one bad row never drops the rest). Convert `restore-rows`, service/client restore signatures, `collectRestoreErrors`, composable together — no mixed convention.
- Per-row `AccountSchema`/`TokenBalanceRawSchema`/`AuthwitSchema` parse at their restore boundaries (tx + token get theirs in P2/P5 where those loops are rewritten anyway).
- **Tests:** malformed `TokenBalanceRaw` (missing `updatedAt`)/`Account` (`visible:"yes"`) persists pre-fix + reads back `undefined` (codec-hidden), post-fix returns error + raw storage never holds it; a hostile row carrying `restoreError` cannot impersonate failure; schema-real integration (real service + `FakeBrowserApi`, complete rows, positive raw-storage read).
- **Gate:** `bun run --cwd apps/extension vitest run src/wallet/services/account src/wallet/services/token-balance src/wallet/services/auth-registry && bun run typecheck:all && bun run lint`. Layers: typecheck+lint+unit+integration.

### Phase 2 — transaction create-only restore (finding B) ☐
- Add a `Lock` to `TransactionService`. In `restore`, under the lock: `contains(hash)` → record collision + skip (no overwrite); else `TxSchema.parse` (folds H) → `set`. Same lock guards `addTransaction`/worker writes/deletion to close TOCTOU + resurrection.
- **Tests:** seed `nulo:core:txs@victimHash` (self-owned account) → `restore` a row with that hash → pre-existing row UNCHANGED + result carries collision error (pre-fix overwrites → fails); two `restore`s racing the same new hash → exactly one wins.
- **Gate:** `bun run --cwd apps/extension vitest run src/wallet/services/transaction && bun run typecheck`. Layers: typecheck+unit.

### Phase 3 — broaden provenance to EVERY account-owned slice + chain/canonical allow-set (A + F) ☐
- `AccountService.restore`: `AztecAddress.fromString(address)` (reject `" "`/malformed → error), store canonical `.toString()`, dedupe within batch. "Successfully restored" ⇒ well-formed unique canonical address, not "`set` didn't throw."
- `useFullBackupImport.ts`: build `importedChainAddress = {`\`${chainId}:${address}\``}` + `importedAddresses = {address}` from the JUST-restored accounts (never "exists in storage"). Filter ALL three account-owned slices BEFORE the generic loop writes them: tx by `(chainId,account)` tuple; token-balance + auth-registry by `account`. Drops → security-filter `console.warn` (not `restoreErrorLog`, per #275 rationale). Service-boundary schema-parse (P1) is the defense-in-depth mirror.
- Residual (D4): document the non-derivable-address phantom as inert + self-profile-only; test-pin the inertness; derive-verify sweep = documented follow-up.
- **Tests (all red pre-fix):** pre-existing-foreign-account graft for tx/auth/balance (seed victim `V`, import only `A`, supply txs for both → only `A` reaches restore, raw storage never gets `V`); wrong-chain tx dropped; auth-registry + token-balance foreign-account rows not forwarded; whitespace address → `AccountService.restore` error + its txs dropped.
- **Gate:** `bun run --cwd apps/extension vitest run src/composables/useFullBackupImport.test.ts src/wallet/services/account && bun run typecheck:all && bun run lint`. Layers: typecheck+lint+unit+integration.

### Phase 4 — one-pass network remap + split helper (finding E) ☐
- Split `remapIdInBackupData` → `normalizeAllIds(data, key, value)` + `remapByMap(data, key, oldToNew: Map)`. After `networkService.restore`, build `oldToNew` by result index (pairing already unforgeable per #275), single `remapByMap` over a snapshot — each original row rewritten exactly once (no A→R then R→S aliasing). `NetworkService.restore` collision loop excludes EVERY source id in the batch during allocation.
- **Tests:** cascade-aliasing exploit (force A→R where a later B.old==R → assert A's children at R, B's at S, never both S); 3+ index matrix `[changed, failed, unchanged, changed]` → `[M1,N2,N3,M4]`, createdNetworks 1/3/4; legit unchanged-profile no-op.
- **Gate:** `bun run --cwd apps/extension vitest run src/composables/useFullBackupImport.test.ts src/utils src/wallet/services/network`. Layers: typecheck+lint+unit.

### Phase 5 — index-pair token relink + token write-validation (finding G; structural) ☐
- Replace the `(chainId,contract)` composite-key relink with index-pairing (`oldTokens[i].id → newTokens[i].id` for `!error`, `Map<number,number>`). Failed duplicate drops only ITS balance. `TokenService.restore`: `TokenSchema.parse` before id-allocation/write (catches `chainId:"1:"` before a balance is relinked to a soon-rejected token). Numeric ids/types.
- **Tests:** token `chainId:"1:"` → restore error + balance dropped-and-recorded + neither in raw storage (pre-fix: token "succeeds", balance orphaned on next read); two same-contract tokens, token 2 fails → token 1's balance still links to token 1; assert dropped-row id+message. #275's existing ambiguity/append tests still green.
- **Gate:** `bun run --cwd apps/extension vitest run src/composables/useFullBackupImport.test.ts src/wallet/services/token`. Layers: typecheck+lint+unit.

### Phase 6 — `onTokenDeleted` carries authoritative `profileId` (finding C) ☐
- `TokenDeleted = TokenInfo & {profileId}` payload; emit at `token/service.ts:99` (clearChainState) + `:300` (`_deleteTokenById`) with `token.profileId`. `IncomingTransferService.onTokenDeleted` (`:479`) uses the payload's `profileId`, NOT `getActiveProfile()` (mirror the correct `onAccountDeleted` pattern at `:214`). `TokenBalanceService.onTokenDeleted` accepts the new shape (already token-id-keyed = profile-safe).
- **Tests (`cross-profile-isolation.test.ts`, real services):** active P1 + inactive P2 both hold a token on the same `(chainId,contract)`, P1 has incoming records + `trusted`; delete P2's token → P1's records + trust UNTOUCHED (pre-fix wipes P1 → fails).
- **Gate:** `bun run --cwd apps/extension vitest run src/wallet/services/cross-profile-isolation.test.ts src/wallet/services/incoming-transfer && bun run typecheck`. Layers: typecheck+unit+integration.

### Phase 7 — PXE deletion honesty (finding D privacy sub-item) ☐
- `pxe/service.ts clearChainState`: `onerror` → reject; `onblocked` → bounded-timeout retry then reject (D10). `purgeChain` propagates (no longer log-and-swallow); the coordinator treats PXE-clear failure as CRITICAL.
- **Tests:** fake `indexedDB.deleteDatabase` firing `onerror`/`onblocked` → `clearChainState` rejects (pre-fix resolves).
- **Gate:** `bun run --filter '@nulo/aztec-runtime' test`. Layers: unit.

### Phase 8 — awaited deletion coordinator + durable tombstones (finding D core) ☐
- Durable tombstone `EntityStorage` under new root `nulo:core:profile-tombstones` (new persisted shape — allowed, NO migration pre-production; delete-path state, not a backup root — verify block-list). Payload `{profileId, addresses[], tokenIds[], stage}` (D8).
- `deleteProfile` → two-phase: **under facade lock** validate → write tombstone (snapshot addresses via AccountService + token ids via TokenService) → delete profile row → close session → emit `onProfileDeleted` (UI notify only). **Outside the lock**: run the awaited coordinator sequence (idempotent, fail-fast, critical-failure-retains-tombstone): `TransactionService.purgeForAccounts(addresses)` → `AuthRegistryService.purgeForAccounts(addresses)` → `IncomingTransferService.clearProfile(profileId)` → `TokenBalanceService.purgeForTokens(tokenIds)` → `NetworkService.purgeProfile(profileId)` (per-network purgeChain incl. now-critical PXE). Each leaf method is the SINGLE impl the fire-and-forget event handler ALSO calls (no duplicated logic). On full success: clear tombstone (under lock). `restore`/`generateUniqueId` exclude tombstoned ids (linchpin closing successor-clobber + resurrection). Resume: enumerate tombstones AFTER `services.start()` (not in `init`), re-run coordinator.
- Backstop subs (D7): retain the fire-and-forget `onProfileDeleted` cleanup subscriptions as idempotent safety nets.
- **Tests (composition/integration):** successor-clobber (delete P → immediate restore of a backup with root id P → fresh id + new generation survives); awaited-boundary (post-`await deleteProfile` all leaf stores empty synchronously); restart-resume (tombstone + fresh ProfileService on same FakeBrowserApi → cleanup completes + tombstone clears); critical-failure retryable (inject reject → tombstone remains, re-run converges); pending tx cannot rewrite/query-wrong-RPC after purge; replace `cross-profile-isolation.test.ts:409` hand-rolled loop with a real `NetworkService.deleteNetwork`.
- **Gate:** `bun run --cwd apps/extension vitest run src/wallet/services/profile src/wallet/services/cross-profile-isolation.test.ts src/wallet/services/transaction src/wallet/services/auth-registry src/wallet/services/token-balance src/wallet/services/incoming-transfer src/wallet/services/network && bun run --filter '@nulo/wallet-core' test && bun run typecheck:all && bun run lint`. Layers: typecheck+lint+unit+integration+composition.

### Phase 9 — coverage completion + e2e contract hardening ☐
- Make `backup-restore-integrity.test.ts` arming/contract test UNCONDITIONAL in required CI (absent sandbox FAILS, not skips); extend it to exercise foreign auth/balance rows + preserve valid rows + the delete→re-add round-trip (no resurrected tx). Consolidate the provenance/chain/index/no-op tests.
- **Gate:** `bun run audit:vue && bun run e2e:agent tests/e2e/network/backup-restore-integrity.test.ts && bun run e2e:agent`. Layers: typecheck+lint+unit+component+**network e2e**.

## Sequencing
Phase 1 (substrate) first. Then two parallel clusters: **restore-path** (2,3,4,5 — 2+3 coupled; 4,5 share the index-map refactor) and **delete-path** (6,7,8 — 7 before 8; 6 independent; 8 is the hub, needs leaf services exposing public awaited cleanup). Phase 9 last (needs all green). All one PR, phase commits conventional + separately green.

## Security & Adversarial Considerations
- **Threat model:** the backup blob is fully attacker-controlled and its plain checksum is attacker-recomputable (`useFullBackupImport.ts:229`) — nothing downstream may treat it as authentication. Victim = a user importing a malicious backup; assets = other profiles' data (A/B/C/D) + privacy-erasure on delete (D).
- Closes every cross-profile WRITE primitive: foreign-account graft on ALL account-owned slices (A/F), tx-hash-collision overwrite (B), wrong-profile incoming-transfer wipe (C), successor-clobber + resurrection (D). Post-PR a restored row binds only to a this-restore account on its derived chain.
- Privacy: PXE no longer false-success (P7); tombstone retained on erasure failure ⇒ "deleted" = "verifiably erased or pending-retryable", never silently leaked.
- New durable tombstone state is itself hostile-adjacent on read-back — validate shape; a corrupt tombstone must never brick profile creation.
- **Do NOT weaken CI gates** (CLAUDE.md non-negotiable): the unconditional e2e contract is a strengthening, not a skip.
- Audit asks (codex + opus, every phase): "what could still reach a victim profile? can deletion still leave/resurrect/false-succeed? can the coordinator deadlock or partially-commit? attack the Assumptions Facts/Inferences/Asks."

## Assumptions
**Facts:** see "Load-bearing facts" above (all file:line-verified across the two legs).
**Inferences (attack these):** removing vs retaining the fire-and-forget `onProfileDeleted` subs is correctness-equivalent given the tombstone gates id-reuse (D7 retains for defense-in-depth); `account-state` is network-scoped (remapped by networkId) so needs no account provenance — VERIFY it carries no forgeable account field; `TokenService.restore` returns one ordered result per input (index-pairing sound); tombstone-resume can hook post-`services.start()`.
**Asks (resolved AFK per leg recs, re-confirm in audit):** D4 defer derive-verify · D6 ProfileService-owned coordinator · D7 retain backstops · D8 persist snapshot · D10 bounded PXE timeout · tombstone root not block-listed.

## Audit trail
- Legs: [`plan-leg-codex.md`](./plan-leg-codex.md), [`plan-leg-opus.md`](./plan-leg-opus.md), [`plan-leg-main.md`](./plan-leg-main.md). Findings + raw reviews: [`findings.md`](./findings.md), [`reviews/`](./reviews/).
- Pending: contradiction-check (codex + opus on this consolidated plan + ledger) → double audit → final fresh codex pass → `eli5.html` → implement.
