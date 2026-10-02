# Phase 2 · The glossary's `where` (G)

- **Red**: `utils/glossary.test.ts` and `popup/pages/settings/glossary.test.ts` expect
  "Permission window · Connected apps" (O4 (a)). From `apps/extension`,
  `bun --bun vitest run src/utils/glossary.test.ts src/popup/pages/settings/glossary.test.ts` → exit
  1, 2 failed, 12 passed; each received "Permission window · approval window".
- **Change**: `utils/glossary.ts`, `GLOSSARY.authorization.where`. No other file holds the old line,
  and no e2e reads it.

## Gate

- `bun --bun vitest run src/utils/glossary.test.ts src/popup/pages/settings/glossary.test.ts` → exit
  0, 2 files, 14 passed.
- `bun run lint` → exit 0 (28 warnings, 3 infos, the base's; complexity-baseline OK). ✓
