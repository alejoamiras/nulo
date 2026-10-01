# Post-implementation · the codex fix loop

`/codex high` (gpt-6-astra, account `alejo-gmail`, read-only) over `git diff origin/dev...HEAD`
(`origin/dev` at `85c4d20f`), with the plan, its ledger and lessons, the adversarial ask, and the
plan's two rules verbatim. Session `01a0ef0b-4975-7260-9311-a056ebee2ef2`.

## Round 1 (at `546c3662`): request changes, high confidence

1. **Major, accepted.** Picking another backup while a Retry runs did not end the Retry: the file
   row stays enabled on the errors screen, and the Retry's late clean answer completed the first
   profile's import, leaving the new selection's form. Realistic enough (a person who thinks they
   chose the wrong file) and new with the Retry. Red first:
   `-t "picking another backup"`: `expected "vi.fn()" to not be called at all, but actually been
   called 1 times`. Fix `0a17a3eb`: a new pick drops the Retry context once the picker answers, and
   a new restore drops it before its first await (it dropped it only after validation).
2. **Minor, accepted.** Continue called `completeImport` straight from both pages, so Retry stayed
   live during the completion handshake; a Retry pressed then ran the tail again and, answered
   cleanly, completed the import twice. Red first: `c.continueImport is not a function`. Fix
   `007f0c2e`: the composable's `continueImport` drops the Retry context, then completes; both
   pages' Continue and the popup's Enter shortcut use it. Retry therefore leaves the screen the
   moment Continue is pressed (Decision ledger). A page case pins the onboarding wiring.
3. **Nit, accepted.** Two TSDoc lines on the error-log writers narrated them; removed in
   `e2410b22`, the append, raw-identity and emptied-key comments kept.

Gate after the fixes: the composable, flow, onboarding page and Enter-helper suites, 4 files, 120
passed; `bun run typecheck:all` exit 0; Biome clean on the touched files.

## Round 2 (at `801b9d00`): request changes, high confidence

Codex confirmed that the new-restore invalidation, the Continue wiring and the comment removals
close their findings, and raised one more:

1. **Major, rejected.** The pick fix drops the Retry only after `opts.pickFile()` resolves, and
   for a compressed backup (the export writes gzip) that waits on the decompression
   (`utils/files.ts`), so a Retry that answers cleanly inside that window still completes the
   first import. Codex's fix: drop the Retry before awaiting the picker. Rejected by the realism
   rule: the window is the decompression of a file the person chose while a Retry (45 s at most)
   runs, well under a second (inflating 34 MB took 64 ms in a Bun measurement); the outcome is
   the first profile's wallet, fully restored, with the second backup still importable; and the
   proposed fix trades it for a path people do take: `pickFile` never settles when the picker is
   cancelled, so opening the picker and cancelling would discard the Retry for good. Closing the
   window without that cost needs a new callback through `pickFile`, the kind of surface the rules
   exclude. Decision ledger.

## Round 3 (at `b5bcdcc4`, no code change): approve, high confidence

"No new material finding." Codex withdrew round 2's finding: "The cancellation behavior makes my
proposed fix worse; I have no concrete failure beyond the documented navigation race that
outweighs that trade-off." It found nothing else materially wrong in the whole diff. The loop
converged in three rounds: four findings, three accepted and fixed, one withdrawn.

## Final gate (at `e40cf03d`; `origin/dev` still `85c4d20f`, so no merge)

Local gates, every one exit 0: `bun run lint` 2 s, `bun run typecheck:all` 38 s,
`bun run test:all` 133 s, `bun run test:ci-gating` 39 s, `bun run build` 26 s. `test:all`:
extension 609 files (606 passed, 3 skipped), 8062 tests (8050 passed, 4 skipped, 8 todo), three
more than P4's: the two Retry cases and the onboarding Continue case; aztec-runtime 35 files (34,
1 skipped), 252 tests (250, 2 skipped); every other workspace all passed. `test:ci-gating`: 246
tests, 244 passed, 2 skipped, 0 failed.

