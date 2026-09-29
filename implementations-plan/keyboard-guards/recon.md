# Recon · keyboard-guards

Read against `48a97f4a` (the head of #718, the same tree as `f32b1e0a`), 2026-09-29, and rebased to
`85c4d20f` (`dev` after #719): `git diff --stat f32b1e0a 85c4d20f` touches none of the source or
test files cited here, only e2e fixtures and helpers this plan does not use, `follow-ups.md` and
`lessons.md` (whose § E2E repeat lesson is unchanged). Every row was read in the file it cites.
The planner ran `bun --bun vitest run src/popup/pages/settings/security/export/full.test.ts` from
`apps/extension` once, 7 of 7 green (not independently reproduced by the audit).

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| "Enter in a field means submit", refusing a repeat or composing Enter | `isPopupSubmitKey` (`apps/extension/src/composables/usePopupEntity.ts:10-14`) over `isRepeatOrComposing` (`:5-7`); predicate tests at `usePopupEntity.test.ts:41-49` and `:106-108` | **reuse-as-is**, plus a `defaultPrevented` check at each page guard (not in the predicate: its 13 form-popup users are #717's). Imported explicitly: the unit vitest does not auto-import composables (lessons.md § CI & gates) |
| A control that ignores a repeat or composing Enter landing on it | `@keydown.enter="isRepeatOrComposing($event) && $event.preventDefault()"` (`RevokeAuthwitsPopup.vue:250`, `ChangeAuthwitsRegistryPopup.vue:123`) | **adapt**: one export, `refuseRepeatEnter`, beside `isRepeatOrComposing`; ten new bindings plus the two existing make twelve, past the three-copies rule |
| Scoping a page's Enter to its own fields | the page's root: every page here renders `CollapsingHeroLayout` (one root `Flex`, `components/composite/CollapsingHeroLayout.vue:60-61`; `Flex` keeps attribute fallthrough, `packages/design/src/core/Flex.vue:79`), except onboarding, which has a `<form>` (`onboarding/pages/create.vue:116`) | **reuse-as-is**: the handler binds on the layout; shell popups (`PopupManager.vue:322`) render outside it |
| The same predicate, copied without the repeat and composition refusal | `shouldHandleEnter` (`apps/extension/src/popup/pages/profile/new-profile-helpers.ts:53-57`), used by `makeCreateKeydownHandler` (`:65-69`), tested at `new-profile-helpers.test.ts:109-133` | **adapt**: `makeCreateKeydownHandler` calls `isPopupSubmitKey` and checks `defaultPrevented`; `shouldHandleEnter` and its five predicate tests go; three wiring cases (composing, repeat, handled) |
| A test that presses a key on a focused button as a browser would (keydown, then the click unless cancelled) | `pressOn` (`apps/extension/src/popup/components/popups/RevokeAuthwitsPopup.test.ts:132-142`), a second copy at `ChangeAuthwitsRegistryPopup.test.ts:123` | **adapt**: moved to `apps/extension/tests/helpers/press-key.ts` (the unit helpers' home: `tests/helpers/chrome-storage-mock.ts`, imported by `src/utils/storage.test.ts:3`); its comment states it simulates button activation only, never native form submission or browser timing; field cases use a plain keydown |
| A mounted page harness for onboarding Create | `mountCreate` (`apps/extension/src/onboarding/pages/create.test.ts:28-47`), attached to `document.body`, `OnboardingBackLink` stubbed at `:38` | **adapt**: the Back case mounts the real `OnboardingBackLink` (a plain `<button type="button">`, `onboarding/components/OnboardingBackLink.vue:9`) |
| A mounted page harness for full export, with a real assembler and a KDF deferred | `mountPage`, `reachUnlockAndSubmit`, `deferred` (`export/full.test.ts:16-25`, `:149-190`) | **adapt**: `mountPage` mounts detached (`:149`), the unlock stub disappears after the helper awaits (`:182-186`), and most tests never unmount; every mount attaches to `document.body` and unmounts in `afterEach`. The two latch tests (`:205-258`) are rewritten as latch evidence (plan § Non-obvious mechanics) |
| Page harnesses for popup Import, Change password and Recovery phrase | none: `popup/pages/` has `import-helpers.test.ts` only; `settings/security/` has no test; `export/` has `full.test.ts` and `full-passkey.pins.test.ts`. Searched `rg --files apps/extension/src -g '*import*.test.ts' -g '*change-password*' -g 'seed*.test.ts'` | **build new**: three colocated files, each mocking its one service seam (`useProfileImportFlow`, `ProfileServiceClient`, `managers.profile.exportMnemonic`) the way `create.test.ts:5-19` and `full.test.ts:27-60` do |
| A real nested field to prove Import's scoping | `JsonViewer` (`components/JsonViewer/JsonViewer.vue:60`, CodeMirror `searchKeymap`), the search panel's Enter handler (`apps/extension/node_modules/@codemirror/search/dist/index.js:1137-1142`) and its native checkboxes (`:1078-1083`) | **reuse-as-is** in `import.test.ts`, mounted in its own `createApp` outside the page |
| Back navigation under test | `SubPageHeader.handleBack` (`components/ui/SubPageHeader.vue:33-43`): `router.back()` with history, else `router.push(backTo)` | **reuse-as-is**; Back cases assert the branch their history takes |
| A browser recorder of a key's target and `repeat` | `recordEnterKeydowns` (`tests/e2e/network/popup-escape-layered.test.ts:93-108`), in the network suite | **adapt** by pattern, not import: the new smoke file records clicks and submits too, and importing from `network/` would pull the network lane in; one copy each, different shapes |
| A native-field testid for the smoke case | none: `@nulo/design`'s `Input` gives its root the testid and its `<input>` none (`packages/design/src/ui/Input.vue:286-302`) | **build new**: an optional `inputTestid` prop, one case in `Input.test.ts` |
| The rule, stated where contributors read it | CLAUDE.md § Keyboard & focus order, last bullet (`CLAUDE.md:330`) | **adapt**: one more bullet for pages |
| A browser proof of full export's double-fire | `tests/e2e/backup-roundtrip.test.ts:49-60`: one in-page task clicks Create Backup and dispatches two `keydown` Enters at `document`; by then the status is `progress`, whose case does nothing (`full.vue:403-406`), so the poke proves the switch, not a latch | **delete** the two Enters and the comment (codex Ask C4); the click and the round trip stay |

## Inventory: what an Enter does today on each page's other controls

Every handler below listens on `document`, so a keydown on any focused element, in the page or in
a shell popup over it, reaches it, and a focused button then runs its own click as well (native
activation, which the handler does not cancel). The double-run counts are predictions from reading
the code against `lessons.md` § E2E (Chrome activates a button on a repeat; Firefox unprobed), not
browser observations (plan Inference 6).

| Page | Handler | Other controls a keyboard user reaches, and what Enter on them does today |
|---|---|---|
| `onboarding/pages/create.vue` | `:90-96`, bare Enter, `isCreating` latch; plus the form's implicit submission (`:116`, default button `:192-202`) | **Back** (`OnboardingBackLink`, `:109`, outside the form): creates the wallet when the password pair is valid or the Passkey method is chosen (`useProfileCreateFlow.ts:55-57`), and routes to Welcome. **Method tab** (the active one, `type="button"`, `:129-152`): creates the same way (passkey: opens the passkey prompt). **Create**: creates once (latched). The inputs: create (intended), through both the handler and the form |
| `popup/pages/import.vue` | `:146-161`, bare Enter, `resolveFullBackupEnterAction` (`import-helpers.ts:14-27`) | Only on the full-backup form. **Back** (`:299`): decrypts the chosen encrypted file, or starts restoring the chosen decrypted one (`runRestoreBackup` flips to `progress` before its first await, `useFullBackupImport.ts:671-681`), besides going back. **Choose a backup file** (a `<button>` row, `ImportFullBackupForm.vue:34-43`, `SettingItem.vue:98`, `RowTarget.vue:41`): same, besides opening the picker. **View Errors** (`:278-285`): runs Continue (`completeImport`, leaving the page) besides opening the log. **The error viewer's search field and its checkboxes** (`import.vue:123-128` opens it in `PopupManager`): Continue, besides finding the next match. **Decrypt** (disabled only without a password, `:239-245`) and **Continue** (never disabled, `:268-275`): a held Enter reruns them (predicted). Show-password toggles (`tabindex="-1"`, `ImportFullBackupForm.vue:90-93`, `:118-121`), reachable after a mouse click: same as Back. The method picker and the seed form: nothing (the resolver returns `null`) |
| `settings/security/change-password.vue` | `:82-88`, bare Enter, no latch (`:63` checks only `isAllowedToChange`) | **Back arrow** (`SubPageHeaderBase.vue:36-43` via `CollapsingHeroLayout.vue:63`): changes the password when the three fields are valid, besides going back. **Change Password** (`:219-225`, disabled while loading): two change requests, handler plus native click (predicted); the profile service runs them in turn (`profile/service.ts:1133`) and the second fails its reseal as "Invalid profile old password" (`:1139-1141`). Show-password toggles (`tabindex="-1"`, `:124-128`, `:166-170`): change the password besides toggling |
| `settings/security/export/seed.vue` | `:74-83`, bare Enter, installed once Agree is pressed | **Back arrow**: retrieves the recovery phrase in the service worker when a password is typed, besides going back. **Retrieve Recovery Phrase** (`:182-190`, disabled only without a password): two retrievals, and one more per repeat under a held Enter (no latch, `:53-65`; predicted), each calling `countdown.start()`, which overwrites the auto-close timer without clearing it (`useSecretCountdown.ts:26-35`), so one 5-minute close survives "keep open". After the reveal (Show, Copy, Close, keep open): nothing more (the password is cleared, `:59`) |
| `settings/security/export/full.vue` | `:391-414`, bare Enter, gated on Agree, per-stage switch | **Back arrow** before export, password typed: starts the backup besides going back. **Download Backup** at `finished` (`:653-660`): starts encryption instead (`handleEncrypt` latches first, `:333-335`; `handleDownloadBackup` then refuses, `:369-370`); for a passkey profile with no password typed it hides the recommendation (`:317`) and downloads the plain file. At `encrypted`, a held Enter on it downloads again whenever the previous download finished (`:369-388`; predicted). **Back arrow** at later stages: runs the stage's action (encrypt or download) besides going back. **Create Backup** / **Protect with Password**: once (latched and disabled). **Read more about backups** (`:457`): nothing (not agreed yet) |

Where focus rests with nothing focused (the body): after a stage swap unmounts the focused control
(full export's `progress` → `finished` → `encrypted`; import's restore → finished-with-errors), an
Enter today runs the next stage's action (predicted trajectory; the body is where Chrome leaves
focus when the focused element is removed). `full.test.ts:245-252` pins that for `finished`.

## The dApp windows' confirms (F-6)

- No window installs a keydown listener: `rg -n 'keydown' apps/extension/src/popup/windows -g '*.vue'`
  returns nothing, and `DappApprovalFooter.vue:46-59` renders plain `Button`s; execute,
  capabilities and discover render that footer.
- No window focuses its confirm: the one `.focus()` is the alias input
  (`capabilities/AccountSelectRow.vue:45`), and `rg -n autofocus apps/extension/src/popup/windows`
  returns nothing.
- Each approve latches before its first await: execute (`execute/index.vue:480`, `:497`),
  capabilities (`capabilities/index.vue:296`, `:316`), discover (`discover/index.vue:109`, `:111`);
  verify's OK only saves the trust flag and closes, with no latch (`verify/index.vue:75-80`,
  button `:221`). The latches exclude concurrent calls; they do not stop a repeat or composing
  Enter from activating an idle confirm, which CLAUDE.md's rule (`CLAUDE.md:330`) forbids for a
  window that sends or signs.

## Conventions to match

- Red before green: each page's and control's failing case lands before its guard, with the red
  run recorded in `lessons/phase-N.md`; cases that pass on `85c4d20f` are labelled preservation.
- Component tests colocated, attached to `document.body` and unmounted in `afterEach`; buttons are
  pressed through `pressOn`, fields through a plain keydown; each case asserts the control's own
  action ran as well as the page action not running (the #717 convention,
  `wallet-safety-fixes/plan.md` ledger row 8).
- Explicit imports in SFCs that unit tests mount (lessons.md § CI & gates); a new auto-imported
  export needs a build before commit (lessons.md § CI & gates).
- Testids verbatim; e2e by `data-testid` only; a held key is recorded with its `repeat` in the page
  (lessons.md § E2E).
- Comments: one sentence of why at the guard, or none; no plan or review references.

## Collision and dedup risks

- **`connect-window`** edits `popup/windows/discover/index.vue` (which renders `DappApprovalFooter`;
  this plan leaves its props alone) and `popup/windows/verify/index.vue` (not edited here; the
  repeat guard on Verify's OK is its FU-2). `DappApprovalFooter.vue` and its test are this plan's
  alone. No shared file.
- **`copy-polish`** rewrites em-dash copy; `popup/pages/import.vue:79` ("Profile imported — unlock to
  continue") is in this plan's file, on a line this plan does not touch. Expect a clean merge.
- **`backup-import`** reworks the full-backup import's network work; if it edits `import.vue` it
  is outside `:146-170` and the CTAs at `:239-285` that gain a refusal. Rebase on whichever merges
  first and re-run `import.test.ts`.
- **`implementations-plan/follow-ups.md`**: this plan deletes two entries in § Wallet safety (F-3,
  F-6) and adds FU-1 and FU-2; #719 edited other sections, and other wave-2 plans do. Reconcile
  against trunk before delivery.
- `src/types/auto-imports.d.ts`: `refuseRepeatEnter` is a new export under `src/composables/`, so
  the build adds two lines; build before committing it. `new-profile-helpers.ts` is outside the
  auto-import dirs (`apps/extension/vite.config.ts:126`).
- `packages/design/src/ui/Input.vue` gains an optional prop; the landing renders no `Input` with it,
  so its output is unchanged.
- `pressOn` moves: the two authwit popup tests change imports only.
