# Phase 3 · A trust write lands only in its session and incarnation (A3)

## The harness

- The scenario profile stub now carries a real `ProfileDeletionState` and a session serial:
  `lock()` ends the session, `unlock(id)` (a switch included) opens a new serial,
  `beginDeletion(id)` bumps the epoch and closes that profile's session, `releaseDeletion(id)`
  drops only the reservation. `captureExecutionFence` throws "Wallet locked" with no session or a
  reserved id; `isFenceLive` compares serial, profile and epoch, as `profile/service.ts:521-555`.
  `getActiveProfile` follows the same session, so an add on `p1` emitted after a switch to `p2`
  reaches `p2` on the unfixed code, which is the bug, not an artifact of the stub.
- Parking points are awaits the fake has: the steered tip reader, `getTokensRaw`, `getRecord` and
  the repo's `clearProfile`. The watchdog cases use fake timers from before the lock is taken.

## Red, on the unfixed service (`b172f0ca`, identical to `624117cd` for these files)

`bun --bun vitest run src/wallet/services/incoming-transfer/service.scenarios.test.ts
src/wallet/services/token/service.test.ts` from `apps/extension`: exit 1, 18 failed, 207 passed.
Every new case failed on its write, never on the harness:

- Queued behind the cascade's clear, then the deletion began: `[true, true]`, not `[false, false]`.
- Called after the deletion began: Allow `true`.
- Tip read spanning the deletion, and the same with a same-id re-import unlocked: `true`.
- A switch, and a lock, during the tip read: `true`.
- Allow and Reject in the registration read through a switch and through a lock (4 cases): `true`.
- Allow and Reject displaced by the watchdog in the registration read, a successor clear done: `true`.
- Successor Reject: the displaced Allow resumed and returned `true`.
- The (BUG PIN): the displaced Allow kept un-hiding and returned `true`.
- Token add after a switch to `p2`: states `['pending', 'trusted']`, `p2` auto-trusted.
- Token add whose tip read spans the deletion: a `trusted` row with a pending floor came back.
- Already trusted, session moved in the registration read: floor `100`, not `40`.
- `token/service.test.ts`, the add released by the token lock's watchdog in its last
  `isNetworkLive`, then a deletion and a same-id restore: it resolved with the token (emitted, row
  kept). "No trust row" follows from no emit, since only the emit reaches the auto-trust handler.

The pin "a lock while an Allow un-hides still lands its floor and every un-hide" passed, as it
must: the follow-through reads the lock and the incarnation, not the session.

## Green

- The change as § A3. Two shapes the plan did not name:
  - The lock section of `setTrustAllow` scored 20 against the cognitive budget of 15 once the
    fenced returns were in, so its un-hide loop, with its new `kept()` check, moved into
    `unhideLocked(records, kept)`; no suppression.
  - `moveArrivalFloorLocked` resolves `false` when its `isCurrent` (now `kept`) refuses, so
    `setTrustAllow` returns `false` on a refused floor too; the token add ignores the result.
- The token add resolves its network with `getNetworksRaw(token.profileId, token.chainId)`, as
  `onTokenDeleted` does, so every read and write in the handler uses the payload's profile.
- `send.vue` untouched: `typecheck:all` passes with its handler typed `TokenInfo`, as the plan
  expected for every `TokenInfo` consumer.
- The same two files after the change: exit 0, 225 passed.

## The gate

- `bun --bun vitest run src/wallet/services/incoming-transfer/ src/wallet/services/token/
  src/wallet/services/token-balance/` from `apps/extension`: exit 0, 25 files, 539 passed.
- `bun run lint` exit 0 (the same 29 warnings and 3 infos; complexity baseline OK);
  `bun run typecheck:all` exit 0; `bun run test:all` exit 0 (the extension 7833 passed,
  4 skipped, 8 todo; every other workspace green).
