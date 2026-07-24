# Account-switch cross-account isolation — implementation plan

## Status

Proposed plan for item 3 / PR-D.

Risk: **High security impact**, **Medium implementation risk** with the staged approach below.

## Recommendation

Use a **staged structural migration**, preceded by a complete targeted containment layer.

Do not attempt a big-bang rewrite. First close every known leak with synchronous scope resets, captured request generations, exact ingest filtering, and strict task/job identity. Keep those guards in place while migrating state into account-scoped slices.

The final state should not be keyed by `accountAddress` alone. Use a composite scope:

```ts
type ActivityScope = {
	profileId: string
	networkId: string
	chainId: number
	accountAddress: string
}
```

The proposed structural slice is broader than the example in the brief because `transactions` and `incomingTransfers` are also flat active-view state today:

```ts
type ActivitySlice = {
	transactionsByHash: Map<string, Tx>
	awaitingById: Map<string, AwaitingTx>
	journalOpsById: Map<string, OperationRecord>
	incomingByNullifier: Map<string, IncomingTransferRecord>
	executingTasksByJournalId: Map<string, TaskState>
	pendingCancelJobIds: Set<string>

	requestVersions: Record<ActivitySource, number>
	eventRevisions: Record<ActivitySource, number>
}
```

The UI receives only a readonly `activeSlice`. Every mutation requires an explicit captured scope; no reducer may consult “whatever account is active now” to decide where a result belongs.

## Goals and security invariants

1. Once the UI represents account B, no A transaction, incoming receive, journal row, task, placeholder, or cancellation effect may render in B.
2. A late A result may update A’s inactive slice, but never B’s slice.
3. A malformed or unscoped event is dropped fail-closed; it is never assigned to the active account as a fallback.
4. Switching clears the visible active-view caches synchronously, before Vue can render the new account with old rows.
5. Snapshot races are safe under A→B and A→B→A. Scope equality alone is not enough for the ABA case.
6. Event ordering is not trusted. An event may arrive before, during, or after a snapshot or service reconnect.
7. Cancellation and task cleanup use exact operation identity, not kind/token heuristics.
8. The incoming-transfer service continues polling inactive accounts. Account switching changes presentation, not note discovery.

## Trade-off analysis

| Approach | Implementation risk | Residual privacy risk | Assessment |
|---|---:|---:|---|
| Targeted guards only | Medium | Medium–High | Fastest containment, but every new fetch/listener is another place to forget a guard. Flat state still cannot retain a late A result safely. |
| Big-bang per-account rewrite | High | Low if correct | Correct destination, but too many simultaneous changes across transaction, journal, task, send, incoming, and both feed surfaces. Regression diagnosis would be difficult. |
| Staged structural migration | Medium | Low | Recommended. Phase 1 closes the leak completely; subsequent phases move producers one at a time while the Phase 1 guards remain active. |

A captured-generation token alone is insufficient. It protects awaited work that explicitly captures the token, but it does not automatically cover:

- `onIncomingTransferAdded` and other unsolicited service events;
- transaction and journal events from the service worker;
- reconnect callbacks;
- task events;
- direct Pinia mutations;
- A→B→A, where an old A request sees the same scope again;
- snapshot/event interleavings in which a stale snapshot overwrites a newer event.

The durable solution therefore combines composite-scope ownership, exact ingest validation, per-source request versions, and event revisions.

---

## Phase 0 — Build deterministic race-test infrastructure

This phase is mergeable test infrastructure, but it is **not a security release**: the existing leak remains until Phase 1.

### Implementation

1. Add an injectable, no-op-in-production `IncomingTransferPollGate` beside the existing proof-gate pattern:

   - Production implementation returns immediately.
   - E2E implementation uses a dedicated `chrome.storage.session` key.
   - Place the hold point in `IncomingTransferService.scanContract` after `getNotesRaw` has returned but before the first storage critical section. The current boundary is between `service.ts:586` and `service.ts:612`.
   - Match the hold command by account, network, contract, and the test transfer’s tx hash so an older note cannot satisfy the precondition.
   - Expose status transitions such as `armed → discovery-held → committed/emitted`.
   - Include a safety timeout that releases and reports a loud test error rather than wedging the service lock.
   - Never place the hold while `serviceLock` is held.

