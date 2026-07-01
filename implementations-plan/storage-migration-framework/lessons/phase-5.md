# Phase 5 — Docs + network e2e

## Work
- **ARCHITECTURE.md §5** rewritten: "Storage versioning + destructive migration" → "Storage versioning + data-preserving migration" — the engine's journal sequence, the registry + `template.ts` how-to, migrate-before-`config.load()`, the failure UX (`blocked`/`degraded`), the UI barrier + static facade ban, the explicit NOT-covered list (crypto pre-unlock, PXE, session, backups-queued-follow-up), and the e2e fixture proof. Fixed the stale "runs on first unlock" claim (it runs at SW boot, first storage action).
- **ARCHITECTURE.md §4**: journal tier corrected (session → **local**, with the 2026-06-05 durability rationale — the doc drift codex caught); PXE bullet no longer references the deleted wipe migration.
- **`packages/wallet-core/README.md`**: `src/migration/` added to the file map.
- **`implementations-plan/M4/DECISIONS.md`**: M4.7 marked **SUPERSEDED** by this plan, with an honest note on how the re-opened design resolved its 3 blockers differently (single global version vs per-collection; boot-single-flight + facade vs shared lock registry; wipe deleted outright).
- `wallets-architecture-research/` deliberately untouched (frozen archive, like implementations-plan history).
- (`apps/extension/README.md` + `packages/wallet-crypto/README.md` were already rewritten in Phase 2, co-located with the `migrate.ts` deletion, per the audit's sequencing condition.)

## Gate
- `typecheck:all` ✓ 12/12 packages.
- biome errors-only across the whole real source tree ✓ clean.
- Full extension unit suite + prod build + final DCE grep: (appended below).
- Network e2e (`bun run e2e:agent`): (appended below).
