# Phase P0 — reproduce + pin. RESULT: the plan's diagnosis is WRONG. STOP + re-aim.

P0's whole purpose (per its own gate) is to PROVE the localized mechanism before any fix. It did —
and **disproved** it. The restore-boot hang is **not** a lock/emit deadlock.

## What was instrumented
Temporary `[[P0]]` console probes (behind the e2e console tap) at the four suspected wedge points:
`ProfileService.runExclusive` (enter/acquire/leave + tag), `getProfileSecret`, the store-key
provider (`runtime.ts`), the missing-key retry (`pxe/client.ts`), and `createChainRuntime`. Built
armed, ran the node-free smoke `backup-roundtrip.test.ts` (which reproduces the 60s hang
deterministically).

## What the timeline actually shows
1. The facade `Lock` NEVER contends. `getProfileSecret` runs `ENTER → ACQUIRED → LEAVE` in the same
   millisecond, every time. There is no queue wedge, no held-across-await lock, no re-entrancy
   stall. The fire-and-forget `EventHandler.invoke` (async listeners are not awaited) means the
   hypothesized synchronous emit-under-lock deadlock cannot occur, and empirically does not.
2. The healthy boot works: `createChainRuntime … hasKey=false` → provider `active=<id>
   present=true` → `createChainRuntime … hasKey=true` → PXE starts. Seen once (the export-side
   extension).
3. The hang: ~19 s later, `createChainRuntime … hasKey=false` for the SAME profile → provider
   `requested=addc2842 active=NONE` → **`getProfileSecret THREW "Profile locked"`** → key missing →
   `createChainRuntime` fail-closes with `PXE_STORE_KEY_MISSING` again → the client retries → same
   result, forever. The SW then idles on a 10-second heartbeat, never progressing. `completeImport`
   times out waiting for `#/popup/general` and routes to `/popup/auth`; the e2e's 60 s wait fails.

## The real mechanism
`SessionManager.getSecret(id)` throws `"Profile locked"` when `getActive()` returns no session
matching `id` (`session-manager.ts:175-181`). On the import-side extension, **the restored
profile's session is not active when its encrypted PXE store boots**, so the per-profile store key
cannot be derived. Fail-closed encryption (this arc's own new subsystem) then correctly refuses to
open the store — and there is no path that re-activates the session, so the PXE never boots.

Default `sessionTtl` is 30 min, so this is NOT ordinary TTL expiry. The leading sub-cause (to
confirm at the top of the re-aimed fix): the SW/offscreen MV3 lifecycle drops the in-memory master
secret after `finalizeRestore`, and F-11's no-persisted-bearer model means the persisted session
re-hydrates as LOCKED (no secret without the password) — so the encrypted-store key provider,
which needs the in-memory master, gets nothing. In short: **the encrypted per-profile store design
collides with the session-secret lifecycle across a restore + a worker cycle** — exactly the
subsystem this arc introduced.

## Consequence for the plan
- **P2 (emit-after-release deadlock fix) targets a bug that does not exist.** No deadlock is
  present. That phase, as written, would not fix the hang.
- **P3's #281 deletion-fence work is still valid on its own merits** (the audits found real
  resurrection/purge hazards independent of this) — but it is NOT the restore-boot fix.
- The true fix lives in the session-secret ↔ encrypted-store-key seam: either the store key must be
  recoverable for an active-but-worker-cycled profile without a re-unlock, or the restore/boot flow
  must guarantee the session's master is live when the store opens (and surface a clean re-unlock
  prompt instead of an infinite silent retry when it isn't).

## STOP
Per P0's gate ("if the localized mechanism does not reproduce → STOP, re-aim"), PR-A's P2/P3 shape
is paused pending a re-aim of the restore-boot fix around the proven mechanism. Surfaced to the
user. Instrumentation reverted (diagnostic-only). The #281 hardening and the 5.0.1 bump/redeploy/
release phases are unaffected in principle, but the restore fix — the thing that turns #282 green —
needs new design.
