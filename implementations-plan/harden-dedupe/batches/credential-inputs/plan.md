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

# credential-inputs: one show/hide toggle, one shake, one name field

Findings Q-08 (a, c) and Q-14 (c), from `audit/quality/2026-09-30-dedup-high/`. Q-08 (b), the new-password pair, was dropped by the plan audit (see Decisions).

The wallet's password, recovery-phrase and profile-name fields hand-roll the same controls: 8 show/hide buttons, 7 copies of one shake keyframe, and 3 profile-name fields. This batch states each once.

No attribute, label, focus, Tab stop, Enter path, value flow or pixel changes on any host. The one exception is a preparatory commit that adds a `data-testid` to each toggle.

Paths are under `apps/extension/src/` unless they start with `packages/` or `tests/`.

## Outcome & Quality Bar

- **For whom:** the next person who touches a credential field. Today, revisiting the owner-accepted `tabindex="-1"` trade-off, adding `aria-pressed`, or adding reduced motion (owner call 5) means 8 to 11 edits on the wallet's most sensitive screens.
- **Excellent:**
  - The toggle's markup, `type="button"`, `tabindex="-1"` and CSS live in one component.
  - The shake keyframe lives in one CSS module.
  - The name field's input, shake and alert live in one component.
  - Every site keeps its own attribute set and event timing, proven by host-level characterization. That characterization is written against today's code and frozen before the refactor.
  - Every touched host is pixel-identical in every state the change reaches: Chrome and Firefox, dark and light. Attribute and computed-style probes on both real builds back this up.
- **Good enough:** a state the offline harness cannot stage keeps its current code and is listed under Deferred.

## Architecture & Implementation

Every line below was read on `harden-dedupe` at `2adab99d` and re-checked at `eb06c37d`, which changed none of these files.

### Preparatory commit: toggle testids

The 8 toggle buttons carry no `data-testid` today, which breaks CLAUDE.md's testid rule for interactive elements. One commit adds them, named `<field testid>-visibility-toggle`:

- `import-seed-input-visibility-toggle`
- `import-password-input-visibility-toggle`
- `import-full-backup-decrypt-password-input-visibility-toggle`
- `import-full-backup-password-input-visibility-toggle`
- `register-password-input-visibility-toggle`
- `auth-password-input-visibility-toggle`
- `current-password-input-visibility-toggle`
- `new-password-input-visibility-toggle`

An attribute adds no pixels. That commit is shot against its parent on its own, and it is the screenshot base for the refactor commits.

### The three shared pieces (new, L3, under `components/composite/`)

Each host imports them explicitly: vitest resolves no components, and the host tests must render them.

1. **`PasswordVisibilityToggle.vue`.**
   - **Props and event:** a `hidden` prop (Boolean, required), a `subject` prop (String, default `"password"`), and one event, a payload-free `toggle`.
   - **Hosts keep their handlers verbatim:** `@toggle="isPasswordType = !isPasswordType"`, including change-password's single flag for three fields.
     - Why not `update:hidden` with `!hidden`: two activations in one task would both negate the same stale prop.
     - Each host's own negation of its live ref keeps today's semantics.
   - **What it renders, unchanged:**
     - `type="button"` and `tabindex="-1"`;
     - `aria-label` = `Show <subject>` / `Hide <subject>`;
     - `MaterialIcon` `visibility` / `visibility_off` at size 18, colour secondary;
     - the `.visibility_btn` rule: `display:flex`, centred, transparent, no border, `cursor:pointer`, `padding: 4px 0 4px 8px`.
   - **Testid:** each host passes its `data-testid`, which falls through to the button.
   - **TSDoc:** one line, carrying the invariant that the toggle stays out of the Tab order by owner decision (CLAUDE.md § Keyboard & focus order).
2. **`shake.module.css`.**
   - **Contents:** today's `@keyframes shakeInput` (`0 / -4px / 4px / -3px / 2px / 0`) once, with two role classes at today's durations:
     - `.shake_password { animation: shakeInput 0.3s ease }`, used by the four password-error sites;
     - `.shake_name { animation: shakeInput 0.4s ease }`, used by the name field.
   - **The split is by role.** Today's duration split is exactly the role split, so the program's "shake durations kept" call survives as a one-line edit.
   - **Consumers:** each local `.shake` becomes `composes: <class> from "<relative path>"`, the repo's convention.
   - **Load order:** that rule holds only `composes`, and nothing else on the wrapper sets `animation`. So the composed copy every chunk re-injects cannot reorder anything (the visual-shells-b cascade rule).
