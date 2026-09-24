# Permissionless Any-ERC-20 Bridge — Implementation Plan

## 1. Summary

- Replace per-token L2 bridges and minter proxies with one ownerless `TokenBridgeHub`, while retaining isolated L1 reserves in deterministic per-token portal clones.
- Add an `Ownable2Step` L1 `PortalFactory`; clones contain only immutable arguments and consult its deposit/withdraw pause bits.
- Bind the router structurally to factory-derived portals, support full-amount gas swaps, and retain the existing 12-field Permit2 witness.
- Generalize bridge-core around deterministic token identity, manifest v2, per-token journals, route discovery, and resumable deployment conductors.
- Replace the single-token Bridge/Fuel forms with one Token → Amount → Review wizard; preserve the existing journal, stepper, backup, and receipt engines.
- Sequence TXE in-contract deployment and the Solidity/Noir/TS derivation keystones before production code.
- Ship testnet only; remove legacy bridges from active manifests/UI and disable the new bridge on mainnet until the later hardened deployment.
- Tier: `mega-deep`. Novelty **HIGH**; blast radius **HIGH**; irreversibility **HIGH**; migration **MEDIUM**; external coupling **HIGH**; security **HIGH**.

## 2. Architecture & Implementation

### Proposed architecture

**L1 factory and portals**

`PortalFactory` owns the only governance state. Its constructor receives the Aztec registry and L2 hub, resolves the current rollup/inbox/outbox/version, and deploys `TokenPortalImpl` from inside the constructor so the implementation can immutably bind `FACTORY = address(this)` without an initializer or setter.

Each portal is an OZ deterministic clone with:

- `args = abi.encodePacked(erc20)` — exactly 20 bytes.
- `salt = keccak256(abi.encodePacked(erc20))`, subject to Ask A2.
- no storage and no initializer.
- implementation immutables for factory, registry, rollup, inbox, outbox, rollup version, and L2 hub.
- deposit/withdraw pause modifiers around the existing content-hash-critical bodies.
- exact-in balance-delta enforcement; otherwise fee-on-transfer deposits create unbacked L2 supply.

`createPortal` is idempotent. It deploys first, then performs bounded metadata reads and sends one public registration message using a fixed, keystone-pinned register secret/hash. Front-running therefore cannot select a different address or message sender. Existing portals return without sending a second registration message.

The router calls `createPortal` automatically when a token leg exists and the predicted clone has no code. Factory `createPortalAndDeposit…` helpers remain for direct EOA use, but the wizard uses the router so tokens make only one transfer into the portal.

**L2 hub**

`TokenBridgeHub` is ownerless after a one-shot deployer binding. It is the minter and burn caller for every standards Token. It:

- authenticates registration through a message whose L1 sender is the CREATE2-derived portal;
- deterministically derives the Token instance from ERC-20 address plus the L1-attested metadata;
- publishes the child instance in a private function, then enqueues its public constructor;
- immutably records both `portal_of[l2Token]` and `token_of[erc20]`;
- keeps `derive_claim_secret(salt, recipient)` unchanged;
- exposes public and private claims/exits generalized over `l2Token`.

The frontend must derive and register the Token instance with the wallet/PXE before calling the hub: `publish_contract_instance_for_public_execution` reads the instance preimage from that oracle (`research/l2-contracts.md:61-66`).

**Required correction:** a single `portal_init_code_hash` cannot derive immutable-args clones because the initcode hash changes with `erc20`. The implementable binding is `bind_l1(factory, portalImplementation)`, after which Noir reconstructs the per-token initcode. This blocks implementation until Ask A1 is resolved.

**Router**

Add immutable `portalFactory`. For every token leg:

```solidity
p.tokenPortal == portalFactory.portalFor(p.bridgeToken)
```

The fee asset has two deliberately distinct meanings:

- `TOKEN`: use its factory portal and mint a wrapped hub Token.
- `Gas`: deposit 1:1 through canonical `FeeJuicePortal`.
- `TOKEN + gas`: factory portal for the remainder; direct 1:1 Fee Juice for the gas slice.

For non-fee tokens, `bridgeWithFuel` accepts `0 < fuelAmount <= totalAmount`. At equality it performs the swap and Fee Juice deposit but skips portal creation, approval, and the token event leg. It emits zero token key/index/amount. Empty routes are allowed only for the direct fee-asset branch; all swap routes remain non-empty and hookless.

The witness fields and type string remain unchanged. The caller still signs `tokenPortal`, even where a gas-only operation does not invoke it.

### Key interfaces and types

#### Solidity

