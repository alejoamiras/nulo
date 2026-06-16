# Phase 0 — Evidence baseline, exact shard compositions, code grounding

Evidence pulled from real CI logs (saved under `lessons/raw/`). **No mechanism asserted as confirmed** — these are observations + discriminators for Phases 2-4.

## Source runs
- `27642919283` — the #94 PR run. shard 1 + shard 3 FAILED, shard 5 PASSED. (F1, F2 evidence.)
- `27638447273` — earlier run. shard 5 FAILED here (F3 evidence) + 1, 3.
- Raw logs: `raw/f1-shard1-run94.log`, `raw/f2-shard3-run94.log`, `raw/f3-shard5-run27638.log`.

## Exact shard compositions (the H1 fix — replay these via `mode=files`, NOT `--shard`)
The first four files in each grep (`fee-methods`, `concurrent-sendtx-confirm`, `transfers`, `tx-sendTx-default`) are the `--exclude` echo, NOT shard members (they run in dedicated jobs). Actual members:

- **shard 1** (F1): `incoming-transfers`, `cancel-mid-prove`, `authwit-lifecycle`, `register-token`, `tx-sendTx-multicall`, `tx-sendTx-noFrom`, `batch-mixed`, `cap-request-accounts`, `meta-getAccounts`, `contracts-getClassMetadata`.
- **shard 3** (F2): `concurrent-sendtx`, `token-add-auto-trust`, `authwit-consume-smoke`, `session-tabNavigate`, `tx-sendTx-reject`, `err-scope-and-cap`, `cap-request-repeat-noPopup`, `token-management`, `batch-partial-failure`, `meta-batch`.
- **shard 5** (F3): `_probe-warmup-effect`, `multi-account-from`, `tx-sendTx-feePayer`, `authwit-variants`, `sim-methods`, `cap-request-rerequest`, `tokens`, `session-explicitDisconnect`, `cap-request-basic`, `meta-getChainInfo`.

(Exact intra-shard ORDER still to be confirmed from the per-file run sequence in the logs — Phase 2/3 will pin it when replaying.)

## F1 — shard 1 CDP freeze
- **Symptom:** `Caused by: ProtocolError: Runtime.callFunctionOn timed out` — a *single* CDP call hung the full **300s** `protocolTimeout`. The renderer was unresponsive for 5 continuous minutes → renderer crash/deadlock, NOT transient load.
- **Exact hang point:** `authwit-lifecycle.test.ts:101` → `grant()` `:81` → `waitForPgResult` (`playground.ts:68`) → `page.waitForFunction` (the patched poller, `extension.ts:961`) → `Runtime.callFunctionOn`. So the freeze is the *playground page* renderer going unresponsive while polling for the grant result.
- **Failing-set VARIES by run:** #94 = `authwit-lifecycle` + `cancel-mid-prove`; the older phase-3 note = `register-token` + `authwit-lifecycle`. The reporting test changes run-to-run → argues against single-test-logic, toward an environmental/shared-state or contamination cause.
- **Notable:** the freeze is on the `page.evaluate`/`waitForFunction` path the harness *migrated to* specifically to dodge the documented Puppeteer 24.4x/Chrome 128+ regression (`extension.ts:1148-1152`) — yet it still hangs. So the migration didn't fully escape it, OR this is a different (renderer-side) wedge.
- **Cross-cutting suspect (NEW):** `##[error]Error: maxFeesPerGas.feePerL2Gas=18900000 must be ≥ gasFees.feePerL2Gas=19500000` in shard 1. The wallet's max fee is ~3.1% BELOW the network's required gas price → tx rejected at build/submit. Intermittent by nature (depends on gas-price movement). Possibly tied to the `VITE_NULO_FEE_MULTIPLIER` envelope not covering these txs. **This is a concrete, non-CDP, non-starvation lead.**
- **Discriminator (Phase 3):** contamination ⇒ the reporting test freezes ONLY after a heavy predecessor + passes in isolation + correlates with a left-behind artifact; shared-path/renderer ⇒ freezes in isolation too under CDP pressure. Bisect the shard-1 file list.

## F2 — shard 3 settle-timeout
- **Symptom:** `waitForPgResult` (`playground.ts:68`) times out (120/240s). **No `Runtime.callFunctionOn` / CDP freeze** in the log → distinct from F1. The playground result row simply never appeared.
- **Failing tests (#94):** `authwit-consume-smoke` AND `concurrent-sendtx` (both settle-timeouts).
- **Key gap (codex M5/H):** `waitForPgResult` only watches a DOM result row — it does NOT prove the dApp promise never resolved. F2 is undecided between (a) promise genuinely never resolves (real bug) and (b) the on-chain mine legitimately exceeds budget (perf). **No fee error observed in shard 3** → F2 is probably not the fee-mismatch.
- **Discriminator (Phase 4):** add a page-DOM-independent signal — journal op-state + direct node mine-status — to split page-wedged / promise-unresolved / mine-too-slow.

## F3 — shard 5 queued-stall (clearest)
- **Symptom (journal-diag captured it directly):** across all 3 retry attempts, the `dapp_execute` record is stuck at `stage:"queued"` with a fresh `sessionId` each time:
  - `{"id":"eed608d5...","stage":"queued","sessionId":"5b2bed00-..."}`
  - `{"id":"1d24401d...","stage":"queued","sessionId":"be4a5de1-..."}`
  - `{"id":"60a56efa...","stage":"queued","sessionId":"b34af8c6-..."}`
- **Exact hang point:** `multi-account-from.test.ts:86` → `waitForDappExecuteWorked` (`journal.ts:207`). The record reaches `queued` (so enqueue worked) but **never transitions to `pending`** — the `queued→pending` claim never fires after approval.
- **Per-run-persistent, run-intermittent:** ALL 3 retries stalled at `queued` in the bad run (not a 1-in-3 flake), yet shard 5 PASSED entirely on #94. ⇒ a per-run bistable condition: once the worker/offscreen gets into a bad state early in the shard, it stays bad for every retry. Strongly supports the baton/`releaseFifo` claim mechanism (`background.ts:300`) as the locus.
- **Reaper not involved:** the 10-min queued grace (`reaper.ts:77`) ≫ 90s budget, so the `queued` reading is honest.
- **Phase 1/2 need:** the worker/baton/offscreen state AT the stall (does the worker exist? is the baton held? is the offscreen doc alive?) — the journal alone shows `queued` but not WHY the claim didn't fire.

## Cross-cutting observations
- The four heavy files (`fee-methods`, `concurrent-sendtx-confirm`, `transfers`, `tx-sendTx-default`) are excluded from the SHA-1 shard matrix and run in dedicated jobs — confirmed in every shard's `--exclude` echo. (Validates audit H1.)
- `close timed out after 10000ms` appears at teardown in ALL shards — the known Vite/browser close-timeout leak (de-scoped previously; not a test failure, but it delays teardown).
- **Three distinct mechanisms** (CDP-wedge / result-never-settles / job-never-claimed) — the "single common root" is partly weakened, BUT F1+F3 could still share an offscreen/worker-lifecycle origin (Phase 5 confirms-or-kills via side-by-side dumps).

## Status
Phase 0 gate met: exact compositions + real error traces + code paths captured for all three; discriminators written; no mechanism asserted as confirmed. The fee-mismatch is flagged as a cross-cutting lead. Proceed to Phase 1 (harden the instrument on F3 — already the best-understood).