3. **`ProfileNameField.vue`.**
   - **Shape:** a two-root fragment, today's shake `div` wrapping the `Input`, then the alert `Text`. It is `OnboardingProfileNameField`'s script minus the label, with `testid` as a required prop:
     - props `modelValue`, `error` and `shake`;
     - it emits `update:modelValue` and re-emits `input`, the way the onboarding copy does today: plain props and emits, with no `defineModel`;
     - `defineExpose({ focus })`.
   - **The `Input` keeps:** `type="text"`, `placeholder="My Profile"`, `:maxLength="32"`, `sanitize`, `:error="!!error"` and `:ariaInvalid="!!error"`.
   - **The alert keeps:** `size="12" color="red" height="150" role="alert"`.
   - **Hosts keep** their container and label, whose layout differs per shell.
   - **What the DOM gains:** the fragment's element children equal today's, plus Vue's two empty text anchors around them. Those anchors render nothing; the harness proves the pixels.

### Sites

**Toggles (Q-08 a)**

| host | toggle lines | state | fields it drives | `subject` |
|---|---|---|---|---|
| `components/composite/import/ImportSecretForm.vue` | 43-56 | `hideCredentials` :22 | seed | recovery phrase |
| same | 78-91 | `isPasswordType` :21 | password, confirm | password |
| `components/composite/import/ImportFullBackupForm.vue` | 113-126 | `isDecryptionPasswordType` :32 | decrypt | password |
| same | 141-154 | `isPasswordType` :31 | password, confirm | password |
| `popup/components/modules/settings/new-profile/NewProfileCredentials.vue` | 30-44 | `isPasswordType` :15 | password, confirm | password |
| `popup/pages/auth.vue` | 264-278 | `isPasswordType` :51 | unlock password | password |
| `popup/pages/settings/security/change-password.vue` | 129-143 | `isPasswordType` :38 | current, new, repeat | password |
| same | 171-185 | same flag | current, new, repeat | password |

- **What goes:** the five `.visibility_btn` rules, at ImportSecretForm :145-153, ImportFullBackupForm :189-197, NewProfileCredentials :80-88, auth :392-402 and change-password :266-274.
- **What stays inline:** every `Input`. Only its `#suffix` content changes.

**Shake (Q-08 c)**

| host | wrapper | keyframes and class | becomes |
|---|---|---|---|
| `components/composite/SecretUnlockSection.vue` (export seed, account and full unlock gate) | :28 | :65-74, 0.3 s | `shake_password` |
| `popup/pages/auth.vue` | :250 | :439-450, 0.3 s | `shake_password` |
| `popup/pages/settings/security/change-password.vue` | :117 | :288-297, 0.3 s | `shake_password` |
| `popup/pages/settings/security/export/full.vue` (passkey encrypt pair) | :577 | :723-732, 0.3 s | `shake_password` if Phase 0 reaches it; else Deferred |
| `onboarding/components/OnboardingProfileNameField.vue` | :16 | :45-56, 0.4 s | moves into `ProfileNameField` (`shake_name`) |
| `popup/pages/import.vue` | :184 | :352-363, 0.4 s | same |
| `popup/pages/profile/new.vue` | :102 | :180-191, 0.4 s | same |

`popup/components/popups/NewSenderPopup.vue:175-191` runs a different animation (its own steps, 0.5 s) and stays.

**Profile-name fields (Q-14 c)**

- **`OnboardingProfileNameField.vue:13-36`** keeps its `Flex gap="8"` and its `Text` label. It renders `<ProfileNameField testid="onboarding-name-input">`, re-emits both events and delegates `focus`. Onboarding create and import use it unchanged.
- **`popup/pages/import.vue:182-201`** keeps `div.name_section` and the `span` label. Lines `:184-200` become `<ProfileNameField ref="nameInputRef" v-model="profileName" testid="import-name-input" …>`.
- **`popup/pages/profile/new.vue:100-119`** gets the same change with `register-name-input`. `section_last` and `section_label` stay, because the passkey block uses them too (:132-133).
- **The composable's contract holds.** It reads only `nameInputRef.value?.focus()` (`composables/useProfileNameField.ts:139`, `:150`), and `handleInput` ignores its argument (:157).

