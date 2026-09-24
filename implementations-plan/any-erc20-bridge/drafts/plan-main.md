# Draft A (main) — any-erc20-bridge

## Summary

One L1 `PortalFactory` mints a storage-less portal clone per ERC-20 and attests the token's metadata to ONE L2 `TokenBridgeHub` through an L1→L2 `register` message; the hub deploys the per-token L2 `Token` itself from that attestation and serves every claim/exit. The router derives the legal portal from `bridgeToken` (closing A-1) and gains a fuel-only path (swap-in-place). The tools app becomes a 3-step wizard over a runtime token list. Testnet-live + docs is done; mainnet is a later owner-run step behind `/harden security`.

Rubric: novelty **HIGH** (in-contract Aztec deployment, cross-chain address binding), blast radius **HIGH** (every bridged asset flows through the hub), irreversibility **HIGH** (portals + hub are immutable; a bad genesis is a new generation), migration **MEDIUM** (pre-prod, legacy retired, no user data), external coupling **HIGH** (Uniswap V4, Permit2, Aztec Inbox/Outbox, tokens.uniswap.org), security **HIGH**. → `mega-deep`.

## Architecture & Implementation

### Refinement of the locked topology (decision-ledger candidate D1)

The brief has the hub *recompute* `portal(erc20)` by CREATE2/keccak in the AVM. Simpler and equally trust-rooted: **the factory sends the `register` message itself** (`msg.sender == factory` → `L1Actor = factory`, a single constant the hub learns at `bind_l1`), and the message content carries the portal address the factory just deployed. The hub consumes with `sender = l1_factory` and stores the attested portal. No keccak in Noir, no CREATE2 preimage in three toolchains — the CREATE2 keystone shrinks to Solidity ↔ TS (the frontend still predicts portals for the review's "verified" line and the router binding). Same trust root (the factory's immutable code is what created the clone), fewer moving parts. The topology (one hub, constant `l2Bridge`) is unchanged.

### L1 (`contracts/bridge/evm/src/`)

