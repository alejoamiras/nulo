# Phase 1 — re-pin V5 portal + helper guard + fork-validate

## What shipped
- Re-pinned `FEE_JUICE_PORTAL` `0xd3361019…` (V4) → `0x7C4176bFF969c9417e42F9CB921100145911CC84` (V5, EIP-55 checksummed) in 5 sites: `DeployFuelLive.s.sol:45`, `DeployBridge.s.sol:131`, `DeployFuelLive.fork.t.sol:34`, `DeployBridge.fork.t.sol:22`, `.env.example:20`. Confirmed zero `0xd3361019` left in bridge-evm src/script/test/env.
- Guarded `PoolSetupHelper` (`DeployFuelLive.s.sol:93`): read `SEED_AZLO_WETH`/`SEED_ETH_FJ` up front, only `new PoolSetupHelper(...)` if either is true, and the two seed blocks now key off the locals. Makes a reuse-the-swap re-run (FUEL_SWAP_ADDRESS set, both SEED_* false) genuinely router-only — closes the codex BLOCKER that Phase 2's pass criterion was impossible.

## Validation results
- `forge build` (guarded script + both fork tests): **Compiler run successful** (pre-existing unused-import note on `PoolId` only).
- Non-fork forge suite: **34/34 green** (`forge test --no-match-path 'test/*.fork.t.sol'`).
- `DeployFuelLive.fork.t.sol`: 1 pass / 3 fail.

## The fork-test failures are pre-existing live-state drift, NOT the portal change (proven)
The 3 failures (`test_productionTopology_publicAndPrivate_realPortals`, `test_repeatPurchasesClearTheFloor`, `test_frontRunGuardTripsOnGarbagePrice`) all revert with `PoolAlreadyInitialized()` (`0x7983c051`) at `PoolManager.initialize(...)` during the test's pool-SEEDING setup — **before any `depositToAztecPublic` on the fee-juice portal**. The portal address only affects the later swap+bridge step, so it cannot cause an init-stage revert.

**Rigorous proof**: `git stash push -- packages/bridge-evm/` (revert ALL my edits) → re-run → the SAME 3 tests fail with the SAME `PoolAlreadyInitialized`. The failures are identical on the unmodified V4 code → independent of the portal re-pin.

**Cause**: the test uses `LIVE_AZLO=0xA40A2FE1` (the original holonym AZLO) and `vm.createSelectFork(rpc)` at LATEST Sepolia. Its AZLO/WETH + ETH/FJ pools are already initialized on live Sepolia (seeded for real previously), so the test's fresh `initialize` reverts. The test was written assuming clean (uninitialized) pools — an assumption that stopped holding once the pools were seeded live. The `_guardPrice`-based reuse path exists for the production `setup`, but `test_frontRunGuardTripsOnGarbagePrice` expects a fresh init, and the topology test's helper.setup calls `initialize` directly.

**Why my change didn't make it worse**: the fork test never reaches the portal, so the V5-vs-V4 portal address is untested by it either way. The portal-acceptance evidence comes from: (a) live `cast` — V5 portal `0x7c4176bf` has code + `UNDERLYING()==0x762c` (the FJ the swap outputs); (b) ABI match — `FeeJuicePortal.depositToAztecPublic(bytes32,uint256,bytes32)→(bytes32,uint256)` == the router's `IFeeJuicePortal`; (c) the authoritative proof is Phase 3's REAL self-paying claim (codex round-1: "the e2e self-paying claim remains the real proof").

## Decision (codex-consulted)
_Codex consult session pending — verdict folded in below before marking Phase 1 ✓._

## Follow-up (out of scope here)
The `.fork.t.sol` pool-seeding tests assume uninitialized pools and are broken by live seeding. Fix later by making the test reuse already-initialized pools (or pin a clean fork block). Tracked, not fixed in this portal-address fix.
