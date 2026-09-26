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

## CI's Firefox smoke on the synced stack

After the stack moved onto `origin/dev` at `e476e919`, CI's Firefox smoke failed #703.
`rows.test.ts`'s contact-row test timed out waiting for the tab its Ctrl-click opens
(`waitForTarget: no matching target after 10000ms`), on all three attempts. The same wait lost
the tab on one of #704's two attempts, and #702's single attempt saw it. No local run failed. It
was not the product: on CI the unclosed tabs logged vue-router `pagehide` warnings at teardown,
and locally the classic handle list named every such tab.

The cause was read in Firefox 153's remote agent and timed with a chrome-scope probe that was
never committed. BiDi announces a tab only through its first browsing context, once it has seen
that context's document (`waitForCurrentWindowGlobal`, polled every 10 ms for up to 100 ms). It
sends nothing when the context is discarded first, and filters out the context that replaces it
(`#onContextAttached`, `why: "replace"`). The Ctrl-click tab was replaced 9–25 ms after it opened;
a `windows.create` window kept its first context 50–70 ms. The probe saw 36 of 36 clicks
announced, with 2 CPUs among the runs, and 12 of 12 with the run and three busy loops pinned to
one CPU. So the trigger on CI's runners is inferred.

The fix is `fdead741`: `waitForNewTab` joins `BrowserDriver`.
- Chrome keeps the `targets()` diff.
- Firefox diffs the classic handle list and closes the tab it found by handle from chrome scope.
  It then waits until the list no longer names the tab, because `removeTab` can return with the
  tab still open.
- The seam's contract says nothing else may open a tab meanwhile.

FIREFOX.md has the row, and the e2e-testing skill's flake ledger has #36.
`onboarding-tab.test.ts` also waits in `targets()` for a `tabs.create` tab, so it depends on the
same announcement. It has not failed, and it is not changed.

Codex high reviewed the fix over three rounds, in one session (`01a0df6f-…`).
- Round 1 had material findings:
  - the cleanup trusted `removeTab`'s return;
  - the seam had no sole-opener precondition;
  - the comments overstated the timing;
  - the timeout was not end to end;
  - the onboarding exposure.

  The first three were adopted and the timeout's wording corrected. The exposure is recorded.
- Round 2: "Material findings: no". Its two wording points went into `fdead741`.
- Round 3, on that amend: "Material findings: no".

`rows.test.ts` at retry 0, on the stack top carrying the fix, passed on Firefox 5 of 5 and on
Chrome 3 of 3. That held both before and after the cleanup check was added. The stack top's
full gate is in `../../lessons/final-pass.md`.
