# Recon — popup-submit-reentrancy (3 scouts on dev@8771ce50)

## 1. The mechanics (why the class exists)

Two routes converge on each popup's submit handler, and neither is closed by the in-flight flag today:

- **Enter route (fully open):** `usePopupEntity`'s `onKeydown` (and the four hand-rolled `isPopupSubmitKey` copies) calls `handlers.submit()` as a direct function call — it never touches the DOM, so the button's `:disabled`/`:loading` state is irrelevant to it.
- **Click route (partially open):** the design-system `Button` keys `tabindex` and the native `disabled` attribute off `disabled` ONLY; `loading` contributes just a CSS class with `pointer-events: none` (+ `aria-busy`). Mouse clicks are blocked by hit-testing, but a Tab-focused button still fires native keyboard activation (Enter/Space → click) — `pointer-events` has no jurisdiction over focus-driven activation. `FormPopup`'s internal button emits `submit` unconditionally on click.

Every affected handler sets its flag (`isLoading`/`isSubmitting`/`isCreating`/`is*InProgress`) around the await but never checks it on entry; the only entry guard is the validity computed (`isAvailableToX`), which deliberately excludes the flag.

## 2. The gap inventory (12 vulnerable / 5 guarded / windows N/A)

**Vulnerable (flag set, never checked; both routes reach the handler):**
| Popup | Handler | Flag |
|---|---|---|
| EditAccountPopup | handleUpdateAccount | isAccountUpdateInProgress |
| EditNetworkPopup | handleUpdateNetwork | isNetworkUpdateInProgress |
| EditFpcPopup | handleUpdateFpc | isFpcUpdateInProgress |
| EditEndpointPopup | handleSave | isSubmitting |
| EditContactPopup | handleUpdateContact | isLoading |
| EditProfilePopup | handleUpdateProfile | isProfileUpdateInProgress |
| NewContactPopup | handleAddContact | isLoading |
| NewFpcPopup | handleAddFpc | isLoading |
| NewEndpointPopup | handleCreate | isSubmitting |
| NewNetworkPopup | handleCreateNetwork | isCreating |
| NewSenderPopup | handleAddSender | isLoading |
| **NewAccountPopup** | handleCreateAccount | **NONE — no flag exists; `:submitLoading` not even bound.** Concrete race: name uniqueness is checked synchronously against `appStore.accounts` BEFORE the post-await push, so two concurrent invocations can both pass "already exist" and create two same-named accounts. |

**Already guarded (3 conventions; all pinned):** NewTokenPopup (`phase !== "idle"` folded into the availability guard line + input `:disabled="isBusy"`); SelectProfilePopup (B-09 latch, first line) and IncomingTrustPopup (B-26 latch + generation token); ChangeAuthwitsRegistryPopup + RevokeAuthwitsPopup (caller-side duplication: `!isLoading` repeated in the keydown predicate AND the button's `:disabled` — safe today, fragile for any future caller; both carry `(REGRESSION-PIN)` tests proving this class already bit here once).

**Out of scope:** `popup/windows/**` has no Enter/keydown wiring (execute/discover self-guard; `capabilities/index.vue`'s `approve()` lacks a self-guard — latent smell, click-only today, recorded for the owner report). No FormPopup consumers exist outside `popups/`. `useFormState` has no in-flight concept — not the reuse candidate.

## 3. Guard-shape research (settles the owner's open question)

Two shapes close all routes at the handler chokepoint; they are NOT equivalent:

- **Handler-line fold** (NewTokenPopup pattern): `if (!isAvailableToX.value || inFlight.value) return`. Closes both logic routes; leaves the button Tab-focusable and merely "loading" during flight (silent no-op on keyboard activation — a worse a11y signal).
- **Validity-source fold** (arc-D precedent): the flag joins the `isAvailableToX` computed that the handler ALREADY early-returns on AND that feeds `:submitDisabled`/`:disabled`. One line changed per popup, no new guard line, and the button gains the native `disabled` attribute + `tabindex="-1"` during flight — closing the keyboard-focus DOM route too, with a coherent inert state (the `.disabled` 0.3-opacity CSS wins over `.loading`'s 0.8 at equal specificity, declared later).

**Verdict: validity-source fold**, with one per-popup verification obligation: confirm nothing else consumes `isAvailableToX` in a way that in-flight folding would disturb (watchers, other bindings).

## 4. Test surface

- Colocated tests exist for 5 of the 12 (EditContact, EditProfile, NewContact, NewEndpoint, NewSender) with a shared harness idiom (mock clients, `pressEnterOnInput`, `mountShown`, hide-then-unmount `dispose`). The other 7 have no test files.
- The pin technique for this exact class already exists 4× in-repo: hang the mocked service (`mockImplementationOnce(() => new Promise(() => {}))`), re-press Enter / re-click, assert the service was called exactly once (B-26, B-09, the two authwits `(REGRESSION-PIN)`s).
- **Coverage recommendation from the map: component tests only** — every prior fix of this class was pinned at the component layer; a Puppeteer double-click race would be slower, flakier, and prove less than a deterministic hung-promise pin. Existing e2e specs to run as regression checks (happy paths unbroken): smoke `profile-rename`, `endpoints`, `accounts`, `contacts`, `settings-crud` (armed run); network `senders-advanced` (the only real `addSender` success path). No `NewNetworkPopup`/`NewFpcPopup` submit e2e exists anywhere — component pins are their only coverage.
