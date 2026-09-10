---
plan: tools-readiness
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
budget: recon 1 agent; codex at high; no /code-review (owner directive 2026-09-03)
base: dev @ 94e412a6
status: v3 — codex rounds 1–2 folded (25 findings); round 3 pending
---

# tools-readiness — the account-widening feature and the readiness cells

The follow-up to `tools-self-testing`. Two things ship: a feature that exists on neither side
today — a dApp session granted some of a wallet's accounts can be widened to a new one without
forgetting the app — and the test cells `implementations-plan/tools-self-testing/readiness.md`
lists as the gap between the suites and production evidence, plus the three product recovery fixes
those cells exposed (owner-authorized at Phase 0). No wallet-sdk patches: both halves use
`requestCapabilities` and `getAccounts` as the SDK ships them.

## Scope (from the Phase 0 answers)

**In**
1. **Account widening.** Extension: a repeat `accounts` request from a dApp whose session does not
   cover every visible account on the session's chain opens the capability popup with the new accounts
   selectable and the already-granted ones pre-checked and locked; a decline keeps the old grant and
   its flags. Tools: an "Add accounts…" action in the account switcher that re-requests through the
   session's existing quiet path, and a `getAccounts` re-read when the page becomes visible again. One
   extension network e2e and one tools cell prove it end to end.
2. **Multi-account cells.** Tools: the six cells of readiness § 5, with their expectations corrected
   to what the product does (a record owned by another granted account offers a SWITCH, the feed is
   shared with that offer, a rediscovered hash-less claim needs a click). Extension: an active-account
   switch under a live dApp session, and a second-account send end to end.
3. **Readiness § 1 test gaps** and **three recovery fixes** they exposed — each one a recovery the
   journal does not offer today, and none of them a resubmission: a message consumed by another
   submitter completes on record-tied evidence; a deposit whose Ethereum wallet never answered is
   reconciled against the chain; an exit that lost its transaction id can have it attached. Plus
   dropped claims, Permit2 signature fields, a hostile token-list entry, a two-tab provenance race
   and two narrower viewports.

**Out** (explicitly): the two wizard warts (preflight-deferred stand-down, value-keyed route watcher)
and the deterministic FPC equality gate (readiness § 2–3); the testnet nightly canary; any change to
`@aztec/wallet-sdk`; promoting the advisory aggregators; bounding a dApp's repeat prompts after a
decline (pre-existing behaviour for every capability type, see Security); re-submitting a deposit or
an exit from a record (a duplicate is worse than a stuck row — the fixes reconcile, attach or discard).
Nothing in `apps/extension/**` or the wallet packages is touched from the tools arcs, nothing in
`apps/tools/**` or `packages/bridge-core/**` from the extension arc (CLAUDE.md § Two products, one repo).

## Success criterion

Every cell below is a named test passing at retry 0 in its suite's full local run and on the PR's CI;
the widening feature is proven by an extension e2e (Nulo) and a tools cell (stock wallet); each
product fix carries an engine-level unit pin (the policy pins prove the button, the engine pins prove
the run); the three PRs are green and merged in order by the owner.

## Delivery — three arcs, one stack

| Arc | Branch | Phases | Stacks on | code_review |
|---|---|---|---|---|
| 1 extension | `worktree-tools-readiness` — `gh stack init --base dev worktree-tools-readiness` (no `--adopt` flag exists) | 1, 2 | `dev` | off |
| 2 tools accounts | `tools-readiness/tools-accounts` — `gh stack add tools-readiness/tools-accounts` | 3, 4 | arc 1 | off |
| 3 tools gaps | `tools-readiness/tools-gaps` — `gh stack add tools-readiness/tools-gaps` | 5, 6, 7 | arc 2 | off |

