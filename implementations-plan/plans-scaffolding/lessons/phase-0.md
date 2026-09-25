# Phase 0: rebase, refresh, coordinate

**2026-09-25, green.**

- Rebased onto `origin/dev` at ee66a233 (#695), from 9f11de70. All four plan commits are still signed (`%G?` = `G`).
- Drift in `implementations-plan/` since the recon base: `index.md` (one line), `tools-extraction/plan.md` and `tools-extraction/lessons/phase-2.md`. There is no new plan dir and no new transcript, so the recon counts (253 dirs, 667 untrack candidates) still hold.
- In flight:
  - #669, vitest 5: A10's baseline relocation follows it if it lands first.
  - The UX stack: `feat/ux-1..4`, unmerged.
  - `feat/extraction-recipe`, the tools-extraction R arc: local, not yet a PR. It adds `implementations-plan/tools-extraction/tools/`, which the gate must accept as an active plan's tooling.
- Gate: `git status --short` shows only the six untracked drafts and transcripts in this dir, which Phase 2's `.gitignore` will cover. They are never staged, since every add names its paths. `git merge-base --is-ancestor 9f11de70 HEAD` exits 0.
