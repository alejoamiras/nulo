# Phase 2 — merge promote PR #337

2026-07-29. `gh pr merge 337 --merge --match-head-commit c00598ae…` accepted server-side, first try.
Main tip is now `e3a3c612e1b8c47be992238be24043448912e8d8` with parents `bffaad2` (prior main) and
`c00598a` (RELEASE_SHA) — a true 2-parent merge commit. Gate ✓. dev is now FROZEN until the Phase 5
sync merges.
