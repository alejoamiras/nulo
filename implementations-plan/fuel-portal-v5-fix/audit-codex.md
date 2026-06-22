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
# Codex consult — Phase 1 gate decision (session 019ee5b2)

Question: the approved Phase 1 fork-test gate is unachievable (PoolAlreadyInitialized drift, proven innocent via git stash). Adjust the gate + proceed?

## Verdict: proceed with changes

Verdict: `proceed with changes (downgrade Phase 1 from “acceptance gate” to “non-regression evidence”; keep candidate-only until Phase 3 smoke is green; optionally add a portal-only fork probe if it’s <30 min).`

Your innocence argument is sound on attribution, not on acceptance. `git stash` equivalence proves the 3 fork failures are pre-existing and unrelated to the re-pin. It does **not** prove the new portal path works.

The important part: this specific fork test is not uniquely valuable anymore. In its current form it dies before `depositToAztecPublic`, so treating it as a blocker is fake rigor. Also, even when green, it only proves `router.feeJuicePortal()==...` plus FJ balance moved into the portal. It does **not** prove message/claim semantics. Phase 3’s real self-paying claim is stronger than this fork test, not weaker.

So yes: Phase 2 is acceptable **if** you keep strict candidate-first discipline. Redeploy router, update candidate only, run the real smoke, and do not promote live until that passes. What you are risking is testnet deploy gas/time, not a user-facing cutover.

What I would change in your proposal:
- Do **not** describe `forge build + 34/34 + stash-equivalence` as a replacement acceptance gate. Call it what it is: compile/regression evidence plus proof the old gate is invalidated by live drift.
- Log the fork test as broken-by-environment and explicitly move portal acceptance to Phase 3.

Cheaper/better than pure defer:
- Best cheap salvage: make the fork test idempotent against already-initialized pools. If `slot0 != 0` and price is within tolerance, skip init/reseed and use existing live liquidity; fail only if initialized at garbage price.
- Do **not** pin an old block. That restores greenness by dodging reality.

If that salvage is not obviously small, skip it and proceed candidate-first.
# Codex post-impl audit (session 019ee648)

Verdict: `no high/critical`

**Correctness**
- No helper-guard bug found. `helper` is only touched inside the same seeded branches that justify constructing it, so there is no path where `helper == address(0)` is called and “succeeds” silently. Full-seed behavior is unchanged because both defaults are still `true`. See [DeployFuelLive.s.sol](packages/bridge-evm/script/DeployFuelLive.s.sol:93) lines 93-151.
- Separate low-grade footgun remains in the reuse matrix: if an operator sets `ROUTER_ADDRESS` but forgets matching `FUEL_SWAP_ADDRESS`, the script will deploy a fresh `UniswapFuelSwap` and then reuse the old router, orphaning the new swap. That predates/exists outside the helper guard, but it is still a bad env combination. See [DeployFuelLive.s.sol](packages/bridge-evm/script/DeployFuelLive.s.sol:84) lines 84-89.

**Security**
- The new router owner EOA is a real trust surface, but not a high-severity theft surface. `setSwapTarget()` can DoS users or force a config rotation, and `sweep()` can recover residue, but the router only approves `fuelAmount`, witness-binds the live `swapTarget`, checks actual FeeJuice balance increase, and checks exact fuel-slice consumption before bridging the remainder. That prevents “steal the whole deposit” and “sweep mid-flight” failure modes. See [SwapBridgeRouter.sol](packages/bridge-evm/src/SwapBridgeRouter.sol:143), [SwapBridgeRouter.sol](packages/bridge-evm/src/SwapBridgeRouter.sol:181), [SwapBridgeRouter.sol](packages/bridge-evm/src/SwapBridgeRouter.sol:290).

**Live-state**
- I found no runtime consumer in repo still pointing at `0x697bdb88` or the V4 portal. The live faucet manifest is on the new router, and the faucet/runtime reads from that manifest. See [testnet-bridge.json](packages/faucet/public/testnet-bridge.json:14), [bridge-deployments.ts](packages/faucet/src/contracts/bridge-deployments.ts:21), [useDeposit.ts](packages/faucet/src/composables/useDeposit.ts:647).
- Leaving the old router deployed is acceptable on testnet, but it is not the best possible state. You can effectively neutralize it by changing its `swapTarget` to a nonfunctional address/reverter: stale faucet clients will then fail closed because `swapTarget` is witness-bound, instead of burning FJ into the dead V4 portal.

**Missed**
- `router` is not the only runtime-critical fuel field. `swapTarget` is also runtime-critical because the frontend signs it into the Permit2 witness; if `setSwapTarget()` changes on-chain and the manifest is not updated, fueled deposits fail. `feeJuicePortal` is metadata-only for faucet runtime, but still required by verification tooling. See [bridge-deployments.ts](packages/faucet/src/contracts/bridge-deployments.ts:21), [flows.ts](packages/bridge-core/src/flows.ts:230), [verify-l1.ts](packages/bridge-core/scripts/verify-l1.ts:136).
