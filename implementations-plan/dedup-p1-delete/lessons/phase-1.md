# P1 dedup-p1-delete — lessons

Scope: ledger ids M4 I6 B4 E3 E2 C4 I3 I4 (`implementations-plan/dedup-ledger/ledger.md`). Base: `dev` @ b47b9bf4 plus the two ledger docs commits cherry-picked from `docs/dedup-ledger` (#559), so the phase worktrees carry the README they read.

## Decisions

- **E3 cascade.** Deleting `TokenMintContent` left `ContentKind.TokenMint` with no producer, so the enum member, `TokensView`'s three switch cases, its `newTokens` computed and the template block that rendered "new token" placeholder cards went too. Residue deliberately left for P5 (L cluster): `TokenCard`'s `newToken` prop and the `isMinting` derivations in `TokensView` (now always false) — removing them changes a component contract and its tests, which is beyond "delete dead code".
- **ContentKind is a numeric enum.** Removing `TokenMint` (index 2) shifts `ExecuteOperation`/`Transfer`/`RevokeAuthwits` by one. Tasks are in-memory (never persisted) and the only literal kinds in tests are 0 and 1, so nothing observes the shift.
- **E2.** The switch's `default: AccessLevel.None` was unreachable (18 kinds, 18 cases) but would have silently gated a 19th kind at the weakest level. `Record<OperationKind, AccessLevel>` at module scope makes that a compile error; the method was private with one caller and is inlined.
- **C4.** `getContracts` still runs first; the instance/artifact resolve moved above the registration branch and is reused by it — one fewer PXE round-trip on the unregistered path, identical inputs to `registerContract`.
- **I4.** `refreshBalances`'s first argument was ignored (30-minute threshold hardcoded). Dropped it and the nested `checkAge`; the threshold is now a named module constant. Callers: `auth.vue`, `core.test.ts`.

## Skipped ids

(none)

## Codex consults

(pending)
