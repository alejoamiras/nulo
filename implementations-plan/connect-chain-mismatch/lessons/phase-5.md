# Phase 5 — docs + wrap

Status: ✓ (2026-09-05)

## What landed
- `ARCHITECTURE.md` § 8: one paragraph on chain-scoped sessions, on-demand provisioning and its limits.
- The e2e README enumerates no specs — nothing to add there.
- `useProfileBootstrap.test.ts`: its `@/wallet/services/account/client` module mock gained
  `DEFAULT_ACCOUNT_NAME` (a module mock must expose what the module under test imports).

## Gate
- `bun run audit:vue` → typecheck:all ∥ test ∥ lint all green, then build: 435 files, 5428 tests passed
  (2 skipped, 7 todo); build 4.1 s. Exit 0.

## Notes
- The first `audit:vue` run failed only on the bootstrap suite's incomplete module mock — the one
  place `DEFAULT_ACCOUNT_NAME` is consumed through a mocked module. Every other `account/client` mock
  stays untouched (their modules under test do not import the constant).