2. Add a build-time E2E flag and marker:

   - Wire it through `apps/extension/src/e2e/config.ts` and `wallet/runtime.ts`.
   - Have `apps/extension/scripts/e2e/agent.sh` positively assert the marker.
   - Add the marker and session key to the production negative-grep in `.github/workflows/_build-extension.yml`.
   - Keep the gate tree-shaken from normal Chrome and Firefox builds.

3. Extend the Aztec E2E mint helper to return the submitted tx hash. The test needs a cryptographic correlation value, not an amount-only guess.

4. Strengthen `switchAccountByAddress` in `tests/e2e/fixtures/helpers.ts`:

   - wait until `nulo:ui:activeAccount` equals the requested address;
   - wait for a feed-scope DOM marker to identify the same account;
   - fail with both expected and observed addresses.

5. Add stable, non-secret test observability to the activity root and rows:

   - active composite-scope or account marker on the feed root;
   - transaction hash already exists on settled cards;
   - incoming row correlation through tx hash/nullifier or a test-safe row attribute.

6. Add a harness test proving that:

   - a real private note reaches the extension PXE;
   - the gate observes the exact A poll;
   - no record is committed while held;
   - releasing the gate produces the A incoming row.

### Validation gate

Run from the repository root:

```bash
bun run lint
bun run typecheck:all
bun run test
bun run --cwd apps/extension test:components
bun run test:e2e
NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts
bun run e2e:agent
```

Pass criteria:

- all commands exit zero;
- the dedicated network test executes rather than skips;
- its hold status proves the poll was stopped after live PXE discovery and before commit;
- the dedicated test consumes no Vitest retry;
- release builds contain neither the gate marker nor its storage key;
- existing smoke and full network suites introduce no new console or page errors.

Layers exercised: gate unit tests, Vue/component regression suite, Chrome smoke flows, real Anvil/Aztec/PXE polling.

---

## Phase 1 — Ship complete targeted containment

This is the first releaseable security fix. It must close all four facets before structural migration begins.

### 1. Canonical scope and synchronous switch boundary

Add a shared `ActivityScope`/scope-key helper. Prefer a structured or safely encoded tuple over hand-built ambiguous delimiter strings.

Centralize all active identity mutations. Current direct writers include:

- `app.store.ts:55-76`;
- `app.store.ts:84-90`;
- `NewAccountPopup.vue:54-59`;
- profile/network/bootstrap writers;
- reset and notification flows.

At the start of every effective profile/network/account change:

1. increment `activityGeneration`;
2. synchronously clear active-view transaction, incoming, journal, and task refs;
3. mark the new scope as loading;
4. then begin snapshots for the captured new scope.

Do not erase A’s durable or in-flight state merely because B became active. “Hard reset” means clearing what B can see, not deleting A’s work.

The active account setter should own persistence so callers cannot update `appStore.account` and `chrome.storage` in different orders.

### 2. Transaction containment

In `app.store.ts`:

- Capture account, scope, and generation before `getTransactions`.
- Commit the snapshot only if the captured generation is still current.
- Filter returned rows to the captured account and chain before commit.
- In `onTxAdded`, never unconditionally prepend an event. Only update the active flat view when the tx scope equals the live scope.
- Clean awaiting placeholders using `tx.account` and the placeholder’s captured scope, not the active account.
- In `onTxUpdated`, require account plus hash; hash-only lookup can update the wrong account’s row.
- Handle transaction deletion symmetrically.
- Deduplicate events by scoped identity.

Fix `send.vue` to create a unique awaiting-placeholder ID and capture its full scope. Promise rejection removes that exact ID from that scope; it must not search the active array by destination and contract.

