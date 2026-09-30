# Recon · send-amount-exact

Read at `f51ec001` (dev) and re-checked at `a7b1ff62`, which edits none of the files this plan
edits (it does edit `wallet/services/token/service.ts`, which the threat model cites; those lines
were read at `a7b1ff62`). Every line reference below was opened and read. Each "measured" value
came from running dev's own `utils/amount.ts` and `popup/pages/send-amount.ts` under `bun`, not
from reading them.

## How an amount travels on the Send page

| Step | Code | What it does to the value |
|---|---|---|
| A keystroke or a paste | `handleAmountInput`, `apps/extension/src/components/composite/send/AmountCard.vue:53-74` | `purgeNumber` (`apps/extension/src/utils/amount.ts:41-44`) keeps only digits and "."; `normalizeAmount` (`amount.ts:46-60`) drops the last character of a value with two "." and caps at 9,999,999,999,999 through `Number.parseFloat` (`:59`); then `clampDecimals(typed, …)` (`AmountCard.vue:66`) runs on the **raw typed string**, and when it clamps, the raw string replaces the purged one (`:68`) |
| Leaving the field | `handleAmountBlur`, `AmountCard.vue:96-107` | returns early if the model holds a comma (`:100`), else `comma(model, ",", Math.min(tokenDecimals, 8))` (`:105-106`): `Number.parseFloat` then `toFixed` (`amount.ts:11-39`) |
| Max, token mode | `handleMax`, `AmountCard.vue:272-279` | `model.value = props.tokenBalanceByType`, a Number |
| Max, fiat mode | `handleFiatBalanceAction`, `AmountCard.vue:283-291` | `writeModelFromRaw(BigInt(props.balanceRawByType) / divisor)`: exact, plain (`:164-168`), and it returns when the raw balance is missing (`:285`) |
| Fiat typing | `scheduleConvert`, `AmountCard.vue:170-185` | `writeModelFromRaw(raw)`: exact, plain |
| A decimals change | watcher, `AmountCard.vue:79-90` | `clampDecimals` on the model string; commas in the whole part are untouched |
| A token switch, unmount | `send.vue:437-446`, `:595` | `amountTerm.value = null` |
| Validation | `validateSendAmount`, `apps/extension/src/popup/pages/send-amount.ts:45-82` | `input.trim().replace(",", "")` (`:51`) removes the first comma only, then `parseAmountToBaseUnits` (`amount.ts:158-179`, exact BigInt) |
| Estimate and submit | `send.vue:207-213` (validation), `:459-489` (estimate watcher), `:405` (submit) | both use `amountValidation.integerized`; an invalid amount cancels the estimate (`:473-476`) |
| Confirm | `isAllowedToSend`, `send.vue:256-264` | needs `amountValidation.valid`; it does **not** wait for the estimate |
| Review sheet | `amountText`, `send.vue:287` | `String(amountTerm)`: the field's string, at `send-review-amount` (`SendReviewSheet.vue:91-93`) |
| Balance corner | `balanceSegment`, `AmountCard.vue:152-155` | `comma(props.tokenBalanceByType, ",", 8)`; hidden when `tokenBalanceByType` is falsy; the same element in both modes |
| The props | `send.vue:127-135`, `:199-202`, `:653-654` | `tokenBalanceByType` = the raw balance string divided by `10 ** decimals` (a float, `0` without a row, `NaN` without decimals); `balanceRawByType` = the same row's raw string; both come from `tokenBalance`, so both go missing together |
| Where the balance and decimals come from | `wallet/services/token/service.ts:736-785` (`fetchTokenMetadata`: decimals from the token contract, `0` when it has no getter), `wallet/services/token-balance/balance-projector.ts:243-251` | the token contract's own answers, stored as strings |

## Measured on dev

- **Validator** (6 decimals): "1,000,000" and "123,456,789.5" → `invalid`; "1,234.5", "1,000",
  "12,34.5" and "123456789.5" → valid.
- **Blur** (`comma(v, ",", min(d, 8))`): "12345678901.123456" (6) → "12,345,678,901.123455";
  "1234567890123.12345678" (8) → "1,234,567,890,123.12353516"; "1.123456789" (18) → "1.12345679";
  "0.123456789012" (18) → "0.12345679"; "999.999999999" (18) → "1,000"; "1234567.5" (18) →
  "1,234,567.5" and "1234567" (0) → "1,234,567", both of which the validator then refuses. Rules
  that keep the value: "1.50" → "1.5", "1." → "1", "007" → "7", ".5" → "0.5", "0.00" → "0".
- **Max** (18 decimals, float `raw / 10 ** 18`): 1.123456789012345678 fills "1.1234567890123457",
  22 base units over the balance, refused with or without a blur; 99.876543210987654321 fills
  "99.87654321098765" (4,321 short), and after the blur "99.87654321" (987,654,321 short); dust of
  0.0000001 fills "1e-7", refused, which dev's float blur happens to turn back into "0.0000001";
  124,457,554.4 fills exactly, and after the blur becomes "124,457,554.40000001", refused. The
  float is not exact for every balance of 15 or fewer significant digits: 1.00000000000012 fills
  "1.0000000000001201".
