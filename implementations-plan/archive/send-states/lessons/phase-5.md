# Phase 5 · Captures and the owner's sign-off

## How the captures are taken

- **The spec.** A throwaway spec, never committed, runs through `e2e:agent`, proverless, at retry
  0. For each run it is copied into `apps/extension/tests/e2e/network/`, and removed afterwards.
- **The frames.** The popup is 360×600. The execute window is its own size: 400×600 on Chrome,
  400×767 on Firefox. Chrome runs in the dark theme, Firefox in the light one.
- **Where they live.** The PNGs and their `index.md` stay outside the repo, in the build's scratch
  directory.

- **The builds.** Today is dev at `4387b112`. Option (a) is this branch at `0fd09693`. O1 (b),
  O1 (c) and O2 (b) are three local capture-only branches off `0fd09693`. Each is one commit, and
  none is ever pushed or merged. Each ran in its own worktree of that commit, beside the others.
  - `capture/send-states-o1-b` (`3303abcc`): the sponsor stays selected with the warning "The
    sponsor can't cover this fee right now. The network will refuse this send." Confirm stays
    enabled.
  - `capture/send-states-o1-c` (`69bc0271`): the same warning, and the card hands on no fee
    settings. Send's Send and the execute window's Approve stay disabled until another method is
    picked.
  - `capture/send-states-o2-b` (`7e1bb412`): a warning banner above the form, "Couldn't load your
    tokens", with a Retry action. The token card goes inert and reads "No available tokens".
- **The states.** A hook wraps the replies of every port opened after it is installed in the
  background realm. On Chrome that is the service worker, through its CDP target. On Firefox it is
  the event page, through a sandbox over its window, because the page's CSP refuses `eval`. The
  hook can:
  - flip a real verdict on Nulo's sponsor to `funded: false`;
  - refuse the next `getTokens` or `getContacts`;
  - hold a `getTokens` reply, so a Retry stays on screen;
  - report the private balance as unknown.

  The verdict it flips is the one the branch's own probe read, so the notice in the picture is the
  one the code path draws. It read `funded: true` on every run.

## Runs

Every run was one `e2e:agent` invocation of the spec. Two or three ran at a time, while the host's
load average sat between 140 and 250 (430 at one peak).

| Run | Build | Outcome |
|---|---|---|
| 1 | (a) | Both tests red. `openSend` waits for the transfer-types card, which Send draws only once a token has loaded, so the failed-load page timed out at 10 s. The saved-pick test saw no notice, because the hook was set after the page had opened its ports |
| 2 | today, twice | Green: `o2-today-failed` and `o1-today-execute`. The second run's output replaced the first's, because the output directories had no per-run suffix yet. Their no-gas and saved-pick shots caught "You pay" still a skeleton |
| 3 | (a) | The saved-pick test green, with five captures (`o1-a-savedpick-*`, `blanket-row4-menu`, `blanket-row5`). The token-card test red waiting for the failed card before the Tab step: Home's own `getTokens` used up the one refusal, so Send's load never failed. That test's first three shots sat under the "Token added" snack, so run 5 retook them |
| 4 | today | Green: the no-gas and both saved-pick shots, each with the fee estimated |
| 5 | (a) | Seven captures: `o2-a-failed`, `blanket-row8-failed`, `blanket-row8-recovered`, `o2-a-focused`, `o2-a-retrying`, `o2-a-recovered`, `blanket-aggregate-failed`. Then red at the no-gas step: the active token was still PHT, which the account holds none of, so the amount field stayed disabled |
| 6 | O1 (b) | The saved-pick test green (`o1-b-savedpick-*`). The no-gas step red: no notice, because the verdict named a row id other than the spec's |
| 7 | (a), no-gas and execute only | Green: `o1-a-nogas`, `o1-a-menu`, `o1-a-execute` |
| 8 | O1 (c), first build `13ef4624` | Green, but the picture misstated (c). The build handed the execute window `null` for "no settings", and Approve's gate (`requiresFeeSelection`) tests `undefined`, so Confirm stayed enabled. Rebuilt as `69bc0271`, handing on `undefined`, and every (c) capture was retaken. Send's gate tests truthiness, so the Send pictures did not change |
| 9 | O1 (b), no-gas and execute only | Green: `o1-b-nogas`, `o1-b-execute` |
| 10 | O2 (b) | Green: `o2-b-failed` |
| 11 | O1 (c) `69bc0271` | Green: `o1-c-nogas`, `o1-c-execute` (Confirm disabled), `o1-c-savedpick-public`, `o1-c-savedpick-private` |
| 12 | (a), Firefox | Green: `o2-a-failed`, `o1-a-nogas`, `o1-a-execute`, the last at the window's Firefox size, 400×767. The Chrome-only steps skip there by design: the second token, the menu and the saved-pick test |

