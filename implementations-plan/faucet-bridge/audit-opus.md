# Hostile Audit — Faucet → Bridge (mega-deep, fresh adversarial reviewer)

Reviewer stance: no prior stake in this plan. Read `plan.md` + all 7 `research/*.md`, then verified the load-bearing claims against `[holonym]` (`holonym-aztec-bridge`), `[wonderland-fee]` (`aztec-fee-payment`), and the live Nulo repo. Findings below are evidence-backed; I cite the exact file/line I checked.

## Verdict

**conditional approve (with conditions: 1. Re-baseline the viem-alias decision — the repo aliases `viem` → `@aztec/viem@2.38.2`, so the Ledger's premise ("dedupe can't merge") is inverted and the `@wagmi/vue`-vs-`@wagmi/core` gate must test the FORK's wagmi-compatibility, not single-viem-ness. 2. Resolve the withdraw `epoch`-vs-`l2BlockNumber` contradiction BEFORE Phase 2 — the reference portal Nulo is copying passes a raw `_l2BlockNumber` to `outbox.consume`, but `plan.md` + 3 research docs assert "epoch-based"; the 4.2.0 Outbox ABI takes `Epoch`. One of these is wrong and it lands stranded-withdraw bugs in Phase 7. 3. Phase 1 must HARD-GATE on the live testnet's `FeeAssetHandler` being wired as a minter on the current fee asset with non-zero `mintAmount` — if not, Phase 8 pool-seeding has no FeeJuice source and Nulo cannot mint it (the fee asset is owner-gated, not Nulo's). 4. `MintableERC20.allowance()`-override Permit2 pre-approve is Nulo-invented, NOT copied from any reference — spec + test it as a first-class adversarial surface, not a "default pending veto". 5. Add `hooks == address(0)` to `_validateRoute` — confirmed ABSENT in the reference; the plan says "verify, add if not" but the answer is definitively "add". 6. Adopt the omitted `SwapBridgeRouterPermit2Fork.t.sol` as the Permit2 regression anchor.)**

The plan is unusually strong — recon-first ordering is correct, the content-hash keystone is the right obsession, and the deferral of the swap to Phase 8 is sound. It does NOT clear `approve` because three of its "resolved" facts are contradicted by the actual reference source, and one core contract (`MintableERC20`) is presented as a copy when it is a novel invention.

---

## Critical

### C1 — Withdraw is asserted "epoch-based" but the reference portal passes a raw L2 block number; the 4.2.0 Outbox takes an `Epoch`. Unreconciled. (Phases 2, 4, 7)

`plan.md` Phase 2/4/7 and `research/holonym-flows-status-recovery.md:144-146` + `research/aztec-4.2.0-portals-fees.md` Q2 all state withdraw is "epoch-based" via `getEpochForCheckpoint` and `computeL2ToL1MembershipWitness` returns `epochNumber`. But the reference contract Nulo is copying verbatim does this (`[holonym] l1-contracts/src/TokenPortal.sol:230-253`):

```solidity
function withdraw(... uint256 _l2BlockNumber, uint256 _leafIndex, bytes32[] calldata _path) ...
    outbox.consume(message, _l2BlockNumber, _leafIndex, _path);
```

It passes `_l2BlockNumber` straight into `outbox.consume` as the second arg. Yet `research/aztec-4.2.0-portals-fees.md:278-285` documents the 4.2.0 Outbox as `consume(L2ToL1Msg, Epoch _epoch, uint256 _leafIndex, bytes32[] _path)`. These cannot both be right. Either:

- (a) Holonym's `TokenPortal.sol` is a 4.1.2-era contract whose `outbox.consume(uint256, ...)` call will **not compile** against the 4.2.0 `aztec-contracts` submodule's `IOutbox` (the type changed `uint256` → `Epoch`), OR
- (b) `Epoch` is a `uint256`-compatible user-defined value type and the "epoch" is numerically the checkpoint/block number, making the research's `getEpochForCheckpoint` conversion either a no-op or a second source of truth that contradicts the contract.

The plan never resolves this. Phase 2 says "withdraw (epoch-based)" and Phase 1 pins the `aztec-contracts` submodule "@ deployed tag" — but if the submodule is 4.2.0 and the copied portal calls the old Outbox signature, **Phase 2 won't `forge build`**, and the plan's Phase-1 gate doesn't check withdraw-side ABI compatibility (it only checks the content-hash + mint sigs). Worse case is (b)-with-a-bug: it compiles, but the frontend passes `getEpochForCheckpoint(block)` while the contract expects the block number, the witness `leafIndex`/`epoch` pairing is off, and `outbox.consume` reverts — stranding withdrawn funds at exactly the Phase-7 "point of no return" the plan correctly identifies as unrecoverable.

**Fix:** Before Phase 2, read the pinned 4.2.0 `aztec-contracts/l1-contracts/src/Outbox.sol` `consume` signature AND the canonical 4.2.0 `TokenPortal.sol` (not Holonym's) and decide which `withdraw` arg the portal must pass. Add the withdraw-side ABI to the Phase-1 compile gate (`forge build` against the real submodule, not Holonym's vendored copy). Pin a fixed-vector `get_withdraw_content_hash` equality test alongside the mint-hash test — the withdraw hash (`research/holonym-l1-contracts.md:307-310`) is just as load-bearing and the plan's Phase-1 keystone only covers `mint_to_public/private`.

### C2 — The viem-alias decision is built on an inverted premise. The repo aliases `viem` → `@aztec/viem`, so wagmi WILL dedupe — to a fork of unknown wagmi-compatibility. (Phase 5, Decision Ledger)

The Ledger states: "Opus showed the repo viem is `npm:@aztec/viem@2.38.2` (a different package, not a version) so dedupe can't merge it with wagmi's stock-viem peer → likely dual-viem identity bugs." I verified the lockfile (`bun.lock:2446`):

```
"viem": ["@aztec/viem@2.38.2", ...]
```

The bare specifier `viem` **is aliased to `@aztec/viem@2.38.2` repo-wide**. This is the opposite of what the Ledger claims. When `@wagmi/core` (peer `viem@^2`) imports `viem`, Bun resolves it to `@aztec/viem@2.38.2` — a **single** viem identity, not a dual one. There is no dual-viem problem; there is a *fork-compatibility* problem the plan never names:

- `@aztec/viem`'s `package.json` self-describes as `"TypeScript Interface for Ethereum"` (identical to upstream viem's description) — it is a viem **fork**, not a re-export. Exports surface looks viem-shaped (`./actions`, `./chains`, `./accounts`, `./utils`, `./account-abstraction`), but it pins its OWN `ox@0.9.6`, `abitype@1.1.0`, `@noble/*`.
- `@wagmi/core@2.x` is built and tested against **upstream** viem at specific minor ranges. Whether it runs against `@aztec/viem@2.38.2`'s fork (which may lag or diverge upstream `2.38.x` internals wagmi reaches into — `getClient`, transport shapes, `Account` types) is **unverified by anyone**. The fork could silently break `createConfig`, `connect`, `signTypedData`, or `simulateContract`.

