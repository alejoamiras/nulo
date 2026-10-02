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

## Gas-cap parity ✓ (already covered, minimally extended)
`applyEmbeddedFpcGasCap` is mode-driven (fpc/fjwc/default), not payload-shape-driven. The private claim is
an `embedded="fpc"` payment (feePayer=FPC≠from), so the EXISTING test 3 ("fpc + dApp explicit maxFeesPerGas
→ pass through, node not consulted") already proves the private-fuel gas behavior — a duplicate test would
be bloat. Extended test 3 with a `teardownGasLimits` pass-through assertion (L14: explicit teardownGas=0
survives) + labelled it the private-fuel path. extension `embedded-fpc-cap` 3/3.

## Playground extension + network-e2e — DEFERRED to the sandbox session (coupled, unrunnable solo)
On reading `packages/playground/sections/transactions.ts`, the private-fuel hook's shape is coupled to the
e2e's setup (bridge FJ to the FPC → derive secret/leafIndex/amount → drive the claim → assert the result),
and neither the hook nor the e2e can be validated without the `e2e:agent` sandbox. Building the hook blind
risks rework once the real integration is exercised. So the playground hook + the network-e2e (L12/L13/L16)
are built TOGETHER as the sandbox-gated tail of P2 — not speculatively now. The manifest scope + gas-cap
(the code the e2e will exercise) are in place. **Remaining (sandbox): the playground private-fuel hook + the
cold-start private network-e2e + the FUNDED-account no-fuel e2e.**

## Gate (partial)
- `bun run --cwd packages/faucet test capabilities` → 21/21.
- `bun run --cwd packages/bridge-core test` → 107/107 (DOM_SEP literal, no regression).
- `audit:vue` (full faucet/extension build) + the network-e2e are the remaining P2 gates.
