---
plan: amount-honesty
tier: light
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
eli5_mode: artifact (one ELI5 Artifact covers the wave's plans; its URL is filled in later)
branch: fix/amount-honesty
worktree: .claude/worktrees/amount-honesty
base: dev after stack #729 lands (the tree at `0f37ab78`)
---

# Amounts that read as another number

Two places in the wallet can show a number that is not the amount, and one of them can send it.
One rule covers both: **the wallet never changes an amount's magnitude by guessing.** What it
cannot state exactly, it does not state.

- **A1 · Activity amounts that guess their decimals.** Six capped amounts format with decimals 0
  (or a hard-coded 8) when they cannot name the token, so a dApp's mint of one 18-decimal token
  reads "1,000,00" in History, and a sent transfer's detail page shows its raw integer while the
  token list loads. The list and detail pages have the right decimals for most of these rows
  already and do not use them. The sixth, the first-receive prompt, drops its figure (O4).
- **A2 · The amount field rewrites what it cannot read.** A paste of "1.234,56" becomes "1.23456"
  and "1e5" becomes "15"; a typed "1,5" becomes "15" and ",5" becomes "5". Each can be sent.
- **A3 · `comma`** is already deleted (#725, its F-3): nothing to build; P0 confirms it.

The owner answered the four UI asks on 2026-09-30 (§ UI asks, quoted in P4), and this plan is
built on those answers. One PR off `dev`, built once stack #729, which carries
`fix/send-amount-exact` (#725), has landed. Recon: [`recon.md`](recon.md).

## Phase 0 (pre-answered by the owner)

No clarifying questions were asked. The owner's words that start this work:

- 2026-09-28: "Can you ultracode 1 to 5 + security and privacy + test rliability + trivial?
  Assigning blueprinting level to each of those and just needing me to answer the open questons
  that it may come."
- 2026-09-29: "Feel free to leverage the gh cli to merge away the branches that you understand are
  ready and feel confident on their implementation. Continue then with ultracodeing the
  follow-ups."
- 2026-09-28: "FYI: use opus5.5 instead of fable please."
- 2026-09-29, on `fix/send-amount-exact`'s F-1 (`paste`, 14:37): **"fix"**. "The field keeps only
  digits and the point, as it does for typing (clamp the purged value, not the typed text). So
  "1.234,5678901" on a 6-decimal token reads "1.234567" at once and sends exactly that." This plan
  changes that reading; the owner decided again on 2026-09-30 (O3).

Recorded from those answers and the program's standing rules:

- **Scope**: A1 and A2. The records: `implementations-plan/follow-ups.md` § Amounts, sends and
  fees ("Six capped amounts guess their decimals") and § Send amounts (F-2);
  `implementations-plan/ux-owner-picks/plan.md` O1.
- **Out**: the same `|| 0` / `?? 0` fallback on surfaces that name a known token (journal rows,
  Recent Activity's in-flight rows, prices, the token fold: Follow-ups FU-1); the in-flight and
  terminal activity cards, which already name their token (#718); the input's 13-digit cap, which
  the owner declined to change (`send-amount-exact` A-2).
- **Constraints**: pre-production, no migrations; complexity budgets hold with no new acceptance;
  no new dependency; the logging policy; existing testids verbatim; e2e selects by `data-testid`.
- **Quality bar**: production. **`/harden`**: not scheduled. **`/code-review`**: off.
- **Validation layers**: typecheck, lint, unit, component, CI-gating scripts, build; smoke e2e on
  Chrome and Firefox (popup surfaces change); the network files that open the changed surfaces, on
  Chrome and Firefox; one native paste per browser; one real dApp mint observed end to end.
- **Decisions**: UI and product asks go to the owner (answered 2026-09-30); technical asks are
  decided with `/codex high`.
- **Delivery**: single arc, one PR off `dev` on `fix/amount-honesty`, plain `gh pr create` after
  the codex loop converges. The first commit adds `implementations-plan/amount-honesty/` and one
  line in `implementations-plan/index.md`. Merge: by the driver under the owner's standing
  authorization above, once every required check is green on the head, the blanket sign-off is
  quoted in P4, and the codex loop has converged.

### Phase 0.5 · Tier

| Dimension | Score (0-3) | Why |
|---|---|---|
| Novelty | 1 | The "no known token, no figure" rule and the compact form exist (#718); the reader extends the validator's own grouping rule |
| Blast radius | 1 | Five display sites and the first-receive prompt, one input field, one validator, one derived `TokenInfo` field; no stored shape, no message shape a dApp sees |
| Irreversibility | 0 | Code and tests only |
| Migration cost | 0 | No stored shape changes |
| External coupling | 0 | Nothing a dApp sees changes |
| Security sensitivity | 2 | A person decides on the first-receive prompt and sends the field's amount |

`light`, as the brief assigns and under the owner's cap "never blueprint more than mid, to keep our
credits safe": the risk is in getting two small rules exactly right, which a single audit and red
tests cover.

## Outcome & Quality Bar

For whom: a person reading History after using a dApp faucet, a person deciding whether to allow a
contract's receipts, and a person who types or pastes an amount into Send, in any locale.

Excellent means:

1. **No figure on these surfaces is off by a power of ten.** The card, the transaction page and
   the received page show the amount in decimals the wallet knows (a getter's in-range value, or
   the send record's own), or no figure at all: never the raw integer, never invented decimals,
   not while a list loads, not for a mint whose amount position the wallet does not know. The
   first-receive prompt shows none. A component test with an 18-decimal token in wire shape
   (`0x` + 64 hex, below the field modulus) proves each site and fails on the base.
2. **The amount field never turns text into an amount the person cannot see.** A typed comma is
   the point as it is typed (O3); a paste that reads as one amount keeps it; text that cannot be
   read, or can be read two ways, stays as written, blocks Send and says why; only the wallet's own
   resting text reads as the amount it rested. A table test over every form fails on the base;
   component tests cover the typed re-read, paste → token change → submit, Max and rest-then-edit
   with the submitted base units; a native paste is observed on Chrome and on Firefox.

Good enough: the same fallback on the out-of-scope surfaces stays (FU-1); a pasted "1.234" and a
typed "1,234" read 1.234, as the owner chose, shown so before Send; a listed token's standard mint
is read by its shape (F4, conceded by codex on the resumed pass).

## UI impact

Built as the owner answered on 2026-09-30 (P4). The answered rows carry that answer; the blanket
rows wait for the owner's sign-off on P3's screenshots.

| # | Surface | Before → after | Sign-off |
|---|---|---|---|
| 1 | Activity row (Home, History, a token's page) for a dApp mint of a listed token, one standard mint call (`mint_to_public` / `mint_to_private` / `mint_to_commitment`, two arguments) | One 18-decimal token reads "1,000,00" with no symbol → "1" and the token's symbol; past 8 characters the compact form of #718 ("1.23M") | blanket |
| 2 | The same row and the transaction page when the wallet cannot state the mint: the token is not listed, its decimals are unusable, the call is not a standard mint shape, or the transaction holds two mint calls | "1,000,00" (for two mints, their sum) → no figure; the title still reads "Mint" | O1 (c): ships (a) |
| 3 | Transaction page of a dApp mint of a listed token | "1,000,00" / "Mint amount" → "1 TST" / "Mint amount", compact past 8 characters | blanket |
| 4 | A mint whose dApp paid its fee through a fee payload (a Fee Juice claim, or a private-FPC `mint_and_pay_fee`) | The figure adds the last argument of every call, fee calls included → the minted amount only | blanket |
| 5 | Transaction page of a sent transfer, while the token list loads and after the token was removed | The raw integer cut to 8 characters ("1,000,00") → the amount from the send record ("1 TST"); the "TST is missing" banner stays when the token was removed | blanket |
| 6 | Received transaction page, while its token loads | "+1,000,00 Token" for a moment, then "+1 TST" → no figure until the token is known, then "+1 TST" | blanket |
| 7 | The card, the transaction page and the received page, a whole part longer than 8 characters | The plain cut ("1,234,56" for 1,234,567 tokens) → the compact form ("1.23M"), as every other known-token amount since #718 | blanket |
| 8 | Received page of a token whose decimals are unusable (a getter returning 255; a token with no getter) | "+1,000,00 TST" (decimals 0) → no amount block | O1 (c): ships (a) |
| 9 | A token symbol on the activity row and the transaction page | Rendered as the contract returned it → through `sanitizeWireString` (bidi and zero-width characters removed), as the first-receive prompt already does | blanket |
| 10 | Send amount field, a paste it cannot read ("1e5", "12.5 USDC", "$5" in token mode, "12,34.5") | Rewritten into another number ("15", "12.5", "5", "1234.5") that can be sent → kept as pasted, Send off, and "Not an amount. Type it like 1234.56" under the field | O2 (a) |
| 11 | Send amount field, a typed comma ("1,5", "1,234", "1,234.56") | Every comma dropped: "15", "1234", "1234.56" → the comma is the decimal point as it is typed: "1," shows "1.", "1,5" reads 1.5, "1,234" reads 1.234; a "." typed after it re-reads that comma as a thousands separator where it can be one (one to three digits before it, whole groups of three after it), so "1,234.56" shows "1.234", then "1234.", then "1234.56" | O3 (b) |
| 12 | Send amount field, a first typed "," | The keystroke vanishes, so ",5" becomes "5" → "0.", so ",5" becomes "0.5" | blanket |
| 13 | Send's USD line under text it cannot read or holds | "≈ $15.00" for "1e5" → the unit rate, as for an empty field | blanket |
| 14 | USD field, the same pastes and commas as rows 10, 11 and 15 | Rewritten, then converted into a token amount → the same rules; no token amount derived from held text; a leading "$" ("$12.50") still reads 12.50 | O2 (a), O3 (b) |
| 15 | Send amount field, a paste with a comma ("1.234,56", "1 234,56", "1,234", "1.234,5678901" at 6 decimals) | The comma dropped: "1.23456", "123456", "1234", "1.234567" → kept and read where only one reading exists ("1.234,56" and "1 234,56" are 1234.56, "1.234,5678901" is 1234.567890 with the clamp hint), in the wallet's form once the field is left ("1,234.56"); a pasted "1,234" is held, Send off, with "Is that 1234 or 1.234? Type the one you mean." | O3 (b) |
| 16 | The first-receive prompt ("Allow USDC?"), any contract | "You received 1.5 USDC from a contract you haven't seen before.", in the row's own decimals (0 without a getter) → "You received USDC from a contract you haven't seen before." | O4 (b) |

Unchanged: letters still never appear from the keyboard; a typed or pasted "." is the decimal
point, so a pasted "1.234" still reads 1.234; a first "0" still gives "0."; the clamp and its hint;
the resting form of a plain amount ("1234" rests "1,234"); what Max writes (it now also marks that
text as the wallet's rest, so its "1,234" reads as 1234); the review sheet, which shows the field's
text (`popup/components/modules/send/SendReviewSheet.vue:112-113`, `send.vue:311`), rested once the
field is left, and the page has no Enter path that skips the blur.

### UI asks for the owner

A record: each Ask, its options, and the owner's 2026-09-30 answer, given in chat on text mocks
with the exact copy (P4 quotes them).

- **O1 · An amount the wallet cannot state** (rows 2 and 8): (a) no figure, as a received row of an
  unknown token already shows (#718); (b) the whole integer with a "base units" caption on the two
  pages; (c) look the decimals and symbol up, its own plan, shipping (a) now. Under every option a
  transaction with more than one mint call shows no figure: the wallet cannot say which amount is
  the person's. **Answer: (c)**, "Look it up (own plan)": this PR ships (a); the lookup is FU-5.
- **O2 · A paste the field cannot read** (rows 10 and 14): (a) keep it, Send off, the line under the
  field at once; (b) refuse it and restore the prior text. **Answer: (a)**.
- **O3 · Commas and dots** (rows 11, 12, 14 and 15): (a) drop every comma (today, the F-1 answer);
  (b) a typed comma is the decimal point, pastes read by (c)'s reader; (c) keep a comma and read it
  where only one reading exists, holding "1,234"; (d) as (c), and hold a pasted "1.234" too.
  **Answer: (b)**, and, asked next because (b) with today's second-point rule reads a typed
  "1,234.56" as 1.23456, "Yes, re-read it": a "." typed after a comma the field turned into the
  point re-reads that comma as a thousands separator.
- **O4 · The first-receive prompt's amount** (row 16): (a) in the row's reported decimals, as today;
  (b) none until the person allows the contract. **Answer: (b)**, on the corrected premise of
  Fact 21, with today's sentence minus the amount.
- **The blanket sign-off**, open until P3's screenshots: rows 1, 3 to 7, 9, 12 and 13, one line
  each, and row 11's two edges, which follow from the O3 answer: a second typed comma is dropped
  ("1,234,567" reads 1.234567), and the re-read needs whole groups of three ("1,5." stays 1.5).

## Architecture & Implementation

### A1 · One helper for the activity amount

- **`TokenInfo.hasDecimals`** (`wallet/services/token/spec.ts`, derived in `getTokenInfo`,
  `wallet/services/token/utils.ts:4-17`, as `!!token.getDecimalsFn`, beside the `has*` fields):
  a derived boolean, no stored shape. `fetchTokenMetadata` writes 0 for a contract with no decimals
  getter (`token/service.ts:783`), so a stored 0 alone cannot tell a real zero from a missing one.
- **`knownDecimals(token)`** in `utils/token-amount.ts`, beside `isValidDecimals`:
  `token?.hasDecimals === true && isValidDecimals(token.decimals) ? token.decimals : null`. Its
  TSDoc carries the invariant: a missing getter is stored as 0, which is never a known 0. The
  activity rows re-read the token list on an add (`composables/useScopedTokens.ts:65`), so a
  re-added token's decimals show there at once; an update, and the two detail pages, which read
  the list once per open (`tx/[id].vue:151`, `received/[id].vue:166`), show them on the next open.
  A sent transfer keeps its record's snapshot, the decimals it was typed in.
- **`utils/tx-amount.ts`** (new, pure, colocated test; imports only `utils/primary-method.ts`,
  `utils/token-amount.ts` and `sanitizeWireString`, none of which loads `@aztec/*`):

  ```ts
  export type TxAmount = { units: bigint; decimals: number; symbol: string }
  /** The amount a settled transaction record states, or null when the wallet cannot state it
   *  exactly: a transfer from its own record, a standard mint from the listed token it names. */
  export function txAmount(
    calls: readonly TxCall[] | undefined,
    tokens: readonly Pick<TokenInfo, "contract" | "decimals" | "symbol" | "hasDecimals">[],
  ): TxAmount | null
  ```

  - Primary: `calls[pickPrimaryIndex(calls) ?? 0]` (`utils/primary-method.ts:81`, already
    `ReadonlyArray`, the pick `getPrimaryCall` makes).
  - **transfer**: `primary.transfers?.[0]`; decimals from its snapshot `token` (Fact 1) through
    `isValidDecimals`; units only from a digit string.
  - **mint**: `primary.method` is one of `mint_to_public`, `mint_to_private`, `mint_to_commitment`
    with exactly two arguments, the aztec-standards Token's shapes, amount last (Fact 18); no other
    call in the list has one of those names; the token is `tokens.find((t) => t.contract ===
    primary.contract)` with `knownDecimals`; units from a decimal digit string or `0x` hex, below
    2^128 (the shape's `u128`). A lookalike (another arity), a second mint call or any other
    argument yields `null`.
  - **symbol**: `sanitizeWireString(symbol, 32)` (`wallet/services/dapp-session/capability-meta.ts:161`),
    as `IncomingTrustPopup.vue:56` does. It strips bidi, zero-width and control characters; it does
    not catch a homoglyph, which is why the prompt shows the contract.
  - **other**: `null`.
- **`TransactionCard.vue`**: gains `tokens: { type: Array, default: () => [] }`; `transferAmount`,
  `mintAmount` and `displayAmount` collapse into one computed over `txAmount`, formatted with
  `balanceFormatted(units, decimals, 8, { compact: true })`; `displayAmountSymbol` and the transfer
  title read the helper's sanitized symbol; the fiat label keeps its transfer-only rule and reads
  the helper's decimals (it passed `?? 0`, `:147`). The dead UI-origin branch (Fact 3) and the
  `OriginType` import go, and with them the narrating comments at `:51`, `:106` and `:128` and the
  "D2:" label at `:141`. `TransactionsList.vue:63` and `RecentActivityView.vue:853` pass their
  `tokens`.
- **`tx/[id].vue`**: the same helper over `tx.calls` and the page's `tokens`; the hero keeps its
  two blocks (transfer: the record's symbol; mint: "Mint amount") keyed on the category. The "is
  missing" banner keeps its rule (`transfer && !token`), `transferFiat` keeps the listed token.
- **`received/[id].vue`**: `token` becomes `tokenForReceipt(tokens, inc)`
  (`utils/received-display.ts:58-65`, removing the copy at `:96-100`); `formattedAmount` is `null`
  without `knownDecimals`, else compact; the amount block gets a `v-if` on it.
- **`IncomingTrustPopup.vue`** (O4 (b)): the sentence drops the amount for every contract, and
  `formattedAmount` with its `balanceFormatted` import goes. The stale `aztec_registerToken`
  paragraph (`:11-15`, Fact 21) becomes one sentence naming the real triggers: a listed token with
  no trust row, after a trust write that failed at add or a backup restore. The symbol comment
  (`:52-55`) becomes one sentence: the symbol is contract-controlled, and the sanitizer removes
  invisible and bidi characters, not look-alike letters.
- **`amount.callers.test.ts`**: the card's, the transaction page's and the received page's rows
  become one compact call each; the prompt's row goes; the header sentence drops "none of the calls
  that guess decimals".

### A2 · The field reads its text whole

- **`readAmountText(text, { rested?, currency? })`** in `utils/amount.ts`, pure, the one definition
  of "reads as one amount". Returns `{ ok: true, plain } | { ok: false, reason: "ambiguous" |
  "unreadable" }`, `plain` being digits and at most one ".". Trims; with `currency: "$"` drops one
  leading "$". Then, in order:
  1. no digit → unreadable;
  2. `text === rested` and the wallet's comma grouping → its commas removed (the field's own
     resting form; `GROUPED`, moved here from `send-amount.ts:31-32`);
  3. `/^\d*\.?\d*$/` → as is (a dot is the decimal point);
  4. `/^[1-9]\d{0,2},\d{3}$/` → ambiguous;
  5. comma grouping, point decimal (`/^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d*)?$/`) → commas removed;
  6. point grouping with a comma decimal or two groups (`/^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d*)?$/`) →
     points removed, the comma a point;
  7. space grouping (U+0020, U+00A0, U+202F, U+2009) with an optional "." or "," decimal → spaces
     removed, the comma a point;
  8. comma decimal (`/^\d*,\d*$/`) → the comma a point;
  9. anything else (exponents, letters, symbols, a sign, misplaced separators) → unreadable.
  A prototype over the P2 table (42 forms) and the edit sequences of P2 steps 2 to 4 (48) matched
  every expected row (recon).
- **Provenance.** `rested` (`defineModel("rested", { default: null })`) is text the wallet itself
  wrote at rest: the blur rest, Max, the decimals watcher's re-rest. Every other write and every
  edit clears it, an edit only after `nextAmountText` has compared the prior text with it, so it
  never matches later text (else Max "1,234", Backspace to empty and a pasted "1,234" would read
  1234). The **comma point**, card state, marks the text's one "." as one a typed comma wrote: that
  keystroke sets it, it holds while that point stays (a blur rest that keeps the point keeps it),
  and every other write clears it. One dense comment where they are defined states both invariants.
- **`validateSendAmount`** (`popup/pages/send-amount.ts:48-87`) gains `rested?`, reads through
  `readAmountText`, and returns `invalid` on any failed read. The first-comma fallback (`:56`) goes,
  and the header paragraph (`:1-10`) becomes its contract in one sentence. It stays the single
  gate: `send.vue:231-237` passes the card's `rested`.
- **`nextAmountText({ prior, value, inputType, data, decimals, rested, commaPoint, currency })`** in
  `amount-field.ts`, pure: the text after an edit, the comma point, and which hint shows (`clamp`,
  `unreadable`, `ambiguous`, or none).
  - **Paste-like** (`inputType` starting `insertFrom`: paste, drop, yank; or
    `insertReplacementText`): `value` as it stands, read by the reader.
  - **Into a kept text that does not read** (and is not empty): `value` as it stands, so a hand
    edit of a kept paste is never rewritten.
  - **Keystroke** otherwise. The edit is `value` less the prefix and suffix it shares with `prior`;
    when `prior` is `rested` and holds a comma, those lose their commas, the wallet's grouping
    ("1,234" + "5" is "12345", "1,234" + "," is "1234."). A lone "," writes "." (O3 (b)); a longer insertion
    keeps its commas for the reader. Every character but digits, "." and "," goes. A "." typed after
    the comma point re-reads it as a thousands separator where it can be one: one to three digits
    before it (the first not 0), whole groups of three after it ("1.234" + "." is "1234.", "1.5" +
    "." stays "1.5"). Any other second point, a second typed comma included, is dropped by today's
    rule ("1,234,567" reads 1.234567, "1,234,567.89" reads 1234567.89). Then `normalizeAmount`'s
    cap, and a first "0" gives "0.", last.
  - **Clamp**, on every path: only when the text reads, on its `plain`; the clamped plain replaces
    the text and the clamp hint shows.
  - **Hints**: `unreadable` or `ambiguous` at once after a paste-like edit, after a keystroke only
    once the field is left; each clears when the text reads or empties. The ambiguous line names
    both readings from the text.
- **`AmountCard.vue`**:
  - `handleAmountInput` (`:58-78`) becomes a call to `nextAmountText` with the input's own value,
    `e.inputType`, `e.data`, `lastText`, `rested` and the comma point; it writes the model once, as
    today, and clears `rested`.
  - `lastText`, `rested` and the comma point are set by one writer used by every card write (the
    handler, blur, Max, the fiat writers, the watcher); a watch on the model resets `lastText` and
    clears the other two on a parent write (`send.vue:473`, `:645` set it to `null`).
  - Max in token mode (`:288-298`) writes its grouped text as today and sets `rested` to it; in USD
    mode it writes plain text (`:302-310`) and clears it.
  - The decimals watcher (`:83-94`) acts only on a text that reads: it clamps the `plain` and, when
    that changes it, writes the clamped reading at rest (`restingAmount`) and sets `rested`, so a
    grouped amount keeps its grouping (`AmountCard.test.ts:203-208`); held text stays and keeps
    Send off.
  - Blur (`:101-105`): a text that reads rests as `restingAmount(plain, decimals)` and sets
    `rested`; other text stays; the keystroke hint shows from here.
  - `modelRaw` (`:130-139`) reads through `readAmountText(model, { rested })`, so held text has no
    USD figure (row 13).
  - The USD field (`:200-212`, `:190`) runs the same `nextAmountText` with `currency: "$"`, its own
    `lastText` and comma point and no `rested`, then today's leading-dot fix (a `plain` starting
    with "." gains a "0", `:202-204`, since `parseUsdToMicro` refuses ".5",
    `wallet/services/price/convert.ts:101-103`) and micro-precision cut on the `plain`;
    `scheduleConvert` converts only a text that reads, else writes `""` to the model (row 14).
  - Two hints in the clamp hint's slot and style (`:379-381`): `send-amount-unreadable-hint` and
    `send-amount-ambiguous-hint`.
  - The workflow labels "C3" (`:32`, `:120`) and "G1b" (`:158`, `:257`) go.

### File-level change map

| File | Change |
|---|---|
| `apps/extension/src/wallet/services/token/spec.ts`, `utils.ts` | `TokenInfo.hasDecimals` |
| `apps/extension/src/utils/token-amount.ts` (+ test) | `knownDecimals` |
| `apps/extension/src/utils/tx-amount.ts` (+ test) | new: `txAmount` |
| `apps/extension/src/popup/components/modules/activity/TransactionCard.vue` (+ test) | `tokens` prop, helper, compact, sanitized symbol, comments |
| `apps/extension/src/popup/components/modules/activity/TransactionsList.vue`, `general/RecentActivityView.vue` | pass `tokens` to the card |
| `apps/extension/src/popup/pages/tx/[id].vue` (+ new test) | helper, compact |
| `apps/extension/src/popup/pages/received/[id].vue` (+ new test) | `tokenForReceipt`, `knownDecimals`, null until known, compact |
| `apps/extension/src/popup/components/popups/IncomingTrustPopup.vue` (+ test) | no amount; the header and symbol comments |
| `apps/extension/src/utils/amount.callers.test.ts` | three rows compact, the prompt's row gone, header sentence |
| `apps/extension/src/utils/amount.ts` (+ test) | `readAmountText` |
| `apps/extension/src/popup/pages/send-amount.ts` (+ test) | the reader and `rested`; no first-comma fallback; header |
| `apps/extension/src/popup/pages/send.vue` | `v-model:rested`, passed to the validator |
| `apps/extension/src/components/composite/send/amount-field.ts` (+ test, which pins `restingAmount`) | `nextAmountText` |
| `apps/extension/src/components/composite/send/AmountCard.vue` (+ test) | the edit path, `lastText`, `rested`, the comma point, Max, the watcher, the hints, `modelRaw`, the USD field, labels |
| `apps/extension/src/types/auto-imports.d.ts`, `.eslintrc-auto-import.json` | regenerated by the build for the new `utils/` exports |
| `apps/extension/tests/e2e/network/send-amount-exact.test.ts` | one synthetic paste case, one typed re-read |

### Trade-offs and alternatives not taken

- **Resolve decimals in the parents and pass a number to the card.** Each parent would repeat the
  category and mint rules; one pure helper keeps them in one place, testable without a mount.
- **Catch the paste at `beforeinput`.** Cleaner in a browser, but it moves the keystroke filter out
  of the handler every existing component test drives through `trigger("input")`, and jsdom's
  `beforeinput` support is partial. `inputType` on `input` carries the same fact (C1).
- **Record each mint's amount parameter at build time** (the builder resolves the artifact's
  function, `tx-request-builder.ts:186`, `:195`) instead of fixed shapes. Truer for any token, but
  it changes the stored call record; the standard shapes cover every mint the wallet meets today.
- **Keep the model plain and show the person's text in a local ref.** It removes the provenance
  channel but splits the input from its model and changes what the review sheet shows.
- **Track the comma point by position.** The text holds at most one ".", so a flag says which one
  it is; a position would have to follow every caret edit.

## Security & Adversarial Considerations

- **Threat model.** A dApp controls a transaction's calls and arguments; a token contract controls
  its symbol and decimals, and may name a function after a standard one; a paste is arbitrary
  text. The attack is a figure that misleads: a prompt that reads larger than the receipt is, a
  lookalike mint that shows an invented figure, or text that sends another amount.
- **Input validation.** `txAmount` reads only the standard mint shapes, a digit string or `0x` hex
  below 2^128, and one mint call per transaction, and returns `null` otherwise: no throw inside a
  render, no sum a second call can inflate. Decimals pass `isValidDecimals` (0 to 77) before any
  `10n ** BigInt(...)`, and a stored 0 counts only with a getter.
- **What a listed contract still controls.** Its getter can report misleading in-range decimals,
  and a standard-named mint of its own can take a second argument that is not the minted amount.
  That is a contract the person added, which already sets its balance, symbol and decimals on Home
  and in History, and the figure is display-only on the person's own transaction (F4, Decision
  ledger; codex conceded it, the shape check does not authenticate mint semantics).
- **The first-receive prompt.** Every add trusts its contract at once (Fact 21), so a dApp's fake
  USDC never reaches it; it opens for a listed token with no trust row (a failed trust write at add,
  a backup restore), where a figure would be scaled by the row's own decimals. It shows none
  (O4 (b)); FU-4 trusts restored tokens.
- **The symbol** is sanitized at every new rendering boundary (row 9); Vue's escaping stops markup,
  the sanitizer stops invisible and bidi tricks, and neither stops a homoglyph, which the prompt
  answers with the contract address.
- **The send path.** `validateSendAmount` stays the single gate, and the reader accepts a text only
  as its one reading; `rested` lets only the field's own resting text read as the amount it rested;
  a typed comma writes a point the person sees, and the re-read removes one only for a "." typed
  after it; held text never reaches a conversion. No path writes a reading the person did not see.
- **Privacy.** No new node, PXE or network call (FU-5's lookup would add one). Nothing new is
  logged; `log-payload-ban.test.ts` holds.
- **Least privilege, cryptography, supply chain.** N/A: no credentials, crypto or dependency
  change.

## Assumptions

### Facts (verified at `0f37ab78` by reading the file)

1. The card's transfer amount uses the record's own token (`TransactionCard.vue:37-41`); the
   wallet writes that token's name, symbol and decimals into the record at send
   (`wallet/services/execution/transfer-executor.ts:191-203`; `wallet/services/transaction/spec.ts:54-71`).
2. Only the wallet's own transfers record `transfers`: a dApp's call is recorded as its contract,
   method and arguments (`wallet/services/execution/tx-request-builder.ts:189`, `:197`), so a dApp
   transfer's row shows no amount (`TransactionCard.vue:128-133`).
3. A mint formats with decimals 8 for a UI origin and 0 otherwise (`TransactionCard.vue:50`,
   `tx/[id].vue:91`). UI-origin transactions come only from the transfer executor
   (`transfer-executor.ts:109`) and the auth registry's `set_authorized` and `set_reject_all`
   (`auth-registry/service.ts:284-297`, `:338-353`), so every mint is a dApp's, at decimals 0.
4. The mint figure adds the last argument of every call (`TransactionCard.vue:52-56`,
   `tx/[id].vue:92-96`), and a dApp's fee payload rides in the same list: a Fee Juice `claim` and
   `mint_and_pay_fee`, or `claim_and_end_setup` (`utils/primary-method.ts:13-25`, `:47-56`); the
   playground sends one `mint_to_private` "with the route's fee payload merged in front"
   (`apps/playground/src/sections/phase.ts:124-133`).
5. The transaction page takes a transfer's decimals from the token list, not the record
   (`tx/[id].vue:78-79`, `:83`), and loads that list after mount (`:150-151`), so it shows the raw
   integer until the list arrives and for good once the token is removed; the banner is
   `:216-225`.
6. The received page takes decimals from the token list (`received/[id].vue:96-100`, `:105`),
   fetched after the record and its network (`:147-166`), and its amount block renders
   unconditionally (`:224-230`). Removing a token wipes that contract's receipts on the network it
   is removed from (`wallet/services/incoming-transfer/service.ts:1176-1201`), so the unknown case
   there is mostly the load window.
7. `Token.decimals` is any number (`wallet/services/token/spec.ts:20`, `:45`); a contract without
   a decimals getter is stored with 0 (`token/service.ts:783`); an update re-fetches and overwrites
   it (`:553-561`). The popup's add refuses an interface without every getter
   (`popup/components/popups/NewTokenPopup.vue:197-201`, `isTokenComplete`,
   `token/utils.ts:19-28`) and a dApp's add refuses one without a decimals getter
   (`execution/service.ts:887-894`), so the missing-getter 0 is reached today only through the
   internal `addToken` / `updateToken` RPC; an out-of-range value from a hostile getter is reachable
   by any add the person approves. The prompt's decimals are the listed token's, passed by three
   emits (`incoming-transfer/service.ts:1447`, `:1554`, `:2145`), and the popup falls back to 0
   (`IncomingTrustPopup.vue:62`).
8. "No known token, no figure" is the incoming row's rule (`utils/received-display.ts:67-86`,
   `components/composite/activity/TransactionIncomingCard.vue:37-41`), signed off by the owner in
   #718 (ux-owner-picks UI impact row 5); `isValidDecimals` is `utils/token-amount.ts:14-16`.
9. `utils/amount.callers.test.ts:14-29` pins the six calls plain and every other capped call
   compact, and refuses any option but `{ compact: true }` (`:68-79`).
10. Both parents of the card hold the profile and chain's tokens (`TransactionsList.vue:18-20`,
    `RecentActivityView.vue:152`) and render the card without them (`TransactionsList.vue:63`,
    `RecentActivityView.vue:853`).
11. `purgeNumber` returns a plain decimal as is and otherwise keeps only digits and "."
    (`utils/amount.ts:11-14`): "1e5" → "15", "1.234,56" → "1.23456", "1 234,56" → "123456",
    "$5" → "5"; "1.234" passes as is. `normalizeAmount` drops the last character when a text holds
    two "." (`:16-30`).
12. `handleAmountInput` purges every input, a paste included, then clamps the purged value
    (`components/composite/send/AmountCard.vue:58-78`); `modelRaw` and the USD conversion read
    through `purgeNumber` (`:130-139`, `:190`, `:200-212`); the decimals watcher clamps the model
    text as it stands (`:83-94`), so a kept "1.234,56" would become "1.23" on a switch to a
    2-decimal token.
13. `validateSendAmount` removes every comma from a text grouped in threes and otherwise drops the
    first comma (`popup/pages/send-amount.ts:31-32`, `:56`), so "1,5" validates as 15 and "12,34.5"
    as 1234.5, and "1,000" as 1000 (pinned in `send-amount.test.ts:139-148`). `GROUPED` also matches
    "0,001" and "1,234", reading them as 1 and 1234.
14. Measured on the handler logic (a copy run under Bun; the handler is the same at `0f37ab78`):
    typed "1,5" → "15", "12,5" → "125", ",5" → "5", "0,5" → "0.5" (a first "0" already gives "0.").
    The first-"," rule (`AmountCard.vue:63`) never fires: `normalizeAmount("")` returns "" and
    overrides it (`:65-66`).
15. Amounts display in the browser's locale (`utils/amount.ts:1-9`), the popup's body is
    `user-select: none` with a `.selectable` exception (`packages/design/src/base.css:291`,
    `:426-428`), and an input's text can be copied, so a pasted figure can come from the wallet
    itself in a comma-decimal locale.
16. `comma` is gone from `utils/amount.ts` and from both declaration files (`git grep -nw comma`
    finds no definition or declaration under `apps` or `packages`), and `follow-ups.md` no longer
    lists its F-3.
17. The unit tests run on jsdom (`apps/extension/vitest.config.ts:29`); the field's tests drive
    input with `trigger("input", { data })` or `{ inputType }` (`AmountCard.test.ts:40`, `:49`,
    `:171`), or `setValue`, one event holding the whole text. The F-1 cases
    (`AmountCard.test.ts:167-176`; `send-amount.test.ts:181`, `:183`) pin "1.234,5678901" →
    "1.234567"; `AmountCard.test.ts:203-208` pins a grouped amount re-clamped on its fraction;
    `amount-field.test.ts:4-25` pins `restingAmount`, "1." resting as "1" (`:8`).
18. The aztec-standards 5.0.1 Token's mints are `mint_to_public(to, amount)`,
    `mint_to_private(to, amount)` (its `inputs` parameter is the private context, not an argument)
    and `mint_to_commitment(commitment, amount)`, `amount` a `u128`
    (`@aztec-foundation/aztec-standards/target/token_contract-Token.json`); `getTxCategory` only
    checks the `mint_to_` prefix (`utils/tx-enrichment.ts:102-107`).
19. The card exposes its amount as `data-tx-amount-display`
    (`components/composite/activity/TransactionCardLayout.vue:77`); the e2e helper that reads it
    (`tests/e2e/fixtures/helpers.ts:1274`) is passed amounts of 1 to 100, which the compact form
    leaves unchanged.
20. `balanceFormatted` (en) gives "1" for 10^18 at 18 decimals, "1.23M" for 1,234,567 tokens
    compact and "<0.000001" for one base unit at 18 (`utils/amount.test.ts:431`, `:441`).
21. Every added token's contract is trusted before any scan: `onTokenAdded` flips its trust
    (`incoming-transfer/service.ts:1133-1174`) for the popup form, a dApp's approved
    `register_token` and the default seeds (`addSeededToken` → `persistToken` → the emit,
    `token/service.ts:503-523`, `:433`), pinned by `service.scenarios.test.ts:2546` and
    `tests/e2e/network/token-add-auto-trust.test.ts`. The prompt opens only for a listed token with
    no trust row (`incoming-transfer/service.ts:1433-1451`, `:2126-2149`): after a trust write that
    failed at add, or a backup restore, as `TokenService.restore` writes rows without the emit
    (`token/service.ts:853-896`) and no backup slice carries trust
    (`wallet/services/backup/backup-migration-registry.ts:195-216`). A dApp's fake USDC never
    reaches it, a restored default seed can, and the header's `aztec_registerToken` paragraph
    (`IncomingTrustPopup.vue:11-15`) is stale.
22. #725's Max writes the resting form in one write, with no blur (`AmountCard.vue:288-298`), and
    the fiat writers write plain text (`:179-181`, `:302-310`); a token pick resets the page's
    amount to `null` (`send.vue:466-474`).

### Inferences (unverified; the audit attacks these)

1. Stack #729 lands as `0f37ab78` with no later change to the plan's files; P0 compares them.
2. A call's `contract` and the token list's `contract` are the same string for the same address
   (lower-case `0x` hex). A mismatch falls to "no figure", never a wrong one.
3. Chrome and Firefox report a native paste into a text input as `inputType: "insertFromPaste"`,
   and a comma key (a numpad's decimal key in a comma locale included) as one `insertText` with
   `data` ",". P3 observes the paste natively on each; the e2e's typed re-read drives real keys.
4. The transactions in the app store belong to the active network, so the scoped token list is the
   right one to resolve a mint against (codex's final pass: supported by scoped storage).
5. A dApp's `encoded_call` records the standard mints with two field arguments, `to` and `amount`
   (an `AztecAddress` is one field). P1's wire fixture assumes it; P3 observes a real playground
   mint end to end.

### Asks

**Owner** (answered 2026-09-30, quoted in P4)

- **O1**: (c) "Look it up (own plan)": this PR ships (a), no figure; the lookup is FU-5.
- **O2**: (a) "Keep it, block Send".
- **O3**: (b) "Typed comma = decimal point", pastes read by (c)'s reader, plus "Yes, re-read it".
- **O4**: (b) "No amount until allowed", today's sentence minus the amount.
- **Blanket**: rows 1, 3 to 7, 9, 12 and 13 and row 11's two edges, open until P3's screenshots.

**Codex** (`/codex high`)

- **C1 · Paste versus keystroke** (`inputType` with the prior-text rule): round 1 amend (findings
  2, 3) and final pass amend (F2, F3), both applied. The owner's O3 answer then set the keystroke's
  comma rule (§ A2), which the driver's resumed codex check covers.
- **C2 · The helper's home** (`utils/tx-amount.ts`): approve in both passes (finding 8:
  `pickPrimaryIndex` is pure and read-only, so the helper loads no `@aztec/*`).
- **C3 · The mint sum**: round 1 amend, applied; final pass amend (F4, F6): F6 applied, F4
  disputed, then conceded by codex on the resumed pass.
- **C4 · The browser test's paste**: round 1 amend, applied (a synthesized paste in e2e, one native
  paste per browser in P3); final pass approve.

### Plan audit ledger

- `/codex high` (GPT-6 Astra), session `01a0ede8-868d-7420-a767-bfa9bbebe45f`: **reject**,
  confidence high. Eight findings; all accepted or amended below.

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| 1 | codex | major | Stored decimals are unvalidated, a missing getter becomes 0, updates overwrite: the invalid-decimals branch is reachable | accepted: `hasDecimals` / `usableDecimals` / `knownDecimals` guard every touched surface; the no-amount sentence is O1; tests for genuine 0, missing getter, 255 and changed decimals. Fact 7 corrected: the missing-getter 0 is reached only through the internal RPC, 255 through any approved add |
| 2 | codex | major | The decimals watcher clamps a kept unreadable paste into a sendable amount | accepted: the watcher and every clamp act only on a text that reads, on its `plain`; `lastText` follows blur, Max, fiat and parent writes; `e.data` passed; a paste → token change → submit component test |
| 3 | codex | major | `GROUPED` reads "0,001" as 1 and "1,234" as 1234 | amended per the driver: the reader reads every unambiguous comma form, holds only "d,ddd", and the wallet's own resting text reads through `rested`; what the field does with commas is O3, pictured |
| 4 | codex | major | Mint identification is a name-prefix heuristic; the last argument need not be an amount | accepted: only the standard Token's three mints, two arguments, `u128`, one mint call per transaction; lookalike and mixed-call tests. C3 needs no owner ask: no real flow sends two mints |
| 5 | codex | major | O1 (c)'s privacy claim is unsupported | amended: O1 (c) stays on the page with its disclosure stated from `batched-view-simulation.ts:550-570`, not built here; an answer of (c) opens its own plan |
| 6 | codex | major | The token add does not sanitize symbols | accepted: Security corrected; `sanitizeWireString` at every new symbol boundary, with a hostile Unicode fixture |
| 7 | codex | minor | Tests overclaim: circular formatter mock, fake addresses, preservation tests labelled red, synthetic paste, O2 (b) hint lifetime | accepted: the mock goes, fixtures become wire-valid (`0x` + `0a` × 32), unchanged cases are labelled pins, a native paste per browser in P3, O2 (b)'s hint and Send behaviour specified and tested |
| 8 | codex | minor | Align the read-only contracts; trim touched narration; fix the trust popup comment; add the missing-decimals invariant | accepted: `pickPrimaryIndex` is already `ReadonlyArray`; the comments at `TransactionCard.vue:51`, `:106`, `:128` go; the trust popup comment is rewritten; `knownDecimals`' TSDoc carries the invariant |
| — | codex | noted | Fact 6 "only the load window" too absolute; recon's "nothing shared" search claim false | accepted: Fact 6 and recon corrected; the other `|| 0` sites are FU-1 |

- `/codex high` (GPT-6 Astra), final fresh pass at `0f37ab78`, session
  `01a0f289-5ba8-7250-a11d-5461693f82c4`: **reject**, confidence high. Five majors and three
  minors: F2, F3, F7 and F8 accepted, F1, F5 and F6 amended, F4 disputed. Its moved citations are
  corrected in the Facts, § A1, § A2, recon and FU-1. The owner's answers retired two round-1
  resolutions: `usableDecimals` (the prompt has no figure) and O2 (b)'s behaviour (not chosen).

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| F1 | codex | major | A pasted German "1.234" (one thousand) reads 1.234, a realistic 1000× under-send; O3 (a) restores wrong magnitudes | amended per the driver: O3 gained (d) and kept (a), the owner's F-1 answer; the owner chose (b), pastes read by (c)'s reader, so a pasted "1.234" reads 1.234 by the owner's choice, shown before Send |
| F2 | codex | major | `prior === rested` strips a new comma (type "12", leave, type ",5" gives 125), and a paste can inherit the wallet's reading | accepted: `rested` is only the wallet's own rest, and every edit clears it after the comparison (a gap found in revision: Max "1,234", Backspace, a pasted "1,234" would read 1234); under O3 (b) a typed comma writes the point, so 125 cannot arise, and the rested strip covers it ("1,234" + "," is "1234."); parent-bound tests on the submitted base units |
| F3 | codex | major | #725's Max writes grouped text with no blur, so a Max of 1,234 tokens reads as ambiguous and disables Send | accepted: Max sets `rested` and `lastText`; the watcher re-rests and sets it; fiat and parent writes clear it; Max at 1,234 tokens sends 1234 × 10^18; "Max unchanged" restated |
| F4 | codex | major | Name, arity and `u128` range do not prove a listed contract's second argument is an amount | disputed: the driver keeps the shape rule (Decision ledger) and resumes codex on it |
| F5 | codex | major | Adding a token does not establish trust in its getter; the first-receive prompt scales its figure by unvalidated decimals | amended: the premise is wrong at the code, as every add trusts its contract and the prompt opens only for a listed token with no trust row (Fact 21); Security corrected; the owner chose O4 (b) on the corrected premise, still the safer default; the stale header is rewritten; FU-4 |
| F6 | codex | minor | "No real flow sends two mints" is unsupported: any batch is accepted, the playground batches | amended per the driver: no figure stays the rule; the realism line goes; the two-mint row and page are captured |
| F7 | codex | minor | Tests overclaim: two prompt cases already pass; the F2/F3 sequences, a listed mint on the transaction page and metadata propagation are missing; P3 may inject a mint record | accepted: the sequences and a listed-mint page case added; the prompt's figure cases leave with its figure (O4 (b)); live re-render claimed only for the activity rows on an add (`useScopedTokens.ts:65`); P3 observes a real playground mint |
| F8 | codex | minor | Workflow labels in `AmountCard.vue`, a paragraph in `send-amount.ts:1`; no invariant for resting provenance | accepted: "C3" and "G1b" go, and "D2:" at `TransactionCard.vue:141`; `send-amount.ts:1-10` becomes its contract; one invariant where `rested` and the comma point are defined |

- `/codex high` (GPT-6 Astra), the same session resumed on this revision: **conditional approve**,
  confidence high. F1 to F6 and F8 resolved, F7 partly; F4 conceded ("a display heuristic within
  an already contract-controlled token representation, not new signing authority"); no unseen
  wrong-amount sequence found in § A2. Conditions 1 to 3, all accepted and applied:

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| G1 | codex | minor | A pasted ".5" in the USD field no longer reaches today's leading-dot fix, and `parseUsdToMicro` refuses ".5" (`convert.ts:101-103`), so Send stays off | accepted: § A2 keeps the fix (`AmountCard.vue:202-204`) after the reader; P2 step 4 adds the ".5" paste (red) and keeps the typed case (pin) |
| G2 | codex | minor | "1.234,56" at 2 decimals needs no clamp, so it cannot re-rest; two expectations are already green; "the same pastes" in USD mode is unclear | accepted: the re-rest case uses "1.234,567", "1.234,56" is a pin; "1,000" with `rested` and the received page's "+1" after loading are labelled pins; the USD case names which pastes convert and which clear |
| G3 | codex | minor | The comma point's lifecycle is not pinned | accepted: parent-bound sequences for blur and return, a replacing paste and a removed comma point, and card cases for the USD re-read and `insertReplacementText` |

### Decision ledger

- **Outline** (light): two pure helpers, `txAmount` for the activity surfaces and
  `readAmountText` with `nextAmountText` for the field, over one derived `hasDecimals`, one
  card-owned provenance string and a comma-point flag, so each rule lives once and tests without a
  mount; the rejected alternatives are § Trade-offs.
- **The owner's answers** (2026-09-30, P4) settle O1 to O4. Two edges follow from O3 and go on the
  blanket page: the re-read needs whole groups of three after the comma (the technical reading of
  "as a thousands separator"), and a second typed comma is dropped by today's second-point rule.

Realism, per the owner's rule (2026-09-29): "Don't even care with a balance of 10 trillion tokens
my friend. let's cover realistic scenarios lol."

- **Realistic, fixed**: a dApp mint of a listed token (row 1; faucets and the playground mint this
  way); a mint paid through a fee payload (row 4; a new account's first transaction, Fact 4); a sent
  transfer's page while the list loads or after the token's removal (row 5); a receipt's page while
  its token loads (row 6, a flash on every open).
- **Realistic, no figure**: a dApp mint of an unlisted token (row 2; mint first, add later; FU-5);
  two mint calls (the builder records any batch, `tx-request-builder.ts:137`; the playground
  batches, `apps/playground/src/sections/transactions.ts:60-66`; a token admin minting to several
  recipients), since the wallet cannot say which amount is the person's (F6); a lookalike mint of a
  spam dApp, unless its shape is standard (a listed contract's own lookalike is F4, below);
  unusable decimals on the received page (row 8), reachable through any approved add (Fact 7); the
  first-receive prompt (row 16), after a backup restore (a default seed included) or a failed trust
  write at add, never after a successful add (Fact 21; FU-4).
- **A listed token with no decimals getter**: reached today only through the internal RPC
  (Fact 7); guarded on the touched surfaces anyway, by the driver's call on codex round-1 finding 1;
  elsewhere FU-1.
- **Typed commas** (a comma-decimal locale, a numpad whose decimal key types a comma): realistic;
  "1,5" and ",5" send 15 and 5 today (Fact 14) and now read 1.5 and 0.5. A "1,234" meant as 1234
  reads 1.234, shown so while typed and on the review sheet (the owner's O3 answer), and "1,234.56"
  reads 1234.56 by the re-read. "1,234,567" is rare: it reads 1.234567, shown as typed, while
  "1,234,567.89" reads 1234567.89.
- **Pastes**: "1.234,56", "1 234,56" and "1,234.56" are realistic (an exchange, a spreadsheet, the
  wallet's own display in a comma-decimal locale, Fact 15) and read; "1,234" and "12,345" are truly
  two-way and held; a German "1.234" meant as 1234 (F1) reads 1.234 by the owner's O3 answer, shown
  before Send; "1e5" or "1e-7" is rare but sends another amount today, so it is unreadable.
- **Max and rest-then-edit**: a Max of a round balance ("1,000" after a faucet) would read as
  ambiguous under a blur-only `rested` (F3), so Max sets it; ",5" after a rested "12", "," or "5"
  after a rested "1,234", or "1,234" pasted after Max and Backspace are realistic, and every edit
  clears `rested` (F2).
- **Not realistic**: a paste of 10 trillion or more (the owner's words above, and his decline of
  the input cap in `send-amount-exact` A-2); it stays as pasted and reads "exceeds balance"; no test.
- **A symbol with a homoglyph**: realistic for a spam token and beyond any sanitizer; the prompt's
  contract row is the answer.

Disputed:

- **F4 · Mint semantics** (final pass, major).
  - Codex: a listed contract's `mint_to_public(x, y)` with `y` below 2^128 passes though `y` need
    not be an amount; require authenticated evidence of the implementation, else no figure.
  - Driver: rejected for this plan: that contract is one the person added and already sets its
    balance, symbol and decimals everywhere the wallet shows it, the figure is display-only on the
    person's own transaction and invites no send, and the only authenticated evidence, a class pin,
    exists for default seeds alone (`default-tokens.ts`), pinning every listed token being a new
    feature (FU-2, FU-3).
  - Settled: codex conceded on the resumed pass, "a display heuristic within an already
    contract-controlled token representation, not new signing authority", the limitation stated
    in § Security.

### Follow-ups

- **FU-1 · The same decimals fallback on surfaces that name a token.** `RecentActivityView.vue:188`,
  `:373`, `popup/pages/journal/[id].vue:79`, `utils/journal-state.ts:381`, `composables/usePrices.ts:83`
  and `utils/token-fold.ts:21` format with `decimals || 0` / `?? 0`, and Home, Holdings and the
  incoming row read `isValidDecimals` without `hasDecimals`, so a token without a decimals getter
  reads in base units there. Reached today only through the internal RPC (Fact 7); move them to
  `knownDecimals` when one of them is next touched.
- **FU-2 · Mint amounts for any token.** Record each call's amount parameter from the artifact the
  builder already resolves (`tx-request-builder.ts:186`, `:195`), so a non-standard mint can show
  a figure. Only if a real dApp's mint shows none.
- **FU-3 · Class-pin listed tokens beyond the default seeds.** A pin on each added token's class,
  as the seeds carry (`wallet/services/token/default-tokens.ts`), would let a mint figure rest on
  the implementation rather than its function's name (the F4 dispute). A new feature, its own plan.
- **FU-4 · Trust restored tokens** (the owner's pick, 2026-09-30; its own small PR after this
  program): a restored token is trusted as an added one is, by the flip `onTokenAdded` runs; no
  backup format change; a Block on a listed token is not kept. Evidence (Fact 21):
  `TokenService.restore` writes rows without that emit (`token/service.ts:853-896`) and no backup
  slice carries trust (`wallet/services/backup/backup-migration-registry.ts:195-216`), so each
  restored token with a receipt, a default seed included, opens the first-receive prompt.
- **FU-5 · Look up an unlisted mint's decimals and symbol** (the owner's O1 answer; its own plan).
  The getter is a public call simulated on the node with this account as its sender
  (`wallet/services/execution/helpers/batched-view-simulation.ts:551-572`), so the node learns that
  this account looked at that contract; it needs the dApp's artifact in the PXE, a per-network and
  per-contract cache, and a failure state.

## Approval

The final fresh codex pass rejected the plan (F1 to F8); revised per the driver's decisions and the
owner's 2026-09-30 answers to O1 to O4 (quoted in P4); the resumed pass gave a conditional approve,
its three conditions applied (G1 to G3). **Cleared to build** by the driver on 2026-09-30, under the
owner's standing instruction that the plans need only the owner's answers. The delivery boundary:
the PR may open and run CI before the blanket sign-off; it does not merge until that sign-off is
quoted in P4, beside the O1 to O4 answers.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/amount-honesty/lessons/phase-N.md`. Unit and component commands
run from `apps/extension`. Every new behaviour test on existing code is run red on the unfixed code
first and the red run recorded; a case marked **pin** already passes on the base and is labelled
so; a case marked **new** tests a new helper, which has no base behaviour to fail on, so the red
proof is its surface's test.

### P0 · Plan in the tree, and the landed field re-read ✓

Assumptions: Inference 1.

1. Branch `fix/amount-honesty` off `dev` once stack #729 has landed. Compare the change map's
   files with `0f37ab78` (`git diff --stat 0f37ab78 origin/dev -- <files>`); on any change, record
   in `lessons/phase-0.md` whether Facts 11 to 17, 21 and 22 still hold at their lines, and adjust
   § A2 before P2. Confirm `comma` is still gone (A3).
2. First commit: `implementations-plan/amount-honesty/` (`plan.md`, `recon.md`) and one line in
   `implementations-plan/index.md`.

Gate:
- Commands: `bun run lint`; `bun run test:ci-gating`.
- Pass: both exit 0 (the plans check reads the new directory).
- Layers: lint, CI-gating.

### P1 · Activity amounts from known decimals (A1) ✓

Assumptions: Facts 1 to 10, 18 to 21; Inferences 2, 4 and 5; O1 (a) and O4 (b), as answered.
Addresses in every new or touched fixture are `0x` + `0a` × 32 style values below the field
modulus; `ONE` is `0x` + `(10n ** 18n)` as 64 hex digits.

1. New, in `src/utils/token-amount.test.ts`: `knownDecimals` over rows built with `getTokenInfo`,
   so `hasDecimals` is exercised through its consumer: a getter at 18 → 18; a getter at 0 → 0; no
   getter, stored 0 → `null`; 255 → `null`; no token → `null`.
2. New, `src/utils/tx-amount.test.ts`, one `test.each`:
   - `mint_to_public(recipient, ONE)` on a listed 18-decimal token → `{ units: 10n ** 18n,
     decimals: 18, symbol: "TST" }`; the same behind `claim` and `mint_and_pay_fee` with large last
     arguments → the same;
   - `null` for: an unlisted token; `hasDecimals: false`; decimals 255; a three-argument
     `mint_to_public`; a second mint call on another contract; an amount of 2^128; an argument
     that is neither digits nor hex; a dApp transfer (no `transfers`);
   - a genuine 0-decimal token with a getter and amount `0x5` → units 5, decimals 0;
   - a UI transfer whose record says 18 decimals, with an empty list → its units and 18;
   - a symbol `"US‮DC​"` → `"USDC"`.
3. Red, `TransactionCard.test.ts`: the #718 case "never reads as >999T" (`:108-118`) is rewritten
   on wire-valid fixtures (it used `0xtoken` and `"ab"` × 32): with the token listed, "1" and
   "TST"; without it, no amount; 1,234,567 tokens, "1.23M"; two mint calls, no amount.
4. Red, `src/popup/pages/tx/[id].test.ts` (new; services mocked as `TransactionCard.test.ts`
   does): a sent transfer of one 18-decimal token with the list still empty reads "1" and its
   symbol; a dApp mint of a listed 18-decimal token reads "1", "TST" and "Mint amount"; a dApp mint
   of an unlisted token renders no amount block.
5. Red, `src/popup/pages/received/[id].test.ts` (new): no amount while the token list is pending;
   none for a row without a getter; and "+1" once it resolves with an 18-decimal token (a pin:
   today's page already shows it after loading).
6. Red, `IncomingTrustPopup.test.ts`, with its `balanceFormatted` mock removed (`:63-65`) and a
   wire-valid contract (`:27`, and the trimmed form at `:117` with it): payloads at 18 decimals, at
   255 and without decimals all read "You received TST from a contract you haven't seen before."
7. Build § A1. Update `amount.callers.test.ts` (three rows compact, the prompt's row gone, the
   header sentence).

Gate:
- Commands: `bun --bun vitest run src/utils/token-amount.test.ts src/utils/tx-amount.test.ts src/popup/components/modules/activity/TransactionCard.test.ts "src/popup/pages/tx/[id].test.ts" "src/popup/pages/received/[id].test.ts" src/popup/components/popups/IncomingTrustPopup.test.ts src/utils/amount.callers.test.ts src/popup/components/modules/activity/TransactionsList.test.ts src/popup/components/modules/general/RecentActivityView.test.ts`; `bun run lint`; `bun run typecheck:all`.
- Pass: every command exits 0; each red case failed on the unfixed code (recorded).
- Layers: typecheck, lint, unit, component.

### P2 · The field never changes a magnitude unseen (A2)

Assumptions: Facts 11 to 17 and 22; Inferences 1 and 3; C1 as applied; O2 (a) and O3 (b) with
the re-read, as answered.

1. New, in `src/utils/amount.test.ts`, one `test.each` for `readAmountText`:
   - reads: "1234.56", "1.", ".5", " 12.5 " → the plain text; "1.234", "12.345" → as is; "0,001" →
     "0.001"; "1,5" → "1.5"; ",5" → ".5"; "12,50" → "12.50"; "1,2345" → "1.2345"; "0,123" →
     "0.123"; "1,234.56" → "1234.56"; "1,234,567" → "1234567"; "1.234,56" → "1234.56";
     "1.234.567" → "1234567"; "1 234,56" with an ordinary space, "1 234,56" and
     "1 234.5" → "1234.56", "1234.56", "1234.5"; "1 234" → "1234"; "$12.50" with
     `currency: "$"` → "12.50"; "1,234" and "1,000" with `rested` equal to the text → "1234",
     "1000";
   - ambiguous: "1,234", "12,345", "123,456", "1,000";
   - unreadable: "1e5", "1E5", "1e-7", "1.5e3", "12,34.5", "1,5,", "1.234,5,", "1,234,5",
     "1.234,5,678901", "12.5 USDC", "$5" (token mode), "-1".
2. Red, `src/popup/pages/send-amount.test.ts`:
   - the validator: "1,5" → 1.5; "12,34.5" (`:145`) → `invalid`, and "1,000" (`:140`) → `invalid`
     without `rested` (both flip the base's pins); "1,234" → `invalid`; pins: "1,000" with
     `rested: "1,000"` → 1000, and "1,000,000", "123,456,789.5", "1.234,5," and "1.234" keep their
     results.
   - the field-to-send harness (`sendsFromField`, `:15-28`) passes the card's emitted `rested` to
     the validator, as the page does. Its `setValue` is one insertion of the whole text, which keeps
     its commas for the reader, so its F-1 rows (`:181`, `:183`) become "1.234,5678901" → rests
     "1,234.56789", sends 1234567890 (6 decimals), and "1.234,5,678901" → unreadable, `invalid`,
     labelled as the O3 change.
   - sequences on a parent-bound model (a wrapper that binds `v-model` and `v-model:rested` and
     validates as `send.vue` does), each asserting the field's text and the submitted base units:
     typed "1,234.56" shows "1.", "1.234", "1234." and "1234.56", sends 1234.56 × 10^18 (red: the
     base shows "1" after "1,"); typed "1,234" → "1.234", 1.234 × 10^18 (red); type "12", leave,
     type ",5" → "12.5", 12.5 × 10^18 (red, F2); rested "1,234" plus a typed "," → "1234." (red),
     plus a typed "5" → 12345 (pin); rested "1,234", select all, paste "1,234" → held, `invalid`
     (red, F2); Max at a balance of 1,234 tokens → "1,234", 1234 × 10^18 (pin, the guard for F3);
     Max at 1,234, Backspace to empty, paste "1,234" → held, `invalid` (red). The comma point's
     lifecycle, each asserting text, review text and base units: typed "1,234", leave, return,
     typed "." → "1234.", 1234 × 10^18 (red); typed "1,234", select all, paste "1.234", typed "." →
     "1.234", 1.234 × 10^18 (red: the paste clears the comma point); typed "1,234", Backspace over
     the point, typed "." then "." → the second "." is dropped and no re-read happens (red).
3. New, in `src/components/composite/send/amount-field.test.ts` (it pins `restingAmount`):
   `nextAmountText` for a paste of "1.234,56" into "" (kept, reads); "e5" pasted after "12" (kept
   "12e5", unreadable hint at once); "1.1234567" pasted at 6 decimals (clamped, clamp hint); "1,234"
   pasted (kept, ambiguous hint at once); "1.234" pasted (reads); typed "a" after "12" ("12");
   "," typed after "1" ("1.", comma point set); "." typed after the comma point in "1.234"
   ("1234.", cleared), in "1.5" ("1.5") and in "0.123" ("0.123"); "." typed after a typed point in
   "1.234" ("1.234"); "," typed after the comma point in "1.234" ("1.234"); a first typed ","
   ("0."); "0" typed into the kept "12e5" ("12e50", kept); a deletion inside a kept text (kept).
4. Red, `AmountCard.test.ts` (keystrokes as `trigger("input", { data, inputType: "insertText" })`):
   - "1,234,567" typed shows "1.234567"; "1,234" typed shows "1.234" and no hint;
   - a paste of "1.234,56" leaves field and model at "1.234,56", no hint, and the blur rests it as
     "1,234.56" and sets `rested`;
   - a paste of "1e5" shows `send-amount-unreadable-hint`, no USD figure; a paste of "1,234" shows
     `send-amount-ambiguous-hint` at once, naming "1234 or 1.234";
   - paste "1e5", switch to a 2-decimal token, then the send page's validator: the text stays
     "1e5" and the result is `invalid`; the same with "1.234,567" re-rests the clamped reading as
     "1,234.56" and sets `rested` (red); "1.234,56" needs no clamp and keeps its text (pin);
   - Max emits `update:rested` with its text; a paste then clears it; a parent write of `null`
     clears it; `lastText` follows each (the next keystroke takes today's path);
   - in USD mode "1e5" and "1,234" pasted write `""` to the model and show their hints, while a
     pasted "1.234,56" converts; "12,5" typed reads 12.5; "$12.50" converts; ".5" pasted at $1 per
     token converts to 0.5 tokens (red), and the typed ".5" case stays (pin); "1,234" typed then
     "." re-reads to "1234." in USD mode too (red); an `insertReplacementText` edit clears the
     comma point (red);
   - the flipped F-1 case (`:167-176`) is rewritten to the O3 reading ("1234.567890" and the clamp
     hint); the grouped re-clamp (`:203-208`) and every other existing typing case pass unchanged
     (pins).
5. Build § A2 (with the labels and the `send-amount.ts` header), then `bun run build` and commit
   the regenerated declarations with the change.
6. Add to `tests/e2e/network/send-amount-exact.test.ts`: on the funded Send page with a
   destination filled, dispatch a paste (`InputEvent` with `inputType: "insertFromPaste"` after
   setting the value, per C4) of "1e5" into `send-amount-input`: the field reads "1e5",
   `send-amount-unreadable-hint` shows, `send-submit` stays disabled; Max then fills the balance and
   `send-submit` enables; cleared and typed with the keyboard, "1,234" reads "1.234", and a further
   ".56" makes it "1234.56".

Gate:
- Commands: `bun --bun vitest run src/utils/amount.test.ts src/popup/pages/send-amount.test.ts src/components/composite/send/amount-field.test.ts src/components/composite/send/AmountCard.test.ts src/popup/pages/send.test.ts src/popup/pages/send.integration.test.ts`; `bun run lint`; `bun run typecheck:all`; `bun run build`; `git status --porcelain apps/extension/src/types` prints nothing after the commit.
- Pass: every command exits 0; each red case failed on the unfixed code (recorded).
- Layers: typecheck, lint, unit, component, build.

### P3 · Browser proof, the arc gate and the screenshots

1. `bun run lint`; `bun run typecheck:all`; `bun run test:all`; `bun run test:ci-gating`;
   `bun run build`.
2. Smoke, for `<b>` in `chrome` and `firefox`, one at a time:
   `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:<b>`,
   then `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`.
3. Network, one file per run, for `<file>` in `send-amount-exact`, `send-amount-clamp`,
   `fiat-send`, `transfers`, `incoming-transfers`:
   - Chrome, prover on: `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/<file>.test.ts`
     (a file marked `@requires-proverless` adds `NULO_E2E_PROVERLESS=1`);
   - Firefox: `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/<file>.test.ts`.
   Each run's executed, passed and skipped counts go in `lessons/phase-3.md`; a skipped spec (no
   network configuration) is not a pass.
4. Flake bar: `send-amount-exact`, three consecutive retry-0 runs per browser.
5. **Native paste, once per browser** (Inference 3), from the throwaway capture spec of step 8:
   write "1.234,56" to the clipboard, press the platform's paste shortcut in `send-amount-input`,
   and record in `lessons/phase-3.md` the `inputType` the field saw (a temporary `console.debug`
   in the capture patch), the field's text and the model's reading. If a browser refuses clipboard
   access under automation, the driver pastes by hand in that browser and records the same three
   facts.
6. `bun run e2e:reap` after the last e2e run of the phase.
7. **One real dApp mint** (Inference 5), from the same capture spec: deploy the fixture's
   18-decimal token with the extension account as its minter (`tests/e2e/fixtures/selfpay-phase.ts:42`),
   send one `mint_to_private` of 10^18 through the playground's phase section as
   `tests/e2e/network/selfpay-phase.test.ts` sends its mints, and record in `lessons/phase-3.md`
   the stored call's method and argument count, then the History row and the transaction page
   while the token is unlisted (no figure) and after adding it ("1" and "PHT"). A wire-shaped
   record written into the transaction store serves only the states a live send cannot make (two
   mint calls; decimals 255 through a patched token row), never as this proof.
8. **Screenshots for P4**, from that throwaway capture spec, never committed, at the popup's size,
   of the built states only: Chrome and Firefox in light, and Chrome in dark. The prompt is opened
   by seeding a token row, a pending trust row and a hidden receipt, as
   `tests/e2e/network/incoming-transfers.test.ts:134-180` does.

   | Rows | State |
   |---|---|
   | 1, 3, 4 | step 7's mint once its token is listed: the History row ("1", "PHT") and the transaction page; row 4 when that mint rode a fee payload |
   | 2 | the same mint while its token is unlisted, and a transaction with two mint calls: History row and transaction page |
   | 5, 7, 8 | a sent transfer's page with the token list empty; the received page at 1,234,567 tokens ("+1.23M"); the received page of a token whose decimals read 255 |
   | 9 | an activity row whose seeded token symbol carries a bidi override |
   | 10, 13 | "1e5" pasted into an empty field, with the USD line; "e5" pasted after a typed "12" |
   | 11, 12 | typed "1,5", "1,234", "1,234.56" (after its "." and at the end), "1,234,567", "1,5." and ",5" |
   | 14 | "12.5 USDC" pasted and "12,5" typed in USD mode |
   | 15 | pasted "1.234,56" (in the field and after leaving it), "1,234" (held, with the line) and "1.234,5678901" on a 6-decimal token |
   | 16 | the prompt for a restored USDC with a receipt |

   Row 6 is a load-time flash; its component test (P1 step 5) stands in for a screenshot.

Gate:
- Commands: steps 1 to 6 as written.
- Pass: every command exits 0; every network run 0 failed and 0 skipped; the flake bar's six runs
  pass; both native pastes recorded with `insertFromPaste` (or the fallback's result in its place,
  and § A2 adjusted if a browser reports another type); step 7's mint recorded as
  `mint_to_private` with two arguments (else § A1's shape rule and P1's fixture are corrected
  first); the screenshots listed exist.
- Layers: typecheck, lint, unit, component, CI-gating, build, smoke e2e, e2e-live-network, both
  browsers.

### P4 · The owner's sign-off

1. The owner's answers, 2026-09-30, given in chat on text mocks with the exact copy, verbatim from
   the driver's record:
   - **O1** → "Look it up (own plan)". The option read: "Fetch the token's decimals and symbol from
     the node. The node learns this account looked at that contract. Not built here: the first
     option ships now and this opens its own plan."
   - **O2** → "Keep it, block Send (Recommended)".
   - **O3** → "Typed comma = decimal point". Asked next, because (b) plus today's second-point rule
     turns a typed "1,234.56" into 1.23456: "Yes, re-read it (Recommended)". A "." typed after a
     comma the field turned into the point re-reads that comma as a thousands separator, so
     "1,234." becomes "1234." and "1,234.56" sends 1234.56; "1,5" still reads 1.5 and "1,234" alone
     still reads 1.234.
   - **O4** → "No amount until allowed (Recommended)", note: "It'd be cool to communicate this is an
     unverified token. You recived USDC from an unverified token you haven't seen before." After
     the correction of Fact 21, asked which sentence: "Today's sentence, no amount (Recommended)",
     i.e. "You received USDC from a contract you haven't seen before.", note: "should we add that
     the trust records go into back-ups?" Asked which fix, as its own small PR after this program:
     "Trust restored tokens (Recommended)" (FU-4).
2. The driver publishes P3's screenshots in one private Artifact and asks the blanket sign-off:
   rows 1, 3 to 7, 9, 12 and 13, one line each, and row 11's two edges. The answered rows'
   screenshots sit beside their answers.
3. Record the sign-off here, quoted. A change the owner asks for is a new step in the phase that
   built it, then P3's gate for the affected files and new screenshots.

Gate: the delivery boundary (§ Approval): the PR does not merge until the blanket sign-off is quoted
here.

## Post-implementation (read by the implementing session)

`/code-review` is off. The review loop is `/codex high` (GPT-6 Astra) over the whole diff
(`dev...HEAD`), after P3 is green and before any PR:

1. **Codex audit**: the diff, this plan and its decision ledger, the adversarial ask ("What could
   go wrong? What would an attacker target? What are we trusting that we shouldn't?"), and these
   two rules, verbatim in the first prompt and in every resumed one:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative
     abstractions, extra configuration surface, new layers, or rewrites — the smallest change
     that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop**: verify each finding against the code before acting; apply the accepted ones,
   commit each fix separately, log the round (consult and verdict) in `lessons/phase-3.md`, then
   resume the same codex session with the fix diff. Repeat until a round has no new material
   finding. Still material after three rounds: stop and surface it to the owner.
3. Codex is advisory: it cannot override the owner's answers, CLAUDE.md or this scope.
4. If the loop changed a surface in § UI impact, re-capture it for P4.
5. **Delivery** (below), the first time a PR is opened.

## Delivery

- Single arc, one branch `fix/amount-honesty`, one PR off `dev`, plain `gh pr create` after the
  loop converges; then `gh pr checks --watch`.
- Title: `fix(amounts): state activity amounts only in known decimals and never reread an amount`
  (≤ 93 characters).
- Commits: conventional, lower-case, signed; at least one per phase, fixes separate.
- PR body: the UI impact table with the owner's O1 to O4 answers quoted and the blanket as
  **pending** until signed off, the red-before-green evidence per phase, the e2e counts, the native
  pastes, the real mint, the screenshots.
- **Overlap.** Built on `dev` after stack #729, whose #725 owns the field; this PR changes its
  validator's comma rule, its field's edit path and Max's provenance, and, by the owner's O3
  answer, the F-1 reading. #728 (`send-states`) moved `send.vue`'s fee card and strip, not its
  amount wiring; `copy-polish` edits `send.vue` strings, not the lines this plan changes.
- **Merge**: by the driver under the owner's standing authorization, once every required check is
  green on the head, the blanket sign-off is quoted in P4, and the codex loop has converged.
- Closing the plan: an `## Outcome` block, lessons promoted, FU-1 to FU-5 moved to
  `implementations-plan/follow-ups.md`, and the "Six capped amounts" and F-2 entries there deleted,
  in the same PR.

## Seeds

Final. Artifact: one ELI5 for the wave's plans, https://claude.ai/artifact/WY5w8GEggYX9zZTEuqBktk.

Recommended, `/goal`:

```
/goal Deliver implementations-plan/amount-honesty/plan.md. Done when the transcript shows every phase ✓ in plan.md with its validation gate reported passing, the red run recorded before each behaviour fix, LESSONS_FILE=implementations-plan/amount-honesty/lessons/phase-N.md printed per phase, P3's e2e counts recorded with no skipped network spec, the send-amount-exact flake bar three of three per browser, one native paste recorded per browser and the real playground mint recorded, a resumed /codex high pass quoted with no new material findings, and gh pr view showing the one PR off dev created after that pass; bun run test:all and bun run lint both exit 0 in the transcript. /code-review is off and was not run. The owner's O1 to O4 answers are quoted in P4; merge only once the blanket sign-off on P3's screenshots is quoted there and every required check is green. UI questions go to the owner, technical ones to /codex high.
```

Fallback, `/loop 15m`:

```
/loop 15m Drive implementations-plan/amount-honesty/plan.md forward. Never idle. Each firing: read plan.md and lessons/ (stop if the plan has an Outcome block or moved to archive/); git status, git log --oneline -5; if a PR exists, gh pr view --json statusCheckRollup. Take the next unchecked step; write its failing test first and record the red run (a pin or a new helper's case is labelled, not red); after each edit run bun run lint and the phase's vitest command from apps/extension; commit and push the branch. A technical decision: /codex high, logged in lessons/. A UI question: hold it for the owner's page (P4). Phase gate green: paste it, mark ✓, print LESSONS_FILE. One e2e:agent at a time; a skipped network spec is not a pass; bun run e2e:reap after the last run. All phases ✓: the Post-implementation loop, then gh pr create and gh pr checks --watch, then report and stop. Merge only with the blanket sign-off quoted in P4 and every required check green; hard limits stay hard.
```

Use exactly one per session.
