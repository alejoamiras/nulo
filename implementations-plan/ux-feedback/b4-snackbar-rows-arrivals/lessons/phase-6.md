# Phase 6 · The owner's parity answers

The owner answered the parity page's thirteen calls on 2026-09-25. Code paths are relative to
`apps/extension/src/` unless they start with `packages/` or `tests/`.

## P6.1 · Above the footer (1c)

Built:

- `composables/snackInset.ts`: two directives and the host's inset. `v-snack-footer` marks a
  bottom action row and `v-snack-sheet` an open sheet; both register their element in a
  module-level registry. `useSnackInset(base)` returns the snack's distance from the viewport's
  bottom edge: `base` (76 with the nav, 12 without), raised to 12px above the highest registered
  footer whose top edge is on screen. It measures on the next frame after a footer or sheet arrives
  or leaves, a footer resizes (`ResizeObserver`, which catches a wrapping error line), the window
  resizes, anything scrolls, or a transition or animation ends. It also measures at once when a
  snack opens, so a card never rises at a stale height. The pure step is `snackInset(base,
  viewportHeight, boxes)`.
- `components/ui/ToastManager.vue`, the host: `useSnackInset(() => showBottomNav ? 64 + 12 : 12)`
  replaces the route-only inset. `ToastManagerBase` is unchanged: the package still takes a
  number and reads no store, route or page.
- New testids for the e2e: `send-footer` on Send's footer, `dapp-approval-footer` on the shared
  approval footer. No existing testid moved.

The surfaces (every page or window without the nav that has a bottom action row):

| Where | The row | Registered on |
|---|---|---|
| Send | the publish strip and Confirm Transaction (or Review send, Get Fee Juice) | `popup/pages/send.vue` `.bottom` |
| Import a profile, create a profile, import an account, change password, delete profile, the three export pages | the page's bottom bar (continue, agree, download, delete) | `components/composite/CollapsingHeroLayout.vue` `.bottom`, 8 pages |
| The lock screen | the Delete profile link | `popup/pages/auth.vue` `.footer` |
| Register | the Terms of Use and Privacy Policy line | `popup/pages/register.vue` `.terms` |
| Terms declined | Review the new Terms, Export a backup | `popup/pages/legal/declined.vue` `.actions` |
| The execute, discover and permission windows | the error line and Reject/Confirm (Approve, Allow) | `components/composite/DappApprovalFooter.vue` |
| The verify window | Always trust and OK | `popup/windows/verify/index.vue` `.footer` |
| Onboarding: learn, fees | Continue and Skip intro | `onboarding/components/OnboardingExplainer.vue` `.actions` |
| Onboarding: welcome | Create profile, Import profile | `onboarding/pages/welcome.vue` `.actions` |
| Onboarding: create | the cream submit button | `onboarding/pages/create.vue` |
| Onboarding: import | the method's buttons and Back to methods | `onboarding/pages/import.vue` `.ctas` |
| Onboarding: terms | Continue and its hint | `components/composite/LegalConsent.vue` `.actions` |
| Onboarding: Presto | Continue, or the skip link | `onboarding/pages/presto.vue` `.ctaSlot` |
| Onboarding: done | Open wallet | `onboarding/pages/done.vue` |

Not registered, because they have no bottom action row: the Settings pages' in-list buttons
("Add account", "Add endpoint", "Delete chain", the other "Add" buttons), the detail pages (a
transaction, a receipt, a journal entry, a connected app), About, Appearance, Glossary, Proving,
the security and export index pages, and the json, logger and passkey windows.

Decisions:

1. **The registry is DOM-side.** A directive on the row itself is the one place that knows the row
   exists, is mounted, and where it is. The alternative, a route-meta flag per page, cannot follow
   a footer that grows, a sheet's own row, or the onboarding CTAs that move with their content.
2. **"On screen" means the row's top edge is inside the viewport.** A row below the fold places
   nothing (the snack stays 12px from the bottom); one scrolled into view lifts it.
3. **Never below the base.** On a nav page a footer low enough to sit under the nav's inset changes
   nothing. No nav page registers one today.
4. **The inset moves at once**, as it did on a route change. There is no transition on `bottom`.

Sign-off pending (built as the closest existing pattern):

- The onboarding CTAs sit in the page flow, not at the bottom of the tab. The snack rides 12px
  above the row wherever the row is on screen, so on a short page it sits mid-tab, just above the
  button.
- The lock screen's Delete profile link and the register page's Terms line are links, not
  buttons; both count as the page's bottom row.
- The Settings pages' in-list buttons are not footers, so a snack there keeps 12px from the bottom
  and can cover a button in the list's last rows.

Observed, not changed: the popup's Terms sheet (`components/LegalAcceptanceSheet.vue`) sits at
z-index 9000, above the snack's 2000, so a snack raised while it is open is hidden behind it. Its
consent row is registered (through `LegalConsent`), which moves nothing while the sheet hides the
snack anyway.

Tests:

- `composables/snackInset.test.ts`, 14 cases: the pure step (the base, the highest footer, never
  below the base, a zero-height or off-screen row); the host after a frame, a footer's removal, a
  sheet over the nav, two stacked sheets, a footer growing, a scroll, a transition end and an
  animation end, a snack opening before any frame, the base following its source, and disposal.
- `components/ui/ToastManager.test.ts`: a footer on a no-nav route lifts the card to
  `bottom: 92px` (600 − 520 + 12).
- `tests/e2e/network/snack-placement.test.ts`, new: on Send, a public→private send to an off-curve
  address fails the estimate and its error sits 12px (±0.5) above `send-footer`; in the execute
  window, a public transfer the account cannot fund does the same above `dapp-approval-footer`.
  Both then grow the footer by a 40px line and check the snack follows it.