These are the fixes the spec needed. A later capture of Send can reuse them:

- On a page with no tokens, wait for the token card (`send-token-trigger`), not the types card.
- Arm the hook before the page opens its ports, and count a refusal only on a port opened after
  the hook was armed. Otherwise a page that is already open, such as Home, uses the refusal up.
- Wait for the snack from an earlier step to leave, and for "You pay" to show an amount rather
  than its skeleton.
- A profile holds one row of Nulo's sponsor for each chain it has seen, and every row has the same
  canonical address. The local network's row is the one with `chainId` 0, and it carried the
  verdicts: the other row here had chain id `1816023401`.
- Before a send that needs a balance, switch back to a token the account holds.
- A capture build of "no fee settings" must hand on `undefined`, because that is what the execute
  window's gate reads.

## Coverage of the capture list

All 32 captures exist and each was viewed. The `index.md` beside them quotes the strings each one
shows.

| Capture-list row | Files |
|---|---|
| O1, all four builds, Send with no gas | `o1-{today,a,b,c}-nogas-chrome-dark` |
| O1, all four, a saved pick, public origin | `o1-{today,a,b,c}-savedpick-public-chrome-dark` |
| O1, all four, a saved pick, private origin, plus (a)'s review sheet | `o1-{today,a,b,c}-savedpick-private-chrome-dark`, `o1-a-savedpick-private-sheet-chrome-dark` |
| O1, all four, the execute window | `o1-{today,a,b,c}-execute-chrome-dark` |
| O1 (a), the menu with the sponsor row disabled | `o1-a-menu-chrome-dark` |
| O1 (a) on Firefox | `o1-a-nogas-firefox-light`, `o1-a-execute-firefox-light` |
| Blanket, rows 4 and 5 and the aggregate error | `blanket-row4-menu-chrome-dark`, `blanket-row5-chrome-dark`, `blanket-aggregate-failed-chrome-dark` |
| O2, today, (a) and (b), the failed load | `o2-today-failed-chrome-dark`, `o2-a-failed-chrome-dark`, `o2-b-failed-chrome-dark` |
| O2 (a): focused, retrying, recovered | `o2-a-focused-chrome-dark`, `o2-a-retrying-chrome-dark`, `o2-a-recovered-chrome-dark` |
| O2 (a) on Firefox | `o2-a-failed-firefox-light` |
| Blanket, row 8 | `blanket-row8-failed-chrome-dark`, `blanket-row8-recovered-chrome-dark` |

These pictures show two things the owner should see:

- **(c) on Send reads "Fee estimated after simulation" where "You pay" was.** Once the card hands
  on no settings, Send drops its estimate. A real (c) build could keep the amount on screen.
- **The token card shows the browser's own focus ring.** It is a `role="button"` row with no focus
  style of its own. The ring is visible because nothing turns outlines off for that element, and
  it stays through the Retry and the recovery.

## Open

P5 stays open. Step 2, the owner's page, belongs to the driver. Step 3 waits for the owner's
answers to O1, O2 and the blanket sign-off. An answer other than (a) is a new phase: that option's
build, its tests, and P4's gates again.

## After the panel's decision of 2026-09-30 (delegated)

On 2026-09-29, while away, the owner delegated the open calls to a panel. `plan.md` § Decided
while the owner was away has the votes, the dissent and the declined edits. They are not the
owner's sign-off. One call changed code: the no-payer notice now ends at "The sponsor can't cover
this fee right now." (`99635341`).

### The copy change, red first

- **Red**, on `591973f6` with the tests edited and the component not yet: from `apps/extension`,
  `bun --bun vitest run src/popup/components/modules/send/FeeSettingsCard.test.ts
  src/popup/windows/execute/OperationCard.fee.test.ts` → exit 1. Two files failed, 6 of 122 tests,
  each expecting the new string and receiving the old one: four in `FeeSettingsCard.test.ts` (no
  gas of its own on a public origin; unchecked private gas with one notice; Nulo's sponsor chosen
  unasked; a hand-added sponsor picked) and two in `OperationCard.fee.test.ts` (the card
  withdrawing the sponsor; app fields shaped like a verdict).
- **Green** with the component edited: the same two files plus
  `src/popup/pages/send.integration.test.ts` → exit 0, 3 files, 161 tests passed. `bun run lint`
  → exit 0.
- **No e2e asserted the old string.** `network/fee-sponsor-funding` asserts the fallback notice
  ("…, so Sponsored pays it."), which did not change.

