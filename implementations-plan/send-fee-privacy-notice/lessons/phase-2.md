# Phase 2 — the card's selection

- **Mutation-checked, and one hole found.** Two deliberate breaks were run against the new suite:
  1. FPC delete patches `registeredFpcs` instead of the overlay → 5 tests red (between-legs, recovery
     recommit, both A→B→A cases, event-before-first-fetch). Good.
  2. The live-identity guard removed from `sendSelection` → **0 tests red.** The end state is the same
     either way because the identity watcher closes the gate; the difference is one tick, in which
     `derivedSettings`' watcher (declared before the identity watcher) would emit settings for account
     B computed from account A's balances. Added "account A's balances never produce settings for
     account B, not even for the tick of the switch" — red on the mutant, green on the code.
- **Reader regression proven red first.** With the re-entry reverted to `false`, the new
  `gas-balance-reader.test.ts` case fails `Expected "55" / Received "0"`; with the fix it passes and
  the view layer is called 4 times (two computations × two legs).
- **Hold copy on a public origin.** The approved line talks about *private* gas, so it is used only
  under a private origin. A public-origin hold with a healthy store (a structurally unread balance,
  no sponsor) reuses the existing "Couldn't load fee data — retrying in the background." — no new copy
  was invented. Rare: it needs an unread balance, no sponsor, and a non-degraded store at once.
- **`reset.vue` does not `await` the clear.** Its sibling legacy remove is fire-and-forget, and an
  awaited storage failure would abort the reset half-way. It rides the writer's chain (that was the
  point) and logs on failure.
- **Observed, not changed:** a forced success resets the home gas card's optimistic-deduction overlay
  (`forcedVersion`). Send and Home are different routes, so the two are not co-mounted in practice;
  the co-mount test pins that a Send card on hold issues no read beyond its mount read.
- `needsFeeJuice` is never emitted when it stays `false` (a `defineModel` default), so the test helper
  reads "never emitted" as `false`.
- Gate: lint 0 · typecheck 0 · 842/842 over the gate's 70 files · `git diff -U0 b0ebbb40 -- <the two
  pre-existing test files> | grep '^-[^-]'` printed nothing.
