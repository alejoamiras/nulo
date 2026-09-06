# Post-implementation codex loop (2026-09-06)

## Round 1 — `not converged` (1 Medium, 1 Low) — response (verbatim)

- **Medium — incomplete event fence (high confidence).** [reconcile-locked-boot.ts:38](apps/extension/src/popup/reconcile-locked-boot.ts:38) executes `selectAndAuth` without checking `profileEventSeq`; [app.vue:279](apps/extension/src/popup/app.vue:279) also applies the stale profile list after reconciliation. Missed interleaving: a fresh import-page shell has no selected profile; boot reads `[P]`; another window deletes active P and its lock event finishes, landing this shell on register; boot’s session read returns locked. The stale candidate then selects deleted P and redirects to auth. A deferred-promise Bun probe using the actual decision/reconciliation helpers reproduced this. **Fix:** fence candidate selection too, return an explicit event-superseded outcome, and prevent the caller from applying that result’s stale profiles. Add this lock-event/no-selected-profile case.

- **Low — documentation overstates the guarantees (high confidence).** [SKILL.md:305](.claude/skills/e2e-testing/SKILL.md:305) says surviving popups lock themselves, but valid lenient-password sessions restore, and discover/execute windows lack `isAuthRequired` metadata: their selected-profile boot takes `settle`, so the inherited `closeAll()` never runs there. Qualify the statement to the routes and session modes actually covered. [plan.md:140](implementations-plan/restart-lock-truth/plan.md:140) still says the new emit cannot occur with nothing to close, contradicting the implementation and strict-password test; update it. Ledger row 29 should also record the batched-watcher cause and sync-watcher fix.

Other checks passed by source tracing and isolated probes, **high confidence**:

- Only this watcher becomes synchronous; GlobalLoader remains batched. The client installs listeners and sets Connected before invoking `onConnected` ([client.ts:53](packages/extension-messaging/src/background/client.ts:53)). A mocked-port probe completed the callback’s first RPC. Direct `onConnected` subscription has equivalent timing; mount supersession is fenced.
- `isSessionChecked` introduces no synchronous route-guard reordering before lock cleanup.
- Other `close()` callers need no fallback announcement. The added emit remains inside `runExclusive`, after successful read-back; failure throws first.
- All seven migrated baselines are post-stop. Reopened-popup reads may require another heartbeat but are not vacuous. Only the two documented exceptions remain pre-kill. Their budgets do **not** eliminate the stale-final-tick limitation.
- The canary’s 60s automatic landing replaces the old 60s record poll while removing manual navigation; it is a stronger behavioral assertion.

No Vitest E2E configs ran.

not converged
## Round 1 — triage

Both adopted:
- M: the seam fenced only `lock`; `select-and-auth` ran on a stale candidate and the caller applied
  the stale profile list. Codex reproduced the interleaving (a no-profile import shell lists [P];
  another window deletes P and its lock event lands; the boot's session read returns locked with P
  as candidate → P is selected and the shell routed to auth). Now the fence sits before the decision
  and covers every action; the seam returns `event-superseded` and `loadProfile` applies nothing on
  it. Tests updated and the deleted-profile interleaving added (14 passing).
- L: the skill bullet is scoped to the routes and session modes actually covered (lenient password
  sessions restore; approval windows carry no `isAuthRequired` meta and only settle); the plan's
  stale "nothing to close ⇒ no emit" sentence corrected; ledger 29 records the batched-watcher
  cause and the sync-watcher fix.

Confirmed by codex: only the one watcher became synchronous; the client marks Connected before
invoking `onConnected`, so a run started inside the callback completes its first RPC; the read-back
throws before the new emit; all seven baselines are post-stop and not vacuous; the canary's 60s
automatic landing replaces a 60s poll with a stronger assertion.

## Round 2 — `not converged` (1 Medium) — response (verbatim)

- **Medium — superseded boot leaves completion flags stuck (high confidence).** [app.vue:279](apps/extension/src/popup/app.vue:279) returns before clearing `bootRetrying` or settling `isSessionChecked`. Neither profile-event branch settles those flags.

  Reproduced using the actual shell functions: retry a failed boot; a lock event arrives during the lookup and routes to auth; reconciliation returns `event-superseded`. The wallet is locked, but `bootRetrying` remains true, hiding authentication ([auth.vue:62](apps/extension/src/popup/pages/auth.vue:62)) and disabling RETRY. Recovery requires another reconnect or reopening the popup. On initial boot, the same return can leave `isSessionChecked=false`.

  **Fix:** settle these completion flags for the still-current run before returning, while continuing to discard stale profiles, candidates, and routing actions. Add caller-level regression tests for initial boot and failed-boot retry superseded by a profile event; the seam-only tests cannot detect this.

My unit rerun executed no tests because worker startup timed out. The separate Bun reproduction succeeded. No Vitest E2E configs ran.

not converged

## Round 2 — triage

Adopted. The `event-superseded` early return skipped the completion bookkeeping every finished run
owes: `bootRetrying` stayed true (auth form withheld, RETRY disabled) and on an initial boot
`isSessionChecked` stayed false. The post-reconcile dispatch moved out of `app.vue` into
`popup/apply-boot-outcome.ts` (`applyBootOutcome(outcome, shell)`), pure over a six-method shell
interface, with the caller-level cases codex asked for: superseded by a run → nothing;
superseded by an event → `retrying=false` + `checked`, no list, no candidate, no route; locked,
unreachable, failed, active as before. `app.vue` keeps only the `isCurrent()` re-check and the
shell wiring. Popup unit dir 742/742.

