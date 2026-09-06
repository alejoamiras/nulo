# restart-lock-truth — a lock after a worker restart must lock the popup

- **Tier**: light (single codex audit). `code_review: off`. `eli5_mode: artifact`.
- **Budget**: recon 1 sonnet agent (done, `recon.md`); codex: 1 plan audit + post-impl loop ≤3.
- **Worktree**: `restart-lock-truth` / branch `worktree-restart-lock-truth` off `dev@e7e94005`.
- **Owner decisions (2026-09-06)**: both product layers; shared helper + all eligible callers for the
  liveness gates; validation = unit + prover-ON passkey canary + smoke.

## Why

#553 gave the passkey canary its first real service-worker restart and the stage went red: the
replacement worker holds no in-memory session, so the Header's Lock click clears the persisted
record through `SessionManager.close()` without the `onActiveProfileChanged(undefined)` that drives
the redirect, and the popup keeps its logged-in shell. The harness works around it today (poll the
record away, navigate by hand). A user who keeps the popup open across a worker death — crash,
update, or the idle reaper between two heartbeats — sees the same thing: Lock strips the header and
leaves the page. Separately, every post-restart liveness gate in the suite snapshots the heartbeat
before the kill, which a 10s heartbeat can satisfy with the OLD worker's last tick.

## Scope

In:
1. **Service**: an explicit lock always produces the event. `SessionManager.close()` returns
   whether it emitted (true only on the in-memory path, unchanged); `lockActiveProfile()` emits
   `onActiveProfileChanged(undefined)` itself when `close()` did not. This covers both the
   persisted-only record (passkey after a restart) and the nothing-at-all case (a strict-password
   profile whose bearerless record `restore()` already dropped) — the audit's Medium — without a
   presence read inside the artifact lock. `close()`'s internal ordering, `silentClose`, and every
   `isActive()`-gated caller are untouched; the existing "no-op when already closed" pin on
   `close()` stays true, the new pin is on `lockActiveProfile`.
