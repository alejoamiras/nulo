# Phase 5 — sync-back main → dev (#339)

2026-07-29. The bot's sync PR arrived clean (no needs-manual-resolution; the App-signed manifest
commit). dev's full gates green first try (no flakes this cycle). Pre-merge assertions: rollup
unique == SUCCESS + mergeStateStatus CLEAN. Merged with `--merge --match-head-commit c5db11d…` —
NEVER squash. Post-merge gate: dev tip `184f390bb7f7dba5313d285ce1b8c8dec6fa9c99` = true 2-parent
merge (c00598a + c5db11d); dev package.json 0.27.0; prerelease manifest {".": "0.27.0"}; tag still
peels to TAG_SHA; `git merge-base --is-ancestor v0.27.0 origin/dev` exit 0. Gate ✓. dev unfrozen.
