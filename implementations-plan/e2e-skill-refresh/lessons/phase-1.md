# Phase 1 — consolidate the kill (2026-09-06)

## The consolidation

Six call sites → `stopServiceWorker` from `fixtures/helpers.ts`; `findServiceWorkerTarget` exported
for the two canaries' absence path (`restartServiceWorker`). `Runtime.terminateExecution` and
`worker.close()` no longer appear in any test.

## Validation (quiet host)

| Leg | Result |
|---|---|
| smoke trio (`imported-account-lifecycle`, `sw-resilience`, `sw-restart-network`), `taskset -c 0,1`, `--retry=0` × 3 | 3/3 rounds green |
| full smoke, `NULO_E2E_MIGRATION_FIXTURE=1` | 31/31 (1 env-gated skip) |
| `connect-locked-queue-sw-restart` + `backup-restore-sw-restart` + `cold-wake-discovery`, proverless, two cores, retry 0 × 2 | 2/2 rounds green |
| `frozen-account-canary`, prover-ON, two cores, retry 0 × 2 | 2/2 green; the absence path never fired (every restart was a real stop) |
| `passkey-execution-canary`, prover-ON, retry 0 | **red** on the first run — see below; green after the harness fix |

Codex's smoke correction mattered: `NULO_E2E_RETRY=0` is ignored by the smoke config (`retry: 2`
hardcoded), so every earlier "retry 0" smoke claim in this repo's lessons that used the env var was
really retry 2. The CLI flag `--retry=0` is the override. (`e2e-flake-fixes`'s own evidence for the
SW-stop fix rested on the probe's per-stop counts, not on suite pass/fail, so it stands.)

## The passkey canary red — what the fake kill was hiding

Fingerprint: `TimeoutError: Waiting failed: 15000ms exceeded` at
`waitForHash(anchorPopup, "#/popup/auth", 15_000)` right after `clickByTestId(anchorPopup,
"header-lock")`, on the first REAL restart the stage ever saw. Deterministic (2/2).

Two instrumented runs (hash trajectory, `$router.beforeEach/afterEach` hooks, store snapshot,
session record, DOM) showed, both times:

- before the click: hash `#/popup/settings/accounts`, `header-lock` present, session record
  present (`{profile, since, lockedAt}`), liveness already strictly newer;
- after the click: hash unchanged, ZERO router navigations attempted, `header-lock` gone,
  `auth-submit` absent, session record `{}`.

So the lock reached the replacement worker (record cleared) and the header's handler flipped
`isLogined` locally (header unmounted), but nothing navigated. Reading the product:

- `Header.vue` `handleLockWallet`: `appStore.isLogined = false; managers.profile.lockActiveProfile()`.
- The redirect to `/popup/auth` on lock is event-driven: `app.vue` `onActiveProfileChanged(undefined)
  → getProfiles() → router.push("/popup/auth")`.
- `SessionManager.close()` emits `onChange(undefined)` ONLY `if (this.activeSession)` — an in-memory
  session. After a real restart under strict security the replacement worker has no in-memory
  session (never silently restored) while the PERSISTED record still exists, so `lockActiveProfile`
  deletes the record and emits nothing.
- On reconnect the popup's `loadProfile` → `resolveBootSession` → `locked` → `landOnLockScreen`,
  which only pushes `/popup/auth` when `appStore.profile` is unset; a popup that was logged in keeps
  its profile, so it stays put with `isLogined` still true.

With the old `Runtime.terminateExecution` "kill" the worker and its in-memory session survived, the
lock emitted, the redirect fired, and the stage passed — proving nothing about a restart.

**Harness fix (this PR).** The canary waits for the authoritative lock (record gone from
`chrome.storage.session`) and then `navigateByHash("#/popup/auth")` itself — the header click
already flipped the store, so the guard admits the route; the anchor popup stays open (same
FrameTreeNode, same virtual authenticator). Green on the first run after the change.

**Product finding (reported to the owner, NOT changed here — out of scope).** An open popup that
survives a worker restart keeps a logged-in shell over a worker with no session; the next Lock click
strips the header without navigating. Reachable whenever the worker dies under an open popup: an
open port by itself does not extend the MV3 idle timer (traffic on it does — the wallet's 10s
heartbeat and the popup's RPCs are what keep the worker up), plus crashes and updates. Two
candidate shapes, owner's call: (a) `SessionManager.close()` emits when it deletes a persisted
record even without an in-memory session; (b) `landOnLockScreen` treats a `locked` result over a
popup whose store says logged-in as a lock (flip `isLogined`, push auth). Fresh popups are
unaffected (they boot from storage and land on auth), which is why `frozen-account-canary`, which
opens a new recovery popup, was green.

## Follow-up surfaced by the codex loop (not changed here)

Every post-restart liveness gate in the suite snapshots the heartbeat BEFORE the kill and waits for
strictly newer. The heartbeat ticks every 10s (`runtime.ts` `HEARTBEAT_INTERVAL_MS`), so the old
worker's final tick can land between the snapshot and the kill and satisfy the gate before any
replacement boots; the later UI waits absorb it today. The honest threshold is a read taken AFTER
`stopServiceWorker` returns (the old instance is gone, so that value is final). Eight callers; a
separate mechanical PR, recorded in the skill's product-couplings section so nobody copies the
pattern meanwhile.
