# Codex audit — fuel-portal-v5-fix (light)

Session `019ee564-406f-74f3-b046-b7815fbafcd4`, xhigh, read-only. Prompt: critical adversarial + assumption-attack pass on `plan.md` (root cause: SwapBridgeRouter built pointing FEE_JUICE_PORTAL at the dead V4 portal; V5's is `0x7c4176bf`).

## Verdict

**conditional approve** (conditions: fix the Phase 2 "router-only" deploy assumption or patch the script; validate the candidate manifest with `smoke-swap-existing-testnet.ts` before promoting live; correct the stale-address inventory and test claims; drop the absolute-index heuristic)

## Facts

- "Stale V4 portal pinned in exactly 6 places" is false. The exact V4 address is also in `packages/bridge-evm/.env.example:20`; repo research docs still mention it too.
- "The `.fork.t.sol` tests actively call `depositToAztecPublic` through the router" is overstated. Only `DeployFuelLive.fork.t.sol` does. `DeployBridge.fork.t.sol` is wiring/seed coverage, not a real fee-portal claim-path exercise.
- Updating `l1.fuel.feeJuicePortal` in the faucet manifests is not runtime-critical today. The faucet's `FuelDeployment` omits that field entirely (`packages/faucet/src/contracts/bridge-deployments.ts:21-50`). It matters for metadata and `packages/bridge-core/scripts/verify-l1.ts`, not for the live fueled flow.

## Inferences

- `I1` is mostly safe. No wallet/runtime code pinning the L1 fee portal. `FeeJuicePaymentMethodWithClaim` upstream only packages `sender + claimAmount + claimSecret + messageLeafIndex` (`node_modules/@aztec/aztec.js/src/fee/fee_juice_payment_method_with_claim.ts:15-42`).
- The real resolution happens inside the L2 `FeeJuice` contract, which does NOT depend on the portal address. It consumes against protocol `FEE_JUICE_ADDRESS`, while `Inbox` rewrites the sender to that magic address only when `msg.sender == FEE_ASSET_PORTAL` (`Inbox.sol:104-107`). Strongly supports "wrong portal is the whole story."
- The V5 address from `feeJuicePortalAddress` is the right target for `depositToAztecPublic`. `FeeJuicePortal` and `FeeAssetHandler` are distinct. `FeeAssetHandler` is just a mint helper (`src/mock/FeeAssetHandler.sol`); the canonical bridge endpoint is the portal created by `Inbox` and surfaced via `getFeeAssetPortal()`.
- `I2` should be weakened: seeded pools prove swap liquidity, not bridge correctness. The stronger safety point is that the router uses `feeJuicePortal.UNDERLYING()`, so an asset mismatch would fail the balance/approve path.

## Security

- Reusing the existing `UniswapFuelSwap` is portal-safe: it bakes only `poolManager`, `feeJuice`, and `weth`, not the portal.
- But not trust-free: `UniswapFuelSwap` has an owner-only `sweep()` safety valve. That trust surface already exists; reusing it preserves it.
- "Old router left live => no funds at risk" is too soft. The old router remains a live sink for the fuel slice into the dead portal. Stale clients can still strand FJ there, even if token bridging still succeeds.
- No cross-router replay issue: Permit2 signatures are spender-bound to the router address.

## Sufficiency

- Redeploying only the router should be sufficient for the functional bug. No extra L2 fee-juice contract update or alternate 5.0 delivery path hiding here.
- But the fork tests only prove "portal accepts custody + emits a message-compatible deposit," not "message folds and self-paying claim succeeds." The e2e self-paying claim remains the real proof.

## Gates

- Biggest blocker: `DeployFuelLive` will NOT deploy "only the router." Even with `FUEL_SWAP_ADDRESS` set and both `SEED_*` flags false, it still deploys `PoolSetupHelper` unconditionally (`DeployFuelLive.s.sol:93`). The Phase 2 pass criterion is impossible as written.
- Candidate/live discipline is backwards. Use `smoke-swap-existing-testnet.ts --config testnet-bridge.candidate.json` before promoting live. `fuel-testnet.ts` defaults to the live manifest.
- Add `owner()` read-back on the new router. Current read-backs only prove portal/swap wiring.
- The "canonical-range index ~3.0M" check is brittle and time-sensitive. Gate on successful claim and/or defined checkpoint for the exact message, not an absolute index range.

## Disposition

All conditions adopted — see `plan.md` Phases 1-3 + Audit verdicts. Path references above rewritten repo-relative for the committed record.
