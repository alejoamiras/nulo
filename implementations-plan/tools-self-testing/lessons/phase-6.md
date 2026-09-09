# Phase 6 — `local` ToolsTarget, loader, local build, drip record, transport fix

## What was done

- `network-targets.ts`: `ToolsTargetKey += "local"`, a pure `localTarget(cfg)` factory, `webWalletUrls` on the target type (only the local target lists any), and a `__NULO_LOCAL_TARGET__` define guard — `resolveToolsTarget()` builds the local target only when the bundle defined it; every other build and vitest fall back to testnet, so the local branch is dead code in the shipped bundles.
- `local-target-loader.ts` (Node-only): reads a sandbox run's `handle.json` / `manifest.json` / `deployments.json` and produces the target + config; `vite.local.config.mts` feeds `makeToolsConfig(target, { manifestJson, localConfig })`, which `define`s the config and, for the local target only, serves the generated CSP (with `frame-src` for the wallet origins) from `vite preview`.
- `network.ts`: `foundry` (31337) joins the viem chain map. `createAztecWalletSession.ts`: `webWallets.urls` from the target. `useAddDripToken.ts`: `Unknown wallet method` (the iframe transport's answer for a schema-less wallet) maps to `unsupported` like `Unsupported wallet method`; a unit test pins it.
- `verify-build-target.ts` takes `--dist <dir>` and resolves the local target through the loader.
- **No target-aware drip record was needed**: the sandbox's Dripper + NULO/OLUN are universal deploys (deployer ZERO, fixed salts, identical constructor args), so they land at the addresses `apps/tools/src/contracts/deployments.json` already commits — verified byte-for-byte (`jq -S` diff empty). The browser suite asserts that equality in its global setup rather than carrying a second record.

## Gate

- `bun run --cwd apps/tools typecheck` → clean; `bun run --cwd apps/tools test` → 1252 pass (96 files); `bun run --cwd apps/tools test:e2e` → 29 pass.
- Local build (`NULO_SANDBOX_ARTIFACTS=<sandbox-deploy> NULO_TOOLS_WEB_WALLETS=… bun run build:local -- --outDir <dir>`): `verify-build-target local --dist <dir>` → `✓ … matches target local (chainId 3686003978; local-bridge.json digest verified)`; the bundle contains the node URL (1 file) and the wallet URL (1 file); `_headers` carries the CSP with the loopback `connect-src`.
- `build:testnet` and `build:mainnet`: node URL 0 files, wallet URL 0 files, no `local-bridge.json` in `dist`, no `foundry` chain reference.

Re-run on 2026-09-09 after the wallet-priced fee change: `typecheck` clean; `test` 1252 pass (96
files); `test:e2e` 29 pass (3 files); every browser run's `build:local` + `verify:build-target local`
prints `matches target local (chainId 3686003978; local-bridge.json digest verified)` and the two
bundle greps pass; `build:testnet` and `build:mainnet` built clean with 0 files naming the node URL,
0 naming the test wallet, no `local-bridge.json`, 0 mentioning `foundry`.

## Findings

- viem's `foundry` Chain names no `contracts.multicall3`, and the wizard's L1 balance reads are multicalls: the first real selection on the local build threw `ChainDoesNotSupportContract` and bounced the wizard to the token step with no visible error (found by the spike). The local chain now declares the canonical, chain-invariant Multicall3 address the sandbox installs.
- `build:local` is a production-mode bundle: `checkBuildIntegrity` runs with `isProd: true`, so the preview must be served at exactly the `host` the config names (`127.0.0.1` by default) and the post-mount node probe is fatal on a mismatch — both are what the suite wants.
- The mint cap on `MintableERC20` bounds fixture minting per call; the harness mints in bounded chunks where it matters.
