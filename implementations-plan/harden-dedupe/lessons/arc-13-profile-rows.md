# Arc 13, profile-rows: lessons log

## Plan

- **A seeded RNG makes row bytes pinnable.**
  - Every random draw on the profile row paths goes through `globalThis.crypto.getRandomValues` at call time.
  - A counter-filled spy, reset before `makeService()`, makes every persisted row byte-identical across runs, envelope MAC included.
  - The vectors were stable across an isolated `-t` run and two full-file runs. A scratch probe showed this before the plan was written.
- **Plan audit:**
  - Codex: REVISE.
  - Opus: REVISE.
  - Both confirmed the design. All eleven findings were adopted; see the batch plan's Decisions.
  - The load-bearing one is Opus's: a bare `return` of the tail helper inside a `try` lets the caller's `finally` zero the master and DEK before the open copies them.
- **Ask 3 was split** between the two legs. The call was to include `session-manager.ts`'s envelope projection as commit 2d, gated on a mutant proving that the existing bearer-restore test sees drift. It does: 7 failures, including `(e) SW-restart silent restore`.

## Build

- **Phase 1 passed on the unchanged code.** It added 23 cases to `service.integration.test.ts`:
  - eight row vectors;
  - four MAC-oracle checks, folded into the password vector cases;
  - twelve tail cases;
  - four stash pins.
- **Phase 2 changed no test file.** `git diff --stat` between the Phase 1 commit and the head lists only `service.ts`, `session-manager.ts`, `profile-row.ts` and `expiring-stash.ts`.
- **TS2729:** instance-field initializers that read a static declared later fail typecheck. The static and its doc moved above the stash fields; the runtime value is unchanged.
- **Mutation checks:**
  - Applied by a scratch script that restores each file from memory, never with git.
  - All 19 mutants went red; the plan's table lists each one with its failing tests.
  - A slot swap inside `macEnvelopeV3` passes every round-trip test, because compute and verify share the projection. The literal vectors and the independent oracle both catch it; the vector assertion fails first. That is the case for checks that are independent of production code.
- **Scoped duplication:** `scoped-dup.sh` gives 204 clones / 3,576 lines at `7450928c` and 204 clones / 3,561 lines at the head.
- **Local gates at the Phase 2 head:** `lint`, `typecheck:all`, `test:all`, `test:ci-gating` and `audit:vue` all exit 0. The tree is clean after the build, so the generated declaration files are unchanged.

## Code review round 1: CONVERGED

- **Codex (GPT-6 Astra, xhigh): no blocker, no should-fix.** It confirmed:
  - the six constructor bindings, P4's mutation, key order, key presence, the random-draw sequence and the brands;
  - the verify fold and the `session-manager.ts` projection;
  - the tails, the emits and the wipe order. The extra async frame adds no suspension between the open and the degraded emit, and the RPC reply still follows cleanup.
  - `ExpiringStash`;
  - the per-case re-seeding, and the healthy twins matching the independently unsealed DEK.
- **Three nits, all adopted:**
  1. The slot-swap note now credits the oracle too. Only the round-trip tests miss the swap; the vector assertion simply fails first.
  2. The restore-commit comment no longer claims `plainSecret` is branded only there. The "P4 rider Medium" review tag is gone.
  3. The plan now says every wipe keeps its position relative to the lock release. Password unlock's wipes, and passkey unlock's master wipe, run after `runExclusive` returns, as on base.
- **Restack** onto `harden-dedupe` at `0a9e48f9`, after arcs 6, 8 and 4 landed:
  - `git rebase --onto origin/harden-dedupe 7450928c` applied all ten commits without conflict; `range-diff` shows every patch `=`, and every commit is signed `G`.
  - The landed arcs touched no profile file, `bun.lock` or `package.json`.
  - At the new head, `lint`, `typecheck:all`, `test:all`, `test:ci-gating` and `audit:vue` all exit 0, the profile suite passes 308 of 308, and the tree is clean after the build.