```solidity
contract TokenPortalImpl is ReentrancyGuardTransient {          // storage-less; one per generation
  IPortalFactory public immutable FACTORY;   // guardian pause bits
  IInbox  public immutable INBOX;  IOutbox public immutable OUTBOX;
  uint256 public immutable ROLLUP_VERSION;  bytes32 public immutable L2_HUB;
  function underlying() public view returns (IERC20)             // address(bytes20(Clones.fetchCloneArgs(address(this))))
  function depositToAztecPublic(bytes32 to, uint256 amount, bytes32 secretHash) external nonReentrant returns (bytes32, uint256)
  function depositToAztecPrivate(uint256 amount, bytes32 secretHash) external nonReentrant returns (bytes32, uint256)
  function withdraw(address recipient, uint256 amount, bool withCaller, Epoch, uint256 numCheckpointsInEpoch, uint256 leafIndex, bytes32[] calldata path) external nonReentrant
}
```
- Deposit/withdraw **content hashes are byte-identical** to `NuloTokenPortal` (`mint_to_public(bytes32,uint256)`, `mint_to_private(uint256)`, `withdraw(address,uint256,address)`); `ContentHash.t.sol` + `PortalRoundtripFuzz.t.sol` pass with zero vector edits.
- Two body changes, both content-hash-neutral: (1) `require(!FACTORY.depositsPaused())` / `require(!FACTORY.withdrawsPaused())`; (2) **amount = balance delta** (`received = bal(after) − bal(before)`) is what goes into the message + event, and `require(received > 0 && received <= type(uint128).max)` — closes fee-on-transfer under-collateralization (today's F-E DoS pin flips to a supported path) and the latent u128 overflow that would strand any deposit above `2^128−1` base units forever. The depositor reads `amount` + `index` from the event (the app already reads the index there).
- `ReentrancyGuardTransient` (OZ ≥ 5.1, EIP-1153) keeps the clone storage-less; Sepolia/mainnet are post-Cancun.

```solidity
contract PortalFactory is Ownable2Step {                          // owner == guardian
  address public immutable IMPLEMENTATION;  IInbox public immutable INBOX;  uint256 public immutable ROLLUP_VERSION;  bytes32 public immutable L2_HUB;
  bytes32 public constant REGISTER_SECRET_HASH = <poseidon2 secret hash of REGISTER_SECRET=1, keystone-pinned>;
  mapping(address token => address portal) public portalOf;  mapping(address portal => address token) public tokenOf;
  bool public depositsPaused; bool public withdrawsPaused;
  event PortalCreated(address indexed token, address indexed portal, bytes32 name31, bytes32 symbol31, uint8 decimals, bytes32 key, uint256 index);
  function createPortal(address token) public returns (address portal);   // idempotent-revert on existing
  function ensurePortal(address token) external returns (address);         // create-if-missing (router uses this)
  function predictPortal(address token) external view returns (address);   // Clones.predictDeterministicAddressWithImmutableArgs(IMPL, abi.encodePacked(token), _salt(token))
  function setDepositsPaused(bool) external onlyOwner;  function setWithdrawsPaused(bool) external onlyOwner;
}
```
- `_salt(token) = bytes32(uint256(uint160(token)))` (the immutable args already make initcode unique per token; a readable salt beats a keccak).
- `createPortal`: metadata via low-level `staticcall` with `try`-style decoding — `name()`/`symbol()` accept `string` **or** `bytes32` (MKR-style), truncated to 31 bytes, empty on failure; `decimals()` **required** (revert `NoDecimals`); then clone, record, `INBOX.sendL2Message(L2Actor(L2_HUB, ROLLUP_VERSION), registerHash, REGISTER_SECRET_HASH)`, emit.
- `registerHash = sha256ToField(abi.encodeWithSignature("register(address,address,bytes32,bytes32,uint8)", token, portal, name31, symbol31, decimals))` — the 4th keystone vector (Solidity/Noir/TS).
- Guardian = `Ownable2Step` owner; pause is reversible and can only grief, never move funds.

**Router** (`SwapBridgeRouter.sol`, 12-field witness unchanged):
- `_legalPortal(bridgeToken, tokenPortal, fuelOnly)`: `tokenPortal == FACTORY.ensurePortal(bridgeToken)` (create-and-deposit batching lives here) **or** (`bridgeToken == FEE_ASSET && tokenPortal == feeJuicePortal`, today's direct fuel) **or** (`fuelOnly && tokenPortal == address(0)`).
- `bridgeWithFuel`: allow `fuelAmount == totalAmount` (skip the token leg, `aztecRecipient` must be zero); allow an **empty path iff `bridgeToken == FEE_ASSET`** (no swap: `fuelReceived = fuelAmount`) — this is "AZTEC + gas". `bridge()` unchanged except the portal rule.
- Token pulled via Permit2 is measured by delta; `bridgeAmount = received − fuelAmount`.
- Halmos: `check_bridgeWithFuel_conservesUserFunds` extended to `fuelAmount == totalAmount`; new `check_bridge_portalIsDerived` (∀ portal ≠ derived → revert). Invariant handler gains `createPortal`/`pause` actions.

### L2 (`contracts/bridge/aztec/token_bridge_hub/`)

```rust
struct Storage { owner: PublicImmutable<AztecAddress>, token_class_id: PublicImmutable<ContractClassId>,
                 l1_factory: PublicImmutable<EthAddress>,
                 portal_of: Map<AztecAddress /*l2 token*/, PublicImmutable<EthAddress>>,
                 token_of:  Map<EthAddress /*erc20*/, PublicMutable<AztecAddress>> /* discovery only */ }
#[initializer] constructor(token_class_id)                        // owner = msg_sender, universal deploy
bind_l1(factory: EthAddress)                                       // owner-only, single-shot (PublicImmutable nullifier); owner has no authority after
#[external("private")] register_token(erc20: EthAddress, portal: EthAddress, name: str<31>, symbol: str<31>, decimals: u8, leaf_index: Field)
   // content = register_content_hash(erc20, portal, name, symbol, decimals); consume_l1_to_l2_message(content, [REGISTER_SECRET], l1_factory, leaf_index)
   // token = derive_token(erc20, name, symbol, decimals)  = ContractInstance{salt: erc20.to_field(), deployer: self, class: token_class_id, init: H(constructor_with_minter(name,symbol,decimals,self,ZERO)), immutables_hash: 0, keys: default}.to_address()
   // publish_contract_instance_for_public_execution(context, token); enqueue Token::at(token).constructor_with_minter(...); enqueue self._bind(token, erc20, portal)
claim_public(token, to, amount: u128, secret, leaf_index)            // consume(content, [secret], portal_of.at(token).read(), leaf) ; Token.mint_to_public
claim_private(token, recipient, amount, claim_salt, leaf_index)      // F-007 derive_claim_secret kept verbatim; portal_of read privately (constant cost)
exit_to_l1_public / exit_to_l1_private(token, recipient, amount, caller_on_l1, authwit_nonce)   // Token.burn_* (authwit to the hub) ; message_portal(portal_of.at(token).read(), content)
```
- The hub never holds tokens; per-token `Token` instances are aztec-standards `Token` (minter = hub). `TokenMinterProxy` and `token_bridge` are deleted.
- **Private first claim = 2 txs** (register lands, then `claim_private` reads `minter` historically). Public claim batches `register_token` + `claim_public` in one tx.
- No pause on L2 (guardian pause is L1-side, where funds are); the hub is ownerless after `bind_l1`.

### bridge-core (`packages/bridge-core/src/`)

- `derive.ts`: `predictPortal(factory, impl, erc20)` (viem `getCreate2Address` over the OZ initcode `61 ‖ u16(len+0x2d) ‖ 3d81600a3d39f3363d3d373d3d3d363d73 ‖ impl ‖ 5af43d82803e903d91602b57fd5bf3 ‖ args`), `deriveHubToken(hub, tokenClassId, erc20, meta)` (`getContractInstanceFromInstantiationParams` with `deployer: hub`, `salt: Fr(erc20)`), `registerContentHash(...)`, `REGISTER_SECRET`/`REGISTER_SECRET_HASH`. All keystone-pinned.
- `generation.ts` (manifest v2): `{ network, l1ChainId, walletChainId, l1: { factory, implementation, guardian, fuel{core, swap?}, feeJuice }, l2: { hub: L2Record, tokenClassId }, tokens: [{ erc20, portal, l2Token, name, symbol, decimals, source, seeded?: boolean }] }`; zod `.strict()`; pre-created tokens only — the app treats `tokens[]` as the always-present part of the list.
- `journal.ts`: `JournalBase.binding = { chainId, hub, portal }` + `token?: { erc20, symbol, decimals, l2Token }`; `assetKind: "token" | "fee-juice"`. `backup.ts` header follows; `recoveryKeyMessage` keeps `{chainId, portal, bridge: hub, secretHashHex}` (per-record isolation unchanged — `secretHashHex` is per deposit).
- `flows.ts`: `runDeposit`/`runSwapBridge` gain `ensurePortal` semantics (portal derived, existence via `eth_getCode`), a fuel-only variant, `registerToken` (permissionless, relayer-able), any-token claims/exits.
- `route.ts`/`quote.ts`: `discoverFuelRoute(token)` over candidate shapes (`token→WETH→ETH→FJ` × tiers `{100,500,3000,10000}`, `WETH→ETH→FJ`, zero-hop for AZTEC), `extsload` slot0 + dust quote → `{ kind: "route", route, quote } | { kind: "no-route", tried } | { kind: "unavailable", error }`.
- `token-list.ts`: zod schema for the Uniswap list, `chainId` filter, TTL cache (24 h) in a caller-supplied KV, fail-closed to the manifest tokens; `gas-share.ts`: proposal = clamp(inverseQuote(TX_TARGET × FJ_PER_TX), floor-clearing, 40 % of amount).

### Faucet (`apps/faucet/src/`)

New `SendView` (tab `SEND`, replaces Bridge + Fuel): `WizardShell` + `StepStrip` (from the extension's `StepIndicator` pattern), `TokenStep` (`TokenList` rows from `WalletPickerModal`'s shape, search, paste → on-chain metadata via multicall), `AmountStep` (`ChoiceCards` as a roving tablist, gas breakdown, private row), `ReviewStep` (`ReviewSheet` + `Details`), then the existing `BridgeStepper`/`PhaseRail` (optional `register` phase) and `BridgeReceipt` (token + gas + "review said / you got"). `TokenTile` = bundled SVG sprite (`src/assets/token-logos.svg`, generated by a script from a committed allowlist) with monogram/hue fallback. `useTokenList`, `useTokenMetadata` (multicall), `useRouteDiscovery`, `useSend` (replaces `useDeposit`/`useFuel` orchestration; `deposit-flow.ts` generalized per token). Journal cards + `deploymentMatches` per token by derivation. CSP: `connect-src` += `https://tokens.uniswap.org`; `img-src` unchanged.

### Flows

- **(a) first-time, public**: wizard → `ensurePortal` inside `router.bridge` (one L1 tx: clone + register message + deposit) → app polls Inbox for both leaves → one L2 tx `[register_token, claim_public]` (register consumes the factory-sent message; claim consumes the portal-sent one) → done.
- **(b) first-time, private**: same L1 tx → L2 tx 1 `register_token` (app sends; relayer-able) → tx 2 `claim_private(token, recipient, amount, salt, leaf)` after the register block is mined.
- **(c) known token + gas**: `bridgeWithFuel(tokenPortal = portalOf(token), fuelAmount < total, path)` → `claim` gas (existing ladder) + `claim_*` token.
- **(d) gas only**: `bridgeWithFuel(tokenPortal = 0, fuelAmount == totalAmount, path)`; for AZTEC `bridge(tokenPortal = feeJuicePortal)` (existing).
- **(e) exit**: `exit_to_l1_*(token, …)` (authwit to the hub) → prove → `portal.withdraw(...)` on the derived portal.

### Trade-offs / not taken

Per-token L2 bridges (Wonderland shape) — rejected (locked). Hub computes CREATE2 in the AVM — replaced by L1 attestation (D1). Mutable parameters contract — rejected (locked). Bundled-only token list — owner chose runtime fetch; mitigations applied. Router-less direct portal deposits — still possible (the portal is permissionless) but the app always routes via the router so binding + batching apply. V3 swap leg — out. Pause with expiry — over-engineering for a testnet-first release; noted.

## Phases

**Arc 1 — L1 contracts**
- **P1 `TokenPortalImpl` + `PortalFactory` + register keystone.** Tests: `PortalFactory.t.sol` (create/ensure/predict/idempotence/pause/metadata variants incl. bytes32-name + no-decimals revert + fee-on-transfer + u128 cap), `PortalCloneRoundtripFuzz.t.sol` (reuse `CapturingInbox/Outbox/FakeRollup/FakeRegistry`), `ContentHash.t.sol` 4th vector, `FormalFactory.t.sol` (halmos: `check_createPortal_isIdempotentPerToken`, `check_pause_blocksOnlyGuardedPaths`), `BlackhatFactory.t.sol` (front-run `createPortal` is harmless; hostile `name()`; ERC-777 reentrancy mock). Gate: `cd contracts/bridge/evm && forge build && forge test --no-match-contract Fork && halmos --match-contract '^Formal'` (all pass; halmos proof counts asserted) · `bun run lint`.
- **P2 Router binding + fuel-only + AZTEC wrapped.** Tests: unit + `SwapBridgeRouterFuzz` (portal-derivation + boundary), invariant handler actions, `FormalRouter` extended, fork suite (`forge test --match-contract Fork`, `SEPOLIA_RPC_URL`) proving real Permit2 + V4 through `ensurePortal` + fuel-only. Gate: hermetic + halmos + fork green · witness keystone unchanged (`WitnessHash.t.sol`).

**Arc 2 — L2 hub**
- **P3 Spike: in-contract deploy in TXE.** Minimal hub `register_token` + TXE test (`send_l1_to_l2_message_from_secret_hash` from `l1_factory`, publish, ctor, `mint_to_public` on the new token). Gate: `contracts/bridge/aztec/scripts/run-txe-tests.sh` green with ≥1 passing test on the hub. Fallback (documented): SDK-side deploy of the hub-derived instance; hub verifies by derivation.
- **P4 Full hub + suites.** Port the 33 TXE tests to the hub (claims, private claims incl. F-007 redirect rejection, exits, pause-free, register double-consume, wrong-sender, metadata tamper, two-tx private first claim), keystone crate (+ register vector, `REGISTER_SECRET_HASH`, a derived-token-address vector), `check-sole-consumer.sh` re-pointed, class-id pins. Gate: `run-txe-tests.sh` (≥ 40 pass) · `aztec-nargo test` in `keystone/` · `bash contracts/bridge/aztec/scripts/check-sole-consumer.sh --self-test && …` · `bun run --cwd packages/bridge-core test` (class-id pins).

**Arc 3 — bridge-core**
- **P5 Derivation + keystones + schema + journal + flows.** `derive.ts` vectors vs forge (`predictPortal` ↔ `PortalFactory.predictPortal` fixed vectors) and vs Noir (hub token address vector); `generation.ts`; journal/backup v3; `flows.ts` any-token; route discovery + no-route; token-list + gas-share. Gate: `bun run --cwd packages/bridge-core test` · `bun run typecheck:all` · `bun run lint`.
- **P6 Conductors + sandbox smoke.** `deploy-sandbox.ts` rewritten (impl+factory, hub, `bind_l1`, publish Token class, `--smoke`: first-time public, first-time private (2 tx), known+gas via `MockSwapTarget`, gas-only, exit public+private, relayer register). `deploy-bridge-testnet.ts` v2 (fake USDC/WETH-real/USDT/cbBTC/WBTC, pre-create + register, candidate manifest v2, journal), `promote`, `verify-deployments` v2. Gate: `bun run --cwd packages/bridge-core deploy:sandbox --smoke` green (runs alone) · package tests · `bun run --cwd apps/faucet verify:deployments` on the candidate.

**Arc 4 — wizard**
- **P7 Primitives + testids.** `StepStrip`, `ChoiceCards` (tablist), `TokenList`/`TokenSearch`, `TokenTile` + sprite script, `ReviewSheet`, `GasBreakdown`; ≥10 cases each. Gate: `bun run test:faucet` · `bun run lint` · `bun run typecheck:all`.
- **P8 SendView wiring + smoke.** `useSend`, per-token journal, receipt, exits, register phase, no-route states, CSP, remove Bridge/Fuel tabs, `tests/e2e/send-smoke.test.ts` (mock wallet + real journal). Gate: `bun run audit:faucet` (typecheck ∥ test ∥ lint → verify:deployments → build) · `bun run --cwd apps/faucet test:e2e`.

**Arc 5 — docs + testnet**
- **P9 Docs.** `aztec-update` skill Branch B rewritten for generations, READMEs ×4, `UPDATE.md` couplings, `CLAUDE.md` pointers, `implementations-plan/index.md`. Gate: `bun run lint` (md untouched by biome; `scripts/check-no-brand.sh` via hook) · reviewer read.
- **P10 Testnet deploy + sign-off.** Owner runs the conductor (secrets); agent drives candidate smokes (`smoke-existing-testnet.ts` v2), promote, build `testnet.tools`, owner live sign-off. Gate: promoted manifest verifies · owner sign-off recorded in `lessons/phase-10.md`.

## Security & Adversarial

- **Poisoning**: impossible by construction — portal address = f(factory, impl, erc20); L2 token = f(hub, class, erc20, L1-attested metadata). A front-run `createPortal` produces the identical portal.
- **Metadata**: `name()`/`symbol()` are attacker-controlled strings → truncated to 31 bytes on L1, never rendered from L2; the UI renders list/on-chain names as text nodes only (Vue escapes), never HTML. Two tokens with the same symbol are distinguished by address in the picker.
- **Token behaviors**: fee-on-transfer → delta accounting; rebasing → unsupported (documented; positive rebases accrue to the portal, negative under-collateralize — no on-chain detection); ERC-777 → `ReentrancyGuardTransient` + checks-effects; `decimals > 18` fine (u8); `amount > u128` rejected on L1.
- **Hub bug** → every portal's `withdraw` trusts hub messages → guardian `withdrawsPaused` is the circuit breaker; guardian key compromise = griefing only.
- **Router**: portal derived on-chain (A-1 closed); witness still binds portal/token/amounts/recipients/route/swapTarget; fuel-only requires zero recipient.
- **Quotes**: display + floor only; on-chain `minFuelOutput` signed; hookless pools only.
- **Token list**: single pinned origin, HTTPS, zod-validated, chainId-filtered, TTL cache, fails closed to manifest tokens; `logoURI` ignored; CSP `connect-src` widened by exactly one host; no `img-src` change. Supply chain: no new npm deps except none (viem already present); OZ pinned by commit in CI.
- **Journal/backup**: binding `{chainId, hub, portal}` + `token` block; `deploymentMatches` re-derives the portal from `erc20` rather than trusting the record; backups reject cross-token label/seal mismatches (existing check, extended fields).
- **Genesis**: `bind_l1` one-shot, deployer-only, nothing bridged before it; L1 `L2_HUB` immutable; wrong-hub deployment = redeploy generation (nothing at risk).

## Assumptions

**Facts**: OZ 5.6.1 `Clones` immutable-args API (`Clones.sol:197-293`); `NuloTokenPortal` bodies + hashes (`upstream/NuloTokenPortal.sol:93-185`); router A-1 + `0<fuel<total` (`SwapBridgeRouter.sol:154-158`); v5.0.1 `publish_contract_instance_for_public_execution` private-only with deployer check; `PublicImmutable` private read constant-cost, same-tx read impossible; Token `constructor_with_minter(str<31>, str<31>, u8, minter, auth)`; `run-txe-tests.sh` + TXE not in CI; manifest/journal shapes (`research/bridge-core.md`).
**Inferences**: (I1) Inbox records `msg.sender` as the L1 actor, so a factory-sent message is unforgeable — verify in `@aztec/l1-artifacts` `Inbox.sol`; (I2) `ReentrancyGuardTransient` exists at OZ `cab19933` (5.6.1 — yes) and Sepolia is Cancun — verify; (I3) TXE ships the canonical `ContractInstanceRegistry` at genesis so P3 works — the spike decides; (I4) tokens.uniswap.org serves CORS-enabled JSON directly (not an IPFS redirect) — verify with a `curl -I`; (I5) hub `str<31>` args serialize as 31 fields for `hash_args` — the Noir/TS token-address keystone catches drift.
**Asks**: (A1) accept the D1 refinement (L1-attested portal instead of AVM CREATE2)? (A2) fee-on-transfer support via delta accounting (recommended) vs reject-on-mismatch? (A3) testnet fuel routes: seed TOKEN/WETH pools only for fake USDC (+ real WETH is 1-hop) and let USDT/cbBTC/WBTC show "no gas route" on testnet? (A4) pre-created blue-chip set on mainnet candidate: USDC, USDT, WETH, WBTC, cbBTC, DAI? (A5) TX_TARGET = 15 and FJ_PER_TX from `minFuelFj`?

## Delivery

Stacked via `gh stack`: `any-erc20-bridge/l1` (P1–P2, medium) → `/l2` (P3–P4, medium) → `/core` (P5–P6, medium) → `/wizard` (P7–P8, medium) → `/docs-testnet` (P9–P10, low). Each arc reviewable alone; contracts arcs are deployable-inert until the conductor arc.

## Post-implementation

Per arc at the boundary: `/code-review medium --fix` → commit separately → codex `xhigh` with the arc map + adversarial ask + verbatim no-over-engineering + comment-quality rules → fix/commit/log/resume until clean (≤3 rounds) → `gh stack add`. After all arcs: fresh codex cross-arc pass. Then `gh stack submit --auto`, bodies, `gh pr checks --watch`. `/harden security` before any mainnet deploy (recorded, not scheduled).
