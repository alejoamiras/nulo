# Phase 9 — The matrix

Every "B" cell of plan § Matrix is a named test in `apps/tools/tests/browser/specs/`, one file per
family, each file with its own actor pool (`test.use({ cells, l1Index })`). Every cell states its
payer and reads its postconditions from the chain through the harness.

| Family | Cells | Notes |
|---|---|---|
| `deposit-token` | 1, 2, 3, 4, 5, 6 | credit-paid claims assert the exact wallet-priced ceiling; 3 pastes a fresh token and sends twice (the second cheaper) |
| `fee-states` | 7, 8, 9, 10, 11, 12 | the token-only card's reason is read through its `aria-describedby` (the in-sight line only shows while the token is chosen); 12 fails the confirm's re-read through the test wallet's `failNext` |
| `deposit-token-gas` | 13, 13b, 14, 15, 15b, 16, 17 | 13/13b/14 assert conservation `after = before + received − fee` from the journal's figures and the node's receipt |
| `deposit-gas-only` | 18, 18b, 19, 20, 20b, 21 | the fee asset and WETH are pasted (not in the catalog); conservation exact on the public cells |
| `tokens` | 22, 23, 34, 37 | 22 pastes NORT; the community list is the egress fixture's |
| `recovery` | 24a (pending branch), 25 | see below |
| `l1-wallet` | 26 | rejection, account change, wrong chain — the shim counts signatures |
| `exits` | 27, 28, 29, 30, 31 | 30 triples the node's predicted fees under the wallet between review and confirm; 31 flips both switches and restores them in `finally` |
| `drip` | 35, 36, 38 | |
| `activity` | 39 | a real download → `localStorage.clear()` → restore under one signature; a backgrounded send's strip and completion toast |
| `spike` | 40 + discovery / grant / panel | kept as the connection file |

## Not staged, and why

- **24a's dropped branch and 24b's consumed branch.** A claim transaction that the node drops, or
  one included with its app phase reverted (fuel consumed, token unclaimed), cannot be produced from
  outside the wallet on the automine network without changing the contracts under test. The pending
  branch (reload after the Ethereum leg, before the claim) is the branch a user actually hits.
- **25's "grant for a left selection discarded"** needs a prompt that stays open while the user
  moves on; the test wallet answers prompts synchronously. The declined half is covered.

## What the matrix found

- **Cell 26 — a refused Ethereum signature stranded the wizard (product gap, fixed).** A public
  token deposit re-keys its journal row onto the claim hash and narrates "signing" BEFORE the
  witness signature; the takeover had already moved the wizard to the stepper. The refusal
  (`4001`) threw out of `executeSend`, whose catch discarded only PROVISIONAL rows, so the named row
  stayed, the stepper sat on AUTHORIZE with no retry and no way back, and `sendFlow.error` held
  "Rejected in wallet." where nothing rendered it. The page snapshot at the failure was the proof.
  Consult (codex, `high`, one round, plan § Autonomy): agreed the public fix; found the private
  seal's signature sat OUTSIDE the catch (`openSendRecord` moved inside); asked that the "any
  other failure is flagged" claim be bounded (flag only when no lane has set an attention yet, and
  never let the bookkeeping mask the failure); tightened the wizard's vanish guard to re-adopt only
  the row OURS was renamed into (`canonicalRecordId`); accepted deleting the row on refusal (the
  Permit2 allowance stands, as for any Permit2 user — the deposit-flow comment now says so).
  `settleFailedSend` in `useSend.ts` is the result; two unit cases pin it.
- **Cell 34 — the community list never showed.** The egress fence served the fixture, but the
  loader's schema requires a top-level `name` the fixture lacked; `loadTokenList` never rejects, so
  it fell back to an empty list with no error. The fixture carries a name now.
- **Cell 37 — the mint strip lives on the token step**, not the amount step; the cell reads the
  tile's balance before and after the mint, then confirms the amount step shows it.
