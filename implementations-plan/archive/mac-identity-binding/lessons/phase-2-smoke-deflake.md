# Phase 2 — the red smoke gate: pre-existing post-unlock navigation races

The PR's `smoke-e2e-status` went red 6 of 7 runs (`imported-account-lifecycle`,
`backup-imported-account`) while quality + network stayed green. This phase records how the
failure was attributed and what actually fixed it.

## Attribution: inherited from dev, not introduced by the branch

- **Probe PR** (plain dev + one comment line, zero code relation to this arc) failed smoke
  with the identical signature — the strongest possible blame assignment.
- The branch passed the FULL local battery repeatedly: `audit:vue` (4579), network 99/99,
  smoke 105/105 — including testnet-pinned builds matching the CI smoke env.
- Nightly on post-merge dev: ALL GREEN the same night (artifact-mode smoke, no
  `VITE_NULO_E2E_DEFAULT_NET=testnet` pin) — consistent with load/env sensitivity, not logic.
- Failures were always wait-budget overruns on visibly HEALTHY parked states (correct
  account, balances rendered) — never an assertion about MAC/DEK/fingerprint values.

## Reproduction — CPU restriction is the amplifier

```bash
# ≈ GitHub-hosted runner conditions; ~40% failure rate on plain dev
taskset -c 0,1 bun run --cwd apps/extension test:e2e \
  tests/e2e/imported-account-lifecycle.test.ts \
  tests/e2e/backup-imported-account.test.ts
```

The races below live in a window that is ~100ms on a fast machine and MULTIPLE SECONDS on a
starved 2-core runner while PXE sync + PBKDF2-600k share the cores. That width difference is
the whole story of "passes locally, fails in CI".

## The four races (all pre-existing on dev)

1. **Router guard ejects mid-bootstrap navigations** (`src/popup/index.ts`).
   `appStore.isLogined` flips only at the END of `bootstrapActiveProfile`'s sequential RPC
   chain; the guard bounced every `isAuthRequired` navigation to `/popup/auth` in that
   window. Captured hash-log: `general → accounts → AUTH → accounts`. Fix: the
   auth-required branch delegates to `authRequiredGate` (`src/popup/auth-guard.ts`), which
   consults the AUTHORITATIVE `getActiveProfile()` read; transport rejections retry across
   [0,250,500,750]ms (SW respawn), persistent rejection degrades to PASS — unknown is not
   locked, and a locked wallet answers cleanly. The `popup-auth`-redirect branch above it
   stays flag-only + synchronous: an async lookup there fires during cold boot and its
   degrade would strand the boot at the bare index route.
2. **Stale lock event ejects a newer unlock** (`src/popup/app.vue`). The lock handler
   awaits `getProfiles()` before pushing `/popup/auth`; under load it can resume AFTER its
   own unlock re-activated the profile — ejecting the fresh session and clobbering
   `isLogined=false`. Captured: `PUSH /popup/auth` ~2.5s post-unlock. Fix: sequence token
   (`profileEventSeq`) — a superseded handler abandons its mutations after each await.
3. **Export deep-link preselect races the bootstrap refill**
   (`settings/security/export/account.vue`). Preselect ran once at setup against a
   momentarily-empty account list (a fresh unlock re-runs the activation bootstrap, which
   resets + refills the store); the page stranded on the picker and the agree gate never
   rendered. Fix: a second watcher re-applies the query preselect when rows arrive, only
   while nothing is selected.
4. **auth.vue pushes `/popup/general` late and twice** (`src/popup/pages/auth.vue`). The
   submit handler ran `await syncTransactions()` + `refreshBalances()` BEFORE navigating —
   seconds under load, and the late unconditional push yanked the user back from wherever
   they had navigated since (captured: export page mounted, `PUSH /popup/general` 9ms
   later). The `isLogined` watcher also pushed from ANY route. Fix: navigate first, warm-up
   fire-and-forget after; the watcher advances only while still on `/popup/auth`.

These are real user-facing bugs, not test artifacts: any slow machine (or busy SW) shows
the same eject-to-password-screen / yank-back-to-general behavior after unlock.

## Attribution technique that worked

Wrap `$router.push/replace` + `hashchange` in-page with stack capture (throwaway
`zz-navprobe*` tests, deleted after use), then match the recorded stack's chunk file + byte
offset against the built bundle to name the pushing call site. Guessing from symptoms
produced wrong fixes; the router-attribution log produced four right ones.

## Validation methodology (learned the hard way)

- Freeze the tree before running comparison loops — interleaving edits with runs produced
  hours of contradictory data.
- Run the restricted-CPU loop ALONE on the host (other heavy processes shift the failure
  rate unpredictably).
- With all four fixes: 4/5 restricted-CPU loops fully green; the residual single
  `gotoAccounts` stall (attempt 3 of 5) was not attributed — either a fifth layer or load
  noise. If the gate reds again with these fixes in-tree, re-run the instrumented probes
  before assuming.

## Known residuals

1. `ensureUnlocked` can return early on a stale "unlocked" reading when the lock click
   hasn't propagated (documented in its own comments; untouched).
2. `stopServiceWorker`'s 15s close-confirmation timed out once under extreme starvation —
   MV3 `worker.close()` is best-effort; a retry is a candidate hardening.
3. PR-gate smoke builds pin `VITE_NULO_E2E_DEFAULT_NET=testnet` (nightly artifact smoke
   does not); chain-adjacent pages probe RPC during navigation, so remote-LB latency adds
   variance exactly on nav-after-network-touch stages. Pinning smoke to a mock RPC remains
   an open deflake candidate if budgets keep getting grazed.

LESSONS_FILE=implementations-plan/mac-identity-binding/lessons/phase-2-smoke-deflake.md
