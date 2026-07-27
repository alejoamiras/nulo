# Lessons — Phases 2a, 2b, 3, 4

## Phase 2a — durable sequencing

**The watermark needed a third number, not two.** Allocation and "highest contiguous settled" are both required, but
an allocation whose write fails would pin the watermark below every later record forever. The fix is an explicit
`abandon` that fills the hole with the same bookkeeping as `settle`, plus a `settled` set for completions that
arrive out of order. Without it, one failed write silently freezes every snapshot for that `(scope, source)`.

## Phase 3 — slices

**A `computed` that re-evaluates to the same object does not notify its dependents.** The slice store originally
mutated slices in place and called `triggerRef`. That works only for readers who had not read yet: Vue's
value-equality check on `activeSlice` sees the identical object and stops propagation, so anyone who read the feed
before the mutation stays stale forever. Copy-on-write (`{...slice, transactions: [...]}`) fixes it.

The store's own 15 tests all passed with the bug present, because each mutated *before* reading. `app.store`'s
existing suite caught it — it asserts an empty feed, then adds a row. A regression test now encodes exactly that
order.

**Deriving a scope must be all-or-nothing.** The `activeScope` computed originally required profile + network +
account but not a well-formed network id, so a test stub with `{chainId: 1}` and no `id` produced a scope whose
key threw inside a `flush: "sync"` watcher — surfacing as "Unhandled error during execution of watcher callback"
across 13 unrelated component tests. Any half-resolved scope must resolve to `null`, not a partial key.

**Delegating a store's state means finding every mutation site.** `transactions`/`awaitingTransactions` became
computeds, so `push`/`splice`/assignment from `send.vue`, `RecentActivityView` and `reset.vue` had to move to
actions. Typecheck found all of them, which is the argument for making the delegated properties readonly rather
than proxying writes.

## Phase 4 — the guard

**The guard attaches to the only switch a user can make mid-send.** There is no in-session profile switcher:
reaching another profile goes through lock → auth → unlock, and lock must never be blocked (it is a security
action). So the account switch is the guarded intent, and the lock-then-fast-unlock-into-another-profile race is
documented as a known residual in plan §9.6 rather than papered over — closing it needs either cancel-at-lock or
the captured-scope machinery this arc deliberately dropped.

**Extracting a shared rule is only safe with the old behavior pinned first.** The dispatcher's account resolution
moved into `resolveAuthorizedSessionAccount`, consumed by both the dispatcher and the queued journal. The Phase-0
pins (four tests through the real dispatcher) are what make that extraction verifiable rather than hopeful —
they passed unchanged before and after, so the refactor provably preserved behavior while fixing the journal.

**Inverting a characterization pin is the proof the fix landed.** All four pins (two journal races, two queued
account derivations) were rewritten to assert the opposite of what they originally captured. Each rewrite is a
diff a reviewer can read as "this is what changed", which a fresh assertion would not be.

**A serialized race needs a different test shape.** Once delete and transition share a lock, the original
interleaving test deadlocks: it holds a gated write while the competing call waits for that same lock. The
rewritten tests start the competing call, release the gate, then await both — asserting the serialized outcome
instead of the interleaved one.

## Phase 6 — security audit

**Cross-model review caught a bug I introduced *while fixing that exact class of bug*.** The shared account
resolver exists so the journal and the dispatcher pick the same account. I then called it with
`getAccounts(profileId, chainId, true)` — `all=true`, which includes hidden accounts — while the dispatcher calls
it without that flag. A hidden lower-index account would win the default on one side and not the other: the same
divergence, reintroduced through a different parameter. Sharing a function is not sharing a rule; the INPUTS have
to match too.

**My own change made a pre-existing weakness reachable.** The legacy-row fallback (attribute an unscoped
transaction by address + chain) was defensible while two same-mnemonic profiles could not coexist — the account
re-key is what made them able to. A fix in one layer can promote a dormant issue in another to a live one; audit
the diff for what it *enables*, not only what it changes.

**An obsolete test is a signal, not an obstacle.** `import-paths.test.ts` asserted that importing a backup whose
account collides on address is REFUSED. That is precisely the behavior the re-key removes, so the failure was the
change working. Flipped to assert the new behavior (both profiles coexist, each owning its own row) rather than
deleted — the diff now records the product change.

**Report the gate, not the wrapper.** A monitor wrapping the smoke suite exited 0 while the suite itself exited 1
(3 failed). Read the suite's own summary line before calling a gate green.
