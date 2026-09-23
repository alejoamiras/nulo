reject (with blocking findings: incorrect popup stacking, contradictory arming semantics, and integration tests that cannot prove their stated guarantees)

Confidence: **high** on source-backed findings; **moderate** on stale-descriptor race reachability. Read-only review; no files modified. References use repository-relative filenames.

**Facts**

- [High][B] **F14 conflates stacking with displacement.** `ConfirmPopup.vue:86` passes stored `order` to `Popup`; `:87` passes `len − order` to `PopupCard`. Rev 2 specifies only the latter (`plan.md:202–211`). Because `Popup.vue:57` derives z-index from that input, opening `incoming_trust` can leave review visually above the newer focus trap—the rev-1 finding remains unresolved. **Fix:** separate overlay order from card displacement; test actual hit-testing and focus ownership, not merely “higher order” in T13.

- [Medium][B] **F12’s integration precedent is misstated.** `fee-freshness.integration.test.ts:48–51,98–121` exercises reader → store → pure selection; it mounts no card. The real-card precedent is `FeeSettingsCard.test.ts`, whose mocks omit `TransferType`, estimation/execution methods, and usable page identity, and stub the selector (`:25–105`). **Fix:** specify an adapted harness with real card, selector, balances-store actions and model propagation; mock external clients, legal acceptance, routing and unrelated visuals. This looks feasible, but copying either fixture is insufficient.

- [Low][B] **Other factual overclaims need correction.** “Registry popups never unmount” (`plan.md:222`) is false: `PopupManager.vue:340` conditionally mounts the token picker. F11’s cited CI test pins `selfpay-phase`, not its pairing with `fee-methods` (`behavior-gating.test.ts:279–290`). Recon’s absent tablist claim is contradicted by `onboarding/pages/create.vue:125`. **Fix:** narrow the claims and add the missing pairing assertion if that guarantee matters.

**Inferences**

- [High][A] **Stack membership alone does not make the lifecycle safe.** The proposed `popups.send_review.order` dereference throws when absent (`plan.md:209`). Store orders also use current length, without renumbering on close (`popup.store.ts:17–30`): closing review underneath another popup can make the next popup reuse an occupied order. **Fix:** handle absent slots safely, make opening idempotent, preserve unique ordering after non-top removal, and test `closeAll`, unmount beneath another popup, and reopening.

- [High][D] **T12’s balance-event transition has no production path.** The card copies gas into local refs (`FeeSettingsCard.vue:434`), explicitly disables transaction refresh (`:349–355`), and observes retry versions rather than ordinary gas versions (`:592–607`). A token-balance event cannot empty its private-gas snapshot. **Fix:** stage the transition through an actual supported path—an eligible payer selection change, FPC deletion, or degraded-read recovery. Do not mutate card internals or enable refresh contrary to ancestor decisions.

- [Medium][A] **HIDDEN’s trust proof remains incomplete.** Protocol decoration concerns the row’s own chain (`fpc/service.ts:124–128`); execution separately checks chain compatibility (`fpc-strategy.ts:131–139`). The proposed descriptor omits scope (`plan.md:126`). Moreover, a sponsored row’s address can change under the same ID (`fpc/service.ts:399–403`), so ID equality alone does not prove current trust. The card’s scope fence (`FeeSettingsCard.vue:153–170`) helps; I found no demonstrated `fj` bypass. **Fix:** explicitly prove scoped descriptor invalidation across network/chain switches, delayed responses, and same-ID protocol→custom updates. Add live scope binding if those tests expose stale reassurance.

**Implementation and test contradictions**

- [High][E] **Optional review can become permanently unsendable.** T4 says “never arms when not gated” (`plan.md:310`), while the sheet requires `armed` unconditionally (`:204`). **Fix:** define readiness as immediate for non-gated sends and delayed 800 ms for gated sends, or condition the sheet guard on gating. Add an actual send from an optional non-gated sheet and a gated→non-gated transition.

- [High][E] **The no-token promise is not implemented by the proposed wiring.** The UI table promises no tag (`plan.md:39`), but only the strip checks `isBlockedTransfer` (`:233`). The card remains mounted without a token (`send.vue:621`); funded own FJ can still produce exposed facts and a tag. T15’s dead-RPC case cannot catch that. **Fix:** suppress the tag/review surface when transfer capability is absent; test no token **with resolved, funded gas**.

- [Medium][D] **Mutation claims still overstate coverage.** M5 is killed by literal null-payer expectations and token-bearing pending T12; M8 by T13’s successful armed submission; M11 by first-click zero-send assertions; M12 by a protocol-funded T11 case expecting HIDDEN. Those are realistic. **M9, however, survives the stated T13 path:** the sheet’s independent `show` guard prevents emission before `authorises` runs. T4 kills it. **Fix:** correct the mapping; test the handler’s closed-review rejection directly through a legitimate component-event boundary. Similarly, explicitly assert closure before navigation for M15 and keep the page mounted/in-flight for M17.

**Asks**

- [Medium][B] **Approval status is ambiguous.** A1–A8 remain open, while each displays an emphatic recommendation such as “Yes” (`plan.md:414–425`). **Fix:** distinguish recommendation from recorded approval. I1 has an explicit fallback; I2/I4 need defined stop-and-revise outcomes rather than phase 3’s claim that every fallback is already stated.

**Looks fine**

The single settings-based gate, C0 timer composable, L3 facts placement and L4 import direction are justified (`CLAUDE.md:267–271`; `biome.json:363–414`). Moving pinned copy preserves its contract. Extracting the submission tail is sensible if execution-client ownership survives navigation. Explicit helper expectations improve T17, though DOM equivalence proves consistency, not correctness. The opt-in Escape hook is appropriate. Deferring pre-existing refresh rejection and cached-estimate mismatch work remains reasonable.