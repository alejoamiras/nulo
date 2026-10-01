# Phase 1 — the resolvers (2026-09-17)

- `execute/scope-mismatch.ts`: `resolveOperationScope` (row identity for the chain axis; the single signer, else the single account that sends, and never a hidden one, as the follow account), plus two pure helpers the plan left to the template: `scopeBannerState(view, declined)` and `scopeBannerCopy(state, view, active)`. Deriving state and copy in code, not in the template, is what lets Phase 1 pin the owner-approved table verbatim and keeps `index.vue` a consumer.
- **Hidden signer**: the resolver leaves `followAccount` undefined when the account is not visible, so every consumer skips the account half by construction; the follow does not re-check `visible` (one rule, one place).
- `signers.ts`: `uniqueSignerAccounts` accepts a readonly array (no copy at the call site).
- 19 cases: every state-table row, both declines, `multi-signer` unaffected by declining, padded read vs. two senders, hidden lone signer on the same row (no banner) and on another row (chains only), unresolved active scope, zero operations, read-only copy, chains-only copy, renamed row.

## Gate

- `bun --bun vitest run src/popup/windows/execute/scope-mismatch.test.ts` → 19 passed.
- `bun run typecheck` → exit 0; biome clean on the execute folder (formatter applied to the two new files).
