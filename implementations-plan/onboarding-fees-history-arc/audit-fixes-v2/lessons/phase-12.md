# P12 lessons — Test pin backfill

## Outcome

`test(arc-v2): pin onAccountAdded + RecentActivityView connect glue` —
closes the codex Low #2 deferred test gaps from the prior arc.

## What shipped

### 1. `onAccountAdded → hydrateSchedulers` pin

`packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts`
— new test under the existing "account lifecycle (P5 carry)" describe.
Symmetric to the existing `onAccountDeleted` pin:

- Boot the service with an empty accounts list.
- Mutate the account stub's `getAccounts` mock to return a new account.
- Fire `accountService.onAccountAdded.invoke({...})`.
- Assert the scheduler map gains a `(networkId, address)` entry.

Without this pin, a future refactor that drops the
`accountService.onAccountAdded.add(...)` subscription in
`IncomingTransferService.init` would silently regress the
"new account starts scanning immediately" behavior. The prior arc's
post-impl codex audit verbatim: *"those are not benign defers; they
are the exact glue paths that already broke once."*

### 2. `RecentActivityView.connect()` on-mount pin

`packages/extension/src/popup/components/modules/general/RecentActivityView.test.ts`
(NEW file).

The widget mounts on the home tab. It registers
`incomingTransferService.onConnected.add(loadIncomingTransfers)` at
module-top, but `ServiceClient` does NOT auto-connect on listener
registration — an explicit `connect()` in `onMounted` is required for
the onConnected listener to ever fire. The prior arc's P3 added the
explicit connect; this test pins it.

Two assertions:
- `IncomingTransferServiceClient.prototype.connect` called exactly
  once on mount.
- `ConfigServiceClient.prototype.connect` called exactly once on
  mount (sibling explicit-connect path; same pattern).

Mock surface: stubbed the 6 service clients with minimal `vi.fn()`
implementations + the stores via `vi.mock`. `shallow: true` mount
prevents nested-component activation. ~110 lines of fixture; the
test is intentionally narrow (just the connect call).

## Test counts

- `service.scenarios.test.ts`: 23 → 24 tests.
- `RecentActivityView.test.ts`: new, 2 tests.

## Files

- `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts`
  (+1 test in the account lifecycle describe).
- `packages/extension/src/popup/components/modules/general/RecentActivityView.test.ts`
  (NEW file).

## Open items

The third pin codex Low #2 flagged (OFF→ON config replay path) is
already covered by P6's tests in `PopupManager.test.ts`. No additional
work needed.