Smoke, per browser: the migration-fixture build once (all three markers present), then three
retry-0 shards at once (`--shard=i/3`), each on its own dist copy (`dist/chrome`, `dist/smoke2`,
`dist/smoke3`; Firefox `dist/firefox`, `dist/fxsmoke2`, `dist/fxsmoke3`) through its own
`EXTENSION_PATH`, with `NULO_E2E_MIGRATION_FIXTURE=1`. Every shard exit 0.

| Browser | Shard 1 | Shard 2 | Shard 3 | Sum |
|---|---|---|---|---|
| Chrome | 14 files (2 skipped), 52 tests (50, 2 skipped), 254 s | 14 files (1 skipped), 45 tests (41, 4 skipped), 341 s | 13 files, 67 tests (66, 1 skipped), 631 s | 41 files (38, 3 skipped), 164 tests (157, 7 skipped), 0 failed |
| Firefox | 14 files (1 skipped), 52 tests (51, 1 skipped), 347 s | 14 files (1 skipped), 45 tests (41, 4 skipped), 470 s | 13 files, 67 tests (61, 6 skipped), 671 s | 41 files (39, 2 skipped), 164 tests (153, 11 skipped), 0 failed |

The skipped cases are exactly P4's (phase-4.md § Smoke). The slowest shard took 631 s on Chrome and
671 s on Firefox, against 1250 s and 1583 s for P4's unsharded runs.

Network, retry 0, each report checked with
`jq -e '.numTotalTests > 0 and .numPassedTests == .numTotalTests'`: two extra worktrees detached at
`e40cf03d` (each with its own `bun install --frozen-lockfile`), one invocation at a time in each.

| Invocation | Browser, prover | e2e:agent, jq | Cases | Time |
|---|---|---|---|---|
| integrity + round-trip + the stall spec (its run 01) | Chrome, on | 0, 0 | 6 of 6 | 412 s |
| `backup-restore-sw-restart` | Chrome, proverless | 0, 0 | 3 of 3 | 210 s |
| integrity + round-trip | Firefox, proverless | 0, 0 | 4 of 4 | 317 s |

The stall spec on the final commit: ten runs in a row, all green, 2 of 2 cases each, none skipped
(01 in the Chrome invocation above; 02 to 10 took 222 to 254 s). `bun run e2e:reap` found nothing
to reap in any of the three worktrees; both extra worktrees removed.

## Round 4 (at `1831e3d5`, the owner's calls built): approve with fixes, high confidence

The same session, resumed over `git diff 2ce28a1e..HEAD`, the merge's conflict resolution
(`git show --remerge-diff 2ce28a1e`) and the whole branch for context, with the two rules and the
adversarial ask verbatim, and the owner's decisions stated as not open to review. It read the tree
only: the e2e gates were running in it.

"No new material finding." One nit, accepted: the doc comments on `restoreWarningText` and
`retryWarningRefs` narrated the helper's branches and restated its name. Both deleted in
`d61f7f8f`; after it the form and composable suites, 5 files, 120 passed, and Biome is clean. A
comment-only fix, so the loop ends here without another round.

## Round 5 (at `860b3e68`, the open's landing): approve with fixes, high confidence

The same session, resumed over `git diff d4ead5e6..HEAD` (the one commit), with the two rules and
the adversarial ask verbatim, and the landing's decision (`plan.md` § P6 step 8) stated as not open
to review. It read the tree only: the smoke suite and a network capture were running in it. Named
for attack: whether the rule can land the warning partly out of view or move a screen the person
already scrolled, whether a post-flush watcher can read a layout that is not final, whether the
provide reaches the layout's other pages, whether the e2e cases prove their names, and whether the
half-pixel tolerance hides anything.

"No new material finding." Two nits, both accepted and fixed in `eb32a31b`:

1. `collapsing-hero.test.ts`: the "already whole" case's block had its top (319.6) below its bottom
   (290), a rectangle no layout makes; it now spans 230 to 290.
2. `collapsing-hero.ts`: the interface's summary restated its name, and `reveal`'s doc promised
   more than the rule gives an arbitrary element. The landing can be the scroller's end, so the
   element must be a trailing block that fits between the bar and the scroller's bottom; the doc
   now says so, and the summary is gone.

After the fix: the decision's, the layout's and the form's test files, 3 files, 29 passed; the
pre-commit Biome check clean. A comment and fixture fix, so the loop ends here.
