---
plan: failed-send-check
tier: mid
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
same_family_leg: Opus 5.5 subagent
eli5_mode: artifact
eli5: https://claude.ai/artifact/WY5w8GEggYX9zZTEuqBktk (one page for the wave's ten plans)
branch: feat/failed-send-check
worktree: .claude/worktrees/failed-send-check
base: 85c4d20f (dev after #719; code read at f32b1e0a, and #719 touched no cited file but Fact 15's record)
---

## Outcome

- **Date:** 2026-09-29. **Status:** closed, awaiting archive: delivered as #721 on
  `feat/failed-send-check`, not yet merged. The owner delegated the open UI calls to a review
  panel on 2026-09-29; the decisions, the panel's votes and the dissents are in § P6. The owner
  confirmed each on 2026-09-30 (§ P6).
- **Shipped** in #721, S1 to S3 as planned, P0 to P7:
  - A1: the `submitting` write is a precondition of the send, and a failed row keeps the stage it
    failed from, its hash and its endpoint.
  - A2, A3: `SendCheck` reads a failed send's receipt on its own endpoint, one attempt per read,
    inside the row's profile fence, for 30 minutes, and records sent, reverted or unconfirmed.
  - A4, A5, A6: the popup waits up to 60 minutes for `executeTransfer`, the Send snack says what
    the wallet knows, the card and the journal page show the outcome and update in place, and a
    checked send's own change notes are not "Received".
  - P7: the panel's edits (History, Unconfirmed's own State, "Interrupted before sending", "The
    fee was still paid.", no Ended row while the check asks) after merging `dev`.
  - Tests: a red-first unit, component or composition case per behaviour;
    `network/failed-send-check` on Chrome and Firefox; a composition pin of a node's refusal at
    the send line (F-8).
  - From the codex loop: the one-attempt receipt client, a network spec that proves the check
    runs, and two comment fixes.
- **Gates at delivery:** at `4db69ddb`, after merging `dev`: lint, `typecheck:all`, `test:all`,
  `test:ci-gating`, build and the plans gate exit 0. Smoke in three shards per browser: Chrome 39
  files passed, 3 skipped, 159 tests passed, 7 skipped; Firefox 40 files passed, 2 skipped, 155
  tests passed, 11 skipped. `failed-send-check` and `snack-placement` on Chrome and Firefox, 4
  passed each; `transfers` on Firefox, prover on, 1 passed, its public send's record at 110 s.
  Codex round 3 approved. Counts in `lessons/phase-7.md`.
- **Dropped:** O1 (b), O3 (b) and O4 (b), built only on local capture branches that were never
  pushed.
- **Open items:** none left here; `follow-ups.md` § Amounts, sends and fees holds F-1 to F-10.
  `lessons.md` § Extension runtime carries one, the node transport's retry.
- **Seeds retired:** the `/goal` and `/loop` seeds below are spent; nothing to resume.

# Failed send check

Three follow-ups from `implementations-plan/follow-ups.md` and #719's record, as one PR off `dev`:

- **S1** · A failed send hedges ("…If it was already submitted, it may still go through.") where
  the wallet could ask the network. After this change a failed send that may have reached the node
  is checked in the background, on the endpoint recorded with it (the one that submitted it unless
  the primary was edited mid-build, realism 3), and its record says what the network answered, at
  inclusion, the point where the regular send path calls a send confirmed. A failure the wallet can prove happened before the send says nothing was sent.
- **S2** · The Send screen's snack reports "Send failed · Simulation failed, transaction not sent"
  at 60 s for a transfer that is still proving and then succeeds (Firefox without Presto proves a
  public transfer in 86 to 94 s). After this change the popup waits for the background's answer.
- **S3** · A failed dApp send reads "Reported by app" whatever failed. After this change it reads
  what happened, like a wallet send.

Recon: [`recon.md`](recon.md). Competing outline: `outline-alt.md` (local, not committed).

## Phase 0 (pre-answered by the owner)

No clarifying questions were asked. The owner's standing instructions for this program:

- 2026-09-28: "Can you ultracode 1 to 5 + security and privacy + test rliability + trivial?
  Assigning blueprinting level to each of those and just needing me to answer the open questons
  that it may come."
- 2026-09-29: "Feel free to leverage the gh cli to merge away the branches that you understand are
  ready and feel confident on their implementation. Continue then with ultracodeing the
  follow-ups."
- 2026-09-28: "FYI: use opus5.5 instead of fable please."
- 2026-09-29: "let's cover realistic scenarios lol."
- 2026-09-29: "for next documents please put how it's going to look on each choice you are giving
  me".

This plan's own record: S1, the owner on 2026-09-28, when #718 kept the hedge: "Add it as an
immediate follow-up maybe after this arc?" S2, the owner on 2026-09-29, asked "Fix it?", answered:
"Fold into failed-send check". S3 is `follow-ups.md`'s "A failed dApp send always blames the dApp",
where new copy is an owner UI decision.

- **Scope**: S1 to S3 above: the `submitting` write becomes a precondition of the send; the journal
  keeps a failed send's hash, endpoint and the stage it failed from; a background check reads its
  receipt and records the answer; the popup's `executeTransfer` waits for the background; the snack,
  the activity card and the journal page show the outcome; Activity stops showing a checked send's
  own change note as "Received".
- **Out**: the two authwit popups' RPCs, which keep the 60 s ceiling (follow-up F-1); a definitive
  "won't go through" from the tx's expiry (F-2); the public-authwit index for a checked dApp send
  whose recorder never ran (F-3); a banner on Send while an earlier send is being checked; telling a
  dApp anything new; linking a checked record to the tx page or an explorer; migrating records
  written before this change (pre-production).
- **Constraints**: pre-production, no migrations; complexity budgets hold with no new acceptance;
  no new dependency; the logging policy and `log-payload-ban.test.ts`; the Terms wall's single
  broadcast line (`legal/call-sites.test.ts`, unchanged); the storage facade rule; existing testids
  verbatim; new copy joins no two clauses with an em dash.
- **Quality bar**: production. **`/harden`**: not scheduled. **`/code-review`**: off.
- **Validation layers**: typecheck and lint, unit, component, composition, CI-gating scripts,
  build; smoke e2e on Chrome and Firefox (popup copy changes); network e2e: the new
  `failed-send-check` spec on Chrome and Firefox (proverless), `transfers` on Firefox prover-ON
  without Presto with a measured prove time above 60 s (S2), and `snack-placement` on both browsers.
- **Decisions**: UI and product asks go to the owner, each with a recommendation and a picture per
  option; technical asks are decided with `/codex high` and logged in `lessons/`.
- **Delivery**: single arc, one PR off `dev` on `feat/failed-send-check`, plain `gh pr create`
  after the codex loop converges. The first commit adds `implementations-plan/failed-send-check/`
  and one line in `implementations-plan/index.md`. Merge: by the driver under the owner's standing
  authorization above, once every required check is green on the head, every UI surface carries
  the owner's quoted sign-off and the codex loop has converged.

### Phase 0.5 · Tier

| Dimension | Score (0-3) | Why |
|---|---|---|
| Novelty | 2 | A new background check and two new visual states; every rule it follows exists already (endpoint pinning, the execution fence, the lock-guarded in-stage writer, the per-method RPC ceiling) |
| Blast radius | 2 | The `submitting` and `failed` stages every send writes, the coordinator's four callers, the reaper's sweep, three popup surfaces, the incoming-note dedupe |
| Irreversibility | 1 | Code and tests; the stored shape grows optional fields |
| Migration cost | 0 | Pre-production: nothing to migrate |
| External coupling | 2 | The node's receipt semantics; DROPPED also means "this replica has not seen the hash" |
| Security sensitivity | 2 | A tx hash links private activity; the check must stay on the submitting endpoint and inside the owning session |

`mid`. The rubric does not reach `deep`: no new trust boundary, no protocol change, and the risky
parts reuse reviewed rules. The owner's standing cap is "never blueprint more than mid, to keep our
credits safe"; the plan stays inside it by leaving the authwit popups (F-1), an expiry-based answer
(F-2) and the authwit index (F-3) to follow-ups.

## Outcome & Quality Bar

For whom: a person whose send failed, on the Send screen's snack, on Home and History, and on the
journal page; a person proving in the browser on Firefox, who waits a minute and a half; a person
whose dApp send failed.

Excellent means:

1. **No screen invites a second send while the first can still land.** Every failed send resolves
   to one of five outcomes:
   - **nothing sent**, only where the stage proves it: the row failed before `submitting`, or at
     the send line's liveness check (`session_ended`);
   - **not confirmed yet**, while the check runs, DROPPED and an unreachable node included, with
     "Don't send it again yet";
   - **went through** (receipt mined, success);
   - **reverted** (receipt mined, failure);
   - **still unconfirmed** when the 30-minute window ends, which tells the person to check before
     sending again.

   A DROPPED answer never reads as "not sent". A unit test that fails on the base proves each
   outcome's copy, a composition test proves an accepted send whose response was lost ends "went
   through", and the new network spec proves on a real node, in both browsers, that a DROPPED
   answer leaves the send "not confirmed yet".
2. **No send goes out without a durable record that it may have.** The `submitting` write must
   succeed before `sendTxTask` runs; a failed write stops the send. A unit test with a rejected
   `submitting` write followed by working storage asserts zero broadcasts.
3. **The popup never reports a failure the background does not have.** A transfer that proves for
   90 s ends in "Transaction submitted", not "Send failed" at 60 s. `network/transfers` on Firefox
   prover-ON without Presto, red on the base (Fact 15), passes on a run whose measured prove time
   exceeds 60 s.
4. **The check is invisible to anyone who should not see it.** It dials only the endpoint recorded
   with the send, only inside a live fence of the row's own profile, with one read in flight per
   row. It re-checks one guard (the fence, the watcher's generation, the tracked row) after every
   await and inside its write, so a lock, `stop()` or a deletion stops it; it writes only to that row, and
   logs nothing above `debug`, never the hash or the URL. It tells the dApp nothing new. Unit tests
   pin each rule.
5. **It survives a closed popup and a restarted background.** The check lives on the journal row.
   An unresolved row is tracked again at the next background start and read once its profile is
   unlocked: strict security mode, the default, withholds the session across a restart, so checking
   resumes after unlock. A refused write (a lock while it waits for the journal) leaves the row
   tracked. A row deleted by a profile or chain purge is dropped at once.
6. **It says "went through" where the regular send path does.** A mined receipt of any status
   (`PROPOSED` to `FINALIZED`) is the answer, as `TransactionService.waitForTx` treats inclusion.
   Neither path handles a chain prune that removes an included transaction (F-4).

Good enough: the authwit popups keep the 60 s ceiling (F-1); a send still unconfirmed after 30
minutes stays so (F-2); a rare record that also has a `TransactionService` row shows two consistent
cards (realism 4); a chain prune after inclusion is caught by no send path (F-4).

## UI impact

| # | Surface | Before → after | Sign-off |
|---|---|---|---|
| 1 | Send's failure snack (over Home, after the Send page has left) | "Send failed · Simulation failed, transaction not sent" for every failure but the Terms and not-recorded ones, a timeout at 60 s included → three variants by what the wallet knows: nothing sent, not confirmed yet, status unknown (O4) | **signed: O4 (a), § P6** |
| 2 | The activity card of a failed transfer or dApp send (Home, History) | red "Transaction failed" → for a send that may have reached the node, the outcome: gray "Not confirmed yet", green "Sent", red "Reverted", amber "Unconfirmed" (O1); a failure the stage proves pre-broadcast keeps its card | **signed: O1 (a), § P6** |
| 3 | The journal page of a failed send ("What happened", Outcome, State) | transfer: "Send failed" / "…If it was already submitted, it may still go through."; dApp: "Reported by app" / "The connected app reported an error."; State "Failed" → the outcome's label and context, State from the outcome (O1), no Ended row while the check asks (§ P6); nothing sent: "Stopped before broadcast" with that label's approved context (O1, O3) | **signed: O1 (a), O3 (a), § P6** |
| 4 | The interrupted record (card and page) | "Interrupted mid-flight" / "The wallet restarted before confirming this. Transaction may still be on-chain — check the explorer." → a row stopped before `submitting`: "Your wallet stopped before sending this. Nothing was sent."; a row reaped at `submitting` becomes a checked send (row 2) (O1) | **signed: O1 (a), § P6** |
| 5 | Home's awaiting card while a transfer proves past 60 s | the card spins, then disappears at 60 s under a "Send failed" snack, and the send lands later → the card stays, unchanged, until the result | **blanket signed, § P6** |
| 6 | The journal page while its record's check answers | static until reopened → updates in place | **blanket signed, § P6** |
| 7 | Home and History after a failed send that went through (A6) | a "Received" row for the send's own change note (or a private FPC's fee change note), with the change amount → no such row; the checked send's card is the only row for it | **blanket signed, § P6** |

Nothing else a user sees changes. The dApp's error response is unchanged (this PR edits no file
under `wallet-sdk/` or `packages/wallet-bridge/`). A failure before `submitting` keeps its card
and its State "Failed"; `network/snack-placement.test.ts:198-225` pins the snack label "Send
failed", its Details action and that State, and stays green.