```solidity
interface IPortalFactory {
    function implementation() external view returns (address);
    function depositsPaused() external view returns (bool);
    function withdrawalsPaused() external view returns (bool);
    function portalFor(address erc20) external view returns (address);

    function createPortal(address erc20)
        external
        returns (address portal, bytes32 registerKey, uint256 registerIndex);

    function createPortalAndDepositToAztecPublic(
        address erc20,
        bytes32 to,
        uint256 amount,
        bytes32 secretHash
    ) external returns (
        address portal,
        bytes32 registerKey,
        uint256 registerIndex,
        bytes32 depositKey,
        uint256 depositIndex
    );

    function createPortalAndDepositToAztecPrivate(
        address erc20,
        uint256 amount,
        bytes32 secretHash
    ) external returns (
        address portal,
        bytes32 registerKey,
        uint256 registerIndex,
        bytes32 depositKey,
        uint256 depositIndex
    );

    function setDepositsPaused(bool paused) external;
    function setWithdrawalsPaused(bool paused) external;
}

contract TokenPortalImpl {
    constructor(address factory, address registry, bytes32 l2Hub);

    function underlying() public view returns (IERC20);

    function register(bytes32 name, bytes32 symbol, uint8 decimals)
        external
        returns (bytes32 key, uint256 index);

    function depositToAztecPublic(bytes32 to, uint256 amount, bytes32 secretHash)
        external
        returns (bytes32 key, uint256 index);

    function depositToAztecPrivate(uint256 amount, bytes32 secretHash)
        external
        returns (bytes32 key, uint256 index);

    function withdraw(
        address recipient,
        uint256 amount,
        bool withCaller,
        Epoch epoch,
        uint256 numCheckpointsInEpoch,
        uint256 leafIndex,
        bytes32[] calldata path
    ) external;
}
```

`PortalCreated(address indexed token, address portal, string name, string symbol, uint8 decimals)` stays exact. Add `RegisterMessage(address indexed token, bytes32 key, uint256 index)` so clients do not infer the registration leaf from log ordering.

#### Noir

```rust
#[storage]
struct Storage<Context> {
    deployer: PublicImmutable<AztecAddress, Context>,
    l1_factory: PublicImmutable<EthAddress, Context>,
    portal_implementation: PublicImmutable<EthAddress, Context>,
    portal_of: Map<AztecAddress, PublicImmutable<EthAddress, Context>, Context>,
    token_of: Map<EthAddress, PublicImmutable<AztecAddress, Context>, Context>,
}

#[external("public")]
#[initializer]
fn constructor();

#[external("public")]
fn bind_l1(l1_factory: EthAddress, portal_implementation: EthAddress);

#[external("private")]
fn register_token(
    erc20: EthAddress,
    name: str<31>,
    symbol: str<31>,
    decimals: u8,
    register_leaf_index: Field,
);

#[external("private")]
fn register_and_claim_public(
    erc20: EthAddress,
    name: str<31>,
    symbol: str<31>,
    decimals: u8,
    register_leaf_index: Field,
    recipient: AztecAddress,
    amount: u128,
    claim_secret: Field,
    claim_leaf_index: Field,
);

#[external("public")]
fn claim_public(
    token: AztecAddress,
    recipient: AztecAddress,
    amount: u128,
    secret: Field,
    message_leaf_index: Field,
);

#[external("private")]
fn claim_private(
    token: AztecAddress,
    recipient: AztecAddress,
    amount: u128,
    claim_salt: Field,
    message_leaf_index: Field,
);

#[external("public")]
fn exit_to_l1_public(
    token: AztecAddress,
    recipient: EthAddress,
    amount: u128,
    caller_on_l1: EthAddress,
    authwit_nonce: Field,
);

#[external("private")]
fn exit_to_l1_private(
    token: AztecAddress,
    recipient: EthAddress,
    amount: u128,
    caller_on_l1: EthAddress,
    authwit_nonce: Field,
);

#[external("public")]
#[view]
fn token_for(erc20: EthAddress) -> AztecAddress;

#[external("public")]
#[view]
fn portal_for(erc20: EthAddress) -> EthAddress;
```

Private registration publishes the instance and enqueues an `#[only_self]` public helper. That helper recomputes both portal and Token addresses, consumes `register`, initializes both maps, and invokes the Token constructor. The combined public-claim helper then mints in the same public execution. Duplicate or inconsistent initialization fails through `PublicImmutable`.

#### TypeScript manifest and journal

