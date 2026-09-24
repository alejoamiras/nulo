# swap-fuel - bridge-and-fuel on the LIVE Sepolia <-> Aztec testnet bridge

Branch: `feat/swap-fuel` off `dev`. Aztec pinned 4.2.0. Testnet only. Production-quality bar as prior arcs. Playwright e2e is a separate future arc - this arc verifies via Foundry fork tests, unit/component tests, one headless live-testnet script, and a manual UI checklist.

Driving ask: during an L1->L2 deposit of AZLO, atomically swap a slice of the deposit into FeeJuice via Uniswap V4 on Sepolia (two-hop AZLO->WETH, unwrap, native-ETH->FJ), so the recipient lands on L2 with gas to claim. Fuel is a toggle inside the existing deposit form: one flow, one journal record, the stepper gains a fuel phase. Full privacy parity: `isPrivate` stays in the Permit2 witness; private deposits get fuel too (the FJ claim is public-to-user, the TOKEN stays private). Paying gas FROM private FJ notes is out of scope.

## What already exists (don't rebuild)

The contracts and most of the core plumbing shipped in the faucet-bridge arc and are fork-proven against Sepolia:

- `packages/bridge-evm/src/SwapBridgeRouter.sol` - Permit2 witness-bound `bridgeWithFuel` (pull -> swap -> FJ deposit -> token deposit public/private, atomic) + simple `bridge`, `setSwapTarget` (Ownable2Step), `sweep`.
- `packages/bridge-evm/src/UniswapFuelSwap.sol` - V4 unlock-callback swapper; settlement Case C (multi-hop, last pool native: settle input ERC-20, take intermediate WETH, unwrap, `settle{value}`) is exactly our route shape; `_validateRoute` enforces hookless pools, FJ-output last hop, and the WETH<->native unwrap only at the FINAL boundary (`UniswapFuelSwap.sol:258-273`, pinned by `RouteValidation.t.sol:85-109`).
- `packages/bridge-evm/script/DeployBridge.s.sol` - `PoolSetupHelper` (permissionless FeeAssetHandler FJ batch-mint, idempotent `initialize`, liquidity via unlock callback, sweep) + a deploy that seeds ETH/FJ and USDC/WETH. Fork tests: `DeployBridge.fork.t.sol`, `SwapBridgeRouterPermit2Fork.t.sol` (real Permit2 + real V4 two-hop incl. private variant, nonce replay, expiry, witness tamper).
- `packages/bridge-core/src/l1.ts` - witness typed-data + `hashRoute`/`hashBridgeWitness`, byte-pinned to the router by `l1.test.ts` against `WitnessHash.t.sol` fixtures. `flows.ts` `runSwapBridge` (sign witness -> `bridgeWithFuel` -> parse `BridgeWithFuel` event -> secrets + leaf indices), pinned by `swap.test.ts`. `fee-juice.ts` `publicFeeJuicePayment` (= `FeeJuicePaymentMethodWithClaim`, claim-and-pay-in-one-tx) + `feeJuiceClaimArgs`.
- The wallet already supports dApp-embedded FJ-with-claim fee payment: `extension/src/wallet/services/execution/utils/fee-detection.ts:8-13` classifies `feePayer === from` as `"fjwc"`, `embedded-fpc-cap.ts:25` names `FeeJuicePaymentMethodWithClaim` as a supported dApp pattern, `operation-planner.ts:227-231` maps it to `FEE_JUICE_WITH_CLAIM`. No wallet execution-layer work needed - only manifest scope.
- `MintableERC20` (the live AZLO) pre-approves canonical Permit2 for every holder via an `allowance()` override (`MintableERC20.sol:46-50`) - the fuel path needs NO approve transaction, and its `mint` is permissionless capped at 1000 whole tokens/tx (`MintableERC20.sol:40-44`).

What does NOT exist yet: a live-Sepolia deployment of the router/swapper, an AZLO/WETH pool, any frontend fuel surface, journal/backup fuel fields, manifest scope for the FJ claim, and quoting/route-building helpers.

## Design decisions

