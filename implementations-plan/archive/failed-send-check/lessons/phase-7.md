# Phase 7 · The panel's edits

`LESSONS_FILE=implementations-plan/failed-send-check/lessons/phase-7.md`

## Merge

`3e92530c` is a signed merge of `dev` at `4387b112` (#720). Its one conflict was
`implementations-plan/index.md`, where dev added the keyboard-guards line beside this plan's; both
stay, dev's first. The generated `src/types/auto-imports.d.ts` and `.eslintrc-auto-import.json`
merged cleanly.

## Red first

A `git archive` of `3e92530c` with its own `bun install --frozen-lockfile`, with only the phase's
new and updated tests copied in, and the Ended row's `data-testid` added to the base's page so the
Ended assertion cannot pass on a missing element. `bun --bun vitest run` over
`journal-state.test.ts`, `transfer-failure-copy.test.ts`, `popup/pages/journal/[id].test.ts` and
`execution/service.composition.test.ts`: **10 failed, 120 passed**; 3 files failed, 1 passed;
exit 1.

| File | Failed | What the base does |
|---|---|---|
| `journal-state.test.ts` | 6 | a reverted send's context ends "The fee was charged." (transfer, dApp); an unconfirmed send's visual state is `interrupted`, and its context promises 30 minutes and points at the balance and Activity (transfer, dApp); a row stopped before sending reads "Interrupted mid-flight" (`sw_restart_post_prove`, `stale_on_resume`) |
| `transfer-failure-copy.test.ts` | 2 | the status-unknown snack says "Check Activity before sending it again." (a record with no recorded stage, no record) |
| `popup/pages/journal/[id].test.ts` | 2 | the Ended row shows while State reads "Checking"; an unconfirmed page reads State "Interrupted" |
| `execution/service.composition.test.ts` | 0 | passes on arrival: the refusal case pins today's behaviour (below) |

The first attempt also printed two unhandled rejections (`state.journal.onOperationAdded` was
undefined): the app store opens its own journal client from the same mocked module, for the
in-flight rows. The mock gained the methods the store calls; the red above is the rerun, with none.

## Green

- The four files plus `components/composite/activity`, `popup/pages/journal`, `send-submit.test.ts`
  and `send.test.ts`: 11 files, 314 passed, exit 1 on the same two rejections (that run preceded
  the mock's fix). The page test after the fix: 2 passed, exit 0. `test:all` at `4db69ddb`
  (below) reports no unhandled error.

## What the Unconfirmed sentence can promise

A row with no recorded endpoint is answered at its first read (`send-check.ts`:
`last = watch.url === undefined || now - terminalAt >= window`), so "Unconfirmed" can arrive
seconds after the failure. Only a network record without a primary endpoint writes such a row, but
while that path exists the context cannot say "within 30 minutes", so it goes.

## A node's refusal at the send line

Checked at the coordinator's ask, against `@aztec/foundation` 5.2.0 and `@aztec/stdlib` 5.2.0:

- `json-rpc/server/safe_json_rpc_server.js`: the client posts a batch, and the server answers it
  with HTTP 200 and an array; a call whose handler throws carries
  `{ error: { code: -32702, message } }` in its slot.
- `json-rpc/client/safe_json_rpc_client.js` resolves each slot, and `request` throws an error slot
  as `new Error(message, { cause })`. A transport failure resolves every slot as code -32000.
- `json-rpc/client/fetch.js`: `makeFetch([1, 2, 3], false)`, the node client's default
  (`interfaces/aztec-node.js`), wraps only the POST in `retry`, 1, 2 and 3 s apart, and a 4xx is a
  `NoRetryError`. The wallet's `makeFetchWithTimeout` (`packages/aztec-runtime/src/utils/fetch.ts`)
  matches it with a per-attempt timeout. A refusal arrives inside a successful POST, so nothing
  retries it.
- The node refuses with `Invalid tx: <reason>` ("Insufficient fee payer balance", "Insufficient
  fee per gas"; `ux-owner-picks/lessons/phase-4.md`).

The same retry is why the check reads through a one-attempt client: through the retrying one, a
lock, a switch, a deletion or `stop()` during a failing read still let the later attempts send the
hash (`lessons/phase-5.md`, review finding 1).

So a refusal reaches `sendTxTask` as a thrown error after the `submitting` write: the row fails
from `submitting` with its hash and endpoint, reads "Not confirmed yet", and ends "Unconfirmed"
after the 30-minute window, since the node never holds the hash and DROPPED is never an answer.
`execution/service.composition.test.ts` pins the first half with the error shaped as the client
throws it; the watcher tests already cover the window. Not fixed here: a POST retried after a lost
answer can come back refused for a send the node took, so a refusal alone does not prove "not
sent", and the plan kept that line (Trade-offs, Ask C8). F-8.

## The overlap with `fix/dapp-grants`

Read at `64d7c881`. Its `scope_refused` kind fails a row from `queued` (`failQueuedIfUnclaimed`),
so on this branch `wasNeverSent` holds: the row keeps its failed card, the card's subtitle comes
from the kind, and `nothingSentLabel` has no arm for it, so the page label falls through to
`kindLabel`, where #722 adds "Not allowed". The two touch `kindLabel` beside each other, so the
second to merge resolves a textual conflict there. Codex round 3 traced the same path.

## The status-unknown picture

Not capture timing. The capture log reads the awaiting card's cancel present when the snack shows
and again 15 s later, and both pictures show the snack's top edge over its lower half. An error
snack stays until closed, and the card is the reported send's until the restarted background reaps
its row (over 60 s with only the old popup page open, 3 s once a new page opened:
`lessons/phase-6.md`). Any Home error snack covers the row above the tab bar the same way.
Reported, not fixed (F-10).

## Pictures

Option (a), Chrome, from `4db69ddb`: the not-confirmed card, page and snack and the sent card and
page in both themes; the seeded nothing-sent, reverted, unconfirmed and interrupted cards and pages;
B2 before and after; the status-unknown snack at once and 15 s later. 22 pictures, each read back:
State "Unconfirmed" with no Outcome row on the unconfirmed page, no Ended row on either
not-confirmed page and on B2 before, the Ended row back on the sent pages and on B2 after, and every
changed string as § P6 has it. Kept with the capture spec in the build's scratch directory, not
committed.

## Gates at `4db69ddb`

Host load average 150 to 450 on 192 cores throughout; the peak came during the Firefox smoke.

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | 1913 files; 29 warnings, 3 infos (the base's); complexity baseline OK |
| `bun run typecheck:all` | 0 | every workspace |
| `bun run test:all` | 0 | extension 613 files passed, 3 skipped; 8145 tests passed, 4 skipped, 8 todo. aztec-runtime 35 files passed, 1 skipped; 252 passed, 2 skipped. wallet-bridge 481; wallet-core 247; extension-messaging 239; wallet-crypto 120; design 402; third-party-notices 66; legal 54; landing 40; resolve-asset 14; wallet-sdk-schema-patch 11; passkey-rp 5 passed, 6 skipped. Beside P5's final gate, the merge brought #720's three test files and its design case (401 → 402), and this phase adds three cases, two of them in the new page test file; the skips and todos are the base's |
| `bun run test:ci-gating` | 0 | 244 passed, 2 skipped, 0 failed, 17 files |
| `bun run build` | 0 | built |
| `bun scripts/ci-cd/plans/check.ts` | 0 | 0 enforced; the same 3 report-only path tokens |

### Network, proverless

`failed-send-check` and `snack-placement` in one `e2e:agent` invocation per browser, retry 0, each
in a `git archive` of `4db69ddb` with its own `bun install --frozen-lockfile`.

| Browser | Tests | Samples, last past `terminalAt` | `failed-send-check` | Duration | Exit |
|---|---|---|---|---|---|
| Chrome | 4 passed, 0 skipped | 29, 150 s | 194.26 s | 416.67 s | 0 |
| Firefox | 4 passed, 0 skipped | 29, 150 s | 203.12 s | 434.00 s | 0 |

Every sample also read no Ended row; after the restart and the unlock each page read State
"Unconfirmed", the new context, and the Ended row again. One sample fewer than at P5: the loop
stops at the first sample 150 s past `terminalAt`, so the count moves with each sample's timing.

### `transfers` on Firefox, prover on, no Presto

In the Firefox network tree, after its network run.

| Public → public `terminalAt - createdAt` | Tests | Duration | Exit |
|---|---|---|---|
| 110 104 ms | 1 passed, 0 skipped | 580.69 s (the test 499.52 s) | 0 |

Nothing listened on 59833 before or after. The run counts: past the old 60 s deadline.

### Smoke, sharded in three per browser

Each shard on its own copy of the migration-fixture build (`dist/chrome`, `dist/smoke2`,
`dist/smoke3`; `dist/firefox`, `dist/fxsmoke2`, `dist/fxsmoke3`), `NULO_E2E_MIGRATION_FIXTURE=1`,
`--retry=0`. Chrome in this worktree, then Firefox in a `git archive` of `4db69ddb`; no network run
shared either tree. The merge added `keyboard-guards.test.ts` (2 tests), so each sum is one file
and two tests above P5's, and the shards split the files differently.

| Browser | Shard | Files | Tests | Duration | Exit |
|---|---|---|---|---|---|
| Chrome | 1/3 | 12 passed, 2 skipped (14) | 50 passed, 2 skipped (52) | 268.99 s | 0 |
| Chrome | 2/3 | 13 passed, 1 skipped (14) | 34 passed, 4 skipped (38) | 307.81 s | 0 |
| Chrome | 3/3 | 14 passed (14) | 75 passed, 1 skipped (76) | 696.93 s | 0 |
| Chrome | sum | 39 passed, 3 skipped (42) | 159 passed, 7 skipped (166) | | |
| Firefox | 1/3 | 13 passed, 1 skipped (14) | 51 passed, 1 skipped (52) | 401.79 s | 0 |
| Firefox | 2/3 | 13 passed, 1 skipped (14) | 34 passed, 4 skipped (38) | 540.45 s | 0 |
| Firefox | 3/3 | 14 passed (14) | 70 passed, 6 skipped (76) | 866.28 s | 0 |
| Firefox | sum | 40 passed, 2 skipped (42) | 155 passed, 11 skipped (166) | | |

The skips are the base's, as at P5.
