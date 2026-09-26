# Phase 7 · Arc gate on the final source ✓

P6's gate, rerun on arc 4 as the stack carries it: `4c20a006`, on `origin/dev` at `b15f5218`.
Its code is P6's tip, `037b6c6c`, merged with dev's five commits: the arc's tree equals
`git merge-tree --write-tree origin/dev` of its tip before the move, and every commit's range-diff
is `=`. Each browser ran in its own clean detached checkout, every e2e file at retry 0, each run
followed by `bun run e2e:reap`. The network list is the arc's two added files plus
`network/window-placement.test.ts` three times.

| Step | Chrome | Firefox |
|---|---|---|
| `bun run lint` | exit 0; the 29 warnings and 3 infos P6 saw | not browser-bound |
| `bun run typecheck:all` | exit 0 | not browser-bound |
| `bun run test:all` | exit 0; the extension's 7,499 passed, 4 skipped, 7 todo, as P6 | not browser-bound |
| `bun run test:ci-gating` | exit 0; 241 passed, 2 skipped, with dev's plan-tree tests | not browser-bound |
| `bun run build` | exit 0 | not browser-bound |
| `bun run --cwd apps/extension build-storybook` | exit 0 | not browser-bound |
| `network/snack-placement.test.ts` | prover on: 3 passed | proverless, with the next row: 2 files, 10 passed |
| `network/incoming-arrival.test.ts` (`@requires-proverless`) | proverless: 7 passed | in the row above |
| Smoke (its build exit 0) | files 38 passed, 3 skipped; tests 157 passed, 7 skipped | files 39 passed, 2 skipped; tests 153 passed, 11 skipped |
| `network/window-placement.test.ts`, three runs | 1 passed, 1 skipped, each run | 2 passed, each run |
| `bun run e2e:reap` | exit 0 | exit 0 |

Chrome's skipped window-placement test is the Firefox-only window refocus case
(`FIREFOX_ONLY.windowRefocus`). The smoke counts equal P6's rerun on both browsers. The restack
after the gate changed only `implementations-plan/`: outside it, the arc's tree is `4c20a006`'s.