### UI asks for the owner (built as recommended, captured per option)

Answered in § P6 under the owner's delegation, with the copy edits P7 applies.

Three calls and one blanket. Every option is pictured (capture list in P6); the words beside each
picture are the recommendation, and the owner may edit any of them in the answer.

- **O1 · What a failed send says once the wallet can check.**
  - (a) the outcome replaces the failure (§ A4 table): gray clock "Not confirmed yet", green check
    "Sent", red "Reverted", amber "Unconfirmed", each with its "What happened" line.
  - (b) the red failure visual and State "Failed" stay; only the "What happened" line reports the
    outcome.

  Both options carry the rewritten interrupted line (UI impact row 4) and "Stopped before
  broadcast" for a proven pre-broadcast failure. Recommended and built: (a). A send that went
  through shown in red invites a second send. Confidence: moderate.
- **O3 · A failed dApp send that never reached the network.**
  - (a) the wallet's own label: "Stopped before broadcast" / "Your wallet caught this before
    reaching the network. Often balance, fees, or invalid call." (today's approved copy for
    simulation and prover failures);
  - (b) a neutral dApp label: "Not completed" / "This app's transaction couldn't be completed.
    Nothing was sent."

  Recommended and built: (a): one set of words for every send, and copy the owner has already
  approved. Confidence: moderate.
- **O4 · The Send failure snack's words.** Both options add two new snacks. "Send not confirmed ·
  Checking whether it reached the network. Don't send it again yet." (with Details) is for a send
  that may have reached the node. "Send status unknown · Check Activity before sending it again."
  is for no evidence either way: a lost connection, the 60-minute ceiling, or an unreadable record.
  The options differ for a failure the stage proves pre-broadcast:
  - (a) "Send failed · Nothing was sent. You can try again.";
  - (b) today's "Send failed · Simulation failed, transaction not sent".

  Recommended and built: (a): "Simulation failed" is false for a proof or node failure.
  Confidence: moderate.
- **The blanket sign-off** covers these rows, each with its picture:
  - B1 · Home while a proof takes long: no change. The awaiting card keeps "Proving in browser…"
    past 60 s until the result, and no snack appears at 60 s (UI impact row 5). Kept as today's
    behaviour because the false failure was the problem and the card already reads as in progress.
  - B2 · The journal page updates in place when its record's check answers (row 6).
  - B3 · A failed record whose transaction also has a settled activity row shows both cards, with
    the same outcome (realism 4).
  - B4 · A failed send that went through no longer shows its own change note as a "Received" row
    (UI impact row 7).
  - Text only, nothing visible changes: "Like every send today, 'went through' is decided when the
    transaction is included; a rare chain prune that drops it afterwards is not caught
    (follow-up)." (F-4)

## Architecture & Implementation

### A1 · The send waits for its record; the journal keeps what the check needs

**The `submitting` write is a precondition of the send.** Today both journal closures swallow a
failed write (`transfer-executor.ts:113-121`, `execution-lane.ts:487-493`), so
`proveAndSend` broadcasts whether or not `submitting` landed (`execution-coordinator.ts:342-344`),
and a reaper that already failed the row turns the `submitting` transition into a swallowed
`IllegalTransitionError`. `ProveAndSendContext` gains one required member:

```ts
/** Writes `submitting`; rejects unless the row now durably holds it. The send never runs otherwise. */
commitSubmitting: (patch: { txHash: string; submittedEndpointUrl: string | undefined }) => Promise<void>
```

