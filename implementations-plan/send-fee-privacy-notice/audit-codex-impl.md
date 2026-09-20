**Reject — high confidence: the forced-read guarantee has a reachable origin-switch gap.**

1. **P1 — Private fallback can use an unforced cached zero.** [FeeSettingsCard.vue:478](apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:478). While the origin is public, switch to an account whose cached private balance is `"0"` although it received private gas before Send opened. Initialization reads unforced. Switching the origin to private then defaults to `fj` using that snapshot, without another read. The notice renders, but the wallet unnecessarily exposes the account. In-memory reproduction: `forceRefresh: false` → origin flip → emitted `fj`. **Smallest fix:** force initialization for every Send card, including public origins; preserve the no-origin behavior. Add the public-init → private-flip regression.

2. **P2 — Public hold falsely promises background recovery.** [FeeSettingsCard.vue:347](apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:347). With a healthy store, unread balances and no sponsor, public origin displays “retrying in the background,” although no retry is scheduled. Confirm remains unavailable indefinitely. This also adds a public-origin info row absent from the UI-impact table. **Smallest fix:** remove the healthy-public-hold fallback message; alternatively obtain approval for honest public-hold copy. Add a healthy-store/public-hold assertion.

3. **P3 — Saved Sponsored selection loses its loading preview.** [FeeSettingsCard.vue:170](apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:170). Reopen Send with a saved sponsor and delay gas loading. `registeredFpcs` remains empty until the combined commit, so `rowForPick` cannot resolve the sponsor: the trigger says “Select method” throughout loading. The table promises the last-used-method preview remains unchanged; the loading test covers only `fj`. **Smallest fix:** provide a display-only Sponsored preview until resolution, keeping it excluded from settings; test that case.

4. **P3 — New E2E violates the strict selector rule.** [fee-methods.test.ts:297](apps/extension/tests/e2e/network/fee-methods.test.ts:297). `[data-testid="send-destination-field"] input` depends on descendant structure. Adding another input or changing the recipient control can target the wrong element or break the test. **Smallest fix:** give the actual input a dedicated testid and select it directly.

5. **P3 — New comments include misleading narration.** [FeeSettingsCard.vue:184](apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:184) says a private send is paid from private gas—the fallback implemented here disproves that generalization. [fee-send-selection.ts:10](apps/extension/src/popup/components/modules/send/fee-send-selection.ts:10) claims “nothing is cast” immediately above a cast. **Smallest fix:** delete the first comment and remove the inaccurate clause from the second.

Looks fine:

- No private-origin `fj` selection without its notice found; settings and notice share the effective method.
- No material no-origin card regression found, including locked/embedded paths.
- Identity guards, FPC overlays, storage parsing and same-document serialization look sound. Cross-document lost updates remain explicitly accepted.
- The pure resolver, queue and overlay serve distinct guarantees; no material over-engineering found.

Verified the first three behaviors with an in-memory source harness; full suites were not rerun. Worktree clean; no files changed.**Reject — one new P1 finding, high confidence.**

- **Forced freshness is lost after a failed mount read.** [FeeSettingsCard.vue:479](apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:479), [balances.store.ts:641](apps/extension/src/stores/balances.store.ts:641).

  **Failing scenario:** The reader caches private gas `"0"` and positive public gas. Private gas arrives before Send opens. Send correctly requests a forced read, but `getViewDeps` throws before the balance reads. The reader retains its previous, TTL-valid cache entry. The store’s recovery calls `fetchGas` with `{ cause: "retry" }`, dropping `forceRefresh`; it receives the old zero and recommits it. Send consequently defaults to `fj` despite available private gas.

  I reproduced this using the actual reader, store and resolver sources in memory: requests were `[forced, unforced]`; actual private balance was `"55"`, recovered balance was `"0"`, and selection was `fj`. The notice still renders, but the freshness guarantee remains incomplete.

  **Smallest fix:** Preserve the forced-read requirement through recovery until a fresh read succeeds, while retaining the retry signaling that triggers the card’s recommit. Add a regression that warms the zero cache, fails forced dependency resolution, then recovers with private gas available.

The other fixes look sound. Your selector use is not materially riskier than the shared helper’s; I would not block this change on it.

No files changed; worktree clean. Full suites were not rerun.**Approve — high confidence.**

No new material findings.

Replaying the previous counterexample against HEAD now produces two forced calls, reads private balance `"55"` instead of cached `"0"`, and selects Private Fee Juice. Recovery increments `retryVersion`, clears `retryDebt`, and leaves `forcedVersion` unchanged.

The stateless fix closes the reported gap without adding unnecessary lifecycle state. No new material comment-quality or privacy issues found.

Verified with an in-memory source harness; full suites were not rerun. No files changed.