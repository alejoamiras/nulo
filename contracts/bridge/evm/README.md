# bridge-evm (Foundry)

L1 contracts for the Nulo any-ERC-20 bridge. Aztec L1 interfaces resolve to the installed
`@aztec/l1-artifacts` sources via the `@aztec/` remapping in `foundry.toml` — no
`aztec-contracts` submodule needed (the version matches `packages/bridge-core`'s pin).

## Dependencies (not committed — see `.gitignore`)

`lib/` is gitignored. Install before building — at the COMMITS CI pins (`_bridge-contracts.yml`),
not floating tags:

```bash
forge install \
  foundry-rs/forge-std@bf647bd6046f2f7da30d0c2bf435e5c76a780c1b \
  OpenZeppelin/openzeppelin-contracts@cab19933c33c2ad1d4c7a84864a3601dddfd16f3 \
  Uniswap/v4-core@e50237c43811bd9b526eff40f26772152a42daba
```

> **v4-core MUST be `@v4.0.0`** (commit `e50237c4…`). The fuel contracts (`UniswapFuelSwap.sol`,
> `PoolSetupHelper.sol`) use the pre-1.0 `IPoolManager.SwapParams` /
> `ModifyLiquidityParams` API; v4-core ≥1.0.0 moved those structs. OZ is pinned to 5.7.0 for
> `Clones.cloneDeterministicWithImmutableArgs` + `ReentrancyGuardTransient`.

## Build / test

The `@aztec/` remap resolves through `packages/bridge-core`'s installed `@aztec/l1-artifacts`.
Under the repo's isolated linker that package is NOT at the repo-root `node_modules` the static
`foundry.toml` remap assumes, so generate the override file first (gitignored; `verify-l1.ts`
does this automatically):

```bash
# from this directory (contracts/bridge/evm):
bun --cwd ../../../packages/bridge-core scripts/gen-remappings.ts   # writes ./remappings.txt
forge build
forge test --no-match-contract Fork                                  # hermetic (CI)
SEPOLIA_RPC_URL=… AZTEC_REGISTRY=… forge test --match-contract Fork   # live Sepolia (opt-in; two suites skip without the registry)
forge build --ast --force && halmos --match-contract '^Formal'       # symbolic proofs (CI)
forge snapshot --match-test test_gas_ --no-match-contract Fork --check   # .gas-snapshot (CI)
```

## Contracts

- **`PortalFactory`** — creates one storage-less **portal clone per ERC-20** (OZ `Clones` with the
  token as an immutable arg, salt = the token address) and sends the L2 hub a `register` message
  carrying `(token, portal, nameWord, symbolWord, decimals)`. Idempotent; permissionless; the
  factory is the message's L1 sender. Its owner is the **guardian**: two pause bits (deposits,
  withdrawals — a delay, never a transfer of funds) behind `Ownable2Step`, renounce disabled.
- **`TokenPortalImpl`** — the implementation every clone delegates to. Canonical `TokenPortal`
  content hashes byte-for-byte (`ContentHash.t.sol` + the Noir keystone), plus guards that never
  touch the hashed preimage: pause bits, `amount ≤ uint128.max`, exact-in (fee-on-transfer refused),
  exact portal-debit on withdraw, transient reentrancy guard. No storage, no initializer.
