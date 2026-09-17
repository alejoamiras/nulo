# Phase 7 — close out

## What landed

- **`apps/extension/src/wallet/services/execution/README.md`, "Authorization fence".** What the
  fence binds and why the serial makes A → B → A and a same-profile re-unlock fail; the capture
  points; the two entry contracts (`executeOperations` refuses a DAPP origin without
  `authorizedFence`; `executeSendTransaction` captures when no fence arrives, correct only for a
  caller that awaited nothing); `assertFence` and its sites; `isFenceLive` after the account
  lookups and as the statement before `node.sendTx`, behind the unchanged post-`submitting`
  cancellation check; the registry; the sweep and its two terminal shapes; the limits
  (unregistered work, PXE calls already issued including store-key recovery); the auto-lock
  predicate. The file map's lane row names `registerInFlight` and `abandonDeadSessions`; the
  Testing section names the composition describes and the three network tests.
- **`ARCHITECTURE.md` §7**, one paragraph: a session end cancels the sends it authorized that have
  not been broadcast, the lock button asks first, the auto-lock defers in `min(60 s, TTL)` steps
  within a per-session budget of `min(TTL, 10 min)` that nothing refills, and dApp activity
  refreshes the TTL as before.
- **Sweeps.**
  - `apps/extension/tests/e2e/README.md`: the three new tests join the proof-gate (STUB) list; the
    feature-helper table gains the lock, profile, session-row and send-record helpers.
  - `ProfileService.captureExecutionFence`'s docblock named the fence `{profileId, epoch}`; it now
    names `session` too, and its `(D13)` and `(codex TOCTOU)` tags are gone.
  - `lockWallet`'s docblock said the handler flips `isLogined` at once and quoted a 20 s timeout;
    the handler awaits one journal read first, and the waits live in `waitForLockScreen`.
  - `apps/extension/src/types/.eslintrc-auto-import.json`: the build adds
    `"approvedSendsInFlight": true`; committed here so CI's build job finds no drift.
    `auto-imports.d.ts` regenerated identical to the hand edit in phase 5.

## Decisions

1. **The README states limits, not only guarantees.** Phase 4's round-2 rejection (store-key
   recovery reads whichever session of that profile is open) and the unregistered-work limitation
   were promised a home in this section; both are there, one sentence each.
2. **`transaction/service.ts:175` still reads "captured {profileId, epoch}".** Not edited: this plan
   did not touch that file, and the comment describes the two fields `addTransaction` asserts,
   which is still accurate.
3. **No skill update.** The durable e2e techniques from phase 6 (set the TTL after the last
   navigation; read session state without navigating) are now in the helper table and the helpers'
   own docs. The stale-tracker finding is a product limitation recorded in plan.md, not a testing
   technique.

## Validation gate

Run alone, nothing else on the host (codex not running):

| Command | Result |
|---|---|
| `bun run audit:vue` | exit 0. typecheck:all: every workspace exit 0. test: 503 files passed, 3 skipped; 6245 tests passed, 4 skipped, 7 todo. lint: 30 warnings, 5 infos, all pre-existing; complexity-baseline check OK. build: OK. |
| `bun run test:e2e`, run 1 (the dist `audit:vue` built) | exit 1: 30 files passed, 1 failed, 2 skipped. The one failure is `backup-migration.test.ts`'s fixture-arming contract: "NULO_E2E_MIGRATION_FIXTURE is unset on a repo-build run". |
| `bun run test:e2e`, run 2 (armed build, as `_extension-smoke-e2e.yml` runs it) | exit 0: 32 files passed, 1 skipped; 123 tests passed, 6 skipped; 555 s. |

After the build, `git diff -- apps/extension/src/types/` showed only the `approvedSendsInFlight`
line, committed with this phase.

## Attempt log — the smoke gate