The coordinator writes `submitting` through it instead of `markJournal` (`:342`), still before
`checkCancelled` and `sendTxTask`. The transfer executor binds it to `deps.transitionJournal`
without the catch; the dApp scaffold (`dapp-send-executor.ts:222-258`) adds it to its `run` context
from a new `ExecutionLane.commitJournal(journalId, progress)` (the same call as `markJournal`,
without the catch, throwing on a missing id). Both paths already fail closed on a missing row
(`transfer-executor.ts:132-136`, `claim-helper.ts:157`). A rejection is an ordinary failure: the catch
fails the row from its durable stage, which reads "nothing sent". `sendTxTask` is not edited, so
no await lands between `assertLive()` and `node.sendTx` and `legal/call-sites.test.ts:29-40` stays
exact. `submittedEndpointUrl` is the `primaryEndpointUrl(network)` each caller already computes
for its activity row (`transfer-executor.ts:200`, `dapp-send-executor.ts:524` via
`SentTx.network`, `:908`; the `aztec_sendTx` path at `:709` reuses its `sentTxRecorder`'s network).

`JobProgress` (`packages/wallet-core/src/jobs/types.ts:58-72`) grows:

```ts
export type SendCheckOutcome = "sent" | "reverted" | "unconfirmed"

| { stage: "submitting"; txHash?: string; submittedEndpointUrl?: string }
| { stage: "failed"; from?: ActiveStage; txHash?: string; submittedEndpointUrl?: string; check?: SendCheckOutcome }
```

`ActiveStage` is the five non-terminal stages. The zod mirror (`operation-journal/spec.ts:180-189`)
follows.

`OperationJournalService._transitionLocked` (`operation-journal/service.ts:342-367`) builds a
`failed` progress from the row it replaces, never from the caller:

```ts
function failedFrom(prior: JobProgress): JobProgress {
	if (prior.stage !== "submitting") return { stage: "failed", from: prior.stage }
	return { stage: "failed", from: "submitting", txHash: prior.txHash, submittedEndpointUrl: prior.submittedEndpointUrl }
}
```

Every writer of `failed` (the transfer catch, the dApp lane, the reaper's CAS transition) goes
through `_transitionLocked`, so none can forget the carry, and none can plant a hash, a stage or a
`check`: caller-supplied fields on `failed` are discarded.

A new in-process writer (not in `rpcMethods`), under the transition lock like
`updateProvingBackend` (`service.ts:414-432`):

```ts
/** Records the network's answer for a failed send, once. Writes only while the row is still
 *  `failed` with this hash and no answer, and while `isLive()` holds inside the lock. */
public async setSendCheck(id: string, txHash: string, check: SendCheckOutcome, isLive: () => boolean): Promise<boolean>
```

An answer is written once and ends the check. It is taken at inclusion, the point where the regular
send path calls a send confirmed (`transaction/service.ts:223-237`); it is not a claim of
finality, and a later chain prune is not caught (F-4). `false` only means "not written": the caller
decides from its own re-read (A2 step 7). It emits `onOperationUpdated`, which reaches only the
active profile's ports (`service.ts:137-141`).

Two shared predicates beside the types in `operation-journal/spec.ts`, so the background, the
snack and the card agree:

```ts
/** May have reached the node: it failed at `submitting` with a hash, and not at the send line's
 *  own liveness check, which throws before `node.sendTx`. */
export function isSendCheckable(op: OperationRecord): boolean   // from === "submitting" && txHash && kind !== "session_ended"
/** Proven not sent: it failed before `submitting`, or at that liveness check. */
export function wasNeverSent(op: OperationRecord): boolean
```

A row with no `from` (written before this change) is neither and keeps today's copy.
`duplicate_initialization` is checked: the transport retries a failed POST
(`packages/aztec-runtime/src/utils/fetch.ts:112-120`), so an accepted first attempt whose response
was lost can come back as "existing nullifier" (Ask C2). `session_ended` after `submitting` comes
only from `assertLive` (`execution-coordinator.ts:150`, `:300`); every other `SessionEndedError`
source runs before `submitting` (Fact 31).

### A2 · The check

`SendCheck`, a runtime component in `apps/extension/src/wallet/services/operation-journal/send-check.ts`,
beside the reaper and the GC, armed in `armPostStartWork` (`runtime.ts:607-645`) after the reaper
and stopped with it. Constructor-injected: the journal, `NetworkService`
(`getSingleAttemptNodeForUrl`), `ProfileService` (`captureExecutionFence`, `isFenceLive`),
`TokenBalanceService` (`refreshAccountBalances`), the logger, a clock.

Data and control flow:

1. `start()` subscribes to the journal's in-process `onOperationUpdated` (track) and
   `onOperationDeleted` (untrack), then scans `getOperations({ stage: "failed" })`. It tracks every
   record with `isSendCheckable(op) && op.progress.check === undefined`, due at once. The reaper's
   boot sweep (which fails `submitting` rows as `stale_on_resume`, `reaper.ts:233-244`) is picked up
   in either order. Per row, in memory: `{ id, profileId, txHash, url, terminalAt, nextAt, inFlight }`;
   an update for an id already tracked keeps its entry, so an in-flight read's guard survives it.
2. A single 5 s timer. Per tick: `fence = await profile.captureExecutionFence()`, and a throw
   (locked, or a deletion reserved) skips the tick. A row is due when `now >= nextAt`, it is not
   `inFlight`, and its `profileId === fence.profileId` (Ask C3). Other rows wait.
3. For a due row, with `inFlight` set until the read settles:
   - re-read it with `journal.getOperation(id)`, and untrack it unless it is still checkable with
     the same hash and no answer;
   - a row with no URL is written `unconfirmed` without a dial;
   - `live()`, then `node = await network.getSingleAttemptNodeForUrl(url)`: `getNodeForUrl`'s
     pinning (never `getNode(chainId)`), with one attempt per call, so no transport retry dials
     once the guard is false;
   - `live()`, then `receipt = await node.getTxReceipt(TxHash.fromString(txHash))`;
   - `live()` again before acting on the answer.

   `live()` is one guard for every dial and write:
   `isFenceLive(fence) && gen === this.generation && this.tracked.get(id) === entry`, with `gen`
   and `entry` captured when the read starts. So a lock, `stop()` (which bumps the generation) and a
   deletion (`onOperationDeleted` untracks the entry) each stop the next dial and the write, even
   mid-lookup. A false guard drops the read without writing. A receipt throw counts as no answer.
4. Decision, with the status mappers lifted out of `TransactionService` (A3):
   - mined (`Proposed`, `Checkpointed`, `Proven`, `Finalized`, all one verdict): `sent` for a
     success execution result, `reverted` for any other (the pinned SDK requires
     `executionResult` on a mined receipt, `@aztec/stdlib` 5.2.0 `src/tx/tx_receipt.ts:285`). The
     one invariant comment sits here: the verdict is taken at inclusion to match `waitForTx`.
     Write; once written, refresh the account's balances if `live()` still holds (step 7);
   - `Dropped`, `Pending`, or no answer: no write, keep checking. DROPPED is never evidence of
     non-submission (`transaction/service.ts:37-49`).
5. Cadence: `nextAt = now + 5 s` while `now - terminalAt < 2 min`, then
   `DROPPED_RECHECK_INTERVAL_MS` (15 s).
6. Window: `DROPPED_RESURRECTION_WINDOW_MS` (30 min) from `terminalAt`. The first due read past it
   is the last: a mined answer wins, anything else writes `unconfirmed`, and tracking ends once
   that write lands (step 7).
7. Every write goes through `setSendCheck(id, txHash, check, live)`. A `true` ends tracking. A
   `false` leaves the row tracked, due at the next tick: that tick's re-read (step 3) untracks a
   row that another writer answered, deleted or changed, and a row refused only because the fence
   lapsed while the write waited for the journal lock is read and written again once the profile
   is unlocked. A stopped watcher has no next tick.

Lifetime: the loop lives as long as the background, and reads only while the row's profile is
unlocked. An open popup keeps the worker alive. With the popup closed, the reaper's one-minute alarm
wakes the worker (`runtime.ts:639-641`), whose start tracks every unresolved row due at once
(Inference 2). Strict security mode is the default (`wallet/config/config.ts:26`) and persists no
session bearer, and outside it only a password profile with a DEK gets one
(`profile/session-manager.ts:300`); so after a restart the wallet is usually locked, every tick
skips, and the check resumes at once on unlock. The check keeps no counter that a restart could
lose. The journal is not in backups (Fact 20), so every URL it dials is
one the wallet wrote itself; `TransactionService`'s reason for not re-arming Dropped rows
(backup-restored URLs, `transaction/service.ts:115-119`) does not apply.

Logging: `debug` only, `{ journalId, outcome }` or `{ journalId, stage: "receipt-error" }`. Never
the hash, never the URL.

### A3 · Shared receipt rules

`transaction/receipt-status.ts` (new) exports `txStatusFromReceipt` and `executionResultFromReceipt`
(today's private `getTxStatus` / `getTxExecutionResult`, `transaction/service.ts:508-540`, moved
verbatim). `TransactionService` calls them; its behaviour and tests do not change. Its DROPPED
debounce stays its own: the check never turns DROPPED into an answer.

### A4 · What the popup shows

The outcome step runs before the kind switch in `journal-state.ts`:

```ts
export type SendOutcome = "nothing_sent" | "checking" | SendCheckOutcome
export function sendOutcome(op: OperationRecord): SendOutcome | null  // null: a row with no `from`
```

| Outcome | Card (state, icon, color, subtitle) | Journal page label / "What happened" |
|---|---|---|
| nothing_sent | unchanged: `failed`, `close-circle`, red, the kind's subtitle | `transfer`, `dapp_execute`: "Stopped before broadcast" / "Your wallet caught this before reaching the network. Often balance, fees, or invalid call." (O1, O3); interrupted kinds: "Interrupted before sending" / "Your wallet stopped before sending this. Nothing was sent."; `session_ended` and the other kinds: unchanged |
| checking | `checking`, `clock-circle`, gray, "Not confirmed yet" | "Not confirmed yet" / "Your wallet is checking whether this reached the network. Don't send it again yet." |
| sent | `sent`, `check-circle`, green, "Sent" | "Went through" / "The network confirmed this transaction." |
| reverted | `failed`, `close-circle`, red, "Reverted" | "Reverted" / "The network included this transaction, but it reverted. The fee was still paid." |
| unconfirmed | `unconfirmed`, `help`, amber, "Unconfirmed" | "Unconfirmed" / "Your wallet couldn't confirm this. It may still go through, so check History before sending it again." |

`JournalTerminalVisualState` gains `checking`, `sent` and `unconfirmed` (the amber visual under its
own name); `TransactionTerminalCard` gains a `subtitle_green` class. The journal page's State row
title-cases the new states. Its
`onOperationUpdated` handler reloads the record through `loadOp()` when the id matches, so the page's
existing scope predicate (`journal/[id].vue:185-201`) applies to every update. That predicate moves,
with the read it judges, into `readJournalDetail(client, id, scope)` in `journal-detail-scope.ts`,
which reads the scope when the read returns; beside it, `bindJournalDetailUpdates(client, id,
reload)` adds the update and `onConnected` listeners and returns the unbind the page calls in
`onBeforeUnmount`; both are unit-tested. Two touched
comments become false and are narrowed: the hero-meta comment's "journal records have no on-chain
tx" (`journal/[id].vue:251`) keeps only "no explorer link", and the `transfer` arm's "the failed
stage keeps no hash" (`journal-state.ts:218`) becomes "reached only by a record without `from`".
Option (b) of O1 is a capture-only build: the same outcome lines under the red failed visual.

The snack (`send-submit.ts:85-95`) picks its label and sub, in order:

1. the Terms and not-recorded refusals: unchanged;
2. `RpcTimeoutError`, `RpcDisconnectedError` or `isClientDisconnectRejection(err)`
   (`packages/extension-messaging/src/errors.ts:111`, the plain `Error("Client disconnected")` a
   real port drop produces) → "Send status unknown";
3. a journal id: the record it already reads for Details. `isSendCheckable` → "Send not confirmed"
   with Details; `wasNeverSent` → "Send failed" with O4's sub and Details; a failed read, a missing
   or mismatched record, or neither predicate → "Send status unknown";
4. anything else → "Send status unknown".

### A5 · The popup waits for the background

`ExecutionServiceClient` (`apps/extension/src/wallet/services/execution/client.ts:13-17`) overrides
the hook the PXE client already uses (`packages/aztec-runtime/src/pxe/client.ts:100-108`):

```ts
/** A transport deadline for a transfer whose outcome the popup cannot know sooner: proving in the
 *  browser can take minutes. Past it the journal still holds the answer. */
const EXECUTE_TRANSFER_TIMEOUT_MS = 60 * 60_000
protected override getRequestTimeoutMs(method: keyof Methods): number
```

The reaper's graces do not settle the executor's promise (`reaper.ts:199-205`), and the lane's
mutex has no timeout (`execution-lane.ts:14`), so the ceiling is a bounded deadline for an unknown
outcome, not a guarantee that the background answers first. Its rejection reads "Send status
unknown" (A4). Every other method keeps `DEFAULT_RPC_TIMEOUT_MS` (Ask C5).

### A6 · A checked send's own notes are not "Received"

`IncomingTransferService.collectInflightTxHashes` (`incoming-transfer/service.ts:2403-2417`) reads
only non-terminal journal rows, and its late-delete runs only on `onTransactionAdded`
(`:1255-1276`). A failed send that went through has no Tx row, so its change note, or a private
FPC's fee change note, would surface as a "Received" row with the change amount. It also collects
`progress.txHash` from `failed` rows of the same profile, network and account.

### File-level change map

| File | Change |
|---|---|
| `packages/wallet-core/src/jobs/types.ts` | `SendCheckOutcome`, `ActiveStage`; `submitting` and `failed` fields |
| `apps/extension/src/wallet/services/operation-journal/spec.ts` | zod mirror; `isSendCheckable`, `wasNeverSent` |
| `apps/extension/src/wallet/services/operation-journal/service.ts` (+ `service.test.ts`) | `failedFrom`; `setSendCheck` |
| `apps/extension/src/wallet/services/execution/execution-coordinator.ts` (+ test) | `commitSubmitting` in the context, used for `submitting` |
| `apps/extension/src/wallet/services/execution/transfer-executor.ts`, `dapp-send-executor.ts`, `execution-lane.ts` | bind `commitSubmitting`; `ExecutionLane.commitJournal` |
| `apps/extension/src/wallet/services/execution/service.composition.test.ts` | the lost-response case (P2) |
| `apps/extension/src/wallet/services/transaction/receipt-status.ts` (new), `transaction/service.ts` | the two mappers, moved |
| `apps/extension/src/wallet/services/operation-journal/send-check.ts` (new, + `send-check.test.ts`) | the check |
| `packages/aztec-runtime/src/ports/node-factory-port.ts`, `adapters/aztec-node-factory-adapter.ts` (+ test, new), `apps/extension/src/wallet/services/network/service.ts` (+ test), `apps/extension/src/core/testing/fake-node-factory.ts` | the check's one-attempt node client, pinned per URL |
| `apps/extension/src/wallet/runtime.ts` (+ `runtime.post-start.pins.test.ts`) | arm and stop `SendCheck` |
| `apps/extension/src/wallet/services/incoming-transfer/service.ts` (+ test) | collect failed rows' hashes |
| `apps/extension/src/wallet/services/execution/client.ts` (+ `client.test.ts`, new) | the `executeTransfer` ceiling |
| `apps/extension/src/popup/pages/send-submit.ts` (+ test), `popup/utils/transfer-failure-copy.ts` (+ test), `popup/pages/send.test.ts` | snack variants and their pins |
| `apps/extension/src/utils/journal-state.ts` (+ test) | the outcome step; the rewritten arms; the `transfer` arm's comment narrowed |
| `apps/extension/src/components/composite/activity/TransactionTerminalCard.vue` (+ test) | `green`; header comment cut to its invariants |
| `apps/extension/src/popup/pages/journal/[id].vue`, `journal-detail-scope.ts` (new, + test) | live update through `loadOp`; `readJournalDetail` (the scope predicate with its read) and `bindJournalDetailUpdates`; header comment cut to its invariants; the hero-meta comment narrowed |
| `apps/extension/tests/e2e/network/failed-send-check.test.ts` (new) | the DROPPED guard on a real node |
| `apps/extension/tests/e2e/network/transfers.test.ts` | one debug line: the public transfer's `terminalAt - createdAt` |
| `implementations-plan/failed-send-check/`, `implementations-plan/index.md` | plan, recon, lessons; index line |

### Trade-offs and alternatives not taken

- **Hand an ambiguous send to `TransactionService` as a pending row** (`outline-alt.md`): it
  inherits the settled card, the balance refresh and the authwit reconcile, but it needs the
  executor's activity record, which the reaper's sweep does not have, and it writes a Tx row for a
  transaction the node may never have seen.
- **Carry the hash in each caller** instead of the journal: three writers, one forgotten is a
  silent hedge; the journal is the one place all pass through (Ask C1).
- **Treat DROPPED past a debounce as "not sent"**: DROPPED also means the queried replica has not
  seen the hash, so it cannot prove non-submission, and "not sent" invites a second send.
- **Read "nothing sent" from a missing hash**: a best-effort `submitting` write can fail while the
  send goes out. The stage the row failed from, made trustworthy by the fail-closed write, is the
  evidence instead.
- **Classify a node's JSON-RPC refusal as "not sent" at once**: the error shape depends on the
  node's `http200OnError` and any proxy in front of it (`@aztec/foundation` 5.2.0
  `json-rpc/server/safe_json_rpc_server.js`), and the transport's retry can turn an accepted send
  into a refusal (Ask C8).
- **Learn the outcome from a journal subscription instead of the RPC reply**: the popup does not
  know the record's id until the reply (`JournaledRejection` names it only on failure,
  `transfer-executor.ts:218`), so the ceiling is the smaller change.
- **Keep checking forever while unlocked**: unbounded traffic about old sends.
- **Poll at `TransactionService`'s 1 s cadence**: nothing the person does depends on the first
  seconds.

## Security & Adversarial Considerations

- **Threat model.**
  - *The hash.* A `txHash` links a person's private activity. The check sends it only to the
    endpoint recorded with the send (pinned as `getNodeForUrl` pins, `network/service.ts:772-802`), which
    is the submitting node unless the profile's primary was edited during that send's build
    (Fact 12, realism 3); a row without a URL is never dialed, so the hash never reaches another profile's RPC or the active
    profile's primary.
  - *Cross-profile and lifetime.* The check captures the execution fence once per tick
    (`profile/service.ts:521-532`) and acts only on rows of that fence's profile. It re-checks one
    guard, `isFenceLive` (`:548-554`) plus the watcher's generation and the row's tracked entry,
    before each dial, after each await and inside `setSendCheck`'s lock. A lock, a switch, a begun
    deletion, a purge or `stop()` therefore stops the next dial and every write; a write refused by
    a lapsed fence leaves the row tracked, so the check is paused, never abandoned. A purge
    untracks the row through `onOperationDeleted` and, under the same lock
    (`operation-journal/service.ts:199-243`), leaves a late answer nothing to write. One read per
    row is in flight at a time, and `stop()` invalidates any read still out. Journal ids are
    random, and the journal is not in backups (Fact 20), so a restored profile cannot inherit a row.
  - *A dApp.* A dApp cannot make the wallet say a send went through: the hash is the wallet's own
    `tx.getTxHash()` (`execution-coordinator.ts:341`), the endpoint is the profile's configured
    one, and only the node's receipt for that hash writes `sent`. A dApp learns nothing new: no
    event, message or error changes on its side, and journal events reach only popup ports of the
    active profile (`service.ts:137-141`).
  - *Planting.* Nothing outside `_transitionLocked`'s carry can put a hash or a `from` on a failed
    row, and nothing but `setSendCheck` can write `check`; neither is reachable from the popup
    (`spec.ts:363-371`).
  - *A lying endpoint.* An endpoint that lies about receipts already controls the wallet's view of
    every transaction; the check trusts it no more than `TransactionService` does, and a DROPPED
    lie can only keep a send "not confirmed".
  - *Broadcast without a record.* Closed by the fail-closed `submitting` write (A1): a send the
    wallet cannot record as possibly sent does not go out, including one the reaper already failed.
