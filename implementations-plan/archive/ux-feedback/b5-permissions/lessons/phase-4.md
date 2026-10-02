# Phase 4 · e2e for the consent

Built on `17d0d112` (P3 done, then the two sign-off records). No screen changes. The product code
gains one attribute on the connected-apps list, which renders nothing, and the generated component
declarations that P3 left stale.

Round-5 picks for item 6 signed off by the owner in chat, 2026-09-25: "Regarding 6: Recommended." (the picks store is unreadable from this account, so the chat answer is the record).

## What was built, per commit

| Commit | Step | What |
|---|---|---|
| `8b56a057` | P4.1 | Playground: the `transaction-listed` bundle (accounts with `canCreateAuthWit`; a transaction scope and `simulation.transactions` naming the token's `transfer_public_to_public`; the token as the one contract) and its `<option>`. Scoped bundles read `?tokenAddress=`, then the `tokenAddress` input, else `"0x0"`. |
| `67a39f25` | P4.2 | `data-app-host` on the connected-apps list's `RowTarget` (see Decisions). |
| `1b9b8f0b` | P4.2–P4.4 | Fixtures: `PgBundle` gains `transaction-listed`, `data` and `data-scopedEvents`; `requestPgBundle`; `approveCapabilities({ switches })` with `setCapabilitySwitch` and `readCapabilitySwitch`; `setConnectedAppAuthorizations`; `toggleOff` deleted; `readStoredCapability` in `fixtures/dappSession.ts`. `authwit-variants.test.ts` and `cap-request-partial.test.ts` rewritten. A row in the e2e README's helper table. |
| `992d7e29` | P4.5 | `data-privateEvents.test.ts` rewritten as two tests. `cap-request-partial` compares its answer and stored grant exactly. |
| `ba3ff0a1` | fix | `src/types/components.d.ts` regenerated with `PermissionRow` (see Failed attempts). |
| `8fb54c2c` | P4.3 | Playground: the call-intent button's selector and arguments (see Failed attempts). |
| `14c36a23` | P4.3 | The Settings helper checks that its route took and names the listed hosts on a miss. The spec lets the popup reach home first. |

## The base run of data-privateEvents

Run at `b6aa6e4d`, checked out detached in this worktree after every P4 change was committed. The
spec ran as an untracked copy with one added line that printed both results. Chrome, prover on,
retry 0: 1 passed, exit 0. The copy was deleted and the branch checked out again.

- `requestCapabilities`: `ok`. `granted` held `{ type: "data", addressBook: true, privateEvents:
  { contracts: "*" } }` and the `contracts` grant, since the old window ticks every card.
- `getPrivateEvents`: `status: "error"`, `errorJson: { message: "\"The wallet could not process
  the request.\"" }`. `pg-error-text` read the same.

**The stub event metadata is never reached.** `data` alone grants no account, so the playground
sends the token address as its event scope. `enforceScopeWithSession` refuses that at
`validateAccountScopes` (`scope-enforcement.ts:37-45`, reached through `opts.scopes` at `:97`)
before any event is read. A scratch script ran the real `enforceScopeWithSession` on the four
combinations:

| Private events | Session account | Refused by |
|---|---|---|
| On (`*`) | none (the playground today) | `getPrivateEvents.opts.scopes contains <token>, not in session's approved accounts` |
| Off | none | `getPrivateEvents targets contract <token>, not permitted by granted data.privateEvents scope` (`method-scope-checkers.ts:210-212`) |
| On (`*`) | the scope's account | nothing; both checks pass |
| Off | the scope's account | the private-events scope, as above |

Both refusals are bare `Error`s, which the envelope turns into `UNCLASSIFIED_ERROR_MESSAGE`
(`error-envelope.ts:177-199`). So the dApp sees the same text whether private events are granted
or not. Per P4.5's "otherwise" branch the spec asserts, for both states: the answer's `data`
entry and the stored `data` grant exactly, then the call's exact status and text, with no window.
The grant carries the switch's effect. The call does not show it (owner question 1 below).

## e2e runs

Every run used the program's commands at retry 0 (`NULO_E2E_RETRY=0`,
`NODE_OPTIONS=--dns-result-order=ipv4first`; Firefox also `NULO_E2E_PROVERLESS=1`). "The 8 files"
are the three P4 files (`authwit-variants`, `cap-request-partial`, `data-privateEvents`) and the
five touched specs (`cap-request-rerequest`, `cap-request-basic`, `data-addressBook`,
`data-registerSender`, `cap-widening`). The machine's load average read between 94 and 127
whenever it was checked.

| Run | Browser | At | Files | Result |
|---|---|---|---|---|
| 0 | Chrome, prover on | `b6aa6e4d` | the base probe above | 1 passed; exit 0 |
| 1 | Chrome, prover on | `992d7e29` | the 8 files | 8 passed, 3 failed, all in `authwit-variants`: every call intent got the unclassified error (the selector, below); exit 1; 227 s |
| 2 | Chrome, prover on | `8fb54c2c` | `authwit-variants` alone | 2 passed, 1 failed: the third test timed out on the connected-app row (start-up navigation, below); exit 1 |
| 3 | Chrome, prover on | `14c36a23` | `authwit-variants` alone | 3 passed; exit 0 |
| 4 | Firefox, proverless | `14c36a23` | the 8 files | 11 passed; exit 0; 285 s |
| 5 | Chrome, prover on | `14c36a23` | the 8 files | 11 passed; exit 0; 221 s |

