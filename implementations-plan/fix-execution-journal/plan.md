# fix-execution-journal — Arc 2 of the 2026-08-16 remediation

Three execution/journal correctness fixes. Source of truth: `audit/bugs/2026-08-16-extension-mid/findings/verified.md` (B-02, B-03 verifier-CONFIRMED high; B-19 consolidated). **Prove-first**: RED pin per finding before the fix. Smallest safe change; NO new abstraction (B-02 reuses the existing `runInSlot`).

## Findings + verified fixes

### B-02 (Critical, funds-safety) — dApp `send_transaction` bypasses the ExecutionMutex
`DappSendExecutor.executeSendTransaction` (`dapp-send-executor.ts:373-460`) hand-rolls `beginJournal → controller → try { markJournal(simulating) → buildAndEstimateValidated → coordinator.proveAndSend } catch/finally`, and NEVER calls `deps.lane.acquireSlot`. Its two siblings (`executeAztecSendTx` :493, `executeNoFromSendTx`) route through `runInSlot` (which acquires the slot first). The file header claims all three dApp sends take a slot — false for this one. Reachable from the custom `grantPublicAuthwit` RPC (`dispatcher.ts:802`) and UI `revokeAuthwits`/`setRegistryEnabled` (`auth-registry/service.ts:200,247`). Two concurrent such ops (or one racing an in-flight `aztec_sendTx`) run `simulateTx`/`proveTx` concurrently against the same PXE+account → stale-private-note interleaving → double-spent-nullifier / on-chain-rejected tx.
- **Fix (verified.md, smallest-safe):** wrap `executeSendTransaction`'s body in the existing `runInSlot` scaffold — slot acquired before the journal claim and any PXE work, released in `finally` — mirroring `executeAztecSendTx`. Move `markJournal(simulating) → buildAndEstimateValidated → proveAndSend` into the `run` callback (which supplies `journalId`/`checkCancelled`/`markJournal`); `getCalls` thunk supplies the primary-method calls via `pickActionMethod(op.actions)`. No new mechanism.
- **Open Q for audit:** `executeSendTransaction`'s current signature has no `hooks` param. runInSlot needs `hooks` only for the FIFO-baton/queued-journal machinery (all optional). Passing `hooks: undefined` gives slot-serialization without the queued-record claim — is that the correct scope, or must hooks thread through from the dispatch site? Also: `beginJournal` → `claimOrCreateJournal` behavior-equivalence for the no-queued-record case.

### B-03 (Critical) — boot reaper can fail a live cold-start operation
`reaper.start()` is fired un-awaited (`runtime.ts:268`) and the RPC listener goes live the same tick; the boot sweep (`reap({unconditional:true})`, reaper.ts:130) has NO age/liveness cutoff, so it can flip a journal row that `createOperation` just wrote for the very request that woke the SW to `failed`. The pipeline's later `markJournal` then hits `assertCanTransition("failed", …)`, throws, and is swallowed at `execution-lane.ts:366-367` — the op keeps running (can succeed on-chain) while the journal shows `failed`.
- **Fix (verified.md):** the record already carries `createdAt` (spec.ts:86). Capture `bootCutoff = this.now()` at the TOP of `start()` (before the alarm + sweep) and pass it to the boot `reap`; in the unconditional branch, skip records with `createdAt >= bootCutoff` (created in THIS SW lifetime — live, not stale). Prior-lifetime records (`createdAt < bootCutoff`) sweep as before. Periodic ticks unchanged.
- **Open Q for audit:** capturing at `start()` entry vs at `reap()` — the correct boundary is "before any request could createOperation in this lifetime," which start()'s first line approximates. Any record created exactly at cutoff (`>=` includes it — safe: skip). Any prior-lifetime row with a future/equal createdAt (clock skew)? — the `>=` skip errs toward NOT sweeping (leaves it for the next periodic tick under grace), which is safe.