- **Input validation.** The receipt's status goes through the same exhaustive mapper as today
  (unknown status throws, counted as no answer). The stored fields are zod-validated on read.
- **Logging.** `debug` only, named properties, never the hash or the URL; a unit test asserts no
  logger call at any level carries either. A failed read still leaves the SDK client's own warning,
  once per failed call as for every node call in the wallet, naming the endpoint, which the logger
  reduces to its origin. `submittedEndpointUrl` is already a redacted URL key
  (`wallet/logger/utils.ts:132`) should a record ever be logged whole.
- **The popup.** The record's new fields reach only the active profile's popup, which already
  shows the profile's endpoints in Settings; no surface renders the URL or the hash. The journal
  page applies its scope predicate to every live update.
- **The broadcast line.** Unchanged: `sendTxTask` is not edited, and no await is added between
  `assertLive()` and `node.sendTx` (pinned by `legal/call-sites.test.ts`, run in P1).
- **Least privilege, cryptography, supply chain.** No permission, credential, crypto or
  dependency changes.

## Assumptions

### Facts (verified at `f32b1e0a` by reading the file; the tree equals `48a97f4a`; #719's `85c4d20f` touches none of the cited code)

1. The `transfer` arm hedges and the `dapp_execute` arm blames the app:
   `apps/extension/src/utils/journal-state.ts:215-225`. The card's subtitle for both is "Transaction
   failed" (`failedSubtitleFor`, `:232-253`).
2. The interrupted arm says "Transaction may still be on-chain — check the explorer."
   (`journal-state.ts:206-211`), for `sw_restart_post_prove` and `stale_on_resume`.
3. The `failed` transition replaces `progress` wholesale (`operation-journal/service.ts:357-363`),
   and `JobProgress`'s failed variant has no field (`packages/wallet-core/src/jobs/types.ts:71`;
   zod `operation-journal/spec.ts:187`); `submitting` holds an optional hash (`types.ts:63`,
   `spec.ts:185`).
4. `proveAndSend` journals `submitting` with the hash (`execution-coordinator.ts:340-342`), then
   `checkCancelled`, then `sendTxTask` (`:343-344`), then `recordTransaction` (`:345`), then
   `succeeded` (`:346`). `sendTxTask` awaits the Terms check, then `assertLive()`, then
   `node.sendTx` (`:299-301`).
5. The only four `proveAndSend` callers are `transfer-executor.ts:161` and
   `dapp-send-executor.ts:595`, `:709`, `:885`; `node.sendTx` appears only in
   `execution-coordinator.ts` (`legal/call-sites.test.ts:25-27`).
6. The transfer catch fails the row with kind `transfer` unless classified
   (`transfer-executor.ts:209-218`); the dApp tail fails it with `dapp_execute` unless classified
   (`dapp-send-executor.ts:259-261` → `mark-failed-unless-cancelled.ts:29`); `failureKind`
   classifies only `DuplicateInitializationError` and `SessionEndedError` (`:35-39`).
7. The reaper fails a `submitting` row as `stale_on_resume` (boot sweep or after 5 min), `proving`
   as `sw_restart_post_prove` (boot) or `stuck_proving` (periodic), and every other stage but
   `queued` as `stale_on_resume`, periodic ticks included (`reaper.ts:74-84`, `:240-244`), through
   `transitionIfStage` → `_transitionLocked` (`reaper.ts:199-205`, `service.ts:529-549`).
8. The FSM's `submitting` leads only to `succeeded` or `failed` (`packages/wallet-core/src/jobs/fsm.ts:47`).
9. Today the `submitting` write is best-effort: both closures catch and log a failed transition
   (`transfer-executor.ts:113-121`, `execution-lane.ts:487-493`), and `proveAndSend` continues to
   `sendTxTask` either way (`execution-coordinator.ts:342-344`). So a failed row without a hash
   does not prove that nothing was sent until A1's fail-closed write lands.
10. `TransactionService` debounces DROPPED (`DROPPED_GRACE_MS` 60 s, `DROPPED_CONFIRMATIONS` 3),
    watches Dropped rows 30 min at 15 s (`transaction/service.ts:50-56`, `:411-427`), and documents
    that DROPPED also means "this replica never saw the hash" (`:37-49`). It pins the receipt read
    to `submittedEndpointUrl` (`:439-441`) and polls only while a profile is active (`:366-385`).
    Its status mappers are private (`:508-540`).
11. `getNodeForUrl` never falls back to the active profile's node (`network/service.ts:772-802`).
12. Every caller records `primaryEndpointUrl(network)` as the submitting endpoint
    (`transfer-executor.ts:200`, `dapp-send-executor.ts:524`, `:908`). The builder reads the network
    (`tx-request-builder.ts:223`), awaits account resolution (`:224`), then obtains the node it
    submits through (`:225`), apart from the caller's `network`; so the two agree unless the
    profile's primary is edited in between (realism 3). Nothing prevents that edit.
13. The popup's `ExecutionServiceClient` sets no per-method timeout (`execution/client.ts:13-17`),
    so `executeTransfer` gets `DEFAULT_RPC_TIMEOUT_MS`, 60 s (`packages/extension-messaging/src/background/client.ts:17`,
    `:43`), through `getRequestTimeoutMs` (`packages/extension-messaging/src/core/base-client.ts:109`,
    `:353-357`). The PXE client overrides the hook for `proveTx` with 30 min
    (`packages/aztec-runtime/src/pxe/client.ts:72`, `:100-108`).
14. The Send page leaves at once after submit (`popup/pages/send.vue:394-402`); the result is a
    snack from `submitTransfer`'s promise (`send-submit.ts:81-96`). On any rejection but a cancel,
    the snack is "Send failed" with `transferFailureCopy(err)`, which is "Simulation failed,
    transaction not sent" for everything but the Terms and not-recorded refusals
    (`transfer-failure-copy.ts:3-13`). A failed journal read withholds Details only
    (`send-submit.ts:114-120`).
15. #719's record (`implementations-plan/e2e-reliability-fixes/lessons/phase-6.md:76-87` at
    `85c4d20f`, § The red leg) reports that on Firefox prover-ON without
    Presto the popup raised that snack at 60 s with `RpcTimeoutError: RPC 'executeTransfer' timed
    out after 60000ms`, while the journal row reached `succeeded` at 86 to 94 s, on the base
    `0fa5a2cb` too. Recorded evidence, not reproduced for this plan.
16. The popup reads the journal only through two active-profile-gated reads
    (`operation-journal/spec.ts:363-371`, `service.ts:119-131`); events reach only the active
    profile's ports (`service.ts:137-141`); every write is in-process. These are the existing gates;
    a queued event can still arrive after a scope switch (A4 handles it).
17. `updateProvingBackend` is the precedent for an in-stage write under the transition lock
    (`service.ts:414-432`).
18. The activity feeds apply `onOperationUpdated` (`RecentActivityView.vue:567-568`,
    `activity.vue:99-100`); the journal page listens only for deletion (`journal/[id].vue:204-211`)
    and re-checks profile, network and account on load (`:185-201`).
19. `TransactionTerminalCard` styles `gray`, `amber` and `red` only
    (`TransactionTerminalCard.vue:89-95`); `TransactionCard` uses `check-circle` green,
    `clock-circle` gray, `close-circle` red and reads mined with an undefined result as success
    (`TransactionCard.vue:72-86`); `help` is in `packages/design/src/internal/icons.json`.
20. The journal is not in backups: `OperationJournalService` does not override `backup`, whose
    default returns `null` (`packages/extension-messaging/src/background/service.ts:100-102`).
21. `armPostStartWork` arms the reaper and the GC right after `services.start()`, and the reaper's
    minute alarm is what wakes a closed-popup worker (`runtime.ts:607-645`, `:639-641`).
22. `TokenBalanceService.refreshAccountBalances` exists (`token-balance/service.ts:253`) and today
    runs only from `onTransactionUpdated` (`:604-621`).
23. `URL_KEYS` includes `submittedEndpointUrl` (`wallet/logger/utils.ts:132`).
24. The proof gate auto-releases after 20 s (`apps/extension/src/e2e/chrome-storage-proof-gate.ts:19`),
    and `LEGAL_ACCEPTANCE_KEY` is `nulo:legal:accepted` (`packages/legal/src/status.ts:3`);
    `LegalAcceptanceService` keeps no cache (CLAUDE.md § Terms acceptance).
25. `network/snack-placement.test.ts:198-225` drives a failure before `submitting` (an off-curve
    shield) and asserts the snack "Send failed", its Details action and State "Failed".
26. `journal-state.test.ts` pins the arms this plan changes (`:475-495`). The draft recorded one
    passing run (74 tests); not re-run for this revision.
27. `captureExecutionFence` throws when locked or when the active profile's deletion is reserved,
    and `isFenceLive` answers synchronously (`profile/service.ts:521-532`, `:548-554`).
28. A real port drop rejects every pending request with the plain `Error("Client disconnected")`
    (`packages/extension-messaging/src/background/client.ts:80-96`; pinned by
    `background/client.test.ts:594-604`), which `isClientDisconnectRejection` matches
    (`packages/extension-messaging/src/errors.ts:111`).
29. The JSON-RPC transport retries on 5xx and network errors (`packages/aztec-runtime/src/utils/fetch.ts:112-120`),
    and a send that initializes the account classifies "existing nullifier" as
    `DuplicateInitializationError` (`execution-coordinator.ts:163-166`, `:303-309`).
30. `collectInflightTxHashes` reads only non-terminal rows (`incoming-transfer/service.ts:2403-2417`);
    the late-delete runs only on `onTransactionAdded` (`:1255-1276`).
31. `SessionEndedError` is thrown by `assertLive` (`execution-coordinator.ts:150`) and otherwise
    only before a send's `submitting` write (`execution-lane.ts:359`, `execution/service.ts:1003`,
    `transfer-estimate-reuse.ts:177`, `operation-estimate-reuse.ts:139`, `transfer-executor.ts:136`,
    `profile/service.ts:540`, `claim-helper.ts:166`). `addTransaction`'s fence check throws
    deletion and owner errors, not it (`transaction/service.ts:181-185`).
32. The dApp scaffold refuses a send it could not record (`claim-helper.ts:157`), and the transfer
    creates its row fail-closed (`transfer-executor.ts:132-136`), so `proveAndSend` always runs with
    a journal id.
33. Strict security mode is the default (`wallet/config/config.ts:26`, frozen by
    `config.test.ts`) and persists no session bearer; outside it, only a password unlock of a
    password profile with a DEK persists one (`profile/session-manager.ts:300`). So after a worker
    restart the wallet is locked unless that bearer exists (`:10-14` describes the mirror).