```ts
interface BridgeManifestV2 {
  schema: 2
  network: "testnet" | "mainnet"
  l1ChainId: number
  walletChainId: number
  l1: {
    registry: Address
    factory: Address
    implementation: Address
    guardian: Address
    factoryDeployBlock: number
    router: Address
    permit2: Address
    swapTarget: Address
    feeJuice: {
      portal: Address
      asset: Address
      feeAssetHandler?: Address
      minFj: string
    }
    swap?: {
      poolManager: Address
      quoter: Address
      weth: Address
      feeJuice: Address
      feeTiers: readonly FuelPoolParams[]
      slippageBps: number
    }
  }
  l2: {
    hub: L2Record
    tokenClassId: string
    tokenArtifactSha256: string
  }
  tokens: PrecreatedToken[]
}

interface PrecreatedToken {
  erc20: Address
  portal: Address
  l2Token: string
  name: string
  symbol: string
  nameWord: Hex
  symbolWord: Hex
  decimals: number
  icon?: "usdc" | "weth" | "usdt" | "cbbtc" | "wbtc"
  source?: "permissionless-mint" | "external"
}

interface JournalTokenBlock {
  kind: "hub-token" | "fee-juice"
  erc20: Address
  portal: Address
  l2Token: string
  nameWord: Hex
  symbolWord: Hex
  displaySymbol: string
  decimals: number
}

interface JournalBaseV3 {
  schema: 3
  chainId: number
  factory: Address
  hub: string
  token: JournalTokenBlock
  intent: "token" | "token-and-gas" | "gas"
}
```

Recovery/backup domains become:

```ts
{ chainId, factory, hub, kind, erc20, portal, l2Token, secretHashHex }
```

A record for token A must never open or resume under token B even if symbol, decimals, secret hash, or direction coincide. Legacy records are quarantined rather than guessed into the new domain.

#### Runtime token list and route result

