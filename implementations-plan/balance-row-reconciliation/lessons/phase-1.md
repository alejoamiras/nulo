# Phase 1 — pure diff module

`reconcile-pairs.ts` exports `reconcilePlan({ tokens, accounts, existing })` returning
**both** halves of the repair in one pass: `missing` pairs (worker died before `repo.set`)
and `staleTokens` (worker died after `repo.set`, before `enqueue`). No storage, no chrome,
no service — everything needing serialization is on the caller's side of the boundary.

## Shape decisions

- **Narrow input types** (`ReconcileToken`, `ReconcileAccount`, `ReconcileRow`) rather than
  the real `Token`/`Account`/`TokenBalanceRaw`, so the module is exercisable without the
  storage codec and the test fixtures stay one line each.
- **Existing rows are indexed only under desired keys.** A foreign profile's rows are never
  materialized — pinned by a test asserting an unknown pair neither suppresses a creation
  nor appears as stale.
- **One pass, two outputs.** Computing `staleTokens` during the same walk avoids a second
  scan of `existing`, which is the large input.

## Ordering

Total order is `chainId → token id → account index → address`. Chain + account alone does
not order multiple tokens on the same chain (the codex round-2 Low). Pinned by a permutation
test that reverses both input arrays and asserts an identical result.

## Validation gate — PASS

```
bun run lint       → exit 0
bun run typecheck  → clean
bun run --cwd apps/extension test src/wallet/services/token-balance/reconcile-pairs.test.ts
                   → Test Files 1 passed · Tests 14 passed
```

Note the command form: `bun run --cwd apps/extension test <path>` runs `bun --bun vitest run`,
so launcher and workers execute on Bun 1.4 per CLAUDE.md. The draft plan (and #485's gates)
used `… vitest run` directly, which launches under Node — caught by the fable audit.
