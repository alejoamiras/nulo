# Post-implementation — /code-review + codex fix loop

## Self-review found one gap the phase gates could not

Reading my own diff against the plan surfaced that `onTokenDeleted` removed the token from
the map synchronously (correct) but its **purge loop never went under the lock**, which the
plan required. Every test still passed, because none exercised a deletion racing a creation.
That is the case for keeping the review step separate from the gates: gates prove what the
tests assert, a read against the spec proves what the tests forgot.

## Codex round 1 — the High I had shipped

**Live handlers serialized allocation but not pair existence.** Both called
`createTokenBalanceHoldingLock` unconditionally, so a sweep holding the lock while awaiting
`repo.getAll` could create a pair, and a handler queued behind it would then create the SAME
pair under a different id — duplicate rows, duplicate cards.

This was also a faithfulness failure: the approved plan said *one idempotent ensure path for
all four callers*, and I had written the handlers as direct create loops. Fixed with
`ensurePairsHoldingLock(pairs, gen, existing?)` — the existence check now happens inside the
same hold as the write, and the sweep passes the rows it already read so the steady state is
still one full-namespace read.

Codex also caught that the e2e's headline claim was weaker than advertised: `auth.vue` calls
`refreshBalances` on unlock, so `maxRefreshes: 0` silences only the helper, never isolating
the sweep's own enqueue. The e2e now states what it actually proves; a service-level
`createNewTask` spy pins the enqueue.

## Codex round 2 — my regression test was theatre

The same-pair test started with the pair **already created** by the boot sweep, so both
handlers took the already-exists skip path and the race window was never entered.

Why I believed it: removing the existence check entirely *did* make it fail. But the
mutation that matters is subtler — moving the check *outside* the hold — and the old test
passed that. After the fix (`getAccountsRaw` returns `[]` so the boot sweep creates nothing,
plus an assertion that allocation happens exactly once) the outside-the-hold mutation fails
with `expected [...] to have a length of 1 but got 2`.

**The lesson: "verified red" is only as strong as the mutation you chose.** Deleting a check
proves the check runs; relocating it proves the check is in the right place. For a
concurrency invariant, the second is the one that counts.

Codex also corrected a comment of mine that was simply wrong: I had claimed a future
`onTokenBalance*` subscriber calling back in would deadlock the non-reentrant lock. It would
not — `EventHandler.invoke` does not await subscribers, so it would queue behind the hold.

## Round 3 — converged

"No production or test-behavior issue found"; one comment whose snapshot ordering I had
backwards. Applied.

## Final state

lint 0 · typecheck clean · `src/wallet/services/` 1829 passed · token-balance 23/23.