### 3. Incoming-transfer containment

Refactor `useIncomingTransfers` so it owns a synchronous watcher of the scope tuple:

- clear its visible ref immediately when the tuple changes;
- capture `{scope, requestVersion, generation}` before every refresh;
- reject a stale response after any intervening request or switch;
- validate every Added/Updated/Deleted payload;
- accept an event into the active flat view only when `profileId`, `networkId`, and `accountAddress` exactly match the live scope;
- never infer a missing account from the active store;
- deregister the scope watcher during disposal.

Use the same implementation in `RecentActivityView.vue` and `activity.vue`; do not preserve two near-duplicate reload lifecycles.

### 4. Journal, task, and cancellation containment

For both activity surfaces:

- filter journal events at ingest by exact profile, network, and account;
- snapshot using all available scope fields, not account alone;
- reject stale snapshot results by generation/request version;
- treat journal records missing account or network scope as ambiguous and hide them from account-specific feeds;
- use an exact journal/task correlation field.

Extend task or journal metadata so a task can be routed without consulting the active account. The preferred correlation is `OperationRecord.taskId`, because transfer tasks are currently created before their journal record in `transfer-executor.ts:82-115`. Queued dApp records can attach the task ID when claimed.

Task scope should include profile, network, and account. Unscoped legacy tasks must not render as orphan activity cards.

Replace:

- kind-only dApp matching;
- kind+token matching for transfers;
- unconditional executing-task clearing after a pending cancel;

with exact task ID/journal ID plus scope equality.

Until every producer carries strict metadata, fail closed by omitting TaskService enrichment. The journal is already the primary progress source, so this is a safe temporary degradation.

Change `pendingCancelJobIds` into a scope-owned mapping. A terminal event may:

- remove only its own job ID;
- clear only the task whose exact correlation ID matches;
- clean only the awaiting placeholder in the operation’s scope.

### 5. Defensive final filtering

Strengthen `buildActivityRows` to require the active scope for all three row types:

- transaction: account and chain/network;
- journal: profile, network, and account;
- incoming: profile, network, and account.

This is defense-in-depth even after upstream ingest has filtered the rows.

### 6. Incoming trust-boundary validation

The incoming client currently uses unvalidated passthrough methods, while its Zod record schema validates only broad primitive shapes.

Add schemas and fail-closed validation for methods, results, and wire events. At scan time validate:

- account exists in the requested profile and network;
- note contract equals the registered token contract being scanned;
- PXE note owner equals the captured account;
- no fallback from a missing owner to “active account”;
- address/hash/nullifier fields parse canonically;
- amount is a non-negative u128;
- block and note indexes are non-negative safe integers;
- malformed note-render fallbacks are not converted into incoming records.

Drop and minimally log malformed events without recording note contents, amounts, or addresses.

### Validation gate

```bash
bun run lint
bun run typecheck:all
bun run test
bun run --cwd apps/extension test:components
bun run test:e2e
NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts
bun run e2e:agent
```

Pass criteria:

- A snapshot resolving after A→B cannot change B’s transaction list;
- A incoming event emitted after A→B never appears in B;
- A journal terminal/cancel event cannot clear B’s task or placeholder;
- account switching shows an empty/loading B feed before B’s snapshot resolves;
- A→B→A rejects the first A request if a newer A request exists;
- malformed and wrong-scope incoming records are dropped;
- the dedicated live-poll test passes with retry disabled;
- smoke E2E covers both account selector and manage-accounts switch entry points;
- all full-suite commands exit zero.

Layers exercised: reducers/store tests, composable race tests, mounted feed tests, smoke account switching, deterministic live-poll privacy test.

---

## Phase 2 — Introduce structural slices and migrate transactions/awaiting state

Keep every Phase 1 guard active.

### Implementation

1. Add `activity.store.ts` or an equivalent dedicated coordinator. Do not expand `app.store.ts` into a service-heavy activity store.

2. Store slices in a session-memory `Map<ActivityScopeKey, ActivitySlice>`.

