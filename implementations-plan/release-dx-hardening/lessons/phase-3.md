# Phase 3 — Faucet chain-identity hardening + build metadata

## What shipped
- **`src/lib/chain-constants.ts`** (NEW) — single source of truth for the testnet identity (L1 `11155111`, rollup `4239416255`, wallet chainId `4229590296`). Plain numbers, no `@aztec` import → importable from both the app bundle AND `vite.config.ts` (Node). Commit `cefbac33`.
- **`chain-info.ts`** — **dropped the `VITE_CHAIN_*` env path** (the durable bug-killer); imports the constants; keeps `?chainId=&version=` URL override for the e2e driver only. + `env.d.ts` dead types removed + `.env.example` stale `VITE_CHAIN_VERSION=4127419662` removed. `chain-info.test.ts`: 6 vitest cases incl. a bug-pin (`11155111 ^ 4127419662 = 4138294185`). Commit `cefbac33`.
- **`vite.config.ts` build-meta plugin** — emits one `buildId` (`<version>+<gitSha>`) into BOTH `index.html` (`<meta name="nulo-build">`) and `dist/build.json` `{ buildId, version, chainId: 4229590296 }`. This is what Phase 5's `verify-live` reads: the HTML↔JSON buildId match defeats a split CDN cache, and the `chainId` proves the live faucet serves the chain the wallet expects.
- **README** — env table updated (removed the dead `VITE_CHAIN_*`), documented the constant + the build metadata.

## Root cause, killed at the source
`.env.example:32` literally shipped `VITE_CHAIN_VERSION=4127419662`; prod CF was seeded from it; `chain-info.ts` honored the env over the source default → wallet matcher computed `4138294185` → "No network configured". Dropping the env path means a stale dashboard value can never shadow the code again.

## Single-sourcing note (known minor)
`scripts/release/chain-guard.ts` (release tooling) still keeps its OWN copy of the canonical `4239416255`/`4229590296`. Truly single-sourcing across the `scripts/` ↔ `packages/faucet/` boundary would need a shared `@nulo/*` package (out of scope). The agreement is instead enforced at release time by `verify-live` (asserts the LIVE faucet `build.json.chainId === 4229590296`), and both `chain-guard.test.ts` + `chain-info.test.ts` pin the same value.

## Gate result — GREEN
- `bun run --cwd packages/faucet vitest run src/lib/chain-info.test.ts` → 6/6.
- `bun run --cwd packages/faucet build` → `dist/build.json` `chainId=4229590296` + `index.html` meta, buildIds MATCH.
- `bun run --cwd packages/faucet typecheck` → exit 0; biome clean on all changed files.
- `bun run --cwd packages/faucet test:e2e` → 14/14.
- (carried from Phase 2) the `bump-minor` empirical dry-run + stateful rc fixtures remain Phase 4 (test repo).