Arc 2 depends on arc 1 only by stacking discipline (its widening cell runs against the stock test
wallet, which already widens); arc 3 on arc 2 for the accounts helpers and the L1 hold. Each arc gets
its own codex loop at its boundary, then one cross-arc pass. PRs open only in Delivery: `gh stack
submit --auto --open` (`--auto` alone creates drafts), then `gh pr edit` each of the three bodies
(what/why, gates, the owner's merge order), then `gh pr checks --watch` per PR. After any `gh stack
sync`, rebase or boundary fix, the affected arcs' LOCAL gates re-run first (the phase gates named
below, on the new SHA) and only then are the PR checks re-watched; the owner is told a PR is green
only after both. `gh stack merge` is the owner's, lowest PR first.

## Phases

Every gate includes the fast layers for the touched packages: `bun run lint`, `bun run --cwd <pkg>
typecheck`, `bun run --cwd <pkg> test` (bridge `packages/wallet-bridge`, extension `apps/extension`,
playground `apps/playground` when touched, tools `apps/tools`, bridge-core `packages/bridge-core` when
touched). Heavy layers per phase. Retry 0 everywhere: the extension network config defaults to two
retries (`apps/extension/vitest.e2e.network.config.ts:46`), so every network command below carries
`NULO_E2E_RETRY=0`; the tools suite is retry 0 by config. The owner asked for full suites locally,
sharded: the tools suite runs as parallel `--shard=i/n` launchers, each on its own sandbox — **two**
shards first (two sandboxes ran side by side in the previous plan); a third only if a two-shard run
shows headroom (`free -h`, no swap), and a mass failure under load falls back to sequential shards,
logged. The extension network runner has no shard option (`apps/extension/scripts/e2e/agent.sh`), and
that suite mass-fails under concurrent host load, so it runs whole and alone (`NULO_E2E_RETRY=0
NULO_E2E_PROVERLESS=1 bun run e2e:agent`), and single files during a phase (`NULO_E2E_RETRY=0
NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/<file>`). The smoke suite runs whole against
an armed build: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet
VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension
build:chrome` then `NULO_E2E_MIGRATION_FIXTURE=1 bun run --cwd apps/extension test:e2e`. Every local
run's retry-0 tally and SHA are quoted in the phase's lessons file.

### Arc 1 — extension

#### Phase 1: The wallet widens a session on a repeat `accounts` request
- **Membership, chain-scoped, independent of why the type is in the delta.** `packages/wallet-bridge/src/dispatcher.ts`
  `handleRequestCapabilities`: whenever the manifest asks for `accounts` AND the session already
  holds an accounts grant, compute the ungranted set — the profile's visible accounts on the session's
  chain (`accountService.getAccounts(profileId, chainId)`, visible only,
  `apps/extension/src/wallet/services/account/service.ts:170`; NOT `loadAvailableAccountsForPopup`,
  which provisions a default account when the profile has none) minus the session's addresses for
  that chain (`getSessionAccountAddresses(dappSession, chainId)`, `dispatcher.ts:1396` — session
  entries are CAIP-10 `aztec:<chainId>:0x…`, so raw subtraction is wrong). A pure helper
  `ungrantedAccounts(profileAddresses, sessionAddresses)` owns the rule. The request then classifies:
  - **membership-only**: flags equal the stored grant's, ungranted ≠ ∅ → `accounts` joins the delta
    (today it is covered and skipped, `dispatcher.ts:1058-1071`);
  - **field-diff**: flags differ (already in the delta) — with or without ungranted accounts;
  - **re-prompt after a decline**: already in the delta (`dispatcher.ts:333`) — the same two shapes.
  In EVERY case where the session holds an accounts grant, the popup params carry `grantedAccounts:
  string[]` (raw hex, the session's chain) beside `availableAccounts`, so granted rows are locked on
  every path, not only the membership-only one. The presence of wallet-derived `grantedAccounts` is
  the "already granted" signal; `reRequested` keeps meaning "previously declined".
- **The decision never revokes.** Membership-only: the accounts card's rider (`canCreateAuthWit`)
  renders locked to the stored value and the decision builder (`dispatcher.ts:366-425`) treats the
  type as approved-without-replacement — `addAccounts` = selected − granted, `aliasPatch` only for new
  addresses, `replaceTypes` excludes `accounts`, `grantRecords` carry no accounts entry, so the stored
  grant stands. Field-diff: the existing replacement path, with granted rows locked and pre-selected
  (they are re-included in the replaced grant unchanged) and new rows unchecked; the approve gate
  accepts a selection that adds nothing (a flag-only approval must not force sharing more). A decline
  is a rejection of the `accounts` type exactly as today: the old grant and its aliases stand
  (`applyCapabilityDecision`'s invariant), and the next request re-prompts (existing semantics for
  every declined type — see Security). **Concurrent revocation**: the decision re-reads the session
  under the service lock; if the accounts grant is gone (revoked from the management UI while the popup
  was open) a membership-only approval is rejected — `addAccounts` never lands on a session without
  the grant, and no grant is re-created. Pinned.
- **Wire + UI.** `dapp-interaction-protocol.ts`: `grantedAccounts?: string[]` on `CapabilityParams`.
  `apps/extension/src/popup/windows/capabilities/index.vue` `init()`: granted rows pre-selected; the
  approve gate accepts an empty addition only when `grantedAccounts` is absent or the request changes
  flags. `AccountSelectRow.vue`: a `locked` prop → native `disabled` on the control, `aria-disabled`,
  `data-granted="true"`, and the toggle handler ignores locked rows (keyboard included). Copy names
  what the app already has and what it asks to add.
- **Unit tests.** `dispatcher.test.ts` — the `:543` same-shape pin becomes: same shape, every visible
  account granted → no popup; same shape, one ungranted → popup with `grantedAccounts`; a hidden
  account is not ungranted; an account on another chain is not ungranted (cross-chain membership);
  membership-only approve adds only the new address, keeps the stored flags and aliases; decline keeps
  grant, flags, aliases; field-diff with an ungranted account replaces flags and adds the address;
  field-diff approving nothing new keeps membership and changes flags; a re-prompt after a decline
  still carries `grantedAccounts`; the grant revoked between popup and decision → rejected, nothing
  written. `capabilities/index.test.ts` with the REAL `AccountSelectRow` (the harness stubs it at
  `:223` — the consent tests mount the row): granted rows pre-checked and locked; approve returns
  granted ∪ picked; a flag-only request approves with no new row. `AccountSelectRow.test.ts`: a locked
  row ignores click, Enter and Space.
- **Validation gate**: `bun run lint`; `bun run --cwd packages/wallet-bridge typecheck && bun run --cwd
  packages/wallet-bridge test`; `bun run --cwd apps/extension typecheck && bun run --cwd apps/extension
  test -- src/popup/windows/capabilities`; exit 0. Layers: lint · typecheck · unit.

#### Phase 2: Extension e2e — widening, the active-account switch, the second-account send
- `apps/extension/tests/e2e/network/cap-widening.test.ts`: `grantCapBundle` with one account;
  `createAccount(setupPage, "Second")`; the playground re-requests `accounts`
  (`pg-btn-requestCapabilities`): the popup lists two rows, the first `[data-granted="true"]` and
  unchangeable; approve → `getAccounts()` (`callExpectingNoPopup`) returns both, aliases of the first
  unchanged; a second run declines → `getAccounts()` returns one, the stored `canCreateAuthWit` unchanged
  (a `sendTx`-free `createAuthWit` check).
- `apps/extension/tests/e2e/network/account-switch-live-session.test.ts`: two accounts granted; the
  popup's active account switched to B (`accounts.test.ts`'s switcher path); `getAccounts()` with no
  popup returns the same two in the same order; a `sendTx` with `from: A` (`pg-input-simFrom`) is
  executed by A — two separate assertions: A's token balance drops by the amount (B's unchanged), and
  A's Fee Juice balance drops (B's unchanged); the fee is never read off the token balance.
- Second-account send: no playground change — `simFrom` already drives `from` (`sections/transactions.ts:59`).
  `multi-account-from.test.ts` gains the case its docstring calls out: `simFrom` = account 2, `sendTx
  default` lands, account 2's token balance drops by the amount, its Fee Juice by the fee, account 1's
  both unchanged, the recipient's rises; the docstring is updated.
- **Validation gate**: each new/changed file green alone at retry 0 (`NULO_E2E_RETRY=0
  NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/<file>`); `bun run --cwd apps/playground
  typecheck`; the smoke suite whole against the armed build (command above), exit 0; `bun run
  test:ci-gating`. Layers: lint · unit · e2e.