Each run's Aztec node printed `Error: Address already in use (os error 98)` once while starting,
then reported ready and served the run on the pack's ports. No run failed on it, and the log does
not say which port it was. `bun run e2e:reap` afterwards found nothing to reap: every run's
teardown had stopped its own anvil, node and playground.

## Failed attempts and why

- **Every call intent failed, silent and confirmed alike** (run 1). The playground hashed
  `transfer_public_to_public((Field),(Field),Field,Field)`. The token's amount is a u128
  (`token_contract-Token.json`), so its selector is `0xc47adea0`, and the button's `0x0f963671`
  names no function. Before signing, the wallet binds a call intent to the function its selector
  names (`execution/service.ts:1009-1041`). It finds none, throws `Error("Method not found")`, and
  the dApp gets the unclassified error. The old spec accepted `error` for the call intent, so this
  was never seen. A scratch script proved it by computing both selectors against the artifact.
  Fixed in the playground (`8fb54c2c`): the u128 signature, and the call's four arguments (the
  acting account, the consumer, and the amount and nonce inputs). `args: []` was not the cause:
  the wallet parses an empty array and never compares the count.
- **The Settings step timed out on the connected-app row** (run 2). `openPopup` returns before
  the popup's own start-up navigation lands. When that lands after the helper's hash change, it
  takes the page back home. Other specs wait for `#/popup/general` first, and this one now does
  too (`14c36a23`).
- **The build regenerated `src/types/components.d.ts`.** The first e2e build added
  `PermissionRow`, which P3 did not commit. CI's build job fails on that diff
  (`_build-extension.yml:106-112`). P3's gate had no plain build in it.
- **A commit hung in signing.** It was rerun as `SSH_AUTH_SOCK= git commit …` and is signed.
- **The e2e tree has no typecheck gate.** An ad-hoc `tsc` over the touched e2e files shows only
  the harness-wide errors (the `inject` keys, the fixture context type, `storage.local.get(null)`),
  none in the new helpers or their call sites.

## Decisions

- **`data-app-host` on the list's row target.** The list shows only the app's name, and e2e
  selects by attribute, never by text. The testid table (`plan.md:814-831`) gives one app's row no
  handle, so this attribute is added. Its value is the host of the session's url, which the wallet
  takes from the discovery origin (`wallet-sdk/background.ts:961-964`).
- **The Settings helper reopens the app's page** after the switch settles, so the state it proves
  is read back from the session, not the switch's pending value.
- **`readStoredCapability` is shared** in `fixtures/dappSession.ts`. `cap-widening` keeps its own
  reader, which returns the whole row, untouched.
- **`data-privateEvents` uses a fresh session per state,** so the control connects with the row
  Off, as P4.5 says, rather than widening an earlier grant.
- **The expected text is the product constant** (`UNCLASSIFIED_ERROR_MESSAGE`), JSON-encoded as
  the SDK wraps it. Other e2e files import product constants the same way.
- **authwit-variants' third test carries three of P4.3's bullets:** switched On, the silent call
  intent; the inner hash that still asks; Settings Off, then the call intent that asks. One fresh
  browser instead of three.
- **The touched specs.** `cap-request-rerequest`, `cap-request-basic`, `data-addressBook` and
  `data-registerSender` use the `data` bundle, whose private-events row now starts Off, or read
  `data-cap-id` through `getCapItems`. `cap-widening` re-requests accounts, which puts the
  authorizations card under "Already granted" (A-31). No other spec selects the capability testids
  or passes `switches`, and no other spec asks for an authwit through `createAuthWit`.

## Plan text that proved wrong or ambiguous

1. **Owner question: P4.5's premise.** "The status the stub event metadata reaches" assumes the
   call reaches the metadata, and it does not (above). "Refused as a scope violation" is true
   inside the wallet, but the dApp sees the same unclassified text as in the granted case. So
   neither the call nor its control can show the switch; only the grant does. Two ways to make the
   call show it, both outside P4: grant an account and give the playground real event metadata
   (the old header's "productionizing"), or classify scope refusals in the envelope. The second is
   a product and privacy decision (`error-envelope.ts:177-190`).
2. **P4.3's "If `args: []` cannot sign".** Signing failed on the selector, not on the empty
   arguments. The button got valid arguments too, as the plan allows.
3. **`data-app-host`** is not in the testid table. It is added for the reason above.

## Gate

Run from the worktree root on `14c36a23`.

| Command | Exit | Notes |
|---|---|---|
| `bun run lint` | 0 | 29 warnings and 3 infos, all pre-existing (unchanged since P1). `complexity-baseline check OK` |
| The 8 files, Chrome, prover on, retry 0 | 0 | Run 5: 11 passed |
| The 8 files, Firefox, proverless, retry 0 | 0 | Run 4: 11 passed |
| `bun run typecheck:all` | 0 | Not in P4's gate; run because this phase touched a page and a generated declaration. 15 workspaces exited 0 |
