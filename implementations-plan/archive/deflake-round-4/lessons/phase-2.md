# Phase 2 lessons — the fix arc (fix-plan execution)

## Upstream collision, absorbed mid-arc

- Between the blueprint's final audit and PR-1's CI, a parallel remediation
  campaign moved dev (#391-#399). Two direct hits: **BUG-FENCE was
  independently found (user report) and fixed** with the fall-through variant +
  its own regression e2e (`profile-reimport-matrix`), and the composable's
  rollback became B-24's bounded `rollbackCreatedProfile`. Two sessions, one
  bug: this arc's evidence found it first (runs 6-7), the user-report arc
  shipped first. Detection came from an oddity, not coordination: PR #400's
  `pull_request` workflows silently never ran — because the PR was
  CONFLICTING and GitHub does not build a merge ref (and therefore runs no
  pull_request workflows) for conflicting PRs. **Lesson: a PR whose Actions
  are absent (not red — absent) is a mergeability symptom; check
  `mergeable`/`mergeStateStatus` before debugging CI.**
- The re-scope was consulted, not improvised: codex agreed ×3 (adopt the
  shipped fence, PR-2 = hardening delta only, PR-3 composes with B-24), the
  duplicate control e2e was dropped for the upstream matrix (+ a
  generation-change assertion folded there), and every supersession got a
  ledger row (13-15).
- Rebase mechanics that worked: replaying 24 commits over a 282-line
  composable restructure would have meant resolving the same conflicts
  repeatedly — instead, a fresh branch off dev + wholesale checkout of the
  8-file non-overlap set + per-file semantic re-application of the 8-file
  overlap set, squashed to one rebase commit. gh stack absorbed the rewritten
  layers cleanly (`submit` after force-pushes re-linked all three PRs).

## The fixes, validated

- **Scenario A green end-to-end for the FIRST TIME (58.8s)**: kill while a
  restore RPC is held at `service-restore` → the catch classifies the
  disconnect → liveness gate resolves off the respawned worker's first write
  → B-24's delete succeeds against the live worker → `rolled-back` → the
  designed retry re-imports clean → on-chain convergence. The exact fork the
  round-3 test claimed to exercise and never could.
- Scenario B: 8 consecutive greens across the arc. Matrix (fence gate): green
  with the generation pin.
- The one evidence-run failure of the arc was the HELPER, not the fixes: with
  the fence fixed, a clean re-import completes and AUTO-ROUTES between two
  250ms polls, so `reimportToTerminal`'s terminal predicate starved against a
  finished import (`stage=<unbound>` = the attribute unmounted with the page).
  Terminal predicates over pages that can navigate must count
  "already-routed" as terminal. Fixed causally; no budget touched.

## Review-loop catches worth keeping

- codex (PR-1): both agent-contract tests checked `NULO_E2E_REQUIRE_CONFIG`,
  which NOTHING sets (`agent.sh` exports `E2E_REQUIRE_SETUP=1`) — the
  no-false-skip guard was inert through all seven evidence runs. Copying a
  guard pattern without grepping the runner for the variable is how a guard
  rots invisible.
- codex + second lens (PR-1, converged independently): the post-finalize pin
  was VACUOUS — the fixture backup carried no account-state slice, so the
  rejecting mock never ran and every assert passed trivially; the chain-sync
  runner also contractually records rather than throws. De-vacuizing needed
  the slice to survive the network-id remap (`data:` override + matching
  network row) plus a `toHaveBeenCalled` on the mock.
- codex (PR-2, two rounds): the `async` keyword ALONE reopened the
  authority-race window — an async `ensureTransportReady` returns a resolved
  Promise even for the consumed bypass, and the correlator's `if (ready)
  await …` then suspends for a microtask between the authority check and the
  wire. The fix is a `void | Promise<void>` signature returning literal void;
  the pin asserts `sendMessage` fired synchronously before the caller regains
  control. Zero-microtask claims need non-async plumbing end to end.

## Standing evidence discipline

- Every scenario failure in this arc carried its own diagnosis payload
  (stage, hash, errors-screen, store dump, generation pair) — every
  fix-iteration was one run, not a bisecting session. The pattern held from
  the finding arc: instrument the failure message first, then re-run.