The boundary follows the official [Uniswap Token Lists shape](https://github.com/Uniswap/token-lists/blob/main/src/types.ts), while discarding `logoURI`:

```ts
interface RuntimeTokenList {
  name: string
  timestamp: string
  version: { major: number; minor: number; patch: number }
  tokens: Array<{
    chainId: number
    address: Address
    name: string
    symbol: string
    decimals: number // uint8, 0..255
    tags?: string[]
  }>
}

type RouteDiscoveryResult =
  | {
      status: "found"
      route: FuelRoute
      shape: "direct" | "via-weth" | "via-weth-unwrap" | "via-native"
      amountIn: bigint
      amountOut: bigint
      blockNumber: bigint
      quotedAt: number
    }
  | { status: "no-route"; candidatesTried: number }
  | { status: "unavailable"; reason: "rpc" | "config" | "stale-request" }
```

### Data and control flow

**First-time public deposit**

1. Resolve the address from the pinned list or paste; read current metadata only for preview.
2. Compute the predicted portal. If a `PortalCreated` event exists, its bounded metadata words are authoritative.
3. Derive the hub Token and register its instance with the wallet/PXE.
4. Router calls `createPortal` before pulling funds when a token leg is present. The same L1 transaction emits the register and deposit messages, plus Fee Juice when selected.
5. Wait until both register and deposit messages are anchored.
6. Submit `register_and_claim_public`; its private portion publishes the Token and its public portion consumes registration, runs the constructor, consumes the deposit, and mints.
7. Journal each leaf/key before attempting the L2 transaction.

**First-time private deposit**

Steps 1–5 are identical, but:

1. Submit `register_token` as the first L2 transaction.
2. Wait for the Token constructor/minter state to enter a historical public block.
3. Submit `claim_private` as the second transaction, retaining the existing recipient-derived claim secret.
4. If gas was included, the registration transaction consumes the private Fee Juice message through the PrivateFPC and leaves the remainder for the claim. Without included or pre-existing gas, stop before the L1 deposit and show the locked red warning.

**Known-token deposit with gas**

Resolve `hub.token_for(erc20)` and verify it equals the locally derived instance. Discover and quote routes, approve Permit2 if necessary, sign the unchanged witness, and execute `bridgeWithFuel`. Claim the token and Fee Juice using the existing public or PrivateFPC fee ladders, but build the hub call from the journal’s token block.

**Swap-in-place gas only**

For non-fee tokens, set `fuelAmount == totalAmount`; no portal is created and no token deposit occurs. The router swaps, checks actual input consumption and Fee Juice balance delta, deposits Fee Juice, and emits a zero token leg. For the fee asset, skip Uniswap and deposit 1:1. A typed `no-route` result disables only Gas and TOKEN+gas; TOKEN remains available if the account can pay its claim.

**Exit and finish**

Select a registered hub token, generate authwit for the hub, then call `exit_to_l1_public/private(token, …)`. The hub reads the immutable portal, burns through the Token, and sends the L2→L1 message to that portal. The journal waits for proof and invokes `portal.withdraw`. A withdrawal pause may delay finish but must never cause the record to be discarded or marked failed permanently.

### Non-obvious mechanics

**OZ immutable-args clone preimage**

The pinned OZ implementation constructs:

```text
61
uint16(args.length + 0x2d)
3d81600a3d39f3363d3d373d3d3d363d73
<20-byte implementation>
5af43d82803e903d91602b57fd5bf3
<args>
```

For the 20-byte ERC-20 arg, runtime length is `0x0041`, runtime is 65 bytes, and initcode is 75 bytes. CREATE2 is:

```text
last20(keccak256(
  0xff || factory20 || salt32 || keccak256(initcode)
))
```

Solidity uses `Clones.predictDeterministicAddressWithImmutableArgs`; TS constructs these exact bytes rather than relying on a generic minimal-proxy helper; Noir does the same in public execution. One fixed vector records factory, implementation, ERC-20, args, salt, initcode hash, and portal. The byte layout comes from the pinned form of [OpenZeppelin `Clones.sol`](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/proxy/Clones.sol).

**Register content hash**

Selector: `0x7793ce54` for `register(address,bytes32,bytes32,uint8)`.

```text
sha256ToField(
  selector4
  || leftPad32(erc20)
  || nameWord32
  || symbolWord32
  || leftPad32(decimals)
)
```

`sha256ToField(x) = uint256(sha256(x)) >> 8`, matching the existing three vectors. Canonical name/symbol are at most 31 raw bytes, copied to bytes `0..30` and right-padded with zero; byte 31 must be zero. Noir copies the first 31 bytes byte-for-byte into `str<31>`. TS derivation uses the words, not a second UTF-8 round-trip. Display decoding is untrusted and may use replacement characters.

**Genesis binding**

Deploy the ownerless hub, deploy the factory with the hub address, then call `bind_l1(factory, implementation)` once from the recorded hub deployer. Read back both values and renounce no additional capability—the deployer check becomes irrelevant after the immutable slots initialize.

**Gas-share proposal**

Let `setupTxs` be 1 for known/public-first-time/gas-only and 2 for first-time private. Default `futureTxs = 3`. Compute:

```text
targetFj =
  ceil(max(predictedWorstTxFee, calibratedMinFj) *
       (setupTxs + futureTxs) *
       1.20)
```

Find the smallest input whose slippage-adjusted output reaches `targetFj` using bounded exponential search plus binary search over exact-input quotes. Cap it at the entered amount. “Change” edits `futureTxs` or the exact slice. A proposal is display assistance; submit always re-quotes and re-signs the floor.

**Route candidate set**

Probe hookless V4 routes over `{100/1, 500/10, 3000/60, 10000/200}`:

1. token → Fee Juice;
2. token → WETH → Fee Juice;
3. token → WETH, then native ETH → Fee Juice using the final-boundary unwrap;
4. token → native ETH → Fee Juice.

Two-hop candidates use the fee-tier cross product. Quote them at one pinned block with bounded concurrency, choose maximum output, and return `no-route` only when every candidate conclusively fails; RPC errors are `unavailable`.

### File-level change map

**Add**

- `contracts/bridge/evm/src/{PortalFactory,TokenPortalImpl}.sol`
- `contracts/bridge/evm/src/interfaces/IPortalFactory.sol`
- Factory/clone unit, fuzz, invariant, formal, fork, metadata-adversary, and CREATE2 tests.
- `contracts/bridge/aztec/token_bridge_hub/**`
- `packages/bridge-core/src/{portal-derivation,hub-token,token-list,route-discovery,gas-proposal}.ts`
- `apps/faucet/src/components/{WizardShell,StepStrip,ChoiceCards,TokenList,TokenTile,BridgeReview}.vue`
- Bundled token SVG sprite and corresponding tests.

**Modify**

- `SwapBridgeRouter.sol`, router ABI/tests, content-hash suites, `FormalRouter`, `BlackhatAudit`, and `_bridge-contracts.yml`.
- `content-hash.ts`, `l1.ts`, `route.ts`, `quote.ts`, `flows.ts`, `journal.ts`, `backup.ts`, `recovery-crypto.ts`, artifact/class-id pins, exports, and tests.
- `candidate-schema.ts`, `deploy-manifest.ts`, testnet/sandbox conductors, `script-l1.ts`, `script-l2.ts`, verification/smoke scripts, and live-intent allowlists.
- `BridgeForm`, stepper/rail/receipt/journal components, deposit/withdraw flows, wallet registration, balances, deployment reader, `bridge-steps.ts`, `testids.ts`, `network-targets.ts`, and `vite.config.ts`.
- README files, `UPDATE.md`, `CLAUDE.md` pointers, and `.claude/skills/aztec-update/SKILL.md` Branch B.

**Delete or retire**

- Delete `token_minter_proxy/**` and the old `token_bridge/**` after vectors/tests move.
- Remove proxy/legacy bridge artifacts and class-id pins.
- Remove the standalone Fuel form/view/tab; its direct-fee logic moves behind the wizard’s Gas card.
- Remove legacy portal deploy conductors, committed portal bytecode tooling, and active legacy manifest entries. Retain `NuloTokenPortal.sol` only as an explicitly historical reference if audit history requires it.
- Disable mainnet bridge UI and remove the legacy mainnet bridge manifest from consumption; do not silently retain Circle USDC.

### Trade-offs and alternatives not taken

- One hub minimizes L2 deployment and discovery complexity but makes one hub defect systemic across all portals.
- Per-token L2 bridges would isolate failures but reintroduce deployment orchestration and the L1/L2 address cycle.
- Immutable clones avoid all initializer/repointing classes; beacon/UUPS or mutable parameter registries are rejected.
- No V3 or hooked V4 routes: less coverage, materially smaller trust surface.
- Runtime token lists improve freshness but are availability and poisoning dependencies; they are never registration or identity authorities.
- Nonstandard balance semantics are not supportable safely without per-token adapters. “Any ERC-20” must mean balance-preserving ERC-20 unless the owner explicitly accepts insolvency risk.
- If TXE cannot exercise in-contract publication, stop and re-gate. SDK deployment is not an automatic fallback because it contradicts the locked hub-deploys-token architecture.

## 3. Phases

### Phase 1 — feasibility spikes and keystones

**Goal:** prove the two unknown mechanics before building around them.

**Steps**

1. Build a minimal hub that derives, publishes, initializes, and mints one standards Token.
2. Add a TXE test that registers the instance preimage, runs publication, and verifies minting.
3. Add the Solidity/TS/Noir CREATE2 vector, register content-hash vector, fixed register-secret vector, and hub Token-address vector.
4. Resolve A1/A2; no downstream implementation starts while derivation is ambiguous.

**Tests added:** minimal TXE deploy/mint, wrong deployer/preimage/class tests; four fixed cross-toolchain vectors; fuzzed ERC-20 address parity.

**Validation gate**

```bash
bun run lint
bun run typecheck:all
bun run --cwd packages/bridge-core test
bun run test:faucet
contracts/bridge/aztec/scripts/run-txe-tests.sh
cd contracts/bridge/evm
forge test --no-match-contract Fork
forge build --ast --force
halmos --match-contract '^Formal'
```

Layers: fast, Forge/keystone, TXE. Pass only if TXE reports a positive test count and all three toolchains produce identical unchanged bytes. No “expected vector update” is allowed.

### Phase 2 — L1 factory, clones, and router

**Goal:** close arbitrary-portal routing and safely support creation, direct Fee Juice, and gas-only swaps.

**Steps**

1. Implement factory, implementation, metadata bounds, pause modifiers, exact-in checks, events, and idempotent creation.
2. Port the three existing portal content bodies without changing selectors or content preimages.
3. Add factory-aware router validation, automatic creation for token legs, gas-only skipping, and the direct fee-asset branch.
4. Preserve the witness and update ABI parity/readback tooling.
5. Update Foundry CI proof-count assertions.

**Tests added:** unit/fuzz/invariant tests for deterministic creation, front-running, duplicate creation, hostile portals, metadata reentrancy/large returns, fee-on-transfer rejection, pause isolation, gas-only conservation, direct Fee Juice, approvals reset, and event zeros; Sepolia clone/Permit2 forks; Halmos proofs for portal binding and zero token leg.

**Validation gate**

```bash
bun run lint
bun run typecheck:all
bun run --cwd packages/bridge-core test
bun run test:faucet
cd contracts/bridge/evm
forge test --no-match-contract Fork
forge test --match-contract Fork
forge build --ast --force
halmos --match-contract '^Formal'
```

`SEPOLIA_RPC_URL` is required for the second Forge command. Pass means all 256-run fuzz/invariant campaigns, updated named proof counts, and every fork test pass.

### Phase 3 — full L2 hub

**Goal:** replace the legacy bridge/proxy with generalized registration, claims, and exits.

**Steps**

1. Implement one-shot binding, portal/Token derivation, bidirectional immutable maps, registration helpers, combined public first claim, ordinary claims, and exits.
2. Keep recipient-derived private claim logic verbatim and repoint the sole-consumer guard.
3. Replace old artifacts/class-id pins and teach the TXE runner to stage only Hub and Token artifacts.
4. Delete ownership/pause/proxy surfaces from L2.

**Tests added:** bind once/deployer-only, unbound use, wrong portal, forged metadata, duplicate/cross-token registration, replay, public first claim, two-transaction private first claim, wrong recipient, relayer claim, public/private exits, cross-token authwit, and map discovery.

**Validation gate**

```bash
bun run lint
bun run typecheck:all
bun run --cwd packages/bridge-core test
bun run test:faucet
contracts/bridge/aztec/scripts/run-txe-tests.sh
cd contracts/bridge/evm
forge test --no-match-contract Fork
forge build --ast --force
halmos --match-contract '^Formal'
```

Layers: fast, keystone, TXE, contract regression. Pass means a positive TXE count, exact failure reasons, unchanged claim-secret vectors, and no remaining production reference to `TokenMinterProxy`.

### Phase 4 — bridge-core, journals, routes, and conductors

**Goal:** make deterministic identity and per-token recovery the only application model.

**Steps**

1. Land manifest v2 and semantic refinements for unique tokens, factory/implementation binding, derived portals, Token instances, and artifact digests.
2. Centralize ERC-20 ABI/metadata, portal and Token derivation.
3. Introduce journal schema 3 and update backup, sealing, resume, withdraw, labels, and recovery domains atomically.
4. Implement token-list fetch/cache boundary, route discovery, gas proposal, and typed no-route result.
5. Rewrite sandbox/testnet conductors: hub → factory → bind → fake blue chips → create/register → candidate; generalize smoke to two tokens and all five required flows.
6. Remove or fail-stop legacy mainnet conductor paths.

**Tests added:** strict manifest fixtures, derivation keystones, token-list timeout/size/schema/TTL/cache poisoning, cross-token journal/backup rejection, route matrix/no-route/RPC distinction, gas-search bounds, crash-resume at every deploy step, readback mismatch, and sandbox public/private/known/gas-only/exit flows.

**Validation gate**

```bash
bun run lint
bun run typecheck:all
bun run --cwd packages/bridge-core test
bun run test:faucet
contracts/bridge/aztec/scripts/run-txe-tests.sh
bun run --cwd packages/bridge-core deploy:sandbox --smoke
cd contracts/bridge/evm
forge test --no-match-contract Fork
forge test --match-contract Fork
forge build --ast --force
halmos --match-contract '^Formal'
```

Run the sandbox smoke alone on the box. Pass means candidate/readbacks are deterministic across rerun, partial journals fail safely, and all five flows settle with correct token-specific balances.

### Phase 5 — wizard and runtime token UX

**Goal:** ship the locked three-step UX without weakening recovery.

**Steps**

1. Add Token → Amount → Review shell, roving-tab cards, keyboard token list, paste-address flow, bundled icons, and monogram/hue fallback.
2. Merge Bridge and Fuel into the three Amount choices; privacy remains one private-default row.
3. Add first-time detection, no-route behavior, two-transaction private narration, collapsed details, portal recomputation, and signing explanation.
4. Generalize balances, wallet Token registration, receipt, journal cards, account switching, and exits.
5. Add exact Uniswap origin to `connect-src`; keep `img-src 'self' data:`.
6. Assign `TESTIDS` before implementing each interactive element.

**Tests added:** keyboard/accessibility, every wizard transition, arbitrary decimals, stale quote cancellation, XSS strings, no live logo loads, first-time public/private, AZTEC’s three modes, account switch, journal restoration, and testid-only e2e coverage.

**Validation gate**

```bash
bun run lint
bun run typecheck:all
bun run --cwd packages/bridge-core test
bun run test:faucet
bun run --cwd apps/faucet test:e2e
bun run --cwd apps/faucet verify:deployments
bun run audit:faucet
```

Layers: fast, faucet unit, testid-only smoke, manifest/build/CSP audit. Pass means no text/class selectors in e2e, no `logoURI` request, no `v-html`, both target builds pass, and mainnet exposes no legacy bridge.

### Phase 6 — testnet cutover, documentation, and owner gate

**Goal:** produce and promote a verified testnet generation.

**Steps**

1. Use live-intent tooling before every broadcast group.
2. Deploy fake USDC/WETH/USDT/cbBTC/WBTC, hub, factory/implementation, router as needed, and bind the hub.
3. Pre-create/register all five; seed only owner-approved V4 pools.
4. Run candidate verification, public/private first-token, known-token+gas, gas-only, and exit/finish canaries.
5. Promote candidate atomically, deploy `testnet.tools.nulo.sh`, update every runbook/README/UPDATE pointer, and obtain owner live sign-off.
6. Record `/harden security` as mandatory before any mainnet deployment.

**Tests added:** live candidate scripts assert portal/Token recomputation, metadata/event identity, guardian/owner, hub binding, pause state, class IDs, two different token round-trips, and zero legacy addresses.

**Validation gate**

```bash
bun run lint
bun run typecheck:all
bun run --cwd packages/bridge-core test
bun run test:faucet
bun run --cwd apps/faucet test:e2e
cd contracts/bridge/evm
forge test --no-match-contract Fork
forge test --match-contract Fork
forge build --ast --force
halmos --match-contract '^Formal'
cd ../../../..
contracts/bridge/aztec/scripts/run-txe-tests.sh
bun run --cwd packages/bridge-core deploy:sandbox --smoke
bun run --cwd apps/faucet verify:deployments
bun run audit:faucet
```

Pass requires every local layer, all candidate live canaries, deployed-source verification, correct hosted CSP/build metadata, and explicit owner testnet sign-off. A partial live landing is fix-forward under its journal; it is never promoted.

## 4. Security & Adversarial Considerations

- **Factory poisoning/front-running:** creation must be idempotent and deterministic. An attacker may pay first, but cannot select another portal or hub. Metadata is nevertheless frozen at first creation; upgradeable or caller-dependent metadata makes this a semantic front-run.
- **Metadata denial:** high-level `name()` can allocate attacker-sized returndata. Use gas-limited `staticcall`, copy only bounded ABI words, and never emit an unbounded returned string.
- **CREATE2 mismatch:** one wrong byte strands every deposit for that token. Solidity, Noir, and TS vectors are release keystones, not ordinary unit tests.
- **Clone/factory substitution:** the hub authenticates the predicted clone sender; the router derives the same portal. Never accept list-, manifest-, or caller-supplied portals without recomputation.
- **Fee-on-transfer/rebase/ERC-777:** fee-on-transfer must fail exact balance deltas. Negative rebases can make an otherwise valid portal insolvent later and cannot be safely detected at deposit. Malicious callbacks are bounded by router/factory reentrancy guards and exact-delta checks. These tokens require adapters or explicit exclusion.
- **Decimals/metadata:** `decimals() > 18` is not an on-chain arithmetic error, but every parser/formatter must remain BigInt-only and bounded through 255. Missing or changing metadata needs an owner-approved fallback policy.
- **Hub systemic risk:** any cross-token map, authwit, or portal-selection bug can authorize withdrawals against every clone. Test cross-token substitution everywhere; never let user metadata select an already-registered Token.
- **Pause compromise:** the guardian can globally deny deposits or finishes. It cannot redirect assets, but a withdrawal pause can leave already-burned exits pending. Disable renounce unless the owner explicitly accepts permanent unpausability.
- **Router/swap:** retain Permit2 nonce/deadline, signed min output, route hash, swap-target binding, actual input-consumption check, Fee Juice balance delta, and approval-to-zero discipline. Reject every hook address.
- **Quote manipulation:** a compromised RPC/quoter may suggest a poor price. A fresh signed floor limits execution loss but does not prove fairness; show exact route/minimum, pin quote block, expire stale results, and never use quotes as claim amounts.
- **Runtime token list:** compromise can promote counterfeit token addresses or offensive strings, but cannot forge portal/hub identity. Cap response bytes/token count/string lengths, validate on every cache read, filter chain ID, and fail closed to manifest tokens/paste.
- **XSS/CSP:** render token strings only through Vue text interpolation; no `v-html`, HTML titles, token-supplied URLs, SVG IDs, or CSS fragments. Sprite selection is a hardcoded address map. Add only the exact list origin to `connect-src`.
- **Journal/backup confusion:** all cryptographic domains include generation and token identity. Local list cache and display labels are never authoritative recovery inputs.
- **Supply chain:** keep Bun lockfile frozen, OZ pinned to the CI commit, Token/Hub artifact digests in the manifest, and existing class-id pins. Runtime JSON is data only and cannot influence imports, logos, ABIs, or contract classes.

## 5. Assumptions

### Facts

- Router portal choice is currently caller-controlled and `fuelAmount == totalAmount` is rejected (`SwapBridgeRouter.sol:83-105,153-160`).
- The Permit2 witness is twelve fields and mirrored in TS (`SwapBridgeRouter.sol:52-56,113-126`; `packages/bridge-core/src/l1.ts:11-14,25-38`).
- Current portal withdrawals bind `l2Bridge` as the L2 sender (`NuloTokenPortal.sol:43-50,162-185`).
- Private claims commit the recipient through `derive_claim_secret`, and this is the only acceptable private consumer (`token_bridge/src/main.nr:105-134`).
- In-contract publication is private-only and needs a PXE-registered instance preimage (`research/l2-contracts.md:45-66`).
- A private first claim cannot read minter state initialized in the same transaction (`recon.md:15,39`).
- Current manifest and deployment reader are single-token (`candidate-schema.ts:31-135`; `research/bridge-core.md:19-35`).
- Current recovery binding is only `{chainId, portal, bridge}` (`journal.ts:35-57`; `useBridgeJournal.ts:317-331`).
- L1 reads currently require an injected connected wallet (`useL1Wallet.ts:20-38`).
- CSP generation already has target-specific `connect-src` and self-only images (`vite.config.ts:96-132`).
- CI installs OZ at a pinned commit and runs hermetic Forge, Halmos, Noir keystones, and the sole-consumer guard (`_bridge-contracts.yml:42-69,71-106,108-163`).

### Inferences

- Public first registration and claim can share one L2 transaction; private first claim requires two.
- The router can safely create a missing portal before pulling Permit2 funds because the address was already witness-bound.
- Portal creation metadata, not later `name()` reads or token-list text, must drive Token instance derivation.
- The separate Fuel tab should be retired because the locked Gas card subsumes it.
- Legacy local records can be quarantined instead of migrated because the brief states no production records exist.

### Asks

**A1 — blocking:** replace locked `bind_l1(l1_factory, portal_init_code_hash)` with `bind_l1(l1_factory, portal_implementation)`. A global initcode hash is mathematically insufficient when immutable args change the initcode for every ERC-20.

**A2 — blocking:** ratify salt bytes: `keccak256(abi.encodePacked(erc20))` over 20 raw address bytes, not `abi.encode(erc20)` over a 32-byte ABI word.

**A3:** decide metadata fallback. Recommendation: bounded 31-byte name/symbol truncation with deterministic address fallbacks, but fail creation if `decimals()` is absent. Defaulting decimals to 18 makes more tokens bridgeable but can materially mislead users.

**A4 — safety objection to “any”:** define support as balance-preserving ERC-20s or approve adapters. Literal permissionless support for rebasing tokens can make portals insolvent; keeping deposit bodies literally unchanged also permits fee-on-transfer undercollateralization. The plan changes only balance guards, not content hashes.

**A5:** specify guardian custody, renounce policy, and maximum pause response time. A compromised withdrawal guardian can freeze every portal after users have burned on L2.

**A6:** approve testnet pool seed amounts and payer. Pre-creation alone does not give fake blue chips a gas route.

**A7:** confirm that mainnet Bridge/Fuel is disabled until the later hardened hub deployment, rather than continuing to expose retired Circle/TestUsdc generations.

**A8:** approve a 24-hour token-list TTL and a bounded manifest-token fallback. The pinned runtime origin remains a centralized availability and poisoning dependency.

## 6. Delivery

| Arc | Phases | Stacked PRs | Review |
|---|---:|---|---|
| A — Feasibility | 1 | TXE publication spike; derivation/content keystones | `/code-review medium` |
| B — Protocol | 2–3 | Factory/clones/router; then ownerless hub and legacy deletion | `/code-review medium` per PR |
| C — Core/tooling | 4 | Manifest/derivation; journal/recovery; routes/conductors | `/code-review medium` per PR |
| D — Faucet | 5 | Token boundary/components; wizard flows; e2e/CSP/mainnet disable | `/code-review medium` per PR |
| E — Cutover/docs | 6 | Candidate/live artifacts and documentation only after canaries | `/code-review medium` |

Each PR is independently reviewable and revertible. Protocol PRs introduce no UI dependency; core accepts the new manifest before the faucet consumes it; the faucet flip occurs only after sandbox smoke; live promotion is last. Reverting code never pretends to revert already-deployed contracts—the prior UI remains disabled or points at the last verified generation.

## 7. Post-implementation

For each arc:

1. Run `/code-review medium --fix`.
2. Feed every actionable finding through a Codex fix loop.
3. Fix demonstrated correctness, security, recovery, test, and documentation gaps; do not add speculative abstractions, compatibility layers for retired contracts, generic registries, or unrelated cleanup.
4. Comments must explain invariants, trust boundaries, domain separation, or non-obvious protocol reasons. Remove comments that restate code, mention phases/plans, narrate edits, or preserve obsolete history.
5. Re-run the arc’s complete validation gate after every fix batch.
6. Repeat review and validation until no actionable finding remains.

After all arcs converge, run one fresh cross-arc `/code-review medium --fix` against the full stacked diff, then the complete Phase 6 gate and owner live-testnet sign-off. Open PRs only after these loops converge. Before any mainnet deployment, separately run `/harden security`; that review is not replaced by the per-arc loops.