34. `TransactionService.waitForTx` settles once the hash leaves the pending queue
    (`transaction/service.ts:223-237`), and the watcher stops polling a mined tx (`:490-503`): the
    regular send path treats inclusion as the answer. `@aztec/stdlib` 5.2.0 has four mined statuses,
    `PROPOSED` to `FINALIZED` (`src/tx/tx_receipt.ts:22-42`), and a mined receipt's schema requires
    `executionResult` (`:285`). The wallet treats the checkpointed tip as prunable for incoming
    records (`orphanedByReconciliation`, `incoming-transfer/service.ts:2421-2432`).

### Inferences (unverified; audits attack these)

1. A node answers DROPPED for a hash it never received (the premise of `transaction/service.ts:37-49`;
   the same-family audit read it in Aztec 5.2.0's `modules/node_tx_receipt.js:40-41`, not
   re-verified here). The new network spec is the first proof on this path.
2. With the popup closed, the check advances only while the worker is awake and the row's profile
   unlocked: the reaper's minute alarm and any dApp or popup traffic, a few reads per wake at the
   15 s cadence. In the default strict mode a restarted worker is locked (Fact 33), so checking
   pauses until the next unlock. With no counter to reach, this only delays an answer.
3. After a restart, an unresolved check resumes on the first tick after its profile is unlocked
   (Fact 33); the unit test drives restart, locked, unlock, resume.
4. A node answers a receipt for a mined tx long after mining, so the last read past the window is
   still informative. This is about readability, not permanence: a pruned block is F-4.
5. `RpcTimeoutError` at 60 s is the only cause of today's false "Send failed" during a long prove
   (#719's console capture shows it); nothing else in the popup waits on the proof.
6. Removing `nulo:legal:accepted` while the proof gate holds a send makes `sendTxTask` refuse after
   the `submitting` write, which gives the new spec a failed row with a hash the node never saw.
7. `refreshAccountBalances` for a landed transfer shows the new balance without waiting for another
   trigger.

### Asks

**Owner** (each built as recommended; the capture list is P6)

- **O1 · What a failed send says once the wallet can check.** (a) the outcome replaces the failure
  (§ A4 table); (b) the failure stays and only "What happened" reports it. Recommendation: (a).
  Confidence: moderate.
- **O3 · A dApp send stopped before broadcast.** (a) "Stopped before broadcast" with today's
  context; (b) "Not completed" / "This app's transaction couldn't be completed. Nothing was sent."
  Recommendation: (a). Confidence: moderate.
- **O4 · The Send failure snack.** (a) "Send failed · Nothing was sent. You can try again." for a
  proven pre-broadcast failure; (b) today's sub. Both show the "Send not confirmed" and "Send
  status unknown" snacks. Recommendation: (a). Confidence: moderate.
- **Blanket sign-off**: B1 (Home past 60 s, no change), B2 (the live journal page), B3 (two cards),
  B4 (no "Received" row for a checked send's own change note), and the text-only inclusion line (F-4).

**Codex** (round 1 and the final fresh pass recorded; none open)

- **C1 · The record the send depends on**: the fail-closed `submitting` commit, and the carry of
  hash, URL and `from` in `_transitionLocked` with caller fields discarded. Round 1: approve,
  subject to durable submission gating; applied (A1). Final: approve. Confidence: high.
- **C2 · Which failures are checked**: every failure from `submitting` with a hash but
  `session_ended`. Round 1: amend to include `duplicate_initialization`; applied. Confidence:
  moderate. Final: approve.
- **C3 · Whose session the check runs in**: a fence captured per tick, re-checked after every await
  and inside the write, one read in flight per row, untrack on delete, invalidate on stop. Round 1:
  amend with session fencing and deletion or stop handling; applied. Final: amend: one guard
  (fence, watcher generation, tracked entry) on every dial and write, and a refused write keeps
  the row tracked; applied (A2 steps 3 and 7). Confidence: high.
- **C4 · Bounds**: 5 s for two minutes, then 15 s, 30 minutes from `terminalAt`, a last read past
  the window; DROPPED never an answer; unresolved rows resumed at start. Round 1: amend (DROPPED
  finality, restart policy); applied. Final: amend with the restart default (checking resumes
  after unlock); applied (A2 lifetime, Fact 33). Its finality amendment is the disputed point,
  ruled for the driver: the verdict stays at inclusion (Decision ledger). Confidence: moderate.
- **C5 · The popup's ceiling for `executeTransfer`**: 60 minutes, that method only, described as a
  transport deadline for an unknown outcome. Round 1: amend (drop the guaranteed-answer claim);
  applied. Final: approve. Confidence: moderate.
- **C6 · The network spec**: a Terms lapse during a held proof, as one focused DROPPED guard, not
  the only proof. Round 1: reject as the sole browser proof; applied: the lost response is proved
  by C9, the long proof by the measured Firefox gate. Final: amend: the DROPPED observation ends
  from the record's `terminalAt`, not a fixed 90 s; applied (P5). Confidence: moderate.
- **C7 · A balance refresh on `sent` and `reverted`**, inside a live fence. Round 1: approve with
  fencing; applied. Final: approve. Confidence: moderate.
- **C8 · Short-circuit a node's JSON-RPC refusal to "not sent"**. Round 1: approve the "no";
  unchanged. Final: approve. Confidence: high.
- **C9 (new) · Where the lost response is proved**: a case in
  `execution/service.composition.test.ts`, whose harness already fakes `proveTx` and `toTx` with a
  canned hash and asserts only whether `sendTx` was called (COMPOSITION-TESTS.md D1 carve-out). The
  fake node's `sendTx` records the call and rejects with a network error; the real journal and a
  real `SendCheck` then read a canned mined receipt. It asserts one `sendTx` call, the row failed
  from `submitting` with the hash, then `check: "sent"` and the card's "Sent", read after the
  executor's promise settled. It proves the lost response, not popup closure: that is P3's client
  disposal and P4's unbind. The hash is `0x` + 64 hex so `TxHash.fromString` parses it without bb.
  Final: approve the case, reject its popup-closure claim; applied. Confidence: moderate.

### Plan audit ledger

Round 1 ran in parallel on the draft; both legs saw the plan, `recon.md` and `outline-alt.md`. The
final fresh pass read the revised plan, `recon.md`, the brief and the driver's round-1 decisions;
its findings are rows F1 to F8, applied under the driver's final rulings.

- Opus 5.5 (same-family leg): **conditional approve**, confidence moderate-high (M1 to M3 before
  build).
- `/codex high` round 1 (GPT-6 Astra, session `01a0edcd-8750-7e80-85d1-145c5aaa1d14`): **reject**,
  confidence high.
- `/codex high` final fresh pass (GPT-6 Astra, session `01a0edef-5c05-7482-b61d-51934923c7f6`):
  **reject**, confidence high (F1 and F2 major; F1 disputed and ruled for the driver, F2 to F8
  applied).

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| 1 | codex | major | DROPPED cannot justify "Not sent" or retry advice | accepted: `not_sent` removed; DROPPED keeps "Not confirmed yet"; the window ends "Unconfirmed"; nothing sent only when the stage proves it (A1, A2, A4, O1) |
| 2 | codex | major | A missing hash does not prove nothing was broadcast; the `submitting` write is swallowed | accepted: fail-closed `commitSubmitting`; `from` records the durable stage; unit test for a rejected write then working storage, zero broadcasts (A1, P1) |
| 3 | codex, Opus M1 | major, medium | Ownership checked once per tick; a deleted row keeps being dialed | accepted: per-tick fence, `isFenceLive` after every await and inside the write, re-read before each dial, untrack on `onOperationDeleted`, one read in flight, stop generation (A2, P2) |
| 4 | codex | major | The recorded URL can differ from the submitting node after a primary switch | rejected: unrealistic under the owner's rule (a switch between two reads inside one build); at worst the send stays "not confirmed", never "not sent"; realism 3 |
| 5 | codex, Opus L5 | major, low | Restart abandons the late-mine watch; the backup reason does not apply | accepted: every unresolved row inside its window resumes at start; no `not_sent` state is left to strand (A2) |
| 6 | codex | major | A real disconnect is a plain `Error`; a failed journal read is not evidence | accepted: `isClientDisconnectRejection`, and a failed or missing read reads "Send status unknown" (A4, P3) |
| 7 | codex | major | A lost response retried by the transport can come back as duplicate initialization | accepted: `duplicate_initialization` with a hash is checked (A1, C2); realism 9 for the genuine race |
| 8 | codex | major | Live updates on the journal page bypass its scope checks | accepted: updates go through `loadOp()` and its scope predicate, now a tested helper; reload on reconnect; unsubscribe on unmount (A4, P4) |
| 9 | codex, Opus L2 | minor, low | The ceiling's "background answers first" comment is false | accepted: described as a transport deadline for an unknown outcome; tests for delayed success, disconnect and pending-map cleanup (A5, P3) |
| 10 | codex, Opus L3 | major, low | The Terms trigger misses the lost response; the Firefox gate is host-speed dependent | amended: the lost response and popup close are proved in the composition layer (C9), the Terms spec stays one focused DROPPED guard, and the Firefox gate counts only a run whose measured prove time exceeds 60 s (P2, P5) |
| 11 | codex | minor | Fact and recon corrections; narrating header comments | accepted: Facts 9, 12, 15, 16, 26 corrected; recon's receipt trail and overlap claim fixed; P6 pictures the blanket rows; both header comments cut to their invariants |
| 12 | Opus M2 | medium | A DROPPED answer can end as "couldn't reach the network" | amended: the window-end copy no longer names a cause ("Unconfirmed"); no streak exists to reset, since DROPPED is never an answer (per codex 1) |
| 13 | Opus M3 | medium | A landed failed send's own change note shows as "Received" | accepted: `collectInflightTxHashes` also reads failed rows' hashes; unit test (A6, P2) |
| 14 | Opus L1 | low | Mined with an undefined result would read "Reverted" | accepted: `reverted` only for a defined non-success result (A2) |
| 15 | Opus L4 | low | Inference 3 is false by default: the session survives suspends | accepted: Inference 3 restated; Fact 33 added |
| 16 | Opus L6 | low | `sent` skips `TransactionService` settlement consumers | accepted: realism 7 widened; F-3 for the public-authwit index |
| 17 | Opus L7 | low | "The wallet restarted before sending this" is false for a periodic reap | accepted: "Your wallet stopped before sending this. Nothing was sent." in O1 (UI impact row 4) |
| F1 | codex final | major | A `PROPOSED` or `CHECKPOINTED` receipt can be pruned, so "every answer is final" can leave a false "Sent" | rejected as a condition, disputed, ruled for the driver: the verdict stays at inclusion, where `waitForTx` already calls a send confirmed (Fact 34); every finality claim removed (S1, Outcome 6, A1, A2 step 4, Inference 4); `PROPOSED` and `CHECKPOINTED` pinned to `PROVEN`'s verdict (P2); the prune gap is wallet-wide follow-up F-4 and a text-only blanket line |
| F2 | codex final | major | A lock while `setSendCheck` waits for the journal lock strands the row; the write guard ignores `stop()` | accepted: one `live()` guard (fence, generation, tracked entry) on every dial and write; a `false` write keeps the row tracked and the next re-read decides (A2 steps 3 and 7); tests for lock then unlock during the write wait, stop during it, and deletion during `getNodeForUrl` (P2) |
| F3 | codex final | minor | Strict mode is the default, so a restart does not keep the session | accepted: Fact 33 corrected (`config.ts:26`, `session-manager.ts:300`), Outcome 5, A2 lifetime and Inferences 2 and 3 say checking resumes after unlock; test restart, locked, unlock, resume (P2); the default is untouched |
| F4 | codex final | minor | C9 does not prove popup closure; P4 tests no subscription cleanup; 90 s is not two minutes from `terminalAt` | accepted: P3 disposes a pending client and reopens one, asserting no pending entry, timer or port listener; P4 tests `bindJournalDetailUpdates`' unbind; P5 observes until 150 s past the record's `terminalAt`; P3's disconnect and pending-map cases labelled pins; C9 keeps only the lost-response claim |
| F5 | codex final | minor | A6 hides "Received" change-note rows without owner coverage | accepted: UI impact row 7, blanket row B4, before and after in P6's capture list |
| F6 | codex final | minor | Two touched comments become false | accepted: `journal/[id].vue:251` and `journal-state.ts:218` narrowed (A4); the one invariant comment at the verdict (A2 step 4) |
| F7 | codex final (on L4) | minor | The endpoint-pinning guarantee is stated unconditionally | accepted: S1, the threat model and Fact 12 state its limit (`tx-request-builder.ts:223-225`); realism 3 reworded as a limit, not an impossibility |
| F8 | codex final (on L14) | minor | The mined-with-undefined-result test is unrealistic: the pinned SDK requires `executionResult` | accepted: test deleted, A2 step 4 reads `sent` for success and `reverted` otherwise; realism 12 |

### Decision ledger

- **Outline**: the journal-row check (this plan) over `outline-alt.md`, confirmed by both legs: it
  covers the recorder failure and the reaper's sweep, which the alternative cannot build a Tx row
  for, and it never writes a Tx row for a send the node may not hold.
- Rejected alternatives: § Trade-offs.
- **Owner asks trimmed to three** (driver, round 1): O2 had "no change" as its recommendation, so
  it is blanket row B1 with its picture.
- **Realism** (owner rule, 2026-09-29: "let's cover realistic scenarios"). Each line: no fix, no
  test, no owner question unless it says otherwise.
  1. A `chrome.storage.local` write failing is unrealistic. The fail-closed `submitting` write
     costs one unit test, not an e2e.
  2. A Terms refusal between the `submitting` write and `node.sendTx` needs the acceptance to lapse
     during a proof after `executeTransfer`'s own early check passed (`execution/service.ts:481`).
     That is test-only. It is checked conservatively ("Not confirmed yet", then "Unconfirmed"), and
     the spec uses it on purpose.
  3. A primary endpoint edited during one send's build (codex finding 4; nothing prevents it, since
     the builder awaits account resolution before it obtains the node, `tx-request-builder.ts:223-225`):
     the check dials the recorded URL, the same profile's, so the pinning holds only without that
     edit, and at worst the send stays "not confirmed", never "not sent". A person editing their
     endpoint in the seconds of a build is not a realistic case; the plan states the limit instead
     of claiming it away.
  4. A failed record whose transaction also has a `TransactionService` row (a `sendTx` that hung
     past the reaper's 5-minute grace, then recorded) shows two cards with the same outcome. No
     dedup; B3.
  5. Failed records written before this change have no `from` and keep today's copy. Pre-production:
     developers reinstall.
  6. A background wedged past the popup's 60-minute ceiling: the snack says "Send status unknown",
     which is true.
  7. After a checked "Sent": the gas balance cache stays up to its 5-minute TTL
     (`GAS_BALANCE_TTL_MS`, `execution/gas-balance-reader.ts:27`), and `GasBalanceCard`'s
     `onTransactionAdded` does not fire. A dApp send whose recorder failed leaves its public
     authwit out of the revoke index (F-3).
  8. A cancel landing between the `submitting` write and the next `checkCancelled`, microseconds
     apart, leaves a row the reaper fails at `submitting`; it is checked and ends "Unconfirmed".
  9. A genuine first-tx race (another device initialized the account first) reads "Not confirmed
     yet", then "Unconfirmed", instead of its retry copy. Two devices sending a first tx at once is
     rare; the conservative copy is still true.
  10. A check paused for its whole window (wallet locked, or another profile active) makes one read
      at the next unlock: mined wins, anything else reads "Unconfirmed". Common, not rare, in the
      default strict mode (a restarted worker is locked, Fact 33), so P2 tests it.
  11. In scope because they are realistic: a node that answers slowly or not at all (the check
      keeps polling, one read at a time), a popup closed mid-send (the check lives on the row),
      Firefox's WASM proving (S2), a lost `sendTx` response on a flaky connection (C9), a mined
      send that reverted.
  12. A mined receipt with no execution result: the pinned SDK's schema requires `executionResult`
      (`@aztec/stdlib` 5.2.0 `src/tx/tx_receipt.ts:285`), so no node answer reaches the mapper
      without one. No test (codex final F8).
  13. Found in build (P1): a Cancel pressed as the proof ends can reach the journal before the
      `submitting` commit, which the fail-closed write then refuses. Today's code reports that as
      a cancel; so does this one: the coordinator checks for a cancel when the commit rejects. A
      real person can press Cancel at that moment, so it has a pin test
      (`execution-coordinator.test.ts`).
  14. Found in review (post-implementation round 1, finding 3): the snack reads "checking" for a
      record the check already answered only if the check's first read (a tick 0 to 5 s after the
      failure, then a node round trip) lands before the popup's own read, one in-browser round trip
      after the rejection, and only for a transaction already in a block when its send failed.
      The snack would still say "Don't send it again yet". No fix; new snack copy would be the
      owner's.
- **Disputed, settled by the driver after the final pass: when "went through" is decided.**
  - Codex: a `PROPOSED` or `CHECKPOINTED` block can be pruned, so require finality before writing
    an answer, route the timing to O1, and test Proposed → Dropped.
  - Driver: the regular send path already calls a send confirmed at inclusion (`waitForTx`,
    `transaction/service.ts:223-237`; the watcher stops at mined, `:490-503`), so a finality-only
    check would read "not confirmed yet" for an epoch's proof where the regular path says it went,
    a visible inconsistency the owner never saw, beyond the queued item.
  - Ruling (driver): the verdict stays at inclusion. No finality claim anywhere; `PROPOSED` and
    `CHECKPOINTED` pinned to `PROVEN`'s verdict; no Proposed → Dropped test, since nothing
    implements that transition; the prune gap is wallet-wide F-4 and one text-only blanket line.
    What Aztec does with a pruned tx's receipt is unverified.
- No other point is open. The final pass's other findings and Ask amendments were applied as
  worded.

### Post-implementation audit

`/codex high`, one session over `85c4d20f...HEAD`; the rounds' detail is in `lessons/phase-5.md`.

| # | Round | Severity | Finding | Verdict |
|---|---|---|---|---|
| R1.1 | 1 | major | The retrying node client let a failing read's later attempts send the hash after a lock, a switch, a deletion or `stop()` | accepted: the check reads through a one-attempt client pinned to the same URL (A2 step 3) |
| R1.2 | 1 | minor | A failing read logs the endpoint above `debug` through the SDK | accepted in part: the transport's retry lines are gone with R1.1; the SDK client's one warning per failed call stays, as for every node call, with the URL reduced to its origin (Security, Logging) |
| R1.3 | 1 | minor | The snack reads "checking" for a record already answered | rejected: realism 14 |
| R1.4 | 1 | minor | The network spec passes with no check running | accepted: the spec reads the node's DROPPED for the hash, ages the row past the window, restarts the background and requires "unconfirmed" after the unlock (P5) |
| R1.5 | 1 | nit | A test header names a review round | accepted: cut to its invariant |
| R2.1 | 2 | nit | The one-attempt client cache's comment says the SDK never frees a client; its registry holds each through a `WeakRef` | accepted: the comment states the cache's bound |

Round 2 approved: R1.1, R1.4 and R1.5 confirmed fixed, R1.2's remainder and R1.3's rejection
accepted. The loop converged there. Round 3, on P7 (`3e92530c..4db69ddb`): approve with no
finding; it confirmed the Unconfirmed state, the Ended row, the refusal pin's comment and a
`scope_refused` row's path through `kindLabel`.

### Follow-ups

- **F-1 · The authwit popups keep the 60 s ceiling.** `revokeAuthwits` and `setRegistryEnabled`
  await a full proof (`auth-registry/service.ts` → `executeSendTransaction`), called from
  `RevokeAuthwitsPopup.vue:103` and `ChangeAuthwitsRegistryPopup.vue:59` through
  `AuthRegistryServiceClient`, which sets no per-method timeout. On Firefox without Presto they
  report a failure the background does not have. The same override fixes it; what the popups then
  show while waiting is an owner call.
- **F-2 · A definitive "won't go through".** DROPPED cannot prove non-submission (codex round 1), so
  an unconfirmed send stays so. An Aztec tx carries an expiry after which no block can include it;
  a check that knows the expiry and the chain's time could say "won't go through, you can send it
  again". Unverified: the field's name and shape at Aztec 5.2.0. Its own plan.
- **F-3 · The public-authwit index for a checked dApp send.** A dApp send whose `sentTxRecorder`
  never ran leaves a live public authwit the revoke UI cannot see (`dapp-send-executor.ts:516-535`,
  `auth-registry/service.ts:115-125`). Pre-existing; it becomes visible when the check writes
  `sent`.
- **F-4 · A chain prune after inclusion is caught by no send path.** `@aztec/stdlib` 5.2.0 counts
  `PROPOSED` and `CHECKPOINTED` as mined (`src/tx/tx_receipt.ts:22-42`), and blocks at those
  statuses can be pruned (codex final pass). `TransactionService.waitForTx` settles at inclusion
  (`apps/extension/src/wallet/services/transaction/service.ts:223-237`) and the watcher stops at
  mined (`:490-503`); this plan's check matches it. The wallet already treats the checkpointed tip
  as prunable for incoming records (`orphanedByReconciliation`,
  `apps/extension/src/wallet/services/incoming-transfer/service.ts:2421-2432`). Wallet-wide: every
  "went through" would need a re-read until proven or finalized, with its own copy. Unverified: what
  a node answers for a pruned tx's hash. Its own plan.

- **F-5 · A failed card beside a settled row for the same send.** B3 shows both cards, with the
  same outcome (realism 4); hiding the failed card when a settled row carries its hash is the
  panel's ask. Codex would have blocked B3 on it (§ P6).
- **F-6 · A neutral snack style for "Send not confirmed".** The snack keeps the error kind's red
  icon, which reads as a failure (§ P6).
- **F-7 · The status colours' contrast in the light theme** (the gray, amber and green subtitles on
  the cards and the page), from the panel (§ P6).
