# Phase 5 — e2e evidence

All runs on `baf85f93` (the post-loop SHA), sequential in one tmux session: the host was also
running another repo's network e2e (anvil + aztec + headless Chromes), and the Claude Code harness
kills its own background tasks under that pressure, so every wait was a foreground poll.

## Smoke — `bun run test:e2e`

First attempt (on `600c99ba`, unarmed dist): 29 files green, 1 red —
`backup-migration.test.ts › fixture-arming contract` asserts that a repo build carries
`VITE_NULO_E2E_MIGRATION_FIXTURE=1` and the run `NULO_E2E_MIGRATION_FIXTURE=1` (CI sets both on
repo builds, `_extension-smoke-e2e.yml:41`). Not a regression: an arming contract.

Armed rerun on `baf85f93` (`VITE_NULO_E2E_MIGRATION_FIXTURE=1 bun run build`, then
`NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`): **31 files passed, 1 skipped; 118 tests passed,
6 skipped** (retry 0). `SMOKE_EXIT=0`.

## Network subset — `bun run e2e:agent …`

Files: `tx-sendTx-multicall`, `tx-sendTx-default`, `tx-sendTx-noFrom`,
`tx-sendTx-delegated-authwit`, `authwit-variants` (the ones that open the execute popup on a dApp
`aztec_sendTx` / authwit). Result on `baf85f93`, retry 0: **4 files passed, 1 skipped; 6 tests
passed, 1 skipped** — `tx-sendTx-default` (1), `authwit-variants` (2), `tx-sendTx-multicall` (2),
`tx-sendTx-noFrom` (1); `tx-sendTx-delegated-authwit` skipped itself (its own gate, see below).
`NETWORK_EXIT=0`. Ran while another repo's sandbox was live on the host; no flake.

The skip: `tx-sendTx-delegated-authwit.test.ts:40` is `test.skipIf(!hasConfig || !hasStandardContracts)`
— it needs the standard-contracts config the agent runner does not provision here; CI's network
shards run it. The delegated-authwit *card* path is pinned by `OperationCard.createAuthwit.test.ts`
and `OperationCard.discovered.test.ts` instead.

## `bun run audit:vue`

On `baf85f93`: typecheck:all → **491 test files passed, 2 skipped; 6000 tests passed, 2 skipped,
7 todo** → lint → build (`✓ built`). `AUDIT_EXIT=0`. (The "ESM syntax in a file loaded as CommonJS"
line for `tests/e2e/retry-error-reporter.ts` is a pre-existing vite warning on dev, not this branch.)

## After merging dev (`7f37fd37`)

PR #605 opened `DIRTY`: dev had moved (`#600`, `#601`, `#604`), and GitHub runs no
`pull_request` workflow when it cannot compute the merge ref. `origin/dev` merged in with two
trivial unions (`execution/spec.ts` import list, `implementations-plan/index.md`). Dev's presto
packages needed a `bun install --frozen-lockfile` before the worktree typechecked again.

`bun run audit:vue` on `7f37fd37`: **500 test files passed, 2 skipped; 6089 tests passed, 2
skipped, 7 todo**; build OK; `EXIT=0`.

Smoke (armed) on `7f37fd37`, retry 0: **32 files passed, 1 skipped; 123 tests passed, 6 skipped**
(dev added one smoke file); `SMOKE_EXIT=0`. Network subset on `7f37fd37`, retry 0: **4 files
passed, 1 skipped; 6 tests passed, 1 skipped** (same self-skip); `NETWORK_EXIT=0`.

PR #605 CI on `7f37fd37`: `quality-status`, `extension-smoke-e2e-status`,
`extension-network-e2e-status` (5 shards + heavy + real-proving canary), `tools-e2e-status`,
`bridge-contracts-status`, lint — all `SUCCESS`; `mergeStateStatus: CLEAN`.
