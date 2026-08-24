# Post-implementation review loop — Arc B

## /code-review max --fix (run while the keep/abort codex gate deliberated)

Full code-bearing diff read (24 files, +554/−165; plan docs + lock excluded). Findings, all in NEW code:

- `gen-remappings.ts` `assertEffectiveRemapping`: a `forge --version` spawn failure would surface as a TypeError on `null.split` instead of the real cause → both spawns now guarded (`error` / non-zero status) with the real message. FIXED.
- `resolve-asset` `assertPackageIdentity`: `mustContain.file` was joined without the containment guard `resolvePackageAsset` has → a `../` marker file could read outside the package. FIXED (same lexical containment rule).
- `useOptionalChain` nit in gen-remappings → folded.
- Considered and left alone: `resolvePackageAsset`'s guard compares LEXICAL paths (correct — it detects a caller writing `..`, not symlink targets); `fuel-testnet.ts` keeps `dirname`/`join`/`fileURLToPath` because `here` still builds two other paths.

Verification: resolver 14/14 + tsc · both files lint-clean · `assertEffectiveRemapping("forge")` end-to-end OK — and under the isolated layout the effective remap now points at `packages/bridge-core/node_modules/@aztec/l1-artifacts/...` (the declaring workspace), exactly as designed. Committed separately from implementation commits (ff827403 + the nit follow-up), per protocol.

## Cloudflare Pages previews on the draft PRs — external, non-required, unresolved

Both stack PRs show `Cloudflare Pages: nulo-tools-testnet` = failure while `nulo` (landing) and `nulo-tools-mainnet` (same faucet app, same lock, same deps) = success, and the SAME testnet project succeeds on dev's merged head. So the failure is specific to the testnet faucet project on Cloudflare, not to the lockfile format (B1 has the v1 lock and fails identically) nor to the build logic (a clean-checkout `build:testnet` repro only failed on the scratch dir not being a git repo — `nulo-build-meta` shells `git rev-parse`). The Cloudflare build log is dashboard-only (not readable via API); likeliest cause is `verify:deployments` against the testnet manifest on Cloudflare's runner. NOT a required check; surfaced to the owner for a dashboard look before merge.

## CI round 1 on the stack — the isolated linker found what it exists to find

B2's first CI run failed chrome/firefox/faucet builds + lint/typecheck + e2e with `Rolldown failed to resolve import "@aztec/constants" from packages/aztec-runtime/src/pxe/public-events.ts`. Root cause: **source-level phantom dependencies** the recon inventory (which swept TOOLING, not every workspace's src imports) never covered. A repo-wide import-vs-manifest sweep (scratch `phantom-sweep.ts`; alias/generated/stories false positives filtered) found FOUR real ones, all already-locked `5.0.1` records (manifest edits, not version-line changes): `@aztec/constants` + `@aztec/kv-store` (aztec-runtime, the latter in 4 files) and `@aztec/standard-contracts` (aztec-runtime, extension, faucet — the faucet builds failed on it too). Locally they resolved through the `node_modules/.bun/node_modules` hoist-fallback; on CI's fresh runner the same fallback existed but evidently populated differently — the declarations are correct regardless, and CI is the oracle. Post-fix local: chrome + faucet mainnet/testnet builds, typecheck:all, storybook all green. Also closed codex r2: README cwd fixed; storybook now strips the app's inherited unplugin-vue-components instance so `components.d.ts` survives a storybook build (verified: empty diff, 9 entries intact).

## CI round 2 — a BUILD-INJECTED phantom the source sweep cannot see

Extension chrome/firefox went green on CI after the four declarations; both FAUCET builds still failed: `Rolldown failed to resolve import "vite-plugin-node-polyfills/shims/buffer" from packages/wallet-crypto/src/mnemonic-master.ts`. That file contains NO such import — `nodePolyfills({ globals: { Buffer: true } })` INJECTS it into every transformed module, and rolldown resolves the injected specifier from the module's own location; wallet-crypto doesn't declare the plugin, so under the isolated linker it's unreachable (the hoisted root copy had masked it). The extension config already carried the exact countermeasure — an alias pinning the shim specifier to the app's own copy, with a comment naming this failure mode (recon listed it as a self-healing consumer; it was ALSO a latent bug in every OTHER app using the plugin). Fix: the same alias in `apps/faucet/vite.config.ts` via `@nulo/resolve-asset` (+ the workspace edge). Blind spot recorded in `tools/phantom-sweep.ts`: it reads SOURCE imports; build-time plugin injections must be found by clean-room builds — the CI runner is that clean room.
