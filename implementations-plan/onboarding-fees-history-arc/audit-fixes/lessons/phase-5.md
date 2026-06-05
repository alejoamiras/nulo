# P5 lessons — AccountService lifecycle subscriptions

## Outcome

`fix(incoming): scan new accounts + tear down deleted account schedulers` —
typecheck clean, no test regressions. Closes codex post-impl audit **C3**.

## The bug

`IncomingTransferService` subscribed to token + profile + chain lifecycle events but
NOT to account lifecycle. Symptoms:

- **New account**: stays unscanned until the user adds a new token (which triggers
  `onTokenAdded → hydrateSchedulers` for that account too) or the SW restarts (init
  re-hydrates from scratch). First-receive prompts for new accounts deferred until
  one of those.
- **Deleted account**: scheduler keeps running its interval, polling PXE for an account
  the user has removed. Wasted calls + privacy footgun (PXE keeps querying for the
  deleted key set).

## What shipped

`packages/extension/src/wallet/services/incoming-transfer/service.ts`:

- `init`: subscribe to `accountService.onAccountAdded` + `onAccountDeleted`.
  `onAccountUpdated` intentionally skipped — `Account.address` is derivation-bound
  (`profileId + chainId + index + type`); a name/visibility flip can't change scheduling.
- `onAccountAdded`: call `hydrateSchedulers()`. Account adds are user-driven (rare); the
  cost is one tokens-by-profile read + one accounts-per-network read. Cheaper than
  open-coding scheduler bookkeeping, and converges on the same end state as a fresh init.
- `onAccountDeleted`: targeted tear-down per `(network.id, account.address)` scheduler key
  across every network sharing the deleted account's chainId. `clearInterval` + `Map.delete`
  on both `schedulers` and `watchedContracts`. Falls back gracefully if
  `networkService.getNetworks(chainId)` throws.

## Account events: shape verified

`Account` type from `wallet/services/account/spec.ts`:
- `profileId`, `chainId`, `address`, `index`, `type`, `name`, `visible`.
- `AccountService` emits `onAccountAdded`, `onAccountUpdated`, `onAccountDeleted` with
  `Account` payloads.

## Tests — deferred to P8

P8 backfill will add:
- `onAccountAdded` event triggers a `hydrateSchedulers` call → assert via the test fixture
  that the new account gets a scheduler entry in `schedulers` map.
- `onAccountDeleted` event clears the scheduler for that account → assert
  `schedulers.has(key) === false` after the event.
- `getNetworks(chainId)` throw on `onAccountDeleted` → no crash + scheduler unchanged.

Same fixture as the P4 service-side tests, reused.

## Files

- `packages/extension/src/wallet/services/incoming-transfer/service.ts` (2 subscriptions
  in `init` + 2 handlers).

## Open items

- P8 — add the three account-lifecycle test cases.
