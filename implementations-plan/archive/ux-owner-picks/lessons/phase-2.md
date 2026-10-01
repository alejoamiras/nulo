# Phase 2 · One token lookup (D2)

## Red first

Step 1's cases ran on the unfixed code (`activity.test.ts`, `received-display.test.ts`, 16 tests):
7 red, 9 green.

- Cold open (network unset at mount, then set): `expected { title: 'Token', …(2) } to deeply
  equal { Object (title, amount, ...) }`.
- Network switch: `expected last "vi.fn()" call to have been called with [ 'p1', 2 ]`: History
  never re-read its tokens.
- Journal read rejecting at mount: the row read "Token", the token read never ran.
- Builder, known token and no token: `expected { tokenSymbol: 'Token', …(5) } to match object`;
  the two `tokenForReceipt` cases: `TypeError: tokenForReceipt is not a function`.

Found while building step 3, pinned red afterwards:

- Chain id 0 (`activity.test.ts`, the local network): with History's old guard put back,
  `expected vi.fn() to be called with arguments: ['p1', +0]`.
- Parity pin (`incoming-row-parity.test.ts`), each page probed from a scratch copy: History
  building its own row read `TST` instead of the sentinel, Home read `Token`.
- `TransactionsList.test.ts`'s `tokens` case on dev's list and builder: the terminal transfer row
  read no symbol and no amount.
- `useScopedTokens`: without the guard at the top of `reload()`, a reload after `dispose()` read
  again (`expected "vi.fn()" to be called 1 times, but got 2 times`), which on a disconnected
  client opens its port again.

## Finding: History never loaded tokens on the local network

`activity.vue`'s token load returned early on `!appStore.network?.chainId`, and the local
network's chain id is 0 (`CHAIN_IDS.SANDBOX`). So on the chain the network e2e uses, History never
named a received row's token, whatever the timing. The composable's scope tests the network
object, as Home did. This is a likely trigger for batch 4's capture (I1) if that capture ran on
the local network, which was not recorded (inference, moderate confidence).

## C7, built without the held identity reply

Built: after case 1 in `network/incoming-public-transfers.test.ts`, while History shows the
receipt, `expect.poll` reads the pub→pub row's `activity-title` and `activity-amount` until they
are `TST` and `+10` (60 s budget). The two testids are additive on `TransactionCardLayout.vue`.

Not built: holding the first identity reply. Three reasons:

1. Firefox runs no preload script in extension documents (`fixtures/browser/firefox.ts`, the
   `openScratchPage` note), so a test cannot hold a reply inside the popup on both browsers
   without a product hook, which the plan forbids.
2. A cold reload of `#/popup/activity` never mounts History cold: with `isSessionChecked` false the
   auth gate routes to `popup-auth` (`popup/auth-guard.ts`, `popup/route-guard.ts`), and the boot
   then advances to Home (`popup/should-advance-to-general.ts`). History mounts only once
   `isLogined` is set, after the bootstrap has set the network. Read from the code, not run.
3. The chain-id-0 guard makes `dev` red on this chain every run, so the block is deterministic
   without a hold.

The cold-open, network-switch and journal-rejection paths stay pinned by `activity.test.ts`.

Red on `dev`: the six P1 and P2 product files swapped for `origin/dev`'s (testids and the e2e
block kept), Chrome, retry 0, three runs, each red at the History assertion:

| Run | Exit | Report | Seconds |
|---|---|---|---|
| 1 | 1 | 1 test, 0 passed, 1 failed | 222 |
| 2 | 1 | 1 test, 0 passed, 1 failed | 241 |
| 3 | 1 | 1 test, 0 passed, 1 failed | 228 |

Each: `expected { title: 'Token', amount: '+10,000,0' } to deeply equal { title: 'TST', amount:
'+10' }`. The files were restored from scratch copies after run 3's build; `git diff` against the
P2 commit was empty.

## Gotchas

- A page-evaluated function runs under the extension page's CSP, so it cannot call
  `new Function`. Pass a plain module-level function to `page.evaluate` and poll it with
  `expect.poll`, which reports the last value it read.
- History's scope tested `chainId` for truthiness; chain id 0 is a real chain.
- The local node logs `Address already in use (os error 98)` at start on every run here and then
  serves normally; not caused by this change.

## Gate

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | 29 warnings, 3 infos, all pre-existing |
| `bun run typecheck:all` | 0 | |
| `bun --bun vitest run` the seven P2 files (from `apps/extension`) | 0 | 7 files, 68 passed |
| `bun run test:all` | 0 | extension 7829 passed, 4 skipped, 8 todo; every workspace exit 0 |
| `incoming-public-transfers`, Chrome, prover on, retry 0 | 0 | 1 test, 1 passed, 0 failed, 0 skipped (252 s) |
| `incoming-public-transfers`, Firefox, proverless, retry 0 | 0 | 1 test, 1 passed, 0 failed, 0 skipped (207 s) |

Each e2e run removed its report first and passed
`jq -e '.numTotalTests > 0 and .numPassedTests == .numTotalTests'` on it
(`apps/extension/.e2e-state/report-incoming-public-transfers-<browser>-p2-1.json`), on the P2
commit's product code; `bun run e2e:reap` after each. P5's flake bar reruns this file three times
per browser.
