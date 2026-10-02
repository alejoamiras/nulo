# b04-incoming-balances-activity — codex

Scope read: `dev` at `910a4def`; whole files or relevant sections:

- `CLAUDE.md`, `ARCHITECTURE.md`, `implementations-plan/lessons.md`.
- Required repo maps, quality leads, both prior bug reports, and the August 24 adjudication.
- `apps/extension/src/wallet/services/incoming-transfer/{service.ts,repository.ts,public-event-indexer.ts,arrival-state.ts,scan-health.ts,service.scenarios.test.ts}`.
- `apps/extension/src/wallet/services/token/{service.ts,seeder.ts,spec.ts,default-tokens.ts}`; targeted seeder-test searches.
- `apps/extension/src/wallet/services/token-balance/{service.ts,balance-job-queue.ts,balance-projector.ts,reconcile-pairs.ts}`.
- `apps/extension/src/wallet/services/note/{service.ts,spec.ts}`.
- `apps/extension/src/wallet/services/activity-protocol/coordinator.ts`.
- `apps/extension/src/wallet/services/price/{service.ts,spec.ts,convert.ts,price-map.ts}`; targeted service-test sections.
- `apps/extension/src/stores/balances.store.ts`.
- `apps/extension/src/utils/{activity-rows.ts,token-amount.ts,token-aggregate.ts,token-fold.ts,token-order.ts,token-search.ts,tx-enrichment.ts}`.
- `apps/extension/src/popup/components/modules/general/{BalanceView.vue,BalanceView.test.ts,TokensView.vue,recent-activity-rows.ts}`.
- Handoff: `apps/extension/src/composables/useIncomingTransfers.ts`.

Validation: source inspection plus two in-memory reproductions using source-extracted methods and fake dependencies, each with a passing control. No files modified; no services started.

## b04-incoming-balances-activity-X-1: [Major] Locking during an incoming refresh drain discards the durable refresh marker

**Title:** A profile transition makes an existing balance look missing and deletes its pending refresh.

**Severity:** Major.

**Repro confidence:** High.

**Type:** Lost update; secondary: race.

**Counter-example:**

1. Profile A has a previously projected token balance of 1 token (`updatedAt > 0`).
2. An incoming receipt raises the chain balance to 2 tokens. Discovery persists the receipt and an unanchored balance-outbox row.
3. `drainBalanceOutbox()` captures A, then awaits `listOutbox()`.
4. The user locks the wallet. `TokenBalanceService.onActiveProfileChanged(undefined)` clears its active token map.
5. The drain resumes. Its captured profile still matches the outbox key, so it calls `requestBalanceRefresh()`.
6. The persisted balance exists, but the empty token map makes the lookup return `{ missing: true }`. The drain deletes the outbox row.

The reproduction retained one persisted balance row in both runs. The control retained and anchored its refresh marker; the lock interleaving deleted it.

**Violated invariant:** The outbox contract at `apps/extension/src/wallet/services/incoming-transfer/service.ts:2215` explicitly requires active-profile scoping to prevent a background profile’s balance being falsely classified as missing. Checking a captured profile once does not preserve that invariant across awaits.

**Failing path:**

`incoming-transfer/service.ts:2229` — `drainBalanceOutbox()` captures profile, awaits storage, then checks the stale capture at line 2243  
→ `incoming-transfer/service.ts:2259` — `drainOutboxRow()`  
→ `incoming-transfer/service.ts:2296` — `requestRefreshOrKeep()`  
→ `token-balance/service.ts:238` — `requestBalanceRefresh()` requires membership in the current token map and returns `missing` at line 244  
→ `incoming-transfer/service.ts:2274` — deletes the marker.

The concurrent map clear is at `token-balance/service.ts:455`.

**Expected vs actual behavior:** A lock or switch should leave the marker available for the next active session. Instead, it is permanently removed without a successful projection. The old balance can remain displayed until another refresh trigger: reconciliation only requeues never-projected rows (`reconcile-pairs.ts:145`), and rediscovering an existing receipt does not recreate its dirty marker.

