# Phase 4 — one-pass network remap + split helper (E) — lessons

**Status: ✓ (`2dca5f6`).** Gate: `vitest run full-backup-helpers.test.ts useFullBackupImport.test.ts network` 116 pass; typecheck 0; lint 0.

## What was built
- **`full-backup-helpers.ts`:** replaced `remapIdInBackupData(data, key, newId, oldId?)` with two named functions — `normalizeAllIds(data, key, newId)` (all-rows, for profileId) + `remapByMap(data, key, oldToNew: Map)` (single pass, each row's ORIGINAL value looked up once). Kills the `(newId, oldId)` optional-arg footgun.
- **Composable:** profileId → `normalizeAllIds`; networkId → build the complete index-paired `oldToNew` map first (skip duplicated source ids), then ONE `remapByMap`. No more per-id loop → no cascade-aliasing (E).
- **`NetworkService.restore`:** on a collision re-roll, the fresh id must avoid every SOURCE id in the batch too (`(id !== candidate.id && sourceIds.has(id))`) — a network keeps its own id when uncontested, but a generated id can't equal a later source id.

## Key decisions / gotchas
- **Whitespace matched via `cat -A`:** the composable's method body is 3-tab-indented (not 4) — earlier multi-line edits failed on a wrong tab count. `grep -nP … | cat -A` reveals `^I` tabs; substring edits (no leading whitespace) are the robust fallback.
- **Duplicate source id → skip (not drop-rows):** an un-remapped networkId row keeps its old id → account-state finds no matching created network and ignores it (safe). Backup normalization already rejects duplicate root ids upstream, so this is a defensive backstop.
- **Stale `auto-imports.d.ts`** still lists `remapIdInBackupData` but typecheck stays 0 (harmless unused global type decl; regenerated on build). The composable imports the new fns explicitly, not via auto-import.
- **Cascade pin at the helper level:** `remapByMap(Map(N1→R, R→S))` on `[{N1},{R}]` → `[{R},{S}]`; a sequential remap would alias to `[{S},{S}]`. This is the tightest expression of finding E.
- **Deferred to Phase 9:** the 3+ network index matrix + a composable duplicate-source-id pin + legit unchanged-profile no-op (coverage completion).