2. **Popup**: the reconnect boot that resolves `locked` over a popup still rendering an
   auth-required route enters the locked state itself — the same routine the event path runs
   (`popupStore.closeAll()`, `isLogined = false`, `clearActivity()`, route to auth/register) —
   extracted once and called from both. The trigger is "a profile is selected AND the current route
   requires auth", NOT `isLogined` (the Header flips that flag before the worker answers, so a
   flag-keyed trigger misses an early Lock click — the audit's Medium). The passkey exemption stays
   exactly `isPasskeyRoute && !hasProfile` (today's `app.vue:215`). `landOnLockScreen` becomes a
   pure decision (`decideLockLanding(state) → "stay" | "select-and-auth" | "lock"`) beside
   `boot-session.ts`; `app.vue` executes the action.
   **Fence rule (audit High, rewritten).** The boot path NEVER bumps `profileEventSeq` — an unlock
   that started through the event path owns the authenticated state, and `runFencedBootstrap` fences
   only its failure bookkeeping, not its mutations, so a bump from the boot path would strand a live
   session. Instead the boot run captures `profileEventSeq` BEFORE its lookup and, immediately before
   the destructive mutation, requires BOTH `loadProfileSeq` (its own `isCurrent()`) and the captured
   `profileEventSeq` to be unchanged; any event in between (an unlock, a lock) means the event path
   owns the outcome and the boot path only sets `isSessionChecked`. The orchestration is a small
   seam (`reconcileLockedBoot(deps)`) tested with deferred promises for the interleavings: lookup
   resolves → unlock event lands → boot reaches mutation (must abandon); unlock event lands → lookup
   resolves (must abandon); lookup resolves with no event (must lock).
3. **Harness**: one `waitForWorkerLiveness(page, afterTs, opts?)` in `fixtures/helpers.ts`
   (strictly newer than `afterTs`, 30s default, 500ms polling, reads from an extension page) and
   one `readLivenessBaseline(page)` that THROWS unless the read succeeds with a finite positive
   value (today's readers turn errors into 0, which a retained old timestamp then beats — the
   audit's Medium). The seven eligible callers (the skipped strict-OFF `sw-resilience` test
   included, skip retained) take their baseline AFTER `stopServiceWorker` resolves; the
   first-heartbeat timing test and `cold-wake-discovery` keep the pre-kill baseline with a comment
   naming the constraint. The passkey canary's stage 4 asserts the AUTOMATIC landing on
   `#/popup/auth` after reconnect (no Lock click — once phase 2 works the reconnect cleanup hides
   `header-lock`, so the old click would time out precisely when the fix works), then unlocks.
   New smoke spec in `sw-resilience.test.ts`: the ORIGINAL popup stays open across the kill and
   must land on auth by itself, then unlock; the existing tests close and reopen the page and never
   saw this bug. An e2e for "Lock clicked before reconnect settles" is not deterministic to drive;
   that interleaving is covered by the seam's deferred-promise tests.
4. **Docs**: the e2e skill's product-coupling bullet and ledger row #29 updated to "fixed"; the
   liveness bullet updated to name the helper; `lessons/`.

Out: the `isLogined` short-circuits in `route-guard.ts` and `auth-guard.ts` (test-pinned for the
accepted-unlock race; the fix makes the flag true at its source); password-profile bearer
semantics; any timeout change.

## Assumptions (verified)

1. `lockActiveProfile` is the only unconditional `close()` caller (`service.ts:853-866`); all others
   gate on `isActive()`.
2. `open()` emits its own info and never routes through `close()`, so the new emit cannot fire
   inside an unlock.
3. `landOnLockScreen` only routes when `!appStore.profile` (`app.vue:214-223`).
4. `profileEventSeq` and `loadProfileSeq` are independent; `onActiveProfileChanged`'s lock branch
   awaits `getProfiles()` and re-checks its seq before mutating (`app.vue:159-172`).
5. Seven of the nine liveness gates can move their baseline after the stop (the audit found the
   skipped strict-OFF test recon missed); two cannot (`recon.md`).
6. The passkey canary is not on CI's prover-ON canary lane (it runs proverless in the shard pool),
   so the local prover-ON run is the only prover-ON proof for it.

Asks: none blocking. Codex is asked to attack A2 and the fence rule in item 2.

## Phases

### Phase 1 — an explicit lock always emits (unit-gated)

- `session-manager.ts`: `close()` returns `Promise<boolean>` — true iff the in-memory branch
  emitted. No other change inside `close()`.
- `service.ts` `lockActiveProfile()`: `const emitted = await this.sessionManager.close(); …
  read-back …; if (!emitted) this.emit("onActiveProfileChanged", undefined)` — after the
  read-back, so a lock that did not persist throws instead of announcing a lock.
- Tests: `session-manager.test.ts` — `close()` returns true with an in-memory session, false on a
  fresh manager over a seeded persisted record (record gone, no emit from `close()` itself), false
  with nothing. `service.test.ts` (or the profile-service composition test) — `lockActiveProfile`
  emits exactly once in all three states; the read-back failure still throws and emits nothing.
- Gate: `bun run --cwd apps/extension test -- session-manager profile`.

### Phase 2 — popup enters the locked state on a locked boot (unit-gated)

- Extract `enterLockedState(profiles)` in `app.vue` (the four mutations + push); the event's lock
  branch calls it after its seq check.
- `popup/lock-landing.ts`: `decideLockLanding({ hasProfile, onAuthRequiredRoute, candidate, isPasskeyRoute })
  → "stay" | "select-and-auth" | "lock"`; `landOnLockScreen` maps the action: `select-and-auth`
  = today's branch; `lock` = `enterLockedState(result.profiles)` after both seq checks (no bump); `stay` =
  `isSessionChecked = true` only.
- `popup/reconcile-locked-boot.ts`: the seam — `reconcileLockedBoot({ lookup, readEventSeq,
  isCurrent, decide, enterLocked, settle })`: captures the event seq, awaits the lookup, decides,
  re-checks both seqs, then acts. `app.vue` wires it with real deps.
- Tests: `lock-landing.test.ts` (every branch of the pure decision);
  `reconcile-locked-boot.test.ts` with deferred promises for the three interleavings named in
  scope item 2, plus "a newer `loadProfile` run supersedes" — these are the proof the audit asked
  for; the e2e pin is integration evidence only.
- Gate: `bun run --cwd apps/extension test -- lock-landing reconcile-locked-boot boot-session
  auth-guard route-guard`.

### Phase 3 — harness helper, callers, canary revert (e2e-gated)

- `waitForWorkerLiveness` + `readLivenessBaseline` in `fixtures/helpers.ts`; the seven callers;
  the two exemptions commented; the passkey canary's stage 4 asserts the automatic landing; the new
  open-popup smoke spec in `sw-resilience.test.ts`.
- Validation (quiet host):
  - unit: `bun run --cwd apps/extension test`.
  - smoke trio (`sw-resilience`, `sw-restart-network`, `imported-account-lifecycle`) under
    `taskset -c 0,1` with `--retry=0` × 3; full smoke once.
  - `connect-locked-queue-sw-restart` + `cold-wake-discovery` proverless, two cores, retry 0 × 2.
  - `passkey-execution-canary` prover-ON, two cores, retry 0 × 2 (the product pin);
    `frozen-account-canary` prover-ON once.
- Gate: `bun run lint`, `bun run --cwd apps/extension typecheck`.

### Phase 4 — docs

Skill bullet + ledger #29 → fixed (this plan); liveness bullet names the helper; lessons.

## Security & adversarial considerations

- The new emit fires only when a persisted record was actually deleted; it cannot be triggered by
  a caller that has nothing to close, and it never runs inside `open()`. A forged
  `onActiveProfileChanged` from a page is already impossible (events are service → client only).
- The popup-side lock is strictly more conservative: it moves a popup that a dead worker left
  logged-in to the lock screen. The risk is ejecting a LIVE session on a stale `locked` result; the
  fence rule plus the ordering pin cover it, and the e2e pin runs it prover-ON under two cores.
- No storage shape change, no migration, no new RPC.

## Post-implementation

Codex fix loop ≤3 rounds → PR `fix(popup,profile): a lock after a worker restart locks the popup;
liveness gates read after the stop` → babysit to green. Merge on the owner's word.

## Delivery

Single PR, squash. Commits per phase.

## Audit outcome (codex, 2026-09-06 — `audit-codex.md`)

`plan needs changes`; every finding adopted: (H) the boot path no longer bumps `profileEventSeq`
— it captures the seq before the lookup and requires both seqs unchanged before mutating, proven
by deferred-promise tests on an extracted seam; (M) the popup trigger keys on "profile selected +
auth-required route", not `isLogined`, and the service side moves from a presence read in `close()`
to "`lockActiveProfile` emits when `close()` did not" so the early-click / already-dropped-record
case also emits; (M) the canary asserts the automatic auth landing and a new open-popup smoke spec
is added; (M) the liveness baseline read throws on anything but a finite positive value; (L) the
seventh caller. Codex confirmed the service ordering is sound, `silentClose` stays separate, the
popup layer is necessary (service-only leaves stale UI until the next click), and no scope change.
