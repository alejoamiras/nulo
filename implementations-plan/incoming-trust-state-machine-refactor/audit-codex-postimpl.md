Verdict: Reject

High

1. `packages/extension/src/wallet/services/incoming-transfer/service.ts:186-188`, `packages/extension/src/wallet/services/incoming-transfer/service.ts:531-645`, `packages/extension/src/popup/pages/activity.vue:61-76`, `packages/extension/src/popup/components/modules/general/RecentActivityView.vue:206-220`
`onActiveProfileChanged` now just calls `hydrateSchedulers()` and does not invalidate in-flight scans. On `dev`, `hydrateSchedulers()` explicitly bumped every scan generation before rebuild (`git show dev:packages/extension/src/wallet/services/incoming-transfer/service.ts:363-372`), so a scan parked before the rebuild would bail before mutating (`...:540-587`). In this branch, a scan for profile A that is parked on `getNotesRaw()` during an A→B switch can resume, pass the unchanged `serviceEpoch`, and still emit `onIncomingTransferAdded` for A. That is user-visible because the popup consumers blindly append/remove incoming-transfer events without checking the live `(profileId, networkId, accountAddress)` triple. Fix direction: treat active-profile scheduler rebuilds as lifecycle-cancel boundaries too. Bump `serviceEpoch` on profile-switch rehydrate and add a regression test that parks `getNotesRaw()` across A→B. Because the current UI listeners are unscoped, I would also harden the client-side `onIncomingTransferAdded` / `onIncomingTransferDeleted` handlers or route them through a triple filter.

2. `packages/extension/src/wallet/services/incoming-transfer/service.ts:203-235`, `packages/extension/src/wallet/services/account/service.ts:43-49`, `packages/extension/src/wallet/services/account/service.ts:194-200`
`onAccountDeleted` scopes its record wipe through `getActiveProfile()` instead of the deleted account's own `profileId`. That is wrong for the two paths that emit `onAccountDeleted` for arbitrary profiles: chain purge and profile delete. If an inactive profile is being purged, this handler can delete incoming-transfer rows from the currently active profile when addresses overlap, and it can also tear down the active profile's scheduler entries because the scheduler key does not include `profileId`. Fix direction: accept the full `Account` payload here, use `account.profileId` for the repo wipe, and only touch `schedulers` / `watchedContracts` / `serviceEpoch` when the deleted account belongs to the active profile. Add a multi-profile regression test; the current coverage only checks scheduler removal on the active profile.

Medium

3. `packages/wallet-core/src/utils/lock.ts:36-60`, `packages/extension/src/wallet/services/incoming-transfer/service.ts:573-641`
The lock's force-release path is not ownership-aware. After the timer fires and `leave()` hands the lock to waiter B, a late `leave()` from timed-out holder A will clear B's timer and unlock B's critical section. This refactor now depends on `serviceLock` across multiple awaited calls inside `scanContract`, including PXE timestamp I/O, so a 5-minute stall breaks mutual exclusion instead of merely logging. Fix direction: make acquisition tokenized/owned (`enter()` returns a token, `leave(token)` ignores stale holders) or change the timeout to log-only. Add a regression test for `force-release -> waiter acquires -> original holder late-leaves -> waiter still owns lock`.

Low

4. `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts:1428-1445`, `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts:548-574`, `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts:1566-1734`
The new lock-race coverage still leaves three holes the plan explicitly called out. `setTrustReject` is only pinned in steady-state symmetry, not under queued contention with `onTokenDeleted` / stale-token races. `onAccountDeleted` coverage stops at scheduler teardown and never asserts record deletion across both networks or inactive-profile safety. `replayPendingPrompts` is only tested for the "delete/reset before replay emits" ordering, not the inverse ordering where replay emits first and `onTokenDeleted` follows, which is the path that relies on `PopupManager` purge/close behavior. Fix direction: add dedicated regression pins for those three orderings.

Nit

5. `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts:1255-1333`, `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts:1620-1625`, `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts:1793-1796`
The scenario test file still carries stale prose from the retired generation-counter design. Test names/comments mention a "generation counter", reference a nonexistent `service.lock-races.test.ts`, and the LR12 comment says the epoch is captured after `getNotesRaw()`, which is the opposite of the implementation (`packages/extension/src/wallet/services/incoming-transfer/service.ts:531-543`). Clean those comments up so the test file documents the lock+epoch design that actually ships.

Confirmed / no finding

- `packages/extension/src/wallet/services/incoming-transfer/service.ts:531-571`: `serviceEpoch` capture before any await, and the check at the top of the per-note critical section, are the right positions for clear/delete cancellation.
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:227-230`, `273-301`, `336-349`, `463-468`, `506`, `590`, `611`, `639`: every record/trust storage mutation is now under `withServiceLock`.
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:278-314`, `607-615`: reentrancy split is correct. Public callers use `_setTrustStateLocked` once already inside the lock; the unknown→pending transition in `scanContract` goes straight through `repo.setTrust(...)` plus one emit.
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:333-350`, `436-469`: `clearProfile` / `clearChain` do not emit directly, and `onTokenDeleted` still does records-first then trust-reset emit.
- Sticky-pending and visibility-gate behavior look preserved in code and in the updated tests.

Verification

- `bun run --cwd packages/extension vitest run src/wallet/services/incoming-transfer/service.scenarios.test.ts`
- `bun run --cwd packages/wallet-core vitest run src/utils/lock.test.ts`