3. Expose:

   - readonly `activeSlice`;
   - `ensureSlice(capturedScope)`;
   - scoped event reducers;
   - scoped snapshot begin/commit APIs;
   - scope invalidation for profile lock, account deletion, network deletion, and reset.

4. Migrate transactions:

   - transactions are written to the slice derived from the transaction’s own metadata;
   - add `profileId` and `networkId` to newly persisted transaction records, because `chainId + account` is not a fully precise network identity;
   - thread these fields from execution, where the network ID and profile fence already exist;
   - handle legacy records fail-closed when ownership is ambiguous;
   - update transaction detail lookup to use active scope plus hash.

5. Migrate awaiting placeholders:

   - add ID and captured composite scope;
   - insert and remove by ID;
   - route `onTxAdded` cleanup to the transaction’s slice;
   - route journal-terminal cleanup to the operation’s slice.

6. Provide temporary active-slice compatibility computed values only where needed. Compatibility accessors must be readonly; mutations go through scoped actions.

7. Add cache lifecycle limits:

   - clear all slices when the profile locks;
   - remove account/network slices on deletion;
   - clear prior-profile slices on profile switch;
   - do not let a late request recreate a tombstoned scope.

### Snapshot/event algorithm

For each source and scope:

1. Register event listeners before starting the snapshot.
2. Increment the source request ID and capture its current event revision.
3. Fetch using the captured scope.
4. Discard if the scope was invalidated or the request is no longer latest.
5. If no event arrived, replace the slice source.
6. If events arrived, do not overwrite them with the older snapshot; merge by stable ID or schedule a fresh snapshot.
7. Increment event revision for every add/update/delete.

This prevents both stale-switch writes and snapshot-over-event loss.

### Validation gate

```bash
bun run lint
bun run typecheck:all
bun run test
bun run --cwd apps/extension test:components
bun run test:e2e
NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts
bun run e2e:agent
```

Pass criteria:

- transaction and placeholder consumers no longer mutate flat arrays;
- a late A transaction event is retained in A’s inactive slice and absent from B;
- switching back to A shows the retained result without requiring popup restart;
- deletion/lock invalidation prevents late results from recreating removed slices;
- Phase 1 DOM and live-poll privacy assertions remain green.

---

## Phase 3 — Migrate incoming, journal, task, and cancellation state

Keep ingest filtering and captured request guards as permanent defense-in-depth.

### Implementation

1. Refactor `useIncomingTransfers` to write events and snapshots to the captured composite slice.

2. Route every incoming event from its payload scope, even when that scope is inactive.

3. Move `journalOps`, task enrichment, subtasks, and pending cancel IDs out of `RecentActivityView.vue` and into the scoped state coordinator.

4. Migrate `activity.vue` to the same store and source lifecycle. Remove its independent terminal-journal and incoming snapshot ownership.

5. Use exact correlation:

   ```text
   journal operation ID ↔ task ID ↔ cancel job ID
   ```

   No task kind/token heuristic should decide which task is cleared.

6. Render both home and full-page feeds from the same active slice and the same scoped row builder.

7. Preserve source-specific maps so one event cannot overwrite another source’s identity domain.

8. Continue to filter every rendered row against `activeScope`, even though the slice is already scoped.

### Validation gate

```bash
bun run lint
bun run typecheck:all
bun run test
bun run --cwd apps/extension test:components
bun run test:e2e
NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts
bun run e2e:agent
```

Pass criteria:

- no flat `journalOps`, `incomingTransfers`, `executingTask`, or `pendingCancelJobIds` remain in either feed component;
- an A emission arriving while B is active updates A’s slice only;
- switching back to A shows that result;
- an A terminal event cannot mutate any B task or cancel set;
- home and full-page feeds produce identical scope decisions;
- all validation layers pass.

---

## Phase 4 — Remove compatibility state and perform adversarial cleanup

### Implementation

1. Remove flat transaction and awaiting compatibility APIs from `app.store.ts`.

