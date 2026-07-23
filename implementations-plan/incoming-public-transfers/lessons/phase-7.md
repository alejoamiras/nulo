# Phase 7 — the deferred "if feasible" e2e cases (4 & 5)

The Phase-5 ship gate shipped the 3 mandatory network-e2e cases (pub→pub, priv→pub, pub→priv) and left
cases 4–5 as conditional "if feasible" extensions. A sonnet-5 harness-feasibility recon settled both.

## Case 4 — public scan resumes across a service-worker restart: **UNIT-ONLY (owner decision)**

Case 4 ships as a deterministic **unit** proof. An integration e2e was attempted through THREE codex rounds
+ one real CI run and rejected: the harness cannot force a *faithful* SW recycle without a heavyweight,
flake-prone browser relaunch, and every lighter shape is a false-green. Rather than ship the flakiest e2e
category for coverage that's largely redundant, Case 4 is unit-only — matching the Case-5 resolution below
and the owner's standing "no flakes" priority.

### The unit proof (deterministic, flake-free) — the shipped coverage

`service.scenarios.test.ts` → the `"public-scan cursor resume"` describe, two tests for the two resume
branches:

- **(a) No anchor** (`lastSyncedBlockHash: null`, cold-start): the FIRST reader call pages with
  `afterCursor == the persisted cursor` (+ `fromBlock` undefined).
- **(b) With a non-null anchor** (the real production post-scan state): the anchor triggers a boundary
  ancestry probe first, and a later reader call still resumes from the exact persisted cursor with no
  block-0 fallback.

Both boot a FRESH service over the same in-memory storage (`bootService` doesn't clear cursors) — the SW
restart modeled as a new instance re-hydrating from `chrome.storage.local`. A restart that dropped the
cursor would fetch from block 0; this pins the exact "resume from persisted cursor, no re-processing"
property. It is the ONLY layer that can prove it: a from-0 rescan + primary-key dedup looks byte-identical
to a correct resume from the outside, so no e2e can distinguish them anyway.

### Why NOT an e2e (what the codex loop + CI actually proved)

The abandoned e2e (`incoming-scan-sw-restart.test.ts`, removed) went through three failing shapes. Each
failure is a durable lesson about this harness:

1. **`>= 2` cards was false-green (codex R1).** The fixture mints 1000 pre-import and zero-sender mints
   create a record, so `{mint, A}` already = 2 before B ever arrives. Fixed to a `cardsBefore + 1` delta.
2. **Gating recovery on `#/popup/general` is a false-green (codex R3 + verified).** It assumes the SW
   recycle leaves the wallet unlocked. But **`strictSecurityMode` defaults to `true`** (`config.ts:26`) and
   the fixtures don't opt out, so `SessionManager.open()` persists **no bearer** (`session-manager.ts:213`:
   `persistBearer = passhash !== undefined && !strictSecurityMode && type === "password"`). A genuine
   recycle therefore `silentClose`s and the wallet **locks** → routes to `auth`. Accepting `general` means
   accepting a run where the worker never died and the *old* scheduler's ordinary 30s poll found B — proving
   nothing about restart-resume.
3. **Gating on `#/popup/auth` timed out in CI (the decisive signal).** `Runtime.terminateExecution` (the
   only in-process SW-kill lever) leaves an **unrevivable zombie SW** — documented in the harness itself
   (`fixtures/extension.ts:23`). It does not reliably produce a fresh respawn, so the popup never settled
   onto a recovery route. The repo's own faithful SW-restart pattern is a **browser relaunch on a persistent
   `userDataDir`** (`backup-restore-sw-restart.test.ts` → `launchExtension({ userDataDir })`), which clears
   `chrome.storage.session` → deterministic lock → auth → settle-loop unlock.

A correct e2e would thus need: a manual persistent `userDataDir` + full token setup (the `tokenReadyExtension`
fixture doesn't expose a relaunchable dir), a real browser relaunch, and a settle-loop unlock — ~200 lines
of the flakiest e2e machinery there is. **Owner decision (2026-07-23): not worth it.** The integration half
it would add (real `chrome.storage` survives a restart + the wallet recovers) is **already covered** by
`backup-restore-sw-restart.test.ts` and `sw-restart-network.test.ts`; the scan-resumes-end-to-end half by
`incoming-public-transfers.test.ts`; and the cursor-resume core by the unit proof above. The union leaves no
real gap.

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
  dedicated `test_files:` job. High flake + blast-radius risk.
- **The residual it would uniquely cover (codex R1 #4):** a live reorg is the only thing that validates a
  REAL rollback/replacement fork produces the tip / block-hash / archive-membership / log-query behavior
  the D6 unit fakes ASSUME. That's **accepted node-integration risk pending a dedicated isolated harness**
  — not "cosmetic." The unit suite proves the reconciliation LOGIC; it can't prove the node's fork
  semantics match the fakes. `public-events-capability.test.ts` covers the healthy-response shape live.
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

- **Case 4 unit proof:** `service.scenarios.test.ts` `"public-scan cursor resume"` (both branches) green;
  the full `incoming-transfer` service suite is 136 tests green; `typecheck` + `lint` clean.
- **The e2e loop is the lesson, not a shipped artifact.** Three `gpt-5.6-sol` rounds + one real CI run
  progressively falsified every non-relaunch e2e shape (`>= 2` → `cardsBefore+1`; `general`-gate →
  false-green; `auth`-gate → CI timeout from the zombie-SW `terminateExecution`). The codex loop working as
  intended: it (and CI) refused to let a false-green ship. The faithful browser-relaunch alternative was
  rejected on flake-cost vs. the redundant coverage (see "Why NOT an e2e" above).
- **Coverage owned elsewhere:** real-`chrome.storage`-survives-restart + wallet-recovers →
  `backup-restore-sw-restart.test.ts` + `sw-restart-network.test.ts`; scan-works-end-to-end →
  `incoming-public-transfers.test.ts`; cursor-resume core → the unit proof above.
