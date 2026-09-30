---
plan: send-states
tier: mid
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
same_family_leg: Opus 5.5 subagent
eli5_mode: artifact
eli5: https://claude.ai/artifact/WY5w8GEggYX9zZTEuqBktk (one page for the wave's ten plans)
branch: feat/send-states
worktree: a harness-created agent worktree (its path is recorded in lessons/phase-0.md)
base: dev @ 85c4d20f (#719's squash, on #718's f32b1e0a, tree-identical to 48a97f4a, which the drafts cite)
---

## Outcome

- **Date:** 2026-09-30. **Status:** closed, awaiting archive: delivered on `feat/send-states` and
  pushed. The owner, away, delegated the open UI calls to a panel on 2026-09-29, and the panel
  decided them on 2026-09-30 (§ Decided while the owner was away). The owner confirmed each on
  2026-09-30 (§ Decided while the owner was away).
- **Shipped:** S1 and S2 as planned, P0 to P5, with the panel's picks O1 (a) and O2 (a):
  - S1: when the kernel names a sponsor row's own contract as the payer, the estimate reads that
    contract's public Fee Juice once, in one attempt through the transaction's node aborted at 5 s,
    and compares it with the fee limit as the node's admission check does. A short verdict sets
    the sponsor aside on that card: Send's payer walk goes on as when the sponsor is missing, the
    menu's row reads "can't pay now", and a notice names the payer that takes over ("The sponsor
    can't cover this fee right now, so Public Fee Juice pays it.") or, with none, reads "The
    sponsor can't cover this fee right now." The execute window's Approve waits for a pick. A read
    that fails changes nothing.
  - S2: when the tokens, balances or contacts fail to load, Send's token card reads "Couldn't load
    tokens" / "Retry". A tap, Enter or Space retries, a held key once, and a Retry that succeeds
    lands the token the page was opened for, or the active one.
  - From the codex loop (`lessons/post-impl.md`): a sponsor that is only renamed keeps its short
    verdict; two comments corrected.
  - From the panel: the no-payer notice ends at "The sponsor can't cover this fee right now."
- **Gates at delivery** (`lessons/phase-5.md` § The final gate after the panel): on `1284f741`,
  every local gate exits 0, smoke passes in three shards per browser, and the five network files
  pass on both browsers, all at retry 0. The earlier full gate, on `2a7e4632`, is in
  `lessons/phase-4.md`. The commits after `1284f741` touch only `implementations-plan/`. Codex
  approved in round 3; round 4 asked for three corrections to these docs, all applied, and
  round 5 approved them with no new findings (`lessons/post-impl.md`).
- **Dropped:** O1 (b) and (c) and O2 (b), which the panel did not pick; their three capture-only
  branches were never pushed. A picture of note D, which the capture spec cannot reach cheaply
  (`lessons/phase-5.md`); `send.test.ts` pins it.
- **Open items:** none left here; `follow-ups.md` holds them.
  - § Amounts, sends and fees: F-1 and F-2, and five the panel raised: the execute window has no
    way to get fee juice when nothing can pay; a Confirm before a sponsor-paid estimate returns
    skips the check; a re-enabled Sponsored row reads "free" before it is checked again; the
    notice is not announced; a hand-added sponsor's fallback names "Sponsored".
  - § Wallet safety: the token card's focus style. § ux-feedback: technical: `fee-methods`'
    private Fee Juice flake.

  `lessons.md` § Extension runtime carries one. Reconcile against `dev` at delivery:
  `feat/failed-send-check` conflicts here in `apps/extension/src/core/testing/fake-node-factory.ts`,
  `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.test.ts` and
  `implementations-plan/index.md`; `fix/send-amount-exact` merges clean.
- **Seeds retired:** the `/goal` and `/loop` seeds below are spent; nothing to resume.

# Send states · the sponsor that cannot pay, the tokens that did not load

Two follow-ups #718 left in `implementations-plan/follow-ups.md` § Amounts, sends and fees, as one
PR off `dev`:

- **S1** · Nulo's sponsor is picked without a funding check. An unfunded sponsor's send proves,
  then the node refuses it (`Insufficient fee payer balance`), nothing spent. Send and the
  execute window should know before the proof.
- **S2** · Send's failed token load looks like an empty wallet: "No available tokens" / "Import
  token", as for an account that holds none.

Recon: [`recon.md`](recon.md). Competing outline: `outline-alt.md` (local, never committed).

## Phase 0 (pre-answered by the owner)

No clarifying questions were asked. The owner:

- 2026-09-28: "Can you ultracode 1 to 5 + security and privacy + test rliability + trivial?
  Assigning blueprinting level to each of those and just needing me to answer the open questons
  that it may come."
- 2026-09-29: "Feel free to leverage the gh cli to merge away the branches that you understand are
  ready and feel confident on their implementation. Continue then with ultracodeing the
  follow-ups."
- 2026-09-28: "FYI: use opus5.5 instead of fable please."
- 2026-09-29: "let's cover realistic scenarios lol." and "for next documents please put how it's
  going to look on each choice you are giving me".

The records: for S1, the owner on 2026-09-29, asked whether to add the funding check in #718 or
later, answered "Follow-up (Recommended)" (`ux-owner-picks/plan.md` § Asks → owner, its Fact 16,
`ux-owner-picks/lessons/phase-4.md`). For S2, the owner signed off today's empty state as the state
#718 ships on 2026-09-29, leaving a real error state with a retry as an owner UI decision.

- **Scope**: S1 on Send and the execute window's fee card; S2 on Send's token card.
- **Out**: the Revoke authorizations and authwit registry popups, which estimate nothing (Fact 12;
  F-1); a dApp's embedded fee payment, where the fee card is not shown (Fact 31; F-2); deployment
  checks of a sponsor (#718's I4, unproven); the PrivateFPC's own balance (Decision ledger); an
  automatic retry of the token load (C7); Send's submit and failure path (`failed-send-check`); the
  amount field (`fix/send-amount-exact`).
- **Constraints**: pre-production, no migrations, and nothing new is persisted; complexity budgets
  hold with no new acceptance; no new dependency; the logging policy and `log-payload-ban.test.ts`;
  layer imports; existing testids verbatim; no em dash joining clauses in new copy.
- **Quality bar**: production. **`/harden`**: not scheduled. **`/code-review`**: off.
- **Validation layers**: typecheck and lint, unit, component, CI-gating scripts, build, Storybook
  build; smoke e2e on Chrome and Firefox (the popup's fee card and token card change); the network
  files named in P4 on both browsers.
- **Decisions**: UI and product asks go to the owner, each with a recommendation, a confidence and
  a picture per option; technical asks are decided with `/codex high` and logged in `lessons/`.
- **Delivery**: single arc, one PR off `dev` on `feat/send-states`.

### Phase 0.5 · Tier

| Dimension | Score (0-3) | Why |
|---|---|---|
| Novelty | 1 | A public storage read already exists (`auth-registry.ts:52-65`); the fee card already treats a missing sponsor (#718's O4 (a)); the token card already has states |
| Blast radius | 2 | The FPC strategy and both estimate entry points; one new `NodeFactory` method; the shared fee helpers behind four fee cards; Send's token loader |
| Irreversibility | 0 | Code and tests; nothing stored |
| Migration cost | 0 | Pre-production, no stored shape |
| External coupling | 2 | Fee Juice's balance slot, the kernel's fee payer and the node's admission check, all `@aztec` 5.2.0 |
| Security sensitivity | 2 | Which payer a card picks unasked, what a dApp can make it say, a new node read |

`mid`: two contained changes with known patterns and one new chain read. Nothing here needs
`deep`, and the owner's cap is "never blueprint more than mid, to keep our credits safe".

## Outcome & Quality Bar

For whom: a person on testnet whose shared sponsor has run dry, opening Send or approving a dApp's
transaction; a person whose Send page opened while the wallet's background restarted.

Excellent means:

1. **No proof starts on a sponsor the node will refuse, when the wallet can know.** Every estimate
   a sponsor row pays reads the balance of the fee payer the kernel named in that estimate's final
   simulation, through the node the transaction goes to, and compares it with the transaction's fee
   limit exactly as the node's admission check does (Fact 23). A verdict exists only when that
   payer is the row's own contract. A short sponsor is never the card's automatic choice, and the
   card says in visible text that it cannot pay (per O1). A component test that fails on the base
   proves it, and a network e2e proves it against a real unfunded sponsor, and a real funded one,
   in both browsers.
2. **A probe that could not run changes nothing.** A failed, slow or absent read leaves today's
   behaviour exactly: the sponsor stays usable and nothing is shown. The probe adds at most one
   single-attempt node read to an estimate, aborted at 5 s, and none to a send; no SDK log line
   from it reaches the log buffer.
3. **A verdict describes one transaction and one contract.** It disables the sponsor's row only
   while the transaction it was taken on, and the row's address, are unchanged; after a change the
   row is selectable again, and the person's current payer is never switched back unasked.
4. **A failed token load reads as a failure, with a way out.** The token card says the tokens
   could not load and offers Retry, distinct from an empty wallet; a Retry that succeeds lands the
   normal card, with the token the page was opened for or the one that was active; a held Enter
   or Space retries once.
5. **Nothing a dApp sends can move the automatic payer or the card's words** beyond a truthful
   verdict on its own transaction, and nothing persists past the card.

Good enough: a send confirmed before its first estimate returns proceeds as today; the Revoke
authorizations and authwit registry popups (F-1) and embedded fee payments (F-2) keep today's
behaviour; a token read that hangs shows the skeleton until the port's 60 s timeout (Fact 17),
then the error.

## UI impact

Built as recommended. The owner delegated the open calls to a panel while away (§ Decided while
the owner was away), then confirmed every one on 2026-09-30: each Sign-off cell gives the panel's
call and the owner's confirmation.

| # | Surface | Before → after | Sign-off |
|---|---|---|---|
| 1 | Send's fee card, a sponsor that would pay is short for this send (O1) | "Sponsored" stays selected, "You pay: Nothing ~x FJ"; the send proves and fails → (a) the card sets the sponsor aside: Send's payer walk goes on as when the sponsor is missing (the account's own funded Fee Juice, else the get-gas nudge or "Select method"), and a notice reads "The sponsor can't cover this fee right now, so Public Fee Juice pays it." (the payer's title), or "The sponsor can't cover this fee right now." when none pays. On a private send whose walk lands on Public Fee Juice, Send's existing review sheet opens before the send, as today for that payer | **delegated: O1 (a), unanimous, no-payer copy shortened**; owner confirmed 2026-09-30 |
| 2 | The execute window's fee card, same state (O1) | as row 1, before → (a) "Select method" and the notice; Approve stays disabled until a method is picked (`requiresFeeSelection`, Fact 11) | **delegated: O1 (a), unanimous**; owner confirmed 2026-09-30 |
| 3 | The fee menu's sponsor row while short (O1 (a)) | an enabled row reading "free" → disabled, reading "can't pay now" | **delegated: O1 (a), unanimous**; owner confirmed 2026-09-30 |
| 4 | The same row after the transaction changes (amount, recipient, token, priority) or the row's address is edited in Settings | n/a → enabled again, reading as today; the card's current payer stays; tapping the row makes it the payer and the next estimate reads it again | **delegated: blanket, 2 to 1**; owner confirmed 2026-09-30 |
| 5 | A private send whose private gas is unchecked, with the sponsor short | "Couldn't check your private gas. Pick a fee source to continue." → the sponsor notice in that one row (one notice, never two) | **delegated: blanket, 2 to 1, Codex dissenting**; owner confirmed 2026-09-30 |
| 6 | Send's token card after a refused, timed-out or disconnected load of tokens, balances or contacts (O2) | "No available tokens" / "Import token", and a tap opens the import popup → (a) "Couldn't load tokens" / "Retry", and a tap, Enter or Space retries | **delegated: O2 (a), unanimous**; owner confirmed 2026-09-30 |
| 7 | The same card during and after a Retry (O2) | none → the loading state (skeleton after 300 ms), then the normal card, or the error again | **delegated: O2 (a), unanimous**; owner confirmed 2026-09-30 |
| 8 | Send opened for a token (`?tokenId=`) whose first load failed, or whose tab opened before the wallet's identity settled | no Retry today, and in a cold tab the requested token is lost to the first one → the requested token is selected once the tokens load; after a Retry, the account's active token stays active | **delegated: blanket, 2 to 1**; owner confirmed 2026-09-30 |

Nothing else a user sees changes: with the sponsor funded, the probe unread, or a payer the kernel
names that is not the row's own contract, every fee card is as today; a hand-added sponsor the
person picked is set aside by the same rule and says the same words; the Revoke and registry popups
and embedded payments are unchanged. The fee card's root gains an invisible `data-sponsor-funding`
attribute for e2e.

### UI asks for the owner (built as recommended)

- **O1 · The fee card when the sponsor cannot pay this fee.** (a) **Fall back**: set the sponsor
  aside as if it were missing, and say so; (b) **warn and keep**: the sponsor stays selected with a
  warning ("The sponsor can't cover this fee right now. The network will refuse this send."), and
  Confirm stays enabled; (c) **block Confirm**: (b)'s warning, with Send's Send button and the
  execute window's Approve disabled until another method is picked. Recommended: (a), confidence
  moderate. It reuses a state the owner already signed (#718's O4 (a), "Nulo's sponsor missing"),
  never picks a payer today's walk would not pick without the sponsor, keeps the review sheet in
  front of any payer that names the account, and gets the person to a working send in one step;
  (b) lets a person prove a send the node will refuse; (c) is (a) with an extra tap and a dead end
  when the account has no gas. Pictures: every option in each O1 row of P5's capture list.
- **O2 · The token card when the tokens could not load.** (a) **In the card**: the card's own row
  reads "Couldn't load tokens" / "Retry", in the empty state's type and place; (b) **a page
  banner**: a warning banner above the form, "Couldn't load your tokens", with a Retry action (the
  legal banner's shape, `send.vue:642-644`), and the token card inert. Recommended: (a), confidence
  moderate: the failure sits where the tokens would be, costs no layout shift, and keeps one
  control per job; (b) is louder than a failure that a tap fixes. Pictures: both options beside
  today's empty card, per P5.
- **The blanket sign-off** covers UI impact rows 4, 5 and 8 (each pictured in P5) and these lines:
  the notice and menu copy as pictured; a sponsor row re-enabled after a change is not selected
  again unasked; Retry is manual, with no automatic retry; **one error state for the three reads**:
  a refusal of tokens, balances or contacts shows the same failed card, because two of the
  requests can straddle a background restart (one answers before the other's port disconnects,
  Facts 17, 27) and the page cannot send without all three; a token added from another window while
  the load has failed retries the load; the Revoke and registry popups and embedded payments
  unchanged (F-1, F-2); a send confirmed before its first estimate returns proceeds as today.

### Decided while the owner was away (delegated)

The owner, 2026-09-29: "any chance your resolve auditing with Codex and Opus5.5 subagents the open
artifacts? Ask those subagents to be evaluators on the ux/ui/copies. Use your knowledge about my
previous decisions too."

The panel, on 2026-09-30: two Opus 5.5 evaluators, one reading interaction and one craft, and
Codex (session `01a0efb6-50a4-7ff0-a6ff-6b4cd49cc1f7`), each judging the page
https://claude.ai/artifact/61MuSd62Gjq2qEUbG6fnG1 against the owner's earlier picks. These are
delegated decisions the owner can overturn, not the owner's sign-off, and nothing merges before
the owner confirms them.

- **O1: (a), unanimous, with one copy change.** The no-payer notice "The sponsor can't cover this
  fee right now. Pick another way to pay." becomes "The sponsor can't cover this fee right now."
  With no fee juice and no sponsor added by hand, every row of the menu is disabled, so the
  instruction cannot be followed; either way, "Select method" already asks for the pick. The
  fallback "…, so {payer} pays it." stays.
  Declined: Codex's "You'll pay with Public Fee Juice.", one vote, with "You pay" right under it.
  Built red first (`lessons/phase-5.md`).
- **O2: (a), unanimous.** "Couldn't load tokens" / "Retry" stays. Declined: Codex's "Couldn't load
  send details". The realistic failure, a background restart, takes the three reads together, and
  Retry repeats all three, as the blanket's one error state has it.
- **The blanket: signed two to one** (rows 4, 5 and 8 and the lines above). Codex dissented on row
  5: the failed private-gas check is hidden while the sponsor notice shows. Both Opus evaluators
  checked that the fee menu still marks Private Fee Juice "couldn't check balance"
  (`apps/extension/src/popup/components/modules/send/fee-helpers.ts:290-292`), so the one notice
  loses nothing.
- **Note D, corrected.** Tokens are stored per profile and network, not per account (`getTokens`,
  `apps/extension/src/wallet/services/token/service.ts:220-224`), so it reads: on a profile or
  network with no tokens, the first token added becomes the active one. The blanket covers it; it
  is not pictured (`lessons/phase-5.md`).
- **Raised by the panel, now in `follow-ups.md`:** the execute window's missing way to get fee
  juice; a Confirm before a sponsor-paid estimate returns; the re-enabled row's "free"; the
  notice's missing live region; a hand-added sponsor's fallback naming "Sponsored"; the token
  card's focus style.

**The owner's sign-off, 2026-09-30.** On the decision page
(https://claude.ai/artifact/61MuSd62Gjq2qEUbG6fnG1) the owner answered O1 (a), O2 (a) and the
blanket "signed", then wrote: "Okei, ive answered everything on the artifacts." Each surface in
§ UI impact now carries the owner's own answer.

## Architecture & Implementation

### S1 · The sponsor probe

- **What "funded" means.** The node's admission check refuses a transaction when its fee payer's
  public Fee Juice balance, plus any Fee Juice claim the same transaction makes to that payer, is
  below `gasSettings.getFeeLimit().toBigInt()`, Σ `maxFeesPerGas × gasLimits`, and accepts at
  equality (Facts 4, 23). A sponsor-paid transaction from Nulo never claims to the sponsor, so a
  sponsor is **funded for an estimate** when its balance is at least that estimate's fee limit, and
  **short** otherwise. No floor and no zero test (Inference I2). Nulo's displayed `maxFee` adds the
  teardown limits again (Fact 4), so it is not the comparison.
- **Who pays.** The kernel's `publicInputs.feePayer` on the strategy's final simulation (Fact 24),
  the value the node validates, never inferred from the row: a hand-added row is accepted on its
  function's name and signature alone (Fact 25), so its `sponsor_unconditionally` may hand the payer
  role elsewhere. A verdict exists only when that payer equals the row's own address; otherwise no
  probe runs and the card behaves as today.
- **How it is read.** Not through `built.node`: that client retries with 60 s attempts, so losing
  a race leaves its requests running, and the SDK logs a malformed body and a fetch error at `warn`,
  which every user's exportable log keeps (Fact 33). Instead, one abortable, single-attempt read:
  - `NodeFactory.readPublicStorageOnce(rpcUrl, contract: AztecAddress, slot: Fr, timeoutMs):
    Promise<Fr>` (`packages/aztec-runtime/src/ports/node-factory-port.ts`), beside `probeChainId`
    and with its contract: one non-retrying attempt whose abort fires at `timeoutMs` and covers the
    body read (`makeSingleAttemptFetch`, `utils/fetch.ts:34-69`, `:100-102`), so nothing outlives
    the probe. The adapter builds that client as `createAztecNodeClient` does
    (`createSafeJsonRpcClient(rpcUrl, AztecNodeApiSchema, { namespaceMethods: "aztec", fetch })`,
    `@aztec/stdlib` 5.2.0 `dest/interfaces/aztec-node.js:371-383`) plus the `log` option
    `createAztecNodeClient` cannot pass: `SILENT_RPC_LOG`, a `Logger` whose every level is a no-op,
    exported for its test. `FakeNodeFactory` and the double at `pxe/chain-runtime.test.ts:57` gain
    the method.
  - `NetworkService.readPublicStorageOnce(network, contract, slot, timeoutMs)`: the passed row's
    primary endpoint URL, resolved as `getNode` does (`network/service.ts:763-765`), through its
    `nodeFactory`. The executors pass `built.network`, the row the build asserted, so the read goes
    to the endpoint the transaction goes to. It is not in `rpcMethods` (`:167-186`), so no popup can
    call it. The two executors' deps gain it, wired in `execution/service.ts` beside `getNode`
    (`:344`, `:397`).
  - `readPublicFeeJuiceBalance(read, network, owner: AztecAddress, timeoutMs): Promise<bigint>` in
    `apps/extension/src/wallet/utils/fee-juice.ts`:
    `read(network, AztecAddress.fromNumberUnsafe(FEE_JUICE_ADDRESS), await computeFeePayerBalanceStorageSlot(owner), timeoutMs)`,
    `.toBigInt()`. The slot function is the one the node's check and the simulator use (Fact 7); the
    node API takes an `AztecAddress`, not the string `feeJuiceAddress` export (Fact 7). The storage
    read of `auth-registry.ts:52-65` (Fact 6). No new endpoint, no account, no PXE queue.
- **Which rows.** `DefaultSponsoredFpc` rows, Nulo's or added by hand, subject to the payer check.
  Not a PrivateFPC (Decision ledger), not Fee Juice, not an embedded payment (F-2).
- **Where.** The strategy names the sponsor, the estimate entry points read it:
  - `FeeEstimate` (`fee/fee-strategy.ts:72-74`) gains `sponsor?: { fpcId: string; address: AztecAddress }`.
    `FpcStrategy` sets it at each path's return (`fpc-strategy.ts:185`, `:290`), from the last
    `simulatedTx` of that path (`:142`/`:157` fast, `:265` Pass 2), when
    `fpc.infoData.type === FpcType.DefaultSponsoredFpc` and `simulatedTx.publicInputs?.feePayer`
    equals the row's address. No I/O: the strategy also builds every send (`transfer-executor.ts:317`),
    which must not pay for a read nobody uses.
  - New `apps/extension/src/wallet/services/execution/sponsor-funding.ts`:
    `probeSponsorFunding(built, read, log): Promise<SponsorFunding | undefined>`. Undefined when
    `built.sponsor` is absent; otherwise `readPublicFeeJuiceBalance(read, built.network,
    built.sponsor.address, SPONSOR_PROBE_TIMEOUT_MS = 5_000)`, then `{ fpcId, address:
    built.sponsor.address.toString(), funded: balance >= built.txRequest.txContext.gasSettings.getFeeLimit().toBigInt() }`.
    A rejection, the transport's abort included (`fetch.ts:74-79`), is undefined; no local race.
    One `debug` line per probe, a fixed shape `("sponsor probe", { outcome })` with `outcome` one of
    `funded`, `short`, `failed`: no error object (an RPC message can carry addresses, figures or
    the endpoint URL, Fact 26), no balance, limit or address.
  - `transfer-executor.ts` `estimateFee` and `dapp-send-executor.ts` `estimateOperationFee` call it
    after the build's `checkCancelled()` and before the reuse stash, then `checkCancelled()` again,
    so a cancelled estimate still leaves nothing cached (`transfer-executor.ts:343-356`); they
    spread `sponsorFunding` into the result when defined (returns at `:414-419`, `:336-344`).
- **The wire.** `TransferFeeEstimate` (`packages/wallet-bridge/src/fee.ts:46-75`) gains
  `readonly sponsorFunding?: { readonly fpcId: string; readonly address: string; readonly funded: boolean }`.
  TSDoc, one sentence: set only when the row's own contract, at `address`, pays and its balance was
  read; absent means unknown, which must never disable a sponsor, since a failed read is not an
  empty one.
- **Cost and caching.** One `getPublicStorageAt` per sponsored estimate, after the build (itself
  one to several simulations), on its own short-lived client. No cache: a cached balance of a
  shared sponsor that others drain is the staleness this exists to remove.
- **When it runs.** On every estimate a sponsor row pays: on Send once the form can estimate, again
  on each change; in the execute window per operation. Not at Confirm: the Confirm reuses the
  estimate (`estimateId`), and Send's Confirm never waited for an estimate (Fact 13).

### S1 · What the fee card does (O1 (a) as built)

- **Two card-local sets, never stored.** In `FeeSettingsCard.vue`:
  - `shortSponsorIds`: ids with a short verdict on the current transaction. Their rows are
    disabled ("can't pay now").
  - `setAsideSponsorIds`: ids with a short verdict anywhere on this card. Never selected unless the
    person taps that row after the verdict.
  A watch on `props.feeEstimate?.sponsorFunding` whose `fpcId` is a row of `methods` and whose
  `address` is that row's current address (`sameFieldAddress`, `@nulo/wallet-bridge`,
  `field-address.ts:26-29`): `funded: false` adds the id to both; `funded: true` removes it from
  both; an id the card does not hold, or an address the row no longer has, is ignored. An address
  edit of a held row (`onFpcUpdated`, `FeeSettingsCard.vue:338-349`, before its Send early return;
  `updateFpcAddress` keeps the id, `fpc/service.ts:375-381`) empties `shortSponsorIds` of that id
  only: the row is enabled again and, still set aside, is not selected unasked. A **genuine
  change** empties `shortSponsorIds` only: `selectedPriority`, or the new prop `txShape` (String,
  default `""`; Send passes token id, transfer type, recipient and integerized amount, the inputs
  of its estimate watch at `send.vue:478-505` without `feeSettings`; the execute window passes
  none, its transaction being fixed). The priority watcher's comment (`FeeSettingsCard.vue:682-688`,
  "No imperative work needed") becomes the invariant it now keeps: a priority change is a new fee
  limit, so a short verdict no longer describes it. The re-estimate the fallback itself triggers
  changes only the fee settings, so it clears nothing and cannot loop. An identity-key change
  (profile, network, chain, account, compared as the key at `FeeSettingsCard.vue:697`, not on every
  object replacement of the watch at `:689-701`) and unmount empty both. `handleMethodPicked` on a
  sponsor removes its id from `setAsideSponsorIds`.
- **The helpers honour them.** `buildFeeMethods` (`fee-helpers.ts:179-207`) takes
  `options.shortSponsorIds` and `options.setAsideSponsorIds`; a sponsor row in the first gets
  `disabled: true`, `disabledReason: "can't pay now"`, a row in the second `setAside: true`. Three
  readers skip a disabled or set-aside sponsor, as they already skip disabled self-paid rows
  (Fact 10):
  - `defaultSponsor`, so Nulo's short sponsor reads as missing, #718's O4 (a): Send's walk goes on
    (`fee-privacy.ts:63-86`), the other cards open on "Select method". Its comment (`:218-219`,
    "not by whether it can pay") is rewritten to say so;
  - `isEligible`'s `fpc` case, so a saved pick of it is walked past (never rewritten,
    `fee-privacy.ts:108-115`);
  - `resolveSavedSelection`'s `fpc` case, so a recovery recommit cannot reselect it.
  `FeeKnowledge` carries both sets so `resolveSendSelection` builds the same rows (`:108-110`).
  `FeeMethodSelector.vue` needs no edit: it draws a disabled row with its reason (Fact 10).
- **Non-Send cards**: when a short verdict names the selected method's id, `selectedMethod` becomes
  `undefined`, whatever `chosenUnasked` says: a pick of a contract that cannot pay is dropped too,
  and the saved record stays (`:346-348` is the precedent). The execute window's parent clears
  `op.feeSettings` on that `undefined` and Approve disables (`execute/index.vue:474-478`, `:584`).
- **The notice** (testid `fee-sponsor-short`, the `info` icon, the degraded row's text style,
  `:797-802`) shows only when the sponsor would have paid: on Send, the selection resolved with both
  sets empty names an id in `shortSponsorIds`; on the other cards, the selection was dropped for a
  verdict and nothing was picked since. Text per UI impact row 1: with an effective method, "The
  sponsor can't cover this fee right now, so {title} pays it."; without one, "The sponsor can't
  cover this fee right now." While it shows, `statusNotice` drops
  `PRIVATE_GAS_UNCHECKED` (`:376-384`), so a private hold shows one row, not two; a fee-data error
  (`error.value`) keeps its row. The nudge (`:813-826`) shows beside it when Send reaches `none`.
- **Comments.** The `methods` comment's history clause (`FeeSettingsCard.vue:111`, "This honors PR
  #66's stated intent.") goes.
- **`data-sponsor-funding`** on the `fee-settings-card` root (beside `data-origin`, `:747`):
  `funded` or `short` for the last verdict on the effective or dropped sponsor, absent otherwise.
  Invisible; it lets P4 prove a real `funded: true` read.
- **The execute window** mounts the same card with the dApp estimate (`OperationCard.vue:301-311`),
  which carries the verdict from `estimateOperationFee`: covered with no window change.
- **Not covered**: the Revoke and registry popups pass no estimate (Fact 12, F-1); an embedded
  payment hides the card (Fact 31, F-2).

### S2 · The token card's load error (O2 (a) as built)

- **`send.vue`**:
  - `tokensFailed = ref(false)`. `refetchIdentityScopedState` (`:530-574`) sets it `false` at its
    start, before the incomplete-identity return (`:534-541`), so an identity switch after a failure
    never leaves the old error; in a new `catch` it sets it `true` when the fetch is still current,
    then rethrows to today's callers, which log at `debug` (`:110`, `:580`, `:591`). One flag for
    the one `Promise.all` of tokens, balances and contacts (`:551-555`): three ports to one
    background (Fact 27), where a restart can refuse one request after another has answered
    (Fact 17), and the page cannot send without all three; one error state serves every such
    failure (blanket).
  - `retryTokens()`: `refetchIdentityScopedState().catch(onReadFailed)`. The card is inert while
    loading, so a second tap during a Retry does nothing.
  - `onTokenAdded` (`:94-100`) calls `retryTokens()` while `tokensFailed`, so a token added from
    another window never lands beside the failed load's empty balances.
  - The mount's `?tokenId=` preselect (`:596-601`) moves into `applyQueryToken()`, consumed once on
    the first successful load, called where `applyQueryContact()` is (`:565`), the same pattern; it
    clears `awaitingNewToken` when it applies. The mount sets `awaitingNewToken` (`:603-605`) only
    when the load succeeded and came back empty, and a Retry that succeeds empty sets it the same
    way. Otherwise the tokens watch (`:468-476`) would move the active token to the first one after
    a Retry or a late identity, over the requested or active token (Fact 28).
  - The mount's stale comment (`:588-590`, "A refused read leaves the page as an empty load does")
    goes.
  - `<SelectTokenCard :failed="tokensFailed" @retry="retryTokens" …>` (`:671`).
- **`SelectTokenCard.vue`**: prop `failed` (Boolean, default false) and emit `retry`. `state` gains
  `failed` (a token wins, then loading, then failed, then empty), exposed as `data-state="failed"`
  on `send-token-trigger`. In that state `handleSelectToken` emits `retry` instead of opening
  `new_token`, the row keeps `role="button"` and `tabindex="0"`, and its text is "Couldn't load
  tokens" / "Retry" in the empty state's two classes (`:183-199`). Its Enter and Space handlers
  (`:67-68`) ignore an event for which `isRepeatOrComposing` is true (`composables/usePopupEntity.ts:5-7`,
  the shared guard), so a held key cannot retry again after a fast rejection. If `keyboard-guards`
  lands a replacement for that export first, the card uses the replacement.
- **Not an error**: an incomplete identity (tokens cleared), a successful empty read, and a failed
  re-read after a token-added event on a loaded list (`reloadTokens`, `:103-109`), which keeps the
  loaded list.

### File-level change map

| File | Change |
|---|---|
| `packages/aztec-runtime/src/ports/node-factory-port.ts`, `adapters/aztec-node-factory-adapter.ts` | `readPublicStorageOnce`, `SILENT_RPC_LOG` |
| `apps/extension/src/core/testing/fake-node-factory.ts`, `packages/aztec-runtime/src/pxe/chain-runtime.test.ts` | the doubles gain `readPublicStorageOnce` |
| `apps/extension/src/wallet/services/network/service.ts` | `readPublicStorageOnce(network, …)`, outside `rpcMethods` |
| `apps/extension/src/wallet/services/execution/service.ts` | wire the executors' new dep |
| `apps/extension/src/wallet/utils/fee-juice.ts` | `readPublicFeeJuiceBalance` |
| `apps/extension/src/wallet/services/execution/fee/fee-strategy.ts` | `FeeEstimate.sponsor?` |
| `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts` | set `sponsor` from the final simulation's fee payer |
| `apps/extension/src/wallet/services/execution/sponsor-funding.ts` (new) | the probe |
| `apps/extension/src/wallet/services/execution/transfer-executor.ts`, `dapp-send-executor.ts` | call the probe between cancellation checks, spread the field; drop the review reference at `transfer-executor.ts:372-373` |
| `packages/wallet-bridge/src/fee.ts` | `TransferFeeEstimate.sponsorFunding?` |
| `apps/extension/src/popup/components/modules/send/fee-helpers.ts` | the two sets, disabled and set-aside sponsor rows, the three readers, `defaultSponsor`'s comment |
| `apps/extension/src/popup/components/modules/send/fee-privacy.ts` | `FeeKnowledge` sets, `isEligible` |
| `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue` | the sets, the watches, the address binding, `txShape`, the drop, the notice, `data-sponsor-funding`, the two comments |
| `apps/extension/src/popup/pages/send.vue` | `tokensFailed`, `retryTokens`, `applyQueryToken`, `awaitingNewToken`, `onTokenAdded`, `txShape` |
| `apps/extension/src/popup/components/modules/send/SelectTokenCard.vue` | `failed`, `retry`, the repeat guard |
| `UPDATE.md` | § Types coupled to `@aztec` shape: `computeFeePayerBalanceStorageSlot`, `GasSettings.getFeeLimit()`, `TxSimulationResult.publicInputs.feePayer`, `createSafeJsonRpcClient`'s `log` option with `AztecNodeApiSchema`, and the admission rule of Fact 23 |
| tests | P1 to P4 |

### Trade-offs and alternatives not taken

- **A third gas-balance leg read by the card** (`outline-alt.md`): reaches the popups that estimate
  nothing and could speak before the first estimate, but only on an exact zero, from a 5-minute
  cache, with the fee limit rebuilt in the popup, and widens the `GasBalances` wire every gas
  consumer reads. Both audits prefer the main outline.
- **A probe inside the strategy**: one call site, but it would read on every send too (Fact 5).
- **The build's own node with a local race**: fewer lines, but the lost race leaves a retrying
  60 s request running and the SDK's `warn` lines in the user's log (Fact 33).
- **Probing the row's address**: simpler, but reads the wrong balance for a delegating contract
  (Fact 25); the kernel's payer costs a few lines more.
- **The `balance_of_public` view** (`gas-balance-reader.ts:172-179`): no slot to get wrong, but it
  needs an account's view deps and a simulation; the storage read uses the node's own slot function.
- **A page-lifetime verdict**: simpler, but it keeps a sponsor disabled after the transaction that
  was short is gone, with no way back for a person with no gas short of reopening the page.
- **Refusing at Confirm in the background**: the node refuses anyway, and a refusal before the
  proof without a card state is a worse failure message; (c) of O1 is the visible form of it.
- **An automatic retry of the token load** (C7): hides a transient restart, at the cost of a timer
  and a second sequence guard for a rare failure one tap fixes.

## Security & Adversarial Considerations

- **Threat model.**
  - A dApp shapes its transaction (gas, custom limits within the admission cap) so the sponsor reads
    short: the card sets the sponsor aside for that one operation card. The verdict is true for that
    transaction, card-local and never stored, so it cannot reach Send or another window. A dApp
    cannot make a short sponsor read funded: the wallet reads the chain through the profile's node,
    for the payer the kernel named on the wallet's own build, keyed by the wallet's own row id and
    that row's address, so a verdict never outlives an address edit of its row.
  - A contract that passes the sponsor validation but delegates payment (Fact 25) gets no verdict,
    so its own balance can neither disable a working payer nor vouch for one.
  - A dApp or a hostile row cannot pose as Nulo's sponsor: identity stays `isProtocol`, derived
    from the address (`fpc/service.ts:108-114`), and a hand-added sponsor is never an automatic
    choice (#718's rule). The fallback can only remove a sponsor, never add one, and a payer that
    names the account still goes through the review sheet (`send.vue:389-392`).
  - dApp-supplied strings (`dapp.name`, call args, fee options) never reach the verdict or the
    notice: the verdict is two wallet-computed fields and the notice's `{title}` is the wallet's own
    row title. P2 pins it with a wire-shaped case.
  - The probe's read tells the node provider the wallet looked at a sponsor's public balance: it
    goes to the endpoint the transaction goes to (`built.network`'s primary), names only the Fee
    Juice contract and a slot derived from the sponsor's public address, and carries no user field.
    No new party; the transaction that follows names that sponsor as fee payer to the same node.
  - A lying endpoint could report a funded or empty sponsor; it already controls every chain read
    the wallet makes, and the node that validates is the same one.
  - S2 adds no data flow: Retry repeats the same three reads.
- **Input validation.** The card matches `fpcId` and `address` against its own rows and ignores a
  verdict naming a row it does not hold or an address that row no longer has; a superseded estimate never reaches the card (Fact 30).
- **Least privilege, cryptography, supply chain.** No permission, credential, crypto or dependency
  change. `@aztec/protocol-contracts` and `@aztec/stdlib` stay at the exact-pinned 5.2.0, already
  direct dependencies, the first already bundled (Fact 7).
- **Logging.** One fixed-shape `debug` line per probe (`{ outcome }`), no error object, balance,
  fee limit or address; P1 proves it through the real `trim()` projection; `log-payload-ban.test.ts`
  scans the new file. The probe's client logs to `SILENT_RPC_LOG`, so the SDK's `warn` of a
  malformed body or a failed fetch, and its `debug` of params and results, never reach
  `console.*` (Fact 33; the endpoint URL can carry a provider key, `network/service.ts:100`,
  `:109`); P1 proves it at the transport. The token card's failure keeps the existing `debug`
  line.
- **Storage.** Nothing written, nothing new read.
- **Coupling.** A future `@aztec` bump that moves Fee Juice's slot, the payer field or the node's
  check: the slot comes from the protocol's own function, P1 pins it against the literal map slot,
  the funded e2e reds on a wrong read (it requires `funded`), and `UPDATE.md` lists all three.

## Assumptions

### Facts (verified at `f32b1e0a` by reading the file; #719's `85c4d20f` touches none of them but `FeeMethodSelector.vue`, Facts 10 and 22)

1. Discovery registers the protocol sponsor with the local PXE and stores its row with no
   deployment or funding check (`apps/extension/src/wallet/services/fpc/service.ts:163-173`,
   `:205-240`).
2. The protocol sponsor takes the single-pass path when the dApp set no custom limits
   (`fee/fpc-strategy.ts:111-118`, `:103-104`), whose simulation passes `skipFeeEnforcement: true`
   (`:142` via `fee/fee-strategy.ts:167`); the two-pass sims pass it too (`fpc-strategy.ts:211`,
   `:265-270`). So no estimate sees the payer's balance.
3. Send's default sponsor and the other cards' come from `defaultSponsor`
   (`popup/components/modules/send/fee-helpers.ts:218-222`, used at `fee-privacy.ts:50` and
   `FeeSettingsCard.vue:449-451`), by identity only.
4. `GasSettings.getFeeLimit()` is Σ `maxFeesPerGas × gasLimits` and returns an `Fr` (`@aztec/stdlib`
   5.2.0, `dest/gas/gas_settings.js:56-57`); Nulo's `getEstimatedFee` goes through `computeMaxFee`,
   which adds the teardown limits to the gas limits (`execution/tx-fee-details.ts:14-21`,
   `utils/fee-estimation.ts:41-49`).
5. Every strategy returns the node it built against (`FeeEstimate extends BuiltStandardTx`,
   `fee/fee-strategy.ts:72-74`; `node` at `tx-request-builder.ts:72-74`), passed through unchanged
   by the estimate wrapper and the discovery decorator (`execution/service.ts:1080-1112`,
   `discovery-aware-estimator.ts:118`, `:135`). The strategy also builds the send
   (`transfer-executor.ts:317`), not only the estimate (`:355`).
6. A public storage read through the node already exists: `isAuthwitConsumable` and
   `isAuthRegistryEnabled` (`apps/extension/src/wallet/utils/auth-registry.ts:52-65`), with a
   comment recording that a wrong slot there once read the wrong map (`:9-16`).
7. `computeFeePayerBalanceStorageSlot(feePayer)` derives the fee payer's balance slot from the Fee
   Juice artifact's `balances` slot (`@aztec/protocol-contracts` 5.2.0, `dest/fee-juice/index.js:18-20`),
   and the simulator charges fees through it (`@aztec/simulator` 5.2.0,
   `dest/public/public_tx_simulator/public_tx_simulator.js:336`). `@aztec/protocol-contracts` is a
   direct dependency (`apps/extension/package.json:45`) and its `fee-juice` entry is already bundled
   (`packages/aztec-runtime/src/pxe/artifact-catalog.ts:6`). `feeJuiceAddress` is exported as a
   string (`wallet/utils/fee-juice.ts:7`), while `getPublicStorageAt` takes an `AztecAddress`
   (`@aztec/stdlib` 5.2.0, `dest/interfaces/aztec-node.d.ts:335`). aztec.js's `getFeeJuiceBalance`
   uses a literal `new Fr(1)` and carries a "TODO: Consider nuking" (`@aztec/aztec.js` 5.2.0,
   `dest/utils/fee_juice.js:4-9`).
8. The account's gas read logs only whether each leg read and is funded, never amounts
   (`execution/gas-balance-reader.ts:197-200`).
9. `TransferFeeEstimate` is plain JSON with optional fields (`packages/wallet-bridge/src/fee.ts:46-75`),
   returned by `transfer-executor.ts:414-419` and `dapp-send-executor.ts:336-344`.
10. `buildFeeMethods` never disables a sponsor row (`fee-helpers.ts:195-203`) but disables self-paid
    rows with a reason (`:230-274`); `FeeMethodSelector.vue:57-67` draws a disabled row with its
    reason (`:57-68` at `85c4d20f`); `resolveSavedSelection` honours `disabled` for `fj` and `private_fpc` and not for `fpc`
    (`fee-helpers.ts:148-161`); `isEligible`'s `fpc` case is `Boolean(method.fpc)`
    (`fee-privacy.ts:33-34`).
11. The execute window mounts the card with its estimate (`popup/windows/execute/OperationCard.vue:301-311`);
    an `undefined` from the card clears `op.feeSettings` (`popup/windows/execute/index.vue:474-478`)
    and its Approve waits for a method (`requiresFeeSelection`, `:492`, `:584`).
12. The Revoke and registry popups mount the card with no estimate
    (`RevokeAuthwitsPopup.vue:207-216`, `ChangeAuthwitsRegistryPopup.vue:111-116`) and send with the
    settings directly (`ChangeAuthwitsRegistryPopup.vue:59`).
13. Send's submit gate needs fee settings, not an estimate (`popup/pages/send.vue:276-284`,
    `:369-382`); the estimate is `null` while pending or after a failure
    (`composables/useFeeEstimation.ts:35-36`).
14. A refused token read is logged at `debug` (`send.vue:110`); the identity fetch clears the list,
    runs tokens, balances and contacts in one `Promise.all`, and ends loading in `finally`
    (`:546-573`), so a rejection leaves an empty, settled list; the `?tokenId=` preselect runs once,
    at mount, after the first fetch (`:596-601`).
15. The token card draws "No available tokens" / "Import token" for an empty, settled list, and a
    tap opens `new_token` (`SelectTokenCard.vue:21-22`, `:37-44`, `:106-109`); it ignores a tap
    while loading (`:38`).
16. `send.test.ts` pins today's refused-read empty card (`:809-829`, `:858-870`, `:879-887`,
    `:889-913`), through a stub exposing `data-loading` and `data-symbol` (`:141-144`).
17. On a disconnect the popup's port rejects every pending request and reconnects at once
    (`packages/extension-messaging/src/background/client.ts:80-93`, `onDisconnect` at `:94-97`); a
    request times out at 60 s (`:17`). Each read has its own port (Fact 27), so one request can
    answer before a restart and another be refused by it.
18. `withTimeout` lives in a popup store and is auto-imported (`stores/balances.store.ts:124-138`,
    `types/auto-imports.d.ts:336`); the probe no longer needs a race (§ S1 How it is read).
19. A lock leaves the page: the locked state routes to `/popup/auth` or `/popup/register`
    (`popup/locked-state.ts:29-32`); `getTokens` reads storage with no session check
    (`wallet/services/token/service.ts:220-227`).
20. `addFpc` needs the instance and artifact in the local PXE (`fpc/service.ts:266-274`), whose
    `getContractInstance` reads its own store only (`@aztec/pxe` 5.2.0, `dest/pxe.js:365-366`).
21. The e2e harness caps its sponsored setup transactions "under the SponsoredFPC fee-juice balance
    (cap × gasLimit)" (`apps/extension/tests/e2e/fixtures/aztec.ts:133-142`).
22. Every fee menu row carries `data-fpc-id` (`FeeMethodSelector.vue:59` at `85c4d20f`, #719).
23. The node's admission check reads the fee payer's balance at
    `computeFeePayerBalanceStorageSlot(tx.data.feePayer)`, adds the amount of a setup-phase Fee Juice
    `_increase_public_balance` claim to that payer, and refuses when the sum is below
    `gasSettings.getFeeLimit().toBigInt()`, with the text `Insufficient fee payer balance
    (required=<fee limit>, available=<balance>)` (`@aztec/p2p` 5.2.0,
    `dest/msg_validators/tx_validator/gas_validator.js:166-187`, `fee_payer_balance.js:9-20`). Read
    from the published 5.2.0 tarball (`npm pack @aztec/p2p@5.2.0`); the package is not in this
    repo's install.
24. A simulation result carries the kernel's fee payer: `TxSimulationResult.publicInputs:
    PrivateKernelTailCircuitPublicInputs`, whose `feePayer: AztecAddress` (`@aztec/stdlib` 5.2.0,
    `dest/tx/simulated_tx.d.ts:124-126`, `dest/kernel/private_kernel_tail_circuit_public_inputs.d.ts:71`),
    the same `tx.data.feePayer` Fact 23 checks. `FpcStrategy`'s last simulation per path is at
    `fpc-strategy.ts:142`/`:157` (fast) and `:265` (Pass 2), both with the fee payload included.
25. A `DefaultSponsoredFpc` row is typed by the name `sponsor_unconditionally` and validated by its
    empty parameter and return lists only (`fpc/service.ts:421-423`,
    `fpc/handlers/default-sponsored-fpc-handler.ts:9-17`): nothing proves the contract pays itself.
26. The logger's `trim()` keeps an error's message, reducing only URLs to their origin
    (`wallet/logger/utils.ts:160-175`).
27. Tokens, balances and contacts each open their own port (`send.vue:88`, `:135`, `:188`;
    `extension-messaging/src/background/client.ts:66`) to the one background.
28. The mount sets `awaitingNewToken` whenever the list is empty (`send.vue:603-605`), and the
    tokens watch then moves `activeTokenIdx` to the first token on the next non-empty list
    (`:468-476`).
29. The identity watch fires on any replacement of the profile, network or account objects and
    compares a key only to close the gate (`FeeSettingsCard.vue:689-701`, key at `:697`); a private
    hold shows `PRIVATE_GAS_UNCHECKED` in `fee-init-degraded` (`:376-384`, `:797-802`).
30. The fee-estimation engine drops a superseded run's result and failure
    (`composables/internal/fee-estimation-engine.ts:103-110`, `:205-212`).
31. An embedded fee payment pre-fills `{ kind: "embedded" }` and hides the fee card behind "Fee
    payment method set by …" (`popup/windows/execute/index.vue:349-361`, `OperationCard.vue:292-312`);
    a wallet-sdk dApp's fee payer arrives as `embeddedFeePayment: "fpc"`
    (`execution/operation-planner.ts:95`) and is estimated by `EmbeddedStrategy`, not `FpcStrategy`.
32. `test:all`, `typecheck:all` and `test:ci-gating` are root scripts (`package.json:28-31`);
    `apps/extension/package.json:8-30` has none of them.
33. The build's node client retries (`makeFetchWithTimeout`: 60 s attempts, backoff 1, 2, 3 s,
    `packages/aztec-runtime/src/utils/fetch.ts:18`, `:112-122`, used at
    `adapters/aztec-node-factory-adapter.ts:55`), and a lost race does not abort it. The SDK client
    logs a malformed response with its body at `warn` (`@aztec/foundation` 5.2.0,
    `dest/json-rpc/client/safe_json_rpc_client.js:75-77`), a failed fetch with its error at `warn`
    (`:124`), and each request's params and result at `debug` (`:164-166`), to its own logger unless
    `config.log` is passed (`:29`); `createAztecNodeClient` passes none (`@aztec/stdlib` 5.2.0,
    `dest/interfaces/aztec-node.js:371-383`). In the extension that logger is pino's browser build at
    `LOG_LEVEL: "verbose"` (`pino-logger.js:261-268`; `apps/extension/vite.config.ts:323-326`), which
    writes through `console.*`, which the sniffer captures (CLAUDE.md § Logging policy). A
    single-attempt client already exists for `probeChainId` (`aztec-node-factory-adapter.ts:58-68`,
    `node-factory-port.ts:26-34`).
34. `updateFpcAddress` replaces a row's address under the same id and emits `onFpcUpdated`
    (`fpc/service.ts:375-381`); the card's handler records the edit and returns early on Send
    (`FeeSettingsCard.vue:338-341`).
35. The card's Enter and Space handlers fire on every keydown (`SelectTokenCard.vue:67-68`);
    `isRepeatOrComposing` (`composables/usePopupEntity.ts:5-7`) already guards two popups
    (`ChangeAuthwitsRegistryPopup.vue:123`, `RevokeAuthwitsPopup.vue:250`).
36. Already covered today, so regression controls here: a token drawn over loading
    (`SelectTokenCard.test.ts:65-70`), a successful empty read ending on the empty card
    (`send.test.ts:872-877`).

No test was run for this draft; Fact 23 was read from the unpacked tarball.

### Inferences (unverified; audits attack these)

1. **I1** is now Fact 23.
2. **I2.** A drained sponsor stops at a residual below one fee limit rather than at zero: each
   accepted transaction needs balance ≥ limit (Fact 23) and pays the actual fee, which is at most the
   limit. How often it sits at exactly zero is unknown; the comparison needs no case for it.
3. **I3** (withdrawn by the final pass). Not every estimate runs a public simulation: the PXE
   runs it only when `publicInputs.forPublic` is set (`@aztec/pxe` 5.2.0 `dest/pxe.js:799`), and
   folded discovery also sets `skipTxValidation` (`fee/fee-strategy.ts:163`). The privacy argument
   (§ Security) no longer rests on it.
4. **I4.** The playground's `registerContract` registers a salt-1 SponsoredFPC instance in the
   wallet's PXE with no on-chain deployment, and a two-pass estimate for it succeeds under
   `skipFeeEnforcement` with the kernel naming it as fee payer. Settled first, in P1 step 0, or C8's
   fallback.
5. **I5.** `getPublicStorageAt("latest")` reads the balance the node's validator reads, less any
   spend still in the mempool, a race no read closes (Decision ledger).
6. **I6.** A Send page opened during a background restart has some or all of its reads refused by
   the disconnect (Fact 17), and a Retry, on the port already reconnected, succeeds.

### Asks

**Owner**

- **O1 · The fee card when the sponsor cannot pay this fee** (§ UI asks). (a) fall back, (b) warn
  and keep, (c) block Confirm. Recommendation: (a). Confidence: moderate. Pictures: every option,
  per P5.
- **O2 · The token card when the tokens could not load** (§ UI asks). (a) in the card, (b) a page
  banner. Recommendation: (a). Confidence: moderate. Pictures: both options and today's card.
- **Blanket sign-off**: UI impact rows 4, 5 and 8 and the lines in § UI asks, each visible state
  pictured.

**Codex** (round 1, then the final fresh pass)

- **C1 · Probe location**: estimate entry points, the strategy naming the sponsor with no I/O.
  Codex: **approve**, keep cancellation checks around the new await. Applied (§ S1 Where). Final:
  **approve**.
- **C2 · The read**: public storage. Codex: **amend**, typed addresses. Applied, with the
  protocol's own slot function (Opus A2). Final: **amend**, fix the transport boundary. Applied:
  `readPublicStorageOnce` (§ S1 How it is read).
- **C3 · The comparison**: `getFeeLimit()`. Codex: **amend**, verify the validator, compare
  bigints. Applied: Fact 23, `.toBigInt()`. Final: **approve**.
- **C4 · Failure policy**: a 5 s cap; throw or timeout is unknown and changes nothing. Codex:
  **amend**, outcome-only logs. Applied. Final: **amend**, enforce the deadline and the logging in
  the transport, not by a race. Applied: single attempt aborted at the cap, `SILENT_RPC_LOG`,
  tested at the fetch boundary (P1).
- **C5 · Verdict scope**. Codex: **amend**, scope it to the transaction, owner-visible recovery.
  Applied per the driver: shape-scoped disabled row, card-scoped set-aside, no switch back;
  pictured under the blanket (UI impact row 4). Final: **amend**, bind to the address too.
  Applied: `sponsorFunding.address`, mismatch discarded, an address edit re-enables (§ S1 card).
- **C6 · Which sponsors**. Codex: **amend**, verified payer only. Applied: a verdict only when the
  kernel's payer is the row's contract. Final: **approve**.
- **C7 · Token retry**: manual only, the `?tokenId=` preselect on the first successful load. Codex:
  **amend**, owner approves, fix the failure scope and reset. Applied: the reset before the early
  return; manual retry under the blanket; one error state for the three reads (Decision ledger).
  Final: **amend**, the realistic rationale for the aggregate state and a repeat guard on Retry.
  Applied (§ S2, blanket).
- **C8 · The e2e's unfunded sponsor**: a salt-1 SponsoredFPC registered through the playground and
  added by hand; if I4 fails, publish the instance from the test process with the harness's
  sponsored fee options (still unfunded). Codex: **amend**, settle feasibility early, require
  observable real reads. Applied: P1 step 0, `data-sponsor-funding`. Final: **approve**, with P4's
  red taken on `85c4d20f`. Applied.

### Plan audit ledger

Round 1 ran in parallel; both legs saw this plan, `recon.md` and `outline-alt.md`.

- `/codex high` round 1 (GPT-6 Astra, session `01a0edd3-ed4a-7653-b168-90f639af28e3`): **conditional
  approve**, confidence high.
- Opus 5.5 (same-family leg): **conditional approve**, confidence moderate-high.
- `/codex high` final fresh pass (GPT-6 Astra, fresh context, session
  `01a0edf5-2301-74d1-b26f-ece45c5657b8`): **conditional approve**, confidence high, conditions 1
  to 5, all applied (rows 17 to 21). It found round-1 rows 1, 5, 6 and 8 to 16 holding, and 2, 3,
  4 and 7 holding with gaps that row 18, the aggregate-state settlement (Decision ledger), row 17
  and row 21 close.

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| 1 | codex 1, Opus A1 | major / medium | A function name does not prove the fee payer; a delegating hand-added sponsor would be probed at the wrong address | accepted: the payer is the final simulation's `publicInputs.feePayer`; a verdict only when it is the row's contract; a same-signature delegating case tested (P1, P2); Facts 24, 25 |
| 2 | codex 2 | major | The verdict outlives its transaction; a no-gas person has no way back; the identity watch fires on object replacement; late verdicts untested | amended (driver): shape-scoped `shortSponsorIds` cleared by `txShape` or priority, card-scoped `setAsideSponsorIds` so nothing switches back; identity compared by key; deferred-verdict test through the engine (Fact 30); recovery pictured under the blanket, not asked |
| 3 | codex 3 | major | The three reads use separate ports; a contacts-only failure is mislabeled; the reset sits after the early return | amended (driver): Fact 27 corrects "one port"; a single-dependency failure is a storage failure, one realism line; the reset moves before the early return; stale-rejection and repeated-Retry tests added |
| 4 | codex 4 | major | Logging `{ error }` can leak addresses or figures in RPC messages; the serialized-args test can pass falsely | accepted: one fixed `{ outcome }` line, no error object; tested through `trim()` with sentinel-bearing errors (Fact 26) |
| 5 | codex 5 | major | The admission rule is unverified; `getFeeLimit()` is an `Fr`; the funded e2e passes when every probe is unknown; the residual case is untested; `feeJuiceAddress` is a string | amended: Fact 23 read from `@aztec/p2p` 5.2.0; `.toBigInt()`; `AztecAddress` for the contract; the funded e2e requires `data-sponsor-funding="funded"`; residual and equality at unit level (a residual on chain needs a Fee Juice claim to the sponsor, and the comparison is pure) |
| 6 | codex 6 | major | "No settings emitted" misses retained settings after a funded pick | accepted: P2 tests the transition with the parent consuming `undefined`, Approve disabled, then a replacement pick; plus a wire-shaped case that dApp strings reach neither verdict nor notice |
| 7 | codex 7 | minor | Owner routing of C5 to C7; the private-origin picture; the Storybook gate; command working directories; stale comments | accepted: C5 and C7 behaviour pictured under the blanket, C6 through row 1; the private-origin review-sheet capture; `build-storybook` in P4; every gate names its directory (Fact 32); the three comments trimmed |
| 8 | Opus A2 | low | Recon missed the protocol's `computeFeePayerBalanceStorageSlot` | accepted: the helper uses it (Fact 7); P1 pins it against the literal map slot |
| 9 | Opus A3 | medium | `awaitingNewToken` makes a successful Retry select the first token | accepted: set only after a successful empty load; `applyQueryToken` clears it (Fact 28) |
| 10 | Opus A4 | medium | Embedded dApp FPCs dismissed as unrealistic, though wallet-sdk dApps pay through the same sponsor | amended: the realism line is corrected; the embedded path hides the fee card and runs another strategy (Fact 31), so a notice there is a new surface outside the brief: F-2 |
| 11 | Opus A5 | medium | The notice claims cause whenever a short id is a row | accepted: it shows only when the selection without the verdict names the short sponsor; P2 case with a private flip |
| 12 | Opus A6 | low | P4 omits the commands that write the report `jq -e` reads, and the smoke commands | accepted: literal lines inlined |
| 13 | Opus A7 | low | The Retry test passes on a one-token fixture despite A3 | accepted: two tokens, the active and the requested one second |
| 14 | Opus A8 | low | Row 6 omits the cold-tab `?tokenId=` change | accepted: UI impact row 8 names it |
| 15 | Opus A10 | low | A private hold stacks two notices | accepted: the sponsor notice takes the row (UI impact row 5), captured |
| 16 | Opus A11 | low | A token added during a failure lands beside empty balances | accepted: `onTokenAdded` retries while failed |
| 17 | final 1 | major | Racing `built.node` leaves its retrying 60 s requests running, and the SDK logs malformed bodies and fetch errors at `warn`; a fake node cannot see either | accepted: `NodeFactory.readPublicStorageOnce`, single attempt aborted at 5 s, on `built.network`'s primary endpoint, SDK client logging to `SILENT_RPC_LOG`; adapter test over a stubbed `fetch` (a 500, a malformed body, the abort deadline, one call each, nothing in `console.*`); Fact 33 |
| 18 | final 2 | major | A row id does not pin the contract: `updateFpcAddress` keeps the id, so a verdict can describe the wrong address | accepted: `sponsorFunding.address`, a mismatch discarded, an address edit clears the short id and keeps it set aside; one deferred-result address-edit test (P2); Fact 34 |
| 19 | final 3 | minor | A held Enter or Space on Retry retries again once a fast rejection ends loading | accepted: the existing `isRepeatOrComposing` guard on the card's key handlers; a repeat after a fast rejection tested (P3); Fact 35 |
| 20 | final 4 | minor | Some red cases already pass on the base; P4's red cannot run on `f32b1e0a`; the deferred-estimate test covers one identity change | accepted: those cases labelled regression controls (Fact 36); every red run on `85c4d20f`, P4's past `waitForFee`; the deferred test parameterised over profile, account and network |
| 21 | final 5 | minor | Fact 17 misstates the reconnect; I3 is not universal; two stale comments in `FeeSettingsCard.vue` | accepted: Fact 17 corrected, I3 withdrawn and the privacy line rewritten without it, the `:111` history clause removed and the `:682-688` narration replaced by the reset invariant |

### Decision ledger

- **Outline**: the main outline (the estimate reads the kernel's payer, the card treats a short
  sponsor as missing) over `outline-alt.md`; both round-1 legs prefer it (§ Trade-offs).
- Rejected alternatives: § Trade-offs.
- **Disputed points, settled by the final pass**:
  - *Recovery after a change* (codex 2): codex, the owner should decide how a disabled sponsor comes
    back; driver, the rule (row re-enabled, current payer kept) follows from #718's never-switch-unasked
    rule. **Settled for the driver**: re-enable the row without restoring the selection, under the
    pictured blanket sign-off; the selection derives from live identity and explicit picks
    (`FeeSettingsCard.vue:175`, `:307`).
  - *A single-dependency failure* (codex 3): codex, a contacts-only failure deserves its own words;
    driver, one error state. **Settled on codex's third option**: one aggregate error state, its
    "only a storage failure" rationale replaced by the realistic one (two requests can straddle a
    background restart, Fact 17), approved by the owner on the blanket line; no new owner ask.
- **Realism** (no fix, no test, no owner question):
  - *A sponsor at exactly zero*: the fee-limit comparison covers it with no special case.
  - *The PrivateFPC running short*: its public Fee Juice backs every depositor's private balance, so
    it runs short only through a contract bug; not probed.
  - *The sponsor drained between the estimate and the node's check*: no read closes that race; the
    send fails as today, nothing spent.
  - *A sponsor refilled while the page stays open*: a shared testnet sponsor is refilled by its
    operator on no schedule the person sees; a change to the send re-enables the row anyway, and
    the next open reads again.
  - *A verdict taken at "urgent" that "normal" would pass*: a priority change re-enables the row.
    With no other payer the priority row hides along with the payer, so the way back is reopening
    the card, which starts at "normal": the sponsor's balance would have to sit between the two fee
    limits, a band a few fees wide (codex, post-implementation round 1).
  - *A hand-added sponsor that claims Fee Juice to itself during setup* (codex, round 1): the node
    counts that claim toward the payer's balance and the probe does not, so such a contract reads
    short. Nulo calls its `sponsor_unconditionally` with no arguments, so it would need claim
    secrets of its own; no known sponsor does this, and the error can only disable a payer, never
    pass one the node refuses.
  - *A lying RPC endpoint*: § Security.
  - *The primary endpoint edited between the build and its probe*: the probe reads the row the
    build captured (`built.network`); a person switching RPC mid-estimate is the owner's own example
    of an unrealistic case.
  - *A locked session during the token load* (in the brief): a lock routes away from Send (Fact 19),
    so no card is left to show an error.
  - *A failed re-read after a token-added event on a loaded list*: the loaded list stays valid; no
    error state.
  - *A token read that hangs*: the port's 60 s timeout (Fact 17) ends it in the error state; no
    shorter per-call timeout for a storage read.
  - *A delegating hand-added sponsor*: no verdict, today's behaviour (Fact 25); no probe of the
    contract it delegates to.
  - *A dApp's embedded payment running short* is realistic and not dismissed: F-2.

### Follow-ups

- **F-1 · The Revoke authorizations and authwit registry popups** send with a sponsor they never
  estimate (Fact 12), so a short sponsor still proves and is refused there, nothing spent. Covering
  them needs an estimate in each popup, or a probe outside the estimate.
- **F-2 · A dApp's embedded sponsor payment** (`embeddedFeePayment: "fpc"`, Fact 31) proves and is
  refused the same way when the shared sponsor runs dry. The execute window hides the fee card
  there ("Fee payment method set by …"); covering it needs a probe in `EmbeddedStrategy`'s estimate
  and a new notice on that row pointing at "Use my method", an owner UI decision.

## Approval

The final fresh codex pass: conditional approve, confidence high, every condition applied (rows
17 to 21). The O1, O2 and blanket answers were decided on 2026-09-30 by a panel, under the owner's
delegation of 2026-09-29 (§ Decided while the owner was away). The owner confirmed them on
2026-09-30, quoted there.

**Delivery boundary** (the same rule in P5 and Delivery): the PR opens and CI runs while the
owner's answers are pending; it merges only once O1, O2 and the blanket sign-off are quoted in this
plan, every required check is green on the head, and the codex loop has converged.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/send-states/lessons/phase-N.md`. Vitest commands run from
`apps/extension`; `bun run lint`, `typecheck:all`, `test:all`, `test:ci-gating`, `build`, `e2e:agent`
and `e2e:reap` run from the repo root (Fact 32); `packages/aztec-runtime`'s vitest runs from that
package. Every phase writes its failing test first and records the red run on `85c4d20f` in its
lessons file before the fix; a case marked *control* already passes there and is recorded as a
regression control, not as red evidence.

Assumptions per phase: P1 rests on Facts 23, 24 and 33, I4 and C1 to C4, C6, C8; P2 on Fact 34, C5 and O1 (a);
P3 on Facts 17 and 35, C7 and O2 (a); P4 on I4 and C8; P5 on nothing new.

### P0 · Plan in the tree ✓

1. First commit: `implementations-plan/send-states/` (`plan.md`, `recon.md`) and one line in
   `implementations-plan/index.md`.

Gate:
- Commands (repo root): `bun run lint`, `bun scripts/ci-cd/plans/check.ts`.
- Pass: both exit 0.
- Layers: lint, CI-gating.

### P1 · The sponsor probe (S1, background) ✓

0. Settle I4 before any code: a throwaway run of P4's unfunded setup (register the salt-1
   SponsoredFPC through the playground, add it in Settings → FPCs, estimate a Send with it) on
   Chrome, proverless. Record in `lessons/phase-1.md` whether the estimate succeeds and the kernel
   names the instance as payer; if not, take C8's fallback and record it.
1. Red:
   - `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.test.ts` (new), `fetch`
     stubbed as `utils/fetch.pins.test.ts` does, `SILENT_RPC_LOG`'s methods and `console.*` spied:
     `readPublicStorageOnce` resolves the field of a well-formed reply; a 500 rejects after exactly
     one `fetch` call; a body that is not a batch reply (carrying a sentinel) rejects, and the SDK's
     `warn` for it lands on `SILENT_RPC_LOG`; a `fetch` that settles only when its signal aborts
     rejects at `timeoutMs` (fake timers) with the signal aborted; no `console.*` call carries the
     sentinel or the URL. Red: no method.
   - `src/wallet/services/network/service.test.ts`: `readPublicStorageOnce` dials the passed row's
     primary endpoint through the factory, not another profile's or network's. Red: no method.
   - `src/wallet/utils/fee-juice.test.ts` (new): `readPublicFeeJuiceBalance` asks the reader for the
     Fee Juice `AztecAddress` and for `computeFeePayerBalanceStorageSlot(owner)`, which equals
     `deriveStorageSlotInMap(new Fr(1), owner)` for two addresses, passing the network and the
     timeout through; the result is the field's bigint. Red: no such export.
   - `src/wallet/services/execution/sponsor-funding.test.ts` (new): over a fake reader and a built
     `GasSettings`: a positive balance one below the limit → `{ fpcId, address, funded: false }`;
     equal → `funded: true`; zero → `funded: false`; the read gets `built.network` and
     `SPONSOR_PROBE_TIMEOUT_MS`; no `sponsor` → undefined and no read; a rejecting read →
     undefined. Every logger call deep-equals `("sponsor probe", { outcome })` for its case, and a
     rejecting read whose message carries a balance, an address and an endpoint URL leaves none of
     them in the logged arguments after `trim()`. Red: no module.
   - `src/wallet/services/execution/fee/strategies-structural.test.ts`: `FpcStrategy` sets `sponsor`
     for a `DefaultSponsoredFpc` row whose final simulation names the row as fee payer, on the fast
     path, the two-pass path and the chain-mismatch fallback; sets none when the simulation names
     another payer (the delegating case) or none; sets none for a PrivateFPC row. Red: no field.
   - `transfer-executor.test.ts`, `dapp-send-executor.test.ts`: an estimate whose build names a
     sponsor carries the probe's `sponsorFunding`; one without, or whose probe returned undefined,
     has no such key; the probe's reader is the dep wired to `readPublicStorageOnce`, never
     `built.node`; a cancel landing during the probe throws and stashes nothing; dApp payload
     fields shaped like `sponsorFunding` never appear in the result. Red.
2. The change as § S1 · The sponsor probe, the review reference at `transfer-executor.ts:372-373`
   trimmed, and the `UPDATE.md` entry.
3. Green.

Gate:
- Commands: from `packages/aztec-runtime`, `bun --bun vitest run src/adapters/ src/utils/`; from
  `apps/extension`, `bun --bun vitest run src/wallet/utils/ src/wallet/services/network/service.test.ts
  src/wallet/services/execution/sponsor-funding.test.ts src/wallet/services/execution/fee/
  src/wallet/services/execution/transfer-executor.test.ts src/wallet/services/execution/dapp-send-executor.test.ts
  src/utils/log-payload-ban.test.ts`; from the root, `bun run lint`, `bun run typecheck:all`,
  `bun run test:all`.
- Pass: all exit 0, the step-1 cases green, step 0 recorded.
- Layers: typecheck, lint, unit.

### P2 · The fee card acts on the verdict (S1, O1 (a)) ✓

1. Red:
   - `fee-helpers.test.ts`: `buildFeeMethods` disables a `shortSponsorIds` row with "can't pay now"
     and marks a `setAsideSponsorIds` row, leaving the others; `defaultSponsor` skips either;
     `resolveSavedSelection` returns undefined for either `fpc` match.
   - `fee-privacy.test.ts`: with Nulo's sponsor short, the public walk with no own gas reads `none`
     (both balances "0") or `hold` (one unread); the private walk with private Fee Juice unread
     holds; a saved pick of the short sponsor with public Fee Juice funded selects `fj`, on both
     origins; a set-aside, enabled sponsor is never selected by the walk or by its old pick.
   - `FeeSettingsCard.test.ts`, Send describe: an estimate carrying `{ fpcId: <Nulo's id>, funded:
     false }` moves the selection as above, draws `fee-sponsor-short` with the payer-named text or
     the pick-another text, disables the menu row and sets `data-sponsor-funding="short"`;
     `funded: true` sets it to `funded` and changes nothing else; *control*: a missing field and an
     unknown `fpcId` change nothing; a verdict whose `address` is not the row's changes nothing; a
     hand-added sponsor picked, its estimate held, its address edited, the old address's short
     verdict released: discarded, no notice; a short verdict, then an address edit: the row
     enabled, the current payer kept, the row not reselected; the fallback's own re-estimate (settings change, same `txShape`) keeps
     the row disabled; a `txShape` or priority change re-enables the row and keeps the current
     payer; tapping it then makes it the payer; an identity-key change clears both sets, and a
     replaced profile object with the same key does not; the verdict short, the origin flipped to
     private with private Fee Juice eligible: no notice; a private hold with the sponsor short: one
     row, the sponsor notice.
   - `FeeSettingsCard.test.ts`, non-Send: an unasked Nulo's sponsor and a picked hand-added one are
     both dropped to "Select method" on a short verdict, the saved record untouched, and a recovery
     recommit does not reselect.
   - `OperationCard.fee.test.ts`, the wire-shaped `aztec_sendTx` (`field()`, `sendTx()`): a funded
     sponsor selected, then a short verdict: the card emits `undefined`, the parent's
     `op.feeSettings` clears, Approve disables and the notice shows; a replacement pick re-enables
     Approve and the submitted payer is that pick; a `dapp.name` and call args carrying verdict-like
     strings change neither the verdict nor the notice.
   - `send.integration.test.ts`, *control*, parameterised over a profile, an account and a network
     switch: an estimate carrying a short verdict held, the identity switched, the estimate
     released: no notice and both rows enabled. It passes on the base, which ignores the field; it
     proves each switch supersedes the run once the field is read.
   - Red on `85c4d20f`: a short verdict is ignored and the sponsor stays.
2. The change as § S1 · What the fee card does, and `defaultSponsor`'s comment.
3. Green; every existing fee test unchanged.

Gate:
- Commands: from `apps/extension`, `bun --bun vitest run src/popup/components/modules/send/ src/popup/windows/execute/
  src/popup/pages/send.integration.test.ts`; from the root, `bun run lint`, `bun run typecheck:all`,
  `bun run test:all`.
- Pass: all exit 0.
- Layers: typecheck, lint, unit, component.

### P3 · The token card's load error (S2, O2 (a)) ✓

1. Red:
   - `SelectTokenCard.test.ts`: `failed` without a token draws "Couldn't load tokens" / "Retry" with
     `data-state="failed"`; a click, Enter and Space emit `retry` and never open `new_token`; after a
     Retry whose loading already ended in failure again, an Enter or Space keydown with `repeat` or
     `isComposing` set emits nothing; loading wins over failed; a token wins over failed
     (*control* for a token over loading, Fact 36).
   - `send.test.ts`: the stub gains `:data-failed`. The four refused-read cases (Fact 16) now expect
     the failed card; tokens read and contacts refused shows the same failed card; *control*: a
     successful empty read stays empty, not failed (Fact 36); an incomplete identity after a
     failure clears it; with two tokens and `activeTokenIdx` on the second, a Retry after a refusal
     shows loading, then the second token; a page mounted with `?tokenId=` naming the second token,
     whose first read is refused, selects it after a successful Retry; a cold tab whose identity
     settles after mount selects the `?tokenId=` token; a second refusal fails again; a refusal from
     a superseded identity fetch leaves the newer fetch's card alone; a second Retry tap while
     loading starts no second fetch; a token added while failed retries the whole load. Red on
     `85c4d20f`.
2. The change as § S2, and the stale mount comment removed.
3. Green.

Gate:
- Commands: from `apps/extension`, `bun --bun vitest run src/popup/components/modules/send/SelectTokenCard.test.ts
  src/popup/pages/`; from the root, `bun run lint`, `bun run typecheck:all`, `bun run test:all`.
- Pass: all exit 0.
- Layers: typecheck, lint, unit, component.

### P4 · Browser proof and the arc gate ✓

#719's `data-fpc-id` is in the base (Fact 22).

1. `apps/extension/tests/e2e/network/fee-sponsor-funding.test.ts`, two tests, every selector a
   testid (a row by `send-fee-method-sponsored` plus #719's `data-fpc-id`):
   - *Funded, real read*: an account with no Fee Juice of its own opens Send, fills the form, waits
     for the fee (`waitForFee`): the trigger reads Nulo's sponsor, `fee-settings-card` carries
     `data-sponsor-funding="funded"`, and `fee-sponsor-short` never appears. A wrong slot or a probe
     that returns unknown fails here.
   - *Unfunded, real read* (C8, as settled in P1 step 0): the salt-1 SponsoredFPC registered and
     added by hand, picked, the form filled: `data-sponsor-funding="short"`, `fee-sponsor-short`
     appears, the row is disabled, and the card reaches its fallback state. Red on `85c4d20f`,
     recorded: the test selects the row by `data-fpc-id`, passes `waitForFee`, and only then fails
     on the absent `data-sponsor-funding="short"`, so the red is the missing verdict, not a missing
     selector.
2. Every local gate, from the root: `bun run lint`, `bun run typecheck:all`, `bun run test:all`,
   `bun run test:ci-gating`, `bun run build`, `bun run --cwd apps/extension build-storybook`.
3. Smoke on both browsers: build with
   `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:<b>`,
   then `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`, for `chrome` and
   `firefox`.
4. Network e2e, from the repo root, one file per run, for each `<file>` in `fee-sponsor-funding`,
   `fee-methods`, `transfers`, `tx-sendTx-sponsoredFpc`, `send-picker`:
   - Chrome, prover on:
     `NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/<file>.test.ts --reporter=default --reporter=json --outputFile=.e2e-state/report-<file>-chrome.json`
   - Firefox, proverless:
     `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/<file>.test.ts --reporter=default --reporter=json --outputFile=.e2e-state/report-<file>-firefox.json`
   - The runner changes into `apps/extension` (`apps/extension/scripts/e2e/agent.sh:14`), so each
     report lands at `apps/extension/.e2e-state/report-<file>-<b>.json`. Before each run
     `rm -f apps/extension/.e2e-state/report-<file>-<b>.json`; after it, from the repo root,
     `jq -e '.numTotalTests > 0 and .numPassedTests == .numTotalTests' apps/extension/.e2e-state/report-<file>-<b>.json`
     exits 0. A failure, a skip or a missing report fails it.
5. Flake bar: `fee-sponsor-funding`, three consecutive retry-0 runs per browser, same check.
6. `bun run e2e:reap`.

Gate:
- Commands: steps 1 to 6.
- Pass: every command exits 0; every report passes the `jq -e` check (a skip is not a pass); the
  flake bar three of three per browser; counts in `lessons/phase-4.md`.
- Layers: typecheck, lint, unit, component, CI-gating, build, Storybook build, e2e,
  e2e-live-network.

### P5 · Captures and the owner's sign-off ✓

Runs after the codex loop converges, so a signed-off surface is not changed after its capture.

Status: the gate passes; the answers are the panel's, delegated, and the owner's. Step 1: all
32 captures, then ten retaken after the panel's copy change (`lessons/phase-5.md`). Step 2: the
page, https://claude.ai/artifact/61MuSd62Gjq2qEUbG6fnG1. Step 3: § Decided while the owner was
away, with the owner's confirmation of 2026-09-30.

1. Captures from a throwaway spec, never committed, through `e2e:agent`, proverless, at the popup's
   360×600 (the execute window at its own size). O1's short state is Nulo's own sponsor: the spec
   holds the execution port's estimate reply in the page and adds `sponsorFunding: { fpcId: <Nulo's
   id>, funded: false }` (the technique of `ux-owner-picks/lessons/phase-5.md`). O2's failure: the
   spec holds the token port's `getTokens` and rejects it, then lets the Retry through. Options (b)
   and (c) of O1 and (b) of O2 are built on a local throwaway commit for capture only, then dropped.

   | Ask | Option | State | Browser | Theme |
   |---|---|---|---|---|
   | O1 | today, (a), (b), (c) | Send, an account with no gas of its own, public origin, fee estimated | Chrome | dark |
   | O1 | today, (a), (b), (c) | Send, a saved pick of the sponsor, public origin, public Fee Juice funded | Chrome | dark |
   | O1 | today, (a), (b), (c) | Send, a saved pick of the sponsor, private origin, private Fee Juice read "0", public funded; for (a) also the review sheet it opens | Chrome | dark |
   | O1 | today, (a), (b), (c) | The execute window's fee card, a wire-shaped `aztec_sendTx`, with Approve | Chrome | dark |
   | O1 | (a) | The fee menu open, the sponsor row disabled | Chrome | dark |
   | O1 | (a) | Send, no gas; the execute window | Firefox | light |
   | blanket | row 4 | The fee menu after an amount change: the sponsor row enabled, the fallback payer kept | Chrome | dark |
   | blanket | aggregate error | Tokens read, contacts refused: the same failed card as O2 (a) | Chrome | dark |
   | blanket | row 5 | A private send, private gas unchecked, the sponsor short: the one notice row | Chrome | dark |
   | O2 | today | "No available tokens" / "Import token" after a refused read (the reference) | Chrome | dark |
   | O2 | (a), (b) | The failed load | Chrome | dark |
   | O2 | (a) | Focused by Tab; retrying; recovered to the active token | Chrome | dark |
   | O2 | (a) | The failed load | Firefox | light |
   | blanket | row 8 | Send opened with `?tokenId=` after a refused first load, recovered to that token | Chrome | dark |

2. The driver publishes one private page: O1 and O2 with every option's pictures, and one blanket
   sign-off for UI impact rows 4, 5 and 8 and the § UI asks lines, each with its picture.
3. Record the answers here, quoted. A pick other than (a) is a new phase: that option's build, its
   tests, P4's gates again.

Gate:
- Commands: step 1 through `e2e:agent`; `bun run e2e:reap`.
- Pass: every listed capture exists; the page URL printed; the delivery boundary (§ Approval) holds.
- Layers: e2e-live-network (captures only).

## Post-implementation (read by the implementing session)

`/code-review` is off. The review loop is `/codex high` (GPT-6 Astra) over the whole diff
(`dev...HEAD`), after P4 is green and before P5 and any PR:

1. **Codex audit**: the diff, this plan and its decision ledger, the adversarial ask ("What could
   go wrong? What would an attacker target? What are we trusting that we shouldn't? Where are the
   supply-chain, crypto and least-privilege weaknesses?"), and these two rules, verbatim in the
   first prompt and in every resumed one:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative
     abstractions, extra configuration surface, new layers, or rewrites — the smallest change
     that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop**: verify each finding against the code before acting; apply the accepted ones,
   commit each fix separately, log the round (consult and verdict) in `lessons/post-impl.md`, then
   resume the same codex session with the fix diff. Repeat until a round has no new material
   finding. Still material after three rounds: stop and surface it to the owner.
3. Codex is advisory: it cannot override the owner's answers, CLAUDE.md or this scope.
4. P5, then **Delivery** (below), the first time a PR is opened.

## Delivery

- Single arc, one branch `feat/send-states`, one PR off `dev`, plain `gh pr create` after the loop
  converges; then `gh pr checks --watch`.
- Title: `feat(send): say when the sponsor can't pay and when tokens fail to load` (71 characters).
- Commits: conventional, lower-case, signed; at least one per phase, fixes separate.
- PR body: summary, the UI impact table, O1, O2 and the blanket as **pending** (or the owner's
  answers, quoted), the red-before-green evidence per phase, the e2e counts, the page URL.
- **Order.** Builds on `85c4d20f` (#719 merged) after `fix/send-amount-exact` merges; merge `dev` in before P4.
  `failed-send-check` shares `send.vue`'s file but not its lines (§ Collision in recon); reconcile
  against `dev` right before delivery.
- **Merge**: by the driver under the owner's standing authorization (2026-09-29, Phase 0), once
  every required check is green on the head, every UI surface carries the owner's quoted sign-off
  and the codex loop has converged. Never `--admin`.
- Closing the plan: the `## Outcome` block, lessons promoted, and in
  `implementations-plan/follow-ups.md` the two § Amounts, sends and fees entries this PR closes
  deleted and F-1 and F-2 added, in the same PR.

## Seeds

DRAFT until approval.

Recommended, `/goal`:

```
/goal Deliver implementations-plan/send-states/plan.md. Done when the transcript shows every phase P0 to P4 marked ✓ in plan.md with its validation gate reported passing, P1 step 0's I4 result recorded, each phase's red run on 85c4d20f recorded before its fix (controls labelled as such), LESSONS_FILE=implementations-plan/send-states/lessons/phase-N.md printed per phase, P4's e2e reports passing the jq -e check on Chrome and Firefox with no skip, the funded test asserting data-sponsor-funding="funded", and the flake bar three of three per browser, a resumed /codex high pass quoted with no new material findings, P5's capture list complete and the owner page URL printed, and gh pr view showing the one PR off dev created after that pass; bun run test:all and bun run lint both exit 0 from the repo root in the transcript. /code-review is off and was not run. The PR merges only with O1, O2 and the blanket sign-off quoted in plan.md. UI questions go to the owner, technical ones to /codex high.
```

Fallback, `/loop 15m`:

```
/loop 15m Drive implementations-plan/send-states/plan.md forward. Never idle. Each firing: read plan.md and lessons/ (stop if the plan has an Outcome block or moved to archive/); git status, git log --oneline -5; take the next unchecked step, P1 step 0 first; write its failing test first and record the red run on 85c4d20f; after each edit run bun run lint from the repo root and the phase's vitest commands from the directories its gate names; commit and push the branch. A technical decision: /codex high, logged in lessons/. A UI question: hold it for the owner. Phase gate green: paste it, mark ✓, print LESSONS_FILE. A skipped network spec is not a pass. P4 green: the Post-implementation loop, then P5's captures and page, then gh pr create and gh pr checks --watch, then report and stop. Merge only with the owner's answers quoted; hard limits stay hard.
```

Use exactly one per session.
