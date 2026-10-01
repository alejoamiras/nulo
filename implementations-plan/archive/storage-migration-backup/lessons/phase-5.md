# Phase 5 — smoke e2e + docs — lessons

**Status: ✓ complete.** Gate: `bun run test:e2e backup-migration` green with the fixture ARMED — 3 passed, 0 skipped (the arming-contract test FAILS rather than skips on an unarmed repo build; only a release-artifact run with `EXTENSION_PATH` may skip). Regression `bun run test:e2e migration import-paths security-backup` green (4+8+4). `bun run audit:vue` exit 0. `bun run lint:actions` exit 0 (workflow edit).

## What was built
- `tests/e2e/backup-migration.test.ts`: (1) the M5-codex arming contract; (2) v1 backup with a pre-shape contact (`legacyName`) → real import UI → storage holds the CURRENT shape (`name`, no `legacyName`) + active account restored; (3) pre-baseline legacy blob rejects with the "Incompatible backup" copy through the real UI.
- Driver upgrades (`import-drivers.ts`): `buildSyntheticBackup` gained `extraData` (slice injection) + `bodyOverrides` (metadata overrides; `undefined` drops a key via JSON.stringify — builds pre-baseline blobs), and a default `contact: []` slice; `importFullBackup`'s `expectError` accepts an expected banner string.
- `_build-extension.yml`: `nulo:e2e:backup-mig-fixture` added to the prod-bundle negative-grep markers.
- Docs: ARCHITECTURE §5 (backup-import paragraph + e2e-proof update), CLAUDE.md migrations section (backup-safe-first procedure, new guardrails, live pointer), NEW `src/wallet/services/backup/README.md` (file map + invariants + how-to-add).

## Gotchas
- **The stamped fixture reads `nulo:core:contacts`, so every synthetic backup MUST carry a `contact` slice (present-but-empty is fine)** — a missing non-optional slice a pending migration reads rejects the import. This broke `import-paths` full-backup tests until the builder default was added (and the passkey builder separately — it has its own inline body).
- **Pre-existing, machine-dependent failure (NOT ours):** `passkey-backup.test.ts` "passkey full-backup export: modal appears + status card + CTAs become available" fails on this homelab AT THE BRANCH BASE (verified in a throwaway worktree at `b2bcb4f`): the 11-service export chain completes faster than the transient "Creating your backup" status card can be observed at 100 ms polling (the test is already CI-skipped for the opposite timing reason — hosted runners too slow). Out of scope here; flagged for a separate fix (e.g. a hold hook or a completion signal instead of sampling a transient).
- The smoke suite is parallel-safe as-is: `global-setup-smoke.ts` scopes its orphan-Chrome cleanup by THIS build's `--load-extension` path.
