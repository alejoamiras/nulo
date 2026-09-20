reject (with blocking findings: forced reads can still reuse an older zero; FPC event patches can be overwritten by snapshot commits).

**Security**

- **[High] BLOCKING — D20 does not guarantee a fresh mount read. Confidence: high; reproduced.** `forceRefresh` exists at `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:373`. The store correctly waits out its own older raw flight and forwards the flag (`apps/extension/src/stores/balances.store.ts:487`, `:508`, `:564`). However, the SW reader can have another document’s flight. At `apps/extension/src/wallet/services/execution/gas-balance-reader.ts:94`, the forced caller waits, then re-enters with **`false`**. Without an intervening invalidation, the older result is now freshly cached and returned at `:75`.

  I executed the existing reader in memory with fake view dependencies: an older request captured private `"0"`; the balance became `55`; a forced request arrived; both returned `"0"`, with only the original two view calls. The wallet can therefore default to public Fee Juice despite private gas received **before Send opened**. The warning still renders, but this violates D20’s freshness requirement.

  **Smallest fix:** preserve forced intent on re-entry and add the reader regression described below. Force bypasses an already-settled TTL entry; it does not currently guarantee a new computation after an overlapping request. Nor does it suppress a result invalidated during its own computation (`:204–212`); distinguish that accepted in-open residual from this pre-open defect.

**Facts**

- **[Low] Fact 20 overstates dropdown disabling. Confidence: high.** `apps/extension/src/popup/components/modules/send/fee-helpers.ts:181` and `:195` disable explicit `null` balances, but an **undefined whole balances object** leaves public Fee Juice enabled, and also private Fee Juice when its FPC exists. Thus a whole-fetch failure can show clickable rows that the proposed resolver refuses to select. **Smallest fix:** qualify Fact 20 and the UI-impact description; preserve the approved unchanged dropdown. The resolver’s independent eligibility check still protects payment.
- Fact 18’s unconditional “bypasses the reader cache” needs the concurrency qualification above. The remaining checked facts support the proposed design.

**Inferences**

- **[Low] I8 is a baseline, not a traffic bound. Confidence: high.** `apps/extension/src/wallet/services/execution/gas-balance-reader.ts:188` starts two legs, but `:218` retries each thrown leg once; store recovery can add subsequent attempts. **Smallest fix:** say “normally two view calls per successful open, excluding retries.”
- I2 and I4 are supported: the fee card mounts independently of token availability (`apps/extension/src/popup/pages/send.vue:594`), and smoke discovers new root-level test files (`apps/extension/vitest.e2e.config.ts:11`). I1, I5 and I7 appropriately remain empirical checks.

**Asks**

No blocking finding. Dropping the extra hold re-read is a sound engineering trade: per-leg recovery may require reopening, while whole-fetch failures retain store retries. `implementations-plan/send-fee-privacy-notice/plan.md:251` states that cost honestly. The owner’s pending approval remains a product gate, not grounds for rejection here.

**Implementation**

- **[High] BLOCKING — D21 patches only the current snapshot, so later commits can resurrect deleted FPCs. Confidence: high.** The plan preserves snapshot copying (`implementations-plan/send-fee-privacy-notice/plan.md:208`) while changing event handlers to patch only `registeredFpcs` (`:229`). But `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:328` unconditionally replaces that list from the store.

  Concrete sequence: FPC fetch completes with custom sponsor S; gas remains pending; S is deleted; the handler patches the still-empty local list; gas settles; commit installs the old list containing S; the computed selection selects S again. A later recovery commit can likewise overwrite a post-init patch. The deletion is real and supported (`apps/extension/src/wallet/services/fpc/service.ts:408`).

  **Smallest fix:** preserve scope-bound FPC event deltas through snapshot commits, or fence and refetch the affected FPC snapshot. Pin deletion/rename **after FPC fetch resolves but before gas settles**, plus recovery recommits. Merely testing events before fetching or after settled init misses this.

**Validation gates**

- **[Medium] The proposed stale-zero component test cannot establish SW freshness. Confidence: high.** The harness uses the **real store**, but replaces `ExecutionServiceClient.getGasBalances` (`apps/extension/src/popup/components/modules/send/FeeSettingsCard.test.ts:25`). It can verify flag forwarding and selection from a returned positive balance; it cannot verify reader cache behavior. **Smallest fix:** add a direct `gas-balance-reader.test.ts` case overlapping an older plain read **without invalidation**. The existing forced concurrency test explicitly invalidates first (`:428`), masking the defect.
- FPC events are accessible through captured callbacks (`FeeSettingsCard.test.ts:432`); delayed cloned storage can genuinely test queued-pick/reset ordering.
- All five phases name real commands with checkable criteria. No unrunnable gate found. Builds/E2E were not executed in this read-only review.

**Looks fine**

- `pending.preview` stays separate from payment settings.
- No additional uncovered `selectedMethod` consumer or selection-without-warning path found.
- The null-origin branch preserves legacy behavior as specified.
- Separate storage, per-origin picks, serialized reset, pure resolver and inline row are proportionate and reuse the existing infrastructure.