## Round 3 — `converged` — response (verbatim)

No remaining findings (high confidence).

Bun probes against the actual shell wiring verified that event supersession clears retrying and marks the session checked without applying stale profiles, candidates, or routes. Supersession by a newer run leaves that run’s flags untouched.

No Vitest E2E configs ran.

converged

Loop closed at three rounds: 1 (fence covered one action of three; docs overstated), 2 (a run
superseded by an event skipped its completion flags), 3 clean. No open items.

## CI red after the loop: `backup-restore-sw-restart` scenario A (shard 3/5)

Verdict text: "PRODUCT BUG (pre-finalize crash, page alive): the disconnect reached the page but
the designed rollback never completed within 150000ms". Reproduced locally at two cores, retry 0,
deterministic — not in the ledger, and this spec was NOT in the plan's battery (it uses the
restore-gate rendezvous, not a liveness gate, so recon's caller table did not list it; the
plan's "two proverless restart specs" omitted it). That omission is the process lesson.

Mechanism: the spec keeps the IMPORT page open across the mid-restore kill. With the sync watcher,
the reconnect ran a boot for the first time; the restore had not finalized, so the lookup resolved
`locked`; the import page has no selected profile and the orphan sits in the profile list, so
`decideLockLanding` returned `select-and-auth` and routed the page to `/popup/auth` — unmounting
the composable that owns the rollback and the `[data-restore-stage]` marker the test polls. The
pre-existing `landOnLockScreen` had the same branch; it never ran on a reconnect because the
watcher never fired.

Fix: a reconnect run never selects a candidate (`reconnect` in `LockLandingState`; the watcher
passes it; mount and RETRY do not). A no-profile page that survives a restart — import
mid-restore, register, reset — keeps its flow; the restart lock (`hasProfile` + auth-required
route) is unchanged. `shouldAdvanceToGeneral` leaves only the auth/register routes, so no other
reconnect path can navigate a page. Unit 21/21; the spec green after the fix (below).

Re-validated after the fix (two cores, retry 0): `backup-restore-sw-restart` 3/3 (scenario A
converges in 59s); `sw-resilience` + `sw-restart-network` + `migration` + `import-paths` × 2 →
2/2; passkey canary prover-ON green; `connect-locked-queue-sw-restart` + `cold-wake-discovery`
green. `backup-restore-sw-restart` is added to this plan's battery in `plan.md`.

## Round 4 (post-convergence, on the CI fix) — `not converged` (2 Medium) — response (verbatim)

- **Medium — high confidence:** [lock-landing.ts:43](apps/extension/src/popup/lock-landing.ts:43) strands initial boot if a disconnect rejects the route guard’s first `getProfiles()`. `router.isReady()` rejects, preventing mount’s boot; the successful reconnect then settles without selecting a profile or navigating. Reproduced with the real guard/router and extracted caller: blank route, no RETRY banner; the previous decision reaches auth. **Fix:** preserve candidate landing when initial navigation has not completed, while protecting established page flows.

- **Medium — high confidence:** [app.vue:217](apps/extension/src/popup/app.vue:217) still selects the orphan and pushes auth when reconnect returns `unreachable`. A successful profile-list read followed by exhausted active-session reads bypasses the new rule and can unmount the import rollback owner. Reproduced through the actual boot pipeline. **Fix:** apply the same flow-preservation policy to unreachable dispatch, displaying recovery in place.

The caller sweep found no additional retained extension page outside the listed battery. No Vitest E2E configs ran.

not converged

## Round 4 — triage

Both adopted; the rule sharpened from "a reconnect never selects" to "a run over an ESTABLISHED
page never selects" (`pageEstablished = reconnect && route.matched.length > 0`):
- M: a mount-time boot lost to a rejected `router.isReady()` (a disconnect rejecting the guard's
  first read) makes the reconnect the only boot the popup gets; with the route unresolved it must
  still select the candidate and land on auth. It does now (`pageEstablished` false).
- M: the `unreachable` landing had the same select-and-push branch. Extracted as
  `decideUnreachableLanding` (`auth` with a profile; `select-and-auth` with no page; `stay` — banner
  in place — on an established page or with no candidate) and wired through `settleUndecidedBoot`.
Codex's caller sweep found no further spec that keeps a page open across a kill outside the
battery. Popup unit dir 751/751.

## Round 5 (final verdict on the round-4 fold) — `converged` — response (verbatim)

No remaining material findings (high confidence).

Probes using the actual caller wiring confirmed both round-4 fixes: rejected initial navigation recovers to auth; established import pages survive both `locked` and `unreachable` reconnects. Authenticated-page locking remains intact, and a superseded mount cannot overwrite the reconnect outcome.

No Vitest E2E configs ran.

converged

Loop closed at five rounds: 1–2 on the original diff (fence coverage; superseded-run flags), 3
clean, 4 on the CI fix (lost mount-time boot; the unreachable landing), 5 clean. No open items.

Local note: during the round-4 re-validation, `migration.test.ts`'s "crash mid-migration
converges" went red ONCE in a five-file batch at two cores, then 4/4 solo and 5/5 in two more
identical batch rounds. Its crash is a whole-browser close + relaunch, not `stopServiceWorker`, so
no reconnect path runs there; treated as a two-core load flake with no fingerprint captured
(the batch grep kept only the failing line). If it recurs, capture the error text first.
