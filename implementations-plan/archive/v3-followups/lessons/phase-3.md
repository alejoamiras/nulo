# P1 phase 3 — wire the cap into the sendTx path

**Done.** `acquireExecutionSlot` now enforces the dual cap. `originKey` is
threaded from `ctx.origin` (dispatcher) → `execute` → `executeOperations` → both
send paths → `acquireExecutionSlot`, via `IExecutionHooks.originKey` — and the
dispatcher sets it ALWAYS (not gated on the FIFO hooks), so every dApp sendTx is
capped. Caps from constants (`EXECUTION_ORIGIN_CAP=8`, `EXECUTION_LANE_CAP=32`).
On `ExecutionMutexCapacityError`: terminalize the `queuedJournalId` record
(`failed`) HERE — covers the silent-path `pending` case the background safety-net
misses — then throw `TooManyPendingError` (→ -32005).

**Codex audit (before wiring): ship-it** on the mutex+error; it restated the
wiring contract (originKey=ctx.origin, cap-reject cleanup, journal terminalization)
— all applied. Added its suggested "repeated abort while capped" mutex test.

**Lessons:**
- The widened mutex import exceeded biome's line width → a *format* error (not the
  import-ordering I first assumed). `biome format --write` wrapped it. Distinguish
  "Formatter would have printed" (width/whitespace) from organizeImports (order).
- `onEnqueued` (baton release) fires even on a capacity reject — `acquire`'s
  synchronous cap-check rejects before enqueue, so it's a harmless early
  baton-advance for a request that just failed (the safety-net would release anyway).

**Validation:** typecheck:all ✓ · 16/16 mutex tests · lint ✓.
**Next (P1.4):** originKey-forwarding tests (dispatcher + dapp-interaction).
