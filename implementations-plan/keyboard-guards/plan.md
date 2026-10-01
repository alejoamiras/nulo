---
plan: keyboard-guards
tier: light
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
eli5_mode: artifact
eli5: https://claude.ai/artifact/WY5w8GEggYX9zZTEuqBktk (one page for the wave's ten plans)
branch: fix/keyboard-guards
worktree: .claude/worktrees/keyboard-guards
base: dev @ 85c4d20f
---

## Outcome

- **Date:** 2026-09-29. **Status:** closed, awaiting archive: delivered as #720 on
  `fix/keyboard-guards`, not yet merged. On 2026-09-29 the owner picked K1 (a) and gave the
  blanket sign-off for UI impact rows 1 to 7 (§ P4).
- **Shipped** in #720, K-A, K-B and F-6 as planned, P0 to P4:
  - K-A: onboarding Create, popup Import, Change password, Recovery phrase and Full backup bind
    their Enter shortcut on the page's root instead of `document`. It answers only an Enter in one
    of the page's fields that no child handled, and each button it names refuses a repeat or
    composing Enter. Onboarding keeps only the browser's form submission, and its form refuses a
    repeat or composing Enter, so a held Enter creates the wallet once.
  - K-B: New profile's copy of the field check folds into `isPopupSubmitKey`.
  - F-6: `DappApprovalFooter`'s confirm (execute, capabilities, discover) refuses a repeat or
    composing Enter.
  - Shared pieces:
    - `refuseRepeatEnter`, which checks the key itself, on eleven buttons and onboarding's form.
    - `pressOn`, the button-activation test helper.
    - `@nulo/design`'s `Input` gains `inputTestid`.
    - CLAUDE.md § Keyboard & focus order states the page rule.
  - Tests: a red-first unit or component case per page and control; `keyboard-guards.test.ts` holds
    a real Enter on Chrome and Firefox; `backup-roundtrip.test.ts` drops its document Enters.
  - From the codex loop: the key check in `refuseRepeatEnter`, and three list-only test headers
    removed.
- **Gates at delivery:** the final gate on `f08bafed` (`lessons/post-impl.md`). Lint,
  `typecheck:all`, `test:all`, `test:ci-gating`, the plans gate and the build exit 0. Smoke is
  green on Chrome, and on Firefox in three shards, with P3's counts. The flake bar passes
  three of three per browser at retry 0. Codex approved in two rounds of three, with no finding
  rejected. The later commits touch only `implementations-plan/`; the plans gate, lint and
  `test:ci-gating` ran again on them.
- **Dropped:** K1 (b)'s body-Enter listener and the `full.test.ts` case it would have restored,
  since the owner picked (a). Its capture-only commit was never pushed.
- **Owner answers, 2026-09-29:** K1, "(a) Nothing until Tab (Recommended)"; rows 1 to 7, "sign off
  rows 1 to 7 as built sir!" (§ P4).
- **Open items:** none left here; `follow-ups.md` holds them. In § Wallet safety:
  - FU-1: no submit latch on Retrieve or Change Password.
  - FU-2: Verify's OK, for `connect-window`.
  - FU-3: the two focus rings that do not show, which the owner left out of this PR.

  In § ux-feedback: technical, `test-soak/cli.test.ts`'s fixture cases, which run under
  `bun test`'s 5 s default (`lessons/post-impl.md`).

  `lessons.md` carries three. In § E2E: the held-key entry, extended with Firefox, and the
  implicit-submission one. In § Popup UI: the focus-ring one.
- **Seeds retired:** the `/goal` and `/loop` seeds below are spent; nothing to resume.
- **Shipped**: #720.

# Keyboard guards

The Enter paths #717 left open (`implementations-plan/follow-ups.md` § Wallet safety), as one PR
off `dev`:

- **K-A** · Five pages answer a bare Enter from any control (F-3): onboarding Create, popup
  Import, Change password, Recovery phrase export and Full backup export. Enter on Back, on a
  file picker, on "View Errors", on "Download Backup", or in the error viewer's search field runs
  the page's main action as well as, or instead of, the control's own. A held Enter on a page's
  own button runs its action again on every repeat.
- **K-B** · The popup's New profile page keeps a copy of the field predicate without #717's repeat
  and composition refusal.
- **F-6** · The dApp windows' shared confirm (execute, capabilities, discover) accepts a repeat or
  composing Enter, against CLAUDE.md's rule for popups that send or sign. It gets #717's
  button-local refusal. The focus-transfer scenario itself stays one Decision-ledger line.

Recon: [`recon.md`](recon.md).

## Phase 0 (pre-answered by the owner)

No clarifying questions were asked. The owner, 2026-09-28: "Can you ultracode 1 to 5 + security
and privacy + test rliability + trivial? Assigning blueprinting level to each of those and just
needing me to answer the open questons that it may come." The owner, 2026-09-29: "Feel free to
leverage the gh cli to merge away the branches that you understand are ready and feel confident on
their implementation. Continue then with ultracodeing the follow-ups." The owner, 2026-09-28:
"FYI: use opus5.5 instead of fable please."

- **Scope**: K-A, K-B and F-6's footer guard above. The rule, from the brief: an Enter confirms
  only when the focused element is the control it names, or a field of that page whose Enter means
  submit; a repeat or composing Enter confirms nothing.
- **Out**: Verify's OK (`popup/windows/verify/index.vue`, which `connect-window` rewrites; FU-2);
  the missing re-entrancy latches on a mouse double-click (FU-1); any change to what a control does
  when it is pressed once; the form popups on `usePopupEntity` (already guarded by #717).
- **Constraints**: pre-production, no migrations; complexity budgets hold with no new acceptance;
  no new dependency; the logging policy (no new log line); existing testids verbatim; CLAUDE.md
  § Keyboard & focus order (no positive tabindex, custom widgets keep their keyboard activation,
  secondary in-field controls stay out of the Tab path, nothing approved by Escape).
- **Quality bar**: production. **`/harden`**: not scheduled. **`/code-review`**: off.
- **Validation layers**: typecheck and lint, unit and component, CI-gating scripts, build; smoke
  e2e on Chrome and Firefox (one new smoke file, one changed); no network e2e (no page here
  reaches the network suite's paths, and no file under `tests/e2e/network/` changes).
- **Decisions**: UI and product asks go to the owner (K1 and the blanket sign-off); technical asks
  are decided with `/codex high` and logged in `lessons/`. Every Ask carries a recommendation and a
  confidence.
- **Delivery**: single arc, one PR off `dev` on `fix/keyboard-guards`, plain `gh pr create` after
  the codex loop converges. Merged by the driver under the owner's standing authorization (2026-09-29,
  quoted above) once every required check is green on the head, every UI surface carries the
  owner's quoted sign-off and the codex loop has converged.

### Phase 0.5 · Tier

| Dimension | Score (0-3) | Why |
|---|---|---|
| Novelty | 0 | The predicate, the button refusal and the test helper already exist (#717) |
| Blast radius | 1 | Five pages' Enter handlers, one page helper, one shared footer, one design prop, test helpers |
| Irreversibility | 0 | Code and tests only |
| Migration cost | 0 | No stored shape changes |
| External coupling | 1 | The dApp windows' confirm key handling (no wire or RPC change) |
| Security sensitivity | 2 | Two of the five pages reveal secrets, one changes the password, and the footer confirms dApp sends |

`light`: every fix is a known guard with a known predicate, under the owner's standing cap "never
blueprint more than mid, to keep our credits safe".

## Outcome & Quality Bar

For whom: a person who moves through onboarding, import, password change, an export or a dApp
approval with the keyboard, and presses Enter on the control they mean, Back included.

Excellent means:

1. **Enter does what the focused control says.** On all five pages, Enter on Back, a method tab,
   the file picker row, "View Errors", "Download Backup" or a show-password toggle runs that
   control's action and nothing else, and Enter in a field outside the page (the error viewer's
   search) never runs the page's action. A component test per page that fails on `85c4d20f`
   proves it, and each asserts the control's own action ran.
2. **One key, one action.** Enter on a page's own button runs it once (today Recovery phrase runs
   twice, and Change password is predicted to, Inference 6), and a repeat or composing Enter on a page's submit control, in a
   page's field, in New profile's field or on the dApp windows' confirm runs nothing. A component
   test per control proves the refusal; a smoke case on each browser proves a held Enter on
   Retrieve clicks once, with `repeat: true` recorded.
