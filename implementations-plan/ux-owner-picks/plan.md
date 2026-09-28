---
plan: ux-owner-picks
tier: mid
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
same_family_leg: Opus 5.5 subagent
eli5_mode: artifact
eli5: https://claude.ai/artifact/AwdUMz4EYvyU2Kgoh9W9Td
branch: feat/ux-owner-picks
worktree: a harness-created agent worktree (its path is recorded in lessons/phase-0.md)
follows: implementations-plan/ux-feedback/plan.md § Follow-ups (D1 to D5)
---

# UX owner picks · five follow-ups from the ux-feedback program

One PR off `dev` building the five UI decisions the owner picked on 2026-09-28:

- **D1**: an incoming amount too long for its row keeps every whole-number digit, as a compact
  "123.45M".
- **D2**: History's received rows show the token, the amount and the dollar value Home shows.
- **D3**: Send's token card is disabled and loading until the page's tokens arrive.
- **D4**: with no saved choice, the default fee sponsor is Nulo's.
- **D5**: a failed send made from the wallet's own Send page gets its own label.

Recon: [`recon.md`](recon.md). The competing outline stays local; its verdict is in the Decision
ledger.

## Phase 0 (pre-answered by the owner)

No clarifying questions were asked. Recorded:

- **The request**, the owner, 2026-09-28: "Can you ultracode 1 to 5 + security and privacy + test
  rliability + trivial? Assigning blueprinting level to each of those and just needing me to answer
  the open questons that it may come." Items 1 to 5 are D1 to D5 above: each is the owner's pick of
  the driver's recommendation. That authorizes building it; it is not the sign-off on the result.
- **Tier**: `mid`, under the owner's standing cap "never blueprint more than mid, to keep our
  credits safe". Rubric (0 to 3):

  | Dimension | Score | Why |
  |---|---|---|
  | Novelty | 1 | Every piece extends an existing helper or pattern |
  | Blast radius | 2 | Two shared helpers: `balanceFormatted` (18 capped calls in 11 files) and the default fee sponsor (four fee cards) |
  | Irreversibility | 0 | Display and default selection only; no stored shape changes |
  | Migration cost | 0 | Pre-production; no storage key or shape is touched |
  | External coupling | 1 | None beyond the node the e2e already uses |
  | Security sensitivity | 2 | Who pays a fee by default, and the copy that says whose fault a failure was |

  Five contained items with two shared-helper edits: above `light` (one audit is thin for a fee
  default), well under `deep`.
- **Same-family leg**, the owner, 2026-09-28: "use opus5.5 instead of fable please".
- **Quality bar**: production. **`/code-review`**: off. **`/harden`**: not scheduled.
- **Decisions**: UI and product asks go to the owner, each with a recommendation and a confidence;
  technical asks are decided with `/codex high` and logged.
- **Delivery**: single arc, one PR off `dev`, branch `feat/ux-owner-picks`, `gh pr create`
  after the codex loop converges.
- **Constraints**: pre-production, no migrations; complexity budgets hold with no new acceptance;
  no new dependency; the account freeze, `base.css` and the `@aztec/*` line untouched; existing
  testids verbatim; no em dash joining clauses in new copy.
- **Validation layers**: lint and types; unit and component; smoke e2e on both browsers (the
  popup changes); the network files that drive the changed surfaces, on both browsers, with every
  expected case executed; a flake bar for any e2e file this plan changes.

## Outcome & Quality Bar

For whom: someone who holds tokens in Nulo and reads their history, sends from the popup, or
approves a dApp's transaction, often on a slow machine where the page settles after it paints.

Excellent means:

1. **The incoming row's number is right.** It never shows fewer whole-number digits than the
   amount has, never more than arrived (truncated, not rounded up), and never a figure for a
   token the wallet has not looked up; the same holds for terminal journal rows, as today.
2. **Home and History agree.** The same receipt reads the same symbol, amount and dollar value on
   both, including after opening the popup straight onto History or switching network there, and a
   test that renders both rows fails if either page stops using the shared lookup and formatter.
3. **Nothing acts on a half-loaded page.** Until Send knows the current identity's tokens, its
   token card says it is loading and neither a tap nor a key does anything; it never shows the
   previous account's token or another profile's or chain's; after the load it behaves as today,
   keyboard included.
4. **Defaults and failure copy tell the truth.** With no saved choice, a fee card picks a sponsor
   automatically only when it is Nulo's own, and a failed wallet send is never blamed on "the
   connected app" nor described as certainly unsent.

Good enough: other capped surfaces keep today's cut unless O1 says otherwise; the surfaces that
guess decimals 0 for an unknown token (`TransactionCard.vue:41`, `:48-58`, `tx/[id].vue:83`,
`:89-97`, `received/[id].vue:105`, `IncomingTrustPopup.vue:62-63`) keep that fallback (a
follow-up); the compact form has no expanded hover or screen-reader text; the received detail page
keeps its own token lookup; a failed Send token load keeps today's empty state; Nulo's sponsor is
chosen by identity, so one holding no Fee Juice on a network fails at submission, as it does today
whenever it is chosen (a funding probe is a follow-up).

## UI impact

Every surface below is **sign-off pending**: built with O1 on the incoming row only until the owner
answers it and O2 to O4 as recommended, then shown to the owner on one page with its screenshots
(Chrome and Firefox), at most about five calls and one blanket sign-off.

