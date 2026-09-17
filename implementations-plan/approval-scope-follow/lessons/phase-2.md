# Phase 2 — the banner (2026-09-17)

- `execute/index.vue`: `followDeclined` ref, `scopeView` / `scopeBanner` computeds over the Phase 1 helpers, `toggleFollow`; the auto-registered `Banner` (`variant="info"`, `direction="vertical"`, `wide`) above *Requested operations*, `data-testid="execute-scope-banner"` + `data-state`, the action carrying `execute-scope-action-btn`. The variant is a literal `info`, so no state can render `warning`.
- `execute/scope-follow.test.ts` (new): a self-contained window scaffold (init resolves eagerly; the transient network client answers with the row the test picks; two accounts). Six cases: none · `account` ⇄ `account-declined` with the copy verbatim · `chain` → `chain-declined` (both rows named, info tone kept) · `multi-signer` (no action) · a padded read keeps `account` · no banner until the active rows are known, then it appears. Phase 3 extends this file with the follow.

## Gate

- `bun --bun vitest run src/popup/windows/execute` → 14 files, 122 tests passed (the frozen-oracle pins in `index.test.ts` untouched and green).
- `bun run typecheck` → exit 0; biome clean on the folder after formatting the new test file.
