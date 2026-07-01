# Updating `@aztec/*` and Noir

The checklist for bumping the Aztec / Noir dependency line. **`@aztec/*` is exact-pinned and bumped manually** (outside the 7-day min-age policy — see [`SECURITY.md`](./SECURITY.md) and [`CLAUDE.md`](./CLAUDE.md) § Dependency policy). A bump touches WASM resolution, native proving, on-chain identity invariants, and a runtime schema patch — none of which the type-checker or unit tests fully cover, so this doc is the human re-check list.

> **Convention:** any code that types against an `@aztec` shape (a PXE method signature, a wire type, an artifact field) MUST add an entry to **§ Types coupled to `@aztec` shape** below, with `file:line`, so the next bump has a checklist. Round-2 phase R4 (P18b PXE descriptor) is the first to append here.

Current line: **`@aztec/* = 5.0.0-rc.1`** (Noir wasm packages `noir-acvm_js` / `noir-noirc_abi` carry Bun patches — see below).

## Before you bump
1. Read the upstream `@aztec/aztec.js` + `@aztec/pxe` changelog for the target version — note any renamed/removed exports, PXE method signature changes, or artifact-format changes.
2. Bump the exact pins in EVERY workspace `package.json` (root + `packages/*` + `apps/*`) — they must all match. `@aztec/*` does not go through `bun update --latest` cleanly (Bun #25305); prefer editing the pins + a clean re-resolve (delete `bun.lock`, `bun install`) if transitives drift.
3. Also bump the `packageManager` Bun version drift check if the upgrade requires it.

## Coupling points to re-verify (the re-check list)
1. **Bun patches on Noir wasm** — `patches/@aztec%2Fnoir-acvm_js@<ver>.patch` + `patches/@aztec%2Fnoir-noirc_abi@<ver>.patch`. The patch filenames pin the version; on bump they must be re-generated/re-verified against the new package or they silently stop applying. Confirm `bun install` still applies them.
2. **Noir WASM resolution (darwin arm64 + browser)** — `apps/extension/vite.shared.ts:63` aliases `@aztec/noir-acvm_js` to the package's `nodejs/` entry (fixes `__wbindgen_malloc undefined`); `apps/extension/vite.config.ts:79` `dedupe` + `:286` `optimizeDeps.exclude` list the noir/bb wasm packages. If the package's internal entry layout changes, these paths break — re-check the `nodejs/` path exists.
3. **On-chain identity invariants** — `packages/aztec-runtime/src/pxe/artifact-class-id.ts` (class-id derivation) + the deferred class-id + address invariant fixture. A protocol-version bump can change contract class ids / addresses; re-derive and update the fixture, and confirm the account-contract + token artifacts still resolve.
4. **`WalletSchema` runtime patch** — `packages/wallet-sdk-schema-patch/src/{apply,register}.ts` extends `@aztec/wallet-sdk`'s `WalletSchema` with `registerToken` / `isTokenRegistered` / `grantPublicAuthwit`. If upstream changes `WalletSchema`'s shape or those method names, `apply.test.ts` + the wallet-bridge reachability pin (`packages/wallet-bridge/src/dispatcher.test.ts`) will catch it — but re-check the patch still composes.
5. **PXE seam** — `packages/aztec-runtime` PXE factory + client. PXE method signatures are an `@aztec` coupling surface; see § Types coupled to `@aztec` shape.
6. **Native proving (accelerator)** — the network-e2e installs `accelerator-server` (SHA-256-pinned in `.github/workflows/_network-e2e.yml`); a proving-backend bump may need a matching accelerator build. `VITE_NULO_ACCELERATOR_REQUIRED=1` makes a silent WASM fallback a hard fail.

## Types coupled to `@aztec` shape
> Append here whenever you type against an `@aztec` type. Format: `- <type/signature> — <file:line> — <what breaks if the upstream shape changes>`.

_(seeded empty — R4/P18b populates the PXE descriptor couplings.)_

## After you bump — validation gate
- `bun run typecheck:all` (exit 0 — verify by exit code + grep, not `| tail`).
- `bun run test` (units) + `bun run build`.
- `bun run test:e2e` (smoke) + `bun run e2e:agent` (FULL network — includes the real-proving canary; a WASM fallback is a hard fail).
- Confirm the class-id/address fixture still matches (coupling #3).