- **F-8 · A node's refusal at the send line reads "Not confirmed yet".** An unfunded sponsor or a
  fee per gas below the base fee makes the node throw `Invalid tx: <reason>`, a per-call JSON-RPC
  error on an HTTP 200 that the transport never retries; the row fails from `submitting` with its
  hash and reads "Not confirmed yet", then "Unconfirmed" after 30 minutes
  (`execution/service.composition.test.ts` pins it). A refusal can also follow a retried POST
  whose first attempt the node took, so ending such a row "failed" at once needs the send's
  transport to report an earlier failed attempt, and copy for "the network refused it" (Trade-offs;
  Ask C8). Related: `follow-ups.md`'s funding check for Nulo's sponsor.
- **F-9 · A checked record shows no tx hash or explorer link.** The owner's standing call is
  "ALWAYS link the tx hash where an explorer URL exists" (`incoming-public-transfers/plan.md`,
  decision L21); this plan's scope left the journal page's links out.
- **F-10 · Home's error snack covers the row above the tab bar.** It sits 12 px above the footer
  and stays until closed, so it covers the lower half of an awaiting card's cancel × there. After
  a background restart the card is the reported send's, until the restarted background reaps its
  row (§ P6).

## Approval

_The final fresh codex pass is applied (ledger rows F1 to F8, its dispute ruled by the driver).
Pending: the approval gate._

