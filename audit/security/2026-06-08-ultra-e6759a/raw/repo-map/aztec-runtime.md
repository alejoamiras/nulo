# Security Map: packages/aztec-runtime

Aztec SDK glue layer. ~4,489 LOC across 22 source files.

## Module inventory

| Subdir | Purpose | Language | LOC |
|---|---|---|---|
| `src/pxe/` | PXE lifecycle, artifact registry, class-id verification, note schema management, service RPC plumbing | TypeScript | ~3,490 |
| `src/account/` | `NuloAccount` adapter (Schnorr account wrapping), payload chunking, fee-option helpers | TypeScript | ~662 |
| `src/adapters/` | `AztecNodeFactoryAdapter` (sole node creation seam) | TypeScript | ~40 |
| `src/ports/` | `NodeFactory` interface (DI boundary for node construction) | TypeScript | ~52 |
| `src/utils/` | Timeout-bounded fetch for RPC calls | TypeScript | ~198 |
| `src/offscreen/` | Offscreen document bootstrap (PXE service wiring) | TypeScript | ~47 |

## Entrypoints (public API)

**Main exports via subpath entries:**

- `./pxe`: `PxeService`, `ChainRuntime`, `ChainRuntimeRegistry`, `ProductionPxeFactory`, `ArtifactRegistry`, artifact/note schema loaders, class-id verifier.
- `./account`: `NuloAccount`, `IAccountContract` interface, fee-option helpers.
- `./adapters`: `AztecNodeFactoryAdapter`.
- `./ports`: `NodeFactory` (interface).
- `./offscreen/entry`: `createPxeOffscreen()` — entry point for offscreen bootstrap.

**Key factories:**
- `NuloAccount.new(secret: Fr, logger)` — wraps `@aztec/accounts/schnorr`, derives signing key via `deriveSigningKey(secret)`, pins salt to `Fr.ZERO`.
- `ProductionPxeFactory.createChainRuntime(network: NetworkInfo)` — constructs `AztecNode` + `PXE` pair per chain. Optionally enforces accelerator availability via `required` flag.
- `AztecNodeFactoryAdapter.createNode(rpcUrl)` — **sole call site** for `createAztecNodeClient()`.

**Zod-validated inputs:** `TxExecutionRequest`, `ContractArtifact`, `ContractInstanceWithAddress`, `NotesFilter`, `AccessScopes` all parsed before use.

## Trust boundaries

### PXE node URL handling ⚠️

- `AztecNodeFactoryAdapter.createNode(rpcUrl: string)` receives URL without validation of scheme or origin.
- URL is directly passed to `createAztecNodeClient(rpcUrl, {}, makeFetchWithTimeout())`.
- **No allowlist, no scheme restriction** — accepts any HTTP(S) URL the extension provides via `NetworkInfo.rpcUrl`.
- Fetch has **timeout enforcement** (60s default via `makeFetchWithTimeout`) and **retry+backoff** but **no hostname/TLS validation** (delegated to platform fetch).
- **Risk:** A compromised network coordinator could inject a malicious RPC URL; downstream verification (class-id checks) mitigate but don't prevent early-stage snooping.

### Account secret-key input

- `NuloAccount.new(secret: Fr, ...)` accepts a bare `Fr` (field element).
- **No validation** that the input is a valid scalar in the Schnorr subgroup — relies on caller to ensure `secret` is correctly derived.
- Secret is used directly in `deriveSigningKey(secret)` (upstream call) and stored as instance field.
- **Risk:** If a malformed or zero `Fr` is passed, downstream signing becomes non-deterministic or fails.

### Transaction payload deserialization

- `TxExecutionRequest` inputs deserialized via Zod schema `TxExecutionRequest.schema.parseAsync()` in `proveTx()` and `simulateTx()`.
- Payload structure is validated; no arbitrary bytecode execution — the payload is a structured `ExecutionPayload` with validated function calls.
- **Payload chunking** (recursive split at `APP_MAX_CALLS = 4`) is applied transparently; chunk-count tuning changes authwit hashes.