So the Phase-5 gate "`bun why viem` (single resolved viem) BEFORE building bridge UI" tests the wrong thing. `bun why viem` will ALWAYS show a single `@aztec/viem` because of the alias — the gate passes trivially and proves nothing about wagmi working. The real risk is the fork.

**Fix:** Rewrite the gate. It must be a *runtime smoke*: install `@wagmi/core` (or `@wagmi/vue`), build a minimal `createConfig({ chains:[sepolia], transports:{...} })` + `connect()` + `signTypedData()` (the Permit2 EIP-712 call) against `@aztec/viem`, and confirm it executes in the COOP/COEP'd app. If the fork diverges, the fallback is NOT "vanilla `@wagmi/core` through `@aztec/viem`" (same fork, same risk) — it is hand-rolling the ~5 viem calls the bridge needs (`getWalletClient`/`signTypedData`/`writeContract`/`waitForTransactionReceipt`/`readContract`) directly against `@aztec/viem`, skipping wagmi entirely. The user's original Decision #1 ("viem + `@wagmi/core` vanilla") may not survive contact with the fork; surface that to the user (see Ask-1).

### C3 — Phase 8 pool-seeding has no FeeJuice source if the live testnet's `FeeAssetHandler` is not wired as a minter on the current fee asset. The plan treats this as a soft Phase-1 check; it is a hard external dependency Nulo cannot satisfy itself. (Phases 1, 8)

`research/uniswap-v4-sepolia.md:289-295` asserts "On Aztec testnet [FeeJuice] is only available via `FeeAssetHandler.mint()`... Option A (recommended): use `FeeAssetHandler.mint()`... proven working." I verified the actual contract (`[holonym] .../@aztec/l1-artifacts/.../mock/FeeAssetHandler.sol`):

```solidity
function mint(address _recipient) external { FEE_ASSET.mint(_recipient, mintAmount); }
```

`mint(address)` itself is permissionless — but it calls `FEE_ASSET.mint(...)`, and `FEE_ASSET` is a `TestERC20` whose `mint` is `onlyMinter` (`.../mock/TestERC20.sol`):

```solidity
function mint(address _to, uint256 _amount) external onlyMinter { _mint(_to, _amount); }
```

So `FeeAssetHandler.mint()` only works if **the protocol deployer added the FeeAssetHandler as a minter on the fee asset** AND `mintAmount > 0`. Both are properties of the *target testnet's* deployment, entirely outside Nulo's control. The Holonym seed script (`[holonym] l1-contracts/script/SeedUniswapPools.s.sol:200-206`) even has a tell: after calling `FeeAssetHandler.mint(seeder)` it ALSO sweeps the *deployer's own pre-existing FJ balance* into the seeder — implying their deployer had FJ from another source (likely was itself an allowlisted minter). If Nulo's deployer is NOT a fee-asset minter and the handler is unwired (or `mintAmount==0`), the plan has **no FeeJuice and no way to mint it** — `feeJuiceAddress` is a protocol-owned token, not Nulo's `MintableERC20`. The entire ETH/FeeJuice pool, the swap path, and the headline "USDC→AZTEC in 1 tx" demo collapse.

