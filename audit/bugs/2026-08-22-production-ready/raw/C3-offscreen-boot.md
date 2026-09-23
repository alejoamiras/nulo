# Cluster C3 — offscreen supervision + SW boot + cold-wake relay (lifecycle lens)

> Scanner: general agent, 2026-08-22.

## C3-1 — Migration retry budget is spent by *ambient* SW wakes; a "retryable" block silently auto-escalates to terminal ("Reinstall the extension") with no user action

**Severity:** Medium-High (≈Critical for affected users) | **Repro confidence:** high (every link code-verified; no counter-mechanism found) | **Type:** Lifecycle / design-gap made reachable by routine MV3 wake traffic

**Mechanism (code-verified):**
1. apps/extension/src/wallet/index.ts:103-111 — logger.rehydrate().then(() => runtime.start()) is MODULE TOP-LEVEL code, so EVERY SW wake — dApp content-script message from any tab, popup open, alarm, port connect — executes a full doStart() incl. Migrator.run() (runtime.ts:143). Alarm shim (index.ts:91-99) adds an extra autonomous 3-min-periodic driver whenever price alarm exists.
2. packages/wallet-core/src/migration/migrator.ts:246 — each failing run bumps the durable per-(version,phase) attempt counter; journal cleaned (:247); nothing in runInner() consults persisted blocked status to short-circuit.
3. migrator.ts:56,254 — DEFAULT_MAX_RETRIES = 3; at attempts >= 3 result flips terminal: true (needs-recovery becomes retryable: false :240).
4. apps/extension/src/components/MigrationBarrier.vue:21-32 — terminal flips copy from "UPDATE INTERRUPTED — close and reopen to retry" to "UPDATE FAILED — Reinstall the extension to start clean."

**Concrete counter-example:** update ships migration N; up() throws transiently (storage quota/disk pressure — run()'s catch converts ANY storage exception into retryable: true, migrator.ts:124-132). Boot blocks; user sees "restart to retry", goes back to browsing. Their dApp tabs reload → each fires cold-wake CS message → full doStart() → attempt++. Attempt 2 next tab reload, attempt 3 shortly after (or with the price alarm surviving into the blocked regime, every 3 min autonomously). Within minutes-to-hours of ordinary non-consenting activity the block becomes terminal and barrier instructs destructive recovery — for a condition a single manual retry next day might have survived.

**Amplifier (version-dependent):** price alarm (price/service.ts:27,258 periodInMinutes: 3) persists across SW restarts; per Chrome semantics alarms are cleared on extension update reliably only from ~Chrome 150; Firefox keeps them within browser session. Where alarm survives into blocked regime, burn cadence is machine-driven (≤3 min).

**Violated invariant:** runtime.ts:107-122 and :167-171's own contract — the veto exists so an in-lifetime retry loop wouldn't consume cross-boot budget and flip a recoverable block terminal without a real boot. Veto only stops same-lifetime retries; cross-lifetime retries driven by arbitrary wake traffic achieve identical outcome. MigrationBarrier copy promises user-controlled retries; ambient events spend budget invisibly.

**Smallest safe fix:** at doStart() entry BEFORE Migrator.run(): read persisted SCHEMA_BLOCKED_KEY; if non-terminal blocked status already exists, skip re-running engine and rethrow blocked error directly. Alternative/complement: timestamp in blocked status + cool-down (e.g. 15 min) refusing engine re-runs.

**Instances:** wallet/index.ts:103-111 · index.ts:91-99 · runtime.ts:143-175 · migrator.ts:56,240,246,254 · MigrationBarrier.vue:21-32.

## Verified clean (lens-by-lens)

- Pass fence passSeq: traced every early-return/throw between ++passSeq and completion. Timeout handler fences before closing (:113); ghost-retry re-checks fence after close suspends (:260); Firefox window-handle assignment fenced identically (:287); successors join pendingClose before probing/creating (:352). All closes serialize through one closeTail; lone direct windows.remove targets pass's own unfenced orphan. Joiner's check-then-await of offscreenPromise has no suspension point between them.
- Ready-gate vs pending createDocument: race bounds hung-create wedge; late loser rejections swallowed (:380); post-READY un-awaited creating + ghost-READY-during-teardown documented accepted races (:392-398), worst case transient failed request recovered by next pass probe+ping.
- Single-flight boot memo: memo-reset ordering cannot clobber successor memo; vetoed-boot recovery = fresh module state on next wake; alarm shim guarantees vetoed workers keep waking (bounded noise) rather than wedging dead. Promise.all legs have handlers.
- Cold-wake relay: strictest-admission buffering, snapshot-and-clear before drain (no replay/double-journal; duplicate delivery structurally impossible given single-listener ownership). Mid-drain sync-throw remainder-loss by design, below threshold.
- Keepalive/offscreen-death: 20 s pings reset SW idle timer for invoke duration; offscreen killed mid-prove → waiter hangs to deliberate 30-min sanity ceiling with journal reaper/cancelJob recovery on next transport touch — bounded.
- Liveness: single writer; sole production consumer ceiling 60 s comfortably exceeds 10 s heartbeat; dual causal observers; stale-value semantics fail-closed. Session-TTL one-shot missed on cold wake backstopped by reactive isExpired close in getActive().
- Alarm shim: ticks forwarded only after start() settles; price alarm single-dispatch; session alarm bypasses dispatcher with scheduledTime staleness gate.
