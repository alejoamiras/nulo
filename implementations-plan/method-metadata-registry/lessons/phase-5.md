# Phase 5 — Docs + cleanup

## Outcome — ✓ (2026-06-15, commit `1ffd5f5`)
- `packages/wallet-bridge/README.md` reconciled:
  - File map: added `method-descriptors.ts` (single source of truth) + `method-scope-checkers.ts` (leaf); `capability-map`/`scope-enforcement` reframed as facades.
  - Principles: added the dispatch-entry guard + "method metadata lives in ONE place" (edit the registry row; exhaustiveness test + runtime guard catch a forgotten one; a new kind still touches the build switches; a new handler method still needs a dispatch branch).
  - Custom-RPC table reconciled to all THREE customs (`registerToken`/`isTokenRegistered`/`grantPublicAuthwit`) — previously listed only `registerToken` (opus/codex flagged).
  - Schema-patch contract: note all three patched methods.
- **Phase 5 gate `bun run audit:vue` → EXIT=0** (typecheck:all → test 2392 → lint → build "built in 2.23s").

## Notes
- audit:vue surfaced info-level FIXABLE lint findings (`useArrowFunction`, `noUnusedVariables`) in pre-existing test files NOT touched by this work (`useFullBackupImport.test.ts`, `useProfileBootstrap.test.ts`, `RecentActivityView.test.ts`, `lock.test.ts`). Non-blocking (gate passed) and out of scope per "no scope beyond plan.md" — left untouched.

## All phases 0-5 ✓ — next: post-impl sequence
- `/code-review max --fix` on the implementation diff → commit separately.
- codex post-impl audit (`/codex xhigh`, adversarial on the authz boundary + the exhaustiveness guard) → address high/critical.
- PR to dev (never merge autonomously) → watch CI incl. the required Network e2e (the delegated Phase-4 gate).
- Wrap-up with contentious decisions ELI5'd.