**Delivery boundary** (the same rule in P6 and Delivery): the PR opens and CI runs while the
owner's answers are pending, but it does not merge until the owner's answers to O1, O3, O4 and the
blanket sign-off are quoted in this plan.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/failed-send-check/lessons/phase-N.md`. Unit and component
commands run from the workspace named. Every phase writes its failing test first and records the
red run in its lessons file before the fix. A test listed as a pin is green before and after.

### P0 · Plan in the tree ✓

1. First commit: `implementations-plan/failed-send-check/` (`plan.md`, `recon.md`) and one line in
   `implementations-plan/index.md`.

Validation gate:
- Commands: `bun run lint`; `bun scripts/ci-cd/plans/check.ts`.
- Pass criteria: both exit 0; the plans check reports no enforced finding for the new directory.
- Layers: lint, CI-gating.

### P1 · The send waits for its record; the journal keeps it (A1) ✓

Assumptions: Facts 3 to 9, 16, 17, 29, 31, 32; Asks C1, C2.

1. Red, in `apps/extension/src/wallet/services/operation-journal/service.test.ts`: a row moved
   `submitting` (with a hash and a URL) → `failed` keeps both and `from: "submitting"`; a row moved
   `proving` → `failed` stores `{ stage: "failed", from: "proving" }`; caller-supplied `txHash`,
   `from` or `check` on `failed` are discarded; the reaper's `transitionIfStage` carries the same.
   `setSendCheck` writes and emits on a matching failed row, and returns `false` for a missing row,
   another hash, a non-failed stage, a row that already has an answer, and `isLive()` false.
   `isSendCheckable` and `wasNeverSent` tables: `transfer`, `dapp_execute`, `stale_on_resume`,
   `duplicate_initialization` from `submitting` with a hash are checkable; `session_ended` from
   `submitting` is never sent; every kind from an earlier stage is never sent; a row with no
   `from` is neither.
2. Red, in `execution-coordinator.test.ts`: the `submitting` write goes through `commitSubmitting`
   with the context's `submittedEndpointUrl`; a `commitSubmitting` that rejects once, followed by
   storage that works again, ends with `node.sendTx` never called and the row failed from
   `proving`; a row the reaper already failed makes the commit reject and the send never run.
3. Build A1: the types, the zod mirror, `failedFrom`, `setSendCheck`, the predicates,
   `commitSubmitting`, `ExecutionLane.commitJournal` and the four callers.

Validation gate:
- Commands: from `packages/wallet-core`, `bun --bun vitest run src/jobs`; from `apps/extension`,
  `bun --bun vitest run src/wallet/services/operation-journal src/wallet/services/execution
  src/wallet/services/legal/call-sites.test.ts`; `bun run lint`; `bun run typecheck:all`.
- Pass criteria: every command exits 0; the red runs recorded; `legal/call-sites.test.ts` green
  and unedited.
- Layers: typecheck, lint, unit, composition (the existing execution composition test).

### P2 · The check (A2, A3, A6) ✓

Assumptions: Facts 10, 11, 20 to 23, 27, 30, 33, 34; Inferences 1 to 4, 7; Asks C3, C4, C7, C9.

1. Move the two mappers into `transaction/receipt-status.ts`; `transaction/service.test.ts` and
   `service.dropped.test.ts` stay green unchanged.
2. Red, `operation-journal/send-check.test.ts` (fake journal, network, profile service, balances,
   fake timers; receipts wire-shaped, hashes `0x` + 64 hex):
   - mined success writes `sent` and refreshes the account; mined reverted writes `reverted`;
     `PROPOSED` and `CHECKPOINTED` give the same verdict as `PROVEN`;
   - DROPPED, Pending and a receipt throw never write, before or after two minutes;
   - the window's last read writes `unconfirmed` for DROPPED and for no answer, and a mined last
     read wins;
   - the receipt is read through `getSingleAttemptNodeForUrl(row URL)`, never `getNodeForUrl` or
     `getNode`; a row with
     no URL is written `unconfirmed` without a dial;
   - a row of another profile, or a locked wallet, is not dialed;
   - a lock during the node lookup, and one during `getTxReceipt`, leave no further dial, no write
     and no balance refresh;
   - with the journal lock held: a lock then an unlock while `setSendCheck` waits leaves the row
     tracked and writes it once on the next live tick; `stop()` while it waits writes nothing and
     leaves nothing tracked;
   - a row deleted between ticks is never dialed again; one deleted during the node lookup is not
     dialed for its receipt; a read slower than two ticks is never overlapped;
   - a read that settles after `stop()` writes nothing;
   - `start()` resumes an unresolved row inside its window, due at once, and one past it for its
     last read; a row the reaper fails at `submitting` after `start()` is tracked;
   - restart, locked, unlock, resume: `start()` with `captureExecutionFence` throwing dials nothing
     over several ticks, and the first tick after it stops throwing dials the row;
   - no logger call at any level carries the hash or the URL.
3. Red, `incoming-transfer/service.scenarios.test.ts` (beside the in-flight dedupe case, where the
   service harness lives): an incoming note whose hash matches a failed row of the same profile,
   network and account is not recorded.
4. Red, `execution/service.composition.test.ts`: the lost-response case of Ask C9.
5. Build `SendCheck` and A6; arm and stop the check in `runtime.ts`; update
   `runtime.post-start.pins.test.ts`.

Validation gate:
- Commands: from `apps/extension`, `bun --bun vitest run src/wallet/services/operation-journal
  src/wallet/services/transaction src/wallet/services/incoming-transfer
  src/wallet/services/execution/service.composition.test.ts
  src/wallet/runtime.post-start.pins.test.ts src/utils/log-payload-ban.test.ts`; `bun run lint`;
  `bun run typecheck:all`.
- Pass criteria: every command exits 0; the red runs recorded; the complexity baseline unchanged.
- Layers: typecheck, lint, unit, composition.

### P3 · The popup waits and says what it knows (A4 snack, A5) ✓

Assumptions: Facts 13 to 15, 28; Inference 5; Asks C5, O4.

1. Red, `apps/extension/src/wallet/services/execution/client.test.ts` (new; fake timers, a stubbed
   port): red: `executeTransfer` is still pending at 61 s, resolves when the answer arrives at
   90 s, and rejects with `RpcTimeoutError` at 60 minutes; a new client made after the first is
   disposed (the reopened popup) gets the same ceiling. Pins, green on the base: a port drop
   rejects a pending `executeTransfer` with the plain `Error("Client disconnected")` (as
   `packages/extension-messaging/src/background/client.test.ts:594-604` does for any method);
   `disconnect()` while it is pending (the Send page's disposal) rejects it and leaves no pending
   entry, no timer and no port listener; `estimateTransferFee` rejects at 60 s.
2. Red, `send-submit.test.ts`: a checkable failed record → "Send not confirmed" with Details; a
   never-sent record → "Send failed" with O4 (a)'s sub and Details; `RpcTimeoutError`, the plain
   disconnect `Error`, a failed journal read and a record with no `from` → "Send status unknown",
   no Details; the Terms and not-recorded snacks unchanged. Update the pins in
   `transfer-failure-copy.test.ts` and `send.test.ts:356`.
3. Build A5 and the snack variants.

Validation gate:
- Commands: from `apps/extension`, `bun --bun vitest run src/wallet/services/execution/client.test.ts
  src/popup/pages/send-submit.test.ts src/popup/pages/send.test.ts src/popup/utils/transfer-failure-copy.test.ts`;
  `bun run lint`; `bun run typecheck:all`.
- Pass criteria: every command exits 0; the red runs recorded.
- Layers: typecheck, lint, unit, component.

### P4 · The card and the journal page (A4) ✓

Assumptions: Facts 1, 2, 18, 19; Asks O1, O3.

1. Red, `journal-state.test.ts`: each outcome's card display, label and context, for a `transfer`
   and a wire-shaped `dapp_execute` record (hash `0x` + 64 hex, endpoint `https://…`, dApp
   subtitle); `session_ended` from `submitting` keeps its copy; a `transfer` and a `dapp_execute`
   failed from `proving` read "Stopped before broadcast"; the interrupted kinds from an earlier
   stage read the new context; a row with no `from` keeps today's arms. Update the arms' pins
   (`:475-495`).
2. Red, `TransactionTerminalCard.test.ts`: `color="green"` renders the green subtitle class.
3. Red, `popup/pages/journal/journal-detail-scope.test.ts`: the scope helper rejects a record of
   another profile, network or account, including one read after a scope switch;
   `bindJournalDetailUpdates` reloads on an update for its id and on `onConnected`, ignores another
   id, and after its unbind neither listener remains and neither event reloads.
4. Build the outcome step, the rewritten arms, `green`, the scope helper and the journal page's
   live update, reconnect reload and State labels; cut both header comments to their invariants
   and narrow the two false comments (A4);
   run the extension build once so `src/types/*.d.ts` regenerate if an export moved.

Validation gate:
- Commands: from `apps/extension`, `bun --bun vitest run src/utils/journal-state.test.ts
  src/components/composite/activity src/popup/pages/journal`; `bun run lint`;
  `bun run typecheck:all`; `bun run build`.
- Pass criteria: every command exits 0; the red runs recorded; `git status` shows no stray
  generated diff.
- Layers: typecheck, lint, unit, component, build.

### P5 · Browser proof and the arc gate ✓

Assumptions: Inferences 1, 6; Ask C6.

1. `apps/extension/tests/e2e/network/failed-send-check.test.ts`, `@requires-proverless`, retry 0,
   the focused DROPPED guard:
   - hold the proof gate; send 1 token public to public from Send; wait for the record at
     `proving`; save and remove `LEGAL_ACCEPTANCE_KEY`; release the gate;
   - wait for the record `failed` with `from: "submitting"` and a `0x` + 64 hex hash; restore the
     key;
   - open the record's journal page and read `journal-detail-category` as "Not confirmed yet"
     (imported from `journal-state.ts`);
   - then, sampled every 5 s until 150 s past the record's own `terminalAt` (the check's two
     minutes at 5 s plus one 15 s read and margin), assert the stored `progress.check` stays
     undefined, the page still reads "Not confirmed yet", and the account's public balance is
     unchanged;
   - then (post-implementation R1.4) read the node's own receipt for the hash as DROPPED, age the
     stored row's `terminalAt` past the 30-minute window, stop the background, reopen and unlock:
     the restarted check's last read must write `unconfirmed`, the page must read its label, and
     the balance must not have moved. Only a check that runs passes this step.

   Red on the base (the failed row keeps no `from` or hash), recorded by its failing assertion on
   the stored record; red with the check's `start()` removed, recorded at the unanswered row.
2. Every row of the local gates: `bun run lint`, `bun run typecheck:all`, `bun run test:all`,
   `bun run test:ci-gating`, `bun run build`.
3. Smoke e2e on Chrome and Firefox: the migration-fixture build per browser, then
   `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`.
4. Network e2e, retry 0, `NODE_OPTIONS=--dns-result-order=ipv4first`:
   - `failed-send-check` and `snack-placement` on Chrome and Firefox with `NULO_E2E_PROVERLESS=1`;
   - `transfers` on Firefox prover-ON with no Presto answering on the host
     (`NULO_E2E_BROWSER=firefox NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run
     e2e:agent tests/e2e/network/transfers.test.ts`). Its red on the base is Fact 15. The spec's
     new debug line prints the public transfer record's `terminalAt - createdAt`, a lower bound on
     the RPC's duration. A run counts only when that exceeds 60 000 ms. Otherwise rerun under load,
     and record every run's figure.
5. Flake bar: `failed-send-check`, three consecutive retry-0 runs per browser.
6. `bun run e2e:reap`.

Validation gate:
- Commands: all of the above.
- Pass criteria: each exits 0; each run's summary in `lessons/phase-5.md` with executed, passed and
  skipped counts and, for `transfers`, the measured duration above 60 s; a skipped network spec is
  not a pass; the diff lists no file under `apps/extension/src/wallet/services/wallet-sdk/` or
  `packages/wallet-bridge/`.
- Layers: typecheck, lint, unit, component, composition, CI-gating, build, e2e, e2e-live-network.

### P6 · The owner's sign-off ✓

