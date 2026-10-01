# Phase 5 · Browser proof and the arc gate

`LESSONS_FILE=implementations-plan/failed-send-check/lessons/phase-5.md`

## Red run on the base

The new spec, copied into a `git archive` of the base (`85c4d20f`) with its own `bun install`, run
there with `NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run
e2e:agent tests/e2e/network/failed-send-check.test.ts` on Chrome: **1 failed**, 1 file, 268.6 s,
exit 1. The failing assertion is the one on the stored record:

```
AssertionError: the row failed after its submitting record, with the hash it tried to send:
expected { stage: 'failed' } to match object { stage: 'failed', …(2) }
-   "from": "submitting",
-   "txHash": StringMatching /^0x[0-9a-f]{64}$/i,
```

The base's failed row keeps neither the stage it failed from nor the hash, so the send the node
never received cannot be checked. Everything before it held on the base too: the proof gate held the
send at `proving`, the Terms record was removed while it held, and the send line refused.

## Spec notes

- The spec asserts the whole stored `progress` equals the failed row's for every sample, which is
  stricter than "`progress.check` stays undefined": no field of the row may move while the check
  reads DROPPED.
- The Terms record goes back in a `finally` on the wait for the failed row, so a red there never
  leaves the profile without accepted Terms for the rest of the file.
- The expected category is `categoricalLabel(failed).label`, read from `journal-state.ts`, so the
  spec and the page share one string.

## Red run: `test:all` caught a file that no longer loads

The first `bun run test:all` failed one extension file to load (8085 passed, no failed test):
`RecentActivityView.test.ts` mocks `@/wallet/services/transaction/spec` with `OriginType` and
`TxStatus` only. `journal-state.ts` now imports `isSendCheckable` and `wasNeverSent` from the
journal spec at runtime, and that module builds its zod schema with `TransferType`, which the
partial mock left undefined:
`No "TransferType" export is defined on the "@/wallet/services/transaction/spec" mock`. P4's gate
ran a filtered file set and never loaded it. Fixed in the test: the mock spreads the real module
(`importOriginal`) and overrides the two enums it controls; 33 passed, then `test:all` green.

## `test:ci-gating` under host load

Two runs at load average about 250 failed in `scripts/ci-cd/test-soak/cli.test.ts`, a different
test each time, each at bun's 5 s default timeout ("unhandled rejection…", then "passing…"); the
file spawns a vitest fixture per engine. The same file with `--timeout 60000` passed 14 of 14, and
the gate itself passed on the third run at load about 160. No file under `scripts/ci-cd/` is in
this diff.

## Local gates

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | 1906 files; 29 warnings, 3 infos (the base's); complexity baseline OK |
| `bun run typecheck:all` | 0 | every workspace |
| `bun run test:all` | 0 | extension 608 files passed, 3 skipped; 8118 tests passed, 4 skipped, 8 todo. aztec-runtime 250 passed, 2 skipped; wallet-bridge 481; wallet-core 247; extension-messaging 239; wallet-crypto 120; design 401; third-party-notices 66; legal 54; landing 40; resolve-asset 14; wallet-sdk-schema-patch 11; passkey-rp 5 passed, 6 skipped. The diff adds no skip, todo or only |
| `bun run test:ci-gating` | 0 | 244 passed, 2 skipped, 0 failed, 17 files |
| `bun run build` | 0 | built |
| `bun scripts/ci-cd/plans/check.ts` | 0 | 0 enforced; 3 report-only path tokens in files this diff does not touch |

## E2E

Every run at retry 0. The Chrome runs used this worktree; the Firefox network runs used a
`git archive` of `469eae60` in a scratch directory with its own `bun install --frozen-lockfile`.
No smoke and network run shared a tree at once.

### Network, proverless (`NULO_E2E_PROVERLESS=1`)

| Run | Browser | Files | Tests | Samples, last past `terminalAt` | Duration | Exit |
|---|---|---|---|---|---|---|
| 1 | Chrome | `failed-send-check`, `snack-placement`: 2 passed | 4 passed, 0 skipped | 30, 154 s | 342.67 s | 0 |
| 2 | Chrome | `failed-send-check`: 1 passed | 1 passed, 0 skipped | 30, 154 s | 348.02 s | 0 |
| 3 | Chrome | `failed-send-check`: 1 passed | 1 passed, 0 skipped | 30, 154 s | 287.77 s | 0 |
| 1 | Firefox | `failed-send-check`, `snack-placement`: 2 passed | 4 passed, 0 skipped | 30, 154 s | 389.06 s | 0 |
| 2 | Firefox | `failed-send-check`: 1 passed | 1 passed, 0 skipped | 30, 155 s | 291.73 s | 0 |
| 3 | Firefox | `failed-send-check`: 1 passed | 1 passed, 0 skipped | 30, 154 s | 288.61 s | 0 |

The flake bar holds: three consecutive green runs per browser.

### `transfers` on Firefox, prover on, no Presto

Nothing listened on the wallet's Presto port (59833) before or after the run.

| Run | Public → public `terminalAt - createdAt` | Tests | Duration | Exit |
|---|---|---|---|---|
| 1 | 113 624 ms | 1 passed, 0 skipped | 594.80 s (the test 512.02 s) | 0 |

The run counts: the record took 113.6 s, so `executeTransfer` was pending past the old 60 s
deadline and the popup still reported the send.

### Smoke, the migration-fixture build per browser

| Browser | Shards | Files | Tests | Duration | Exit |
|---|---|---|---|---|---|
| Chrome | 1 | 38 passed, 3 skipped (41) | 157 passed, 7 skipped (164) | 1214.31 s | 0 |
| Firefox | 3 | 39 passed, 2 skipped (41) | 153 passed, 11 skipped (164) | 717.36 s (the longest shard) | 0 |

The Chrome run started before the owner asked for sharded runs. The Firefox shards, each on its
own copy of `dist/firefox` (`dist/firefox`, `dist/fxsmoke2`, `dist/fxsmoke3`):

| Shard | Files | Tests | Duration | Exit |
|---|---|---|---|---|
| 1/3 | 13 passed, 1 skipped (14) | 51 passed, 1 skipped (52) | 378.28 s | 0 |
| 2/3 | 13 passed, 1 skipped (14) | 41 passed, 4 skipped (45) | 508.00 s | 0 |
| 3/3 | 13 passed (13) | 61 passed, 6 skipped (67) | 717.36 s | 0 |

Every skip is the base's: two `test.skip` (`appearance`, `sw-resilience`'s strict-mode-off case),
the env-gated console probe (3) and store captures (1), and each browser's own: on Chrome the
Firefox-only popup-layout case (1); on Firefox the Chrome-only `sw-resilience` case (1) and four
`import-dead-rpc` cases (the CDP redirect). No file in this diff is a smoke spec.

