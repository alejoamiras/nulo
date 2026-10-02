# P11 · Gates, review and captures

## Static gates

On `919892b6` (P10's tree), from the repo root: `bun run lint` exit 0; `bun run typecheck:all`
exit 0; `bun run test:all` exit 0 (extension 606 files passed and 3 skipped by design, 8,066
tests passed); `bun run test:ci-gating` exit 0; `bun run build` exit 0;
`bun run --cwd apps/extension build-storybook` exit 0; the plans gate exit 0.

**Miss, caught by the build.** P9 added `inputRoom` to `utils/hero-ruler.ts`, which the build
auto-imports, and committed without building, so the tracked declarations lacked it; this build
wrote them. Committed on their own (`0fa4df32`). `lessons.md` § CI & gates already names the trap.

## Code review, round 3 of 3

`/codex high` (GPT-6 Astra), resuming session `01a0eb09-0547-7610-b15e-ba1f8557c586` on account
`alejo-gmail` through the lock script, with the rebuild's commits, the owner's four answers
verbatim, the adversarial ask and the two rules: **approve, confidence high, no new material
finding**. It reproduced F-1's example ("1.234,5678901" at 6 decimals reads "1.234567", validates
to `1234567n`), found the three moved files byte-identical, BalanceView changed in its import paths
only, no `comma` caller left, both font listeners removed on unmount, and the fits writing
presentation state only: the review text and the submitted units still come from the model and
the validator.

| # | Severity, bucket | Finding (one line) | Resolution |
|---|---|---|---|
| 1 | minor, realistic (maintenance) | `fitHero`'s doc says only a too-long symbol can push a fit below 60%, false for its new one-form callers; the two rulers' comments describe the element instead of the invariant the fit rests on | accepted: the clause dropped; each ruler's comment now says what it must share with the text it measures (`d8e084c8`) |
| — | noted | the declarations for `inputRoom` were uncommitted | committed (`0fa4df32`, above) |
| — | noted | the specs prove the line under the field does not move between focus and rest, not that it sits where dev had it | the captures below read the line's height at focus against the input's own |

The loop ends here: three rounds, the last with no new material finding.

## `dev` merged again

The driver reported `dev` at `85c4d20f` (#719, e2e reliability fixes). `git merge-tree
--write-tree HEAD origin/dev` had no conflict; `SSH_AUTH_SOCK= git merge --no-ff origin/dev` made
`cbd802fc` (signed). #719 changes none of this plan's files; it touches the e2e fixtures this
spec uses, and the curated `lessons.md`, `follow-ups.md` and `index.md`, read after the merge
before the close-out edited them. `bun install --frozen-lockfile` changed nothing.

On `cbd802fc`: lint, `typecheck:all`, `test:all` (extension 606 files passed and 3 skipped,
8,068 tests passed), `test:ci-gating`, `build`, `build-storybook` and the plans gate all exit 0;
the build regenerated nothing.

## Browser gates, on `cbd802fc`

Smoke built as `_extension-smoke-e2e.yml` builds its source run, run with
`NULO_E2E_MIGRATION_FIXTURE=1` at retry 0; network through the isolated runner, proverless, at
retry 0. Smoke Chrome ran beside the Firefox network runs, then smoke Firefox beside the Chrome
ones: never a smoke and a network run of one browser together.

| Run | Chrome | Firefox |
|---|---|---|
| smoke | exit 0: 38 files passed, 3 skipped by design (`action-popup-layout`, `_probe-console-capture`, `store-captures`, as at P4); 157 tests passed | exit 0: 39 files passed, 2 skipped by design (`_probe-console-capture`, `store-captures`, as at P4); 153 tests passed |
| `send-amount-exact`, three runs | 3 of 3 passed, 134 to 143 s | 3 of 3 passed, 239 to 244 s (beside smoke Chrome) |
| `fiat-send` and `send-amount-clamp` | 2 of 2 passed | 2 of 2 passed |

No network spec skipped. `bun run e2e:reap` after the runs: nothing to reap.

## Captures

A throwaway spec, copied into `tests/e2e/network/` for its run and deleted after it, never
staged; light theme, 360×600, retry 0, Chrome and Firefox. Two sets, each exit 0 with four files
per browser. The first is the wallet as the network runs leave it: the live price for TST did not
land, so no TST/USD toggle sits beside the field and the field takes the row's full width. The
second seeds a quote as `fiat-send` does, so the toggle takes its width, as in P5's captures.

| Capture | No quote | Quote seeded |
|---|---|---|
| 1 · the review sheet after the million-plus Max | every digit and "TST" on one line at 19.8 px (66%), no overflow | the same |
| 2 · the field at rest with 1.123456789012345678 | every digit, at 29.2 px (73%) | every digit, at 22.8 px (57%) |
| 3 · the field at rest with the million-plus Max | every digit, at 21.6 px (54%) | every digit, at 16.8 px (42%) |
| 4 · "1.234,5678901234567890123" pasted, 18 decimals | reads "1.234567890123456789" at once, with the clamp hint; at rest every digit, at 28.8 px (72%) | the same, at 22.4 px (56%) |

Chrome and Firefox drew the same sizes to the tenth of a pixel. With focus the field's line is
the input's own height, 53 px in both browsers, and it stays 53 px at rest while the input
shrinks to 24 to 40 px: the strut keeps dev's line to the pixel. The quote-seeded sizes are the
ones the owner's answer estimated (about 58% and 43%).

**Found: the unit toggle's place (Ask A-4).** With a quote, the TST/USD toggle stays at the top
of the field's line, where dev draws it, so once the amount shrinks the toggle sits above the
amount's end instead of beside it (the second set, captures 2 to 4). The row asks for
`align="baseline"` (`AmountCard.vue:314`), but the design `Flex` has no such value: its validator
refuses it and no `items-baseline` class exists, so the row stretches and the toggle's text sits
at its top. A layout call for the owner: plan § Asks, A-4.

`git status` after the runs shows no spec left. ✓
