**Conditional-approve with conditions 1–4 below. Confidence: high on source findings; moderate on abstraction tradeoffs.**

1. **Medium — K3 loses branch remounting.** [OperationCard.vue:390](apps/extension/src/popup/windows/execute/OperationCard.vue:390) and `:422` currently receive distinct compiler-generated branch keys. Merging them reuses descendants when `op.kind` changes between simulate/profile. [AddressDisplay.vue:67](apps/extension/src/components/AddressDisplay.vue:67) initializes its displayed address/contact only on mount, so a same-instance kind/destination change can retain the previous address. **Key the merged branch root by `op.kind`; add one switching case with a changed destination.** No `AddressDisplay` refactor.

2. **Medium — L2’s implementation correction survived consolidation; its required parity cases did not.** [plan.md:80](implementations-plan/dedup-p5-vue-components/plan.md:80) promises existing suites green, but [RecentActivityView.test.ts:219](apps/extension/src/popup/components/modules/general/RecentActivityView.test.ts:219) shallow-mounts without `token`. Restore rendered cases for token/account fallback, journal-plus-orphan coexistence and fallback suppression, both empty states, and token-presence remounting. Assert cancel/focus/click forwarding in those fixtures. The proposed computed and root key themselves are correct.

3. **Medium — tighten the remaining test contracts.** [plan.md:80](implementations-plan/dedup-p5-vue-components/plan.md:80), `:89`:
   - **N3:** four existing tests plus two colors do not meet the documented L3 minimum. Add meaningful transition, tooltip geometry, and adoption checks. Both FPC test harnesses omit `aboveSubmit`, so their current green results cannot detect a missing error note; see [NewFpcPopup.test.ts:42](apps/extension/src/popup/components/popups/NewFpcPopup.test.ts:42).
   - **M1:** pin the non-array fallback to wildcard at [CapabilityDetailPanel.vue:21](apps/extension/src/components/composite/capabilities/CapabilityDetailPanel.vue:21). Preserve index keys and branch roots. Keep the panel’s sanitizer import: the unknown-type branch still uses it at `:314`.
   - **N7:** outcome cases must assert close count and latch release, including false/undefined/throw; the reopen case must start a new pending decision before settling the old one.
   
   Cut arbitrary shape-count padding and duplicated helper-only assertions. N2’s transition cases and M1’s distinct scope/label cases are substantive. For N8, one mixed-boolean fixture can check all six ordered labels, property names, and icons.

4. **Medium — N2’s placement remains unreconciled.** [plan.md:26](implementations-plan/dedup-p5-vue-components/plan.md:26) introduces a host-independent L2 under extension `ui/`, while [CLAUDE.md:180](CLAUDE.md:180) assigns those primitives to `@nulo/design`. Resolve placement explicitly within N2’s scope.

**Low:** the plan references “Phase 4” and “four phases” despite defining three. N7’s “before the latch as today” is inaccurate: current symbol capture follows the latch.

**looks fine**

Agree with **N4 skipped**: the classifier/form plumbing does not justify extraction. Agree with **N7 kept** once its specified assertions are concrete; production actions are arrow closures, so passing them unbound loses no receiver.

N2’s separate transition branches, K8’s identity adoption, N3’s primary/red adaptation, and M1’s shared CSS preserve the intended shapes. L5/M5 partials are appropriate; emitted-CSS inspection should include the fee row’s static-hover override. Logged skips account for narrowed ledger promises; no deferred id or substitute work appears. HEAD’s source matches P4. No files changed or tests run.