**Recommended fix:** Capture a lifecycle generation before the drain’s first await and recheck it before processing rows and applying refresh results. Reserve `{ missing: true }` for verified absence; an inactive or rebuilding token map should produce a retryable result.

**Instances:**

- `apps/extension/src/wallet/services/incoming-transfer/service.ts:2230`, `:2243`, `:2269`, `:2274`.
- `apps/extension/src/wallet/services/token-balance/service.ts:238`, `:244`, `:461`.

## b04-incoming-balances-activity-X-2: [Minor] A failed seed-marker read erases existing token-deletion preferences

**Title:** Read failure is converted into an empty marker blob and subsequently persisted.

**Severity:** Minor.

**Repro confidence:** High.

**Type:** Silent corruption; secondary: bad error path.

**Counter-example:**

1. A profile’s seed-marker blob contains a valid permanent `deleted` tombstone for mainnet Clean USDC.
2. The user deletes the other mainnet default, USD Coin.
3. `markDeletedByUser()` enters `updateMarker()`. The storage read rejects once with a transient error.
4. `readMarkerState()` returns `{}`.
5. The subsequent storage write succeeds, replacing the entire blob with only USD Coin’s tombstone.

Clean USDC’s deletion preference is now gone. A later seed pass treats its absent marker as eligible and can add the token again.

The in-memory control preserved both tombstones. Injecting one read rejection left only the newly written tombstone.

**Violated invariant:** `seeder.ts:300` defines user deletion as a permanent tombstone. `updateMarker()` promises to preserve existing deletion decisions. A failed read of valid stored data is not evidence that the data is absent or corrupt.

**Failing path:**

`apps/extension/src/wallet/services/token/service.ts:604` — default-token deletion  
→ `token/seeder.ts:301` — `markDeletedByUser()`  
→ `token/seeder.ts:337` — `updateMarker()` reads the blob  
→ `token/seeder.ts:683` — `readMarkerState()` swallows the failure and returns `{}`  
→ `token/seeder.ts:342` — overwrites the persisted blob.

**Expected vs actual behavior:** A failed read should abort the mutation and preserve existing preferences. Instead, the operation reports success while silently dropping unrelated tombstones and attempt bookkeeping.

**Recommended fix:** Propagate storage-read failures from `readMarkerState()` to mutating callers. Keep the existing malformed-data handling separate; read-only status callers may provide their own fallback.

**Instances:**

- Shared failure conversion: `apps/extension/src/wallet/services/token/seeder.ts:683`.
- Whole-blob replacement consumers: `seeder.ts:277`/`:279` (`retry`), `:337`/`:342` (`updateMarker`), and `:535`/`:538` (`commitSeedResult`).
- `seeder.ts:524` also uses the failed-read fallback to decide whether a deletion tombstone permits persistence.

## Leads adjudicated

- **q03 — `commitScannedNote` epoch recheck:** Rejected as a finding. The proposed wiped-profile interleaving must overtake the same service lock before the trust write; no realistic pre-trust stall establishing that handoff was demonstrated. A missing check alone is insufficient.
- **q03 — negative/hex note amounts:** Rejected. Production UintNote decoding converts the field to a decimal string; `parseNoteAmount()` also canonicalizes hexadecimal input to decimal. No normal negative-u128 producer was established.
- **q05 — `BalanceView.onBalanceAdded` doubles fiat:** Rejected as unproven. The missing dedupe exists, but the production Added emitter supplies zero balances (`token-balance/service.ts:293`); a funded Added payload does not establish the claimed production double-count.
- **q09 — foreign-profile incoming History rows:** Rejected. Repository snapshots filter the full profile/network/account tuple, the composable rejects foreign events, and its synchronous scope watcher clears prior rows.
- **q09 — `mint_to_commitment` categorized as Mint:** Rejected. A broad activity category does not establish an incorrect amount or interpretation; the approval parser’s refusal to infer transfer intent serves a different contract.