1. **Run 1 failed on the environment, not the code.** `audit:vue` ends in a plain `bun run build`,
   which leaves an unarmed `dist/chrome`; the smoke suite then ran without the migration fixture
   and without `NULO_E2E_MIGRATION_FIXTURE`, and `backup-migration.test.ts` throws by design in that
   case. The `e2e-testing` skill already names this trap ("a later plain `bun run build` —
   including the one at the end of `bun run audit:vue` — silently disarms the dist").
2. **Run 2 reproduced CI's source-build path**: `VITE_NULO_E2E_MIGRATION_FIXTURE=1
   VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1
   VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run build:chrome`, a grep for the token-seed stamp and
   key and the `nulo:e2e:backup-mig-fixture` marker in `dist/chrome`, then
   `NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e` from the repository root. Exit 0.

Run order for this gate: `audit:vue`, then the armed build, then smoke.

## Arc 2 codex loop

Codex (GPT-6 Astra, effort `high`, static review of `worktree-profile-fenced-execution..64897bd7`)
was told not to run tests. Session `01a0acf5-f6bb-7c60-8c9e-ac9646cc5a17`.

### Round 1 — reject, seven findings: five accepted, two accepted in part

| # | Codex finding | Verified | Disposition |
|---|---|---|---|
| 1 | High: `Header.vue` awaits the journal read before any lock; a stalled read holds the lock for the client's 60 s RPC timeout (longer while connecting). | Yes: `DEFAULT_RPC_TIMEOUT_MS = 60_000` (`packages/extension-messaging/src/background/client.ts`); `refreshInFlightOps` awaits `connect()` then `getOperations`. Before arc 2 the button locked synchronously. | **Fixed.** The read races a 3 s budget; a read that has not answered locks without asking, whatever count earlier events cached. A late answer only updates the store. Same rule as the failed-read case (phase 5, decision 2). |
| 2 | High: a stale confirmation can lock a replacement session. Window A shows the dialog; window B locks and unlocks; A's `app.vue` lock cleanup awaits `getProfiles()` and is abandoned when the unlock event supersedes it, so A's dialog stays open and its callback locks B's session and cancels B's work. A pending read can resume after a replacement unlock the same way. | Yes: `app.vue` `onActiveProfileChanged` returns on `seq !== profileEventSeq` before `enterLockedState` (which is what calls `popupStore.closeAll()`). | **Fixed in the popup.** `Header` counts `onActiveProfileChanged` events: each one closes a lock dialog `Header` raised, and a decision whose read spanned one starts over on a fresh read. **Rejected in part:** comparing the session identity where the worker closes the session needs a serial on the wire and a new `lockActiveProfile` parameter; an event not yet delivered when the user confirms stays under "Consent is best-effort" (plan, Known limitations). |
| 3 | Medium: the auto-lock e2e cannot tell a lock after the send finished from a lock after the budget ran out; an always-true deferral check would pass. | Yes: with an 8 s TTL, step = `min(60 s, TTL)` = budget = `min(TTL, 10 min)`, so the first deferral moves the deadline to the budget's end, and both causes lock at that same deadline. | **Accepted as a claim fix.** No TTL of 60 s or less separates them, and a longer TTL needs the proof gate held past its 20 s self-release. The test's header now claims deferral while proving and a lock afterwards, and names what pins the rest: the composition test "init registers it over the real journal: an approved send defers its own profile's lock until it settles" (the check turns false once the send settles) and the session-manager test "repeated deferrals stop at the budget…". |
| 4 | Medium: `lock-cancels-dapp-send` and `profile-switch-sweeps-transfer` wait up to 30 s for `cancelled` although the gate releases itself after 20 s, so a slow sweep, or B unlocking after A's execution unwound, could still pass. | Yes: neither test compared the clock with `enteredProveAt`. | **Fixed.** `PROOF_GATE_HOLD_MS` (`fixtures/proof-gate.ts`, the gate's exported `SAFETY_TIMEOUT_MS` minus 2 s) replaces the auto-lock test's local constant. `lock-cancels-dapp-send` asserts the cancel lands before it; `profile-switch-sweeps-transfer` asserts B is unlocked before it. |
| 5 | Medium: `callService` settles only on a response or a disconnect. | Yes. | **Fixed.** A 15 s timer disconnects and rejects with the service and method only; every settlement clears it. |
| 6 | Low: `readSessionRow` ships the whole row, restore secret included, out of the page and parses it in the runner, where a parse error can quote the input. | Yes. | **Fixed.** Parsed and projected in the page; an unreadable row throws a constant message. |
| 7 | Comment: the Header comment narrated the handler; `SendRecordView`'s doc said `enteredProveAt` is when the gate starts its timer. | Yes: `proveAndSend` stamps `enteredProveAt` in the `proving` write, and `ChromeStorageProofGate.wait()` starts its timer later, inside `proveTxTask`. | **Fixed.** The Header comments state the two rules; the journal doc calls the stamp a lower bound. |

Tests: three `Header.test.ts` cases (a read that never answers locks at 3 s without asking, with a
count cached from events, and its late answer opens nothing; a session change closes the dialog
`Header` raised; a session change during the read discards the count and decides again).

Mutation checks (scratch script, file restored after each):

| Mutation | Tests that failed |
|---|---|
| The lock awaits the read with no budget | the budget case |
| A timed-out read still uses the cached count | the budget case (after it was given a cached count of 1; it survived before) |
| A session change leaves the dialog open | the dialog-close case |
| A read that spanned a session change is trusted | the decide-again case |

Gate: `bun --bun vitest run src/components` exit 0 (49 files, 540 tests); `bun run typecheck`
(extension) exit 0; `biome check` on the touched files clean. Network e2e, solo, `NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent`: `lock-cancels-dapp-send`
exit 0 (23 s), `auto-lock-defers-while-proving` exit 0 (48 s), `profile-switch-sweeps-transfer` exit 0
(93 s), so B's unlock does land inside the gate's hold.

### Round 2 — reject, two new findings, both accepted

| # | Codex finding | Verified | Disposition |
|---|---|---|---|
| 1 | High: restarting a decision whose read spanned a session change carries the click to the next session: click during A, the read stalls, another window locks A and unlocks B, and the restart reads B's journal and can lock B at once. Each restart also grants a new 3 s budget. | Yes. | **Fixed.** A decision whose read saw a session change is abandoned: no second read, no dialog, no lock. A dropped worker connection (`onDisconnected`) counts as a change too, since the worker may have restarted. |
| 2 | High: the partial rejection of round-1 #2 does not hold. If this popup has not yet received the events when its user confirms, the unqualified `lockActiveProfile()` closes the replacement session. The approved "best-effort" limitation covers work admitted within the session being locked, not a confirmation carried across sessions. | Yes: the popup cannot compare with the worker's session atomically; only the worker can. | **Fixed in the worker.** `ProfileService.getSessionHandle()` returns `<worker id>:<serial>` (the worker id is random per worker, because serials restart with it), and `lockActiveProfile(handle?)` returns without closing anything when a different session is open. With no session open it locks as before, so the read-back and the lock announcement still run. The header reads the handle with the in-flight count, inside the same 3 s budget, and passes it on both lock paths; a lock issued after the budget carries no handle. |

Codex accepted the round-1 disposition of #3 (the auto-lock e2e claim fix) and confirmed the other
round-1 fixes: the timer is cleared on every settlement, callback identity limits closing to this
header's dialog, the subscription is removed on unmount, and a late answer has no side effects.

Why the handle is safe to refuse on: the background client rejects every pending request when its
port drops (`rejectAllPending` in `packages/extension-messaging/src/background/client.ts`) and never
resends, so no request carries a handle from before a worker restart to the worker after it; and a
header that saw the drop abandons its decision. A non-strict worker restart restores the session
under a new handle, so a handle from before it closes nothing (pinned).

Tests: `service.integration.test.ts` "lockActiveProfile given a session handle" (a handle closes its
session and leaves a replacement open; a handle from before a worker restart does not name the
restored session). `Header.test.ts`: both lock paths pass the handle; the budget case locks with no
handle; an event from either source closes the dialog; a session change during the read abandons
the lock.

Mutation checks (scratch script, files restored after each):

| Mutation | Tests that failed |
|---|---|
| The confirm drops the handle | both counts of the dialog case |
| The immediate lock drops the handle | the nothing-running case |
| A dropped connection is not watched | the dialog-close case for `onDisconnected` |
| A changed session restarts the decision | the abandon case (after its listener was made to fire once; firing on every read made the mutation loop until the test timed out) |
| The worker ignores the handle | both handle cases |
| The handle is the bare serial | the worker-restart case |

Gate: `bun --bun vitest run src/components src/wallet/services/profile src/stores src/popup` exit 0
(161 files, 1789 tests); extension `bun run typecheck` exit 0; `bun run lint` exit 0 (30 warnings,
5 infos, all pre-existing; complexity-baseline check OK). Network e2e, solo at retry 0: `lock-cancels-dapp-send` exit 0 (23 s), `auto-lock-defers-while-proving`
exit 0 (49 s), `profile-switch-sweeps-transfer` exit 0 (92 s), and `session-profileSwitch` exit 0 (11 s),
which also locks through the header.

### Round 3 — approve: converged

Codex checked the round-2 fixes: the RPC wiring (spec, the service's allowlist, the exhaustive
client passthrough list, the optional argument surviving serialization); the handle telling apart
a same-profile re-unlock, a profile switch and a session restored by another worker; the refusal
taken under the facade lock with no suspension before the close; cleanup, read-back and the lock
announcement still reached with no live session (passkey and strict-password restarts included);
abandonment without restart on delivered changes and disconnects; one 3 s budget covering both
reads; and the tests. It restated the one exception as a trade-off already chosen: a read that times
out or rejects locks without a handle, even when the handle read had succeeded, so the
replacement-session protection does not cover that path. It added that the client's no-replay
behaviour supports the restart reasoning for pending requests but does not guarantee delivery of a
lock through a worker crash. Verdict line: "No new material findings."

## Cross-arc pass

A fresh codex session (GPT-6 Astra, `high`, static review only) read the combined diff
`c543c18d..HEAD`, the plan and every lessons file, and looked at the seams between the arcs.

### Round 1 — approve, no material findings; four comment findings

Verdict line: "Approve — no new material cross-arc defects found." It confirmed: the popup count and
the worker's deferral share `isApprovedSendInFlight` (the sweep's extra `queued` stage is
intentional); the sweep persists `cancelled` before it aborts; serials, the account-lookup rechecks
and the broadcast check keep a successor session from authorizing work; a lock handle protects a
replacement session, the unbound lock after the budget excepted; the deferral read bypasses the
journal's RPC gate, so it takes no lock cycle; the three network e2e carry real proving-stage and
timing preconditions. On the phase-6 limitation it found nothing inside this plan's surfaces that
makes it worse, and called the workaround (close and reopen the popup) accurate.

| # | Finding | Disposition |
|---|---|---|
| 1 | The `PRE_SUBMIT_STAGES` comment says the broadcast is issued from `submitting`; the journal write precedes the cancellation check and the fence check | Accepted. The comment now names the stages the sweep cancels and why `submitting` is left to the fence check before `node.sendTx`: a sent transaction must never read `cancelled` |
| 2 | The `utils/in-flight-send.ts` header says a send follows whichever profile becomes active and that cancelling always clears the guard | Not changed here. The header predates this plan and states the rationale of the account/network Send freeze, a hard limit of this plan owned by the parked approval-scope-follow plan. Its first claim still holds for the switches the freeze blocks (an account or network switch does not end a session, so the fence does not see it); its second is the stale-tracker limitation already in the plan's Known limitations. Recorded as a follow-up for that plan and in the PR body |
| 3 | The `hasApprovedSendsInFlight` docblock repeats its name and omits why it reads the journal in-process | Accepted, verified: `getActiveProfile` runs under the facade lock and reaches `expireOrDefer`, so the gated RPC read (which asks for the active profile) would wait on a lock the caller holds. The docblock now states that |
| 4 | Provenance and duplicated explanations in `claim-helper.ts`, `mark-failed-unless-cancelled.ts`, `journal-state.ts` | Accepted. Review and phase references removed (two more of the same in `claim-helper.ts` and `journal-state.ts`); the claim decision tree now matches the code (`pending` registers only); the synchronous-passthrough paragraph is one sentence; the header table with obsolete icon names is gone |

Gate: `bunx biome check` on the five files exit 0; `bun --bun vitest run src/wallet/services/execution
src/utils` exit 0 (92 files, 1321 tests). Comment-only change.

### Round 2 — approve: no new material findings; one comment correction

Codex resumed on `9808944b..a6e8cc31`. Verdict line: "Approve — no material cross-arc problem remains
identified." followed by "No new material findings." It confirmed each rewritten comment against the
code, and agreed that leaving the `in-flight-send.ts` header is not material for this change: an
account or network switch inside one session does not end the session, so the fence does not see
the switches that guard blocks, and the header's overbroad "never stuck" belongs with the freeze's
owner.

| # | Finding | Disposition |
|---|---|---|
| 1 | The shortened reaped-row comment in `claim-helper.ts` overstates what the branch knows: `getOperation(...).catch(() => null)` also sends an unreadable row there, so neither "reaped" nor "no cancel could have aborted it" follows | Accepted, verified. The comment now states only the cleanup reason: the fallback files under a new id, so the old id's controller entry would leak |

Resumed once more on the correction, so the last pass reviews the code as delivered.

### Round 3 — approve: converged

Codex resumed on `a6e8cc31..b78780e6`. Verdict line: "Approve at `b78780e6` — no material cross-arc
problem identified." followed by "No new material findings." It checked that the corrected comment
covers missing and unreadable rows without claiming anything about an earlier cancel, that the
commit changes no executable behaviour, and that its earlier cross-arc conclusions still hold.

## Final gates at `b78780e6`

Run one at a time on the delivered code, after the cross-arc pass converged; `origin/dev` was still
`c543c18d`, the stack's base, so no rebase sits between these runs and the push.

| Gate | Result |
|---|---|
| `bun run audit:vue` | exit 0 — typecheck (bridge-core, tools, extension) exit 0; 503 test files, 6251 tests passed; lint 30 warnings, all pre-existing; build passed. No generated-file drift |
| Smoke, armed build (`VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run build:chrome`, markers checked, then `NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`) | exit 0 — 32 files, 123 tests passed |
| `lock-cancels-dapp-send` (`NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent`, alone) | exit 0 (test 22 s) |
| `auto-lock-defers-while-proving` (same, alone) | exit 0 (test 48 s) |
| `profile-switch-sweeps-transfer` (same, alone) | exit 0 (test 93 s) |

Screenshots for the PR came from a throwaway test copied into `tests/e2e/network/` for its own run
and deleted after it (exit 0, never committed): the home screen with a dApp transfer held mid-proof,
then the dialog in both themes. Compared with the render approved before implementation, the only
visible change is the pre-title override ("Irreversible" → "Running transactions"). The confirm
button is not literally red: `confirm_color: "red"` only selects the destructive pre-title, and
`ConfirmPopup` binds it to the button's `type` attribute, which nothing styles, so every
destructive dialog in the wallet, this one included, uses the accent fill. That was already true
of the approved render, so nothing changed there. The screenshots, with the approved render beside
them, are a private artifact linked from the arc 2 PR: https://claude.ai/artifact/EMFM5h5zd2Ani6rQmab2KM
