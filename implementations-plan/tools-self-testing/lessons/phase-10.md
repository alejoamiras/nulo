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
  `e2e:tools` label (with `labeled`/`unlabeled` triggers) or a dispatch forces a run; 6 shards (from the phase-9 durations);
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

## Cross-arc codex pass (plan § Delivery)

**Round 1** (GPT-6 Astra, `high`, a fresh session over the net diff `036709d8..HEAD` with the plan, every lessons file and the six cross-arc questions) — verdict **"Not ready"**, 3 findings, all adopted:

| # | Finding | Call |
|---|---|---|
| 1 | the wizard's gas gates (`useGasShare`) and the deposit flow's budget checks (`privateCreditFee`, `privateFpcFee`, `ownGasFee`) priced the DECLARED gas constants while submission clamps them to the network's per-tx limit — on the sandbox (DA 55,882 vs the declared 100,000) a claim the FPC accepts was refused on screen, and the harness's `walletCeiling` (clamped) and the app's gate disagreed; generous funding in cells 1–4 masked it | real → every ceiling prices `clampGas(limits)` (a `clampedOwnGasCeiling` beside the harness's own arithmetic); cell 1 funds its credit to the ceiling EXACTLY so the boundary is what the suite proves |
| 2 | `required-checks.sh labels` provisions only the two extension labels while arc 3 advertises `e2e:tools`, and the morning sequence never runs `labels` | real → `e2e:tools` added; the sequence's first line is `labels` |
| 3 | docs promised superseded behaviour: the bridge-core README's "unproven-exit refusal" (cell 32 is positive-only) and the old artifact path / smoke wording; CI.md and the workflows README omitted the `integration` + `txe` jobs; MORNING.md had "a few PRs" for the plan's clean-week promotion | real → all four aligned, the promotion paragraph carries the `--add` command |

**Round 2** (same session, `high`, on `7ffae78b`) — verdict: **"Ready for the stack — no new material findings."** The cross-arc pass converged here. Its one non-blocking residue (the bridge-core README still counted "seventeen flows (+ one optional private-FPC flow)") is fixed: the smoke is one battery and the private-FPC flow is not optional. Its reading of the integration-vs-browser fee deductions — each suite asserts the policy it actually submits under, neither claims equality with the other — stands as recorded.

Confirmed sound by round 1: the `@nulo/bridge-core/sandbox` surface the browser suite consumes is a real export; no overlapping L1 writers between the two suites; the harness's uncapped probe vs the app's proposed cap (with the note that integration-suite and browser deductions need not be equal — arc 2 supplies an unpadded cap in-process, the browser's stock wallet pads); the arc-1 cut-over order; run isolation and the security controls.

## Gate

`bun run lint:actions` → actionlint clean, exit 0. `bun run test:ci-gating` → 100 pass, 0 fail (the
aggregator truth table, `behavior-gating` with the tools graph, `required-checks`, the complexity
baseline). `bun run --cwd apps/extension test:e2e`, run alone against a build armed exactly as
`_extension-smoke-e2e.yml` arms a source build (`VITE_NULO_E2E_MIGRATION_FIXTURE=1`, the testnet
default net, the empty token-seed source; `NULO_E2E_MIGRATION_FIXTURE=1` on the runner) → **31 files
passed, 1 skipped; 116 tests passed, 6 skipped**, `EXIT=0` (569 s). A first attempt on a plain
`bun run build` failed only the suite's arming contract — an unarmed repo build is refused by design,
so the local gate has to build the way CI does. CI proof at Delivery: the arc-3 PR's six shards +
`tools-e2e-status` at retry 0.
