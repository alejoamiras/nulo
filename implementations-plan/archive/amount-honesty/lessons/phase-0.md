# Phase 0 · Plan in the tree, and the landed field re-read

## Base

- The branch starts at `0f37ab78`, the top of stack #729, by the driver's instruction: the stack's
  eight PRs are about to land on `dev` as squash commits whose final tree equals `0f37ab78`'s.
  At the start `origin/dev` was still `4387b112`, so the stack had not landed.
- Step 1's comparison (`git diff --stat 0f37ab78 origin/dev -- <change map>`) is empty by
  construction: the branch is `0f37ab78` itself, where the plan's Facts were verified. Facts 11 to
  17, 21 and 22 therefore hold at their lines; § A2 needs no adjustment before P2. The comparison is
  repeated before the final gate, when the branch takes `origin/dev`.

## A3 · `comma`

- `git grep -nE "(export (const|function) comma|comma:|comma\b.*: typeof)" -- apps packages` finds
  nothing: no definition in `apps/extension/src/utils/amount.ts` and no declaration in
  `apps/extension/src/types/auto-imports.d.ts` or `.eslintrc-auto-import.json`.
- `implementations-plan/follow-ups.md` no longer lists `send-amount-exact`'s F-3. Nothing to build.

## Gate

- `bun scripts/ci-cd/plans/check.ts`: exit 0, 3 report-only `path-token` findings, all in files
  this plan does not touch.
- `bun run lint`: exit 0 (the complexity-baseline check OK).
- `bun run test:ci-gating`: exit 0, 244 pass, 2 skip (an env-gated `skipIf` in
  `decide-gate.test.ts` and a fixture's deliberate `test.skip`), 0 fail.