- **Cell 22** failed only on the wizard's private default (the spec now sets the visibility, like
  every other cell); the stand-down it hit was the credit gate landing under a private ceiling.
- **Cell 39's export moved to the stepper.** A finished card offers Clear, not a recovery file —
  the export is for a bridge in flight — so the cell exports from the stepper's BACKUP once the
  journal holds the deposit's hash (the row is named by then), then finishes, clears and restores.
  An "injected" provider is never cached as deterministic, so every export costs two signatures.
- **The picker can miss a wallet on a page that connects right after load.** Discovery probes
  each frame once; a frame that posts READY after the probe left it is absent from that scan. The
  page object cancels and reopens the picker (up to three scans) instead of a longer wait.
- **After a reload the remembered wallet reconnects to `verifying`**, where the panel's own
  button reads "Verify in wallet" and opens the emoji check; the recovery cells drive that state
  rather than a fresh connect.
- **The node client namespaces its methods (`aztec_getPredictedMinFees`) and batches JSON-RPC
  into arrays** — a route matching `node_…` on a single object body never fires; cell 30 patches
  the batch by request id.
- **An exit's review has no visibility line** (that line is the deposit's); `reviewExit` asserts
  the burn note. **A token the wallet reports registered loses its add-to-wallet button**, so cell
  36 asserts the button is gone. **The generation's own tokens are granted at connect**, so cell
  25's declined grant needs a fresh (routable) token pasted in.
- **The first held-gas read can race the wallet's contract registration** on a plain profile
  ("No artifact registered for contract class …" → fail-closed `null`); later reads succeed. It
  never decided a cell, but it is the first place to look if a token-only card is greyed as
  unverifiable on a fresh profile.

## Arc-3 codex loop

**Round 1** (GPT-6 Astra, `high`, the whole arc-3 diff + plan + lessons + the adversarial ask) — verdict **"Not ready for PR"**, 13 findings. Verified against the code, all adopted:

| # | Finding | Call |
|---|---|---|
| 1 | `verify-build-target <target>` without `--dist` excluded its own positional (`args[-1 + 1]`) | real → only the value after `--dist` is not the target |
| 2 | the fee probe asked the wallet with NO cap, so a cap-honoring wallet (Nulo) answered with its padded default and the app then bound it to 1.5× — worse than the 1× it had | real → the probe PROPOSES the app's cap (the node's worst prediction, both spellings); Nulo answers with it, a stock wallet with what it will really submit under; `wallet-fee-budget.test.ts` pins both policies |
| 3 | worker fixtures keyed only on `{cells, l1Index}` — two files with equal values share a worker and exhaust one pool | real → every spec names itself in `family`, a worker option the pool refuses to run without |
| 4 | `useGasShare.invalidate()` could adopt an outstanding read's result; a probe in flight across `forgetWalletFees()` repopulated the cache | real → generation/epoch counters on both |
| 5 | the deployment-identity check whitelisted the root keys recursively, emptying every nested object | real → deep key-sorted canonical form |
| 6 | the browser ports were bind-tested, never claimed in the host registry; the sandbox's allocator ignored the registry | real → `registerHostPorts`/`releaseHostPorts` (bridge-core), the resolver claims under the run id and the reaper releases; `reservePort` skips registered ports |
| 7 | a `sandbox.pid` left after a normal teardown lets a later `reap` kill a recycled pgid | real → the file is removed after the stop; the reaper checks the group leader is `sandbox:up` |
| 8 | cell 22 derived its token from a half-shaped block and skipped the assertion on failure | real → the record's own read-back block; exact token gain and exact credit deduction |
| 9 | weak postconditions (`≥ 0n`, `> 0n`, first-time cells without token gains) | real → exact private balances and both L1 releases (28), `credit = fuel − ceiling` (15, 15b, 16, 19), exact token gains (3) |
| 10 | "nothing authorized" read from Ethereum signatures only | real → the test wallet counts calls per method; `nothingSubmitted` asserts no `createAuthWit`/`sendTx` (29, 30, 31) |
| 11 | 24a's reload raced the claim's submission; the claim click was swallowed | real → the claim's `sendTx` is refused once (`failNext`) so the interruption is deterministic; the reloaded page's wallet must send it |
| 12 | cells 20/21 lacked private variants; 24b and 25's second half claimed in the matrix | real → 20p/21p added (credit = fuel − the fuel claim's ceiling, `PRIVATE_FUEL_CLAIM_GAS` now a bridge-core constant); matrix rows 24b/25 say what is staged |
| 13 | the aggregator read an empty filter verdict as "skipped" | real → `scripts/ci-cd/aggregate-status.sh` with a truth-table test; an empty verdict is an error |