### D1 - Harden the router BEFORE deploying: enforce `minFuelOutput` in SwapBridgeRouter itself
`bridgeWithFuel` passes `p.minFuelOutput` to the swap target and trusts the TARGET to enforce it (`SwapBridgeRouter.sol:190`); the router's own check is only `fjBalAfter - fjBalBefore >= fuelReceived` (`:195`), which passes trivially when a malicious or buggy target returns 0 and keeps the tokens. `swapTarget` is owner-mutable (`setSwapTarget`, `:142-147`), so the slippage bound the user SIGNED in the witness is currently enforced by a replaceable contract. One line in the router - `require(fuelReceived >= p.minFuelOutput, "SwapBridgeRouter: insufficient fuel")` - makes the user's signed bound binding regardless of what the swap target does. This does NOT touch the witness typehash, so the `l1.ts`/`WitnessHash.t.sol` pinning is unaffected. We have not deployed yet; this is the cheapest moment this fix will ever have. (Arguing with the obvious "contracts are done, just deploy" framing.)

### D2 - New deploy script for the LIVE arc; keep `DeployBridge.s.sol` as the fork-fixture
`DeployBridge.s.sol` deploys a FRESH 6-dec USDC every run and its `USDC_WETH_SQRT_PRICE`/tick constants (`:141-144`) encode a 6-dec/18-dec pair - both wrong for live AZLO. A new `script/DeployFuelLive.s.sol` (importing `PoolSetupHelper`) takes the EXISTING AZLO from env (default `0xa40a2fe147b7e96325d7c7d974b1f11c3ed82c68`), deploys `UniswapFuelSwap` + `SwapBridgeRouter`, seeds AZLO/WETH, and optionally tops up ETH/FJ behind a flag. Editing the old script in place would silently invalidate the existing fork fixtures that other tests build on.

### D3 - Pool parameters recomputed for 18-dec AZLO; 1 AZLO ~ 1 FJ by construction
V4 orders currencies by address: AZLO (`0xa40a...`) < WETH (`0xfFf9...`), so AZLO is `currency0` (the script asserts this at runtime; it is a fact for the live pair, not a probability like the fresh-USDC case at `DeployBridge.s.sol:181-185`). Both sides are 18-dec, so no decimal adjustment:

