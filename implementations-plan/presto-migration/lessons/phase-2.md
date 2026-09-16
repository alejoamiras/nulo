# Phase 2 — runtime swap, config, manifest, shim (2026-09-15)

## What landed

- `chain-runtime.ts`: `PrestoProver`; `PrestoEndpoint {host, port, httpsPort}`; `ProveBackend` / `ActiveProve` / `ProvePhaseEvent` / `ProvePhaseObserver`; `httpsOnly: !required` passed explicitly on both arms (plaintext derives from the mode, no option exists); the per-runtime `onPhase` runs the required guard first, then advances `runtime.activeProve` and calls the observer inside `try/catch`; `advanceProve` exported (pure, tested); `ChainRuntime.activeProve`; preflight names `reason` + `diagnosis`; `[presto-required]` prefix. The observer closure reads a `let runtime` assigned after `createPXE` — the prover is built before the runtime exists.
- `src/accelerator/config.ts` → `src/presto/config.ts` (`PRESTO_HOST/PORT/HTTPS_PORT`, `PRESTO_REQUIRED`, `NULO_PRESTO_REQUIRED_BUILD_STAMP`); `offscreen/index.ts` passes `httpsPort` in required mode; `entry.ts` comments.
- `src/presto/client.ts`: memoized `getPrestoClient()` with explicit `httpsOnly: true`; `PrestoStatusClient` for injection (+ test).
- Arc-1 shim: `useAcceleratorStatus` keeps `idle | detecting | not-detected | no-bb | active`, `detect({forceRefresh})`, `info`, over `client.checkStatus`; `accelerator.vue` → `https://presto.build/`, Presto copy (the two approved lines), Windows note + gating removed, retest passes `forceRefresh: true`, testids unchanged.
- Manifest: `https://127.0.0.1/*` added; A5 dev `key` emitted only when `env.mode === "development"` (chrome config; the public key's derived id is `gponbolnnkmjaafcnoeckiplpehdfgml`; the private key was generated in-shell and never written anywhere).
- `vite.config.ts` accelerator alias removed (I2: Presto's `exports` resolve cleanly, no alias needed); accelerator dependency removed from both `package.json`s and the lockfile.
- `agent.sh` renamed to `VITE_NULO_PRESTO_REQUIRED` + `NULO_PRESTO_REQUIRED_BUILD_STAMP` here (plan listed it under P3) because the stamp literal moved in this phase and the local prover-ON path must not break between phases.
- Tests: `chain-runtime.test.ts` rewritten (default/required/observer/proverless, 21 cases); `presto-policy.test.ts` drives the real `presto-core` `prove()` with a stubbed `fetch` (three HTTPS-failure shapes, the only HTTP request is `GET /health`); shim composable test with an injected fake client; smoke `onboarding-tab.test.ts` intercepts the HTTPS probe and aborts both ports for "not detected".

## I9 — resolved

Puppeteer request interception answers `https://127.0.0.1:59834/health` before any TLS handshake: the new probe case fetches the URL from the onboarding page and receives the stubbed body. No page-level override needed.

## Gate

| layer | command | result |
|---|---|---|
| unit (runtime) | `bun run --cwd packages/aztec-runtime test` | 26 files / 218 tests passed |
| typecheck | `bun run typecheck:all` | every workspace exit 0 |
| lint | `bun run lint` | exit 0 (three formatter diffs fixed with `biome format --write`) |
| unit (extension) | `bun run test` | 473 files / 5777 tests passed |
| build | `bun run build` | exit 0; `host_permissions` = `["https://nulo.sh/","https://127.0.0.1/*","http://127.0.0.1/*"]`, `.key` = `null` |
| dev build (A5) | `bunx vite build --mode development -c vite.chrome.config.mts --outDir <scratch>` | exit 0; `.key` is a string |
| smoke e2e | `cd apps/extension && bun run test:e2e -- tests/e2e/onboarding-tab.test.ts` | 7/7 passed (I9 probe, mock-active, not-detected, skip pins) |
| residue | `grep -rn "aztec-accelerator\|AcceleratorProver\|ACCELERATOR_" packages apps --include='*.ts' --include='*.vue' --include='*.mts'` | 0 hits |

Notes: the tool shell's cwd drifted into `apps/extension` after a `cd` there — `bun run lint` / `typecheck:all` from that directory report a different script set; every gate command was re-run from the worktree root.
