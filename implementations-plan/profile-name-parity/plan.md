# Profile-name Parity — Plan v1

Bring the extension's in-app **Create** + **Import** flows to feature-parity with the onboarding flow's "set name before create" UX, and align user-facing terminology across both flows on the single word **"Profile"** (extension's existing term — onboarding currently says "Wallet").

This is Tier B (medium / contained feature work). All changes live inside `packages/extension/src`. No cross-package surface, no RPC/schema changes, no identifier rename — only user-visible copy + one new input field + e2e fallout.

## 0. Context

Two user-facing flows let someone create or import a profile:

| Flow | Where | Today's behavior | Term used |
|---|---|---|---|
| **Onboarding** | `src/onboarding/pages/{create,import}.vue` | Requires the user to type a profile name (1–32 chars, trimmed, submit-time validation with shake + inline error). | "Wallet" |
| **Extension popup** | `src/popup/pages/profile/new.vue` + `src/popup/pages/import.vue` | Create: no name input — auto-generates `` `Profile ${profiles.length + 1}` `` at submit time. Import: pre-fills `My Profile N` in `onMounted`, length-checked in `:disabled`. | "Profile" |

The product owner's intent: a user should **decide** the name before creating, so they don't land in the app with a placeholder name they have to rename. The extension flows fail at that today. And the term split is a maintenance smell: future contributors will keep adding new "Wallet" copy or new "Profile" copy on whichever side they're working in.

## 1. Decisions locked (from clarifying-question round)

| # | Decision | Choice |
|---|---|---|
| 1 | Term direction for user-facing copy | **"Profile" wins.** Extension copy already uses "Profile" throughout. Onboarding flips from "Wallet" → "Profile". |
| 2 | Rename depth | **Copy + e2e testids only.** Internal code identifiers (`ProfileService`, `profileName` refs, `changeProfileName` RPC) keep their existing "Profile" naming — the rename is bidirectional only for user copy. |
| 3 | Consistency scope | **All user-visible surfaces.** Not just Create/Import. Also covers Edit/Select/Settings/AuthProfilePill copy *if* any "Wallet" leaks exist there (sweep audit confirms none today). |

## 2. Goals

- The extension's **Create** flow has a "Profile name" input with the same validation UX as onboarding (1–32 chars, trim, submit-time validation, shake-on-empty, inline error, focus restore).
- The extension's **Import** flow drops the `My Profile N` pre-fill and uses the same validation UX as onboarding.
- All onboarding user-visible copy switches from "Wallet" → "Profile" — placeholders, labels, headings, button text, error messages, notification titles.
- E2E tests still pass — both the smoke suite (`bun run test:e2e`) and the network suite (`bun run e2e:agent`).
- No regression on EditProfile, SelectProfile, Settings → Profile, or AuthProfilePill (already on "Profile").

## 3. Non-goals

- **No internal identifier rename.** `ProfileService`, `useProfileBootstrap`, `profile.store`, `profileName` refs, the RPC method names (`createProfile`, `changeProfileName`, `importMnemonic`, …) — all stay as they are. Locked at clarifying-question time.
- **No service-side validation changes.** Length / charset validation stays at the UI layer; the service still accepts any string. (Defense-in-depth at service layer is a separate concern; flagged in §7 but out of scope.)
- **No EditProfilePopup behavior change.** Copy stays "Profile" (it already is). Applying the shake-validation UX to that popup is listed as an open question — defaults to *no* unless approved.
- **No "Open wallet" / "Wallet version" rename on Done/About surfaces** unless explicitly approved (open question — those refer to the *app*, not the account).
- **No data migration.** Per memory, no production users; no need to preserve old-name shapes.
- **No new `noExplicitAny` exceptions.**

## 4. Work surface — file catalog

### 4.1 Feature work (new code)

**[F1] `src/popup/pages/profile/new.vue` — add Profile-name field**

Today (snapshot):
```js
const handleCreate = async () => {
  // …
  const profiles = await managers.profile.getProfiles()
  const name = `Profile ${profiles.length + 1}`
  // …
}
```

After:
- Replace the auto-suggest with a controlled `profileName` ref bound to an `<Input>` that lives **above** the existing `NewProfileMethodTabs`.
- Mirror onboarding's validation pattern exactly: `trimmedName` computed, `nameError` ref, `shakeName` ref, `nameInputRef` template ref, `validateName()` called at submit time before `isAllowedToContinue` is checked.
- Drop the `await managers.profile.getProfiles()` count lookup — no longer needed.
- Testid: `register-name-input` (new). Symmetric with existing `register-method-{password,passkey}` and `register-submit-btn`. Do NOT reuse `profile-name-input` — that's owned by EditProfilePopup and the testid-stability rule keeps each owner unique.

**[F2] `src/popup/pages/import.vue` — drop pre-fill, add validation parity**

Today:
```js
const profileName = ref("My Profile")
// …
onMounted(async () => {
  const profiles = await managers.profile.getProfiles()
  profileName.value = `My Profile${profiles?.length ? ` ${profiles.length}` : ""}`
  // …
})
const isAllowedToContinue = computed(() => {
  if (!profileName.value || profileName.value.length < 2) return false
  // …
})
```

After:
- `profileName.value = ""` (initial empty, matches onboarding).
- Drop the `onMounted` pre-fill block.
- Move name-validation OUT of `isAllowedToContinue` and INTO submit-time `validateName()` (matches onboarding pattern).
- Add `nameError`, `shakeName`, `nameInputRef`, `validateName()`, `triggerNameShake()`, `handleNameInput()` — copy-paste from `src/onboarding/pages/import.vue:51-86`. Or **better**: extract a tiny composable (see §5).
- Add the same `<Input>` block under the hero, before the `ImportMethodPicker`.
- Testid: `import-name-input` (new).
- Update each `handleImport*` to call `if (!validateName()) return` after the `isAllowedToContinue` checks (same as onboarding's pattern at `import.vue:154,170,189,211`).

### 4.2 Optional refactor (extract shared validation logic)

**[R1] Extract `useProfileNameField()` composable** — *recommended; flagged for codex/opus opinions in §8*.

The validation block in `onboarding/pages/create.vue:36-76` and `onboarding/pages/import.vue:46-86` is byte-identical (modulo the variable name). It will appear a **third time** in `popup/pages/profile/new.vue` and a **fourth time** in `popup/pages/import.vue` if we copy-paste. Per CLAUDE.md "Modularize relentlessly — same code in 3 places is a refactor signal," four copies trips the threshold cleanly.

Proposed `src/composables/useProfileNameField.ts`:
```ts
export interface UseProfileNameFieldOptions {
  minLength?: number // default 1
  maxLength?: number // default 32
  emptyErrorMessage?: string // default "Profile name is required."
  maxLengthErrorMessage?: string // default "Max 32 characters."
}

export function useProfileNameField(opts: UseProfileNameFieldOptions = {}) {
  const min = opts.minLength ?? 1
  const max = opts.maxLength ?? 32
  const emptyMsg = opts.emptyErrorMessage ?? "Profile name is required."
  const maxMsg = opts.maxLengthErrorMessage ?? `Max ${max} characters.`

  const profileName = ref("")
  const trimmedName = computed(() => profileName.value.trim())
  const nameError = ref("")
  const shakeName = ref(false)
  const nameInputRef = ref<{ focus: () => void } | null>(null)
  let shakeTimer: ReturnType<typeof setTimeout> | null = null

  function triggerShake() {
    shakeName.value = false
    if (shakeTimer) clearTimeout(shakeTimer)
    requestAnimationFrame(() => {
      shakeName.value = true
      shakeTimer = setTimeout(() => { shakeName.value = false }, 400)
    })
  }

  function validate(): boolean {
    const n = trimmedName.value
    if (n.length < min) {
      nameError.value = emptyMsg
      triggerShake()
      nameInputRef.value?.focus()
      return false
    }
    if (n.length > max) {
      nameError.value = maxMsg
      triggerShake()
      return false
    }
    nameError.value = ""
    return true
  }

  function handleInput() {
    if (nameError.value) nameError.value = ""
  }

  function dispose() {
    if (shakeTimer) clearTimeout(shakeTimer)
    shakeTimer = null
  }

  return { profileName, trimmedName, nameError, shakeName, nameInputRef, validate, handleInput, dispose }
}
```

This is **C0** (pure utility — no `chrome.*`, no service clients). Parents call `dispose()` in `onBeforeUnmount` per the cleanup-order rule.

Test coverage minimum: 10 cases (composable rule). Covered in §6.

### 4.3 Onboarding copy alignment (Wallet → Profile)

**[C1] `src/onboarding/pages/create.vue`**

| Line | Old | New |
|---|---|---|
| 38 (comment) | `// Wallet name is required.` | `// Profile name is required.` |
| 60 (error string) | `"Wallet name is required."` | `"Profile name is required."` |
| 97 (button label) | `"Create wallet"` | `"Create profile"` |
| 138 (notif title) | `"Wallet creation failed"` | `"Profile creation failed"` |
| 188 (BrutalistTitle) | `sub="Wallet"` | `sub="Profile"` |
| 194 (section label) | `Wallet name` | `Profile name` |
| 200 (placeholder) | `"My Wallet"` | `"My Profile"` |

(Note: F1's extraction of `useProfileNameField()` absorbs lines 38–76; if R1 is approved, lines 60/76 disappear into the composable. Lines 138/188/194/200 stay in the .vue file.)

**[C2] `src/onboarding/pages/import.vue`**

| Line | Old | New |
|---|---|---|
| 47 (comment) | `// Wallet name is required across…` | `// Profile name is required across…` |
| 70 (error) | `"Wallet name is required."` | `"Profile name is required."` |
| 222 (notif title) | `"Wallet import failed"` | `"Profile import failed"` |
| 224 (notif description) | `"…importing the wallet."` | `"…importing the profile."` |
| 230 (console.error) | `"Failed to import wallet:"` | `"Failed to import profile:"` |
| 307 (BrutalistTitle) | `sub="Wallet"` | `sub="Profile"` |
| 313 (section label) | `Wallet name` | `Profile name` |
| 319 (placeholder) | `"My Wallet"` | `"My Profile"` |
| 390 (button text) | `"Import wallet"` | `"Import profile"` |
| 419 (button) | `Import wallet` | `Import profile` |
| 430 (button) | `Import wallet` | `Import profile` |
| 441 (button) | `Import wallet` | `Import profile` |

**[C3] `src/onboarding/pages/welcome.vue`**

| Line | Old | New |
|---|---|---|
| 42 (button) | `Create wallet` | `Create profile` |
| 51 (button) | `Import wallet` | `Import profile` |

**[C4] `src/onboarding/pages/done.vue`** — flagged as open question (see §8). Three surfaces here:
- L97 subcopy: `"open the wallet from now on"` — refers to opening the *app* (popup), not an account record.
- L107 button: `"Open wallet"` — opens the popup.
- L23 function name `openWallet()` — internal identifier, NOT renamed regardless of decision.

Default position: **leave L97 and L107 unchanged** because they refer to the app, not the account concept. Approving this as-is is the recommended option in §8.

### 4.4 Cross-surface verification (no edits expected, just confirm)

Confirmed by grep (executed during planning):
- `data-testid="*wallet*"` → **no hits** in `packages/extension/src`.
- `popup/components/popups/EditProfilePopup.vue` → already says "Edit profile" / "My Profile".
- `popup/components/popups/SelectProfilePopup.vue` → confirmed "Profile" throughout.
- `popup/pages/settings/profile/index.vue` → already "Profile".
- `popup/components/modules/auth/AuthProfilePill.vue` → already "Profile".

This step is a CI guard, not edits: after the implementation, re-run `grep -rEi '[Ww]allet' packages/extension/src --include="*.vue"` and confirm only intentional matches remain (app-name uses in done.vue, comments referencing the wallet repo, log strings).

### 4.5 E2E + test fallout

Direct selector breakage (text-based): **one** location.
- `tests/e2e/onboarding-tab.test.ts:7` — `const TEST_WALLET_NAME = "Onboarding Test"`. Cosmetic rename of the constant to `TEST_PROFILE_NAME` is offered (matches §7 sweep) but not load-bearing — the constant value isn't asserted against, only typed into the input.
- `tests/e2e/onboarding-tab.test.ts:17` — test description string `"…opens wallet popup window"` — touch only if "Open wallet" → "Open Nulo" is approved in §8.

No testid selectors break: `onboarding-name-input`, `onboarding-submit-create`, `onboarding-submit-import`, `register-create-btn`, `register-import-btn`, `register-submit-btn`, `register-method-*`, `import-{seed,private-key,public-key}-submit-btn`, `import-full-backup-*` — all stable.

The new testids `register-name-input` and `import-name-input` are additive; no existing test references them.

## 5. Phase plan

Each phase is independently verifiable. The order is: refactor first, feature next, copy last — so feature work uses the extracted composable and copy alignment is a final sweep that doesn't churn through logic edits.

**P0 — Optional precondition (R1).** If approved at the gate:
1. Create `src/composables/useProfileNameField.ts` per §4.2.
2. Create `src/composables/useProfileNameField.test.ts` (10 cases — see §6).
3. Validate: `bun run --cwd packages/extension test src/composables/useProfileNameField.test.ts`.
4. Update `onboarding/pages/create.vue` and `onboarding/pages/import.vue` to consume the composable. No copy changes yet — just the logic-extraction refactor. The output should be a no-op for users (e2e still passes).
5. Validate: `bun run audit:vue` + `bun run test:e2e`.

**P1 — Extension Create: add Profile-name field (F1).**
1. Edit `src/popup/pages/profile/new.vue`:
   - Import `useProfileNameField` (if R1) or inline-port the validation block from onboarding.
   - Add the `<Input>` block above `NewProfileMethodTabs` with testid `register-name-input`. Place inside a `:class="[shakeName && $style.shake]"` wrapper. Add the error `<Text>` below.
   - Inside `handleCreate`, replace `const name = ...` with `if (!validateName()) return` followed by `const name = trimmedName.value`.
   - Drop the unused `const profiles = await managers.profile.getProfiles()` line.
   - Wire `dispose()` (if R1) into the existing `onBeforeUnmount` in cleanup order (after services, before timers).
2. Add CSS for `.shake` keyframes — copy verbatim from onboarding/create.vue:390-401.
3. Validate: `bun run --cwd packages/extension typecheck && bun run --cwd packages/extension test src/popup/pages/profile`.

**P2 — Extension Import: drop pre-fill, add validation parity (F2).**
1. Edit `src/popup/pages/import.vue`:
   - Drop the `My Profile` ref default → `const profileName = ref("")`.
   - Delete the `profileName.value = \`My Profile${...}\`` block from `onMounted`.
   - Remove `profileName.value.length < 2` from `isAllowedToContinue` (it's now validated at submit time).
   - Add the composable (R1) or inline-port the validation block.
   - Add `<Input>` block under hero/before `ImportMethodPicker`, testid `import-name-input`.
   - In each of `handleImportSeed`, `handleImportPrivateKey`, `handleImportPublicKey`, `handleImportPasskey`, `handleImport*` for backup paths if applicable: insert `if (!validateName()) return` after the `isAllowed*` early-return and before the service call.
   - Verify `useFullBackupImport` doesn't separately reference `profileName` (it doesn't today — backup imports use the backup's embedded name).
   - Wire `dispose()` in `onBeforeUnmount` if R1.
2. Reuse the `.shake` CSS rule.
3. Validate: `bun run --cwd packages/extension typecheck && bun run audit:vue`.

**P3 — Onboarding copy alignment (C1–C3).**
1. Apply the line-by-line table edits in §4.3 to `create.vue`, `import.vue`, `welcome.vue`. No logic changes.
2. (Conditional on §8 decision) `done.vue` edits.
3. Validate: `bun run lint && bun run --cwd packages/extension test`.

**P4 — E2E + test fixture sweep.**
1. (Optional) Rename `TEST_WALLET_NAME` → `TEST_PROFILE_NAME` in `tests/e2e/onboarding-tab.test.ts`. Value stays `"Onboarding Test"` — it's typed into the new "Profile name" field.
2. (Conditional on §8) Update test description string on `onboarding-tab.test.ts:17` if "Open wallet" copy changed.
3. Run the smoke e2e: `bun run test:e2e`. If a passkey or full-backup test is gating elsewhere, run that subset.
4. Run the network e2e under the agent runner: `bun run e2e:agent`.

**P5 — Final cross-surface grep guard.**
1. `grep -rEi '[Ww]allet' packages/extension/src/{onboarding,popup} --include="*.vue"` — confirm zero unintentional hits. Whitelist the residual matches (e.g. `done.vue` if §8 decision is "keep"; any `// comment about the wallet repo`).
2. `bun run audit:vue` (full local gate: typecheck → test → lint → build).

**P6 — Implementation-codex review (per protocol §6).** Send diff + summary to codex with explicit adversarial ask.

## 6. Test plan

### 6.1 Unit / component (Vitest)

**(R1 only) `src/composables/useProfileNameField.test.ts` — 10 cases:**

1. Initial state: empty `profileName`, no error, no shake.
2. `validate()` returns false + sets error on empty input.
3. `validate()` returns false + sets error on whitespace-only input.
4. `validate()` returns true on a single non-space char (length=1).
5. `validate()` returns true at exactly 32 chars.
6. `validate()` returns false + sets max-char error at 33 chars.
7. `handleInput()` clears an existing error (verifying the on-input clear).
8. `triggerShake()` flips `shakeName` false→true and returns to false after 400ms (fake timers).
9. `nameInputRef.focus()` is called on empty-input validation failure.
10. `dispose()` clears the pending shake timer (no spurious mutation after unmount).

These are the canonical 10. No more, no fewer — per the testing philosophy "smallest set that proves the implementation works."

**(F1, F2 component-level)** — None required at the component level. The popup pages are L6 (pages), exempt from the component-test minimum. Behavior is covered by e2e.

### 6.2 E2E

**New smoke coverage** in `tests/e2e/registration.test.ts` (popup-side flow):
- Type a name in the new `register-name-input`, click `register-submit-btn`, assert profile is created with that exact name (read from `chrome.storage.local["nulo:ui:lastActiveProfile"]` + the profile list).
- Submit with empty name: assert no profile created, focus is on the name input, error text "Profile name is required." renders.

**New smoke coverage** in a new or existing `tests/e2e/import-paths.test.ts` test:
- Type a name, do a seed-phrase import, assert profile saved with that name.
- Empty name + submit: assert no profile created.

If passkey paths are easy to extend, add empty-name coverage to `passkey-paths.test.ts`. If not, leave for the network suite to catch.

**Existing tests that should still pass unchanged:** all of them. The smoke + network suites are the regression net.

## 7. Security & adversarial considerations

Per CLAUDE.md "Think like an attacker, always."

### 7.1 Duplicate profile names (key adversarial concern)

**Today**: auto-suggest (`My Profile 1`, `My Profile 2`, …) makes collisions effectively impossible without the user typing exactly the same string. After this change: the user can type "My Profile" twice and create two indistinguishable list rows in `SelectProfilePopup`. There's **no service-level uniqueness check** (`profile/service.ts:788,925` only checks passkey *credential* uniqueness, not name uniqueness).

**Threat model**: not a security vulnerability — there's no privilege boundary at the profile-name layer. But it's a real UX footgun and a phishing-adjacent confusion vector (e.g., a malicious dapp instructs the user to rename their profile to match another the attacker controls). Worth mitigating.

**Mitigation options** (open question in §8, defaults to **(c)**):
- **(a)** Hard-block at submit time. UI shows inline error "Name already in use." Disable submit until renamed. **Recommended for safety**, costs +20 LOC.
- **(b)** Soft warning + allow. Shows inline yellow text "Another profile is named X" but doesn't block. Lower friction.
- **(c)** Silently allow (current behavior). Status quo. Easy to ship, leaves the footgun.

### 7.2 Input sanitization

`Input.vue` has a `sanitize` prop that runs `sanitizeString` from `@/utils/string`. **EditProfilePopup uses it; onboarding's create/import do NOT.** This is an existing inconsistency, predating this PR.

**Action**: apply `:sanitize` to the new `register-name-input` and `import-name-input`. Optionally retro-apply to onboarding's existing input for consistency (zero-cost addition).

Threat: profile names are rendered in many UI surfaces (AuthProfilePill, SelectProfilePopup, Settings, toast notifications). If `sanitizeString` is the only line of defense against an injected unicode-direction-override or zero-width character that could spoof another profile name, we want it on every input. Audit `sanitizeString`'s implementation to confirm what it strips, and decide whether the unconditional Vue template binding (`{{ profile.name }}`) is sufficient for the rendered surfaces (it is, for HTML/JS injection — Vue auto-escapes mustache content).

### 7.3 Length cap

UI enforces `:maxLength="32"`. Service accepts arbitrary strings — `createProfile(name: string, ...)`. Defense-in-depth at the service layer (clamp / validate / reject) is **out of scope** for this PR but flagged for a follow-up. The risk today is bounded: the only way past the UI cap is direct RPC calls from a compromised content script, which already has bigger attack surface than profile names.

### 7.4 Supply chain / dependencies

Zero new dependencies. Zero version bumps. This work is internal-only.

### 7.5 Cleanup order

The shake timer (`shakeTimer`) is the only async resource the new code introduces. Composable (R1) exposes `dispose()`; consumers call it in `onBeforeUnmount` per the canonical order (services first, then composables, then timer/listener teardown). If R1 is rejected and we inline-port, the existing `onBeforeUnmount` blocks in both popup pages need the `if (shakeTimer) clearTimeout(shakeTimer)` line added — easy to miss; flagged for the audit.

### 7.6 Test fixture drift

`TEST_WALLET_NAME = "Onboarding Test"` is currently typed into the input as the literal string. It still typechecks after the field rename; it's just that the *constant name* is misleading. Rename to `TEST_PROFILE_NAME` as part of P4 to avoid future-contributor confusion.

## 8. Open questions (resolve at approval gate)

| # | Question | Default | Why this is open |
|---|---|---|---|
| Q1 | Duplicate name handling | **(c)** silent allow (status quo) | Adversarial concern is real but the fix isn't free; pick severity. |
| Q2 | `done.vue` "Open wallet" button + "open the wallet from now on" subcopy | **Keep "wallet"** | Refers to opening the *app*, not the account concept. Renaming it to "Open Nulo" works too. |
| Q3 | "Wallet version" string on the About / Settings page (referenced by `tests/e2e/navigation.test.ts:75`) | **Keep "wallet"** | Refers to the app version, not an account. |
| Q4 | Extract `useProfileNameField()` composable (R1) vs. inline-port | **Extract** | CLAUDE.md "same code in 3 places is a refactor signal" — we hit 4. But 4 of 4 copies are inside the same package, and the composable adds ~80 LOC + 10 tests; codex/opus may push back. |
| Q5 | Apply shake-validation UX to `EditProfilePopup.vue` for full surface consistency | **No (defer to follow-up)** | Edit-Profile already works; consistency improvement is bonus, not feature parity. |
| Q6 | Apply `:sanitize` to the new inputs (and retro-apply to onboarding) | **Yes** | Free hardening; aligns with EditProfilePopup. |
| Q7 | Rename `TEST_WALLET_NAME` → `TEST_PROFILE_NAME` constant in tests | **Yes** | Cosmetic but worth the diff to avoid future-contributor confusion. |

## 9. Trade-offs / risks

- **R1 vs. inline-port**: extracting the composable is the cleaner choice but adds a new C0 file + 10 tests + a wiring step in 4 consumers. If approval defers R1, P0 dissolves and the validation block lives inline in 4 places — minor maintenance debt, easy to fix later. Both paths land the feature.
- **Visual regression on onboarding hero**: BrutalistTitle `sub="Wallet"` → `sub="Profile"`. Both words render the same. No layout risk — same letter count (7 vs 7).
- **Notification copy "Profile creation failed" / "Profile import failed"**: changes the searchable string in notification history. If any error-aggregation tooling regex-matches on the old strings, it breaks. There's no such tooling in this repo today.
- **`onboarding-name-input` testid is reused across onboarding's create + import**: confirmed; new popup testids (`register-name-input`, `import-name-input`) avoid the collision.
- **Submit-time validation vs. disabled-button**: onboarding chose submit-time validation deliberately (visible shake + inline error beats silently-disabled-button — see `create.vue:38-42`). Extension flows currently use disabled-button. P1/P2 explicitly flip to submit-time validation; this is a **deliberate UX divergence from the old extension flows**, not a regression.

## 10. Rollout

Single PR. The phases are commit-shaped — each can be a separate commit on a `feat/profile-name-parity` branch — but they land together because:
- P3 (copy) without P1+P2 (extension parity) leaves the extension UX inconsistent with the new "Profile" copy.
- P1+P2 without P3 leaves onboarding still saying "Wallet" — defeats the consistency goal.
- The smoke + network e2e suites verify the full flow; splitting introduces an interim "broken-ish" state in dev.

Branch name: `feat/profile-name-parity`. PR title (Conventional Commit): `feat(extension): add profile-name input + align onboarding copy to "Profile"`. Squash-merge to `dev` per the branch policy.

## 11. Validation gates

Per CLAUDE.md "validate after each step before moving on":

- After P0: `bun run --cwd packages/extension test src/composables/useProfileNameField.test.ts && bun run audit:vue && bun run test:e2e`
- After P1: `bun run audit:vue && bun run test:e2e -- registration.test.ts`
- After P2: `bun run audit:vue && bun run test:e2e -- import-paths.test.ts`
- After P3: `bun run lint && bun run --cwd packages/extension test`
- After P4: `bun run test:e2e && bun run e2e:agent`
- After P5: full `bun run audit:vue` one more time + grep guard
- After P6: address codex review feedback, repeat P5 as needed

## 12. Out of scope (explicitly excluded)

- Internal identifier rename (`ProfileService` → anything, etc.).
- RPC method rename (`createProfile`, `changeProfileName`, …).
- Service-side validation hardening (length cap, charset filter at service layer).
- Storage migration for existing profile names.
- Browser-fingerprint / passkey-credential changes.
- Any "Open wallet" / "Wallet version" copy unless Q2 / Q3 are approved.
- EditProfilePopup UX upgrade unless Q5 is approved.

## 13. Codex / Opus audit asks

Both audits (codex via the codex skill at `xhigh`, opus via Agent subagent) receive this plan with the explicit ask:

> Review for: (a) factual accuracy of the file/line catalog in §4; (b) the test plan in §6 — succinct enough? missing critical case?; (c) the adversarial section in §7 — what would an attacker target? what are we trusting that we shouldn't?; (d) is R1 (the composable extraction) the right call, or is inline-porting cleaner given the consumer count?; (e) are any of the §8 open questions actually closed (i.e., the "default" is wrong)?; (f) any cross-cutting concerns the file catalog missed?

Audit transcripts saved at `audit-codex.md` and `audit-opus.md`.