## Routed to security

None confirmed.

## Non-findings considered

- Prior B-04/B-05 and N-10 balance-generation failures have queue-reset and generation fences in the inspected implementation.
- Prior B-20 scheduler replacement is fenced before committing its descriptors.
- Prior B-21 price-refresh cleanup now checks promise/controller ownership.
- The pinned partial-unhide watchdog behavior in `incoming-transfer/service.scenarios.test.ts:5255` was excluded.
- Price freshness uses the shared TTL rule and the older local/provider timestamp; no concrete additional staleness failure was established.
- No production handoff to `ActivityProtocolCoordinator` was established; isolated coordinator scenarios were not reported.

## Cross-rebuttal (codex on claude)

**1. Overconfident / wrong in Claude’s findings**

Claude reports zero findings, so there are no `C-*` finding IDs to adjudicate. Two claims in its appended rebuttal need correction:

- **X-1 — partially agree:** the mechanism is confirmed; I retain **Major**, because losing the durable refresh request leaves a user-visible balance stale. Contrary to Claude’s explanation, profile changes **do** bump `serviceEpoch`: `apps/extension/src/wallet/services/incoming-transfer/service.ts:361` calls `hydrateSchedulers`, which bumps it at `:917`. The bug survives because the drain checks lock ownership, not that epoch (`:2273`).
- **X-2 — disagree with dismissal as intentional:** `apps/extension/src/wallet/services/token/seeder.ts:672` documents resetting **malformed data**, not overwriting valid persisted data after a failed storage read. The corruption test likewise supplies malformed data (`apps/extension/src/wallet/services/token/seeder.test.ts:384`). That does not establish an intentional trade-off for transient read failures.

**2. Leads Claude rejected that I think are real—or vice versa**

No lead changes verdict.

- **q03, missing scan epoch check:** rejection of the proposed *wiped-profile* counterexample still stands, but “every epoch bumper holds the lock” is false: profile-change hydration bumps outside it (`apps/extension/src/wallet/services/incoming-transfer/service.ts:361`, `:917`). This correction alone does not establish the claimed destructive interleaving.
- **q05, duplicate balance rows:** still insufficient evidence for the claimed doubled fiat. The production Added payload contains zero balances (`apps/extension/src/wallet/services/token-balance/service.ts:293`). Claude’s ordered-port argument is stronger than demonstrated: transport ordering does not itself prove the order in which independently awaited storage operations generate their messages (`:194`, `:297`, `:301`).
- **q09, foreign incoming rows:** agree with rejection; ingestion checks profile/network/account and synchronously clears on scope changes (`apps/extension/src/composables/useIncomingTransfers.ts:115`, `:147`).

**3. What Claude missed that I found**

- **b04-incoming-balances-activity-X-1 — Major; high confidence:** capture profile A, suspend the outbox read, then lock the wallet; the token map clears (`apps/extension/src/wallet/services/token-balance/service.ts:461`), refresh falsely returns `missing` (`:244`), and the resumed drain deletes A’s marker (`apps/extension/src/wallet/services/incoming-transfer/service.ts:2274`). Reconciliation does not refresh previously projected rows (`apps/extension/src/wallet/services/token-balance/reconcile-pairs.ts:145`).
- **b04-incoming-balances-activity-X-2 — Minor; moderate confidence:** with one valid deletion tombstone already stored, delete another default token while that marker read transiently rejects and the following write succeeds; `apps/extension/src/wallet/services/token/seeder.ts:684` substitutes `{}`, and `:342` overwrites the complete blob, erasing the earlier permanent deletion preference. The conditional corruption is deterministic; production frequency is unestablished.

**4. What BOTH missed**

No additional concrete finding. Claude’s additional outbox call sites invoke the same defective drain already covered by **X-1**; they are instances of that root cause, not new findings.