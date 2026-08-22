# Phase 2 lessons — passkey execution canary

- **GREEN prover-ON (round 2)**: `bun run e2e:agent tests/e2e/network/passkey-execution-canary.test.ts
  tests/e2e/network/frozen-account-canary.test.ts` → 2 files / 4 tests, exit 0. The passkey canary
  proves the 512-bit chain END-TO-END on a live node: PRF ceremony registration → second account →
  dApp connect + transaction-bundle grant → A's FIRST tx (frozen ctor, REAL proof, mined) →
  authwit consume as B (B's ctor, mined) → SW terminate → ceremony re-unlock in the SAME
  FrameTreeNode → post-restart tx mined. The mnemonic canary re-ran green beside it (no arc-4
  regression).
- **Round-1 failure (the one harness bug)**: after the SW restart, `location.hash = "#/popup/auth"`
  got bounced — the anchor popup's IN-MEMORY Pinia store still said `isLogined` (the SW-side
  session died, the popup JS context didn't), so the router redirected before auth mounted.
  Fix (791ec097): drive the app's own `header-lock` path, which flips the local store BEFORE
  routing — the exact mechanism passkey-paths' lock+unlock leg uses. Stages 1–3 (register, real
  proof, authwit) passed on the very first live run.
- **FTN discipline is the whole ballgame**: the virtual authenticator (and the credential + its
  PRF seed) is scoped to the anchor popup page's FrameTreeNode. The anchor popup stays OPEN for
  the entire test; `registerPasskeyProfile` moved to `fixtures/passkey.ts` (shared with
  passkey-paths, deduped) and `grantCapBundle` exported from `fixtures/extension.ts`. Small canary
  helpers (stopServiceWorker/txHashOf/setPgInputs) are DUPLICATED from the mnemonic canary on
  purpose — that file is the KDF-bump gate and stays untouched by this arc.
- **Harness ops lessons**: (1) `e2e:agent` is a ROOT package.json script — `--cwd apps/extension`
  fails with "Script not found". (2) A ~30-min gate cannot live inside a harness background task
  (10-min-scale kills observed): run it `nohup`-detached writing to a real-disk log with an exit
  marker, and poll the marker with cheap re-armable watchers — the killed watcher costs nothing,
  the detached gate survives. (3) A killed-mid-boot run left no orphans (the runner's teardown
  held), and the agent runner ran clean IN PARALLEL with a peer worktree's hour-long network run —
  the parallel-safe design held; the one "Address already in use" line in the killed round-1 boot
  self-resolved on relaunch via fresh registry ports.

LESSONS_FILE=implementations-plan/key-model-v2-hardening/lessons/phase-2.md
