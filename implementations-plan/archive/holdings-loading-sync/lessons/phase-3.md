# Phase 3 — Holdings list

**Gate (2026-09-17):** `bun run lint` exit 0 · `bun run typecheck:all` exit 0 · `bun run --cwd apps/extension test src/popup src/composables/useSeedStatus` 95 files / 888 tests passed.

## What landed

- `useSeedStatus` (C1, 13 cases): snapshot state `loading | loaded | unavailable`, generation-guarded, one timed retry (2 s), refetch on event / reconnect / scope change, `ensureSeeding` once per scope and again after every reconnect. The parent (`pages/general.vue`) owns the one `TokenServiceClient`.
- `TokenSeedRow` (5 cases): inert `div`; `pending|seeding` → compiled-in symbol + label + a skeleton pair; `failed` → "Couldn't set up" + `RETRY`; `rejected` → "Couldn't verify", no button.
- `TokensView`: `BalanceView`'s dirty-refetch + generation pattern, the same three-state snapshot, placeholders deduped by contract against real rows and `TokenImportRow`s, ghost rows after 300 ms of a blank wait, empty state only when both snapshots are `loaded`. All sync-state plumbing deleted, along with its `IncomingTransferServiceClient`.
- `TokenCard`: dot, tooltip, both loading captions, spinner and private shimmer gone; the initial-sync block is a `Skeleton` pair under the kept `token-balance-loading` testid. `TokenList` lost its `backfilling` prop.

## Lessons

- **Skeleton dimensions come from the approved canvas**, not from taste: amount pair 64×13 / 92×9, ghost left column 52×14 / 84×9, the failed row's `RETRY` outline button 28 px high. Kept identical so the screenshots match what the owner signed off.
- **vitest has no component resolver** (only auto-import): a bare `<Skeleton>` in an SFC renders as an unknown element in unit tests while the real build resolves it. Tests therefore stub it (`TokenCard.test.ts`) or the SFC imports it explicitly (`TokenSeedRow`, `TokensView`). Assertions go through the wrapper's testid, never through the primitive's class.
- **Complexity budget:** the first `load()` in `useSeedStatus` scored 25 (nested `try/catch` + scope reset + retry arming). Split into `enterScope` / `onRejected` / `load`; no suppression.
- **A latent stall surfaced:** `TokensView`'s `onMounted` awaited `fetchTasks()` unguarded, so a rejected task snapshot skipped the balances fetch entirely. Under the old template that showed an (incorrect) empty state; under the new contract it would have been skeleton rows forever. Now `.catch(() => undefined)`, same as the scope watcher already did.
- **The 2 s retry is a real timer**, so every test that can reject a fetch unmounts its wrapper (or uses fake timers) — a stray retry would otherwise bump `getTokenBalances` call counts in a later test of the same file.
- **Dropped with the loading caption:** `TokenCard`'s "Minting more tokens..." string. It only ever rendered inside the removed caption span (i.e. during an initial sync), so it had no other surface; the `newToken` minting row is untouched.
- `BalanceView` does not receive the seed props yet — passing undeclared props would fall through as DOM attributes. Phase 4 declares and wires them.
