# Briefing — backup-import migration (deep blueprint)

You are drafting an implementation plan. Another two planners are drafting independently in parallel; a consolidation + double adversarial audit follows. Draft the STRONGEST plan you can, then attack your own assumptions.

## The task
The extension just shipped a data-preserving numbered-migration engine (PR #246, `@nulo/wallet-core/migration`) that transforms LIVE `chrome.storage.local` on release. This plan extends that capability to **imported full-backup files**: when a user imports a backup that was exported from an OLDER schema, migrate its contents forward to the current schema before restoring, instead of rejecting it.

## Decisions already made (user, this session — do NOT relitigate)
- **Tier: deep.** Full build now, gate-ready (same rigor as #246 — implement + test + land, dormant until the first real format bump).
- **Redefine the backup baseline freely (pre-production).** There are no production users; testers re-export. Treat the CURRENT export format as the backup-v1 baseline; NO back-compat for any pre-baseline blob. (Mirrors the live-migrator "current structure IS v1" rule now in CLAUDE.md § Persisted-storage shape changes.)
- **Validation layers that gate phases: typecheck/lint + unit + Vitest component + smoke e2e.** Network-e2e round-trip was DROPPED by the user as too expensive — record this as an accepted coverage tradeoff and reason about whether the smoke+parity layer genuinely covers migration correctness without it (the audits will pressure-test this).
- **No separate /harden** — the deep tier's codex+fable adversarial + assumption-attack audits plus the post-impl codex audit are deemed sufficient.

## Ground truth (verified, file:line)
### The live engine seam (reuse target)
- `packages/wallet-core/src/migration/types.ts`: `MigrationContext = { local: MigrationArea }`. `MigrationArea` = `{ rows<T>(root), setRows<T>(root, upserts, deletes?), value<T>(key), setValue<T>(key,v), deleteValue(key) }`. Type params are ASSERTIONS not validation; a malformed row THROWS (fail-closed).
- `StorageRef = {kind:"root";root} | {kind:"value";key}`. A migration declares `reads`+`writes` footprint; the engine snapshots exactly that.
- `Migration = { version, description, breaking, reads, writes, up(ctx) }`; forward-only, idempotent, applied when `version > persisted`.
- The engine (`migrator.ts`) runs migrations against an injected `MinimalStorageArea` (get/set/remove) — live chrome.storage in the extension, in-memory fake in tests. A backup-blob adapter is the intended "third consumer" via this same seam.
- Migrations are keyed to LIVE storage roots: e.g. account migration reads/writes root `nulo:core:accounts`.

### The backup blob (what we must migrate)
- Assembled in `apps/extension/src/popup/pages/settings/security/export/full.vue:128-143`:
  ```
  { "wallet-version", "aztec-version", "schema-version": 2, "master-key": <key>,
    data: { <serviceName>: <slice>, ... }, checksum: <hash over the whole blob minus checksum> }
  ```
  `data[serviceName]` is that service's `.backup()` output; `serviceName = s.name.replace("-client","")` (e.g. `account`, `network`, `token`, `token-balance`, `config`, `contact`, `fpc`, `auth-registry`, `account-state`, `transaction`, `profile`). `checksum = EncryptionKey.getHashHex(JSON.stringify(backup))` computed LAST, over the blob with `data` populated.
- `schema-version: 2` is HARDCODED in export. The number "2" is a legacy pre-release account-contract epoch, NOT the live storage schema version (which is a separate `nulo:schema:version` = currently baseline 1). Do not conflate them.

### The import flow (what consumes the blob)
- `apps/extension/src/composables/useFullBackupImport.ts`:
  - L207: strips `checksum`, recomputes `EncryptionKey.getHashHex` over the rest, compares (L227) — integrity gate.
  - L216: `if (backup["schema-version"] !== 2) reject("...custom account contracts...cannot be imported...")` — the COMPAT GATE. Currently conflates "incompatible" with "any non-2 version".
  - Restore is SERVICE-METHOD-DRIVEN, not row-writes: `profileService.restore(profile, masterKey, ...)` → `networkService.restore(data.network)` → `accountService.restore(data.account)` → `tokenService.restore(data.token)` → a loop of `{transaction, token-balance, account-state, auth-registry, fpc, contact, config}` each `client.restore(data[name])`. account-state additionally takes `createdNetworks`.
  - **ID REMAPPING**: restore generates NEW ids; cross-slice references are remapped in-blob via `remapIdInBackupData(data, "profileId"|"networkId", newId)` and token `id↔contract` maps (L365-378). So slices are interdependent, and restore order matters.

### The serviceName ↔ storage-root mapping (the hard part)
- NOT derivable by string transform. Each service hardcodes its root in its constructor: `account/service.ts:41` = `new EntityStorage<Account>("nulo:core:accounts", ...)`. So `account`(slice) ↔ `nulo:core:accounts`(root) must be an EXPLICIT registry.
- MIXED representation: some services are EntityStorage (row) services; `config` is a ValueStorage (single-key) service. The mapping must cover both `{kind:"root"}` and `{kind:"value"}` targets.

## The central architectural fork (resolve it — this is why it's deep)
The live migrations transform storage ROWS. A backup is a set of SERVICE-ARRAY slices consumed by `service.restore()` which expects the CURRENT shape. Where does the vN→current transform happen for a backup? At least three candidate designs — evaluate all, pick one, justify, and record the rejected ones:

- **A. Adapter-over-MigrationArea.** A backup adapter presents `data[serviceName]` slices through the `MigrationArea` interface (slice-array ↔ rows mapping via the explicit registry), runs the SAME numbered migrations on it, THEN hands migrated slices to the existing `service.restore()`. Reuses migrations verbatim; needs the bidirectional slice↔row + id-key mapping + missing-root/missing-slice semantics + parity tests vs the live adapter.
- **B. Version the restore path.** Each `service.restore(slice, fromVersion)` learns to read old slice shapes. No engine reuse; migration logic scatters into every service; diverges from the single-source numbered engine (the exact anti-pattern #246 replaced). Likely a trap — but state why.
- **C. Normalize → reuse live engine wholesale.** Write the slices as rows into a scratch/in-memory `MinimalStorageArea`, run the live `Migrator` on that store unchanged, read rows back, re-slice, restore. Maximum engine reuse; needs a bidirectional slice↔row transform + a scratch store + a re-slice step.
- (Consider hybrids / a fourth option if you see one.)

## Additional required design points
1. **Compat-epoch vs migratable-version split.** Today `schema-version !== 2` conflates "genuinely incompatible" (custom pre-release account contracts — un-importable) with "old-but-migratable". Add a SEPARATE non-migratable `compat-epoch` field (account-contract generation) AND a migratable `backup-schema-version`. Rewire the L216 reject into: reject iff compat-epoch is incompatible; else migrate `vN→current`. Define what the NEW baseline export stamps for both fields.
2. **Checksum trust ordering (security-critical).** The checksum proves integrity of the ORIGINAL bytes. Migrating invalidates it. Correct order: verify checksum on original → migrate → the migrated blob's integrity is NOT re-provable from a recomputed checksum (it's derived, not user-signed). Decide: recompute+restamp for downstream consumers, or drop it and rely on the pre-migration verification as the sole integrity gate. A migrate-then-trust-recomputed-checksum inversion is a vulnerability — call it out.
3. **Missing-slice / partial-blob semantics.** A vN backup may lack a slice a migration reads, or have extra slices. Define fail-closed behavior.
4. **Idempotency + failure atomicity.** Import is already all-or-nothing-ish (orphan-profile cleanup on failure). A mid-migration failure must not half-restore. Reconcile with the existing restore rollback.

## Required plan.md structure (deep tier)
- Phases, each ending in a **Validation gate** (exact commands from real tooling + pass criteria + layers). Real commands: `bun run typecheck`, `bun run lint`, `bun run --cwd packages/wallet-core test <path>`, `bun run --cwd apps/extension test <path>` (vitest), `bun run test:e2e <name>` (smoke). NO network-e2e gate (user dropped it).
- **Security & Adversarial Considerations** section (threat model: tampered/malicious backup blob, checksum bypass, master-key handling, migration writing outside declared footprint, downgrade/replay of an old blob; least-privilege; input validation at the blob trust boundary).
- **Assumptions** section: Facts (file:line) / Inferences (labelled, attackable) / Asks (surface, don't silently assume).
- A concrete phase breakdown (suggest 4-6 phases) with the mapping registry, the adapter, the compat-epoch format change, the import-flow rewire, and the test layers each as identifiable work.

Draft the plan now. Be concrete about file paths and the chosen architecture. Attack your own assumptions before finishing.
