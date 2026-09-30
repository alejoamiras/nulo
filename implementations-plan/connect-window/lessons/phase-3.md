# Phase 3 · Allow hands the window to the connection

## Red first (the P3 production files as on `85c4d20f`, P2's gate in place)

`bun --bun vitest run` over the five gate files: exit 1, 15 failed / 98 passed.

- `window-manager.test.ts`: 2 failed (`manager.handOver is not a function`).
- `dapp-interaction/service.test.ts`: 2 failed. The approval resolved with the page's object
  (`{ approved: true, windowId: 999 }`, not the handle's 1000); `{ approved: "yes" }` passed
  through as given. Green before and after (pins): a denial settles and closes; a capability
  window and an execute window answered through `resolveInteraction` settle with that answer and
  close.
- `discovery-approval.test.ts`: 1 failed (no recheck: an abandoned attempt still approved). The
  four existing cases gained `attemptOpen: () => true` and stayed green: the expiry rollback pin.
- `background.connect-window.test.ts` (new): 10 of 10 failed. The reservation stayed
  `unstarted`, no exit closed window 41 or 43, a closed standby window freed no slot, and a
  queued third Allow never attached.
- `background.admission.test.ts`: green before and after, with `test-services.ts` keying new
  rows by the metadata's origin.

## Build

- `WindowManager.handOver(handleId, value)`: settles, stops watching, removes nothing. A hand-over
  before the create resolved passes `undefined`, and the arriving window is closed by the existing
  identity fence (pinned by the second new case).
- `DappInteractionService.resolveInteraction`: a discovery (the one payload without a session)
  goes to `settleDiscovery`: `approved === true` hands over with `{ approved: true, windowId }`
  built from the handle; anything else settles `{ approved: false }` and closes. `discover()`
  resolves `DiscoveryOutcome`.
- `approveOrRollbackDiscoverySession`: `attemptOpen()` is read right after `isDiscoveryExpired`,
  with no await before the marker write; either refusal takes the one rollback, logged as
  `expired` or `abandoned`.
- `background.ts`: `state.handedOver` and one `state.closeWindow` (also the gate's hook);
  `runDiscoveryPopup` records the hand-over, attaches the window after admission (a buffered
  removal fails the attach and rejects), and closes an unattached window in `finally`;
  `persistAndApprove` passes `attemptOpen: () => reservation?.abandoned !== true`;
  `tearDownTabAttempts` closes the tab's handed-over windows, cancels its markers' reservations,
  then deletes its markers.
- `test-services.ts`: rows keyed by `metadata.url`; `deleteDappSession` deletes the row; two
  injection points (`activeProfile`, `setCapabilityGrants`).

## Harness notes

- The new file mocks `./discovery-approval` with a call-through `vi.fn`, which hands the test the
  worker's live marker map (`mock.calls[n][0].pendingVerification`), and spies on
  `VerifyAdmissionGate.prototype.admit`, whose `mock.contexts` hold the worker's gate. Both read
  real state; neither replaces behavior.
- The fake window port rejects `remove` of a window it does not hold and delivers every removal
  one microtask later, as `chrome.windows.onRemoved` does. The mocked SDK's `terminateForTab`
  drops the tab's discoveries, so a later `approveDiscovery` for them returns false (Fact 30).
- "An approval that did not land" asserts the closed window and the absent marker, not a
  rejection: the SDK already dropped that request, and today's code rejects nothing there.
- Considered and left as the plan has it: `handedOver` is keyed by the dApp-chosen request id.
  Only the page that minted an id can reuse it, the gate refuses a second live slot for it, and
  the worst an overwrite does is leave one of that page's own waiting windows to close when its
  own attempt settles (at most the 55 s deadline).

## Gate

- `bun --bun vitest run src/wallet/services/window-manager/window-manager.test.ts
  src/wallet/services/dapp-interaction/service.test.ts
  src/wallet/services/wallet-sdk/discovery-approval.test.ts
  src/wallet/services/wallet-sdk/background.connect-window.test.ts
  src/wallet/services/wallet-sdk/background.admission.test.ts`: exit 0, 5 files, 113 passed.
- Regression beyond the gate: `bun --bun vitest run src/wallet/services/wallet-sdk/
  src/wallet/services/dapp-interaction/ src/wallet/services/window-manager/`: exit 0, 29 files,
  346 passed.
- `bun run typecheck:all`: exit 0.
- `bun run lint`: exit 0 after two fixes (a test's `?.` into a cast, flagged
  `noUnsafeOptionalChaining`; one formatter wrap). 29 warnings and 3 infos, pre-existing.
