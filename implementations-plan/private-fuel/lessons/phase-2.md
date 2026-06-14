# Phase 2 — wallet scope + cold-start EXTERNAL payload

Status: **manifest ✓ (faucet code green); gas-cap test + playground + network-e2e REMAIN.** Moves no funds.

## Done
- `capabilities.ts` `buildCombinedManifest` (the LIVE manifest): scoped `FeeJuice.claim` +
  `PrivateFPC.mint_and_pay_fee` in BOTH `transaction.scope` and `simulation.transactions.scope`
  (so the private cold-start claim is simulate-gated like the public fjwc one). Function names verified
  against Wonderland `private.js`: `"claim((Field),u128,Field,Field)"` + `"mint_and_pay_fee(u128,Field,Field)"`.
- **Registration decision (refines plan part 2):** the PrivateFPC is NOT added to `contracts`, and the
  faucet does NOT `registerContract` it — mirroring the SponsoredFPC, which the wallet auto-registers
  (`fpc/service.ts` auto-discovers BOTH protocol FPCs). This avoids dragging the 2.2 MB artifact into the
  faucet bundle. The network-e2e (remaining) is the arbiter of whether auto-registration suffices for the
  EXTERNAL cold-start sim; if it throws "Function artifact not found", escalate to explicit registration.
- Pins: combined manifest scopes private fuel for send AND simulate; PrivateFPC absent from `contracts`.
  Faucet capabilities suite 21/21.

## ⚠ Lesson: Aztec poseidon at MODULE-LOAD crashes non-node bundles
P0 computed `DOM_SEP = poseidon2HashBytes(...)` at module top-level. Merely IMPORTING `@nulo/bridge-core`
(for `feeJuiceAddress`) then ran that poseidon at load — which threw `BBApiException: std::bad_cast` in the
faucet's jsdom vitest env (`BarretenbergSync` not yet initialized). `computeSecretHash` (same sync-poseidon
family) works in the faucet because it's CALLED at runtime (post-init), not at import. Fix: pin hash-derived
constants as LITERALS, verify them in a node test (the drift tripwire). Never compute an `@aztec` hash at
TS module-load time in code that a browser/jsdom bundle imports. Fixed in `fix(bridge-core)` edaa345.

## Remaining P2
1. Gas-cap parity test (extension `embedded-fpc-cap.test.ts`): dApp-supplied explicit `maxFeesPerGas` +
   `teardownGas=0` survives `applyEmbeddedFpcGasCap` for the 2-call payload (L9/L14).
2. Playground extension (L16): teach `packages/playground` to construct the
   `PrivateMintAndPayFeePaymentMethod` payload so the network-e2e can drive it through the real extension.
3. Network-e2e (L12/L13): a `tests/e2e/network` cold-start private-fuel claim through the REAL extension
   (EXTERNAL transport carries both setup calls, feePayer=FPC, no scope violation) + a FUNDED-account no-fuel
   claim (wallet self-pays). **Needs the sandbox harness (`e2e:agent`).**

## Gate (partial)
- `bun run --cwd packages/faucet test capabilities` → 21/21.
- `bun run --cwd packages/bridge-core test` → 107/107 (DOM_SEP literal, no regression).
- `audit:vue` (full faucet/extension build) + the network-e2e are the remaining P2 gates.
