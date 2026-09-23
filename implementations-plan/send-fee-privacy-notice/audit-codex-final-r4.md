reject (with blocking findings: the FPC overlay loses deletion knowledge across identity switches)

**Security**

- **[High] BLOCKING — D27 still permits a deleted sponsor to return. Confidence: high.** `implementations-plan/send-fee-privacy-notice/plan.md:249` clears the overlay on identity change, but balance-store entries survive same-profile account/network switches: `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:281` subscribes before releasing, and `apps/extension/src/stores/balances.store.ts:378` evicts the profile only when no subscribers remain. A failed FPC refresh retains its previous list (`balances.store.ts:216`).

  Concrete sequence: A selects custom sponsor S → S is deleted and overlaid → switch to B, clearing the overlay → return to A → FPC refresh fails → A’s retained list still contains S. A’s retained in-memory pick can select it again; pruning storage does not remove that pick. Even without the pick, S remains eligible for the default walk.

  I reproduced the retained-row sequence using the actual store code evaluated in memory. This is a correctness defect: Send can emit settings referencing a deleted payer.

  **Smallest fix:** retain event deltas for the mounted card across account/network switches, partitioned by FPC ownership—profile and chain—rather than discarding them. Apply only the relevant partition. Initialize its scope before fetching; the first snapshot commit must not erase events received during initialization. Add A→B→A with failed FPC refresh, alongside the existing between-legs and recovery-recommit cases.

**Facts**

- **[Low] The forced-computation bound is misstated. Confidence: high.** `plan.md:205` and D26 at `:631` say serialization is bounded by open documents. `apps/extension/src/wallet/services/execution/gas-balance-reader.ts:80` queues calls, not documents; repeated opens and overlapping requests can leave multiple outstanding calls from one document. Replace that claim with “one computation per forced request; queue length follows outstanding requests.”

  D26 itself works at the reader boundary: preserving `forceRefresh` guarantees a successful forced caller receives a computation started after its request. My in-memory comparison produced four stale zeros with today’s reader; the proposed change produced four positive results through four additional computations. Later-epoch unforced reads and eviction checks also passed. No self-sustaining loop or finite-batch starvation appeared; epoch, eviction-generation and stale-marking fences remain intact.

**Inferences**

- **[Low] I8 remains a load assumption, not a demonstrated bound. Confidence: high.** Besides reader serialization, the store can wait up to 20 seconds for an earlier raw flight, then another 20 seconds for its own request (`apps/extension/src/stores/balances.store.ts:487`). The `lockedMethod` path therefore gains freshness with a possible latency/timeout cost; “strictly an improvement” is too broad if it includes latency.

  Store bookkeeping otherwise looks consistent: forced counters are decremented with epoch guards (`:445`), superseded forced results are fenced (`:467`), and `ensure` adopts retry debt after failure (`:572`). A successful forced mount also resets a co-mounted home card’s optimistic deduction through `apps/extension/src/popup/components/modules/general/GasBalanceCard.vue:44`; that is an existing forced-refresh consequence.

  I2 is established by the unconditional fee-card mount at `apps/extension/src/popup/pages/send.vue:594`. I1, I5 and I7 appropriately remain runtime observations.

**Asks**

- **[Low] Dropping the hold re-read is a sound engineering trade-off; the missing owner approval is not my blocker. Confidence: high.** The honest trade-off at `plan.md:274` is accurate. However, D10 at `:614` still describes another attempt as futile or merely repetitive, contradicting that correction. Replace D10’s rationale with the acknowledged recovery-versus-complexity trade-off. Whole-fetch failures retain store recovery; successful responses containing unread legs may require reopening.

**Implementation**

The pure resolver, separate storage key, serialized writer/reset, and inline notice are proportionate. Outline B conflicts with the fixed persistence decisions. Recon’s reusable helpers are appropriately retained.

Within an uninterrupted scope, the overlay handles events before either leg settles and across recovery commits. Later updates replace earlier edits; ordinary re-registration allocates another ID (`apps/extension/src/wallet/services/fpc/service.ts:308`), so an old tombstone does not hide that new row. The blocking issue is discarding known edits while stale snapshots remain reusable.

I found no additional `selectedMethod` consumer omitted from the planned `effectiveMethod`/`displayMethod` split, nor a planned selected public-payer path that suppresses the warning.

**Validation gates**

- **[Medium] Add the switch-back regression above. Confidence: high.** `plan.md:530` currently tests clearing the overlay, without testing the resulting stale-list resurrection.

The proposed tests otherwise have usable seams:

- Component mocks prove forced-flag forwarding and selection, as D28 now explicitly states.
- The direct reader regression must configure a protocol PrivateFPC; its existing default fixture returns no FPCs (`apps/extension/src/wallet/services/execution/gas-balance-reader.test.ts:26`).
- FPC events can invoke captured subscription callbacks, following `FeeSettingsCard.test.ts:432`.
- Recovery should use the real store retry; queued-reset tests should delay storage completion and await both operations.

All five gates map to existing scripts/configurations with checkable criteria. Smoke discovery and the network fixture support the proposed additions. I inspected these gates; I did not run builds or e2e during this read-only review.

**Looks fine**

- Positive-zero fallback and explicit-pick exception.
- Warning derived from the actual effective method.
- Display-only pending preview.
- Separate Send memory and preserved null-origin card behavior.
- D26’s reader correction.
- No files modified.