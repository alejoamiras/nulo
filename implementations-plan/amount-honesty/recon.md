# Recon: amount-honesty

Read at `0f37ab78`, the top of stack #729 (`dev` `4387b112` plus eight PRs, #725
`fix/send-amount-exact` among them in its final form): what `dev` becomes when the stack lands.
Every path is repo-relative under `apps/extension/src/` unless it says otherwise.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Decide whether a `decimals` value can be used | `isValidDecimals` (`utils/token-amount.ts:14-16`), already the guard of the incoming row (`components/composite/activity/TransactionIncomingCard.vue:37-41`) | reuse, plus `knownDecimals` beside it, which also requires the getter |
| Tell a stored 0 from a missing getter | the stored `Token.getDecimalsFn` (`wallet/services/token/spec.ts:24`); `getTokenInfo` derives `has*` booleans from the stored functions (`wallet/services/token/utils.ts:4-17`) | adapt: one more derived boolean, `hasDecimals` |
| "No known token, no figure" rendering | the incoming row's `null` decimals (`utils/received-display.ts:67-86`) and terminal journal rows (`utils/journal-state.ts:372-383`); owner-signed in #718 (ux-owner-picks UI impact row 5) | reuse the rule; the card and `tx/[id].vue` already hide a null amount (`TransactionCard.vue:128-139`, `tx/[id].vue:198`, `:208`); the receipt page's amount block (`received/[id].vue:224-230`) renders unconditionally and needs a branch |
| Capped display with the compact form | `balanceFormatted(units, decimals, 8, { compact: true })` (`utils/amount.ts:68`) | reuse as is |
| The primary call | `pickPrimaryIndex` (`utils/primary-method.ts:81`, `ReadonlyArray`, no imports), the pick `getPrimaryCall` makes (`utils/tx-enrichment.ts:91-97`, which loads `@aztec/*`) | reuse `pickPrimaryIndex`; `getTxCategory`'s prefix check (`tx-enrichment.ts:102-107`) is too loose for an amount, so the helper names the three standard mints |
| Which mint shapes carry an amount where | aztec-standards 5.0.1 Token: `mint_to_public(to, amount)`, `mint_to_private(to, amount)`, `mint_to_commitment(commitment, amount)`, `amount: u128` (`node_modules/@aztec-foundation/aztec-standards/target/token_contract-Token.json`) | reuse as the helper's fixed shape list |
| Which calls are fee payload | `FEE_METHODS`, `userIndexesOf` (`utils/primary-method.ts:13-25`, `:47-56`) | reuse through `pickPrimaryIndex` |
| Decimals of a sent transfer | the tx record's `transfers[0].token.decimals`, snapshotted at send (`wallet/services/execution/transfer-executor.ts:191-203`, `wallet/services/transaction/spec.ts:54-71`) | reuse: `tx/[id].vue` switches to it |
| Decimals of a mint's token | the profile and chain's token list the parents already hold (`popup/components/modules/activity/TransactionsList.vue:18-20`, `RecentActivityView.vue:152`; `tx/[id].vue:78`, `:150-151`), re-read on every add (`composables/useScopedTokens.ts:65`) | adapt: `TransactionCard` gains a `tokens` prop |
| One amount helper for the card and the detail page | none: `transferAmount` and `mintAmount` are written twice, near byte-identical (`TransactionCard.vue:39-59`, `tx/[id].vue:81-98`) | build new: `utils/tx-amount.ts`, one pure function, removes the second copy |
| A display-safe symbol | `sanitizeWireString` (`wallet/services/dapp-session/capability-meta.ts:161`, pure), used by the trust popup (`IncomingTrustPopup.vue:56`) and the dApp-facing surfaces; the token add stores the fetched symbol verbatim (`wallet/services/token/service.ts:381`, `:553-561`) | reuse at every new symbol boundary |
| A receipt's token | `tokenForReceipt` (`utils/received-display.ts:58-65`); `received/[id].vue:96-100` has its own copy | reuse: the page calls `tokenForReceipt` |
| Who reaches the first-receive prompt | `onTokenAdded` trusts every added contract (`wallet/services/incoming-transfer/service.ts:1133-1174`), the seeds included (`token/service.ts:503-523`, `:433`); `TokenService.restore` writes rows without that emit (`token/service.ts:853-896`); `BACKUP_SLICE_REGISTRY` has no trust slice (`wallet/services/backup/backup-migration-registry.ts:195-216`) | reuse as evidence: the prompt drops its figure (O4 (b)); trusting restored tokens is FU-4 |
| Read a text as exactly one amount | `parseAmountToBaseUnits` (`utils/amount.ts:149`) refuses anything but digits and one "."; `GROUPED` (`popup/pages/send-amount.ts:31-32`) reads a whole part grouped in threes, "0,001" and "1,234" included; `restingAmount` (`components/composite/send/amount-field.ts:6-12`, pinned by `amount-field.test.ts:4-25`) writes that grouping and drops a trailing "." | adapt: `readAmountText` in `utils/amount.ts`, used by the validator, the field and its USD twin; `GROUPED` moves into it, and the field's own resting text reads through `rested` |
| The field's next text for an edit | `handleAmountInput` inline (`AmountCard.vue:58-78`); `normalizeAmount`'s second-point rule and cap (`utils/amount.ts:16-30`) | build new: `nextAmountText` in `amount-field.ts`, pure, so the handler stays under the complexity budget and the paths are unit-tested; it keeps `normalizeAmount` for the second point and the cap |
| Tell a paste from a keystroke | `InputEvent.inputType`; read only in a test today (`AmountCard.test.ts:171`) | build new: `insertFrom*` and `insertReplacementText` are paste-like; a lone `data` "," is the comma key |
| A hint line under the field | the clamp hint (`AmountCard.vue:379-381`; `data-testid="send-amount-clamp-hint"`, class `clamp_hint`) | reuse its style and slot for the two new hints |
| Pin which amount calls read compact | `utils/amount.callers.test.ts:15-29` | adapt: the card's, the transaction page's and the received page's rows move to compact; the prompt's row goes |
| `comma` | deleted with its declarations by #725 (its F-3) | nothing to build |

