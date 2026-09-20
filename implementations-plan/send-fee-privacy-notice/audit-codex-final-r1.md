reject (with blocking findings: incomplete FPC knowledge can trigger public fallback; explicit picks can cross accounts; origin changes can be lost)

Confidence: **high** on source findings; **moderate** on race outcomes where implementation remains unspecified. No files modified.

### Security

- **[High] D4 still mistakes failed discovery for absence.** `apps/extension/src/wallet/services/fpc/service.ts:183` catches individual discovery failures and returns a successful empty/partial array at `:194`. Separately, `apps/extension/src/stores/balances.store.ts:220` retains last-good lists after failures. Yet `implementations-plan/send-fee-privacy-notice/plan.md:180` treats any defined list as confirmed knowledge. With public gas held and the PrivateFPC missing from either list, the walk can select `fj`. **Fix:** carry discovery completeness/freshness separately from list contents. Hold on incomplete discovery or stale negative evidence; preserve genuinely successful empty discovery as known absence. “All findings adopted” overstates D4’s resolution.

- **[High] `lastPick` leaks preferences across identities.** `implementations-plan/send-fee-privacy-notice/plan.md:187` checks only origin and eligibility. Account A’s private-slot `fj` therefore overrides account B’s saved private payer when B holds public gas. Send survives account switches (`apps/extension/src/popup/pages/send.vue:475`). **Fix:** bind picks to the full identity, invalidate on switches, and resolve their semantic keys against current methods. Capture address/origin when enqueueing writes; the legacy writer’s live-prop read after an await (`apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:193`) must not be copied.

### Facts

- **[Medium] Plain re-reads can degrade other subscribers.** The claim at `implementations-plan/send-fee-privacy-notice/plan.md:221` is false. Any failed gas fetch clears `verified` and sets `degraded` (`apps/extension/src/stores/balances.store.ts:185`); `apps/extension/src/popup/components/modules/general/GasBalanceCard.vue:67` then dims. **Fix:** correct D10’s rationale and test shared-subscriber failure behavior. Plain avoids forced staleness *at initiation*, not failure effects.

- **[High] Prefill is not always behind a closed gate.** `implementations-plan/send-fee-privacy-notice/plan.md:202` assumes otherwise, but `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:412` keeps the gate open for same-identity refreshes before prefill at `:425`. Directly installing a saved record can bypass Send reconciliation while fetching. **Fix:** prefill only with the gate closed; otherwise preserve the committed selection. Resolve compact saved records into presentation rows.

### Inferences

- **[High] Standing down can lose an origin flip.** Under `implementations-plan/send-fee-privacy-notice/plan.md:195`, a pending recommit suppresses the watcher. A newer init can replace `committedScope`; an origin flip then occurs; the old recommit exits at `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:503` without settling. **Fix:** settle immediately whenever the committed identity is current, even during refresh, or replay a dirty-origin flag after every exit. Test supersession/discard, not just successful live-origin commits.

- **[Medium] “Every unread state holds” is too broad.** `implementations-plan/send-fee-privacy-notice/plan.md:375` conflicts with Sponsored-first and confirmed-absence handling. A known sponsor needs no gas balance; an absent PrivateFPC needs no private balance read (`apps/extension/src/popup/components/modules/send/fee-helpers.ts:94`, `:160`). **Fix:** test unread *applicable candidates*, including genuine empty discovery plus public zero → `none`.

### Asks

- **[Medium] D10 leaves a recovery decision implicit.** `apps/extension/src/wallet/services/execution/gas-balance-reader.ts:75` serves structural-null results from cache; `:211` caches them fresh. Thus the “re-read” can make no fresh attempt. **Fix:** explicitly decide whether that limitation is acceptable; otherwise retain the rejected forced-read alternative. Approved copy does not establish this recovery contract. Also document that saved/manual `fj` overrides may bypass unread *alternative* payers (`implementations-plan/send-fee-privacy-notice/plan.md:187`); the absolute unread prohibition applies to automatic fallback.

### Implementation

- **[Medium] D10 claims lifecycle guarantees without specifying them.** `implementations-plan/send-fee-privacy-notice/plan.md:483` says “no overlap” was adopted, but `:218` describes guards, not scheduling ownership. Guards discard results; they do not prevent overlapping work. **Fix:** define pending/running/spent states, identity-generation ownership, cancellation on identity change, and checks before fetching and after awaits. Test an already-fired timer across unmount, superseding init, and A→B→A—not only a pending timer.

- **[Medium] D9’s queue does not cover every new-key writer.** The added prune inherits a separate read-modify-write path (`apps/extension/src/popup/pages/settings/fpcs/index.vue:92`); component-local queues also cannot serialize separate Send documents. **Fix:** define shared mutation ownership for the new key, include pruning, and recover the queue after rejection. Use delayed, cloned storage snapshots in tests: the current fake returns shared references (`apps/extension/src/popup/components/modules/send/FeeSettingsCard.test.ts:146`).

### Validation gates

- **[High] Smoke can pass before testing anything meaningful.** The trigger renders before initialization (`apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:607`), while no token independently disables Confirm (`apps/extension/src/popup/pages/send.vue:234`). The assertions at `implementations-plan/send-fee-privacy-notice/plan.md:439` can all pass immediately. **Fix:** control RPC failure, await settled degraded/hold state, then assert selection. Existing `apps/extension/tests/e2e/helpers/rpc-intercept.ts:31` supplies a reusable interception seam.

- **[Medium] Network e2e is achievable, but setup is incomplete.** The fixture is file-scoped (`apps/extension/tests/e2e/fixtures/extension.ts:1025`); earlier tests persist public-origin fee choices. **Fix:** explicitly select Sponsored for shielding, await confirmation and refreshed private balance before opening the inspected Send. Measure the 300-second budget. Gate commands otherwise exist; add the missing race/comount cases above.

Looks fine:

- D3 isolates Send writes from the legacy key’s unserialized writer.
- D6’s `none` takeover and D7’s unconditional notice are sound once knowledge is trustworthy.
- Pure helpers plus an inline row are appropriate.
- No independent warning-omission path emerged from the proposed notice condition; the unsafe fallbacks above would still warn.