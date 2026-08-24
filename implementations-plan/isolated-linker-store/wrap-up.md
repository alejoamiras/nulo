# Arc B — wrap-up report (isolated-linker-store)

## What shipped (stack #456 on dev)

- **PR #454 — B1 "layout-agnostic package-asset resolution"** (hoisted-safe hardening, ships on any linker): `@nulo/resolve-asset` (search-path scan over `require.resolve.paths`, manifest-name validation, root containment, `/@fs/` anchor normalization, `assertPackageIdentity` with realpath lockstep); six drifted root-walking resolvers replaced; `noirAliases` de-hardcoded; two source phantoms fixed (`@aztec/sqlite3mc-wasm` — the shipped sqlite asset's source — declared at its existing pin; `zod` in bridge-core); `fuel-testnet.ts` dead renamed-package path fixed; generated + `forge remappings`-asserted foundry remap; `layout-identity.test.ts` (6 assertions incl. patch markers + lockstep); the new workspace registered in every CI paths-filter (the repo's anti-drift guard caught the omission).
- **PR #455 — B2 "isolated linker + exemption-free lockfile regeneration"** (stacked on B1): `linker = "isolated"` with `globalStore` deliberately OFF; 34 aged-out `minimumReleaseAgeExcludes` removed; lockfile regenerated (v2) under the real 7-day gate with a wallet-grade review done on a dry regen first (0 frozen-scope changes; youngest move 7.4d; 0 unprovenanced; advisories 40 → 23); four MORE source phantoms surfaced by CI's fresh runner and declared (`@aztec/constants`, `@aztec/kv-store`, `@aztec/standard-contracts` ×3); one build-INJECTED phantom (the polyfill buffer shim rolldown resolves from workspace-package locations) countered in the faucet config; the one layout consumer the inventory missed (`observability.test.ts`'s root `.bin`) fixed; storybook no longer rewrites `components.d.ts`.

## Measured, honestly

Fresh-checkout cold install (Linux, warm cache): hoisted **1.17s** · isolated per-project store (the committed default) **1.22s — no speed win** · isolated + opt-in global store **0.36s (~4×)**. The blog's 7× is a macOS/global-store figure. The arc's value is **correctness**: eight phantom dependencies eliminated (two of which fed shipped production assets), executable identity guarantees, and a supply-chain-reviewed dependency refresh. The global store is recommended only as a per-user opt-in on trusted single-user worktree-heavy dev machines (`~/.bunfig.toml`) — never CI/shared/release hosts (it lives inside `~/.bun/install/cache/links`, which CI's cache restores).

## Every codex-converged decision

See [decisions.md](decisions.md) (13 rulings with reasoning) — highlights: consumers-first over the hoist-pattern bridge (unanimous, three auditors); the owner's "monkey-patchy" challenge → discovery redesigned onto `require.resolve.paths` and `entry` anchors deleted; flip-first-on-frozen-lock over regen-first; explicit sqlite3mc declaration + lockstep guard over two-hop resolution; wallet-grade regen review classes; KEEP despite the speed thesis failing; `hoist = false` deferred to its own flip-first gate after soak.

## Gates (final tree)

Local: audit:vue (4,619 tests) · test:all (12 suites) · identity 6/6 · resolver 14/14 · build chrome+firefox (0 symlinks/paths in dist; WASM hashes byte-identical to hoisted) · faucet mainnet+testnet · storybook · dev-server `/@fs/` serving · fixture-armed smoke 112/0 · one solo network shard 19/19 · forge build (lib populated). CI: B1 fully green; B2 green after the phantom rounds (final run on the converged head).

## Follow-ups (deliberately not in this arc)

1. `hoist = false` — its own flip-first gate after soak (codex-ruled).
2. Cloudflare `nulo-tools-testnet` preview failure on both PRs — testnet-project-specific (mainnet passes, lockfile format ruled out; owner confirmed CF Pages is on Bun 1.4) — needs a dashboard look.
3. The `@scure/bip39@2.2.0`→1.6.0-line consolidation and the 9 in-lockstep major crossings are documented in `lessons/phase-4.md` for the next Aztec bump's reviewer.
4. Arcs C (vitest-on-bun) and D (Bun-native tooling) per the dossier.