2. Remove duplicate scope/reload logic from both feed surfaces.

3. Add static regression checks or focused tests preventing:

   - active-account fallback in activity reducers;
   - direct mutation of activity arrays;
   - unscoped task/journal creation for activity-feed operation kinds.

4. Decide and codify legacy behavior:

   - scope-complete legacy record: migrate safely;
   - scope-ambiguous record: exclude from account feeds;
   - never display an ambiguous record under every account.

5. Verify all reset, lock, profile-switch, network-switch, account-hide/delete, and service-worker reconnect paths invalidate or reload the correct scopes.

6. Add privacy-safe diagnostics:

   - counts and scope-generation IDs are acceptable;
   - do not log addresses, note values, tx payloads, or contract metadata solely for this feature.

7. Hand the completed implementation to 2–3 independent Codex auditors. Do not run `/harden`.

### Final validation gate

```bash
bun run lint
bun run typecheck:all
bun run test
bun run --cwd apps/extension test:components
bun run test:e2e
NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts
NULO_E2E_RETRY=0 bun run e2e:agent
```

Run the dedicated retry-zero command on at least three cold sandbox starts.

Pass criteria:

- every command exits zero;
- the dedicated race test passes three cold runs with zero retries;
- the full network suite passes with retry disabled;
- release bundle negative-grep proves E2E gate code is absent;
- auditors find no cross-scope write using live active identity and no unvalidated incoming event path.

---

## Dedicated network-E2E design

File: `apps/extension/tests/e2e/network/account-switch-isolation.test.ts`.

### Preconditions

1. Start from `tokenReadyExtension` on Local Network with account A and the test token already registered/trusted.
2. Submit one real A transaction with a unique amount; wait for its settled card and capture the exact tx hash.
3. Create account B. Account creation currently selects the new account, so explicitly switch back to A and wait for exact persistence/UI scope.
4. Arm the incoming poll gate for:

   ```text
   profile + network + A + token contract + expected external tx hash
   ```

### Force the race

1. From the independent EmbeddedWallet, mint a distinctive private amount to A. The helper returns the tx hash.
2. Refresh/synchronize the extension until the gate reports that A’s poll has fetched that exact note and is held before commit.
3. Install a `MutationObserver` that records A’s known transaction hash and distinctive incoming marker whenever the feed root declares scope B.
4. Switch A→B and wait for:

   - persisted active account equals B;
   - feed root scope equals B;
   - A’s settled tx is absent immediately.

5. Release the A poll.
6. Wait for the gate’s commit/emission status. This proves the late event actually occurred after the switch; a negative DOM assertion without this precondition would be meaningless.

### Assertions while B is active

Assert on both Recent Activity and History:

- A’s known settled tx hash never appears;
- the A incoming amount/hash/nullifier never appears;
- no incoming row is created and removed transiently, according to the observer;
- B’s feed remains empty or contains only B-scoped records;
- no A cancellation/task marker affects B.

Keep observation active until:

- the exact A event has emitted;
- Vue has processed pending microtasks;
- one reconnect/poll observation interval has elapsed.

### Positive control

Switch back to A and assert:

- the A settled transaction is visible;
- the A incoming transfer is visible exactly once;
- the persisted incoming record carries A’s exact profile/network/account;
- B still has no copy after switching back again.

This distinguishes “properly routed to A” from “silently dropped everywhere.”

### Flakiness assessment

Without the poll barrier, the test would be a timing soak, not a proof: PXE sync, the 30-second poll cadence, Vue rendering, and account selection could reorder on every run. Such a test is still useful as non-gating stress coverage but is unsuitable as the privacy ship gate.

With the barrier, the race ordering is deterministic:

```text
A note discovered
        ↓
poll held before commit
        ↓
active scope becomes B
        ↓
release A poll
        ↓
A record commits/emits
        ↓
B must never render it
```

The remaining timeouts test infrastructure liveness rather than race luck. Failures should report which precondition failed: mint inclusion, PXE discovery, gate hold, account switch, service emission, or DOM isolation.

