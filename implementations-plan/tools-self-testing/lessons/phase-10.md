# Phase 10 — CI for the tools suite; the extension's dead tools plumbing; docs

## What was done

- `.github/actions/setup-playwright/action.yml`: the browser cache keyed on `apps/tools/package.json`
  (the exact `@playwright/test` pin lives there); `install --with-deps chromium` on a miss, deps only
  on a hit.
- `.github/workflows/_tools-e2e.yml` (`workflow_call`: `ref`, `shard`, `shard_label`): setup-bun →
  setup-aztec at bridge-core's pin → the same Foundry + forge-lib pins as `_bridge-contracts.yml` →
  forge build → setup-playwright → `bun run e2e:tools -- --shard=<shard>`; 30-minute cap; traces +
  sandbox logs uploaded on failure.
- `.github/workflows/pr-tools-e2e.yml` (`name: Tools e2e`): the `tools-e2e` filter is positive-only
  and literal per dependency (the tools graph's `src/**` + `package.json`, `contracts/bridge/**`,
  `packages/bridge-core/**`, root config, `patches/**`, the two workflows, the three actions); the
  `e2e:tools` label (with `labeled`/`unlabeled` triggers) or a dispatch forces a run; 4 shards;
  `tools-e2e-status` is the exact-state aggregator, `pull-requests: read` on `changes`, `fetch-depth: 0`.
- `scripts/ci-cd/behavior-gating.test.ts`: the new workflow joins the negation scan, the aggregator
  pin (`tools-e2e-status`) and gets its own graph test (`assertGraphCovered(…, "tools")` + the
  contracts, the harness package and the pipeline's own files).
- The extension runner no longer knows the tools app: `TOOLS_DEV_PORT`, `toolsUrl`, `ports.tools`,
  `pids.tools` and the tools dev-server block are gone from `agent.sh`, `resolve-ports.ts` (five ports
  now), `global-setup.ts`, `lockfile.ts`, `reap.ts`, and the e2e README.
- Docs: `CI.md` (the gate table row + `### pr-tools-e2e.yml` + the check-names list), `CLAUDE.md`
  (the local gates table, the CI bullets, the advisory-gates sentence in § Branching),
  `apps/tools/README.md` § Tests, `apps/tools/tests/browser/README.md`, `.github/README.md`.

## Gate

_(`bun run lint:actions` + `bun run test:ci-gating` + `bun run --cwd apps/extension test:e2e`)_
