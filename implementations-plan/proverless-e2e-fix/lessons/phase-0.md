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
Phase 0 design DONE; **gate PENDING the falsifier soak (27676912669).** Phase 1 (build the batcher) is blocked until the falsifier passes. Watcher armed.
