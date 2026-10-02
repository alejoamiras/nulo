# Phase 3 — the sweeps + numeric key identity

## What landed

- `reconcileBalanceRows(profileId, gen)` called from the tail of `init()` and of
  `onActiveProfileChanged`, both inside the generation fence established in Phase 2.
- **One `getAccountsRaw(profileId)`** — profile-wide, all chains, no visibility parameter.
  Read *count* is the cost model (every entity enumeration deserializes the whole storage
  namespace), and there is no `all: true` boolean left to get wrong.
- Both repair halves: create the missing pair, and **re-enqueue** rows at
  `updatedAt === 0 && syncFailure === undefined` — the window where the worker died after
  `repo.set` and before `enqueue`, which strands the card on "Loading balance…" forever.
- Per-pair `try/catch` so one unwritable row cannot abandon the rest of the repair.
- `Warn` when anything was repaired (it means a previous worker died mid-write), `Debug`
  elapsed-ms on the no-op path.
- **`BalanceRepository` now constructs with `{ requireKeyIdentityMatch: true, keyIdentityMode: "numeric" }`.**

## The generic-types detour

`reconcilePlan` originally took the narrow `ReconcileToken`/`ReconcileAccount`/`ReconcileRow`
shapes, which typechecked in isolation but forced a cast at the call site — the service needs
the full `Token`/`Account`/`TokenBalanceRaw` to write. Making the function generic over
`T extends ReconcileToken` etc. keeps the module pure *and* hands the caller back its own
objects. Narrow-input-types is the right instinct; narrow *output* types were not.

## The stub failure fable predicted, exactly

The moment `init()` started reading accounts, six tests failed with:

```
TypeError: this.accountService.getAccountsRaw is not a function
```

across `token-balance/service.test.ts` and `cross-profile-isolation.test.ts` — the same two
files the fable audit named as E-1, and the same class of failure #485's phase-4 lessons
recorded. Codex's round-3 re-wording of the phase boundary (Phase 2 prepares the ensure path,
Phase 3 adds the sweeps) predicted precisely when it would land: Phase 2's gate was green
because nothing read accounts yet.

## Red-run proof

Disabling the init sweep:

```
× boot sweep creates the row a worker death left missing, and re-queues one it never projected
× a key/id mismatched row is hidden and replaced; its physical bytes survive
  Tests  2 failed | 17 passed (19)
```

Both recovery tests bite. The no-op test and the well-formed-row control correctly stay
green either way — they are guarding cost and non-regression, not the repair.

## Validation gate — PASS

```
bun run lint       → exit 0
bun run typecheck  → clean
bun run --cwd apps/extension test src/wallet/services/
                   → Test Files 130 passed | 2 skipped · Tests 1825 passed
```