3. **Enter in a field still submits.** Preservation cases per page (green before and after), and a
   smoke case proving onboarding's native form submission from the confirm field on each browser.

Good enough: nothing drawn changes; a mouse double-click on Retrieve and Change Password keeps its
double run (FU-1); with nothing focused, Enter behaves as the owner picks in K1.

## UI impact

Nothing drawn changes. The keyboard behaviour below does; all rows are built as recommended and
were **signed off by the owner on 2026-09-29** (§ P4).

| # | Surface | Before → after | Sign-off |
|---|---|---|---|
| 1 | Onboarding → Create wallet | Enter on Back or on the active method tab creates the wallet when the password pair is valid or Passkey is chosen (Passkey opens the passkey prompt), and Back also routes to Welcome → Back only goes back, the tab only selects. Enter in a field still creates, once for a held Enter | signed (blanket), the owner, 2026-09-29 |
| 2 | Popup → Import / Recover → Full backup | Enter on Back or "Choose a backup file" decrypts the chosen file or starts restoring it; Enter on "View Errors", or Enter in the error viewer's search, continues to Home → each control does only its own thing, and the search finds the next match. Enter in a field still decrypts or restores; a held Enter on Decrypt, Import or Continue runs it once | signed (blanket), the owner, 2026-09-29 |
| 3 | Settings → Security → Change password | Enter on the back arrow with valid fields changes the password; Enter on Change Password is predicted to send two changes (Inference 6; Vue may disable it before the native click), the second failing its reseal as a wrong current password → the back arrow only goes back; Change Password sends one change | signed (blanket), the owner, 2026-09-29 |
| 4 | Settings → Security → Export → Recovery phrase | Enter on the back arrow with a password typed retrieves the phrase in the background; Enter on Retrieve retrieves twice, and a held Enter more, leaving an auto-close timer that "keep open" cannot cancel → the back arrow only goes back; Retrieve retrieves once, held or not | signed (blanket), the owner, 2026-09-29 |
| 5 | Settings → Security → Export → Full backup | At the backup-ready stage, Enter on "Download Backup" encrypts instead (password profile), or hides the recommendation and downloads the plain file (passkey profile, no password typed); Enter on the back arrow runs the stage's action; a held Enter on Download downloads again per repeat (predicted) → "Download Backup" downloads once; the back arrow only goes back | signed (blanket), the owner, 2026-09-29 |
| 6 | Popup → New profile | A repeat or composing Enter in the name field submits → it does not | signed (blanket), the owner, 2026-09-29 |
| 7 | dApp windows → execute, capabilities, discover: Confirm / Allow | A repeat or composing Enter that lands on the idle confirm approves → it does nothing; a fresh Enter or a click approves as today | signed (blanket), the owner, 2026-09-29 |
| 8 | Full backup export and Import, with nothing focused (after a stage swaps the focused button away) | Enter runs the next stage's action (encrypt, then download; Continue past restore errors) → per K1: (a) nothing, Tab to the button; (b) unchanged | **K1**: (a), the owner, 2026-09-29 |

### UI asks for the owner (built as recommended)

- **K1 · Enter with nothing focused.** When a stage change removes the focused button (full
  export: Create Backup → the backup-ready stage → encrypted; import: a restore that finishes with
  errors), focus falls to the page, and Enter today runs the next stage's action.
  **(a) Enter answers only from a field; with nothing focused it does nothing, and the person Tabs
  to the button they want. (b) Enter with nothing focused keeps running the stage's action.**
  (b) is an exception to the rule this plan enforces (an Enter confirms only from the control it
  names or a field), so choosing it authorizes that exception on these two stages.
  Recommended and built: (a). It is the owner's O1 (a) rule for the authwit popups
  (`wallet-safety-fixes/plan.md` § UI asks), New profile's rule today (Fact 13), and the brief's
  rule; at the backup-ready stage it lets the person choose between "Protect with Password" and
  "Download Backup" instead of Enter choosing for them, and after a restore with errors it stops
  Enter from skipping the log. (b) keeps an Enter, Enter, Enter run through the export. Its cost
  under (a): the first Tab from the body lands on the page's first stop, which is the back arrow
  (`CollapsingHeroLayout.vue:63`), not necessarily the CTA; the capture records where. Confidence:
  moderate.
  Pictures, per option, as built captures (§ P4 capture list): (a) and (b) at full export's
  backup-ready stage and at import's finished-with-errors stage, before and after Enter, and for
  (a) the frame after one Tab, focus ring visible wherever it landed. **Answered (a)** by the
  owner, 2026-09-29 (§ P4).
- **The blanket sign-off** covers UI impact rows 1 to 7, each pictured on the page (§ P4 capture
  list): a built capture with the focus ring visible before the key and the frame after it, or,
  where a headless browser cannot produce the state (an IME composition, a held Enter carried onto
  a confirm), an annotated interaction mock at the real popup size and font.

## Architecture & Implementation

### Proposed architecture

No new abstraction. Three guards, each reusing #717's pieces in `usePopupEntity.ts`:

1. **The page's Enter shortcut answers only a field of that page.** Each popup page's handler moves
   off `document` onto the page's root (`@keydown="onKeydown"` on its `CollapsingHeroLayout`, whose
   single root `Flex` receives the listener, Fact 26), and starts with
   `if (e.defaultPrevented || !isPopupSubmitKey(e)) return`. A field in a shell popup over the page
   (the error viewer, Fact 23) is outside the root and never reaches it; a focused button, link or
   tab gets only its native activation; the body (nothing focused) is outside the root (K1 (a)).
   The page's action and its stage logic below the guard stay as they are; the manual
   `addEventListener`/`removeEventListener` pairs and `seed.vue`'s install watcher go.
2. **Onboarding uses its form.** `create.vue`'s document handler is deleted: Enter in a field
   submits through the `<form @submit.prevent="handleSubmit">`'s implicit submission, whose default
   button is the CTA (Fact 19). The form gains `@keydown.enter="refuseRepeatEnter"`, so a repeat
   or composing Enter in a field, on a tab or on the CTA submits nothing. Back is outside the form
   (`:109`), the tabs are `type="button"` (`:131`, `:143`).
