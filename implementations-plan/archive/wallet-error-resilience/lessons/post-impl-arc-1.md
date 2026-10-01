# Post-implementation — arc 1 codex loop

Codex (GPT-6 Astra, `high`, read-only) over `git diff e01e416e...HEAD`, the plan, its decision log and
the four phase lessons, with the arc map, the adversarial ask and the two standing rules verbatim.

## Round 1 — session `01a0a7c3-4621-7662-ae79-12cb68d3d0d0`
**Verdict:** "Arc 1's production changes look sound; two material test issues remain." Two material,
two nits, nothing blocking.

| # | Finding | Verified? | Call |
|---|---|---|---|
| 1 | material — `stale-anchor.real.test.ts` arms on `ANVIL_URL` + `AZTEC_NODE_URL` alone, so any shell with the agent's URLs runs `anvil_reorg` against that sandbox | yes — Phase 4 had just shown what the prune does to a shared sandbox | **adopted**: `NULO_E2E_REORG=1` required, header says why |
| 2 | material — the canary's burst can complete before the node processes the reorg; `waitForPrune` then passes and the hard assertion never saw a post-prune request | yes — nothing in the spec ordered a view after the prune | **adopted**: one view issued and asserted after `waitForPrune`; "nearly always" and the skip's "never landed" claims cut to what is observed |
| 3 | nit — the "stale transient completion" case bumps the generation without `reset()`, so it never exercises the case the plan named (`reset()` during an in-flight projection); the task fake's `failTask` accepts a second finish, unlike `TaskService` | yes — the plan's Tests paragraph asks for exactly that case; `TaskService.failTask` throws on a finished task | **adopted**: case replaced (deferred projector, generation bump + `reset()` mid-flight, successor enqueued, stale result released; asserts the successor's task completes and no retry is parked); the fake now throws on every second finish |
| 4a | nit — helper doc does not state what a stale-shaped `sync()` failure becomes | yes | **adopted** (one clause) |
| 4b | nit — `ContractNotRegisteredError` doc says "downstream matchers key on" the throw-site message; the dApp receives the envelope's constant | yes — `error-envelope.ts` substitutes a constant for that class | **adopted** (doc corrected) |
| 4c | nit — replace the service's retry note with "PXE aborts staged writes before rejection reaches this wrapper; broadcasting occurs separately" | not verified — I did not trace the PXE's staging/abort path and will not assert an invariant I have not read | **rejected**; the existing note states only what is established (the retry re-runs the op, never a broadcast) |

Codex's own "checked and fine" list covered the node diagnostics against the installed 5.2.0
sources, replay safety under `withPxeWrite`, retry amplification bounds, the queue's fences, both
envelope boundaries, the noise predicates and layering. It did not verify the reported gates or the
live recovery (it ran nothing), which is the right division: those are in `lessons/phase-4.md`.

One observation while verifying #3, pre-existing and left alone: a stale completion (profile switched
mid-flight) calls `failTask` on a record `reset()` already cancelled; `TaskService` throws, the batch
catch absorbs it and the remaining stale results of that batch are skipped — which is the outcome the
fences want anyway. The new test pins that the successor's work is untouched by it.

Gate after the fixes: `balance-job-queue.test.ts` 32/32, aztec-runtime 237 passed / 2 skipped,
extension-messaging 219/219, Biome clean on the touched files.

## Round 2 — resumed session, over `git diff cc11c56f...HEAD` (commit `4068d2fc`)
**Verdict, quoted:** "no new material findings. Confidence: high for the reviewed changes." Both
material findings closed; the queue case "exercises an actual mid-flight reset, cancellation,
successor task ownership, successful persistence and absence of a delayed stale retry"; no nit
warrants another round. **Loop converged.**

On the rejected #4c codex came back with the concrete evidence: all four ops enter the PXE's job
queue (`pxe.js:606/753/865/671`), the shared catch awaits `abortJob(jobId)` before rethrowing
(`pxe.js:217`), and `abortJob` awaits every store's `discardStaged(jobId)`
(`job_coordinator.js:77`) — "PXE awaits staged-write abort before rethrowing the operation error",
ordering, not guaranteed cleanup under a storage failure. Verified against the installed 5.2.0
files; the service's retry note now carries that one sentence, since it is the fact that makes a
replay of a stateful op safe and nothing else in the file says it.
