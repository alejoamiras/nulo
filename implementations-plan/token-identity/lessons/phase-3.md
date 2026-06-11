# P3 - frontends + footer (lessons)

## 2026-06-11 - P3a: the deploy-independent slice (`pushed`)
- `parseAmount(text, decimals)` joins `lib/format.ts` beside `formatBigInt` (BigInt end-to-end; truncates excess places - never rounds up a spend; junk ⇒ 0n). Pins include the >2^53 case where `Number()` silently loses integer precision.
- Add-token hiding via the gated probe: `useFaucetAddToken.isRegistered` (FAIL-OPEN on older wallets/scope refusals/transport - the button shows), consumed by `BridgeAddToken.vue` (connect-time check + hides after a successful add) and `TokenCard.vue` (same).
- DEFERRED to the atomic flip (needs the new deployment addresses): constants, NULO/OLUN/AZLO names + decimals math sweep (parse + 7 display sites + MINT_AMOUNT), footer content, sandbox/deposit harness scripts. Flipping copy/decimals NOW against the live 6-dec USDC deployment would parse wrong magnitudes.
- Suites: faucet 274 ✓ smoke 9 ✓ typecheck ✓.

LESSONS_FILE=implementations-plan/token-identity/lessons/phase-3.md
