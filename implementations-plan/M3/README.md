# M3 — Package Extraction (~4-6 weeks)

## Overview

M3 splits the monolithic `packages/extension/` into 7 bun workspace packages. All M2 work is complete (0.12.4). The architecture plan's prerequisite ("services constructable with fake ports") is met.

## Package dependency graph

```
@nulo/wallet-core            (no deps)
    ↑
@nulo/wallet-crypto          (wallet-core + @aztec/stdlib/keys for signing key derivation)
@nulo/extension-messaging    (wallet-core + chrome-types + zod)
    ↑                            ↑
@nulo/aztec-runtime          (wallet-core + wallet-crypto + extension-messaging + @aztec/*)
@nulo/wallet-bridge          (wallet-core + extension-messaging + @aztec/wallet-sdk)
@nulo/extension-ui           (wallet-core + vue + pinia)
    ↑                            ↑                ↑             ↑              ↑
@nulo/extension              (everything above — thin MV3 shell)
```

## Extraction order

| # | Package | Days | Prerequisite |
|---|---|---|---|
| M3.1 | `@nulo/wallet-core` | ~5 | — |
| M3.2 | `@nulo/wallet-crypto` | ~3-4 | M3.1 |
| M3.3 | `@nulo/extension-messaging` | ~4-5 | M3.1 |
| M3.4 | `@nulo/aztec-runtime` | ~5 | M3.1 + M3.2 + M3.3 |
| M3.5 | `@nulo/wallet-bridge` | ~4-5 | M3.1 + M3.3 |
| M3.6 | `@nulo/extension-ui` | ~5 | M3.1 |
| M3.7 | Thin shell + boundary enforcement | ~3-4 | All above |

M3.2, M3.3, M3.6 can proceed in **parallel** after M3.1 lands.
M3.4 and M3.5 can proceed in **parallel** after their respective prereqs land.
M3.7 is the final pass after all 6 extractions.

## Key build-system decisions (pre-resolved for all plans)

**Source-first exports**: Extracted packages expose `./src/index.ts` (TypeScript source) via the `exports` field. The extension's Vite build processes all packages as source — no per-package compile step during development. This avoids per-package vite build orchestration and is the simplest path for a monorepo where the extension is the sole bundler.

**`@/` alias strategy**: Within each extracted package, files use relative imports. The extension's `@/` alias continues to map to `packages/extension/src/`. Cross-package imports use the package name: `@nulo/wallet-core`, `@nulo/extension-messaging`, etc.

**Auto-import preservation**: `useComponents` and `useAutoImport` Vite plugins are updated to include the extension-ui directories so developer ergonomics (no explicit imports for UI primitives) are preserved.

**WASM shim stays in extension**: The `bb-fetch-code.ts` shim and `dedupe` config live in the extension's `vite.config.ts` and apply transitively to all workspace packages during the extension's Vite build.

**Chrome types**: Packages that use `chrome.*` types include `chrome-types` in devDependencies and set `"types": ["chrome-types"]` in tsconfig. Tests provide the chrome global via `@webext-core/fake-browser`.

## Critical invariants (do not break)

- KDF labels (`nulo:kdf:v1`, `nulo:master:v1`, `nulo:profile:v1`) — never change values
- Passkey RP ID `nulo.sh` — stays in extension/passkey spec
- AES-GCM ciphertext format — stays in wallet-crypto, tested by M2.6 vectors
- M2.6 crypto vectors must pass before and after M3.2

## M3 exit criteria

- `bun run test:all` passes across all packages
- `bun run typecheck:all` zero errors  
- `bun run check:deps` zero boundary violations (dependency-cruiser)
- `bun run build` clean Chrome + Firefox builds
- E2E smoke: register, unlock + send, dApp sendTransaction
- M2.6 crypto vectors still pass in `@nulo/wallet-crypto`
