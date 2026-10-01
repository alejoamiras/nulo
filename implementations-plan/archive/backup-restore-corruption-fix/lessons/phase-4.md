# Phase 4 — network-e2e integrity + a UX refinement — lessons

**Status: ✓ complete.** Gate: `bun run e2e:agent tests/e2e/network/backup-restore-integrity.test.ts` GREEN on a quiet-enough machine (2 passed / 0 skipped; another agent's sandbox ran concurrently — zero clash, `e2e:agent` owns its port pack); `bun run audit:vue` exit 0; smoke regression (migration, import-paths, security-backup, backup-migration) 19 pass.

## What was built
- `apps/extension/tests/e2e/network/backup-restore-integrity.test.ts`: funded wallet exports a real backup → doctor it to carry a valid tx (funded account) + a FOREIGN-account tx → import into a fresh extension → assert via raw `chrome.storage` that the funded tx is present + the foreign one ABSENT (P1 provenance), and the wallet is on-chain functional (real 1,000-token balance syncs). Fails-not-skips (`skipIf(!hasConfig)` + an arming-contract test).

## The e2e caught a real design issue (its whole point)
Run 1 FAILED at `importFullBackup → waitForHash(successHash)` timeout. Root cause: the provenance filter recorded the dropped foreign tx into `restoreErrorLog`, which makes `isRestoreHasErrors` true → the composable takes the "finished WITH errors" path (sets `importedProfile`, shows the error log) instead of calling `completeImport` (which navigates to `/popup/general`). So the import never navigated → timeout.
**Fix:** a provenance-dropped tx is a security FILTER action (its account is foreign/corrupt — nothing the user did or can fix), so it must NOT flip a clean import into error-mode. Changed to `console.warn` the dropped count (recorded/auditable — satisfies codex's "not silent" condition — matching how `EntityStorage` silently drops malformed rows). A failed-account tx is already surfaced by its own account `restoreError`. Updated the 3 P1 composable tests to assert the console.warn + `isRestoreHasErrors === false`. This is a genuine product-correctness improvement the e2e surfaced that the unit tests (asserting on `restoreErrorLog`) had baked in as "correct."

## Coverage split (honest, documented in the plan)
- **P1 provenance filter:** proven END-TO-END here (real chrome.storage + real restore).
- **P1 cross-profile WIPE:** proven through the REAL service graph in `cross-profile-isolation.test.ts` (real Account+Transaction+onAccountDeleted; only chrome.storage faked). Driving multi-profile deletion via the network UI is flaky, so not re-done at e2e.
- **P2 index-pairing / P3 composite key:** unit-proven. A live network-id collision (P2) and multi-node multi-chain restore (P3) aren't cheaply forgeable in a single-sandbox e2e.

## Gotchas
- `warn.mockRestore()` BEFORE the `expect(warn)` assertion wipes the recorded calls — assert first, restore after. (Cost me one debug cycle.)
- The doctored tx fixtures must be TxSchema-valid (numeric `feePaymentMethod`, object `origin`, `calls: [{contract,method,args}]`, non-Pending `status`) or the #220 read-codec drops them invisible.
- The trailing "close timed out … Vite server" note is cosmetic; the e2e exit was 0.