### The retaken captures

Ten frames on `99635341`, in their own folder beside the first set with its own `index.md`, in the
build's scratch directory. The first set was not rewritten or renamed: the owner's page shows it
as the options were offered.

| Frames | From |
|---|---|
| `o1-a-nogas` (Chrome dark, Firefox light), `o1-a-menu`, `blanket-row5` | the second pass |
| `o1-a-savedpick-public`, `o1-a-savedpick-private`, with `o1-a-savedpick-private-sheet` and `blanket-row4-menu` from the same test | the second pass |
| `o1-a-execute` (Chrome dark, Firefox light) | the first pass |

Both passes exited 0 with every test passed. On Firefox the saved-pick test skips by design, as in
run 12.

- **The recipient field is blurred before the shots.** The first pass's Send frames showed the
  field's suggestion list over the sticky page header: the spec left focus in the field, and the
  list sits above the header (z-index 999 against 10). The first set has the same artifact. The
  spec now blurs the field at the end of the form fill and waits for the blur, and the second pass
  retook every Send frame. The execute window has no recipient field, so its first-pass frames
  stand.
- **The saved-pick frames scroll the amount into view.** The spec scrolls Send's scroll container
  until the amount input sits just under the header, so "TRANSACTION AMOUNT" shows above the fee
  card. In the first set it was scrolled under the header.
- **Every frame was viewed.** Each shows "The sponsor can't cover this fee right now." where the
  first set showed the old string, and the saved-pick frames show the unchanged fallback.

### Note D is not pictured

The note: on a profile or network with no tokens, the first token added becomes the active one.
Showing the change needs Send held open while the profile or network switches to one with no
tokens, and then a token added from elsewhere, such as a dApp's `registerToken` or the import page
in a second tab. The capture spec drives one page, and the sandbox has only one live network, so
that setup is not cheap. An empty mount would show the base's behaviour, since the base already
makes the first added token active there. `send.test.ts` pins the change ("a switch to an identity
with no tokens: a token added becomes the active token").

## The final gate after the panel, on `1284f741`

`1284f741` is the head after the copy change (`99635341`) and the plan's close. The gates are the
ones that ran on `2a7e4632` (`lessons/phase-4.md` § The final gate):

- every local gate, from the root, in this worktree;
- beside it, the five network files, one invocation per browser, in a second worktree at the same
  commit;
- then smoke here, in three shards per browser.

Every run used retry 0, while the host's load average sat between 114 and 144.

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | 1910 files; 29 warnings, 3 infos |
| `bun run typecheck:all` | 0 | |
| `bun run test:all` | 0 | extension 611 files passed, 3 skipped; 8116 tests passed, 4 skipped, 8 todo; aztec-runtime 255 passed, 2 skipped; passkey-rp 5 passed, 6 skipped; every other workspace passed with no skip |
| `bun run test:ci-gating` | 0 | 244 pass, 2 skip, 0 fail: 246 tests in 17 files |
| `bun scripts/ci-cd/plans/check.ts` | 0 | the same 3 report-only findings, 0 enforced |
| `bash scripts/check-no-local-paths.sh` | 0 | |
| `bun run build` | 0 | |
| `bun run --cwd apps/extension build-storybook` | 0 | |

| Run | Exit | Tests | Passed | Skipped | Failed |
|---|---|---|---|---|---|
| Smoke, Chrome, shards 1/3, 2/3, 3/3 (20, 15 and 23 files) | 0, 0, 0 | 52 + 38 + 76 = 166 | 159 | 7 | 0 |
| Smoke, Firefox, shards 1/3, 2/3, 3/3 (20, 15 and 23 files) | 0, 0, 0 | 52 + 38 + 76 = 166 | 155 | 11 | 0 |
| Network, Chrome, prover on, the five files, 724 s | 0 | 13 | 13 | 0 | 0 |
| Network, Firefox, proverless, the five files, 570 s | 0 | 13 | 13 | 0 | 0 |

- **The five network files** are `fee-sponsor-funding`, which asserts the sponsor states,
  `fee-methods`, `transfers`, `tx-sendTx-sponsoredFpc` and `send-picker`. Every report passes the
  `jq -e` check, and `fee-methods` passed 8 of 8 on both browsers.
- **Skips.** The same ones as on `2a7e4632`, each declared by the suite.
- **Counts.** The same as on `2a7e4632`: the copy change edits assertions, not cases.
- **Reaps.** Each found nothing to reap.
- The commits after `1284f741` touch only `implementations-plan/`. The plans gate, lint and
  `test:ci-gating` ran again on each of them.
