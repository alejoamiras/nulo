# Recon — popup-escape-closes

Base: `dev` at `a5374be2` (the worktree's base). Read-only sweep: one Explore agent (the reuse sweep, eight named capabilities) plus the driver's own reads of the popup layer. No subsystem mappers were needed; the sweep covered the two load-bearing pieces (`Popup.vue`, the smoke stack test) directly.

## Reuse map

| Capability needed | Existing code found | Verdict |
|---|---|---|
| Escape closes the top popup | `apps/extension/src/components/Popup/Popup.vue:16-20, 32-36, 55-56` — the `closeOnEscape` prop (default `false`), `onEscape` (preventDefault + `emit("onClose")` + return `false` so the trap stays for the close), wired as focus-trap's `escapeDeactivates` | **adapt**: flip the default to `true`; the handler is already correct |
| Only the top popup answers | focus-trap's trap stack: the newest trap is the only active one, lower traps are paused and their document listeners removed (`Popup.vue:57` creates one trap per shown popup; `PopupCard.vue` displaces by `displaceIdx`) | **reuse-as-is** |
| Focus returns to the opener | focus-trap `deactivate()` with the default `returnFocus: true` (`Popup.vue:38-41` `releaseTrap()`, called from the `show` watcher when the store drops the key); `delayReturnFocus` lands it on a 0 ms timer | **reuse-as-is** |
| Every popup's `onClose` closes it | `PopupManager.vue:319-357` — every registry entry is `@onClose="popupStore.close('<key>')"`; `popup.store.ts:24-32` compacts orders | **reuse-as-is** |
| Escape ≡ tapping outside | `Popup.vue:83` — the `close_area` div emits `onClose` on click in every popup; the review sheet already maps Escape to it | **reuse-as-is** (this is the product rule the flip generalises) |
| Unit proof of the default | `Popup.test.ts:114-131` — a mocked `focus-trap`; "closeOnEscape off" asserts no `escapeDeactivates`, "on" asserts swallow + emit + trap left active | **adapt**: swap which case is the default, keep both |
| Sheet tests that mirror the prop | `SendReviewSheet.test.ts:19-24, 88-92` (`data-escape="true"` on the stub), `send.test.ts:172, 637-640` ("backdrop / Escape" emits `onClose` on the Popup stub), `send.integration.test.ts:175` | **adapt**: the sheet drops its explicit `close-on-escape`; the stub assertion changes; `send.test.ts`'s emit test is unchanged in meaning |
| Browser proof on the stack | `tests/e2e/popup-stack.test.ts` — accounts → new_account: covered · held · handed back on a pointer close of the top popup; `helpers/pointer-probes.ts` (`coveredAt`, `tabAround`, `waitForFocus`), `fixtures/popup-leave.ts` (`settleClosedPopup`) | **adapt**: add an Escape case to the same file with the same openers; both openers are focusable (`Header.vue:272` is a `<button>`, `SettingItem.vue:50` is `tabindex=0`) so the focus landing is assertable |
| Network proof for the sheet | `tests/e2e/network/fee-methods.test.ts:398` — Escape closes the review sheet and focus lands on `send-submit` | **reuse-as-is**: it must stay green with the attribute removed |
| Stuck-popup hack that mentions Escape | `tests/e2e/fixtures/helpers.ts:817-822` `closeStuckPopup` — its comment says every popup listens for Escape "via FormPopup or PopupHeader", which is false today (neither has a keydown handler) and becomes true, through the trap, after the flip | **adapt**: correct the comment; behaviour unchanged |
| Second Escape handlers that could double-fire | `DropdownRoot.vue:157-165, 223` — a `Dropdown` has its own focus trap and a document keydown Escape → `close()`; **two registry popups host one**: `ChangeAuthwitsRegistryPopup.vue:119` and `RevokeAuthwitsPopup.vue:215` render `FeeSettingsCard`, which renders `FeeMethodSelector.vue:37`'s `<Dropdown>` (the first sweep grepped `popups/*.vue` one level deep and missed the nested component — codex round 1 caught it). While the menu is open its trap is the top of the stack, so the first Escape closes the menu and the second the popup. `PasskeyCeremonyDialog.vue:50` (window keydown, mounted only by full-page routes); `ConfirmPopup.vue:54`'s passkey confirm opens a separate browser window (`passkey/service.ts:76-78, 113-127`, PATH B); `LegalAcceptanceSheet.vue` has no keydown handler | **none to change**; the layering is recorded and proven by a network e2e (the fee menu needs fee discovery against a node). Search trail: `grep -rn "Escape\|keydown.esc\|escapeDeactivates" src --include=*.vue --include=*.ts`; `grep -rn "FeeSettingsCard\|<Dropdown" src/popup/components/popups/*.vue` (the two hits above) |
| Popups that guard their close while busy | none: every `closable` binding is static and every `@onClose` is a bare pass-through — search trail: `grep -rn "PopupHeader" src/popup/components/popups/*.vue`, `FormPopup.vue:22`, `PopupManager.vue` template | **none** — Escape adds no exit the X does not already offer |
| Docs stating Escape behaviour | none — `CLAUDE.md` § Keyboard & focus order (line 307) covers tab order only; `ARCHITECTURE.md` § 12 covers the sheet's stack slot; `e2e-testing/SKILL.md`, `tests/e2e/README.md`, `FIREFOX.md` have no "escape" hit (`grep -i escape` on each) | **build new**: one bullet in CLAUDE.md § Keyboard & focus order (the rule), one line in the e2e skill (Escape is a legitimate close path; wait for the focus landing) |

## Conventions and shapes to match

- `Popup.vue` is plain `<script setup>` JS; the prop block carries a one-line docstring per prop. Keep the flip to the default plus the docstring.
- Unit tests mock `focus-trap` and read the options object handed to `createFocusTrap`; the Escape handler is invoked directly with a cancelable `KeyboardEvent`.
- Smoke e2e: testid-only selectors, hit-tested pointer input (`pointerClick`), `settleClosedPopup` for a stuck leave, `waitForFocus` rather than reading `activeElement` (the trap returns focus on a timer). Console and page errors asserted empty at the end.
- `popup-stack.test.ts` runs on both browsers (no `CHROME_ONLY` entry); the Escape case inherits that.

## Collision and dedup risks

- The sheet's `close-on-escape` attribute becomes redundant after the flip. Leaving it would be harmless but misleading (it reads as an opt-in); the plan removes it.
- `closeStuckPopup`'s comment asserts a wrong mechanism (FormPopup/PopupHeader listeners that do not exist) and a store clear it does not do; correcting it avoids a future reader "fixing" Escape handling that already works.
- `NewAccountPopup.vue:100-109` focuses its own input from `useFormState`'s `onShow` after `nextTick()`, before `Popup.vue`'s trap activates — so focus-trap would record the input, not the opener, as the return target. `Popup.vue` must capture the opener itself (`setReturnFocus`). `clickByTestId` (`fixtures/extension.ts:1445`) calls `el.click()` without focusing; a landing assertion needs `pointerClick`.
- `send.test.ts`'s "backdrop / Escape" case emits `onClose` on the stub, so it proves the page's reaction, not the trap; it stays as is.

## Stacking pairs (for e2e choice)

- accounts → new_account (`AccountsPopup.vue:114`) — already in `popup-stack.test.ts`; chosen for the Escape case too, so one file proves pointer close and Escape close on the same stack.
- import_contacts → edit_contact (`ImportContactsPopup.vue:71`), revoke_authwits → data_viewer (`RevokeAuthwitsPopup.vue:127`), incoming_trust over anything (`PopupManager.vue:102`, gated only on its own key). Not exercised; the trap stack is the same code path.
- `select_fpc` has no live opener (only the registry entry); `select_token` and `new_token` are page-triggered, not popup-on-popup.
