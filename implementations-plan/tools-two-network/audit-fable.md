# Independent Claude audit — round 1 (plan)

**Role:** the top-tier Claude planning reviewer running alongside Codex (Fable role; run on Opus 4.8
1M while Fable is unavailable). Read-only against the worktree.

## Verdict

> `reject` (blocking findings: F1 mainnet manifest cannot validate or boot; F2 Phase 3 does not
> exercise the approve path it exists to prove; F3 the gates cannot catch a wrong-chain build)

## Findings

**F1 — BLOCKING. No valid mainnet manifest exists under the current schema.**
`candidate-schema.ts:47-69`: `l1.fuel` is optional, but **if present** requires
`router, swapTarget, poolManager, quoter, permit2, weth, feeJuice, feeJuicePortal, pools,
slippageBps, minFuelFj` — `.strict()`. `l1.feeJuice` requires `feeAssetHandler` **non-optionally**.
`bridge-deployments.ts:67-70` throws at module init unless `pools.azloWeth` *and* `pools.ethFj` exist.
`useDeposit.ts:957` and `useFuel.ts:160-163` both hard-require `BRIDGE_ROUTER/PERMIT2/SWAP_TARGET`
(all under `l1.fuel`). Omit `l1.fuel` → both lanes throw; include it → deploy a full V4 stack on
mainnet plus a pool literally keyed `azloWeth`. Omit `l1.feeJuice` → the Fuel tab never renders,
killing the plan's primary goal; include it → supply a `feeAssetHandler` that doesn't exist on
mainnet. **Fact 7 is wrong. D5 doesn't remove the deploy burden.** Phase 5 never mentions
`SwapBridgeRouter`/`DeployFuelLive`.

