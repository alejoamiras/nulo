# M4.10 — audit-diff (post-dual-audit)

Date: 2026-04-26

## ⚠ Plan needs material reshape before execution

Codex flagged 3 BLOCKING design errors centered on the M4.7 dependency.

## Codex BLOCKERS

1. **Migrator can't fit M4.7's single-root contract (codex BLOCKING)**: `CollectionMigrator` is `(area: MinimalStorageArea, root: string)` — single-root, MUST NOT touch other roots. M4.10's PXE migrator enumerates IndexedDB AND reads `nulo:core:networks` from another root. **Fix**: either extend M4.7 with a separate boot-migration type (cross-root + IndexedDB capable) + explicit `after: ["nulo:core:networks"]`, OR keep PXE rename OUTSIDE the per-root runner and invoke it only after networks root has migrated. (See M4.7 audit-diff for the reshape that supports this.)
2. **Orphan cleanup deletes recoverable DBs + misses inactive-profile networks (codex BLOCKING)**: sample preserves only hashed names (line 104-118), but plan also says old-shape DB matching current network must be preserved for migrator (line 184-185). Contradictory. Also: `NetworkService.getNetworks()` returns ONLY active profile's networks (`network/service.ts:100-109`), not all profiles. **Fix**: preserve BOTH `pxe/{profile}/{chain}` and `pxe/{profile}/{chain}/{hash}` for any known network until migration succeeds. Add an all-profiles network reader; wire through offscreen (`offscreen/entry.ts:20-33`, `offscreen/index.ts:41-45`).
3. **`renameIndexedDb` not specified tightly enough for own idempotence requirement (codex BLOCKING)**: text says "copy then delete" + "re-attempts" but never defines behavior for `newName` already existing, both DBs existing, or crash-after-old-delete-before-sidecar-bump. **Fix**: codify re-entry rules: `old missing + new present => already migrated`, `both present => verify-and-delete-old OR delete-and-recreate-target-from-old`. Only bump version sidecar after every DB reaches settled state.

## Plan agent BLOCKERS

- **ChainRuntime ctor change**: plan adds `rpcUrlHash` + `dataDir` as positional args. Plan claims "ChainRuntime interface unchanged" (line 31) but contradicts at line 83-95. Existing test `pxe/chain-runtime.test.ts:30-31` may construct directly. **Fix**: keep backward compat (optional trailing params or static factory) OR drop `rpcUrlHash`/`dataDir` from the class — cleanup flow doesn't require storing them on the runtime object.
- **Cross-root ordering**: M4.10 migrator must declare `fromVersion` after networks-collection migrators, not "decide later."

## Codex SHOULD-FIX

- Test/verification mismatch: plan says all tests live in `packages/aztec-runtime/src/pxe/` but `@nulo/aztec-runtime` has no `test` script (`package.json:15-17`). Existing chain-runtime suite is under `extension/` (`packages/extension/src/wallet/services/pxe/chain-runtime.test.ts:1`). **Fix**: either add aztec-runtime test harness explicitly OR point plan at extension Vitest surface.

## Plan agent SHOULD-FIX

- Orphan cleanup needs `INetworksReader` port (mirrors `IProfileReader` pattern).
- `renameIndexedDb` partial-failure: check target before copy; if exists, skip copy, just delete old.
- Test coverage gap: M4.7-runner-with-M4.10-registered integration test.
- Hash length: pin **16 chars** (not "audit may push to 64"). 8-byte truncation is safer than birthday-paradox-relevant for non-adversarial inputs. Don't bloat IndexedDB names.

## Recommended execution-time absorption

1. **Resolve M4.7 dependency** first. M4.10 cannot ship until M4.7-a's revised migrator interface supports cross-root + IndexedDB + ordering.
2. **`renameIndexedDb` re-entry rules** documented in helper JSDoc + test coverage.
3. **All-profiles network reader** added (across the offscreen seam).
4. **`ChainRuntime` ctor**: drop `rpcUrlHash`/`dataDir` from class (cleanup flow doesn't need them stored).
5. **Hash length**: 16 chars; close the open question.
6. **Test placement**: plan against extension Vitest surface OR add aztec-runtime test harness.

## Status

- Plan v0 SHIPPED. Audits absorbed in this audit-diff.
- Plan v1 — major reshape after M4.7 v1 (which M4.10 transitively depends on). Recommend M4.10's planning-revision pass after M4.7-a's interface settles.