---

## Security and adversarial considerations

### Threat model

A same-profile multi-account user expects account B to reveal nothing about account A. A leaked incoming row can reveal A’s:

- token relationship;
- received amount;
- receipt timing;
- transaction hash;
- activity cadence.

A malicious dApp could exploit timing by:

- inducing or socially engineering an account switch;
- sending a note to A while B is selected;
- generating bursts to maximize event/snapshot overlap;
- using deceptive token metadata;
- completing or cancelling an A operation while B has a similar operation in flight.

Task/cancel mis-scoping can mislead the user into believing B’s operation stopped or completed. That may encourage an unsafe retry even if it does not directly authorize spending.

### Aztec-specific trust boundary

A private note can be authored by anyone able to send to the account. Do not treat note arrival as authentication of a sender.

The service may trust PXE to return notes decryptable in the requested scope, but it must not trust:

- encoded owner fields without comparison to the requested account;
- sender identity, which the current incoming model does not carry;
- token symbol/name;
- note ordering;
- event delivery order;
- PXE timing;
- reconnect replay timing;
- raw amount or index ranges.

The UI should say “Received,” not “Received from X,” unless sender provenance is added and independently verified later.

### Least privilege

- The active feed gets one readonly slice, not the entire account map.
- Reducers take explicit scope; they cannot read `appStore.account` as a write destination.
- Cancellation verifies that the requested job exists in the active slice before dispatch.
- Incoming RPC reads verify account membership in the requested profile/network.
- Ambiguous legacy records are hidden instead of shown broadly.
- Profile lock clears popup-resident activity slices.

### Input validation and resource abuse

A malicious contract or sender may attempt malformed or high-volume notes. Enforce:

- strict canonical field/address parsing;
- u128 amount bounds;
- non-negative index bounds;
- contract and owner equality;
- idempotency by nullifier;
- bounded per-tick processing;
- reasonable in-memory slice retention.

Token metadata remains attacker-controlled even after registration; retain Unicode/bidi sanitation and length limits.

### Visibility setting

`IncomingTransferService.isVisibilityEnabled` currently fails open on config errors at `service.ts:692-701`. That conflicts with strict least-privilege semantics for a privacy-oriented visibility toggle. Recommended behavior is fail-closed for UI emission/read while preserving records for later recovery, subject to product confirmation in the Asks below.

---

## Concurrency correctness checklist

- [ ] Scope change increments a generation synchronously.
- [ ] Active refs clear synchronously on profile/network/account change.
- [ ] Every awaited snapshot captures scope and a source-specific request ID.
- [ ] A→B→A rejects the first A request.
- [ ] Service events route by validated payload scope, never generation alone.
- [ ] Listener-before-snapshot ordering is used.
- [ ] Event revision prevents a snapshot from overwriting a later event.
- [ ] Deletes use tombstones/revision handling so snapshots cannot resurrect rows.
- [ ] Scope deletion/lock invalidates outstanding writers.
- [ ] Transaction updates match account/network plus hash.
- [ ] Task/cancel cleanup uses exact IDs and scope.
- [ ] Missing scope fails closed.
- [ ] Both feed surfaces consume the same scoped source.
- [ ] Service-worker reconnect re-snapshots captured scopes without overwriting newer events.

---

## Assumptions

### Facts verified in the current tree

