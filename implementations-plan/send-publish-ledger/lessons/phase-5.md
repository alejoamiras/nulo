# Phase 5 — e2e, mutation pass, screenshots

Date: 2026-09-21.

## Mutation pass

Each mutant applied alone on the phase-4 tree (`scratch mutants.py`: mutate → run the named files → restore), 24 runs. Killers are the unit / page files the table names; the e2e legs (T15–T17) were not re-run per mutant — every mutant has a jsdom killer, and the e2e files ran green once on the unmutated tree below.

| Mutant | Outcome | Red files |
|---|---|---|
| M1 `requiresReview` always false | killed | publish-facts.test, send.integration.test |
| M2 `requiresReview` true for any private origin | killed | publish-facts.test, send.integration.test |
| M3 `payerKindOf` reads `settings.kind` | killed | fee-privacy.test, send.integration.test |
| M4 `contract` without checking `isProtocol` | killed | fee-privacy.test, send.integration.test (the hand-added rows) |
| M5 `you` = `hidden` when the payer is null | killed | publish-facts.test, send.integration.test (pending, network switch) |
| M6 amount `public` only when both sides are public | killed | publish-facts.test, send.integration.test (`SIDE_CELLS`) |
| M7 destination bound to the origin ref | killed | send.integration.test, send.test |
| M8 the sheet's CTA wired as `submit("primary")` | killed | send.test (4 consent cases) |
| M9a `submit` drops its open-check | killed | send.test — the closed-slot `send` event, **not gated** (the gated case passes: `ready` is false, the sheet reopens) |
| M9b `authorises` ignores `isOpen` | killed | useSendReview.test |
| M10 the 800 ms dropped | killed | useSendReview.test, send.test |
| M10b `ready` stays false on a non-gated sheet | killed | useSendReview.test, send.test |
| M11 primary button sends a gated transfer directly | killed | send.integration.test, send.test |
| M12 `payer` model never written | killed | FeeSettingsCard.test, send.integration.test (HIDDEN never appears) |
| M13 tag rendered for any private origin | killed | FeeSettingsCard.test, send.integration.test |
| M14a strip `v-if` dropped | killed | send.integration.test, send.test (no token) |
| M14b facts computed with no token | killed | send.integration.test, send.test |
| M15a sheet not closed before navigating away | killed | send.test (`close` before `leaveSend`) |
| M15b sheet not closed on identity switch | killed | send.integration.test, send.test |
| M16a `Popup.vue` pending-activation guard reverted (`token`/`mounted`/`show` checks dropped, `!container` kept) | **survived — equivalent** | — |
| M16b `Popup.vue` unmount deactivate reverted | killed | Popup.test |
| M17 `isSending` guard dropped | killed | send.test (two same-tick activations) |
| M18 `Popup` given the card's displacement | killed | send.test (z-index) |
| M19 `popup.store.close` stops compacting | killed | popup.store.test, send.test |

**M16a is an equivalent mutant on the reachable surface, not a gap.** A probe (`setProps({ show: true })`, one microtask, `setProps({ show: false })`) showed the activation continuation always runs before the flush that would flip `props.show` or run `deactivate()` — Vue queues it at the end of the flush that called `activate()`, and a later `setProps` can only land in a later flush. So within the pending tick nothing can make the token or `show` check differ from `!container`, which the mutant keeps and which carries the unmount case (`unmounted before the tick`, tested). A test for "closed within the tick" therefore cannot go red on the fixed code either (tried, removed). The checks stay: they are one line, and they document the intent.

## E2E

### Smoke (armed build, `NULO_E2E_MIGRATION_FIXTURE=1`, retry 0)

15/15: `legal-acceptance.test.ts` 13, `send-fee-privacy.test.ts` 1 (T15: the tag, the strip and the footer's action read together), `popup-stack.test.ts` 1 (T19). Two iterations on T19 before green: `tabAround` never listed `account-name-input` because the testid sits on the `Input` wrapper, not the `<input>` — `activeTestId` now walks to the nearest named ancestor; and the closed popup's DOM never left — headless Chrome froze its leave transition — so the close is settled by `settleClosedPopup`, scoped to the one popup (the accounts popup beneath must stay). It logs when it had to force the leave; it did on every smoke run.

### Network (`e2e:agent`, proverless, retry 0) — three runs to green

| Run | `fee-methods` | `transfers` | `legal-acceptance-wall` | What stopped it |
|---|---|---|---|---|
| 1 | 7/8, 235.5 s | 1/1, 73.3 s | 1/1, 27.6 s | `readSendInputs` read `destination: ""` after Escape. Not a bug: the recipient was the account's own address, which is in the candidates, so the field resolved it to a `RecipientCard` on blur and the `<input>` was gone. The card now carries `data-address` and the reader takes the card or the input, whichever the field shows. |
| 2 | 7/8, 238.4 s | 1/1, 73.3 s | 1/1, 27.2 s | `activeTestId` read `BODY` after Escape where run 1 had read `send-submit`. |
| probe | test 2 alone, instrumented | — | — | An in-page sampler (25 ms) plus capturing `focusin`/`focusout` listeners: after Escape, `focusout` on the sheet's button with `relatedTarget: null`, `focusin send-submit`, and every sample from 26 ms on reads `send-submit` — while the test's read, taken between those two events, saw `BODY`. focus-trap hands focus back on a 0 ms timer (`delayReturnFocus`, default on); `settleClosedPopup` removed the leaving wrapper — the focused button with it — before that timer fired, and the read landed in the gap. CDP round-trips on this pipe are shorter than a timer tick. |
| 3 | 8/8, 271.9 s | 1/1, 78.7 s | 1/1, 32.1 s | — |

The fix is `waitForFocus(page, testid)` (`helpers/pointer-probes.ts`): focus after a close is a landing to wait for, never an instant to read. Routed into the `e2e-testing` skill. The product was right on every run — the opener had focus within a frame of the close.

A third change came from the screenshots, not a failure: `sheet-not-gated` ghosted the page through the card because the sheet was still entering (a non-gated sheet is `ready` at once, so the shot raced the fade; the gated one waits 800 ms and was clean). `shotSend` now waits for no `enter` class under `#popup` before capturing, with a 3 s give-up.

### I3 — `fee-methods` wall time

Local proverless, retry 0: 272 s for 8 tests (5 pre-existing + the 3 walks), of which the three walks are ≈ 126 s (15 + 72 + 40). The file runs alone in the dedicated heavy-network job (`_extension-network-e2e.yml`, `timeout-minutes: 30`); the seven real sends it now makes (was three) are all proverless-cheap here and prover-ON in CI. Holds within the budget with room; the file stays on its lane, no workflow edit.

### I2 / I4 — read from the shots

- I2 (a page-rendered `Popup` on the store's stack): `sheet-gated` / `sheet-not-gated` show the sheet over the dimmed page at the popup layer, header and close control in place, in both themes. `popup-stack.test.ts` covers the stacking contract itself (covered · held · handed back). Holds.
- I4 (the footer at 600 px): `strip-fee-payer` / `tag-private-*` show the strip (one line, three cells) and the button in the sticky footer with the fee card's priority row still reachable above it; the page scrolls under the footer as before. The sheet's CTA sits at ≈ 440–490 px with the fee line above it and nothing clipped. Holds — no layout change to bring to the owner.

### Screenshots (`shots/`, both themes each)

`strip-all-hidden`, `strip-public-send`, `sheet-not-gated` (no gas · sponsor), `tag-private-private`, `strip-fee-payer`, `tag-private-public`, `sheet-gated` (public gas only · own Fee Juice). 14 PNGs, referenced from the PR body.