`bun run e2e:reap` in each tree afterwards: nothing to reap.

## Codex loop

Session `01a0eee1-7386-7170-9504-8047eeafc2db` (`/codex high`, GPT-6 Astra), over
`85c4d20f...e625fef3`, with the adversarial ask, both review rules verbatim, and the finality
ruling, the copy sign-offs and the realism rule marked as settled.

### Round 1: changes requested

| # | Severity | Finding | Verdict |
|---|---|---|---|
| 1 | major | The check read through the retrying node client, so a lock, a switch, a deletion or `stop()` during a failing read still let the transport's later attempts send the hash | accepted, `642f3b84`: a one-attempt client pinned to the same URL (`NodeFactory.createSingleAttemptNode`, `NetworkService.getSingleAttemptNodeForUrl`); the check's cadence is its retry |
| 2 | minor | A failing read logs the endpoint above `debug` through the SDK's transport | accepted in part: fix 1 removes the transport's three retry lines per failed read. The SDK client's own one warning per failed call stays: it comes from `createSafeJsonRpcClient`'s logger, which `createAztecNodeClient` gives no way to replace, it fires for every node call in the wallet, and the logger reduces the URL to its origin as the logging policy prescribes. The plan's Logging line now says so |
| 3 | minor | The snack reads "checking" for a record already answered | rejected, realism: the answer needs the tick (0 to 5 s after the failure) and a node round trip, the popup's read one in-browser round trip right after the rejection, and the transaction must already be in a block when its send failed. The snack would still say "Don't send it again yet"; a snack for an answered record is new copy, an owner decision |
| 4 | minor | The network spec passes with no check running | accepted, `eceaa0ed`: the spec reads the node's own DROPPED for the hash, then ages the row past the window, restarts the background, unlocks, and requires "unconfirmed" |
| 5 | nit | The runtime pins header names a review round and restates its assertions | accepted, `8ee608d2` |

