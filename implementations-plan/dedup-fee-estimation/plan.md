# dedup-fee-estimation — Q-03: one fee-estimation state machine, two public composables

Remediation arc 8 (final implementation arc) of the quality audit `audit/quality/2026-08-14-dedup-mid`. Finding Q-03: `useFeeEstimation` (scalar) and `useFeeEstimationMap` (keyed) hand-roll the identical debounce/counter/inflight/completed-token/cancelRemote/handedOff/dispose machinery twice. Both files changed in lockstep in the same two feature commits — textbook Shotgun Surgery. The verified finding (`audit/quality/2026-08-14-dedup-mid/findings/verified/Q-03.md`) is authoritative and this plan implements its refined recommendation.

## Success criterion

- `useFeeEstimation` no longer owns a parallel state machine — one debounce/token engine exists.
- **Zero consumer-visible change**: `send.vue` and `execute/index.vue` keep their exact destructured APIs, types, and defaults (800ms / 500ms).
- All characterization tests (39 pre-existing + 7 new pins + 1 hardened = 46 scalar-file+keyed-file total) pass **unchanged post-refactor** (they are the behavior proof).
- The two verified seams preserved exactly:
  1. `handoff()` (scalar) stays **in-flight-inclusive** (`completedToken ?? inflight?.token ?? null`); `handoffAll()` (keyed) stays **completed-only**.
  2. `flowKey` stays keyed-only: the scalar estimator keeps its 2-arg signature; the wrapper drops the third arg.

## Assumptions

### Facts (verified against source)

