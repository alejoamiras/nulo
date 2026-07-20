# Planning leg — MAIN (independent draft, pre-consolidation)

My independent take before reading the codex/opus legs. Input: `findings.md`. Goal: ONE PR fixing A–H + tests + structural improvements, no entropy.

## Core insight for sequencing
Two INDEPENDENT workstreams + one that underpins several:

1. **Restore-boundary provenance + validation** (A, B, F, G, H) — all live at service `restore()` boundaries + the composable's pre-restore filter. These share a mechanism: *a restore must (a) schema-validate each row, (b) authorize account-owned rows against the imported-account set scoped by `(chainId, canonicalAddress)`, (c) never overwrite an existing keyed row (create-only).* Do this ONCE as a shared pattern, apply per slice.
2. **Deletion coordinator** (C, D) — makes profile/network deletion atomic + awaited, and fixes the wrong-profile `onTokenDeleted` wipe. Underpins the *privacy-erasure* guarantee. Independent of workstream 1 at the code level but both are needed for "safe."
3. **Remap correctness + structural** (E + index-pair tokens + split helper) — localized to the composable/helpers.

These are largely parallel; the risk is they all touch overlapping files (services + composable). Sequence to minimize merge churn: coordinator first (biggest, most invasive), then restore-boundary hardening, then remap/structural, tests inline throughout.

## Phase sketch (each ends with a real Validation gate)

### Phase 1 — restore-boundary contract: validate + create-only + provenance, as a shared primitive
- Introduce a `restoreRows`-level guard (there's already `@/wallet/services/restore-rows`): each row is `Schema.parse`d (reject → per-row restoreError, don't write — fixes G/H); writes are create-only where the key is content-addressed (tx `hash` — fixes B: `contains(hash)` → skip+record).
- Account-owned slices (transaction, auth-registry, token-balance) gain a provenance parameter: the set of `(chainId, canonicalAddress)` from successfully-restored accounts; rows outside it are dropped+recorded (fixes A + F). AccountService.restore canonicalizes + derives/verifies the address (fixes F's whitespace-address hole).
- Move the provenance filter OUT of the composable-only tx path INTO each service's restore boundary (or a shared pre-restore filter the composable applies to all 3 slices) so it can't be forgotten per-slice.
- Gate: unit tests for each slice (foreign account dropped incl. PRE-EXISTING account; wrong-chain dropped; hash-collision skipped; malformed row rejected) + `bun run typecheck && bun run lint`.

### Phase 2 — awaited deletion coordinator (C + D)
- The design fork (consult codex): (a) add an awaited dispatch variant to `EventHandler` vs (b) a dedicated `DeletionCoordinator` that snapshots `Account[]` and calls awaited cleanup hooks. Leaning (b) — narrower blast radius than changing EventHandler globally; the already-awaited `registerChainPurgeSubscriber` path is the model to extend.
- `onProfileDeleted`/`purgeChain` become awaited end-to-end: snapshot exact `Account[]` → pass positive `(chainId,address)` set to awaited tx/auth/incoming/token-balance cleanup → THEN delete account rows → THEN free the profile id (tombstone until all succeed; resume on SW restart). Critical local-delete failures abort+retry (not log-and-continue). PXE delete stops treating IndexedDB error/blocked as success.
- Fix C directly: carry authoritative `profileId` in the token-deletion path (extend the event payload / pass it through the coordinator) so IncomingTransfer scopes to the DELETED profile, never `getActiveProfile()`.
- Gate: unit — delete inactive profile sharing (chain,contract) does NOT touch active profile's incoming transfers/trust; delete-then-restore-same-backup does NOT clobber the new generation; a simulated mid-cleanup failure leaves a retryable tombstone. Network e2e — full delete→re-add round-trip shows no resurrected tx + no wrong-RPC hash query.

### Phase 3 — remap correctness + structural cleanups (E + index-pair tokens + split helper)
- E: build the complete index-paired old→new network-id map first, single traversal, exclude all source ids during allocation.
- Index-pair token relinking (delete the composite-key + skip-and-record path); explicit `{ok,row/error}` results; split `remapIdInBackupData` → `normalizeAllIds()` + `remapMatchingId(oldId,newId)`.
- Gate: unit (3+ network matrix; token index-pairing incl. duplicate-token-failure; no cascade aliasing) + typecheck + lint.

### Phase 4 — coverage completion + e2e arming
- Add the missing tests from findings.md (pre-existing-foreign-account, chain-provenance, legit unchanged-profile no-op, schema-real integration). Make the e2e arming/contract test UNCONDITIONAL in required CI (fail-not-skip on absent sandbox). Replace the hand-rolled subscriber loop in cross-profile-isolation with a real `deleteNetwork` call.
- Gate: `bun run audit:vue` + `bun run e2e:agent` (backup + deletion round-trips) green.

## Top risks
1. **Coordinator scope creep** — touching EventHandler/deletion could destabilize the whole service teardown. Mitigate: prefer the additive coordinator over changing EventHandler; keep the fire-and-forget emits for non-critical listeners, only await the data-integrity-critical cleanup.
2. **Provenance at the service boundary vs composable** — moving it into services changes every restore caller; must not break the migration-import path (`migrateBackupData` runs first). Keep the composable filter too (defense in depth) or prove the service-boundary filter covers the backup-import path.
3. **One-PR size** — this is large; the risk is an unreviewable diff. Mitigate: phase commits (conventional, separate), each independently green, so the PR reads as a sequence even though it merges once.

## Assumptions (Facts to verify in consolidation)
- `restore-rows.ts` is the shared restore helper (verify it's used by all account-owned slices).
- Tombstone persistence can reuse an existing storage root or needs a new ValueStorage key (pre-production → no migration, just a new key).
- The `submittedEndpointUrl`-absent → current-profile-node query (D) is fixed as a side effect of not resurrecting, OR needs its own guard.

## Security & adversarial
Backup blobs are attacker-controlled → presence-guard + schema-parse every row; provenance scope by (chainId, canonicalAddress); create-only for content-addressed keys; deletion must actually erase (privacy). Adversarial audit must attack: can any account-owned row still reach a victim profile? can deletion still leave/resurrect data? can the coordinator deadlock or partially-commit?
