# Phase 6 · The owner's calls

The answers are in `plan.md` § P5 (2026-09-29, decided by the driver under the owner's
delegation).

## The merge (step 1)

`origin/dev` had moved from `85c4d20f` to `4387b112` (keyboard-guards, #720). `git merge --no-ff
origin/dev` stopped on two conflicts:

- `apps/extension/src/popup/pages/import.vue`, Continue: this branch's `@click="continueImport"`
  and `:disabled="isRetryingAccountState"` against dev's `@click="completeImport(importedProfile)"`
  and `@keydown.enter="refuseRepeatEnter"`. Kept this branch's two and dev's refusal.
- `implementations-plan/index.md`: both plans' lines, keyboard-guards first.

Everything else merged clean: dev's root listener (`@keydown` on the layout, `isPopupSubmitKey`)
replaced the document listener this branch's Enter guard lived in, and the guard's `isRetrying`
argument carried over. The merge commit is `2ce28a1e`, signed.

Dev's new `popup/pages/import.test.ts` mocks the flow without this branch's members, so after the
merge its three "does not continue" cases passed vacuously: Continue calls the flow's
`continueImport`, which the mock lacked, and they watched `setLastActiveProfileId`, which only
the page's own completion calls. The mock gains the members and the cases watch `continueImport`.

## Red first (step 2)

Unit runs from `apps/extension`, before any product change, with the new cases written and jsdom
given a no-op `scrollIntoView` in `tests/vitest.setup.ts` (jsdom has none, so a spy needs one):

- `bun --bun vitest run src/components/composite/import/ src/composables/useFullBackupImport.test.ts
  src/composables/useProfileImportFlow.test.ts src/popup/pages/import.test.ts
  src/onboarding/pages/import.test.ts`: exit 1, 9 failed and 137 passed (146), 6 of 8 files
  failed. `restore-warning.test.ts` could not import its module; the composable and flow cases
  read `unrestoredNetworkNames` and `hasOtherRestoreErrors` as undefined; the form's two cases and
  both pages' warning cases found no `import-full-backup-warning`; the popup's Back case read
  `disabled` false.
- **Enter on a focused Retry**, at `91378ecd` (this branch before the merge), in a scratch
  worktree with the new test file and `tests/helpers/press-key.ts` copied in:
  `bun --bun vitest run src/popup/pages/import.test.ts -t "Enter on a focused Retry"`: exit 1,
  `expected "vi.fn()" to not be called at all, but actually been called 1 times` on
  `continueImport`, after `retryAccountState` was called once: the document listener ran Continue
  beside Retry's own click. On the merged head: 1 passed. The merge is the fix; no product change.
- **Back while a Retry runs**, with the warning built and Back unchanged: the two page files, exit
  1, 2 failed and 12 passed. Popup: `expected false to be true` on Back's `disabled`; onboarding:
  `expected undefined to be defined` on "Back to methods" after Retry. (The first onboarding run
  failed earlier, on the sentence: its mock named Alpha V5 but left `hasOtherRestoreErrors` to the
  real composable, which reads its hand-set row as another error with no Retry context; the mock
  now sets it false.)

## Change

- `components/composite/import/restore-warning.ts` builds the sentence. It sits beside the form,
  outside the auto-import directories, so it adds no global name.
- The composable's `unrestoredNetworkNames` are the Retry context's seeded network names in seed
  order (`RestoredNetwork.name`, from `seedDefaultsForProfile`: nothing in the backup chooses
  them); `hasOtherRestoreErrors` is whether any logged row is not one a Retry replaces, compared
  raw. `retryReplacedRows` in `full-backup-restore.ts` is that row set, shared with the Retry stage,
  whose own copy it replaces; it is the one new auto-imported name. Both computeds live in
  `retryWarningRefs`, since the composable's body reached 82 lines of the 80 allowed.
- The form takes `unrestoredNetworks` and `hasOtherErrors`; its warning carries `role="alert"` and
  a testid, and scrolls into view once, as it appears (`flush: "post"`, after the footer's buttons
  render).
- Back (popup) and "Back to methods" (onboarding) are disabled while a Retry runs.

## Green

- The same five files plus the rest of `src/composables/`, `src/popup/pages/`,
  `src/onboarding/pages/` and `src/wallet/services/account-state/`: exit 0, 77 files, 1040 passed.
- `bun run lint`: exit 0 after two fixes (the form test's formatting; the composable over the
  lines budget, above), the same 29 warnings and 3 infos, complexity baseline OK.
- `bun run typecheck:all`: exit 0. `bun run build`: exit 0; `src/types/` gains `retryReplacedRows`
  only.
- `bun run test:all`: exit 0; extension 613 files (610 passed, 3 skipped), 8094 tests (8082
  passed, 4 skipped, 8 todo); aztec-runtime 35 files (34, 1 skipped), 252 tests (250, 2 skipped);
  every other workspace all passed.
- `bun run test:ci-gating`: exit 0, 246 tests, 244 passed, 2 skipped, 0 failed.

## P4's gates on the head (step 5, at `1831e3d5`)

Local gates, every one exit 0: `bun run lint` 1 s, `bun run typecheck:all` 74 s,
`bun run test:all` 148 s, `bun run test:ci-gating` 39 s, `bun run build` 17 s, with the counts
above.

Smoke, per browser: the migration-fixture build once (all three markers present), then three
retry-0 shards at once, each on its own dist copy through its own `EXTENSION_PATH`, with
`NULO_E2E_MIGRATION_FIXTURE=1`. Every shard exit 0. Chrome ran at `1831e3d5`; Firefox's build ran
after `d61f7f8f`, the codex round's comment-only fix, landed.

| Browser | Shard 1 | Shard 2 | Shard 3 | Sum |
|---|---|---|---|---|
| Chrome | 14 files (2 skipped), 52 tests (50, 2 skipped), 310 s | 14 files (1 skipped), 38 tests (34, 4 skipped), 352 s | 14 files, 76 tests (75, 1 skipped), 748 s | 42 files (39, 3 skipped), 166 tests (159, 7 skipped), 0 failed |
| Firefox | 14 files (1 skipped), 52 tests (51, 1 skipped), 344 s | 14 files (1 skipped), 38 tests (34, 4 skipped), 440 s | 14 files, 76 tests (70, 6 skipped), 749 s | 42 files (40, 2 skipped), 166 tests (155, 11 skipped), 0 failed |

The skipped cases are, name for name, the final gate's (`post-impl.md`), which are P4's. The one
file more is dev's `keyboard-guards.test.ts`, 2 of 2 on each browser.

Network, retry 0, each report checked with
`jq -e '.numTotalTests > 0 and .numPassedTests == .numTotalTests'`: two extra worktrees detached at
`1831e3d5`, each with its own `bun install --frozen-lockfile`.

| Invocation | Browser, prover | e2e:agent, jq | Cases | Time |
|---|---|---|---|---|
| integrity + round-trip + the stall spec | Chrome, on | 0, 0 | 6 of 6 | 448 s |
| `backup-restore-sw-restart` | Chrome, proverless | 0, 0 | 3 of 3 | 291 s |
| integrity + round-trip | Firefox, proverless | 0, 0 | 4 of 4 | 345 s |

## Captures (step 6)

`zz-capture-backup-import-3.test.ts`, never committed, in the Firefox worktree after its run: five
cases, 5 of 5 (436 s), and a re-shoot of the three-button case, 1 of 1 (204 s). Every shot is the
screen as it opens, and the probe measured the warning against every ancestor that clips it:

- Popup, Alpha V5 stalled: the named singular sentence, `role="alert"`, its box 238 to 297 px in a
  scroller that ends at 297, both of its lines the topmost element at their points. Before the
  change the same screen hid the whole sentence under the four buttons (`O1-B-finished`, P5).
- While the Retry ran, Retry, Continue, View Errors and Back were all disabled; when it ran out of
  time again the screen came back as it opened (F-5).
- Onboarding, Alpha V5 stalled: the singular sentence, in view.
- Alpha V5 and Testnet stalled (a stub answering the identity probe per request path): "Alpha V5
  and Testnet didn't answer in time, so what was saved for them may not be restored. You can retry
  or continue.", in view; the viewer lists the two networks' rows.
- Another error only (an account-state row on chain 424242, which no seed serves): no Retry, three
  buttons, today's sentence in view whole. The first shot had the local network active, and its
  first-receive sheet (the funded test token, never allowed) covered the page; the re-shoot keeps
  Alpha V5 active and refused, as the stalled cases do.
- Alpha V5 stalled beside that row: "… You can retry, review the details, or continue.", in view.

The files and their strings are listed in the driver's `captures/index.md`.

## Codex (step 7)

Round 4, approve with fixes, high confidence: no new material finding and one comment nit, applied
in `d61f7f8f` (`post-impl.md`).

## Closing gate (the code at `d61f7f8f`, with the plan's closing docs)

Every command exit 0: `bun run lint` 1 s (the same 29 warnings and 3 infos, complexity baseline
OK), `bun run typecheck:all` 51 s, `bun run test:all` 132 s (extension 613 files, 610 passed and
3 skipped; 8094 tests, 8082 passed, 4 skipped, 8 todo; aztec-runtime 252 tests, 250 passed and 2
skipped; every other workspace all passed), `bun run test:ci-gating` 39 s (246 tests, 244 passed,
2 skipped, 0 failed), `bun run build` 14 s, `bun scripts/ci-cd/plans/check.ts` 4 s (three
report-only path tokens in files this branch does not touch, none enforced). `bun run e2e:reap`
found nothing to reap in the three worktrees.

## Where the open lands (step 8)

Step 6's captures showed the popup's four-button errors screen opening at scroll 82 of its 102,
with "PROFILE", the hero's second line, cut in half under the compact bar. A probe on the smoke
runner (never committed: synthetic backups, the local network refused so a Retry is offered, or an
item on chain 424242 so it is not) measured at 360x600, the same on Chrome and Firefox:

| | Four buttons, three-line warning | Four buttons, four-line warning | Three buttons | Onboarding (720x900) |
|---|---|---|---|---|
| Maximum scroll | 102 | 116 | 34 | 32 (Firefox 33) |
| The open landed at | 82 | 96 | 14 | 0 |
| The warning whole for scrolls in | [81.8, 263.6] | [96.2, 263.6] | [13.8, 263.6] | in view at 0 |

The bar is 56 px; the hero's title box clears it at 101.6, its accent bar at 113.6, the whole hero
block at 133.6. Onboarding has no hero. Decided 2026-09-30 (`plan.md` § P6 step 8): the title
lands under the compact bar where the scroller allows it; no layout change.

- **Change.** `components/composite/collapsing-hero.ts` holds the injection key and `revealMove`,
  which judges the edges at the current scroll: nothing when the block is whole below the bar, the
  scroller's end when that end carries the title past the bar, else the nearest scroll.
  `CollapsingHeroLayout` provides `reveal`, measuring its own scroller, bar and title; the form
  hands it the warning and, with no layout above it (onboarding), keeps `scrollIntoView({ block:
  "nearest" })`. The thresholds come from the elements, so another warning length lands by the
  same rule. The layout's scroller, bar, title and accent bar gain test ids.
- **Red, unit**, from `apps/extension` before the product change: the new
  `collapsing-hero.test.ts` with the layout's and the form's test files, exit 1, 7 failed and 22
  passed: the six decision cases on `revealMove is not a function`, the form's new case on
  `reveal` called 0 times.
- **Red, e2e**: `tests/e2e/import-errors-scroll.test.ts` on the previous product code, Chrome,
  retry 0: exit 1, 2 failed and 2 passed, twice. The first run's four-line case failed early, on
  the warning's bottom at 297.156 against the view's 297: the nearest scroll snaps to whole device
  pixels. The spec's check gained a half-pixel tolerance, and the second run failed where it
  should: the three-line case `expected 82 to be 102`, the four-line case the title's bottom at
  61.59 against the bar's 56. The three-button and onboarding cases passed, as today's behaviour
  does.
- **Green**: `bun --bun vitest run src/components/composite/collapsing-hero.test.ts
  src/components/composite/CollapsingHeroLayout.test.ts src/components/composite/import/
  src/popup/pages/import.test.ts src/onboarding/pages/import.test.ts`, exit 0, 8 files, 61
  passed; the spec 4 of 4 on Chrome (45 s) and on Firefox (56 s).
- **Landings after**, both browsers: 102 with a three-line warning (the title's bottom at 55.6,
  its accent bar alone at 65.6 to 67.6), 116 with a four-line one (title and accent bar under the
  bar), 14 with three buttons (the hero whole), onboarding 0.
- **Captures.** The probe again after the fix (`captures/hero-scroll/index.md` in the driver's
  scratch directory), and `zz-capture-backup-import-3.test.ts` re-shot step 6's list at
  `860b3e68` in a detached worktree, 5 of 5 (362 s), replacing its files under the same names.
  The Firefox shot of the three-line screen is the probe's: Firefox's interception only refuses,
  so it names "Local Network".
- **Codex**, round 5: approve with fixes, high confidence; two nits fixed in `eb32a31b`
  (`post-impl.md`).

## Gates at step 8 (the code at `eb32a31b`, with these docs)

Local, every command exit 0: `bun run lint` 2 s (the same 29 warnings and 3 infos, complexity
baseline OK), `bun run typecheck:all` 42 s, `bun run test:all` 120 s (extension 614 files, 611
passed and 3 skipped; 8101 tests, 8089 passed, 4 skipped, 8 todo; aztec-runtime 252 tests, 250
passed and 2 skipped; every other workspace all passed), `bun run test:ci-gating` 32 s (246 tests,
244 passed, 2 skipped, 0 failed), `bun run build` 14 s, `bun scripts/ci-cd/plans/check.ts` (the
same three report-only path tokens). The extension's one file and seven tests more are the
decision's six cases and the form's new one.

Smoke, per browser, as at step 5: the migration-fixture build once (all three markers present),
three retry-0 shards at once on their own dist copies, `NULO_E2E_MIGRATION_FIXTURE=1`. Every shard
exit 0. The builds carry the head's product code: `eb32a31b` changes a doc comment and a unit
fixture, neither of them in the bundle.

| Browser | Shard 1 | Shard 2 | Shard 3 | Sum |
|---|---|---|---|---|
| Chrome | 15 files (2 skipped), 54 tests (52, 2 skipped), 273 s | 14 files (1 skipped), 45 tests (41, 4 skipped), 309 s | 14 files, 71 tests (70, 1 skipped), 624 s | 43 files (40, 3 skipped), 170 tests (163, 7 skipped), 0 failed |
| Firefox | 15 files (1 skipped), 54 tests (53, 1 skipped), 334 s | 14 files (1 skipped), 45 tests (41, 4 skipped), 402 s | 14 files, 71 tests (65, 6 skipped), 631 s | 43 files (41, 2 skipped), 170 tests (159, 11 skipped), 0 failed |

The skipped cases are, name for name, step 5's. The one file more is `import-errors-scroll.test.ts`,
4 of 4 on each browser. The network specs were not rerun: the change moves only the errors
screen's scroll, and the capture run at `860b3e68` drove the stalled flows, Retry included, 5 of 5.
`bun run e2e:reap` found nothing to reap; the capture worktree is removed.
