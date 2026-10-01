# harness-fixtures — recon (round 3, plan 1)

Base: dev after #519 (round-3 scope) — six directives in the e2e harness, all `noExcessiveCognitiveComplexity`.

## Reuse map

| capability | found | verdict |
|---|---|---|
| `(account, token)` storage join over `nulo:core:tokens@*` + `nulo:core:token-balances@*` | duplicated verbatim in `fixtures/helpers.ts` `captureBalanceBaseline` (1319–1345) and `waitForFreshBalanceRow.readRows` (1400–1434); a third prefix scan in the diagnostic `grab` (~1469) | **dedup** — one in-page raw reader + Node-side parse/join |
| active `(profileId, networkId, account)` triple | `resolveActiveTriple` already exists in `network/account-switch-isolation.test.ts:222`, identical logic to the inline copy at 117–136 | **reuse-as-is** |
| held/record polling loops in the phase-0 harness test | inline (171–205); `waitForIncomingPollPhase`, `readIncomingPollStatus`, `findIncomingRecordByHash` exist in `fixtures/incoming-poll-gate.ts` | **extract** two local drivers over the existing fixtures |
| JSON-RPC batch parsing / blackhole planning | inline in the stub server's `end` handler (`import-dead-rpc.test.ts:103–130`); no existing helper (searched `fixtures/*.ts` for `jsonrpc`, `blackhole`, `batch`) | **build new** pure `planBatchReplies` (test-local, Node-testable without a browser) |
| restore residue read (`profiles@` / `restore-pending@` keys) | evaluated inline THREE times in `backup-restore-sw-restart.test.ts` (226, 258, 296) | **dedup** — `readRestoreResidue(page)` |
| sandbox boot stages | `global-setup.ts` `setup` is ONE 400-line function (233–632): lock reconciliation, anvil, aztec node, playground, tools, deploy; the four skip exits repeat the same three `project.provide` calls; playground and tools blocks are near-identical (spawn `bun run dev`, pipe logs, `waitForHttp`, kill on failure); every child pipes stdout/stderr through the same needle-filter shape | **extract** stage functions + `provideWithoutSandbox` + `startDevServer` + `pipeChildLogs` |

## Constraints found

- Puppeteer serializes an evaluated function by `toString()` — an in-page function cannot reference module-scope helpers. Keep the in-page part trivial (raw entries by prefix) and parse/join in Node.
- `setup`'s process handles and `weStarted*` flags are module-level `let`s, read by `teardown` and `recordSpawnedPid`; stage functions mutate the same module state, so ownership does not move.
- The reuse path in `setup` (prior lock with matching ports + healthy pack) is reachable only by direct vitest invocations with a stable env — `bun run e2e:agent` always allocates fresh ports, so a double boot exercises the "different ports → reap orphans" path, not reuse.
- `E2E_REQUIRE_SETUP=1` turns four skip exits into throws; the anvil-binary and aztec-binary gates each carry a specific FATAL message that CI's `setup-aztec` docs reference.
- `tests/e2e/README.md` and the `e2e-testing` skill describe the setup sequence; both need the stage names once they exist.