**F2 — BLOCKING. Phase 3's core claim is false.**
`MintableERC20.sol:47-50` returns `type(uint256).max` for Permit2 for **any holder at any decimals**.
A 6-dec `MintableERC20` leaves the approve branch dead code on the canary. Phase 3 proves 6-decimal
math (already covered by `BridgeForm.test.ts`'s 6-dec fixture) and nothing about approve. → Canary
against a plain OZ ERC20 without the override. Also: approve-race-requires-zero is **USDT**, not
USDC; USDC's real quirks are proxy upgradeability, blacklist, pause — none appear in the plan.

**F3 — BLOCKING. A wrong-chain build passes every gate.**
`useDeposit.ts:853,:993` and `useFuel.ts:220` pass `sepolia.id` as the **EIP-712 domain chainId**
into `bridgeWitnessPermitTypedData`. One missed substitution → mainnet Permit2 signatures invalid,
deposits revert 100%; invisible to Phase 1 (testnet-identical by construction) and Phase 2 (which
only reads `build.json.chainId`, a path disjoint from every composable). → Lint/grep ban on
`viem/chains` outside `network.ts` + a test asserting the typed-data domain equals `NETWORK.l1ChainId`.

**F4 — HIGH.** "Git-committed, never a dashboard setting" isn't true of what ships.
`_build-faucet.yml:38-46` builds a CI artifact that is **never deployed**; `release.yml:396-415` only
POSTs a hook and Cloudflare rebuilds with a **dashboard-configured build command + output dir**. Two
projects differing only by that dashboard string is the exact drift class D1 claims to eliminate.

**F5 — HIGH.** The post-deploy backstop can't run on the money host, and doesn't block.
`verify-live-run.ts:22-24` — the URL must be the OPEN host; an Access-gated host returns the login
page. Mainnet is Access-gated → "verify-live green for both hosts" is unachievable without a service
token. `release.yml:418-421` marks the job **advisory**. And `assertTestnetIdentity`
(`chain-guard.ts:40`) has **zero non-test call sites** — "chain-guard asserts it at release" is false.

**F6 — HIGH.** I2's payment method doesn't exist at the pin. `@aztec/aztec.js` v5.0.1 exports only
`PrivateFeePaymentMethod`, `PublicFeePaymentMethod`, `FeeJuicePaymentMethodWithClaim`,
`SponsoredFeePaymentMethod`. Balance payment = **omitting** `paymentMethod`, which the first tx (L2
account deploy) cannot do — it must claim in-tx via `FeeJuicePaymentMethodWithClaim`, already wrapped
as `publicFeeJuicePayment` (`bridge-core/src/fee-juice.ts:73`) — prior art the plan ignores.

**F7 — MEDIUM.** Caps are Sepolia-shaped: `live-intent.ts:34-37` `maxTotalEthSpend: "0.5"` ETH is
trivial on Sepolia, four figures on mainnet; balance/code reads go through `SEPOLIA_RPC_URL`.

**F8 — MEDIUM.** Alias mechanics misstated. `vite.config.ts:76-83` uses `dedupe`, not alias (only
alias is `@`→`./src`). `vite.config.ts:9` imports the chain constant in **Node config scope**, which
`resolve.alias` never touches → `build.json.chainId` won't follow the alias; needs an explicit
`buildMetaPlugin({chainId})` arg. `public/` is copied wholesale, so both builds ship both manifests;
per-target `_headers` needs a separate `publicDir`.

**F9 — MEDIUM.** `chain-ids.ts:8-18` warns in its own header that a stale MAINNET pin already shipped
once → "reuse the numbers" must become "re-read `node_getNodeInfo` and assert at deploy time".

**F10 — LOW.** `features` leaks: `testMint`/`feeAssetHandler` are derivable from manifest presence;
hand-set booleans recreate the duplicate-source-of-truth sin D6 exists to kill. Only `swapFuel` is
genuine policy.

## Looks fine

Facts 1, 2, 3, 5, 6, 8, 9, 10 verified against source. Permit2 gap correctly ranked #1. D1/D2/D7
reasoning sound. Extension dual-build precedent real. `format.ts`/`reuse-token.ts`/
`verify-deployments.ts` reuse map accurate. Rejection of the runtime-hostname outline well-argued.

## Assumptions attack

- **Facts:** #7 misstated (F1). #4 misstated by omission — SponsoredFPC's replacement is a *claim*,
  not a balance (F6). Others verified. Unstated fact that belongs here: `l1.fuel` gates **both**
  lanes, so recon's "direct fee-juice path is architecturally decoupled" contradicts its own later
  "no router-free direct-portal path" — the plan inherited the optimistic half.
- **Inferences:** I2 unsafe (F6). **I5 resolves worse than feared** — `assertReuseMatchesManifest`
  hard-stops when `--reuse-token` ≠ live `l1.usdc`, and `assertPortalUninitialized` is checked on a
  fresh portal → the 6-dec re-point forces a new portal + L2 trio **and cannot use `--reuse-token`**.
  I1 partly wrong (F8). I4 wrong (F1). I3 fine.
- **Asks:** A1 correctly flagged as a blocker. **A2 is mis-scoped** — not "swap-fuel yes/no" but
  "what goes in `l1.fuel` on mainnet at all". Missing: **A5** mainnet gas + $AZTEC budget/cap;
  **A6** CF Access service token for verify-live; **A7** who owns the second CF project's build
  command and how drift is detected; **A8** does the mainnet FeeJuicePortal expose the
  `depositToAztecPublic` shape `SwapBridgeRouter` calls; **A9** real-USDC trust surface (proxy admin,
  blacklist, pause) accepted explicitly.

---

# Independent Claude audit — round 2 (plan v2)

## Verdict

> `conditional approve` — conditions: (1) pin a non-zero mainnet `swapTarget` as an explicit
> decision AND add a readback that manifest `swapTarget` == on-chain `router.swapTarget()`; (2) size
> the Phase-7 fee-juice bridge for the whole ~6-tx deploy sequence, not one claim; (3) migrate the
> live `testnet-bridge.json` + `verify-l1` fuel block atomically with the schema split.

**The three v1 root causes are genuinely fixed against real code. Remaining items are operational.**

## v1-finding verification
- F1 (schema split + guard) — **fixed**. `candidate-schema.ts:47-62` confirmed all-or-nothing; core/swap split + relaxed `requiredPools` is right.
- F2/F4 (Permit2 approve rehearsal) — **fixed**. `useDeposit.ts:966-968` still throws; `MintableERC20` auto-grants Permit2, so D9's plain-6-dec-OZ token forces the approve.
- F3 (viem/chains ban + domain test) — **fixed**. `sepolia.id` as EIP-712 domain confirmed at `useDeposit.ts:853,:993`, `useFuel.ts:220`.
- F6 (`resolveDeployerKeys` + claim-in-tx) — **mostly fixed**; residual = NEW-2 (budget).
- codex#1 (config factory) — **fixed**. `vite.config.ts:9,:61` Node-scope bake confirmed; alias can't touch it.
- codex#3 (per-network gating) — **fixed**. `FUEL_ASSET_HANDLER` stays manifest-derived (no F10 dup). `useWithdraw.ts:221-223` SponsoredFPC confirmed for DP3.
- codex#5 (verify-l1 reused-USDC skip) — **fixed-with-gap** (NEW-1: also reshape verify-l1's fuel block for the split).

## NEW findings
- **NEW-1 (HIGH) — the split is a synchronized breaking change.** Live `testnet-bridge.json` (11 flat fuel fields), `bridge-deployments.ts:32-85` (`BRIDGE_FUEL` reads flat), `verify-l1.ts:138-146` (router-verify), and the deploy-writer must move in ONE commit or `parseCandidateManifest` throws at module init. The always-on `test:faucet` gate catches it (not silently passable), but **Phase 3's gate text must add "existing manifest still parses."**
- **NEW-2 (MEDIUM) — Phase 7 budget.** The gate proves *one* claim consumable, not that bridged fee juice covers account-deploy + 3 contract deploys + 2 wiring txs. Under-sizing halts the mainnet deploy mid-sequence (recoverable via stable deployer + journal, but a live-money stall). **Pre-budget the full worst-case sequence.**
- **NEW-3 (HIGH) — swapTarget equality.** `SwapBridgeRouter.sol:133` `require(_swapTarget != address(0))` — mainnet MUST supply a non-zero swapTarget; and since it's witness-bound (`:266`; app signs `BRIDGE_SWAP_TARGET`, `useDeposit.ts:987`), the manifest value MUST equal on-chain `router.swapTarget()` or **100% of mainnet deposits revert at `permitWitnessTransferFrom`**. No automated gate checks equality. **Add a readback to verify-l1/verify-deployments.** Security: dormant `bridgeWithFuel` is benign (pulls only the caller's own Permit2-signed tokens, reverts if `swap()` reverts, no residual approval).

## Looks fine
Option B defensible given DP1. Per-target `publicDir` correctly fixes CSP/manifest cross-ship; a
mis-remapped manifest fails the startup assertion. DP5 max-approve-to-canonical-Permit2 is standard.
Phase order genuinely de-risks; Phase 6 plain-token rehearsal is the strongest gate.

## Assumptions attack
- **Facts** 1-10 verified. Fact 1 incomplete — add "constructor rejects zero swapTarget" (NEW-3).
- **Inferences:** I-a real breaking-change risk (NEW-1), under-gated. I-b — rehearsal must use mainnet
  feature flags AND router-only manifest shape; the fee-juice rehearsal differs (Sepolia mints via
  feeAssetHandler vs mainnet BYO-$AZTEC) though the bridge tx is faithful. **I-c NOT resolved →
  promote to an Ask** (decide+pin the swapTarget). I-d correctly deferred to deploy-time node check.
- **Asks:** A3-A7 reasonable; A5 must include NEW-2's full-sequence budget. **Missing ask:** which
  address is the mainnet `swapTarget`, and who owns the router's `Ownable2Step` owner key (sweep
  authority).
