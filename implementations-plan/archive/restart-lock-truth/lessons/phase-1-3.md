# Phases 1–3 — implementation notes (2026-09-06)

## Phase 1 — an explicit lock always emits

`SessionManager.close()` now returns whether its in-memory branch emitted; nothing else inside it
changed. `lockActiveProfile()` emits `onActiveProfileChanged(undefined)` after the persistence
read-back when `close()` reported `false`. Three integration cases pin exactly one emit: over an
in-memory session, over a passkey record that survived a restart (`makeServiceFromExistingApi`
after `createPasskeyProfile`), and over nothing at all (strict password profile whose bearerless
record `restore()` dropped). Profile service dir: 237/237.

The plan's first shape (a presence read inside the artifact lock) was dropped at the audit: it
could not cover the "already dropped" case, and the read-back that `lockActiveProfile` already does
is the presence check the emit needs.

## Phase 2 — the popup locks itself on a locked reconnect boot

- `popup/lock-landing.ts`: `decideLockLanding` → `passkey-hold | select-and-auth | lock | settle`,
  keyed on `hasProfile` and `onAuthRequiredRoute`, never on `isLogined` (the header flips that
  before the worker answers). The passkey exemption is exactly today's `isPasskeyRoute && !hasProfile`
  and, as before, sets nothing (not even `isSessionChecked`).
- `popup/reconcile-locked-boot.ts`: captures `profileEventSeq` before the lookup; after it,
  requires its own run to be current, reads the decision at action time, and for `lock` requires the
  event sequence unchanged. It never bumps the sequence. Eight deferred-promise tests cover the
  interleavings the audit named: event lands during the lookup; event lands after the lookup resolved
  but before the continuation; an event counted before the run; a superseding run; the decision read
  at action time; the unfenced actions; pass-through.
- `app.vue`: `enterLockedState(profiles)` extracted from the event handler's lock branch and called
  from both paths; `landOnLockScreen` replaced by the decision + three actions; `loadProfile` wraps
  `resolveBootSession` in the seam.

## Phase 3 — the harness

- `readLivenessBaseline(page)` throws unless finite and positive; `waitForWorkerLiveness(page,
  afterTs, { timeoutMs })` is the strictly-newer wait. Seven callers migrated to a post-stop
  baseline; the smoke callers close their page before the kill, so their baseline comes from the
  reopened popup and may already be the replacement's first write (one extra tick, inside the 30s
  budget). Exempt, with a comment naming why: `sw-resilience`'s first-heartbeat timing test and
  `cold-wake-discovery` (no extension page between kill and click).
- The passkey canary's stage 4 no longer clicks Lock: it waits for the anchor popup to land on
  `#/popup/auth` by itself (60s, the budget the record poll had), then unlocks in the same
  FrameTreeNode.
- New smoke pin in `sw-resilience.test.ts`: the original popup stays open across the kill, lands
  on auth on its own, the record is gone, and the wallet unlocks again.

Cosmetic: the phase-3 migration script's first pass matched only two of the local helpers' doc
comments; a broadened pattern finished the other five. `grep` for `waitForLiveness(` /
`readLiveness(` over `tests/e2e` is the completeness check (only `ensureUnlocked`'s diagnostic
closure remains, which is not a gate).

## The finding the open-popup pin produced first (2026-09-06)

First battery: the new open-popup test timed out waiting for `#/popup/auth` (and the strict-mode
test behind it failed as a cascade, inheriting a locked wallet). The popup never re-ran its boot
on reconnect: `background/client.ts`'s `onDisconnect` calls `disconnect()` then `connect()`, and
`chrome.runtime.connect` returns at once (it wakes a dead worker asynchronously), so
`isBackgroundConnected` goes false → true inside ONE synchronous callback. `app.vue`'s watcher on
that flag was batched (default flush), saw no net change, and never called `loadProfile()`. The
2026-09-02 comment "mount and each background reconnect start a run" was true only for reconnects
that straddled a tick. Fix: `{ flush: "sync" }` on that watcher, so the false and the true both
fire and the true starts the run. With it, the open popup locks itself in ~5s under two cores;
`sw-resilience` 4/4 at `--retry=0`. `EventHandler.add` dedupes, so the run's repeated
`onActiveProfileChanged.add` stacks nothing.

## Validation (second battery, after the watcher fix)

| Leg | Result |
|---|---|
| unit (extension) | green |
| smoke trio (`sw-resilience` incl. the new open-popup pin, `sw-restart-network`, `imported-account-lifecycle`), two cores, `--retry=0` × 3 | 3/3 |
| full smoke | 31/31 |
| `connect-locked-queue-sw-restart` + `cold-wake-discovery`, proverless, two cores, retry 0 × 2 | 2/2 |
| `passkey-execution-canary`, prover-ON, two cores, retry 0 × 2 — the anchor popup locks itself, ceremony re-unlock, post-restart tx mined | 2/2 |
| `frozen-account-canary`, prover-ON | green |
