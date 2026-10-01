# Phase 4 · C4 · `legal-acceptance.test.ts` S5

## Branch taken: 1, the park and its comment are deleted

With the park removed, the account export's snack was on screen at the full backup's first two
bottom-row presses in every run, on both browsers, and every one of those presses succeeded. With
`v-snack-footer` removed from `CollapsingHeroLayout.vue` (the mutation), the first press failed on
every run with `pointerClick`'s own cover message. So the snack's footer inset is what keeps the
export row clear, the park guarded nothing, and branch 1's evidence is complete. Neither branch 2
(a cover on the unmutated page) nor branch 3 (a harness reason to keep the wait) was observed.

## The probes (steps 1 and 2)

Uncommitted copies of the file (written by a scratch generator) drop S5's park (the comment,
`page.mouse.move(180, 40)` and the wait for the snack to leave) and record every `pointerdown` that
reaches `agree-continue-btn`, `unlock-submit-btn` or `download-backup-btn`: whether a
`[data-testid="snackbar"]` is on screen, and both boxes. A press whose control is covered never
gets that far: `pointerClick` hit-tests the control's centre first and throws naming the cover
(`helpers/legal-drivers.ts:69-97`). Each run is the smoke build with the plan's flags, then
`-t S5` (its three seeds, `missing`, `stale` and `corrupt`), retry 0.

| Run | Browser | Result | At each seed's presses |
|---|---|---|---|
| Natural | Chrome | 3 passed, exit 0 (84 s) | `agree-continue-btn` and `unlock-submit-btn`: snack on screen, snack box top 447 to bottom 489, button 522 to 580; `download-backup-btn` (about 11 s later): no snack |
| Natural | Firefox | 3 passed, exit 0 (92 s) | the same boxes and the same pattern |
| Natural, mutant | Chrome | 3 failed, exit 1 (68 s) | every seed: `agree-continue-btn is covered at its centre by snackbar` at the first press, so no `pointerdown` reached a control |
| Held | Chrome, Firefox, and Chrome mutant | 3 failed each, exit 1 | failed in the probe's own hold step (below), before any press |

The boxes are the same on both browsers and every seed: the snack's bottom edge sits 33px above
the button's top, and both span the page's width (snack 16 to 344, button 24 to 336).

The held variant is the plan's fallback for a run that never catches the snack at a press. Its hold
step read the snack's box from `page.waitForSelector(…)`'s handle, but the harness's
`patchPagePolling` replaces `waitForSelector` with a version that always returns `null` for a plain
CSS selector (`fixtures/extension.ts:1073-1077`), so every held run threw "PROBE: no snackbar box
to hold" before its first press. Every natural run caught the snack at the first two presses, so
the fallback was not needed and was not rerun.

The mutation: `CollapsingHeroLayout.vue` was copied to scratch first, then `v-snack-footer` was
removed from its bottom row (`:84`) and Chrome rebuilt. Afterwards the copy was put back (`cmp`
byte-identical), `git diff --exit-code -- apps/extension/src/components/composite/CollapsingHeroLayout.vue`
exited 0, and Chrome was rebuilt from the restored source (exit 0).

## The flake bar

The whole file without the wait, retry 0, after a smoke build per browser with the plan's flags
(`NULO_E2E_MIGRATION_FIXTURE=1 bun run --cwd apps/extension test:e2e --retry=0
tests/e2e/legal-acceptance.test.ts`). One file cannot be split by `--shard`, so these ran
unsharded; the owner's sharding instruction (2026-09-29) arrived with Chrome's second run done and
applies from the next multi-file run.

| Run | Exit | Tests passed / failed / skipped | vitest duration |
|---|---|---|---|
| Chrome 1 | 0 | 13 / 0 / 0 | 200 s |
| Chrome 2 | 0 | 13 / 0 / 0 | 214 s |
| Chrome 3 | 0 | 13 / 0 / 0 | 202 s |
| Firefox 1 | 0 | 13 / 0 / 0 | 245 s |
| Firefox 2 | 0 | 13 / 0 / 0 | 254 s |
| Firefox 3 | 0 | 13 / 0 / 0 | 251 s |

`bun run e2e:reap` after the bar: exit 0, nothing to reap.

## Gate

- The branch 1 criteria: the snack on screen at a press on each browser with every unmutated press
  succeeding; the mutated run with the snack covering the first press; three green retry-0 runs per
  browser without the wait (all above).
- `git diff --exit-code -- apps/extension/src/components/composite/CollapsingHeroLayout.vue`: exit
  0, after the mutation and again at the phase's end.
- `bun run lint`: exit 0 (28 warnings and 3 infos, none in `legal-acceptance.test.ts`).