- F1 — Scalar `handoff()` returns `completedToken ?? inflight?.token ?? null` and marks it handed off (`useFeeEstimation.ts:131-135`). The inflight token exists from schedule time, so `handoff()` can hand off a token whose RPC hasn't even started.
- F2 — Keyed `handoffAll()` iterates **only** `completed` (`useFeeEstimationMap.ts:143-150`); its TSDoc says in-flight estimates are deliberately left armed.
- F3 — Keyed estimator signature is 3-arg with `flowKey = op:${instanceId}:${key}` (`useFeeEstimationMap.ts:10,120`); scalar is 2-arg (`useFeeEstimation.ts:10`).
- F4 — Defaults differ by design: 800ms scalar / 500ms keyed, each documented in its own TSDoc.
- F5 — Exactly one consumer each: `send.vue:266-267` (`result, isEstimating, estimate, cancel, handoff`), `execute/index.vue:128-131` (`results, estimating, estimate, handoffAll, rearm, cancelAll`). Neither calls `dispose()` explicitly.
- F6 — 21 scalar + 18 keyed characterization tests exist. The scalar `(HANDOFF RACE PIN)` covers the **completed**-token handoff only; **no test pins the in-flight handoff** (F1's `inflight?.token` branch reached via handoff, then no remote cancel on dispose).
- F7 — Keyed-only members with no scalar analog: `cancelAll()`, `rearm()`, `instanceId`. These must NOT surface on the scalar API.
- F8 — `keyed cancel(key)`/`schedule(key)` write `results.value[key] = null` and flip `estimating.value[key]`; an absent key reads `undefined`. The scalar wrapper's computed unwraps must coalesce (`?? null`, `?? false`).

### Inferences (audit should challenge)

- I1 — (SUPERSEDED by Shape C — both auditors confirmed the type-level assignability but flagged the runtime writable-Ref hazard; C uses plain refs, no computeds anywhere.)
- I2 — The keyed engine's per-key counter/disposed guards are behaviorally equivalent to the scalar's single counter/disposed guards for a single fixed key. The 21 unchanged scalar tests are the proof.
- I3 — Always minting a flowKey in the keyed engine and dropping it in the scalar adapter is harmless — the scalar estimator (`estimateTransferFee`) never sees or uses it.

### Asks (owner decisions already made)

- The goal authorizes this arc ("sentinel-key wrapper over useFeeEstimationMap, preserve flowKey + handoff()/handoffAll() seams") and per-arc merge. No open asks.

## Architecture & Implementation (consolidated — Shape C: state-sink engine, both composables keep their exact public surfaces)

Post-dual-audit consolidation. The dueling outlines (A: additive `handoff(key)` on the keyed API + sentinel wrapper; B: engine owning the Vue state, map as pass-through) each died on a real defect — A puts a misuse-hazard member on the multi-op public surface and forces computed-unwrap patches (writable computeds, `?? null` `undefined`-coercion); B makes the map a Middle Man. Shape C (codex's counter-proposal, refined) keeps ONLY the genuinely duplicated machinery in the engine and leaves ALL Vue state + API adaptation in the composables.

### New module — `src/composables/internal/fee-estimation-engine.ts`

Genuinely private: the auto-import `dirs` scan (`apps/extension/vite.config.ts:143`) is non-recursive, so nothing under `internal/` is auto-importable — explicit imports only. Pure TS, zero Vue imports (unit-testable without an effect scope; the composables own `onScopeDispose`).

```ts
export interface FeeEstimationEngineOptions<TKey extends string | number, TParams> {
  /** The RPC leg. Receives the raw key — adapters mint flowKeys etc. themselves. */
  run: (params: TParams, estimateToken: string, key: TKey) => Promise<unknown>
  debounceMs: number // required — each composable supplies its own documented default
  onResult: (key: TKey, result: unknown) => void   // null clears; adapters own the refs
  onEstimating: (key: TKey, estimating: boolean) => void
  onError?: (key: TKey, err: unknown) => void
  cancelRemote?: (estimateToken: string) => void
}
export interface FeeEstimationEngine<TKey extends string | number, TParams> {
  schedule(key: TKey, params: TParams): void
  cancel(key: TKey): void
  cancelAll(): void
  /** Single-slot submit seam: completed ?? in-flight token, marked handed off. */
  handoffInclusive(key: TKey): string | null
  /** Multi-op approve seam: completed tokens ONLY, each marked handed off. */
  handoffCompleted(): Array<[TKey, string]>
  rearm(): void
  dispose(): void
}
```

The engine owns `timers`/`counters`/`inflight`/`completed`/`handedOff`/`disposed` and every transition (the exact bodies of today's keyed `schedule`/`cancel`/`cancelOwnedRemoteFor`/`dispose`, with record writes replaced by `onResult`/`onEstimating` callbacks — invoked at the same points, synchronously). Both handoff operations are ATOMIC engine members (token selection + `handedOff` marking in one call) — the invariant is never split across layers, which was the fatal flaw of a bare `peek()`.

Generics note: the engine is `TParams`-generic but result-`unknown` — the composables own `TResult` typing at their unchanged public boundaries; the engine never inspects results. This keeps the engine free of a third type parameter that would buy nothing (internal helper, looser types are fine per the repo's boundary policy).

### `useFeeEstimationMap` — thin adapter, public API BYTE-IDENTICAL

Keeps: its interfaces, `results`/`estimating` Records, 500ms default, `instanceId` minting, and the flowKey construction — its `run` adapter is `(params, token, key) => estimate(params, token, `op:${instanceId}:${String(key)}`)`. `handoffAll()` = wraps `engine.handoffCompleted()` into the `Partial<Record<TKey, string>>` shape. `rearm`/`cancel`/`cancelAll`/`dispose` delegate; `onResult`/`onEstimating` write the Records exactly where today's inline code does. Registers `onScopeDispose(dispose)` as today. `handoffInclusive` is NOT exposed here — the multi-op surface keeps no member whose call would orphan an in-flight stash.

### `useFeeEstimation` — thin adapter, public API BYTE-IDENTICAL, PLAIN refs

Keeps its interfaces, plain `ref()`s for `result`/`isEstimating` (writable-Ref contract preserved structurally — no computed anywhere), 800ms default, 2-arg estimator: `run: (params, token) => estimate(params, token)` (key ignored, no flowKey, no instanceId, no extra RNG). Sentinel key: a module const (`const SINGLE_SLOT = 0`). `handoff()` = `engine.handoffInclusive(SINGLE_SLOT)`. `onResult`/`onEstimating` assign the refs; a successful `undefined` result passes through unchanged (no `??` coercion anywhere). Registers `onScopeDispose(dispose)` as today.

### What disappears

Both composables' hand-rolled timer/counter/token machinery (~90 lines each) collapses into one engine. Future estimation-protocol changes touch ONE file; the composables change only when a public surface changes.

### Behavioral deltas that must be preserved exactly (checklist for the diff pass)

- D-scalar-1: `handoff()` in-flight-inclusive, incl. never-started tokens (F1). PINNED.
- D-scalar-2: 800ms default (F4); keyed 500ms never leaks.
- D-scalar-3: `onError(err)` 1-arg; only on real errors, never stale settles (cancel or dispose). PINNED both ways.
- D-scalar-4: initial `result === null`, `isEstimating === false` (plain refs — structural).
- D-scalar-5: `isEstimating` flips synchronously at `estimate()` (engine invokes `onEstimating` synchronously inside `schedule`). PINNED.
- D-scalar-6: `result`/`isEstimating` are genuinely WRITABLE plain refs; the seed-write pin now asserts the write took effect. PINNED.
- D-scalar-7: a successful `undefined` result is preserved, not coerced to null. PINNED.
- D-scalar-8: no `Math.random()`/instanceId in the scalar path (no flowKey machinery at all) — structural under C; deliberately NOT pinned (RNG call counts are not public contract; see L7).
- D-keyed-1: `handoffAll()` completed-only, return shape unchanged. PINNED (asymmetry pin).
- D-keyed-2: `rearm()`/`cancelAll()`/`instanceId`/flowKey minting keyed-only (F7); scalar API unchanged.
- D-keyed-3: keyed `estimate` keeps its 3-arg signature + real flowKey (flowKey format `op:${instanceId}:${key}` byte-identical — pinned by existing keyed test).

## Rejected outlines (full trail)

- **A (additive `handoff(key)` on `useFeeEstimationMap` + sentinel wrapper over the keyed composable)** — original primary; Fable endorsed it, codex REJECTED it: (1) `handoff(key)` on the multi-op public surface is an attractive nuisance — calling it there would disarm cleanup for a token whose id can never reach the approve payload, orphaning its stash; the member's rationale belongs entirely to the scalar adapter; (2) the wrapper's computed unwraps need a writable-computed patch for the Ref contract AND still coerce a successful `undefined` to `null` (`?? null`); (3) constructing the keyed composable mints `instanceId` (an observable extra `Math.random()`) and flowKey machinery in a path that must stay flowKey-free. C dissolves all three structurally.
- **B (engine = map minus refs, map wraps it)** — Middle Man: the map would delegate essentially every member to an engine that IS the map, and the largest diff lands in the execute-critical file. C's engine is narrower (no Vue state, no flowKey) and both composables retain real responsibilities (Vue reactivity + API adaptation).
- (An earlier draft claimed engine privacy was impossible under auto-import — wrong: the `dirs` scan is non-recursive; `internal/` escapes it. Verified in `vite.config.ts:143`.)

## Phases

1. **Pin first** (on the CURRENT implementation) — DONE, 46/46 green pre-refactor: (a) in-flight-handoff pin; (b) never-started (debounce-pending) handoff returns the token; (c) keyed ASYMMETRY PIN (`handoffAll` excludes an in-flight key; its token IS remote-cancelled on dispose); (d) supersede-after-handoff; (e) reject-after-cancel is a stale settle; (f) seed-write pin hardened (asserts the write took effect — proves the writable-Ref contract non-vacuously); (g) successful-`undefined` preservation; (h) dispose-mid-flight exactly-once remote cancel + silent late reject. (NO "completed preference" test — per key, `completed`/`inflight` never coexist; the `??` chain never arbitrates; it would pin an unreachable state.)
2. **Engine**: create `src/composables/internal/fee-estimation-engine.ts` by extracting today's keyed machinery verbatim with record writes → sink callbacks.
3. **Adapters**: rewrite both composables over the engine. All 46 scalar + 19 keyed tests must pass UNCHANGED — they are the equivalence proof for both adapters AND (transitively) the engine.
4. Gates: `bun run audit:vue`; armed smoke (`VITE_NULO_E2E_MIGRATION_FIXTURE=1 bun run build` → `NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`).
5. Final fresh-context codex pass on plan+ledger (mid tier step 5), then implement, then the single codex xhigh pass over the complete arc diff → fix → converged → PR → merge.

## Validation gates

- `bun run audit:vue` (typecheck:all → test → lint → build).
- Armed smoke (goal requires it for arc 8).
- Targeted: `bun run --cwd apps/extension test src/composables/useFeeEstimation` (both files).

## Security & Adversarial Considerations

No trust boundary moves. The handoff/handedOff mechanism is a resource-lifecycle protocol with the SW (stash eviction), not an authz surface; the risk class is *orphaned SW-side stashes* (resource leak until TTL) or *premature eviction* (a submitted tx losing its precomputed estimate → re-simulation, not fund risk). Both failure modes are exactly what the characterization pins + the two seam rules guard. No new inputs cross a trust boundary; tokens remain caller-minted UUIDs.

## Decision ledger

- L1 — **Shape C (state-sink engine) adopted over both original outlines.** The dual audit SPLIT: Fable confirmed A ("handoff(key) is a real, documentable per-key operation; B is a Middle Man"); codex REJECTED A (misuse-hazard member on the multi-op surface; writable-computed + `?? null` patches; extra RNG) and proposed C. Main-agent resolution: codex's objections to A are defects C removes STRUCTURALLY (plain refs, no coercion, no scalar RNG, keyed API untouched), while Fable's objections to B (Middle Man; peek splitting the handoff invariant) do NOT apply to C — the composables keep real responsibilities and both handoff operations are atomic engine members. C also matches verified/Q-03's own refined recommendation ("private unexported keyed engine; scalar as a thin wrapper with one fixed sentinel key") more literally than A did. **Status: adopted; cross-checked with the Fable auditor (resumed) + final fresh codex pass.**
- L2 — Sentinel is `const SINGLE_SLOT = 0` (numeric, module-const). With the engine `TKey`-generic and never stringifying keys (flowKey minting moved out), the string-vs-number choice is inert; `0` keeps the adapter one line. **Status: settled.**
- L3 — Pin-first ordering per the verified finding. **Status: executed — 8 pins across two commits, 46/46 green pre-refactor.**
- L4 — (superseded by C) Writable computeds were the A-shape patch for the writable-Ref contract; C keeps plain refs, preserving the contract structurally. The HARDENED seed-write pin (assert-write-took-effect) stays — it guards any future regression to readonly refs. **Status: superseded, pin retained.**
- L5 — No "completed preference" handoff test (Fable M2 + codex agree): per-key `completed`/`inflight` never coexist — unreachable state. **Status: adopted.**
- L6 — Engine result type is `unknown`, not a third generic: the engine never inspects results; `TResult` typing lives at the composables' unchanged public boundaries (repo policy: precise types at package boundaries, looser internals). **Status: settled.**
- L7 — No RNG-call-count pin (codex asked, Fable found no semantic effect): Math.random consumption is not public contract; pinning it would forbid unrelated future internals for no consumer-visible reason. C makes the point moot (no RNG in the scalar path). Documented here instead of pinned. **Status: settled (deviation from one codex ask, with rationale).**
- L8 — Codex's extra keyed tests for A's `handoff(key)` (key isolation, refire-after-handoff, rearm interaction) are dropped WITH A — no new keyed public member exists under C. The keyed suite stays unchanged; the supersede-after-handoff + rearm behaviors remain covered at the scalar level and by existing keyed tests. **Status: settled.**