`plan.md` Phase 1(a) says "confirm `FeeAssetHandler.mint()` is permissionless for our deployer" — correct check, but framed as a checkbox, with no documented fallback if it fails. The "live faucet at 4.2.0 strongly implies yes" reasoning is a non-sequitur: the faucet uses `SponsoredFPC` and `Dripper`-minted L2 tokens; it has never touched the L1 `FeeAssetHandler` or L1 FeeJuice (confirmed — `grep` for FeeAssetHandler in `packages/faucet` is empty). The faucet working tells you nothing about the L1 fee-asset minter wiring.

**Fix:** Promote this to a Phase-1 STOP-THE-LINE gate with an explicit branch: actually call `FeeAssetHandler.mint(deployer)` on the live net in the recon script and assert a non-zero balance delta. If it fails, the decision tree is: (a) request fee-asset minter rights from the Aztec testnet operators (out of Nulo's hands, schedule risk), or (b) drop the swap entirely and ship public-fuel-only via direct `FeeJuicePortal.depositToAztecPublic` — which requires the user to *already hold* the fee asset, or the operator to seed it. This is an UNSURFACED ask to the user (Ask-2): "the headline swap demo is contingent on a testnet property we don't control — accept the risk that v1 ships without the swap?"

---

## High

### H1 — `MintableERC20` with an `allowance()`-override Permit2 pre-approve is invented, not copied. It is a novel security surface presented as a "default pending veto". (Phase 3)

`plan.md` "Defaults pending veto" #5 and Phase 3 specify a `MintableERC20` whose `allowance()` returns `max` for the canonical Permit2 spender. I checked: **Holonym has no `MintableERC20.sol`** (`find l1-contracts/src -name '*.sol'` lists only `UniswapFuelSwap`, `TokenPortal`, `SwapBridgeRouter` + interfaces/tests). Holonym uses the Aztec `TestERC20` (standard OZ ERC20 + `onlyMinter` mint) and an externally-deployed test USDC with public `mint`. The `allowance()`-override trick is entirely Nulo's invention. That is fine, but:

- An `allowance()` override that hard-returns `type(uint256).max` for Permit2 means `transferFrom` via Permit2 succeeds for ANY amount without an on-chain allowance ever being set. Permit2's `permitTransferFrom` calls `token.transferFrom(owner, to, amount)` after verifying the signature — so the signature IS the gate, which is the intended Permit2 model. But the override also silently grants the same to the canonical Permit2 for *non-witness* `transferFrom` flows. On a free-mint testnet token that's low-stakes; the invariant to PIN is "the override returns max ONLY for `spender == CANONICAL_PERMIT2`, and a normal `approve()` still works for every other spender" — otherwise standard ERC20 integrations (the V4 PositionManager during seeding, which pulls USDC) may behave unexpectedly.
- The plan correctly rejects the constructor-`approve` approach ("only covers the deployer") — that reasoning is sound. But it never states whether `balanceOf`/`transfer` are otherwise stock OZ, nor whether the cap (1000 units/tx) interacts with seeding (the seed script mints 3000-5000 USDC per `research/uniswap-v4-sepolia.md:307` — that exceeds a 1000/tx cap and would require multiple mint calls or a separate uncapped owner-mint path).

**Fix:** Spec `MintableERC20` explicitly: stock OZ ERC20, public `mint(to,amount)` capped 1000e{dp}/tx for the faucet path, PLUS an owner-only uncapped mint for seeding (the 5000-USDC pool seed cannot use the capped public path). Pin two `forge` tests: (1) `allowance(anyone, PERMIT2) == max` AND `allowance(anyone, randomSpender) == 0` until approved; (2) capped public mint reverts above cap, owner mint does not. Treat this as a Phase-3 first-class contract with its own test file, not a config bullet.

### H2 — `_validateRoute` does NOT enforce `hooks == address(0)`. Confirmed absent. The plan says "verify, add if not" — the answer is "add". (Phase 8, Security §)

I read the full `_validateRoute` (`[holonym] l1-contracts/src/UniswapFuelSwap.sol:226-249`). It checks first-hop input token and last-hop output token. It **never inspects `key.hooks`**. The plan's Security note and Phase 8 hedge ("enforce `hooks == address(0)` ... verify it's present; add if not") — it is not present. With attacker-seeded thin pools (the plan's own "permissionless capped mint → pool manipulation" threat), a user-supplied `path` containing a pool with a malicious hook would pass `_validateRoute`. The `routeHash` in the Permit2 witness binds the hooks field to *the user's signature*, so a relayer can't swap it — but the USER (or a phishing UI feeding the user a poisoned route) can sign a route through a hooked pool. A V4 hook runs arbitrary code during swap/settle and can grief or skim within the `minFuelOutput` band.

**Fix:** Non-optional: add `require(Currency.unwrap(key.hooks) == address(0))` for every hop in `_validateRoute`. Add a `forge` test with a non-zero-hook pool key that reverts. Stop describing this as "verify".

### H3 — The Permit2 fork test the reference ships is omitted from the TAKE list; the unit suite does NOT test nonce-replay or deadline-expiry. (Phase 8, Decision Ledger Ask-D)

The plan's Ask-D decides "`SignatureTransfer` unordered nonce + short deadline" and the Security § calls replay "unsurfaced in research, decided here". I verified the reference: Holonym's frontend DOES use the unordered-nonce model — `crypto.getRandomValues` for a 32-byte random nonce (`[holonym] frontend/src/hooks/bridge/bridgeL1ToL2.ts:882-884`), matching the decision. Good. BUT:

- The plan's TAKE list (`plan.md` "Take/Drop", Phase 8 validate) names `SwapBridgeRouter.t.sol` and `UniswapFuelSwap.t.sol` but **omits `SwapBridgeRouterPermit2Fork.t.sol`** — the only test that exercises real Permit2 with a real signature against the canonical `0x000...78BA3` (I confirmed it exists and forks Permit2). That is the single most valuable test for the witness/typehash/nonce surface and the plan doesn't copy it.
- The non-fork `SwapBridgeRouter.t.sol` uses `nonce: 0, deadline: type(uint256).max` (line 595-596) — i.e. it never tests nonce reuse rejection or deadline expiry. So "decided here" has zero test coverage in the reference. The plan must ADD these tests, not inherit them.

**Fix:** Add `SwapBridgeRouterPermit2Fork.t.sol` to the Phase-8 TAKE list (adapted to drop `isPrivate`/attestation). Add two new fork tests the reference lacks: replaying the same `(owner, nonce)` reverts (`InvalidNonce`), and a signature past `deadline` reverts (`SignatureExpired`). Pin the short-deadline default (e.g. 30 min, matching the fork test's `block.timestamp + 30 minutes` at line 161) in the SDK's witness builder.

### H4 — The EIP-712 type-string reorder when dropping `isPrivate` is a silent-signature-rejection landmine, and the plan ships private fuel (so `isPrivate` may need to STAY). (Phase 8, Phase 9)

The reference typehash (`[holonym] SwapBridgeRouter.sol:88`, confirmed identical in the fork test:56) ends `...bytes32 routeHash,bool isPrivate)`. Permit2's witness grammar is `"<Witness> witness)<Witness>(...fields...)TokenPermissions(...)"`. Dropping `isPrivate` requires deleting it from BOTH the typehash AND the concatenated `*_TYPE_STRING` in the exact same position, AND the off-chain TS EIP-712 `types` object must match byte-for-byte or Permit2 computes a different digest and `permitWitnessTransferFrom` reverts with an opaque signature error (the plan's `research/holonym-l1-contracts.md:520` gotcha #3). The plan flags the hazard but then creates a contradiction with itself:

- Phase 8 drops `isPrivate` from the witness. Phase 9 (private fuel) sets `fuelRecipient = FPC` instead of user — but `research/holonym-l2-and-fee-juice.md:84,119-125` is explicit that **public vs private differs ONLY by `fuelRecipient`**, which is already a witness field. So dropping `isPrivate` is actually correct (it was Holonym-specific for the attestation branch). Fine. BUT the plan never states this reconciliation; Phase 9 reads as if it might re-add an `isPrivate`-like flag, and if an implementer adds one to the witness in Phase 9 after Phase 8 removed it, every Phase-6/8 signature breaks.

**Fix:** State the invariant once, loudly: the Nulo witness has NO `isPrivate`; public/private is encoded solely by `fuelRecipient` (user vs FPC address), which the UI must display at sign-time (the plan's phishing mitigation). Pin the exact typehash string + the TS `types` object in a shared constant imported by both the contract test and the SDK, and add a test asserting `keccak256(TYPE_STRING)` equals the on-chain `BRIDGE_WITNESS_TYPEHASH`. Forbid Phase 9 from touching the witness shape.

### H5 — FPC public-balance funding is hand-waved as a "runbook step"; the actual mechanism (a SECOND `depositToAztecPublic(_to=FPC)` + random-secret `FeeJuice.claim`) is buried in research and unscheduled. First private-fuel users will fail. (Phase 9)

`research/wonderland-aztec-fee-payment.md:245-253` is explicit: the FPC's INTERNAL balance (what `mint_and_pay_fee` credits the user) and its PUBLIC FJ balance (what the sequencer actually draws) are **separate**. The sequencer is paid from the public balance. For the very first private-fuel user, the FPC's public balance is whatever the operator seeded — and `research/...:483-490` (open Q2) plus `:492-496` (Q3) note the cold-start tension: each user's `FeeJuice.claim` credits the FPC's public balance by `amount`, and `mint_and_pay_fee` immediately spends `max_gas_cost` of it. If the operator seed is zero/too small, the *first* user's claim credits exactly `amount`, then the tx tries to pay `max_gas_cost` from the public balance — which works only if `amount >= max_gas_cost` (asserted) AND the public balance net of prior spends covers it. The plan's Phase 9 reduces all of this to "Operator runbook: bootstrap-seed the FPC's PUBLIC FJ balance" and the Ledger to "small conservative operator bootstrap; self-funds thereafter."

The mechanism to seed the public balance is itself a full bridge operation (a second `depositToAztecPublic(_to=FPC, randomSecret)` then an L2 `FeeJuice.claim`) — that is not a one-liner, it's a scripted flow that must run before Phase 9 e2e, and it consumes real testnet FJ (back to C3's scarcity). The plan schedules none of it.

**Fix:** Add an explicit Phase-9 sub-step (and a script in `bridge-evm`/`bridge-core`): "seed FPC public balance" = `depositToAztecPublic(FPC, seedAmount, randomSecretHash)` + `FeeJuice.claim(FPC, seedAmount, secret, leafIndex)`, run once at deploy. Document that this is distinct from per-user internal crediting. The Phase-9 negative test should also cover "public balance exhausted → sequencer payment fails" so the failure mode is understood, not discovered in prod.

### H6 — `deployments.test.ts` pins an invariant Phase 3 deliberately breaks; the plan says "regenerate deployments.json" but not "rewrite the committed test". (Phase 3)

The faucet ships `packages/faucet/src/contracts/deployments.test.ts:19-22`: `it("every token's minter equals the dripper address")`. Phase 3 redeploys L2 USDC/ETH with `minter = token_minter_proxy` — so the minter becomes the PROXY, not the Dripper, and this committed test will fail. The plan's Phase-3 validate says "faucet still drips through the proxy; CI `verify:deployments` green" but never mentions that the `deployments.test.ts` minter-equality assertion must be inverted (minter == proxy; proxy.is_minter(dripper) == true; proxy.is_minter(bridge) == true). An implementer following the plan literally hits a red CI on an unmentioned test and may "fix" it wrong.

**Fix:** Phase 3 explicitly: rewrite `deployments.test.ts` minter assertions to the proxy model; add `is_minter(dripper)` + `is_minter(bridge)` assertions against the proxy. Update `verify-deployments.ts` if it independently checks the minter slot.

---

## Medium

### M1 — "No bridge fee → hash gross amount" deletes one bug class but the Holonym reference hashes `amountAfterFee` everywhere; copying carries latent fee plumbing. (Phase 2)

Confirmed: `[holonym] TokenPortal.sol:164-176,189-200,215` computes `fee = calculateFee(_amount); amountAfterFee = _amount - fee` and hashes `amountAfterFee` in all three of public/private/withdraw, and emits `amountAfterFee` in the event. The plan's Opus-5.1 decision (gross-amount hashing, no fee) is correct and genuinely deletes the post-fee `claimAmount` readback class (`research/holonym-l2-and-fee-juice.md:466`). The risk is mechanical: when rewriting the portal, every `amountAfterFee` reference, the `fee`/`feeRecipient`/`collectedFees` state, `calculateFee`, `withdrawFees`, and the event's `fee` field must ALL go, and the SDK's `getPostFeeClaimAmount` (`research/holonym-flows-status-recovery.md:436`) must be dropped — but the FEE-JUICE side still has a post-fee subtlety (`research/holonym-l2-and-fee-juice.md:253-260`): Holonym's FJ amount varies because it's a *swap output*. With Nulo's direct (Phase 6) FJ deposit there's no swap and `claimAmount == requested`, but in Phase 8 (swap path) the FJ `fuelReceived` IS variable and MUST be read from the event for the `PrivateMintAndPayFeePaymentMethod`'s `amount` (nullifier-bound, `research/wonderland-aztec-fee-payment.md:511-516`). So "no fee → gross everywhere" is true for the TOKEN side but the FJ side still needs event-amount readback in Phase 8/9. The plan conflates them.

**Fix:** Document the split: token content-hash uses gross amount (no fee); FJ `claimAmount`/`amount` is always read from the `DepositToAztecPublic` event because the swap output is variable. Carry this into the Phase-8 SDK.

### M2 — `rollupVersion` baked at `initialize` is a documented gotcha but the plan has no detection for a mid-flight rollup-version bump stranding in-flight messages. (Phase 2)

`research/holonym-l1-contracts.md:518` and `plan.md` Phase 2 "Risk" both note `rollupVersion` is frozen at `initialize`. The plan says "pin/document". But on a testnet that bumps rollup versions (Aztec testnets reset/upgrade frequently), a portal initialized against the old version becomes unusable AND any in-flight L1→L2 message addressed to `L2Actor(l2Bridge, oldVersion)` can never be consumed after the bump. The plan's localStorage recovery (Phase 6/7) will loop forever on `getL1ToL2MessageCheckpoint` for a message that's permanently dead. No detection, no user-facing "this deposit is stranded by a network upgrade" state.

**Fix:** Phase 6 status poller should compare the portal's stored `rollupVersion` against the live `getNodeInfo().rollupVersion` on each poll; if they diverge, surface a terminal "network upgraded — this in-flight deposit cannot complete; sweep available" state instead of polling forever.

### M3 — COOP/COEP + poseidon2-in-browser is presented as an open risk across research, Phase 4, and Security — but the live faucet already runs at 4.2.0 under exactly these headers. Overstated. (Phase 4)

`plan.md` Phase 4, Security §, and `research/...wonderland:498-503` / `research/holonym-flows-status-recovery.md:479-484` all hedge on whether `poseidon2`/`computeSecretHash` works in-browser under COOP/COEP. I verified: the faucet already sets `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` in BOTH `packages/faucet/vite.config.ts:6-8` AND `packages/faucet/public/_headers:2-3`, runs a full in-browser PXE at 4.2.0, and the sibling extension calls `poseidon2Hash` from `@aztec/foundation/crypto/poseidon` directly (`packages/extension/src/wallet/services/account/service.ts:2,191`). Holonym proxied poseidon2 to a server ONLY because Next.js SSR + their CSP; that constraint does not transfer to Nulo's already-isolated static app. This is a near-zero risk dressed as a real one — it inflates Phase 4's perceived difficulty.

**Fix:** Downgrade. State that COOP/COEP is already in place (cite the faucet `_headers`) and poseidon2-in-browser is proven by the extension; the only real work is choosing sync (`@aztec/foundation/crypto/sync`) vs worker. Drop the "validate under COOP/COEP" caveats from Phase 4 / crypto.ts / Security.

### M4 — CSP `connect-src` currently allows only `*.aztec.network`; adding an L1 RPC is mandatory and the plan under-specifies it. (Phase 5)

I verified the faucet CSP (`packages/faucet/public/_headers:4`): `connect-src 'self' data: blob: https://*.aztec.network wss://*.aztec.network`. There is NO L1/Ethereum RPC origin. The bridge MUST add one (Sepolia RPC + the V4 quoter calls go through it). The plan's Phase 5 says "CSP `connect-src` += L1 RPC origin (do NOT loosen `script-src`)" — correct intent, but: (a) which RPC? A public Sepolia RPC origin must be pinned (not a wildcard `https:` — that defeats the CSP); (b) MetaMask/injected wallets do their own RPC, but `@aztec/viem` `readContract`/quoter calls from the page need the origin allowlisted; (c) the plan's threat model leans HARD on "tight CSP prevents XSS secret exfiltration" (Security §1) — adding even one RPC origin to `connect-src` is a small exfil channel (an XSS could POST secrets there as a fake RPC call). The plan asserts the CSP is the backstop without noting that `connect-src` necessarily widens.

**Fix:** Pin the exact Sepolia RPC origin in `connect-src` (e.g. a specific provider host), never `https:`. Acknowledge in the threat model that the L1 RPC origin is now a (narrow) exfil surface and that the AES-GCM encryption of secrets is what actually protects them if XSS lands — the CSP narrows, it doesn't eliminate.

### M5 — `UniswapFuelSwap.sweep` is NOT `nonReentrant` while the router's sweep IS; copied verbatim, this asymmetry ships. (Phase 8)

The router's `sweep` is `onlyOwner nonReentrant` (`[holonym] SwapBridgeRouter.sol:378`) but `UniswapFuelSwap.sweep` is `onlyOwner` only (`UniswapFuelSwap.sol:266` — no `nonReentrant`). The plan says "copy `UniswapFuelSwap` verbatim". The swap adapter holds zero between calls and sweep is owner-only, so impact is low — but a native-ETH sweep via `call{value:}` to an owner-controlled contract that re-enters during an active (buggy) unlock could matter, and "verbatim copy" propagates the inconsistency silently.

**Fix:** Add `nonReentrant` to `UniswapFuelSwap.sweep` for symmetry (cheap, defense-in-depth). Note the deviation from verbatim in the file header.

### M6 — Recovery AES-GCM/PBKDF2 is called "greenfield" implicitly, but the extension already ships a battle-tested PBKDF2+AES-GCM key model that the plan ignores. (Phase 4)

`research/holonym-flows-status-recovery.md:393-396` and `plan.md` Phase 4 describe deriving an AES key from a wallet signature via PBKDF2. The extension already has a hardened PBKDF2+AES-GCM implementation for profile/session secrets (`packages/extension/src/wallet/services/profile/service.ts:138,976`, `session-manager.ts:357-358`). The plan plans to write this fresh in `bridge-core/recovery.ts` rather than extracting/reusing. Per the user's own CLAUDE.md ("Modularize relentlessly. Same code in 3 places is a refactor signal" + "battle-tested libraries only — never roll your own [crypto]"), re-implementing AES-GCM key derivation in a fourth place is exactly the smell the rules forbid.

**Fix:** Either extract the extension's KDF/AES helper into a shared package (`wallet-crypto` already exists per CLAUDE.md's layer list) and consume it from `bridge-core`, or at minimum mirror its parameters (iteration count, salt construction) verbatim and cite it. Don't hand-roll a parallel implementation.

---

## Low

### L1 — Two-hop swap defaults to `currency0 < currency1` ordering, but the plan never pins the ordering-invariant test; a mis-sorted PoolKey reverts silently in `PoolManager`. (Phase 8)
`research/uniswap-v4-sepolia.md:106,473` notes `currency0 < currency1` is mandatory. Add a TS unit test on the route-builder asserting sort order for all candidate routes. Cheap insurance.

### L2 — `registerPrivateContract` salt choice (Holonym uses `Fr.ZERO`) is "open" in research but the plan picks nothing. (Phase 9)
`research/wonderland-aztec-fee-payment.md:399,478-481`. The plan's Phase 9 says "registerPrivateContract(wallet, salt)" with `salt` unbound. Pick it explicitly (a non-zero domain-separated salt is marginally better than `Fr.ZERO` to avoid collision with any other `Fr.ZERO`-salted FPC), compute + commit the address, and PIN it in the startup-assertion (the plan's drift guard is good).