1. One page for the owner with O1, O3, O4 and the blanket sign-off. Every option and every
   blanket row is a screenshot of it built; the non-recommended options are built on a local
   branch for capture only and never committed. States the spec cannot reach live (sent,
   reverted, unconfirmed) are captured from a local build whose `chrome.storage.local` holds a
   seeded journal row of that outcome. Each picture carries its strings beside it. Capture list
   (option · state · browser · theme):
   - O1 (a) and (b) · the card and the journal page for: nothing sent (a transfer failed at
     `proving`), not confirmed yet, sent, reverted, unconfirmed, interrupted before `submitting` ·
     Chrome · dark; not confirmed yet and sent also in light.
   - O3 (a) and (b) · a playground send that fails simulation: its journal page and its card ·
     Chrome · dark.
   - O4 (a) and (b) · the three snacks over Home (nothing sent, not confirmed, status unknown) ·
     Chrome · dark; the not-confirmed snack also in light.
   - B1 · Home's awaiting card at +30 s and +90 s of a WASM transfer, and Home at +61 s with no
     snack · Firefox · dark.
   - B2 · the journal page of a checked send before and after its check answers (seeded) ·
     Chrome · dark.
   - B3 · Home with a failed record and a settled activity row for the same send (seeded) ·
     Chrome · dark.
   - B4 · History for a failed send that went through, before (the base build: a seeded failed
     record plus a seeded incoming record for its change note, which shows as "Received" with the
     change amount) and after (this branch: the same failed record, checked `sent`; A6 records no
     incoming row for it, so only the "Sent" card shows) · Chrome · dark, at the popup's real
     size. Each picture labelled seeded.
   - The inclusion line (F-4) is text only: nothing visible changes.
2. **The answers.** On 2026-09-29 the owner delegated the open decision pages: "any chance your
   resolve auditing with Codex and Opus5.5 subagents the open artifacts? Ask those subagents to be
   evaluators on the ux/ui/copies. Use your knowledge about my previous decisions too." A panel
   judged this page: two Opus 5.5 evaluators (an interaction lens, a copy and visual lens) and a
   Codex session (`01a0ef3d-a12a-74f3-8cf6-048d52a474ab`). The coordinator decided:

   | Call | Decision | Panel | Dissent |
   |---|---|---|---|
   | O1 | (a), with the edits below | unanimous, high | none |
   | O3 | (a) | two to one | Codex preferred (b), the neutral dApp label |
   | O4 | (a); status unknown reads "Send status unknown · Check History before sending it again." | unanimous | none |
   | Blanket (B1 to B4, the F-4 line) | signed | two to one | Codex would block B3 (F-5) |

   The edits, applied in P7:
   - "Activity" becomes "History" wherever the new copy sends the person to a screen: there is no
     Activity tab.
   - The Unconfirmed page's State reads "Unconfirmed", not "Interrupted"; only the amber visual is
     shared. The page's rule that hides an Outcome row repeating its State then hides that page's
     Outcome row, as for Cancelled.
   - A row stopped before sending (context "Your wallet stopped before sending this. Nothing was
     sent.") reads Outcome "Interrupted before sending". The interrupted kinds with no recorded
     stage keep "Interrupted mid-flight" and their own context.
   - Reverted: "The network included this transaction, but it reverted. The fee was still paid."
     The sponsor may have paid it.
   - Unconfirmed: "Your wallet couldn't confirm this. It may still go through, so check History
     before sending it again." Raised by Codex: an unchanged balance does not make a second send
     safe, since the first can still land, and the owner counts a path that invites a second send
     as realistic, so the balance goes and the reason stays. "Within 30 minutes" goes as well: a
     row with no recorded endpoint is answered at its first read (`send-check.ts`,
     `last = watch.url === undefined || …`). Only a network record without a primary endpoint
     writes one, but the sentence cannot promise 30 minutes while that path exists.
   - While State reads "Checking", the journal page hides its Ended row, and shows it again once
     the check answers. Raised by Codex and the Opus interaction evaluator: an Ended time beside
     "Checking" reads as over.

   Logged for later at the panel's ask: F-5 (B3), F-6 (the snack's style), F-7 (light-theme
   contrast). The delegation names no surface, where CLAUDE.md's sign-off rule asks for an owner
   message naming it: whether it stands as this PR's sign-off is the owner's call before merge.
3. **Checked at the coordinator's ask.**
   - A node's refusal of `sendTx` (an unfunded sponsor, a fee per gas below the base fee) reads "Not
     confirmed yet" for 30 minutes, then "Unconfirmed". The node throws `Invalid tx: <reason>`
     (`ux-owner-picks/lessons/phase-4.md`), which reaches the wallet as a per-call JSON-RPC error
     on an HTTP 200 (`@aztec/foundation` 5.2.0 `json-rpc/server/safe_json_rpc_server.js`, and
     `client/safe_json_rpc_client.js`, which throws it); the row fails from `submitting` with its
     hash, as a lost answer does. `execution/service.composition.test.ts` pins it. No fix here: a
     POST the transport retried after a lost answer can come back refused for a send the node took
     (an "Existing nullifier" once the first attempt is mined), so telling the two apart needs the
     send's transport to report an earlier failed attempt, which is not a small change (F-8).
   - A checked record shows no tx hash or explorer link, against the owner's standing call in
     `incoming-public-transfers/plan.md`, decision L21. Out of this plan's scope (F-9).
   - The status-unknown picture: the snack's top edge covers the lower half of the awaiting card's
     cancel ×. It is not only capture timing. An error snack stays until closed, and the card is
     the reported send's, live until the restarted background reaps its row: with only the old
     popup page open that took over 60 s in the capture run, and 3 s once a new page opened
     (`lessons/phase-6.md`). Any Home error snack covers the row above the tab bar the same way.
     Reported, not fixed here (F-10).
4. **The owner's sign-off, 2026-09-30.** On the decision page
   (https://claude.ai/artifact/68bRWTZAfDw3oefDwxVTWc) the owner answered O1 (a), O3 (a), O4 (a)
   and the blanket "signed", then wrote: "Okei, ive answered everything on the artifacts." Each
   surface in § UI impact now carries the owner's own answer.

Validation gate:
- Commands: none beyond recording.
- Pass criteria: the delivery boundary (§ Approval): the PR may open before this gate; it does not
  merge until the owner's answers to O1, O3, O4 and the blanket sign-off are quoted here. They are,
  in step 4.
- Layers: none (owner sign-off).

### P7 · The panel's edits ✓

After a signed merge of `dev` (#720, `4387b112`), whose one conflict was `index.md`'s two new lines.

1. Red first (`lessons/phase-7.md`):
   - `journal-state.test.ts`, `transfer-failure-copy.test.ts`: each changed string, and
     `unconfirmed` as a visual state of its own.
   - `popup/pages/journal/[id].test.ts` (new) mounts the page: while the check asks, State reads
     "Checking" and no Ended row shows, and the answer brings the row back; an unconfirmed send
     reads State "Unconfirmed" and hides its Outcome row.
   - `execution/service.composition.test.ts`: a node's refusal at the send line. It passes on
     arrival, since it pins today's behaviour (F-8).
2. `journal-state.ts` takes the copy and the `unconfirmed` state, `transfer-failure-copy.ts` the
   status-unknown line, and `journal/[id].vue` hides Ended while the check asks
   (`journal-detail-ended`). `network/failed-send-check` reads the Ended row's absence while the
   check asks, then State and context once it answers.
3. P5's gates again: the local gates, smoke on both browsers in three shards, the two network specs
   on both browsers, `transfers` on Firefox prover-ON.
4. Re-capture every changed surface, option (a), Chrome.
5. One codex round on the diff.

Validation gate:
- Commands: P5's.
- Pass criteria: P5's, with the red run and the captures recorded in `lessons/phase-7.md`.
- Layers: unit, component, composition, typecheck, lint, build, e2e, e2e-live-network.

## Post-implementation (read by the implementing session)

`/code-review` is off. The review loop is `/codex high` (GPT-6 Astra) over the whole diff
(`dev...HEAD`), after P5 is green and before any PR:

1. **Codex audit**: the diff, this plan and its decision ledger, the adversarial ask ("What could
   go wrong? What would an attacker target? What are we trusting that we shouldn't? Where are the
   supply-chain / crypto / least-privilege weaknesses?"), and these two rules, verbatim in the first
   prompt and in every resumed one:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative
     abstractions, extra configuration surface, new layers, or rewrites — the smallest change
     that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop**: verify each finding against the code before acting; apply the accepted ones,
   commit each fix separately, log the round (consult and verdict) in `lessons/phase-5.md`, then
   resume the same codex session with the fix diff. Repeat until a round has no new material
   finding. Still material after three rounds: stop and surface it to the owner.
3. Codex is advisory: it cannot override the owner's answers, CLAUDE.md or this scope.
4. **Delivery** (below), the first time a PR is opened. Opened as #721 on 2026-09-29, while the
   owner's answers were pending, as the delivery boundary allows.

## Delivery

- Single arc, one branch `feat/failed-send-check`, one PR off `dev`, plain `gh pr create` after
  the loop converges; then `gh pr checks --watch`. `/code-review`: off.
- Title: `feat(send): check the network after a failed send; no false failure while proving`
  (82 characters).
- Commits: conventional, lower-case, signed; at least one per phase, fixes separate.
- PR body: summary, the UI impact table, O1, O3, O4 and the blanket sign-off as **pending** (or the
  owner's answers, quoted), the red-before-green evidence per phase, test evidence with e2e counts
  and the measured Firefox prove duration, and the attribution line.
- **Overlaps.** `copy-polish` rewrites em-dashed strings in `journal-state.ts`; this PR replaces the
  interrupted context, so whichever merges second rebases the other. `send-states` edits Send's
  fee and token cards; this PR does not touch `send.vue`. `fix/send-amount-exact` also edits
  `popup/pages/send.test.ts` and the shared `implementations-plan/` files
  (`git diff --stat origin/dev...origin/fix/send-amount-exact`): rebase over it and keep both
  pins. #719 folded S2 into S1's `follow-ups.md` entry; this PR's close-out deletes it.
- **Merge**: by the driver under the owner's standing authorization, once every required check is
  green on the head, every UI surface carries the owner's quoted sign-off and the codex loop has
  converged. Never `--admin`.
- Closing the plan, in the same PR: the `## Outcome` block, lessons promoted, F-1 to F-10 moved to
  `implementations-plan/follow-ups.md`, and the two entries this plan resolves deleted from it
  (S1 with S2 folded in, and S3's "A failed dApp send always blames the dApp").
- **Overlap with `fix/dapp-grants`:** its `scope_refused` kind fails a row from `queued`, so on this
  branch it reads as nothing sent, keeps its failed card with the kind's subtitle, and takes its
  page label from `kindLabel`, where its arm lands when the two merge.

## Seeds

DRAFT until approval.

Recommended, `/goal`:

```
/goal Deliver implementations-plan/failed-send-check/plan.md. Done when the transcript shows every phase ✓ in plan.md with its validation gate reported passing, the red run recorded before each fix, LESSONS_FILE=implementations-plan/failed-send-check/lessons/phase-N.md printed per phase, P5's e2e counts recorded with no skipped network spec (failed-send-check and snack-placement on Chrome and Firefox proverless, transfers on Firefox prover-ON with its measured duration above 60 s, the flake bar three times per browser), a resumed /codex high pass quoted with no new material findings, and gh pr view showing the one PR off dev created after that pass; bun run test:all and bun run lint both exit 0 in the transcript. /code-review is off and was not run. Merge only under the owner's standing authorization once every required check is green, O1, O3, O4 and the blanket sign-off are quoted in plan.md, and the codex loop has converged; never --admin. UI questions go to the owner, technical ones to /codex high.
```

Fallback, `/loop 15m`:

```
/loop 15m Drive implementations-plan/failed-send-check/plan.md forward. Never idle. Each firing: read plan.md and lessons/ (stop if the plan has an Outcome block or moved to archive/); git status, git log --oneline -5; if a PR exists, gh pr view --json statusCheckRollup. Take the next unchecked step; write its failing test first and record the red run; after each edit run bun run lint and the phase's vitest command; commit and push the branch. A technical decision: /codex high, logged in lessons/. A UI question: hold it for the owner. Phase gate green: paste it, mark ✓, print LESSONS_FILE. A skipped network spec is not a pass; a Firefox transfers run counts only above 60 s measured; one e2e:agent at a time; bun run e2e:reap after the last run. All phases ✓: the Post-implementation loop, then gh pr create and gh pr checks --watch, then report and stop. Merge only once the owner's answers are quoted and every check is green; never --admin; hard limits stay hard.
```

Use exactly one per session.