- **Arc boundary**: the FULL network suite whole and alone (`NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1
  bun run e2e:agent`), retry-0 tally quoted; then the codex loop on the arc-1 diff; then `gh stack add
  tools-readiness/tools-accounts`.

### Arc 2 — tools accounts

#### Phase 3: "Add accounts…" and the visibility re-read
- `apps/tools/src/lib/prompt-queue.ts`: `enqueuePrompt` extracted from `useTokenGrant.ts` (its queue
  is private today; two composables must share one queue, not run two). `useTokenGrant` imports it.
- `apps/tools/src/composables/useAccountWidening.ts`: `addAccounts()` enqueues on the shared queue; the
  queued task re-checks INSIDE the queue (the state may have moved while it waited): a flow owning the
  session or an operation in flight (`MID_FLOW_STATUSES`, `opsInFlight`) → `busy`, no request; else
  `session.retryCapabilities()` — a `false` return (the session's own no-op, `createAztecWalletSession.ts:734-739`)
  is `busy`, never `unchanged`; `true` → the outcome is classified from the session: `failed` when the
  status left `connected` or an error was set, `added n` when the grant grew, `unchanged` otherwise
  (a wallet's decline and "nothing new" both answer with the old grant and are not distinguishable
  from the response — the copy says so).
- `createAztecWalletSession.ts`: `refreshAccounts()` — enqueued on the same shared queue so it never
  interleaves with a grant request; runs only when `connected`, no flow owns the session and no
  operation is in flight; the flow epoch does NOT move on a retry or a selection (`retryCapabilities`
  reads `s.epoch` at `:740` and never increments it), so the completion check is by state, not epoch:
  the result is dropped unless `s.accounts.value` is still the array captured before the await
  (`chooseGrantedAccount` replaces it wholesale, `:826`, so a grant landing meanwhile changes identity),
  `s.selectedAccount.value` is unchanged, the status is still `connected` and no operation started.
  `wallet.getAccounts()` answers a list of `{ item, alias }` entries, not a grant, so the per-entry
  loop of `parseGrantedAccounts` (`:984-1004`: address parse, dedupe, cap, alias hardening) is extracted
  as `parseAccountList(entries)` and both callers use it; an empty or failed read changes nothing; the
  selected account is kept when still listed, else the first; `hiddenAccountsCount` and the
  persisted selection follow the existing cap/persist rules. Unit-pinned per guard.
- `useWalletConnection.ts`: the module-level singleton has no dispose (`:158-170`;
  `__resetWalletConnectionForTests` only resets the session, `:216-220`), so the ONE
  `document.visibilitychange` listener (→ `visible` calls `session.refreshAccounts()`) is installed at
  module init for the page's lifetime and never removed; the test reset does not touch it, and the
  composable's tests call `refreshAccounts` directly.
- `AccountSwitcher.vue` `.foot`: "Add accounts…" (`TESTIDS.accountMenuAddAccounts`), disabled while
  busy; a status line (`TESTIDS.accountMenuAddStatus`): "Added 1 account" / "No accounts were added"
  / "Couldn't reach your wallet".
- **Unit tests**: `useAccountWidening.test.ts` (busy from state, busy from the `false` return, added,
  unchanged, failed, queued behind a token grant); `createAztecWalletSession.test.ts` (`refreshAccounts`:
  each guard, identity-changed drop, selection kept/dropped, `parseAccountList` shapes);
  `AccountSwitcher.test.ts` (button, disabled state, status line); `useTokenGrant.test.ts` still green
  on the shared queue.
- **Validation gate**: `bun run lint`; `bun run --cwd apps/tools typecheck && bun run --cwd apps/tools test`;
  exit 0. Layers: lint · typecheck · unit.

#### Phase 4: The accounts cells
- Fixture additions (arc 2, because these cells need them): `fixtures/l1-wallet.ts` `holdNext(kind,
  match?)` (the next matching call never answers; `match.to` narrows a transaction to its target —
  a deposit's router, not the ERC-20 approval that precedes it, `useSend.ts:695`), per-method call
  counters (`calls("eth_sendTransaction")`, `calls("eth_signTypedData_v4")` — the single `signatures`
  total stays), and `releaseHeld()` (broadcast a held transaction from the fixture's own client — the
  wallet that answers after the tab is gone); `fixtures/test.ts` a `spares` worker option (default 2)
  so a file can ask for a pool of exactly `cells`; `pages/connect.ts` `reconnectedAs(page, address)` —
  reload-side reconnect that FAILS if the chooser appears (`driveToConnected` answers it, which would
  hide the bug) and asserts the chip.
- `apps/tools/tests/browser/specs/accounts.spec.ts`, `test.use({ family: "accounts", cells: 10, l1Index: 8 })`
  — `cells` counts actors taken: cells 2–5 take two each. Actors come from `pool.take()`.
  1. **Widening**: connect as A; `window.__nuloTestWallet.addAccount(secret, salt)` for a fresh seed in
     the wallet frame; "Add accounts…" → the switcher lists the new address (`grantedAccounts`), the
     status says "Added 1 account"; a second click says "No accounts were added".
  2. **A record owned by another granted account**: deposit as A with the claim held (24a's `holdNext`);
     reload — the session remembers A (`chooseGrantedAccount` re-applies the persisted choice, `:838-846`),
     so `reconnectedAs(A)` then `switchAccount(B)`: the card shows "SWITCH TO <A>" (`BridgeJournalCard.vue`
     `offerSwitch`) and no claim is sent (`walletCalls(...).sendTx` 0); click it: the chip shows A; the
     rediscovered hash-less record does not auto-resume (`resumeActionFor`, `useBridgeJournal.ts:1449`),
     so click CLAIM: it lands from the journal.
  3. **Switch refused mid-send**: `holdNext("transaction", { to: router })` on the Ethereum leg;
     confirm as A; open the switcher: B's row is `disabled` (asserted, never clicked) and the chip
     still shows A.
  4. **The feed is shared, the switch is offered**: after cell 2's shape, B's feed lists A's record with
     the SWITCH action and B's own record without it; under A the action is gone.
  5. **Gas gate re-read**: A holds credit, B nothing: a review opened as A then a switch to B stands
     down; B's amount step says `none`; back under A it sends.
  6. **Reload remembers a non-first account**: connect choosing B; reload; `reconnectedAs(B)` — no
     chooser, chip B.
- `apps/tools/tests/browser/specs/accounts-single.spec.ts`, `test.use({ family: "accounts-single",
  cells: 1, spares: 0, l1Index: 8 })`: a one-seed wallet connects straight to `connected`, no chooser.
- Missing testids are added before a cell names them: the card's SWITCH button, the switcher row's
  disabled state is native (`:disabled`), the status line.
- **Validation gate**: `bun run e2e:tools -- tests/browser/specs/accounts.spec.ts tests/browser/specs/accounts-single.spec.ts`
  green at retry 0 on a fresh sandbox. Layers: lint · unit · e2e.
- **Arc boundary**: the full tools suite in parallel shards (two, then three if measured), every shard
  green at retry 0 with the tally quoted; the codex loop on the arc-2 diff; `gh stack add tools-readiness/tools-gaps`.

### Arc 3 — tools gaps (tests and the three recovery fixes)

#### Phase 5: Recovery — dropped and consumed
- Test wallet: `dropNext("sendTx")` on the node hand-off proxy (`wallet.ts` `observeSubmissions`) —
  records the submission and returns its hash without forwarding the transaction (one shot).
- **Product fix (consumed).** `awaitConsumable` (`useBridgeJournal.ts:1102-1123`) rethrows on a consumed
  message, and the probe it wraps is not record-specific: for an unregistered token it probes the fee's
  setup as a whole transaction (`useSend.ts:445-452`), so a consumed FUEL message throws the same
  shape, and a fee stop returns before any probe (`:379`). Fix: the consumed error is the TRIGGER, the
  record-tied probe is the PROOF — on `isMsgConsumed`, run `recordMessageConsumed(rec)` (`:1312-1330`,
  re-simulates the record's own claim; `true` only on that claim's nullifier); `true` and no
  `claimTxHash` of the record's own → `completeDeposit` with the note "Claimed for you by another
  submitter" (funds arrived), set AFTER `completeDeposit`'s runtime wipe (`:707-715`); `false` or
  `null` → rethrow exactly as today. A record WITH its own hash keeps the receipt path. Engine pins in
  `useBridgeJournal.test.ts`: consumed trigger + proof → `done` with the note, no send; consumed trigger
  + the record's claim still simulates (the fuel case) → NOT completed, the error surfaces as today;
  consumed trigger + no secret (`null`) → as today.
- Harness: `pages/relayer.ts` `claimAsRelayer(actor, record)` — `HubClaimParams` from the page's
  journal record (token block, recipient, amount, leaf index, the public claim secret) → `claimViaHub`
  with `actor.s.relayerOpts`, after `waitForL1ToL2Message` for the record's message.
- `recovery.spec.ts` **24c dropped**: fueled deposit as A with `dropNext` armed for the claim; three
  straight dropped receipt polls clear the hash, the card says "The claim was dropped - claim again
  from this card"; claim: it lands; balances as 24a.
- `recovery.spec.ts` **24b consumed**: public deposit as A with the claim held; after the Ethereum leg
  the harness claims through the relayer; reload; the record is not session-live and has no hash, so
  it does not auto-resume — click CLAIM: the record ends `done` with the note, no own claim
  (`walletCalls(...).sendTx` 0, `claimTxHash` undefined), the token credited once.
- **Validation gate**: `bun run --cwd apps/tools test`; `bun run e2e:tools -- tests/browser/specs/recovery.spec.ts`
  green at retry 0. Layers: lint · unit · e2e.

#### Phase 6: Permit2 fields, a hostile token list
- `fixtures/l1-wallet.ts`: every `eth_signTypedData_v4` payload recorded with its timestamp; `permits()`
  returns the parsed Permit2 messages (domain, `permitted.token`, `permitted.amount`, `spender`,
  `nonce`, `deadline`, witness).
- `deposit-token.spec.ts` cell 1 and `deposit-token-gas.spec.ts` cell 13: exactly one permit; `spender`
  is the generation's router, `permitted.token` the ERC-20, `permitted.amount` the review's units (the
  whole amount for token-only; token leg + slice for token+gas), `deadline` after the signing timestamp,
  and `nonce` + `deadline` equal to those in the deposit transaction's calldata (decoded with the
  router ABI from the journal's `depositTxHash`).
- `fixtures/egress.ts`: the token-list fixture is a worker option (`tokenList: "community" | "hostile"`);
  `tests/e2e/fixtures/token-list-hostile.json`: `decimals: 300`; a non-address; a syntactically valid
  address with no contract; a duplicate of a manifest token's symbol at another address.
- `tokens.spec.ts` cell 34b (`tokenList: "hostile"`): the two malformed entries never become tiles
  (`token-list.ts:141` validates per entry); the no-contract entry is listed but selecting it fails
  closed at verification (the tile's error state, no route, no send); the duplicate-symbol entry is
  listed as its own address, never merged into the manifest token.
- **Validation gate**: the three spec files green at retry 0. Layers: lint · unit · e2e.

#### Phase 7: Wallet loss mid-flow, two tabs, viewports
- **Both hash-less fixes reconcile or attach; neither resubmits.** A missing hash never proves nothing
  was broadcast: an Ethereum wallet can answer after the tab is gone, an Aztec wallet can have sent the
  exit and lost the reply. Re-signing with fresh nonces would duplicate a deposit or a burn, and the
  records do not carry a replayable plan (an exit record has no originating account or authwit nonce,
  `useHubExit.ts:365-380`). The card already offers Discard on both shapes with "check your wallet
  activity" copy (`BridgeJournalCard.vue:169-186`); what is missing is a way to find out.
- **Product fix (held Ethereum leg).** `useSend.ts` opens the row before the Permit2 signature
  (`:668-676`), so a wallet that never answers leaves a `depositing` record with no hash that only
  Discard can touch (`record-policy.ts:92-95` needs `depositTxHash` for CLAIM). Fix: a `depositing`
  record with no `depositTxHash` gains **Reconcile** — `packages/bridge-core` `findDepositByContent(l1,
  router, { recipient, amount, secretHash }, fromBlock)` reads the router's deposit event (the one
  `runSend` already parses for `tokenMessageHashHex`, `send-flow.ts:78`) over the blocks since the
  record's `createdAt`, identity-bound by the L1 content (recipient + secret hash + amount, the same
  binding that makes a tampered claim fail); found → the record takes `depositTxHash`, `leafIndex` and
  `messageHash` from the event and re-enters the existing recoverable shape (the "stranded L1-timeout"
  path CLAIM already handles); not found → the note says the outcome is unknown ("Your Ethereum wallet
  never answered. If it sends this deposit later, reconcile again; otherwise discard.") beside Discard.
  Reconcile also runs once automatically on reload for such records. Engine pin: found → hash attached,
  CLAIM offered; not found → unknown, nothing sent; a mismatching event (another deposit to the same
  recipient) is never attached.
- **Product fix (exit without its hash).** `useHubExit.ts` opens the row at `exiting` (`:472`); the
  engine already refuses to run a hash-less withdraw (`unknown-outcome`, `useBridgeJournal.test.ts:701`)
  — that protection stays — but the policy offers RETRY on `unknown-outcome` (`record-policy.ts:96`),
  which for this shape re-runs the same refusal. Fix: RETRY is hidden for a withdraw without
  `exitTxHash`; the card offers **Attach transaction id** (an input, `TESTIDS.journalAttachTx`) — the
  hash is accepted only when the transaction's L2→L1 message names this record's `recipientL1`,
  `amount` and portal (the identity check the rediscovered-consume path already applies,
  `useBridgeJournal.ts:174,205`; `flows.ts:192-230` reads the message from the tx effects); accepted →
  `exitTxHash` set, the FINISH path takes over; rejected → "That transaction is not this exit". Engine
  pin: attach with a matching tx → FINISH runs once; a non-matching tx → refused, record unchanged; the
  hash-less withdraw still never auto-runs.
- `l1-wallet.spec.ts` 26d: a first deposit by the actor establishes the Permit2 allowance; then
  `holdNext("transaction", { to: router })`; the stepper shows the send waiting on the wallet; reload;
  the record shows Reconcile + Discard, Reconcile finds nothing (unknown-outcome copy); `releaseHeld()`
  broadcasts the held transaction; Reconcile again → the hash is attached and CLAIM lands; the
  per-method counters show one signature and two transactions for that deposit. A Discard variant
  (never released) leaves no record.
- `exits.spec.ts` 31b (private exit, single credit charge): the test wallet's `swallowNext("sendTx",
  <the hub's exit selector>)` forwards the transaction to the node but never answers the page (the
  pattern targets the exit call, not the authwit); reload; the record shows Attach + Discard, no
  RETRY; paste the hash from `submitted()`; a wrong hash (another actor's tx) is refused; the right
  one → FINISH lands; the credit is charged once; the token arrived once on L1. A Discard variant.
- `activity.spec.ts` 40 two tabs: `context.newPage()`; two sends started in two tabs (A and B are two
  actors); each tab's stepper adopts only its own record (`adoptRunRecord`'s provenance rule is only
  exercised while both are submitting); both records land; each feed lists both.
- `spike.spec.ts` viewports: at 390 px and 1024 px, connect and a public deposit; the ActivityDock
  overlay (below 1100 px) is opened, closed with Escape, and the confirm is clicked afterwards.
- **Validation gate**: `bun run --cwd apps/tools test`; `bun run --cwd packages/bridge-core test`; the
  four spec files green at retry 0; then the full tools suite in parallel shards at retry 0; `bun run
  test:all` and `bun run lint && bun run lint:actions` exit 0. Layers: lint · unit · e2e.

## Architecture & Implementation

**Extension (arc 1).** The widening decision lives beside coverage, in `handleRequestCapabilities`,
with profile I/O there and `isCapabilityCovered` untouched and pure; the chain-scoped membership uses
the dispatcher's existing CAIP-10 projection and a new pure helper unit-tested alone. "Already
granted" is signalled by wallet-derived `grantedAccounts` on the popup params on every path that
shows the accounts card for a session that holds a grant, so locking does not depend on why the type
entered the delta; `reRequested` is not overloaded. The decision builder learns one distinction — a
membership-only widening adds accounts without replacing the accounts grant — and re-checks the
grant's presence under the session lock, so `applyCapabilityDecision` (already unions `addAccounts`,
keeps a rejected type's grant) needs no change. The popup renders granted rows through the existing
`AccountSelectRow` with a `locked` prop backed by native `disabled`. Alternative not taken: an "add
this account to app X" screen in the extension's management UI — same storage path, but the dApp
gets no signal (no accounts-changed event in the SDK) and only learns on a re-read; the re-request
lets the dApp ask when the user wants it.

**Tools (arc 2).** `useAccountWidening` mirrors `useTokenGrant` and shares its queue through an
extracted `prompt-queue.ts` (one queue, two callers, guards re-checked inside the queue).
`refreshAccounts` is a session method on the same queue, with the existing per-entry parser shared
as `parseAccountList` and a state-identity completion check (the flow epoch does not move on
retries); the visibility listener is installed once for the page's lifetime. Alternative not taken:
polling `getAccounts` on an interval — a wallet round trip per tick for a rare event.

**Cells and fixes (arcs 2–3).** Every cell reuses the suite's fixtures (`grantedAccounts`,
`switchAccount`, `walletFrame`, `holdNext`, `keptFor`, the journal readers). Fixture additions: a
targeted L1 hold with release and per-method counters, typed-data recording, `dropNext` and
`swallowNext` on the node hand-off proxy, a `spares` option, a strict reconnect helper, a selectable
token-list fixture, a relayer-claim helper. The three product fixes are each one recovery the journal
did not offer, added as an explicit affordance with a policy row and an engine pin — consumed proven
by the record's own claim, a lost deposit found by its content, a lost exit attached by its
transaction id — and none of them resubmits.

**File map.** Arc 1: `packages/wallet-bridge/src/{dispatcher.ts,dispatcher.test.ts,dapp-interaction-protocol.ts,README.md}`,
`apps/extension/src/popup/windows/capabilities/{index.vue,index.test.ts,AccountSelectRow.vue,AccountSelectRow.test.ts}`,
`apps/extension/tests/e2e/network/{cap-widening,account-switch-live-session,multi-account-from}.test.ts`,
`apps/extension/tests/e2e/README.md`. Arc 2: `apps/tools/src/lib/{prompt-queue.ts,testids.ts}`,
`apps/tools/src/composables/{useAccountWidening.ts,useAccountWidening.test.ts,useTokenGrant.ts,createAztecWalletSession.ts,createAztecWalletSession.test.ts,useWalletConnection.ts}`,
`apps/tools/src/components/{AccountSwitcher.vue,AccountSwitcher.test.ts,BridgeJournalCard.vue}`,
`apps/tools/tests/browser/{fixtures/{test.ts,l1-wallet.ts},pages/connect.ts,specs/{accounts,accounts-single}.spec.ts,README.md}`,
`apps/tools/README.md`. Arc 3: `apps/tools/src/composables/{useBridgeJournal.ts,useBridgeJournal.test.ts,useHubExit.ts}`,
`apps/tools/src/lib/{record-policy.ts,record-policy.test.ts,testids.ts}`, `apps/tools/src/components/BridgeJournalCard.vue`,
`packages/bridge-core/src/{flows.ts,flows.test.ts}`,
`apps/tools/tests/browser/{test-wallet/{main.ts,wallet.ts,globals.d.ts},fixtures/{l1-wallet.ts,egress.ts},pages/relayer.ts,specs/{recovery,deposit-token,deposit-token-gas,tokens,l1-wallet,exits,activity,spike}.spec.ts}`,
`apps/tools/tests/e2e/fixtures/token-list-hostile.json`, `implementations-plan/tools-self-testing/readiness.md`
(rows closed).

**Critical flow (widening).** dApp `requestCapabilities({accounts})` → dispatcher: session holds an
accounts grant → profile addresses on the chain − session addresses on the chain ≠ ∅ → delta +=
accounts (membership-only), `grantedAccounts` set → popup: granted rows locked, new rows unchecked,
rider locked → approve → `selectedAccounts` → decision: grant still present, `addAccounts` = new
only, no replacement → `applyCapabilityDecision` unions → response `granted.accounts` re-derived from
the stored grant → tools `chooseGrantedAccount` replaces `s.accounts` → the switcher lists the new
account.

## Security & Adversarial Considerations

- **Consent boundary.** A session never widens without the popup; the re-read path is session-scoped
  by construction (`projectSessionAccounts`), so a dApp cannot enumerate ungranted accounts.
  `grantedAccounts` and `availableAccounts` are wallet-derived; a manifest cannot inject an address.
- **No revocation through the widening prompt.** Locked rows are natively disabled and the handler
  ignores them (keyboard included); the decision only adds and never replaces the accounts grant or
  its flags on a membership-only widening; the rider is locked; a flag change re-includes the granted
  rows unchanged. A grant revoked while the popup is open is not re-created. Revocation stays in the
  extension's management UI.
- **A declined widening keeps the older grant, flags and aliases** — pinned.
- **Repeat prompts.** A declined type re-prompts on the next request today, for every type; this plan
  keeps that (tools asks only on a click). A dApp looping `requestCapabilities` to nag is a pre-existing
  exposure recorded as a follow-up (a per-session backoff after N declines), out of scope here. The
  response's timing reveals whether ungranted accounts exist (a prompt vs an immediate answer), never
  which; accepted.
- **No resubmission from a record.** Reconcile attaches only an event whose L1 content matches the
  record (recipient, secret hash, amount); Attach accepts only a transaction whose L2→L1 message names
  the record's recipient, amount and portal — the same identity checks the rediscovery paths already
  apply — so a pasted or planted hash can bind a record only to its own transaction, and a duplicate
  deposit or burn is impossible from the card. The consumed completion needs the record's own claim
  to simulate as nullified; a consumed fuel message never completes a token record.
- **Test-only surfaces.** `dropNext`, `swallowNext`, `holdNext`/`releaseHeld`, `permits()` live on the
  test wallet and the L1 fixture, served only on loopback; shipped builds list neither. The hostile
  list is a fixture inside the egress fence.
- **The relayer helper** stages external consumption through the real hub path (the integration suite's
  relayer flow); the cell proves the UI's own recovery after a reload, not the helper.
- **Supply chain / CI.** No new dependencies; workflow permissions unchanged.
- **Domain.** The Permit2 cells make `spender` and the nonce/deadline binding asserted invariants —
  the drain shape.

## Assumptions

**Facts (verified)**
1. Coverage for `accounts` compares only the two flags — `dispatcher.ts:264-266`, `:443-448`; a
   same-shape re-request returns the stored grant with no popup — `:1058-1071`, pinned by
   `dispatcher.test.ts:543`; a rejected type re-enters the delta on every request — `:333`.
2. Session accounts are CAIP-10 and the dispatcher projects them per chain — `dispatcher.ts:289-296`,
   `:1396-1400`; `accountService.getAccounts(profileId, chainId)` returns visible accounts only —
   `account/service.ts:166-174`.
3. The decision builder replaces approved delta types and re-sends aliases for every selected account
   — `dispatcher.ts:366-425`; `applyCapabilityDecision` unions `addAccounts` unconditionally and keeps
   a rejected type's grant — `dapp-session/service.ts:300-334`.
4. `loadAvailableAccountsForPopup` provisions a default account when the profile has none —
   `dispatcher.ts:1118-1130`. `handleGetAccounts` intersects with the session's addresses — `:736-793`.
5. `capabilities/index.test.ts` stubs `AccountSelectRow` — `:223`.
6. Tools re-requests on a live session through `retryCapabilities` (returns `false` as its no-op,
   reads the epoch without moving it) — `createAztecWalletSession.ts:734-751`; `chooseGrantedAccount`
   replaces `s.accounts` wholesale and re-applies a remembered selection — `:818-855`;
   `parseGrantedAccounts` reads a GRANT result and parses entries per item — `:984-1004`; no
   `getAccounts` call and no visibility listener exist in `apps/tools/src`; the `useWalletConnection`
   singleton has no dispose — `:158-170`, `:216-220`.
7. The test wallet answers every `requestCapabilities` with all imported accounts —
   `test-wallet/wallet.ts:72-82`; `addAccount` imports a seed live — `main.ts:124`; `holdNext`/`failNext`
   take a method + pattern — `main.ts:128-133`; the node hand-off proxy exists — `wallet.ts` `observeSubmissions`.
8. Dropped: three straight `dropped` receipt reads clear the hash with the re-claim note —
   `useBridgeJournal.ts:1238-1275`. Consumed: `awaitConsumable` rethrows on a consumed message —
   `:1112-1120`; `recordMessageConsumed` re-simulates the record's own claim and answers
   true/false/null — `:1312-1330`; `completeDeposit` wipes attention and note — `:707-715`; the send
   probe covers the fee's setup for an unregistered token — `useSend.ts:445-452`, and a fee stop
   returns before it — `:379`.
9. The feed hides only the foregrounded record — `useBridgeJournal.ts:1466`; a record owned by another
   granted account offers SWITCH — `BridgeJournalCard.vue:70-80`, `record-policy.ts:98-100`; a
   rediscovered record without a hash is not auto-resumed — `:1440-1452`.
10. Send and exit rows open before their first chain write — `useSend.ts:660-676` (Permit2 approval
    at `:695`), `useHubExit.ts:466-478`; CLAIM needs `depositTxHash` and FINISH is hidden while
    `exiting` — `record-policy.ts:92-95`; RETRY is offered on `unknown-outcome` — `:96`; a hash-less
    withdraw is refused as `unknown-outcome` — `useBridgeJournal.test.ts:701`; Discard exists on both
    shapes with "check your wallet activity" copy — `BridgeJournalCard.vue:169-186,237-242`; the exit
    record carries `recipientL1`, amount, portal and no originating account or nonce — `useHubExit.ts:365-380`;
    the rediscovered-consume identity check — `useBridgeJournal.ts:174,205`; the exit message is read
    from the tx effects — `flows.ts:222-228`.
11. The playground's `simFrom` input drives `from` — `sections/transactions.ts:59`.
12. The token list validates entries one by one after the chain filter — `token-list.ts:33,141`.
13. `gh stack init` takes `--base <trunk> <branch>`; no `--adopt`. `gh stack submit --auto` creates
    drafts unless `--open`.
14. The extension network runner has no shard option (`apps/extension/scripts/e2e/agent.sh`) and its
    config retries twice unless `NULO_E2E_RETRY=0` — `vitest.e2e.network.config.ts:46`.
15. Used `l1Index` values are 1–7; `actorKeys` defaults to 12 — `deploy.ts:115`.

**Inferences (unverified — the audit should attack)**
- Two parallel tools shards fit this host (two sandboxes ran side by side in the previous plan);
  three is measured, not assumed.
- The extension's `sendTx` from a non-first granted account is already permitted by the session's scope
  enforcement (`scope-enforcement.ts`) — `multi-account-from.test.ts` implies it; Phase 2 confirms.
- `wallet.getAccounts()` (wallet-sdk `Wallet`) answers entries of the same `{ item, alias }` shape the
  grant's accounts capability carries; confirmed at Phase 3 against the SDK's type before
  `parseAccountList` is shared.
- The router's deposit event carries the recipient, amount and secret hash as readable (indexed or
  decoded) arguments, so `findDepositByContent` can filter by them; confirmed at Phase 7 against the
  ABI before the helper is written — if not, the helper decodes candidate events and compares.
