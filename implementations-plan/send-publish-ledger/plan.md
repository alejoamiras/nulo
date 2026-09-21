---
plan: send-publish-ledger
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off
harden: not scheduled
budget: recon 2 agents; codex at high; code-review off (owner, Phase 0)
status: rev 4 — APPROVED by the owner (2026-09-21), A1–A9 as recommended; implementation in progress. Rev 1: codex reject, fable conditional approve. Rev 2: fresh-context codex pass → reject. Rev 3: codex closure check → conditional approve; its five conditions are folded into rev 4 (§ Decision ledger, § Audit verdicts).
base: dev @ 06010c9b
---

# send-publish-ledger

Tell the sender, at the button, what a send puts on the public chain — always, in one line — and
make the one send that names them against their intent pass through an explicit review.

Design source: the owner-reviewed artifact *Publish Ledger Options* (v3, round 2 option **B** + the
fee-source tag): https://claude.ai/artifact/8dZX1ydpR97C6vJ2Rq1cXH

**UI impact** (owner sign-off required per CLAUDE.md § UI changes; record below):

| Surface | Before | After |
|---|---|---|
| Send → sticky footer, whenever a transfer is possible | Only the primary button (99px footer) | A one-line **strip** above the button (+38px): three cells **You · To · Amount**, each a square mark plus one word, and a chevron. The whole strip is one button that opens the review sheet |
| Strip → words | — | You: **SENDER** (public origin) / **FEE PAYER** (private origin, own Fee Juice pays) / **HIDDEN**. To: **PUBLIC** / **HIDDEN**. Amount: **PUBLIC** when either side is public, else **HIDDEN** |
| Strip → marks | — | hollow grey square = hidden; filled square in primary ink = public by choice; filled **orange** square = public against a private origin (the FEE PAYER cell only). Shape and word carry the meaning; colour only reinforces. No eye icons (the recipient card owns the eye) |
| Strip → You cell, private origin, while the wallet cannot vouch for the answer: no fee source resolved yet (loading, held, no gas), or the payer is a **hand-added** sponsor contract | — | **—** with a dimmed hollow mark — never HIDDEN on a payer the wallet does not know (**Asks A2, A4**) |
| Send → primary button, private origin **and** the account's own Fee Juice pays | "Confirm Transaction" sends | Reads **"Review send"** and opens the review sheet; the send happens from the sheet |
| Send → primary button, every other state | "Confirm Transaction" sends in one tap | **unchanged** |
| Review sheet (new; the app's bottom-sheet chrome, as the token picker — **Ask A3**) | does not exist | Header **Review** + close; the amount with its symbol; **to** name · `0x????????…????????` (the recipient card's masked form); **This send publishes** — rows *Your address*, *Recipient*, *Amount*, each mark + word, and **a sentence on public rows only** (§ Copy); **Fee · ~n FJ — paid by** *your address / the fee contract / the sponsor*; CTA **Send now** |
| Review sheet → *Your address* row in the gated state | — | The shipped notice sentence for the destination (both wordings, verbatim) + link **Get private gas** → the fee-juice bridge |
| Review sheet → *Your address* row, hand-added sponsor | — | **—** + "This fee contract was added by hand. Nulo cannot tell what it publishes about you." (**Ask A4**) |
| Review sheet opened from the strip on an unfinished form | — | Missing amount, recipient or fee read **—**; **Send now** is disabled (**Ask A5**) |
| Review sheet → **Send now** when the sheet opens as the mandatory step, or when the send turns into one while the sheet is open | — | Disabled for 800 ms, then enabled (**Ask A1**) |
| Review sheet → closing | — | Close button, backdrop, **Escape** (this sheet only — **Ask A6**); it also closes by itself on an account, network or token switch and on lock (**Ask A8**). The form underneath is untouched |
| Send → fee card, the warning row under "Available" (`send-fee-privacy-notice`, 118px) | Icon + **"Your address pays this fee"** + body + "Get private gas" | **Removed.** Replaced by a zero-height tag **■ NAMES YOUR ADDRESS** (orange filled square) on the right of the **Fee Source** label, in the same state only |
| Send → fee card, every other state | — | **unchanged** |
| Send with no sendable token | The fee card is mounted anyway, so the warning row could appear above a form that cannot send | **No strip, no tag, no "Review send"** — with nothing to send there is nothing to publish |
| dApp execute window; authwit popups | — | **unchanged** |

Sign-off record — the owner's words, in session, 2026-09-21, on the artifact above. Round 1 (six
options): *"I'm leaning towards 01 and 05 to be honest … I like how explicit 05 is."* Round 2 (A/B/C
combining them): *"I actually like B, you've really nailed it."* On replacing the fee-card notice:
*"Wondering if this could save the 'Your address pays the fee' on the 'Fee source' section on the
SendPopUp, as its pretty noisy"*, then on the tag mock: *"Oh! I really like the tag. amazing work
man. I think we are happy to blueprint."* This **reverses two rulings of `send-fee-privacy-notice`**
("no privacy badge on the fee row", "no change to `FeeMethodSelector`") — deliberately, by the same
owner, after seeing it. Phase 0 answers: sheet rows — *"Public rows only"*; tag copy — *"NAMES YOUR
ADDRESS"*; validation — *"All layers, proverless"*; `/code-review` — *"Off"*. Quality bar: *"let's
please be mindful of having good e2e tests here, and testing the variants. I want this to be
top-notch quality, not monkey-patches, and I want us to be sure it works correctly, just through the
tests even."* The strip words, the three public-row sentences and the "paid by" wording are verbatim
from the artifact the owner reviewed. Approval gate, rev 4, on A1–A9 and the whole UI-impact table: *"Go with all the recommended. Approved."* — every Ask is
decided as the plan recommended (§ Assumptions). Screenshots
of the strip, the sheet (gated and not) and the tag, in both themes, go on the PR.

## Why

