# Arc 5, error-registry: lessons log

## Build

- **Recon was wrong about the four constant-message classes.** They need no per-class rebuild: their constructors take no parameters, so the generic `new C(message, details)` ignores both arguments exactly as the old `new C()` did. `ScopeViolationError` drops `details` the same way. Only `CapabilityNotGrantedError` reshapes its arguments, so it alone has `fromPayload`.
- **Type probes, in scratch files that were deleted.**
  - A constructor type of `new (message: string, details?: unknown)` rejects `JobCancelledError` and `DuplicateWalletError`, whose `details` parameters are typed. `details?: never` accepts all 21.
  - With `BY_CODE`'s value type explicit, a constructor that *requires* typed details fails to compile, while optional typed details still pass.
- **Mutation check:** I dropped `SessionEndedError` from the registry and pointed the `fromPayload` branch at the wrong class. 18 tests failed. The file was restored from a copy, never with git.
- **Phase 1 passed on the old switch** (156 tests). After Phase 2, `git diff` of the test file between the two phase commits was empty.
- **Local gates green** at the Phase 2 head and again after the code-round nits: `lint`, `typecheck:all`, `test:all`, `test:ci-gating`, `audit:vue`.

## Codex loop

- **Plan audit:** REVISE, one should-fix finding and three nits, all adopted (see the batch plan's Decisions). Its in-memory comparison of the proposed dispatch against the switch matched on 3,552 combinations.
- **Code round 1:** CONVERGED, three nits, all adopted in one commit:
  - pin the literal default messages of `UserRejectedError`, `DuplicateInitializationError`, `InvalidPasswordError` and `ProfileIdConflictError`;
  - remove five standalone tests that the table covers;
  - delete a comment that narrated `expected()`.

  Its comparison matched on 6,720 combinations and caught every mutation.
- **Getter-bearing payloads: a non-issue, not fixed.** The constant-message constructors now evaluate a getter on `message` or `details`, and `ScopeViolationError` one on `details`, where the switch never read them. Every caller passes deserialized data or plain literals, so no wire difference is reachable.

## Merge gate

- At head 282b4728, every job in the five required workflows passed, none skipped: Quality, plus smoke, the five network shards, both heavy jobs and the real-proving canary on Chrome and on Firefox. Build Landing was skipped by its path filter, correctly. Squash-merged as #763; its tree equals the arc head.