- After the relayer's claim deploys the derived token, the page's wallet can register the instance
  and simulate the record's claim (so `recordMessageConsumed` answers `true` for 24b); if the
  registration still enqueues a constructor for a deployed instance, the cell registers the token
  through the existing "add to wallet" path first and the plan notes it.

**Asks** — none open. Settled at Phase 0: scope (items 1–3), heavy suites locally and sharded, a
three-arc stack, `code_review: off`, the three recovery product fixes authorized in arc 3 (now
specified as reconcile / attach / record-tied completion, never resubmission). `/harden`: not scheduled.

## Decision log

### Codex round 1 (reject, 16 findings) → v2

| # | Finding | Call |
|---|---|---|
| 1 | session accounts are CAIP-10; raw subtraction misclassifies | adopted — chain-scoped projection, `grantedAccounts` as raw hex for the chain, cross-chain test |
| 2 | the decision path replaces the accounts grant, can revoke the rider, rewrites aliases; CSS-disabled rows still toggle by keyboard | adopted — membership-only widening adds without replacement, rider locked, aliases only for new addresses, native `disabled` + handler guard, keyboard tests |
| 3 | a declined type re-prompts on every request; timing reveals that ungranted accounts exist | adopted as documented behaviour — pre-existing for every type; a backoff is a follow-up; timing accepted |
| 4 | keep coverage pure; don't overload `reRequested`; resolve the loader contradiction; cover flag+membership | adopted — `grantedAccounts` presence is the signal; `accountService.getAccounts` direct; the combined case takes the field-diff path |
| 5 | `getAccounts` returns a list, not a grant; guard the refresh; teardown ownership | adopted — shared entry parser, state guards, listener ownership (revised in round 2) |
| 6 | `useTokenGrant`'s queue is private; outcomes need distinguishing | adopted — `prompt-queue.ts` shared; `added / unchanged / busy / failed` with honest copy |
| 7 | 24b cannot end `done`: `awaitConsumable` rethrows | adopted — owner-authorized product fix + the cell (proof tightened in round 2) |
| 8 | 26d and 31b assert recovery the product lacks; target the exit's second tx | adopted — owner-authorized fixes (mechanism replaced in round 2); the hold targets the exit selector |
| 9 | the feed is shared; another granted account gets SWITCH, not a mismatch note; assert `disabled` without clicking | adopted — cells 2 and 4 rewritten; cell 3 asserts the disabled row under a held Ethereum leg |
| 10 | duplicate symbols and no-contract addresses pass the schema; permit nonce unverified | adopted — cell 34b asserts fail-closed selection and no merge; permits compared with the deposit calldata |
| 11 | `simFrom` already controls `from`; receipts carry no sender | adopted — no playground change; balance-based assertions |
| 12 | popup test stubs rows; actor pairs need explicit allocation; seed scripts compete; `driveToConnected` hides the chooser | adopted — real rows in the consent tests, `cells: 10`, a `spares` option + a separate one-seed file, `reconnectedAs` |
| 13 | three shards unmeasured; Phase 2 promised the full suite; armed-smoke command; playground typecheck | adopted — two shards then measure; the full network suite at the arc boundary; commands spelled out |
| 14 | idle tab B never enters the provenance branch; test the dock's open/close | adopted — two racing sends; dock opened, closed with Escape, then confirm |
| 15 | product-fix authorization was a silent Ask; `--adopt` does not exist; drafts; re-watch after sync | adopted — asked and answered; `gh stack init --base dev …`; `--open`; re-watch rule in Delivery |
| 16 | the seed's "no turn waited" clause conflicts with the three-round stop; owner merging is not the agent's | adopted — seed reworded |

