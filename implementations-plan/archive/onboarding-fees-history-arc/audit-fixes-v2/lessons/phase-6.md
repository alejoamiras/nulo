# P6 lessons — PopupManager visibility seed + onUnmount deregister

## Outcome

`fix(popup-manager): seed visibility before subscribing + deregister on unmount` —
10/10 tests pass in `PopupManager.test.ts` (+4 new pins). Closes codex
Med #1 (the prior arc's post-impl audit) + opus H-6 (listener leak).

## What shipped

`packages/extension/src/popup/components/popups/PopupManager.vue`:

- **Listener registration moved into `onMounted` after the seed
  `getValue` resolves.** Previously the registration was at module-
  top (before `connect()` and `getValue()` resolve). A real OFF→ON
  config flip arriving in the connect-vs-seed window was misread
  against the optimistic `lastVisibility = true` default.
- **`visibilityInitialized` belt-and-suspenders gate**: even though
  the listener is now registered post-seed, the handler still checks
  this flag and early-returns if false. Defends against any future
  refactor that re-broadens the listener-registration window.
- **`configService.onUpdate.remove(onConfigUpdate)` in
  `onBeforeUnmount`** BEFORE the disconnect. Prevents listener
  accumulation across popup mount/unmount cycles (opus H-6). The
  remove call also splices the handler from the mock's array so
  the test asserts work as expected.

## Tests (+4 new pins)

`packages/extension/src/popup/components/popups/PopupManager.test.ts`:

- **post-init OFF→ON**: seed reads `false`; fire event with `value: true`
  → `replayPendingPrompts` called exactly once with active triple.
- **pre-init event ignored**: hold the seed `getValue` in a never-
  resolving promise; assert the listener is NOT yet registered (so
  any event fired in this window can't even reach the handler).
  Resolve the seed → listener registered → post-init event fires
  replay normally.
- **mount → unmount listener cleanup**: assert
  `configService.onUpdate.remove` is called exactly once on unmount
  AND the mock's handler array is emptied.
- **mount → unmount → mount listener count**: assert exactly one
  listener registered after the second mount (no leak across cycles).

The mock's `onUpdate.add` / `onUpdate.remove` implementation was
extended to splice on remove + a `configUpdateRemoveSpy` was added
so tests can assert deregistration. The mock's `getValue` is now
controllable via a module-level `configGetValueImpl` that tests can
swap to a deferred promise for the seed-race test.

## Files

- `packages/extension/src/popup/components/popups/PopupManager.vue`
  (init gate + listener-registration move + remove on unmount).
- `packages/extension/src/popup/components/popups/PopupManager.test.ts`
  (+4 cases + mock extensions).

## Open items

None. P6 is rollback-independent per the plan's rollback matrix.
