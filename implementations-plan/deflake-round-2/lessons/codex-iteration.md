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