`send-fee-privacy-notice` (#631) warns inside the fee card, which sits wholly below the fold of a
360×600 popup (card top at 513px of an 894px form, 437px visible) while Confirm is sticky: the
warning can be off screen at the moment of commitment. The owner accepted that residual on the
promise of this follow-up. The research behind the artifact says why a conditional, below-the-fold
row is weak: people do not notice a reassurance that goes missing (Schechter 2007), passive warnings
are ignored where active ones are heeded (Egelman 2008: 79% vs one participant), and a fixed slot
with changing content resists habituation better than an element that appears (Anderson 2015).
Caveat kept from the artifact: that literature is about security warnings; applying it to a privacy
readout is an inference.

A constant strip changes the wallet's posture from *warning* to *asserting*: HIDDEN is a claim the
wallet makes, so it needs a higher bar than a warning did. That bar drives the design below —
HIDDEN only on a payer the wallet can vouch for, "—" otherwise.

## Scope

In:

1. The strip, constant whenever a transfer is possible, derived from one pure facts function.
2. The review sheet: optional from the strip in every state, mandatory in the gated state.
3. The gate: private origin ∧ the submitted fee settings name the account — one decision site.
4. Notice row → tag, **in the same PR as the gate** — never before it.
5. Tests at every layer that can stage the behaviour (§ Test strategy), mutation-checked.
6. `Popup.vue`: lifecycle fixes a page-rendered popup makes reachable, and an opt-in `closeOnEscape`.
7. `handleSend` split so the money path stays under the 80-line budget, behind characterization tests.

Out: any change to the fee-source resolution rule or its storage (D30 of the ancestor plan stands);
per-cell popovers (round 1's option 01 detail — the sheet replaced them); sentences on hidden rows;
the dApp execute window and authwit popups; Escape or focus changes for the app's other popups (the
latent "Escape releases the trap but leaves the popup open" stays as it is — follow-up); a generic
bottom-sheet primitive; visual-regression tooling; smoke-harness work to seed tokens; detecting a
public send to one's own address (**A7**).

## Architecture & Implementation

### Shape

```
components/composite/send/          L3 — pure + presentational, Storybook story
  publish-facts.ts                  (origin, destination, payer) → facts; the copy; the payer reading
  publish-mark.module.css           the marks, composed by strip, sheet and tag
  PublishStrip.vue (+ .stories.ts)  facts → one <button> with three cells
composables/
  useSendReview.ts                  C0 — open/close, the arm deadline, "does this click authorise a gated send?"
popup/components/modules/send/      L4
  SendReviewSheet.vue               Popup + PopupCard + PopupHeader + rows + fee line + the CTA's ready state
  FeeMethodSelector.vue             + payerNoticeShape prop → the tag on "Fee Source"
  FeeSettingsCard.vue               − the notice block and its predicate; + payer model; passes the shape through
  fee-privacy.ts                    − NOTICE copy and feePayerNotice (they move to publish-facts.ts)
popup/pages/
  send.vue                          footer = strip + button; ONE submit function owning the gate; renders the sheet
  send-submit.ts                    the extracted fire-and-forget transfer (promise chain, toasts, awaiting row)
components/Popup/Popup.vue          pending-activation guard; deactivate on unmount; opt-in closeOnEscape
```

Reused as-is: `Popup`/`PopupCard`/`PopupHeader` (chrome, focus trap, backdrop close,
`popup-close-btn`), the popup stack (`popupStore` order/displace, `closeAll` on lock),
`Button variant="cta"`, `pointerClick` (e2e), the integration-test mocks of
`fee-freshness.integration.test.ts` / `FeeSettingsCard.test.ts`.

### Interfaces

```ts
// components/composite/send/publish-facts.ts — imports nothing from L4+
export type TransferSide = "private" | "public"
export type Visibility = "hidden" | "public" | "exposed" | "unknown"   // exposed = public against a private origin
/** What the wallet can say about who pays. `unvouched` = a contract it cannot speak for. */
export type PayerKind = "account" | "contract" | "unvouched" | null
export interface PayerDescriptor { type: "fj" | "private_fpc" | "fpc"; fpcId?: string; isProtocol: boolean }
export interface PublishFacts {
  you: Visibility; recipient: Visibility; amount: Visibility
  /** True exactly when `you === "exposed"`. */
  requiresReview: boolean
  noticeShape: "private-private" | "private-public" | null
}
type SubmittedFee = { paymentMethod?: { kind?: string; fpcId?: string } } | undefined
export function payerKindOf(settings: SubmittedFee, payer: PayerDescriptor | null): PayerKind
export function publishFacts(origin: TransferSide, destination: TransferSide, payer: PayerKind): PublishFacts
export function noticeBodyFor(shape: NonNullable<PublishFacts["noticeShape"]>): string
export const FACT_WORDS, FACT_SENTENCES, PAID_BY, stripAriaLabel(facts)
```

`payerKindOf` — the dangerous direction never depends on a display model:

- `paymentMethod.kind === "fj"` → `account`, from the settings alone.
- `kind === "fpc"` → `contract` **only if** the card's descriptor names the same `fpcId` **and**
  `isProtocol === true`; a matching non-protocol row → `unvouched`; no match → `null`.
- anything else (`undefined`, `embedded`, `fjwc`, malformed) → `null`.

`publishFacts`: `you` = public origin → `public`; private origin → `exposed` (`account`), `hidden`
(`contract`), `unknown` (`unvouched` or `null`). `recipient` = destination. `amount` = `public`
when either side is public.

`FeeSettingsCard` adds `defineModel("payer")` — a `PayerDescriptor | null` written by one watcher off
`effectiveMethod` (`isProtocol` is the read-time decoration already on the FPC row). It can only
ever *withhold* HIDDEN; it cannot produce `exposed` or suppress it. The card gains a
`payerNoticeShape` prop (default `null`) and forwards it to `FeeMethodSelector`; its own
`payerNotice` computed and `feePayerNotice` are deleted. **Tag ⇔ gate ⇔ strip hold by construction:
all three read the page's one `facts`.**

```ts
// composables/useSendReview.ts — C0: reactive state + one timer, no service, no store
export function useSendReview(opts: { isGated: () => boolean; now?: () => number }): {
  /** Not gated → true at once. Gated → true 800 ms after the sheet opened, or after the send became gated. */
  ready: Readonly<Ref<boolean>>
  onOpened(): void
  onFactsChanged(): void    // gated while open → the 800 ms start again; no longer gated → ready at once
  onClosed(): void
  /** A gated send is authorised only by the sheet's CTA, while the sheet is open and ready. */
  authorises(source: "primary" | "review", isOpen: boolean): boolean
}
```

### The gate — one decision site

```js
// No sendable token → no facts: no strip, no tag, no review, whatever the fee card resolved.
const facts = computed(() => isBlockedTransfer.value ? NO_FACTS
  : publishFacts(selectedSendType.value, selectedReceiverType.value, payerKindOf(feeSettings.value, payer.value)))
const reviewOpen = computed(() => popupStore.isOpened("send_review"))

function submit(source) {                       // the ONLY caller of submitTransfer
  if (!canSubmitNow()) return                   // existing early returns + the wall-clock fiat gate
  if ((source === "review") !== reviewOpen.value) return   // the sheet's event only while it is open; the footer only while it is not
  if (facts.value.requiresReview && !review.authorises(source, reviewOpen.value)) return openReview()
  isSending.value = true
  popupStore.close("send_review")
  submitTransfer(snapshotArgs())                // send-submit.ts
  if (!cancelled) leaveSend()
}
```

The footer button calls `submit("primary")`, the sheet's CTA `submit("review")`. Consent is not a
boolean the caller passes; it is *(the click came from the sheet)* ∧ *(the sheet is open — not
leaving, not closed)* ∧ *(the 800 ms have passed)*, checked in the handler. A send that is **not**
gated needs no authorisation: from the optional sheet it goes out at once. The disabled look of
"Send now" mirrors `ready`; it is never the authorisation. Invariant (tested with the real card):
**`executeTransfer` is never called with `kind: "fj"` under a private origin unless that handler
authorised it.**

`handleSend` is 80 non-blank lines today — exactly the budget. Before the gate is added, its
fire-and-forget half (awaiting row, `executeTransfer`, the toast / rejection / `finally` chain)
moves to `send-submit.ts` as `submitTransfer(deps, args)`, behind characterization tests written
against the *current* page first. No complexity acceptance is added.

### The sheet

`SendReviewSheet.vue` composes `Popup` → `PopupCard` → `PopupHeader` directly (`FormPopup` cannot put
a state attribute on its button). Props: `show`, `order` (→ `Popup`), `depth` (→ `PopupCard`), `facts`, `amount`, `symbol`,
`recipientName`, `recipientAddress`, `feeText`, `payerKind`, `payerType`, `canSend`, `sending`,
`ready`. Emits: `close`, `send` (guarded in script by `show && canSend && ready && !sending`, not
only by `disabled`). No store, no service client. Its root carries `role="dialog"`,
`aria-modal="true"`, `aria-labelledby`.

- **It joins the popup stack**, the way `ConfirmPopup.vue:28-30,86-87` does — two different numbers:
  `Popup` gets the slot's **`order`** (its z-index), `PopupCard` gets **`len − order`** (how far it is
  displaced behind newer cards). A popup that opens later (the incoming-transfer trust prompt opens
  by itself) has the higher order, so it is on top *and* its trap activates last and owns focus;
  lock's `closeAll()` closes the sheet. `show` is `popupStore.isOpened("send_review")`; an absent
  slot reads as closed with `order ?? 0` — nothing dereferences a missing slot. The page's
  `openReview()` does nothing when the sheet is already open (the store's `open` re-numbers an
  existing key; its behaviour for registry popups is left alone). Data and actions stay typed props and emits
  on the page — no store payload, no stored callback.
