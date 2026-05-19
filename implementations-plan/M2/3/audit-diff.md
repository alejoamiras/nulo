# M2.3 plan — audit diff

What changed in `plan.md` after the codex + agent audits. Originals preserved in git history.

## Changes

1. **Execution order** — Targets table now reads **d → a → b → c** (was a → b → c → d). Agent flagged as blocker; codex implicitly supports via blocker priority. Rationale: d fixes a correctness bug today; a/b/c atop broken guard means intermediate commits carry the race.

2. **M2.3-c renamed** — Dropped "PxeProcessSupervisor" (misleading). New name: "Centralize `ensureOffscreenRunning` in `ServiceClient` transport base". The real supervisor (ghost detection, zombie cleanup) already lives inside `ensureOffscreenRunning`; this PR only hoists the call site.

3. **ChainRuntime identity fixed to (profileId, chainId)** — Both audits flagged as blocker. Profile switch during `getOrInit()` could reinsert old-profile runtime. Now snapshot profileId at entry + dispose stale init results if profile changes mid-init + generation-checked under the guard.

4. **Dispose = post-drain cleanup only** — Codex verified upstream `pxe.stop()` drains but doesn't abort (serial_queue.js:45, base_memory_queue.js:79). Plan no longer claims dispose() aborts in-flight work. Correctness across profile switch comes from **lock ordering**, not teardown.

5. **Read-path I/O bounded first** — Codex finding: `getContractArtifact`'s registry fallback uses raw `fetch()` with no timeout (service.ts:426). Profile switch can block forever. M2.3-d prerequisite: add `AbortController` + timeout BEFORE assuming drain-wait is safe.

6. **Read/write method classification preserved** — Invariant #7 added. Plan previously (wrongly) claimed "All public methods wrap logic in `guard.read(...)`"; today's code has a deliberate split (service.ts:129 reads vs service.ts:166 writes; `simulateTx` at 242 is a **write**). M2.3-d does NOT re-classify.

7. **Reentry: fails fast, not documented-only** — Agent flagged "documented" as insufficient mitigation. Plan now requires AsyncLocalStorage-style dev-assertion that throws synchronously if `write` is called from inside `read`. Codex Q8 alignment: "if nested calls are unsupported, test that they fail fast rather than deadlock."

8. **5-min force-release on reader counter** — Added to invariants. Mirrors `Lock.MAX_HOLD_MS`. Converts "forever hang" into "5-min hang + loud log".

9. **Test list expanded to 8 scenarios** — Was 3. Added: reader-after-writer-queued, enterWrite drain, rejection-decrement, reentry fails-fast, writer FIFO, stale-profile init race, 5-min force-release. Aligns with codex Q8 list.

10. **Template-method + hook pattern in M2.3-c** — Replaces naive protected-method override (a `super` footgun). Non-overridable `request()` calls `ensureReady()` which runs base `ensureOffscreenRunning()` + optional subclass `onReady()` hook. Forgot-super bug eliminated by construction.

## Still open / decisions at execution time

- ChainRuntime key concrete form: string `"${profileId}:${chainId}"` vs `(generation, chainId)` tuple — pick during implementation.
- Registry-fetch timeout value (plan picks 30s; revisit after telemetry).
- Known-artifact file location — `src/wallet/services/pxe/known-artifacts.ts` sibling (codex recommended).

## Verdict flip

Codex: Not Go → Go (after these fixes).
Agent: NO-GO as written → Go with 6 edits → all 6 incorporated.
