# Fable audit trail — dedup-fee-estimation

Claude-side leg of the mid-tier dual audit (Plan agent, adversarial + assumption-attack asks). Two rounds; paths repo-relative.

## Round 1 — Outline A vs B (on the original plan)

### HIGH — H1: plain `computed` silently hollows a characterization pin (writable-ref contract)

Plan inference I1 is **type-level true** in this repo's Vue 3.5.x (`ComputedRef` extends `Ref` through the reactivity type chain), so typecheck passes. But `UseFeeEstimationResult.result` is a *writable* `Ref` contract, and the scalar suite writes it (`result.result.value = 42` to seed a stale value). Under a wrapper's read-only computed, that write silently no-ops (dev-mode warning only; no console trap in vitest setup, so it won't fail). The test still goes green — **vacuously**: the "clears result on schedule" pin no longer tests clearing. Fix: writable computed; add to the D-checklist.

### MEDIUM — M1: Outline B rejection reason (2) was factually wrong

`apps/extension/vite.config.ts:143` scans `dirs: ["src/composables/", ...]` **non-recursively** — an engine at `src/composables/internal/` escapes auto-import; the "privacy is illusory" claim doesn't hold. The arbitration conclusion still stood on the Middle Man + blast-radius grounds. A "peek + markHandedOff" third shape needs two engine members and splits the invariant across layers — worse. (Round-1 verdict: A genuinely higher quality.)

### MEDIUM — M2: "completed preference" test targets an unreachable state

Per key, `completed` and `inflight` never coexist: `schedule` clears completed via the owned-remote cancel before setting inflight; success clears inflight. The `completedToken ?? inflight?.token` chain never actually arbitrates. Reframed as two reachable tests.

### LOW — L1: missing pre-refactor pin (third handoff path)

handoff → re-`estimate()` supersede → no remote cancel for the handed-off token. Added to Phase 1.

### LOW — L2: D-scalar-3's "never on stale-counter cancels" had no pin

No test rejected post-cancel. Added.

Equivalence attack (confirmed clean): computed recompute synchronous on read; per-key counters ≡ single counter for one fixed key (dispose's `counter++` masked by `disposed`); never-started handoff + dispose traced identical; inner `onScopeDispose` registers in the caller's scope; empty record vs null refs masked by coalescing; exact-arity estimator assertions would catch a 3-arg pass-through.

**Round-1 verdict: conditional approve** (writable computed; ledger correction; unreachable-state test replaced; supersede pin) — endorsing Outline A.

## Round 2 — Shape C cross-check (after codex rejected A)

### Middle Man question — resolved, objection does not apply

Round-1's Middle Man objection targeted B, where the engine WAS the map minus refs and the map delegated its entire identity. Under C the map keeps Vue state ownership (Record sinks), flowKey/instanceId minting in its `run` adapter, `handoffAll` shape adaptation, and its defaults; only `cancel`/`cancelAll`/`rearm`/`dispose` are pure delegations — to a deliberately private, non-Vue module the caller cannot reach. That is an adapter over a hidden engine, not Fowler's Middle Man (which requires delegation to an object the caller could use directly). The peek-splits-the-invariant objection is answered: `handoffInclusive`/`handoffCompleted` are atomic (select + mark in one call). Codex's three A-defects are verifiably dissolved structurally. **Round-1 A endorsement withdrawn; C dominates both A and B.**

### MEDIUM — C1: sink-call ordering unpinned in the D-checklist

Today's write orders (schedule: clear-result before estimating-true; cancel: result-null before estimating-false; error: `onError` before the finally flips estimating false) are observable via `flush: 'sync'` watchers and inside the `onError` callback. Condition: add a D-item pinning sink invocation order. → Adopted (D-order-1..3 + pins).

### LOW — C2: test-count arithmetic slip

"46 scalar + 19 keyed" phrasing claimed 65 tests; actual was 27 + 19 = 46. → Fixed.

### LOW — C3 (recommendation): reverse L6 — adopt a `TResult` engine generic

The generic type-couples `run: Promise<TResult>` to `onResult(key, TResult | null)`, eliminates per-adapter casts, and turns a wrong-value sink call into a compile error. "Buys nothing" was not true. → Adopted, L6 reversed.

Confirmed clean under C: no sink re-entrancy hazard (Vue queues watcher flushes; sinks are plain assignments), per-composable engine + own `onScopeDispose` (no shared-scope hazard), post-dispose settles sink-silent, dispose-leaves-estimating-true holds structurally, `handoffCompleted` order-insensitive for existing pins, successful `null`/`undefined` flow-through harmless.

**Round-2 verdict: conditional approve** (C1 sink-order D-item; C2 count fix) + C3 recommendation — all applied.