- `selectAccount` changes the reactive account before awaiting persistence: `apps/extension/src/stores/app.store.ts:71-75`.
- `AccountsPopup` calls it without awaiting it: `apps/extension/src/popup/components/popups/AccountsPopup.vue:30-33`.
- The account watcher starts `syncTransactions` without awaiting or cancellation: `apps/extension/src/popup/app.vue:87-95`.
- `syncTransactions` assigns an awaited snapshot unconditionally: `apps/extension/src/stores/app.store.ts:153-157`.
- Transaction events are unconditionally added, and updates match hash alone: `apps/extension/src/stores/app.store.ts:131-151`.
- `awaitingTransactions` and `transactions` are flat store refs: `apps/extension/src/stores/app.store.ts:129-130`.
- `executingTask`, `journalOps`, and `pendingCancelJobIds` are flat component-local refs, not app-store fields: `RecentActivityView.vue:128-129`, `:201-203`, `:253-254`.
- Pending-cancel terminal handling clears the current task without checking task identity: `RecentActivityView.vue:480-485`.
- DApp task detection has no account check: `RecentActivityView.vue:568-580`.
- `ExecuteOperationContent` carries no account or network: `apps/extension/src/wallet/services/task/spec.ts:76-82`.
- Journal snapshots write their result unconditionally: `RecentActivityView.vue:553-556` and `:665-667`.
- Incoming refresh and event handlers mutate one flat ref without checking payload scope: `apps/extension/src/composables/useIncomingTransfers.ts:55-72`.
- `activity.vue` loads journal/tokens/incoming only on mount and has no account-switch reload watcher: `apps/extension/src/popup/pages/activity.vue:133-155`.
- `buildActivityRows` trusts transaction and incoming arrays to be pre-scoped: `apps/extension/src/utils/activity-rows.ts:50-52` and `:62-72`.
- The incoming service schedules every active-profile account independently and broadcasts account-tagged records: `service.ts:389-437`, `:555-570`, `:658-685`.
- Account switching does not need to stop the A scheduler; discovery is designed to continue for all accounts.
- The incoming client uses unvalidated request passthroughs: `apps/extension/src/wallet/services/incoming-transfer/client.ts:16-54`.
- Current record schemas accept generic strings for addresses/hashes and unconstrained numbers: `apps/extension/src/wallet/services/incoming-transfer/spec.ts:84-101`.
- `buildRecord` falls back to the requested account if owner is absent: `service.ts:773-790`.
- The existing account-switch E2E helper does not wait for the target address after clicking: `tests/e2e/fixtures/helpers.ts:333-343`.
- `e2e:agent` already owns a parallel-safe Anvil/Aztec/playground stack and passes file selectors to Vitest: `apps/extension/scripts/e2e/agent.sh:1-12`, `:151-173`.

### Brief statements that need correction

- The data-model gap is larger than the proposed example map: `transactions` and `incomingTransfers` must also be scoped.
- `journalOps`, `executingTask`, and `pendingCancelJobIds` are currently component-local, not app-store state.
- The two feed surfaces do not share reload behavior completely. They share the incoming composable, but neither performs a correct account-switch reload.
- A map keyed only by account address is insufficient for profile/network isolation.
- Cancelling A’s incoming scheduler on account switch would be incorrect because the service intentionally scans inactive accounts.

### Inferences

- Account-derived addresses appear intended to differ by chain, but relying on that instead of explicit network scope is unsafe.
- Service events may be delayed, duplicated, or replayed across reconnects; the transport provides no ordering guarantee the UI should depend on.
- Task scope metadata can be added compatibly because task state is in-memory and already cleared across profile changes.
- Persisted transaction metadata will require either a storage migration or explicit legacy handling.

### Asks requiring product/maintainer confirmation

1. **Legacy unscoped records:** May ambiguous journal/transaction records be hidden? Recommendation: yes; privacy must win over displaying uncertain history.
2. **Incoming visibility fail-open:** Should config-service failure suppress incoming UI events? Recommendation: fail closed while retaining records.
3. **Transaction schema:** Approve adding `profileId` and `networkId` to new transaction records. Recommendation: yes; composite isolation cannot be fully structural without them.
4. **Network-suite baseline:** `tests/e2e/README.md:160-162` describes an older partially failing baseline. Confirm the current expected baseline before implementation; this PR should not declare success while the full required gate is red.
5. **Temporary task UX:** If strict task correlation cannot land in Phase 1, approve temporarily dropping orphan TaskService cards. Recommendation: accept the degradation because journal cards remain and cross-account ambiguity is worse.