3. **A submit control ignores a repeat or composing Enter that lands on it.** A new one-line
   export beside `isRepeatOrComposing`, `refuseRepeatEnter(e)`, cancels such a keydown so the
   native activation never fires (#717's inline expression at `RevokeAuthwitsPopup.vue:250`,
   which both authwit popups switch to). Bound with `@keydown.enter="refuseRepeatEnter"` on every
   control whose action the page's Enter shortcut names: Import's Decrypt, Import and Continue;
   Change Password; Retrieve; full export's Create Backup, Protect and Download; and the shared
   `DappApprovalFooter`'s confirm.

- `create.vue`: delete `onKeydown` and its listener pair (`:88-96`, `:100`); form refusal at `:116`.
- `import.vue:146-147`: guard; listener on the root (`:170`), listener pair (`:159-166`) goes;
  refusal on `:239-275`'s three CTAs.
- `change-password.vue:82-84`: the same; root at `:99`; refusal on `:219-225`.
- `seed.vue:74-83`: the same, watcher gone (before Agree the page has no field); root at `:94`;
  refusal on `:182-190`.
- `full.vue:391-393`: `if (!isAgreed.value || e.defaultPrevented || !isPopupSubmitKey(e)) return`;
  the stage switch stays; root at `:436`; refusal on `:630-660`'s three CTAs.
- `new.vue` + `new-profile-helpers.ts`: `makeCreateKeydownHandler` checks
  `!e.defaultPrevented && isPopupSubmitKey(e)`, bound on the page's root (`new.vue:98`) instead of
  `document`; `shouldHandleEnter` is deleted (its only caller is `:67`; its tests at
  `new-profile-helpers.test.ts:109-133` go, since `usePopupEntity.test.ts:41-49` and `:106-108`
  cover the predicate).
- `DappApprovalFooter.vue:50-60`: the confirm's refusal; its explicit import.

Each SFC imports what it uses explicitly from `@/composables/usePopupEntity` (the unit vitest does
not auto-import composables).

### Key interfaces