### B-19 (Major) — over-broad fee-fallback error match
`predictedWorstMinFees` (`bridge-core/fee-juice.ts:50`) falls back to the potentially-stale `getCurrentMinFees()` when the node's `getPredictedMinFees` throws a message matching `/not found|not supported|unknown method|unimplemented|method.*not/i`. `not found` matches transient errors ("block not found", "account not found", "tx not found"); `method.*not` is loose. A transient RPC error thus silently downgrades the inclusion-safe fee cap to a possibly-under-priced current fee → the tx can be rejected for insufficient fee.
- **Fix:** tighten to method-unimplemented signatures ONLY: `/method not found|not supported|unknown method|unimplemented/i` — drop bare `not found` and `method.*not`. Genuine node-doesn't-implement still falls back; transient errors propagate (correct — the caller rebuilds rather than under-prices).
- **Open Q for audit:** exact token set — is `method not found` (JSON-RPC -32601 standard phrasing) sufficient, or do real Aztec nodes phrase method-missing differently? Should we match the JSON-RPC error CODE (-32601) if the error object exposes it, rather than the message? (Message-match is the current mechanism; smallest-safe is to tighten it, not re-architect.)

## Architecture & Implementation

All in-place edits, no new modules/abstractions:
- `apps/extension/src/wallet/services/execution/dapp-send-executor.ts` — refactor `executeSendTransaction` onto `runInSlot` (B-02).
- `apps/extension/src/wallet/services/operation-journal/reaper.ts` — `start()` captures `bootCutoff`; `reap()` gains an optional `bootCutoff` that skips this-lifetime rows in the unconditional branch (B-03).
- `packages/bridge-core/src/fee-juice.ts` — tighten the fallback regex (B-19).

## Prove-first test plan (RED before fix)

1. **B-02** (`dapp-send-executor.*.test.ts` or execution composition): drive `executeSendTransaction` with a fake `lane`; assert `lane.acquireSlot` is invoked (currently NOT → RED). Stronger: two concurrent `executeSendTransaction` on the same account → assert their `proveAndSend` do not overlap (the slot serializes) — if the harness supports gated fakes.
2. **B-03** (`reaper.test.ts`): seed a journal row with `createdAt` AFTER the captured `bootCutoff` (this-lifetime) + a `pending` stage; run the boot sweep; assert the fresh row is NOT transitioned to `failed` (currently IS → RED), while a prior-lifetime row (`createdAt < bootCutoff`) still sweeps.
3. **B-19** (`fee-juice.test.ts`): a node whose `getPredictedMinFees` throws `"block not found"` → assert `predictedWorstMinFees` PROPAGATES (does not fall back to getCurrentMinFees) — currently falls back → RED. And a `"method not found"` throw → still falls back (unchanged).

## Validation gates

- `bun run lint` + `bun run typecheck:all`; targeted test files green.
- `bun run audit:vue` (apps/extension touched).
- `NULO_E2E_PROVERLESS=1 bun run e2e:agent` run SOLO (arc 2 per goal — execution/journal is network-behavior).

## Security & Adversarial Considerations

B-02 is the funds-safety fix of this arc: without the slot, a hostile-or-buggy dApp calling `grantPublicAuthwit` twice can force concurrent proving against stale private-note state (double-spent nullifier). The fix reuses the audited mutex. B-03 is a correctness/observability fix (false-failed journal) — no fund risk. B-19 prevents an under-priced fee cap (tx rejection, not fund loss). No new trust boundary; no new persisted shape.

## Decision ledger

- L1 — B-02 reuse `runInSlot` (no new mechanism). **Status: codex conditional — MUST thread hooks (originKey), not undefined; codex pending Fable.**
- L2 — B-03 `bootCutoff` at start() + `createdAt >= cutoff` skip. **Status: codex APPROVES; capture as start()'s first statement, pass into reap().**
- L3 — B-19 tighten. **Status: codex — my regex STILL too broad; mirror BaseWallet: `error.cause?.code === -32601` OR message "Method not found". Drop bare not-supported/unimplemented/not-found.**
- L4 — no new abstraction this arc. **Status: settled.**

### Reconciled design (codex conditional + Fable conditional — both converge, folded, NO third plan round)

