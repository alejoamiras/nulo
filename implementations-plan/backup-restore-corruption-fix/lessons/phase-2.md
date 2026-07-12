# Phase 2 — P2 index-pairing + P3 composite key — lessons

**Status: ✓ complete.** Gate: `full-backup-helpers.test.ts` + `useFullBackupImport.test.ts` — 55 pass; typecheck 0; lint 0.

## What was built
- `full-backup-helpers.ts`: `remapIdInBackupData(data, idKey, newId, oldId?)` — `oldId` scopes the rewrite to rows whose `idKey === oldId`; omitted = all-rows (for `profileId`, single-valued per backup, which also normalizes a hostile foreign `profileId`).
- `useFullBackupImport.ts` P2: replaced the network field-match (`name+rpcUrl+chainId`) with **index-pairing** — `for i: old = data.network[i], restored = newNetworks[i]`; remap only when `!restored.restoreError && old.id !== restored.id`, scoped by `old.id`. `NetworkService.restore` returns one result per input in order, so index-pairing is unforgeable.
- `useFullBackupImport.ts` P3: token-balance old→new map keyed by `${chainId}:${contract}` (sourced from the OLD token via the balance's `token` id, since balance rows carry no chainId); duplicate `(chainId,contract)` → `ambiguousKeys` → skip-and-record into `restoreErrorLog["token-balance"]`; widened the `newTokens`/`oldTokens` casts to include `chainId`.
- Tests: helper scoped-vs-all-rows + no-cross-graft + hostile-profileId-normalize; composable index-pairing (2-network no-collapse; the ambiguous failed-A/valid-B-same-`name+chainId` proving index beats field-match); P3 same-contract-cross-chain distinct + duplicate-key skip-and-record.

## Key points
- **The index-pairing is in the COMPOSITE (the composable), not the helper.** The helper only does the scoped/all-rows rewrite; the composable establishes the old→new PAIR by index and calls the scoped helper per network. Cleaner separation + testable independently.
- The ambiguous-network test is the load-bearing one: with a field-match, a valid net B sharing `name+chainId` with a FAILED net A pairs to A (whose raw fields spread back) → grafts B onto A. Index-pairing pairs B to B by position — asserted.
- P3 balance rows reference the OLD token id (`tb.token`), so the composite key is `oldIdToKey.get(tb.token)`; the new-token map is `(chainId,contract) → newId`. The `token`-id field on the balance is what gets rewritten to the new id.
- `TOKEN_BALANCE_SERVICE_NAME` was already imported (used in the restore loop); no new imports beyond that.