| # | Surface | Before → after | Item |
|---|---|---|---|
| 1 | Incoming row (Home "Recent transactions", History) | 123,456,789 TST reads "+123,456," (the 8-character cut, en-US) → "+123.45M"; past 999 trillion whole tokens, "+>999T" (O1 text); an amount whose whole part fits is unchanged | D1, O1 |
| 2 | Incoming row, an amount whose whole part fits but whose cut ends on a separator | "+999,999." → "+999,999" (the trim rides the same `{ compact: true }` option, so no other surface gets it) | D1 |
| 3 | The other capped amounts whose token the wallet knows (outgoing Home rows' in-flight and awaiting amounts, terminal journal rows, the journal detail page, Home token rows, the token page split and hero, the snack) | unchanged; **only if the owner answers O1 (a)**: the compact form and the trim ("1,234." → "1,234" on Home's token-row split, "123,456." → "123,456" in the snack) | D1, O1 |
| 4 | History's received rows | "Token", "+1,000,00", no dollar value (seen on batch 4's parity page) → "TST", "+1,000", "≈ $1,000.00", as Home | D2 |
| 5 | A received row whose token is not known (Home and History) | "Token" and the raw integer cut to 8 characters → "Token" and no amount or dollar value, as terminal journal rows already do (`journal-state.ts:312-323`); a receipt whose `tokenId` went stale (token removed and re-added) now matches by contract and reads its symbol, as its detail page already does (`received/[id].vue:95-99`) | D2 |
| 6 | History's failed-send rows after a cold open | no amount (the token map is empty) → the amount, as Home | D2 |
| 7 | Send, token card before the tokens load (12 to 26 ms on Chrome, 52 to 206 ms on Firefox, measured in batch 4), and after a profile, network or account switch while Send is open | "No available tokens" / "Import token", a tap opens the import popup; on a switch, the previous account's token → disabled, `aria-busy`, a tap does nothing; per O2's recommendation an empty row, and after 300 ms a skeleton of the token row; on a switch the send-type and amount sections wait with it, since they need a token | D3, O2 |
| 8 | Send, token card and the keyboard | not reachable by Tab → one Tab stop between the recipient field and the amount; Enter or Space acts as a tap; out of the Tab path while loading | D3 |
| 9 | Default fee sponsor with no saved choice: Send, the execute window's fee card, Revoke authorizations, authwit registry | the first sponsor in storage order, so a hand-added one can win → Nulo's sponsor; where Nulo's is missing, per O4's recommendation no sponsor is chosen automatically (Send's walk goes on to its next payer or holds; the other three cards open on "Select method", as they do today on a network with no sponsor rows) | D4, O4 |
| 10 | Journal detail page of a failed wallet send ("What happened" and "Outcome") | "Reported by app" / "The connected app reported an error." → O3's wording, recommended "Send failed" / "Your wallet couldn't finish this send. If it was submitted, it may still land." | D5, O3 |

The compact form truncates like every other amount (Ask C2), so the brief's example "123.46M"
reads "123.45M"; the sign-off page says so. No dotted term, tooltip or glossary entry is added.

## Architecture & Implementation

### D1 · Compact amounts (`apps/extension/src/utils/amount.ts`)

- **Where**: `balanceFormatted` gains a fourth parameter `opts?: { compact?: boolean }`. Only
  `TransactionIncomingCard.vue:40` passes `{ compact: true }` (O1 (b), built until O1 is answered);
  every other caller is untouched and keeps today's cut byte for byte.
- **Rule**, only when `opts.compact` and `length` are set and `fullValue.length > length`, after the
  small-value hint (`:100-109`), which keeps priority, so dust still reads `<0.000001`:
  - the formatted whole part (with the locale's separators) fits in `length`: slice as today, then
    drop one trailing decimal or thousands separator;
  - otherwise return `compactWhole(u, decimals, length)` with `slashed: true`.
- **`compactWhole`** (new, private, pure, bigint only):
  - `whole = units / 10^decimals`; tier `k` is the largest of 1..4 with `whole ≥ 1000^k`,
    suffixes `K M B T`;
  - `head = whole / 1000^k`; `frac` = the next digits of `whole`, truncated to
    `min(2, length − digits(head) − 2)` places (never negative), trailing zeros trimmed;
  - output `head + decimalSep + frac + suffix`, with the locale's decimal separator
    (`getDecimalSeparator`), no thousands separator;
  - `whole ≥ 1000^5` → `>999T` (O1 text): the same "the true value is past what fits" hint as
    `<0.000001`.
  - At `length` 8 the K tier is never reached (`999,999` fits).
- **O1 (a)**, if the owner picks it: `{ compact: true }` added at the eleven other known-token calls
  (recon § Every capped caller, the rows marked "known"), none at the six that guess decimals.
  `formatSnackAmount` then passes it too and gets the trim; it keeps printing the full amount when
  the whole part does not fit, since its `startsWith(whole)` test is false for the compact form.
- **Docs**: the `balanceFormatted` TSDoc (`:62-78`) is rewritten shorter, not longer: the `length`
  cap, the hint, and one bullet for `compact` (whole digits are never cut; past the cap the value
  reads K/M/B/T or `>999T`). `formatSnackAmount`'s doc comment stays accurate under (b) and is
  touched only under (a). `transfer-executor.ts:259` and `operation-journal/spec.ts:98` only name
  the function and stay. `TransactionIncomingCard.vue`'s `receivedLabel` doc (`:28-29`) loses its
  "(D5-D)" tag while the file is edited.
- Complexity: `balanceFormatted` stays flat (one extra early return); `compactWhole` is a short
  loop plus arithmetic, well under 15.

### D2 · One token lookup and one row builder for Home and History

- **Cause, verified in code**: both pages build the row with `buildIncomingCardProps`
  (`received-display.ts:58-70`), which falls back to `"Token"` and `decimals` 0 when the token is
  missing and gets no fiat label without it. Formatting 1,000 TST (18 decimals) with 0 decimals
  and an 8-character cap gives exactly "1,000,00" (Fact 2): not a separator bug. History's lookup
  is the difference: it loads once on mount, only if the profile and network are already set, after
  awaiting the journal read, with no catch and no reload on a scope change (`activity.vue:129-138`,
  `:153-154`), while Home reloads on every scope-triple change behind a run fence
  (`RecentActivityView.vue:146-166`, `:727-751`). The receipts themselves reload on scope change
  (`useIncomingTransfers.ts:147-155`), so History can show rows its token map never catches up
  with. A journal read that rejects at mount also stops History's token load while the receipts
  still load (`activity.vue:153-155`). Which trigger produced the parity capture is an Inference
  (I1); the failing-first tests reproduce both mechanisms.
- **New C1 composable** `apps/extension/src/composables/useScopedTokens.ts`:

  ```ts
  export function useScopedTokens(options: {
  	tokenService: Pick<TokenServiceClient, "getTokens" | "onTokenAdded">
  	scope: () => { profileId: string; chainId: number } | undefined
  }): { tokens: Ref<TokenInfo[]>; tokenById: (id: number | undefined) => TokenInfo | undefined; reload: () => Promise<void>; dispose: () => void }
  ```

  - Lifted from Home in behaviour: a `createRunFence` per load; a failed read keeps the current
    map and logs at `debug` with `{ error }`; `onTokenAdded` reloads (wrapped, so the payload never
    reaches the fence argument, `RecentActivityView.vue:172-178`).
  - A `flush: "sync"` watch on the scope key clears the map and reloads, so a new scope never
    renders the old chain's tokens; an unset scope clears it and loads nothing.
  - **Deliberate scope-key change**: the key is `{profileId, chainId}`, what
    `TokenService.getTokens` reads by (`token/service.ts:219-225`). Home today clears its map on the
    `profile network account` triple (`RecentActivityView.vue:727-748`); after the change an account
    switch within one profile and chain keeps the map, which is correct because tokens are per
    profile and chain. The four token cases in `RecentActivityView.test.ts` (`:407-421`,
    `:443-482`, `:643`) change the profile or the network and stay green.
  - It never connects or disconnects the client; `dispose()` stops the watch and removes the
    listener, and the parent calls it in its existing `onBeforeUnmount` slot, after the client
    disconnects (CLAUDE.md § Cleanup order).
- **One row builder** (`received-display.ts`):
  - new pure `tokenForReceipt(tokens, inc)`: the token whose `id` is `inc.tokenId`, else the one
    whose `contract` is `inc.contract` (a `tokenId` goes stale when a token is removed and
    re-added, `incoming-transfer/spec.ts:59-60`);
  - `buildIncomingCardProps(inc, tokens, fiatLabel)` takes the token list and the fiat function,
    resolves the token through `tokenForReceipt`, and returns `tokenDecimals: null` without a token
    (so `TransactionIncomingCard` renders no amount, `:38-41`; `null`, not `undefined`, because an
    `undefined` prop takes the card's default 0, `:23`) and no fiat label. So the lookup and the fiat
    glue, now written twice (`RecentActivityView.vue:270-273`, `TransactionsList.vue:45-48`), live
    once.
  - The file header (`:1-7`) and `resolveReceivedType`'s doc (`:29`) lose their plan tags ("D5-B/D",
    "D7 dropped") while this file is edited.
- **Home** (`RecentActivityView.vue`): `tokens`, `tokensFence`, `loadTokens`, `tokenById` and the
  `onTokenAdded` registration go to the composable; the scope-triple watch loses its three token
  lines; `tokens` stays in `defineExpose` as the composable's ref; the mount load (`:777`) becomes
  `reload()`; `incomingCardProps` becomes one call `buildIncomingCardProps(inc, tokens.value,
  incomingPrices.tokenFiatLabel)`.
- **History** (`activity.vue`): the composable replaces `tokens`/`loadTokens`/the `onTokenAdded`
  line (and their "Phase 2 follow-up" comments, `:37-43`); the mount no longer awaits the journal
  read before the tokens. `TransactionsList.vue`'s `tokensById` prop becomes `tokens` (the list),
  with a local computed map for terminal rows, and its `incomingCardProps` becomes the same one call;
  the prop's doc (`:18-20`) says rows render an amount only for a token in that list, and the
  `terminalCardProps` comment (`:50-52`) loses its extraction history.
- **Parity pin**, two tests:
  - behavioural, `apps/extension/src/popup/incoming-row-parity.test.ts`: `vi.mock` of
    `@/utils/received-display` whose `buildIncomingCardProps` returns a sentinel (`tokenSymbol:
    "PARITY-PIN"`, a distinct amount); `test.each` over Home's `RecentActivityView` and History's
    `TransactionsList`, each mounted with one incoming row, asserts the rendered
    `tx-incoming-card` shows the sentinel. A page that formats the row itself fails it;
  - source scan, `apps/extension/src/composables/useScopedTokens.callers.test.ts`, in the
    `call-sites.test.ts` style: `RecentActivityView.vue` and `pages/activity.vue` each call
    `useScopedTokens(` and neither calls `getTokens(` directly. A page that goes back to its own
    lookup fails it.

### D3 · Send's token card while loading

- **`send.vue`** (`refetchIdentityScopedState`, `:514-544`):
  - `const tokensLoading = ref(true)`;
  - incomplete identity (today's branch, `:516-521`): clears the lists as today and settles
    `tokensLoading = false` when current, so the card shows today's empty state instead of loading
    forever (Ask C6);
  - complete identity: before the await, `tokens.value = []`, `tokenBalances.value = []` and
    `tokensLoading = true`, so a switch shows loading, never the previous account's token or
    balance; after the fetch, `tokensLoading = false` only when `mySeq === identityFetchSeq`, in a
    `finally`, so a superseded fetch never ends a newer one's loading and the sequence guard keeps
    invalidating older work;
  - `tokenBalanceByType` (`:130-135`) also returns 0 without an active token: it reads
    `activeToken.value.decimals` and `AmountCard` binds it unconditionally (`:653`), so a balance
    that outlives its token would throw on render (Fact 17);
  - `onTokenAdded` (`:91-93`) stops appending its payload, which names no profile and can come from
    any chain (Fact 17). It re-reads `getTokens` for the current identity and applies the list only
    if no newer token read began and no identity fetch is loading; an event that lands during a load
    is not lost, because that fetch re-reads the tokens before it ends loading. The reload leaves
    balances, contacts and the form alone (a full refetch would re-run `initSendType`, which resets
    the send type to `preselectedBalanceType`, `:139-143`), and the `tokens` watch (`:448-457`)
    still adopts a token imported into an empty page;
  - a rejected fetch leaves the tokens empty, so the card shows today's "No available tokens" /
    "Import token" (no new error state in this PR; a follow-up). Every caller catches: the watch
    (`:546-553`), `onMounted` (`:561`) and the token reload each `.catch` and log at `debug` with
    `{ error }`, so no rejection goes unhandled; the rest of `onMounted` runs as it does after an
    empty load;
  - the comment block `:506-512` is rewritten to the invariants only (the sequence guard, that only
    the current fetch ends loading, the rebind of `activeTokenIdx`), dropping its "P11 E1 fix" and
    "Post-impl audit High #2" tags;
  - template: `<SelectTokenCard :token="activeToken" :loading="tokensLoading" />`.
- **`SelectTokenCard.vue`** (L4):
  - prop `loading: Boolean`; `isLoading = loading && !token`, so the card never shows loading over
    a token it was given (Send passes one only after the fetch that ends loading);
  - `handleSelectToken` returns at once while `isLoading`;
  - the wrapper keeps `data-testid="send-token-trigger"` and gains `data-state` (`loading`,
    `ready`, `empty`), `role="button"`, `:tabindex="isLoading ? -1 : 0"`, `@keydown.enter.prevent`
    and `@keydown.space.prevent` calling `handleSelectToken`, `aria-busy` and `aria-disabled`
    while loading, no hover background and `cursor: default` while loading (CLAUDE.md § Keyboard &
    focus order);
  - loading branch (O2 recommended): an empty row the token row's height; after 300 ms (the
    `TokensView.vue:109-116` value) a `Skeleton` 36×36 box and two bars in the token row's layout;
    the timer is cleared when loading ends and on unmount;
  - the empty branch renders only once loading is false.
- **e2e**: `openSend` keeps waiting for `send-from-type`, since the tests need a token, not just a
  settled list. `send-picker.test.ts:31`'s comment ("Until the page's token loads, the trigger opens
  the import popup") becomes false and is rewritten to say why `openSend` still waits; no other line
  of that file changes (overlap with e2e-reliability-fixes). The premature-tap regression is proven
  in-process (P3), since the e2e waits past the window.

### D4 · Nulo's sponsor as the default sponsor

- **What the owner's pick means**: which sponsor a card picks, not whether a sponsor beats a
  self-paid method. Send's walk still tries the funded self-paid methods first and reaches a sponsor
  last on either origin (`fee-privacy.ts:59-86`); the other three cards pick a sponsor as their
  default outside mainnet, as today (`FeeSettingsCard.vue:446-449`). The sign-off page states this
  reading in one line for the blanket sign-off, worded to the walks' real eligibility
  (`fee-privacy.ts:59-86`: a private send skips public Fee Juice unless private Fee Juice is read as
  zero), for the owner to approve: "The payer order is unchanged: a send from a public balance tries your Fee Juice first; a send from a private balance tries your private Fee Juice first, and uses public Fee Juice only when the private balance reads zero, because paying with it names your account."
  It is not a new Ask (disputed, Decision ledger).
- **Where**: two call sites choose a sponsor, both "first sponsor in `buildFeeMethods` order", which
  is storage order (`fee-helpers.ts:190-204`): Send's walk (`fee-privacy.ts:50`) and the other
  cards' `settledSelection` (`FeeSettingsCard.vue:446-449`).
- **New** `defaultSponsor(methods)` in `fee-helpers.ts`, built per O4 (a):
  `methods.find((m) => m.type === "fpc" && m.fpc?.isProtocol === true)`, its doc comment one
  sentence: the pick is by derived identity, not usability. Both call sites call it;
  `buildFeeMethods`, `menuOrder` and `FeeMethodSelector.vue` are untouched. Under O4 (b) its body
  becomes `menuOrder(methods).find((m) => m.type === "fpc")`, so menu and default still cannot
  disagree. `settledSelection`'s `m.fpc?.type === DefaultSponsoredFpc` and Send's `m.type === "fpc"`
  select the same rows, because `buildFeeMethods` makes an `fpc` row only for a
  `DefaultSponsoredFpc` (`fee-helpers.ts:195-203`).
- **Definitions** ("Nulo's sponsor" is `fpc.isProtocol === true`, decorated by the FPC service when
  the row's address is the chain's derived protocol sponsor, `fpc/service.ts:108-114`; it cannot be
  deleted, `:384-397`, and is re-discovered when missing, `:138-141`):
  - present → it is the default sponsor;
  - absent (discovery failed or not yet done) → no automatic sponsor (O4 (a)): Send's walk goes on
    to its next step (Fee Juice, a hold, or "none"), the other cards open on "Select method"; a
    hand-added sponsor pays only once the person picks it, and that pick is then saved;
  - present but unusable → still the default, as it is today whenever it is chosen. Discovery
    registers the contract with the PXE and stores the row without checking deployment or funding
    (`fpc/service.ts:163-173`, `:210-230`), and the estimate cannot tell either: its one simulation
    skips fee enforcement (Fact 16). The two cases differ in what is known:
    - *unfunded*: the card shows a fee, the send proves, and the node refuses it at submission
      (`Insufficient fee payer balance`). Nothing is spent, and the journal records a `failed` row
      of kind `transfer` (`execution-coordinator.ts:301-309`, `transfer-executor.ts:209-218`). The
      builder records which error the refusal surfaces, and P4 pins its mapping to that row;
    - *undeployed*: unproven (Inference I4). The plan claims no outcome for it, and a mocked
      refusal tests only the error mapping.

    A saved pick of another payer wins. No deployment or funding probe in this PR (disputed,
    surfaced to the owner; a follow-up);
  - sponsors not allowed (mainnet, `FeeSettingsCard.vue:112`) → no sponsor rows, unchanged;
  - a saved pick that still resolves wins, unchanged (`fee-privacy.ts:111-112`,
    `FeeSettingsCard.vue:443-444`); no stored pick is rewritten;
  - a sponsor row is never `disabled` (`buildFeeMethods` sets none), so "disabled" has no case.
- **A dApp's explicit request stays**: an `aztec_sendTx` that names the account as payer with no fee
  call locks the card to Public Fee Juice (`OperationCard.vue:97-100`, passed at `:304`, pinned by
  `OperationCard.fee.test.ts:166-174`). Nothing else in a request reaches the default: P4 pins that
  hostile names and metadata, and a reordered sponsor list, leave the automatic choice on Nulo's
  sponsor and persist no pick.
- `menuOrder`'s doc comment (`:209-210`) says the menu is reordered and the default is Nulo's
  sponsor alone (`defaultSponsor`); the `fee-helpers.test.ts:270` title drops "the payer list keeps
  storage order" as a reason.

### D5 · A failed wallet send's category (`apps/extension/src/utils/journal-state.ts`)

- `transfer` is the kind `transfer-executor.ts:215` records for any failure of a Send-page transfer
  that is not a cancellation, a duplicate initialization or an ended session (`failureKind`,
  `mark-failed-unless-cancelled.ts:35-39`): building and simulating, proving, the node's refusal at
  submission, and two after the node may already hold the tx: a `sendTx` whose reply is lost or
  times out (the node client retries under a timeout,
  `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:55`), and a
  `recordTransaction` throw after `sendTx` returned (`execution-coordinator.ts:345`). A failed
  success mark is not one: `markJournal` catches it and returns `false`
  (`transfer-executor.ts:113-121`). The failed stage keeps no `txHash`
  (`operation-journal/spec.ts:187`), so the copy cannot branch on it and must hedge.
- `categoricalLabel` gives `transfer` its own arm with O3's strings; `dapp_execute` keeps "Reported
  by app". The Outcome row still shows because the label differs from the state "failed"
  (`journal/[id].vue:156-161`).
- `dapp_execute` also covers the wallet's own simulate/prove/send failures of a dApp request, so
  "The connected app reported an error." is doubtful there too. Not changed here: a follow-up.

### File-level change map

| File | Change | Item |
|---|---|---|
| `apps/extension/src/utils/amount.ts` (+ `amount.test.ts`) | `compact` option, `compactWhole`, TSDoc | D1 |
| `apps/extension/src/components/composite/activity/TransactionIncomingCard.vue` (+ test) | pass `{ compact: true }`, `receivedLabel` doc tag | D1 |
| `apps/extension/src/popup/components/modules/activity/TransactionCard.test.ts` | the guessed-decimals guard case (wire-shaped argument) | D1 |
| `apps/extension/src/composables/useScopedTokens.ts` (+ `.test.ts`, `.callers.test.ts`) | new | D2 |
| `apps/extension/src/popup/incoming-row-parity.test.ts` | new, behavioural parity | D2 |
| `apps/extension/src/popup/components/modules/general/RecentActivityView.vue` | the composable, one builder call | D2 |
| `apps/extension/src/popup/pages/activity.vue` (+ `activity.test.ts`) | the composable, `:tokens` | D2 |
| `apps/extension/src/popup/components/modules/activity/TransactionsList.vue` (+ test) | `tokens` prop and its doc, one builder call, `terminalCardProps` comment | D2 |
| `apps/extension/src/utils/received-display.ts` (+ test) | `tokenForReceipt`, builder signature, header comments | D2 |
| `apps/extension/src/popup/pages/send.vue` (+ `send.test.ts`, `send.integration.test.ts`) | `tokensLoading`, lifecycle, balances cleared with tokens, `tokenBalanceByType` guard, fenced `onTokenAdded`, callers' catch, comment | D3 |
| `apps/extension/src/popup/components/modules/send/SelectTokenCard.vue` (+ new `.test.ts`) | `loading`, keyboard | D3 |
| `apps/extension/tests/e2e/network/send-picker.test.ts` | line 31 comment only | D3 |
| `apps/extension/src/popup/components/modules/send/fee-helpers.ts` (+ test) | `defaultSponsor`, `menuOrder` comment | D4 |
| `apps/extension/src/popup/components/modules/send/fee-privacy.ts` (+ test) | `payersOf` | D4 |
| `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue` (+ test) | `settledSelection` | D4 |
| `apps/extension/src/popup/windows/execute/OperationCard.fee.test.ts` | wire-shaped cases | D4 |
| `apps/extension/src/wallet/services/execution/transfer-executor.test.ts` | one assertion, the node-refusal case, one post-send case | D4, D5 |
| `apps/extension/src/utils/journal-state.ts` (+ test) | `transfer` arm | D5 |
| `implementations-plan/ux-owner-picks/`, `implementations-plan/index.md` | the plan, one index line | all |

### Trade-offs and alternatives not taken

- **D1 at every capped surface by default**: every capped surface shows a wrong number for huge
  amounts today, but the brief forbids changing a surface the owner did not pick, and six callers
  guess decimals 0, where the compact form would turn a dApp's mint of one 18-decimal token into
  `>999T`. So the option is built at the incoming row and O1 decides the rest.
- **D1 via `Intl.NumberFormat` compact notation**: rejected. It accepts a bigint, but its compact
  suffixes vary by locale ("Mio.", "M", "百万"), so the length cap cannot be guaranteed, and
  truncation needs `roundingMode: "trunc"`, which the test runtime and both browsers would each
  have to honour.
- **D2 as a scope watch added to History only**: smaller, but leaves two copies of the lookup, the
  divergence that caused D2, and no test can pin a local watch. The composable costs ≥ 10 cases.
- **D2's `tokenForReceipt` on the composable**: rejected for a pure function inside the builder,
  because `TransactionsList` receives a list, not the composable, and the lookup then cannot be
  bypassed by either caller.
- **D4 by sorting inside `buildFeeMethods` and deleting `menuOrder`**: one order too, but it edits
  `FeeMethodSelector.vue` next to the testid lines e2e-reliability-fixes rewrites, changes every
  consumer's list order, and still falls back to a hand-added sponsor.
- **D3 by making `SelectTokenCard` fetch its own state**: rejected: the page owns the service
  lifecycle (CLAUDE.md L5/L6), and the page already knows when its fetch settles.

## Security & Adversarial Considerations

- **Threat model.** No new trust boundary, message, permission, storage key or dependency. The
  inputs are wallet-owned or contract-fed: amounts from the incoming-transfer store, token rows the
  user imported, FPC rows from the FPC service, journal kinds set by the executor. At the incoming
  card `isValidDecimals` checks the decimals only (`token-amount.ts:14-15`), never the amount.
- **Fee payer (D4).** A hand-added sponsor "can make its sponsorship conditional on a call from the
  account and then spend a token authorization the account granted it earlier"
  (`fee-helpers.ts:198-200`). Today storage order can make such a contract the default on four fee
  cards, including a dApp's execute window. After the change (O4 (a)) it is never the default
  without the person's saved pick. Identity is `isProtocol`, computed by the background from the
  derived address (`fpc/service.ts:108-114`), not from a name, so a hand-added row named
  "Sponsored" cannot pose as Nulo's; only `NewFpcPopup.vue` adds an FPC, so a dApp cannot add one.
  `isProtocol` proves identity, not usability: a protocol sponsor holding no Fee Juice on this chain
  passes the estimate (fee enforcement is skipped there, Fact 16), proves, and is refused at
  submission, so nothing is spent and the journal records the failure (D4 § Definitions); an
  undeployed one's outcome is unproven (I4). Both exposures predate this change. A dApp can still lock the payer to the account's own Fee
  Juice by naming it (`OperationCard.vue:97-100`), which only removes the sponsor option; request
  metadata cannot move the automatic choice (P4 test). The execute card's tests use a wire-shaped
  `aztec_sendTx` (`OperationCard.fee.test.ts:70`), per CLAUDE.md.
- **Displayed amounts (D1, D2).** The compact form reaches only the incoming row, which after D2
  renders an amount only for a token the wallet holds a row for. There the truncating form
  understates, and `>999T` says the value is past what fits. Six callers guess decimals 0 for an
  unknown token or a dApp mint; they never get the option (O1 (a) keeps them out too), and a
  `TransactionCard.test.ts` case pins that a mint of 10^18 base units, its argument `0x` plus 64 hex
  digits as the wire carries it, does not read `>999T`. Showing no amount for an unknown token
  removes a figure that was wrong by 10^decimals.
- **Premature taps (D3).** Today a tap in the loading window opens the import-token popup, an
  unintended flow into adding a contract address; it becomes a no-op, by pointer and by key. A
  switch never shows the previous account's token to act on, and a token event, which names no
  profile, can no longer put another profile's or chain's token on the page.
- **Failure copy (D5).** The new copy blames neither the connected app nor the network, and says a
  submitted send may still land, since a `transfer` failure can follow `sendTx`.
- **Logging.** The composable keeps Home's single `console.debug` with `{ error }`; Send's three new
  catches log the same way at `debug`; nothing new reaches `warn` or `error`.
  `log-payload-ban.test.ts` runs in `test:all`.
- **Supply chain, crypto, least privilege.** No dependency, no cryptography, no CI or token change.

## Assumptions

### Facts (verified at `624117cd`)

1. `balanceFormatted` cuts an over-long string with `fullValue.slice(0, length)`
   (`apps/extension/src/utils/amount.ts:111-113`), after the small-value hint (`:100-109`).
2. `formatBaseUnits` groups the whole part with the locale's thousands separator (`amount.ts:270-274`).
   A throwaway script importing `amount.ts`, run with the local bun (en-US), printed:
   `balanceFormatted(123456789n·10^18, 18, 8)` → `"123,456,"`; `(1000n·10^18, 0, 8)` → `"1,000,00"`;
   `(1000n·10^18, 18, 8)` → `"1,000"`; `(123456700000n, 6, 8)` → `"123,456."`; `(1n, 18, 8)` →
   `"<0.000001"`. (The brief's "12345678" is the same cut without grouping.)
3. 18 calls in 11 files pass a `length` (recon § Every capped caller): 12 with the token's own
   decimals, 6 that guess decimals 0 when the token is unknown or the call is a mint.
   `formatSnackAmount` prints the full amount whenever the capped form lost a whole digit and the
   capped form otherwise, so `formatSnackAmount(123456700000n, 6)` is `"123,456."` today
   (`snack-amount.ts:9-14`).
4. Home and History both build incoming rows with `buildIncomingCardProps`
   (`TransactionsList.vue:45-48`, `RecentActivityView.vue:270-273`), which uses `"Token"`,
   `decimals || 0` and no fiat without a token (`received-display.ts:58-70`, the callers' ternaries);
   both look the token up by `tokenId` only, while the received detail page also matches on
   `contract` (`received/[id].vue:95-99`).
5. History loads tokens once in `onMounted`, after `await loadTerminalJournalOps()`, returning early
   without a profile or chain id, with no catch and no scope watch (`activity.vue:129-138`,
   `:143-155`); its root renders under `v-if="appStore.isLogined"` (`:180`) while `onMounted` runs
   regardless. Home reloads on a scope-triple change behind a run fence and catches a failed read
   (`RecentActivityView.vue:146-166`, `:727-751`).
6. `useIncomingTransfers` clears and re-reads the receipts on a scope change (`useIncomingTransfers.ts:147-155`).
7. Terminal journal rows render an amount only with a known token (`journal-state.ts:312-323`);
   the incoming card renders none for invalid decimals (`TransactionIncomingCard.vue:37-41`), and its
   `tokenDecimals` prop defaults to 0 (`:23`).
8. Before its tokens load, `SelectTokenCard` renders "No available tokens" / "Import token" and a
   click opens `new_token` (`SelectTokenCard.vue:20-26`, `:47-50`); its wrapper is a `<Flex @click>`
   with no role, tabindex or key handler (`:30`). `send.vue`'s `tokens` starts empty (`:112`) and
   fills in `refetchIdentityScopedState` (`:514-544`), called from `onMounted` (`:555-561`) and from
   an unawaited watch (`:546-553`); on a complete identity it keeps the old list until
   `Promise.all` resolves (`:522-530`). Batch 4 measured the window at 12 to 26 ms on Chrome and
   52 to 206 ms on Firefox
   (`implementations-plan/ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-8.md`, its table).
9. `openSend` waits for `send-from-type` (`tests/e2e/fixtures/send-page.ts:43-46`), which the page
   draws only once an active token exists (`send.vue:114`, `:621-622`).
10. Send's default sponsor is `methods.find((m) => m.type === "fpc")` (`fee-privacy.ts:46-52`); the
    other fee cards' is `methods.find((m) => m.fpc?.type === FpcType.DefaultSponsoredFpc)`
    (`FeeSettingsCard.vue:446-449`); both lists are in storage order (`fee-helpers.ts:190-204`), and
    only the menu puts Nulo's first (`fee-helpers.ts:209-216`, `FeeMethodSelector.vue:20`). With no
    selection the trigger reads "Select method" (`FeeMethodSelector.vue:47`).
11. `FeeSettingsCard` is mounted by `send.vue:669`, `OperationCard.vue:301`,
    `RevokeAuthwitsPopup.vue:222` and `ChangeAuthwitsRegistryPopup.vue:121`; only Send derives its
    selection (`FeeSettingsCard.vue:470-471`).
12. `isProtocol` is true only for the chain's derived sponsor and private FPC addresses
    (`fpc/service.ts:108-114`); a protocol FPC cannot be deleted (`:384-397`); missing ones are
    re-discovered (`:138-141`) by registering the contract with the local PXE and storing the row,
    with no deployment or funding check (`:163-173`, `:210-230`).
13. `categoricalLabel` maps `transfer` and `dapp_execute` to "Reported by app" / "The connected app
    reported an error." (`journal-state.ts:217-219`), pinned by `journal-state.test.ts:485-488`.
14. `transfer` is recorded for every unclassified failure of a Send-page transfer
    (`transfer-executor.ts:215`, `mark-failed-unless-cancelled.ts:35-39`), including a
    `recordTransaction` throw after `sendTx` returned (`execution-coordinator.ts:345`); a failed
    success mark is swallowed by `markJournal` (`transfer-executor.ts:113-121`, passed at `:171`);
    the `failed` stage carries no `txHash` (`operation-journal/spec.ts:187`).
15. `OperationCard.fee.test.ts` already mounts the real fee card against a wire-shaped
    `aztec_sendTx` (`field()` at `:70`, `sendTx()` at `:84-104`) with `NULO_SPONSOR` and
    `HAND_ADDED` rows (`:74-75`), and pins the dApp's self-payment lock (`:166-174`).
16. The protocol sponsor takes the single-pass path (`fpc-strategy.ts:103-104`, eligibility
    `:111-119`), whose one simulation passes `skipFeeEnforcement: true` (`:142`, via
    `fee-strategy.ts:167`); the PXE forwards it to public simulation and to the node's validation
    (`@aztec/pxe` 5.2.0, `dest/pxe.js:801`, `:810-813`). Its fee function, `sponsor_unconditionally`,
    is private and only sets the fee payer and ends setup (the SponsoredFPC source in
    `@aztec/noir-contracts.js` 5.2.0), and the PXE runs a contract the node has no record of from
    its local registration (`@aztec/pxe` 5.2.0, `dest/contract/contract_class_service.js:26-34`).
    The node's text for an unfunded payer is `Insufficient fee payer balance` (`@aztec/stdlib`
    5.2.0, `dest/tx/validator/error_texts.js:3`); a `sendTx` rejection that is not a duplicate
    initialization is rethrown unchanged (`execution-coordinator.ts:301-309`) and journals `failed`
    with kind `transfer` (`transfer-executor.ts:209-218`).
17. `send.vue`'s `onTokenAdded` appends the event's token to the page's list (`:89`, `:91-93`); the
    payload is a `TokenInfo`, with a `chainId` and no profile (`token/utils.ts:4-17`).
    `tokenBalanceByType` checks only the balance before reading `activeToken.value.decimals`
    (`:130-135`), and `AmountCard` binds it with no `v-if` (`:647-657`).

### Inferences (to attack)

- **I1.** Batch 4's History capture opened the page cold (a reload or a direct hash) or after a
  scope change, so `loadTokens` returned early or loaded the old chain; a rejected journal read is a
  third way. Which one the capture hit is not recorded. The failing-first tests (P2) prove the
  mechanisms, not the capture's trigger.
- **I2.** On the incoming row, whose decimals are the token's own, no production amount reaches
  `1000^5` whole tokens except by a hostile or test contract, so `>999T` there is an edge. This
  holds only where decimals are known; it is why the guessing callers never get the option.
- **I3.** A 300 ms delay hides the skeleton in every measured load (206 ms worst), so on today's
  numbers the user sees an empty disabled row, then the token.
- **I4.** An unfunded protocol sponsor passes the estimate, proves, and is refused at submission
  (Fact 16). An undeployed one is unproven. The PXE runs a locally registered contract's private
  functions without a public deployment (`@aztec/pxe@5.2.0`,
  `dest/contract/contract_class_service.js:26-34`), and nothing before `sendTx` checks deployment,
  but what the node then does with it, funded or not, was not established. The plan relies only on
  the unfunded outcome. A focused run against a chain without the sponsor would settle the other.

### Asks → owner (sent, answers pending; until answered, O1 builds the incoming row only and O2 to O4 are built as recommended)

- **O1 · Where the compact form applies (D1).** Built: the incoming row only. The same cut drops
  whole digits on the other capped surfaces (17 calls in 10 files, recon § Every capped caller).
  (a) the compact form, and the trailing-separator trim, on every capped amount whose token the
  wallet knows (11 more calls, the snack's text included: "123,456." → "123,456", and Home's token
  split "1,234." → "1,234"); the six calls that guess decimals 0 keep today's cut, because there
  the compact form would show a dApp's mint of one 18-decimal token as ">999T"; (b) the incoming row
  only, the rest a follow-up. Past 999 trillion whole tokens the form reads ">999T" under either.
  **Recommend (a)**, confidence **moderate**: every one of those surfaces shows a wrong number today
  for the same amounts, and nothing that fits changes except a trailing separator. ">999T" as is.
- **O2 · What the loading token card looks like (D3).** (a) an empty disabled row, then a skeleton of
  the token row after 300 ms (the Tokens list's delay); (b) the skeleton at once; (c) a spinner
  with "Loading tokens". **Recommend (a)**, confidence **moderate**: loads measured under 206 ms,
  and a skeleton flashing for 12 ms reads as a glitch (the reason `TokensView` delays its own).
- **O3 · The failed wallet send's wording (D5).** The `transfer` kind also covers failures after
  the send may have reached the node (D5), and the journal cannot tell which. (a) "Send failed" /
  "Your wallet couldn't finish this send. If it was submitted, it may still land."; (b) "Couldn't
  send" / "This send stopped before it finished. If it reached the network, it may still land.";
  (c) "Send failed" / "Your wallet couldn't finish this send.", shown only as the contrast: it
  reads as "nothing happened", which is false in those cases. **Recommend (a)**, confidence
  **moderate**: it blames nobody and states the same fact as the sibling
  "Interrupted mid-flight".
- **O4 · When Nulo's sponsor is missing (D4).** When Nulo's sponsor is missing on a network, what
  does a fee card start on with no saved choice? (a) no sponsor: it starts on the next payer (Send's
  walk goes on to Fee Juice or waits; the other cards open on "Select method"), and a hand-added
  sponsor is used only after the person picks it once (then saved); (b) the first hand-added
  sponsor, as today. **Recommend (a)**, confidence **moderate**: a hand-added contract can spend an
  authorization the account granted it (`fee-helpers.ts:198-200`), so it should pay only by the
  person's choice; the cost is one extra pick on a network where discovery failed.

### Asks → codex (decided in the plan audit; "final" is the fresh pass)

- **C1.** Past `999T`: `>999T`, or a fifth suffix? **Codex: amend** (owner-visible): folded into
  O1's text, recommended as is. **Final: approve** the routing to O1.
- **C2.** Truncate the compact form (123.45M) rather than round (123.46M)? **Codex: approve**,
  per `amount.ts:219-227`; the sign-off page shows it. **Final: approve**, with finding 5's cases
  (applied, P1).
- **C3.** The composable plus a pin, against a local watch in History? **Codex: amend**: the
  composable plus a behavioural rendering pin (applied, D2 § Parity pin). **Final: approve.**
- **C4.** Nulo's sponsor absent: fall back to the first hand-added sponsor? **Codex: reject**: no
  automatic hand-added fallback; the visible fallback is the owner's (O4, (a) built). **Final:
  reject** again; the visible fallback stays the owner's.
- **C5.** The default as `menuOrder(...)`'s first sponsor, against sorting `buildFeeMethods`?
  **Codex: amend**: a shared protocol-only selector, menu order left alone (applied,
  `defaultSponsor`). **Final: amend**: protocol identity and verified usability. Not applied:
  identity only, no probe (disputed, surfaced to the owner, Decision ledger).
- **C6.** `tokensLoading` on an incomplete identity: stay loading, or settle? **Codex: reject as
  specified**: explicit lifecycle handling (applied: settle to today's empty state). **Final:
  amend**: settle, and fix findings 2 and 3 (applied, D3).
- **C7.** Browser proof for D2: a cold-open History assertion (new additive testids `activity-title`
  and `activity-amount` on `TransactionCardLayout.vue`) in
  `network/incoming-public-transfers.test.ts`? **Codex: amend**: only as a deterministic cold open
  (the test delays the identity) with a recorded red on `dev` (applied, P2 step 4: dropped, testids
  included, if it cannot be made red). **Final: approve**; the component coverage stays mandatory
  either way.

### Plan audit ledger

Round 1 ran both legs in parallel, each seeing this plan, `recon.md` and the competing outline,
with the full packet: the adversarial ask, the assumption attack and the implementation critique.

- `/codex high` (GPT-6 Astra, session `01a0e970-a01b-7b40-a009-f1997b85b230`): **conditional
  approve, confidence high** (conditions: its findings 1 to 8).
- Opus 5.5 (same-family leg): **conditional approve, confidence moderate-high** (conditions F1 to
  F6).
- `/codex high` final fresh pass (GPT-6 Astra, session `01a0e986-6bbc-7ee3-8a4e-02458bec90e3`),
  seeing this plan, `recon.md` and the brief: **conditional approve, confidence high** (conditions:
  its findings 1 to 8, rows 20 to 27). Its check of rows 1 to 19 held 4, 5, 10, 11, 13, 14, 16, 18
  and 19; the partial ones and row 12, which it failed, are carried by rows 20 to 27. Its
  confirmation (the same session, resumed): **conditional approve, confidence high**, rows 21 and
  24 to 27 resolved; its three corrections are rows 28 to 30, applied by the driver.

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| 1 | codex | major | The hand-added fallback breaks the payer policy; `isProtocol` proves identity, not usability; "default Nulo" undefined as sponsor or payer | accepted: O4 added, (a) built; unusable defined with its test; the sponsor-not-precedence reading stated (D4). Shared with F4, F11 |
| 2 | codex | major | Send can stay loading on an incomplete identity or show the old account's tokens; a rejection re-enables them | accepted: tokens cleared on identity change, incomplete identity settles, callers catch; today's empty state on failure; five lifecycle tests (P3) |
| 3 | codex | major | D1's boundaries, locales and maxima unpinned; the snack claim is false; `>999T` is owner copy | accepted: incoming-only build, trim behind the option; boundary table (P1); snack claim corrected (Fact 3, UI 3); `>999T` in O1. Shared with F1 |
| 4 | codex | major | The source-scan pin passes on the broken baseline; the scope-key change is undocumented | accepted: behavioural parity test added; scope-key change stated (D2) |
| 5 | codex | major | "A dApp cannot influence the default" ignores its explicit self-payment request | accepted: the lock kept and cited; wire-shaped test with hostile metadata and reordered sponsors, no pick persisted (P4) |
| 6 | codex | minor | Fact 3 count wrong; Fact 15 lines; recon's "no formatter" search too narrow; `Intl` takes bigint; `isValidDecimals` checks decimals only; I4 unsafe | accepted: Facts 3 and 15, recon row 3 (repo-wide search), the `Intl` reason, the Security sentence and I4 rewritten. Shared with F3 |
| 7 | codex | major | Gates can pass without proving the failures: C7 may be green on `dev`, no premature-click test, no post-send case, P5 has no commands and allows skips | accepted: C7 deterministic or dropped; real-card deferred-load test (P3); post-send recording-failure case (P4); P5 commands and a no-skip check. Shared with F6, F9 |
| 8 | codex | minor | The loading card is mouse-only; touched comments carry workflow tags; TSDoc too long | accepted: keyboard semantics and tests (D3, UI 8); tags dropped at `send.vue:506-512`, `received-display.ts:1-7`, `:29`; TSDoc shortened |
| 9 | Opus F1 | high | Building "everywhere" by default, and the trim, change unpicked surfaces | accepted: incoming row only; trim behind `{ compact: true }`; own UI row (UI 2) |
| 10 | Opus F2 | high | Under O1 (a), callers guessing decimals 0 show dApp mints as `>999T`; "only understates" false | accepted: the six guessing calls excluded from O1 (a); guard test in `TransactionCard.test.ts`; Security rewritten |
| 11 | Opus F3 | medium | 18 calls pass a length, not 14; O1 says 13 | accepted: recounted (18 in 11 files) in Fact 3, the rubric, O1 and recon |
| 12 | Opus F4 | medium | Nulo's row is present even where undeployed; "unusable" undefined | accepted: defined in D4 with its outcome and `transfer-executor.test.ts:207-219`; I4 rewritten |
| 13 | Opus F5 | medium | `transfer` covers post-send failures; every O3 option says nothing happened | accepted: O3 reframed with two hedged options, (a) recommended |
| 14 | Opus F6 | medium | No test for the journal-read rejection; C7 may be green on `dev` | accepted: `activity.test.ts` case (P2 step 1); C7 red-on-`dev` rule |
| 15 | Opus F7 | medium | Loading vs a present token undefined; the watch's rejection unhandled | accepted: `isLoading = loading && !token`; rejection tested through mount and the watch |
| 16 | Opus F8 | low | The row glue stays duplicated; rows match `tokenId` only | amended: `tokenForReceipt` as a pure function inside the one builder instead of on the composable, since `TransactionsList` receives a list and neither caller can then bypass the lookup |
| 17 | Opus F9 | low | P5 step 3 has no command and misses `incoming-arrival` | accepted: per-browser commands, `incoming-arrival` added |
| 18 | Opus F10 | low | Outcome 1 overclaims | accepted: limited to the incoming and terminal rows; guessing callers named under Good enough, a follow-up |
| 19 | Opus F11 | low | C4 is a user-visible default | accepted: O4 |
| 20 | codex final | major | An unusable Nulo sponsor stays the automatic default; the fast path skips fee enforcement, so a mocked estimate failure proves neither deployment nor funding | amended (disputed, surfaced to the owner): no probe. D4, Security and I4 corrected: the estimate cannot tell (Fact 16), the send proves and the node refuses it at submission, nothing spent, a failed `transfer` row; P4 pins that mapping; the funding probe stays a follow-up |
| 21 | codex final | major | Clearing tokens alone crashes `tokenBalanceByType` on render | accepted: balances cleared with the tokens and the missing token guarded (D3, Fact 17); P3 runs a populated balance through the deferred switch and the rejection |
| 22 | codex final | major | `onTokenAdded` appends any profile's or chain's token unfenced, so `loading && !token` enables the card mid-load | accepted: a tokens-only reload for the current identity, fenced by the fetch sequence (D3, Fact 17); P3 tests a foreign-chain event during loading and after a failure, and the import-from-empty adoption |
| 23 | codex final | major | The /loop seed builds unanswered O1 "as recommended" (eleven more calls); sponsor precedence should go to the owner | accepted for the seeds: every seed and build instruction builds the incoming row only until O1 is answered. Amended for precedence: the reading stays, stated in one line for the blanket sign-off (disputed, Decision ledger) |
| 24 | codex final | minor | P1 calls rows red that pass today; 999,995 and the O1 (a) widths are missing; the mint guard feeds friendly values | accepted: passing rows marked (P4's two guards too), 999,995 added, a lengths 6/10/20 table under O1 (a), the guard's argument `0x` plus 64 hex digits |
| 25 | codex final | minor | P5 reads reports from the repo root; the runner writes them under `apps/extension` (`apps/extension/scripts/e2e/agent.sh:14`) | accepted: reports read at `apps/extension/.e2e-state/`, removed before each run, asserted with `jq -e` |
| 26 | codex final | minor | Touched files keep a `D5-D` tag and an extraction narration | accepted: both dropped (D1, D2); the loading-fence and identity-not-usability comments kept, one sentence each |
| 27 | codex final | minor | D5 names a failed success mark, which `markJournal` swallows (`transfer-executor.ts:113`) | accepted: dropped from D5, Fact 14 and O3's framing; D5 lists only the verified post-send paths (a lost or timed-out `sendTx` reply, a `recordTransaction` throw); O3's options unchanged |
| 28 | codex confirm | minor | The foreign-event case injects the incumbent's id, so `.find()` still returns A and it passes today | accepted: the event cases start from an empty list with a retained selected id and assert the rendered token (P3 step 2); the A → B case's no-`TypeError` check marked a preservation guard |
| 29 | codex confirm | major | Undeployed and unfunded have different support; the PXE runs a local private function undeployed, so a rejection is not established | accepted: D4 separates the two, Security and I4 keep the undeployed outcome unproven, and the plan relies only on the unfunded one |
| 30 | codex confirm | minor | "Send still tries your own Fee Juice first" omits the private-origin guard (`fee-privacy.ts:68-72`) | accepted: D4's sign-off line states both walks' eligibility, for the owner to approve |

### Decision ledger

- **Outline**: the main outline (shared helpers: `balanceFormatted`'s option, one token composable
  and one row builder, `defaultSponsor`), with the competing outline's D1 default adopted (build
  the incoming row only, O1 decides the rest), because the brief forbids changing unpicked surfaces
  and six callers guess decimals. Both legs agreed.
- **Rejected alternatives**: see Trade-offs. The competing outline's History-only watch (no pin
  possible, keeps a raw figure off by 10^decimals), its `buildFeeMethods` sort (touches the other
  package's lines, keeps the hand-added fallback), its delay-free skeleton (left to O2) and its two
  PRs (the brief asks one).
- **Disputed points**, after the final fresh pass:
  - *Load-failure presentation*: settled. The final pass sides with keeping today's empty state on a
    failed load (`send.vue:112`, `:524`, `:561`), subject to the owner's sign-off: the sign-off page
    states it in one line, and a real error state stays a follow-up.
  - *Sponsor versus payer precedence*: disputed, resolved by a sign-off line. Codex: route it to the
    owner, since Send prefers funded self-payment (`fee-privacy.ts:63`, `:78`) while the other cards
    prefer a sponsor (`FeeSettingsCard.vue:442-451`), and "default to Nulo's sponsor" does not settle
    which. Driver: "which sponsor", from the brief's own framing ("a fee contract added by hand can
    beat Nulo's"); not a new Ask. The sign-off page states D4's payer order line for the blanket
    sign-off, worded to both walks' eligibility.
  - *Sponsor usability before the automatic pick* (final finding 1, C5): disputed, surfaced to the
    owner, who may override. Codex: verify usability before the pick; unknown or unusable follows
    the owner's fallback. Driver: identity only and no probe in this PR, because the exposure exists
    today whenever the protocol sponsor is chosen, a probe would change every fee card (a network
    read, an "unknown" state, a visible "unusable" state), and the brief asks to define and test
    "unusable", not to verify it before selection. The sign-off page carries it in one line.

## Approval

Approved for build by the final pass's confirmation (conditional approve, confidence high; its
three corrections applied, rows 28 to 30). Phase 0 met; the final pass's conditions 2 to 8 applied and
condition 1 amended and surfaced (Decision ledger); C1 to C7 decided; UI impact lists only D1 to D5
and their direct states; scope holds. Pending: the owner's answers to O1 to O4 and the owner's call
on sponsor usability; an answer that lands during the build changes only its own surface (P6).

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/ux-owner-picks/lessons/phase-N.md`. The first commit adds
`implementations-plan/ux-owner-picks/` and one line in `implementations-plan/index.md`.

### P1 · Compact amounts (D1) ✓

1. Failing first, `amount.test.ts`, a `test.each` boundary table for `balanceFormatted(u, d, 8,
   { compact: true })`, en-US unless noted (the locale cases stub `Number.prototype.toLocaleString`
   for the separators, restored after each):

   | Case | Value | Decimals | Expected |
   |---|---|---|---|
   | whole part fits, cut on the separator | 999,999.9 | 18 | `999,999` |
   | whole part fits exactly | 999,995 | 18 | `999,995` (passes today) |
   | first M | 1,000,000 | 18 | `1M` |
   | M with a fraction | 1,234,567 | 18 | `1.23M` |
   | the brief's amount, truncated | 123,456,789 | 18 | `123.45M` |
   | at the M/B boundary, never rounded up | 999,995,000 | 18 | `999.99M` |
   | top of M | 999,999,999.99 | 18 | `999.99M` |
   | first B, decimals 0 | 1,000,000,000 | 0 | `1B` |
   | top of T | 999,999,999,999,999 | 0 | `999.99T` |
   | past T | 10^15 | 0 | `>999T` |
   | u128 maximum | 2^128 − 1 base units | 0 | `>999T` |
   | u128 maximum | 2^128 − 1 base units | 18 | `>999T` |
   | zero | 0 | 18 | `0` (passes today) |
   | one base unit | 1 | 18 | `<0.000001`, the hint wins (passes today) |
   | one base unit | 1 | 0 | `1` (passes today) |
   | comma decimal, dot grouping (de-DE) | 123,456,789 | 18 | `123,45M` |
   | comma decimal, narrow-space grouping (fr-FR) | 123,456,789 | 18 | `123,45M` |
   | fr-FR, whole part fits | 999,999.9 | 18 | `999 999` (U+202F) |

   Plus: without the option every row above returns today's value (the cut), and `slashed` is true
   on every compact result.
2. Green: the option, the branch and `compactWhole`. Kept green: fits-unchanged, the `<0.0001`
   hint, `"1.234"` at 5, and `snack-amount.test.ts` unchanged.
3. `TransactionIncomingCard.test.ts`: the row renders `+123.45M` and `+999,999`.
   `TransactionCard.test.ts`: a dApp-origin `mint_to_public` whose last argument is 10^18 base
   units as the wire carries it (`0x` plus 64 hex digits, not the friendly strings at `:80`) never
   renders `>999T`. A guard that passes today (Opus F2's); under O1 (a) it proves the guessing
   callers got no option.
4. Under O1 (a) only: the option at the eleven known-token calls; one case each at the snack
   (`123,456.` → `123,456`) and Home's token split (`TokenCard.vue:51`, `1,234.` → `1,234`); and
   the other widths in `amount.test.ts`, the K tier included:

   | Length | Case | Value | Decimals | Expected |
   |---|---|---|---|---|
   | 6 | whole part fits, the trim | 1,234.5678 | 18 | `1,234` |
   | 6 | whole part fits exactly | 99,999 | 18 | `99,999` (passes today) |
   | 6 | first K | 100,000 | 18 | `100K` |
   | 6 | K with a fraction | 123,456 | 18 | `123.4K` |
   | 6 | at the K/M boundary, never rounded up | 999,995 | 18 | `999.9K` |
   | 6 | first M | 1,000,000 | 18 | `1M` |
   | 6 | one base unit | 1 | 18 | `<0.0001` (passes today) |
   | 10 | whole part fits, the trim | 1,234,567.89 | 18 | `1,234,567` |
   | 10 | top of M | 999,999,999 | 18 | `999.99M` |
   | 10 | B with a fraction | 1,234,567,890 | 18 | `1.23B` |
   | 20 | whole part fits, the trim | 999,999,999,999,999.5 | 18 | `999,999,999,999,999` |
   | 20 | past T | 10^15 | 18 | `>999T` |
5. The `balanceFormatted` TSDoc, shortened.

Gate:
- Commands: `bun run lint`; `bun run typecheck:all`;
  `bun --bun vitest run src/utils/amount.test.ts src/utils/snack-amount.test.ts src/components/composite/activity/TransactionIncomingCard.test.ts src/popup/components/modules/activity/TransactionCard.test.ts`
  from `apps/extension`, plus each touched caller's colocated test under O1 (a); `bun run test:all`.
- Pass: every command exits 0; every table row not marked "passes today" was red before step 2
  (logged).
- Layers: lint, types, unit, component.

### P2 · One token lookup (D2) ✓

1. Failing first:
   - `activity.test.ts`: mount History with the app store's network unset, then set it: a received
     row reads the symbol, `+1,000` and its fiat label (red today: "Token", "+1,000,00"); then a
     network switch reloads the map; and `getOperations` rejecting at mount still lets the received
     row resolve its token (red today, `activity.vue:153`).
   - `received-display.test.ts`: no token → `tokenDecimals` null and no fiat; a stale `tokenId`
     with a matching `contract` → that token.
2. `useScopedTokens.ts` + `useScopedTokens.test.ts` (≥ 10 cases): loads for a scope; unset scope
   loads nothing and clears; a scope change clears synchronously and reloads; an account-only change
   keeps the map; a stale load for an old scope is dropped; a failed read keeps the map and logs at
   debug; `onTokenAdded` reloads; `tokenById` for a known, unknown and `undefined` id; `reload()`;
   `dispose()` stops the watch and removes the listener; a load resolving after `dispose` changes
   nothing.
3. Home, History and `TransactionsList` on the composable and the one builder;
   `incoming-row-parity.test.ts` and `useScopedTokens.callers.test.ts`.
   `RecentActivityView.test.ts` passes unchanged; `TransactionsList.test.ts` takes `tokens`.
4. C7: build the cold-open block in `network/incoming-public-transfers.test.ts` with the two
   additive testids (after case 1: open `#/popup/activity` with the first identity reply held by the
   test, never by a product hook, then released; the pub→pub row's `activity-title` is the token
   symbol and its `activity-amount` is `+10`). Run it on `dev`'s code first and log the red. If it
   is not red there on three runs, delete the block and both testids and log why.

Gate:
- Commands: lint; `typecheck:all`; from `apps/extension`,
  `bun --bun vitest run src/composables/useScopedTokens.test.ts src/composables/useScopedTokens.callers.test.ts src/popup/incoming-row-parity.test.ts src/popup/pages/activity.test.ts src/popup/components/modules/general/RecentActivityView.test.ts src/popup/components/modules/activity/TransactionsList.test.ts src/utils/received-display.test.ts`;
  `bun run test:all`. If C7 is kept: P5's command for `incoming-public-transfers` on both browsers.
- Pass: all exit 0; step 1 red before step 3 (logged); C7 kept only with its logged red on `dev`.
- Layers: lint, types, unit, component; e2e-live-network if C7 is kept.

### P3 · Send's loading token card (D3)

1. `SelectTokenCard.test.ts` (new): loading ignores a click and Enter and opens no popup;
   `aria-busy`, `aria-disabled`, `tabindex="-1"` and `data-state="loading"`; `loading` with a token
   renders the token (`ready`); no skeleton before 300 ms, the skeleton after; the timer cleared on
   unmount; loaded with a token, a click, Enter and Space each open `select_token`, `tabindex="0"`,
   `role="button"`; loaded with none shows the empty copy and opens `new_token`.
2. `send.test.ts`, with `getTokens` deferred per identity and a balance loaded for A's active
   token: loading true, then false once it resolves; a superseded fetch does not end a newer
   fetch's loading; populated A → B: the page renders through B's load (no `TypeError`) and shows
   neither A's token nor its balance, then with B rejecting the empty state with loading false;
   A → unset identity: loading false, empty state; a rejection then recovery to B: B's token; a
   successful empty result: empty state, loading false; the mount fetch rejecting: no unhandled
   rejection, empty state. Token events start from an empty token list with a retained selected
   token id, so on today's code an appended foreign token becomes the rendered token: a
   foreign-chain `onTokenAdded` carrying that id is never rendered (assert the rendered token, not
   only the loading prop), whether it lands during B's load (which it does not end) or after B's
   rejection; an event for the current identity
   during the load is in the loaded list; after an empty load, an event for the current identity
   becomes the active token (`:448-457`). The stubs in `send.test.ts:139` and
   `send.integration.test.ts:155` take the new prop.
3. `send.integration.test.ts`: one case with the real `SelectTokenCard` (its stub removed for that
   case) and `getTokens` deferred: a click on `send-token-trigger` during the load opens no popup;
   after it resolves, a click opens `select_token`.
4. `send.vue`, `SelectTokenCard.vue`, the `send-picker.test.ts:31` comment.

Gate:
- Commands: lint; `typecheck:all`; from `apps/extension`,
  `bun --bun vitest run src/popup/components/modules/send/SelectTokenCard.test.ts src/popup/pages/send.test.ts src/popup/pages/send.integration.test.ts`;
  `bun run test:all`.
- Pass: all exit 0; step 3's click case and step 2's A → B and foreign-event cases red on today's
  code (logged). The A → B case is red because A stays visible; its no-`TypeError` assertion is a
  preservation guard.
- Layers: lint, types, unit, component.

### P4 · Default sponsor and wallet-send copy (D4, D5)

1. Failing first:
   - `fee-helpers.test.ts` `defaultSponsor`: `[hand, nulo, hand2]` → nulo; `[hand, hand2]` →
     undefined; none → undefined; `allowSponsored: false` → undefined.
   - `fee-privacy.test.ts`: a walk that reaches the sponsor with `[hand, nulo]` selects nulo on both
     origins; with `[hand]` only it never selects hand (the next payer, hold or none); a saved
     hand-added pick still wins (a guard: passes today).
   - `FeeSettingsCard.test.ts`: a non-Send card with `getFpcs` `[s2 hand-added, s1 Nulo's]` emits
     `fpcId: "s1"` and the readout says `sponsor`; with `[s2]` only it selects nothing.
   - `OperationCard.fee.test.ts`, wire-shaped `sendTx()`: `[HAND_ADDED, NULO_SPONSOR]` defaults to
     `s1`; the same request with a dApp name "Nulo Sponsored", a hand-added row named "Sponsored"
     and extra `exec` metadata still defaults to `s1` and writes no fee pick to storage; the
     self-payment lock case (`:166-174`) unchanged (a guard: passes today).
   - Existing fee tests whose sponsor fixture lacks `isProtocol: true` but expect it as the default
     are listed in the log and given `isProtocol: true` only where the case is about Nulo's sponsor.
2. `defaultSponsor`, its two call sites, the `menuOrder` comment and test title.
3. `transfer-executor.test.ts`, three pins that pass today and hold the mapping D4 and D5 rely on:
   `:207-219` gains `expect(proveAndSend).not.toHaveBeenCalled()` (an estimate failure never
   proves); `proveAndSend` rejecting with the node's refusal of an unfunded payer, in the text the
   builder records in `lessons/phase-4.md` from the pinned node's source or a local run (expected to
   carry `Insufficient fee payer balance`, Fact 16), journals `failed` with kind `transfer` and
   throws `JournaledRejection`; `addTransaction` rejecting inside `recordTransaction` (after the
   send) journals `failed` with kind `transfer`.
4. D5: `journal-state.test.ts:485-488` split: `transfer` → O3's label and context (the context
   asserted to say a submitted send may still land); `dapp_execute` unchanged. Then the arm.

Gate:
- Commands: lint; `typecheck:all`; from `apps/extension`,
  `bun --bun vitest run src/popup/components/modules/send/fee-helpers.test.ts src/popup/components/modules/send/fee-privacy.test.ts src/popup/components/modules/send/FeeSettingsCard.test.ts src/popup/windows/execute/OperationCard.fee.test.ts src/popup/components/modules/fee-cards.comount.test.ts src/wallet/services/execution/transfer-executor.test.ts src/utils/journal-state.test.ts`;
  `bun run test:all`.
- Pass: all exit 0; step 1's `defaultSponsor`, walk, card and execute cases, the two guards
  excepted, red before step 2 (logged); the refusal text recorded in the log.
- Layers: lint, types, unit, component (wire-shaped execute fixture).

### P5 · Full gates, browsers, the sign-off page

1. Every local gate: `bun run lint`, `bun run typecheck:all`, `bun run test:all`,
   `bun run test:ci-gating`, `bun run build`.
2. Smoke on both browsers: build with
   `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:<b>`,
   then `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`, for `chrome` and
   `firefox`.
3. Network e2e, from the repo root, one file per run, for each `<file>` in `send-picker`,
   `fee-methods`, `transfers`, `tx-sendTx-sponsoredFpc`, `incoming-public-transfers`,
   `incoming-transfers`, `incoming-arrival`:
   - Chrome, prover on (`incoming-arrival` is `@requires-proverless`: add `NULO_E2E_PROVERLESS=1`
     for it):
     `NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/<file>.test.ts --reporter=default --reporter=json --outputFile=.e2e-state/report-<file>-chrome.json`
   - Firefox, proverless:
     `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/<file>.test.ts --reporter=default --reporter=json --outputFile=.e2e-state/report-<file>-firefox.json`
   - The runner changes into `apps/extension` (`apps/extension/scripts/e2e/agent.sh:14`) and hands
     the flags to vitest (`:214`), so each report lands at
     `apps/extension/.e2e-state/report-<file>-<b>.json`. Before each run,
     `rm -f apps/extension/.e2e-state/report-<file>-<b>.json`, so only the current run's report can
     pass; after it, from the repo root,
     `jq -e '.numTotalTests > 0 and .numPassedTests == .numTotalTests' apps/extension/.e2e-state/report-<file>-<b>.json`
     must exit 0. A failure, a skip (a missing config, `test.skipIf(!hasConfig)`) or a missing
     report fails it.
4. Flake bar: `incoming-public-transfers` if C7 was kept, three consecutive retry-0 runs per
   browser with the same check. `send-picker`'s change is a comment and needs none.
5. `bun run e2e:reap`.
6. Captures for the sign-off page, Chrome and Firefox, from a throwaway capture spec never
   committed: the incoming row at 123,456,789 TST and at 999,999.9 on Home and History; History
   cold-opened beside Home; the Send token card loading (the token fetch held in the page), loaded,
   and focused by Tab; the execute window's fee card with a hand-added sponsor registered first, and
   with Nulo's sponsor missing; the journal page of a failed Send-page transfer.
7. Hand the captures to the driver, who publishes one private Artifact: at most about five calls
   with their screenshots (O1 to O4 as built), and one blanket sign-off for the rest of the UI
   impact table, which states in one line each: the "123.45M" truncation; the payer order line of
   D4; a failed token load keeps today's "No available tokens" / "Import token"; and Nulo's sponsor
   is chosen by identity, so where it holds no Fee Juice the send proves and the network refuses it
   with nothing spent, as today (a funding check before choosing it is the owner's call, now or as
   a follow-up).

Gate:
- Commands: steps 1 to 5 as written.
- Pass: every command exits 0; every report passes step 3's `jq -e` check (0 failed, 0 skipped);
  the flake bar's runs all pass; the sign-off Artifact URL printed.
- Layers: lint, types, unit, component, smoke e2e, e2e-live-network, both browsers.

### P6 · The owner's sign-off

The owner's answers on the P5 page, quoted here and in the PR body. A changed answer loops back
to the phase that built it, then reruns P5's gate for the affected surfaces.

Gate:
- Commands: P5 steps 1 to 3 for any surface changed after sign-off.
- Pass: exit 0, and a quoted owner message naming each signed-off surface.
- Layers: as P5, for the changed surfaces.

## Post-implementation (read by the implementing session)

Single-arc plan: after P6, one review loop over the whole diff (`dev`...HEAD). `/code-review` is
off for this plan: do not run it.

1. **Codex audit** (`/codex high`, GPT-6 Astra): the diff, this plan.md with its decision ledger,
   the adversarial ask ("What could go wrong? What would an attacker target? What are we trusting
   that we shouldn't? Where are the supply-chain / crypto / least-privilege weaknesses?"), the parity
   rule ("flag any UI that differs from the UI impact table or invents a state it does not list"),
   and verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
     extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
     problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or spends
     a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Iterative fix loop**: verify each finding against the repo first (codex can misread code),
   apply the accepted ones, commit each fix separately, log the round (the consult and its verdict,
   every rejection with its reason) in `lessons/phase-6.md`, then RESUME the same codex session with
   the fix diff for a re-review carrying the same two rules. Repeat until a round has no new material
   finding; rejected nitpicks are not churn. Still material after three rounds: stop and surface it
   to the owner.
3. If the loop changed a signed-off surface, re-capture it and ask the owner again.
4. **Delivery** (below): the first time any PR is opened.

Codex is advisory: it cannot override the owner's picks, CLAUDE.md or this scope.

## Delivery

- Single arc, one PR: branch `feat/ux-owner-picks` off `dev`, `gh pr create --base dev`, then
  `gh pr checks --watch`. No PR, draft included, before the loop converges.
- Title (≤ 93 characters): `feat(ux): compact amounts, history token lookup, send loading, nulo sponsor default`.
- Commits: conventional, lower-case, signed; one per phase at least, loop fixes separate.
- Body: summary; the UI impact table; the owner's quotes (the 2026-09-28 request and every sign-off
  answer); the sign-off Artifact link; test evidence; the shared-file lines (recon § Collision).
- New follow-ups for `implementations-plan/follow-ups.md` at close:
  - `dapp_execute` failures read "Reported by app" although the kind also covers the wallet's own
    simulate, prove and send failures of a dApp request (`journal-state.ts:217-219`).
  - Send's failed token load shows "No available tokens" / "Import token"; a real error state with a
    retry is an owner UI decision.
  - Six capped calls guess decimals 0 for an unknown token or a dApp mint and print a figure off by
    10^decimals (`TransactionCard.vue:41`, `:48-58`, `tx/[id].vue:83`, `:89-97`,
    `received/[id].vue:105`, `IncomingTrustPopup.vue:62-63`).
  - The protocol sponsor is stored without a deployment or funding check
    (`fpc/service.ts:163-173`), and the estimate cannot tell (Fact 16); a funding probe would let
    the card say so before the person waits for a proof the network then refuses.
  - Only if O1 is (b): the compact form on the other known-token capped surfaces.

## Seeds (DRAFT, finalized after approval)

Recommended, `/goal`:

```
/goal Deliver implementations-plan/ux-owner-picks/plan.md from its build worktree (lessons/phase-0.md): every phase P1-P6 marked ✓ in plan.md, each backed by its phase's validation gate reported passing in the transcript (P5: every network report under apps/extension/.e2e-state passing its jq -e check, 0 failed and 0 skipped), and LESSONS_FILE=implementations-plan/ux-owner-picks/lessons/phase-N.md printed per phase; until the owner answers O1 the compact form is built on the incoming row only (never O1's recommended (a) by default), and O2-O4 are built as recommended until answered; `/code-review` NOT run (code_review is off); the codex fix loop over the whole diff converged, evidenced by a resumed /codex high pass reporting no new material findings, quoted; the owner's answers to O1-O4, the owner's call on sponsor usability and the sign-off quoted; one PR from feat/ux-owner-picks into dev created only after the loop converged (gh pr view output shown); `bun run test:all` and `bun run lint` both exit 0 in the transcript. Never merge; UI questions go to the owner, technical ones to /codex high.
```

Fallback, `/loop 15m`:

```
/loop 15m Drive implementations-plan/ux-owner-picks forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/ux-owner-picks/plan.md (its Outcome & Quality Bar included) and lessons/. If the path is gone, look for implementations-plan/archive/ux-owner-picks/plan.md: the plan closed, STOP. If plan.md carries an ## Outcome block, STOP. Rebuild the task list from plan.md if empty; git status; git log --oneline -5; with a PR, gh pr view --json statusCheckRollup; without one, gh run list --branch $(git branch --show-current) --limit 1 --json status,databaseId.
2. Waiting on CI is fine: gh run watch <id> up to 10 minutes; stuck → log it as blocked in lessons.
3. No task in hand? Take the next unchecked step of plan.md. After each edit run bun run lint and the phase's focused vitest files, then commit and push the branch.
4. A decision? UI or product → the owner (hold that surface, keep working elsewhere; until answered, O1 builds the incoming row only, never its recommended (a), and O2-O4 are built as recommended). Technical → /codex high until a defensible call; log consult and verdict in lessons/phase-N.md. Never merge, publish or deploy; never expand scope beyond plan.md.
5. Same step failed 5 times? Stop retrying; reassess with codex.
6. Phase green means its validation gate as written in plan.md: run it, paste the result, mark ✓, write lessons, print LESSONS_FILE=implementations-plan/ux-owner-picks/lessons/phase-N.md, advance. A skipped e2e case is not a pass.
7. All phases ✓? /code-review stays off. Run the codex audit over dev...HEAD with the plan's no-over-engineering and comment-quality rules and the adversarial ask; fix, commit, resume the same session until a round has nothing material (3 rounds max, then surface). Then gh pr create --base dev, gh pr checks --watch, and a wrap-up: what shipped, each codex debate with its ELI5 context, open items. Surface and stop.
```

Use exactly one per session: they do not compose.