### Codex round 2 (reject, 9 findings) → v3

| # | Finding | Call |
|---|---|---|
| 1 | a missing hash does not prove nothing was broadcast; a retry with fresh nonces duplicates; keep the engine's `unknown-outcome` protection | adopted — no resubmission anywhere; the deposit fix reconciles by content, the exit fix attaches an identity-checked tx id; `unknown-outcome` stays; Discard's copy states the unknown outcome |
| 2 | records carry no replayable plan; policy pins prove buttons only | adopted — replay dropped, so no plan is needed; every fix carries an engine pin (found/attached/refused/never-runs) beside the policy row |
| 3 | a consumed error can come from the fuel setup; a fee stop prevents probing; `completeDeposit` wipes the note | adopted — trigger + record-tied proof via `recordMessageConsumed`; the fuel case pinned as NOT completed; the note set after the wipe |
| 4 | `grantedAccounts` only on the membership path; rejected/flag-change paths lose locking; flag-only approval must not force sharing; keep the concurrent-revocation test | adopted — `grantedAccounts` on every path with a stored grant; classification by flags, not delta origin; empty-addition approval on a flag change; revocation re-checked under the lock, pinned |
| 5 | retries and selection never move `s.epoch`; no singleton disposal exists; reuse the entry parser | adopted — completion check by `s.accounts` identity + selection + status; the listener installed once for the page's lifetime; `parseAccountList` shared with `parseGrantedAccounts` |
| 6 | re-check busy inside the queue; honour `retryCapabilities() === false` | adopted — both, `false` → `busy` |
| 7 | reload remembers A, so `reconnectedAs(B)` cannot establish B; SWITCH only selects; hash-less claims need a click | adopted — cell 2 reconnects as A then switches; CLAIM clicked in cells 2 and 24b |
| 8 | fees are Fee Juice, not the token; the Permit2 approval precedes the deposit tx; count per method; private exit for the single charge | adopted — separate balance assertions; allowance pre-established + `holdNext` matched by `to`; per-method counters; 31b private |
| 9 | `NULO_E2E_RETRY=0`; re-run local gates after a rebase; the seed must require passing checks | adopted — retry 0 on every network command; local gates before re-watching; seed reworded |

