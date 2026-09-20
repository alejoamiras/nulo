reject (with blocking findings: incomplete unread-state protection, broken empty-state takeover, unresolved selection races)

Confidence: high on source findings; runtime timing remains untested. No files modified or tests run.

**Security**

- **[High] F2 confuses unavailable registration data with confirmed absence.** `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:328` converts missing FPC data to `[]`; `apps/extension/src/stores/balances.store.ts:216` preserves that absence after failure. Consequently, public balance positive + private balance null + failed FPC discovery bypasses the proposed `method.fpc` hold and selects `fj`. With the entire balance object undefined, `fj` can also appear enabled. **Fix:** pass registration-read status into resolution; only a successful discovery establishes absence.

- **[High] “Fresh methods” are not balance-aware during first reconciliation.** `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:82` withholds balances until initialization completes, but reconciliation happens at `:330`, before the gate opens at `:337`. Saved or mid-init `fj` therefore survives null public balance; private zero can incorrectly remain selected instead of falling back. **Fix:** build a separate balance-aware list directly from the committed entry for Send resolution, including saved picks and mid-init validation. Evaluate unknowns before accepting enabled rows; preserve legacy timing for null origins.

- **[Medium] The suppression explicitly violates the unconditional notice invariant.** `implementations-plan/send-fee-privacy-notice/plan.md:177` hides the notice for selected `fj` with confirmed-zero public balance. This is currently unsendable: `apps/extension/src/popup/components/modules/send/fee-helpers.ts:88` clears settings. **Fix:** either state the invariant as “every sendable private-origin `fj` selection warns,” and test suppression plus disabled Confirm together, or give the privacy row precedence. I found no demonstrated *funded* exception in the specified notice predicate.

- **[Medium] Hostile parsing does not cover every consumer.** `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:425` assigns raw storage directly to selection before reconciliation. The proposed `SavedMap` parameter also pretends unvalidated storage is already typed. **Fix:** accept `unknown`, validate nested records/FPC IDs, and use normalized slot reads for prefill, reconciliation, writes and pruning—not merely `readSlot` unit tests.

**Facts**

- **[Medium] Fact 7 overstates undefined handling.** `apps/extension/src/popup/components/modules/send/fee-helpers.ts:88` rejects an undefined balance *object*, but accepts an object whose `publicFeeJuice` property is undefined. The private branch rejects that case. **Fix:** qualify the Fact; if missing fields belong to the promised unread protection, normalize/reject them in the Send policy and test them.

- **[Low] A misrepresents B’s extraction boundary.** `implementations-plan/send-fee-privacy-notice/plan.md:225` says B inlines the walk into the SFC; `implementations-plan/send-fee-privacy-notice/plan-outline-b.md:11` puts it in `fee-helpers.ts`. **Fix:** remove that rejection rationale. Complexity budgets are per function, not determined by total SFC length.

**Inferences**

- **[High] I2’s synchronous watcher does not make surrounding awaits safe.** `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:418` prefills after storage awaits; `:430` identifies user intervention solely by reference inequality; `:499` independently awaits during recommit. An origin-driven replacement can masquerade as a user pick, while late storage can overwrite a real pick. The mirror alone also cannot prevent out-of-order whole-map writes (`:191`). **Fix:** capture identity/slot synchronously, track explicit-pick revisions, protect pending mirror entries from stale reads, serialize writes, and test flips during both awaits and recovery.

- **[High] The hold retry is incomplete, although forced refresh is a viable contained approach.** `apps/extension/src/stores/balances.store.ts:560` requires `legs`; the proposed call omits them. Forced success changes `forcedVersion`, not `retryVersion` (`:173`), so the card’s recovery watcher will not commit it. **Fix:** request `legs: ["gas"]`, explicitly recommit under identity/origin/pick guards, prevent overlapping retries and cancel pending scheduling on disposal. Do not introduce another store-wide retry policy.

- **[Medium] I1’s cache rationale is incomplete.** Missing return slots are cached normally, unlike thrown reads (`apps/extension/src/wallet/services/execution/gas-balance-reader.ts:218`). `forceRefresh` bypasses that cache at `:73`; however, an existing flight re-enters with `false` at `:94`. **Fix:** test both structural-null and thrown failures, including another document’s concurrent flight. Specify what happens after three exhausted attempts; “retrying” must not describe a permanently stopped loop.

**Asks**

- **[Medium] “Byte-for-byte unchanged” needs an explicit compatibility decision.** All three other mounts omit privacy props, so A redirects their shared flat preference into `any`. Its nested writes contradict `apps/extension/src/popup/components/modules/send/FeeSettingsCard.test.ts:377`, which requires top-level `.type`. **Fix:** preserve legacy flat storage separately from Send slots if literal compatibility is required; otherwise surface the narrower guarantee and required assertion change. Passing existing default/locked tests cannot prove storage compatibility.

**Implementation**

- **[High] The takeover formula fails its own acceptance cases.** With both balances zero, the resolver returns `none`; no selected method means `feeJuiceMissing === false` (`apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:160`), so no bridge takeover appears. Conversely, `anyMethodPayable(methods)` cannot distinguish disabled-zero from disabled-unread. **Fix:** derive confirmed exhaustion independently of selection, using balances and registration status; use that same result for the Send nudge and takeover.

- **[Low] Build the hybrid, after these corrections.** A’s pure policy and origin slots justify their boundaries; B loses deliberate private-origin public-payer preferences and lets public-origin preferences bleed across origins (`implementations-plan/send-fee-privacy-notice/plan-outline-b.md:32`). The inline row reuses the existing template idiom without needing a standalone component/test pair.

**Validation gates**

- **[High] I3 is false as written.** `.github/workflows/_extension-smoke-e2e.yml:76` deliberately supplies an **empty** seed list. Without a token, origin controls do not mount (`apps/extension/src/popup/pages/send.vue:547`). **Fix:** smoke-test the reachable fee card and disabled submission explicitly; retain flips in network/component tests. Require the trigger to exist before negative assertions.

- **[Medium] Gate mechanics need correction.** Scripts exist (`package.json:19`, `:31`, `:40`), but smoke only checks an existing build (`apps/extension/tests/e2e/global-setup-smoke.ts:38`). Build before Phase 3 smoke; pass `--retry=0` directly; inspect actual hunks rather than `git diff --stat`. I6 also mislabels CI: `.github/workflows/pr-extension-network-e2e.yml:195` runs this lane **proverless**. Specify a generous two-transaction timeout and measure any separate prover-ON run.

Looks fine:

- Sponsored-first, warn-and-allow, approved copy and fixed bridge link.
- Manual public-payer network coverage is achievable; default fallback belongs in component tests.
- Existing four-mount inventory and storage-pruning reuse are correct.