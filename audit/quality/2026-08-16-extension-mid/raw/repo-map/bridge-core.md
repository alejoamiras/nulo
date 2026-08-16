# `packages/bridge-core` — Module Map

Scope note: `apps/extension` imports only the `@nulo/bridge-core/fee-juice` subpath (5 files, all in `apps/extension/src/wallet/services/execution/**`). Everything else below is mapped for completeness per your instructions, but section 2 grounds exactly what's extension-reachable, and later sections flag what falls outside that reach.

## 1. Module inventory

### `src/` (library surface)

| Path | Purpose | LOC |
|---|---|---|
| `src/index.ts` | Barrel: `export * from` every non-lazy module (the `.` package export). | 25 |
| `src/flows.ts` | Cross-chain orchestrations: `runRouterDeposit` (Permit2-signed bridge-only deposit via the router's `bridge()`), `consumeWithdrawal` (L2→L1 Outbox consume), `runSwapBridge` (one-tx swap+bridge via `bridgeWithFuel`). Largest, most coupled file. | 428 |
| `src/journal.ts` | The in-flight bridge journal (multi-record, device-local, KV-injected). Deposit/withdraw record schemas, stage derivation, capped/pruned storage. **State owner.** | 275 |
| `src/backup.ts` | Per-record encrypted recovery-file seal/open + strict shape validation of restored records. | 218 |
| `src/recovery-crypto.ts` | Per-record AES-GCM key derivation from an L1 signature; seal/open secrets and deposit envelopes (v2). | 200 |
| `src/candidate-schema.ts` | Zod-strict schema for the deploy manifest (`testnet-bridge.json`/`.candidate.json`). Deploy-tooling only. | 186 |
| `src/l1.ts` | L1 Permit2/`BridgeWitness` typed-data + `hashRoute`/`hashBridgeWitness`, cross-pinned to the Solidity router; `ensurePermit2Allowance` state machine. | 192 |
| `src/router-abi.ts` | Hand-written minimal `SwapBridgeRouter` ABI (`bridge`, `bridgeWithFuel` + events), pinned against the forge artifact by test. | 110 |
| `src/l2.ts` | L2 bridge wrappers: `claimPublic`/`claimPrivate`/`submitPrivateClaim`, `exitToL1Public`/`exitToL1Private`. **No dedicated test file.** | 107 |
| `src/relay-claim.ts` | Pure relayer-claim descriptor parsing/validation + redaction for `scripts/relay-claim-testnet.ts`. | 107 |
| `src/fee-juice.ts` | `predictedWorstMinFees`, `publicFeeJuicePayment`, `sponsoredFeePayment`, `preexistingFeeJuicePayment`, `feeJuiceClaimArgs`, `deploySequenceFeeBudget`. **The sole extension entrypoint.** | 123 |
| `src/fuel.ts` | Direct Fee-Juice L1→L2 bridge primitives (deposit plan, event parse, fail-closed floor check, carrier-less private claim payload). | 98 |
| `src/quote.ts` | Off-chain V4 Quoter `eth_call` chaining for fuel-route pricing + slippage floor math. | 98 |
| `src/private-fuel.ts` | Wonderland PrivateFPC address/salt pin + `deriveBridgeSecret`/`privateFuelSecretHash` + FPC fee-payment method wrappers. | 93 |
| `src/promotion.ts` | Pure validation seams for `live-intent.ts promote` (faucet-candidate shape, zero-seed manifest diffing). Deploy-tooling only. | 84 |
| `src/progress.ts` | `computeProgress` — the shared block-based/time-based progress-bar model. | 86 |
| `src/seal-trust.ts` | Per-wallet "seal determinism" trust cache (skip the self-test signature on a known-good wallet). **State owner.** | 79 |
| `src/l1-receipt.ts` | `awaitL1Receipt` — resilient retry-then-direct-read L1 receipt wait. **Retry primitive.** | 67 |
| `src/reuse-token.ts` | Pure seams for `deploy-bridge-testnet.ts --reuse-token`. Deploy-tooling only. | 64 |
| `src/content-hash.ts` | Pure-TS SHA-256 content hashes mirroring Solidity/Noir (3-toolchain keystone). | 61 |
| `src/route.ts` | `buildFuelRoute` — the fixed two-hop token→WETH→FeeJuice V4 pool route builder. | 54 |
| `src/claim-secret.ts` | Recipient-committed private claim secret derivation (`deriveTokenClaimSecret`), TS mirror of the Noir `claim_secret_lib`. | 51 |
| `src/status.ts` | `depositStatus`/`withdrawStatus` — thin wrappers over `progress.ts` for polling. | 31 |
| `src/artifacts.ts` | Eager-loads the L2 bridge Noir artifacts (`token_minter_proxy`, `token_bridge`) from `../../../contracts/bridge/aztec/**/target/*.json`. | 10 |
| `src/private-fpc-artifact.ts` | Lazy dynamic-import-only re-export of the 2.2 MB `PrivateFPCContractArtifact`, deliberately excluded from the main barrel. | 12 |
| `src/private-fpc-canonical.json`, `src/private-fpc-canonical-mainnet.json` | Canonical PrivateFPC deployment descriptors (data, not code). | — |

Test files (one per module above except `l2.ts`, plus two flow-scenario tests and one artifact tripwire test) total 5,487 LOC across `src/` including tests; non-test `src/*.ts` alone is roughly 2,900 LOC.

### `scripts/` (deploy/ops — brief inventory, extension-reachability marked)

All 27 scripts are **ops-only**; confirmed via grep that `apps/extension` contains zero references to `packages/bridge-core/scripts` (no path, no import). None are excluded selectively — the whole directory is out of the extension's reach and can be excluded from the audit wholesale.

| Script | Purpose |
|---|---|
| `deploy-bridge-testnet.ts` / `deploy-bridge-mainnet.ts` | Full bridge deploy conductors (journal-first, resumable). |
| `deploy-canonical-private-fpc.ts` | Shared PrivateFPC canonical-deploy conductor. |
| `deploy-private-fpc-testnet.ts` / `deploy-private-fpc-mainnet.ts` | Network-specific PrivateFPC deploys. |
| `deploy-sandbox.ts` | Local sandbox full-stack deploy + smoke (deprecated path, excluded from typecheck). |
| `deploy-manifest.ts` | Deploy journal + candidate-manifest writer. |
| `deployer-keys.ts` | Stable, network-keyed L2 deployer identity derivation. |
| `check-fpc-version.ts` | Fail-closed PrivateFPC version/artifact/live-class reconciliation gate. |
| `build-portal-artifact.ts` / `portal-artifact.ts` | F-001 portal-fork artifact build/integrity pins. |
| `discover-mainnet-fuel.ts` | Read-only mainnet Uniswap V4 liquidity discovery. |
| `restore-swap.ts` | Candidate-manifest swap-block restoration step. |
| `live-intent.ts` | Deployment-intent tooling (schema-validated `intent.json`). |
| `deposit-testnet.ts`, `fuel-testnet.ts`, `drip-canary-testnet.ts`, `fee-juice-canary-testnet.ts`, `fpc-dust-canary-mainnet.ts` | Live-network smoke/canary scripts. |
| `smoke-existing-testnet.ts`, `smoke-existing-mainnet.ts`, `smoke-swap-existing-testnet.ts` | Pre-promotion candidate smokes. |
| `relay-claim-testnet.ts` | Live relayer CLI (wraps `src/relay-claim.ts`). |
| `verify-l1.ts` | Etherscan L1 source verification. |
| `script-bootstrap.ts` | Shared L1/L2 client + timer + `--config` manifest bootstrap for the above. |

## 2. Entrypoints / public exports

- **`package.json` `exports`**: `.` → `src/index.ts` (full barrel), `./artifacts` → `src/artifacts.ts`, `./fee-juice` → `src/fee-juice.ts`, `./private-fpc-artifact` → `src/private-fpc-artifact.ts`.
- **What `apps/extension` actually imports** (grep-verified, only 5 files, all the same one symbol):
  - `apps/extension/src/wallet/services/execution/fee/fee-strategy.ts:44`
  - `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:77`
  - `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:30`
  - `apps/extension/src/wallet/services/execution/transfer-estimate-reuse.ts:22`
  - `apps/extension/src/wallet/services/execution/operation-estimate-reuse.test.ts:8` (a `vi.mock`)
  
  All five import only `predictedWorstMinFees` (plus the `MinFeeNode` type) from `@nulo/bridge-core/fee-juice`. `fee-juice.ts` has **zero internal relative imports** — it depends only on `@aztec/aztec.js`, `@aztec/stdlib`, `@aztec/constants`. So the extension's real reachable graph through this package is one self-contained ~124-line file, not the 2,900-line library.
- The rest of the barrel (`.` export: `flows`, `journal`, `l1`/`l2`, `backup`, `recovery-crypto`, `seal-trust`, `route`, `quote`, `router-abi`, `status`, `progress`, `relay-claim`, `private-fuel`, `fuel`, `claim-secret`, `content-hash`, `candidate-schema`) has **no** importer in `apps/extension`.
- `./artifacts` and `./private-fpc-artifact` also have no `apps/extension` importer — they're consumed by `apps/faucet` (`useDeposit.ts`, `apps/faucet/scripts/verify-deployments.ts`).
- Notable near-miss: `apps/extension/src/wallet/services/fpc/service.ts` has a comment referencing "bridge-core's `PRIVATE_FPC_SALT`/`private-fpc-canonical.json`" but does **not** import bridge-core — it independently re-derives the same PrivateFPC address via its own `@private-fpc-artifact` Vite alias, with an explicit comment "layering bars the import here." This means bridge-core's `PRIVATE_FPC_ADDRESS` invariant (`src/private-fuel.ts`) is not actually shared code with the extension at runtime — it's a parallel, comment-linked derivation.

## 3. Coupling surfaces

- **`src/flows.ts` (428 LOC) is the hub**: imports `./claim-secret`, `./l1` (3 symbols), `./private-fuel`, plus 7 distinct `@aztec/*` subpaths and `viem`. It's the only module that mixes L1 (viem) and L2 (aztec.js) primitives in the same file.
- **`src/fuel.ts`** also straddles both layers (imports `./private-fuel`, `@aztec/*`, and `viem`).
- **`src/backup.ts`** couples `./journal` (3 type imports + `isProvisionalWithdrawId`) and `./recovery-crypto`.
- **`src/quote.ts`** and **`src/route.ts`** both depend on `./l1`'s `PoolKey` type; `quote.ts` additionally depends on `./route`'s `FuelRoute`.
- **`src/status.ts`** depends on `./progress`.
- **`src/seal-trust.ts`** depends only on `./journal`'s `KV` type (not the journal logic itself).

**L1 (viem) vs L2 (@aztec) split** (non-test files):
| Layer | Files |
|---|---|
| viem-only | `l1.ts`, `route.ts`, `quote.ts` |
| @aztec-only | `l2.ts`, `artifacts.ts`, `private-fpc-artifact.ts`, `claim-secret.ts`, `relay-claim.ts`, `private-fuel.ts`, `fee-juice.ts` |
| Both (mixed) | `flows.ts`, `fuel.ts` |
| Neither (pure TS/logic) | `backup.ts`, `candidate-schema.ts`, `content-hash.ts`, `journal.ts`, `l1-receipt.ts`, `progress.ts`, `promotion.ts`, `recovery-crypto.ts`, `reuse-token.ts`, `router-abi.ts`, `seal-trust.ts`, `status.ts`, `index.ts` |

Of the extension's reach (just `fee-juice.ts`), the module is @aztec-only — the extension never touches this package's viem surface at all, despite viem being a listed dependency of bridge-core.

## 4. State owners

| Variable / storage key | Owner module | Guard / mutation discipline |
|---|---|---|
| `JOURNAL_KEY = "nulo-bridge:journal:v1"` (in-flight deposit/withdraw records) | `src/journal.ts` | `KV`-injected (caller supplies storage, e.g. `localStorage`). Every mutation (`upsertRecord`, `patchRecord`, `rekeyRecord`, `removeRecord`, `pruneCompleted`) re-reads via `loadJournal` then writes the full set back through `write()` — a per-record read-merge-write to survive concurrent-tab staleness. `capRecords` caps at `MAX_RECORDS = 100`, always evicting completed-oldest-first, never unfinished records (an unfinished private deposit may hold the sole recovery blob). |
| `SEAL_TRUST_KEY = "nulo-bridge:seal-trust:v1"` (per-wallet signing-determinism cache) | `src/seal-trust.ts` | `KV`-injected. Positive-only cache (`markSealTrusted`); provider-fingerprint-scoped (`isCacheableProvider` rejects generic fingerprints "unknown"/"injected"/""); explicit `revokeSealTrust` on unseal failure. |
| `LEGACY_KEYS` (`nulo-bridge-pending-deposit`, `nulo-bridge-pending-withdraw`) | `src/journal.ts` | Dead pre-journal keys, deleted once via `clearLegacyKeys` (no migration, dev-phase decision). |
| In-memory `EncryptionKey` returned from `sealDepositRecord`/`openDepositRecord` | `src/recovery-crypto.ts` | Never persisted by this module — caller-owned, explicitly documented as "must never be persisted." |
| Deploy-conductor journal/candidate manifest state | `src/candidate-schema.ts` (schema) + `scripts/deploy-manifest.ts` (writer) | Ops-only; not extension-reachable. |

None of these state owners are touched by the extension's actual import (`fee-juice.ts` is stateless — pure functions/factories only).

## 5. Dependency graph (one level deep, internal `./` imports only)

```
index.ts        → claim-secret, candidate-schema, content-hash, fee-juice, flows,
                   private-fuel, fuel, l1, l1-receipt, l2, journal, progress,
                   recovery-crypto, relay-claim, seal-trust, status, backup,
                   route, quote, router-abi        (barrel — no logic itself)
flows.ts        → claim-secret, l1, private-fuel
fuel.ts         → private-fuel
backup.ts       → journal, recovery-crypto
quote.ts        → l1, route
route.ts        → l1
status.ts       → progress
seal-trust.ts   → journal (type-only: KV)
```

**No cycles found.** The graph is a clean DAG, layered: `l1.ts`/`journal.ts`/`progress.ts`/`private-fuel.ts`/`claim-secret.ts` are leaves; `route.ts`/`status.ts`/`seal-trust.ts` are one hop up; `quote.ts`/`backup.ts`/`fuel.ts`/`flows.ts` are two hops up; `index.ts` re-exports everything.

`fee-juice.ts`, `l2.ts`, `router-abi.ts`, `content-hash.ts`, `l1-receipt.ts`, `recovery-crypto.ts`, `relay-claim.ts`, `candidate-schema.ts`, `promotion.ts`, `reuse-token.ts`, `artifacts.ts`, `private-fpc-artifact.ts` have **no** internal `./` imports — self-contained leaves.

## 6. Frameworks/primitives

- **viem** surface used: `Abi`, `Account`, `Address`, `Hex`, `PublicClient`, `WalletClient`, `parseEventLogs`, `encodeAbiParameters`, `keccak256`, `toHex` (in `l1.ts`, `flows.ts`, `fuel.ts`, `route.ts`, `quote.ts`). Note: `viem` here is aliased to `npm:@aztec/viem@2.38.2` in `package.json`, not the upstream `viem` package.
- **@aztec** surface used: `@aztec/aztec.js/{addresses,contracts,crypto,fields,node,wallet,abi,fee,ethereum}`, `@aztec/stdlib/{messaging,gas,tx,hash,contract,abi}`, `@aztec/ethereum/contracts` (`OutboxContract`), `@aztec/constants` (`FEE_JUICE_ADDRESS`), `@aztec/foundation/{eth-address,crypto/sync}`, `@aztec/l1-artifacts` (`FeeJuicePortalAbi`), `@alejoamiras/private-fee-juice/{fee-payment-methods,artifacts/private}`.
- **Polling/retry primitives**:
  - `src/l1-receipt.ts` → `awaitL1Receipt`: bounded retry (default 8 rounds × 90s `waitForTransactionReceipt` timeout), falls back to a direct `getTransactionReceipt` read after each timeout (to catch "mined despite timeout" races), 2s pause between rounds, distinguishes revert (throw immediately, non-retryable) from not-yet-mined (retry).
  - `src/status.ts` / `src/progress.ts` → not retry loops but poll-driven progress computation (`withdrawStatus` calls `getProvenBlockNumber()` once per invocation; the caller is expected to re-poll).
  - `src/fee-juice.ts` → `predictedWorstMinFees` has a narrow catch-and-fallback (only for "not found/unsupported method" errors, explicitly NOT for transient RPC errors, which propagate) — a single-shot fallback, not a retry loop.
  - Ops scripts (`smoke-existing-mainnet.ts`'s `retryOnRevert`, `deploy-bridge-mainnet.ts`'s account-deploy retry, `fpc-dust-canary-mainnet.ts`'s claim retry) each hand-roll their own `setTimeout`-based retry loop rather than reusing `l1-receipt.ts` — duplication, but ops-only.

## 7. Test surfaces

- Tests live co-located in `src/*.test.ts` (vitest, `vitest.config.ts` at package root, `environment: "node"`, setup file `src/test/setup.ts` shims `self` for `@nulo/wallet-crypto`'s Web Crypto usage).
- Coverage impression: ~300 `it`/`describe` blocks across the package; nearly every non-test `src/*.ts` file has a matching `*.test.ts`.
- **Untested module: `src/l2.ts`** — no `l2.test.ts` exists. `claimPublic`/`claimPrivate`/`submitPrivateClaim`/`exitToL1Public`/`exitToL1Private`/`assertExitRecipient` have no unit coverage in this package (per the README, they're exercised indirectly by faucet/extension integration + sandbox smokes, not here).
- Two scenario-named tests don't match a module name 1:1: `src/swap.test.ts` tests `runSwapBridge` from `flows.ts`; `src/withdraw.test.ts` tests `consumeWithdrawal` from `flows.ts`. Together with `flows.test.ts`, `flows.ts` (the biggest/most-coupled file) is actually well covered — just split across three files.
- `src/noir-artifact-classids.test.ts` is a supply-chain tripwire, not a unit test of a specific module: it pins the derived class ID + `aztec_version` of the committed `TokenMinterProxy`/`TokenBridge` JSON artifacts that `src/artifacts.ts` loads, plus the installed `@aztec-foundation/aztec-standards` Token/Dripper artifacts — guards against a hand-edited-but-still-valid artifact surviving CI undetected.
- `src/artifacts.ts` and `src/private-fpc-artifact.ts` have no direct unit test file of their own (they're thin re-export/load wrappers); their correctness is covered indirectly by the class-id tripwire above and by faucet-side integration tests.
- `scripts/*.test.ts` (4 files: `deploy-canonical-private-fpc.test.ts`, `deployer-keys.test.ts`, `deploy-manifest.test.ts`, `script-bootstrap.test.ts`) test ops-only conductor logic — out of the extension audit's scope.
- The extension's actual dependency, `fee-juice.ts`, is covered by `src/fee-juice.test.ts` (50 LOC) within this package, and additionally exercised indirectly through `apps/extension/src/wallet/services/execution/operation-estimate-reuse.test.ts` (which mocks the module rather than testing it directly).

## 8. Generated/vendored/fixture code

- `packages/bridge-core/aztec-wallet-data/pxe_data-stores/**/*.mdb` and `packages/bridge-core/aztec-wallet-data/wallet_data-stores/**/*.mdb` — local sandbox PXE/wallet LMDB data files. Git-excluded (`.git/info/exclude:20: aztec-wallet-data/`). Exclude entirely — not source.
- `src/artifacts.ts` statically imports two large generated Noir build artifacts from **outside** `packages/bridge-core`: `../../../contracts/bridge/aztec/token_minter_proxy/target/token_minter_proxy-TokenMinterProxy.json` (1.7 MB) and `../../../contracts/bridge/aztec/token_bridge/target/token_bridge_contract-TokenBridge.json` (2.0 MB, plus a stray `.json.bak` sibling on disk). These are nargo compiler output, not hand-written, and not extension-reachable (only `apps/faucet` imports `./artifacts`).
- `src/private-fpc-canonical.json` / `src/private-fpc-canonical-mainnet.json` — vendored canonical-deployment descriptors mirroring an external publisher's (`@alejoamiras/private-fee-juice`) `canonical-deployment.json`, data not code.
- `src/private-fpc-artifact.ts` re-exports a 2.2 MB artifact from the external `@alejoamiras/private-fee-juice` package (not vendored in-tree, but a large third-party blob deliberately kept out of the eager barrel).
- `.env` / `.env.example` — env template, not code; `.env` itself should not be treated as source of truth (real secrets).

## 9. Apparent duplication

- **README drift, not code duplication, but worth flagging**: `packages/bridge-core/README.md`'s file map still documents `recovery.ts` (does not exist — only `recovery-crypto.ts` exists) and describes `flows.ts`'s `runDeposit` (approve→deposit→poll-claim) as current; the actual code deleted that path (`flows.ts:54` comment: "The direct approve+portal path (runDeposit/depositPublic/depositPrivate) is DELETED — bridge-only now goes through bridge() everywhere") and replaced it with `runRouterDeposit`. The README's "Claim retry budget is 200×3s" invariant also no longer matches any code in `flows.ts` (that polling loop was removed with `runDeposit`). Anyone auditing via the README alone would map a stale surface.
- **Secret-derivation pattern repeated across two modules with parallel structure**: `src/claim-secret.ts` (`deriveTokenClaimSecret = poseidon2HashWithSeparator([salt, recipient], DOM_SEP_A)`) and `src/private-fuel.ts` (`deriveBridgeSecret = poseidon2HashWithSeparator([salt, claimer], DOM_SEP_B)`) are structurally identical (same shape, different domain separator constant, different comment block warning about the same "random-not-deterministic" and "never log the salt" invariants). Not a bug — deliberately separate domain-separated derivations per protocol area — but the two files carry near-duplicate prose and near-duplicate helper shape (`X = poseidon2HashWithSeparator(...)`, `XHash = computeSecretHash(X)`).
- **Retry-loop duplication is ops-only**: `src/l1-receipt.ts`'s `awaitL1Receipt` is the one reusable, tested retry primitive in `src/`, but `scripts/smoke-existing-mainnet.ts`, `scripts/deploy-bridge-mainnet.ts`, and `scripts/fpc-dust-canary-mainnet.ts` each hand-roll their own bespoke `setTimeout`-loop retry instead of reusing it. Not extension-reachable, low priority for this audit.
- **Undeclared dependency**: `src/candidate-schema.ts` imports `zod` (`import z from "zod"`), but `zod` is not listed in `packages/bridge-core/package.json` dependencies (works only via workspace hoisting from other packages that do declare it, e.g. `apps/extension`, `apps/faucet`). Not extension-reachable code, but worth flagging as a package-hygiene gap.

## 10. Error-path hotspots

- **`src/l1-receipt.ts` `awaitL1Receipt`** — the central L1-confirmation resilience mechanism: distinguishes a genuine revert (`assertNotReverted`, thrown immediately, non-retryable) from an RPC timeout that might still be mined (falls back to a direct `getTransactionReceipt` read before retrying), bounded at 8 rounds × 90s + 2s backoff, final failure message explicitly tells the caller the record "stays Pending" and "Retry resumes from the recorded transaction without sending a new one" — i.e., designed around the journal's resumability.
- **`src/flows.ts` `runRouterDeposit`/`runSwapBridge`** — multiple fail-closed guards *before* any irreversible L1 tx: missing `claimSalt`/`fuelSecret`/`tokenClaimSalt` on the private path throws with an explicit "would strand the deposit" message; invalid Aztec recipient (`AztecAddress...isValid()`) is rejected before signing; a `bridge()`/`bridgeWithFuel()` receipt with `status !== "success"` throws explicitly (guards against the "REVERTED but looks like no-Bridge-event" misdiagnosis the code comments say was "hit live during the cutover's rapid back-to-back deposits"); a mined receipt with no matching event throws with a distinct "RPC log gap? re-fetch the receipt" message rather than silently returning undefined leaf indices. Recovery hooks (`onSecret`/`onSecrets`) are invoked **before** the broadcast, by design, so a crash mid-flow leaves a recoverable secret.
- **`src/recovery-crypto.ts` `sealRecordSecret`/`sealDepositRecord`** — round-trip self-test (re-sign, re-derive key, re-open) before trusting a seal, specifically to catch non-deterministic wallet signing; throws "Recovery self-test failed... Aborting before the deposit" rather than proceeding with an unrecoverable seal. `sealDepositRecord` supports a `trusted: true` fast path (skip self-test) gated by `src/seal-trust.ts`'s cache.
- **`src/journal.ts`** — partial-failure/tamper resilience is structural rather than exception-based: `parseRecords` fails closed to `[]` on any parse/shape error (never throws into the caller), `capRecords` guarantees unfinished records are never evicted under storage pressure (explicitly framed against a flood-based eviction attack), and `DepositFuelBlock.claimAttemptAt`/`setupInsufficiency` fields exist specifically to recover a fuel claim stuck in ambiguous "pending" limbo (a receipt that never resolves) by re-enabling retry instead of waiting forever.
- **`src/backup.ts`** — layered validation for untrusted input: `parseBackupFile` → format/version/shape ladder with distinct user-facing messages per failure mode; `validateBackupRecord` is a **strict** per-direction/per-schema validator deliberately separate from the journal's own lenient parser ("the journal's shallow parse filter is for OUR own storage, never for a file someone handed us"); `openBridgeBackup` re-checks every header field against the unsealed record post-decrypt and deliberately reports GCM failure and tamper detection as indistinguishable ("wrong wallet OR tampered/corrupted file") to avoid leaking an oracle.
- **`src/quote.ts`** — `QuoteUnavailableError` is a dedicated error class distinguishing "no route/liquidity/dust" from generic failures, with per-hop error wrapping (`cause: e`) so a multi-hop quote failure names which hop failed.
- **`src/fuel.ts` `assertFuelClearsFloor`** — explicitly fail-closed: an absent or non-positive floor config is itself a hard error ("refusing to bridge (fail-closed)"), called out in the comment as deliberately different from a sibling code path elsewhere that "fails OPEN when the config is absent."
- None of the above error-path modules are in the extension's actual reachable set (`fee-juice.ts` only) — `fee-juice.ts`'s own error handling is narrow: `predictedWorstMinFees` re-throws any RPC error that isn't a recognized "unsupported method" message, so transient RPC failures propagate to the extension caller rather than being retried inside bridge-core.