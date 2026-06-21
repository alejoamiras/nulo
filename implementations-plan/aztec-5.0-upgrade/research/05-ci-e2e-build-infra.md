# Research: CI / E2E / build infra — 4.2.0 → 5.0.0-rc.1

Paths repo-relative.

## Sandbox version coupling
- `.github/actions/setup-aztec/action.yml:18` derives Aztec CLI/sandbox version from `@aztec/aztec.js` pin in `packages/extension/package.json`. Caches at `~/.aztec/versions/<v>`, symlinks `~/.aztec/current`. So bumping the package.json pin **auto-bumps the CI sandbox** — but the installer endpoint must serve `5.0.0-rc.1`: TEST `curl -fsSL https://install.aztec.network/5.0.0-rc.1/install`.
- Build stamp `__AZTEC_VERSION__` from `@aztec/pxe` pin (`packages/extension/vite.shared.ts`).
- Local e2e: `packages/extension/scripts/e2e/agent.sh` + `tests/e2e/global-setup.ts` probe `~/.aztec/current/...`; sandbox version follows the installed CLI. L1-identity reuse check compares L1 contract addresses (global-setup.ts ~197-210).

## Accelerator-server binary — THE BLOCKER
- `.github/workflows/_network-e2e.yml:158` `version: "1.0.1"`, `:167` `expected_sha256: d701837047429334a19cc0d75d8723615c367a9d9d8a531e72fd5e66ccc9a664`.
- Download: `https://github.com/alejoamiras/aztec-accelerator/releases/download/accelerator-v<ver>/accelerator-server-<ver>-linux-x86_64.tar.gz`. Setup action verifies SHA on EVERY run (cache hit too).
- **No 5.0-compatible binary exists.** Binary line latest = v1.0.6, whose notes say it tracks **Aztec 4.3.1**. The `@alejoamiras/aztec-accelerator@5.0.0-rc.1` SDK release ships **no server-binary asset**. Bundled `bb` for 4.3.1 cannot prove 5.0 txs → with `VITE_NULO_ACCELERATOR_REQUIRED=1` the wallet hard-fails (fallback→throw).
- ⇒ "Full network-e2e on real 5.0" REQUIRES first releasing a 5.0-protocol `accelerator-server` binary (user owns `alejoamiras/aztec-accelerator`) + updating version+SHA at `_network-e2e.yml:158-167`. **Top Ask.** Rollback while waiting: `vars.NULO_E2E_DISABLE_ACCELERATOR=1` or `workflow_dispatch disable_accelerator:true` (→ WASM/proverless, advisory).

## Enforcement layers (accelerator)
- Layer 1 (workflow): `/health` preflight @ `127.0.0.1:59833`, assert `bb_available==true`, 30s.
- Layer 2 (wallet): `packages/extension/src/accelerator/config.ts` build stamp + `chain-runtime.ts` required-mode `onPhase` throw on fallback. `agent.sh:78-85` greps build stamp in `dist/chrome`.
- Layer 3 (workflow): advisory `/prove` log scrape (no gate).

## E2E configs / suites
| config | suite | boots sandbox | script |
|---|---|---|---|
| `vitest.e2e.config.ts` | smoke | no (`global-setup-smoke.ts`) | `test:e2e` |
| `vitest.e2e.network.config.ts` | network | yes (anvil+aztec+playground) | `e2e:agent` / `test:e2e:network` |
| `vitest.e2e.all.config.ts` | smoke+network | yes | `test:e2e:all` |
- Network: `hookTimeout: 300s`, retry default 2 (`NULO_E2E_RETRY` override; PR gate uses 0). Parallel-safe ephemeral ports via `scripts/e2e/resolve-ports.ts`; worktree lockfile `.e2e-state/`.
- PR gate (`pr-network-e2e.yml`): 5 SHA-sharded shards (most proverless w/ excludes) + heavy jobs (fee-methods, concurrent-confirm) + **canary** (transfers, tx-sendTx-default) with REAL proving + accelerator ON.

## Patches
`patchedDependencies` (root package.json) = ONLY two:
- `@aztec/noir-noirc_abi@4.2.0` → patch
- `@aztec/noir-acvm_js@4.2.0` → patch

Both rewrite `"module": "./web/..."` → `"exports": {node: "./nodejs/...", default: "./web/..."}` so Node/vitest SSR picks the `nodejs/` wasm (else `__wbindgen_malloc undefined` on darwin). At 5.0: the keys MUST change to `@5.0.0-rc.1`; verify hunks still apply (package.json shape may differ); DELETE if upstream added `exports` itself. `vite.shared.ts` noir alias is belt-and-suspenders for the same issue.

## minimumReleaseAge gate
`bunfig.toml minimumReleaseAge=604800` (7d). 5.0.0-rc.1 published **2026-06-15** (~4d as of 2026-06-19) → **BLOCKS `bun install --frozen-lockfile`** today. Add all bumped `@aztec/*` + accelerator to `minimumReleaseAgeExcludes` (temporary, like puppeteer); follow-up PR removes after it ages out (~2026-06-22). Wonderland/accelerator tgz+npm: tgz URLs bypass the npm-age gate; `@alejoamiras/aztec-accelerator@5.0.0-rc.1` (npm, 2026-06-18) is well inside the window → exclude it too.

## CI gates
- `Quality / Status` (pr-quick.yml) — REQUIRED on main+dev (commitlint, lint, typecheck, unit, build).
- `Smoke e2e / Status` — advisory (required on main per CI.md).
- `Network e2e / Status` — REQUIRED on main; advisory on dev. Cache keyed on `bun.lock` (auto-invalidates on bump).

## Precedent
- `accelerator-server-ci`: repo-pinned SHA is the trust anchor; layered enforcement; `disable_accelerator` rollback.
- `aztec-4.2.0-bump`: re-vendor bb.js wasm, storage migration, patch-key refresh.

## Open questions / risks
1. 5.0 accelerator-server binary (CRITICAL/BLOCKER) — must be built+released+SHA-pinned.
2. `install.aztec.network/5.0.0-rc.1/install` endpoint serves the rc (MEDIUM) — test.
3. noir-wasm patches re-key or remove at 5.0 (MEDIUM) — darwin private-circuit flake if dropped wrongly.
4. min-age excludes hygiene (LOW) — temporary, with follow-up removal PR.
