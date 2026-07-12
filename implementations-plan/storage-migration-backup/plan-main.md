# Backup-import migration — plan (main-agent draft)

> Independent draft #3 of 3 (main). Consolidated with the codex + fable drafts, then double-audited. Architecture position here is deliberately the "true single-source" one so the audit can weigh it against the adapter-only positions.

## Goal
When a user imports a full-backup exported from an OLDER schema, migrate its contents forward to the current schema **before** the service-by-service restore runs, instead of rejecting it. Reuse the numbered-migration engine from #246 so backup migrations and live migrations are the SAME objects — never a divergent second copy.

## Ground truth (verified this session)
- `service.backup()` returns stored row VALUES verbatim, profile-filtered: `account/service.ts:58` → `storage.getValues().filter(x => x.profileId === profile.id)`. So a slice is `T[]` of the same shape as live rows — NOT a projection.
- `service.restore(slice)` re-keys by a VALUE field: `account/service.ts` writes `storage.set(account.address, account)`. The row key is derived from the value, per service (account→`address`, most others→`id`).
- Blob: `{ "wallet-version","aztec-version","schema-version":2,"master-key",data:{<slice>},checksum }` (`export/full.vue:128-143`), checksum = hash over the whole blob-minus-checksum, computed last.
- Import: `useFullBackupImport.ts` — L207 strip+recompute+compare checksum; L216 `schema-version !== 2` reject (conflates incompatible vs old); restore is service-method-driven with cross-slice ID remapping (`remapIdInBackupData`, token id↔contract).
- Live engine: `MigrationContext={local:MigrationArea}`; `Migrator.run()` over an injected `MinimalStorageArea`; `applyOne()` wraps one migration in the durable journal (backup/running/stamp). 41 engine tests, 4 e2e — audited across 6 codex + 4 fable rounds (#246).

## Architecture — D: extract a journal-free shared apply-core (my pick)
The live migrations transform storage ROWS via `MigrationArea`. A backup is profile-scoped slice-arrays. Four candidate homes for the vN→current transform:

- **A. Adapter-over-MigrationArea, custom apply loop.** A `MigrationArea` implemented over the slice-arrays; then run each pending `migration.up(ctx)` in sequence. Reuses migration OBJECTS but REIMPLEMENTS the version-filter + sequencing + fail-closed loop that lives in `Migrator.runInner`/`applyOne` → divergence risk (the exact thing #246 unified). Rejected as the primary — but its adapter is a building block.
- **B. Version each `service.restore(slice, fromVersion)`.** Scatters migration logic into every service; abandons the single numbered source. Rejected outright — it is the pre-#246 anti-pattern.
- **C. Normalize slices→rows in a scratch `MinimalStorageArea`, run the whole `Migrator.run()`, re-slice.** Maximal reuse, zero new apply logic. Cost: the durable journal (backup/running/stamp keys) is inert dead-weight on a one-shot in-memory transform, and reserved `nulo:schema:*` keys must be filtered on read-back. Viable fallback.
- **D (pick). Extract the journal-free apply-core from `Migrator` into a shared primitive** both paths call: `applyMigrations({store, migrations, fromVersion, toVersion})` that does version-filter + ordered `up()` + commit + fail-closed, WITHOUT the durable journal. The live `Migrator.run()` wraps it with the crash-safe journal (persisted store); the backup path calls it directly over an in-memory store seeded from the slices. **True single-source: the sequencing/fail-closed logic exists once, tested once, used twice.**

Why D over C: C reuses the engine but drags the journal semantics (running-marker, backup-key, version-stamp, resume matrix) into a context where none of them mean anything — an in-memory one-shot can't be "interrupted" across boots, so the journal is pure overhead plus a reserved-key-leak footgun. D gives the backup path exactly the logic it needs (ordered, fail-closed application) and nothing it doesn't.

Why D over A: A duplicates `runInner`/`applyOne`'s loop. D makes that loop the shared primitive so there's nothing to duplicate.

**Cost of D, stated honestly:** it refactors the just-shipped, 10-audit-round engine (`migrator.ts`) — extracting the apply-core from `applyOne` without disturbing the journal wrapper. This MUST re-run the full #246 gate (41 engine tests + 4 e2e + the live-boot path) to prove the live path is byte-for-byte unchanged. If the audit judges the refactor risk to the audited engine too high, **fall back to C** (no engine change; the backup path stands up its own scratch store + Migrator and filters reserved keys). C is the safe-but-less-pure escape hatch; the decision ledger will carry both.

## The mapping registry (needed by A/C/D alike)
A single source-of-truth registry, colocated with the export/import, mapping each backup slice to its storage target:
```
type SliceMap =
  | { slice: string; kind: "root"; root: string; keyOf: (v: unknown) => string }   // EntityStorage services
  | { slice: string; kind: "value"; key: string }                                  // ValueStorage services (e.g. config)
```
- Derived + PINNED against the services' own root declarations by a parity test (import each service's root constant; assert the registry matches) so a service relocating its root fails CI, not silently mis-migrates.
- `keyOf` per service mirrors that service's `restore()` keying (account→`v.address`, id-keyed services→`v.id`). Pinned by the same parity test.
- Covers missing-slice semantics: a slice absent from a vN blob that a migration reads → the normalized store simply has no rows for that root (migration sees `[]`), which is correct; a slice PRESENT but for a root no migration/registry knows → fail-closed (unknown slice = refuse, don't silently drop user data).

## Compat-epoch vs migratable-version split
- Add to the export format (new backup-v1 baseline, per the "redefine freely" decision):
  - `backup-schema-version: <int>` — the MIGRATABLE version (drives the engine; current baseline stamps 1).
  - `compat-epoch: <string>` — NON-migratable account-contract generation (what `schema-version:2` really guarded). Genuinely un-importable blobs (custom pre-release contracts) carry a different epoch.
- Rewire `useFullBackupImport.ts:216`: reject **iff** `compat-epoch !== CURRENT_COMPAT_EPOCH`; else migrate `backup-schema-version → current` and proceed. Retire the `!== 2` conflation.
- The legacy `schema-version` field: with the baseline redefined and no pre-baseline back-compat, the new format drops/ignores it (or keeps it frozen at 2 for one release as a tombstone — audit to decide).

## Checksum trust ordering (security-critical)
1. Verify checksum over the ORIGINAL decoded bytes (unchanged from today) — integrity gate BEFORE anything.
2. Only then migrate the (now-trusted) blob in memory.
3. The migrated blob's checksum is NOT re-provable as user integrity — it's a derived artifact. **Do not** recompute-and-trust as an integrity signal (that inversion would let a tampered blob through if step 1 were ever skipped). Recompute only if a downstream consumer needs a well-formed blob; otherwise drop it and treat step 1 as the sole integrity proof. The migrated slices flow straight into `service.restore()`, which has its own per-row validation.

## Phases

### Phase 1 — Engine: extract the journal-free apply-core (or ratify fallback C)
Extract `applyMigrations({store, migrations, fromVersion, toVersion})` from `Migrator` (shared by `run()` and the backup path); prove the live path unchanged.
- **Validation gate:** `bun run --cwd packages/wallet-core typecheck && bun run --cwd packages/wallet-core test src/migration` (all 41 pre-existing green + new apply-core unit tests) `&& bun run typecheck`. Layers: typecheck + unit. **Plus** re-prove the live e2e unchanged: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 build:chrome && NULO_E2E_MIGRATION_FIXTURE=1 test:e2e migration` = 4/4. If the audit selects fallback C, this phase becomes "stand up the scratch-store + reserved-key filter" with the same unit gate and NO engine change.

### Phase 2 — Mapping registry + slice↔row normalizer + parity tests
The `SliceMap` registry, the `normalize(slices)→MinimalStorageArea` and `denormalize(store)→slices` transforms, reserved-key filtering, missing/unknown-slice semantics.
- **Validation gate:** `bun run --cwd apps/extension test <registry+normalizer test path>` — round-trip parity (normalize∘denormalize = identity on well-formed slices), registry↔service-root parity (fails if a service's root drifts), unknown-slice fail-closed, config/value-key handling. Layers: typecheck + lint + unit.

### Phase 3 — Backup migration driver + compat-epoch format change
`migrateBackup(blob) → migratedBlob | {incompatible} | {failed}`: compat-epoch gate → normalize → `applyMigrations` (or scratch Migrator) → denormalize → re-assemble. Add `backup-schema-version` + `compat-epoch` to `export/full.vue`; define the current-baseline stamps.
- **Validation gate:** `bun run --cwd apps/extension test <driver test path>` — a seeded vN blob migrates to current; an incompatible-epoch blob returns `{incompatible}`; a current-version blob is a no-op; a mid-migration throw yields `{failed}` with no partial output. Layers: typecheck + lint + unit.

### Phase 4 — Import-flow rewire (checksum ordering + reject → migrate)
Wire `migrateBackup` into `useFullBackupImport.ts`: verify-checksum → migrate → restore; replace the `!== 2` reject with the compat-epoch gate; preserve the existing ID-remap + orphan-rollback on failure. Reconcile: migration runs BEFORE `service.restore`, so remapping (which happens during restore) is unaffected — migrations transform values, restore still re-keys + remaps IDs downstream.
- **Validation gate:** `bun run --cwd apps/extension test src/composables/useFullBackupImport*` (Vitest component) — version detection, compat reject copy, checksum-before-migrate ordering, failure atomicity (no half-restore). `bun run lint && bun run typecheck`. Layers: typecheck + lint + unit + component.

### Phase 5 — Smoke e2e + docs
Smoke e2e: import a fixture vN backup → migrates forward end-to-end; incompatible-epoch → rejects; same-version → no-op. Update ARCHITECTURE §5 + the export/import READMEs + CLAUDE.md pointer.
- **Validation gate:** `bun run test:e2e <backup-migration smoke name>` green; `bun run audit:vue` (typecheck→unit+component→lint→build) exit 0. Layers: typecheck + lint + unit + component + smoke e2e. **No network e2e** (user-dropped — see the coverage-tradeoff note in Assumptions).

## Security & Adversarial Considerations
- **Threat model:** the backup blob is UNTRUSTED input (a file the user picked; could be attacker-crafted or tampered). Trust boundary = the import parse. Attacks: (1) tampered blob with a valid-looking but wrong checksum → mitigated by verify-before-migrate; (2) a blob whose slices, once migrated, write outside a migration's declared footprint → the apply-core enforces the same commit-time footprint guard as the live engine (an undeclared write fails the migration); (3) downgrade/replay — an old blob re-imported is fine (it just migrates forward); a blob claiming a FUTURE `backup-schema-version` → fail-closed (out-of-range, like the live corrupt-marker path); (4) master-key exposure — the key stays in the decrypted-in-memory blob exactly as today; migration must NOT log/serialize slices containing it, and the `master-key` field is NOT a migratable slice (it's blob-level, untouched).
- **Least privilege:** the backup path is pure in-memory; no new storage writes until `service.restore` (unchanged). No new network, no new permissions.
- **Crypto:** reuse `EncryptionKey` (existing, battle-tested in-repo) for checksum; no new crypto. Verify→migrate→(no-trust-recompute) ordering per above.
- **Input validation:** every slice is untrusted; the normalizer + migrations fail-closed on malformed rows (the `MigrationArea.rows` throw-on-malformed contract). Unknown slice = refuse.
- **Supply chain:** no new deps.

## Assumptions
**Facts (verified):**
- `backup()` = verbatim profile-filtered row values (`account/service.ts:58`).
- `restore()` re-keys by a value field (`account/service.ts` `storage.set(account.address, ...)`).
- Blob shape + checksum-last (`export/full.vue:128-143`); `!== 2` reject (`useFullBackupImport.ts:216`).
- Engine seam + journal (`migration/types.ts`, `migrator.ts`); 41 tests + 4 e2e green post-#246.

**Inferences (attack these):**
- *Slices are profile-scoped subsets, so a migration that reasons across ALL rows/profiles behaves differently on a backup than on live storage.* Most migrations are per-row field transforms (identical either way), but a cross-row invariant migration is a latent divergence. Inference: all realistically-anticipated migrations are per-row; if a cross-row one is ever needed, it needs a backup-specific variant. NEEDS the audit's eyes.
- *The `keyOf` per service is stable and matches `restore()` keying.* Verified for account; INFERRED for the other ~10 services — Phase 2's parity test must confirm each, or the registry mis-keys rows.
- *Extracting the apply-core from `migrator.ts` won't disturb the audited journal.* Inference — Phase 1's re-run of the full #246 gate is the proof; if it can't be made clean, fall back to C.
- *Dropping network-e2e still covers migration correctness.* Inference: unit parity (normalize round-trip, registry↔root) + smoke (end-to-end import of a vN blob) prove the TRANSFORM; the on-chain "does the restored wallet work" is already covered by the EXISTING restore-flow tests (migration is additive upstream of unchanged restore). The gap: we don't prove a migrated-then-restored wallet transacts on-chain. Accepted by the user; the audit should judge whether it's a real hole.

**Asks (resolved this session):** tier=deep; full-build-now; redefine-baseline-freely; layers=typecheck/lint+unit+component+smoke; no /harden. No open asks.

## Decision ledger (seed — filled at consolidation)
- Architecture: main=D (extract shared core, fallback C); codex=?; fable=? → consolidated pick + rejected + disputed.