### Network/ChainId selection

- `ChainRuntimeRegistry.getOrInit(network: NetworkInfo)` uses `network.rpcUrl` and `network.chainId` directly.
- **No `L1ChainId` validation** — the wallet trusts the `NetworkInfo` provided by the service worker.
- If the dApp or extension injects a false `chainId`, the wallet will construct an account with the wrong chain context (incorrect `ChainInfo`).
- **Risk:** No per-profile/per-account allowlist of acceptable chains.

### Contract artifacts & class-id verification ✅

- `ArtifactRegistry.resolve(classId, source)` calls `verifyArtifactClassId()`, which recomputes the artifact's class-id and compares to expected.
- **Verification is mandatory** — if class-id mismatches, the artifact is rejected and the next source is tried.
- Known artifacts (12 protocol + standards) are **compiled-in** — never fetched or mutated at runtime.
- **The HTTP artifact registry was removed** — dApps must call `aztec_registerContract({ artifact })` to register non-bundled contracts.

### Note discovery & decryption

- `getNotes(filter)` returns `NoteDao[]` from the PXE's private note index.
- Notes are decrypted inside the PXE (client-side) — the wallet never trusts raw encrypted note material from the node.
- **Risk:** The PXE trusts nullifier membership proofs from the node (used in `requiresInitialization` checks). A lying node could claim a nullifier is unspent when it isn't, causing account double-initialization.

## Dependency graph

**Workspace imports:**
- `@nulo/wallet-core` — types, logger, storage, base service framework.
- `@nulo/extension-messaging` — RPC service base classes (`Service`, `OffscreenService`).

**External dependencies (all @ 4.2.0 unless noted):**
- `@aztec/accounts`, `@aztec/aztec.js`, `@aztec/bb.js`, `@aztec/pxe`, `@aztec/entrypoints`, `@aztec/protocol-contracts`, `@aztec/simulator`, `@aztec/foundation`, `@aztec/stdlib`, `@aztec/noir-contracts.js`
- `@defi-wonderland/aztec-standards@4.2.0-aztecnr-rc.2`
- `@wonderland/aztec-fee-payment` — external (tarball) FPC package
- `@alejoamiras/aztec-accelerator@4.2.0` — proof acceleration (optional)
- `zod@^3.23.8`

**Consumers:**
- `@nulo/wallet-bridge` — dispatches wallet SDK calls to PXE service via offscreen RPC.
- `@nulo/extension` — loads offscreen, passes network/profile info.

## Frameworks

Heavy `@aztec/*` usage: PXE client/bundle, account/schnorr, entrypoints/account, stdlib/contract artifact validation, foundation/curves Fr.

Service framework: `@nulo/wallet-core/base`, `@nulo/extension-messaging`.

## Test surfaces

**Unit tests (3 files, ~280 LOC):**
- `pxe/service.test.ts` — PXE service methods, chain guard, artifact resolution, error paths.
- `pxe/chain-runtime.test.ts` — PXE factory, node creation, accelerator modes.
- `account/fee-options.test.ts` — fee-option completion and gas-settings edges.

**Integration via extension:**
- `packages/extension/tests/e2e/network/` — real anvil + aztec sandbox.

**Gaps:**
- Class-id verification indirectly tested via artifact resolution; no standalone unit tests.
- No dedicated payload-chunking edge cases (payloads with 500+ calls, deeply nested wraps).

## Generated / vendored / dev-only

Dev-only: `*.test.ts`, `tsconfig.json`, vitest config. No vendored or generated code; artifacts are static imports from upstream packages.

---

**Summary:** Thin orchestration layer over `@aztec/*`. Primary trust boundary: **node RPC URL injection** (no scheme/origin validation) and **artifact verification enforcement** (well-guarded via class-id recompute). No custom cryptography or proof logic. Fee-payment system and payload chunking introduce per-transaction logic that ripples through signing; changes must be regression-tested.
