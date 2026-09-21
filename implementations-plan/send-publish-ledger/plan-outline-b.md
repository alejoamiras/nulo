# Outline B — the app's own idioms first (competing approach)

Same UI, same copy, same tests-at-every-layer bar as `plan.md`. Different angle: **change as little
structure as possible by using the mechanisms the app already has**, and let the fee card — the one
component that already knows the effective method — own the privacy facts.

## Shape

1. **Facts live in the card.** `FeeSettingsCard` already computes `payerNotice` from
   `effectiveMethod`. It gains one model, `v-model:publishFacts`, a plain object
   `{ you, recipient, amount, requiresReview, noticeShape, payerType }` computed from its own
   `originPrivacy` / `destinationPrivacy` props and `effectiveMethod`. The pure function still lives
   in `fee-privacy.ts` next to `feePayerNotice` (one file owns every privacy rule). `send.vue`
   derives nothing; it renders what the card says.
2. **The sheet is a registry popup.** `popups/SendReviewPopup.vue`, registered in `PopupManager`
   under the key `send_review`, opened with `popupStore.open("send_review")`. Its data comes from a
   small `cacheStore.sendReview` record the page keeps current (`facts`, amount, recipient, fee
   text, `canSend`) and its action is a stored callback — exactly how `cacheStore.confirm` +
   `ConfirmPopup` work today. It stacks, displaces and closes like every other popup, and e2e's
   existing popup helpers (`closeStuckPopup`, `popup-close-btn`) apply unchanged.
3. **Strip as an L3 composite** in `components/composite/send/PublishStrip.vue`, beside
   `SendTypesCard`, with a Storybook story (the repo's convention for L3) and ≥10 cases.
4. **Gate** = `publishFacts.requiresReview` from the card's model, checked in the footer click
   handler and again inside the popup's callback.
5. **Escape** is added to `Popup.vue` itself, for all popups — one fix at the source instead of a
   per-sheet listener.

## Why it might win

- No page-rendered popup: `Popup.vue`'s unmount gap never becomes reachable, so no change there.
- One owner for every fee-privacy rule; the tag and the strip cannot disagree because both come out
  of the same computed.
- Storybook coverage for the strip; keyboard users get Escape everywhere.

## Why it probably loses

- The gate would hang off a **display model** one watcher-tick behind the settings that are actually
  submitted. `plan.md` derives the gate from the submitted object; this cannot.
- A stored callback + a store record for live, reactive facts is the weakest part of the registry
  idiom: stale payloads are easy, typing is `unknown`, and a popup that outlives the page (it is
  mounted globally) could fire a callback into an unmounted page.
- Escape on all 28 popups is a behaviour change across the app — outside the UI-impact table.
- The card would compute facts about the recipient and the amount, which are none of its business.
