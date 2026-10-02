# Phase 0 — Foundation (no runtime change) — lessons

2026-08-24, worktree `vitest-on-bun`, base `origin/dev` 6fe41b46, Bun 1.4.0, Node 24.18.0 (nvm), vitest 4.1.10.

## What landed

- `vitest.base.ts` (root, plain object, no imports) with the `deps.interopDefault: false` stopgap + retirement trigger; spread into all 8 existing configs; four new minimal configs (`landing`, `aztec-runtime`, `wallet-bridge`, `wallet-sdk-schema-patch`: `...sharedTest` + explicit `environment: "node"`, nothing else).
- `biome.json` includes `vitest.base.ts` + `scripts/ci-cd/test-soak/**`.
- `scripts/ci-cd/test-soak/`: `cli.ts` (soak/compare/compact; async `spawn` + `detached` process group + timer + group kill; enforced flags last; reserved flags rejected; `--runtime node` = strict grammar + explicit `pre`/`post`), `lib.ts` (pure parse/canonicalize/inventory/compare/compact; pinned `RESOLVE_ALLOWLIST`), `runtime-reporter.mjs` (writes `runtime.json` next to vitest's configured `outputFile` — no env var), `resolve-esm.mjs` (out-of-process, workspace-anchored ESM resolution: `Bun.resolveSync` / two-arg `import.meta.resolve`), fixtures `passing`/`crash`/`hang`/`unhandled-rejection`/`sourcemap` (named `*.fixture.ts` with fixture-local `include`), `lib.test.ts` + `cli.test.ts` (`bun:test`).
- `lessons/baselines/full/.gitignore` (full soak summaries never committed).

## Things the tool taught while being built

- **vitest's JSON `success` ignores escaped unhandled rejections** — the `unhandled-rejection` fixture exits non-zero with `success: true`. This is exactly why `failedRun` includes the exit code; `cli.test.ts` pins it on both engines.
- The `crash` fixture (`process.kill(process.pid, "SIGKILL")` inside a forks worker) is reported by vitest as a failed run on both engines; the `hang` fixture is only ever ended by the tool's group kill (`timedOut: true`, `missingJson: true`).
- The source-map sentinel passes on both engines: the failure message names `sourcemap.fixture.ts:5` under Node AND under Bun.
- Fixture launches go through `apps/landing` (declares vitest) with `--root <fixture>`; `cli.test.ts` also asserts no fixture file matches `bun test`'s discovery pattern.

## Validation gate (as written in plan.md) — PASSED

| Command | Result |
|---|---|
| `bun run lint` | 0 errors (33 warnings / 12 infos, all pre-existing outside the touched files; the touched files report 0 diagnostics) |
| `bun run typecheck:all` | every workspace exit 0 |
| `bun run test:all` (Node, stopgap in every config) | landing 3 · schema-patch 5 · wallet-core 233 · extension-messaging 188 · design 313 · wallet-bridge 210 · wallet-crypto 112 · aztec-runtime 189 · bridge-core 223 (+4 skipped) · faucet 542 · extension 4635 (+2 skipped, 7 todo) — all green, counts identical to the pre-stopgap baseline |
| `bun run --cwd apps/faucet test:e2e` (Node, stopgap) | 3 files / 15 tests green |
| `bun run test:ci-gating` | 37/37 (behavior-gating 7 + soak tool 30: lib 15, fixtures 15 on Node and Bun) |

Interop-stopgap regression check: every suite the aggregate does NOT cover (faucet ×2, bridge-core, landing, design's own run) is green on Node with the flag — I2 verified before any flip.

LESSONS_FILE=implementations-plan/vitest-on-bun/lessons/phase-0.md
