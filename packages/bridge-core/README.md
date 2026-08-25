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
| `bun run verify:l1 [--config <manifest>] [--dry-run]` | Etherscan source verification of the bridge's L1 contracts for the live testnet manifest (or a `--config` candidate/mainnet one); `--dry-run` builds the standard-json without a key. Needs `forge` (`FORGE_BIN` → PATH → `~/.aztec/current/bin/forge`). The rest of the deploy/verify/canary scripts are the operator runbook in `.claude/skills/aztec-update/SKILL.md`. |

## Key invariants

- **Leaf index from the mined event, never a preflight simulate** (`flows.ts`). A concurrent deposit changes the simulated index, so the claim would retry against the wrong leaf forever. `runDeposit` reads the Inbox `MessageSent` index; `runSwapBridge` reads the `BridgeWithFuel` event's `tokenIndex`/`fuelIndex`.
- **Secrets persisted before the irreversible L1 tx.** A lost claim salt/secret strands funds — `RecoveryHooks`/`SwapRecoveryHooks` fire `onSecret(s)` before broadcast, clear on claim. **A PRIVATE claim is recipient-committed (F-007 closed).** The stored `secret` for a private deposit is a per-deposit `claim_salt`; `claim_private` re-derives the consumption secret from `(claim_salt, recipient)` in-circuit (`deriveTokenClaimSecret` ↔ the Noir `claim_secret` lib, keystone-pinned), so a leaked salt only lets someone claim to the ORIGINALLY-BOUND recipient — a relayer can finish the deposit, never redirect it. The real driver of the recipient-commitment work was the **relayer capability**, not the F-007 fix (which the June red-team rated Low 2.6). Integrators MUST still seal the salt at rest and NEVER log/URL/plaintext-persist it: losing it strands the deposit (sole recovery input), and leaking it reveals the recipient↔amount↔leaf linkage (a privacy loss, not a theft vector). **Two salt rules, distinct risks:** (1) *keep it secret* — a LEAKED salt → the linkage above; (2) *keep it full-entropy-random* (`Fr.random()`, never deterministic/recoverable) — the private deposit's `secret_hash = H(deriveTokenClaimSecret(salt, recipient))` is written to L1 **in the clear** and the amount is public, so a WEAK/low-entropy salt lets an observer brute-force `(salt, recipient)` and **de-anonymize the recipient pre-claim, with no leak at all**. Pinned by `claim-secret.test.ts` (two random-salt deposits to one recipient → different `secret_hash`es). The **public** path stays a raw secret (`claim_public` binds the recipient in its content hash).
- **The Permit2 witness is cross-pinned.** `l1.ts`'s `BridgeWitness` member list + `BRIDGE_WITNESS_TYPE` must stay byte-identical to `SwapBridgeRouter._hashBridgeWitness` (Solidity). `l1.test.ts` pins the hashes; `bridge-evm`'s fork test proves a post-signature tamper reverts.
- **Tests run under vitest, not `bun:test`.** `@aztec/foundation` calls `expect.addEqualityTesters` at import, which `bun:test`'s `expect` lacks — so any test that (transitively) imports `Fr`/`AztecAddress` throws at import. Always `import { … } from "vitest"`. (The vitest suite itself executes on the Bun *runtime* — `bun --bun vitest run` — which is a different thing: vitest's own `expect` is unaffected.)
- **Claim retry budget is 200×3s** (`flows.ts`, `deploy-sandbox.ts`) to tolerate slow/settling sandboxes (72s L2 slots + inbox lag); harmless on a settled sandbox (resolves in the first retries).
- **Scripts spawn other programs ONLY through `scripts/run.ts`** — argv arrays, never a shell string (`run(bin, args)` throws `RunError` on any failure; `{ check: false }` for the callers that interpret a non-zero exit themselves; `resolveBin` finds `forge`/`cast` by one rule: `FORGE_BIN`/`CAST_BIN` override, then PATH or the Aztec toolchain folders). The primitive never formats or retains argv in a failure — `cast` receives `PRIVATE_KEY` as an argument — but argv is visible in `ps` while a child runs, child output is verbatim, and the environment is inherited. Values that reach `git`/`forge`/`cast` are validated first (git behind `--end-of-options`/`--`, manifest addresses through the schema, the key/addresses by shape); argv closes shell injection, not a hostile flag.

See [`implementations-plan/faucet-bridge/`](../../implementations-plan/faucet-bridge/) for the plan + lessons, and `SwapBridgeRouterPermit2Fork.t.sol` (bridge-evm) for the real-V4/Permit2 swap proof.
