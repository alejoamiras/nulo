# Phase 2 — private-fuel calibration (BLOCKED on a prerequisite; surfaced to user)

## Findings before any live run (saved ≥3 doomed runs)

Investigating how to register the PrivateFPC in `fuel-testnet.ts` (EmbeddedWallet) surfaced three things:

1. **The PrivateFPC salt is `0`** (Fr.ZERO), no constructor args. `getContractInstanceFromInstantiationParams(PrivateFPCArtifact, {salt: 0, publicKeys: default, deployer: ZERO})` reproduces `PRIVATE_FPC_ADDRESS` (`0x1fa8746e…`) exactly. (The salt was never exported — the faucet relies on the extension wallet auto-registering the instance.)
2. **The 5.0 artifact (`fb6f196`) at salt 0 yields the SAME address** as the V4 (`215fd08`) pin → the V4→5.0 fee-payment artifact bump did NOT move the FPC address. The `PRIVATE_FPC_ADDRESS` pin is still correct for 5.0; no re-pin needed. (Resolves the V4-pin concern.)
3. **The PrivateFPC is NOT deployed on the V5 node.** Contrast: the SponsoredFPC (`0x261366b3…`, deployed during the bridge bring-up) IS deployed on V5; `node.getContract(0x1fa8746e)` returns nothing.

## Why this blocks the calibration

The user's original failure (`amount >= max_gas_cost`) fired in **client-side simulation** — the wallet has the FPC *instance registered* in its PXE, so it can simulate `mint_and_pay_fee` locally even though the contract isn't on-chain. But for the claim to **settle**, the FPC is the on-chain fee payer; its public fee logic must execute on-chain, which requires the contract class + instance to be **deployed** on V5. It isn't (V4 deploy didn't carry to the fresh V5 rollup — same class of issue as the portal/bridge V5 redeploy).

So the fee-math fix (Phase 1 ✓ — pin the ceiling) is **necessary but not sufficient**: even a perfectly-calibrated `minFuelFj` + predicted-worst cap will not settle the private claim until the PrivateFPC is deployed on V5. Running the ≥3 calibration runs before deploying the FPC would just fail to settle every time.

## Decision surfaced to the user (scope addition + on-chain deploy)

Phase 2 now needs a prerequisite the plan didn't include: **deploy the PrivateFPC (class publish + instance at salt 0) on V5**, analogous to the portal/bridge redeploy. This is an on-chain testnet deploy + a scope expansion, so per the `/goal` hard limits ("never expand scope; surface and hold") it's held for the user's go-ahead before proceeding.

Once deployed: register it in `fuel-testnet.ts` via `getContractInstanceFromInstantiationParams(PrivateFPCArtifact, {salt: 0})` + `registerContract`, then the private-claim variant + predicted-worst fee + decompose logging + ≥3 calibration runs can proceed.

`LESSONS_FILE=implementations-plan/private-fuel-fee-fix/lessons/phase-2.md`

## Phase 2: ⏸ HELD (prerequisite: deploy PrivateFPC on V5 — awaiting user go-ahead)