- **`popup.store.ts` keeps orders unique.** Today `open` assigns `order = count` and `close` never
  renumbers, so closing a popup that is *not* on top lets the next one reuse an occupied order. That
  is reachable once the sheet can close underneath a newer popup (identity switch, unmount). `close`
  now compacts: every slot above the removed one moves down by one. New `popup.store.test.ts`.
- The page closes it in `onBeforeUnmount` (before the existing service teardown — it owns no
  service) and on any change of the identity triple or the active token (**A8**).
- **Focus** moves to the sheet's heading on open and returns to the opener (strip or button) on
  close; both are requirements, asserted in a real browser (T16).
- **Escape**: `Popup.vue` gains `closeOnEscape` (default `false` = today's behaviour, byte for
  byte). When set, focus-trap's own `escapeDeactivates` hook calls `preventDefault()` and emits
  `onClose`. No second document listener.
- **`Popup.vue` lifecycle**: the trap is created after `await nextTick()`; the continuation now
  re-checks `props.show` and a mounted flag, and `onBeforeUnmount` deactivates an active trap with
  `{ returnFocus: false }`. The gap is already reachable for the one conditionally mounted registry
  popup (the token picker, `PopupManager.vue:340`, unmounts on lock); a page-rendered sheet makes it
  routine.
- The sheet is reactive to live facts: if the payer stops naming the account while it is open, the
  row follows the facts (HIDDEN for a protocol contract, "—" otherwise) and the send is allowed — it
  discloses no more than what was reviewed. If it
  *starts* naming the account, the 800 ms start again.
- Rendered as a child of the page root, outside the sticky `.bottom`, so the non-teleported
  backdrop covers the app.

### Footer template

```
.bottom
  PublishStrip                v-if="!isBlockedTransfer"   @open → openReview()
  Button send-get-fee-juice   v-if="needsFeeJuice"        (unchanged; wins)
  Button send-submit          v-else  @click="submit('primary')"  :data-action="review|send"
       label: isSending ? "CONFIRMING" : requiresReview ? "Review send" : "Confirm Transaction"
SendReviewSheet               (sibling of .body)
```

`needsFeeJuice` ⇒ no payer ⇒ `feeSettings === undefined` ⇒ `requiresReview === false`. "Review
send" is enabled on the same condition as Confirm. While the payer is pending the button reads
"Confirm Transaction" and is disabled (no settings ⇒ `isAllowedToSend` false); it may turn into
"Review send" when the payer resolves — the label never changes on an enabled button without the
facts changing.

### Test ids and state attributes (new)

`send-publish-strip` (`data-you`, `data-to`, `data-amount` = visibility), `send-submit[data-action]`,
`send-review-sheet` (`data-open`), `send-review-amount`, `send-review-recipient`,
`send-review-row-{you,to,amount}` (`data-visibility`; the you row also `data-notice-shape`),
`send-review-fee` (`data-payer`), `send-review-submit` (`data-ready`). Kept verbatim:
`send-fee-privacy-notice` + `data-notice-shape` (now the tag), `send-fee-privacy-remedy` (now in the
sheet), `popup-close-btn`. e2e waits key on these attributes, never on visibility — a leaving
`<Transition>` is visible while logically closed.

### Copy

Constants in `publish-facts.ts`, pinned by a literal test. All but the two marked lines are verbatim
from the reviewed artifact:

- You · SENDER — "A public origin shows the balance leaving your account, so your address is on the chain as the sender."
- You · FEE PAYER — the shipped notice bodies, unchanged (they move files, not words).
- You · — (hand-added sponsor) — "This fee contract was added by hand. Nulo cannot tell what it publishes about you." *(new — A4)*
- Recipient · PUBLIC — "A public destination shows the balance arriving at the recipient's address."
- Amount · PUBLIC — "Either side being public shows the balance change, and with it the amount."
- Fee line — "paid by your address" (keyed on `payerKind === "account"`) / "paid by the fee contract" / "paid by the sponsor".
- Strip `aria-label` — "This send publishes {…}. Open details", with "nothing" only when all three are hidden, and "your address: not known yet" when `you` is unknown *(new wording, not visible)*.

### File-level change map

Added: `components/composite/send/{publish-facts.ts, publish-facts.test.ts, publish-mark.module.css,
PublishStrip.vue, PublishStrip.test.ts, PublishStrip.stories.ts}`,
`composables/{useSendReview.ts, useSendReview.test.ts}`,
`modules/send/{SendReviewSheet.vue, SendReviewSheet.test.ts}`, `stores/popup.store.test.ts`,
`popup/pages/{send-submit.ts, send-submit.test.ts, send.test.ts, send.integration.test.ts}`,
`components/Popup/Popup.test.ts`, `tests/e2e/fixtures/send-page.ts`, `tests/e2e/popup-stack.test.ts`.
Modified: `send.vue`, `FeeSettingsCard.vue` (+test), `FeeMethodSelector.vue` (+ its existing test),
`fee-privacy.ts` (+test — the notice cases move to `publish-facts.test.ts`), `Popup.vue`,
`stores/popup.store.ts`,
`tests/e2e/fixtures/helpers.ts`, `network/fee-methods.test.ts`, every network file that calls
`sendTransfer` (an explicit `expect`), `tests/e2e/send-fee-privacy.test.ts`, `ARCHITECTURE.md`
§ fee model, `.claude/skills/e2e-testing/SKILL.md`, `implementations-plan/index.md`.
Deleted: nothing. No workflow file changes: the real sends live in `fee-methods.test.ts`, already on
its dedicated lane.

### Trade-offs and alternatives not taken

- **Outline B** (`plan-outline-b.md`): registry popup + stored callback + facts emitted by the card.
  Adopted from it: the popup-stack slot, L3 placement + story for the strip. Rejected: the store
  payload and callback (untyped, can outlive the page), the gate on a display model, Escape for all
  28 popups.
- **A bespoke `BottomSheet` composite**: pixel-faithful to the mock, but a second sheet system.
- **Gate from the card's model**: the settings object is the thing that is sent.
- **Two entry points with a `reviewed` flag** (rev 1): a flag is not consent, and the second check
  was unobservable (no `await` between the reads) — the mutation pass could not have killed it.
- **`FormPopup`**: cannot carry state attributes to its button; composing its three parts is the
  same chrome.
