# Phase 5 — the lock dialog and the card copy

## What landed

- **`approvedSendsInFlight(ops, profileId)`** in `utils/in-flight-send.ts` counts the profile's sends
  for which `isApprovedSendInFlight` holds (`pending`, `simulating`, `proving`) on any account and
  network. `queued`, `submitting`, terminal records, non-sending kinds and other profiles do not
  count. It reuses the predicate the auto-lock deferral asks, so the dialog and the deferral count
  the same records.
- **The store** exposes `approvedSendsInFlight`, a computed over the tracker's rows for the active
  profile. The tracker already loads every operation of the profile, so there is no new read path.
- **`Header.vue`**: the lock button awaits `refreshInFlight()`, then locks at once when the count is 0.
  Otherwise it fills `cacheStore.confirm` with the §UI impact copy (pre-title "Running transactions",
  title "Lock wallet?", singular or plural body, confirm "Lock anyway", red) and opens the confirm
  popup. The callback is the old lock body, which re-checks `isLogined` because the session may have
  ended while the dialog was open.
- **`ConfirmPopup.vue`**: the pre-title shows `cacheStore.confirm.pre_title` when set and falls back
  to the colour-derived "Irreversible" or "Action required" otherwise. The popup already resets
  `cacheStore.confirm` on close, so the override never reaches the next dialog. The pre-title, title
  and description gained `confirm-pre-title`, `confirm-title` and `confirm-description` testids for
  the Phase 6 e2e.
- **`journal-state.ts`**: `session_ended` maps to the failed card subtitle "Stopped — wallet was locked".

## Decisions and deviations

1. **The count is a number, not a boolean.** The body copy has a singular and a plural form.
2. **A failed journal read locks immediately.** `refreshInFlightOps` treats a read failure as "no
   sends known" and sets the count to 0. Locking is a security action and must not depend on the
   journal answering.
3. **The generated `auto-imports.d.ts` gained `approvedSendsInFlight` by hand**, in both blocks, at
   the generator's position (after `applyOutcome`). The Phase 7 build regenerates the file and a
   diff there would show a mismatch.
4. **The journal-detail page is unchanged.** Its "Reason" row and categorical label fall to their
   generic defaults for `session_ended`, as they do for any kind they do not list. The signed-off
   UI impact names only the card subtitle, so those labels stay as they are.

## Copy check

A scratch script compared each string with plan.md §UI impact: the pre-title, title, singular body,
plural body (the `{N}` template), confirm label and card subtitle each appear verbatim in both.

## Tests

| Plan case | Test |
|---|---|
| Predicate: account-blind; `queued`, `submitting`, kinds excluded | `in-flight-send.test.ts`: three sends on three accounts count 3; a queued request, a send at `submitting`, a succeeded send, a token import and another profile's send count 0; no profile counts 0 |
| Store computed over seeded records | `app.store.shape.pins.test.ts`: seeded rows count 2 for `p1`; after a switch to `p2`, its row counts 1; the getter key and return order include the new computed |
| Header: refresh awaited before the decision | the refresh raises the count from 0, and the dialog opens |
| Header: instant lock at 0 | lock called, `isLogined` false, no popup |
| Header: dialog copy at 1 and N, pre-title included | `test.each` over 1 and 3: every confirm field |
| Header: confirm locks, cancel does nothing | lock not called until the callback runs; `ConfirmPopup` Cancel closes without running it |
| ConfirmPopup: override shown, fallbacks otherwise | `test.each` over red, default and override; the override clears on close |
| journal-state subtitle | `session_ended` → failed, red, "Stopped — wallet was locked" |

## Mutation checks

| Mutation | Tests that failed |
|---|---|
| The lock reads the count before the refresh | both dialog cases |
| The lock always asks | the instant-lock case |
| The dialog sets no pre-title | both dialog cases |
| The confirm callback does not lock | both dialog cases |
| ConfirmPopup ignores `pre_title` | the override case |
| The count ignores the profile | the exclusions case |
| The count uses the account-scoped in-flight predicate | the exclusions case, the store case |
| The store computed ignores the active profile | the store case |
| No `session_ended` subtitle | the subtitle case |

## Validation gate

| Command | Result |
|---|---|
| `cd apps/extension && bun --bun vitest run src/utils src/stores src/components/Header.test.ts` | exit 0: 54 files passed; 767 tests passed |
| `bun run typecheck:all && bun run lint` | typecheck exit 0; lint exit 0, 30 warnings (all pre-existing elsewhere), complexity-baseline check OK |

`ConfirmPopup.test.ts` sits outside the gate's paths and ran separately: exit 0, 7 tests passed.
