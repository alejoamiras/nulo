# Phase 1 — implementation + review arc

## Implementation notes

- The reaper's per-record-failure resilience test sabotaged `transitionOperation` — which the CAS'd reaper no longer calls; the spy re-targeted to `transitionIfStage`. **Lesson: a test that intercepts a method to inject failure silently stops testing anything when the implementation switches entry points — sweep sabotage-spies when changing a caller's API.**
- The touched-mid-sweep CAS pin initially failed for a subtle reason: `touchOperation`'s `Date.now()` collided with the record's creation millisecond, so the equality CAS saw no movement. Fixed with a real 2 ms separation — the `gc.test.ts` same-tick-collision lesson strikes again.
- My first CAS pins also used `pending`-stage fixtures where the claim transition (`pending→pending`) was ILLEGAL, so the interceptor itself threw and poisoned the intercepted candidate. Queued-stage fixtures (`initialStage: { stage: "queued" }`, dapp_execute + sessionId) are the correct shape.
- Commitlint rejected the implementation commit's subject at >100 chars — silently (files stayed staged, no commit). Check `git log` after any commit whose subject is near the cap.

## Max review — REQUEST-CHANGES, 3 findings, all adopted

1. **Driver (empirically proven): the `failQueuedIfUnclaimed` CAS migration was silently revertible** — the reviewer reverted the hunk and ran 197 tests green. The plan MANDATED this discriminator (final-gate finding 3) and I shipped the fix without its pin. Fix: moved the function to `queued-journal.ts` (unit-importable without dragging background.ts's wallet-sdk import graph) + a pin that stubs the LEGACY read path (`getOperation` → stale queued snapshot) so the racy shape fails while the CAS's lock-held re-read stands down — probed red against a hand-reverted racy implementation. **Lesson: when a plan's ledger mandates a discriminator for an adopted fix, the pin ships IN THE SAME COMMIT as the fix — "the fix is obviously right" is exactly when the vacuity slips through.**
2. My `transitionIfStage` insertion orphaned `refileOperationScope`'s TSDoc (doc block left attached to the wrong method) — relocated. **Lesson: inserting a method between a doc block and its method is a silent doc corruption; check the neighbor below the insertion point.**
3. Zombie heartbeat interval: when lease expiry empties the collections, the trailing in-heartbeat stop is the ONLY stop path — it existed but was unpinned (strip stayed green). Pin added + probed.
- Ratified as-shipped: `cancelJob`'s prune skipped on early returns (bounded by the finally backstop + lease); the reviewer's concurrency/leak/proof-adoption lenses all came back clean, including the RPC-allowlist verification for the new service methods.

## Codex final-diff — SIGN-OFF

No blockers: lease lifecycle composes (ownership migration, cancel pruning, bounded expiry, timer shutdown); `transitionIfStage` discriminants match all three call sites; the decomposed pins preserve c2-1's guarantee while the proof's artificially aged-yet-live state is "correctly no longer constructed"; hostile dApps can't reach the vouching API or choose waiter ids, and the caps + lease bound every growth path. Contingent only on the battery completing green.
