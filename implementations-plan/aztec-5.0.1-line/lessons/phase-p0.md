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

## Root cause — DEFINITIVE (second instrumented pass)
Probed `SessionManager` construction + `open()` + `getActive()`. The exact timeline (import-side
extension, profile `fed2f974`):
1. `open SET activeSession … strict=true persistBearer=false ttl=1800000` → `open DONE
   activeStill=fed2f974` → store-key provider `present=true` → **PXE boots normally**.
2. ~18 s later: **`SessionManager CONSTRUCTED` fires AGAIN — the MV3 service worker RESTARTED.**
   The new instance's in-memory `activeSession` is empty.
3. `getActive()` returns undefined (it checks ONLY the in-memory `activeSession`; it does NOT
   re-hydrate from disk on demand). Because the profile is **strict mode with `persistBearer=false`**
   (F-11: strict persists no silent-restore bearer), there is no way to recover the master secret
   without the password. → `getProfileSecret` throws `"Profile locked"` → store key unavailable →
   `createChainRuntime` fail-closes with `PXE_STORE_KEY_MISSING` → the client's one retry also
   fails → the PXE never re-opens its encrypted store → the import bootstrap never completes.

**The bug (one sentence):** the encrypted per-profile PXE store — this arc's own new subsystem —
derives its key from the IN-MEMORY master secret, but a routine MV3 worker restart drops that
secret, and in strict mode (no bearer) it is unrecoverable without a re-unlock, so the PXE is
permanently locked out with no recovery path and the boot silently retries forever. NO lock
contention, NO emit ordering, NO deletion race is involved.

Why restore triggers it (and normal flows don't): the restore path is unusually heavy (migration +
multi-slice restore + big storage writes + offscreen boot), which reliably provokes an SW restart
mid-flow; a fresh install lands in strict mode; and the restored profile is a password profile
whose master lives only in memory post-`finalizeRestore`.

## The fix direction (SINGLE — no fork)
The encrypted-store boot must treat "profile locked" as a **recoverable, expected** state, not an
infinite silent retry:
1. The store-key provider / `createChainRuntime` retry must STOP after the profile is observed
   locked and surface a "locked — unlock to continue" signal, instead of looping `PXE_STORE_KEY_
   MISSING` forever.
2. The re-unlock (password) path must **re-provision the store key and (re)boot the chain runtime**
   — i.e. unlock becomes the recovery trigger for the encrypted store, symmetric to how it already
   provisions on first unlock.
3. The import flow (`completeImport` / `waitForProfileActive`) must recognize a locked profile and
   route to `/popup/auth` promptly rather than waiting out the 30 s bootstrap timeout — and the
   post-unlock continuation must land the user on `/popup/general` with a live PXE.
This is a **session-secret ↔ encrypted-store-key lifecycle** fix. It replaces the plan's dead P2
(emit-after-release). P3's #281 hardening (audit-real resurrection/purge hazards) survives on its
own merits, unchanged. P1 (5.0.1 bump) and P4–R are unaffected.

## Severity reframe (strict is the DEFAULT — but recovery likely already exists)
`strictSecurityMode` defaults to **true** in production (`config/config.ts:26`
`z.boolean().default(true)`). So every fresh install is strict: after ANY MV3 worker restart the
in-memory master is gone and the profile is locked until re-unlock. That sounds catastrophic, but
the normal recovery path almost certainly already works and this is NOT an all-users PXE break:

- The `PXE_STORE_KEY_MISSING` retry (`pxe/client.ts:88-108`) calls the store-key provider on demand;
  once the user re-unlocks (session active again), `getProfileSecret` returns the master → the key
  re-derives → the PXE boots. So in ordinary use a worker restart shows the unlock screen, the user
  enters their password, and the wallet (incl. its encrypted PXE) comes back — exactly strict mode's
  promise. Normal e2e (onboarding/token) pass because they either don't cycle the SW mid-boot or
  they re-unlock.
- The RESTORE case is special ONLY because the import flow is programmatically MID-bootstrap when the
  SW restarts (`completeImport` → `waitForProfileActive(30s)`), with no human re-unlock in that
  window. It waits out the 30 s, routes to `/popup/auth` (correct!), and the `backup-roundtrip` e2e
  — which asserts a straight path to `/popup/general` with NO re-unlock — times out.

**So the likely truth: this is substantially an E2E-EXPECTATION mismatch + a UX-latency issue (a 30 s
silent wait before the unlock screen), not a catastrophic product break.** A restored user re-enters
their password once and recovers. **UNVERIFIED (the one open test):** does a re-unlock AFTER the
restore-time SW restart actually re-provision the key and boot the PXE end-to-end? Strongly implied
by the retry code, but not yet driven in the harness.

## Re-aim options for the user (sharpened)
1. **Minimal (if the unlock-recovery holds):** make `completeImport` detect the locked state and
   route to `/popup/auth` promptly (drop the 30 s dead wait), and fix the `backup-roundtrip` e2e to
   drive the re-unlock then assert `/popup/general`. Small, targeted; no lifecycle redesign.
2. **UX-hardening (worthwhile regardless):** persist a short-lived, strict-compatible recovery bearer
   so a routine worker restart does NOT force a re-unlock within the session TTL — closes the "strict
   users get logged out constantly" UX papercut and makes restore seamless. Bigger; touches the F-11
   bearer policy (security-sensitive — needs its own audit).
3. **Reconsider the strict default** (separate question): whether fresh installs should default to
   strict at all, given it makes every worker restart a re-unlock.

## STOP
Per P0's gate, PR-A's restore fix is paused for a re-aim. The next concrete step (pure diagnosis, no
scope commitment) is to VERIFY option-1's premise by driving a re-unlock in the harness. Awaiting the
user's steer on which option to build. Everything else in the plan (P1 bump, P3 #281, P4–R) stands.
Instrumentation reverted; tree clean.