Search trail: `git grep -nE "decimals \|\| 0|decimals \?\? 0" -- apps/extension/src` returns this
plan's sites (`TransactionCard.vue:41`, `:147`, `tx/[id].vue:83`, `received/[id].vue:105`; the mint
guess at `TransactionCard.vue:50` and `tx/[id].vue:91` and the prompt's `tokenDecimals ?? 0` at
`IncomingTrustPopup.vue:62` spell it differently) **and** `RecentActivityView.vue:188`, `:373`,
`popup/pages/journal/[id].vue:79`, `utils/journal-state.ts:381`, `composables/usePrices.ts:83` and
`utils/token-fold.ts:21`, which name a known token and are the plan's FU-1. `git grep -n
"type: OriginType.UI"` finds only the transfer executor and the auth registry's two calls. The
reader and the edit path were prototyped under Bun, the edit path importing the repo's own
`normalizeAmount`, `clampDecimals`, `formatBaseUnits` and `parseAmountToBaseUnits`: the P2 table's
42 reader forms and 48 edit sequences (the typed re-read and its guards, the second typed comma,
rest-then-edit, Max, the decimals watcher, pastes, and the harness's whole-text `setValue`) all came
out as the plan expects.

## Conventions to match

- Pure helpers colocated or in `src/utils/`, with a colocated `*.test.ts` (`utils/received-display.ts`
  and its test are the pattern for a card-props builder). `utils/token-amount.test.ts`,
  `utils/amount.test.ts` and `components/composite/send/amount-field.test.ts` already exist: extend
  them, never overwrite.
- `balanceFormatted`'s option is written exactly `{ compact: true }`: `amount.callers.test.ts:68-79`
  refuses any other form.
- Wire-shaped fixtures for dApp data: `0x` + 64 hex fields below the BN254 modulus
  (`implementations-plan/lessons.md` § Extension runtime). `TransactionCard.test.ts:113` (`0xtoken`)
  and `IncomingTrustPopup.test.ts:27` (`"ab"` × 32, above the modulus) do not meet it and are
  replaced where this plan touches them.
- New testids only for new elements: `send-amount-unreadable-hint`, `send-amount-ambiguous-hint`.
- Exports of `src/utils/` feed the tracked auto-import declarations
  (`src/types/auto-imports.d.ts`, `src/types/.eslintrc-auto-import.json`), which regenerate only
  on a build (`implementations-plan/lessons.md` § CI & gates): build before committing an export
  change.
- SFC ordering and comment style per CLAUDE.md; no plan or review references in code comments.

## Collision and dedup risks

- **#725 owns the field** and lands inside stack #729. Its F-1 reading of "1.234,5678901"
  ("1.234567", the owner's answer then) is pinned in `AmountCard.test.ts:167-176` and
  `send-amount.test.ts:181`, `:183`, and flips by the owner's 2026-09-30 O3 answer; its Max writes
  the grouped resting form with no blur (`AmountCard.vue:288-298`), which is why Max sets `rested`.
  P0 re-reads the landed handler, validator, resting form and their tests before any edit.
- **#728 (`send-states`)** moved Send's fee card and strip, not `AmountCard.vue`, `send-amount.ts`,
  `amount-field.ts` or `send.vue`'s amount wiring. `copy-polish` edits `send.vue` strings, not the
  lines this plan changes.
- **`amount.callers.test.ts`** was written by #718 to hold these sites plain; this plan changes its
  rows and its header sentence in the same commit as the sites.
- **`received/[id].vue` duplicates `tokenForReceipt`** (`:96-100`); calling the shared one removes
  the copy.
- **`TransactionCard.vue` and `tx/[id].vue` duplicate the amount logic**; the helper removes it.
  Leaving one copy behind would let them drift again.
- **The e2e helper that waits for a confirmed card** matches `data-tx-amount-display`
  (`tests/e2e/fixtures/helpers.ts:1274`); every caller passes an amount under 8 characters
  ("1" to "100"), which the compact form leaves unchanged.
- **No test reads the first-receive prompt's sentence** (`git grep` for "You received" under
  `apps/extension/src` and `apps/extension/tests` finds only the popup), so dropping its figure moves
  no e2e.
