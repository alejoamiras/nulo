# Phase 0 — narrow the freeze to wallet sends (2026-09-17)

## Setup

- The branch sat on `c543c18d` (pre-merge dev) with the rev 6 docs commits on top; rebased onto
  `origin/dev` @ `0e9d9ce2` (both prerequisite squashes). One conflict, `implementations-plan/index.md`:
  dev never carried this plan's row (the plan folder was untracked until rev 6), so both rows were
  kept — the prerequisite's above, this plan's below. Rebased commits re-signed automatically.

## What was built

- `utils/in-flight-send.ts`: `isInFlightSend` requires `origin === "popup"` alongside
  `SENDING_KINDS`; `isApprovedSendInFlight` untouched and its doc now says why (a lock cancels dApp
  sends too). Header rewritten around the popup transfer's scope snapshot; the old "reads the active
  profile while it builds" rationale is gone with the fence.
- `stores/app.store.ts`: the tracker carries a `generation`; `resetInFlight()` (rows empty, ready,
  bump) and `refreshInFlight({ invalidate: true })` (bump, close the guard, re-read) are the two
  lifecycle edges; every read captures the generation at issue and `answer()` drops a result — rows
  or the error fallback — from another generation or another profile. `commitScopeChange` unchanged.
- `popup/app.vue` `enterLockedState`: `appStore.resetInFlight()` beside `clearActivity()`.
- `composables/useProfileBootstrap.ts`: both `isLogined = true` sites call
  `refreshInFlight({ invalidate: true })` first.

## Decisions

- **The unlock refresh is an option on `refreshInFlight`, not a second action.** The plan says the
  unlock sites "lower `ready` and call `refreshInFlight()`"; `ready` is tracker-internal, so the
  lowering has to travel with the call. `{ invalidate: true }` names the intent at the call site and
  keeps the store's action set to one addition (`resetInFlight`), which the shape pins now list.
- **Store tests live in `app.store.in-flight.test.ts`**, not appended to `app.store.test.ts`: that
  file runs the real journal client and never touches the tracker; the tracker cases need a
  deferrable `getOperations` fake, the pattern `app.store.setup-active-account.test.ts` already
  uses. Same directory, so the gate's `src/stores` glob covers it.
- The profile-id watcher's behaviour is already pinned by `app.store.shape.pins.test.ts` ("a
  profile change closes the guard until the journal answers"); not duplicated.
- The lane-journaled UI send (auth registry) is a `dapp_execute` record with `origin: "dapp"`
  (`execution-lane.ts:148-149`); the guard test covers it as such.

## Mutations (each restored after the run)

| Mutation | Failing tests |
|---|---|
| drop the generation check in `answer()` | the three late-read cases |
| drop `origin === "popup"` from `isInFlightSend` | 3 guard cases + the dApp-send admits case |
| `resetInFlight` leaves `ready` low | the reset case + the pre-reset late read |

## Gate

- `bun --bun vitest run src/utils/in-flight-send.test.ts src/stores src/wallet/services/execution/service.composition.test.ts`
  → 10 files, 136 tests passed. The composition case cited by the plan is
  `service.composition.test.ts:507` ("a dApp send parked at its slot-key lookup, then $label:
  refused, failed/session_ended under p1, never proved") — green, untouched.
- `bun run typecheck` → exit 0. `bun run lint` → exit 0 after replacing eight `void (store.x = …)`
  test commits (`noAssignInExpressions` warnings) with block-bodied helpers.
- No edits under `execution/`.
