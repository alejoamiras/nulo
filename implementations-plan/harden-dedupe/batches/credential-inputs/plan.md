---
plan: harden-dedupe / credential-inputs (arc 23 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/23-credential-inputs, stacked on harden-dedupe
---

# credential-inputs: one show/hide toggle, one new-password pair, one shake, one name field

Findings Q-08 (a, b, c) and Q-14 (c), from `audit/quality/2026-09-30-dedup-high/`. The wallet's password, recovery-phrase and profile-name fields hand-roll the same controls: 8 show/hide buttons, 4 new-password pairs, 7 copies of one shake keyframe, 3 profile-name fields. This batch states each once. No attribute, label, focus, Tab stop, Enter path, value flow or pixel changes on any host. Paths are under `apps/extension/src/` unless they start with `packages/` or `tests/`.

## Outcome & Quality Bar

- **For whom:** the next person who touches a credential field. Today, revisiting the owner-accepted `tabindex="-1"` trade-off, adding `aria-pressed`, or answering owner call 4 (autocomplete) means 8 to 11 edits on the wallet's most sensitive screens, and the autocomplete drift shows the copies already disagree.
- **Excellent:**
  - The toggle's markup, `type="button"`, `tabindex="-1"` and CSS live in one component; the shake keyframe in one CSS module; the pair's two inputs, hint row and shared mask in one component; the name field's input, shake and alert in one component.
  - Every site keeps its own attribute set, proven by host-level characterization written against today's code and frozen before the refactor.
  - Every touched host is pixel-identical in every state the change reaches, on Chrome and Firefox, dark and light, plus a computed-style and attribute probe on both real builds.
- **Good enough:** a state the offline harness cannot stage keeps its current code and is listed under Deferred.

## Architecture & Implementation

Every line below was read on `harden-dedupe` at `2adab99d`.

### The four shared pieces (all new, L3, under `components/composite/`)

Each host imports them explicitly: vitest resolves no components, and host tests must render them.

1. **`PasswordVisibilityToggle.vue`.** Plain props and emit, no `defineModel`: `hidden` (Boolean, required) and `subject` (String, default `"password"`), emitting `update:hidden` with `!hidden`. It renders today's button byte for byte: `type="button"`, `tabindex="-1"`, `aria-label` = `Show <subject>` / `Hide <subject>`, `MaterialIcon` `visibility` / `visibility_off` at size 18, colour secondary, and the `.visibility_btn` rule (`display:flex`, centred, transparent, no border, `cursor:pointer`, `padding: 4px 0 4px 8px`). The state stays in the host, because four hosts drive several fields from one flag. A one-line TSDoc carries the invariant: the toggle stays out of the Tab order by owner decision (CLAUDE.md § Keyboard & focus order).
2. **`NewPasswordFields.vue`.** It renders today's `Flex direction="column" gap="12"`:
   - First `Input`: suffix = the toggle; `#bottom` = today's hint row (lock icon at 12, tertiary `Text` 12/600, `.hint_row { margin-top: 4px }`).
   - Second `Input`: no suffix.
   - Default slot after the second field.

   Props (plain, no `defineModel`): `password`, `repeatedPassword`, `hidden`, `hint`, `maxLength`, `passwordTestid`, `repeatTestid`, `passwordPlaceholder`, `repeatPlaceholder` (all required); `autocomplete` (default `undefined`, which omits the attribute exactly as today); `autofocus` (default `false`). Emits `update:password`, `update:repeatedPassword`, `update:hidden` and `input`. Each field binds `@input="emit('input', $event)"` on its `Input`, where it lands on the `Input` root as a native listener, as today, since `Input` declares no `input` emit. The hint stays computed by each host from its own source, so no equivalence claim is needed between `newPasswordHint` and `strengthHint`.
3. **`shake.module.css`.** It holds today's `@keyframes shakeInput` (`0 / -4px / 4px / -3px / 2px / 0`) once, with two role classes at today's durations:
   - `.shake_password { animation: shakeInput 0.3s ease }`, used by the four password-error sites;
   - `.shake_name { animation: shakeInput 0.4s ease }`, used by the name field.

   The duration split is exactly the role split today, so the program's "shake durations kept" call survives as a one-line edit. Each consumer's local `.shake` becomes `composes: <class> from "<relative path>"`, the repo's convention. Its rule holds only `composes`, and nothing else on the wrapper sets `animation`, so the composed copy that every chunk re-injects cannot reorder anything (the visual-shells-b cascade rule).
4. **`ProfileNameField.vue`.** A two-root fragment: today's shake `div` wrapping the `Input`, then the alert `Text`. It is `OnboardingProfileNameField`'s script minus the label, with `testid` as a required prop:
   - props `modelValue`, `error`, `shake`;
   - emits `update:modelValue` and `input`, re-emitted as the onboarding copy does today;
   - `defineExpose({ focus })`.

   The `Input` keeps `type="text"`, `placeholder="My Profile"`, `:maxLength="32"`, `sanitize`, `:error="!!error"` and `:ariaInvalid="!!error"`; the alert keeps `size="12" color="red" height="150" role="alert"`. Hosts keep their container and label, whose layout differs per shell. The fragment's two roots land as the container's last two children, as today.

### Sites

**Toggles (Q-08 a):**

| host | toggle lines | state | fields it drives | `subject` |
|---|---|---|---|---|
| `components/composite/import/ImportSecretForm.vue` | 43-56 | `hideCredentials` :22 | seed | recovery phrase |
| same | 78-91 (into the pair) | `isPasswordType` :21 | password, confirm | password |
| `components/composite/import/ImportFullBackupForm.vue` | 113-126 | `isDecryptionPasswordType` :32 | decrypt | password |
| same | 141-154 (into the pair) | `isPasswordType` :31 | password, confirm | password |
| `popup/components/modules/settings/new-profile/NewProfileCredentials.vue` | 30-44 (into the pair) | `isPasswordType` :15 | password, confirm | password |
| `popup/pages/auth.vue` | 264-278 | `isPasswordType` :51 | unlock password | password |
| `popup/pages/settings/security/change-password.vue` | 129-143 | `isPasswordType` :38 | current, new, repeat | password |
| same | 171-185 (into the pair) | same flag | current, new, repeat | password |

The five `.visibility_btn` rules go: ImportSecretForm :145-153, ImportFullBackupForm :189-197, NewProfileCredentials :80-88, auth :392-402, change-password :266-274. The seed and decrypt `Input`s and auth's unlock `Input` stay inline; only their suffix changes. That keeps auth's `ref="passwordInput"` (focused in `onMounted`, :202), its `autocapitalize="none"` and `autocorrect="off"`, and the decrypt field's `autofocus` where they are.

**New-password pairs (Q-08 b):** each site's per-field values pass through unchanged.

| host | lines | testids | placeholders | `autocomplete` | `autofocus` | `@input` | hint source | slot |
|---|---|---|---|---|---|---|---|---|
| ImportSecretForm | 68-108 | `import-password-input`, `import-password-confirm-input` | Enter new password / Repeat password | `new-password` | no | `emit('passwordInput')` | `newPasswordHint` :24 | none |
| ImportFullBackupForm | 132-173 | `import-full-backup-password-input`, `…-confirm-input` | Enter new password / Repeat password | absent | no | `emit('passwordInput')` | `newPasswordHint` :35 | the "Create a new password…" `Text` :170-172 |
| NewProfileCredentials | 21-59 | `register-password-input`, `register-password-confirm-input` | Strong password / Repeat password | absent | first field | none | `strengthHint` prop :9 | none |
| change-password | 161-202 | `new-password-input`, `new-password-repeat-input` | Enter new password / Repeat new password | `new-password` | no | `handlePasswordInput` | `newPasswordHint` :57 | none (the unexpected-error `Flex` stays outside, :204-221) |

`maxLength` is 128 at every site. The `.hint_row` rule leaves ImportFullBackupForm :199-201, NewProfileCredentials :90-92 and change-password :276-278; ImportSecretForm keeps its own, used by the seed's "Correct" row (:58).

**Shake (Q-08 c):**

| host | wrapper | keyframes and class | becomes |
|---|---|---|---|
| `components/composite/SecretUnlockSection.vue` (export seed, account and full unlock gate) | :28 | :65-74, 0.3 s | `shake_password` |
| `popup/pages/auth.vue` | :250 | :439-450, 0.3 s | `shake_password` |
| `popup/pages/settings/security/change-password.vue` | :117 | :288-297, 0.3 s | `shake_password` |
| `popup/pages/settings/security/export/full.vue` (passkey encrypt pair) | :577 | :723-732, 0.3 s | `shake_password`, if Phase 0 reaches it; else Deferred |
| `onboarding/components/OnboardingProfileNameField.vue` | :16 | :45-56, 0.4 s | moves into `ProfileNameField` (`shake_name`) |
| `popup/pages/import.vue` | :184 | :352-363, 0.4 s | same |
| `popup/pages/profile/new.vue` | :102 | :180-191, 0.4 s | same |

`popup/components/popups/NewSenderPopup.vue:175-191` is a different animation (own steps, 0.5 s) and stays.

**Profile-name fields (Q-14 c):**

- `OnboardingProfileNameField.vue:13-36` keeps its `Flex gap="8"` and `Text` label, and renders `<ProfileNameField testid="onboarding-name-input">`, re-emitting both events and delegating `focus`. Onboarding create and import still use it unchanged.
- `popup/pages/import.vue:182-201` keeps `div.name_section` and the `span` label; `:184-200` becomes `<ProfileNameField ref="nameInputRef" v-model="profileName" testid="import-name-input" …>`.
- `popup/pages/profile/new.vue:100-119` does the same with `register-name-input`. `section_last` and `section_label` stay, since the passkey block uses them too (:132-133).
- The composable reads only `nameInputRef.value?.focus()` (`composables/useProfileNameField.ts:139`, `:150`), which the exposed `focus` serves. `handleInput` ignores its argument (:157).

### What stays

- Every host's state refs, models, hint computeds, keydown handlers, buttons and the `useProfileNameField` timer (400 ms, matching the 0.4 s class).
- `onboarding/pages/create.vue:146-174`, the fifth new-password pair: it has per-field labels, no toggle, the hint outside, and an `inputTestid`, so folding it in would take a second layout through props. Leaving it out also keeps this arc out of create.vue, which import-shells owns.
- `export/full.vue:570-614`'s encrypt pair: it has a fixed `type="password"`, an error on both fields, click-to-clear, `disabled` and a label. Only its shake CSS is in scope.

### Alternatives not taken

- **A `PasswordInput` wrapping `Input` plus the toggle.** It would have to forward every attribute, both slots and the `focus`/`inputEl` exposure that auth's `onMounted` uses. The toggle alone removes the duplication without moving any `Input`.
- **Keyframes in `@nulo/design`'s `base.css`.** That file is hash-pinned and shared with the landing, and `<style module>` localizes `animation` names anyway.

### Boundary with import-shells (arc 24, Q-14 a/b, planned in parallel)

- **This arc owns:**
  - the name block and the shake CSS in `popup/pages/import.vue` (:182-201, :336-363) and `popup/pages/profile/new.vue` (:100-119, :180-191);
  - `OnboardingProfileNameField.vue`;
  - the four new components;
  - the import forms' credential sections.
- **import-shells owns:**
  - `popup/pages/import.vue`'s destructure, `onKeydown` and CTA ladder (:85-163, :240-320) and `import-helpers.ts`;
  - all of `onboarding/pages/import.vue` and `onboarding/pages/create.vue`, including the tablist and that fifth pair;
  - `NewProfileMethodTabs.vue` and its import and use in `profile/new.vue` (:27, :121).
- The shared files then carry disjoint hunks. This arc lands first, and import-shells rebases mechanically. If import-shells extracts a shared import body that includes the name block, it moves the `<ProfileNameField>` element as is. Both arcs add components, so `src/types/components.d.ts` is regenerated on conflict, never merged by hand.
- No in-review arc (9, 10, 12, 15, 15b, 17, 18, 19, 20, 21, 22) touches any file listed here: their branches were checked against `harden-dedupe`.

## Security & Adversarial Considerations

- **Who reaches these fields.** Only the user, inside extension pages; no dApp or web page can script them. The adversaries are a shoulder-surfer, the browser's password manager and autofill, and a careless future edit. The risks a consolidation could introduce, and what pins each one:
  - **Unmasking.** A toggle holding its own state would desync linked fields. In change-password, revealing "current" would leave "new" masked, or a stale reveal could survive a re-render. The state stays in the host. Characterization pins, per site, the exact set of inputs each toggle flips and the masked default.
  - **A toggle that submits or swallows Enter.** Without `type="button"`, auth's toggle becomes the form's default button: Enter in the password field would click it, revealing the password and submitting. `type="button"` is hard-coded in the component, and auth's characterization proves a toggle click never reaches `unlockProfile`.
  - **Tab order.** `tabindex="-1"` is hard-coded. The pin reads the attribute on every toggle.
  - **Autofill.** `autocomplete` differs per site today (present at 2 pairs and on current-password fields, absent at 2 pairs and the decrypt field). A unifying default would change what a password manager fills into a new-password field. The prop defaults to absent, every pair passes its value explicitly, and the pin reads the native attribute on every field. Unifying it is owner call 4.
  - **Focus theft.** A shared `autofocus` default would move focus from change-password's current field to the new one. The pin checks `document.activeElement` after mount at every host.
  - **Paste and length.** `Input`'s paste interception runs only when `maxLength` is set. The pairs keep 128 and the seed field keeps none (it stays inline). The pin types 129 characters into each pair field.
- **No new copy of a secret.** The new components hold no value: plain props in, events out. They use no `defineModel` (its local fallback ref would be a second copy of a password when unbound), no `watch` and no storage. Values still live only in the host refs that the onboarding pages zero on unmount (`onboarding/pages/create.vue:92-93`, `onboarding/pages/import.vue:127-129`) and in `Input`'s own `text` ref, as today.
- **Logging policy.** The components contain no `console.*`, logger call or string interpolation of a value. The gate greps the four new files for `console.`, `log` and `chrome.` and expects nothing; `log-payload-ban.test.ts` scans them anyway.
- **Copy.** Every aria-label, placeholder, label, alert and hint string stays byte-identical, and the pins read them literally.
- **Layering.** The new files are L3: no service clients, stores or `@/utils/core`. Onboarding and L4 may import L3. No npm-published entry is touched.

## Assumptions

**Facts** (read 2026-10-03 at `2adab99d`):

1. The toggles, pairs, shakes and name fields sit at the lines in the tables above, and the five `.visibility_btn` rules are declaration-identical. auth's copy differs only in blank lines.
2. `Input` (`packages/design/src/ui/Input.vue`):
   - takes `autocomplete`, `autocapitalize`, `autocorrect` and `autofocus` as props (:66-89) and binds them to the native input, with `spellcheck="false"` hard-coded (:291-308);
   - declares no `input` emit (:15), so `@input` on it is a native listener on its root;
   - intercepts paste only when `maxLength` is set (:214-245);
   - renders `#suffix` inside the clickable base (:280-321, slot at :320), whose click focuses the input (:200-202), and renders `#bottom` after it (:323).
3. The four 0.3 s sites are all password errors and the three 0.4 s sites are all profile names (table above). The keyframes are byte-identical in all seven.
4. `useProfileNameField` exposes the ref as `{ focus }` and calls only `focus()` (`composables/useProfileNameField.ts:40`, `:139`, `:150`).
5. Name validation runs only when the user edited the field, and a failure returns `null` before any import or create (`composables/useProfileNameDefault.ts:65-72`, `composables/useProfileImportFlow.ts:176-182`).
6. `detectBackupType` calls any base64 text whose first decoded byte is 0, 13 bytes or longer, `encrypted` (`utils/full-backup-helpers.ts:42-52`). A minimal JSON with `data.profile.type: "password"` shows the new-password section. Both forms are reachable from a fixture file via the e2e driver's `pickFileByTestId`, on both browsers.
7. Vitest resolves no components (`apps/extension/vitest.config.ts` registers only `vue` and `unplugin-auto-import`), so host tests render a child only when it is imported explicitly.
8. The current tests that host these sites stub `Input` differently: `auth.test.ts:80-87` drops all slots, `ImportSecretForm.test.ts:12-22` renders them, and `OnboardingProfileNameField.test.ts` and `popup/pages/import.test.ts` use the real `Input`.

**Inferences:**

- Moving each `@input` from the host onto the same `Input` one component lower keeps the event order: the inner `<input>` emits `update:modelValue` in the target phase, then the root listener runs on bubbling, as today.

**Asks:**

1. **The harness selector for a toggle.** No toggle carries a `data-testid`, and adding one is outside a dedup. The surfaces would click it as `[data-testid="<field root>"] button`, a structural selector scoped under the field's testid, used only in the uncommitted harness. Accept, or require a testid commit first (it would land in both the base and head builds)?
2. **`NewPasswordFields` in scope?** It is the largest of the four pieces, nine required props for four sites, and Q-08 recommends it. The alternative is to ship only the toggle, shake and name field and leave each pair's ~25 lines inline. Recommendation: ship it. Each prop is a value the site states today, and the hint row and shared mask become one place.

## Phases

### Phase 0: harness surfaces and stability (no product code)

Write `surfaces/credential-inputs.ts` in the harness directory, modelled on `visual-shells-b.ts` and `fee-strategies.ts`. Run it with `--stability` on the parent, on both browsers.

**Rules for every surface:**

- Typed values are fixed strings: `TEST_PASSWORD`, one wrong password, the 24-word canonical seed, and a fixed 129-character string.
- Each surface asserts its field counts before and after settling.
- A `probe` records, per field, the native input's `type`, `autocomplete`, `spellcheck`, `autocapitalize`, `autocorrect` and `aria-invalid`.
- The probe also records, per toggle, `type`, `tabindex`, `aria-label`, its box and its computed `display`/`padding`/`background`/`border`/`cursor`, in the masked and revealed states.
- In each error state, the probe records the wrapper's `animation-duration`, `animation-timing-function` and `animation-iteration-count`, plus the resolved `@keyframes` steps with the name stripped. The name is hashed per build.
- The probe records the hint row's `margin-top`, and the active element (by its nearest testid) after a toggle click.

**Leaving a surface:** a surface that created state removes it. The auth surface unlocks with `TEST_PASSWORD`; the error surfaces assert that no profile was added.

| host | route | states |
|---|---|---|
| auth | lock, `#/popup/auth` | empty; typed (masked); revealed; wrong password submitted by Enter in the field (alert, shake end state, field still masked: a toggle that became the form's default button would be clicked by that Enter and reveal it) |
| change-password | `#/popup/settings/security/change-password` | empty; typed with mismatch (masked); revealed (one click flips all three); valid pair (strong hint); wrong current (alert, shake) |
| export seed / account / full | each export page, past its warning | unlock gate empty; typed; wrong password (alert, shake) |
| export full, encrypt pair | a passkey profile (virtual authenticator), backup finished | mismatch (alert, shake). **Spike:** if either browser cannot reach it, `full.vue` keeps its local keyframes and the site moves to Deferred. |
| popup import | `#/popup/import` | name prefilled; name error (field cleared, valid seed and pair, submit); seed: empty, typed, seed revealed, pair revealed, 24 words ("Correct"); full backup: encrypted fixture (decrypt empty, typed, revealed), password fixture (pair empty, typed, revealed, mismatch hint) |
| popup profile/new | `#/popup/profile/new` | name prefilled; name error; pair empty, typed, revealed, valid hint; the passkey tab |
| onboarding import | onboarding tab | name prefilled; name error; the same seed and full-backup states as the popup |
| onboarding create | onboarding tab | name prefilled; name error (its pair is unchanged, but shown) |

**Pass:** the stability run is identical on both browsers and themes.

### Phase 1: pin today's behaviour (tests only, green on the unchanged code)

**Shared assertions.** One helper, `tests/helpers/credential-pins.ts`, holds the shared checks:

- `expectMaskToggle(wrapper, { fieldRoot, labels, drives, others })`:
  - the toggle is inside `fieldRoot`'s base and has `type="button"`, `tabindex="-1"`, the masked aria-label and the `visibility` icon;
  - every `drives` input is `type="password"`;
  - one click flips exactly `drives` to `text` (never `others`), swaps the label and icon, and leaves focus on the field's native input;
  - a second click restores everything.
- `expectNativeAttrs(field, { autocomplete, autocapitalize, autocorrect })`: present or absent, literally.

**Where the pins go,** each in the host's colocated test, with the real `Input` and a `MaterialIcon` stub that renders its `name`:

- **`ImportSecretForm.test.ts`:**
  - both toggles: seed drives {seed}; password drives {password, confirm};
  - the seed field's `autocomplete="off"` and no `maxLength` (a 129-character paste is kept whole);
  - the pair: testids, placeholders, `autocomplete="new-password"` on both, 128 truncation, the hint under the first field for the empty, mismatch and strong inputs, `passwordInput` emitted once per keystroke on each field, nothing focused at mount.
- **`ImportFullBackupForm.test.ts`:**
  - the decrypt section: its toggle drives {decrypt}, it is autofocused at mount, and it has no `autocomplete`;
  - the pair: as above but with `autocomplete` absent on both, and the helper `Text` the next sibling of the confirm root, inside the same column.
- **New `NewProfileCredentials.test.ts`:** the pair with `autocomplete` absent, the first field autofocused, the hint equal to the `strengthHint` prop, no emitted events.
- **`auth.test.ts`,** a new `describe` with its own mount:
  - the toggle drives {unlock}, with `autocomplete="current-password"`, `autocapitalize="none"` and `autocorrect="off"`;
  - with a password typed, a toggle click calls no `unlockProfile` (jsdom submits a form on a submit button's click; it has no implicit Enter submission, which the Phase 0 auth surface covers in real browsers);
  - a wrong password sets the shake class on the input's parent.
- **`change-password.test.ts`:**
  - each of the two toggles drives {current, new, repeat};
  - the current field: `current-password` and autofocused;
  - the pair's attributes, as in ImportSecretForm;
  - typing in new or repeat clears a wrong-current alert;
  - the wrong-current shake class.
- **`SecretUnlockSection.test.ts`:** the shake class follows `error` on the input's parent.
- **Name fields:**
  - in `popup/pages/import.test.ts` (with `nameFieldState` shown) and a new `popup/pages/profile/new.test.ts`, the same block that `OnboardingProfileNameField.test.ts` already pins: root testid, placeholder, `type="text"`, 32-character sanitize, alert and `aria-invalid` with and without an error, the shake class on the input's parent;
  - `nameInputRef.value.focus()` lands on the native input;
  - typing clears the error through `handleNameInput`;
  - the new page test also pins one create on Enter in the repeat field (`makeCreateKeydownHandler`), since that field moves into the pair.

**Unchanged and frozen.** The existing Enter pins (`change-password.test.ts`, `popup/pages/import.test.ts`, `onboarding/pages/create.test.ts`, `onboarding/pages/import.test.ts`) and every other test file stay as they are.

**Mutants, each checked by hand on the Phase 2 code (each must red):**

- drop `type="button"` (auth no-submit pin, attribute pin);
- `tabindex` 0 or removed;
- a swapped or templated label (`Show Password`);
- toggle state moved into the component (change-password and pair linkage);
- default revealed;
- the toggle moved to `#bottom` (focus pin);
- `autocomplete` defaulting to `new-password` (the absent sites), or dropped (the present sites);
- `autofocus` defaulting true (change-password and ImportSecretForm focus);
- `maxLength` not forwarded (truncation);
- `@input` not re-emitted (`passwordInput` and change-password clearing);
- hint read from the wrong field;
- the slot dropped (the helper `Text`);
- `ProfileNameField` without `sanitize` or `maxLength`, without its exposed `focus`, or with the alert outside the fragment.

Durations and keyframes are CSS that jsdom does not compute: the Phase 0 probe owns them. The forced-diff check runs the harness against a throwaway head with `shake_password` at 0.35 s, and the probe must red.

### Phase 2: the refactor, with every Phase 1 file frozen

Three commits:

1. `shake.module.css` and the four 0.3 s consumers.
2. `PasswordVisibilityToggle` and `NewPasswordFields` across the five hosts.
3. `ProfileNameField` across the three hosts, deleting their keyframes.

Each new component gets a colocated test meeting CLAUDE.md's L3 minimum (ten cases, mostly table rows) written against the component itself. Then `bun run build` regenerates `src/types/components.d.ts`, and that diff is inspected and committed.

**Validation gate (after each phase):**

- **Commands:** `bash <scratch>/hd/gates.sh <worktree> <logdir>` (it runs `bun run lint`, `typecheck:all`, `test:all`, `test:ci-gating` and `audit:vue`), plus `bun run lint:actions`. `bun run --cwd apps/extension test:components` runs after each Phase 2 commit.
- **Pass criteria:**
  - every command exits 0;
  - in Phase 2, `git diff --stat <phase-1 tip>` lists no Phase 1 test file;
  - the grep of the four new files for `console.`, `log` and `chrome.` returns nothing;
  - no new complexity acceptance.
- **Screenshots:**
  - `run.ts --batch credential-inputs --base <parent> --head <head> --browsers chrome,firefox` reports every shot and probe identical, then again with `--stability`;
  - each `report.md` is copied into the scratch directory before the stability run overwrites it;
  - the harness holds a lock, so a run that finds it taken waits and retries.
- **Layers:** lint, typecheck, unit and component, visual and probe; the five CI lanes per the program gates.

## Post-implementation

1. **Plan audit first** (the driver's): Codex xhigh plus an independent Opus panelist; the reconciled findings land under Decisions before building.
2. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks. Name the threat list above (unmasking, default button, Tab order, autofill, focus, paste, secret copies, logging). Include the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact.").
3. **Fix loop:** triage, fix, commit, log each round in `lessons/arc-23-credential-inputs.md`. Stop at a round with no material finding; at 5 rounds, park the arc.
4. **Delivery:** push, open a ready PR in the gh stack on `harden-dedupe`, then add both e2e labels. Attach the harness report as the screenshot artifact. Squash-merge into `harden-dedupe` when the program gates are green.
5. **Close-out** is the program's: this plan closes with the program plan.

## Delivery

One arc, `hd/23-credential-inputs`, stacked on `harden-dedupe`; it lands before import-shells. Code review: off.

## UI impact

None by design. The surfaces are onboarding import and create, popup import, profile/new, auth (unlock), change password, and the export seed, account and full unlock gate, plus the passkey encrypt pair if Phase 0 reaches it. Every state in the Phase 0 table must be pixel-identical on Chrome and Firefox in both themes, with identical attribute and computed-style probes. Any non-zero diff is a refactor bug, so the arc needs no owner sign-off.

## Drift left for the alignment arc

- **Owner call 4:** `autocomplete="new-password"` is absent from ImportFullBackupForm's and NewProfileCredentials' pairs (`ImportFullBackupForm.vue:133-169`, `NewProfileCredentials.vue:22-58`).
- **No `autocomplete` on the decrypt field** (`ImportFullBackupForm.vue:106-112`), and none on export full's encrypt pair (`export/full.vue:578-602`). The decrypt field holds a backup's password, not the profile's. New; for the owner page.
- **Owner call 5:** reduced motion on the shake. The 0.3 s / 0.4 s split is kept, with no call.
- **The toggle announces its state by swapping its label, with no `aria-pressed`.** Kept.
- **`autocapitalize="none"` and `autocorrect="off"` exist only on auth's unlock field.** The other credential fields omit them; `spellcheck="false"` is universal through `Input`.
- **The fifth pair** (`onboarding/pages/create.vue:146-174`) has no toggle and puts its hint outside the pair. Copy and layout, kept.
- **The pair placeholders differ per site** ("Strong password" against "Enter new password"; "Repeat password" against "Repeat new password"). Copy, kept.
- **The onboarding name label is a `Text`; the popup's is a `span` with its own rule.** Per shell, kept.

## Deferred

- `NewSenderPopup.vue`'s shake: a different animation, not a copy.
- `export/full.vue`'s encrypt-pair shake, only if Phase 0 cannot stage it on both browsers.

## Decisions (delegated)
