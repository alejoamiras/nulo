# plan.md — any-erc20-bridge (Fable draft)

## 1. Summary

Replace the single-token `NuloTokenPortal` + `token_bridge` + `token_minter_proxy` trio with an L1 `PortalFactory` (OZ immutable-args clones, one shared `TokenPortalImpl`, one `Ownable2Step` guardian with two pause bits) and ONE ownerless L2 `TokenBridgeHub` that deploys per-token aztec-standards `Token` instances itself after consuming an L1-attested `register` message. The router binds `tokenPortal` to `factory.portalFor(bridgeToken)` (A-1 closed) and gains a swap-in-place "gas only" path. bridge-core grows a generation manifest, `predictPortal`, `deriveHubToken`, a 4th content hash, per-token journal binding, route discovery with a first-class `no-route`, and a runtime token list; the faucet gets the 3-step wizard. Two deliberate deviations from the brief are argued in §5: (i) the `register` message is sent BY THE FACTORY and carries the portal address, which removes keccak/CREATE2 from Noir and one whole toolchain from the address keystone; (ii) the genesis cycle is broken by CREATE-nonce prediction of the factory address instead of `bind_l1`. Sequenced: TXE in-contract-deploy spike and the keystones first, then L1 → L2 → bridge-core → wizard → docs/testnet.

**Tier rubric** (1–5): novelty 5 (in-contract deploy unproven in TXE; first factory/clone code in the repo) · blast radius 5 (every bridge surface, both toolchains, both conductors) · irreversibility 4 (immutable L1/L2 contracts; testnet-only deploy in scope) · migration 3 (legacy retired, no prod sealed records; mainnet legacy-exit hole, §5) · external coupling 4 (Uniswap list origin, V4 pools, aztec-standards class id, Multicall3) · security 5. → `mega-deep`, `/code-review medium` per arc as budgeted.

## 2. Architecture & Implementation

### 2.1 L1

**`TokenPortalImpl`** (`contracts/bridge/evm/src/TokenPortalImpl.sol`, compiled in-project like `upstream/NuloTokenPortal.sol` is today via the `@aztec/` remap — `foundry.toml:19-24`):

```solidity
contract TokenPortalImpl {
  IInbox  public immutable INBOX; IOutbox public immutable OUTBOX; uint256 public immutable ROLLUP_VERSION;
  bytes32 public immutable L2_HUB; IPortalFactory public immutable FACTORY;
  constructor(IRegistry registry, bytes32 l2Hub, IPortalFactory factory);   // derives rollup→inbox/outbox/version like NuloTokenPortal.sol:78-81
  function underlying() public view returns (IERC20) { return IERC20(address(bytes20(Clones.fetchCloneArgs(address(this))))); }
  function depositToAztecPublic(bytes32 _to, uint256 _amount, bytes32 _secretHash) external returns (bytes32, uint256);
  function depositToAztecPrivate(uint256 _amount, bytes32 _secretHashForL2MessageConsumption) external returns (bytes32, uint256);
  function withdraw(address _recipient, uint256 _amount, bool _withCaller, Epoch _epoch, uint256 _numCheckpointsInEpoch, uint256 _leafIndex, bytes32[] calldata _path) external;
}
```
Bodies are `NuloTokenPortal.sol:93-186` with `l2Bridge→L2_HUB`, `rollupVersion→ROLLUP_VERSION`, `inbox/outbox→INBOX/OUTBOX`, `underlying→underlying()`; the three `abi.encodeWithSignature` preimages (`:104`, `:136`, `:176-180`) are untouched, which is the actual invariant (`ContentHash.t.sol`, `PortalRoundtripFuzz.t.sol` pass with zero vector edits). Two additions at the top of each body: `if (FACTORY.depositsPaused()) revert Paused();` / `withdrawsPaused()` in `withdraw`, and a balance-delta check on deposit (`§4`, Ask A3). Zero storage; no `initialize`; the clone's runtime code is 65 bytes.

**`PortalFactory`** (`src/PortalFactory.sol`, `is Ownable2Step`):

```solidity
event PortalCreated(address indexed token, address indexed portal, bytes32 name, bytes32 symbol, uint8 decimals);
event PausedChanged(bool deposits, bool withdraws);
TokenPortalImpl public immutable IMPLEMENTATION;  IInbox immutable INBOX; bytes32 immutable L2_HUB; uint256 immutable ROLLUP_VERSION;
bool public depositsPaused; bool public withdrawsPaused;            // the ONLY storage
bytes32 constant REGISTER_SECRET_HASH = <compute_secret_hash([0]) — keystone-pinned>;
constructor(IRegistry registry, bytes32 l2Hub, address guardian);    // deploys IMPLEMENTATION with address(this)
function salt(address erc20) public pure returns (bytes32) { return keccak256(abi.encodePacked(erc20)); }
function portalFor(address erc20) public view returns (address);    // Clones.predictDeterministicAddressWithImmutableArgs(IMPLEMENTATION, abi.encodePacked(erc20), salt(erc20))
function hasPortal(address erc20) public view returns (bool);       // portalFor(erc20).code.length != 0
function createPortal(address erc20) public returns (address portal); // idempotent: returns existing
function createPortalAndDepositPublic(address erc20, bytes32 to, uint256 amount, bytes32 secretHash) external returns (bytes32,uint256);
function createPortalAndDepositPrivate(address erc20, uint256 amount, bytes32 secretHash) external returns (bytes32,uint256);
function setPaused(bool deposits, bool withdraws) external onlyOwner; // see §4 for the withdraw-expiry variant (Ask A2)
```
`createPortal`: `staticcall` `name()/symbol()/decimals()` with raw-returndata decoding (32-byte return ⇒ `bytes32` MKR-style; ≥64 ⇒ `string`; missing `decimals` ⇒ `revert NotAnErc20()`; missing name/symbol ⇒ empty), sanitize to 31 printable-ASCII bytes (`_ascii31`), `Clones.cloneDeterministicWithImmutableArgs(IMPLEMENTATION, abi.encodePacked(erc20), salt(erc20))`, then `INBOX.sendL2Message(L2Actor(L2_HUB, ROLLUP_VERSION), Hash.sha256ToField(abi.encodeWithSignature("register(address,address,bytes32,bytes32,uint8)", erc20, portal, name32, symbol32, decimals)), REGISTER_SECRET_HASH)`. The FACTORY is the L1 sender (§5 deviation D1). `createPortalAndDeposit*` = `createPortal` if absent, then forward the deposit to the portal — but the router is the only UI entry, so these are called by the router (below), not by users directly.

