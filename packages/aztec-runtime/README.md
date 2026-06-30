# @nulo/aztec-runtime

PXE lifecycle + Nulo's adapter over `@aztec/accounts/schnorr` (`NuloAccount`). Owns class-id verification and payload chunking. Runs inside the offscreen document; the service worker talks to it via `@nulo/extension-messaging`.

## Position in the stack

```
wallet-core  →  wallet-crypto  →  extension-messaging  →  aztec-runtime  →  …
```

Depends on `wallet-core` and `extension-messaging`. Does **not** depend on `wallet-bridge` — the dispatcher must remain transport-shaped, not chain-shaped, so it can live in the service worker while the PXE lives in the offscreen document.

## File map

| Path | Purpose |
|---|---|
| `src/offscreen/entry.ts` | Offscreen-document bootstrap. Wires the PXE and the offscreen-side RPC service. |
| `src/pxe/service.ts` | `PxeService` — long-lived PXE host with chain-coordinator hooks for network add/remove. |
| `src/pxe/client.ts`, `proxy.ts`, `ipxe.ts`, `spec.ts` | Client + proxy + interface for the typed PXE surface across the offscreen boundary. |
| `src/pxe/chain-runtime.ts` | Per-chain PXE runtime. Decoupled from the service so chain creation/teardown is testable in isolation. |
| `src/pxe/artifact-registry.ts` | Caches compiled contract artifacts and verifies their class-id before trusting them. |
| `src/pxe/artifact-class-id.ts` | Class-id verification helper (Aztec spec invariant: the on-chain class id must equal the canonical hash of the artifact). |
| `src/pxe/known-artifacts.ts`, `note-schemas.ts`, `schemas.ts` | Compiled-in artifacts the wallet trusts by default. |
| `src/account/nulo-account.ts` | `NuloAccount` — thin adapter over `@aztec/accounts/schnorr`. Owns signing-key derivation, multicall wrapping, recursive payload chunking, deterministic salt. |
| `src/account/fee-options.ts` | Helpers for fee-payment selection at tx-construction time. |
| `src/adapters/aztec-node-factory-adapter.ts` | The `AztecNodeFactory` adapter — single entry point for constructing `AztecNode` instances. |
| `src/ports/node-factory-port.ts` | Port abstraction the adapter implements. |
| `src/utils/fetch.ts` | Tiny fetch wrapper used by chain-runtime boot. |

## Subpath exports

The package exposes targeted entry points instead of a single barrel:

```
"./"            → src/index.ts
"./pxe"         → src/pxe/index.ts
"./account"     → src/account/index.ts
"./ports"       → src/ports/index.ts
"./adapters"    → src/adapters/index.ts
"./utils"       → src/utils/index.ts
"./offscreen/entry" → src/offscreen/entry.ts
```

## Scripts

| Command | Effect |
|---|---|
| `bun run typecheck` | `tsc --noEmit`. |
| `bun run test` | Unit tests via vitest. |

## Testing

Colocated `*.test.ts`. The end-to-end account behavior is exercised by the extension's network e2e suite (`apps/extension/tests/e2e/network/`) against a real anvil + aztec sandbox.

## Key invariants

- **Use the upstream schnorr account.** There is no custom Noir source in this repo. `NuloAccount` wraps `SchnorrAccountContractArtifact` via `DefaultAccountEntrypoint` and `DefaultMultiCallEntrypoint`. If upstream replaces `deriveSigningKey`'s `DomainSeparator.IVSK_M` derivation (`aztec-packages#5837`), the change is exposed here only.
- **Salt is `Fr.ZERO`.** Account instantiation pins the salt so the address is deterministic from `(seed, index)`. Changing this orphans every existing account.
- **Class-id verification is required.** `artifact-registry.ts` refuses to trust an artifact whose class-id doesn't equal the canonical hash. Treat that as a security gate, not a debuggability aid.
- **Payload chunking is recursive.** Payloads with more than 5 calls are split: each chunk is wrapped via `entrypoint.wrapExecutionPayload()` so every nesting layer gets its own outer-authwit hash. Chunk-size changes ripple through authwit signing — don't tune without re-testing.
- **PXE state is per-chain.** Adding a chain spins up a new chain-runtime; removing a chain tears down its PXE and wipes its IndexedDB. `chain-coordinator` events propagate this across the SW.
- **Pinned aztec versions.** Every `@aztec/*` dep is at the same version (currently `4.2.0`). Mismatched versions cause hard-to-debug failures inside `bb.js` proof generation.