- New: `refuseRepeatEnter(e: KeyboardEvent): void` in `apps/extension/src/composables/usePopupEntity.ts`,
  TSDoc one line ("Cancels a repeat or composing Enter so a focused control's native activation
  does not fire"). An auto-imported export, so `src/types/auto-imports.d.ts` gains its two lines:
  build before committing it.
- New: an optional `inputTestid` prop on `@nulo/design`'s `Input`, bound as the native `<input>`'s
  `data-testid` (absent when unset; the root keeps its testid). Used once, by onboarding's confirm
  field (`onboarding-password-confirm-input`), so the smoke case can focus and assert the native
  field by testid.
- Unchanged: `isPopupSubmitKey`, `isRepeatOrComposing`.
- Test-only: `pressOn(el, key, init?)` moves to `apps/extension/tests/helpers/press-key.ts` with its
  current signature. Its doc comment states the contract: it simulates a button's activation
  (focus, a cancelable keydown, then `el.click()` for Enter unless cancelled), and proves nothing
  about native form submission or browser timing. Field cases dispatch a plain keydown on the
  field instead.

### Data and control flow

Enter on a focused Back button, after the change: keydown dispatches at the button, bubbles to the
page's root, the handler returns at the guard (target is a `<button>`); the native activation fires
the button's click, which navigates. Enter in the password field: the guard passes and the handler
runs the page action as today. Enter in the error viewer's search field: CodeMirror finds the next
match and the page's root never sees the key. A held Enter on Retrieve: the first keydown
activates it; each repeat is cancelled at the button. With nothing focused (target `document.body`):
nothing listens (K1 (a)).

### File-level change map

| File | Change |
|---|---|
| `apps/extension/src/composables/usePopupEntity.ts` (+ `.test.ts`) | `refuseRepeatEnter`; two cases (repeat and composing cancelled, a plain Enter not) |
| `apps/extension/src/types/auto-imports.d.ts` | regenerated by the build (two lines) |
| `apps/extension/src/onboarding/pages/create.vue` (+ `create.test.ts`) | document handler deleted; form refusal; `inputTestid` on the confirm field |
| `apps/extension/src/popup/pages/import.vue` (+ `import.test.ts`, new) | root listener, guard, three refusals |
| `apps/extension/src/popup/pages/settings/security/change-password.vue` (+ `change-password.test.ts`, new) | root listener, guard, one refusal |
| `apps/extension/src/popup/pages/settings/security/export/seed.vue` (+ `seed.test.ts`, new) | root listener, guard, one refusal; the task-history comment at `:67-68` goes |
| `apps/extension/src/popup/pages/settings/security/export/full.vue` (+ `full.test.ts`) | root listener, guard, three refusals; the switch comment at `:405-406` shortened to the live invariant |
| `apps/extension/src/popup/pages/profile/new.vue`, `new-profile-helpers.ts` (+ `.test.ts`) | root listener; helper on the shared predicate; its `shouldHandleEnter` reference and extraction narrative (`:59-63`) and `new.vue`'s "Quirk 2" comment (`:83-84`) trimmed |
| `apps/extension/src/components/composite/DappApprovalFooter.vue` (+ `.test.ts`) | confirm refusal; one case |
| `RevokeAuthwitsPopup.vue`, `ChangeAuthwitsRegistryPopup.vue` | inline expression → `refuseRepeatEnter` |
| `packages/design/src/ui/Input.vue` (+ `Input.test.ts`) | `inputTestid` prop; one case |
| `apps/extension/tests/helpers/press-key.ts` | new: `pressOn`, moved, contract documented |
| `RevokeAuthwitsPopup.test.ts`, `ChangeAuthwitsRegistryPopup.test.ts` | import `pressOn` |
| `apps/extension/tests/e2e/keyboard-guards.test.ts` | new smoke file (§ P3) |
| `apps/extension/tests/e2e/backup-roundtrip.test.ts` | the poke's two document Enters and its comment go; the click stays |
| `CLAUDE.md` § Keyboard & focus order | one bullet |
| `implementations-plan/follow-ups.md` | F-3 and F-6 deleted; FU-1 and FU-2 added |

### Non-obvious mechanics

- **The latch tests in `full.test.ts`.** `:217-218`'s document Enters become vacuous once nothing
  listens at `document`, and `:229`, `:238` only ever exercised the switch's no-op on `progress`
  (`full.vue:394`), not a latch. They go. What stays is latch evidence named as such: the click
  side (the CTA unrenders synchronously, one `exportBackupMaterial`), and `handleEncrypt`'s
  `isBusy` latch through two clicks on Protect in one tick (one `getPasshash`). `:245-252` pinned
  "Enter at the backup-ready stage starts encryption"; under K1 (a) it pins that an Enter at
  `document.body` starts nothing. Every mount in the file is attached to `document.body` and
  unmounted in `afterEach`.
- **The error-viewer regression uses the real viewer.** `import.test.ts` mounts the page and, in a
  separate `createApp` attached to `document.body` (two VTU mounts in one test drop stubs,
  `lessons.md` § CI & gates), a real `JsonViewer`; it opens CodeMirror's search panel on the view
  (`EditorView.findFromDOM`, `openSearchPanel`), types a term that appears twice, and presses Enter
  in the search field and on the "match case" checkbox. It asserts the selection moved to a match
  and `completeImport` never ran. Red on `85c4d20f`: the page's document listener takes both keys.
  If CodeMirror cannot run in jsdom, stop and log it; do not substitute a hand-made input.
- **Back tests honour `SubPageHeader`'s choice.** Its back arrow calls `router.back()` when
  `window.history.length > 1`, else `router.push(backTo)` (Fact 24); a test asserts the navigation
  its own history produces, and that no service call ran.
- **Onboarding's IME boundary.** The form's refusal cancels a composing Enter keydown in a text
  field. The IME has consumed that key before the page sees it, so cancelling it should not undo
  the commit (Inference 5); headless Chrome and Firefox cannot drive an IME here, so this stays an
  Inference, with C6 asking whether the form should refuse repeats only.
- **The smoke recorder.** `keyboard-guards.test.ts` records, from a capture listener installed in
  the page, each Enter keydown's nearest testid and `repeat`, each `click` on the control under
  test and each `submit`, the way `network/popup-escape-layered.test.ts:93-108` records keydowns.
  A driver that sends no repeat, or a first retrieval that resolves before the repeat lands, fails
  the step on the recorded list instead of passing it.

### Trade-offs and alternatives not taken

- **Keep `create.vue`'s document handler, guarded.** Unit-provable in jsdom, but it duplicates the
  form's native submission and leaves the implicit-submission path unguarded against a repeat.
  Rejected (codex Ask C1, amended).
- **Keep `document` listeners and check `root.contains(e.target)`.** Same scoping, more code per
  page. Rejected for the root binding.
- **Add `!e.defaultPrevented` to `isPopupSubmitKey` itself.** One place, but it changes #717's 13
  form popups, where a child's cancelled Enter is not proven to mean "do not submit". Rejected.
- **The inline `isRepeatOrComposing($event) && $event.preventDefault()` on each control.** Twelve
  copies of one expression. Rejected for `refuseRepeatEnter` (C7).
- **A design `Button` that refuses a repeat Enter everywhere.** Changes every button in the
  extension and the landing. Rejected.
- **Rename `isPopupSubmitKey` to fit pages.** Seven call sites and the generated declarations for a
  name; the TSDoc already says what it checks. Rejected (codex Ask C2, approved).
- **Per-control `@keydown.enter.stop` on every Back and secondary button.** Fails open: the next
  control added forgets it. Rejected.

## Security & Adversarial Considerations

- **Threat model.** No remote attacker reaches these keys: extension pages and windows take no
  events from web pages or content scripts, and a dApp cannot focus or press anything in them. The
  risk is the person's own keypress doing something they did not choose: retrieving the recovery
  phrase while pressing Back (row 4), changing the password while pressing Back (row 3), restoring
  a backup they meant to replace or skipping past restore errors while searching them (row 2),
  getting a different backup file than the one they chose (row 5), and a held Enter approving a
  dApp send (row 7). The fix narrows each surface to the control pressed, once.
- **Secrets.** Row 4 removes one path by which the service worker decrypts the mnemonic without
  the person asking, and repeated retrievals under a held Enter. Nothing new is logged, stored or
  sent; no secret-bearing value is touched.
- **Least privilege, cryptography, supply chain.** N/A: no permission, credential, crypto or
  dependency change.
- **Input validation.** The guards read `e.key`, `e.repeat`, `e.isComposing`, `e.keyCode`,
  `e.defaultPrevented` and the target's type only.
- **Frontend.** No XSS or clickjacking surface changes; no copy changes.
- **What could go wrong.** A page left with no keyboard path: every CTA is a native button,
  Tab-reachable, so Tab then Enter always works (K1 (a)'s cost). A field that is not a text field:
  `isPopupSubmitKey` admits any `<input>`; none of the five pages renders a checkbox, radio or
  `<textarea>` inside its root (`rg 'type="checkbox"|type="radio"|<Checkbox|<textarea'` over them
  returns nothing), and the error viewer's checkboxes are outside it. A listener that falls
  through wrongly: each page's field case (preservation) fails if the root binding does not reach
  the page's fields. A broken IME commit in onboarding's name field: Inference 5, C6.

## Assumptions

### Facts (verified at `85c4d20f` by reading the file; #719 changed none of the cited source files, `git diff --stat f32b1e0a 85c4d20f`)

1. `isRepeatOrComposing` is `e.repeat || e.isComposing || e.keyCode === 229`
   (`apps/extension/src/composables/usePopupEntity.ts:5-7`), and `isPopupSubmitKey` is Enter,
   not repeat or composing, targeted at an `HTMLInputElement` or `HTMLTextAreaElement` (`:10-14`),
   with no `defaultPrevented` check; its one production caller is `usePopupEntity`'s own handler
   (`:53-56`).
2. #717's two authwit confirms cancel a repeat or composing Enter at the button
   (`RevokeAuthwitsPopup.vue:250`, `ChangeAuthwitsRegistryPopup.vue:123`), and CLAUDE.md states the
   rule for popups that send or sign (`CLAUDE.md:330`).
3. `create.vue` adds a document keydown at mount (`:94-96`) whose handler calls `handleSubmit` on
   any Enter while not creating (`:90-92`).
4. `OnboardingBackLink` is a `<button type="button">` that routes to `/onboarding/welcome`
   (`onboarding/components/OnboardingBackLink.vue:9`), and `create.vue` renders it first, outside
   its form (`:109`, `:116`); the method tabs are `type="button"` (`:131`, `:143`).
5. `isAllowedToContinue` is true whenever the method is Passkey
   (`composables/useProfileCreateFlow.ts:55-57`), and `handleCreate` returns unless allowed, then
   latches `isCreating` before its first await (`:69-74`).
6. `import.vue`'s document handler runs `decryptBackup`, `restoreBackup` or `completeImport` on
   any Enter, per `resolveFullBackupEnterAction` (`popup/pages/import.vue:146-156`,
   `popup/pages/import-helpers.ts:14-27`); its Back calls `handleBack` (`import.vue:299`), which is
   `clearFormState` (`composables/useProfileImportFlow.ts:308-315`, `:353`).
7. `runRestoreBackup` sets `restoreStatus` to `progress` before its first await
   (`composables/useFullBackupImport.ts:671-681`).
8. "Choose a backup file" is a `SettingItem` in click mode (`components/composite/import/ImportFullBackupForm.vue:34-43`),
   which renders `RowTarget`'s `<button type="button">` (`components/ui/Settings/SettingItem.vue:98`,
   `components/ui/RowTarget.vue:41`).
9. `change-password.vue` calls `handleChangePassword` on any Enter (`:82-84`); that function checks
   only `isAllowedToChange` (`:63`), then sets `isLoading` before its await (`:65-67`), and the CTA
   is disabled while loading (`:221`).
10. `changeProfilePassword` runs under `runExclusive` and throws "Invalid profile old password"
    when the reseal fails (`wallet/services/profile/service.ts:1131-1141`).
11. `seed.vue` installs its document keydown once Agree is pressed (`:78-83`); its handler calls
    `handleUnlock` on any Enter (`:74-76`), which has no latch (`:53-65`); Retrieve is disabled
    only while no password is typed (`:182-186`).
12. `useSecretCountdown`'s `start()` assigns a new `closeTimeout` without clearing the previous one
    (`composables/useSecretCountdown.ts:26-35`); `clear` runs on scope dispose (`:50`).
13. `new-profile-helpers.ts`'s `shouldHandleEnter` checks Enter and an input or textarea target
    only (`popup/pages/profile/new-profile-helpers.ts:53-57`), with no repeat or composition check;
    `makeCreateKeydownHandler` uses it (`:65-69`); `new.vue` binds it at `document` (`:85-94`) and
    opens no shell popup.
14. `full.vue`'s handler returns until agreed, then runs `handleBackup`, `handleEncrypt` or
    `handleDownloadBackup` by stage on any Enter, and does nothing on `progress` or `encrypting`
    (`popup/pages/settings/security/export/full.vue:391-410`).
15. `handleEncrypt` sets `isBusy` before its first await (`full.vue:333-335`), and
    `handleDownloadBackup` returns while `isBusy` or downloading and clears `isDownloading` when
    done (`:369-388`); "Download Backup" is disabled only while no stage, `progress`, `encrypting`
    or downloading (`:653-657`).
16. For a passkey profile, `passkeyPasswordBlocked` hides the recommendation before it refuses an
    empty password (`full.vue:315-318`).
17. `full.test.ts:245-252` pins that an Enter dispatched at `document` at the backup-ready stage
    starts encryption (the assertion at `:250`); `mountPage` mounts detached (`:149-178`).
18. `tests/e2e/backup-roundtrip.test.ts:55-60` clicks Create Backup and dispatches two Enters at
    `document` in one in-page task; by then `backupStatus` is `progress`.
19. The design `Button` renders its tag with no `type` attribute
    (`packages/design/src/ui/Button.vue:99-106`), and `create.vue`'s CTA sits inside its
    `<form @submit.prevent="handleSubmit">` (`:116`, `:192-202`), disabled while not allowed or
    creating (`:196`).
20. `pressOn` focuses, dispatches the keydown and clicks unless it was cancelled
    (`popup/components/popups/RevokeAuthwitsPopup.test.ts:132-142`); a second copy is at
    `ChangeAuthwitsRegistryPopup.test.ts:123`.
21. No `.vue` file under `apps/extension/src/popup/windows/` has a keydown listener or `autofocus`;
    the one `.focus()` is the alias input (`capabilities/AccountSelectRow.vue:45`).
22. The windows' approve handlers return while loading and set loading before their first await:
    `execute/index.vue:480`, `:497`; `capabilities/index.vue:296`, `:316`;
    `discover/index.vue:109`, `:111`. Verify's OK saves one flag and closes, with no latch
    (`verify/index.vue:75-80`, button `:221`).
23. The error viewer: Import opens `data_viewer` (`import.vue:123-128`), which `PopupManager`
    renders in the app shell (`popup/components/popups/PopupManager.vue:322`), outside the page's
    element; `JsonViewer` installs CodeMirror's `searchKeymap` (`components/JsonViewer/JsonViewer.vue:60`);
    the search panel handles Enter in its field with `preventDefault` and `findNext`, without
    stopping propagation, and its options are native checkboxes
    (`apps/extension/node_modules/@codemirror/search/dist/index.js:1137-1142`, `:1078-1083`).
24. `SubPageHeader`'s back calls `router.back()` when `window.history.length > 1`, else
    `router.push(backTo)` (`components/ui/SubPageHeader.vue:33-43`).
25. `DappApprovalFooter`'s confirm is a `Button` with `@click` only
    (`components/composite/DappApprovalFooter.vue:50-60`); execute, capabilities and discover
    render it; its test stubs `Button` as a root `<button>` (`DappApprovalFooter.test.ts:13-17`).
26. `CollapsingHeroLayout`'s template has one root `Flex` (`components/composite/CollapsingHeroLayout.vue:60-61`),
    and `Flex` does not disable attribute fallthrough (`packages/design/src/core/Flex.vue:79`), so a
    listener on the layout lands on the page's root element; the four popup pages and `new.vue`
    render it as their root (`import.vue:170`, `change-password.vue:99`, `seed.vue:94`,
    `full.vue:436`, `new.vue:98`).
27. The design `Input`'s native `<input>` carries no testid; a `data-testid` falls through to its
    root (`packages/design/src/ui/Input.vue:286-302`, no `inheritAttrs`).
28. `vitest.e2e.config.ts` sets `retry: 2` (`:41`); `replaceInputValue` focuses the native input
    it fills (`tests/e2e/fixtures/extension.ts:1363-1372`).

### Inferences (unverified; audits attack these)

1. jsdom performs no native activation or implicit form submission for a synthetic keydown, so a
   page test that dispatches Enter on a button isolates the page's handler; `pressOn`'s explicit
   click stands in for the browser's button activation only. Native form submission and browser
   timing are proven in P3, not in jsdom.
2. On the popup's Back paths (rows 3 and 4) the navigation usually completes before the service
   call resolves, so today's harm is the background action (password changed, phrase decrypted),
   not a visible reveal.
3. In row 2, whether Back also clears the form depends on Vue re-rendering Back as disabled before
   the native click; either way the restore runs.
4. Firefox's focusable scroll area (`follow-ups.md` § ux-feedback: technical) is never where focus
   falls after a stage swap; the body is. If it is, it is inside the root and the guard refuses it.
5. Cancelling a composing Enter keydown in a text field does not undo the IME's commit in Chrome or
   Firefox, since the IME consumed the key first. Not driveable headless here.
6. The recon's double-run counts (rows 3 to 5; Change Password's may not happen, since Vue's
   microtask flush can disable it between the handler and the native click) and "a held Enter on Download downloads per repeat"
   are predictions from reading the code against `lessons.md` § E2E (Chrome activates a button on
   a repeat); Firefox's activation on a repeat is unprobed. P3's Retrieve case observes one of
   them on each browser.

