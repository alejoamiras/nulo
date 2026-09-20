reject (with blocking findings: stale zero can authorize public fallback; computed-selection integration omits existing FPC event paths)

**Security**

- **[High] A positively read zero is not necessarily current. Confidence: high.** `apps/extension/src/wallet/services/execution/gas-balance-reader.ts:75` serves cached balances for five minutes. More seriously, `:204–212` returns a pre-invalidation result to its original caller even though it marks the cache stale; `apps/extension/src/stores/balances.store.ts:170` then commits that result as `verified`. A private-gas receipt during the read can therefore leave exactly the listed-PrivateFPC + `"0"` state rev 3 treats as authoritative. The card subsequently ignores ordinary and forced balance commits (`apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:469`). The warning still renders, but the wallet can unnecessarily choose the revealing payer. **Smallest fix:** specify a freshness requirement for automatic public fallback, reject invalidated read results for that decision, and reconcile Send when relevant balance invalidation/recovery occurs. Add a zero-read → private-gas receipt → late completion regression. The legacy null-origin behavior can remain pinned.

- **No demonstrated A→B or network-X→Y balance substitution in the ordinary switch path. Confidence: high.** Reader keys bind network/address; store entries additionally bind profile/chain and fence profile epochs (`gas-balance-reader.ts:72`; `balances.store.ts:560–575`). The proposed full `committedScope` comparison closes the card-level mismatch. This protects identity, **not freshness**.

**Facts**

- **[Low] “Any method can still be picked by hand” overstates availability. Confidence: high.** `implementations-plan/send-fee-privacy-notice/plan.md:26` says this, but `apps/extension/src/popup/components/modules/send/fee-helpers.ts:181–189` disables unread public gas, and `:195–208` disables unread private gas. `FeeMethodSelector.vue:43` refuses disabled picks. **Fix:** describe manual recovery as choosing an *eligible* fee source. With both balances unread and no sponsor, the proposed hold has no immediately actionable choice.

- The numbered Facts concerning failure-to-`null`, partial FPC discovery, storage shape, and legacy reconciliation are supported. I found **no direct fabricated `"0"`** in the reader or its simulation-result unpacking; the security problem above is reuse of an actual old zero.

**Inferences**

- **[Low] D4’s Alpha usability cost is unmeasured. Confidence: high about the evidence gap; unknown incidence.** `apps/extension/src/wallet/services/fpc/service.ts:183–194` swallows discovery failures, but `:238` attempts protocol registration without an Alpha-specific exclusion. Source does not establish that Alpha users will usually hold—or usually reach fallback. **Fix:** retain the conservative rule, but record one fresh-profile Alpha observation covering registration and a zero private balance; do not characterize hold frequency without evidence.

**Asks**

- **[Medium] D10 still requires the recorded owner decision. Confidence: high.** `implementations-plan/send-fee-privacy-notice/plan.md:224–231` explicitly changes the approved recovery behavior. Dropping the extra timer is a reasonable engineering choice: the reader already retries thrown legs, and structural `null` is cached. However, another delayed attempt is not inherently futile—a transient failure can recover later (`gas-balance-reader.ts:218–229`). **Fix:** present the trade-off accurately: fewer retries and less lifecycle machinery, at the cost of leaving some recoverable holds until another read. This decision does not resolve stale-zero handling.

**Implementation**

- **[High] D8 does not yet cover the whole SFC. Confidence: high.** `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:219–232` updates/deletes only `selectedMethod`; neither handler updates `registeredFpcs`. Under the proposed Send branch, that ref stays unwritten, so these handlers become ineffective and the computed can retain a deleted sponsor or stale FPC metadata. `implementations-plan/send-fee-privacy-notice/plan.md:192–209` does not replace them. **Fix:** preserve the legacy handlers for null origin; for Send, update/invalidate the identity-scoped committed FPC input, then let the computed resolve. Test update/deletion during and after init.

- **[Medium] Loading preview needs a separate, explicit contract. Confidence: high.** The plan promises a saved-row preview in `pending`, but its `SendSelection` union omits `pending` (`plan.md:107–112`), and the effective-method mapping does not distinguish preview from selection (`:199–206`). The existing dropdown still binds `selectedMethod` (`FeeSettingsCard.vue:609`). **Fix:** define `pending` explicitly, derive settings only from `kind === "selected"`, and bind the dropdown to a separate display method. Keep embedded handling, locked-method precedence, and the cache mirror in the null-origin branch. `SelectFpcPopup.vue:59–68` writes the mirror, but the current card has no reactive readback from it; it is not an additional live selection source.

- **[Medium] D9 excludes reset from serialization. Confidence: high.** The queued writer can finish after the separate removal planned at `plan.md:244`, recreating cleared preferences; today’s removal site is `apps/extension/src/popup/pages/settings/security/reset.vue:84`. **Fix:** serialize and await clear through the same module. Keeping parsing and this small storage coordinator together is reasonable; simply do not describe the entire module as pure.

**Validation gates**

The five phases name real scripts and checkable criteria. Smoke’s settled-row wait removes the initial-render false positive. `interceptRpc` accepts Testnet’s `https://lb.drpc.live` origin and arms worker/document targets (`apps/extension/tests/e2e/helpers/rpc-intercept.ts:43–113`); gas traffic uses those contexts. The network fixture funds both gas balances and tokens (`fixtures/extension.ts:888–1025`), making the shield/send sequence achievable. Its 300-second budget remains empirical. No tests were run during this read-only review.

**Looks fine**

- Separate Send storage and per-origin picks.
- Pure resolver plus inline notice; existing helper reuse.
- Warning on explicit public-fee picks.
- Null-origin compatibility is achievable with the stated branch separation.
- No files modified.