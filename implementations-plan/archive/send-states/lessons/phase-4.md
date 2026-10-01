# Phase 4 · Browser proof and the arc gate

## Step 1 · `fee-sponsor-funding.test.ts`, red on `85c4d20f`

The two tests, run with every source file this branch changes put back to its `85c4d20f` copy (a
scratch backup of the branch's copies restored them afterwards; `git status` showed only the new
test file). The two files the branch adds stayed, imported by nothing. Chrome, proverless, retry 0:
`NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/fee-sponsor-funding.test.ts --reporter=default --reporter=json --outputFile=.e2e-state/report-fee-sponsor-funding-red.json`
→ exit 1; 2 tests, 0 passed, 2 failed, 0 skipped.

- *Funded*: `the fee card never read the sponsor as funded: data-sponsor-funding is null` (a 90 s
  wait), after the default read Nulo's sponsor and the form filled.
- *Unfunded*: `the fee card never read the sponsor as short: data-sponsor-funding is null`, after
  the salt-1 SponsoredFPC was registered through the playground, added in Settings, picked in the
  menu by `send-fee-method-sponsored` and its `data-fpc-id`, the form filled and `waitForFee`
  passed. The red is the missing verdict, not a missing selector.

On the branch, the same file on Chrome, prover on, retry 0: 2 of 2 passed in 142 s (the flake
bar's first Chrome run).

## Step 2 · Every local gate, from the root

The host's load average sat at 143 to 170 through these (192 cores).

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | 1905 files; 29 warnings, 3 infos; the complexity baseline matches |
| `bun run typecheck:all` | 0 | the 15 workspaces |
| `bun run test:all` | 1, then 0 | see below |
| `bun run test:ci-gating` | 0 | 244 pass, 2 skip, 0 fail: 246 tests in 17 files |
| `bun scripts/ci-cd/plans/check.ts` | 0 | 3 report-only path-token findings in files this branch leaves alone, 0 enforced |
| `bash scripts/check-no-local-paths.sh` | 0 | |
| `bun run build` | 0 | the popup HTML's 135 chunks hold no protocol Fee Juice artifact: that chunk is still the offscreen document's, as on `85c4d20f` |
| `bun run --cwd apps/extension build-storybook` | 0 | |

`test:all`'s first run failed one test: `src/presto/client.test.ts` "returns one PrestoClient per
module instance" timed out at 5 s (load 159). It is the cold dynamic import after
`vi.resetModules()` that `follow-ups.md` already lists, and the branch touches nothing under
`src/presto`. The rerun passed: extension 608 files passed and 3 skipped, 8094 tests passed, 4
skipped, 8 todo; aztec-runtime 255 passed, 2 skipped; passkey-rp 5 passed, 6 skipped; every other
workspace passed all its tests.

## Step 3 · Smoke on both browsers, three shards each

By the owner's instruction of 2026-09-29, each browser's full smoke run was split into three
parallel shards (`--shard=i/3`) at retry 0, after the plan's armed build
(`VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run build:<b>`,
exit 0 on both). Shard 1 loaded `dist/<b>`, shards 2 and 3 copies at `dist/smoke2-<b>` and
`dist/smoke3-<b>`, so no shard's path starts with another's (the smoke setup's `pkill` matches by
prefix). Each shard:
`EXTENSION_PATH=<its dist> NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e --retry=0 --shard=i/3`,
from `apps/extension`. A shard passes on exit 0, no failed test, and every test passed or skipped.

| Browser | Shard | Exit | Files | Tests | Passed | Skipped | Vitest time |
|---|---|---|---|---|---|---|---|
| Chrome | 1/3 | 0 | 20 | 52 | 50 | 2 | 618 s |
| Chrome | 2/3 | 0 | 15 | 45 | 41 | 4 | 349 s |
| Chrome | 3/3 | 0 | 22 | 67 | 66 | 1 | 262 s |
| Chrome | sum | | 57 | 164 | 157 | 7 | |
| Firefox | 1/3 | 0 | 20 | 52 | 51 | 1 | 653 s |
| Firefox | 2/3 | 0 | 15 | 45 | 41 | 4 | 354 s |
| Firefox | 3/3 | 0 | 22 | 67 | 61 | 6 | 470 s |
| Firefox | sum | | 57 | 164 | 153 | 11 | |

No failure on either browser. Every skip is the suite's own, declared in the test source: on both,
`store-captures` (needs `STORE_CAPTURES`), the three `_probe-console-capture` cases (a probe
flag), `appearance` "theme persists across navigation away and back" and `sw-resilience` "strict
mode OFF" (both `test.skip`); on Chrome only, `action-popup-layout`'s bottom-nav case
(Firefox-only); on Firefox only, the four `import-dead-rpc` cases (CDP Fetch, no BiDi equivalent)
and `sw-resilience` "an open popup outlives the kill" (Chrome-only).

## Step 4 · Network e2e

By the owner's instruction of 2026-09-29 (shard the runs for speed), the phase's five files ran in
one `e2e:agent` invocation per browser, one sandbox boot, instead of the plan's one file per run.
No `--shard`: one shard per browser. Retry 0; each report was removed before its run and checked
after it with `jq -e '.numTotalTests > 0 and .numPassedTests == .numTotalTests'`. Load average 140
to 250.

| Run | Exit | `jq -e` | Tests per file |
|---|---|---|---|
| Chrome, prover on, the five files, 916 s | 1 | false | fee-sponsor-funding 2/2, fee-methods 7/8, transfers 1/1, tx-sendTx-sponsoredFpc 1/1, send-picker 1/1 |
| Chrome, prover on, `fee-methods` alone, 525 s | 0 | true | fee-methods 8/8 |
| Firefox, proverless, the five files, 675 s | 1 | false | fee-sponsor-funding 2/2, fee-methods 7/8, transfers 1/1, tx-sendTx-sponsoredFpc 1/1, send-picker 1/1 |
| Firefox, proverless, `fee-methods` alone, 394 s | 0 | true | fee-methods 8/8 |

Every file passes the check on both browsers: four in the combined runs, `fee-methods` in the
reruns.

### The one failure, outside the branch: `fee-methods` "transfer with private Fee Juice"

Both combined runs failed the same case the same way: after 6.5 s on Chrome and 5.5 s on Firefox,
at `selectFeeMethod` (`fee-methods.test.ts:177`). The menu's private Fee Juice row was on screen
and clicked, but the trigger never read `private` within the helper's 2 s. A pick of that row wins
only once the PrivateFPC balance is read and is not "0" (`resolveSendSelection` and `isEligible`
in `fee-privacy.ts`); until then the trigger shows the walk's payer, and a balance read as "0" or
unknown disables the row. The test picks the row straight after filling the form, with no wait for
that read, a PXE utility call. Nothing on this branch touches that path: the private row, the
balance reads and `handleMethodPicked` for a non-sponsor pick are as on `85c4d20f`, and the probe
runs only for a `DefaultSponsoredFpc` payer, which no estimate in that test names. The file's
other cases passed in the same runs. Treated as a load flake and rerun before any triage: the file
alone passed 8 of 8 on each browser, the private case in 18 s on Chrome. Likely, read in the code
and not reproduced, the race is the test's own: a wait for the private balance before the pick
would close it, which is e2e-reliability work outside this plan.

## Step 5 · Flake bar: `fee-sponsor-funding`, three consecutive runs per browser

Each run its own `e2e:agent` invocation at retry 0 with the step 4 check, then `bun run e2e:reap`.
The Firefox runs used a second worktree of the same commit (`761b34c9`, its own
`bun install --frozen-lockfile`), so they ran beside the Chrome ones; each worktree ran one
network run at a time.

| Browser | Run | Exit | `jq -e` | Tests | Vitest time |
|---|---|---|---|---|---|
| Chrome, prover on | 1 | 0 | true | 2/2 | 142 s |
| Chrome, prover on | 2 | 0 | true | 2/2 | 154 s |
| Chrome, prover on | 3 | 0 | true | 2/2 | 146 s |
| Firefox, proverless | 1 | 0 | true | 2/2 | 167 s |
| Firefox, proverless | 2 | 0 | true | 2/2 | 175 s |
| Firefox, proverless | 3 | 0 | true | 2/2 | 156 s |

Three of three per browser. The file also passed in both combined runs of step 4, the Chrome one
between runs 1 and 2, so neither streak has a failure in it.

## Step 6 · `bun run e2e:reap`

After every network run, and in both worktrees at the end: exit 0, "nothing to reap" each time,
since each run's teardown had already stopped what it started.

## Gate ✓

Steps 1 to 6 as above on `761b34c9`: every command exits 0 or was a flake rerun to green (the
presto unit timeout, the `fee-methods` private pick); every network file passes the `jq -e` check
on both browsers, `fee-methods` in its reruns; the flake bar three of three per browser.

## After merging dev at `4387b112`

`keyboard-guards` landed on dev during the phase, adding `refuseRepeatEnter` beside
`isRepeatOrComposing` in `composables/usePopupEntity.ts`. The merge is a signed merge commit
(`f48189a3`). Its one conflict was `implementations-plan/index.md`, where both sides added a line
at the same place: dev's line stays first, this branch's follows. No other file changed on both
sides.

The token card keeps `isRepeatOrComposing`. The plan swaps that guard only for a replacement, and
keyboard-guards kept it: `refuseRepeatEnter` cancels the default action of a repeat or composing
Enter, so a focused native button does not activate. The card is a `role="button"` element with no
native activation: its own Enter and Space handlers act, both already `.prevent`. The new helper
would stop neither handler, and it does not cover Space.

Every local gate again, from the root, on `f48189a3`:

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | 1910 files; 29 warnings, 3 infos |
| `bun run typecheck:all` | 0 | |
| `bun run test:all` | 0 | extension 611 files passed, 3 skipped; 8115 tests passed, 4 skipped, 8 todo; aztec-runtime 255 passed, 2 skipped; passkey-rp 5 passed, 6 skipped; the rest all passed |
| `bun run test:ci-gating` | 0 | 244 pass, 2 skip, 0 fail: 246 tests in 17 files |
| `bun scripts/ci-cd/plans/check.ts` | 0 | the same 3 report-only findings, 0 enforced |
| `bash scripts/check-no-local-paths.sh` | 0 | |
| `bun run build` | 0 | |
| `bun run --cwd apps/extension build-storybook` | 0 | |

And the e2e of steps 3 and 4 again, on `819874ef` (the merge plus its record): smoke in three
shards per browser in this worktree, and beside it the five network files, one invocation per
browser, in the second worktree at the same commit. Retry 0, the same checks. Two comment-only
edits landed in the source while the Firefox smoke build ran; they change no behaviour.

| Run | Exit | Tests | Passed | Skipped | Failed |
|---|---|---|---|---|---|
| Smoke, Chrome, shards 1/3, 2/3, 3/3 (20, 15 and 23 files) | 0, 0, 0 | 52 + 38 + 76 = 166 | 159 | 7 | 0 |
| Smoke, Firefox, shards 1/3, 2/3, 3/3 (20, 15 and 23 files) | 0, 0, 0 | 52 + 38 + 76 = 166 | 155 | 11 | 0 |
| Network, Chrome, prover on, the five files, 293 s | 0 | 13 | 13 | 0 | 0 |
| Network, Firefox, proverless, the five files, 652 s | 0 | 13 | 13 | 0 | 0 |

Smoke has two more tests and one more file than in step 3: dev's `keyboard-guards.test.ts`. The
skips are step 3's, the same on each browser. Every network report passes the `jq -e` check,
`fee-methods` 8 of 8 on both browsers this time.


## The final gate, on `2a7e4632`

`2a7e4632` is the head after the codex fix (`38b8f796`) and the P5 record. Its source is the
same as `38b8f796`'s. The gates are the same ones that ran after the merge:

- every local gate, from the root, in this worktree;
- beside it, the five network files, one invocation per browser, in a second worktree at the same
  commit;
- then smoke here, in three shards per browser.

All runs used retry 0 and the same checks, while the host's load average sat between 120 and 190.

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | 1910 files; 29 warnings, 3 infos |
| `bun run typecheck:all` | 0 | |
| `bun run test:all` | 0 | extension 611 files passed, 3 skipped; 8116 tests passed, 4 skipped, 8 todo (one test more than after the merge: the rename case); aztec-runtime 255 passed, 2 skipped; passkey-rp 5 passed, 6 skipped; every other workspace passed with no skip |
| `bun run test:ci-gating` | 0 | 244 pass, 2 skip, 0 fail: 246 tests in 17 files |
| `bun scripts/ci-cd/plans/check.ts` | 0 | the same 3 report-only findings, 0 enforced |
| `bash scripts/check-no-local-paths.sh` | 0 | |
| `bun run build` | 0 | |
| `bun run --cwd apps/extension build-storybook` | 0 | |

| Run | Exit | Tests | Passed | Skipped | Failed |
|---|---|---|---|---|---|
| Smoke, Chrome, shards 1/3, 2/3, 3/3 (20, 15 and 23 files) | 0, 0, 0 | 52 + 38 + 76 = 166 | 159 | 7 | 0 |
| Smoke, Firefox, shards 1/3, 2/3, 3/3 (20, 15 and 23 files) | 0, 0, 0 | 52 + 38 + 76 = 166 | 155 | 11 | 0 |
| Network, Chrome, prover on, the five files, 760 s | 0 | 13 | 13 | 0 | 0 |
| Network, Firefox, proverless, the five files, 661 s | 0 | 13 | 13 | 0 | 0 |

- **Skips and checks.** The skips are the ones from step 3. Every network report passes the
  `jq -e` check.
- **The flake bar was not rerun.** It is step 5. `fee-sponsor-funding` ran once per browser in the
  network runs above, and once per browser after the merge. Two code changes have landed since
  the flake bar: dev's merge and `onFpcUpdated`. The second is out of that file's reach, because
  the file never renames or edits a sponsor.
- **Reaps.** Each reap found nothing to reap.
