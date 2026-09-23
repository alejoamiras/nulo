---
plan: popup-escape-closes
tier: light
driver: claude-code
status: in review 2026-09-23 — all phases ✓, codex post-impl loop converged (conditional approve → approve, 2 rounds); PR into dev opened, NOT merged (the owner decides). First CI run red on one Chrome network shard (`pointerClick` pressed a popup mid-slide): fixed in the helper, codex rounds 3–5 on the fix converged (conditional → conditional → approve). Approved 2026-09-23 as rev 3, no conditions
eli5_mode: artifact
code_review: off
budget: default (recon 1 agent; codex high; code-review off)
merge: the owner's call — NOT pre-authorised (owner, 2026-09-22: "Let's do it with no exclusions and maybe we don't merge it.")
follow-up of: send-publish-ledger (#660)
---

# popup-escape-closes — Escape closes the top popup

## Goal

Pressing Escape inside any registry popup closes that popup, and only that one, and hands focus back to whatever opened it. Today a popup that does not opt into `closeOnEscape` lets focus-trap handle Escape its default way: the trap is released but the popup stays on screen, so Tab now moves controls the user cannot see. Found by codex in the send-publish-ledger post-implementation audit; the Send review sheet was protected there (it opts in, and a covered sheet refuses consent, D22), every other popup was left as a product call. The call is made: Escape does exactly what tapping the dark area outside the card already does, on every popup, with no exclusions. A menu open inside a popup keeps the normal layering: the first Escape closes the menu, the second closes the popup.

## UI impact

| Surface | Before | After |
|---|---|---|
| Every registry popup (28 keys in `PopupManager.vue`: pickers, forms, decisions, read-only sheets) | Escape releases the keyboard trap; the popup stays visible; Tab lands beneath it | Escape closes the top popup; the one beneath (if any) stays; focus returns to the control that opened the closed one |
| A fee-method menu open inside the two authwits popups | Escape closes the menu (its own handling); the popup's trap is then the top one and a second Escape releases it silently | first Escape closes the menu, second closes the popup |
| Send review sheet | Escape closes it (opt-in) | unchanged; the opt-in attribute is dropped because it is now the default |
| Visuals, copy, layout | — | unchanged; nothing is drawn differently |

**Owner sign-off (recorded):** on 2026-09-22 the owner chose "Flip the default in Popup.vue" and, on the exclusion question after the fullscreen recon (fullscreen is a global setting, not a per-popup trait), wrote: "Let's do it with no exclusions and maybe we don't merge it." The second half is a merge decision, not a scope one: the PR is opened and left for the owner.

## Architecture & Implementation (compact)

**Reuse / location.** Everything needed exists (`recon.md`). `Popup.vue` already has the correct Escape handler (`preventDefault`, `emit("onClose")`, return `false` so the trap is left to the close); it is only gated behind `closeOnEscape: false`. Every registry entry in `PopupManager.vue` wires `@onClose` to `popupStore.close(key)`, and the store compacts orders. focus-trap's stack makes the newest trap the only one listening, and its deactivate returns focus to a configured node.

**Two things `Popup.vue` must do besides flipping the default** (codex round 1):

1. **An opt-out must keep the trap.** Passing `false` today merely omits `escapeDeactivates`, and focus-trap 8.2.2 defaults that to `true` — the exact defect being fixed. With `closeOnEscape: false` the trap is created with `escapeDeactivates: false`: Escape does nothing, the keyboard stays inside. Nothing opts out today; the prop exists for a prompt that must be answered by a control, together with a blocked outside tap.
2. **The return-focus target is captured before the queued child continuation runs.** focus-trap records `document.activeElement` when the trap activates, one tick after `show` flips. `NewAccountPopup.vue:108` (through `usePopupEntity`'s `onShow`) focuses its own input from a `nextTick()` continuation queued earlier in the same flush, so it runs before the trap is created; what the trap then records depends on that ordering and on whether the still-active lower trap intercepts the focus move (`focus-trap/index.js:692, 785`), and on close it may try to focus a node that is being unmounted, leaving focus on `body`. `activate()` reads `document.activeElement` synchronously on entry (Vue runs post-flush watchers inside the flush, before the `nextTick` continuations — `runtime-core` `flushJobs`) and hands it to the trap as `setReturnFocus`, which `getReturnFocusNode` prefers over its own record (`index.js:511`). The opener then receives focus on close whenever it was focused when it opened the popup (a real click or a keypress; a programmatic `el.click()` does not focus, and then nothing changes from today). Limits, unchanged from today: a child that focuses synchronously during mount, before the post-flush watcher, would be what gets captured (none does); an opener that is disconnected by the time of the close makes `tryFocus` a silent no-op. The Send sheet's `initial-focus` selector is a separate mechanism: focus-trap applies it at activation *and* on every unpause (`addListeners` → `tryFocus(getInitialFocusNode())`, `index.js:877, 1293`), so a sheet beneath another popup refocuses its title when that popup closes, ahead of the closed trap's 0 ms return timer; `setReturnFocus` only names where the closed trap sends focus back.

**Change map.**

| File | Change |
|---|---|
| `apps/extension/src/components/Popup/Popup.vue` | `closeOnEscape` default `false` → `true`; `false` sets `escapeDeactivates: false`; `activate()` captures the opener and passes `setReturnFocus`; docstring rewritten |
| `apps/extension/src/components/Popup/Popup.test.ts` | default: Escape swallowed, `onClose` emitted, trap active; `closeOnEscape: false`: `escapeDeactivates` is `false`, nothing emitted; `setReturnFocus` is the element focused when `show` flipped even when a child focuses another node before the tick |
| `apps/extension/src/popup/components/modules/send/SendReviewSheet.vue` | drop the `close-on-escape` attribute (redundant) |
| `apps/extension/src/popup/components/modules/send/SendReviewSheet.test.ts` | the stub no longer asserts `data-escape="true"`; the case title loses "escape" |
| `apps/extension/tests/e2e/popup-stack.test.ts` | new case: `pointerClick` both openers; on the accounts → new_account stack, Tab once to prove focus is inside the top popup, Escape closes only new_account and focus lands on `accounts-popup-new`; a second Escape closes accounts and focus lands on `account-avatar-btn` |
| `apps/extension/tests/e2e/network/popup-escape-layered.test.ts` (new) | on the local network: Settings → Advanced → Account state → Authwits → actions menu → "toggle registry" opens `change_authwits_registry`; open its fee-method menu; Escape closes the menu while the popup stays *open* (the keyboard is still contained: Tab never reaches the page's `authwits-actions-btn`); Escape again closes the popup (`settleClosedPopup` before asserting it is gone) |
| `apps/extension/tests/e2e/fixtures/helpers.ts` | `closeStuckPopup` comment corrected: it presses Escape and removes leftover popup DOM; it does not clear the store, and Escape reaches a popup through its focus trap, not through FormPopup or PopupHeader |
| `CLAUDE.md` § Keyboard & focus order | one bullet: Escape closes the top popup, the keyboard twin of the outside tap; a menu inside a popup closes first; a popup that must not close on Escape passes `:closeOnEscape="false"` (the trap then holds) and blocks the outside tap too |
| `.claude/skills/e2e-testing/SKILL.md` | one line: Escape is a legitimate close for any registry popup; open the popup with `pointerClick` when the test asserts where focus returns, and wait for the landing with `waitForFocus` |
| `implementations-plan/index.md`, `send-publish-ledger/plan.md` (Outcome), `send-publish-ledger/lessons/phase-6.md` | the `send-review-focus-ring` follow-up is dropped (owner, 2026-09-22); `popup-escape-closes` is marked taken; the lessons log gets a dated line rather than a rewrite |

**Critical flow.** keydown Escape → focus-trap's `checkEscapeKey` on the top trap (a bubble listener on `document`; only the top trap has listeners installed) → `escapeDeactivates` = `onEscape` → `preventDefault`, `emit("onClose")`, return `false` (the trap stays; propagation is not stopped, so other document or window Escape listeners still run) → `popupStore.close(key)` → the popup's `show` turns false → the `show` watcher (`flush: "post"`) calls `deactivate()` → next tick `releaseTrap()` → `trap.deactivate()` with the default `returnFocus` → focus-trap unpauses the trap beneath synchronously (its `initialFocus` is re-applied on a delay: a no-op for `initialFocus: false`, the title selector for the review sheet) and, on a 0 ms timer, focuses the `setReturnFocus` node.

**A menu inside a popup.** `FeeSettingsCard` (inside `ChangeAuthwitsRegistryPopup.vue:119` and `RevokeAuthwitsPopup.vue:215`) renders a `Dropdown`. On open, `DropdownRoot` registers its own document keydown handler (`:121`) and then installs its own trap (`:145`), which becomes the top of the stack and pauses the popup's. On Escape, the menu's keydown handler runs first and calls `close()`; then the menu trap's `checkEscapeKey` (default `escapeDeactivates: true`) deactivates it synchronously, which re-installs the popup trap's listeners on `document` during that same bubble-phase invocation; the DOM invokes the listeners snapshotted for that target and phase when the invocation began, so the popup trap does not see this Escape. The second Escape reaches the popup trap. The new network e2e is the proof; nothing in the code changes for it.

**Simpler alternative considered.** Opt every registry popup in by hand (`close-on-escape` on 28 tags). Same behaviour, 28× the diff, and a new popup ships without it by default. Rejected: the default is the contract.

**Not done on purpose.** No `keepOnEscape`-style rename, no store-level Escape handling, no change to the outside-tap area, no per-popup `initialFocus` wiring (children that focus their own input keep doing so; `setReturnFocus` decides where the close sends focus).

## Phases

### Phase 1 ✓ — flip the default, hold on opt-out, capture the opener; prove it in units (gate green 2026-09-23, `lessons/phase-1.md`)

- `Popup.vue`: default `true`; `false` → `escapeDeactivates: false`; `setReturnFocus` from the element focused on `activate()` entry; docstring.
- `Popup.test.ts`: the three cases above (the existing "off" case is rewritten, the "on" case becomes the default, one new case for the return target).
- `SendReviewSheet.vue`: remove `close-on-escape`. `SendReviewSheet.test.ts`: the stub's `data-escape` assertion goes.
- `send.test.ts` / `send.integration.test.ts` stubs keep declaring the prop (harmless); the "backdrop / Escape" emit case stays as is.

**Validation gate**
- Commands (repo root):
  - `bun run --cwd apps/extension lint`
  - `bun run --cwd apps/extension typecheck`
  - `bun run --cwd apps/extension test src/components/Popup src/popup/components/modules/send src/popup/pages/send.test.ts src/popup/pages/send.integration.test.ts`
- Pass: all exit 0; `Popup.test.ts` shows the three Escape/return cases green.
- Layers: lint/typecheck · unit/component.

### Phase 2 ✓ — prove it in real browsers: the stack, and a menu inside a popup (local gate green 2026-09-23; the Firefox leg is the PR job, checked at Delivery — `lessons/phase-2.md`)

- `popup-stack.test.ts`: a second test on the accounts → new_account stack. Steps: open, `pointerClick` `account-avatar-btn`, `pointerClick` `accounts-popup-new`, assert `account-item` covered; press Tab once and assert focus is inside the new popup (`tabAround(1)` lands on a new_account control); `keyboard.press("Escape")`; `settleClosedPopup(page, "account-name-input")`; `account-item` reachable again; `waitForFocus(page, "accounts-popup-new")`; `accounts-popup` still visible; `keyboard.press("Escape")`; `settleClosedPopup(page, "accounts-popup")`; `accounts-popup` gone; `waitForFocus(page, "account-avatar-btn")`; console and page errors empty.
- `tests/e2e/network/popup-escape-layered.test.ts` (new, `localNetworkExtension`): `navigateToSettings(page, "advanced", "account-state", "authwits")`, `clickByTestId` `authwits-actions-btn`, `clickByTestId` `authwits-toggle-registry`, wait for `registry-toggle-submit` visible, `pointerClick` the fee-method trigger, wait for a `send-fee-method-*` item visible; Escape → no item visible, and the popup is still *open*, proven by containment rather than visibility (a closed popup can linger in its leave transition — `fixtures/popup-leave.ts`): once `registry-toggle-submit` is enabled (it is disabled until the registry state is read from the node, and a disabled button is no Tab stop), every one of ten Tabs lands inside the popup (`focusInPopupOf`, added in the post-implementation loop) and one of them on `registry-toggle-submit`; Escape → `settleClosedPopup(page, "registry-toggle-submit")`, then `registry-toggle-submit` gone; console and page errors empty. No transaction is sent.
- `helpers.ts`: correct the `closeStuckPopup` comment.

**Validation gate**
- Commands:
  - `bun run --cwd apps/extension build:chrome` (the smoke setup only checks that a build exists; it must be this branch's build)
  - from `apps/extension`: `bun run test:e2e tests/e2e/popup-stack.test.ts` (Chrome smoke; both cases green)
  - from the repo root: `NODE_OPTIONS=--dns-result-order=ipv4first NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/popup-escape-layered.test.ts` (the runner builds and owns its sandbox)
  - from `apps/extension`: `bun --bun vitest run scripts/e2e` (the static e2e scans)
  - Firefox: `geckodriver` is not installed on this machine, so the PR's `Extension smoke e2e (firefox)` job is the Firefox proof for `popup-stack.test.ts` — its aggregator is advisory, this gate is not: the job must be green before the PR is reported done, and `lessons/phase-2.md` records the run.
- Pass: exit 0 on each; two tests in the stack file, one in the layered file; no console/page errors.
- Layers: e2e (smoke) · e2e (live local network). The rest of the network suite is not re-run locally: `fee-methods.test.ts`'s Escape path is unchanged in meaning and CI runs it on the PR (the diff trips the `extension-network` filter through `src/components/**`).

### Phase 3 ✓ — docs and plan records (gate green 2026-09-23, `lessons/phase-3.md`)

- `CLAUDE.md` § Keyboard & focus order: the Escape bullet.
- `.claude/skills/e2e-testing/SKILL.md`: the Escape line, next to the `settleClosedPopup` guidance.
- `implementations-plan/index.md`: this plan's line (already added at creation) updated; the send-publish-ledger line's follow-ups reworded (focus ring dropped, escape taken).
- `send-publish-ledger/plan.md` Outcome: same rewording. `lessons/phase-6.md`: one dated line appended.
- `recon.md`: the dropdown row corrected (done in rev 2; the lesson — a nested component hides a Dropdown from a one-level grep — goes to `lessons/phase-3.md`).

**Validation gate**
- Commands (repo root):
  - `git grep -n "send-review-focus-ring" -- implementations-plan CLAUDE.md` → only the lines that record the drop (this plan, the ledger plan's Outcome, the dated lessons line, the index)
  - `bun run lint` (root: every workspace + the complexity-baseline check)
- Pass: the grep matches only record lines; lint exit 0.
- Layers: lint (repo-wide).

## Security & Adversarial Considerations

- **Threat model.** The only input is a keydown in the extension's own document. A dApp page cannot synthesise events into the extension popup or its windows (separate documents, extension origin). `PopupManager` is mounted unconditionally by `popup/app.vue`, so a registry popup can appear on a dApp-window route (the incoming-trust subscriber opens one from a service event); that popup is still inside the extension's document and answers only to the wallet user's keyboard. A malicious page gains no way to dismiss a wallet prompt.
- **Nothing is approved by Escape, and nothing already decided is undone.** Every popup's `onClose` is a dismissal. The confirm popup's callback runs only from its Confirm button (`ConfirmPopup.vue:63`, not awaited): Escape before the button cancels; Escape after it closes the popup while the started operation runs to completion, as the X does today. The incoming-trust prompt's Allow/Reject are awaited in place (`IncomingTrustPopup.vue:114`): an undecided prompt dismissed by Escape stays `pending` and is shown again on the next replay trigger (reconnect, identity switch, the visibility toggle — `incoming-transfer/service.ts:1290`), never auto-requeued by the dismissal itself; a decision already taken is not reverted. The review sheet closes without consent (D22 still holds: `authorises(source)` requires `source === "review"` on a ready sheet). An accidental Escape can lose typed form input, exactly as the X and the outside tap do today.
- **Idempotent close.** `popupStore.close` returns early for a key that is not open, so an Escape racing a same-tick close is a no-op.
- **Opt-out holds the keyboard.** With `closeOnEscape: false` the trap ignores Escape rather than releasing; a future must-answer prompt cannot be Tab-escaped.
- **No new dependency, no crypto, no credentials, no CI change.** `focus-trap` stays at 8.2.2; the lockfile is untouched.
- **Frontend checklist.** XSS/CSRF/clickjacking: no new rendering, no new input. Supply chain: none. Logging: nothing is logged on the Escape path.

## Assumptions

**Facts (verified)**
1. `Popup.vue:16-20` declares `closeOnEscape` with default `false`; `:32-36` `onEscape` prevents default, emits `onClose`, returns `false`; `:55-56` hands it to focus-trap as `escapeDeactivates` only when the prop is on. focus-trap 8.2.2 (`node_modules/focus-trap/package.json`) defaults `escapeDeactivates` to `true` and installs `checkEscapeKey` as a bubble keydown listener on `document` (`index.js:902`).
2. `PopupManager.vue:319-357` — every registry entry's `@onClose` is `popupStore.close('<key>')`; `popup.store.ts:24-32` `close` compacts orders and returns early on an unknown key.
3. `Popup.vue:83` — every popup renders a `close_area` that emits `onClose` on click; the outside tap is universal.
4. Only `SendReviewSheet.vue:77` passes `close-on-escape` today (`grep -rn "close-on-escape\|closeOnEscape" src` outside tests).
5. `PopupCard.vue:15-19` — the card fills the height iff `showFullscreen` (config `showPopupFullscreen`, default `true` in `wallet/config/config.ts:16`, forced on when `window.innerHeight > 600`) unless the card has `fit` (only the review sheet). Fullscreen is not a per-popup trait.
6. No registry popup gates its close: every `closable` binding is static, every `@onClose` a pass-through (sweep over `src/popup/components/popups/*.vue` and `FormPopup.vue`).
7. Two registry popups host a `Dropdown`: `ChangeAuthwitsRegistryPopup.vue:119` and `RevokeAuthwitsPopup.vue:215` render `FeeSettingsCard`, which renders `FeeMethodSelector.vue:37`'s `<Dropdown>`; `DropdownRoot.vue:157-165` installs its own focus trap on open and `:223` closes on a document keydown Escape. Other Escape handlers: `PasskeyCeremonyDialog.vue:50` (window keydown, mounted only by full-page routes; `ConfirmPopup.vue:54`'s passkey confirm opens a separate window, `wallet/services/passkey/service.ts:76-78, 113-127`). `LegalAcceptanceSheet.vue` has no keydown handler.
8. `popup-stack.test.ts` runs on both browsers (no `CHROME_ONLY` entry; not in `FIREFOX.md`'s Chrome-only list). Both openers in its stack are focusable: `Header.vue:272` is a `<button>`, `SettingItem.vue:50` carries `tabindex="0"`. `clickByTestId` (`fixtures/extension.ts:1445`) calls `el.click()` and does not focus; `pointerClick` sends real pointer events.
9. `NewAccountPopup.vue:98-109` focuses its name input from `usePopupEntity`'s `onShow` after `nextTick()`; `Popup.vue`'s `show` watcher is `flush: "post"` and `activate()` awaits its own `nextTick()` before creating the trap. Vue 3.5's scheduler runs post-flush callbacks inside `flushJobs`, before the flush promise's `nextTick` continuations (codex round 2, `runtime-core.cjs.js:284, 428`).
10. `fee-methods.test.ts:398` already proves Escape closes the review sheet and focus lands on `send-submit`. The smoke setup (`global-setup-smoke.ts:44`) only checks that a built manifest exists; `e2e:agent` builds.
11. `authwit-lifecycle.test.ts:125-128` reaches the registry popup through `authwits-actions-btn` → `authwits-toggle-registry` → `registry-toggle-submit` on the local network; the fee trigger inside it is `send-fee-method-trigger` (`FeeMethodSelector.vue:43`).

**Inferences (unverified; the audits may attack)**
- I1. In focus-trap 8.2.2, deactivating the top trap unpauses the one beneath synchronously (`index.js:1161`) and re-installs its listeners; with `initialFocus: false` that reinstall moves no focus (`:333`, `:487`); the top trap's return focus runs on a 0 ms timer (`:1183`). `waitForFocus` absorbs the timer. The Phase 2 smoke case is the proof.
- I2. `page.keyboard.press("Escape")` reaches the trap on Firefox over BiDi as it does on Chrome (the Firefox network lane already runs `fee-methods.test.ts`). The PR's Firefox smoke job proves it for the stack case.
- I3. No test outside those in the change map depends on Escape leaving a popup open. Search trail: `grep -rn 'Escape' tests src --include=*.test.ts` → `passkey-backup.test.ts:376` (ceremony dialog), `fixtures/helpers.ts:824` (`closeStuckPopup`) and `:1371` (`closeAllPopups`, a synthetic document Escape after the store is already clear), `helpers.ts:1043` (a dropdown), `network/fee-methods.test.ts:398` (the sheet), `network/transfers.test.ts:188` (a dropdown), `ChangeAuthwitsRegistryPopup.test.ts:167` (asserts a document Escape does not submit; the popup's Escape close is emitted by `Popup`, which that test stubs).
- I4. A listener added to `document` for the bubble phase while `document`'s bubble-phase listeners are being invoked for a keydown is not invoked for that keydown (the DOM snapshots the listener list per target and phase at invocation), so the popup trap re-installed by the menu trap's deactivation does not see the Escape that closed the menu. The layered network case is the proof.
- I5. Reading `document.activeElement` at `activate()` entry sees the opener: post-flush watchers run inside the flush, and both `nextTick()` continuations (the child's focus, the trap creation) after it, in registration order (codex round 2 confirmed this against Vue 3.5.41). The Phase 1 unit case pins the ordering with a child that focuses another node in `onShow`.

**Asks** — none open. Resolved with the owner on 2026-09-22: flip the default (not per-popup opt-in); no exclusions; unit + smoke e2e (plus one network case for the menu-in-popup layering, added on codex's condition); code-review off; the merge is the owner's decision after the PR is green.

## Decision ledger

| # | Decision | Alternatives | Why |
|---|---|---|---|
| D1 | Flip the default in `Popup.vue` | opt each popup in | one contract, no popup ships without it; the handler already exists |
| D2 | No exclusions | forms keep input; decisions force a button | every popup already dismisses on X and the outside tap; an exclusion would need both blocked to mean anything; fullscreen is global, so "fullscreen popups differ" is not expressible per popup |
| D3 | Keep the prop as an opt-out, and make the opt-out hold the trap (`escapeDeactivates: false`) | delete the prop; leave `false` as "focus-trap default" | codex round 1: the drafted opt-out reproduced the defect; a must-answer prompt needs the keyboard held, not released |
| D4 | Prove Escape on the accounts → new_account stack, in the existing file, with `pointerClick` openers and a Tab-inside check | a new file; a different pair; `clickByTestId` | same stack as the pointer-close case; `clickByTestId` never focuses, so the landing assertion would be vacuous |
| D5 | The merge is the owner's call | pre-authorised merge (the earlier standing authorisation) | the owner said so on 2026-09-22; the PR is opened, checks watched, nothing merged |
| D6 | Skip the blueprint skill's `implementations-plan/.gitignore` migration | apply it | this repo's `CLAUDE.md` and `implementations-plan/README.md` commit audit transcripts deliberately (537 tracked `audit-*.md`); the project rule wins; audit paths are rewritten repo-relative before commit |
| D7 | `Popup.vue` captures the opener on `activate()` entry and passes `setReturnFocus` | wire `initialFocus` per popup so children stop focusing their own inputs; accept `body` as the landing | codex round 1 found `NewAccountPopup` focuses its input from a queued continuation before the trap records; a two-line change in the shell makes every popup's close land on its opener without touching 28 children; a disconnected opener stays a silent no-op, as today |
| D8 | Menu inside a popup: first Escape closes the menu, second the popup; recorded and tested in a new network file | swallow Escape in those two popups; test in smoke | normal layered dismissal, no exclusion; the fee menu needs fee discovery against a node, so the smoke suite cannot open it |

## Audit log

**Codex round 1 (plan rev 1, 2026-09-22, `gpt-6-astra` high):** `conditional approve (with conditions: correct the nested-dropdown assumption, preserve trapping on opt-out, fix e2e opener focus, and build before browser validation)`.

| Finding (severity) | Verified | Disposition |
|---|---|---|
| Dropdowns exist inside registry popups via `FeeSettingsCard` (Medium) | yes — `ChangeAuthwitsRegistryPopup.vue:119`, `RevokeAuthwitsPopup.vue:215`, `FeeMethodSelector.vue:37`; recon's one-level grep missed the nested component | adopted: Fact 7 rewritten, layering recorded (D8), new network e2e, recon.md corrected |
| The opt-out preserves the defect (Medium) | yes — `false` omits the option; focus-trap defaults it to `true` | adopted: `escapeDeactivates: false` on opt-out + unit case (D3) |
| Security wording overstates cancellation and window isolation (Medium) | yes — `ConfirmPopup.vue:63` does not await; `IncomingTrustPopup.vue:114` awaits a started decision; `PopupManager` is unconditional in `popup/app.vue` | adopted: section rewritten; no new bypass found |
| `closeStuckPopup` comment also claims a store clear it does not do (Low) | yes — `helpers.ts:817-834` | adopted: comment rewritten completely |
| I1 blanket "all traps use `initialFocus: false`" is false for the sheet (Low) | yes — `SendReviewSheet.vue:77` | adopted: wording narrowed |
| The e2e does not establish its focus target: `clickByTestId` never focuses; `NewAccountPopup` focuses its input before the trap records (Medium) | yes — `extension.ts:1445`; `NewAccountPopup.vue:108` | adopted: `pointerClick` both openers, Tab-inside check (D4); and the shell captures the opener (D7) so the landing is deterministic rather than hoped for |
| "Swallowed" means default-prevented, not propagation-stopped; I3's search record incomplete (Low) | yes | adopted: flow text and I3 corrected |
| Resolve nested-menu precedence explicitly (Medium) | — | adopted: D8 |
| Build before browser validation; require the Firefox case to pass (Medium) | yes — `global-setup-smoke.ts:44` | adopted: `build:chrome` in the Phase 2 gate; Firefox via the PR's smoke-firefox job, required by this gate even though its aggregator is advisory |

Rejected: nothing. Open: nothing.

**Codex round 2 (plan rev 2, same session, resumed):** `conditional approve (with conditions: strengthen the layered test's open-state assertion and correct the remaining lifecycle claims)`.

| Finding (severity) | Verified | Disposition |
|---|---|---|
| Visibility alone cannot prove the popup survived the first Escape: a store-closed popup lingers through its leave transition (Medium) | yes — `fixtures/popup-leave.ts:2` | adopted: the layered case asserts containment (`tabAround` never reaches the page control) after the first Escape and `settleClosedPopup` before asserting the second close |
| D7's explanation overclaimed ("before any child moves focus"; "correct regardless"); the composable is `usePopupEntity` (Low) | yes — `NewAccountPopup.vue:98` | adopted: wording narrowed to the queued continuation; limits stated |
| The sheet's `initialFocus` selector also runs on unpause (Low) | yes — `focus-trap/index.js:877, 1293` | adopted: flow text corrected; no code change |
| D8 reversed the handler order and overgeneralised listener cloning (Low) | yes — `DropdownRoot.vue:121, 145`; per target/phase snapshot | adopted: text corrected |

Confirmed fine by codex: Vue 3.5.41's post-flush-before-continuations ordering; raw `setReturnFocus` honoured inside the resumed lower trap; the separate network file and fixture; the opt-out; the builds; the Firefox gate; the security wording; the doc placement. Rejected: nothing. Open: nothing — both conditions are folded into rev 3.

## Post-implementation

Executed by the implementing session from this file. `code_review: off`, so no `/code-review` pass: the codex loop is the review.

1. **Codex audit** (`/codex high`, a fresh session via `run-codex.sh <prompt> <worktree> high read-only`): the net diff from `a5374be2`, this plan and its decision ledger, the adversarial/security ask (what could an attacker do with Escape; what is trusted that should not be; does any popup now dismiss something it must not; does the captured opener ever land focus somewhere it should not), and these two rules verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop**: verify each factual claim against the tree before acting; apply accepted fixes; commit (signed, `SSH_AUTH_SOCK= git commit -F <file>`); log consult + verdict in `lessons/phase-4.md`; resume the same codex session (`resume-codex.sh`) with the fix diff for a re-review. Stop when a round yields no new material findings; still material after 3 rounds → surface to the owner.
3. **Pre-PR gate**: `bun run audit:vue` (typecheck ∥ unit + component ∥ lint, then build) from the repo root; `bun run --cwd apps/extension test:e2e tests/e2e/popup-stack.test.ts` once more on the final commit.
4. **Delivery** (below). The PR is opened only now, and it is not merged.

## Delivery

Single arc, one branch (`worktree-popup-escape-closes`), one PR into `dev`: `gh pr create` with no labels (a label on create cancels the e2e runs; the diff trips the smoke and network filters by itself). Title ≤ 93 chars, conventional: `fix(popup): escape closes the top popup, the way tapping outside does`. Body: the UI-impact table, the owner's sign-off quoted, the two browser cases, the docs edits, the dropped follow-up, and the trailer. Watch `gh pr checks --watch`, and read the Firefox smoke job's result by name. **Do not merge**: report green and stop; the owner decides.

**First CI run (2026-09-23).** Four of the five aggregators went green, the Firefox smoke job included. `extension-network-e2e-status` went red on one Chrome shard: the layered test's `pointerClick` read the fee trigger's centre mid-slide and pressed after the trigger had moved. Fixed in the helper, which now waits for a still target; reproduced and proven under CPU throttling (old helper 4/8 presses missed, new 0/8). Codex then made the helper also wait out an enter transition that has not started (rounds 3–5, approve). `lessons/phase-4.md` § Delivery — CI and Rounds 3–5.

## Seeds (final — approved 2026-09-23, unchanged from the draft)

Both run inside this worktree (`agent-worktree resume popup-escape-closes`). Use exactly one per session.

**Recommended: `/goal`** (completion is transcript-observable).

```
/goal All three phases marked ✓ in implementations-plan/popup-escape-closes/plan.md (the phase headers in the file, not the chat), each ✓ backed by its validation gate reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/popup-escape-closes/lessons/phase-N.md`; `/code-review` was NOT run (code_review is off); the codex fix loop over the net diff converged, evidenced by a resumed codex pass quoting no new material findings; `bun run audit:vue` exit 0 in the transcript; a PR into dev exists (`gh pr view` output in the transcript) created only after the loop converged, with no labels; `gh pr checks` shows quality-status, extension-smoke-e2e-status and extension-network-e2e-status green and the Firefox smoke job green; the PR is NOT merged — the owner decides.
```

**Alternative: `/loop 15m`**

```
/loop 15m Drive implementations-plan/popup-escape-closes forward. Never idle waiting for my input. Each firing: (1) read plan.md and lessons/ — if plan.md carries an `## Outcome` block or the folder moved to archive/, STOP; rebuild the task list from the phase headers if empty; `git status`, `git log --oneline -5`; if a PR exists, `gh pr view --json statusCheckRollup`. (2) Waiting on CI is fine — `gh run watch` up to 10 min, then log blocked. (3) No task in hand? take the next pending phase; after each edit run `bun run --cwd apps/extension lint` and the touched tests; commit signed (`SSH_AUTH_SOCK= git commit -F <file>`), push. (4) Stuck or facing a decision? consult `/codex high` and act on the stronger argument; log it in lessons/phase-N.md; hard limits: never merge, never touch apps/tools/** or packages/bridge-core/**, never widen scope past plan.md. (5) Same step failed 5 times? reassess with codex. (6) Phase green = its gate in plan.md passes: paste the result, mark ✓, print `LESSONS_FILE=…`. (7) All ✓? run the Post-implementation section: codex audit over the net diff with the no-over-engineering and comment-quality rules, fix loop until clean (max 3 rounds), `bun run audit:vue`, then `gh pr create` into dev with no labels, `gh pr checks --watch`, write the wrap-up (what shipped, every contested decision with ELI5 context), and STOP without merging.
```

## Lessons

`lessons/phase-1.md` … `phase-4.md` are written as the phases run.

## ELI5 companion

Artifact (claude.ai, private): https://claude.ai/artifact/GJsE838mEUep8MJidQNkM9 — source `implementations-plan/popup-escape-closes/eli5.html` (republish the same path to update the same URL).