### What stays

- **Host-owned code:** every host's state refs, models, hint computeds, keydown handlers, buttons, and the `useProfileNameField` timer (400 ms, matching the 0.4 s class).
- **The four new-password pairs:** they stay inline (Decisions).
- **The fifth pair** (`onboarding/pages/create.vue:146-174`): neither arc edits `create.vue` in this respect, and this arc does not edit it at all.
- **export/full's encrypt pair** (`export/full.vue:570-614`): only its shake CSS is in scope.

### Alternatives not taken

- **A `PasswordInput` wrapping `Input` and the toggle.** It would forward every attribute, both slots and the `focus`/`inputEl` exposure that auth's `onMounted` uses.
- **Keyframes in `@nulo/design`'s `base.css`.** That file is hash-pinned and shared with the landing, and `<style module>` localizes `animation` names anyway.

### Boundary with import-shells (arc 24, Q-14 a/b)

- **This arc owns:**
  - the three new components;
  - the five toggle hosts;
  - `SecretUnlockSection`, and export/full's shake CSS;
  - `OnboardingProfileNameField`;
  - in `popup/pages/import.vue`: its component import line, :182-201 and :336-363;
  - in `popup/pages/profile/new.vue`: its import line, :100-119 and :180-191.
- **import-shells owns:**
  - in `popup/pages/import.vue`: the destructure, `onKeydown` and the CTA ladder (:85-163, :240-320);
  - `import-helpers.ts`;
  - the onboarding import and create shells, including the tablist;
  - `NewProfileMethodTabs.vue`.
- **Neither arc owns** `create.vue`'s fifth pair. It stays in Drift.
- **Landing order:** whichever arc lands first, the other rebases. That rebase keeps both arcs' test additions and regenerates `src/types/components.d.ts`, never merging it by hand.
- **Other arcs:** none of the in-review arcs touches a file listed here.

## Security & Adversarial Considerations

- **Who reaches these fields.** Only the user, inside extension pages; no dApp or web page can script them. The adversaries are a shoulder-surfer, the browser's password manager and autofill, and a careless future edit.
- **What a consolidation could break, and what pins each risk:**
  - **Unmasking.**
    - A toggle holding its own state would desync linked fields.
    - A toggle negating a stale prop would let two activations in one task cancel to a no-op, or flip the wrong way.
    - So the state and its negation stay in the host. The pins cover, per site, the exact set of inputs each toggle flips, the masked default, and two activations without an intervening tick.
  - **A toggle that submits or swallows Enter.**
    - Without `type="button"`, auth's toggle becomes the form's default button. Enter in the password field would then click it, revealing the password and submitting.
    - `type="button"` is hard-coded. A jsdom pin proves a click never reaches `unlockProfile`. The real-browser auth surface submits the wrong password with Enter and requires the field to stay masked.
  - **Tab order.** `tabindex="-1"` is hard-coded and pinned on every toggle.
  - **Autofill and attributes.** Every native attribute (`autocomplete`, `autocapitalize`, `autocorrect`, `spellcheck`) is read literally per field. That includes the absence of native `autofocus` and `maxlength`, which `Input` never binds.
  - **Focus.**
    - `Input` focuses in `onMounted`, so the active element after mount is pinned in jsdom and recorded on both browsers.
    - Clicking a toggle must leave focus on its field.
  - **Paste and length.**
    - The name field's 32-character cap and sanitizer run in `Input`'s paste and input handlers, so a real `paste` event is pinned.
    - The seed field's paste is not intercepted (it has no `maxLength`), which is pinned too.
