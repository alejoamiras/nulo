# Faucet-Bridge — asset re-scope (faucet test tokens ≠ bridge real assets)

## Why (the security invariant)
Today the faucet and the bridge both center on "USDC", but they're separate deployments. The decision: make the separation **explicit and unfakeable**.

- **Faucet** mints **NULO** + **OLUN** — L2-only test tokens, freely drippable, with **no L1 backing**. They are NOT bridgeable.
- **Bridge** moves **real Sepolia USDC** (`0x1c7d4b196cb0c7b01d743fbc6116a902379c7238`, symbol `USDC`, **6 decimals**) and (later) **ETH**. The L2 side is a bridge-minted representation, **mintable only by the bridge on a real L1 deposit** (via the minter-proxy).

**The invariant:** there is no token that is both (a) freely obtainable from the faucet AND (b) withdrawable to a real L1 asset. So nobody can drip a pile on L2 and withdraw it to drain the bridge's L1 reserve (other users' deposits). The faucet drips NULO/OLUN; the bridge's L2 USDC only exists against L1 USDC actually deposited.

## Token facts (verified on Sepolia)
- Bridge L1 USDC `0x1c7d…`: name `USDC`, symbol `USDC`, **decimals 6**. The deposit must use 6-decimal amounts. It is NOT minted by the bridge flow — the user brings USDC (Circle's Sepolia faucet at faucet.circle.com, or our own mint if we control it — done OUTSIDE the public faucet so the invariant holds).
- Faucet NULO/OLUN: new L2 `Token` (aztec-standards) deployments; the existing USDC/ETH faucet tokens are replaced.

## Phases
- **R1 — Faucet → NULO + OLUN.** Deploy two L2 `Token`s (NULO, OLUN) + (re)wire the Dripper to mint them. Update `packages/faucet/src/contracts/deployments.ts` (NULO/OLUN/Dripper), the combined manifest (`capabilities.ts`: contracts + drip/balance scopes), the faucet UI token cards, and "Add to wallet" to register NULO/OLUN. The faucet flow is otherwise unchanged.
- **R2 — Bridge → real USDC (`0x1c7d…`).** Re-deploy `TokenPortal` with its L1 token = `0x1c7d…` (NOT a fresh MintableERC20) + the L2 representation (proxy/token/bridge, name "USDC", 6dp). **Drop the mint step from the deposit** (`useDeposit`): approve → deposit → sync-gate → claim; the user supplies USDC. Rewrite `public/testnet-bridge.json`, `bridge-deployments.ts`, the combined manifest, and the deposit UI copy (no mint; "bring USDC"). Withdraw is unchanged in shape. **Per codex, R2 specifically must:**
  - **Delete every mint path** — the deploy script's fresh `MintableERC20` (+ its config entry), `useDeposit`'s mint ABI + call, and `bridge-core/flows.ts`'s `mint` before deposit. Leaving any reintroduces a freely-sourceable bridge asset or breaks on real USDC.
  - **Hard-check** the configured L1 token === `0x1c7d…` AND `decimals() == 6` at deploy/load time (fail loud if not).
  - **`parseUnits(value, 6)`** for deposit/withdraw amounts (the current `Number(value)*1e6` + `Math.round` silently rounds/loses precision — unacceptable for a real asset). Reject excess precision rather than round.
  - **Add a deployment-invariant test**: faucet token ≠ bridge token; bridged token's minter === `BRIDGE_PROXY`; proxy authorizes ONLY `BRIDGE`.
- **R3 — Footer + token links.** Wire the explorer links (`Footer.vue`, gated on `VITE_EXPLORER_BASE_URL`) back on for the faucet contracts, and add a Bridge-tab contracts footer (L1 USDC/portal + L2 proxy/token/bridge), each linking to the right explorer (Sepolia Etherscan for L1, the Aztec explorer for L2).
- **R4 — Bridge ETH (later).** Add ETH as a second bridgeable asset. Leading approach: **WETH** (wrap ETH→WETH on L1, bridge as a second ERC20 with its own portal + L2 representation; UI auto-wraps on deposit / unwraps on withdraw). Decision pending; deferred until R1–R3 are proven.
- **R5 — Swap (later).** The deferred Uniswap-V4 fuel swap, which now has a real USDC to swap (still needs a seeded V4 pool for it).

## Decisions to confirm
1. **ETH mechanism + timing** — WETH (recommended) vs Fee-Juice vs later. Plan assumes "later" (R4).
2. **Deposit has no mint** — the user brings Sepolia USDC. (If we control `0x1c7d…` and want a dev-only "mint test USDC" affordance, it stays OFF the public faucet to preserve the invariant.)
3. **L2 representation naming** — call the bridged L2 token "USDC" (matches L1) vs "Nulo USDC". Plan assumes "USDC".
4. **NULO/OLUN decimals** — 18 (standard) unless you want them to mirror something.

## Security & adversarial considerations
- **Asset-separation invariant (the headline):** verify the faucet Dripper can mint ONLY NULO/OLUN, and the bridge's L2 USDC minter is ONLY the bridge (via the proxy) — never the Dripper. A single mis-wire (Dripper able to mint the bridged token) reopens the drain.
- **Real-USDC integration:** 6 decimals (amount math), approval handling (USDC's approve is standard; no fee-on-transfer), and that the portal holds the real reserve. Reorg/replay on the L1 deposit + L2 claim (already handled by the sync-gate + leaf-index-from-event).
- **No free L1 value:** the bridge never mints the L1 USDC in-flow; the L2 representation is 1:1 against deposited L1 USDC.
- **Footer links:** external URLs only (explorer); no injection surface.

## Codex review (session `019ea89c-2ac6-76a2-a176-35b2285de997`)
**Verdict: separation model sound + intact today.** Faucet tokens deploy with `minter = DRIPPER`; the bridged token deploys with `minter = BRIDGE_PROXY` — so the Dripper cannot mint the bridged (withdrawable) token. `approve → depositToAztecPublic` / portal `withdraw` work with real Sepolia USDC (no Permit2/hooks dependency). WETH is the right later ETH path (Fee-Juice is a gas asset, not user-transferable). Findings, folded above:
- **HIGH — kill all mint paths (R2).** Done above.
- **MEDIUM — amount precision (R2).** `parseUnits(value, 6)`. Done above.
- **MEDIUM — invariant test (R2).** Done above.
- **HIGH (production hardening, NOT testnet-blocking) — the proxy's minter admin is mutable.** `token_minter_proxy` lets the proxy OWNER (the deployer) authorize ANY minter forever, with no transfer/renounce path. A compromised deployer key → add a minter → mint bridged USDC → drain the L1 reserve. Acceptable on testnet (our key, small reserve), but **must be renounced/burned (or the proxy constructor-wired to `(token, bridge)` once) before any real value.** → see **R-hardening**.

## R-hardening (before any real value — not blocking the testnet re-scope)
Remove the proxy's mutable minter admin: either add a transfer/renounce to `token_minter_proxy` (Noir) and burn ownership after wiring `BRIDGE`, or constructor-wire the single minter and drop `set_minter`. Re-deploy + re-pin the invariant test.

## Out of scope (this re-scope)
The swap (R5) beyond noting it now has a real asset; any mainnet anything (testnet only).