**Router** (`SwapBridgeRouter.sol`), constructor gains `IPortalFactory _factory`; `bridge`/`bridgeWithFuel` replace `:158`/`:246` with:

```solidity
function _checkPortal(address tokenPortal, address bridgeToken, bool isPrivate) internal view {
  if (bridgeToken == address(feeJuicePortal.UNDERLYING()) && tokenPortal == address(feeJuicePortal)) { require(!isPrivate, "SwapBridgeRouter: fee asset has no private deposit"); return; }
  require(tokenPortal == factory.portalFor(bridgeToken), "SwapBridgeRouter: foreign portal");
}
```
plus `require(totalAmount <= type(uint128).max)` (the L2 amount is `u128`; a larger deposit is unclaimable forever). `bridgeWithFuel`: `:155` becomes `0 < fuelAmount <= totalAmount`; when `fuelAmount == totalAmount` the token leg (`:217-227`) is skipped, `tokenKey/tokenIndex/bridgeAmount = 0`, and `tokenPortal` must be `address(0)` (nothing to bind; keeps the signed witness explicit). When `bridgeToken == FJ underlying`, `path.length == 0` is required and `fuelReceived = fuelAmount` (identity swap) — this is what makes the AZTEC "TOKEN + gas" card a single tx. Portal creation is folded in: if `bridgeAmount > 0 && !factory.hasPortal(bridgeToken)` the router calls `factory.createPortal(bridgeToken)` before the deposit (permissionless, idempotent, so front-running is harmless). The 12-field witness (`:52-56`) is unchanged; `l1.ts:11-14` and `WitnessHash.t.sol` stay green.

### 2.2 L2 — `TokenBridgeHub` (`contracts/bridge/aztec/token_bridge_hub/src/main.nr`)

```noir
#[storage] struct Storage<Context> {
  l1_factory:      PublicImmutable<EthAddress, Context>,
  token_class_id:  PublicImmutable<ContractClassId, Context>,
  portal_of:       Map<AztecAddress, PublicImmutable<EthAddress, Context>, Context>,   // l2 token → its L1 portal
  token_of:        Map<EthAddress,   PublicImmutable<AztecAddress, Context>, Context>, // erc20 → l2 token (discovery)
}
global REGISTER_SECRET: Field = 0;

#[external("public")] #[initializer] fn constructor(token_class_id: ContractClassId, l1_factory: EthAddress)
#[external("private")] fn register_token(erc20: EthAddress, portal: EthAddress, name: str<31>, symbol: str<31>, decimals: u8, message_leaf_index: Field)
#[external("public")] #[only_self] fn _register(erc20: EthAddress, portal: EthAddress, token: AztecAddress, name: Field, symbol: Field, decimals: u8, message_leaf_index: Field)
#[external("public")]  fn claim_public(token: AztecAddress, to: AztecAddress, amount: u128, secret: Field, message_leaf_index: Field)
#[external("private")] fn claim_private(token: AztecAddress, recipient: AztecAddress, amount: u128, claim_salt: Field, message_leaf_index: Field)
#[external("public")]  fn exit_to_l1_public(token: AztecAddress, recipient: EthAddress, amount: u128, caller_on_l1: EthAddress, authwit_nonce: Field)
#[external("private")] fn exit_to_l1_private(token: AztecAddress, recipient: EthAddress, amount: u128, caller_on_l1: EthAddress, authwit_nonce: Field)
#[external("public")] #[view] fn portal_of(token) -> EthAddress;  fn token_of(erc20) -> AztecAddress;  fn derive_token_public(erc20, name, symbol, decimals) -> AztecAddress
```
`register_token` (private): `token = ContractInstance{ salt: erc20.to_field(), deployer: self.address, original_contract_class_id: token_class_id.read(), initialization_hash: compute_initialization_hash(Token::interface().constructor_with_minter(name, symbol, decimals, self.address, ZERO).selector, hash_args(args)), immutables_hash: 0, public_keys: PublicKeys::default() }.to_address()`; `publish_contract_instance_for_public_execution(&mut self.context, token)` (v5.0.1 `publish_contract_instance.nr:13-19`, asserts `deployer == this`); `self.enqueue_self._register(...)`; `self.enqueue(Token::at(token).constructor_with_minter(...))` (initializer guard `initialization_utils.nr:152-163` passes: `deployer == msg_sender == hub`). `_register` (public): `consume_l1_to_l2_message(get_register_content_hash(erc20, portal, name, symbol, decimals), [REGISTER_SECRET], l1_factory.read(), leaf)`, then `portal_of.at(token).initialize(portal)`, `token_of.at(erc20).initialize(token)`. Both `PublicImmutable::initialize` calls and the publish nullifier make a second registration revert. Claim/exit bodies are `token_bridge/src/main.nr:94-158` with `config.portal → portal_of.at(token).read()`, `TokenMinterProxy → Token::at(token)`, pause lines removed; `claim_private`'s consume block (`:124-132`) is verbatim (F-007). No owner, no pause, no upgrade.

Ordering guarantee worth stating in the contract: a wrong-metadata `register_token` reverts in `_register` (message absent), and a public-phase revert drops the private phase's revertible publish nullifier — nothing poisonous persists.

### 2.3 bridge-core

New modules (`packages/bridge-core/src/`): `portal-address.ts` (`portalInitCode`, `predictPortal`), `hub-token.ts` (`deriveHubTokenInstance`, `sanitizeErc20Name`), `content-hash.ts` (+`registerContentHash`, `REGISTER_SECRET_HASH`), `erc20.ts` (one ABI, `readErc20Metadata`, `readErc20Balances` via `multicall`), `token-list.ts`, `route-discovery.ts`, `gas-share.ts`, `factory-abi.ts`, `hub-artifacts` (re-pointed `src/artifacts.ts`). Changed: `journal.ts`, `backup.ts`, `candidate-schema.ts`, `flows.ts`, `route.ts`, `quote.ts` (batched quotes via Multicall3 `aggregate3`, `allowFailure`), `router-abi.ts`, `noir-artifact-classids.test.ts`.

