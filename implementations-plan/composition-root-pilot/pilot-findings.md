# Q-04 pilot findings — what two leaf extractions prove (and don't) about the god-inits

The pilot extracted the two verifier-named lowest-risk pieces and STOPPED, per the arc charter. This write-up is the deliverable: what the pilot proved, what it deliberately cannot prove, and the recommendation shape for any continuation — which is OWNER-GATED.

## What was extracted

1. **`buildFeeStrategies`** (`execution/fee/build-fee-strategies.ts`): the fee-strategy dispatch map as a pure, explicitly-typed builder. The `FeeStrategyDeps` literal — five entries: `txBuilder` (eager `this` read), `simulateTxTask` (LAZY closure over `this.coordinator`), `fpcService` (eager), `tasks` (eager), `logger` (eager, ctor-set) — stays in `init()` at its original point, so every capture mode is unchanged; the builder returns the map and the caller owns the `this.feeStrategies` assignment.
2. **`wireTabLifecycle`** (`wallet-sdk/tab-lifecycle.ts`): the tab-close/cross-origin-navigation session-termination wiring, out of `initWalletSdkHandler`'s 375-line closure, behind a structural `TabLifecycleDeps` (the `session-established.ts` pattern). Registered at the same pre-`handler.initialize()` position.

## What the pilot PROVED

- **Leaf builders with caller-owned assignment are mechanically safe** when the piece is dependency-complete at its call site: zero behavior change, all 4377+ pre-existing tests green unmodified, and the dependency set becomes a typed parameter list — the invisible "what does this block need?" question becomes a compile-visible signature.
- **Closure-root wirings become unit-testable for the first time.** `initWalletSdkHandler` had ZERO unit tests; the extracted tab wiring now carries six pins (incl. a three-session cross-origin matrix and the malformed-URL fallback) that previously existed only as two network-e2e specs.
- **The sharpest finding was a MISSING PIN, not coupling.** Nothing in the repo pinned `feeStrategies` at all: the reuse fast paths and executor mocks bypass the dispatch, so an `init()` that never assigned the field passed every test. "Is this field ever populated?" was untestable in the god-init shape. The pilot's highest-value artifact is the new composition pins (map topology through real `init()`, the miss-path, a spied dispatch), not the extraction itself.
- **Line-number doc citations rot; symbol citations don't.** Both tab e2e specs cited line ranges three refactors stale — one pointed INTO unrelated security-critical code. Re-anchored by symbol.

## What the pilot deliberately CANNOT prove

- Nothing about the forward-referencing eager fields (`resolver`/`txBuilder`/`planner` and peers, consumed mid-`init()`): the pilot pieces were CHOSEN for having no ordering hazard, so the hard class — where an eager read hoisted above its assignment captures `undefined` — is unassessed by construction.
- Nothing about `initWalletSdkHandler`'s shared-mutable-state concerns (the decrypt monkeypatch, the `discoveryQueue` forward declaration, the cross-callback maps).
- Nothing about the remaining `= null!` asserted fields beyond `feeStrategies` (a separate verified inventory should count and classify them — unverified counts deliberately omitted here per audit correction).
- **Parameterizing a `= null!` field buys greppability, NOT type safety**: the declared type stays non-null, so an argument position type-checks just as vacuously as the field did. The type-level hole survives extraction.

## Recommendation to the owner (per the OWNER-GATED charter — nothing here is started)

**Dependency-DAG first.** Before any further decomposition: inventory every `= null!` field across the god-inits, classify each edge EAGER (value captured at init time) vs INVOCATION-TIME (lazy closure), and only then choose a representation that makes invalid states unrepresentable (e.g. a frozen post-init deps record with a single assignment site). Type improvement falls out of that design; it is not a safe prerequisite on its own (swapping `= null!` for `!:` remains an unchecked assertion). Continuation, if approved, should proceed leaf-by-leaf with caller-owned assignment and a characterization pin per piece — the two shapes this pilot validated — with "stop here" remaining a first-class option: the pilot's evidence is that the pin gap, not the structure, is where the risk lives, and pins can be backfilled without moving code.
