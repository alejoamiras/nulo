# Phase 5 — CI job for the suite (+ TXE attempt)

## What was done

- `_bridge-contracts.yml` gained `integration` (setup-bun → `setup-aztec` at the pin `packages/bridge-core/package.json` declares for `@aztec/aztec.js` — its own cache key, distinct from the hub crate's Nargo pin — → Foundry 1.7.1 + the same pinned forge libraries as the `forge` job → `gen-remappings` + `forge build` → `bun run --cwd packages/bridge-core test:integration`; `timeout-minutes: 45`; sandbox logs uploaded on failure) and `txe` (`setup-aztec` at the `Nargo.toml` pin → `contracts/bridge/aztec/scripts/run-txe-tests.sh`).
- `bridge-contracts.yml`'s `changes` filter lists every dependency literally per the guard: `contracts/bridge/**`, `packages/bridge-core/**`, `packages/{wallet-crypto,wallet-core,resolve-asset}/src/**` + their `package.json`, `apps/tools/public/*-bridge.json`, `patches/**`, `bun.lock`, `package.json`, `bunfig.toml`, the two workflow files, `setup-aztec` and `setup-bun`. `scripts/ci-cd/behavior-gating.test.ts` pins the bridge graph.

## Gate

- `bun run lint:actions` → exit 0.
- `bun run test:ci-gating` → 93 pass, 0 fail (8 files).
- CI proof at Delivery: `integration` green on the arc-2 PR at retry 0.

## TXE attempt

`contracts/bridge/aztec/scripts/run-txe-tests.sh` with the installed 5.0.1 toolchain: **65 tests passed, exit 0** (`txe-phase5.log`) — the oracle server boots from the committed `txe-server` mini-project and the hub crate's whole `src/test/` suite runs. The `txe` job stays in `_bridge-contracts.yml`; if it fails on the runner for toolchain reasons the evidence goes here and the job is dropped in the fix loop.

## Findings worth keeping

- The measured suite: 32 tests in ≈23 min on this host with two other sandboxes running beside it (≈14 min alone for the 26 pre-fee-state tests); the 45-minute job budget covers a slower runner plus the ≈2-minute boot and the forge build.
- Two Aztec toolchains in one workflow are fine as long as each job's `setup-aztec` cache key carries its own version; the `integration` job must never share the `noir`/`txe` jobs' 5.0.1 install.
