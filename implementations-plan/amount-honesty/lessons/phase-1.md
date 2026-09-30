# Phase 1 · Activity amounts from known decimals

## Red run on the unfixed code (`0f37ab78`)

`bun --bun vitest run src/popup/components/modules/activity/TransactionCard.test.ts
"src/popup/pages/tx/[id].test.ts" "src/popup/pages/received/[id].test.ts"
src/popup/components/popups/IncomingTrustPopup.test.ts`: exit 1, 12 failed, 23 passed.

| Case | Base shows |
|---|---|
| Card, a listed 18-decimal token's mint reads "1" and "TST" | "1,000,00", no symbol |
| Card, an unlisted token's mint shows no amount | "1,000,00" |
| Card, 1,234,567 tokens read "1.23M" | "1,234,56" |
| Card, two mint calls show no amount | "2,000,00" (the sum) |
| Transaction page, a sent transfer while the list loads reads "1 TST" | "1,000,00 TST" |
| Transaction page, a listed mint reads "1 TST" / "Mint amount" | "1,000,00 TST" |
| Transaction page, an unlisted mint has no amount block | the block, "1,000,00" |
| Received page, no amount while the list is pending | "+1,000,00 Token" |
| Received page, no amount without a decimals getter | "+1,000,00 TST" |
| Prompt at 18 decimals reads "You received TST from…" | "You received 1 TST from…" |
| Prompt at decimals 255 | "You received <0.000001 TST from…" |
| Prompt without decimals | "You received 1,000,00 TST from…" |

The received page's "+1 TST once an 18-decimal token resolves" passes on the base, as labelled
(pin). `knownDecimals` and `txAmount` are new helpers with no base behaviour: their cases are
marked new, and the surface tests above are their red proof.

## Build notes

- `TokenInfo.hasDecimals` is required, so two typed test literals needed it
  (`composables/useScopedTokens.test.ts`, `utils/received-display.test.ts`); `vue-tsc` named
  exactly those two.
- Biome's formatter rewrote the `‮` / `​` escapes of the hostile-symbol fixture into the
  literal invisible characters. The fixture builds them with `String.fromCodePoint` instead, so the
  source shows what the test feeds.
- Beyond the plan's cases, `TransactionsList.test.ts` and `RecentActivityView.test.ts` each assert
  that the settled card receives the parent's `tokens`: a dropped binding would silently leave every
  mint row without its figure.
- `bun run build` regenerated `src/types/auto-imports.d.ts` and `.eslintrc-auto-import.json` for
  `knownDecimals`, `txAmount` and `TxAmount`; they are committed with the phase.

## Gate

- `bun --bun vitest run <the nine files of the plan's P1 gate>`: exit 0, 9 files, 102 passed.
- `bun run lint`: exit 0, 28 warnings and 3 infos (the base's own), complexity-baseline check OK.
- `bun run typecheck:all`: exit 0, every workspace.
