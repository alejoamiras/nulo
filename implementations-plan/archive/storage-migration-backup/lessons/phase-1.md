# Phase 1 — Registry + slice↔storage transforms — lessons

**Status: ✓ complete.** Gate: `bun run --cwd apps/extension test src/wallet/services/backup/backup-migration-registry.test.ts` (19 pass) + `bun run typecheck` (exit 0) + `bun run lint` (exit 0). Regression: engine `migrator.test.ts` 41 pass, `migrations/registry.test.ts` 5 pass.

## What was built
- `apps/extension/src/wallet/services/backup/backup-migration-registry.ts` — the pinned `serviceName → SliceDescriptor` map, `normalizeBackupData`/`denormalizeBackupData`, config `toStored`/`fromStored` (absence-preserving), `CURRENT_COMPAT_EPOCH`/`BACKUP_SCHEMA_BASELINE`/`isSupportedCompatEpoch`, `BACKUP_BLOCKED_ROOTS`.
- Storage-root constants extracted into each service's own `spec.ts` (`ACCOUNT_STORAGE_ROOT`, …, `AUTH_REGISTRY_ENABLED_STORAGE_ROOT`; `CONFIG_STORAGE_KEY` in `wallet/config/store.ts`) and the service constructors now consume them — the registry imports the constants instead of re-literalling, so a root rename fails at one definition site. `profile` reuses the pre-existing `PROFILE_STORAGE_ROOT` (`profile/repository.ts`).
- `migrations/index.ts` split: `realMigrations` (backup-facing, empty at baseline) vs `migrations` (live boot = real + stamped e2e fixture) — the 9001 sentinel is unreachable from a `backup-schema-version`.
- `wallet-core/migration` now exports `SCHEMA_RESERVED_PREFIX` (constant promotion only — engine logic untouched) so denormalize filters the engine's journal keys without a re-literal.

## Verified-against-code facts (I-A / I-B resolved)
- **I-A confirmed:** token-balance rows are keyed `String(balance.id)` (`balance-repository.ts` `set()` uses `` `${balance.id}` ``); numeric-id services (token, token-balance, auth-registry) all store under the decimal string.
- **I-B confirmed:** account/network/token/token-balance/contact/transaction/auth-registry slice elements are byte-identical to stored row values. fpc's `backup()` strips `isProtocol` but the STORED row never had it (`StoredFpc = Omit<FpcInfo,"isProtocol">`) → plain `root`, as the plan corrected.
- transaction keyed by `hash` (`txs.set(tx.hash, tx)`), aggregated → `optional`; auth-registry restore RENUMBERS authwit ids (`array_max+1`) — restore-side, irrelevant to the pre-restore migration.

## Decisions worth recording
- **auth-registry descriptor implemented as `root` (identity), not `projection`.** The plan's table says "projection", but per-row the authwit slice IS the stored row — an identity `toStored`/`fromStored` would be dead code pretending to matter. The service-level lossiness the audit cared about (the backup-absent `nulo:core:auth-registry-enabled` root, default-true-when-absent) is captured where it bites: `BACKUP_BLOCKED_ROOTS` + a spec-side doc comment. Flag for the post-impl codex audit.
- **`profile` got its own `block-listed` descriptor kind** (5th union member beyond the plan's 4): `data.profile` is present in every backup, so the "unknown slice → reject" rule needs profile registry-known; kind `block-listed` carries the root for the Phase-2 guardrail.
- **Denormalize re-derives each row's id from its value and rejects on mismatch** — the seam-level catch for a migration that mutates an anchor field (I-C), independent of the Phase-2 DSL guarantees.
- **Anchor fields are compile-time pinned** (`AssertAnchor<Account,"address">` etc.) so a spec rename fails typecheck, plus runtime-pinned by the parity test.

## Gotchas hit
- `noTemplateCurlyInString` (biome, error severity) fires on `${...}` inside a plain test-name string — reworded, don't embed template syntax in test names.
- Always run `bunx biome check --write` on new files before the lint gate; the repo formatter differs from hand-wrapping (it split a long `test.each` array literal).
- This worktree had no `node_modules` — `bun install --frozen-lockfile` first.
