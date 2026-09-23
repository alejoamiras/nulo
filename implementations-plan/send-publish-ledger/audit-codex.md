reject (with blocking findings: incomplete consent checks, popup lifecycle hazards, and tests that cannot prove their stated invariants)

Confidence: **high** on source-backed findings; **moderate** on race reachability pending integration tests. No files modified. References below use filenames within the extension unless otherwise indicated.

**Facts**

- [High][B] **F6 understates existing Escape behavior and overstates accessibility.** `Popup.vue:29` uses `focus-trap` without overriding its default `escapeDeactivates: true`; Escape already releases containment without closing the popup. The supplied chrome also has no `role="dialog"` or `aria-modal`, contrary to the security section. Coordinate closing with trap deactivation and add dialog semantics locally. T7’s permitted mock cannot prove containment: `Dropdown.keys.pins.test.ts:11` replaces the trap with no-op spies.

- [Medium][B] **T3’s unconditional equivalence is false.** `settingsForMethod` returns `undefined` for FJ with zero/unknown public balance (`fee-helpers.ts:88`), while `feePayerNotice` checks only origin and method type (`fee-privacy.ts:149`). Restrict the theorem to eligible, resolved selections and separately test pending/hold/none. `buildSettings` does preserve `paymentMethod.kind`; the proposed classification is sound for valid Send outputs.

- [Medium][B] **I5 is already disproved.** `fee-methods.test.ts:114` and `:176` submit directly outside `fillAndSubmit`. Inventory and update those paths explicitly. Also, `FormPopup.vue:40` forwards only its declared button bindings: passing `data-armed` to the composite will not place it on the CTA. The implementation map needs an explicit solution.

**Inferences**

- [High][A] **`reviewed: true` is weaker than current consent.** The proposed handler checks neither `reviewOpen` nor the current arm deadline (`plan.md:141`). Closing only changes visibility; the leaving transition can retain the CTA, and its disabled formula omits `!show` (`plan.md:170`, `Popup.vue:50`). Reject submit events after close/unmount and before the current deadline in the handler itself. Test close-then-click during transition, rapid reopen, repeated activation, and non-gated→gated immediately before submission. An 800ms disabled appearance alone does not establish authorization.

- [High][C] **The unmount fix does not cover pending activation.** `Popup.vue:28` awaits `nextTick()` before creating the trap. Unmount can deactivate nothing, then the continuation can attempt activation against a removed wrapper. Close/reopen can likewise leave stale continuations. Invalidate pending activation and recheck mounted/show state after the await; test those interleavings. `refreshSession()` is also a real asynchronous service call (`Popup.vue:26`, `profile/service.ts:999`), not presentational chrome: cover rejection and lock-during-open.

- [High][C] **Visual stacking and focus ownership can disagree.** Incoming notes can automatically open `incoming_trust` (`PopupManager.vue:102`). A review using live `popupStore.len` remains visually above that new registry popup, while the newly activated trap can own focus underneath it. `Popup` expects an order for z-index; `PopupCard` uses reverse depth for displacement (`SelectTokenPopup.vue:160`, `PopupCard.vue:22`). Outline B correctly identifies stack coordination as reusable. Keep page-owned data/actions, but define shared stack ownership or explicitly close/suspend review when another modal opens. Test the automatic trust-popup case.

- [High][A] **Identity and watcher transitions are missing from the proof.** The card publishes settings through a scheduled watcher (`FeeSettingsCard.vue:250`); the page separately reloads identity-scoped data asynchronously (`send.vue:465`). T12 directly replacing the parent model bypasses that integration. Mount the real card with controlled service responses and drive account/network changes, origin/destination toggles, degraded-read recovery and balance events through their actual interfaces. Assert displayed facts, tag, CTA and submitted arguments together. Specify whether review survives identity changes; `facts.you` staying `exposed` does not re-arm anything.

**Asks**

- [Medium][B] **Resolve unapproved states beyond A1–A3.** The strip opens review on invalid/incomplete sends, but missing amount/recipient/estimate/payer copy is unspecified. The accessible summary can say “nothing” while the payer is unknown (`plan.md:219`). Decide these renderings, focus entry/return, and identity-change behavior explicitly under `CLAUDE.md`’s UI sign-off rule.

- [Medium][B] **Define what “You HIDDEN” promises.** A private→public transfer to the sender’s own address with an FPC still publishes that address as recipient. The proposed facts function has no address inputs. This is a semantic gap in the absolute “account is not named” claim, even if the intended meaning is only “not identified as sender/fee payer.” Obtain that scope decision without silently broadening the approved gate.

**Test strategy**

- [High][D] **M4 survives T12 as written.** Vue computed values update on access before DOM rendering: after replacing settings with FJ, `onPrimary` reads the new `facts` and opens review without reaching `handleSend`. Deleting the inner check therefore still passes. Prefer one submission entry point owning the gate; otherwise exercise the inner entry directly. Do not manufacture an impossible asynchronous gap between two synchronous reads merely to kill the mutant. M12 similarly need not fail T12 because the page’s invalid-form guard remains.

- [High][D] **T14 is vacuous for the strip.** Smoke has no token; `send.vue:104` makes `isBlockedTransfer` true and the proposed strip is absent. “Not HIDDEN” cannot kill M5 there. Keep smoke’s narrower dead-node assertion and prove unknown visibility with a token-bearing real-card mount. This repeats the ancestor lesson’s warning about artificial mutants (`send-fee-privacy-notice/lessons/phase-5.md:87`).

- [High][D] **T17 lets the implementation choose its expected behavior.** Automatically following `data-action="review"` masks erroneous gates. Give helpers an independently specified expected action and fail on mismatch. T16 omits actual private→public gated submission and private-origin sponsor/Private-FJ one-tap submission; cover those through real-card integration. Add mutants for a miswired primary handler, swapped destination binding, stale review acceptance, missing model propagation, duplicate sends and cached-estimate payer mismatch.

**Looks fine**

The L4 placement, pure facts table, copy reuse, atomic notice replacement and settings-based gate are preferable to B’s callback store. Existing estimate reuse compares payer settings (`transfer-estimate-reuse.ts:164`). Proverless heavy placement is reasonable, but measure headroom: it already includes `selfpay-phase`. No new dependency or privilege is needed. Existing helper diagnostics expose amount/address fragments (`helpers.ts:1151`); avoid expanding them.