**Round 2** (same session, `high`, on the round-1 fixes) — verdict **"Not ready for PR"**, 6 findings, all verified and adopted:

| # | Finding | Call |
|---|---|---|
| 1 | 24a refused the claim's SEND, but the attempt latches before the send: a latched attempt with no hash is an outcome the journal waits on, never retries — the cell could not recover | real → the test wallet gains `holdNext` (a call that never answers); the cell holds the claim's first simulation against the hub (its arrival gate, before any latch), asserts no `sendTx` left that page, and the reloaded page's wallet sends the claim |
| 2 | the standalone fuel claims emitted only `maxFeesPerGas`, so a wallet reading the schema's singular spelling got no cap at submission | real → both spellings in both builders |
| 3 | the browser ports were registered without a conflict check, after the bind test; the sandbox's rows were appended blind; a missing registry (CI) meant no claims at all | real → `withRegistry` creates the registry (with its header) and throws when the lock never frees; `registerHostPorts` checks conflicts under the lock and throws `PortClaimConflict`; both allocators skip registered ports and pick again on a conflict |
| 4 | an attached run deleted the keeper's `sandbox.pid`; the standalone reaper never released a run's browser ports | real → only the run that booted the sandbox removes the file; the reaper releases the state dir's claims |
| 5 | quotes keyed by address alone: the same address reconnected through another wallet reused the first wallet's policy | real → quotes live in a `WeakMap` keyed by the wallet object, each stamped with the epoch of its forget; pinned by a two-wallets-one-address test |
| 6 | cells 4 and 16 proved hashes and fees but not that the recipient got the token | real → exact private balance gains from the record's read-back block (10 USDC; the record's token amount) |

**Round 3** (same session, `high`, on the round-2 fixes) — verdict **"Not ready for PR"**, 2 findings, both adopted: the registry was created before its lock was taken (two first runs could both create it — now created under the lock); the reaper released a run's browser ports by the state directory's name, which a hand-chosen `NULO_E2E_STATE_DIR` breaks (`ports.json` now records its owner and `--release` reads it). Confirmed sound: the hold (the SDK's iframe transport has no per-request timeout and keeps answering heartbeats, so the page-side simulation stays pending and the gate never reaches its send); the wallet-keyed cache; both cap spellings; the private-gain assertions. Noted for the record: the hold is right for a REGISTERED token's claim; an unregistered token's send substitutes a fee-only simulation (`useSend.ts`), so the pattern must stay on a registered-token cell.

**Round 4** (same session, `high`, on `37c2babe`) — verdict: **"Ready for PR — for these two fixes. no new material findings (high confidence)."** The arc-3 loop converged here. One operational caveat it raised: a `ports.json` written before the owner field was added releases nothing — the rows of the runs that were in flight at that moment were removed by hand.

## Durations

_(filled from the sharded full runs — the shard count in `pr-tools-e2e.yml` follows them)_

## Gate

_(`bun run e2e:tools` at retry 0, then `--shard=1/2` and `--shard=2/2`)_
