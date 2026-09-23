# Codex audit trail — dedup-fee-estimation

Codex-side leg of the mid-tier dual audit (xhigh, read-only). Three sessions; paths repo-relative.

## Session 1 — plan audit (dual-audit codex leg): A vs B arbitration

### Blocking

- `implementations-plan/dedup-fee-estimation/plan.md:41-48` — Outline A changes the exported keyed API despite the hard requirement that consumer-visible APIs/types remain unchanged. Worse, `handoff(key)` is unsafe for the API’s multi-operation domain: an in-flight token cannot appear in the approval payload (`apps/extension/src/popup/windows/execute/index.vue:382-400`), so calling it would disarm cleanup and orphan the eventual stash. The method’s “single-slot submit” rationale belongs to the scalar adapter, not the keyed public surface. This hazard outweighs B’s extra layer.

- `implementations-plan/dedup-fee-estimation/plan.md:29,64-65` — I1 is technically true (`node_modules/@vue/reactivity/dist/reactivity.d.ts:346-355`), but misleading: readonly `ComputedRef` is assignable to `Ref`, while runtime writes warn and do nothing. The current interface promises writable refs (`apps/extension/src/composables/useFeeEstimation.ts:33-37`). The existing write at `useFeeEstimation.test.ts:316-319` fails to pin this because it never asserts that `42` was observable before `estimate()`. This is a consumer-visible behavior change hidden by type assignability.

- `implementations-plan/dedup-fee-estimation/plan.md:64` — `?? null` also converts a successful estimator result of `undefined` into `null`. The generic permits `TResult = undefined`; the current plain ref preserves that value. D-scalar-4 only considers the absent initial key and misses this delta.

### High

- `implementations-plan/dedup-fee-estimation/plan.md:31,57-60` — The scalar callback still receives exactly two arguments, but constructing the keyed composable invokes `Math.random()` for `instanceId` (`useFeeEstimationMap.ts:66-70`) and constructs a flow key (`:120`). The extra global RNG call is observable, including at construction before any estimate. Thus I3 is not zero-behavior and flow-key machinery is no longer genuinely keyed-only.

- `implementations-plan/dedup-fee-estimation/plan.md:101-102` — Pin-first is necessary but insufficient. Add pre-refactor pins for:

  - writable/non-readonly scalar refs;
  - successful `undefined` preservation;
  - no scalar `Math.random()` call;
  - started, unhanded disposal followed by late resolve and late reject—exactly-once remote cancellation, no mutation, and no `onError`.

  The new in-flight, never-started, and keyed asymmetry pins are otherwise valuable.

- If A were retained, the proposed keyed tests omit key isolation, never-started-then-completed ownership, refire-after-handoff, and `rearm()` interaction. “Completed preference” is not publicly constructible because completed and in-flight states are mutually exclusive for one key.

### Medium

- `implementations-plan/dedup-fee-estimation/plan.md:97` overstates the auto-import objection. `vite.config.ts:143` does not scan `src/core/`. The best shape is a B-like package-internal engine there, with explicit inclusive/completed handoff operations—not a bare `peek`—while both composables retain their exact APIs and scalar plain refs. The engine should not create flow keys; the keyed adapter should.

- Fixed-key counters, `disposed` guards, one scope-disposal registration, and the one-argument `onError` adapter are equivalent as proposed.

- Test accounting needs reconciliation: base has 39 tests, current phase-one HEAD has 42, while the stated target is 45.

reject (blocking findings)
---

## Session 2 — final fresh-context pass (mid step 5, on consolidated Shape C)

- **High — missing ownership pin:** [plan.md:133](implementations-plan/dedup-fee-estimation/plan.md:133) incorrectly says keyed `rearm()` is covered. No keyed test calls it, although the failure path depends on it at [execute/index.vue:406](apps/extension/src/popup/windows/execute/index.vue:406). Add: complete → `handoffAll()` → `rearm()` → dispose must remote-cancel the token.

- **Medium — Array→Record changes failure/reentrancy semantics:** [fee-estimation-engine.ts:160](apps/extension/src/composables/internal/fee-estimation-engine.ts:160) marks every completed token before [useFeeEstimationMap.ts:83](apps/extension/src/composables/useFeeEstimationMap.ts:83) materializes the record. Previously each token was marked immediately before its property assignment. If assignment throws or an inherited setter re-enters, later tokens are now handed off without being returned, risking orphaned stashes. Preserve per-entry mark→assignment ordering, e.g. with an engine-owned collector callback.

- **Medium — D-order remains under-specified and unproved:** [plan.md:97](implementations-plan/dedup-fee-estimation/plan.md:97) covers sink-to-sink order but omits sinks relative to counter/token mutations, completed/inflight updates, and `cancelRemote`. These are observable through synchronous watchers and callback re-entry. Add pins for `onError` observing estimating=true and keyed result watchers observing `handoffAll()` before completion registration. Also document that post-dispose scheduling remains allowed to mutate synchronously/run the estimator while its settle is ignored; adding an entry guard would be a delta. Omitting scalar’s dispose-time `counter++` is otherwise safe because `disposed` permanently dominates every settle guard.

- **Medium — L7 is wrongly dismissed:** [plan.md:93](implementations-plan/dedup-fee-estimation/plan.md:93) makes “no scalar RNG” a requirement, while [plan.md:132](implementations-plan/dedup-fee-estimation/plan.md:132) calls RNG consumption unobservable. It is globally observable and can advance seeded/mocked sequences. Add the scalar no-`Math.random` pin plus a two-instance keyed test proving distinct flow-key namespaces and independent lifecycle state.

Shape C remains superior; A/B should not return. L2 and L6 are sound. No existing pin would wrongly fail a faithful C implementation; the keyed dispose pin is incomplete, not incorrect.

conditional approve (conditions: resolve all four findings before accepting the refactor)
### Resume 1 — conditions resolved + complete-arc-diff pass

Minor — [plan.md:62](implementations-plan/dedup-fee-estimation/plan.md:62) still documents the rejected Array-returning `handoffCompleted()` API, while lines 9 and 112 still claim 46 tests instead of 51. Update the current architecture/signature and success totals; historical ledger counts may remain.

No code-level or behavioral findings.

Verdict: conditional approve pending documentation correction.
### Resume 2 — doc-sync check (caught a silently-missed edit)

Finding: `plan.md:62` still shows `handoffCompleted(): Array<[TKey, string]>`; the claimed collector signature correction is absent at HEAD.

Verdict: conditional approve pending that correction.
### Resume 3 — convergence

No remaining findings. Complete arc diff is consistent and equivalence-backed.

converged