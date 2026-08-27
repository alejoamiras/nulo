# deflake-round-3 — plan audit, fable leg (Opus subagent, fresh context)

**Verdict: CONDITIONAL APPROVE** — items 2-5 broadly sound with three concrete gaps;
item 1's F1 must not ship as specified (blocking).

- **CRITICAL-1 — F1 is only needed in the world where it is unsafe.** The plan's own
  mitigation ("the failure case posts later") is self-refuting: if later-posting wins
  resolution, today's survivor SUCCESS already beats the duplicate FAILURE and there is no
  durable block for F1 to fix; if later-posting does not reliably win (round-2's "coin
  flip"), a duplicate SUCCESS can durably beat the survivor's FAILURE — a red suite becomes
  mergeable. Exactly one branch is true and neither justifies F1. The round-2 evidence may
  even be TRANSIENT ("initially win" — the fresh-head remedy was applied immediately;
  steady state was never measured). **Blocking condition: measure before designing** — one
  scratch labeled-PR open; poll check-runs + mergeStateStatus before/after the survivor's
  status completes.
- **CRITICAL-2 — F2 was rejected on a premise the recon itself contradicts** ("skipped
  satisfies required checks" vs "skipped leaves the check Expected forever" — both
  unsourced; the 2026-06-24 fix was phantom names, not `always()`). The same measurement
  settles it.
- **HIGH-3 — ranked safest designs**: (1) source elimination — open PRs unlabeled + one
  `gh pr edit --add-label`, and drop `labeled` from pr-quick.yml `types:` (quality is not
  label-gated — its burst is pure waste); (2) `!cancelled()` IF measurement shows skipped
  jobs don't produce a satisfying check-run; (3) F1-mirror — cancelled+superseded polls the
  surviving run and exits with ITS verdict (zero wrong-ALLOW; costs runner-minutes +
  status-job timeout raise, structural); (4) F1 as written only if resolution is proven
  deterministic-latest — at which point it is unnecessary.
- **HIGH-4 — data-auth-ready as specified creates a new hang class.** auth.vue commits
  `appStore.profile` only when a last-active id exists AND matches; no try/catch. "Ready =
  profile committed" never flips in the no-profile/not-found/throw branches → every
  ensureUnlocked caller hard-fails. Correct commit point: a `hydrated` ref set in a
  `finally` around the whole onMounted body ("hydration attempt completed"). Also: the
  recon's mechanism detail is wrong — `appStore.profile.id` THROWS TypeError, swallowed by
  the bare `return` at auth.vue:101; pin that path. The passkey branch motivates the
  signal (isPasskeyProfile is false pre-hydration → wrong form renders).
- **HIGH-5 — the import split needs a second product change and fixes nothing real.** The
  happy-path "Finishing import…" button has no testid; the submit button's absence is also
  true BEFORE a backup is picked (bare-truthy satisfiable by the wrong state — the banned
  class). And splitting 300s into 240-260s restore + 40-60s routing TIGHTENS the restore
  budget — the observed slow-runner failure fails EARLIER. Named-stage diagnostics are
  real value; flake reduction is zero. **Causal alternative: a stall detector** — wait on
  monotonic progress (restoreStatus transitions / restore-pending presence transitions),
  fail only when progress stalls for N seconds, keep 300s as the outer backstop.
- **MEDIUM-6 — sw-resilience**: `Runtime.terminateExecution` does not guarantee the
  target disappears (may linger as zombie) — a waitForTarget-gone could hang to its bound;
  verify empirically, prefer a real close primitive. Kill-side confirmation does not close
  the respawn side; openPopup's bounded detach retry (extension.ts:1003-1024) is the
  existing mitigation — cite it. Per-test retry:0 on test 4 is sound.
- **MEDIUM-7 — PR-3 scope**: withFreshBalanceRow closure rewrite = 22 references / 7 test
  files + 2 fixtures behind a 25-45 min suite — destroys bisectability; defer OUT of the
  arc. Keep MINT_AMOUNT + assertPgError (additive).
- **LOW-8** — recon inventory verified complete (remaining literal sleeps are poll
  intervals inside bounded loops); state that Class-B intervals were enumerated + excluded.