### Asks

- **K1 · owner** · Enter with nothing focused (§ UI asks). Recommendation (a). Confidence:
  moderate. Pictures: § P4 capture list, rows K1. Answered (a), 2026-09-29 (§ P4).
- **C1 · codex · amend, applied.** Codex: prefer native onboarding submission with local
  repeat/composition cancellation; jsdom's limits are no reason for a duplicate production path.
  The document handler goes, the form refuses, P3 proves native submission.
- **C2 · codex · approve.** Keep `isPopupSubmitKey`; no rename, no new layer.
- **C3 · codex · amend, applied.** Share `pressOn`, its doc comment stating its button-simulation
  contract; fields use a plain key dispatch.
- **C4 · codex · reject, applied.** The backup poke goes as keyboard evidence; latch tests stay as
  latch tests; the browser proof uses real keyboard input (P3).
- **C5 · codex · approve.** New profile's copy folds into the shared predicate; its behaviour change
  is row 6.
- **C6 · driver, decided** · Onboarding's form refuses a composing Enter as well as a repeat
  (one helper, one rule), or a repeat only (no keydown cancelled during composition, relying on
  browsers not submitting on a commit)? Decided: both, per Inference 5 (Decision ledger).
  Confidence: moderate.
- **C7 · driver, decided** · `refuseRepeatEnter` as a shared export used by twelve controls,
  against the inline expression? Decided: the export (Decision ledger). Confidence: high.

### Plan audit ledger

