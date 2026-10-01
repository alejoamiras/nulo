# P8 lessons — Tactical C2: one-shot replay on triple-ready

## Outcome

`fix(popup-manager): replay pending prompts on appStore triple-ready` —
15/15 tests pass in `PopupManager.test.ts` (+5 new P8 pins). Closes
the user's QA report C2 ("closed popup → trust prompt never reopened")
under the H3/H7 hypothesis confirmed by both prior audits.

## What shipped

`packages/extension/src/popup/components/popups/PopupManager.vue`:

- Replaced the prior `onConnected` handler that early-returned on
  missing appStore triple with a triple-keyed idempotency-guarded
  `tryReplayForTriple`.
- Registered `tryReplayForTriple` on BOTH `onConnected` AND a granular
  `watch` of `[appStore.profile?.id, appStore.network?.id,
  appStore.account?.address]`. Whichever fires first sees a ready
  triple and calls `replayPendingPrompts`; the other no-ops via the
  `replayedForKey` flag.
- Profile switches re-key (`replayedForKey` differs from new triple)
  → replay re-fires for the new profile/network/account.
- `unwatchTriple()` called in `onBeforeUnmount` so the watcher is
  cleaned up.

## Why "tactical" (vs the deferred full design)

The full v3 design added AbortController + sequence counters for
rapid-profile-switch races. v3 was rejected because the cancellation
guards still left races. This tactical version keys idempotency on the
triple itself; a stale-resolve from a prior profile is absorbed by
the popup queue's existing triple-key dedup (no popup opens for a
non-active triple).

Documented residual risk in the PR rollback matrix: rapid A→B→A
switches can theoretically enqueue B's replayed payloads after the
user is back on A; those payloads sit unused in the queue. Full
cancellation guards deferred to the trust-state-machine arc.

## Tests (+5 new P8 pins)

`packages/extension/src/popup/components/popups/PopupManager.test.ts`:

- **onConnected with active triple**: fires `replayPendingPrompts`
  once with the active triple.
- **onConnected with empty triple, then triple populates**: early-
  returns from onConnected (no replay); subsequent triple
  population fires the watcher which calls replay.
- **Idempotency**: two consecutive onConnected fires for the same
  triple → replay called exactly once (the `replayedForKey` flag).
- **Profile switch**: triple `.id` changes (e.g. `p1 → p2`) →
  replay re-fires for the new triple.
- **Unmount cleanup**: post-unmount triple changes do NOT call
  replay (watcher deregistered via `unwatchTriple`).

## Test harness fixes (incidental)

- `appStoreState` is now `reactive({...})` (was a plain object literal
  in the mock). Required so the P8 watcher inside PopupManager
  observes the test's state mutations.
- Added `trackedWrappers` + `afterEach` that unmounts every wrapper
  created in the test. Without this, watchers from prior tests'
  mounts continue firing on subsequent tests' `appStoreState`
  mutations, leading to mock-call-count leakage. The pre-P8 tests
  passed without this only because they had no watcher on
  `appStoreState`.

## Files

- `packages/extension/src/popup/components/popups/PopupManager.vue`
  (replace `onConnected` body + new `tryReplayForTriple` + watcher +
  unmount cleanup).
- `packages/extension/src/popup/components/popups/PopupManager.test.ts`
  (reactive appStoreState + mount tracking + 5 new P8 cases).

## Open items

The repro e2e test from P4a should now pass; verify in P12 e2e check
OR under the network e2e CI workflow.
