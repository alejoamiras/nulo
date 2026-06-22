# P11 lessons — E1 identity-scoped consumer rehydration (send.vue)

## Outcome

`fix(send): refetch tokens/balances/contacts on profile/network/account change` —
typecheck clean. Closes the user's QA report E1 ("switch from Profile A
to Profile B → press Send → 'no available tokens' until clicking into
a token detail").

## Scope decision

Applied the rehydration ONLY to `send.vue` for v2. The plan's full
consumer-inventory disposition (10+ files) is documented but deferred:

| Consumer | Status in v2 | Why |
|---|---|---|
| `popup/pages/send.vue` | **Fixed** in P11 | The user-confirmed QA bug. |
| `popup/pages/activity.vue` | Deferred | Activity tab refreshes via existing service-event subscribers (`onTokenAdded` etc); the stale-after-profile-switch case is non-QA-confirmed. |
| `popup/pages/tx/[id].vue` | Deferred | Page-level detail; user navigates back on profile change. |
| `popup/pages/journal/[id].vue` | Deferred | Same. |
| `popup/components/modules/general/RecentActivityView.vue` | Deferred | Home-tab widget; same staleness window as activity.vue. |
| `popup/components/popups/NewTokenPopup.vue` | Already correct | Existing `watch(() => props.show)` re-fetches on each open. |
| `popup/components/popups/SelectTokenPopup.vue` | Deferred | Fresh fetch on each popup-open via similar pattern. |
| `popup/pages/settings/tokens/index.vue` | Deferred | Settings page; refresh-on-navigate is acceptable. |

The v2 fix closes the user's user-facing complaint. The trust-state-
machine arc (separate plan) will sweep the remaining consumers with a
shared composable (`useIdentityScopedFetch`) when that arc lands.

## What shipped

`packages/extension/src/popup/pages/send.vue`:

- New `refetchIdentityScopedState` function that fetches tokens +
  tokenBalances + contacts in parallel via `Promise.all`.
- New `identityFetchSeq` sequence counter that guards against stale-
  resolve races: each call increments `identityFetchSeq`; only the
  latest call's resolve writes to the refs. Closes the codex H-7
  finding from v3 (older fetch resolving last and overwriting the
  newer identity's data).
- New `watch(() => [appStore.profile?.id, appStore.network?.id,
  appStore.account?.address], () => refetchIdentityScopedState(),
  { immediate: false })`. The granular .id/.address read pattern
  matches the P8 triple-watcher: a profile-rename that swaps the
  parent reference but keeps `.id` won't spuriously refire.
- Empty triple (all three missing) → clears all three refs to empty
  arrays + early-returns (matches the existing onMounted shape).
- onMounted still does the initial fetch directly (not via the new
  function) so the existing semantics around `cacheStore.activeTokenIdx`
  + `awaitingNewToken` initialization stay intact. The new watcher
  only fires on SUBSEQUENT changes.

## Tests

No new tests in v2. Manual repro in P13 manual QA matrix:
- Unlock profile A. Verify Send shows A's tokens.
- Lock + log into profile B (different tokens).
- Click Send. Verify B's tokens populate IMMEDIATELY (no token-detail-
  click required).

Component test for the watcher is deferred — send.vue has 5+ service
clients + Pinia + router; mounting it under vitest would need the
same fixture mass as PopupManager.test.ts. P12 backfills test pins for
the simpler glue paths; send.vue's identity-scoped refetch is
exercised end-to-end via P13 manual QA.

## Files

- `packages/extension/src/popup/pages/send.vue` (+35 lines).

## Open items

- Apply the same watcher pattern to the deferred consumers
  (activity.vue + RecentActivityView + 3-4 others) in the
  trust-state-machine follow-up arc.
- Extract `useIdentityScopedFetch(fetch, initial)` composable once
  ≥3 consumers need the pattern.