```ts
// candidate-schema.ts (generation shape; .strict() everywhere)
interface GenerationManifest {
  network: string; l1ChainId: number; walletChainId: number
  l1: { factory: Address; implementation: Address; guardian: Address; registry: Address
        fuel: { core: {...as today...}; swap?: { poolManager; quoter; weth; feeJuice; connectors: Address[]; pools: Record<string, Pool>; slippageBps; minFuelFj } }
        feeJuice?: {...}; privateFpc?: {...}; privateClaimMode: "salt-v2" }
  l2: { hub: L2Record /* constructorArgs: [tokenClassId, factory] */; tokenClassId: string; tokenArtifactSha256: string }
  tokens: Array<{ erc20: Address; name: string; symbol: string; decimals: number; portal: Address; l2Token: string
                  source?: "permissionless-mint" | "canonical"; sourceContract?: "MintableERC20" | "TestUsdc"; maxWholePerTx?: number
                  pools?: Record<string, Pool> }>   // pre-created blue chips; superRefine: portal == predictPortal(...)
}
// journal.ts — JournalBase{chainId, portal, bridge} keeps its NAMES: portal = the token's portal (already per-token), bridge = HUB.
interface JournalToken { erc20: string; symbol: string; decimals: number; l2Token: string; name?: string }
interface DepositJournalRecord { ...; assetKind?: "bridge-token" | "fee-juice"; token?: JournalToken /* required when bridge-token */; fuelOnly?: true /* no token leg; amount "0" */; registered?: boolean; registerTxHash?: string }
interface WithdrawJournalRecord { ...; token: JournalToken }
// token-list.ts
const tokenListSchema = z.object({ name: z.string().max(64), timestamp: z.string(), version: z.object({major,minor,patch}), tokens: z.array(z.object({ chainId: z.number().int(), address: evmAddress, name: z.string().max(64), symbol: z.string().max(20), decimals: z.number().int().min(0).max(255), logoURI: z.string().optional() /* ignored */ }).strict()) }).passthrough()
type TokenSource = "manifest" | "list" | "pasted"; interface CatalogToken { erc20; name; symbol; decimals; source; logo?: SpriteId }
loadTokenList({ chainId, fetch, kv, now, ttlMs = 24h, origin: "https://tokens.uniswap.org" }) → { tokens: CatalogToken[]; provenance: "fresh" | "cache" | "fallback" }
// route-discovery.ts
type RouteOutcome = { kind: "route"; route: FuelRoute; quoteOut: bigint; hops: number } | { kind: "no-route"; tried: number } | { kind: "identity" }
discoverFuelRoute(client, cfg: { token; weth; feeJuice; connectors; tiers; ethFj: Pool; probeAmount }) → RouteOutcome
// gas-share.ts
proposeGasShare({ amount, decimals, txTarget = 5, perTxFj, minFuelFj, price /* FJ per token base unit from a dust quote */, slippageBps }) → { fuelAmount: bigint; fuelFj: bigint; capped: "min" | "half" | null }
```

### 2.4 Faucet wizard

New: `WizardShell.vue` (stage machine `token → amount → review → stepper → receipt`), `StepStrip.vue` (copied from the extension `StepIndicator` pattern; roving tablist per CLAUDE.md), `TokenStep.vue` + `TokenList.vue` + `TokenTile.vue` (bundled sprite `src/assets/token-sprite.svg` + monogram/hue fallback) + `PasteAddress.vue`, `AmountStep.vue` + `ChoiceCards.vue` (`TOKEN / TOKEN + gas / Gas`) + `GasBreakdown.vue`, `ReviewStep.vue` + `ReviewDetails.vue`; composables `useTokenCatalog.ts`, `useTokenSelection.ts` (metadata + balance via multicall; derives portal + L2 token; registers the Token instance with the wallet), `useRouteQuote.ts` (replaces `BridgeForm.vue:149-184`), `useGasShare.ts`, `useHubExit.ts` (generalized `useWithdraw`). `BridgeForm.vue`/`FuelForm.vue`/`useL1Usdc.ts`/`BridgeAddToken.vue`/`MintTestUsdc.vue`/`asset-label.ts` are deleted or reduced to the wizard's parts; `BridgeView`+`FuelView` collapse into one `BridgeView` hosting the wizard (the Fuel tab becomes the "Gas" card). `bridge-steps.ts` gains `register` (label `REGISTER`, once-ever, first-time tokens only). `useBridgeJournal.ts:317-330 deploymentMatches` → `chainId && ((bridge == HUB && portal == predictPortal(rec.token.erc20)) || fee-juice branch)`. CSP: `cspConnectSrc` gains `https://tokens.uniswap.org` per target (`network-targets.ts:56,68`); `img-src` unchanged.

### 2.5 Flows

(a) **First-time token, public**: wizard reads metadata (multicall) → no portal (`hasPortal=false`) → REGISTER note in Review → seal/sign witness (`tokenPortal = predictPortal(erc20)`) → `router.bridge()` or `bridgeWithFuel()` → router `createPortal` + deposit in one L1 tx (two inbox messages: `register` then `mint_to_public`) → CROSSING → one L2 tx batching `hub.register_token(...)` + `hub.claim_public(token, …)` (fee paid by the fjwc FJ claim when "+ gas", else sponsored on testnet / user FJ on mainnet) → CONFIRM.
(b) **First-time token, private**: same L1 tx (`mint_to_private`) → L2 tx 1 `register_token` (REGISTER phase; fjwc-paid when "+ gas") → wait one mined block → L2 tx 2 `claim_private` (F-007 secret) → CONFIRM. Rationale: `Token.mint_to_private` reads `minter` historically (`private_context.nr:82-86`).
(c) **Known token + gas**: `bridgeWithFuel` with the discovered route; `parseBridgeWithFuelEvent` reads both leaf indices; L2 fjwc claim + `claim_*` exactly as today.
(d) **Gas only (swap-in-place)**: `bridgeWithFuel{ fuelAmount = totalAmount, tokenPortal = 0, tokenSecretHash = 0 }`; no portal, no register; record `fuelOnly: true`; phases `SIGN → DEPOSIT + FUEL → CROSSING → CLAIM GAS → CONFIRM`. AZTEC gas-only stays `bridge()` to the FeeJuicePortal (the proven path).
(e) **Exit + finish**: wizard exit direction → authwit `Token.burn_*` for the hub → `hub.exit_to_l1_*` (token, recipient, amount, caller) → PROVE (epoch) → `portal.withdraw(...)` on the token's clone → FINISH. The wizard enumerates exit candidates from manifest tokens ∪ list tokens ∪ journal history and reads `balance_of_*` only for the selected token.

