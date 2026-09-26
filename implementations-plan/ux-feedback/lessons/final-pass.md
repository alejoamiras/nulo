# Final cross-batch pass

A fresh codex session (GPT-6 Astra at high, `01a0da9a-…`) read the stack's net diff, from its
base `9f11de70` to its top. It looked for seams between batches, duplication across them and
drift from the spec, under the program's post-implementation rules.

## Round 1

Two minor findings:

> VERDICT: changes-requested — confidence: moderate

1. An account row's keyboard focus draws a tint and no ring (arcs 4 and 5b). Withdrawn as a
   defect: item 11's ring is for rows that open something, and an account row selects. Whether
   selection rows take the ring too goes to the owner, in arc 5b's PR.
2. Comments (arcs 5a and 5b). `dispatcher.ts`'s "Phase 3" line narrated the call below it, and
   `scope-enforcement.test.ts` said "NO LONGER". Both were fixed on arc 5a. The security ids
   (`F-01`, `F-004`) stay: they predate the stack and pair with the registry and its regression
   tests.

## The sync

The stack then moved onto `origin/dev` at `b15f5218`, five commits newer: the landing's Workers
deploy, npm publishing and a fix to it, the report-only plan-tree gate, and an import recipe.
Every arc's tree equals `git merge-tree --write-tree origin/dev` of its tip before the move. The
range-diffs show only round 1's fix, plus context that moved around the deleted line in two 5b
commits.

## Round 2

The same session, on the fix and all six rebased trees:

> **no new material findings**
>
> VERDICT: approve — confidence: high

It withdrew finding 1 as a defect, leaving the ring to the owner, and agreed the security ids
stay.

## Round 3

`d893ae95`, arc 5b's fold fix from its parity page's second reader, came after round 2. The same
session, resumed after a failed first attempt (`../b5-permissions/lessons/phase-10.md` § Codex
round 3), read it and the four no-change judgments listed there:

> **no new material findings**
>
> VERDICT: approve — confidence: high

## The stack-top gate

Two clean detached checkouts at `d893ae95`, every e2e file at retry 0: Chrome prover on, with the
`@requires-proverless` files run proverless, and Firefox proverless. The flake bar is `cap-window`
and the three network files P9 changed (`cap-request-accounts`, `cap-request-basic`,
`cap-request-rerequest`), three runs each.

| Step | Chrome | Firefox |
|---|---|---|
| `bun run lint` | exit 0 (1 s) | not browser-bound |
| `bun run typecheck:all` | exit 0 (39 s) | not browser-bound |
| `bun run test:all` | exit 0 (109 s) | not browser-bound |
| `bun run test:ci-gating` | exit 0 (33 s) | not browser-bound |
| `bun run build` | exit 0 (8 s) | not browser-bound |
| `bun run --cwd apps/extension build-storybook` | exit 0 (7 s) | not browser-bound |
| Network suite, retry 0, 102 files | prover on: exit 0; files 92 passed, 3 skipped of 95; tests 132 passed, 5 skipped of 137 (3,493 s). The 7 `@requires-proverless` files, proverless: exit 0; files 7 passed of 7; tests 18 passed of 18 (853 s) | proverless: exit 0; files 99 passed, 3 skipped of 102; tests 148 passed, 7 skipped of 155 (4,364 s) |
| Smoke (its build exit 0 / 0) | exit 0; files 38 passed, 3 skipped of 41; tests 157 passed, 7 skipped of 164 (827 s) | exit 0; files 39 passed, 2 skipped of 41; tests 153 passed, 11 skipped of 164 (1,074 s) |
| Flake bar, run 1 | exit 0; files 4 passed of 4; tests 8 passed of 8 (146 s) | exit 0; files 4 passed of 4; tests 7 passed, 1 skipped of 8 (169 s) |
| Flake bar, run 2 | exit 0; files 4 passed of 4; tests 8 passed of 8 (147 s) | exit 0; files 4 passed of 4; tests 7 passed, 1 skipped of 8 (171 s) |
| Flake bar, run 3 | exit 0; files 4 passed of 4; tests 8 passed of 8 (148 s) | exit 0; files 4 passed of 4; tests 7 passed, 1 skipped of 8 (170 s) |
| `bun run e2e:reap` | exit 0 | exit 0 |

`cap-window` and `window-placement` passed in both browsers, and both execution canaries
(`frozen-account-canary`, `passkey-execution-canary`) passed prover on inside Chrome's network
suite. The Firefox canaries stay open until CI's `Firefox / Run / canary / real-proving` job on
the stack top's head shows the substantive tests passed, retry 0, with Presto enforced and native
proofs in the server log. The restack after the gate changed only `implementations-plan/`: outside
it, the stack top's tree is `d893ae95`'s.
