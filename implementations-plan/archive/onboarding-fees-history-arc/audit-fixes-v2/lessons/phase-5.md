# P5 lessons — onTransactionAdded per-hash + account filter

## Outcome

`fix(incoming): per-hash reentrancy + account-filter on onTransactionAdded` —
23/23 tests pass in `service.scenarios.test.ts` (+2 new pins). Closes
codex Med #2 from the prior arc's post-impl audit (double-delete) AND
codex/opus C-3 from this arc's first round (account-scope filter).

## What shipped

`packages/extension/src/wallet/services/incoming-transfer/service.ts`:

- **`private readonly txDeleteInflight = new Set<string>()`** keyed
  `${profileId}|${networkId}|${accountAddress}|${txHash}`.
- **`onTransactionAdded`**: enters via `add(guardKey)`, exits via
  `finally { delete(guardKey) }`. If the key is already in the set,
  the handler early-returns. Mirrors the existing `polling` Set's
  shape (verified at service.ts:101).
- **Account filter**: the delete loop now skips records where
  `record.accountAddress !== tx.account`. Closes the legal-but-bad
  scenario where account A's outgoing tx delivers a same-hash note
  to account B in split-fee/sponsored flows. Without the filter,
  A's tx would delete B's record by mistake.

## Tests (+2 new pins)

`packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts`:

- **per-hash reentrancy**: fire two `onTransactionAdded` events with
  same hash back-to-back → exactly one `onIncomingTransferDeleted`
  emit. Without the guard, two listeners observing the same
  `listByTxHash` result before either delete completes would emit
  twice.
- **account filter**: pre-seed records A (account=0xA) + B (account=0xB)
  with the same txHash 0xshared. Fire `onTransactionAdded` with
  `tx.account = 0xA` → only A's record deleted; B's record stays
  grounding. The Delete emit count is exactly 1.

## Files

- `packages/extension/src/wallet/services/incoming-transfer/service.ts`
  (+24 lines, new Set + handler restructure).
- `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts`
  (+2 test cases).

## Open items

None.
