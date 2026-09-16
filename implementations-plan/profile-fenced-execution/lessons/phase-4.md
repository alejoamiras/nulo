# Phase 4 — auto-lock deferral

## What landed

- **`commitSession(session, { mutate, expect? })`** is the only writer of a live session's row.
  Under the artifact lock it stands down unless `session` is still the active one, and, when
  `expect` is passed, unless `lockedAt` and `configRev` still match. It then applies `mutate` to the
  row as it is at that moment, persists it, and re-arms the alarm when `lockedAt` moved.
- **Must-apply writers on it.** `refresh()` stamps `since` and `lockedAt` inside the lock.
  `applyTtlChange` keeps its facade serialization and its immediate close, and writes through
  `commitSession`. `clearBearer`'s live branch writes through it; its locked branch is unchanged.
- **`configRev`** increments as the first statement of `applyTtlChange`, which the config listener
  calls synchronously, so the bump lands in the same tick as the new TTL.
- **One decision per expiry.** `expireOrDefer(session)` stores one promise on the session
  (`expiryDecision`) and clears it when it settles. The alarm handler calls it inside its
  `runExclusive` after the staleness gate. The lazy branch of `getActive()` calls it and then reads
  the same session again.
- **`decideExpiry`** reads `lockedAt`, `configRev`, the budget end and the step before awaiting the
  check. A true answer within the budget commits `lockedAt = min(now + step, budgetEnd)` with
  `expect`. Anything else re-checks identity, `lockedAt` and `configRev`, then closes.
  `step = min(60 s, TTL)`; the budget end is
  `deferBudgetEnd ?? deriveLockedAt(session) + min(TTL, 10 min)`, fixed on the first commit.
- **Wiring.** `SessionManager.setExpiryDeferral`, forwarded by `ProfileService.setExpiryDeferral`.
  `ExecutionService.init` registers `hasApprovedSendsInFlight`, which reads the journal under the
  session's profile and asks `isApprovedSendInFlight` of each record.

## Decisions and deviations

1. **`isApprovedSendInFlight` lives in `utils/in-flight-send.ts`, next to `isInFlightSend`.** It
   reuses `SENDING_KINDS` and adds the approved, unbroadcast stages (`pending`, `simulating`,
   `proving`). The file map places `utils/in-flight-send.ts` in the lock-dialog phase; that phase's
   `approvedSendsInFlight(ops, profileId)` can count with this predicate, so the policy is written
   once. The generated `auto-imports.d.ts` gained its two entries by hand, in the generator's
   alphabetical positions; the build in `audit:vue` regenerates the file, and a diff there would
   show a mismatch.
2. **`getActive()` reads the session again after a decision instead of returning `undefined`.** A
   decision stands down only when someone moved the deadline or the TTL. Returning `undefined`
   would report the wallet locked while it stays open, and a send's fence assert in that window
   would fail. Each re-read needs a new write to stand down again, so it terminates.
3. **A decision never rejects.** `expireOrDefer` catches and logs, so `getActive()` and the alarm
   handler keep their non-throwing contract when a deferral write fails.
4. **The check is asked before the budget is compared.** `now` is read after the answer, so a slow
   check cannot extend from a stale clock.
5. **`commitSession` re-arms only when `lockedAt` moved.** `refresh` and `applyTtlChange` used to
   clear and re-schedule unconditionally. The one visible difference: a restored session without a
   persisted `lockedAt` whose TTL is set to 0 keeps its old alarm, and that alarm is ignored as
   stale when it fires, because the effective deadline no longer matches.
6. **The deferral check reads the journal directly (`getOperations`), never through its RPC gate.**
   The RPC gate reads the active profile under the facade lock, which the alarm path already holds.

## Tests

`session-manager.test.ts`, describe `SessionManager expiry deferral` (fake `Date`, real timers, a
controllable check, a row-write recorder, the artifact lock held by the test to fix acquisition
order):

| Plan case | Test |
|---|---|
| Alarm with the check true, then false | extends one step, re-arms, no emit; the next expiry with false closes and deletes the row |
| Lazy path | a read after the deadline returns the session extended |
| Check throws | the session closes |
| Coalescing | alarm, two reads and a refresh: one check call; writes are the deferral then the refresh |
| `applyTtlChange` non-zero during the check | only the TTL change writes; its deadline and alarm survive |
| `applyTtlChange(0)` during the check | `test.each` over both answers: only the TTL change writes, no close |
| `clearBearer` vs deferral, both orders | writes follow acquisition order; the row ends extended with no bearer |
| `refresh()` vs deferral, both orders | the refresh's deadline persists; refresh-first leaves the deferral without a write |
| `applyTtlChange` vs deferral, both orders | only the TTL change writes, in both orders |
| `clearBearer` vs `close()` | no row after both settle |
| A lock while the check is pending | the decision writes nothing back and the read returns `undefined` |
| Re-read after a stand-down | a TTL change whose write is blocked makes the close stand down; the read decides again and returns the session |
| Budget | deferrals clamp at `min(TTL, 10 min)` past the first deferred deadline, then close |
| `refresh()` does not refill | `deferBudgetEnd` unchanged; the next expiry past it closes |
| Budget from the TTL at first deferral | a session opened with TTL 0 and given a TTL defers |
| Restored without `lockedAt` | the budget anchors on `since + TTL` |
| Stale alarm | ignored, check not asked |
| TTL 0 | nothing expires, no alarm, check not asked |
| `restore()` unchanged | an expired row closes at restore without asking |
| Source pin | `this.session.set(` only in `commitSession`, `open` and `clearBearer`'s locked branch |

`execution/service.test.ts`: the check over kinds and stages (`queued`, `submitting`, terminal and
`token_import` do not defer) and a journal of queued requests alone. The composition harness
captures the registered check; one composition case shows it answering from the real journal: a
queued request does not defer, a transfer at the proof gate does for its own profile only, and
nothing does once it succeeds.

## Mutation checks

A scratch script patched `session-manager.ts`, ran its test file and restored it. The first run
found two survivors, and a test was added for each.

| Mutation | Tests that failed |
|---|---|
| `commitSession` ignores `expect` | both TTL-change orderings, the TTL change during the check, refresh-first, TTL off with a true answer |
| `commitSession` skips the identity check | none at first; after the fix, the lock-while-pending case |
| No `configRev` bump | the TTL change and deferral, deferral first |
| Decisions not coalesced | coalescing, refresh and deferral with the deferral first |
| Budget recomputed on every deferral | budget clamp, no refill, TTL-0-then-TTL, restored without `lockedAt` |
| `refresh()` clears the budget | no refill |
| Budget anchored on the raw `lockedAt` | restored without `lockedAt` |
| Close without the re-check | TTL off with a false answer |
| Alarm closes directly | the alarm case, coalescing |
| Lazy path closes directly | 17 tests |
| Check errors not caught | the throwing check |
| `clearBearer` writes the live row directly | both `clearBearer` orderings, `clearBearer` vs `close()`, the source pin |
| Step not clamped to the budget | budget clamp |
| A stood-down read reports the wallet locked | none at first; after the fix, the re-read case |

## Validation gate

| Command | Result |
|---|---|
| `cd apps/extension && bun --bun vitest run src/wallet/services/profile src/wallet/services/execution/service.test.ts` | exit 0: 13 files passed; 292 tests passed |
| `bun run typecheck:all && bun run lint` | exit 0; 30 warnings, all pre-existing elsewhere; complexity-baseline check OK |

The composition harness and a shared util changed too, so `bun --bun vitest run src/wallet src/utils
src/stores` also ran: exit 0, 237 files passed, 2 skipped; 3328 tests passed.
