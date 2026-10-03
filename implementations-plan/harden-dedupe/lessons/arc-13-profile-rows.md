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
  - A slot swap inside `macEnvelopeV3` is caught only by the literal vectors. Compute and verify share the projection, so every round-trip test stays green. That is the case for literal vectors over round-trip checks.
- **Scoped duplication:** `scoped-dup.sh` gives 204 clones / 3,576 lines at `7450928c` and 204 clones / 3,561 lines at the head.
- **Local gates at the Phase 2 head:** `lint`, `typecheck:all`, `test:all`, `test:ci-gating` and `audit:vue` all exit 0. The tree is clean after the build, so the generated declaration files are unchanged.
