## Adversarial/security findings

1. **Critical — cross-profile cache contamination.** The store key drops `profileId` even though `getFpcs()` explicitly filters by the active profile. Two profiles can share the same derived address; the activity store documents exactly that risk. Clearing the map on switch is insufficient because an old in-flight request can repopulate it afterward. A profile-switch/A→B→A race could expose the wrong FPC list, sponsor selection, or private-balance context. Use a structured `(profileId, networkId, chainId, accountAddress)` scope plus a profile epoch/generation fence. [plan D3](/home/homelab/Projects/nulo/.claude/worktrees/balance-fpc-cache/implementations-plan/balance-fpc-cache/plan.md:176), [FPC profile filtering](/home/homelab/Projects/nulo/.claude/worktrees/balance-fpc-cache/apps/extension/src/wallet/services/fpc/service.ts:128), [activity precedent](/home/homelab/Projects/nulo/.claude/worktrees/balance-fpc-cache/apps/extension/src/stores/activity.store.ts:1)

2. **High — one `status/version` conflates incompatible behavior.** Transaction refreshes, gas failures, FPC failures, and FPC events all mutate one entry. Either FeeSettingsCard observes those versions—making it transaction-live—or it watches only while degraded, in which case ready-state FPC deletion/rename no longer clears/updates the selected method. Both violate D4 and recon’s explicit “STAYS” list. Refreshing the whole FPC slice also introduces new live behavior for added/non-selected FPCs. [architecture](/home/homelab/Projects/nulo/.claude/worktrees/balance-fpc-cache/implementations-plan/balance-fpc-cache/plan.md:37), [recon](/home/homelab/Projects/nulo/.claude/worktrees/balance-fpc-cache/implementations-plan/balance-fpc-cache/recon.md:7), [existing pins](/home/homelab/Projects/nulo/.claude/worktrees/balance-fpc-cache/apps/extension/src/popup/components/modules/send/FeeSettingsCard.test.ts:358)

3. **High — timeout single-flight is incorrectly subsumed.** Current raw promises remain keyed after the wrapper times out, preventing unbounded queued RPCs. A store fetch promise settles at timeout; deleting `rawRequests/reuseRawRequest` then permits every retry to start another uncancellable request. The existing test explicitly pins one underlying call. [plan Phase 4](/home/homelab/Projects/nulo/.claude/worktrees/balance-fpc-cache/implementations-plan/balance-fpc-cache/plan.md:144), [test](/home/homelab/Projects/nulo/.claude/worktrees/balance-fpc-cache/apps/extension/src/popup/components/modules/send/FeeSettingsCard.test.ts:761)

4. **High — fail-open mitigation is necessary but incomplete operationally.** Phase 1 is sufficient only if producer, canonical type, all consumers, and tests form one indivisible commit/release. I found no additional direct `publicFeeJuice` fail-closed comparison beyond `settingsForMethod` and `buildFeeMethods`; `resolveSavedSelection` is transitively protected by the latter. The larger new fail-open vector is stale/wrong-scope store data being treated as verified.

## Assumption attack

**Facts**

- F1–F5 and F7–F8 are substantiated.
- F6 overstates the precedent: `activity.store` demonstrates scoped slices and mutation fencing, not connection ownership.
- F9 establishes the pinned toolchain commit and test presence, not that live-network execution will reliably run at implementation time.

**Inferences**

- I1 is false; reverse it for profile-scoped FPC data.
- I2 is false without separate per-leg raw flights, attempt generations, and cause-specific versions.
- I3 is unsafe: re-anchoring call counts to store actions destroys the raw-RPC accumulation pin.
- I4 is false: GasBalanceCard-only mounts may now fetch FPCs and retry indefinitely; transaction settlement may refresh both legs. Popup RPC traffic is therefore not identical.

**Asks**

Surface decisions for: whether GasBalanceCard alone may auto-retry; exact FPC-event behavior; cache freshness after remount/SW reconnect; ownership of optimistic `onTransactionAdded` handling; and whether tx settlement refreshes balances only.

## Implementation and phases

Keep Pinia, but reject this monolithic entry/API. Use a structured scope; separate gas and FPC slice state, errors, generations, and refresh causes; retain raw per-leg promises; return read-only refs plus an idempotent disposer instead of caller-built keys and mutable `entry()/release()`. Copy activity-store mutation fencing. `usePrices` should remain per-consumer; `useEntityCrud` is not applicable.

