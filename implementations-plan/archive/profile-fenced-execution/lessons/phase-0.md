# Phase 0 — the error, the serial, the two checks

## What landed

- `SessionEndedError` (`SESSION_ENDED`) in `@nulo/extension-messaging/errors`, reconstructed by
  `walletErrorFromPayload`; `session_ended` in `KnownJobErrorKind` and its mirror; the dApp
  envelope maps the class to `{ code: 4900, data: { walletErrorCode: "SESSION_ENDED" } }`.
- `ExecutionFence.session`; `ActiveSession.serial` allocated from `SessionManager.lastSerial`
  inside `open`'s artifact section (in the published object, before `onChange`) and at `restore`;
  `peekLiveSerial()`.
- `ProfileService.captureExecutionFence` carries the serial; `assertFence` (facade lock, reads the
  manager directly) and `isFenceLive` (synchronous).

## Deviations from the plan text (tightenings, no scope change)

1. **`SessionEndedError` takes no constructor arguments.** The plan asks for a detail-free,
   constant-message class. With no parameters nothing can be interpolated at a throw site, and
   reconstruction ignores the wire message, so a message-only payload always rebuilds the constant
   (pinned in `errors.test.ts`).
2. **`assertFence` and `isFenceLive` also compare the profile id.** The plan reasons that serial
   equality implies the profile, which holds for fences produced by `captureExecutionFence`. But
   `executeOperations`' `authorizedFence` is documented as "NOT structurally unreachable over the
   wire" (Fact 2), so a caller-supplied fence pairing a live serial with another profile id is
   conceivable. One extra comparison makes it never pass (pinned: the forged-fence case).
3. **`isFenceLive` also refuses a begun deletion** (`deletionState.isCurrent`). `deleteProfile`
   calls `beginDeletion`, then awaits the tombstone write and the row delete, and only then closes
   the session. A session-only synchronous check would let a broadcast through in that window;
   today `addTransaction` then refuses to record it (D13), leaving an unrecorded on-chain tx for a
   profile being erased. The awaited `assertFence` keeps the existing epoch error class.

## Owner-visible text

`SessionEndedError.MESSAGE` = "The wallet session that approved this request has ended." It is
dApp-facing API text in the 4900 envelope, not popup copy: the Activity card renders the signed-off
subtitle from the job kind (Phase 5), and the popup is on the lock screen whenever a session ends.

## Fixture edits (type-only)

`ExecutionFence` gained a required field, so fence literals in `token/service.test.ts`,
`transaction/service.test.ts` and `execution-lane.test.ts` gained `session: 1`. No assertion
changed.

## Validation gate

| Command | Result |
|---|---|
| `cd packages/extension-messaging && bun --bun vitest run` | 12 files, 222 tests passed |
| `cd packages/wallet-core && bun --bun vitest run src/jobs` | 3 files, 15 tests passed |
| `cd apps/extension && bun --bun vitest run src/wallet/services/wallet-sdk/error-envelope.test.ts src/wallet/services/profile` | 13 files, 282 tests passed |
| `bun run typecheck:all` | exit 0 (first run found five fence fixtures missing `session`; fixed) |
| `bun run lint` | exit 0; `biome check` on the 14 touched files clean |

New tests: four serial-publication cases in `session-manager.test.ts` (fresh serial per open and
re-unlock, degraded success keeps its serial, rolled-back publication burns its serial and never
reuses it, restore publishes one); four facade cases in `service.integration.test.ts` (lock and
same-profile re-unlock, another profile plus the forged fence, deletion keeps its epoch error, a
capture queued behind a rolled-back publication never obtains it); the envelope mapping; the error
round-trip and identity sweep.