- **Corner**: 124,457,554.4 reads "124,457,554.40000001"; 1.123456789012345678 reads
  "1.12345679" and 0.123456789 reads "0.12345679", both more than the balance; a balance below
  1e-8 reads "0".
- **The raw clamp** (a correction to the brief's fact 3): `clampDecimals("1,234,567.1234567", 6)`
  is "1,234,567.123456", `clampDecimals("ab12.1234567", 6)` is "ab12.123456" and
  `clampDecimals("1.234,5678901", 6)` is "1.234,56". So a paste with more decimals than the token
  reaches the model with its commas and any other characters. Removing every comma in the
  validator is therefore **not** safe: the paste "1.234,5,678901" (6) reaches the model as
  "1.234,5,", which dev refuses and every-comma removal reads as 1.2345. Removing the commas only
  when the whole part is grouped in threes (`/^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/`), and otherwise
  keeping dev's first-comma reading, accepts exactly the grouped strings dev refused and reads
  every other string as dev does ("1.234,56" as 1.23456, "12,34.5" as 1234.5).
- **dev's blur invents amounts from such a paste** (`comma` parses a prefix): the model
  "12ab.123456" (6 decimals) rests as "12" and sends 12; the paste "1.5.1234567" reaches the model
  as "1.5.1234", rests as "1.5" and sends 1.5; "ab12.123456" rests as "NaN"; " 1234567.123456"
  rests as "1,234,567.123456", which dev's validator then refuses.
- **The input cap rounds up.** "9999999999998.999999" (6) becomes "9999999999999" as it is typed
  (`Number.parseFloat` reads it as the cap); dev's blur then groups it and the validator refuses
  it, but with a grouping-aware validator it sends 9999999999999000000, one base unit more than
  typed. The band is the values within about 0.001 below the cap with no more decimals than the
  token; a longer fraction is clamped on the raw text and escapes the cap. The owner declined a
  fix as unrealistic (plan, A-2).
- **The planned resting form** (`formatBaseUnits(parseAmountToBaseUnits(v.trim(), d))` with ","
  and ".", else `v` unchanged), over 27 inputs and codex's 91-case matrix (decimals 0, 6, 8 and 18,
  near the cap, past 2^53): every output reads as the same amount as its input under the
  grouping-aware validator, and every output is a fixed point. It keeps every digit
  ("999.999999999" stays, "12345678901.123456" (6) → "12,345,678,901.123456"), keeps the
  value-preserving rules ("1.50" → "1.5", "1." → "1", "007" → "7", ".5" → "0.5", " 12.5 " →
  "12.5"), and leaves unchanged everything that does not parse: any comma ("1,234,567.5",
  "12,34.5", "1.234,56"), letters, "1.2.3", "-1", "1e-7", and "1.1234567" at 6 decimals.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Parse a typed decimal to base units, exactly, refusing garbage and extra decimals | `parseAmountToBaseUnits`, `amount.ts:158-179` | **reuse-as-is** |
| Read a grouped amount | `send-amount.ts:51` (first comma only) | **adapt**: remove every comma only from a whole part grouped in threes; otherwise the first comma, as today |
| Format base units with grouped whole part, every decimal, trailing zeros and "." dropped | `formatBaseUnits`, `amount.ts:238-278` (truncates on `maxDecimals`, trims by default; separators default to the locale, so pass `","` and `"."` as `derivedTokenLabel` does, `AmountCard.vue:161`) | **reuse-as-is** |
| The field's resting form | none. Search trail: `git grep -n "comma(\|\\\\B(?=(\\\\d{3})"` over `apps` and `packages` finds only `comma` and `formatBaseUnits`; `modelRaw` (`AmountCard.vue:119-128`) parses exactly but through `purgeNumber`, which drops any non-digit (so "ab12.5" reads 12.5) and slices a long fraction silently: display-grade, not validator-grade | **build new**: `restingAmount(value, decimals)` beside AmountCard, composing the two functions above. Nothing existing both refuses what the validator refuses and keeps every digit |
| Exact Max | `writeModelFromRaw`, `AmountCard.vue:164-168`, and the fiat path's guard, `:285` | **reuse-as-is** |
| Exact corner cut at 8 places | `formatBaseUnits(raw, d, { maxDecimals: 8, thousandsSep: ",", decimalSep: "." })` | **reuse-as-is**; no new helper. `balanceFormatted` (`amount.ts:79-116`) caps by string length, a different rule |
| A testid for a landed estimate | none: `FeeCostReadout.vue:25-50` carries only `fee-estimate-usd`, drawn only with a USD price; `fillSendForm` waits on `send-submit`'s pointer events (`tests/e2e/fixtures/helpers.ts:1192-1201`), which follow `isAllowedToSend`, not the estimate (`send.vue:256-264`; `derivedSettings` needs no estimate, `FeeSettingsCard.vue:226-232`) | **build new**: `data-testid="fee-estimate"` on the readout's estimate row (`:29`). Nothing drawn changes |
| E2E fixtures | `tokenReadyExtension` (1,000 TST public, 18 decimals; `tests/e2e/fixtures/extension.ts:731-790`, `fixtures/aztec.ts:148-167`), `mintPublicTokensForAccount` (`fixtures/aztec.ts:688-700`), `captureBalanceBaseline` + `waitForFreshBalanceRow` (`fixtures/helpers.ts:1676`, `:1757`), `openSend` + `readSendInputs` + `shotSend` (`fixtures/send-page.ts:43`, `:198`, `:211`), `setActiveSendType`, `replaceInputValue` (focuses each input, so filling the destination blurs the amount; `fixtures/extension.ts:1363-1391`), `clickByTestId` | **reuse-as-is** |
| Component harness | `mountCard`, `AmountCard.test.ts:12-16`; the page harness `mountSend` + `fillForm`, `send.test.ts:191-222`, which stubs AmountCard and renders the real review sheet | **reuse-as-is** |
| Validator tests | `send-amount.test.ts:115-122` | **adapt**: its comment cites the first-comma rule |

