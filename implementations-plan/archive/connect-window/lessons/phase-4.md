# Phase 4 · Establishment shows the check in that window

## Red first (`session-established.ts` as on `85c4d20f`, P3 in place)

`bun --bun vitest run` over the two files: exit 1, 12 failed / 32 passed.

- `session-established.test.ts`: 27 tests, 6 failed, all new. A standby slot was refused by
  `markInFlight` (session terminated, nothing navigated); a failed navigation, a window closed
  while it navigates and a session ended during it never reached `navigate`; a window closed while
  the hash write waited left its marker deleted, not tombstoned; a cancelled marker on a trusted row
  established. The 21 existing B-06, B-13, placement and profile-binding cases stayed green: the
  marker-less reconnect still creates its own window, the stale marker still terminates.
- `background.connect-window.test.ts`: 17 tests, 6 failed. No navigation for the approved
  connection, the two origins or the twin's sibling; the held failed navigation never started; after
  abandonment (expiry, and a closed window) the second late establishment of the id rode the
  sibling's "Always trust" as a reconnect (`["f1"]`, expected `["f1", "f1"]`).
- Green before the build: "the window closed after the approval terminates on establishment and
  keeps the row". P3's wiring releases the slot on the removal, and the existing
  "verify window has no reserved slot" fail-closed terminates. It stays as a pin of that path.

## Build

- `verifyWindowUrl(dappSessionId, verificationHash, isReconnect)`, exported, builds both URLs.
- `showVerifyWindow` claims the standby window (`claimStandby`) and loads the check there, or opens
  a window as today. Claiming in the dispatcher leaves no unreachable "not claimable" branch: a
  reservation that is not standby goes to `openVerifyWindow`, whose `markInFlight` refuses a closing
  or released slot.
- `showVerifyInConnectWindow`: the navigation's rejection becomes a boolean before anything can log
  it, the window is adopted either way, then closed on a failure or an abort with a fixed error
  (`verify window could not be shown`); a best-effort `update({ focused: true })`, not awaited.
- The first check is `isPendingVerificationDead`; `finally` settles the marker through
  `consumePendingVerification` (delete unless a tombstone) before `releaseIfUnstarted`, whose hook
  would otherwise tombstone a marker this handler consumed.
- The complexity budget: the dead-marker branch and the tombstone-keeping `finally` took the
  handler to 17. The log line uses one wording ("an abandoned or stale approval") and the
  delete-unless-tombstone test moved into `consumePendingVerification` (one unit test, written with
  the helper during that refactor; the behavior was already red above). Back to the budget, no
  suppression.
- TSDoc: two invariants (the grid from this session's hash in the URL; no dispatch before a `true`),
  no history, no "unverified".

## Considered and left

- A removal in flight when establishment runs: an expiry puts a standby slot in `closing` and the
  tombstone lands only when the removal arrives. An establishment in that gap terminates (the slot
  is not claimable) and consumes the fresh marker, so a later retry of the id reads as a reconnect.
  Reaching it needs a key exchange completing within the milliseconds between the close and its
  `onRemoved`, 65 s after the discovery, and then a retry of the same id on a row the person marked
  trusted from another connection. Not a realistic path; recorded for the review.
- A B-13 early return (no row, profile skew, the session died) on a standby slot consumes the marker
  as today, and the release closes the window. A retry of that id is a reconnect, as today.

## Gate

- `bun --bun vitest run src/wallet/services/wallet-sdk/`: exit 0, 22 files, 241 passed.
- Regression beyond the gate: `bun --bun vitest run src/wallet/services/dapp-interaction/
  src/wallet/services/window-manager/ src/popup/windows/`: exit 0, 33 files, 444 passed.
- `bun run typecheck:all`: exit 0.
- `bun run lint`: exit 0 after the formatter and the complexity refactor above. 29 warnings and 3
  infos, pre-existing.