Red for finding 1, a probe against the adapter (not committed): one failed `getTxReceipt` through
`createNode`'s client made 4 requests, at 5, 1014, 3016 and 6017 ms. Through
`createSingleAttemptNode`'s, 1 (`aztec-node-factory-adapter.test.ts`). Gates after the fix:
`bun --bun vitest run` over the check, network, composition, runtime-pin and log-ban tests, 12
files, 282 passed; aztec-runtime 35 files, 252 passed, 2 skipped (the base's); `bun run
typecheck:all` 0; `bun run lint` 0, 1907 files, 29 warnings, 3 infos.

Red for finding 4, a probe build (not committed): a `git archive` of `6ed1a33f` with
`sendCheck.start()` removed from `apps/extension/src/wallet/runtime.ts`, its own install, the spec
on Chrome at retry 0: **1 failed**, 1 file, 445.86 s, exit 1. The 30 samples still passed, the last
154 s past `terminalAt`, as they do with no check at all; the new step failed with
`record … was not answered within 60000 ms`, the stored row holding `stage: "failed"`,
`from: "submitting"`, the hash and the endpoint, and no `check`.

### Round 2: approve

Resumed with `e625fef3..6ed1a33f`, both rules verbatim, and the reasons for findings 2 and 3.

- Findings 1, 4 and 5: confirmed fixed.
- Finding 2: the remaining SDK warning accepted; its endpoint is reduced to its origin, as the
  logging policy prescribes.
- Finding 3: not retained under the realism rule.
- New, nit: the one-attempt client cache's comment (`network/service.ts`) said the SDK never frees
  a client, but the SDK's client registry holds each through a `WeakRef`
  (`@aztec/foundation`, `json-rpc/client/safe_json_rpc_client.js`). Accepted, `d1a22dac`: the
  comment states the cache's bound instead.

No new material finding: the loop converged at round 2.

## Final gate, after the review

Code at `d1a22dac`; the first network run per browser ran at `6ed1a33f`, one comment line apart.
Host load average 157 to 199 on 192 cores throughout.

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | 1907 files; 29 warnings, 3 infos (the base's); complexity baseline OK |
| `bun run typecheck:all` | 0 | every workspace |
| `bun run test:all` | 0 | extension 609 files passed, 3 skipped; 8121 tests passed, 4 skipped, 8 todo (one file and three tests more than at P5: the extension suite also runs the new adapter test, plus the network service case). aztec-runtime 35 files passed, 1 skipped; 252 passed, 2 skipped. wallet-bridge 481; wallet-core 247; extension-messaging 239; wallet-crypto 120; design 401; third-party-notices 66; legal 54; landing 40; resolve-asset 14; wallet-sdk-schema-patch 11; passkey-rp 5 passed, 6 skipped |
| `bun run test:ci-gating` | 0 | 244 passed, 2 skipped, 0 failed, 17 files |
| `bun run build` | 0 | built |
| `bun scripts/ci-cd/plans/check.ts` | 0 | 0 enforced; the same 3 report-only path tokens |

### Network, proverless, the flake bar again

Each run `failed-send-check` and `snack-placement` in one `e2e:agent` invocation, retry 0. Chrome
run 1 used this worktree, every other run a `git archive` of its commit with its own
`bun install --frozen-lockfile`.

| Run | Browser | Commit | Tests | Samples, last past `terminalAt` | `failed-send-check` | Duration | Exit |
|---|---|---|---|---|---|---|---|
| 1 | Chrome | `6ed1a33f` | 4 passed, 0 skipped | 30, 154 s | 194.37 s | 449.68 s | 0 |
| 2 | Chrome | `d1a22dac` | 4 passed, 0 skipped | 30, 154 s | 194.92 s | 384.42 s | 0 |
| 3 | Chrome | `d1a22dac` | 4 passed, 0 skipped | 30, 155 s | 196.08 s | 394.87 s | 0 |
| 1 | Firefox | `6ed1a33f` | 4 passed, 0 skipped | 30, 154 s | 199.36 s | 467.72 s | 0 |
| 2 | Firefox | `d1a22dac` | 4 passed, 0 skipped | 30, 154 s | 200.30 s | 419.16 s | 0 |
| 3 | Firefox | `d1a22dac` | 4 passed, 0 skipped | 30, 155 s | 204.68 s | 433.64 s | 0 |

Three consecutive green runs per browser of the strengthened spec, each one answering
"unconfirmed" after the restart and the unlock.

### `transfers` on Firefox, prover on, no Presto

| Run | Public → public `terminalAt - createdAt` | Tests | Duration | Exit |
|---|---|---|---|---|
| 2 | 106 985 ms | 1 passed, 0 skipped | 571.17 s (the test 489.69 s) | 0 |

Nothing listened on 59833 before or after. The run counts: past the old 60 s deadline.

### Smoke, sharded in three per browser

Each shard on its own copy of the migration-fixture build (`dist/chrome`, `dist/smoke2`,
`dist/smoke3`; `dist/firefox`, `dist/fxsmoke2`, `dist/fxsmoke3`), `NULO_E2E_MIGRATION_FIXTURE=1`,
`--retry=0`. Chrome in this worktree, then Firefox in a `git archive` of `d1a22dac`; no network run
shared either tree.

| Browser | Shard | Files | Tests | Duration | Exit |
|---|---|---|---|---|---|
| Chrome | 1/3 | 12 passed, 2 skipped (14) | 50 passed, 2 skipped (52) | 262.57 s | 0 |
| Chrome | 2/3 | 13 passed, 1 skipped (14) | 41 passed, 4 skipped (45) | 358.23 s | 0 |
| Chrome | 3/3 | 13 passed (13) | 66 passed, 1 skipped (67) | 663.07 s | 0 |
| Chrome | sum | 38 passed, 3 skipped (41) | 157 passed, 7 skipped (164) | | |
| Firefox | 1/3 | 13 passed, 1 skipped (14) | 51 passed, 1 skipped (52) | 375.99 s | 0 |
| Firefox | 2/3 | 13 passed, 1 skipped (14) | 41 passed, 4 skipped (45) | 482.48 s | 0 |
| Firefox | 3/3 | 13 passed (13) | 61 passed, 6 skipped (67) | 673.82 s | 0 |
| Firefox | sum | 39 passed, 2 skipped (41) | 153 passed, 11 skipped (164) | | |

The skips are the base's, as at P5. The copies were removed afterwards, and `bun run e2e:reap` in
every tree found nothing to reap.
