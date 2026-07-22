# Phase 3 — preserve the active network across backup import (item 1b)

**Done (security-sensitive; codex conditional-approve conditions all met).**

**Export:** `full.vue` adds a TOP-LEVEL `active-network-id` = `appStore.network?.id` (raw id, like
`master-key` — not a slice). Absent when there's no active network (JSON.stringify drops undefined),
so older backups and no-active states degrade to the primary fallback.

**Restore:** new pure helper `resolveRestoredActiveNetworkId(exportedId, newNetworks, oldNetworks)`
builds a COMPLETE source→successful-result pairing BY RESULT INDEX — including IDENTITY mappings for
unchanged ids (the row-remap `oldToNew` deliberately SKIPS `old.id === new.id`, so it can't be
reused; codex condition #1). Resolves to the new id only for a unique, successful, non-duplicated
pairing; absent / non-string / failed / duplicate / foreign → undefined → skip (bootstrap primary
fallback applies). NEVER `oldToNew.get(raw) ?? raw` (no global fallthrough). `useFullBackupImport`
writes the resolved id via `NetworkService.setActiveForProfile(newProfile.id, id)` BEFORE
`finalizeRestore` (line 453 vs 655 — the profile isn't active yet, so the setter is
profileId-parameterized and `requireOwnedRow`-guarded).

**Why raw id, not chainId:** chainId mis-picks when two hostile same-chain rows exist and the
selected one fails restore but the other succeeds (codex). Also fixed the stray `chainId: string`
annotation → `number` (condition #4).

**Security:** `active-network-id` is attacker-controlled — resolved only within this restore's own
successful pairings; `setActiveForProfile` re-checks `requireOwnedRow` (rejects a foreign/non-restored
id); the import swallows a rejection (never fails the whole import over the pointer).

**Tests (all id cases — condition):** `full-backup-helpers.test.ts` resolver ×6 (changed / unchanged
/ failed-selected / duplicate / absent+non-string / foreign); `service.test.ts` setActiveForProfile
(owned write + `getActiveNetwork` reflects it; foreign/unowned → throws); `useFullBackupImport.test.ts`
(active restored to new id + called BEFORE finalizeRestore via `invocationCallOrder`; legacy no-field
→ setActiveForProfile NOT called). 130/130 across the three files.

**Gate:** those unit/component tests · typecheck:all + lint 0 · build:chrome 0. The export→import→
same-network smoke round-trip folds into the consolidated e2e pass before the post-impl audit.
