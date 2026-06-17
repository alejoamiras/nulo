# Phase 2 — Gate plumbing: strict signal + sentinel + filter + de-retry

Make the gate's signal trustworthy BEFORE touching app code. No app-behavior change.

## What landed

### 2a — `retry: 0` on every PR call
`pr-network-e2e.yml`: added `retry: "0"` to all four `_network-e2e.yml` calls (the
5-shard matrix, `heavy` fee-methods, `heavy-concurrent`, and the real-proving
`canary`). The reusable workflow already had a `retry` input → `NULO_E2E_RETRY`
env → the vitest `retry` (`vitest.e2e.network.config.ts:52`). Previously the PR
caller passed nothing ⇒ config default `retry: 2` ⇒ app flakes were silently
absorbed. Now the PR gate is the honest acceptance signal.

### 2b — Boot-failure sentinel (explicit state, exit 86)
A boot failure happens in-process inside `global-setup.ts`, so it cannot be a
workflow step-retry. Implemented an explicit state-file classifier instead:

- `tests/e2e/sentinel.ts` (new): owns `STATE_DIR` (`packages/extension/.e2e-state`)
  + `markBootStarted/markBootReady/markTestsStarted/clearMarkers/readMarkers` +
  the pure `classifyExit(vitestExitCode, markers)` and `BOOT_FAILURE_EXIT = 86`.
- `global-setup.ts`: `markBootStarted()` right before anvil bring-up (AFTER the
  manifest check + orphan reap — those are build/env problems, not infra flakes);
  `markBootReady()` at BOTH success exits (the reuse-return and the normal end),
  after `deployContractsAndProvide`. Marker placement is the safety: a
  fixture/import regression occurs AFTER `boot-ready` ⇒ classifier returns NOT-86
  ⇒ no retry. The 86 window is narrowly anvil/node/deploy bring-up only.
- `tests/e2e/network-setup.ts` (new) wired as `setupFiles` in the network config:
  `markTestsStarted()` so a run that reached test execution can never be
  misclassified as infra.
- `scripts/e2e/classify-exit.ts` (new): thin CLI (`import.meta.main` guard) that
  reads markers + `process.exit(classifyExit(...))`.
- `agent.sh`: clears stale markers at the top; captures the vitest exit under
  `set +e`; `exec`s the classifier so its code becomes the agent's exit.
- `_network-e2e.yml` "Run network e2e via agent": wraps the run in a `run_agent`
  fn; retries the agent ONCE iff exit == 86; any other non-zero fails
  immediately. Cap = 1.

Classifier truth table (the only retry case is row 2):

| vitest | bootStarted | bootReady | testsStarted | → classified |
|--------|-------------|-----------|--------------|--------------|
| 0      | *           | *         | *            | 0            |
| ≠0     | true        | false     | false        | **86** (retry) |
| ≠0     | true        | true      | *            | passthrough  |
| ≠0     | true        | false     | true         | passthrough  |
| ≠0     | false       | *         | *            | passthrough  |

Unit-tested in `scripts/e2e/classify-exit.test.ts` (7 cases, run by the default
vitest config — `scripts/**/*.test.ts` added to `include`). **7/7 green.**

### 2c — Widen `extension-network` paths-filter
Added the grant-approval + revoke surfaces so a PR touching them triggers the
network gate instead of silently skipping: `windows/execute/**`,
`pages/settings/advanced/**`, `components/modules/settings/authwits/**`, the two
authwit popups, and `composables/useEntityCrud.ts`. (All six paths verified to
exist.) Kept pass-when-skipped for true docs-only PRs; did NOT widen to `src/**`;
permissions unchanged (`contents`/`pull-requests: read`).

### 2d — Remove in-test retry masking + un-quarantine C2
Removed the per-test `retry: 1`/`2` from the 8 files in plan fact 10
(`authwit-variants`, `meta-getAccounts-pregrant`, `concurrency-rapid-fire`
[was retry:2], `meta-batch`, `meta-getChainInfo`, `session-reconnect`,
`data-addressBook`, `err-scope-and-cap`). Un-quarantined
`incoming-transfers.test.ts` C2: `test.skip` → `test.skipIf(!hasConfig)`. Also
reworded two comments in `transfers`/`tx-sendTx-multicall` that contained the
literal `retry: 1` so the Phase-6 gate grep stays clean.

`grep -rnE "retry:\s*[12]" packages/extension/tests/e2e/network` → **empty.**

## Gotcha — biome formatter collapse
Removing `, retry: 1` from `err-scope-and-cap.test.ts` shortened arg 2 enough
that biome's formatter wanted to collapse the multi-line `test.skipIf(...)` call
onto one line. `bun run lint` (= `biome check`, which checks formatting) failed
with exactly 1 error that was TRUNCATED out of the default diagnostic display —
chased it by scoping `biome check` to the 11 edited files. Fix: `biome check
--write` on the edited files (applies biome's canonical format). Confirmed the
clean tree (pre-Phase-2) lints at exit 0 with 53 pre-existing warnings, so the
1 error was mine; post-fix `bun run lint` exits 0.

## Local gate results (all green)
- `bun run lint` → exit 0 (53 pre-existing warnings, 0 errors).
- `bun run typecheck` → exit 0.
- `bun run --cwd packages/extension vitest run scripts/e2e/classify-exit.test.ts` → 7/7.
- `actionlint _network-e2e.yml pr-network-e2e.yml` → exit 0.
- `shellcheck scripts/e2e/agent.sh` → exit 0.
- de-retry grep → empty.

## Pending (CI — fills below)
- `actionlint.yml` on the branch → green.
- Strict baseline soak `mode=full repeats=5 retry=0 proverless` RUNS (sentinel
  works) and ENUMERATES the true flaky set (F1 + the de-retried set + C2 + any
  others). **← record the enumerated set here; it is the input to Phases 3–6.**
- paths-filter behaviour confirmed on the Phase-2 PR run (it touches workflows +
  tests ⇒ `extension-network=true`).

### Enumerated flaky/failing set (TO FILL after the baseline soak)
_pending soak run_
