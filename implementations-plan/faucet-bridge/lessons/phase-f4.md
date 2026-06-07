# F4 — deposit flow (testnet) — IN PROGRESS

## Decisive finding: the faucet's testnet USDC is Dripper-minted, not proxy-shared
`deployments.json`: USDC + ETH use `constructor_with_minter` with `minter = 0x172684be…`, which **equals the Dripper address** (`dripper.address = 0x172684be…`). So the faucet's L2 USDC is minted **directly by the Dripper** — there is NO `token_minter_proxy` in front of it. The bridge therefore CANNOT mint the faucet's exact USDC (the Dripper is the sole minter; the bridge isn't authorized).

The `token_minter_proxy` (whose stated purpose is "Dripper AND bridge mint the same token") was used in the sandbox deploy + `deposit-testnet.ts`, but the live faucet testnet deploy did not put USDC behind it.

## Decision (A): the bridge deploys its OWN persistent testnet set
- "Bridged L1 asset = same L2 asset" means L1 USDC → L2 USDC **1:1, not wrapped** — which the bridge's OWN USDC satisfies. It does NOT require sharing the faucet's separate drip-USDC instance.
- So: the bridge deploys its own persistent set — **L1**: MintableERC20 USDC + canonical TokenPortal (Sepolia); **L2**: token_minter_proxy + Token(minter=proxy) + token_bridge(proxy, portal). Non-disruptive (the faucet's drip-USDC + Dripper untouched).
- Trade-off: the Bridge tab's USDC ≠ the Faucet tab's drip-USDC (two instances on testnet). Acceptable for testnet.
- **Rejected (B): redeploy the faucet's USDC behind a shared proxy** (Dripper + bridge both mint it) — truly one shared token, but disruptive (changes the faucet's USDC address + config, breaks held balances). Not worth it on testnet unless the user wants unified balances.

## F4 plan
1. `scripts/deploy-bridge-testnet.ts` — persistent deploy (FIXED salts → deterministic addresses) + write `public/testnet-bridge.json` (L1 addresses + L2 {address, salt, constructorArgs, constructorArtifact} for instance-rebuild).
2. `src/contracts/bridge-deployments.ts` — rebuild the L2 instances from the config (mirrors `deployments.ts`).
3. `useBridgeWallet` — `createAztecWalletSession` + `buildBridgeManifest` + `registerBridgeContracts` (the rebuilt instances).
4. Deposit flow — L1 (`useL1Wallet`: mint/approve/depositToAztecPublic) → L2 (`useBridgeWallet`: poll claim_public) via bridge-core, boundary at primitives. Block-countdown bar (`status.ts`). Recovery (persisted secret).
5. Playwright-MCP drive vs testnet.

Next: build + run the persistent deploy (~8 min + gas on the funded `0xFcc2…` key).
