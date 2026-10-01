# Phase 2 — composition: the real graph, a real session end, the races

## What landed

All eleven cases live in `apps/extension/src/wallet/services/execution/service.composition.test.ts`,
in the describe "work runs only while the session that authorized it lives". They drive the real
`ExecutionService` → coordinator → lane graph and the real `OperationJournalService`.

| Plan case | Test |
|---|---|
| 1, 2 | `test.each` over a switch and a lock: a dApp send parked at its slot-key `getNetwork` returns `SESSION_ENDED`, the record is `failed/session_ended` under `p1`, `proveTx` is never called |
| 3, 4, 5 | `test.each` over a switch, a lock and a same-profile re-unlock: a transfer parked at the proof gate throws `SessionEndedError`; `proveTx` once, `toTx` and `sendTx` never; `failed/session_ended` under `p1` |
| 6 | `p2` also holds the address; the transfer still throws `SessionEndedError` and the only account lookup ran under `p1` |
| 7 | `executeSendTransaction` with no fence captures at entry, then a switch while parked refuses it as case 1 |
| 8 | An operation estimate stashed under `p1` and confirmed under `p2` fails `SESSION_ENDED` with no account lookup and no prove; the transfer cache case does the same |
| 9 | A silent send whose record is `pending` fails `session_ended` at the slot, with no `getNetwork`, and the slot is grantable afterwards |
| 10 | A cancel whose journal write is parked holds the transition lock; the `submitting` transition queues behind it; on release the send throws `JobCancelledError`, the record is `cancelled`, `submitting` never lands, `sendTx` is never called |
| 11 | A lock while `node.sendTx` is pending does not undo the send: `0xhash` returns and the record is `succeeded` |

## Harness additions

- **Session fake.** `session.setActive(id | undefined)` starts a new serial and drives
  `getActiveProfile`, `captureExecutionFence`, `assertFence`, `isFenceLive` and `peekLiveSerial`.
  `session.fireChanged()` invokes `onActiveProfileChanged` separately, so checkpoint cases run
  without the change subscribers. `assertFence` throws `SessionEndedError` on a serial or profile
  mismatch before the deletion-epoch check.
- **Journal write parking.** `parkJournalWrite(match)` spies `storage.local.set` on the
  `FakeBrowserApi` and holds the first `nulo:journal@` write whose record matches.
- **Account fake.** `getAccountContract` is a spy that resolves only for profiles in
  `accountOwners`, so a lookup under the wrong profile fails loudly and case 6 can add `p2`.
- **Exposed handles.** `proveTx`, `getNetwork`, `getAccountContract`, the lane and the helpers
  `transfer`, `dappSend`, `parkNextNetworkLookup` and `expectEndedUnder`.

## Decisions and deviations

1. **The dApp cases park at `getNetwork`, which is the slot-key lookup.** `acquireSlot` asserts the
   fence before the lookup, so the switch lands after that assert. The refusal comes from the claim's
   `registerInFlight` and the build's `assertFence`, which is the point of parking there.
2. **The seeded transfer `txRequest` gained `gasLimits`, `teardownGasLimits` and `maxFeesPerGas`.**
   Case 11 is the first composition case to reach `node.sendTx` on the transfer path, and the
   success path reads those fields. They are seeded data, not a built request, so D3 holds.
3. **Case 8 computes the operation fingerprint through the real planner and
   `fingerprintOperation`.** The fingerprint is a length-prefixed, type-tagged string encoding with
   no Barretenberg import. The payload has no calls, capsules, authwits or hashed args, so it reaches
   none of the planner's `@aztec/stdlib` schema parses, and D6 holds. A hand-written fingerprint
   would miss the cache and test that miss instead of the cross-profile refusal.
4. **Case 8's records file under `p2`.** The confirm captures its fence after the switch, so the
   journal row belongs to the confirming session. The refusal is the stash's profile against that
   fence.
5. **Case 10 depends on the cancel's abort running before the refused `submitting` transition
   returns.** `cancelJob` transitions first and aborts second. Once the parked write releases, both
   sides are microtask chains: the cancel leaves the lock and aborts, while the queued `submitting`
   transition takes the lock, loads the record and is refused, and `markJournal` swallows the
   refusal. The abort's chain is the shorter one under the fake storage, so the cancel check before
   the send throws; the case passed 10 of 10 repeated runs. In Chrome the load is a storage round
   trip that resolves on a later task, which only widens that gap. The cancel check is untouched.
6. **The two gas-cache tests call `h.session.fireChanged()` instead of `profileChanged.invoke(undefined)`.**
   The subscriber ignores the payload and evicts on any event, so their subject is unchanged. Firing
   the live profile keeps a later sweep subscriber a no-op in those tests.

## Mutation checks

| Mutation | Result |
|---|---|
| Removed the coordinator's `await ctx.assertAuthorization()` | cases 3, 4 and 5 failed |
| Made the operation cache's cross-profile branch a plain miss instead of `SessionEndedError` | case 8 (operation) failed |

Both sources were restored from copies; `git status` showed only the test file modified.

## COMPOSITION-TESTS rules

- **D1.** The inline PXE fake still has only `proveTx`, checked for calls only.
- **D2.** No assertion reads a prove or simulate result.
- **D3.** No `TxExecutionRequest` is built and no account contract is derived; the reuse fast path
  and a hardcoded `{ address }` stand in.
- **D4.** No note, sync, fee or node-response state was added to the PXE fake.
- **D5.** The fakes return shapes only.
- **D6.** A grep of the file for `TxExecutionRequest`, `@aztec/bb`, `@aztec/accounts`, address
  derivation and instance derivation found nothing.

## Validation gate

| Command | Result |
|---|---|
| `cd apps/extension && bun --bun vitest run src/wallet/services/execution/service.composition.test.ts src/wallet/services/execution` | exit 0: 45 files passed, 1 skipped; 621 tests passed, 7 todo |
| `bun run typecheck:all && bun run lint` | exit 0; 30 warnings, all pre-existing elsewhere; complexity-baseline check OK |

The first run of case 11 failed with `TypeError` on `gasSettings.gasLimits.daGas`, which decision 2
fixed.
