# Remediation record — bugs audit 2026-08-16-extension-mid

Full remediation of correctness findings B-01..B-30 from [`report.md`](./report.md), executed as sequential codex-converged PRs into `dev`. Every bug arc was **prove-first**: a RED test (unit / composition, or a script only where unreachable) reproducing the finding's counter-example was written BEFORE the fix and became the green regression pin. Every arc: blueprint (light/mid per risk) → codex xhigh design consults → implement → repo gates (+ armed smoke / SOLO proverless network e2e where the arc touched that surface) → one codex xhigh pass over the complete arc diff → converged → squash-merge. The verified findings ([`findings/verified.md`](./findings/verified.md)) were authoritative over [`findings/consolidated.md`](./findings/consolidated.md) throughout.

**All 30 bugs remediated. No NOT-REPRODUCED findings** — every counter-example reached RED and turned green under fix.

## Finding → PR map

| Finding | Title (short) | Arc | PR | Status |
|---|---|---|---|---|
| B-01 | Session-persist failure swallowed → false unlock/lock success | 1 fix-session-profile | #384 | ✅ remediated — persist-first then in-memory transition + post-op verify |
| B-02 | `executeSendTransaction` never acquires the ExecutionMutex slot | 2 fix-execution-journal | #385 | ✅ remediated — dApp sends take the mutex slot |
| B-03 | Boot reaper fails a newly-started live op on cold SW start | 2 fix-execution-journal | #385 | ✅ remediated — `bootCutoff` guards this-lifetime ops |
| B-04 | Profile switch jams a queued token-balance sync (orphaned `pendingTasks`) | 3 fix-state-fences | #386 | ✅ remediated — both-ends cleanup |
| B-05 | `onActiveProfileChanged` has no incarnation check → wrong-profile token map | 3 fix-state-fences | #386 | ✅ remediated — generation fence |
| B-06 | Concurrent same-`(origin,chainId)` sessions overwrite verification hash | 4 fix-transport-sessions | #387 | ✅ remediated — per-session verification isolation |
| B-07 | OPFS-open 30s timeout doesn't cancel the worker → chain PXE wedge | 5 fix-pxe-offscreen | #391 | ✅ remediated — `ChainStoreWedgedError` + in-flight quarantine |
| B-08 | Forced gas-balance refresh overwritten by a slow pre-trigger fetch | 3 fix-state-fences | #386 | ✅ remediated — generation fence on commit |
| B-09 | "Select Profile" writes `appStore.profile` directly, bypassing send guard | 6 fix-ui-storage | #393 | ✅ remediated — routed via `commitScopeChange` + latch |
| B-10 | Zeroize gap — secret buffers abandoned on exception before `try/finally` | 1 fix-session-profile | #384 | ✅ remediated — owning-frame entry hardened |
| B-11 | Abandoned passkey restore parks master secret un-zeroized for SW life | 1 fix-session-profile | #384 | ✅ remediated — bounded secret lifetime |
| B-12 | Failed tombstone write leaves a profile falsely reserved for SW life | 1 fix-session-profile | #384 | ✅ remediated — tombstone-wedge unstick |
| B-13 | `onSessionEstablished` unguarded branches leak `pendingVerification`/skip verify | 4 fix-transport-sessions | #387 | ✅ remediated — arrival-time journal + guarded branches |
| B-14 | Capability grant lost across independently-locked writes (concurrent revoke/approve) | 4 fix-transport-sessions | #387 | ✅ remediated — re-verify under lock |
| B-15 | RPC timeout doesn't cover connection establishment → wedged transport hangs | 4 fix-transport-sessions | #387 | ✅ remediated — timeout spans establishment |
| B-16 | Queued discoveries vanish on SW restart / approve after dApp stopped waiting | 4 fix-transport-sessions | #390 | ✅ remediated — SDK 60s staleness window + rollback-safe approval (restart-safety follow-up F-B16) |
| B-17 | Offscreen lifecycle — 3 unfenced-continuation gaps (late Firefox create, init-as-ready, unjoined timeout) | 5 fix-pxe-offscreen | #391 | ✅ remediated — pass-seq fence + `servicesReady` gate + serialized closes |
| B-18 | Chain purge → resurrection from an op that entered during the erase | 5 fix-pxe-offscreen | #391 | ✅ remediated — double-bump purge epoch (both ends) |
| B-19 | `predictedWorstMinFees` substring "not found" match downgrades fee prediction | 2 fix-execution-journal | #385 | ✅ remediated — exact fee-error match |
| B-20 | Stale hydration reinstalls inactive-profile incoming-transfer pollers | 3 fix-state-fences | #386 | ✅ remediated — generation fence |
| B-21 | PriceService kill-switch clobbers a newer refresh's single-flight + abort-timeout | 3 fix-state-fences | #386 | ✅ remediated — generation-owned cleanup |
| B-22 | Migration-barrier recheck failure hangs every UI storage access | 6 fix-ui-storage | #393 | ✅ remediated — rejecting re-check (removeListener + reject) |
| B-23 | `EntityStorage` malformed-row delete destroys a concurrent valid replacement | 6 fix-ui-storage | #393 | ✅ remediated — RETAIN on read (non-destructive); serialized-repair follow-up F-B23 |
| B-24 | Failed rollback `deleteProfile` leaves an orphaned, selectable, never-finalized profile | 6 fix-ui-storage | #393 | ✅ remediated — bounded retry + distinct cleanup-pending error; deletion-status follow-up F-B24 |
| B-25 | Live token-balance add crashes Send — `tokenBalance.push is not a function` | 6 fix-ui-storage | #393 | ✅ remediated — array reducers in `send-balance-events.ts` |
| B-26 | Double-clicking a trust decision dismisses the next queued prompt | 6 fix-ui-storage | #393 | ✅ remediated — `isSubmitting` latch + `payloadKey()`-guarded close |
| B-27 | Import-timeout recovery races the running bootstrap activation | 6 fix-ui-storage | #393 | ✅ remediated — per-id single-flight + generation fence; `setupActiveAccount` residual follow-up F-B27 |
| B-28 | Wrong success-toast token label if identity switches mid-RPC | 6 fix-ui-storage | #393 | ✅ remediated — capture symbol before the await |
| B-29 | `activity.store` LRU eviction blind to live in-progress work (dropped placeholder / ABA) | 3 fix-state-fences | #386 | ✅ remediated — live-scope-aware eviction + fence |
| B-30 | Lazy service clients leaked on early-exit/error paths | 6 fix-ui-storage | #393 | ✅ remediated — idempotent disconnect + `submitInFlight` gate |

Arc 0 (#383) committed this audit directory itself.

## Documented deviations / owned follow-ups (codex-agreed)

- **F-B16 (restart-safety)** — B-16 ships rollback-safe approval + the SDK 60s staleness window; a deeper SW-restart durability pass for the queued-discovery journal is an owned follow-up.
- **F-B23 (serialized malformed-row repair)** — B-23's fix is the finding's own recommendation (stop the read-path delete; RETAIN + log). Purging/repairing a genuinely malformed row belongs in a serialized repair path, not the read path — owned follow-up.
- **F-B24 (ProfileService durable deletion-status)** — B-24 surfaces a distinct "cleanup pending" error rather than a false success; a durable deletion-status field on the profile row (so a later unlock can resume the compensating delete) is an owned follow-up.
- **F-B27 (`setupActiveAccount` generation fence)** — B-27's composable single-flight + generation fence close the finding's counter-example; a residual store-level race (`appStore.setupActiveAccount` assigns `account` without bootstrap-generation awareness) is a store-level follow-up.
