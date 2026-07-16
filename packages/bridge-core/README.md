# @nulo/bridge-core

Framework-agnostic L1↔L2 bridge logic for the Nulo Faucet→Bridge — pure TypeScript over
`viem` (L1) + `aztec.js` (L2). No React, no Vue, no server. The bridge frontend's composables
and the sandbox deploy script drive these functions; the proven reference for every flow is
`scripts/deploy-sandbox.ts --smoke`.

## File map (`src/`)

| File | Purpose |
|---|---|
| `l1.ts` | L1 witness/route hashing — the Permit2 `BridgeWitness` typed-data + `hashRoute`/`hashBridgeWitness`, cross-pinned to `SwapBridgeRouter` (Solidity) in `l1.test.ts`. |
| `l2.ts` | L2 bridge wrappers — `claimPublic`/`claimPrivate` (consume an L1→L2 deposit) + `exitToL1Public`/`exitToL1Private` (start an L2→L1 withdraw). |
| `flows.ts` | Cross-chain orchestrations: `runDeposit` (mint→approve→deposit→poll-claim), `consumeWithdrawal` (proven→witness→Outbox consume), `runSwapBridge` (sign Permit2 witness→`bridgeWithFuel`→read leaf indices). Stage callbacks drive the loading bar; `RecoveryHooks` persist secrets before irreversible txs. |
| `fee-juice.ts` | `publicFeeJuicePayment` (`FeeJuicePaymentMethodWithClaim` — claim bridged FJ + pay gas in one tx) + `sponsoredFeePayment` (bootstrap FPC) + `feeJuiceAddress`. |
| `fuel.ts` | Direct Fee-Juice bridge primitives (the **Fuel** flow): `FeeJuicePortalAbi` re-export, `planPublic`/`planPrivateFuelDeposit` (deposit args + secret derivation), `parseFeeJuiceDeposit` (the portal's `DepositToAztecPublic` event), `buildCarrierlessFuelClaimPayload` (the zero-app-call private claim), and the fail-CLOSED `assertFuelClearsFloor`. |
| `status.ts` | Deposit (time-based) + withdraw (proven-block polling) progress for the blocks-remaining bar. |
| `recovery.ts` / `recovery-crypto.ts` | Persist + resume in-flight deposits (the secret is the only claim preimage); AES-GCM/PBKDF2 reused from `@nulo/wallet-crypto`. |
| `content-hash.ts` | 3-toolchain (Solidity/Noir/TS) content-hash keystone vectors. |
| `progress.ts` | Shared progress helpers. |

## Scripts

| Script | What |
|---|---|
| `bun run test` | vitest — 41 tests (pure fns + mocked-L1 orchestrations). |
| `bun run typecheck` | `tsc --noEmit`. |
| `bun run deploy:sandbox [--smoke]` | Deploy the full L1+L2 stack to a local aztec sandbox; `--smoke` runs deposit public/private + withdraw public/private end-to-end. Env-pointed via `SANDBOX_L1_RPC` / `SANDBOX_NODE_URL` (default `:8545` / `:8080`). |
| `scripts/deploy-closure.sh [--verify]` | Build an isolated single-version **@aztec 5.0.1** closure to run the deploy scripts (see below). |

## Deploy closure (single-version @aztec 5.0.1)

The nulo workspace is mid-migration: bridge-core pins `@aztec/* 5.0.1` while the rest of
the monorepo still pins 5.0.0. In a hoisted bun workspace that produces **two physical
copies** of the shared `@aztec` libs (foundation/stdlib/constants/ethereum) — root 5.0.0,
nested 5.0.1 — and two copies of the same class crash the moment `@aztec/stdlib`'s
`block_hash.js` constructs `GENESIS_BLOCK_HEADER_HASH`:
`Type 'object' ... passed to BaseField ctor`. So the deploy scripts (`deploy-sandbox.ts`,
`deploy-bridge-testnet.ts`, …) **cannot run from the workspace tree** as-is.

`scripts/deploy-closure.sh` builds a throwaway mini-workspace **outside** nulo's
`package.json` graph and **outside** nulo's `bunfig.toml`, containing bridge-core plus the
two `@nulo` packages it imports (`wallet-crypto`, `wallet-core`) with their `@aztec` pins
rewritten to 5.0.1. Every package agrees on one `@aztec` version → **exactly one physical
copy** → no crash. Because the closure has no bunfig, nulo's 7-day supply-chain
`minimumReleaseAge` gate does not apply there (the real control in `nulo/bunfig.toml` is
left untouched) and there are no `patchedDependencies` to collide with an all-5.0.1
resolution.

```bash
# build + verify (single-copy check, tsc, dry runtime import — NO deploy)
AZTEC_STANDARDS_DIR=<clone>/aztec-standards packages/bridge-core/scripts/deploy-closure.sh --verify

# then run a deploy script FROM the closure (needs the real artifacts + L1 keys):
cd .deploy-closure/bridge-core
BRIDGE_EVM_OUT=<repo>/contracts/bridge/evm/out \
BRIDGE_EVM_ROOT=<repo>/contracts/bridge/evm \
BRIDGE_AZTEC_DIR=<repo>/contracts/bridge/aztec \
AZTEC_STANDARDS_DIR=<clone>/aztec-standards \
bun scripts/deploy-sandbox.ts --smoke        # local sandbox; testnet uses deploy-bridge-testnet.ts
```

The closure dir (`.deploy-closure/`, gitignored) is transient — re-run the script after
any source change. The env vars point the copied scripts back at the real repo artifacts
(they default to a repo-relative layout that doesn't exist from the closure dir).
`AZTEC_STANDARDS_DIR` must hold a **transpiled** `target/token_contract-Token.json` (run
`aztec compile src/token_contract` in the aztec-standards clone once).

## Key invariants

- **Leaf index from the mined event, never a preflight simulate** (`flows.ts`). A concurrent deposit changes the simulated index, so the claim would retry against the wrong leaf forever. `runDeposit` reads the Inbox `MessageSent` index; `runSwapBridge` reads the `BridgeWithFuel` event's `tokenIndex`/`fuelIndex`.
- **Secrets persisted before the irreversible L1 tx.** A lost claim preimage strands funds — `RecoveryHooks`/`SwapRecoveryHooks` fire `onSecret(s)` before broadcast, clear on claim. **A PRIVATE claim is bearer** (the content hash omits the recipient): whoever holds the secret can claim to any recipient. Integrators MUST seal it at rest and MUST NEVER log it, place it in a URL, or persist it in plaintext — a leak makes the deposit→claim window front-runnable. (Recipient-commitment, which binds the recipient on-chain, is backlog.)
- **The Permit2 witness is cross-pinned.** `l1.ts`'s `BridgeWitness` member list + `BRIDGE_WITNESS_TYPE` must stay byte-identical to `SwapBridgeRouter._hashBridgeWitness` (Solidity). `l1.test.ts` pins the hashes; `bridge-evm`'s fork test proves a post-signature tamper reverts.
- **Tests run under vitest, not `bun:test`.** `@aztec/foundation` calls `expect.addEqualityTesters` at import, which `bun:test`'s `expect` lacks — so any test that (transitively) imports `Fr`/`AztecAddress` throws at import. Always `import { … } from "vitest"`.
- **Claim retry budget is 200×3s** (`flows.ts`, `deploy-sandbox.ts`) to tolerate slow/settling sandboxes (72s L2 slots + inbox lag); harmless on a settled sandbox (resolves in the first retries).

See [`implementations-plan/faucet-bridge/`](../../implementations-plan/faucet-bridge/) for the plan + lessons, and `SwapBridgeRouterPermit2Fork.t.sol` (bridge-evm) for the real-V4/Permit2 swap proof.