## Post-implementation

Executed by the implementing session from this file. `code_review` is `off`: `/code-review` is not
run at any point.

1. **Per arc, at its boundary** (all its phases ✓, the arc's full-suite run green, before `gh stack
   add`): send `/codex high` the arc's diff, this plan.md + `recon.md`, the arc map ("this is arc N of 3;
   later arcs build X on it"), the adversarial/security ask ("What could go wrong? What would an
   attacker target? What are we trusting that we shouldn't? Where are the supply-chain / least-privilege
   weaknesses?"), and both rules below verbatim.
2. **Iterative fix loop**: verify codex's factual claims against the repo; apply the accepted fixes;
   commit; log the round (consult + verdict) in `lessons/phase-N.md`; RESUME the same codex session
   with the fix diff. Repeat until a round yields no new material findings (rejected nitpicks don't
   count). Still material after 3 rounds → stop and surface to the owner: a scope smell.
3. **Final cross-arc pass**: after all three arcs are green and looped, a FRESH codex session over the
   net diff from `94e412a6` asking for cross-arc issues (seams, duplication across arcs, drift from this
   plan), same loop until clean.
4. **Delivery**: the FIRST time any PR is opened — the Delivery section's commands, bodies, the
   local-gates-then-re-watch rule. Update `implementations-plan/index.md` and close the matching rows
   of `implementations-plan/tools-self-testing/readiness.md`. Never merge.

**The no-over-engineering rule** (verbatim in every codex prompt): *"Report bugs and small, targeted
improvements only. Do not propose speculative abstractions, extra configuration surface, new layers,
or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it
alone."*

**The comment-quality rule** (verbatim in every codex prompt): *"Audit the comments for value per
character. Flag any comment that narrates what the code visibly does, restates its line, references
implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag
places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are
permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and
exact."*

**Autonomy**: decisions the plan leaves open are settled by a logged `/codex high` consult; a loop
still material after three rounds, or a decision outside this plan's scope, is surfaced to the owner
and the session holds there. Hard limits: no merge, no publish, no history rewrite on branches others
touch, no scope beyond this plan, no secrets, no resubmission path added to any record. Pushing the
arc branches after `<test>` + `<lint>` pass is authorized.

## Seeds

Recommended: `/goal` (completion is transcript-observable). The `/loop` alternative is in the ELI5.

```
/goal All 7 phases marked ✓ in implementations-plan/tools-readiness/plan.md (the per-phase headers in the file — not the chat, not the task list), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript (each local suite run quoted with its retry-0 tally and the SHA it ran on); for each phase the agent has printed `LESSONS_FILE=implementations-plan/tools-readiness/lessons/phase-N.md`; `/code-review` was NOT run (plan.md says code_review: off); the codex fix loop converged for each of the three arcs at its boundary AND for the final cross-arc pass, each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; the three-PR stack exists on GitHub, created only after all loops converged (`gh stack view` output in the transcript), each PR's checks watched to a settled PASSING state with the result quoted, and after any sync or rebase the affected arcs' local gates re-run on the new SHA before the re-watch; `bun run test:all` and `bun run lint && bun run lint:actions` both report exit 0 in the transcript on the final SHA; every decision point was settled by a logged codex consult or surfaced per plan.md § Autonomy. Merging is the owner's and is not part of this goal.
```