- **R-B02** — wrap `executeSendTransaction` in `runInSlot` AND thread `hooks` (F1, both auditors): add a `hooks?: ExecutionHooks` param to `ExecutionService.executeSendTransaction` and `DappSendExecutor.executeSendTransaction`, forward from `executeOperations`'s `send_transaction` case (which already receives hooks from the `grantPublicAuthwit` dispatch carrying `{originKey}`). UI `auth-registry` callers pass none (legitimately `__no_origin__`). Per-origin fairness restored; a hostile dApp spamming `grantPublicAuthwit` can't share/exhaust the bucket with legit ops. Accepted consequence (Fable): `TooManyPendingError` becomes reachable from UI `revokeAuthwits` under the depth-8 `__no_origin__` cap — theoretical (no user runs 8 concurrent UI auth ops), and it's the existing slot-taking contract. `claimOrCreateJournal` (no queued id) → same `beginJournal` (identical record/origin/calls/fence, controller into the same map) — behavior-equivalent (both auditors verified). **F2: MIGRATE the existing `dapp-send-executor.test.ts:174-236` pins** (the ":188 beginJournal" / ":189 markJournal('j1',…)" expectations and the "ZERO slots—preserve" characterization) to the `claimOrCreateJournal`/slot shape — they go RED after the fix by design; add acquireSlot + originKey-forward + release-after-prove assertions.
- **R-B03** — capture `bootCutoff` BEFORE `await services.start()` in `runtime.ts` and thread it into the reaper ctor (F3, Fable): `reaper.start()` uses `this.bootCutoff ?? this.now()` for the boot sweep (the `?? now()` fallback keeps my committed pins valid — they inject `now()`), and passes the captured cutoff into `reap({unconditional, bootCutoff})`, which skips `createdAt >= bootCutoff`. `createdAt` (not `updatedAt`) is the lifetime signal (Fable). This closes the popup-RPC-mid-start window definitively rather than proving a negative.
- **R-B19** — mirror BaseWallet's method-missing predicate (both auditors): fall back to `getCurrentMinFees()` ONLY when `(e.cause as {code?:number})?.code === -32601` OR the message contains `"Method not found"` (Aztec 5.0.1 `safe_json_rpc_server` emits exactly `Method not found: ${m}` + code -32601; client rethrows verbatim with `cause=response.error`). Drop the broad `not supported`/`unimplemented`/bare `not found` tokens (they match argument/state failures). Add a `cause.code === -32601` fallback pin; my `"block not found"` propagation pin stays RED.

### Codex plan-audit conditions (adopted, pending Fable reconciliation)
- **C-B02a** — thread `hooks` (esp. `originKey`) through `ExecutionService.executeSendTransaction` AND `DappSendExecutor.executeSendTransaction` from the `grantPublicAuthwit` dispatch; UI auth-registry callers legitimately pass none. Without this, grants collapse into the `__no_origin__` capacity bucket, losing per-origin fairness.
- **C-B02b** — `claimOrCreateJournal` (no queued id) calls the same `beginJournal` with identical network/account/origin/calls/fence → journal shape/title/subtitle unchanged; controller registration just moves inside the claim helper. Keep the recordTransaction/pending-authwit closure verbatim.
- **C-B02c** — REPLACE the existing contradictory "ZERO slots — preserve" characterization test with pins for: acquireSlot called, `originKey` forwarded, slot released after prove.
- **C-B03** — capture `bootCutoff` as `start()`'s FIRST statement (synchronous, before the alarm-create await), pass the captured local into `reap(bootCutoff)`. Do NOT recompute inside `reap()` (would misclassify rows created between start() and the sweep). Equal-ms / clock-rollback rows conservatively skipped (safer; periodic reap catches ordinary equality after grace). [My committed B-03 pin simulates the race via the injectable `now()` returning before the row's createdAt — an equivalent, deterministic form of codex's "gate alarms.create + create row mid-start"; keep it.]
- **C-B19** — mirror BaseWallet's method-missing predicate inline: fall back to getCurrentMinFees ONLY when `error.cause?.code === -32601` OR the message contains `"Method not found"`. Drop the broad regex entirely. Add a `cause.code === -32601` fallback pin; my "block not found" propagation pin stays RED today.