- **What the new components hold.**
  - They keep no value in state of their own, use no `watch`, and touch no storage. `ProfileNameField` passes the name through props and events.
  - Hosts already keep `defineModel` refs (Vue's `useModel` keeps `localValue` and `prevSetValue`), and `Input` keeps its `text` ref. Both are unchanged. The toggle never sees a value.
  - The guarantee is therefore that no new place holds a credential, not that no copy exists.
- **Logging policy.** The new files contain no `console.*`, logger call or `chrome.*`. The gate greps for them, and `log-payload-ban.test.ts` scans them anyway.
- **Copy.** Every aria-label, placeholder, label and alert string stays byte-identical. The pins read them literally.
- **Layering.** The new files are L3. Onboarding and L4 may import L3. No npm-published entry is touched.

## Assumptions

**Facts** (read 2026-10-03; unchanged between `2adab99d` and `eb06c37d`):

1. The toggles, shakes and name fields sit at the lines in the tables above. The five `.visibility_btn` rules are declaration-identical; auth's copy differs only in blank lines.
2. What `Input` does (`packages/design/src/ui/Input.vue`):
   - It binds `autocomplete`, `autocapitalize` and `autocorrect` to the native input (:291-308), with `spellcheck="false"` hard-coded.
   - It binds no native `autofocus` or `maxlength`. `autofocus` focuses in `onMounted` (:125-129); `maxLength` truncates in the input and paste handlers (:143-166, :214-245).
   - It declares no `input` emit (:15), so `@input` on it is a native listener on its root.
   - It renders `#suffix` inside the clickable base (:280-321, slot at :320), and a click on the base focuses the input (:200-202).
3. All four 0.3 s sites are password errors and all three 0.4 s sites are profile names. The keyframes are byte-identical in all seven.
4. `useProfileNameField` sets `shakeName` one animation frame after the error, and clears it 400 ms later (`composables/useProfileNameField.ts:114-127`). It calls only `focus()` on the ref.
5. Name validation runs only when the user edited the field. A failure returns `null` before any import or create (`composables/useProfileNameDefault.ts:65-72`, `composables/useProfileImportFlow.ts:176-182`).
6. The backup fixtures need no real backup:
   - `detectBackupType` classes any base64 text whose first decoded byte is 0 and which is 13 bytes or longer as `encrypted` (`utils/full-backup-helpers.ts:42-52`);
   - a minimal JSON with `data.profile.type: "password"` shows the new-password section;
   - the e2e driver's `pickFileByTestId` picks a file on both browsers.
7. Vitest resolves no components (`apps/extension/vitest.config.ts`).
8. The existing host tests use different harnesses:
   - `auth.test.ts:80-87` stubs `Input` and drops its slots;
   - `popup/pages/profile/new.test.ts` stubs `NewProfileCredentials` and mocks `makeCreateKeydownHandler` as a no-op;
   - `onboarding/pages/import.test.ts` has no Enter test.

**Inferences:** none beyond what the pins check.

**Asks:** none. The plan audit settled both (Decisions).

## Phases

### Phase T: the testid commit

Add the 8 testids above, with no other change. Shoot it against its parent, on Chrome and Firefox and in both themes; everything must be identical. Also run the gates.

### Phase 0: harness surfaces and stability (no product code)

Write `surfaces/credential-inputs.ts` in the harness directory, modelled on `visual-shells-b.ts`. Run `--stability` on the testid commit, on both browsers.

**Fixed values and preconditions:**

- Typed values are fixed: `TEST_PASSWORD`, one wrong password, the canonical 24-word seed.
- Every surface with a prefilled name starts with exactly one profile, the harness's, and asserts "Profile 2".
- A surface that adds anything removes it. The auth surface unlocks again before it leaves. The name-error surfaces assert that the profile count is still one.
- The passkey surface, if kept, runs last and deletes its profile.

**What each probe records:**

- Per field: the native input's `type`, `autocomplete`, `spellcheck`, `autocapitalize`, `autocorrect`, `aria-invalid`, `autofocus` and `maxlength`.
- Per toggle, masked and revealed: `type`, `tabindex`, `aria-label`, `data-testid`, its box, and its computed `display`, `padding`, `background`, `border` and `cursor`.
- The active element (by its nearest testid) right after mount and after a toggle click.
- The shake, without depending on the transient frame:
  - a MutationObserver installed before the submit records every class the shake wrapper receives;
  - the probe then reads `animation-duration`, `animation-timing-function` and `animation-iteration-count` from a detached element carrying that class, plus the resolved `@keyframes` steps with the hashed name stripped;
  - it asserts 0.4 s for the name role and 0.3 s for the password role.

**Surfaces:**

| host | route | states |
|---|---|---|
| auth | lock, `#/popup/auth` | empty; typed (masked); revealed; wrong password submitted by Enter in the field (alert, shake, field still masked) |
| change-password | `#/popup/settings/security/change-password` | empty; typed with mismatch; revealed (one click flips all three); wrong current (alert, shake) |
| export seed, account and full | each page, past its warning | unlock gate empty; typed; wrong password (alert, shake) |
| export full, encrypt pair | passkey profile, backup finished | mismatch (shake). This is a spike: if either browser cannot reach it, `full.vue` keeps its keyframes (Deferred). |
| popup import | `#/popup/import` | name prefilled; name error (field cleared, valid seed and pair, submit); seed form empty, typed, seed revealed, pair revealed; full backup with an encrypted fixture (decrypt revealed) and with a password fixture (pair revealed) |
| popup profile/new | `#/popup/profile/new` | name prefilled; name error; pair typed and revealed |
| onboarding import | onboarding tab | name prefilled; name error; seed revealed; full-backup pair revealed |
| onboarding create | onboarding tab | name prefilled; name error |

**Forced-diff check:** two throwaway heads, `shake_password` at 0.35 s and `shake_name` at 0.45 s, must each red the probe. So must a head with `composes` deleted or the roles swapped. jsdom cannot see `composes`, so these are browser mutants.

**Pass:** the stability run is identical on both browsers and themes.

### Phase 1: pin today's behaviour (tests only, green on the unchanged code)

**Shared helper:** `tests/helpers/credential-pins.ts` holds `expectMaskToggle(wrapper, { toggle, drives, others, labels })`. It checks:

- `type="button"`, `tabindex="-1"`, the masked aria-label and the `visibility` icon;
- that every `drives` input is a password field;
- that one click flips exactly `drives` (never `others`), swaps the label and icon, and leaves focus on the field's native input;
- that two clicks dispatched with no tick between them leave the fields masked again;
- that a third click reveals them.

**Per host,** each pin in its colocated test, with the real `Input` and a `MaterialIcon` stub that renders its name:

- **`ImportSecretForm.test.ts`:**
  - both toggles: seed drives {seed}, password drives {password, confirm};
  - native attributes;
  - no native `autofocus` or `maxlength`;
  - a real `paste` into the seed field is not intercepted.
- **`ImportFullBackupForm.test.ts`:**
  - the decrypt toggle drives {decrypt};
  - the decrypt field is focused right after mount;
  - the pair toggle drives {password, confirm}.
- **New `NewProfileCredentials.test.ts`:**
  - the toggle drives {password, confirm};
  - the first field is focused after mount;
  - typing emits `update:password` and `update:repeatedPassword` and no `input` event;
  - Enter in the repeat field reaches a listener on the component root, not `defaultPrevented`.
- **`auth.test.ts`,** a new `describe` with its own mount:
  - the toggle drives {unlock};
  - `autocomplete="current-password"`, `autocapitalize="none"`, `autocorrect="off"`;
  - with a password typed, a toggle click calls no `unlockProfile`;
  - a wrong password puts the shake class on the input's parent.
- **`change-password.test.ts`:**
  - each toggle drives {current, new, repeat};
  - the current field is focused after mount;
  - Enter guard checks: an Enter that is already handled, repeated, composing, or carries keyCode 229 sends no change, and a plain Enter sends one;
  - input in the repeat field followed by Enter with no await between them sends the typed value;
  - the wrong-current shake class.
- **`SecretUnlockSection.test.ts`:** the shake class follows `error`.
- **Name fields:**
  - `OnboardingProfileNameField.test.ts` gets appended tests:
    - the parent's model already holds the typed value when its `input` handler runs;
    - a real `paste` of 40 characters lands as the sanitized 32;
    - no native `maxlength`.
  - `popup/pages/import.test.ts` gets appended tests, with `nameFieldState` shown:
    - root testid, placeholder, `type="text"`, sanitize and the 32-character cap, alert and `aria-invalid`, and the shake class;
    - `nameInputRef.value.focus()` lands on the input;
    - `profileName` is current inside `handleNameInput`;
    - typing a name then Enter, in one task, with a backup ready: `restoreBackup` runs once and sees the typed name;
    - the same Enter guards as above.
  - The existing `popup/pages/profile/new.test.ts` gets appended tests: the same name-field block, plus focus.
  - `onboarding/pages/import.test.ts` gets appended tests: Enter in the full-backup password field, with a backup ready, starts no restore (no Enter shortcut appears).

**Unchanged and frozen:** every existing test, including the current Enter pins.

**Mutants** (on the Phase 2 code; each must red):

- the toggle:
  - drop `type="button"`;
  - `tabindex` 0 or removed;
  - a templated or recased label;
  - the toggle holding its own state;
  - `update:hidden` with `!hidden` instead of `toggle` (the two-activation pin);
  - a default revealed state;
  - the toggle moved to `#bottom`;
  - the testid not falling through;
- the name field:
  - no `sanitize`, or no `maxLength`;
  - no exposed `focus`;
  - the alert outside the fragment;
  - model forwarding delayed by `nextTick`;
  - `input` forwarding delayed by `nextTick`;
- the hosts:
  - the `e.defaultPrevented` check removed from change-password's and import's `onKeydown`.

### Phase 2: the refactor, with every Phase 1 file frozen

Three commits:

1. `shake.module.css` and the 0.3 s consumers.
2. `PasswordVisibilityToggle` across the five hosts.
3. `ProfileNameField` across the three name hosts.

Each new component gets a colocated test that meets CLAUDE.md's L3 minimum (10 cases, mostly table rows). Then `bun run build` regenerates `src/types/components.d.ts`; inspect the diff and commit it.

**Validation gate, after each phase:**

- **Commands:** `bash <scratch>/hd/gates.sh <worktree> <logdir>`, plus `bun run lint:actions`.
- **Pass criteria:**
  - every command exits 0;
  - Phase 2 edits no Phase 1 test file;
  - grepping the three new files for `console.` and `chrome.` finds nothing;
  - no new complexity acceptance.
- **Screenshots:**
  - Two comparisons, each on Chrome and Firefox: the testid commit against its parent, and the refactor head against the testid commit.
  - Each comparison is run again with `--stability`. Every shot and probe must be identical.
  - Each `report.md` is copied into the scratch directory before the next run.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks. It names the threat list above.
   - The no-over-engineering rule goes in verbatim: "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - So does the comment-quality rule: "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
2. **Fix loop:** triage each finding, fix, commit, and log the round in `lessons/arc-23-credential-inputs.md`. Stop at a round with no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR in the gh stack on `harden-dedupe`, and then add both e2e labels. Attach the harness reports. Squash-merge when the program gates are green.
4. **Close-out** belongs to the program: this plan closes with the program plan.

## Delivery

One arc, `hd/23-credential-inputs`, stacked on `harden-dedupe`. Code review: off.

## UI impact

None by design. The surfaces in scope:

- onboarding import and create;
- popup import and profile/new;
- auth (unlock) and change password;
- the export seed, account and full unlock gate;
- the passkey encrypt pair, if Phase 0 reaches it.

Every state in the Phase 0 table must be pixel-identical, with identical probes, on both browsers and in both themes. The added testids are attributes only. The arc therefore needs no owner sign-off.

## Drift left for the alignment arc

- **Owner call 4.** `autocomplete="new-password"` is absent from ImportFullBackupForm's and NewProfileCredentials' pairs (`ImportFullBackupForm.vue:133-169`, `NewProfileCredentials.vue:22-58`).
- **No `autocomplete` on two more fields:** the decrypt field (`ImportFullBackupForm.vue:106-112`) and export full's encrypt pair (`export/full.vue:578-602`). New; for the owner page.
- **Owner call 5:** reduced motion on the shake. The 0.3 s / 0.4 s split is kept, with no call.
- **Toggle state is announced by swapping the label,** with no `aria-pressed`. Kept.
- **`autocapitalize="none"` and `autocorrect="off"`** exist only on auth's unlock field.
- **The fifth new-password pair** (`onboarding/pages/create.vue:146-174`): no toggle, and the hint sits outside it. Owned by neither arc. Kept.
- **The pair placeholders differ per site.** Copy; kept.
- **The onboarding name label is a `Text`; the popup's is a `span`.** Kept per shell.
- **Change-password reveals current, new and repeat together** from one flag (:38). Kept, and reported as a risk in the final report, not as an owner call.

## Deferred

- `NewSenderPopup.vue`'s shake: a different animation, not a copy.
- `export/full.vue`'s encrypt-pair shake. The Phase 0 spike was not attempted: it needs a passkey profile, a virtual authenticator, a WebAuthn ceremony and a profile deletion on both browsers. The file keeps its own keyframes.
- Q-08 (b), the new-password pair (Decisions).

## Decisions (delegated)

### Plan audit (Codex xhigh: REVISE, one blocker; Opus: REVISE, no blocker), reconciled by the coordinator

1. **Blocker (Codex; Opus should-fix): the stale-prop toggle.** Both legs reproduced it: two clicks in one task both negated the same prop. Opus noted a user cannot reach it. **Adopted:** a payload-free `toggle` event, with each host's handler verbatim, plus a two-activation pin.
2. **Ask 2, `NewPasswordFields`: dropped** (both legs). It needed nine required props, saved about as many lines as it cost, and put one more component boundary around a password. It also does nothing for owner call 4.
3. **Ask 1, the harness selector: a testid commit first** (Codex; Opus preferred a scoped structural selector). **Adopted:** CLAUDE.md makes testids the rule for interactive elements, and a testid adds no pixels. The commit is shot against its parent on its own, and it is the base for the refactor's shots.
4. **Timing and keyboard pins (both): adopted.**
   - The parent's value during the input callback.
   - Input then Enter with no await between them.
   - Delay mutants for model and `input` forwarding.
   - Guard checks for handled, repeated and composing Enter, including keyCode 229.
5. **`new.test.ts` exists and stubs the credentials (both): adopted.**
   - The repeat-field keydown is pinned in a new `NewProfileCredentials.test.ts`.
   - The name-field pins are appended to `new.test.ts`.
   - `NewProfileCredentials`' model updates are asserted, along with the absence of an extra `input` event.
   - Onboarding import gets a test that no Enter shortcut appears.
6. **`Input` binds no native `autofocus` or `maxlength` (both): adopted.** The assumption is corrected, the absent attributes are pinned with the behaviour, and paste is pinned with real `paste` events. Phase 0 records the active element after mount.
7. **The name shake is transient (both): adopted.**
   - A MutationObserver captures the class, and a detached element reads the computed animation.
   - Forced-diff mutants run for both roles.
   - The `composes` mutants run in the browser.
8. **The passkey spike creates a profile (both): adopted.** It runs last or deletes its profile, and every prefilled-name surface starts with exactly one profile.
9. **Fragment wording (Opus): adopted.** The element children are identical, plus two empty text anchors.
10. **The `defineModel` reasoning (Opus): adopted.** It is replaced with what is actually guaranteed: no new place holds a credential.
11. **One change-password flag reveals all three fields (Codex): kept.** It is listed in Drift and reported as a risk.
12. **The boundary (both): adopted.**
    - Arc 23 never edits `create.vue`, and arc 24 does not own `new.vue`'s lines.
    - Whichever arc lands first, the other rebases, keeping both arcs' tests.

### Code review (Codex): round 1 CONVERGED; rounds 2 and 3 on the screenshot evidence

- **Round 2: NOT CONVERGED, all adopted.** The Chrome onboarding noise was fixed at its cause: stale LCD fringes at 1x. The onboarding tab is now shot at 2x and repainted whole before capture. Masked full-backup captures and focused name captures were added, each run's bundle keeps only its own evidence, and the loose reach checks were tightened. All three final runs show zero diffs on both browsers.
- **Round 3: NOT CONVERGED on one should-fix, adopted.** The focus-return check could pass without production returning focus, because typing left the name field focused. The surface now blurs the field before the submit, asserts it is unfocused, and keeps the post-submit assertion that the page focused it. A no-op `ProfileNameField.focus()` mutant now fails in all four name hosts.