I would not build outline B: shared promises created by component-owned clients can be broken when the owning component disconnects, and lifecycle/retry ownership remains undefined.

Phase 2 must test A→B→A late completion, hung raw-RPC counts, reconnect, active-entry LRU safety, subscriber kinds, FPC event routing, and tx/Fee non-reactivity. Phases 3–4 should use the real store with mocked clients, not mock the store boundary.

## Ledger

- D1 keep, but narrow/redesign the store.
- D2 keep.
- D3 reverse.
- D4 keep, with a separate exact FPC-event channel.
- D5 keep and require one atomic commit/release.

**Verdict: reject (with blocking findings: unsafe profile keying/in-flight fencing, loss of raw-RPC non-accumulation, and an entry/version model that cannot preserve both FPC-event and transaction non-reactivity semantics).**V2 closes the three original blockers in principle: profile-scoped keys plus an epoch fence fix D3; timeout-surviving raw promises preserve retry non-accumulation; split slices plus card-side FPC events preserve selection reactivity and normal transaction non-reactivity.

Ranked remaining findings:

1. **High — forced invalidation conflicts with raw reuse.** The plan says every gas attempt reuses the keyed raw promise, including `ensure(...forceRefresh)`. A transaction-settle refresh must not join a request predating invalidation; otherwise the popup defeats the SW reader’s force-refresh guarantee. Define a separate forced-flight path matching the SW’s wait/re-enter semantics, and restore the Phase 2 “force refresh never joins pre-invalidation flight” test. [fetch/API](/home/homelab/Projects/nulo/.claude/worktrees/balance-fpc-cache/implementations-plan/balance-fpc-cache/plan.md:49)

2. **High — identity-change release is missing.** The text promises reset on identity change, but FeeSettingsCard releases only on unmount and embedded early-return. An account/network change within one profile therefore leaves the old key subscribed and retrying indefinitely. Require release-before-subscribe whenever the structured scope changes, with account/network A→B and A→B→A tests. [capabilities](/home/homelab/Projects/nulo/.claude/worktrees/balance-fpc-cache/implementations-plan/balance-fpc-cache/plan.md:58), [card lifecycle](/home/homelab/Projects/nulo/.claude/worktrees/balance-fpc-cache/implementations-plan/balance-fpc-cache/plan.md:100)

3. **Medium — D6 is slice-specific, not fully cause-specific.** If a degraded FeeSettingsCard and a `txRefresh` subscriber coexist, a transaction gas commit bumps the watched `gas.version` and prematurely recommits FeeSettingsCard. Use a retry/recovery generation distinct from general gas version, or explicitly pin that tx commits cannot trigger the degraded recovery watcher. [D6 claim](/home/homelab/Projects/nulo/.claude/worktrees/balance-fpc-cache/implementations-plan/balance-fpc-cache/plan.md:40)

4. **Medium — epoch mechanics need tightening.** Specify a synchronous (`flush: "sync"`) profile watcher and epoch-stamp raw flights themselves. Reattaching a new-epoch attempt to an old raw FPC promise can otherwise bless old-profile data under the new epoch. The A→B→A test must assert both non-commit and non-reuse across epochs.

5. **Validation gaps.** Phase 2 lacks the three tests above, capability-union/release transitions, and alternating-leg last-good-FPC retention. “Reconnect re-prime” and FeeSettingsCard’s new peek RPC also contradict “otherwise identical traffic”; remove them or enumerate/approve them as deviations. [test list](/home/homelab/Projects/nulo/.claude/worktrees/balance-fpc-cache/implementations-plan/balance-fpc-cache/plan.md:156)

**Verdict: conditional approve (with conditions: resolve findings 1–5 and obtain explicit owner approval for deviation 4 before Phase 1).****Verdict: reject (with blocking findings: incomplete cross-profile protection, an ambiguous fail-closed data model, and unresolved cross-cause retry semantics).**

1. **Critical — D3 does not close the full cross-profile path.** The popup epoch fence protects its FPC slice, but SW `GasBalanceReader` caches by `(networkId, accountAddress)` while computing `privateFeeJuice` through profile-filtered `getFpcs()`. It has no active-profile invalidation. Profile B can therefore receive profile A’s cached PrivateFPC balance before the Pinia fence sees it. Profile-scope that SW cache or invalidate/fence it on profile change. Because this expands the approved behavior/traffic scope, its disposition is a second owner Ask; deviation 4 is not the only one.

