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
