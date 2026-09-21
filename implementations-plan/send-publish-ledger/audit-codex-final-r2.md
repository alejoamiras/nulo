conditional approve (with conditions: reconcile the remaining contracts and phase gates, and close the mutation and modal-test gaps below)

Confidence: **high**. Rev 3 resolves the principal rev-2 blockers; no architectural redesign is needed.

- [Medium][E] **The closed-sheet test promises more than the handler guarantees.** `plan.md:335` says a closed-slot `send` event produces zero sends. At `:180–186`, a valid **non-gated** send passes through because `authorises()` is conditional on gating. **Fix:** either explicitly restrict that test’s claim to gated sends, or reject `source === "review" && !reviewOpen` unconditionally and test both variants. The latter is the clearer event contract.

- [Medium][D] **M17 can still pass vacuously.** Keeping the page mounted and execution unresolved (`plan.md:331,365`) removes navigation masking, but the button becomes natively disabled (`send.vue:651`; `packages/design/src/ui/Button.vue:103`). A second native `.click()` then never reaches the handler, even with its guard deleted. **Fix:** deliver two component-boundary click events without disabling-button suppression, or two synchronous activations before Vue patches the DOM. For M9, explicitly establish an elapsed deadline: otherwise closed-state readiness cleanup can independently reject the event and mask the removed `isOpen` check.

- [Medium][E] **Phase 3 cannot satisfy all its named tests while retaining the old notice.** It requires T11 before phase 4 replaces the notice (`plan.md:467–471`). T11 now requires no tag with a non-sendable token and funded FJ (`:333`), but the retained warning uses the same testid and still appears (`FeeSettingsCard.vue:769–776`). **Fix:** split T11’s assertions by implementation phase, adding the tag/no-token assertions with phase 4, or move the atomic notice replacement into phase 3. Keep every gate executable and green.

- [Medium][D] **The modal proof remains overstated.** `plan.md:372–374` excludes browser testing of stacked popups, while `:392–394` claims hit-tested proof that nothing remains clickable underneath. T13’s z-index and trap-activation assertions cannot establish actual containment or focus behavior when closing beneath another popup. **Fix:** add a deterministic browser component harness using the real popup store and chrome. Open two popups directly through their normal bindings; test pointer blocking, focus ownership, and closing underneath. This requires no live-chain trust-event timing.

- [Low][E] **Several residual statements contradict the corrected design.** “Stops naming the account → HIDDEN” (`plan.md:237–239`) is false for unresolved/custom payers, which become unknown. The sheet’s props still list only `displaceIdx` (`:207`) despite requiring separate order/depth inputs. Phase 5 and D13 still name M1–M17 (`:475,544`), omitting M18/M19 and M10b. Recon still claims the CI pairing is pinned (`recon.md:52`). **Fix:** align these with the facts table, two-number interface, complete mutant table, and corrected F11.

**Looks fine**

Order compaction is compatible with the existing consumers: I found no cached production order values. Registry components read orders through computed values or template bindings; `FormPopup` forwards its prop reactively (`ConfirmPopup.vue:28,86–87`; `FormPopup.vue:21–22`). Preserve payload-update behavior when reopening an existing key; idempotence should concern its order.

Deferring additional descriptor scope fields is reasonable given the existing live-identity fence (`FeeSettingsCard.vue:153–170`) and the revised transition tests. Those tests must establish HIDDEN first, then drive withdrawal through real events/responses.

The `ready` contract, funded/no-token case, adapted harness, explicit Asks and supported payer transitions close the earlier findings. I see no unnecessary machinery in the proposed compaction or review composable.