2. **High — one gas `Slice.data` cannot express both consumers’ guarantees.** GasBalanceCard must retain a stale peek after refresh failure; FeeSettingsCard must treat that same failed refresh as unknown. Retaining `data` risks a positive stale balance passing fee enforcement; clearing it breaks the existing SWR pin. Separate last-known display data from the verified result returned by `ensure`. Additionally, `subscribe` auto-starting `ensure` can race `peek`; a late peek must never overwrite a newer fetch/forced commit.

3. **High — `retryVersion` is a signal, not sufficient retry ownership.** If a degraded FeeSettingsCard coexists with a successful tx refresh or another subscriber’s ordinary ensure, shared `gas.status` becomes ready without a retry bump; a status-driven loop can stop permanently while the card remains degraded. Conversely, a tx-refresh failure must not create Fee retry behavior. Track cause-scoped retry debt independently of slice status.

4. **High — epoch commit fencing is insufficient at the API boundary.** Send uses `appStore`; execute-window cards use local prop identities, so “the same identity source” does not exist. Moreover, an old `ensure` resolving after A→B→A must be cancelled/re-entered or return an epoch-stamped snapshot; the unchanged component identity guard otherwise passes the ABA. The normative interface also omits both advertised fields: `Slice.retryVersion` and `SubscribeCaps.peek`.

5. **Architecture/ledger.** Pinia ownership remains correct and outline B remains rejected. Narrow D6/D7: make the store an app-lifetime transport/resource broker with consumer-scoped freshness/retry policy, or explicitly model those separate states. Keep D1–D5/D8/D9, but D9 also needs an overlay-reset pin: clear only after successful forced refresh, never generic `gas.version`.

The five phases are insufficient until coexistence, late-peek, retry-debt, SW profile-switch, epoch-snapshot, and overlay-reset tests are explicit.**Verdict: reject (with blocking findings: unsafe cross-epoch re-entry and no implementable overlay-reset signal).**

1. **Epoch closure is still unsafe.** `getFpcs(chainId)` uses the SW’s active profile; caller-carried `profileId` does not bind the RPC. After A releases and B becomes active, A’s stale `ensure` can re-enter under A’s newly bumped epoch, fetch B’s FPCs, and validly cache them under A. Superseded ensures must cancel, not re-enter. Only a new live lease for the exact scope may retry. Add an A-pending→B test proving no re-fetch or commit under A.

2. **D9 is not represented by the normative interface.** GasBalanceCard loses `onTransactionUpdated`, while `GasSlice` exposes only general `version` and `retryVersion`. It therefore cannot identify a *successful forced-refresh commit* to clear its overlay. Add a cause-specific `forcedVersion`/`txRefreshVersion` or subscription callback, then pin failed-force retention and successful-force clearing. Capability examples must also include normative `peek`.

3. **D12 is architecturally sound but its integration plan contradicts itself.** The file map says execution service remains unchanged, and a reader unit test cannot prove `ExecutionService` actually wires profile changes to `invalidateAll()`. Amend the file map and add a facade/composition test.

D10’s display/verified split and D11’s independent retry debt are genuinely closed. The two owner decisions are logically independent, but Phase 1 currently couples them and gives no reject branches; specify independent accept/reject outcomes.**Verdict: conditional approve (with conditions: correct the remaining normative contradictions before implementation).**

The substantive designs are closed: cancellation prevents cross-profile re-entry; `forcedVersion` makes overlay reset implementable; D12 has the correct facade integration test; and the two owner Asks now have genuinely independent branches.

Required corrections:

- The normative `ensure()` comment still says it “re-enters on epoch staleness”; change it to typed cancellation.
- `FeeSettingsCard.runInit` must explicitly catch `EnsureSuperseded` as a no-op before generic failure handling—the post-await identity guard cannot observe a rejected promise. Add a Phase 4 pin proving no degraded state or retry is created.
- Phase 1 still says a reader test pins D12; replace that with the facade/composition test.
- Capability prose/examples and Phase 3 shorthand still omit normative `peek`.

With those consistency fixes, approve.