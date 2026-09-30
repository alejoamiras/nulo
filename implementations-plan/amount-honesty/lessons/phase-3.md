# Phase 3 · Browser proof, the arc gate and the screenshots

## Round 1, at `f33327b8`

### Step 1 · The arc gate

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | 28 warnings, 3 infos (the base's own); complexity-baseline check OK |
| `bun run typecheck:all` | 0 | every workspace |
| `bun run test:all` | 0 | extension 627 files passed, 3 skipped; 8565 tests passed, 4 skipped, 8 todo. Every other workspace 0 failed |
| `bun run test:ci-gating` | 0 | 244 pass, 2 skip, 0 fail |
| `bun run build` | 0 | |

The known `useFullBackupImport.test.ts` flake did not fire, here or in round 2.

### Step 2 · Smoke

Chrome 43 files, 165 passed, 0 failed, 7 skipped; Firefox 43 files, 161 passed, 0 failed, 11 skipped
(the commands and the skips as in round 2).

### Step 3, attempt 1 · A real keystroke broke the typed comma

`NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent`
over the five files: exit 1; 5 files, 6 tests, 5 passed, 1 failed: `send-amount-exact` at its new
typed step, `the amount field reads "1,234", not "1.234"`.

Cause: the token input carried `v-model="model"` beside `@input="handleAmountInput"`, and
v-model's listener runs first. A browser performs a microtask checkpoint between two listeners of
a UA-dispatched event, so Vue flushed between them: the page took the raw "1,", re-rendered, and
the card's model watcher took the page's "1," for a page write and set `lastText` to it. The card's
handler then read "1," as its prior text, found nothing inserted, and kept the comma. Every jsdom
test dispatches from script, where no checkpoint runs between listeners, so all of P2's cases
passed while every real keystroke that needs its prior failed: a typed comma, the re-read, and the
rest's own commas (the rest "1,234" plus a typed "5" would have read 1.2345).

Fix (`1516b938`): the token input is bound one way (`:value="model"`); the card's handler is its
only input listener and hands the page its text once per edit. The USD field keeps its v-model:
nothing resyncs its prior text (`fiatLastText`), so the checkpoint only re-renders it early.

Red first: the page-bound test "a keystroke reaches the page only as the card's text, once, never
as the raw key" (`send-amount.test.ts`) failed on `f33327b8` with the page receiving
`"1", "1", "1,", "1.", …, "1.234.", "1234.", …` (exit 1, 1 failed); green after the fix. P2's
vitest gate after the fix: 6 files, 398 passed (exit 0); `bun run lint` exit 0 (28 warnings,
3 infos); `bun run typecheck:all` exit 0.

## Round 2, at `1516b938`: the gate

### Step 1

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | 28 warnings, 3 infos; complexity-baseline check OK |
| `bun run typecheck:all` | 0 | every workspace |
| `bun run test:all` | 0 | extension 627 files passed, 3 skipped; 8566 tests passed, 4 skipped, 8 todo. Every other workspace 0 failed |
| `bun run test:ci-gating` | 0 | 244 pass, 2 skip, 0 fail |
| `bun run build` | 0 | |

### Step 2 · Smoke, retry 0, three shards per browser

Per browser: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet
VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension
build:<b>` (exit 0), then three shards at once, each on its own copy of that build (`dist/<b>`,
`dist/smoke2`, `dist/smoke3`) and its own `EXTENSION_PATH`:
`NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e -- --shard=i/3 --retry=0`.

| Browser | Shard | Exit | Files | Passed | Failed | Skipped |
|---|---|---|---|---|---|---|
| Chrome | 1/3 | 0 | 15 | 52 | 0 | 2 |
| Chrome | 2/3 | 0 | 14 | 43 | 0 | 4 |
| Chrome | 3/3 | 0 | 14 | 70 | 0 | 1 |
| Chrome | sum | | 43 | 165 | 0 | 7 |
| Firefox | 1/3 | 0 | 15 | 53 | 0 | 1 |
| Firefox | 2/3 | 0 | 14 | 43 | 0 | 4 |
| Firefox | 3/3 | 0 | 14 | 65 | 0 | 6 |
| Firefox | sum | | 43 | 161 | 0 | 11 |

Every skip is the suite's own, none a network gate: the console probe (three,
`NULO_E2E_CONSOLE_PROBE`), the store captures (`STORE_CAPTURES`), two cases the base skips outright
(`appearance.test.ts:79`, `sw-resilience.test.ts:137`), the bottom-nav case on Chrome (Firefox only),
and on Firefox the Chrome-only cases (`import-dead-rpc.test.ts`'s four CDP Fetch cases,
`sw-resilience.test.ts:65`).

### Step 3 · Network, retry 0

The five files ran in one `e2e:agent` invocation per browser (the driver's instruction, in place of
one file per run), each browser in a detached worktree of `1516b938` with its own install, port
pack and build: `NULO_E2E_BROWSER=<b> NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first
bun run e2e:agent tests/e2e/network/{send-amount-exact,send-amount-clamp,fiat-send,transfers,incoming-transfers}.test.ts`,
Firefox with `NULO_E2E_PROVERLESS=1` (its build carried the proverless stamp; Chrome's did not).

| Browser | Exit | Files | Executed | Passed | Failed | Skipped |
|---|---|---|---|---|---|---|
| Chrome, prover on | 0 | 5 | 6 | 6 | 0 | 0 |
| Firefox, proverless | 0 | 5 | 6 | 6 | 0 | 0 |
| sum | | 10 | 12 | 12 | 0 | 0 |

Per file on each: `send-amount-exact` 1, `send-amount-clamp` 1, `fiat-send` 1, `transfers` 1,
`incoming-transfers` 2.

### Step 4 · Flake bar

`send-amount-exact`, three consecutive retry-0 runs per browser, each its own `e2e:agent` run:
Chrome 3 of 3 (exit 0, 1 passed, 0 skipped, each), Firefox 3 of 3 (the same).

### Step 5 · Native paste, once per browser

From the capture spec: "1.234,56" copied from a scratch text area with Control+C, then pasted into
`send-amount-input` with Control+V, both through the browser's own shortcut handling. The
`inputType` was read by a capture-phase listener the spec put on the field, in place of a temporary
`console.debug` in the card, so the card's code is the code under test.

| Browser | Events seen | `inputType` | Field after the paste | Model's reading (the line under the field) | Once left |
|---|---|---|---|---|---|
| Chrome | 1 | `insertFromPaste`, data "1.234,56" | "1.234,56" | "≈ $1,234.56" | "1,234.56" |
| Firefox | 1 | `insertFromPaste`, data "1.234,56" | "1.234,56" | "≈ $1,234.56" | "1,234.56" |

§ A2 stands as written: both browsers report the paste as `insertFrom*`.

### Step 6 · Reap

`bun run e2e:reap` after every run in its worktree (exit 0 each); in this worktree after the last
run: nothing to reap.

### Step 7 · One real dApp mint

Chrome, prover on: PHT deployed with the extension account as its minter (`deployMinterToken`),
fuel bridged to the PrivateFPC for the account (`bridgePrivateFuel`), the playground connected with
`transaction-contracts` and its phase contracts registered, then one `mint_to_private` of 10^18 sent
through the phase section on the `fpc-fuel` route and approved in the execute popup, as the
account's first transaction. The stored record (`nulo:core:txs@0x0e4c…d791`) holds three calls:
FeeJuice `claim` (4 arguments), PrivateFPC `mint_and_pay_fee` (3), PHT `mint_to_private` (2: the
recipient and `0x…0de0b6b3a7640000`, 10^18 as `0x` hex). § A1's shape rule and P1's fixture stand.

- PHT unlisted: the History row reads "Mint" with no figure; the transaction page has no amount.
- PHT added: the History row reads "1" and "PHT"; the transaction page "1 PHT", "Mint amount".
  That mint rode a fee payload, so the same two screens are row 4's.

Firefox, proverless, the same mint: the same record shape and the same four states.

### Step 8 · Screenshots

87 files, 29 states in Chrome light, Chrome dark and Firefox light, at 360 x 600, from a throwaway
capture spec run in a detached worktree and never committed. Their index, with the strings each
shows, sits beside them in the build's scratch directory, outside the repo. Row 6 has none: its
component test (P1 step 5) stands in.

Records written into storage serve only what a live run cannot make: the two-mint record (the live
record cloned with a second mint call), decimals 255 and the bidi symbol (patched token rows), and
the prompt's token, pending trust row and hidden receipt. The patched symbol was stored as
`55 53 202e 44 43 200b` and the row's text shows no character above U+007E but the title's "·".

The first Chrome run held the account at 1,000 TST, so every field state above 1,000 showed Confirm
off for the balance; the field group ran again at 101,000 TST.

The index marks row 15's held-paste line ("Is that 1234 or 1.234? Type the one you mean.", the
plan's copy) as a copy change for the blanket sign-off: the owner's O3 preview read "Type it without
the comma."

### Gate

Every command exited 0; every network run 0 failed and 0 skipped; the flake bar's six runs passed;
both native pastes recorded as `insertFromPaste`; the mint recorded as `mint_to_private` with two
arguments; every screenshot listed exists. Layers: typecheck, lint, unit, component, CI-gating,
build, smoke e2e, e2e-live-network, both browsers.