- **Always-review (round 2's C)**: rejected by the owner — two steps on every send.

## Test strategy

The bar: a reader who never opens the extension can conclude from the tests alone that every variant
behaves as the UI-impact table says. Each layer proves what it alone can; nothing is asserted twice
for comfort; a test that cannot fail is a defect.

| # | Claim | Layer | How |
|---|---|---|---|
| T1 | Facts for every `(origin × destination × PayerKind)` — 2×2×4 = 16 cells, the 2 gated among them | unit | expected table written out literally, one loop; `requiresReview ⇔ you === "exposed"`; `noticeShape` follows the destination and is null elsewhere |
| T2 | `payerKindOf`: inputs **built with the real `settingsForMethod`** for every method type × protocol / hand-added / mismatched `fpcId` / no descriptor; plus `embedded`, `fjwc`, `undefined`, malformed | unit | table |
| T3 | Copy is the approved copy; `stripAriaLabel` incl. the unknown branch and "nothing" | unit | literal pins |
| T4 | `useSendReview`: gated open → not `ready` before 800 ms, `ready` after; **not gated → `ready` at once**; becomes gated while open → the 800 ms start again; stops being gated → `ready` at once; `authorises` false for `primary`, false when the sheet is closed, false before the deadline, true after; timer cleared on scope dispose | unit (fake timers) | ≥10 cases |
| T5 | Strip: word, mark class and `data-*` per visibility × 3 cells incl. `unknown`; one `<button>`; emits `open` on click / Enter / Space | component | `test.each`; ≥10 cases + story |
| T6 | Sheet: rows and sentences per facts; hidden rows carry none; both notice wordings verbatim; the hand-added sentence; remedy `href`/`target`/`rel`; fee line per kind; masked recipient; placeholders on an unfinished form; `send` not emitted when `!show`, `!canSend`, `!ready` or `sending` even if the button is clicked programmatically | component | swept |
| T7 | `Popup.vue`: no trap created when unmounted or closed during the pending tick; active trap deactivated on unmount; `closeOnEscape` off = no `onClose` on Escape, on = `onClose` + `preventDefault` | component (trap spied) | new file |
| T8 | Card: `payer` model tracks `effectiveMethod` (type, `fpcId`, `isProtocol`), null while pending / held / none; tag rendered ⇔ `payerNoticeShape` prop; the old row and predicate are gone | component | the existing notice block, re-pointed |
| T9 | `submitTransfer` behaves as today's `handleSend` tail (awaiting row added / removed, toast, silent cancel, log level, `finally`) | unit | characterization, written **before** the extraction against the current page |
| T10 | Footer wiring with the card stubbed: strip absent with no token; `needsFeeJuice` wins; **two activations delivered in the same tick, before Vue patches `disabled` onto the button**, send once (a second native click on an already-disabled button would never reach the handler and proves nothing) | page mount | small |
| T10b | `popup.store`: orders unique and contiguous after closing a non-top popup | unit | new file |
| T11 | **Real-card integration** (`send.integration.test.ts`): `send.vue` + the real `FeeSettingsCard` + the real `FeeMethodSelector` + the real balances store; mocked: every external service client the page and the card construct (execution incl. the estimate methods, token, token-balance, FPC, transaction, contact, price, config), legal acceptance, the router; unrelated visuals stubbed. It adapts the card-level mocks of `FeeSettingsCard.test.ts` and the page-mount shape of `holdings.test.ts` — neither fixture is enough copied as is. Sweep funding shapes (no gas · public FJ only · private FJ only · both · hand-added sponsor) × origin × destination, **plus no sendable token with funded own Fee Juice** (no strip, action not review). The invariant grows with the phases so every gate stays executable: phase 3 asserts `data-action="review"` ⇔ `data-you="exposed"` (the old warning row is still in the card); phase 4 adds the tag to the equivalence and "no token → no tag". At every settled state assert **together**: tag present ⇔ `data-action="review"` ⇔ `data-you="exposed"`; the three cell values; then click and assert the `executeTransfer` call count and its `paymentMethod.kind` | page mount | table-driven |
| T12 | Transitions, each through a path production really has (the card snapshots gas at init and ignores tx-settle commits — `FeeSettingsCard.vue:349-355,592-607` — so a balance *event* cannot flip the payer, and no test pretends it can): balances held pending → `data-you="unknown"`, button disabled, no tag; the user hand-picks Fee Juice under a private origin → gated, a click on the primary button opens the sheet and sends nothing; the paying sponsor is deleted (FPC event) → the selection walks on; degraded read, then recovery through the store's retry; a protocol sponsor row updated under the same id to a custom address → HIDDEN withdrawn, "—"; network switch with a delayed response → "—" until the new scope commits, never the old scope's HIDDEN; origin / destination toggles; account switch while the sheet is open → sheet closed, nothing sent | page mount | |
| T13 | Consent: gated — "Send now" before the deadline → 0 sends, after → 1; **optional sheet on a non-gated send → "Send now" sends at once**; non-gated → gated while open → the 800 ms start again; gated → non-gated while open → sendable at once; the sheet's `send` event delivered to the page while the slot is closed → 0 sends, **for a gated and for a non-gated send**, with the 800 ms already elapsed so nothing but the handler's open-check can be what rejects it; the sheet is closed in the store **before** `leaveSend()`; another registry popup opened while the sheet is up → it has the higher z-index and the later trap activation, the sheet's card is displaced; the sheet closed underneath it → orders stay unique; `closeAll` → closed; unmount while open → slot released, trap deactivated; reopen → a fresh slot | page mount | |
| T14 | Close paths leave amount, recipient, token, origin, destination and fee pick intact | page mount | |
| T15 | Dead RPC (no token): strip absent, no tag, `data-action` is not `review` | smoke | the honest version — it does not claim to prove `unknown` |
| T16 | Real states and real sends, in `network/fee-methods.test.ts` (fixtures already paid for). Walks: `feeView` gains `you/to/amount/action` and reads the remedy from the sheet; asserted at every step the walks visit. Sends: (a) public → private in **one tap**; (b) private → private, own FJ: review label, first click sends nothing (no toast, no awaiting row, still on Send), while the sheet is open the footer's `send-submit` is covered at its centre (nothing stays clickable under the modal), sheet shows the exposed row with `private-private` + remedy href, close → form intact, reopen from the **strip**, wait `data-ready`, "Send now" → toast → tx **confirmed**; (c) private → public, own FJ: the `private-public` wording, through the sheet, confirmed; (d) private → private with a hand-picked **sponsor**: one tap, confirmed, the sheet never present; (e) keyboard: real `Tab` reaches "Send now" inside the trap and does not leave it, Escape closes, focus is back on the opener; (f) a non-gated send made **from the optional sheet** (opened from the strip) confirms | network, retry 0, proverless | strip, "Review send" and "Send now" are clicked with `pointerClick` (hit-tested), never a dispatched click |
| T17 | Every other network send | network | `sendTransfer` / `fillAndSubmit` take `expect: "send" \| "review"` (default `"send"`), **throw on mismatch**, and assert the T11 DOM invariant before clicking — every real send in the suite becomes a gate check |
| T19 | The popup mechanics the sheet relies on, in a real browser: with the app's existing two-deep stack (the accounts popup → "new account", `AccountsPopup.vue:114`), a control of the lower popup is **covered** at its centre (`elementFromPoint`), `Tab` cycles inside the top popup only, closing the top one makes the lower one reachable again | smoke | new test; normal bindings, no chain |
| T18 | Both themes | network | `shot()` under `NULO_E2E_SHOT_DIR`: strip × 3 states, sheet gated / not gated / hand-added, tag — committed to the plan folder and attached to the PR |

**Mutation pass** — a phase gate, per the ancestor plan's "confidence pass". Each mutant is a bug a
plausible edit would produce; each is applied alone on a quiet tree, the named tests must go red,
the result is logged in `lessons/phase-5.md`. A survivor is a finding.

| Mutant | Must kill |
|---|---|
| M1 `requiresReview` always false | T1, T11, T16b |
| M2 `requiresReview` true for any private origin | T1, T11, T16d, T17 |
| M3 `payerKindOf` reads `settings.kind` instead of `settings.paymentMethod.kind` | T2, T11 |
| M4 `contract` returned without checking `isProtocol` | T2, T11 (hand-added row) |
| M5 `you` = `hidden` when the payer is `null` | T1, T12 (pending) |
| M6 amount `public` only when **both** sides are public | T1, T16 walks |
| M7 destination prop bound to the origin ref | T11, T16c |
| M8 the sheet's CTA wired as `submit("primary")` | T13 |
| M9 `authorises` ignores `isOpen`, or `submit` drops its open-check (stale sheet accepted) | T4; T13's closed-slot `send` event, deadline elapsed, gated and non-gated |
| M10 the 800 ms dropped / not restarted when the send becomes gated | T4, T13 |
| M10b `ready` stays false on a non-gated sheet (optional review can never send) | T4, T13, T16f |
| M11 primary button calls `submitTransfer` directly | T11, T12, T16b |
| M12 `payer` model never written | T8, T11 (HIDDEN never appears) |
| M13 old notice row left in the card / tag rendered for any private origin | T8, T11 |
| M14 strip `v-if` dropped, or facts computed with no token | T10, T11 (no token, funded FJ), T15 |
| M15 sheet not closed before navigating away / on identity switch | T13 (store slot asserted closed before `leaveSend`), T12 |
| M16 `Popup.vue` pending-activation guard or unmount deactivate reverted | T7 |
| M17 `isSending` guard dropped (duplicate send) | T10 (two same-tick activations) |
| M18 `Popup` given the card's displacement instead of the slot's order | T13 (z-index) |
| M19 `popup.store.close` stops compacting | T10b, T13 |

Not provable by test, stated rather than faked: pixel fidelity to the mock (story + screenshots +
the owner's eyes); Chrome closing an *action popup* on Escape — e2e drives the popup in a tab, so
phase 3 checks it once by hand in the real popup, and if `preventDefault` does not hold there,
Escape support is dropped and A6 is withdrawn; real hit-testing of two stacked popups (jsdom has no
layout, and staging the trust prompt over an open sheet on a live chain is a timing lottery) —
T19 proves pointer blocking and focus ownership for a real two-deep stack, T13 the z-index and trap order that put the *sheet* in that stack, T10b that closing underneath keeps orders unique — the three together, not one browser test of the exact pair; Firefox focus behaviour locally (no `geckodriver` on
the dev box — the advisory Firefox lanes run the same files in CI).

## Security & Adversarial Considerations

- **Threat model.** The adversary the feature exists for is a chain observer; the failure that
  serves them is a *false reassurance*. Three defences: `exposed` derives from the submitted
  settings alone; HIDDEN requires a protocol-derived contract the descriptor and the settings
  agree on; everything else is "—". A hand-added sponsor is code the wallet has never seen, called
  from the account — it can publish the caller, so it is never HIDDEN (M4, M5). `isProtocol` is
  decorated per row against that row's own chain, and a sponsored row's address can change under
  the same id; the descriptor is therefore only ever read through the card's live-identity fence,
  and T12 proves HIDDEN is withdrawn on a same-id protocol → custom update and across a network
  switch with a late response. If either test exposes a stale reassurance, the descriptor gains the
  scope it was committed under and `payerKindOf` compares it — decided by the test, not assumed.
- **Consent.** Authorisation lives in the handler, not in how a button looks: source, open state
  and the arm deadline (T13, M8–M11). "Review send" and "Send now" share a screen position; the
  arm delay is what stands between a reflex double-tap and a send.
- **Modal integrity.** One popup stack, so the visually top popup is the one that owns focus. In a
  real browser: hit-tested clicks prove nothing sits over the sheet's controls and that the footer
  button is covered while it is open (T16b); a two-deep stack blocks the popup beneath (T19). Trap released
  on close, on unmount and never created after an unmount.
- **Rendering.** Contact names and addresses reach the sheet through text interpolation only — no
  `v-html`. The address appears in the recipient card's masked form; the sheet adds no reveal.
- **Remedy link.** Fixed build-time URL, `target="_blank" rel="noopener noreferrer"`, pinned by test.
- **Logging.** The new code logs nothing; amount, recipient and balances are on the never-log list;
  `log-payload-ban.test.ts` scans the new files. e2e helper diagnostics are not widened.
- **Estimate reuse** cannot swap the payer under the review: the service compares the fee-settings
  hash at consume time (`transfer-estimate-reuse.ts:164-172`).
- **Least privilege / crypto / supply chain.** No new permission, credential, cryptography or
  dependency (`focus-trap` is already bundled; the third-party-notices gate is untouched).
- **Availability.** The footer is on every send. A defect that strands "Review send" blocks the
  wallet's core action for the most common funded shape on mainnet (public Fee Juice, private
  balance) — hence T16b/c on the required lane, and T17 turning every other send into a check that
  the gate did *not* appear.
- **Known limit (A7).** "You · HIDDEN" means *not named as sender or fee payer*. A private → public
  send to one's own address still publishes that address — as the recipient, which the To cell
  says. The facts function takes no addresses; detecting self-sends is out of scope.

## Assumptions

**Facts** (verified in the tree at `06010c9b`; the audits re-checked them)

- F1. The notice block is `FeeSettingsCard.vue:769-790`; its predicate is `feePayerNotice` (`fee-privacy.ts:144-152`) off `effectiveMethod` (`FeeSettingsCard.vue:177-183`).
- F2. "Fee Source" is rendered by the child `FeeMethodSelector.vue:21`; `FeeMethodSelector.test.ts` exists.
- F3. `send.vue` receives only `feeSettings` and `needsFeeJuice` from the card (`send.vue:629-630`); `settingsForMethod` maps `fj → kind "fj"`, `private_fpc`/`fpc → kind "fpc" + fpcId` (`fee-helpers.ts:78-101`); `buildSettings` preserves `paymentMethod.kind`.
- F4. `handleSend` (`send.vue:315-402`) is the page's only caller of `executeTransfer`, is exactly 80 non-blank lines (`biome.json:62-65` caps at 80), and contains no `await` between its reads of `feeSettings`.
- F5. `needsFeeJuice` is true only on `sendSelection.kind === "none"`, where `effectiveMethod` and `feeSettings` are undefined.
- F6. `Popup.vue` creates its trap after `await nextTick()` (`:27-33`), has no unmount cleanup, leaves `escapeDeactivates` at focus-trap's default (`true` — Escape releases the trap and leaves the popup open), sets `initialFocus: false`, and calls `managers.profile?.refreshSession()` on open. Only `popups/*` render it today. No `Popup.vue` test exists.
- F7. `lockedMethod` is passed only by `windows/execute/OperationCard.vue`.
- F8. Smoke cannot stage a token-bearing Send page (`chrome-storage-token-seeds.ts:22,53`; `send.vue:104,574`).
- F9. The sandbox has all three payers; `feeJuiceReadyExtension` = public FJ only, so a private origin defaults to own Fee Juice (`fee-methods.test.ts:381-382`).
- F10. Send-page submitters in e2e: `sendTransfer` (`fixtures/helpers.ts:1083-1180`; called from 8 network files), `fillAndSubmit`, and two direct clicks in `fee-methods.test.ts:112-114,174-176` (both public-origin). `legal-acceptance*.test.ts` only read the button's disabled state.
- F11. `fee-methods.test.ts` runs on the dedicated proverless `heavy` lane with `selfpay-phase.test.ts` and is excluded from the shard pool (`pr-extension-network-e2e.yml:173,196`). `behavior-gating.test.ts:279-290` pins `selfpay-phase`'s placement, not the pairing; this plan changes neither.
- F12. `send.vue` has no test. Precedents, each partial: `holdings.test.ts` mounts a page; `FeeSettingsCard.test.ts` mounts the real card but stubs the selector and mocks only the card's clients; `fee-freshness.integration.test.ts` covers reader → store → pure selection and mounts nothing.
- F13. Any address can be registered as a `DefaultSponsoredFpc` (`NewFpcPopup.vue:75`) and is then offered as a payer (`fee-helpers.ts:163-171`); `isProtocol` is a read-time decoration on the row (`wallet/services/fpc/spec.ts`), already trusted by `fpc-strategy.ts:115` and `buildFeeMethods` (`:160`).
- F14. The popup stack: `popupStore.open` assigns `order = count` and `close` never renumbers (`popup.store.ts:17-30`); a popup passes its `order` to `Popup` (z-index, `Popup.vue:48,57`) and `len − order` to `PopupCard` (displacement) — `ConfirmPopup.vue:28-30,86-87`; `PopupManager` opens `incoming_trust` by itself (`:102`) and mounts the token picker conditionally (`:340`); lock calls `popupStore.closeAll()` (`app.vue:175`). `popup.store.ts` has no test.
- F16. The card snapshots gas into local refs at init (`FeeSettingsCard.vue:434`), keeps `txRefresh: false` (`:349-355`) and re-commits only on the store's retry versions (`:592-607`): while it is mounted, the payer changes through a user pick, an FPC event, a degraded-read recovery or an identity change — not through balance events.
- F17. The card is mounted whether or not a token is sendable (`send.vue:619-631`), so without the `isBlockedTransfer` guard a funded own Fee Juice would produce gated facts on a form that cannot send.
- F15. `pointerClick` (`tests/e2e/helpers/legal-drivers.ts:66-80`) hit-tests before a real mouse click; `clickByTestId` dispatches in-page.

**Inferences** (unverified — attack these)

- I1. Chrome closes an action popup on Escape unless the keydown is `preventDefault`ed. Checked by hand in phase 3; A6 depends on it.
- I2. A page-rendered `Popup` stacks and transitions like a registry one when given a store slot. Verified in phase 3 in the built popup, both themes. If it does not (teleport order, transition glitch), stop: the sheet becomes a registry-mounted component fed by props through a thin page-owned binding, and the plan is revised before phase 3c continues — not patched with z-index overrides.
- I3. The extra real sends fit the `heavy` lane's budget (today ~6 min for `fee-methods` plus `selfpay-phase`). Measured in phase 5; if it does not fit, the sends move to their own file and lane — a workflow edit plus the `behavior-gating` pin, scoped then.
- I4. 38px more sticky footer leaves the form usable at 600px (437 → 399px visible). Measured on the mock; re-measured on the product in phase 3. If a field becomes unreachable or the fee card cannot be brought fully into view, stop and bring the measurement to the owner — a layout change is not ours to improvise.
- I5. Mounting `send.vue` with the real card, selector and balances store under jsdom is feasible with an adapted harness (T11). Codex judged it feasible on reading; nobody has run it. If a dependency cannot be mocked without distorting the card → settings → page seam, that is surfaced, not worked around with a stub.

**Asks** (owner decisions — **all nine approved as recommended**, 2026-09-21: *"Go with all the recommended. Approved."* The bold word below is now the recorded answer; A6 stays conditional on I1)

- A1. 800 ms before "Send now" is clickable when the sheet is the mandatory step. Recommend **yes**.
- A2. You cell while no fee source is resolved: **—**, dimmed hollow mark. Recommend **yes**.
- A3. The sheet uses the app's bottom-sheet chrome rather than the mock's bespoke one. Recommend **yes**.
- A4. A hand-added sponsor reads **—** plus the sentence in § Copy, and does **not** trigger the mandatory review (the ancestor ruling "No notice on Sponsored" stands for it). Recommend **yes to both**.
- A5. The strip opens the sheet on an unfinished form; missing values read **—**, CTA disabled. Recommend **yes**.
- A6. Escape closes this sheet, and only this sheet. Recommend **yes, if I1 holds**.
- A7. "You · HIDDEN" means not named as sender or fee payer; a public send to your own address is not detected. Recommend **accepting it as a documented limit**.
- A8. The sheet closes by itself on an account, network or token switch. Recommend **yes**.
- A9. With no sendable token the fee card shows no tag (today it can show the warning row there). Recommend **yes**.

## Phases

Every gate includes the fast layers. "Green" means the gate below, pasted in the transcript.

### Phase 1 — facts, copy, review state ✓
`publish-facts.ts`, `useSendReview.ts` + tests (T1–T4). The notice copy moves into `publish-facts.ts`; `fee-privacy.ts` keeps `feePayerNotice` as a thin caller until phase 4 so every commit stays green.
**Validation gate** — commands: `bun run --cwd apps/extension test src/components/composite/send/publish-facts.test.ts src/composables/useSendReview.test.ts src/popup/components/modules/send/fee-privacy.test.ts` · `bun run lint` · `bun run typecheck`. Pass: exit 0. Layers: lint/typecheck · unit.

### Phase 2 — strip, sheet, `Popup.vue` ✓
`publish-mark.module.css`, `PublishStrip.vue` + story, `SendReviewSheet.vue`, `Popup.vue` fixes, `popup.store` compaction + tests (T5–T7, T10b).
**Validation gate** — commands: `bun run --cwd apps/extension test src/components/composite/send src/components/Popup src/stores/popup.store.test.ts src/popup/components/modules/send/SendReviewSheet.test.ts` · `bun run --cwd apps/extension build-storybook` · `bun run lint` · `bun run typecheck`. Pass: exit 0. Layers: lint/typecheck · component · storybook build.

### Phase 3 — the money path, then the gate (nothing is removed yet) ✓
3a characterization tests for today's submit (T9, green on the untouched page). 3b extract `send-submit.ts`. 3c `payer` model on the card; footer, `submit()`, the sheet on the stack; T8 (model half), T10–T14 (T11 with its phase-3 invariant — the tag half arrives in phase 4).
**Validation gate** — commands: `bun run --cwd apps/extension test src/popup/pages src/popup/components/modules/send src/composables/useSendReview.test.ts` · `bun run lint` · `bun run typecheck` · `bun run build:chrome`, then the built popup by hand in both themes: I1 (Escape in the real action popup), I2, I4. Pass: exit 0; I1/I2/I4 recorded in `lessons/phase-3.md` as true, or their stated outcome taken (I1: drop Escape; I2, I4: stop and revise / bring to the owner). Layers: lint/typecheck · unit · page integration · build.

### Phase 4 — notice row → tag ✓
`payerNoticeShape` prop → `FeeMethodSelector` tag; delete the block, `payerNotice` and `feePayerNotice`; re-point the card's and the selector's tests (T8); T11 gains the tag half of its invariant and "no token → no tag".
**Validation gate** — commands: `bun run --cwd apps/extension test src/popup/components/modules/send src/popup/pages` · `bun run audit:vue`. Pass: exit 0. Layers: lint/typecheck · unit · component · page integration · build.

### Phase 5 — e2e, mutation pass, screenshots
`fixtures/send-page.ts`; helpers with an explicit `expect` + the DOM invariant (T17) and an `expect` at every `sendTransfer` call site; `fee-methods.test.ts` walks and sends (T16); smoke (T15, T19); every mutant of the table (M1–M19, M10b); screenshots (T18); lane timing (I3).
**Validation gate** — commands:
`bun run test:e2e tests/e2e/send-fee-privacy.test.ts tests/e2e/legal-acceptance.test.ts tests/e2e/popup-stack.test.ts --retry=0` ·
`NODE_OPTIONS=--dns-result-order=ipv4first NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/fee-methods.test.ts tests/e2e/network/transfers.test.ts tests/e2e/network/legal-acceptance-wall.test.ts` ·
`bun run test:ci-gating`.
Pass: exit 0 at retry 0; the mutation table in `lessons/phase-5.md` shows every mutant killed by its named tests (or the survivor fixed and re-run); screenshots written; `fee-methods` wall time recorded against I3. The remaining `sendTransfer` files run in CI's pool on the PR. Layers: smoke e2e · network e2e (sandbox) · CI-gating units.

### Phase 6 — docs
`ARCHITECTURE.md` fee-model paragraph; the e2e skill's "method in effect" wait target (`send-publish-strip[data-you]` / `send-submit[data-action]` replace the notice row) and the `expect` rule for send helpers; `implementations-plan/index.md`; lessons.
**Validation gate** — commands: `bun run audit:vue` · `bun run test:ci-gating`. Pass: exit 0; a repo-wide search for `send-fee-privacy-notice` shows no doc still describing a row. Layers: lint/typecheck · unit · build.

## Delivery

Single arc, one branch, one PR into `dev` via `gh pr create` (no labels at creation — a label on
create cancels the e2e runs), title ≤ 93 chars: `feat(send): say what a send publishes; review the
one that names you`. `code_review: off`. The PR body carries the UI-impact table, the sign-off
quotes and the screenshots. The PR is opened only after the fix loop below converges. Merging is
the owner's call.

## Post-implementation

1. **Codex audit** — `/codex high`, fresh session, with: the net diff from `06010c9b`; this plan and
   its decision ledger; the adversarial ask ("What could go wrong? What would an attacker target?
   What are we trusting that we shouldn't? Where can the UI say HIDDEN while the account is named,
   or send a gated transfer without the sheet's authorisation?"); and, verbatim:
   *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
   extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
   problem. If code works and is clear, leave it alone."*
   *"Audit the comments for value per character. Flag any comment that narrates what the code
   visibly does, restates its line, references implementation plans / phases / reviews, or spends a
   paragraph where a sentence works — and flag places where a non-obvious invariant or constraint
   deserves a comment it doesn't have. Comments are permanent context every future reader, human or
   LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop** — verify each factual claim against the tree before acting; apply accepted fixes;
   commit; log the round (consult + verdict) in `lessons/`; **resume the same codex session** with
   the fix diff and both rules again. Repeat until a round yields no new material finding. Still
   material after 3 rounds → stop and surface it.
3. **Delivery** — only now: `gh pr create`, then `gh pr checks --watch`. Add the
   `e2e:extension-network` / `e2e:extension-smoke` labels after creation only if the path filters
   did not already trigger the suites.
4. **Close-out** (in the delivery PR): an `## Outcome` block under the front matter (date, status,
   PR, what was dropped, seeds retired); durable e2e lessons into the `e2e-testing` skill; the
   `index.md` line marked completed. `agent-worktree done send-publish-ledger` only after merge.

Loop dispositions for an unattended session: never idle waiting for input; a decision that would
normally go to the owner goes to `/codex high` and is logged; hard limits hold regardless — never
touch `apps/tools/**` or `packages/bridge-core/**`, no UI beyond the UI-impact table, never merge,
never `--admin`.

`/code-review` is **off** for this plan and is not run.

## Decision ledger

Chosen outline: **A** (this plan), with two pieces of **B** adopted (D3, D9).

| # | Decision | Source | Alternative rejected, and why |
|---|---|---|---|
| D1 | One `submit(source)` owns the gate; consent = source ∧ sheet open ∧ ready, checked in the handler, state in `useSendReview` | codex High (consent), codex High + fable 3 (M4 unkillable) | `reviewed: true` flag + two decision sites: a flag is not consent; the inner re-check was unobservable |
| D2 | Extract `send-submit.ts` behind characterization tests before adding the gate | fable 2 (`handleSend` = 80 lines) | A complexity acceptance — forbidden; squeezing lines — the rule's stated anti-goal |
| D3 | The sheet takes a slot in the popup stack; data and actions stay props/emits | codex High (stack vs focus), fable 6, outline B | `displaceIdx = len` (rev 1): above a newer popup while focus sits under it. Full registry popup: stored callback, untyped payload |
| D4 | `Popup.vue`: pending-activation guard, deactivate on unmount, opt-in `closeOnEscape` through focus-trap's hook | codex High (lifecycle), fable 9, 13 | A second document listener; Escape for all popups (out of the UI-impact table) |
| D5 | Compose `Popup`/`PopupCard`/`PopupHeader`; own CTA; `role="dialog"`; focus in on open, back on close — required and tested in a browser | codex (FormPopup cannot forward `data-armed`; no dialog semantics), fable 6, 8 | `FormPopup`; "assert focus return if it holds" |
| D6 | Tag ⇔ gate ⇔ strip by construction: the page passes `noticeShape` down; the card's predicate is deleted | fable 10, codex Medium (T3 false for unread balances) | A correspondence test between two predicates |
| D7 | HIDDEN only for a protocol-derived contract the descriptor and the settings agree on; hand-added sponsor → "—" + sentence | fable 1 | Treating every FPC as hiding the account — the wallet would vouch for code it has never seen |
| D8 | Real-card integration test is the workhorse; the stubbed page test shrinks to footer wiring | codex High, fable 4 | Stubbed card: can emit states the real card never produces → artificial mutants |
| D9 | Strip + marks + facts at L3 with a story | fable 14, outline B | L4 placement: legal, but no visual sweep for sign-off |
| D10 | e2e helpers take `expect`, throw on mismatch, assert the DOM invariant on every send; hit-tested clicks; real `Tab` / Escape in the browser | codex High, fable 5, 8 | A helper that follows `data-action` — it masks a gate that appears when it should not |
| D11 | Smoke claims only what it can see; `unknown` proven in the integration test | codex High, fable 7 | T14 as written — vacuous with no token |
| D12 | Real sends live in `fee-methods.test.ts`; no lane edits | fable 12, codex (measure headroom) | A new file on the heavy lane: pays fixture setup twice, edits two workflows and a pin |
| D13 | Mutant set rebuilt from plausible edits (M1–M19, M10b) | both, then both codex passes | Rev 1's M3/M4/M12 — artificial or unkillable |
| D14 | A4–A9 added as owner Asks, worded as recommendations, not answers | codex Medium ×2, fable 11 | Deciding them silently |
| D15 | `Popup` gets the slot's order, `PopupCard` the displacement; absent slot safe; `openReview` idempotent; `popup.store.close` compacts orders | codex final High ×2 | Rev 2's single `displaceIdx = len − order`: wrong number for z-index — the rev-1 stacking bug survived |
| D16 | `ready`: immediate when not gated, 800 ms when gated | codex final High | Rev 2's `armed` required unconditionally — an optional sheet could never send |
| D17 | No token → no facts at all (no strip, no tag, no review) | codex final High | Guarding only the strip: a funded own FJ would tag and gate a form that cannot send |
| D18 | T12 transitions only through paths production has (pick, FPC event, retry recovery, identity) | codex final High | A "balance event empties private FJ" test — the mounted card never re-reads gas on events |
| D19 | HIDDEN's trust scope proven by test (same-id address change, late network switch); scope binding added only if a test fails | codex final Medium | Adding scope fields speculatively |
| D20 | `submit` accepts the sheet's event only while the sheet is open, and the footer's only while it is not — unconditionally, gated or not | codex closure Medium | Rejecting a closed-sheet event only for gated sends: a murkier event contract, and the test claimed more than the handler did |
| D21 | T11's invariant grows by phase (tag half in phase 4); a real-browser stacked-popup smoke test (T19) + "footer covered" probe (T16b); M17 by same-tick activations | codex closure Medium ×3 | Moving the notice replacement into phase 3 (a commit with the gate half-wired and no warning); claiming modal containment from z-index assertions alone |

Rejected findings: **codex — cover `refreshSession()` rejection in `Popup.vue`**: pre-existing for
every popup including the token picker on this page; unchanged exposure; out of scope (lock during
open *is* covered — `closeAll`, T13). **codex — a "cached-estimate payer mismatch" mutant**: the
service already compares the fee-settings hash at consume time and has its own tests; nothing here
touches it. **fable — a `{returnFocus:false}`-only note** is folded into D4, not separate.

Unresolved disagreements: none on architecture. Open by design: A1–A9, I1 (Escape in a real action
popup), I3 (lane headroom), I5 (jsdom feasibility of the real-card mount).

## Audit verdicts

- **Codex, rev 1 (GPT-6 Astra, high)** — `reject (with blocking findings: incomplete consent checks, popup lifecycle hazards, and tests that cannot prove their stated invariants)`. 7 High, 4 Medium. Adopted: all High; Mediums adopted except the two listed under Rejected findings. Transcript: `audit-codex.md`.
- **Fable, rev 1 (Fable 5.1, `Plan` subagent)** — `conditional approve (with conditions: fix findings 1–8 …)`. 5 High, 6 Medium, 3 Low. Adopted: all 14. Transcript: `audit-fable.md`.
- **Codex, final fresh-context pass on rev 2 (new session)** — `reject (with blocking findings: incorrect popup stacking, contradictory arming semantics, and integration tests that cannot prove their stated guarantees)`. 5 High, 4 Medium, 1 Low; every claim re-checked against the tree and found correct. Adopted: all (D15–D19, F11/F12/F14 corrected, F16/F17 added, M9/M15/M17 re-mapped, Asks re-worded, I2/I4 given stop-and-revise outcomes). Transcript: `audit-codex-final-r1.md`.
- **Codex, closure check on rev 3 (same session resumed)** — `conditional approve (with conditions: reconcile the remaining contracts and phase gates, and close the mutation and modal-test gaps below)`; "Rev 3 resolves the principal rev-2 blockers; no architectural redesign is needed." 4 Medium, 1 Low — all five adopted in rev 4 (D20, D21, the residual-statement fixes). It also checked `popup.store` compaction against every consumer and found no cached order. Not adopted: changing `popupStore.open`'s behaviour for an existing key — the page guards `openReview()` instead, leaving registry popups untouched. Transcript: `audit-codex-final-r2.md`.

## Seeds

**Canonical** — the owner approved rev 4 without a scope change, so these are the gate-time seeds
unchanged. Run exactly one, from inside the `send-publish-ledger` worktree
(`agent-worktree resume send-publish-ledger`). ELI5 companion (Artifact, source
`implementations-plan/send-publish-ledger/eli5.html`): https://claude.ai/artifact/4jw8DrE6PHfHejHgiLHJqF

Recommended — `/goal` (every finish condition is visible in the transcript):

```
/goal All six phases marked ✓ in implementations-plan/send-publish-ledger/plan.md (the phase headers in the file — not the chat, not the task list), each ✓ backed by that phase's validation gate (as written in plan.md) reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/send-publish-ledger/lessons/phase-N.md`; lessons/phase-5.md holds the mutation table with every mutant of plan.md's table (M1–M19 and M10b) killed by its named tests; `/code-review` was NOT run (code_review: off); the codex fix loop converged over the whole diff, evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; one PR into dev exists, created only AFTER that loop converged, its body carrying the UI-impact table, the owner's sign-off quotes and both-theme screenshots (`gh pr view` output in the transcript); `bun run audit:vue` and `bun run test:ci-gating` both report exit 0 in the transcript. Constraints: never touch apps/tools/** or packages/bridge-core/**; no UI beyond plan.md's UI-impact table; never merge; never --admin.
```

Alternative — `/loop`:

```
/loop 15m Drive implementations-plan/send-publish-ledger forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/send-publish-ledger/plan.md and lessons/ (authoritative — not the chat). If the folder moved to implementations-plan/archive/, or plan.md carries an `## Outcome` block, the plan is closed: STOP and say so. Task list empty? Rebuild it from plan.md's phase headers. Run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json statusCheckRollup`.
2. Waiting on CI is fine — confirm it is progressing (`gh run watch <id>` up to 10 min; stuck past that → read the logs, log it in lessons). Use the wait: review the diff, prep the next phase.
3. No task in hand? Take the next pending step from plan.md. After each meaningful edit run the fast layers (`bun run lint`, `bun run typecheck`, the touched test files via `bun run --cwd apps/extension test <files>`). Commit small, conventional, signed (`SSH_AUTH_SOCK= git commit -F <file>` if the agent hangs). Push the branch; do NOT open a PR yet.
4. Stuck, or facing a decision you'd bring to me? Call `/codex high` with full context, go back and forth to a defensible decision, act, and log consult + verdict in lessons/phase-N.md. Hard limits stay hard: never touch apps/tools/** or packages/bridge-core/**, no UI beyond plan.md's UI-impact table, never merge, never --admin. If a decision needs to cross one, surface it and hold.
5. Same step failed 5 times? Stop retrying; reassess with codex, then continue.
6. Phase green? "Green" = THAT PHASE'S VALIDATION GATE in plan.md passes. Run the full gate, paste the result, mark ✓ in plan.md, file lessons, print `LESSONS_FILE=implementations-plan/send-publish-ledger/lessons/phase-N.md`, update `agent-worktree status send-publish-ledger "phase N green: <next>"`, advance. Network e2e locally: `NODE_OPTIONS=--dns-result-order=ipv4first NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent <files>`.
7. All phases ✓? Close out per plan.md § Post-implementation. `/code-review` is OFF — do not run it. Codex audit (`/codex high`, fresh session: net diff from 06010c9b + plan.md + decision ledger + the adversarial ask + the plan's no-over-engineering and comment-quality rules, verbatim) → apply accepted fixes, commit, RESUME the same codex session with the fix diff → loop until a round yields nothing material (still churning after 3 rounds → surface and stop). Then, for the first time, `gh pr create` (no labels at creation; title ≤ 93 chars; body = UI-impact table + sign-off quotes + screenshots), `gh pr checks --watch`. Then the wrap-up: what shipped, every contentious decision with its ELI5 context, open items. Surface and stop.
Keep the task list current; plan.md stays the source of truth.
```
