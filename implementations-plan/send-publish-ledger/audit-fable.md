# Fable audit — plan rev 1 (2026-09-21)

Same-family leg (`Plan` subagent, Fable 5.1), read-only, given plan.md rev 1, plan-outline-b.md,
recon.md and the full audit packet. Paths rewritten to repo-relative.

**Verdict: conditional approve** (with conditions: fix findings 1–8 in the plan before
implementation. Most of the architecture is sound: pure facts, the gate derived from the submitted
settings, and a locally rendered sheet. Four things are not: the HIDDEN claim covers user-added FPCs
the wallet cannot vouch for; the chokepoint is duplicated; the test plan has several vacuous legs;
and the sheet's stacking rule is inverted.)

Limits stated by the auditor: it could not lint a modified `send.vue` (finding 2 rests on a static
line count), and the Escape behaviour in a real action popup (finding 9) is from reading Chrome and
focus-trap, not from a run.

## Findings

1. **[High][A/B] HIDDEN is asserted for FPCs the wallet cannot vouch for.** `NewFpcPopup.vue:75`
   registers any address as a `DefaultSponsoredFpc`; `buildFeeMethods` offers every such row
   (`fee-helpers.ts:168-171`) and `settingsForMethod` collapses it to `{kind:"fpc", fpcId}`
   (`:94-96`). `payerKindOf` would return `contract` and the strip would say "You: HIDDEN · paid by
   the sponsor". A hostile FPC is called from the account, so it can publish the caller. The shipped
   notice only warned; the strip reassures, which needs a higher bar. The settings object carries
   no trust bit. Fix: the card emits one payer descriptor (`type`, `isProtocol`); `contract` only
   for protocol rows, otherwise `unknown` or a new word (an owner Ask).
2. **[High][C] `handleSend` is already at the line cap.** `send.vue:315-402` is 80 non-blank lines;
   `biome.json:62-65` caps at 80. The plan adds lines and says the body is reused as-is. Fix: phase
   3a writes characterization tests for the existing submit; 3b extracts e.g. `submitTransfer(args)`
   with the promise chain; only then add the gate.
3. **[High][C/D] Two decision sites, so mutant M4 cannot be killed.** `onPrimary` reads a computed
   that re-evaluates at click time; the re-check inside `handleSend` can never differ. Fix: one gate
   site inside the submit function; bind the bypass to UI state (`reviewed && reviewOpen`); drop the
   "snapshotted settings" claim — no `await` separates the reads.
4. **[High][D] A stubbed fee card hides the integration that matters** — `effectiveMethod →
   derivedSettings → watch → feeSettings → facts`, the pending-to-selected window and the identity
   switch. A stub can emit states the real card never produces, which makes M3 artificial. Cheapest
   sound alternative: `send.integration.test.ts` mounting `send.vue` with the real card, reusing
   `FeeSettingsCard.test.ts`'s mocks (precedent: `fee-freshness.integration.test.ts:1-7`); sweep
   funding shapes × origins plus a held balance promise; assert in the DOM tag ⇔
   `data-action=review` ⇔ `data-you=exposed`; then click and assert the `executeTransfer` count and
   `paymentMethod.kind`. Keep the stubbed file only for footer precedence.
5. **[High][D] The adaptive e2e helper makes T17 vacuous.** A helper that follows
   `data-action=review` passes whether the gate appears or not. Fix: `expect: "send" | "review"`,
   throw on mismatch; assert the finding-4 DOM invariant on every send; add a real private→private
   one-tap send with a hand-picked sponsor.
6. **[Medium][A] The sheet sits above popups that open while it is up.** `PopupManager` opens
   `incoming_trust` asynchronously; `displaceIdx = popupStore.len` lifts the sheet above it while
   focus-trap activates the trust popup's trap underneath. `initialFocus:false` (`Popup.vue:30`)
   also leaves focus on "Review send" behind the modal. Fix: take an order slot in the store
   (`popupStore.open("send_review")`, which also honours `closeAll` on lock, `app.vue:175`), keep
   rendering locally with typed props, move focus into the sheet on open. The plan contradicts
   itself ("no store" and `popupStore.len`).
7. **[Medium][D] T14 is vacuous, and `unknown` leaks through the `aria-label`.** Smoke has no token,
   so the strip is absent. Rewrite T14 honestly; kill M5 in the finding-4 test via the pending state.
   The `aria-label` template has no `unknown` branch — "publishes nothing" on an unresolved payer.
8. **[Medium][D] e2e clicks are synthetic, keyboard claims are mocked.** `clickByTestId` bypasses
   hit-testing; use `pointerClick` (`tests/e2e/helpers/legal-drivers.ts:66-80`) for the strip,
   "Review send" and "Send now". Every repo precedent mocks focus-trap, so "CTA reachable by Tab" in
   jsdom proves nothing — move it to a real `keyboard.press("Tab")` in the network test. "Asserts
   focus return if it holds" is not a test: require it or drop it.
9. **[Medium][B] Escape facts are missing or wrong.** focus-trap defaults to
   `escapeDeactivates: true`: today Escape already releases the trap and leaves the popup open. The
   wallet is a `default_popup`, and Chrome closes action popups on Escape; e2e runs in a tab and
   cannot see it. Fix: opt-in `closeOnEscape` on `Popup.vue`, default off, wired through
   focus-trap's own hook with `preventDefault()`; verify once by hand in the real action popup.
10. **[Medium][C] Tag ⇔ gate should hold by construction, not by T3.** Pass the page's
    `requiresReview` / `noticeShape` down as props; delete the card's second predicate. Key the fee
    line's "your address" on `payerKind`; use the payer type only for "fee contract" vs "sponsor".
11. **[Medium][B] Silent decisions that need an owner Ask:** the sheet opened from the strip with an
    empty amount or recipient; Escape closing this sheet only; the word for a non-protocol FPC;
    closing the sheet on an account, network or token switch; the label changing while the payer is
    pending; whether the new sentences are verbatim from the artifact.
12. **[Low][B] Misstated facts:** `FeeMethodSelector.test.ts` already exists; no `Popup.vue` test
    exists; I5 is false (`fee-methods.test.ts:112-114`, `174-176` click `send-submit` directly —
    both public-origin); `feeView.remedyHref` is null once the remedy moves; I4 ignores fixture
    setup time — co-locating the real sends in `fee-methods.test.ts` avoids the lane edits.
13. **[Low][A/C]** Clear the arm timer in `onScopeDispose`; guard the `send` emit in script, not only
    through `disabled`; deactivate the trap on unmount with `{returnFocus:false}` and skip creation
    if unmounted during `await nextTick()`; place the sheet outside the sticky `.bottom`.
14. **[Low][C]** Adopt outline B's L3 placement for `PublishStrip` and the marks
    (`components/composite/send/`), with a Storybook story — a visual sweep for the owner. Put
    `publish-facts.ts` where an L3 component can import it.

Missing realistic mutants: `settings?.kind` instead of `paymentMethod.kind` (build T2 inputs with
`settingsForMethod`); the sheet CTA wired without the review source; the strip `v-if` dropped; the
re-arm watcher missing; the review not closed after a send.

## Looks fine

F1–F5, F7, F9–F12 check out. Estimate reuse cannot swap the payer (`feeSettingsHash` compared at
consume, `transfer-estimate-reuse.ts:172`). `needsFeeJuice` implies `feeSettings` undefined on Send.
Native `disabled` blocks synthetic clicks. An identity switch closes the settings gate
(`FeeSettingsCard.vue:152-160, 178-180`). No new dependency, permission or logging. `fjwc` and
`embedded` map to `unknown`, never HIDDEN.
