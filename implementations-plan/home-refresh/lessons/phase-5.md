# Phase 5 lessons — e2e + full gates + manual visual pass

## Gate runs (2026-08-13)

- `bun run audit:vue` → exit 0 (typecheck:all + test + lint + build)
- `bun run test:all` → all workspaces green (extension 4046, faucet 542, design 299, wallet-core/
  crypto/messaging/bridge/aztec-runtime all passing)
- **Smoke e2e**: `bun run test:e2e` bare FAILS by design on a repo build — the fixture-arming
  contract (`backup-migration.test.ts` / `migration.test.ts`) requires a stamped build. The armed
  local flow: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 bun run build`, then
  `NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`. Armed result: **86 passed, 0 failed** (24 files).
- **Network e2e**: `bun run e2e:agent` refuses proverless-gated files without the flag; correct solo
  invocation `NULO_E2E_PROVERLESS=1 bun run e2e:agent` → **87 passed, 0 failed** (65 files, incl.
  the three untouched `account-selector` flows — the name-button testid preservation held with zero
  helper edits).

## New e2e failures found + fixed during the phase

1. My header-copy smoke test used `browserContext().overridePermissions(...)` — CDP rejects the
   `chrome-extension://` origin ("opaque origins"). Fix: no permission games; `page.bringToFront()`
   (the async clipboard API needs a FOCUSED document) + the real click's user gesture. The success
   toast fires only after `writeText` resolves, so the passing test proves an actual clipboard write.
2. Piping a gated command to `tail`/`cat` masks its exit code — background-task "exit 0" lied twice.
   Grep the log for the vitest summary, not the task status.

## Manual visual pass (screenshots reviewed; captured via a throwaway network-harness test, deleted after)

Driven on the real built extension against the local network (light theme — headless defaults):
- Header split: avatar (two-char "AC") + name + address; hover reveals the copy icon + underline,
  nothing shifts. ✓
- Token row: lock (accent) / globe (grey) split icons, tight 8px rows, gas card 2-decimal-capable,
  section rhythm reads correctly at 360px. ✓
- Token detail: breakdown "🔒 PRIVATE: n | 🌐 PUBLIC: n" in the new vocabulary. ✓
- Activity page + reduced-motion: layout intact, no animation artifacts. ✓
- **Dot behavior in the wild**: a fresh token import on the local sandbox NEVER shows the dot — the
  threshold suppresses routine hydration (the owner's core ask). The dot's own rendering couldn't be
  organically triggered (sandbox is always caught up) — pinned by TokenCard component tests and the
  approved-artifact CSS being applied verbatim.
- Light-theme render doubles as token-discipline proof: every new style uses CSS vars, so both
  themes resolve (accent lock = burnt orange in light, bone in dark).
