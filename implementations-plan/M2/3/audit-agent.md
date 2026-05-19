# M2.3 plan — general-purpose agent audit

Run date: 2026-04-22. Plan file: `plan.md`. Reviewer: general-purpose agent (parallel to codex xhigh).

## Verdict: **NO-GO as written. GO with 6 edits.**

## Must-fix before M2.3 execution

1. **Reorder to d → a → b → c.** d fixes a real correctness bug (profile-switch race). Shipping a/b/c atop the broken guard means every intermediate commit carries the race. Update both the plan and the arc README.

2. **Rename M2.3-c.** Drop "PxeProcessSupervisor" — misleading (the real supervisor, ghost detection + zombie cleanup, already lives inside `ensureOffscreenRunning`). New name: **"Centralize `ensureOffscreenRunning` in `ServiceClient` base"** or similar. This PR moves one function call, not a supervisor class.

3. **Read→write reentry deadlock mitigation (M2.3-d).** `guard.read(() => ...svc.doThing()...)` where the inner call internally hits `guard.write(...)` → both hang. "Documented" is not sufficient enforcement. Add:
   - **(b)** `AsyncLocalStorage`-style "am I inside a read" check; `write` from inside a read throws synchronously with a clear error (dev-only assertion).
   - **(c)** 5-min force-release on the reader counter, mirroring `Lock.MAX_HOLD_MS`.
   (b) is the fix, (c) is the safety net.

4. **Key `ChainRuntimeRegistry` by `(chainId, profileId)`**, not chainId alone. Same RPC under two profile slots already works today (`hasChain` compares rpcUrl) — M2.3-a must preserve that dimension or have `getOrInit` snapshot profileId at entry and discard if diverged.

5. **Verify `pxe.stop()` exists** before committing to it as the dispose API in M2.3-a. If not, bare-minimum safe path is `.clear()` the maps + GC; add teardown as follow-up.

6. **Add 4 missing rw-guard tests**:
   - Reader-in-write reentry (document expected throw with b above).
   - `enterWrite()` called while readers active.
   - Writer abandonment / throw before `leaveWrite`.
   - Concurrent `write()` + `enterWrite()` interleaving.

## Per-question findings (plan's Q1-Q10)

| Q | Status | Notes |
|---|---|---|
| Q1 | **Concern** | See must-fix #4. Make chainId+profileId keying explicit. |
| Q2 | **Concern** | "Drain indefinitely" acceptable only with 5-min force-release mirror of Lock.MAX_HOLD_MS. Required, not optional. |
| Q3 | OK | Risk #4 mitigates. In-flight resolve using old policy = correct (consistency > recency). |
| Q4 | **Blocker on naming** | Scope is right, name is misleading. See must-fix #2. |
| Q5 | **Concern** | Plan asserts `pxe.stop()` exists — not verified. Today's service just drops handles. See must-fix #5. |
| Q6 | OK | Sibling `known-artifacts.ts` exporting the array — one diff not a ctor edit. |
| Q7 | OK | PxeService-level IDB sweep is profile-wide, shouldn't split per chain. |
| Q8 | **Concern** | Tests missing (see must-fix #6). |
| Q9 | OK | Template-method pattern with non-overridable `request()` + overridable `ensureTransportReady()` — forgotten-super bug eliminated by construction. |
| Q10 | **Concern** | Without 5-min force-release (must-fix #3), wallet deadlocks forever instead of 5-min hang. Still bad UX, but bounded. |

## Extra audit checks (reviewer-added)

**Sub-PR ordering** [Blocker] — see must-fix #1.

**ChainRuntime identity** [Concern] — see must-fix #4.

**ArtifactRegistry pin ↔ known conflict** [Concern]: if `byClassId[X] = "known"` but X not in knownArtifacts, resolve returns undefined (deliberate — document). Pin "registry" with `allowRegistry: false` → undefined + log so operators can diagnose.

**Read→write reentry deadlock** [Blocker] — see must-fix #3.

**PxeProcessSupervisor name** [Concern] — see must-fix #2.

## Top-3 risks

1. **Read→write reentry deadlock** after M2.3-d if two services share the guard or a callback nests. 5-min force-release turns forever hang into 5-min hang, still bad UX.

2. **ChainRuntime teardown** leaks mid-flight PXE work or crashes if `pxe.stop()` absent or misbehaves. Validate upstream API first.

3. **Landing order risk** — shipping a/b/c atop broken guard means any QA regression in the interim window is ambiguously "race or refactor". Land d first to isolate.
