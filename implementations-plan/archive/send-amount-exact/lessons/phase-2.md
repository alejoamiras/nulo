# Phase 2 · A typed amount keeps its value

- **Tests first**, run on the unfixed code with the phase's command
  (`bun --bun vitest run src/popup/pages/send-amount.test.ts src/popup/pages/send.test.ts src/components/composite/send/`):
  exit 1, 9 failed and 156 passed, plus `amount-field.test.ts` failing to resolve `./amount-field`
  (the module did not exist yet). The failures, each as the plan predicted:
  - validator: "1,000,000" and "123,456,789.5" read `invalid`. The pins "1,000", "1.234,5," and
    "12,34.5" passed.
  - the field's path, through AmountCard's real handler and blur: "1234567.123456789012345678"
    (18) rested as "1,234,567.12345679"; "12345678901.123456" (6) as "12,345,678,901.123455";
    "1234567890123.12345678" (8) as "1,234,567,890,123.12353516"; "1234567" (0) and
    "1,234,567.55" (18) rested grouped and were refused; "12ab.1234567" (6) rested as "12", which
    dev sends as 12. The pin "1.234,5,678901" (6 decimals, refused either way) passed.
  - the page: the review showed "1,234,567.123456TST", but the sheet's send did not reach
    `executeTransfer`, because dev refuses the grouped amount. The token-switch pin passed.
- **The fix**: `send-amount.ts` strips every comma only from a whole part grouped in threes and
  keeps dropping just the first comma elsewhere; `restingAmount` in
  `components/composite/send/amount-field.ts`; the blur calls it and returns early without
  decimals.
- **Gate.** The same command: exit 0, 8 files, 179 tests passed. `bun run lint` exit 0.
- The balance in the page test is 2,000,000 TST, a holding a person can have; the plan's step
  named 9,999,999,999,999 and now names 2,000,000.