- `/codex high` (GPT-6 Astra), session `01a0ede3-147b-7290-b3a7-d0f37b4d8ce6`: **conditional
  approve**, confidence high, conditions: findings 1 to 8.

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| 1 | codex | major | Returning from the document handler does not stop native activation: a held Enter repeats Retrieve and Download, and onboarding's form submits independently | accepted: `refuseRepeatEnter` on every page submit control and on onboarding's form; onboarding's document handler deleted (C1); Outcome 2 now claims only what the guards do; FU-1 reworded to the pointer path it now is |
| 2 | codex | major | A field in a shell popup (the error viewer's CodeMirror search, its checkboxes) still submits Import, since the predicate checks neither ownership nor `defaultPrevented` | accepted: each page's handler bound on its own root instead of `document`, plus a `defaultPrevented` check; a real-CodeMirror regression in `import.test.ts` (search Enter and checkbox Enter, no Continue); Security's control inventory corrected |
| 3 | codex | major | F-6's dismissal leaves the dApp confirms accepting repeat and composing Enter against the written rule | amended: the shared `DappApprovalFooter` confirm gets the refusal and one test; Verify's OK is not edited here, since `connect-window` rewrites that window (FU-2, collision recorded); the focus-transfer scenario stays one ledger line with no torture test |
| 4 | codex | major | The field-positive cases pass today, the re-aimed poke passes vacuously, and `pressOn` proves no native submission or timing | accepted: field cases labelled preservation; the poke's Enters deleted; a smoke file proves onboarding's native submission and a held Enter on Retrieve (one click, `repeat: true` recorded) on both browsers; full backup's Back before export covered; the viewer-search case added |
| 5 | codex | minor | `full.test.ts`'s harness is detached and leaks listeners; Back tests ignore `SubPageHeader`'s history branch | accepted: every mount attached and unmounted in `afterEach`; Back cases assert the navigation their history produces (Fact 24); no same-task click-plus-keypress used as interaction evidence |
| 6 | codex | minor | The browser gate inherits `retry: 2`, and its field selector is structural | accepted: `--retry=0` passed explicitly; the native field gets its own testid through a new `inputTestid` prop; the gate requires the named cases to have run, not skipped |
| 7 | codex | minor | K1 (b) silently weakens the rule; blanket rows have no pictures; "one Tab reaches Protect" is unobserved | accepted: (b) described as an owner-authorized exception; every blanket row pictured (capture or annotated mock) in the P4 list; the Tab frame records where focus lands |
| 8 | codex | minor | Predictions are labelled as Facts; touched comments narrate history | accepted: double-run counts and focus trajectories moved to Inference 6; `new-profile-helpers.ts:59-63`, `new.vue:83-84`, `seed.vue:67-68` and `full.vue:405-406` trimmed; `pressOn`'s comment states its limits |

### Decision ledger

Outline: the single light outline, amended by round 1 (root-bound page handlers, native onboarding
form, button-local refusal). Rejected alternatives: § Trade-offs.

Decided by the driver, 2026-09-29 (a light plan has no final codex pass to take them):

- **C6** · onboarding's form refuses a composing Enter as well as a repeat, through the same one
  helper, as recommended.
- **C7** · `refuseRepeatEnter` is one shared export, as recommended.

Realism, one line each (no fix, no test, no owner question):

- **F-6 · focus carried onto a dApp confirm mid-hold: not realistic as a scenario.** Nothing moves
  focus onto a confirm (Fact 21), a window opened under a held Enter takes the repeats at the body,
  and a held Enter on a confirm the person focused fires once, since each approve latches before
  its first await (Fact 22). The footer guard ships as conformance to CLAUDE.md's rule, with one
  unit test per control and no focus-transfer torture test.
- **A held Enter crossing full export's stages** (seconds of auto-repeat): the repeats land on the
  body once the focused button unrenders, outside the root; no dedicated test.
- **Enter on an inactive method tab in onboarding**, racing the method switch: unreachable, the
  roving tablist keeps focus on the active tab (`create.vue:85`, `:134`, `:146`).
- **Enter on a show-password toggle after a mouse click** (`tabindex="-1"`): realistic, and the
  same `<button>` path as Back; covered by the per-page cases, no dedicated test.
- **Enter on Firefox's focusable scroll area**: does nothing (Inference 4); no test.
- **An IME composition in onboarding's name field**: realistic, but no browser here can drive an
  IME; Inference 5 and C6 carry it, no test.

Disputed points: none.

### Follow-ups

- **FU-1 · Recovery phrase and Change password have no submit latch.** A mouse double-click on
  Retrieve runs `handleUnlock` twice (`seed.vue:53-65`), and the second `countdown.start()` leaves
  a 5-minute close that "keep open" cannot cancel (`useSecretCountdown.ts:26-35`); Change Password
  is disabled while loading (`change-password.vue:221`), so only a same-tick double click reaches
  it twice. `seed.vue` also has no unmount fence (`full.vue`'s `generation` is the pattern), so a
  Retrieve that resolves after the page left sets the phrase on the dead page and arms that timer.
  Out of this plan: after the refusal, only a pointer reaches it twice.
- **FU-2 · Verify's OK accepts a repeat or composing Enter** (`popup/windows/verify/index.vue:221`,
  handler `:75-80`). It neither sends nor signs, so CLAUDE.md's rule does not bind it, but it
  records "Always trust". `connect-window` rewrites this window; it applies `refuseRepeatEnter`
  there when it merges.
- **FU-3 · Two focus rings do not show.** The sub-page back arrow is a bare `<button>`
  (`packages/design/src/ui/SubPageHeaderBase.vue:36-45`) under the base stylesheet's
  `button { outline: none; }` (`packages/design/src/base.css:270-275`), on every page built on
  `SubPageHeader` or `CollapsingHeroLayout`; onboarding's active method tab draws its
  `:focus-visible` outline in `--nulo-accent` over a fill of the same colour (`create.vue:253-261`).
  A keyboard user cannot see that focus sits on Back. Found by the P4 captures; drawing a ring
  changes how those screens look, so it is the owner's call, outside this plan.

## Approval

Approved by the driver, 2026-09-29, on the single light codex audit (conditions folded) and C6
and C7 decided (Decision ledger). **Delivery boundary**: the PR opens and CI runs while K1 and the
blanket sign-off are pending; it does not merge until both answers are quoted in P4.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/keyboard-guards/lessons/phase-N.md`. Unit and component
commands run from `apps/extension`. Every red case is written first and its red run recorded in
the phase's lessons file before the fix.

### P0 · Plan in the tree ✓

Assumptions: none beyond § Assumptions.

1. First commit: `implementations-plan/keyboard-guards/` (`plan.md`, `recon.md`) and one line in
   `implementations-plan/index.md`:
   `- [keyboard-guards](keyboard-guards/plan.md) — active — Enter does what the focused control says on five pages and the dApp confirm`.

**Validation gate.** Commands: `bun run lint`; `bun scripts/ci-cd/plans/check.ts`. Pass: both exit
0. Layers: lint, CI-gating.

### P1 · Shared pieces (the refusal, K-B, the footer, the test helper, the design prop) ✓

Assumptions: Facts 1, 2, 13, 20, 25, 27; C3, C5, C7 as recommended.

1. Move `pressOn` to `apps/extension/tests/helpers/press-key.ts` with its contract comment; both
   authwit popup tests import it; their suites stay green unchanged otherwise.
2. `usePopupEntity.test.ts`: red cases for `refuseRepeatEnter` (a repeat and a composing Enter end
   `defaultPrevented`, a plain Enter does not). Then the export; the two authwit popups use it.
3. `DappApprovalFooter.test.ts`: red case, a repeat and a composing Enter on the confirm through
   `pressOn` emit no `approve`, a plain Enter emits one. Then the refusal.
4. `new-profile-helpers.test.ts`'s `makeCreateKeydownHandler` block: red cases, a composing Enter
   (`isComposing: true`) and a repeat (`repeat: true`) from an input invoke `onSubmit` zero times,
   and a `defaultPrevented` one too. Then the helper on the shared predicate; delete
   `shouldHandleEnter` and its describe block (`:109-133`); `new.vue` binds it on its root.
5. `packages/design/src/ui/Input.test.ts`: `inputTestid` lands on the native `<input>` and the root
   keeps its testid. Then the prop.
6. `bun run build`, then commit the regenerated `src/types/auto-imports.d.ts`.

**Validation gate.** Commands: `bun --bun vitest run src/composables/usePopupEntity.test.ts src/components/composite/DappApprovalFooter.test.ts src/popup/pages/profile/new-profile-helpers.test.ts src/popup/pages/profile/new.test.ts src/popup/components/popups/RevokeAuthwitsPopup.test.ts src/popup/components/popups/ChangeAuthwitsRegistryPopup.test.ts`;
`bun run --cwd packages/design test`; `bun run lint`; `bun run typecheck:all`; `bun run build`, then
`git status --short apps/extension/src/types/` shows nothing uncommitted. Pass: all exit 0, each red
case recorded red first. Layers: lint, typecheck, unit, component, build.

### P2 · The five pages (K-A) ✓

Assumptions: Facts 3 to 19, 23, 24, 26; Inference 1; K1 built as (a); C1 as applied.

Per page: the red cases first (mounted with `attachTo: document.body`, unmounted in `afterEach`,
buttons pressed through `pressOn`, fields through a plain keydown; each asserts the control's own
action ran and the page action did not), then the guard, then the preservation case (Enter in a
field runs the page action once; green before and after, labelled so):

1. `onboarding/pages/create.test.ts`: mount the real `OnboardingBackLink` (drop its stub); valid
   password pair; Enter on `onboarding-create-back` routes to `/onboarding/welcome` and calls no
   `createProfile`; Enter on the active method tab calls none. Refusal: a repeat Enter keydown in
   the confirm field is cancelled (`dispatchEvent` returns false). The field's native submission
   is P3's.
2. `popup/pages/import.test.ts` (new): `useProfileImportFlow` mocked to a decrypted password-type
   selection with valid passwords; Enter on Back calls `handleBack` and not `restoreBackup`; in the
   finished-with-errors state Enter on `import-full-backup-view-errors-btn` calls
   `showRestoreErrorLog` and not `completeImport`, and a repeat Enter on
   `import-full-backup-continue-btn` calls nothing; the error-viewer case (§ Non-obvious
   mechanics). Preservation: Enter in a field calls `restoreBackup` once.
3. `settings/security/change-password.test.ts` (new): `ProfileServiceClient` mocked; valid fields;
   the real `CollapsingHeroLayout` with the router mocked; Enter on `subpage-back` navigates
   (Fact 24) and calls no `changeProfilePassword`; Enter on `change-password-submit-btn` calls it
   once, not twice; a repeat Enter on it calls none. Preservation: Enter in
   `new-password-repeat-input`'s field calls it once.
4. `settings/security/export/seed.test.ts` (new): `managers.profile.exportMnemonic` mocked; agreed,
   password typed; Enter on `subpage-back` navigates and calls no `exportMnemonic`; Enter on
   `unlock-submit-btn` calls it once, not twice; a repeat Enter on it calls none. Preservation:
   Enter in `unlock-password-input`'s field calls it once.
5. `export/full.test.ts`: agreed, password typed, before export: Enter on the back arrow calls no
   `exportBackupMaterial`. At the backup-ready stage (password profile): Enter on
   `download-backup-btn` downloads and calls no `EncryptionKey.getPasshash`; a repeat Enter on it
   downloads nothing. The latch tests rewritten (§ Non-obvious mechanics). Every mount attached
   and unmounted.
6. The guards and refusals in each page (§ Proposed architecture), with explicit imports; the
   comment trims in the change map. No comment beside an obvious guard.
7. CLAUDE.md § Keyboard & focus order, one bullet after `:330`: "**A page's Enter shortcut answers
   only a field of that page:** it listens on the page's root, not `document`, returns unless
   `isPopupSubmitKey` holds and no child handled the key, and each control it names ignores a
   repeat or composing Enter (`refuseRepeatEnter`). A focused button, link or tab keeps its own
   activation."

**Validation gate.** Commands: `bun --bun vitest run src/onboarding/pages/create.test.ts src/popup/pages/import.test.ts src/popup/pages/settings/security/change-password.test.ts src/popup/pages/settings/security/export/seed.test.ts src/popup/pages/settings/security/export/full.test.ts src/popup/pages/settings/security/export/full-passkey.pins.test.ts`;
`bun run lint`; `bun run typecheck:all`; `bun run test:all`; `bun run test:ci-gating`;
`bun run build`, then `git status --short apps/extension/src/types/` shows nothing. Pass: all exit
0, each page's red runs recorded, Outcome criteria 1 and 2 each proven by a named case. Layers:
lint, typecheck, unit, component, CI-gating, build.

### P3 · Browser proof ✓

Assumptions: Facts 18, 28; Inferences 1, 6; C4 as applied.

1. `backup-roundtrip.test.ts:49-60`: the two document Enters and the poke comment go; the
   Create Backup click stays (by `clickByTestId`).
2. `tests/e2e/keyboard-guards.test.ts` (new smoke file, testid selectors only, the recorder of
   § Non-obvious mechanics). Record the red run on Chrome first.
   - "a held Enter on Retrieve retrieves once" (`registeredExtension`): Security → Export →
     Recovery phrase, Agree, fill `unlock-password-input` with a wrong password, focus
     `unlock-submit-btn` (`waitForFocus`), `keyboard.down("Enter")` twice, `keyboard.up`. Asserts
     the recorded Enters are `[{ on: "unlock-submit-btn", repeat: false }, { on: "unlock-submit-btn", repeat: true }]`
     and one click on the button; then the right password and one Enter show `reveal-content`.
     As built: a failed retrieval leaves Retrieve on the page, while with the right password
     Firefox reveals the phrase before the repeat lands (`lessons/phase-3.md`). Red on `85c4d20f`
     on Chrome and Firefox (two clicks).
   - "Enter in the confirm field creates the wallet once" (`freshExtensionPerTest`): Welcome →
     Create, fill both password fields, focus `onboarding-password-confirm-input`, the same held
     Enter. Asserts the recorded Enters on that testid with `repeat` false then true, one click on
     `onboarding-submit-create`, the hash reaches `#/onboarding/learn`, and `readProfileNames` is
     `["Main"]`. As built: implicit submission clicks the default button, whose handler disables
     it before its activation runs, so no `submit` fires. Red on `85c4d20f` too, not green before
     and after: the document handler created the wallet and the native path never ran.
3. Smoke, each browser in turn:
   `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:<b>`,
   then `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e` (`<b>` = `chrome`,
   then `firefox`).
4. Flake bar, per browser, three consecutive runs:
   `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e tests/e2e/keyboard-guards.test.ts tests/e2e/backup-roundtrip.test.ts --retry=0 --reporter=verbose`.
5. `bun run e2e:reap`.

**Validation gate.** Commands: the above. Pass: smoke green on both browsers with its pass and
skip counts recorded; in each of the three retry-0 runs per browser, the verbose output lists both
`keyboard-guards` cases and `backup-roundtrip` as passed, none skipped. Layers: e2e (smoke).

### P4 · The owner's sign-off ✓

1. Build K1 (b) on a local capture-only commit (a `document` listener in `full.vue` and
   `import.vue` that runs the stage's action only for an Enter targeted at `document.body`), take
   its captures, then drop the commit; it is never pushed.
2. One page for the owner: K1 with both options' pictures, and the blanket sign-off for rows 1 to
   7, each row pictured. Capture list (popup at its real size, Chrome, dark theme):

   | Option / row | State | Browser | Theme |
   |---|---|---|---|
   | K1 (a) | full export, backup-ready, nothing focused: before Enter, after Enter, after one Tab (focus ring wherever it lands) | Chrome | dark |
   | K1 (b) | full export, backup-ready, nothing focused: before Enter, after Enter ("Encrypting…") | Chrome | dark |
   | K1 (a) | import, finished with errors, nothing focused: before Enter, after Enter (errors still offered) | Chrome | dark |
   | K1 (b) | import, finished with errors, nothing focused: before Enter, after Enter (Home) | Chrome | dark |
   | Row 1 | onboarding Create, valid pair: focus ring on Back, then after Enter (Welcome); focus ring on the Passkey tab, then after Enter (unchanged, no prompt) | Chrome | dark |
   | Row 2 | import finished with errors: focus ring on View Errors, then after Enter (viewer open over Import); viewer search with a term, then after Enter (next match highlighted, still Import) | Chrome | dark |
   | Row 3 | change password, valid fields: focus ring on the back arrow, then after Enter (Profile settings, no toast) | Chrome | dark |
   | Row 4 | recovery phrase, password typed: focus ring on the back arrow, then after Enter (Export); focus ring on Retrieve, then after a held Enter (phrase shown, annotated "one retrieval") | Chrome | dark |
   | Row 5 | full export, backup-ready: focus ring on Download Backup, then after Enter (download toast, still backup-ready) | Chrome | dark |
   | Row 6 | New profile name field mid-composition, then after the composing Enter (page unchanged): annotated interaction mock at real size and font | mock | dark |
   | Row 7 | execute window with focus ring on Confirm: before, and after a held Enter carried onto it (still pending): annotated interaction mock; a fresh Enter approving: built capture | mock + Chrome | dark |

3. Record the answers here. If the owner picks (b): a new phase adds the body-targeted `document`
   listener to `full.vue` and `import.vue`, restores `full.test.ts`'s body-Enter encryption case,
   and re-runs P2's and P3's gates.

Answers, the owner, 2026-09-29, in chat with the driver:

- **K1**: "(a) Nothing until Tab (Recommended)", picked from the two options. (a) is what is
  built, so nothing changes.
- **Blanket sign-off, UI impact rows 1 to 7**: "sign off rows 1 to 7 as built sir!". The sign-off
  page (https://claude.ai/artifact/XzufunDBKoP5zBWQfcMYz3) records the same answer: `answers/rows`
  is `signed`, at 21:37 UTC.
- **FU-3**, the two focus rings the captures found, is not part of this PR. It stays in
  `follow-ups.md`.

**Validation gate.** The delivery boundary (§ Approval): both answers quoted here before merge.

## Post-implementation (read by the implementing session)

`/code-review` is off. The review loop is `/codex high` (GPT-6 Astra) over the whole diff
(`dev...HEAD`), after P3 is green and before any PR:

1. **Codex audit**: the diff, this plan and its decision ledger, the adversarial ask ("What could
   go wrong? What would an attacker target? What are we trusting that we shouldn't? Where are the
   supply-chain / crypto / least-privilege weaknesses?"), and these two rules, verbatim in the
   first prompt and in every resumed one:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative
     abstractions, extra configuration surface, new layers, or rewrites — the smallest change
     that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop**: verify each finding against the code before acting (codex can misread it); apply
   the accepted ones, commit each fix separately, log the round (consult and verdict) in
   `lessons/post-impl.md`, then resume the same codex session with the fix diff and ask for a
   re-review. Repeat until a round has no new material finding; rejected nitpicks do not count.
   Still material after three rounds: stop and surface it to the owner.
3. Codex is advisory: it cannot override the owner's answers, CLAUDE.md or this scope.
4. **Delivery** (below), the first time a PR is opened.

## Delivery

- Single arc (P0 to P4), one branch `fix/keyboard-guards`, one PR off `dev`, plain
  `gh pr create` after the loop converges; then `gh pr checks --watch`. `/code-review`: off.
- Title: `fix(keyboard): enter does what the focused control says, once` (≤ 93 characters).
- Commits: conventional, lower-case, signed; at least one per phase, fixes separate.
- PR body: summary, the UI impact table, K1 and the blanket sign-off as pending (or the owner's
  answers), the red-before-green evidence per page and control, smoke counts per browser and the
  flake-bar runs, the F-6 ledger line.
- Collisions: `connect-window` edits `popup/windows/discover/index.vue` (which renders
  `DappApprovalFooter`, props unchanged here) and `verify/index.vue` (not edited here; FU-2);
  `DappApprovalFooter.vue` is this plan's alone. `copy-polish` may touch `import.vue:79`, and
  `backup-import` may edit `import.vue` outside `:146-170`: rebase on whichever merges first and
  re-run `import.test.ts`.
- Before delivery, reconcile `implementations-plan/follow-ups.md` and `index.md` against trunk
  (`fix/send-amount-exact` and the other wave-2 plans edit other sections of `follow-ups.md`).
- Merge: by the driver under the owner's standing authorization, once every required check is
  green on the head, K1 and the blanket sign-off are quoted in P4, and the codex loop converged.
  Never `--admin`.
- Closing the plan, in the same PR: the `## Outcome` block, lessons promoted, F-3 and F-6 deleted
  from `follow-ups.md` § Wallet safety, FU-1 and FU-2 added.

## Seeds

Live since the approval, 2026-09-29.

Recommended, `/goal`:

```
/goal Deliver implementations-plan/keyboard-guards/plan.md. Done when the transcript shows every phase P0 to P3 ✓ in plan.md with its validation gate reported passing, each page's and control's red run recorded before its guard, LESSONS_FILE=implementations-plan/keyboard-guards/lessons/phase-N.md printed per phase, smoke green on Chrome and Firefox with counts, keyboard-guards.test.ts and backup-roundtrip.test.ts passed 3 of 3 per browser with --retry=0 and neither skipped, a resumed /codex high pass quoted with no new material findings, and gh pr view showing the one PR off dev created after that pass; bun run test:all and bun run lint both exit 0 in the transcript. /code-review is off and was not run. Merge only after K1 and the blanket sign-off are quoted in P4. UI questions go to the owner, technical ones to /codex high.
```

Fallback, `/loop 15m`:

```
/loop 15m Drive implementations-plan/keyboard-guards/plan.md forward. Never idle. Each firing: read plan.md and lessons/ (stop if the plan has an Outcome block or moved to archive/); git status, git log --oneline -5; take the next unchecked step; write its failing case first and record the red run; after each edit run bun run lint and the phase's vitest command from apps/extension; commit and push the branch. A technical decision: /codex high, logged in lessons/. A UI question: hold it for the owner. Phase gate green: paste it, mark ✓, print LESSONS_FILE. One e2e run at a time, --retry=0 for the flake bar; bun run e2e:reap after the last. All of P0 to P3 ✓: the Post-implementation loop, then gh pr create and gh pr checks --watch, then the P4 page for the owner. Merge only with K1 and the blanket sign-off quoted in P4, every required check green and the loop converged; never --admin; hard limits stay hard.
```

Use exactly one per session.
