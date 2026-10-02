# Phase 3 — Acceptance on `dev` (positive + negative)

## Positive (#171) — the whole point of the fix, proven
After finalizing `dev` (phantoms dropped → required = the 3 new pinned names), #171's `mergeStateStatus` flipped **BLOCKED → CLEAN**, and it merged with a **plain `gh pr merge --squash` (NO `--admin`, no raw-API)**. The resulting squash `d23fca73` is `verified: true`. A self-authored, signed, green PR now merges cleanly — the forced-`--admin` era is over on `dev`.

This also settles the two-gates question empirically: with the name gate fixed and commits signed, `required_signatures` did **not** independently block the self-authored squash (GitHub signs the squash on the author's behalf). So for self-authored PRs the name mismatch was the *whole* cause.

## Negative (#172) — the gate still blocks, it wasn't deleted
A throwaway branch added a deliberate `noExplicitAny` violation (`packages/extension/src/negative-test-deleteme.ts`). Result on the PR:
- `lint-and-typecheck` failed → `quality-status` aggregator went **red** (confirms the `if: always()` + `needs:` failure-propagation actually reddens the required check — the final-codex question).
- `mergeStateStatus` = **BLOCKED**; a plain `gh pr merge --squash` was **refused** (`"the base branch policy prohibits the merge"`).
- PR closed without merging; branch deleted.

A green-merges test alone could not distinguish "gate fixed" from "gate deleted" — the negative test is what proves the gate is real.

> Bash gotcha: `if gh pr merge … | tee …` reports the pipe's exit = `tee`'s exit = 0, masking gh's non-zero. The refusal message is the real signal, not the `$?` of a piped `gh`.

## Validation gate — PASS
Positive: 3 green-matched, `CLEAN`, plain squash merged without `--admin`, squash `verified=true`. Negative: forced-red `quality-status` → non-`CLEAN` + refused non-admin merge. Run on `dev` (`strict:false`) to isolate from `main`'s `strict:true`.
