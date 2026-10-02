# Phase 4 — network e2e

## The spec

`tests/e2e/network/balance-row-reconciliation.test.ts` uses `tokenReadyExtension` (a wallet
with 1000 minted TST, imported and projected), then:

1. asserts the card renders — the precondition is real, not assumed;
2. deletes every `nulo:core:token-balances@*` key and proves zero remain;
3. kills the worker via the newly-extracted `stopServiceWorker`;
4. reopens the popup, **unlocks**, and requires the row back with a real projection.

## Two false-passes closed, both from the codex audit

- **`maxRefreshes: 0`** on `waitForFreshBalanceRow`. The helper re-kicks
  `refreshBalances` on a cadence by default, so without this the assertion would prove an
  explicit refresh rather than the boot enqueue — i.e. it would pass even if the sweep never
  re-queued anything.
- **Popup reopened before the card assertion.** `TokensView` does not refetch on the balance
  client's reconnect, so an already-open popup keeps rendering its pre-deletion card.

Plus an assertion that exactly **one** row exists afterwards — the sweep must repair, not
duplicate.

## What the first run taught

It failed at `waitForHash(reopened, "#/popup/general")`: killing the worker drops the
session, so the popup lands on `#/popup/auth`. Added the unlock that
`sw-restart-network.test.ts:103-113` uses.

That improved the coverage rather than just fixing the test — unlocking fires
`onActiveProfileChanged`, so the spec now exercises **both** sweep call sites (init's and
the profile-switch one) instead of only init's.

## Red/green proof

```
GREEN (both sweeps present):   Test Files 1 passed   EXIT=0
RED   (both sweeps disabled):  TimeoutError: Waiting failed: 60000ms exceeded
                               ❯ balance-row-reconciliation.test.ts:72  (waitForFreshBalanceRow)
```

Line 72 is the recovery assertion — the row never returns without the sweep.

## A property worth knowing about the red run

The red run's stack also showed a failure at line 39 (the *precondition* card assertion) on
a later retry. `tokenReadyExtension` is file-scoped and this spec mutates it, so a retry
runs against a wallet whose rows the previous attempt deleted.

This is self-correcting on the green path — the sweep restores those rows before the retry
begins — and only cascades when the sweep is broken, where failing is the correct outcome.
Documented in the spec rather than engineered around.

## Drive-by

`stopServiceWorker` had **eight** near-identical local definitions across the e2e tree. It
is now exported from `tests/e2e/fixtures/helpers.ts` — this spec uses the shared one rather
than becoming the ninth copy. The existing eight are left in place; consolidating them is a
separate, mechanical change.

## Validation gate — PASS

```
NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/balance-row-reconciliation.test.ts
  → Test Files 1 passed (1)   EXIT=0
  → documented RED without the sweeps
```
