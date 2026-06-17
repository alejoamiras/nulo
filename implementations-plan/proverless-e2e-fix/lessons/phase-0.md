# Phase 0 — Falsifier (in flight) + batcher design

## Choke point — confirmed
`offscreen/index.ts:23-28` installs a per-console-method hook that calls `logger.log("pxe", level, ...args)` — **one `request("log", …)` RPC per console call** (`logger/client.ts:21`) → one `LoggerService.log` handler (`logger/service.ts:21`) → one `LoggerStore.logWithContext` (trim/store/onLog/print, `store.ts:46-61`) on the single SW loop. `LogLevel`: `Debug=0,Info=1,Warn=2,Error=3`; `console.log → Info` (`wallet-core/src/logger/interfaces.ts:45`). The upstream @aztec `block_synchronizer` "Updated pxe last block to N" is a `console.log` (Info) **per block** → during a backlog, thousands of per-call RPCs flood the SW loop. Diagnosis SW-trail was **50/50 these** Info lines.

## FALSIFIER — gate, IN FLIGHT (must pass before Phase 1)
Throwaway no-flood build (`soak/falsifier-noflood`): `if (level >= LogLevel.Warn) logger.log(...)` — drops Info/Debug forwarding (removes the flood), keeps Warn/Error. Soak: F3 isolation (`multi-account-from`), 12×, retry=0, proverless — **run 27676912669**.
- **Baseline:** F3 isolation ~33% stall (diagnosis soaks: 2/3, 4/12).
- **PASS criterion:** no-flood stall rate ≈ 0 → the flood IS the dominant SW load → build the batcher (Phase 1).
- **FAIL criterion (STOP):** still ~33% → the flood is NOT dominant (other SW work) → stop + reassess (don't build the batcher on a false premise). This is the codex-H1 falsifier.

## Batcher design (build in Phase 1 ONLY if the falsifier passes)
A clean, unit-testable unit (NOT inline in offscreen): `createBatchingForwarder(logger, opts)` →
- Buffer `{ level, data }` entries (source always "pxe", context "offscreen" bound by the client).
- **Warn/Error → flush immediately** (flush the buffer first, in order, so Warn/Error is prompt AND ordered after prior Info/Debug). (audit H2: ordered-within-batch + Warn/Error immediate.)
- **Info/Debug → buffer** + a **debounced flush** (~50ms) + flush when buffer ≥ `maxBatch` (~200).
- **Bounded buffer** (~1000): drop-oldest + a dropped-count, and emit a "dropped N logs" notice (never block, never unbounded).
- **Teardown flush** (best-effort — MV3 offscreen lifecycle, NOT a guarantee; audit: Info/Debug may still be lost, Warn/Error must not).
- Flush sends the batch via a NEW `logBatch(entries)` on `LoggerService`/`LoggerServiceClient` (extend `logger/spec.ts` `Methods`), which loops `logWithContext` for each in **ONE handler turn** (collapses N SW event-loop wakes → 1; audit H1).
- `offscreen/index.ts:25-26` routes the console hook through the forwarder.

## Status
Phase 0 design DONE. Batcher BUILT as prep (commit 58b1388, unit-green) — but its efficacy is gated on the falsifier.

### ⚠ FALSIFIER EARLY RESULT — hypothesis AT RISK (run 27676912669)
At 2/12 iterations, **1 failed — and the failure is the IDENTICAL queued-stall** with the flood ENTIRELY removed:
`{"stage":"queued","createdAt===updatedAt,"attempts":0,"title":"transfer_public_to_public"}` (job 81855076148).
So F3 stalls even with **zero** offscreen→SW Info/Debug forwarding. Logical consequence: if removing 100% of the flood doesn't eliminate the stall, **batching it can't reliably eliminate it** either — and zero-flake-required tolerates no residual stall. The diagnosis's "SW-log-flood backpressure" mechanism is at least partly WRONG; the real cause is elsewhere (other SW-loop load, or offscreen-side PXE contention the SW-local reads still wait on).
**DEFINITIVE — FALSIFIER FAILED → STOP.** No-flood rate = **3/7 ≈ 43%**, vs baseline ~33% → **NO reduction** (if anything higher; n=7 is conclusive that it's not near 0). Removing 100% of the offscreen→SW log forwarding does NOT ease the F3 queued-stall. ⇒ the logger-RPC flood is **NOT the cause**; **batching cannot fix F3**; the diagnosis's "SW-log-flood backpressure" mechanism was **WRONG for F3**. The whole fix plan (v2) rests on that premise → **DEAD**. Soak cancelled at 7/12 (conclusive); `/loop` stopped.

### What this means
- The `createBatchingForwarder` (commit 58b1388, 8 tests green) is **good logging hygiene — keep it** — but it is NOT the F3 fix.
- **Re-diagnosis required.** F3's execution-start stalls at `queued` (pre-`executionMutex.acquire`, SW-local `getActiveProfile`/`getNetwork`/preflight) even with the SW log channel silent → the contention is elsewhere. **Leading new candidate: `chrome.storage.local` contention** — the offscreen PXE persisting sync state to `chrome.storage.local` during the backlog starves the execution-start's SW-local `chrome.storage.local` reads (same storage layer, IPC-serialized). No log-flood needed. This was NOT tested by the original diagnosis (which over-fit the log-trail evidence).
- Process note: the original diagnosis correlated the stall with the PXE-sync trail but **inferred** the *log-RPC flood* as the mechanism; it never falsified that vs other sync-time SW load. Codex's H1 (on plan v2) flagged exactly this; the Phase-0 falsifier confirmed it. Lesson: correlation (PXE busy during stall) ≠ the specific mechanism (which sub-activity blocks).

LESSONS_FILE=implementations-plan/proverless-e2e-fix/lessons/phase-0.md
