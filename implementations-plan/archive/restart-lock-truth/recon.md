# Recon — restart-lock-truth (2026-09-06)

One read-only sweep at `dev@e7e94005`. Conclusions; the code is the evidence.

## The mechanism, confirmed on the tree

- `SessionManager.close()` emits `onChange(undefined)` only inside `if (this.activeSession)`
  (`session-manager.ts:366-370`); the artifact section then deletes the persisted record
  unconditionally, without reading it (`:378-391`). `ValueStorage.delete()` returns nothing, so
  `close()` cannot tell "deleted a record" from "nothing to delete" without a presence read.
- `lockActiveProfile()` (`service.ts:853-866`) is the ONLY caller that closes unconditionally;
  every other `sessionManager.close(` site is gated on `isActive()` or a truthy `getActive()`, so
  an in-memory session always exists there and the current emit already fires. Adding an emit on
  persisted-only deletion changes behaviour for exactly one path: the Header's Lock click over a
  worker that restarted with a persisted record. `open()` never routes through `close()`.
- A passkey profile's record survives a restart unconditionally (`restore()` skips passkey
  re-hydration, `:533-538`); a password profile's bearerless record is dropped by `silentClose()`
  at boot (`:545-549`), so the no-emit window is guaranteed for passkeys and bearer-dependent for
  passwords.
- Popup side: on reconnect `loadProfile` → `resolveBootSession` → `locked` →
  `landOnLockScreen(candidate)` (`app.vue:214-223`), which routes to auth ONLY when
  `!appStore.profile`. A popup that was logged in keeps its Pinia `profile`, so it falls through
  to `isSessionChecked = true` and stays rendered as logged in. Both `route-guard.ts:42` and
  `auth-guard.ts:30` short-circuit on `isLogined === true` and are test-pinned for a different,
  legitimate race — the fix must make `isLogined` true at its source, not weaken either gate.
- `Header.vue:24-28` flips `isLogined` locally then fires `lockActiveProfile()`; nothing
  re-navigates off the flag, so the route change depends entirely on the event.
- Fences: `loadProfileSeq` guards `loadProfile`; `profileEventSeq` guards
  `onActiveProfileChanged`. They do not cross-reference. A `landOnLockScreen` that starts
  mutating `isLogined`/route becomes a third writer of the same state and must not undo a real
  unlock landing concurrently via the event path.

## Unit-test coverage today

- `session-manager.test.ts`: `close` is covered with an in-memory session (`:281-292`) and with
  nothing at all (`:294-298`). No case calls `close()` on a fresh manager holding only a persisted
  record — the helpers for it exist (`seedSession` `:132`, `setupFromExistingApi` `:156`) but are
  paired only with `restore()`.
- `session-manager.fence.test.ts`: generation/artifact-lock ordering; a presence read inside the
  artifact section must keep these green.
- `boot-session.test.ts`: the `locked` shape, no store. `auth-guard.test.ts:90-98,104-108` and
  `route-guard.test.ts:41-50` pin the short-circuits. `app.vue` has no tests; `landOnLockScreen`
  is not extracted.

## The liveness gates (harness follow-up)

Runtime: `HEARTBEAT_INTERVAL_MS = 10_000` (`runtime.ts:112`); `writeInitialLiveness` right
after `initWalletSdkHandler` (`:249-251`), then the interval (`:254-258`).

| File | Baseline | Downstream wait | Change? |
|---|---|---|---|
| `sw-resilience.test.ts` tests 1, 2 | pre-kill `readLiveness` | `waitForLiveness(page2, base)` | yes |
| `sw-resilience.test.ts` test 3 (first heartbeat within `HEARTBEAT_INTERVAL_MS`) | pre-kill by design | asserts `elapsed < 10s` | **no** — a post-stop baseline adds a tick and breaks the bound |
| `sw-restart-network.test.ts` | pre-kill | `waitForLiveness` | yes |
| `network/connect-locked-queue-sw-restart.test.ts` | pre-kill | `waitForLiveness` then badge reconciliation | yes |
| `network/cold-wake-discovery.test.ts` | pre-kill, popup closed before the kill | `waitForLivenessOn(probe, base)` after the click | **no** — no extension page may be touched between kill and click; the baseline cannot be read after the stop |
| `network/frozen-account-canary.test.ts` | pre-kill, dedicated snapshot popup | inline strictly-newer poll | yes |
| `network/passkey-execution-canary.test.ts` | pre-kill, anchor popup | inline strictly-newer poll | yes |

Six callers change; two keep their pre-kill baseline with a comment saying why. Existence-only
reads (`launchExtension`, `openPopup`, `ensureUnlocked`'s diagnostic) are not gates.

The helper: `stopServiceWorker` (`fixtures/helpers.ts:1748-1802`) guarantees the ORIGINAL
instance is gone when it resolves. Nothing waits for a replacement's heartbeat; each caller
re-implements the strictly-newer poll (five near-identical copies).

## The passkey canary workaround to revert

`passkey-execution-canary.test.ts:199-204`: click `header-lock`, poll for the session record to
vanish, `navigateByHash("#/popup/auth")`. Natural flow once the product emits: click, then
`waitForHash(anchorPopup, "#/popup/auth", 15_000)` (the `sw-resilience` pattern).

## Reuse map

| Capability | Existing | Verdict |
|---|---|---|
| Emit on persisted-only deletion | `close()` artifact section, `hasPersistedSession()` (`:403-409`) | adapt: presence read inside the lock after the generation re-check |
| Popup enters the locked state | `onActiveProfileChanged`'s lock branch (`app.vue:154-172`) | adapt: extract one "enter locked state" routine, call it from both the event and `landOnLockScreen` |
| Fence semantics for the third writer | `loadProfileSeq`, `profileEventSeq` | build: define the interleaving in the plan; test it |
| Post-restart liveness wait | five inline polls | build one `waitForWorkerLiveness(page, afterTs)` in `fixtures/helpers.ts`; callers keep their own baseline choice |
| Unit seeds for persisted-only state | `seedSession` + `setupFromExistingApi` | reuse |
| `landOnLockScreen` tests | none | build: extract the decision as a pure function beside `boot-session.ts` |
