# Audit — fable-role (Opus 4.8) fresh hostile pass on the consolidated plan

Fresh-context adversarial auditor, no stake in the plan, verified every load-bearing claim against the code.

## VERDICT
**reject (blocking: §9.4 holds the profile facade `Lock` across `node.sendTx`, but that Lock force-releases after
5 min (`packages/wallet-core/src/utils/lock.ts:4,37-44`) and sendTx's worst case is ~4 min with zero margin — the
safety net can fire mid-submit, defeating the serialization the whole abort design rests on AND double-releasing
the lock for all profile ops; plus an unspecified/invertible journal↔coordinator lock order (§5.6/§6/§10); plus
silent drop of an on-chain tx when a chain-purge retires the incarnation post-send).**

## BLOCKING

### B1 — §9.4 holds the facade `Lock` across `node.sendTx`; the 5-min force-release defeats serialization + corrupts the lock
- Facade lock `lock.ts` force-releases after `MAX_HOLD_MS = 5*60_000` (line 4); the timer (37-44) calls
  `this.leave()` **while the original holder is still running**.
- `node.sendTx` → `makeFetchWithTimeout()` (`aztec-node-factory-adapter.ts:55`), `DEFAULT_REQUEST_TIMEOUT_MS =
  60_000` per attempt (`fetch.ts:18`) × `retry(makeBackoff([1,2,3]))` = 1 initial + 3 retries = 4 attempts + 1+2+3s
  backoff ≈ **~246s (~4.1 min)** on a hanging endpoint — a hair under the 5-min ceiling with **zero margin**.
- Failing interleaving: SW-timer throttling / a future timeout bump / the extra awaits under the lock push the
  held section past 5 min → force-release fires → `leave()` dispatches the queued profile switch W → W changes
  active profile while the in-flight P1 `sendTx` still "holds" → abort-on-drift defeated (H5 reintroduced). Then
  the original holder's `finally leave()` clears W's timer + flips `locked=false` mid-W → lock corrupted
  wallet-wide.
- The established ProfileService pattern is the opposite — every slow op (PBKDF2 phases, WebAuthn) is structured
  to NEVER hold this lock across the slow part. §9.4 holds it across the slowest, least-bounded op in the system;
  the plan never mentions `MAX_HOLD_MS`.
- Fix: do NOT hold the facade `Lock` across `node.sendTx`. Use a dedicated short-lived submit-gate / CAS on
  incarnation+epoch with a bounded few-second submit hold and no 5-min force-release.

### B2 — even without force-release firing, §9.4 is a wallet-wide availability regression
`this.lock` (`profile/service.ts:77`) gates `getActiveProfile` (:209, popup poll), `lockActiveProfile` (:533,
emergency lock-wallet), `refreshSession` (:601), `captureExecutionFence` (:225), and the SessionManager TTL
auto-lock. Holding it across 60s–4min `sendTx` freezes ALL of these — including a security-sensitive action.
§9.6/A5's "a stalled node can briefly delay a switch" is a **misstated fact**: the real bound is minutes and the
scope is every profile op.

### B3 — journal↔coordinator lock order unspecified + internally invertible (H3 seam)
§5.6 (`facade→activity-scope→source`) vs §6 (all journal ops incl. snapshot reads take the GLOBAL `transitionLock`,
`operation-journal/service.ts:62-82`) vs §10 (`queuedCreationLock→transitionLock→activity-source`). ABBA on
`transitionLock ↔ activity-scope`: a transition holds `transitionLock` then emits into the coordinator
(transition→scope); a snapshot holds scope then calls `journal.getActivitySnapshot` which takes `transitionLock`
(scope→transition). Specify ONE total order + show it inversion-free.

## SERIOUS
- **S1 — post-`sendTx` recording is incarnation-fenced → silent drop of an on-chain tx.** If a chain-purge / same-
  address re-add retires the incarnation between fence capture and the post-send write, the write is rejected →
  the tx is irreversible on-chain but dropped from local history. Post-`sendTx` recording must be UNCONDITIONAL
  (mirror D13). Contradicts Outcome-4.
- **S2 — builder TOCTOU.** §9.3 "assert match" then `buildStandard`/`buildNoFrom` independently call
  `requireActiveProfile` (`tx-request-builder.ts:113/382`) and resolve the account from active-now
  (`getAccountContract(profile.id,…)` :115/:387) — the same two-acquisition window as H4. The builder must
  CONSUME `fence.profileId`, not re-derive.
- **S3 — global `transitionLock` on snapshot reads couples UI nav to execution.** Snapshot reads full-scan the
  journal; §7 fires one on every cold-scope activation (every switch) → serializes against all execution journal
  transitions. Read path must not take the global write lock.

## MINOR
- **M1 — Phase 3/4 entanglement.** Execution stamps tx/journal `profileId`/incarnation only in Phase 4
  (`execution-coordinator.ts:78,176`), so at the Phase 3 commit every real tx has undefined `profileId` → §8
  quarantines colliding addresses → they vanish. Phase 3's isolation gate is store-synthetic only.
- **M2 — §13/H8 vs I1 muddle.** Re-import mints a fresh `profileId` (`profile/service.ts:837-841,993-999`) → a
  different scope key, no collision (supersedes the BRIEF's H8 re-import framing). The incarnation is relevant
  only for `pxeGeneration` bump / same-address re-add / chain purge / same-id restore.

## What's genuinely solid
- **Ground truth §3 is verified, not asserted** — every load-bearing fact checks out (account keyed by address
  `account/spec.ts:5-30`; tx has no profileId/networkId; journal `profileId` required `spec.ts:66-72`; incoming
  keyed by bare nullifier `repository.ts:51-64`; `transitionLock` global + create/delete/setMeta unlocked
  `service.ts:62-82`; mutex + both builders read active-now; H7 `journalRecordInScope` ignores profileId; the
  frozen prove→send pipeline with `checkCancelled` before send). Unusually rigorous.
- **`captureExecutionFence(expectedProfileId)` correctly closes H4** (I3 a sound inference).
- **Coverage-watermark correction (§5.1/D4) is genuinely right.**
- **(scope, siloedNullifier) key (D9) correct.**
- **I2 verified:** a plain profile lock/switch does not call `cancelJob` (`execution-lane.ts:136-180`).
- **D16 inert-gate is a clean blast-radius framing, provided the `captureFence`/`proveAndSend` threading is
  faithful.** EventHandler.invoke is synchronous (`event-handler.ts:22-28`), ruling out one ABBA class.

## Critical files
`packages/wallet-core/src/utils/lock.ts` (the 5-min force-release) · `profile/service.ts` (facade lock +
captureExecutionFence) · `execution/execution-coordinator.ts:174-175` (submit boundary) ·
`operation-journal/service.ts` (global transitionLock; the §6/§10 seam) · `aztec-runtime/src/utils/fetch.ts`
(the ~4-min sendTx bound).
