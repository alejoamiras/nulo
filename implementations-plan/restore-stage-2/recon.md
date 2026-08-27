# Arc 7 recon — F-Q02 restore-stage-2, against `dev@fe1fc582`

One deep read-only agent over `apps/extension/src/composables/useFullBackupImport.ts` (anchors verified; line numbers cited at recon time from `b1785570`, unchanged by #408/#412 which touch other files).

## Stage outline of `restoreBackup` (:351-878, 528 lines)

Stage 1 `validateAndMigrateBackup` already extracted (#396; module-level :116-181, closure-free, discriminated result — the extraction precedent). Then:

- **A profile restore** (:425-494): passkey ceremony branch, `profileService.restore`, writes `createdProfileId` (outer `let`), unconditional `normalizeAllIds(data, "profileId", …)`.
- **B networks + index-pairing** (:496-559): `networkService.restore`, `createdNetworks` filter (:504 — **read again at :796, Stage G**), `oldToNew` remap, active-network restore. Failure → `rollbackCreatedProfile` + early return.
- **C accounts + provenance filter** (:561-655): **`importedChainAddress` Set hoisted at :563** (comment says exactly why: "so the token re-link's chain-equality check (after the try) can see which (chainId,address) pairs were imported"); written ONLY at :582 from successfully-imported accounts; read at :611 (tx filter) and :704 (Stage D). `filterByAccount` applied to transaction/auth-registry/token-balance slices (in-place `data` mutation). Duplicate-account catch → rollback + early return; other errors rethrow to the outer catch.
- **D tokens + balance relink** (:657-718): `tokenService.restore`, then the relink `flatMap` with the **chain-equality check reading `importedChainAddress`** (:701-704) — a balance survives only if its account was imported ON THE TOKEN'S CHAIN; dropped rows get restoreError diagnostics.
- **E services loop** (:720-748): six clients (TRANSACTION, TOKEN_BALANCE, AUTH_REGISTRY, FPC, CONTACT, CONFIG), whole-loop try/finally disconnects. Least closure-coupled leg.
- **F finalize** (:750-764): writes `finalizeStarted` (outer `let`, read by the outer catch's rollback-vs-retain fork). Failure → no rollback, early return.
- **G account-state / chain-sync** (:766-804): reads `createdNetworks` from B.
- **Finish** (:806-822) + **outer catch** (:823-873 — rollback orchestration; RestoreStage three-way `rolling-back`/`rolled-back`/`rollback-failed` from #400; liveness-gated disconnect-classified rollback from #403) + **outer finally** (:874-877, client disconnects).

## Cross-stage couplings (the extraction-blocker profile)

1. `importedChainAddress`: C-write → C+D-read. THE named hard constraint ("must stay together or be threaded explicitly").
2. `createdNetworks`: B-write → G-read. Structurally identical second coupling the spec didn't name.
3. `createdProfileId`/`finalizeStarted`: A/F-write → outer-catch-read. Whole-closure bookkeeping, not stage-local.
4. `profileService`/`networkService` read in nearly every stage AND the outer finally; `rollbackCreatedProfile` closure used from B/C failure paths; `restoreStage` marker writes at every boundary (the phase-observability suite pins the exact ordered sequence).

## Test surface

All `restoreBackup` coverage is black-box through the whole closure (`useFullBackupImport.test.ts`, 1669 lines): P1 tx-provenance, P3 account-owned slices, P2 network index-pairing, P3 token-balance chain-key (this block DOES cover the C→D Set cross-check end-to-end: "keeps same-contract tokens on different chains distinct" :945-984, OLD-side ambiguity :1015-1045), failure branches incl. B-24 bounded rollback, the RestoreStage ordered-sequence suite (:1451-1567), and the #403 liveness-gate suite. `validateAndMigrateBackup` has the only direct-call (extracted-unit) suite. **Inter-stage contracts are unpinned** — stage outputs are closure locals; nothing characterizes them as values. Crash-truth e2e (backup-restore-sw-restart) exercises the outer-catch fork at two gate points only. `useProfileImportFlow`'s composition of this path has zero direct tests.

## Staleness

F-Q02's substance is NOT stale (stages + couplings verbatim on this tree). The OUTER CATCH is materially newer than the finding: #400 (RestoreStage markers at every boundary + three-way rollback stages) and #403 (liveness-gated rollback) both landed 2026-08-18, after the deferral was recorded. Any staging must treat the outer catch as current-shape and leave it in place.
