# Recon — isolated-linker-store (Arc B, in progress)

Blueprint mid. Base: stacked on `worktree-bun-1.4-bump` @ b6e5920e (PR #452, green). Machine bun: 1.4.0. Parent dossier: [adoption-map.md](../bun-1.4-adoption/adoption-map.md); strategy pre-consult: [pre-arc-consults.md](../bun-1.4-adoption/lessons/pre-arc-consults.md).

## Part 1 — Isolated-linker / global-store semantics (changelog-verified reference, agent-extracted; quotes verified against the 1.4 release text)

- **Layout**: isolated = symlinked per-workspace `node_modules` + a `node_modules/.bun/` store; with the global virtual store, packages extract once into Bun's machine cache and are symlinked into each project's `.bun` store (one `symlink()` per package on warm installs). `node_modules/.bun/node_modules` is a documented "hidden fallback directory" for undeclared requires.
- **Hoist controls** (bunfig `[install]` or .npmrc; bunfig wins on key conflict): `publicHoistPattern = [globs]` → matching TRANSITIVES hoisted to the real root `node_modules` (visible to every workspace); `hoistPattern = [globs]` → controls what lands in the `.bun/node_modules` fallback; `hoist = false` → disables the fallback entirely (phantom `require()` = `MODULE_NOT_FOUND`, pnpm parity; 1.4.0-new).
- **configVersion**: our lockfile already records `configVersion: 1`; existing lockfiles never auto-flip linker. Opt-in = `linker = "isolated"` in bunfig (replacing our pinned `"hoisted"`).
- **⚠️ CORRECTION to the pre-arc consult**: the changelog does NOT say patched packages are excluded from the global store. It says the opposite direction: `patchedDependencies` cache entries participate in a SHARED install cache, now keyed by full-file SHA-1 (fixing cross-project patch contamination), and isolated installs no longer re-apply patches per peer-variant. → The plan must NOT rely on "patched noir stays project-local" as a documented guarantee; instead the identity gate verifies empirically WHERE the patched `@aztec/noir-*` files land and that patch markers are present post-install.
- **⚠️ Documentation gaps that become plan-time verification items** (nothing to cite, must be probed): (a) NO documented concurrency/atomicity guarantee for the global store under simultaneous installs (the codex pre-consult's "atomic renames, ignored staging trees" claim traced to uncited docs — treat as unverified); (b) the global store / cache PATH is undocumented (no env var/flag surfaced in the changelog; `install.globalStore` exists as a bunfig key only via a bug-fix mention — syntax/default undocumented); (c) hardlink-vs-symlink split per step is not fully specified (`--backend` default hardlink; global-store fast path documented as symlink).
- Windows junction fallback + cross-filesystem copy fallback + fail-fast on integrity errors are documented. Store dir names sanitize URL query chars.

## Part 2 — Layout-sensitive consumer inventory

_Pending: explorer running (first attempt died on a transient API entitlement error; retried). Will be appended verbatim when it lands._

## Immediate plan-shaping consequences

1. Consumers-first strategy (pre-consult) stands, but the patched-package leg of the identity gate is now EMPIRICAL, not doc-backed.
2. The three-step matrix (hoisted → isolated/local store → isolated/global store) needs an explicit probe for `install.globalStore` on/off syntax (undocumented — discover against the real binary) and a concurrency smoke (two simultaneous installs into the shared store from two scratch projects) since no doc guarantee exists.
3. `hoist = false` is the END-state strictness step, not the first flip (matches pre-consult).

## Part 2 — Layout-sensitive consumer inventory (explorer report, verified file:lines)

**Break-mechanism taxonomy** (drives every risk rating):
- **A. Walker** (`while (dir !== dirname(dir))` probing `<dir>/node_modules/<pkg>`): survives isolated IF the package is a DIRECT dep of the calling workspace (first-level hit); never benefits from the `.bun/node_modules` fallback.
- **B. Hardcoded literal** (`../../node_modules/...`, remap strings): breaks unconditionally on flip; no resolver involved.
- **C. Real resolution** (`import` / `createRequire().resolve`): correct if declared; phantom deps ride the `.bun/node_modules` fallback until `hoist = false`.

### Findings by severity

| Sev | Site | Pattern | Package | Problem |
|---|---|---|---|---|
| **CRITICAL** | `apps/extension/vite.config.ts:245-253` (`sqlite3mc-wasm-emit` inline walker; its own comment says "hoisted install ⇒ the repo root hit") | A + phantom | `@aztec/sqlite3mc-wasm` | Declared by NO workspace (transitive via `@aztec/kv-store@5.0.1`, itself a direct dep of apps/extension). Walker gets no fallback → build breaks on the first flip, no config knob saves it. |
| **CRITICAL** | `packages/bridge-core/scripts/fuel-testnet.ts:181-198` | B | `@alejoamiras/aztec-fee-payment` | Hardcoded `../../../node_modules/` path to the PRE-RENAME package name (now `private-fee-juice` per `src/private-fpc-canonical.json:2`); `node_modules/@alejoamiras/` contains no such dir — already dead code TODAY, independent of the linker. |
| **HIGH** | `apps/extension/vite.shared.ts:64-67` (`noirAliases`) → consumed by `vitest.e2e.network.config.ts:2,10` + `vitest.e2e.all.config.ts:2,12` | B | `@aztec/noir-{acvm_js,noirc_abi}` | Hardcoded `../../node_modules/`; both are direct deps of apps/extension → trivial fix via the resolver in the same file. |
| **HIGH** | `contracts/bridge/evm/foundry.toml:14` (`"@aztec/=../../../node_modules/@aztec/l1-artifacts/l1-contracts/src/"`) | B | `@aztec/l1-artifacts` | Static remap to root node_modules; foundry does no walking. Forge invoked ONLY manually via `packages/bridge-core/scripts/{verify-l1.ts,portal-artifact.ts}` (no CI workflow runs forge). `@aztec/l1-artifacts` IS declared by bridge-core. |
| **MEDIUM** | `packages/bridge-core/src/candidate-schema.ts:8` (`import z from "zod"`) | C + phantom | `zod` | Not in bridge-core's package.json; on the barrel export (`src/index.ts`) + 4 scripts → transitive graph of every bridge-core consumer. Survives first flip via `.bun/node_modules` fallback; breaks at `hoist = false`. Fix: declare `zod ^4.4.3` (matches every other workspace). |
| Hygiene | 6 independent copies of the walker: `vite.shared.ts:22-31` (canonical), `bridge-core/scripts/check-fpc-version.ts:59-68`, `bridge-core/src/private-fuel.test.ts:33-42`, `aztec-runtime/src/pxe/opfs-store.test.ts:31-40`, `extension/scripts/extract-bb-wasm.ts:37-51`, `vite.config.ts:245-253` | A | — | Drift risk: fixing one and missing a sibling reproduces the exact class of bug. Consolidate. |

### Self-healing under isolated (verify-only; all Pattern A on DIRECT deps — first-level hit)

`vite.shared.ts:48-49` (`@alejoamiras/private-fee-juice`, `@aztec-foundation/aztec-standards` artifacts) · `vite.config.ts:40,50` (`@alejoamiras/aztec-accelerator`, `vite-plugin-node-polyfills` shim) · `check-fpc-version.ts:130,131,207` + `private-fuel.test.ts:85-136` (`private-fee-juice`) · `opfs-store.test.ts:49` (`@aztec/pxe`) · `extract-bb-wasm.ts` (`@aztec/bb.js`, both build + dev-server middleware paths).

### Already layout-agnostic (SAFE)

`bridge-core/scripts/portal-artifact.ts:56` + `verify-l1.ts:36` — `createRequire().resolve("@aztec/l1-artifacts/package.json")`, declared dep, symlink-aware.

### Clean sweep results

All other vite/vitest configs (faucet ×5, landing, playground), `.storybook/*`, extension scripts + all e2e infra, faucet/landing scripts, root `scripts/**`, all workflows/actions: NO repo-node_modules hardcoding. CI caches only `~/.bun/install/cache` (+aztec/puppeteer/tsbuildinfo) — never a workspace `node_modules` → CI needs no cache migration. Extension vite-plugin import surface: no phantoms. Out of scope confirmed: every `~/.aztec/versions/**/node_modules` path (separate aztec-up toolchain); `theme-vars.ts:60` (dir-skip guard); `apps/faucet/node_modules/viem` (pre-existing conflict-nesting: faucet's real `viem` vs bridge-core's `npm:@aztec/viem` alias — informational); vite `resolve.dedupe` entries (Vite's own resolver, direct deps).

### Punch list (priority order)

1. CRITICAL sqlite3mc-wasm phantom → declare `"@aztec/sqlite3mc-wasm": "5.0.1"` as an explicit apps/extension dependency (same pin already in-tree via kv-store; NOT a version-line change — flag at the gate) or publicHoistPattern bridge.
2. CRITICAL fuel-testnet.ts → fix package name + shared resolver (pre-existing bug fix).
3. HIGH noirAliases → resolver-based.
4. HIGH foundry remap → repath to bridge-core's node_modules, generated remappings, or hoist-pattern bridge.
5. MEDIUM zod → declare in bridge-core.
6. Hygiene: ONE shared resolve-asset helper (exports-map-safe: resolve an exported entry via createRequire anchored at the declaring workspace, walk up to matching package.json, append asset path; walker fallback for exports-blocked packages).
7. Verify-only: the self-healing set, post-flip, via identity assertions (realpath + declaring workspace).
