# Phase 1 — stage-aware wait + driver split

## Implementation notes

- The recorder went in exactly per the final plan: MutationObserver armed
  pre-submit (baseline-seeded — the attempt fence), ONE post-settle read on
  the page clock, `withTimeoutMessage` for lapse diagnostics, labels never
  exits (row-3 ruling), 300_000 hardcoded.
- `withTimeoutMessage` throws `new Error(text, { cause: original })` — the
  outcome classifier checks `err.cause instanceof TimeoutError` as well as
  the direct instance (fixtures/extension.ts:1032).
- Attribution uses vitest's `expect.getState()` (testPath basename +
  currentTestName); ordinal is a module counter (one fork per file, so
  per-file ordinals are stable); `retryEnv` records the NULO_E2E_RETRY
  setting instead of a per-attempt number (campaign contract pins retry=0 ⇒
  attempt-1 by construction).
- crash-truth's `driveImportToSubmit` is now a 1-line delegate to the shared
  `submitFullBackupImport`; its `reimportToTerminal` predicate untouched by
  design (different terminal set).

## Attempts / hiccups

1. First `bun run lint` showed "2 errors" repo-wide — both were MY two new
   files' formatting (biome line-width splits). `--write` fixed; scoped
   re-check clean; root `bun run lint` exit 0 after. Detour worth recording:
   `--diagnostic-level=error` is the fast way to separate real errors from
   the repo's pre-existing warning noise (35 warnings live in untouched
   files; only errors gate).
2. `bun run typecheck` (vue-tsc) exit 0 first try.

## Gate (in progress at write time)

- lint exit 0 ✓, typecheck exit 0 ✓, pure-node unit pins written (run as
  part of the smoke suite's glob).
- `bun run build:chrome && bun run test:e2e` running in tmux session
  `isd-smoke`, log `.smoke-run.log` (worktree root, gitignored-by-run).

## Gate result

**GREEN (attempt 2, armed build)**: 27 files / 111 tests passed, 6 skipped,
EXIT:0 — `import-stage-timing.test.ts` 16/16, backup-migration incl. the
expectError path through the new driver, import-paths through the composed
`importFullBackup`. Fast layers: lint exit 0, typecheck exit 0.

3. **Smoke attempt 1: 104 passed / 1 failed — the failure was MY invocation,
   not the change.** `backup-migration.test.ts`'s fixture-arming contract
   fails closed on an UNARMED repo build (exactly its job): a plain
   `bun run build:chrome` lacks `VITE_NULO_E2E_MIGRATION_FIXTURE=1`. The
   armed-build discipline applies to SMOKE too, not just the network runner
   — CI's `_smoke-e2e.yml` arms `VITE_NULO_E2E_MIGRATION_FIXTURE` +
   `VITE_NULO_E2E_DEFAULT_NET=testnet` at build and
   `NULO_E2E_MIGRATION_FIXTURE=1` at run (lines 41/71/75/83). Attempt 2
   mirrors that env set (tmux `isd-smoke2`, `.smoke-run2.log`). My new unit
   pins + all import-driver consumers that DID run were green on attempt 1.
