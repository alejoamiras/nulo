# Phase 5 — the dropped and the consumed claim (arc 3, today's behaviour)

Arc 3 (`tools-readiness/tools-gaps`, stacked on arc 2) is test-only: Option A deferred the three
recovery fixes to `tools-recovery`, so these cells pin what the journal does TODAY.

## What landed

- Test wallet: `dropNextSubmission()` — the next transaction is recorded at the node hand-off and
  never forwarded; the wallet answers a `PendingTxReceipt` for it (the base `sendTx` would
  otherwise wait on a node that never saw the transaction), so the page holds a hash only its own
  receipt polls ever read. `swallowNext(method, pattern)` — the call runs, the page never hears back.
  Held calls (`holdNext`) are parked with their closure and `release()` runs them as if never held.
- `pages/relayer.ts` `claimAsRelayer(actor, record)`: the sandbox relayer consumes a PUBLIC deposit
  from the record's unsealed claim material through `@nulo/bridge-core/sandbox`'s `claim`.
- `recovery.spec.ts`: 24c (dropped → three dropped polls clear the hash → CLAIM again lands under a
  different hash, two sends), 24b (token-only, credit funded at 1.4× the ceiling; the relayer
  credits the whole amount first; after the reload CLAIM surfaces the consumed message as an
  error, sends nothing, credited exactly once).

## Gate (retry 0)

| Command | SHA (tree) | Result |
|---|---|---|
| `bun run --cwd apps/tools test` | `fd88cfda` | 98 files, 1287 tests passed; exit 0 |
| `bun run e2e:tools -- --shard=1/2` ∥ `--shard=2/2` (own sandboxes, retry 0) | `1d5c7d18` | shard 1: 33 passed, 1 failed (cell 40); shard 2: 28 passed, 3 failed (24c, 24b, viewports) — 61/65; the four failures were test-side (below) |
| `bun run e2e:tools -- specs/recovery.spec.ts specs/activity.spec.ts` ∥ `specs/spike.spec.ts` (the changed files, own sandboxes, retry 0) | `fd88cfda` | recovery 4/4 (24a, 24c, 24b, 25) and spike 6/6 (viewports included) passed; activity 2/3 — cell 40's second tab reconnected to the remembered wallet and stalled at `verifying` |
| `bun run e2e:tools -- specs/activity.spec.ts` (own sandbox, retry 0) | `8815188c` | 2/3 — tab 2's fresh connect stalled the same way; the trace showed the wallet frame failing `requestCapabilities` on an OPFS pool already held by tab 1's frame of the same profile |
| `bun run e2e:tools -- specs/activity.spec.ts` (own sandbox, retry 0) | `7b4aaa78` | 2/3 — tab 2 (selfpay) connected; the held grant raised its wallet frame over the rail and `openSend` could not click the Send tab |
| `bun run e2e:tools -- specs/activity.spec.ts` (own sandbox, retry 0) | `6bbaa298` | 2/3 — a forced click under the raised frame did not switch the section |
| `bun run e2e:tools -- specs/activity.spec.ts` (own sandbox, retry 0) | `0d7be4e6` | 3/3 passed (cell 40: 58.6 s); exit 0 — every one of the suite's 65 cells is green on this tree |
