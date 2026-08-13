# Codex iteration log — deflake-round-2

Session continuity: the plan-audit codex session carries the whole arc (plan audit r1
reject → fold [+ live repro refuting the rAF theory] → re-audit conditional approve →
conditions folded).

## PR-1 (observability) — round 1

**Verdict: iterate** — 1 High + 2 Medium + 2 Low, all folded (`fix(review)` commit):

| # | Finding | Disposition |
|---|---|---|
| H1 | `formatPgMismatch` used in the canary error sentinel but never imported — ReferenceError reachable ONLY on the diagnostic (error) path, invisible to green runs | FOLDED — import added. Lesson: a diagnostic-path-only call is exactly the code a green gate can't validate; eyeball imports on error arms. |
| M1 | `vitest.e2e.all.config.ts` retries but had no reporter — `test:e2e:all` still masked retained errors | FOLDED — wired. |
| M2 | "≤2KB bound" overclaimed: the cap is per-field (payload + pg-error-text bounded separately) | FOLDED — documented as PER-FIELD cap. |
| L1 | "attempt N" wording overclaims (errors array ≠ one-per-attempt) | FOLDED — "retained error N". |
| L2 | Child pin: bunx could fall back to registry resolution; assert reporter fires exactly once | FOLDED — installed vitest binary + absolute reporter path + exactly-once assert. |

Codex confirmations: all 26 converted asserts are direct awaited hard failures (none inside
try/catch or Promise.race); page-closure on the pg-error-text read is covered by the catch;
no gate or bound weakened.

## PR-1 rounds 2–3

r2 **iterate**: the temp detached-run wrapper had ridden into the fold commit via `git add -A`
(its own header says never-commit). Untracked + git-ignored (`e3bae69`); lesson: `git add -A`
is banned while a temp wrapper exists — add by explicit path. r3: **APPROVE** ("PR-1 is ready").

## PR-2 (appearance/A1) — rounds 1–2

r1 **iterate**: one Medium — the persisted read could inspect the SAME mounted component
(navigateByHash proves hash, not rendering; the About page may never mount). FOLDED: gate on
the toggle LEAVING the DOM before navigating back. Codex confirmations: trigger non-teleported
with one owning dropdown; the new 5s wait is a bound on a NEW causal signal, not a raise;
appearance.vue's onMounted ordering supports the persisted-read claim. r2: **APPROVE**
("closes the false-persistence-proof gap … PR-2 is ready").

## PR-3 (A3 scan sweep) — rounds 1–2

r1 **iterate**, two Highs the suite could NOT catch: (H1) feeJuiceReady's block-forcing mints
accumulate raw dust on the extension account — the old fuzzy scan tolerated it, the new EXACT
assert wouldn't, and the fixture has no current consumer so no run reds on it; (H2) the
freshness helper's re-kick condition let fast stale projections burn the refresh cap in
seconds (receive-unregistered's old loop = up to 60 kicks; the derived cap = 8). Folded:
self-mint redirect + a 2s spacing floor with the cap derived from it. Codex confirmations:
row-level public+private AND is correct (projector writes both atomically); per-site amount
math verified; baseline placements deadlock-free; the helpers⇄extension cycle is
evaluation-safe; no consumer depends on the old quiet fixture degradation. r2: **APPROVE**
("Both folds are correct and isolated"). Lesson: an exactness upgrade FINDS fixture dirt the
fuzzy assert was absorbing — audit every producer feeding an assert you tighten.

## PR-4 (A5 fee-method + A4 durable cancel) — rounds 1–3

r1 **iterate** (3 High, 2 Medium): the disabled pin was tautological (Confirm already
disabled by other gates); the A5 execute-flow exercise ran on an UNFUNDED fixture
(fee-helpers disable zero-balance methods — any pass raced the balance read); a raced
approve's typed refusal rendered "Processing error." instead of the cancelled UI; the
in-repo canceller gap means nothing settles the dApp promise (ledgered with the driver
TODO); resolveInteraction lacked the first-claim guard. Folds: catch classification
(instanceof JobCancelledError → cancelled UI), exercise dropped (fee-methods' funded
submits exercise the shared selector), resolve guard + parity pin, honest pin renames.
r2 **iterate**: H1 still unpinned — codex prescribed the exact recipe (reuse the
executable-op setup: assert ENABLED, flip cancellation, assert DISABLED). Folded; removing
the binding term now reds a test. r3: **APPROVE**. Lessons: a pin that passes with the
guarded term REMOVED pins nothing — always red-team the pin against the deletion of what
it claims to protect; and an exercise on a fixture that can't satisfy the preconditions
is a race, not coverage.

## PR-5 fold verify (post-impl conditions) — rounds 1–2

r1 **iterate** (1 Blocking): the canary's new pre-kill liveness snapshot ran on the
PLAYGROUND page — `chrome.storage.session` is undefined there, the catch returned 0, and
the stale heartbeat satisfied `> 0` instantly, silently degrading the causal gate back to
truthy. (The retry=0 rerun passed anyway, i.e. the pass proved nothing about the gate.)
Codex confirmed the other four sites correct, the pins discriminating, and the
cold-boot-truthy classification sound. Fold: snapshot via a short-lived extension popup +
`expect(preKillLiveness).toBeGreaterThan(0)` so a future page-type regression fails loudly
instead of degrading. Lesson: a causal gate with a catch-to-default arm can silently
regress to the very non-causal check it replaced — assert the snapshot's validity, not
just its use.
r2: **APPROVE** ("no remaining blocker to PR-5 certification") after the extension-popup
snapshot + nonzero assert landed and the canary re-passed solo retry=0 (2 tests, 140s).