## Every `comma()` caller

`git grep -nw comma -- 'apps/*' 'packages/*'` (plus the auto-import declarations, which list it):

| Site | Feeds | Verdict |
|---|---|---|
| `AmountCard.vue:106`, the blur | the model, which is sent | **change** (the brief's scope) |
| `AmountCard.vue:154`, the balance corner | display only; it shows float digits and can round up past the balance | **change** (the owner's third answer) |

After both, `comma` has no caller; it stays in `utils/amount.ts`, which this plan does not edit.

## Traps

- `schedule` and `cancel` both clear the landed estimate (`src/composables/internal/fee-estimation-engine.ts:108`, `:120`), so a new estimate row after an amount change is a fresh estimate.
- The regroup on blur changes the model string but not its value, so the estimate watcher reschedules once, as dev's blur already does for amounts under a million.
- `AmountCard.test.ts:59-65` pins the float Max (`[250]`); it changes deliberately. The corner test at `:79-89` mounts no raw balance and no decimals; it gains both.
- `AmountCard.stories.ts:8-13` passes no raw balance or decimals, so its corner would disappear; its args gain both.
- The network specs share a file-scoped fixture, and nightly retries twice
  (`vitest.e2e.network.config.ts:46`); a spec that mints sets `retry: 0` and says why, as
  `network/account-switch-isolation.test.ts:26-29` does.
- The network pool is sharded by `vitest --shard`, so a new spec needs no registration; the
  README's "80 files today" (`tests/e2e/README.md:122`) is already stale (102 files). Locally,
  `NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent <file>` runs it as the pool does, and
  `e2e:agent` sets `E2E_REQUIRE_SETUP=1`, so a failed setup fails the run instead of skipping it
  (`apps/extension/scripts/e2e/agent.sh:195-204`).
- `network/fiat-send.test.ts:65-67` reads the corner loosely (`/\d/`) and asserts no page errors: a regression run for the corner.
- No e2e clicks Max today; `network/fee-methods.test.ts:403` reads the field back ("10", which the blur leaves as it is).
- A click on Max bubbles to the card's click handler, which focuses the input (`AmountCard.vue:268-270`, `:295`), so Max leaves the field focused and plain until focus moves on.
- Leaving the destination field with the account's own address selects that account, whose card
  then replaces the input (`popup/components/modules/send/RecipientField.vue:53-56`, `:99-108`;
  accounts are candidates, `send.vue:190`). After Max focuses the amount, there is no destination
  input left to focus, so the spec blurs the amount input itself.
- The review sheet prints the field's string in a 30 px line with no wrap rule (`SendReviewSheet.vue:91-93`, `:179-186`), inside a 360 px popup whose wrapper clips (`packages/design/src/base.css:75`, `popup/app.vue:502`). dev's typing path never rested at a sendable amount longer than about 16 characters (a paste the clamp kept verbatim could); this fix does.

## Overlap with `feat/ux-owner-picks`

At `33b19cb3`, `git diff --name-only origin/dev...origin/feat/ux-owner-picks` lists 55 files.
Shared with this plan: `send.test.ts` (its hunks at dev's lines 121-203 and past 732),
`implementations-plan/index.md` (it adds its line after `wallet-safety-fixes`) and
`follow-ups.md`. It also edits `utils/amount.ts` (from line 62 on), `send.vue`,
`send.integration.test.ts`, `FeeSettingsCard.vue` (which renders `FeeCostReadout`),
`SelectTokenCard.vue` and the auto-import declarations, none of which this plan edits. It touches none of `AmountCard.vue`, its test or stories, `send-amount.ts` or its
test, `FeeCostReadout.vue`, the new `amount-field.ts`, the new e2e spec or `lessons.md`. Expected
overlap: none in code; `git merge-tree` probes it before the first code commit and before the push.
