# Codex post-implementation audit (xhigh)

**Verdict:** the cross-chain keystone is solid — Solidity/Noir/TS content-hash vectors line up, the Permit2 witness binds portal/token/amounts/recipients/route/min-out, and there's no relayer path to change recipients/amounts after signing. Not production-safe yet: 3 fund-stranding correctness bugs + 1 route-validation bug.

## HIGH (fund-stranding)

1. **Secret-loss strands deposits.** `flows.ts` generates the claim secret in memory; `recovery.ts` exists but isn't wired into the live path. A refresh/crash after the L1 deposit tx but before `claim_*` loses the only preimage → both public + private deposits stranded.
   **Fix:** persist `{txHash, secret, secretHash, recipient}` encrypted before broadcast; resume claim on boot.
   **Status:** ☑ FIXED — `flows.ts` `RecoveryHooks` (persist the secret before broadcast, the leaf index on deposit, clear on claim); `sandbox.ts` persists to localStorage via `recovery.ts` + exposes `pending()`/`resume()` to re-claim a stranded deposit.

2. **Leaf-index derivation is race-prone.** `flows.ts` took `leafIndex` from `simulateContract()` *before* sending the deposit. A concurrent deposit changes the real index → `claim_*` retries forever against the wrong leaf.
   **Fix:** derive the actual index from the mined receipt / Inbox `MessageSent` event, not preflight simulation.
   **Status:** ☑ FIXED.

3. **Zero-address L1 exits irreversibly burn funds.** `token_bridge` accepted `recipient = 0x0` in `exit_to_l1_public/private`; the L2 burn completes but the canonical portal's underlying transfer reverts on zero-address → the L1 message can never be consumed.
   **Fix:** reject zero `recipient` in Noir + mirror in `l2.ts`.
   **Status:** ☑ FIXED (l2.ts guard; Noir assert + recompile).

## MEDIUM

4. **Route validation over-accepts ETH/WETH discontinuities.** `_validateRoute` allows a WETH↔native discontinuity between any adjacent hops, but `_settle` only handles a native *last* hop → some signed routes validate then revert at settlement.
   **Fix:** allow the discontinuity only on the penultimate→last boundary. **Status:** ☑ FIXED — restricted to `i + 1 == path.length - 1`; 14 forge route/router tests green.

5. **"Sandbox-only" code ships in prod assets.** The runtime dynamic import code-splits but still emits a fetchable chunk; `sandbox.ts` embeds the (well-known) anvil key + `public/{sandbox,token_bridge}.json` ship.
   **Fix:** build-time env gate (`import.meta.env.DEV`) or a separate sandbox entry. **Status:** ☑ FIXED (gated behind `import.meta.env.DEV`).

## LOW

6. **Replay/expiry test coverage weak** — `SwapBridgeRouter.t.sol` uses a mock Permit2 + `deadline=max`; no real `InvalidNonce`/expiry regression. **Fix:** a real Permit2 fork test (the fork harness already exists in `DeployBridge.fork.t.sol`). **Status:** ☑ FIXED — `SwapBridgeRouterPermit2Fork.t.sol` forks Sepolia + drives the REAL Permit2 + REAL Uniswap V4 through `bridgeWithFuel`: `test_bridgeWithFuel_realSwapAndPermit2` (signed witness transfer → swap USDC→WETH→ETH→FeeJuice → bridge), `test_permit2NonceReplayReverts`, `test_permit2ExpiredDeadlineReverts`. All 3 green on-fork; full forge suite 30 tests.

**All 6 findings addressed.** HIGH ×3 + MEDIUM ×2 fixed during implementation; LOW #6 closed by the fork test above.
