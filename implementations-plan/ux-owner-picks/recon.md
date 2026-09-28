# Recon · ux-owner-picks

Read on `dev` at `624117cd`. Every path is repo-relative; `ext/` below abbreviates
`apps/extension/src/`.

## Reuse map

| # | Capability needed | Existing code | Verdict |
|---|---|---|---|
| 1 | Format base units with a length cap and the small-value hint | `balanceFormatted` (`ext/utils/amount.ts:79-116`): hint at `:100-109`, the whole-digit-dropping slice at `:111-113` | adapt: one new branch where the slice would cut the whole part |
| 2 | Truncating integer formatting, locale separators | `formatBaseUnits` (`ext/utils/amount.ts:238-278`), `getDecimalSeparator` / `getThousandSeparator` (`:1-9`) | reuse-as-is (it carries an accepted complexity directive at `:237`; do not touch it) |
| 3 | Compact "123.45M" form | none: `grep -rn "notation:\|compactDisplay\|\"compact\"" apps packages` finds only a layout prop (`PrestoStatusCard`), no number formatter, in `apps/extension/src` or any `packages/*/src`; `formatSnackAmount` (`ext/utils/snack-amount.ts:9-14`) falls back to the full amount instead | build new: a small pure helper beside `balanceFormatted`, behind a `compact` option |
| 4 | Incoming row props, shared by Home and History | `buildIncomingCardProps` (`ext/utils/received-display.ts:58-70`), called by `TransactionsList.vue:45-48` (History) and `RecentActivityView.vue:270-273` (Home); each caller does its own token lookup (by `tokenId` only) and fiat label | adapt: the builder takes the token list and the fiat function, looks up via `tokenForReceipt`, and passes no decimals without a token |
| 4b | Receipt → token match with a stale `tokenId` | `received/[id].vue:95-99` (`tokenId`, or `contract`); `tokenId` is optional and can go stale (`incoming-transfer/spec.ts:59-60`) | reuse the rule as `tokenForReceipt` (tokenId first, then contract); the detail page keeps its own copy |
| 5 | Incoming row rendering | `TransactionIncomingCard.vue:38-41` (amount null on invalid decimals), `:54-56` | reuse-as-is |
| 6 | Token lookup with scope reload, run fence, error guard | Home's private copy: `RecentActivityView.vue:146-181` (fenced load, `console.debug` on failure, `onTokenAdded`), `:727-751` (sync scope-triple watch resets and reloads); `createRunFence` (`ext/composables/runFence.ts`) | adapt: lift Home's copy into a C1 composable both pages use |
| 7 | History's token lookup | `pages/activity.vue:43-49`, `:129-138`, `:153-154`: loads once, no scope watch, no catch | replace with #6 |
| 8 | "Only an amount when the token is known" rule | `transferCardFields` (`ext/utils/journal-state.ts:312-323`) | reuse the rule for incoming rows (#4) |
| 9 | Placeholder block | `Skeleton` (`packages/design/src/ui/Skeleton.vue`), resolver-registered | reuse-as-is |
| 10 | Delay before a loading placeholder shows | `GHOST_DELAY_MS = 300` pattern (`ext/popup/components/modules/general/TokensView.vue:109-116`) | reuse the value and the pattern; not extracted (two sites) |
| 11 | Send page token state | `send.vue:112-113` (`tokens` starts `[]`), `refetchIdentityScopedState` (`:514-544`), mount (`:555-577`), `<SelectTokenCard :token>` (`:641`); `onTokenAdded` appends the event's token unfenced (`:91-93`; the payload has no profile, `token/utils.ts:4-17`); `tokenBalanceByType` reads `activeToken.value.decimals` behind a balance check only (`:130-135`), bound unconditionally (`:653`); the `tokens` watch adopts a token imported into an empty page (`:448-457`); `initSendType` resets the send type to `preselectedBalanceType` (`:139-143`, default `"private"`, `stores/cache.store.ts:20`) | adapt: a loading ref settled in the refetch, balances cleared with the tokens, the missing token guarded, the event turned into a fenced tokens-only reload |
| 12 | Token card | `SelectTokenCard.vue` (L4): empty branch `:47-50`, click `:20-26`, `<Flex @click>` with no role, tabindex or key handler `:30` | adapt: `loading` prop, `role="button"`, `tabindex` 0 / -1, Enter and Space (CLAUDE.md § Keyboard & focus order) |
| 13 | e2e wait for the Send page's token | `openSend` (`tests/e2e/fixtures/send-page.ts:43-46`) waits for `send-from-type`, drawn only once a token loaded (`send.vue:621-622`, `isBlockedTransfer` `:114`) | reuse-as-is |
| 14 | Protocol ("Nulo's") sponsor identity | `isProtocol` from `FpcService.decorate` (`ext/wallet/services/fpc/service.ts:108-114`); undeletable (`:384-397`); auto-discovered (`:138-141`) by PXE registration and a stored row, with no deployment or funding check (`:163-173`, `:210-230`) | reuse-as-is: identity, not usability |
| 15 | Menu order with Nulo's sponsor first | `menuOrder` (`ext/popup/components/modules/send/fee-helpers.ts:209-216`), used by `FeeMethodSelector.vue:5`, `:20` | untouched; the default is the protocol sponsor alone (`defaultSponsor`), and would read `menuOrder` only under O4 (b) |
| 16 | Send's default payer | `payersOf` (`fee-privacy.ts:46-52`), `sponsor: methods.find((m) => m.type === "fpc")` | adapt: one call to the shared default |
| 17 | Non-Send cards' default payer (execute window, Revoke authorizations, authwit registry) | `settledSelection` (`FeeSettingsCard.vue:442-451`) | adapt: the same call |
| 18 | Wire-shaped execute fixture with both sponsors | `OperationCard.fee.test.ts`: `field()` `:70`, `NULO_SPONSOR` / `HAND_ADDED` `:74-75`, `sendTx()` `:84-104`; the dApp's self-payment lock `OperationCard.vue:97-100`, `:304`, pinned `:166-174` | reuse-as-is |
| 18b | An unusable protocol sponsor | the protocol sponsor's single-pass path simulates once with `skipFeeEnforcement: true` (`execution/fee/fpc-strategy.ts:103-104`, `:142`; `fee-strategy.ts:167`), so an unfunded one passes the estimate; the node refuses it at `sendTx` (`execution-coordinator.ts:301`), which journals `failed` with kind `transfer` (`transfer-executor.ts:209-218`); `transfer-executor.test.ts:207-219` covers only an estimate failure | reuse the harness: pin the refusal's mapping; `:207-219` gains `proveAndSend` not called |
| 18c | Post-send failure kind | `execution-coordinator.ts:344-346` (send, then record, then the success mark); a failed success mark is swallowed by `markJournal` (`transfer-executor.ts:113-121`), a `recordTransaction` throw is not; `transfer-executor.test.ts:65-68` harness calls `recordTransaction` inside `proveAndSend` | reuse the harness for a record-failure case |
| 19 | Failure category copy | `categoricalLabel` (`ext/utils/journal-state.ts:184-222`), rendered by `pages/journal/[id].vue:279-282`, `:299-302` | adapt: `transfer` gets its own arm |
| 20 | Source-scan pin style | `ext/wallet/services/legal/call-sites.test.ts`, `ext/components/composite/DottedTerm.scan.test.ts` | reuse the style for the Home/History parity pin |

## Every capped caller (18 calls in 11 files)

"Known" = the token's own decimals; "guessed" = decimals 0 (or 8 for a UI mint) when the token is
unknown or the call is a mint. `grep -rn "balanceFormatted(" apps/extension/src` minus tests and
the two doc mentions (`transfer-executor.ts:259`, `operation-journal/spec.ts:98`).

| Length | Caller | Decimals | Surface |
|---|---|---|---|
| 8 | `components/composite/activity/TransactionIncomingCard.vue:40` | known (after D2) | the incoming row (Home and History), **picked** |
| 8 | `utils/journal-state.ts:321` | known | terminal journal rows (Home and History) |
| 8 | `popup/components/modules/general/RecentActivityView.vue:218`, `:404` | known | Home's in-flight row, awaiting journal rows |
| 8 | `popup/pages/journal/[id].vue:98` | known | journal detail |
| 8 | `utils/snack-amount.ts:11` | known | the snack: the capped form while every whole digit survives, else the full amount (`:13`); `formatSnackAmount(123456700000n, 6)` is `"123,456."` today, so the trim would change it |
| 10 | `general/BalanceView.vue:78`, `:82`; `general/TokenCard.vue:38` | known | token page split, Home token row total |
| 6 | `general/TokenCard.vue:51`, `:52` | known | Home token row private/public ("1,234." today for a 4-digit balance with a fraction) |
| 20 (or none) | `general/BalanceView.vue:73` | known | token page hero; `slashed` drives "Show full" |
| 8 | `popup/components/modules/activity/TransactionCard.vue:41` | guessed (`token?.decimals \|\| 0`) | outgoing chain-tx rows |
| 8 | `popup/components/modules/activity/TransactionCard.vue:58` | guessed (8 for a UI mint, else 0; the amount is the call's last argument, `:48-57`) | mint rows |
| 8 | `popup/pages/tx/[id].vue:83`, `:97` | guessed (same two rules, `:89-96`) | tx detail |
| 8 | `popup/pages/received/[id].vue:105` | guessed (`token.value?.decimals \|\| 0`) | received detail |
| 8 | `popup/components/popups/IncomingTrustPopup.vue:63` | guessed (`tokenDecimals ?? 0`, `:62`) | trust popup for a receipt |

## Conventions to match

- Amount display truncates, never rounds up (`amount.ts:219-227`, `FormatBaseUnitsOpts.maxDecimals` `:199-204`).
- C1 composables take a connected client, never connect or disconnect, and expose `dispose()`
  (CLAUDE.md § Composables); ≥ 10 test cases.
- Token lookups swallow a failed read at `debug` with the error as a named property
  (`RecentActivityView.vue:158-161`), which the log-payload guard accepts.
- Fee rows: a saved pick wins when it still resolves (`fee-privacy.ts:111-112`,
  `FeeSettingsCard.vue:443-444`); mainnet hides sponsors (`FeeSettingsCard.vue:112`).
- Journal copy: short label, one factual sentence (`journal-state.ts:192-221`).
- e2e selects by `data-testid` only; `send-token-trigger`, `send-token-symbol`,
  `send-fee-method-*`, `tx-incoming-card` stay verbatim.

## Collision and dedup risks

- **e2e-reliability-fixes** edits `FeeMethodSelector.vue`'s row testids (the `DropdownItem` at
  `:52-58`) and `network/send-picker.test.ts`'s retries. This plan does not touch
  `FeeMethodSelector.vue`, and in `send-picker.test.ts` changes only the comment on line 31, which
  the fix makes false.
- **wallet-safety-fixes** edits `RevokeAuthwitsPopup.vue` and `ChangeAuthwitsRegistryPopup.vue`
  (Enter handling) and the journal service. This plan changes neither file; their fee cards change
  default through `FeeSettingsCard.vue`, which only this plan edits.
- **Sibling-plan lines** below are taken from the brief's overlap notes, not re-read in the
  sibling plans; the shared-file promise is about this plan's own edits.
- `TransactionsList.vue`: its `tokensById` prop becomes `tokens`; `TransactionsList.test.ts` and
  `activity.vue:199` change with it. No sibling package touches it.
- `RecentActivityView.vue` exposes `tokens` to its tests (`:774`, used at
  `RecentActivityView.test.ts:421`, `:480`); the composable's ref keeps that exposure.
- `fee-helpers.test.ts:270-282` pins "the payer list keeps storage order": it stays true
  (`buildFeeMethods` is untouched), but its title and the `menuOrder` doc comment (`fee-helpers.ts:209-210`)
  state the old default rule and must change.
- `journal-state.test.ts:485-488` pins `transfer` → "Reported by app" and changes with D5.
- Fee fixtures: `fee-privacy.test.ts:17` (`SPONSOR_2`) and several `FeeSettingsCard.test.ts`
  rows carry sponsors without `isProtocol: true`; any that expect such a row as the default go red
  under `defaultSponsor` and are fixed only where the case is about Nulo's sponsor.
- `send.test.ts:139` and `send.integration.test.ts:155` stub `SelectTokenCard` with `props: ["token"]`;
  the new prop joins the stub.