### L3 — `token_minter_proxy.owner = PublicImmutable` (non-transferable) is decided for v1 but the operator-rotation footgun isn't surfaced to the user. (Phase 3)
`research/holonym-l2-and-fee-juice.md:408,488`. If the single operator key is lost, the minter allow-list is frozen forever (can't add a replacement bridge/dripper). Acceptable for testnet PoC, but it's a one-way door — note it in the runbook.

### L4 — The brute-force 0–63 leaf-index fallback assumes the Inbox tree depth/`messageLeafIndex` range is ≤63 at 4.2.0; unverified. (Phase 4, Phase 6)
`research/holonym-flows-status-recovery.md:91-95` and `plan.md` Phase 4/6 inherit Holonym's `0..63` brute force. The Inbox subtree size is a protocol constant; if 4.2.0 changed `L1_TO_L2_MSG_SUBTREE_HEIGHT` the range is wrong and the fallback silently misses the real index. Add a Phase-1 assertion reading the constant from `@aztec/constants` (or the live Inbox) rather than hardcoding 64.

### L5 — Faucet→bridge-frontend rename touches 4 CI workflows + e2e config + root scripts; the plan lists the workflow rename but not the e2e config path. (Phase 5, Phase 10)
Confirmed surface: `_build-faucet.yml`, `pr-smoke-e2e.yml`, `pr-network-e2e.yml`, `_smoke-e2e.yml`, `_network-e2e.yml`, plus `packages/faucet/vitest.e2e.config.ts` and `tests/e2e/faucet-smoke.test.ts`. The plan names `_build-faucet.yml` rename; enumerate the rest so the rename PR doesn't leave a dangling `@nulo/faucet` reference in a paths-filter or e2e config.

---

## Assumption attack (Facts / Inferences / Asks)

### Facts — misstated or overstated

- **"Withdraw is epoch-based" (stated as Fact across Phase 2/4/7 + 2 research docs).** Contradicted by the reference contract Nulo copies, which passes `uint256 _l2BlockNumber` to `outbox.consume` (`[holonym] TokenPortal.sol:234,253`). Either the contract or the "epoch" claim is wrong; it is NOT an established fact. → C1.
- **"The repo viem is a different package so dedupe can't merge it with wagmi" (Ledger, stated as resolved Fact).** Inverted. The lockfile aliases `viem` → `@aztec/viem@2.38.2` (`bun.lock:2446`); wagmi WILL dedupe to a single (forked) viem. The real risk is fork-vs-wagmi compatibility, which is unverified. → C2.
- **"FeeAssetHandler.mint() is proven working / Option A recommended" (research, stated as Fact).** Overstated. `mint(address)` is permissionless but delegates to an `onlyMinter` fee asset; it works ONLY if the protocol wired the handler as a minter with non-zero `mintAmount` on the target net — a property Nulo can't set. The "live faucet implies yes" inference is a non-sequitur (faucet never touches L1 FeeJuice/handler). → C3.
- **"poseidon2-in-browser under COOP/COEP is an open risk" (research + Phase 4 + Security).** Overstated to the point of being false-for-Nulo. The faucet already runs COOP/COEP at 4.2.0 (`vite.config.ts:6-8`, `_headers:2-3`) and the extension calls `poseidon2Hash` in-browser today. → M3.
- **"`MintableERC20` ... (faithful copy)" framing.** Not in the reference at all — invented. Presented under "Take from Holonym" framing by adjacency; it is net-new code. → H1.

### Inferences — unsafe

- **"Seeding our own thin V4 pools with the REAL FeeJuice underlying suffices for a working swap path" (plan Inference #1).** Unsafe twice over: (a) presupposes Nulo can obtain real FeeJuice (C3); (b) thin attacker-manipulable pools + free-mint USDC mean the swap output is adversarially controllable within the `minFuelOutput` band, and a hooked-pool route passes `_validateRoute` (H2). "Slippage bounded by minFuelOutput" is true but the floor can still be a bad price an attacker pushed.
- **"`@wagmi/vue` + `@aztec/aztec.js` viem versions can be deduped without runtime breakage" (plan Inference #2).** The dedupe succeeds trivially (alias); the unsafe leap is that the FORK behaves like upstream viem for wagmi's internals. Untested. → C2.
- **"The clean portal + canonical content-hash lib will interop with a freshly-deployed `token_bridge` without the attestation params (no hidden coupling)" (plan Inference #3).** Mostly sound for the content-hash (both use the canonical lib), but the WITHDRAW path coupling (`exit_to_l1` content hash + the `epoch`/`block` arg to `outbox.consume`) is NOT covered by the Phase-1 keystone, which only tests `mint_to_public/private`. The withdraw interop is assumed, not gated. → C1.
- **"FPC self-funds from user deposits after a small bootstrap" (Ledger).** Unsafe for the FIRST user and under burst load: public balance can be drawn to zero mid-flight; no monitoring planned. → H5.

### Asks — unsurfaced, should go back to the user

- **Ask-1 (viem stack).** The user's Decision #1 was "viem + `@wagmi/core` vanilla (no React)". If `@aztec/viem` (a fork) breaks `@wagmi/core`, the real fallback is hand-rolling ~5 viem calls with no wagmi at all. The user should be told: "wagmi may not survive the forked viem; acceptable to drop wagmi and call `@aztec/viem` directly?" The plan silently assumes wagmi-or-vanilla-wagmi without flagging "no-wagmi" as the likely outcome.
- **Ask-2 (swap contingency).** The headline "USDC→AZTEC in 1 tx" demo is contingent on the target testnet's `FeeAssetHandler` minter wiring, outside Nulo's control. The user should explicitly accept: "v1 may ship public-fuel-only (no swap) if FeeJuice can't be minted on the live net." The plan's "Swap stays in v1" + the Ledger's self-flagged "user should sanity-check this sequencing" gesture at this but don't name the external blocker. → C3.
- **Ask-3 (infinite-mint griefing of the bridge L2 supply).** "Defaults" #4 accepts "infinite-mint-by-design" for the L1 token. But via the shared minter proxy, a free-minted L1 USDC bridged to L2 mints the SAME L2 asset the faucet hands out. An attacker can inflate the L2 token's total supply arbitrarily and pollute every faucet user's balance view / any L2 contract that reads `total_supply`. On testnet that may be fine — but it's a different blast radius than "free L1 test tokens", and the user should sign off that L2-supply pollution is acceptable.
- **Ask-4 (owner = single EOA, immutable proxy owner, no timelock).** The plan defers timelock "for any mainnet path" but the `sweep`/`setSwapTarget`/`PublicImmutable` owner concentrate full control in one testnet operator key with a one-way door (L3). If there's ANY chance this surface gets promoted toward mainnet, the user should decide the owner model now, not later.

---

## Contradictions & blind spots

- **Withdraw epoch vs block (C1)** — the sharpest internal contradiction: 3 research docs + the contract disagree on the single most fund-critical L2→L1 parameter, and the Phase-1 keystone doesn't cover it.
- **viem dedupe rationale (C2)** — the Ledger's "contradiction resolved" entry resolves it backwards; the gate it produces (`bun why viem`) tests a tautology.
- **Is deferring the swap to Phase 8 safe? Mostly yes, but it hides C3.** Splitting DIRECT fuel (Phase 6) from the swap (Phase 8) is genuinely good risk isolation — the bridge demonstrably works without the swap, and the two HIGH risks (content-hash vs Uniswap) don't compound. BUT the deferral also defers discovery of the FeeJuice-minting blocker (C3) to Phase 8, by which point P1-P7 are built. The recon (Phase 1) is supposed to front-load plan-invalidating unknowns — yet the FeeAssetHandler-minter check is the ONE recon item that can invalidate the headline feature, and it's framed as a soft checkbox, not a stop-the-line gate equal to the "net ≠ 4.2.0" gate. **Move the live `FeeAssetHandler.mint` smoke into the Phase-1 hard gate.** Otherwise the recon-first ordering has a hole exactly where it matters most.
- **Is recon-first ordering right? Yes** — front-loading the content-hash keystone and the 4.2.0 check is correct given TXE can't test claim paths. The only fix is widening Phase-1 to cover withdraw-hash + FeeAssetHandler + Inbox subtree constant (L4) + the wagmi-fork smoke.
- **Rejected alternative that should have been kept: vanilla canonical `TokenPortal.sol`.** `research/holonym-l2-and-fee-juice.md:487` (open Q4) explicitly asks "with attestation + fee dropped, is there any reason Nulo's portal isn't just the upstream canonical `TokenPortal.sol`?" — and answers "likely yes". The plan instead writes a custom `NuloTokenPortal.sol`. If the canonical 4.2.0 `TokenPortal.sol` already has gross-amount hashing + the correct `outbox.consume` arg (resolving C1 for free), copying it verbatim is strictly safer than a hand-stripped custom portal. The plan dismissed this without recording why. **Re-open it in Phase 2:** diff the canonical 4.2.0 `TokenPortal.sol` against the desired clean spec before writing custom Solidity.
- **Blind spot: capability-manifest drift.** Phase 9 adds `mint`/`mint_and_pay_fee`/`pay_fee`/`balance_of` to "the capability manifest" — but this is the FAUCET/BRIDGE app, a dApp, not the wallet extension. The FPC capability manifest lives wallet-side (the user's Nulo extension must allow these FPC calls). The plan conflates the bridge app's needs with the wallet's allowlist; if a bridge user's wallet doesn't manifest these, private fuel fails at the wallet boundary, not the bridge. Clarify which side owns the manifest.
- **Blind spot: the seed-script USDC mint exceeds the public cap.** H1 — the 5000-USDC pool seed (`research/uniswap-v4-sepolia.md:307`) can't go through the 1000/tx public-mint cap; the plan never reconciles the cap with seeding needs.
- **Consolidation glossed: the `amountAfterFee` deletion is clean for the token side but the FJ side still needs event readback in Phase 8 (M1).** The Ledger's "deletes the `amountAfterFee` mismatch class" is true for tokens, false for swapped FJ.
- **Sequencing risk: Phase 9 depends on Phase 8 (swap), but private fuel doesn't NEED the swap.** Private fuel via `PrivateMintAndPayFeePaymentMethod` works with DIRECT FeeJuice deposit (`fuelRecipient = FPC`) exactly like public fuel works with direct deposit in Phase 6. Chaining Phase 9 behind Phase 8 means a swap-integration failure (the riskiest external coupling) blocks private fuel unnecessarily. **Consider: private-fuel-direct as a Phase 6.5 (mirrors Phase 6 public-direct), swap as the final Phase 8/9.** This isolates the FPC/secret-derivation risk (the bug-prone part) from the Uniswap risk, matching the plan's own stated philosophy ("isolate the two HIGH risks").