### 2.6 File change map (cross-checked against recon rows)

Add — L1: `src/TokenPortalImpl.sol`, `src/PortalFactory.sol`, `src/interfaces/IPortalFactory.sol`, `test/PortalFactory.t.sol` (unit+fuzz), `test/PortalFactoryInvariant.t.sol`, `test/FormalFactory.t.sol`, `test/FactoryFork.t.sol`, `test/mocks/{FeeOnTransferERC20,Bytes32MetadataERC20,NoDecimalsERC20}.sol`, `script/DeployFactory.s.sol`. L2: `token_bridge_hub/` crate (+ `src/test/{register,claims,claims_private,exits,guards,utils}.nr`), `register_content_hash/` lib. bridge-core: modules listed in §2.3 + tests, `scripts/deploy-generation.ts` (replaces `deploy-bridge-testnet.ts`), `scripts/pre-create-tokens.ts`. Faucet: components/composables in §2.4, `src/assets/token-sprite.svg`, `src/lib/token-sprite.ts`, `tests/e2e/wizard-smoke.test.ts`.
Modify (recon rows): `SwapBridgeRouter.sol` (#3), `FormalRouter.t.sol`, `SwapBridgeRouterInvariant.t.sol`, `SwapBridgeRouterFuzz.t.sol`, `ContentHash.t.sol` (+1 vector, #8), `PortalRoundtripFuzz.t.sol` (runs against a clone), `_bridge-contracts.yml` (halmos counts; add hub crate to compile; sole-consumer path), `keystone/src/main.nr` (+register vector, +REGISTER_SECRET_HASH, +hub-token address vector), `check-sole-consumer.sh` (3 sites, `_register` allow-listed, self-test fixtures), `compile.sh`, `run-txe-tests.sh` (stage hub deps), `candidate-schema.ts` (#11), `journal.ts`/`backup.ts`/`recovery-crypto.ts` docs (#17), `route.ts`/`quote.ts` (#18), `flows.ts`, `l1.ts` (unchanged fields), `router-abi.ts`, `script-l2.ts` (`deriveInstance` with deployer param, #9), `deploy-sandbox.ts` (#11, smoke generalized), `live-intent.ts` (readbacks: factory owner, hub binding), `verify-deployments.ts`, `noir-artifact-classids.test.ts` (#19), `bridge-deployments.ts`, `useBridgeJournal.ts`, `deposit-flow.ts` (+ re-pin `useDeposit.characterization.test.ts` once), `useWithdraw.ts`, `useWalletConnection.ts` (register hub + selected token), `bridge-steps.ts`, `testids.ts`, `network-targets.ts`, `vite.config.ts` (no CSP shape change), READMEs ×4, `aztec-update/SKILL.md` Branch B, `UPDATE.md`, `CLAUDE.md`.
Delete: `token_bridge/`, `token_minter_proxy/` crates (after the hub lands), `deploy-bridge-testnet.ts`, `deploy-bridge-mainnet.ts` (rewritten later, out of scope — keep behind a `--l1-only` note), `useL1Usdc.ts`, `BridgeForm.vue`, `FuelForm.vue`, `MintTestUsdc.vue`, `asset-label.ts`. Keep `upstream/NuloTokenPortal.sol` + `portal-artifact.ts` + `PortalReinit`/`FormalPortal` this arc (legacy exit path, §5 A6).

### 2.7 Non-obvious mechanics

**CREATE2 preimage for the OZ immutable-args clone** (`Clones.sol:279-293`, `Create2.sol:69-90`): initcode = `0x61 ‖ uint16(N + 0x2d) ‖ 3d81600a3d39f3 ‖ 363d3d373d3d3d363d73 ‖ impl(20) ‖ 5af43d82803e903d91602b57fd5bf3 ‖ args(N)`. With `args = abi.encodePacked(erc20)` (N = 20): length word `0x0041`, initcode 75 bytes, runtime 65 bytes; `fetchCloneArgs` copies from runtime offset `0x2d`. `portal = keccak256(0xff ‖ factory ‖ salt ‖ keccak256(initcode))[12:]`, `salt = keccak256(abi.encodePacked(erc20))` (pin PACKED, not `abi.encode`). TS: `getCreate2Address({ from: factory, salt: keccak256(erc20), bytecodeHash: keccak256(concat(["0x610041 3d81600a3d39f3363d3d373d3d3d363d73", impl, "0x5af43d82803e903d91602b57fd5bf3", erc20])) })`. Note the init-code hash is PER TOKEN (args inside), so the brief's `bind_l1(factory, portal_init_code_hash)` cannot work as written — under the locked variant the hub must store `implementation` and rebuild the 75 bytes in-circuit (`keccak256::keccak256` from `noir-lang/keccak256@v0.1.3`, then 85-byte CREATE2 preimage, then `field_from_bytes` of the low 20 bytes). Under D1 the Noir leg is dropped; the keystone is Solidity ↔ TS with a fixed vector `(factory=0x33…, impl=0x11…, erc20=0x22…)`.

**`register` content hash**: `sha256ToField(selector ‖ erc20 ‖ portal ‖ name32 ‖ symbol32 ‖ decimals)` (164 bytes), `selector = keccak256("register(address,address,bytes32,bytes32,uint8)")[:4]`. `name32`: take `bytes(name)`, keep bytes `0x20..0x7E` (else `_`), truncate to 31, right-pad with `0x00`, then `bytes32(uint256(first32) >> 8)` ⇒ `0x00 ‖ b0..b30`. That equals Noir `FieldCompressedString::from_string(name).value` (`field_from_bytes(bytes, true)`, `field_compressed_string.nr:18-20`) and is what the hub hashes from `name.as_bytes()`. `str<31>` serializes to 31 Fields (`serde/type_impls.nr:523-536`); aztec.js encodes strings with `charCodeAt` (`stdlib/dest/abi/encoder.js:104-115`), so the ASCII sanitization on L1 is load-bearing: a non-ASCII `name()` (UTF-8 bytes on L1, UTF-16 units in TS) would produce an unconsumable register message and strand the batched deposit. `REGISTER_SECRET_HASH = compute_secret_hash([0])` is a Noir-computed constant pinned in Solidity and TS.

**Hub token address**: `AztecAddress::compute(PublicKeys::default(), PartialAddress::compute(TOKEN_CLASS, salt = erc20.to_field(), init_hash = poseidon2([selector(constructor_with_minter), hash_args(65 fields)], DOM_SEP__INITIALIZER), deployer = HUB, immutables_hash = 0))` — TS: `getContractInstanceFromInstantiationParams(TokenContractArtifact, { constructorArgs: [name, symbol, decimals, hub, ZERO], salt: new Fr(BigInt(erc20)), publicKeys: PublicKeys.default(), deployer: hub, constructorArtifact: "constructor_with_minter" })`. Keystone: a TXE test prints/asserts `derive_token_public` for a fixed vector; `hub-token.test.ts` asserts the same literal.

**Genesis (D2)**: the hub address commits to `l1_factory` (ctor arg) and the factory bakes `L2_HUB`. The conductor predicts `factory = CREATE(deployerEOA, nonce)` (viem `getContractAddress({from, nonce})`), computes the hub address, deploys the factory asserting `nonce` immediately before broadcast (hard-stop on mismatch; the journal records the prediction), then deploys the hub. No `bind_l1`, no deployer role, no unbound state.

**Gas-share proposal**: `perTxFj` = node `getCurrentBaseFees` × a pinned typical gas budget (constant per phase, calibrated by `fuel-testnet.ts`); `fuelFj = max(minFuelFj, txTarget × perTxFj)`; `price = quote(probe)/probe`; `fuelAmount = ceil(fuelFj / price × (1 + slippageBps/1e4))`; cap at 50 % of `amount` (flag `capped`), floor at `minFuelFj`-equivalent; re-quote the real slice for `minFuelOutput`; "change" edits `txTarget ∈ [1, 20]`.

**Route candidate set**: shapes in order — `identity` (token == FJ underlying), `WETH → native/FJ` (1 hop, `inputToken == weth` per `_validateRoute :231-238`), `T/WETH{100,500,3000,10000} → native/FJ`, `T/C{tiers} → C/WETH{pinned} → native/FJ` for `C ∈ connectors` (USDC, USDT); hookless always. One Multicall3 `aggregate3` of dust `quoteExactInputSingle` calls proves liquidity ("initialized ≠ liquid", `discover-mainnet-fuel.ts`), best output wins, then a real-size chained quote. All fail ⇒ `no-route` (UI: "+ gas" card disabled with "no gas from X"; "Gas" card hidden).

### 2.8 Trade-offs / not taken

1-tx private first claim via `Token.initialize_transfer_commitment` + `mint_to_commitment` (`token_contract/src/main.nr:242,432`) is feasible but adds a third consume site and a second private-mint path under the F-007 tripwire — deferred. Universal-deploy (`deployer: ZERO`) tokens would let the SDK publish but open a griefing front-run on the enqueued ctor — rejected. Per-portal `initialize` (today's shape) — rejected by the brief and by F-001. A V3 leg — out of scope. A bundled token list — owner chose runtime; mitigations kept.

## 3. Phases

Gate legend: **fast** = `bun run lint && bun run typecheck:all`; **forge** = `cd contracts/bridge/evm && forge test --no-match-contract Fork`; **halmos** = `forge build --ast --force && halmos --match-contract '^Formal'` (counts per `_bridge-contracts.yml:75-77`); **fork** = `SEPOLIA_RPC_URL=… forge test --match-contract Fork`; **txe** = `contracts/bridge/aztec/scripts/run-txe-tests.sh`; **keystone** = `cd contracts/bridge/aztec/keystone && aztec-nargo test --force`; **core** = `bun run --cwd packages/bridge-core test`; **faucet** = `bun run test:faucet && bun run --cwd apps/faucet test:e2e`; **sandbox** = `bun run --cwd packages/bridge-core deploy:sandbox --smoke` (runs alone); **audit** = `bun run audit:faucet`; **sole** = `bash contracts/bridge/aztec/scripts/check-sole-consumer.sh --self-test && bash …/check-sole-consumer.sh`.

**Arc 0 — Spikes (throwaway branch, results recorded in `implementations-plan/any-erc20-bridge/spikes.md`)**
- P0.1 TXE in-contract deploy. Minimal `token_bridge_hub` with `register_token` + `claim_public` + `claim_private`; test: inject `register` message (factory sender) → `register_token` → same-tx `claim_public` mints → mine → `claim_private` mints. Verdict A: TXE executes the registry publish (requires the Token class nullifier to exist in TXE — probe with a `Token` deployed via `env.deploy`). Verdict B: publish fails in TXE ⇒ tests deploy the token via the raw oracle `txe_oracles::deploy(path, "constructor_with_minter", args, secret, salt, deployer = hub)` (`txe_oracles.nr:45-56`; the helper API hardcodes `deployer = ZERO`, `test/helpers/utils.nr:42-48`) and `call_public(from = hub, ctor)`, and the publish is proven only by the sandbox smoke. Either verdict keeps the hub code identical.
- P0.2 Keystones: forge test prints `predictDeterministicAddressWithImmutableArgs` and the register hash for fixed vectors; TS asserts them; keystone crate asserts the register hash + `compute_secret_hash([0])`; TXE test prints the hub-token address; TS `deriveHubTokenInstance` asserts it.
- Gate: fast · forge (`--match-contract Keystone`) · keystone · txe (spike crate) · core (`portal-address`, `content-hash`, `hub-token` tests). Pass: 3 toolchains agree on every vector; spike verdict written.

**Arc 1 — L1 (PR 1)**
- P1.1 `TokenPortalImpl` + `PortalFactory` + interfaces; tests: `PortalFactory.t.sol` (metadata decoding incl. bytes32/no-decimals/huge-name/non-ASCII, idempotent create, pause bits, `Ownable2Step`), fuzz (random erc20 bytes ⇒ `portalFor` == deployed, name sanitization total), `PortalRoundtripFuzz` against a clone (vectors unchanged), `ContentHash.t.sol` +register vector, `PortalFactoryInvariant.t.sol` (I1 `portalFor(t)` never changes; I2 portal balance ≥ Σdeposits − Σwithdraws per token; I3 only guardian flips pause), `FormalFactory.t.sol` (`check_portalFor_isPure`, `check_setPaused_revertsForNonOwner`, `check_createPortal_idempotent`).
- P1.2 Router A-1 + fuel-only + identity swap + `uint128` cap; `SwapBridgeRouter.t.sol` + fuzz (`testFuzz_hostilePortal` flips to "reverts before pull"), invariants extended, `FormalRouter.t.sol` (+`check_bridge_rejectsForeignPortal`, `check_bridgeWithFuel_fuelOnly_conservesUserFunds`), `BlackhatAudit.t.sol` PoCs (FoT token, fake portal, front-run createPortal). `DeployFactory.s.sol` + `FactoryFork.t.sol` (Sepolia: real USDC/WETH portals, real Permit2, real V4 route via `bridgeWithFuel`).
- CI: `_bridge-contracts.yml` halmos expected counts updated (FormalRouterTest 6, FormalPortalTest 1, FormalFactoryTest 3; summaries 3).
- Gate: fast · forge · halmos · fork · `bun run --cwd packages/bridge-core test -- router-abi` (ABI pin regenerated). Pass: all green, zero legacy vector edits, README A-1 section rewritten to the factory threat model.

**Arc 2 — L2 (PR 2)**
- P2.1 `register_content_hash` lib + keystone additions; `token_bridge_hub` crate (full API); `compile.sh`/`run-txe-tests.sh` re-pointed (stage `token_contract-Token.json` only); artifacts committed path-scrubbed.
- P2.2 TXE suite ported: `register.nr` (happy path per spike verdict; wrong metadata reverts with exact string; double register reverts; foreign sender reverts), `claims.nr`/`claims_private.nr`/`exits.nr` generalized over two tokens (cross-token claim must fail: message from portal A cannot mint token B), `guards.nr` (`_register` only-self, unregistered token read reverts "Trying to read from uninitialized PublicImmutable").
- P2.3 `check-sole-consumer.sh` → hub path, 3 sites with `_register` allow-listed by name + constant `[REGISTER_SECRET]` dataflow; self-test fixtures; `noir-artifact-classids.test.ts` re-pinned (hub + Token class id); `txe-ts-map.md` updated.
- Gate: keystone · txe (≥ 33 tests passing, positive count asserted by the runner) · sole · core (`noir-artifact-classids`). Pass: exact-string `should_fail`s only; old crates deleted only after the hub suite is green.

**Arc 3 — bridge-core + conductors (PR 3)**
- P3.1 Schema + manifest + journal: `candidate-schema.ts` generation shape (superRefine: `tokens[i].portal == predictPortal`, tokenClassId format), `journal.ts` token block + `fuelOnly`, `backup.ts` header carries `token`, `promotion.ts`; tests updated (fixtures regenerated once).
- P3.2 Flows + discovery: `erc20.ts`, `token-list.ts` (fetch/TTL/fallback/zod, provenance), `route-discovery.ts` + `route-conformance.test.ts` extended to the new shapes, `quote.ts` batching, `gas-share.ts`, `flows.ts` (`runSwapBridge` fuel-only, `runRegisterAndClaim`, exit any token), `factory-abi.ts` pinned to the forge artifact like `router-abi.test.ts`.
- P3.3 Conductors: `deploy-generation.ts` (journaled: predict factory → hub address → L1 factory (nonce-asserted) → publish Token class → hub → pre-create tokens (`createPortal` + `register_token`) → per-token TOKEN/WETH pools via `SeedTokenPool.s.sol` → readbacks → candidate), `deploy-sandbox.ts` rewritten (factory+hub; `anvil_setCode` Multicall3 like Permit2 `:126-129`), `--smoke` = flows (a)(b)(c)(d)(e) against the sandbox, `verify-deployments.ts` (recompute every `tokens[i].l2Token`, hub binding, class ids), `live-intent.ts` readbacks.
- Gate: fast · core · sandbox · `bun run --cwd apps/faucet verify:deployments` (against the sandbox candidate via `BRIDGE_MANIFEST`). Pass: sandbox smoke covers all five flows incl. the 2-tx private first claim and a `no-route` token.

**Arc 4 — Wizard (PR 4)**
- P4.1 Foundation: `testids.ts` entries first; `bridge-deployments.ts` → generation reader; `useTokenCatalog`/`useTokenSelection`/`useRouteQuote`/`useGasShare`; `useBridgeJournal` binding + REGISTER phase in `bridge-steps.ts`; `deposit-flow.ts` any-token (re-pin the characterization snapshot once); `useHubExit`.
- P4.2 UI: `WizardShell`, `StepStrip`, `TokenStep`/`TokenList`/`TokenTile`/`PasteAddress`, `AmountStep`/`ChoiceCards`/`GasBreakdown`, `ReviewStep`/`ReviewDetails` (portal verified = `predictPortal` vs `factory.portalFor`), stepper/receipt/journal cards per-token labels; sprite + monogram; CSP origin; a11y (roving tablist, `aria-live` list status, focus order); `wizard-smoke.test.ts` (jsdom; mocks per `bridge-smoke.test.ts`; real journal engine) covering list/paste/no-route/first-time note/2-tx private/exit.
- Gate: fast · faucet · audit · `bun run --cwd apps/faucet verify:deployments`. Pass: every interactive element has a testid; parity/drift/contrast tests green; the characterization snapshot re-pinned exactly once in this arc.

**Arc 5 — Docs + testnet (PR 5, then live)**
- P5.1 Docs: `aztec-update/SKILL.md` Branch B → generation deploy runbook (steps 4/7/8 rewritten; pre-create + pool seed per token), READMEs ×4 (stale test counts fixed, `README.md:35-42`), `UPDATE.md` couplings (hub↔factory, tokenClassId↔artifact, token list origin↔CSP), `CLAUDE.md` pointers, `.env.example` (documented vars).
- P5.2 Live: `live-intent.ts build` → `deploy-generation.ts` on Sepolia/alpha-testnet (fake USDC/USDT/cbBTC/WBTC + real Sepolia WETH, §5 A7) → candidate smokes (`verify-l1`, `smoke-existing-testnet`, fueled smoke generalized) → promote → canaries (`fuel-testnet PRIVATE_RUNS=1`, fee-juice canary, drip) → deploy `testnet.tools.nulo.sh`.
- Gate: audit · `bun run --cwd apps/faucet verify:deployments` on the promoted manifest · all canaries · **owner live-testnet sign-off** (wizard first-time private deposit of a pasted token, gas-only, exit). Pass: sign-off recorded in the PR.

## 4. Security & Adversarial Considerations

Threat model: attacker is any L1/L2 user, any token contract author, the token-list origin, or a compromised guardian key. Assets: per-token portal reserves (each isolated), L2 token supplies, user in-flight messages, user browser state.

- **Portal poisoning (fake portal ↔ real token)**: the hub only consumes `register` from the immutable factory (sender bound in `constructor`) and `mint_*` from `portal_of[token]`, which is written once from that message. A fake L1 contract can send messages to the hub but never as the factory or a factory clone. TXE test "foreign sender" + "cross-token claim" pin this.
- **Front-running `createPortal`**: CREATE2 with token-derived salt ⇒ same address, same metadata (read from the token), idempotent; the router calls it inline so a racing creator only pays gas for the winner. Metadata read via `staticcall` — a reentrant `name()` cannot mutate factory state.
- **Fee-on-transfer / rebasing / ERC-777**: FoT under-collateralizes a portal (mint `amount`, hold less) — fix in the impl's deposit (`balanceAfter − balanceBefore == amount`, content hash untouched; Ask A3); rebasing cannot be fixed (document; catalog `caution` for pasted tokens); 777 hooks find no portal state to corrupt and the router is `nonReentrant`. Amounts `> uint128` are rejected by the router (unclaimable on L2 otherwise).
- **Metadata edge cases**: `decimals` missing ⇒ revert (a wrong-decimal L2 token mis-scales forever); bytes32 name/symbol decoded; huge/non-ASCII names sanitized to 31 ASCII bytes before hashing (the `charCodeAt` hazard, §2.7); the event carries the bytes32 forms only.
- **Hook pools / quote manipulation**: hookless-only grammar (`UniswapFuelSwap._validateRoute:252`); the signed `minFuelOutput` is the binding floor (`SwapBridgeRouter.sol:196-198`); discovery uses dust probes so a sandwich cannot make a dead pool look live for the real quote; a manipulated quote only lowers the user's own floor within `slippageBps`.
- **Guardian key compromise**: deposits pause = fail-safe; withdraws pause = griefing of every exit. Proposal (A2): withdraw pause auto-expires after 7 days and cannot be re-armed within 7 days of expiry (halmos-provable), so a stolen key delays, never freezes. The withdraw pause is also the ONLY backstop for an L2 hub bug (mint-without-message → exit → drain), which is why it must exist.
- **Hub bug draining every portal**: blast radius is all hub tokens by construction (shared L2 contract, no upgrade). Mitigations: minimal surface (6 externals + 1 only-self), F-007 body verbatim, sole-consumer tripwire with 3 named sites, cross-token TXE tests, halmos on L1 side, sandbox end-to-end, `/harden security` before mainnet. Per-token isolation on L1 (separate clone balances) caps a single-token exploit at that token's reserve.
- **Journal/backup domain confusion**: the recovery-key message (`recovery-crypto.ts:27-33`) already binds `portal`, which is per-token now; keeping field names avoids re-keying while making records per-token by construction. Backup header gains `token`; `validateBackupRecord` refuses a header whose `portal ≠ predictPortal(token.erc20)`.
- **Token list**: single pinned origin, zod at the boundary (lengths capped, chainId filtered), no `logoURI` ever rendered (sprite only ⇒ no `img-src` change), Vue text interpolation only (no `v-html`), fail-closed to cache then to the manifest tokens; a poisoned list can at most present a wrong name for an address — the wizard shows the address in Details and keys everything by address. Redirect risk: if `tokens.uniswap.org` 30x's to another host the CSP blocks it ⇒ fallback path, verified at P4.2.
- **Supply chain**: viem `getCreate2Address` is pure; Multicall3 is the canonical address (`viem/chains` config); the sprite is committed SVGs reviewed in-PR; OZ commit pin unchanged (`cab19933` = 5.6.1).
- **Wizard**: the Review "portal verified" compares an on-chain read with local recomputation — a tampered manifest or RPC cannot pass both; the private-default row cannot be silently flipped by a route failure (gas card disabled, privacy untouched).

## 5. Assumptions

**Facts** (verified): OZ 5.6.1 `Clones._cloneCodeWithImmutableArgs` layout (`lib/openzeppelin-contracts/contracts/proxy/Clones.sol:279-293`, main checkout; the worktree has no `lib/`) · `Create2.computeAddress` (`utils/Create2.sol:69-90`) · router guards (`SwapBridgeRouter.sol:155,158,246`) · portal content preimages (`NuloTokenPortal.sol:104,136,176-180`) · `publish_contract_instance_for_public_execution` is private-only and asserts `deployer == this` (`aztec-nr/aztec/src/publish_contract_instance.nr:13-19`) · the registry sets `deployer = msg_sender` for non-universal publishes (`contract_instance_registry_contract/src/main.nr` "let deployer = if universal_deploy …") so NO SDK-side publish with `deployer: HUB` exists · public initializer check (`initialization_utils.nr:152-163`) · `str<31>` = 31 fields (`crates/serde/src/type_impls.nr:523-536`) · `FieldCompressedString::from_string = field_from_bytes(bytes, true)` (`compressed-string/src/field_compressed_string.nr:18-20`) · aztec.js string encoding uses `charCodeAt` (`@aztec/stdlib/dest/abi/encoder.js:104-115`) · TXE helper hardcodes `deployer = ZERO` but the raw oracle takes a deployer (`test/helpers/utils.nr:42-48`, `txe_oracles.nr:45-56`) · `PublicContext::consume_l1_to_l2_message(content, secret, sender, leaf)` (`public_context.nr:239-262`) · `Token` API (`aztec-standards v5.0.1 token_contract/src/main.nr:98-111, 410-425, 466-483, 242, 432`) · `deploymentMatches` and the recovery binding (`useBridgeJournal.ts:317-330, 379`) · CSP plugin (`vite.config.ts:100-131`) and per-target `cspConnectSrc` (`network-targets.ts:56,68`) · L1 reads tunnel through the injected provider and `viem/chains` sepolia/mainnet carry `multicall3` (`useL1Wallet.ts:29-38`, `network.ts:14,34`) · sole-consumer count is hard-coded to 2 (`check-sole-consumer.sh:23-28`) · halmos counts in CI (`_bridge-contracts.yml:75-77`).

**Inferences** (labeled): I1 — the TXE's `deploy` oracle registers class + instance without going through the registry contract, so Verdict B is the likely spike outcome; the design tolerates both. I2 — `https://tokens.uniswap.org` serves JSON directly with CORS; if it redirects, the fallback path activates (tested either way). I3 — the Uniswap list has no Sepolia entries, so on testnet the catalog is effectively the manifest `tokens[]` and the runtime fetch is exercised for real only on mainnet. I4 — a public-phase revert drops the private phase's revertible nullifiers (standard tx semantics), which is what makes wrong-metadata registration non-poisonous; the TXE "wrong metadata" test pins it.

**Asks** (owner decisions; nothing assumed):
- **A1 (D1, attacks a LOCKED item)** — send `register` from the FACTORY with the portal in the content instead of from the clone + Noir CREATE2. Same trust root (immutable factory code), removes keccak from Noir, drops a 3-toolchain keystone to 2, and fixes a hole in the locked text: with immutable args the init-code hash is per token, so `bind_l1(factory, portal_init_code_hash)` cannot verify anything as written. If declined, the hub stores `implementation` and rebuilds the 75-byte initcode in the AVM (§2.7).
- **A2 (guardian)** — withdraw pause with a 7-day auto-expiry + re-arm cooldown vs. the locked unbounded bit. A compromised or coerced guardian key must not be able to freeze exits indefinitely; deposits pause stays unbounded.
- **A3 (portal body)** — allow the balance-delta check in the impl's deposits (content hashes unchanged) vs. literal byte-identity. Without it any FoT token under-collateralizes its own portal via a direct portal call the router cannot see.
- **A4 (D2, attacks a LOCKED item)** — CREATE-nonce-predicted factory + hub ctor arg vs. `bind_l1`. `bind_l1` leaves a deployer role and an unbound window; the nonce variant leaves no role at all and fails loudly (redeploy the hub, no funds at risk).
- **A5 (2-tx private first claim)** — accepted as locked; the partial-note 1-tx path is documented as a follow-up, not built.
- **A6 (cutover hole)** — retiring the mainnet legacy USDC bridge from the UI strands holders of the OLD L2 USDC with no exit path. Keep `upstream/NuloTokenPortal.sol` + a schema-level `legacy?` block this arc; a legacy-exit-only affordance is the mainnet-cutover arc's first task.
- **A7 (testnet WETH)** — pre-create real Sepolia WETH's portal (exercises the 1-hop route) instead of a fake "WETH"; fake USDC/USDT/cbBTC/WBTC as locked.
- **A8 (ownerless hub)** — accepted; the concrete failure (an L2 mint bug has no L2 kill switch) is mitigated only by A2's withdraw pause and the pre-mainnet `/harden security`. Say so in the README.
- **A9 (salt encoding)** — pin `keccak256(abi.encodePacked(erc20))`; `abi.encode` would silently produce a different address in TS.

## 6. Delivery

Arcs → stacked PRs off `dev` (worktree `any-erc20-bridge`): PR1 L1 (arc 1) → PR2 L2 (arc 2) → PR3 bridge-core + conductors (arc 3) → PR4 wizard (arc 4) → PR5 docs (arc 5); the testnet deploy + promotion is a live step after PR5 merges, gated by owner sign-off. Arc 0 spikes never merge (results in `spikes.md` inside PR1). Each PR is independently revertable in reverse order (PR4 depends on PR3's schema; PR3 on PR1/PR2 artifacts; PR1/PR2 are independent of each other). `/code-review medium` per arc; PR1 and PR2 additionally get `/security-review` before their fix loops because they are the immutable surfaces. Codex `xhigh` per the budget.

## 7. Post-implementation (self-contained)

Per arc, before the next arc starts: (1) `/code-review medium --fix` on the arc's diff; (2) codex fix loop until convergence — rules: no over-engineering (a finding that proposes a new abstraction, config, or contract needs a concrete failing case or is closed as won't-fix), comment quality (comments state invariants and non-obvious whys only; no plan/phase references; delete narration comments), keystones untouched unless a vector is ADDED; every loop iteration re-runs that arc's validation gate verbatim; (3) record unresolved findings in the PR body. After PR5: a final cross-arc pass (`/code-review medium` over the whole stack diff + `bun run test:all` exit code 0 + `bun run audit:faucet` + sandbox smoke), then open the PRs via `gh` only after all loops converge. Recorded, not scheduled: `/harden security` before any mainnet deploy.

### Critical Files for Implementation
- `contracts/bridge/evm/src/SwapBridgeRouter.sol`
- `contracts/bridge/evm/upstream/NuloTokenPortal.sol` (template for `TokenPortalImpl`)
- `contracts/bridge/aztec/token_bridge/src/main.nr` (template for the hub) and `contracts/bridge/aztec/keystone/src/main.nr`
- `packages/bridge-core/src/candidate-schema.ts` (+ `journal.ts`, `content-hash.ts`, `route.ts`, `quote.ts`)
- `apps/faucet/src/composables/useBridgeJournal.ts` (+ `deposit-flow.ts`, `lib/bridge-steps.ts`, `lib/testids.ts`)