- **`SwapBridgeRouter`** — Permit2 witness-bound periphery: `bridge()` (token → its clone, or the
  fee asset → the canonical `FeeJuicePortal` for direct gas) and `bridgeWithFuel()` (a slice swapped
  to Fee Juice through `UniswapFuelSwap`, the remainder into the token's clone; `fuel == total` is
  fuel-only; an empty route is the fee asset's identity swap). Creates the clone inline on a
  token's first bridge, **before** the Permit2 pull.
- **`UniswapFuelSwap`** — V4 multi-hop, hookless, WETH↔ETH unwrap restricted to the last boundary.
- `MintableERC20` / `TestUsdc` — capped-mint test tokens (testnet only, see INFO-1).

## Tests

**140 hermetic forge tests** (`forge test --no-match-contract Fork`), **12 halmos proofs**
(`FormalRouterTest 8 · FormalFactoryTest 2 · FormalCloneTest 2`, each with a
forge canary proving its complementary case is observable), **live Sepolia fork suites** (real registry/Inbox/FeeJuicePortal, real
Permit2, real V4 pools, live token metadata), and a committed `.gas-snapshot` for the metered
first-time vs known `bridge()` calls.

| Layer | Suites |
|---|---|
| unit | `PortalFactory`, `SwapBridgeRouter`, `Keystone` (3-way vectors with Noir + TS), `ContentHash`, `WitnessHash`, `RouteValidation` |
| fuzz | `PortalFactoryFuzz`, `CloneRoundtripFuzz`, `SwapBridgeRouterFuzz`, `RouteGrammarFuzz` |
| invariant | `PortalFactoryInvariant`, `SwapBridgeRouterInvariant` (handler drives create/pause/bridge/fuel-only/identity/donate/sweep/rotate) |
| symbolic | `FormalFactory`, `FormalClone`, `FormalRouter` — see the header of each for what halmos can and cannot model (it has no sha256, so `createPortal` itself is forge-only) |
| adversarial | `BlackhatFactory` (F-1…F-8), `BlackhatAudit` (F-A…F-M), `BlackhatV4Fork` |
| fork | `FactoryFork`, `SwapBridgeRouterPermit2Fork`, `DeployFuelLive.fork`, `MainnetFuel.fork`, `BlackhatV4Fork` |

## Threat model — the factory-bound portal

The router never trusts a caller-supplied portal. On every entrypoint the legal `tokenPortal` is
**derived from `bridgeToken`** before any funds move:

| entrypoint | legal `tokenPortal` |
|---|---|
| `bridge()` | `factory.predictPortal(bridgeToken)` (created inline if absent), **or** the canonical `feeJuicePortal` iff `bridgeToken == FEE_ASSET && !isPrivate` (direct gas) |
| `bridgeWithFuel(fuel < total)` | `factory.predictPortal(bridgeToken)` only — a partial fee-asset remainder must never enter the `FeeJuicePortal` (it would mint gas, and its private deposit does not exist) |
| `bridgeWithFuel(fuel == total)` | `address(0)`, with `aztecRecipient == 0 && tokenSecretHash == 0` |

A signed intent naming anything else reverts with `ForeignPortal()` / `FuelOnlyLeg()` **before the
Permit2 pull**, so the old generic-router phishing surface (a hostile portal stranding the pulled
amount in the router) no longer exists: `check_bridge_rejectsForeignPortal` proves it for every
portal address, `BlackhatAudit` F-I/F-J/F-K exercise look-alike clones, hand-rolled fakes, the
partial-into-FeeJuicePortal shape and fuel-only smuggling, and the Sepolia fork shows a refused
intent does not even burn its Permit2 nonce.

What a clone trusts: the factory it was cloned from (immutable `FACTORY = msg.sender`, whose pause
bits it reads), the Aztec registry the factory bound at construction (Inbox/Outbox/version are
implementation immutables), and its own token (an immutable arg in its bytecode — nothing to
repoint, no initializer to front-run). What the factory reads from a token is sampled once, gas-
capped and bounded: a hostile `name()`/`symbol()` can only poison the two cosmetic words (sanitized
to printable ASCII, frozen at creation, never trusted for anything but display), a missing
`decimals()` refuses the portal, and a front-runner creating a token's portal first produces the
byte-identical portal, registration and message the honest caller would have (`BlackhatFactory`
F-1…F-8). The remaining trust is the guardian (a pause is unbounded in time by design — it can
freeze deposits or withdrawals indefinitely, but never move funds) and the router owner's
`setSwapTarget`/`sweep` (the target is in the signed witness and cannot rotate mid-bridge; sweep
reaches only donated residue).

## Value-token hard-blockers (MUST clear before any non-testnet deployment)

- **INFO-1 — `MintableERC20` / `TestUsdc` are not value tokens.** `mint` is permissionless (capped
  per tx) and every holder is treated as having granted canonical Permit2 infinite allowance.
  Faucet-by-design and **not** a theft path (Permit2 still needs the holder's signature), but a
  severe footgun if copied to a real asset. A value deployment MUST use a token with
  access-controlled mint and no forced allowance.
- **Rebasing tokens are unsupported** (the clone's reserve accounting assumes a static balance);
  fee-on-transfer tokens are refused on chain.
