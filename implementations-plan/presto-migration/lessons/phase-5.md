# Phase 5 — arc-1 docs + residue (2026-09-15)

## What landed

- `CLAUDE.md`: the dependency-policy line names `@alejoamiras/presto` in the pin surface; the "outside repos by name" example is the Presto native app; the network-e2e paragraph describes the headless `presto-server` (two pins, single-member rule, `PRESTO_ALLOW_ALL=1`, plaintext loopback in CI only), `VITE_NULO_PRESTO_REQUIRED=1` and the fallback-class phases that throw, the `canary` shard's `PROVE_SUCCESS` and subtitle assertions, the production HTTPS-only posture, and the `NULO_E2E_DISABLE_PRESTO` / `disable_presto` rollback, linking `CI.md § Presto in CI`.
- `.claude/skills/aztec-update/SKILL.md`: the fork-class bump note names `VITE_NULO_PRESTO_REQUIRED`.
- `apps/extension/tests/e2e/network/sim-methods.test.ts`: the header no longer points at a retired plan folder (the fixture-migration rationale stays).
- `bunfig.toml`: the exclude comment says "the retired accelerator SDK" instead of the package name.

Everything else on recon.md's doc list was already rewritten in P3 (`CI.md`, `SECURITY.md`, `.github/README.md`, `apps/extension/tests/e2e/README.md`, the `e2e-testing` and `aztec-update` skills) and P4 (`ARCHITECTURE.md`, `UPDATE.md`, codex-notes 05/10).

## Intentional residue (the plan's two exceptions)

- The product name "Aztec Accelerator" / "the retired accelerator SDK" in the coexistence notes of `CI.md` and `SECURITY.md` (and the `bunfig.toml` comment). The gate greps identifiers (`aztec-accelerator`, `accelerator-server`, `ACCELERATOR_`), not the product name.
- The arc-1 shim's file names (`useAcceleratorStatus.ts` / `.test.ts`, `onboarding/pages/accelerator.vue`, the `accelerator` route + testids) until P7 replaces them.

## Gate

| layer | command | result |
|---|---|---|
| lint | `bun run lint` | exit 0 |
| brand guard | `bash scripts/check-no-brand.sh` | `ok: no legacy brand/path strings found`, exit 0 |
| residue | `git grep -n "aztec-accelerator\|accelerator-server\|ACCELERATOR_" -- . ':!CHANGELOG.md' ':!implementations-plan' ':!audit' ':!bun.lock'` | 0 hits (grep exit 1) |
