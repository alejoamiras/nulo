# Phase 5 — Pages cut-over (owner-executed)

- 2026-09-02 13:18 UTC: stack #518 squash-merged — #516 `543c238c`, #517 `bd19e265` (dev head).
- Owner fixed both Cloudflare Pages projects' settings (root directory `apps/tools`) before merging.
- **Both `nulo-tools-*` projects build production from `main`, not `dev`**: neither dev merge commit carries a Pages commit status (only the PR branches got preview builds), and `testnet.tools.nulo.sh/build.json` serves `0.1.0+d4c0e97a` = `chore(main): release 0.27.0 (#338)`, `main`'s head. The plan's I1 guess (testnet tracking `dev`) was wrong; the branch-gated procedure still holds — both flips simply belong to the same moment, the next `release: promote dev → main`.
- Verification therefore lands with that promote: per project, `curl -fsS https://<host>/build.json | jq -r .buildId | awk -F+ '{print $NF}'` must equal `git rev-parse --short=8 origin/main` and the deployment's build log must show `apps/tools`. Until then the sites keep serving 0.27.0 from the old layout, which is correct — nothing about the rename is user-visible before it ships.
- Worktree close-out: `agent-worktree done tools-rename` once this note is merged.
