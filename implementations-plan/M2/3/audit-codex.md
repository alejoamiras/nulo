# M2.3 plan — codex xhigh audit

Run date: 2026-04-22. Plan file: `plan.md`. Tool: `codex exec -s read-only -c model_reasoning_effort=xhigh`. Tokens: 156,893.

## Verdict: **Not Go.** Blockers + mediums require plan rewrite before execution.

## Findings

**BLOCKER — ChainRuntime identity still loose**
Plan keeps `ChainRuntimeRegistry` as effectively `Map<chainId, ChainRuntime>`, but real PXE namespace is `pxe/{profileId}/{chainId}` (service.ts:401) and `Network` carries `profileId` (spec.ts:11). Profile switch during or just after `getOrInit()` can reinsert an old-profile runtime or let a queued read use a stale handle. Fix: **include `profileId` or a profile-generation token in runtime identity**; reject/dispose stale init results before and after awaits; generation-checked under the guard.

**MEDIUM — Teardown assumption wrong**
Plan says `dispose()` can abort in-flight PXE work via `PXE.stop()`. In this version, `pxe.stop()` only calls `jobQueue.end()` (pxe.ts:1169), and queue `end()` **drains** current work rather than canceling (serial_queue.js:45, base_memory_queue.js:79). Fix: rewrite M2.3-a so `dispose()` is **post-drain cleanup only**. If hard kill is needed, that's a separate offscreen-restart scope.

**MEDIUM — Infinite reader drain is unsafe as written**
`getContractArtifact` is a read path (service.ts:146). Its registry fallback uses raw `fetch()` with **no timeout** (service.ts:426). That can block profile-switch/delete forever. Fix: bound read-path I/O first — at minimum registry-fetch timeout/abort — and add drain-wait telemetry/watchdog.

**LOW — Plan's read/write classification wrong**
Plan says "All public methods wrap logic in `guard.read(...)`". The current service has a deliberate **read/write split** (service.ts:129 reads vs service.ts:166 writes). Fix: preserve the existing classification. Do not accidentally turn heavy write paths into reads.

**LOW — "PxeProcessSupervisor" name + super footgun**
Overstates scope. The proposed protected override is a `super.ensureTransportReady()` footgun. Fix: explicitly limit M2.3-c to transport-readiness hoisting AND use a template method + overridable hook (non-overridable request() calls base readiness + then a hook).

## Per-question answers

**Q1 — Per-chain vs per-profile isolation** [BLOCKER]: Yes, runtime identity MUST include profile id or profile generation. `ChainRuntimeRegistry.getOrInit` must reject + dispose stale init results if active profile changed mid-init.

**Q2 — Reader-drain semantics** [MEDIUM]: "Drain indefinitely" not acceptable as written. Note: `simulateTx` is a **write** today, not a read. The real stuck-reader risk is artifact/instance resolution and registry/network I/O. Bound those reads with timeouts; don't pretend runtime dispose can kill them.

**Q3 — ArtifactRegistry config-update**: No correctness issue if an in-flight resolve uses the policy snapshot taken at `resolve()` start. Key invariant: snapshot once per call, don't mix old + new policy mid-flight.

**Q4 — PxeProcessSupervisor scope** [LOW]: Scope must be explicitly limited to the move. If no new stateful health/restart component, drop "Supervisor" from the PR name.

**Q5 — ChainRuntime.dispose** [MEDIUM]: `pxe.stop()` drains; does NOT abort. You don't get a clean mid-simulateTx stop. Correctness guarantee must come from **lock ordering**, not from teardown.

**Q6 — Known-artifact list location** [LOW]: Separate `known-artifacts.ts` file imported by ArtifactRegistry. Developer workflow: "add import + add entry there", not "edit constructor wiring".

**Q7 — IndexedDB cleanup on profile delete** [LOW]: Keep at PxeService level as one profile-scoped sweep, AFTER runtime disposal. Includes shared DB state like `keyval-store` — doesn't belong in per-chain `dispose()`.

**Q8 — ReadWriteGuard test completeness** [MEDIUM]: Missing tests:
- Reader arrives after writer queued
- `enterWrite()` drain behavior
- Rejection paths decrementing counters
- Reentry semantics (if unsupported, test that it **fails fast** rather than deadlocks)
- Writer FIFO / no starvation
- Stale-profile init races

**Q9 — Transport-base override ergonomics** [LOW]: Make readiness a non-overridable template path inside `request()`, with an overridable hook AFTER base readiness. Don't require subclasses to remember `super.ensureTransportReady()`.

**Q10 — Blast radius of reader-drain bug** [MEDIUM]: If reader-drain misses a decrement, PXE can **deadlock**: pending profile-switch/delete writer waits forever, new readers then block behind it. Wallet looks frozen anywhere that touches PXE.

## Alignment with agent audit

| Finding | Agent | Codex |
|---|---|---|
| Reorder to d-first | ✓ (blocker) | not explicit — implicit in blocker priority |
| Rename M2.3-c (drop Supervisor) | ✓ | ✓ |
| ChainRuntime identity includes profileId | ✓ | ✓ (BLOCKER) |
| Read→write reentry deadlock mitigation | ✓ (AsyncLocalStorage assertion + force-release) | ✓ (fail-fast test) |
| Infinite drain bounded by I/O timeout (not reader force-release) | — | ✓ **new finding** |
| `pxe.stop()` drains not aborts | raised doubt | ✓ **confirmed** (with upstream code reference) |
| Plan's "all guard.read" claim wrong (deliberate read/write split today) | — | ✓ **new finding** |
| Template method + hook pattern (not super-footgun) | — | ✓ **new finding** |

## Must-fix before M2.3 execution

1. **ChainRuntime identity = (chainId, profileId) or profile generation** — BLOCKER.
2. **Dispose = post-drain cleanup only** — `pxe.stop()` cannot abort; document; don't rely on hard-kill.
3. **Bound registry-fetch I/O with timeout** before claiming infinite reader drain is safe.
4. **Preserve existing read/write method classification** — plan's "all guard.read" is wrong; today's code has a deliberate split at service.ts:129 vs 166.
5. **Rename M2.3-c** (drop "Supervisor") + use template-method/hook pattern.
6. **Add 6 missing rw-guard tests** (codex Q8 list).
7. **Reorder to d → a → b → c** (agent finding, also consistent with codex's priority of d).