- Target price 10,000 AZLO per WETH (mirrors the live ETH/FJ pool's 10,000 FJ per ETH) -> raw price currency1/currency0 = 1e-4 -> `AZLO_WETH_SQRT_PRICE = floor(2^96 / 100) = 792281625142643375935439503`.
- Init tick ~ -92109; band = the MIRROR of the ETH/FJ band: `tickLower = -115140`, `tickUpper = -69060` (multiples of 60, straddles the init tick - a band that misses the price seeds single-sided and the route quotes to zero).
- Net effect: 1 AZLO ~ 1 FJ through the two-hop (minus 2x0.30% pool fees + slippage) - legible fuel UX ("10 AZLO ~ 9.9 FJ").
- Liquidity default `AZLO_WETH_LIQUIDITY = 1e19`, requiring ~684 AZLO + ~0.068 WETH in that band (amount0 = L(1/sqrtP - 1/sqrtPupper), amount1 = L(sqrtP - sqrtPlower)). AZLO side is FREE (one permissionless `mint` call, 684 < the 1000 cap). All four constants are validated by a fork test that initializes the pool with them and round-trips a production-route swap, not by trusting my arithmetic.

### D4 - Budget: shrink, don't top up; do NOT seed ETH/FJ by default
The deployer holds ~0.168 Sepolia ETH; the old defaults want 0.5 (`ETH_SEED`) + 2.0 (`WETH_SEED`) ETH. But the ETH/FJ pool ALREADY EXISTS live - Holonym seeded it (`DeployBridge.fork.t.sol:69-71` says exactly this) - and FJ liquidity costs only gas via the permissionless FeeAssetHandler (1000 FJ/call). So: skip ETH/FJ seeding by default (`SEED_ETH_FJ=false`), seed only AZLO/WETH with ~0.068 WETH + free AZLO. Total spend ~ 0.068 WETH + ~0.01 deploy gas ~ 0.08 ETH - fits the current balance with margin, no top-up required. The fork test and a post-deploy quoter probe are the gates that decide whether an ETH/FJ top-up (free FJ + 0.02-0.05 ETH, concentrated around the LIVE tick, not the reference tick) is actually needed. Accepted consequence of a thin pool: see Security section on pool-drain economics.

### D5 - Fuel record semantics: `record.amount` stays the TOKEN claim amount; fuel is an optional versioned block
The journal engine claims with `BigInt(rec.amount)` (`useDeposit.ts:90`) and the private envelope seals `amount` and is cross-checked by `envelopeMatchesRecord` (`useBridgeJournal.ts:340-343`). Therefore `record.amount` = `totalAmount - fuelAmount` (what `claim_public`/`claim_private` actually consumes), and the existing claim path, envelope sealing, and `envelopeMatchesRecord` all keep working UNCHANGED. New optional `fuel` block on `DepositJournalRecord`:

```
fuel?: {
  amount: string        // AZLO slice (base units) - display + total reconstruction
  secret: string        // FJ claim secret - PLAINTEXT (recipient-bound, same trust class as a public deposit secret, journal.ts:58-59)
  secretHashHex: string
  minOutput: string     // the signed slippage floor
  leafIndex?: string    // from the BridgeWithFuel event
  received?: string     // fuelReceived from the event - the EXACT content-hash amount; the claim MUST use this, never the quote
  consumed?: boolean    // set when a claim tx that embedded the FJ claim was INCLUDED (even app-reverted) - drives the fallback ladder
}
```

Versioning: per-record `schema: 1 | 2` (fuel records are 2). The journal container stays `{schema: 1}` (its shape didn't change; `parseRecords` at `journal.ts:100-113` filters shallowly by id/direction, so both record schemas load). `backup.ts` `validateBackupRecord` (`:71-121`) gains the schema-2 branch with strict optional fuel-field validation; the backup FILE stays `v: 1` (the envelope format didn't change - the sealed record did). Old schema-1 records load, restore, and resume untouched; the fixture test proves it. The fuel secret deliberately stays OUT of the sealed envelope: it is not a bearer credential (the FJ content hash binds `to = user`, `fee_juice/main.nr` claim_helper per holonym-l2-and-fee-juice.md:130-138), so no envelope version bump and the private 1-2 signature seal UX is untouched.

### D6 - Claim sequencing: ONE L2 tx claims tokens AND gas; sponsored-FPC is the retry ladder, not the default
For fuel records, the engine's `deps.claim` builder (`useDeposit.ts:85-110`) swaps `SponsoredFeePaymentMethod` for `publicFeeJuicePayment(recipient, { claimAmount: BigInt(fuel.received), claimSecret: Fr(fuel.secret), messageLeafIndex: BigInt(fuel.leafIndex) })`. `claim_and_end_setup` is a PRIVATE setup-phase call (aztec-4.2.0-portals-fees.md:116), so it composes identically under `claim_public` and `claim_private` - privacy parity for free. The gas bootstrap is exactly this: a deployed-but-FJ-less account's claim tx pays for itself from the FJ it claims in setup. Both L1->L2 messages come from the SAME L1 tx, so the existing simulate-gate (`useBridgeJournal.ts:577-601`) inherently waits for both - simulating the claim WITH the embedded FJ claim is the consumability authority for the pair; no second gate.

The Aztec fee model's sharp edge: setup/teardown is non-revertible, the app phase is revertible. An included-but-app-reverted claim CONSUMES the FJ message (gas was paid) while leaving the token message unconsumed. So: persist `fuel.consumed = true` the moment a claim tx that embedded the FJ claim reads included (success OR app-reverted, via the existing `claimReceiptStatus` executionResult probe at `useDeposit.ts:112-135`); any retry with `fuel.consumed` falls back to the sponsored FPC (always available on testnet, already in scope) - the user's FJ is already in their public balance, the token claim still completes. Never re-embed a consumed FJ claim: it strands the retry in `isMsgNotReady` ambiguity forever.

### D7 - Fuel ON changes the L1 legs; fuel OFF changes NOTHING
The non-fuel deposit keeps the proven portal-direct path in `useDeposit.ts` byte-for-byte (no migration to `router.bridge()` - zero blast radius on the path users rely on today; arguing with the "unify everything through the router" instinct). The fuel branch, inline in `useDeposit.ts` following the same journal-first discipline (record + secrets persisted BEFORE any signature, `useDeposit.ts:196-199`):

1. Two secrets up front: token secret (sealed for private, plaintext for public - unchanged) + fuel secret (plaintext, D5). Record created with the fuel block, `addRecordVerified`.
2. NO approve leg: assert `allowance(from, PERMIT2) == max` via one read (the `MintableERC20.sol:47-50` override); if a future token lacks it, fall back to a one-time max approve of Permit2. The APPROVE phase is replaced by a SIGN phase.
3. Quote at submit time (D9), `minFuelOutput = quote * (1 - 300bps)`; REFUSE to proceed with no quote (a `minFuelOutput` of 0/1 signs away the slice - the fork tests' `minFuelOutput: 1` is a test convenience, never production).
4. Sign the Permit2 witness typed data on the l1 lane (`bridgeWitnessPermitTypedData`, random 256-bit unordered nonce per Holonym `bridgeL1ToL2.ts:881-884`, deadline now+30min), then `router.bridgeWithFuel` - one signature + one tx.
5. Parse the `BridgeWithFuel` event for `tokenIndex`, `fuelIndex`, `fuelAmount` (= `fuelReceived`); persist `leafIndex`, `fuel.leafIndex`, `fuel.received`, `depositTxHash` (the router tx reuses the existing field - backup/restore field set stays small). The event is the ONLY source for `fuel.received`; the quote is a UI estimate (content-hash mismatch = permanently unclaimable FJ, see Security).
6. Hand off to the unchanged engine claim tail (with D6's payment selection).

`runSwapBridge` in `flows.ts` stays as-is (pinned); the app inlines, mirroring how `useDeposit` already inlines rather than calling `flows.runDeposit`. The headless live-testnet script (P6) is what exercises `runSwapBridge` itself.

### D8 - Stepper: FUEL is a fact-anchored phase, not a narration
`bridge-steps.ts` deposit keys with fuel become `[seal?, sign, deposit, fuel, sync, claim, confirm]` (no `approve`). The FUEL phase anchors on the persisted fact `rec.fuel.received !== undefined` (set at the same receipt-parse moment as `leafIndex`), satisfying the monotonic latch rule (`bridge-steps.ts:5-10`): done-detail "swapped 10 AZLO -> 9.87 FJ (gas)". CLAIM's prompt copy becomes "Confirm in your Aztec wallet - one transaction claims your tokens and your gas." `BridgeStep` union gains `"signing"`. Non-fuel records keep the exact current rail (keys chosen by `rec.fuel` presence, which also survives reload - unlike `approveOutcome`).

### D9 - Quoting: chained V4 Quoter `eth_call`s in bridge-core; fixed route
New `bridge-core/src/route.ts` (`buildFuelRoute(azlo, weth, feeJuice, fee, tickSpacing)` - address-sorted PoolKeys + zeroForOnes; for the live addresses both hops are `zeroForOne = true`) and `quote.ts` (`quoteFuelPath(client, quoter, path, zeroForOnes, amountIn)` chaining `quoteExactInputSingle` per hop, Holonym's recipe from uniswap-v4-sepolia.md). Route is FIXED two-hop (user-fixed scope) - no smart routing, no direct AZLO/FJ pool this arc. The UI debounces re-quotes on amount change (500ms) and maps quoter reverts to honest copy ("amount exceeds pool liquidity" / "no route available - bridge without fuel still works"). Frontend floor: warn/refuse when the quoted FJ is below a configured minimum (`MIN_FUEL_FJ`, calibrated in P6 against a real claim's fee - fuel that can't cover ~2 claim txs is a footgun, since `FeeJuicePaymentMethodWithClaim` must cover its own tx's max fee).

### D10 - Manifest scope: FeeJuice `claim_and_end_setup` + the regrant problem
The embedded FJ claim lands in `exec.calls` as a call to the canonical L2 FeeJuice contract (protocol address, `feeJuiceAddress` already exported by `bridge-core/src/fee-juice.ts:19`; the extension itself uses `AztecAddress.fromNumber(5)` per aztec-4.2.0-portals-fees.md:395), and Nulo enforces every `exec.calls` entry against the granted tx scope (`capabilities.ts:19-22`). Add `{ contract: FEE_JUICE_L2, function: "claim_and_end_setup" }` to BOTH `transaction.scope` AND `simulation.transactions.scope` in `buildBridgeManifest` + `buildCombinedManifest` (the engine's simulate-gate dry-runs the claim with the embedded fee). FeeJuice is a protocol contract pre-known to the PXE - expect NO `contracts` registration needed; the manual P4 smoke confirms, with registration as the documented fallback if "Function artifact not found" appears.

The landmine inside the landmine: token-identity D5 implemented field-level re-consent for the `contracts` capability ONLY - additions to `transaction.scope` do NOT re-prompt, so every EXISTING grant keeps refusing the FJ claim forever. Two options: (a) extend the wallet-bridge field-diff to `transaction`/`simulation` scope lists (the durable fix, follows the established pattern), or (b) testnet-manual: users disconnect/reconnect once. This plan ships (a) as a small scoped task in P4 with (b) as the documented fallback if (a) balloons - flagged as an Ask.

### D11 - Config + verification: `testnet-bridge.json` gains a `fuel` section; verify-l1 extends
`testnet-bridge.json` gains `l1.fuel = { router, swapTarget, poolManager, quoter, weth, feeJuice, pools: { azloWeth: {fee, tickSpacing}, ethFj: {fee, tickSpacing} }, slippageBps, minFuelFj }`, surfaced via `bridge-deployments.ts` exports (one source for every surface, mirroring `bridge-deployments.ts:24-26`). Forge broadcasts + a manual config edit, GATED by `verify-l1.ts` extended to verify `SwapBridgeRouter` + `UniswapFuelSwap` (our own foundry project - the easy case; constructor args from the config) - Etherscan verification fails on any address/source mismatch, which is the cross-check that makes the manual edit safe. Deployed addresses + tx hashes recorded in `implementations-plan/swap-fuel/deployments.md`.

### D12 - Old records, new deployment
`deploymentMatches` binds records to `(chainId, portal, bridge)` (`useBridgeJournal.ts:272-278`) - all unchanged by this arc (the router is NEW, the portal/bridge/L2 set is the same live deployment). Old records keep resuming; no `stale-deployment` wave, no migration. Fuel records carry the same binding.

## Phases

### P1 - Router hardening + live-shape deploy script + fork proof (bridge-evm)
Goal: the exact bytes we will deploy, proven on a Sepolia fork against the REAL PoolManager/Permit2/FeeJuice/live-AZLO.
Files: `src/SwapBridgeRouter.sol` (the D1 `require`), `script/DeployFuelLive.s.sol` (new: env-driven AZLO, D3 constants, `SEED_ETH_FJ` flag, runtime `require(AZLO < WETH)`, helper sweeps), `test/SwapBridgeRouter.t.sol` (unit: malicious-target-returns-zero now reverts on minFuelOutput), `test/DeployFuelLive.fork.t.sol` (new: mints LIVE AZLO permissionlessly at `0xa40a...`, seeds AZLO/WETH with the production constants, asserts the band straddles the init tick and both sides were consumed, executes the production two-hop `bridgeWithFuel` route end-to-end incl. `isPrivate=true`, asserts live AZLO's Permit2 allowance override, and probes the LIVE ETH/FJ pool with a production-sized quote so D4's skip-decision is evidence-based).
Validation gate: `forge test` green (unit + fork with `SEPOLIA_RPC_URL`); existing `WitnessHash.t.sol` values unchanged (witness untouched); `bun run --cwd packages/bridge-core test` still green (l1.ts pinning intact).

### P2 - LIVE Sepolia deployment + pool seeding + Etherscan verification + config
Goal: router/swapper live, AZLO/WETH seeded, everything verified and recorded.
Files: run `DeployFuelLive.s.sol` (broadcast; budget per D4: `WETH_SEED~0.07e`, `AZLO_WETH_LIQUIDITY=1e19`, `SEED_ETH_FJ` only if P1's live probe demanded it), `packages/bridge-core/scripts/verify-l1.ts` (add the two new contracts), `packages/faucet/public/testnet-bridge.json` (+`l1.fuel`), `packages/faucet/src/contracts/bridge-deployments.ts` (fuel exports), `implementations-plan/swap-fuel/deployments.md` (addresses, tx hashes, pool ids, seed amounts, leftover sweeps).
Validation gate: Etherscan shows verified source for both contracts; `cast call` quoter probe for a 10-AZLO two-hop returns a sane FJ amount (~9.9 FJ +-band); deployer leftovers swept back; remaining deployer balance recorded.

### P3 - bridge-core fuel plumbing (route/quote/journal/backup)
Goal: framework-agnostic helpers + versioned persistence, fully unit-tested.
Files: `src/route.ts` + `route.test.ts` (live-address fixtures pin ordering/directions), `src/quote.ts` + `quote.test.ts` (mocked client; chained hops; slippage math; revert mapping), `src/journal.ts` + `journal.test.ts` (schema 1|2 union, fuel block, load/cap/derive with fuel records, schema-1 fixtures untouched), `src/backup.ts` + `backup.test.ts` (schema-2 validation branch; schema-1 golden fixture still restores; tampered fuel fields rejected by type, accepted-as-bounded by trust model), `src/index.ts` exports.
Validation gate: `bun run --cwd packages/bridge-core test` + `typecheck`; a serialized PRE-ARC journal/backup fixture loads and restores byte-identically.

### P4 - Wallet manifest scope + scope-delta re-consent
Goal: the FJ claim path passes scope enforcement for new AND existing grants.
Files: `packages/faucet/src/lib/capabilities.ts` + `capabilities.test.ts` (FeeJuice `claim_and_end_setup` in tx + tx-sim scopes of bridge + combined manifests), wallet-bridge field-diff extension for `transaction`/`simulation` scope lists mirroring the `contracts` precedent (+ dispatcher pins: superset scope re-prompts, equal/subset does not) - OR, per the D10 Ask, the documented manual-reconnect fallback.
Validation gate: `bun run --cwd packages/wallet-bridge test` + extension typecheck; manual smoke against a dev extension build: a claim SIMULATION with the embedded FJ claim passes scope (no "scope violation", no "Function artifact not found") on both a fresh grant and a pre-existing one.

### P5 - Faucet UI: fuel toggle, deposit flow, claim tail, stepper fuel phase, surfaces
Goal: the one-flow fuel experience.
Files: `composables/useDeposit.ts` (D6 claim builder + D7 fuel branch + `fuel.consumed` fallback ladder), `components/BridgeForm.vue` (fuel toggle inside the deposit direction: slice input with default preset, net-bridged display, debounced quote line "~ N FJ, min M" with loading/error/no-route states, 0 < fuel < total validation, MIN_FUEL_FJ floor), `lib/bridge-steps.ts` + tests (D8 keys/latch/copy), `composables/useBridgeJournal.ts` (only if the claim-builder signature needs the fuel context - keep the engine core untouched), `components/BridgeReceipt.vue` + `BridgeStepper.vue` + `BridgeJournalCard.vue` (fuel line: slice, received FJ), `lib/testids.ts`, new `BridgeForm.fuel.test.ts` + updates to `BridgeForm.test.ts`/`BridgePhaseRail.test.ts`/`useBridgeJournal.test.ts` (fjwc payment selection, consumed-fallback, fuel-phase rail states).
Validation gate: `bun run audit:vue` (typecheck:all -> test -> lint -> build) green; component tests cover: toggle off = byte-identical legacy behavior; quote-refusal blocks submit; private+fuel seals only the token secret; fuel phases derive correctly post-reload.

### P6 - Live validation: headless script + manual UI pass
Goal: the whole loop proven on the live testnet before humans click.
Files: `packages/bridge-core/scripts/fuel-testnet.ts` (new, modeled on `deposit-testnet.ts` but against the LIVE set: mint live AZLO, run `runSwapBridge` from `flows.ts` against the live router - live-validating the pinned flow - then EmbeddedWallet with real proofs: deploy fresh account via sponsored FPC, `claim_public` with `publicFeeJuicePayment` so the claim pays for itself, assert L2 AZLO + FJ balances; repeat the private variant), calibrate `MIN_FUEL_FJ` from the observed claim fee, record results + lessons in `implementations-plan/swap-fuel/`.
Validation gate: script passes both variants end-to-end (~30-60 min with real proofs); then the manual UI checklist below.

### NEEDS MANUAL TEST (testnet, via the faucet app + Nulo extension)
1. Reconnect/regrant path: existing grant gains the FJ scope (P4 mechanism), fresh connect works.
2. Public deposit + fuel: one MetaMask typed-data signature + one tx; stepper shows SIGN -> DEPOSIT -> FUEL (received FJ) -> CROSSING -> CLAIM -> CONFIRM; recipient lands with AZLO + FJ; FJ balance visible in wallet.
3. Private deposit + fuel: seal UX unchanged (1-2 signatures); token arrives private, FJ arrives public; claim pays itself.
4. Fuel OFF regression: legacy approve+deposit path identical, old pending records resume.
5. Failure drills: reject the witness signature (record discarded, form restored); kill the tab after the router tx and resume from the journal (fuel claim still embedded); backup/restore a fuel record on a fresh browser and claim from it.
6. Quote edge: oversize fuel slice shows the liquidity error and blocks submit.

## Security & Adversarial Considerations

Threat model for the new surface (L1 funds at risk during `bridgeWithFuel`; L2 claims; local persistence):

- Owner-settable `setSwapTarget` (the headline trust knob): the owner can point the router at an arbitrary contract that receives an approval for the fuel slice. Post-D1, a hostile target can no longer return junk below the user's signed `minFuelOutput` - the router enforces the bound itself - and the balance check (`SwapBridgeRouter.sol:193-195`) prevents over-reporting. Residual: a hostile target can still take `fuelAmount` and return REAL FJ from elsewhere (economically pointless) or grief by reverting (DoS, funds refunded by the revert). Owner is the deployer EOA via `Ownable2Step` (no single-tx hijack); document the key's custody in deployments.md. Witness binds `routeHash`, so a relayer cannot re-route; only the OWNER role threatens the route, and only within the minFuelOutput bound.
- Public-pool slippage / front-running / price manipulation: the pools are permissionless; AZLO is permissionlessly mintable (capped 1000/tx). An attacker can mint AZLO and dump it into AZLO/WETH to extract the seeded WETH - the seed (~0.068 ETH) is the explicit, bounded bounty of that attack (the per-tx mint cap raises its gas cost; `MintableERC20.sol:12-14` documents this trade). Consequences are availability-only: a skewed pool makes quotes collapse and `minFuelOutput` revert the WHOLE bridgeWithFuel atomically - user funds never move on a failed swap. Sandwiching is bounded to 300bps of the fuel SLICE (not the deposit). Mitigations: quote-at-submit (not page-load), the MIN_FUEL_FJ floor, honest UI errors steering to fuel-off bridging, and re-seeding as a cheap operational runbook entry.
- Witness replay / tamper: Permit2 unordered nonces (random 256-bit) + deadline (30 min) + full-field witness binding; all three already fork-tested against REAL Permit2 (`SwapBridgeRouterPermit2Fork.t.sol:239-295` - replay, expiry, tamper). The UI must derive `fuelRecipient` from the connected Aztec account, never from input.
- Content-hash mismatch stranding (the quiet fund-loss path): the FJ message binds `(to = fuelRecipient, amount = fuelReceived)`. Claiming with the QUOTED amount instead of the EVENT amount makes the claim revert forever while the FJ sits consumed-nowhere. Hard rule (D5/D7): `fuel.received` comes only from the `BridgeWithFuel` event, is persisted before the claim tail starts, and the claim uses it verbatim. Recovery for a lost field: re-read the event by `depositTxHash`. Same rule already proven for the token side (amount static) - the fuel side is where the dynamic-amount trap actually lives.
- Setup-phase fee consumption vs app revert (claim sequencing): an included-but-reverted claim consumes the FJ message and pays gas without minting tokens. D6's `fuel.consumed` latch + sponsored-FPC retry ladder prevents both the infinite-retry strand and double-embedding a dead claim. The simulate-first gate makes this path rare; the ladder makes it survivable.
- Refund paths: every pre-claim failure is atomic-revert on L1 (Permit2 pull, swap, both deposits in one tx). Post-deposit, funds exist only as the two L1->L2 messages: token public claim recipient-bound, token private claim bearer-secret (sealed envelope, existing machinery), FJ claim recipient-bound. `sweep` on router/swapper is owner-only dust recovery; both contracts hold zero balance between calls by forceApprove-to-zero discipline.
- Local persistence: the fuel secret is plaintext in the journal LIKE public deposit secrets, and with the same bound (`journal.ts:58-59`): tampering secret/leafIndex/received makes the claim revert, never redirects funds. Backup validation rejects malformed fuel blocks (strict types); the unauthenticated-header cross-check and GCM attribution rules are unchanged.
- Input validation at boundaries: contract (`fuelAmount > 0 && < totalAmount`, path/dirs length, hookless route, final-hop-only unwrap), flow (quote-required, minFuelOutput floor, MIN_FUEL_FJ, deadline), UI (0 < fuel < total <= balance, 18-dec `parseAmount` only - never `Number`).
- Wallet scope: least privilege preserved - one new function on one protocol contract added to tx + tx-sim scopes; no wildcards; `canCreateAuthWit` unchanged.

## Assumptions

Facts (verified in-repo):
- Router passes `minFuelOutput` to the target but does not enforce it itself: `packages/bridge-evm/src/SwapBridgeRouter.sol:190,195`; swap target enforcement at `packages/bridge-evm/src/UniswapFuelSwap.sol:109`; `setSwapTarget` owner-only at `SwapBridgeRouter.sol:142-147`.
- FJ deposits are always public; `depositToAztecPrivate` does not exist on FeeJuicePortal at 4.2.0: `SwapBridgeRouter.sol:197-204`; `implementations-plan/faucet-bridge/research/aztec-4.2.0-portals-fees.md:79-80`.
- Live AZLO is `MintableERC20` with the Permit2 allowance override and permissionless capped mint: `packages/bridge-evm/src/MintableERC20.sol:40-50`; constructor record in `packages/faucet/public/testnet-bridge.json` (`maxWholePerTx: 1000`, 18 dec); the override predates the AZLO deploy (git: `7535c7f` -> deploy arc `7f70f61`) and `verify-l1.ts` verified that source at `0xa40a...`.
- The live ETH/FJ pool exists (Holonym-seeded): `packages/bridge-evm/test/DeployBridge.fork.t.sol:69-72`. Old pool constants assume 6-dec USDC: `packages/bridge-evm/script/DeployBridge.s.sol:141-144`; budget defaults `ETH_SEED=0.5e`/`WETH_SEED=2e` at `:149,186`.
- TS witness hashing is byte-pinned to the router: `packages/bridge-core/src/l1.test.ts:14-15` vs `packages/bridge-evm/test/WitnessHash.t.sol`; `runSwapBridge` returns secrets + event-sourced leaf indices: `packages/bridge-core/src/flows.ts:245-327`, pinned by `swap.test.ts`.
- `FeeJuicePaymentMethodWithClaim` wrapper + standalone claim args already exist: `packages/bridge-core/src/fee-juice.ts:28-29,42-47`.
- The wallet supports dApp-embedded fjwc fee payment: `packages/extension/src/wallet/services/execution/utils/fee-detection.ts:8-13`, `fee/embedded-fpc-cap.ts:25`, `operation-planner.ts:227-231`.
- The engine claims with `SponsoredFeePaymentMethod` today and the journal/backup are schema-versioned with strict foreign-input validation: `packages/faucet/src/composables/useDeposit.ts:85-110`, `packages/bridge-core/src/journal.ts:36,100-113`, `packages/bridge-core/src/backup.ts:71-121`.
- Scope enforcement covers every `exec.calls` entry incl. fee-method calls; tx-shaped simulations need `simulation.transactions.scope`: `packages/faucet/src/lib/capabilities.ts:19-22,219-236`; field-level re-consent exists for `contracts` only: `implementations-plan/token-identity/plan.md` D5.
- `deploymentMatches` binds `(chainId, portal, bridge)` - none change this arc: `packages/faucet/src/composables/useBridgeJournal.ts:272-278`.
- Holonym reference: fjwc claim with EVENT-sourced amounts (`frontend/src/hooks/useL1Operations.ts:928-944`), random unordered Permit2 nonce (`frontend/src/hooks/bridge/bridgeL1ToL2.ts:881-884`), quoter recipe + 300bps default (research/uniswap-v4-sepolia.md).

Inferences (labeled):
- Pool math in D3 (sqrtPriceX96, ticks, ~684 AZLO + ~0.068 WETH at L=1e19) is derived arithmetic - treated as DEFAULTS, gated by the P1 fork test, never trusted bare.
- FeeJuice (protocol contract) needs no explicit `wallet.registerContract`/`contracts` listing - inferred from the PXE pre-knowing protocol contracts and the extension's own FJ claim usage; P4's manual smoke is the gate, registration is the fallback.
- Deployer balance "~0.168 ETH" is taken from the task brief; re-read on-chain before P2.
- The live ETH/FJ pool retains usable liquidity near the reference price - probed in P1's fork test before relying on it.
- A V4 Quoter at `0x61b3f2011a92d183c7dbadbda940a7555ccf9227` (research doc) is callable for chained quotes - confirmed by the P2 `cast` probe.

Asks (user decisions):
1. D10: extend wallet-bridge field-level re-consent to `transaction`/`simulation` scopes in THIS arc (durable, small, follows the contracts precedent), or accept manual disconnect/reconnect on testnet?
2. D4: accept no-top-up (seed ~0.07 ETH from the current 0.168), or top the deployer to ~0.3-0.5 ETH first for re-seed headroom after potential pool-drain griefing?
3. Default fuel preset in the UI: fixed slice (e.g. 10 AZLO ~ 10 FJ) vs user-entered only? (Plan assumes a prefilled editable slice.)
4. Confirm `0xa40a...`'s SwapBridgeRouter owner stays the deploy EOA (vs a future multisig) - recorded either way in deployments.md.
