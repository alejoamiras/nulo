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

## Arc 1 codex loop (GPT-6 Astra, `high`, static) — session `01a0b008-…`

### Round 1 → conditional approve

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | MEDIUM (inferred) — a pre-lock `onOperationAdded/Updated` carrying a popup send, delivered after `resetInFlight()`, refills the cache; the generation gates RPC answers only | plausible: the journal and profile events travel on separate ports, no ordering barrier | **Adopted**: `state.suspended` — set by `resetInFlight()`, cleared by the invalidating refresh; the three listeners return while it is set. Test delivers a captured `onOperationUpdated` callback after the reset (ignored) and after the unlock read (applied). Mutation (drop the check) fails it. |
| 2 | LOW — the dApp-send "admits three switches" test moved the viewed scope off the record after the first commit | yes | **Adopted**: each switch from a fresh store |
| 3 | LOW — the rejecting-late-read test proved readiness only (rows were empty) | yes | **Adopted**: seeded with a popup send; asserts `approvedSendsInFlight === 1` after the rejection |
| 4 | LOW — comments: tracker header overstated ("nothing but a profile change" — reconnects refresh too); app.vue "cancelled every send" (not `submitting`); guard header "a scope change cannot reach them" (a profile change ends the session and the send fails closed); duplicated generation explanation; the `(Codex v2 critique)` / `codex audit` review references in two touched headers | yes | **Adopted** all; the helper doc on `parkNextRead` dropped |

Held: the narrowing itself (popup transfers journal `origin: "popup"`; lane/queued sends `"dapp"`), the generation across reset/unlock, realm separation, `readsFor("p1") === 2`.

### Round 2 (resumed, on `d09dd7bb`) → conditional approve

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | MEDIUM (inferred) — a read pending during an event publishes an older snapshot over it (same generation, same profile); codex notes it predates the fix and affects every refresh | yes, as a pre-existing property of the tracker: the worker snapshots storage, an update in between emits first (same port), the reply replaces it | **Declined for this arc, recorded**: out of Phase 0's scope (the plan keeps every existing refresh unchanged); the unlock read has nothing in flight to race (the lock cancelled the profile's sends) and the boot read had the identical window before. Added to plan.md §Known limitations with the `updatedAt` merge as the fix if it bites. |
| 2 | LOW — `suspended` doc: say "cleared when the unlock read starts"; drop the narrating `emitUpdated` doc | yes | **Adopted** |

Held: `suspended` stays set across a lock-screen profile pick (a pick is not an unlock); plain boolean is right; both bootstrap paths clear it.

### Round 3 (resumed, on `89dfdbf3`) → conditional approve

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | MEDIUM (inferred) — premise "nothing is in flight at unlock" is false: the sweep excludes `submitting` (`execution-lane.ts:61-64`), so the NEW unlock read can snapshot a `submitting` transfer, the transfer ends and its event lands first, the older snapshot then restores it and the cached short-circuit refuses for good. Before this arc a same-profile unlock issued no read. | yes — the sweep's stage list and the same-port ordering both check out | **Adopted**: `state.revision` counts applied events; the invalidating refresh (`settle`) re-reads when the revision moved during its read (≤ 3 reads). Regression test "the unlock read re-reads when an event overtook its snapshot" (disabling the re-read fails it); "a plain refresh publishes its snapshot even when an event landed meanwhile" pins that the other refreshes are unchanged. Known-limitations text corrected. |

Hard stop reached at three rounds with a condition outstanding; the condition was implemented as prescribed and one verification-only resume asked codex to confirm it (below). Surfaced to the owner in the session report.

### Verification resume (on `0adc1ca3`) → conditional approve

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | MEDIUM — the three-read cap still publishes a contested snapshot on the third read | yes | **Adopted**: cap removed — the invalidating read repeats until a read sees no event land during it (each pass is one round trip, so only a journal busier than the read keeps it looping); regression "keeps reading while events keep overtaking it" (three overtaken reads, the fourth uncontested; restoring the cap fails it) |

### Final confirmation (on `ab3624f8`) → **approve**

> "Approve. The retry-cap defect is closed: invalidating reads publish only when the event revision remains unchanged, with generation/profile checks intact. The regression covers three overtaken reads followed by an uncontested fourth. No remaining conditions."

Loop shape for the record: one fresh pass plus four resumes, two beyond the three-round guideline — the extra passes verified a single finding refined twice (the `submitting` ordering, then the retry cap), not new topics; surfaced to the owner.

## Post-review: the lock-screen pick gets its e2e (owner request, 2026-09-17)

`apps/extension/tests/e2e/network/profile-switch-sweeps-transfer.test.ts` carried a workaround for the
bug this arc fixes: after the lock it reopened the popup, because the locked popup's picker refused on
its cached in-flight rows. The reopen is removed — profile B is now picked in the SAME popup that
locked with A's transfer parked at `proving`. A storage-seeded smoke variant was considered and
dropped: the proof gate already parks a real popup send deterministically, and a seeded row with no
live controller would exercise a state production never reaches.

Gate: `NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/profile-switch-sweeps-transfer.test.ts`
→ 1 passed, exit 0 (94 s). The same-profile unlock leg stays unit-covered (`app.store.in-flight.test.ts`).
