# P3 - frontends + footer (lessons)

## 2026-06-11 - P3a: the deploy-independent slice (`pushed`)
- `parseAmount(text, decimals)` joins `lib/format.ts` beside `formatBigInt` (BigInt end-to-end; truncates excess places - never rounds up a spend; junk ⇒ 0n). Pins include the >2^53 case where `Number()` silently loses integer precision.
- Add-token hiding via the gated probe: `useFaucetAddToken.isRegistered` (FAIL-OPEN on older wallets/scope refusals/transport - the button shows), consumed by `BridgeAddToken.vue` (connect-time check + hides after a successful add) and `TokenCard.vue` (same).
- DEFERRED to the atomic flip (needs the new deployment addresses): constants, NULO/OLUN/AZLO names + decimals math sweep (parse + 7 display sites + MINT_AMOUNT), footer content, sandbox/deposit harness scripts. Flipping copy/decimals NOW against the live 6-dec USDC deployment would parse wrong magnitudes.
- Suites: faucet 274 ✓ smoke 9 ✓ typecheck ✓.

LESSONS_FILE=implementations-plan/token-identity/lessons/phase-3.md

## 2026-06-11 - P3b: decimals/symbol parameterization at CURRENT values (behavior-identical)
- `BRIDGE_TOKEN_SYMBOL`/`BRIDGE_TOKEN_DECIMALS` constants added beside the deployment config (USDC/6 today - the flip changes the two lines + deployment json). Every bridge surface swept onto them: form parse (`parseAmount`) + balances + unit + headline + validation copy, receipt, stepper headline, journal toasts (completion + restore), card amount, MINT_AMOUNT (decimals-derived: `100n * 10n ** BigInt(...)` - the dust bug class is structurally gone), mint-card copy. Zero `1e6` remains in src.
- Display normalization rode along: amounts render via `formatBigInt` everywhere ("100.00" not "100") - consistent with the faucet tab's columns; pins updated.
- Gotchas: v-model on a `type="number"` input can hand a NUMBER to parseAmount (defensive `String(text ?? "")`); five test files mock `@/contracts/bridge-deployments` and each needed the two new exports (a mocked module is a CLOSED set - new real exports are undefined in every existing mock).
- Remaining for the flip (deploy-gated): deployment jsons/addresses, the two constants → AZLO/18, tokens.ts NULO/OLUN + FaucetView copy, footer symbols, faucet manifest addresses, sandbox/deposit harness scripts.

LESSONS_FILE=implementations-plan/token-identity/lessons/phase-3.md

## 2026-06-11 - P3 COMPLETE (the atomic flip, in two coherent halves)
- Faucet half (forced the moment the deploy rewrote deployments.json - the module-load lookups went red exactly as the final pass predicted): deployments.ts (NULO/OLUN lookups + renamed exports/rebuilds), tokens.ts catalog, FaucetView, Footer, manifest copy, verify script, test fixtures + smoke. On-chain verify green.
- Bridge half (after the AZLO deploy): the TWO-LINE flip (BRIDGE_TOKEN_SYMBOL/DECIMALS → AZLO/18 - the parameterization made it exactly that) + BridgeAddToken copy + 18-dec test fixtures (amounts gained 12 zeros; pins exercising REAL constants needed AZLO strings; mock-based pins stayed at their mocked USDC/6 intentionally - they test parameterized logic).
- Gotchas: blanket `" ETH"→" OLUN"` replace nearly ate ETHEREUM (word-boundary regexes after the first bite); biome's earlier reformat broke a multi-line replace anchor silently (the receipt headline kept "USDC" with the import sitting unused - caught by pins).

LESSONS_FILE=implementations-plan/token-identity/lessons/phase-3.md
