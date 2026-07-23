# Phase 7 — the deferred "if feasible" e2e cases (4 & 5)

The Phase-5 ship gate shipped the 3 mandatory network-e2e cases (pub→pub, priv→pub, pub→priv) and left
cases 4–5 as conditional "if feasible" extensions. A sonnet-5 harness-feasibility recon settled both.

## Case 4 — public scan RESUMES across a service-worker restart: **IMPLEMENTED**

`apps/extension/tests/e2e/network/incoming-scan-sw-restart.test.ts`.

Feasible + cheap — it reuses proven infra, not new capability:
- The CDP `stopServiceWorker` helper (`Runtime.terminateExecution`) is already CI-green in
  `sw-restart-network.test.ts`; an MV3 SW recycle wipes `chrome.storage.session` (→ the wallet locks) but
  NOT `chrome.storage.local`, where the scan cursor + records + outbox live (`repository.ts:44-59`).
- **Shape (proves resume, not just "eventually works"):** deliver receipt A → scan runs, cursor advances,
  D4 auto-refreshes 1000→1010 → KILL the SW → deliver receipt B while it's dead → reopen + unlock → assert
  the resumed scan discovers B (a 2nd incoming card + balance→1020) AND A's record survived. B is delivered
  ONLY while the SW is down, so it can appear only if a cursor-aware scan resumed from the persisted state.
- **Accepted limitation:** the public scan has no deterministic mid-page pause hook — the e2e
  `incoming-poll-gate` wires only the note arm (`service.ts:951-956` calls it in `scanContract`, not
  `scanPublicContract`). So the kill lands at a clean post-A-scan boundary, not mid-page; the mid-page/
  mid-reconcile crash windows are covered at the unit layer (below). Same race-timed-kill precedent as
  `backup-restore-sw-restart.test.ts`.

## Case 5 — forced reorg triggers D6 reconciliation: **NOT an e2e — covered at the unit layer**

Deliberately NOT implemented as a live-sandbox reorg e2e. Resolution of the "if feasible" hedge: **not
feasible without new, risky, unverified plumbing — and the behavior is already deterministically covered
where it belongs.**

- **No reorg lever is wired in the harness.** Zero uses of `anvil_reorg` / `evm_revert` / `evm_snapshot`
  anywhere; an Anvil L1 revert wouldn't reorg the Aztec L2 sandbox (separate sequencer/world-state). The
  SDK's own reorg machinery (`L2BlockStream` chain-pruned) is node-internal, not client-RPC-exposed.
- The one theoretical lever, `AztecNodeAdmin.rollbackTo` (reachable via the sandbox's live `--admin-port`),
  is **completely unused in the repo + unverified** (would a rollback + new tx even mint a *different*-hash
  block at the same height?) and **mutates the shared sandbox** — `incoming-public-transfers.test.ts` runs
  in an ordinary SHA-1 shard, so a rollback would corrupt shard-mates unless first re-plumbed into a
  dedicated `test_files:` job. High flake + blast-radius risk for a cosmetic gain.
- **The exact D6 behavior is already exhaustively + deterministically covered at the unit layer** —
  `apps/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts:2593` (`describe
  "public-event reorg reconciliation (D6)"`): referenceBlock-throw → orphan delete + refresh-before-delete
  + rewind; still-canonical record kept; blockHash-canonicality-driven deletion; mid-reconcile reorg
  discard+restart; checkpoint ROLLBACK (records above the rolled-back tip deleted, cursor rewound);
  pendingPage crash window. Injected via the `makePublicReader` error seam — no chain, no flake.
- The live-node field-shape half (does the real sandbox serve `blockHash`/reorg fields, does the scan
  decode them) is smoke-covered by `public-events-capability.test.ts` (healthy response only, no reorg).

**Owner decision (2026-07-23): only Case 4; skip a flaky live-reorg e2e.** The unit D6 suite + the
capability smoke test are the standing coverage for reorg reconciliation.

## Validation

- **Local `e2e:agent` runs were blocked by machine resource state, NOT test logic** (3 attempts on a
  marathon-session box): the aztec sandbox hit the recurring `EADDRINUSE` node-boot race, and on the run
  that DID boot, the test executed for 250s before Chrome's popup frame detached — a memory-pressure crash
  (swap ~80% full, tmpfs `/tmp` ~70%, Chrome + sandbox competing for RAM). No run produced a wrong
  assertion; the failures are all boot/crash symptoms of the environment.
- The test is composed entirely of **proven CI-green pieces**: the `waitForKindChip`/balance-poll pattern
  from the passing `incoming-public-transfers.test.ts`, and the `stopServiceWorker`/`waitForLiveness`/
  auth-unlock pattern from the passing `sw-restart-network.test.ts`.
- **Authoritative validation = CI** (isolated runner, proper resources, rerun-on-flake gate) on the PR,
  plus a `gpt-5.6-sol` static review of the Case-4 test logic + this Case-5 resolution.
