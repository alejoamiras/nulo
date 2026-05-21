# Profile-name Parity — Plan v2

**Status**: post-audit consolidation. Codex v1 verdict was **REJECT** (3 HIGH-level concerns); Opus v1 verdict was **APPROVE-WITH-FIXES** (3 HIGH + 9 MED/LOW). Both flagged the same e2e fixture-breakage class + the `useFullBackupImport` silent-name-drop. Codex additionally caught a pre-existing onboarding bug (same composable, same drop) and a passkey-reset test fallout that Opus missed. This v2 supersedes [plan.md](./plan.md).

## Changes from v1

| Section | v1 said | v2 says | Source |
|---|---|---|---|
| §4.1 | F1 + F2 are the only feature changes | Adds **F3** (full-backup typed-name threading) + **F4** (cross-profile duplicate hard-block) | Codex HIGH #1, Opus MED #6, user Q-NEW1/Q-NEW2 |
| §4.3 | C1–C4 only | Adds **C5** (EditProfilePopup `:maxLength` 25→32) + **C6** (`BrutalistTitle.stories.ts` `sub` arg) | Codex MED #5, Opus MED #4, user Q-NEW3 |
| §4.4 | "Confirmed by grep: no leaks today" | Lists every remaining `[Ww]allet` string in `packages/extension/src` as either *whitelisted* (app-name use, keep) or *rename* | Both auditors MED #4 |
| §4.5 | "no testid selectors break"; "existing tests should still pass unchanged" | Enumerates 9 e2e fixture/test files that MUST be updated alongside F1/F2/F4 | Both auditors HIGH; Codex MED #3 |
| §6 | 10 composable cases + light e2e additions | Adds 4 component-test cases for F3/F4 plumbing; switches new e2e assertions from text-based to attribute/testid-based per `data-testid`-only rule | Codex LOW #6 |
| §7 | "Silent allow duplicates is current behavior" | Wrong — `service.ts:825-840` already auto-suffixes on `restore`. Direct create/import hard-blocks at UI; full-backup keeps service-side auto-suffix | Codex MED #5 |
| §8 | Most defaults marked "open" | Q1, Q5, Q6, plus the new Q-NEW1/2/3 — all resolved at v2 approval gate prework | User picks |

## 0. Context (unchanged from v1)

See [plan.md §0](./plan.md). Two flows (onboarding + extension popup) for creating/importing a profile. Onboarding requires explicit name + says "Wallet"; popup auto-generates name + says "Profile". v2 aligns both on "Profile" and gives both an identical pre-create name UX.

## 1. Decisions locked

| # | Decision | Choice | Source |
|---|---|---|---|
| 1 | Term direction | **"Profile"** wins | User pick |
| 2 | Rename depth | **Variable names tracking the *profile concept* must use "profile."** Existing identifiers already do; one outlier (`TEST_WALLET_NAME` → `TEST_PROFILE_NAME`) is in P6. **App-level identifiers** (`lockWallet`, `openWallet`, `WalletRuntime`, `wallet-sdk/*`) and **public SDK contracts** (`walletId`, `walletName` per `@aztec/wallet-sdk`) stay — they refer to the Nulo app, not the account. RPC method names stay (no wire-format churn). | User pick + clarification 2026-05-21 |
| 3 | Consistency scope | All user-visible surfaces | User pick |
| **4** | **Full-backup typed-name** | **Prefill from backup on file pick.** Parsed name fills the input; user can override; the input's current value is threaded through `useFullBackupImport` → `profile.name` mutation → `ProfileService.restore`. No RPC API change. | User Q-NEW1 |
| **5** | **Duplicate-name policy** | **Hard-block at UI submit-time for direct Create/Import.** Case-folded NFKC compare against `managers.profile.getProfiles()`. **Full-backup keeps service-side auto-suffix** (already in `service.ts:825-840`). | User Q-NEW2 |
| **6** | **Profile-name max length** | **All three flows align at 32.** EditProfilePopup `:maxLength="25"` → 32. | User Q-NEW3 |

## 2. Goals

- Extension's **Create** has a Profile-name input matching onboarding's UX (1–32 chars, trim, submit-time `validateName` + cross-profile collision check, shake + inline error, focus restore).
- Extension's **Import** drops `My Profile N` pre-fill; uses the same validation + collision check.
- Onboarding's `useFullBackupImport`-driven path now honors the user-typed name; popup's gets the same behavior in the same PR.
- Onboarding copy switches Wallet→Profile across all user-visible surfaces.
- EditProfilePopup adopts the same 32-char cap.
- Storybook stories with `sub="Wallet"` flip to `sub="Profile"`.
- All app-name "wallet" surfaces (locking, dApp connect, settings descriptions) are **explicitly whitelisted** in §4.4 — no factual "no leaks" claim.
- Local gate passes: `bun run audit:vue`. Smoke + network e2e suites pass after fixture updates.

## 3. Non-goals (unchanged + additions)

- No internal identifier rename (`ProfileService`, `useProfileBootstrap`, `changeProfileName` RPC, etc.).
- No new RPC API surface — the F3 threading is local to `useFullBackupImport`, mutates the parsed-backup `profile.name` field before passing into the existing `restore()` signature.
- No data migration.
- No app-name rename ("Open wallet" / "Lock wallet" / "Wallet version" / "wallet locking" — see §4.4 whitelist).
- **(new)** No homoglyph defense in this PR. Tracked as follow-up — see §7.2.
- **(new)** No backup-restore name sanitization in this PR. Tracked as follow-up — see §7.3.
- **(new)** No service-side name length cap. UI enforces; RPC accepts arbitrary strings (existing posture).

## 4. Work surface — file catalog

### 4.1 Feature work

#### [F1] `src/popup/pages/profile/new.vue` — add Profile-name field (unchanged from v1)

See [plan.md §4.1 [F1]](./plan.md). v2 detail additions:
- Testid: `register-name-input` (new). **Plus** mark the password and confirm inputs with explicit testids (`register-password-input`, `register-password-confirm-input`) — needed for Codex LOW #6's testid-only e2e rule and currently absent.
- Wire `dispose()` slot: §5 P1.4 spells out cleanup-order placement.

#### [F2] `src/popup/pages/import.vue` — drop pre-fill, add validation parity (unchanged from v1 + F3 plumbing)

See [plan.md §4.1 [F2]](./plan.md). v2 additions:
- Testid: `import-name-input` (new).
- Plumb `profileName` into `useFullBackupImport` (see F3).
- Watch `parsedBackupName` (from composable) and prefill the input when it fires.
- Choose **onboarding's `clearFormState` behavior**: do NOT clear `profileName` on Back. Matches `onboarding/pages/import.vue:269-280` comment. Resolves Opus LOW #10.

#### [F3] `src/composables/useFullBackupImport.ts` — thread user-typed name + expose parsed name *(new)*

Today (`useFullBackupImport.ts:200,233`):
```ts
const profile = data.profile as { id: string; name: string; type: "password" | "passkey" }
// …
const newProfile = await profileService.restore(profile, masterKey, opts.password.value, credentialData)
```

The backup-embedded `profile.name` is what gets stored — the typed `profileName` from the parent page is silently dropped. **This is a pre-existing bug in onboarding today.** Fixing it in this PR closes the bug for both surfaces.

Changes:
1. Add to `UseFullBackupImportOptions`: `profileName?: Ref<string>` — optional reactive name the parent owns.
2. Add to return value: `parsedBackupName: Ref<string | null>` — fired after a backup is successfully parsed (set inside `decryptBackup` for encrypted, inside `pickBackupFile` for plain).
3. Inside `restoreBackup`, before calling `profileService.restore`:
   ```ts
   const override = opts.profileName?.value.trim()
   const profileForRestore = override ? { ...profile, name: override } : profile
   const newProfile = await profileService.restore(profileForRestore, masterKey, opts.password.value, credentialData)
   ```
   Service's existing collision auto-suffix at `service.ts:825-840` still applies — if `override` collides with an existing profile, the saved name becomes `override 1` (consistent with current backup-vs-backup collision semantics).

Parent pages (both popup + onboarding) consume:
```ts
const { parsedBackupName, ... } = useFullBackupImport({ profileName, password, repeatedPassword, ... })

watch(parsedBackupName, (newName) => {
  // Guarded prefill: only fill when the user hasn't typed anything yet.
  // Protects against the race where the user starts typing in the name
  // field BEFORE the file-picker completes parsing — without the guard,
  // a delayed parse on a heavy file would clobber their input.
  if (newName && !profileName.value.trim()) profileName.value = newName
})
```

**Implementation note (Codex v2 finding)**: the composable MUST use the spread-clone pattern (`{ ...profile, name: override }`) before passing to `restore()`, NOT mutate `data.profile.name` in place. The clone keeps the parsed-backup data structure pristine in case the restore fails and needs to be retried with a different name.

Tests: 4 new cases in `useFullBackupImport.test.ts` (see §6.1).

**Why mutate locally instead of adding a 5th `restore()` arg**: avoiding RPC API churn. The mutation is on the locally parsed `data.profile` object; nothing else reads `data.profile.name` after this point in the composable, so the mutation is safe and contained. If a future requirement needs the override at the wire layer (e.g. server-side name validation), promoting to a real parameter is a follow-up.

#### [F4] Cross-profile duplicate hard-block for direct Create/Import *(new)*

Service-side `restore()` already auto-suffixes; direct create/import paths today have no uniqueness check. After F1/F2 force explicit naming, two "My Profile" entries are user-creatable.

UI-layer enforcement in three places:
1. `src/composables/useProfileNameField.ts` (if R1 lands — see §4.2) — extend `validate()` to consult an injected `existingNames: () => string[]` and reject on collision. Or wrap with a second composable `useProfileNameUniqueness({ getNames })`.
2. `popup/pages/profile/new.vue` and `onboarding/pages/create.vue` — pass existing names list at submit time.
3. `popup/pages/import.vue` and `onboarding/pages/import.vue` — same.

Collision check: case-folded NFKC-normalized comparison (`a.normalize("NFKC").toLocaleLowerCase() === b.normalize("NFKC").toLocaleLowerCase()`). Inline error: `"This name is already in use."`. Submit blocked until renamed. Same shake animation.

**Full-backup carve-out**: the duplicate-block does NOT run on full-backup path. The service's restore-time auto-suffix is the right semantic there (backups come pre-named; user shouldn't be blocked from restoring two backups of the same name). The UI input still shows the prefilled backup name; submit succeeds; service auto-suffixes if needed.

EditProfilePopup's existing `isAlreadyExist` check at L34 covers same-name-as-current; extending it to cross-profile collision is a parallel ~10 LOC change. Listed as **optional but recommended** in §4.3 [C5b]; defaults to applying.

### 4.2 Optional refactor — `useProfileNameField()` composable (R1, unchanged from v1 + duplicate hook)

See [plan.md §4.2](./plan.md). v2 additions:
- `validate(opts?: { existingNames?: string[] }): boolean` — **stays sync**. Optional `existingNames` arg powers the F4 duplicate check. The parent fetches the list async via `await managers.profile.getProfiles()` BEFORE calling `validate()`, behind the existing `isCreating` / `isImporting` latch. Sync `validate` preserves the no-race property of today's handlers.
- 11 tests instead of 10 (see §6.1).
- Recommendation unchanged: **extract**.

Plan v2's verdict is still "extract" because the duplicate-check pulls a second piece of shared logic in, raising the cost of inlining four copies. The composable becomes `~110 LOC` instead of `~80 LOC`.

**Parent-side submission shape (the latch is load-bearing):**
```ts
async function handleCreate() {
  if (isCreating.value) return
  isCreating.value = true                                  // ← latch FIRST
  try {
    const existing = (await managers.profile.getProfiles()).map(p => p.name)
    if (!validateName({ existingNames: existing })) {       // sync — no race window
      isCreating.value = false
      return
    }
    // … proceed with profile creation …
  } catch (err) {
    isCreating.value = false
    // … existing error handling …
  }
}
```

**Why sync over async (Codex v2 MED #7)**: the existing handlers latch `isCreating` AFTER validation. If we make `validate()` async, two rapid submit clicks both pass the `isCreating.value` pre-check before either reaches the latch — two profile creates. Keeping `validate()` sync and moving the async fetch to the parent (inside the latch) closes the window.

### 4.3 Onboarding copy alignment (Wallet → Profile)

C1–C4 unchanged from [plan.md §4.3](./plan.md). v2 additions + clarifications:

**[C1] `src/onboarding/pages/create.vue` — L97 nuance** (Opus MED #5):
- L97 is `return authMethod.value === "passkey" ? "Create with passkey" : "Create wallet"`. **Only the password branch flips** — the passkey branch already says "with passkey" (no rename needed). Spell this out for the implementer.

**[C5] `src/popup/components/popups/EditProfilePopup.vue`** *(new — locked decision #6)*
- L108: `:maxLength="25"` → `:maxLength="32"`. Aligns with onboarding + the new popup inputs.
- **[C5b] (optional but recommended)**: Extend the `isAlreadyExist` check at L34 to cross-profile collision (currently only checks `appStore.profile.name === nameTerm`, i.e. same-as-current). Use the same case-folded NFKC compare. Inline warning at L116 already exists; just generalize its trigger.

**[C6] `src/components/ui/BrutalistTitle.stories.ts:20`** *(new — Opus MED #4)*
- `args: { main: "Create", sub: "Wallet" }` → `args: { main: "Create", sub: "Profile" }`. Storybook is a developer-facing surface but it's listed in §3 consistency scope; flip.

### 4.4 Cross-surface whitelist (revised — no more "no leaks" claim)

`grep -rEi '[Ww]allet' packages/extension/src` returns ~50 matches. v1 claimed sweep was clean — incorrect. v2 enumerates and decides explicitly:

**Rename (apply Wallet → Profile)**:
- `src/onboarding/pages/{create,import,welcome,done}.vue` — per §4.3 C1–C4.
- `src/components/ui/BrutalistTitle.stories.ts:20` — per §4.3 C6.

**Whitelist (keep as-is — refer to the app, not the account record)**:
| File:line | String | Why keep |
|---|---|---|
| `popup/windows/discover/index.vue:162` | `actionLabel="wants to connect to your wallet"` | App-name use (dApp connect dialog). "Your wallet" = your Nulo install. |
| `popup/pages/settings/security/index.vue:82,116,184` | "unlock the wallet", "the wallet will never be locked", "Automatic wallet locking (minutes)" | App-name use. Locking is an app-level action. |
| `popup/pages/settings/advanced/account-state/senders/index.vue:61` | `"…won't appear in your wallet"` | App-name use. "Your wallet" = the app's UI. |
| `popup/pages/settings/fpcs/index.vue:83` | (similar app-name confirm description) | App-name use. |
| `components/Header.vue:22,82,117,247,249` | `handleLockWallet`, `handleWalletFailure`, `aria-label="Lock wallet"` | Internal identifier (handlers) + app-level user action (Lock button). |
| `onboarding/pages/done.vue:23,97,107` | `openWallet()`, `"open the wallet from now on"`, `"Open wallet"` button | App-name use ("opening the popup app"). Internal `openWallet()` is a handler name. |
| `wallet/services/passkey/spec.ts:75` and comments in `wallet/services/profile/*.ts` | Function-doc comments referencing the wallet | Documentation about the app/repo. Internal. |
| Various `*.test.ts` files: `lockWallet`, `wallet-lock.test.ts`, `wallet-version` | Test helper names + test file names | Internal/test only. |
| `tests/e2e/passkey-backup.test.ts:82` | `"wallet-version": "test"` | Stable backup JSON field key. **Do NOT rename** — it's a wire-format identifier. |
| `tests/e2e/navigation.test.ts:75` | `text/Wallet version` (About page assertion) | App version, not account. |

This whitelist replaces v1's §4.4 "no leaks" claim. Implementer: do not rename anything in the whitelist column; if a new grep hit surfaces during implementation, add it here.

### 4.5 E2E + test fallout (substantially revised — Codex HIGH #2, MED #3; Opus HIGH #1, #2)

The v1 claim "no testid selectors break, existing tests should still pass unchanged" was wrong. The auto-name behavior of today's flows is a load-bearing implicit assumption for many e2e fixtures.

**Direct breakage from F1 (Create flow): tests submitting `register-submit-btn` without typing a name**
| File:line | What it does today | Needs |
|---|---|---|
| `tests/e2e/fixtures/extension.ts:149-167` | `registerProfile` shared fixture — clicks `register-submit-btn` | Type a name into `register-name-input` before submit. Use new `TEST_PROFILE_NAME` constant. |
| `tests/e2e/registration.test.ts:23-45` | Direct registration smoke | Same |
| `tests/e2e/passkey-paths.test.ts:46-58` | Passkey create paths | Same |
| `tests/e2e/passkey-backup.test.ts:40-45` | Passkey create + backup | Same |

**Direct breakage from F2 (Import flow): tests submitting import buttons without typing a name**
| File:line | What it does today | Needs |
|---|---|---|
| `tests/e2e/import-paths.test.ts:60-91` | `importPlainKey` helper | Type into `import-name-input` before submit |
| `tests/e2e/import-paths.test.ts:93+ (importEncryptedKey)` | Encrypted key import | Same |
| `tests/e2e/import-paths.test.ts:144-160` | `importSeed` helper | Same |
| `tests/e2e/import-paths.test.ts:528-583` | Full-backup import helper | F3 changes the contract: prefill happens after file pick; helper may need a wait, but explicit name-typing not required if backup-prefill is allowed to win. |
| `tests/e2e/fixtures/extension.ts:540-560` | Shared import fixture | Same |
| `tests/e2e/passkey-paths.test.ts:174-194` | **Passkey re-import path**: navigates to `#/popup/import` then clicks `import-option-passkey` without typing a name. The passkey `get` ceremony runs and a profile is created with the auto-name. *(Codex v2 MED #2 — missed in v2.0)* | Type into `import-name-input` BEFORE clicking `import-option-passkey`. Use `TEST_PROFILE_NAME`. |

**Indirect breakage (Codex MED #3 — Opus missed)**
| File:line | What it does today | Needs |
|---|---|---|
| `tests/e2e/passkey-paths.test.ts:141-160` | Asserts destructive-confirm input matches hardcoded `"Profile 1"` | Replace with `getActiveProfileName(page)` from `fixtures/helpers.ts:879-940`. |
| `tests/e2e/passkey-backup.test.ts:383-390` | Same hardcoded-name pattern | Same fix |
| `tests/e2e/fixtures/helpers.ts:879-940` | `getActiveProfileName` already exists | Just consume it |

**Sweep fixtures**
| File:line | Action |
|---|---|
| `tests/e2e/onboarding-tab.test.ts:7` | `TEST_WALLET_NAME` → `TEST_PROFILE_NAME` (value `"Onboarding Test"` unchanged). Locked. |
| `tests/e2e/scripts/check-derivation-parity.ts:143-150` | Verify it uses a fixture or its own setup — adjust if it calls the broken helpers. |

**New testids to introduce in source pages (so e2e can drive them per `data-testid`-only rule):**
- `register-name-input` (F1)
- `register-password-input`, `register-password-confirm-input` (F1 — fixes Codex LOW #6: existing NewProfileCredentials.vue:22-55 has no testids on password inputs, blocking testid-only assertions)
- `import-name-input` (F2)

**Testid-only assertion shape for inline-error checks** (Codex LOW #6 — replaces v1's text-based assertions):
- Submit with empty name → assert `[data-testid="register-name-input"]` has `aria-invalid="true"` (already wired via `:ariaInvalid="!!nameError"` in onboarding's existing input — same pattern in F1/F2).
- For duplicate check: assert `aria-invalid="true"` + the *toast text* "This name is already in use." via the existing `waitForToast` helper (toasts are the one text-assertion exception per CLAUDE.md).

### 4.6 Storybook

No regression risk — the only `.stories.ts` impact is `BrutalistTitle.stories.ts:20` (§4.3 C6). Run `bun run --cwd packages/extension build-storybook` once after C6 to confirm the story still builds.

## 5. Phase plan (revised)

Order: **refactor → feature behavior → copy → fixtures → guards**. Implementing in this order keeps each commit reviewable in isolation.

**P0 — `useProfileNameField` composable (R1)**
1. Write `src/composables/useProfileNameField.ts` (~110 LOC including duplicate-hook plumbing).
2. Write `src/composables/useProfileNameField.test.ts` (11 cases — §6.1).
3. Refactor `onboarding/pages/{create,import}.vue` to consume the composable (no copy changes yet; no F3 yet).
4. Validate: `bun run --cwd packages/extension test src/composables/useProfileNameField.test.ts && bun run audit:vue`.
   E2E smoke at this point should still pass since onboarding behavior is preserved.

**P1 — F3: full-backup typed-name threading**
1. Extend `useFullBackupImport.ts`: add `profileName?: Ref<string>` option + `parsedBackupName: Ref<string | null>` return. Mutate `profile.name` before `restore()`.
2. Update `decryptBackup` to set `parsedBackupName.value = data.profile.name` after successful parse. Same for `pickBackupFile` if plain backup.
3. Add 4 tests to `useFullBackupImport.test.ts` (§6.1).
4. Validate: `bun run --cwd packages/extension test packages/extension/src/composables/useFullBackupImport.test.ts && bun run audit:vue`.
5. **No call-site changes yet** — parent pages don't pass `profileName` in this commit. Behavior identical to today (backward-compatible: when `profileName` opt is absent, override is empty string, falls back to backup name).

**P2 — F1: Extension Create page + F4 duplicate hard-block**
1. Edit `src/popup/pages/profile/new.vue`: consume `useProfileNameField` (with `existingNames`), drop the `getProfiles()` count lookup, add `<Input>` block with `register-name-input`, add `.shake` CSS, plumb `validateName()` into `handleCreate`.
2. Add `register-password-input` / `register-password-confirm-input` testids to `NewProfileCredentials.vue`.
3. Wire `dispose()` in `onBeforeUnmount` before listener teardown (the file's `onBeforeUnmount` is at L170-174 today — only removes listeners; insert `dispose()` immediately before).
4. Update `onboarding/pages/create.vue` to also pass `existingNames` (the duplicate hard-block applies to onboarding too — consistency).
5. Validate: `bun run --cwd packages/extension test src/popup/pages/profile && bun run audit:vue`.

**P3 — F2: Extension Import page + onboarding Import composable wiring**
1. Edit `src/popup/pages/import.vue`: drop `My Profile` pre-fill, drop the `length < 2` guard from `isAllowedToContinue`, consume `useProfileNameField`, add `<Input>` block with `import-name-input`, plumb `validateName()` into each `handleImport*`.
2. Pass `profileName` to `useFullBackupImport` + watch `parsedBackupName` to prefill.
3. Update `onboarding/pages/import.vue` to consume `useFullBackupImport`'s new options + `parsedBackupName` watch.
4. Apply onboarding's `clearFormState` semantics (keep `profileName` on Back) — see [F2] note above. Update popup to match.
5. Validate: `bun run --cwd packages/extension test src/popup/pages/import && bun run audit:vue`.

**P4 — C5 + C6: EditProfilePopup length cap + Storybook story**
1. `EditProfilePopup.vue:108` `:maxLength="25"` → `:maxLength="32"`.
2. (C5b — optional) Extend `isAlreadyExist` at L34 to cross-profile collision. Surface uses `case-folded NFKC compare` like F4.
3. `BrutalistTitle.stories.ts:20` `sub: "Wallet"` → `sub: "Profile"`.
4. Validate: `bun run --cwd packages/extension test src/popup/components/popups/EditProfilePopup.test.ts && bun run --cwd packages/extension build-storybook`.

**P5 — Onboarding copy sweep (C1–C4)**
1. Apply the line-by-line tables in [plan.md §4.3](./plan.md) for `create.vue`, `import.vue`, `welcome.vue`. Use the C1 note that L97 in `create.vue` is a ternary — flip only the password branch.
2. Apply L97/107 in `done.vue` per the whitelist (keep "Open wallet" / "open the wallet"). No change there.
3. Validate: `bun run lint && bun run --cwd packages/extension test`.

**P6 — E2E fixture + test sweep**
1. Add name-typing step to fixtures + tests per §4.5 breakage tables. Use new constant `TEST_PROFILE_NAME = "Onboarding Test"` (drop `TEST_WALLET_NAME`).
2. Replace the two hardcoded `"Profile 1"` assertions (`passkey-paths.test.ts:141-160`, `passkey-backup.test.ts:383-390`) with `getActiveProfileName(page)`.
3. Verify `scripts/check-derivation-parity.ts:143-150` — adjust if it depends on broken helpers.
4. Validate: `bun run test:e2e` (smoke), then `bun run e2e:agent` (network).

**P7 — Final cross-surface grep guard**
1. `grep -rEi '[Ww]allet' packages/extension/src/{onboarding,popup} --include="*.vue"` — confirm hits are only on §4.4 whitelist entries.
2. `bun run audit:vue` (full local gate).

**P8 — Implementation-codex review (per protocol §6)**
Send the implementation diff to codex with the same adversarial ask used in the plan audit. Save transcript to `audit-codex-impl.md`.

## 6. Test plan

### 6.1 Unit / component (Vitest)

**`useProfileNameField.test.ts` — 11 cases** (was 10 in v1; Opus LOW #9 + F4 plumbing):
1. Initial state: empty, no error, no shake.
2. `validate()` false + error on empty.
3. `validate()` false + error on whitespace-only.
4. `validate()` true at exactly 32 chars.
5. `validate()` false + error at 33 chars.
6. **Trimmed name passes validation** (e.g., `"  Acme  "` → trimmed value `"Acme"` retained, validate passes). *(new — Opus LOW #9)*
7. `handleInput()` clears an existing error.
8. `triggerShake()` flips false→true and back after 400ms (fake timers).
9. `nameInputRef.focus()` is called on empty-name validation failure.
10. `dispose()` clears the pending shake timer.
11. **`existingNames` collision: validate false + "This name is already in use." error; case-folded + NFKC-normalized compare** *(new — F4)*

**`useFullBackupImport.test.ts` — add 4 cases** (v1 didn't enumerate; v2 makes them explicit):
1. `parsedBackupName` is null initially.
2. After `pickBackupFile` parse succeeds, `parsedBackupName.value === <backup.profile.name>`.
3. `restoreBackup` with no `profileName` opt uses `profile.name` from backup (regression pin).
4. `restoreBackup` with `profileName.value = "Acme"` calls `profileService.restore` with `profile.name === "Acme"` (mock the client).

**No component-test minimums** for F1/F2/F4 page-level changes (L6 pages exempt per project rule). Covered by e2e.

### 6.2 E2E

**New** in `tests/e2e/registration.test.ts` or a new sibling:
- Submit with empty name → assert `[data-testid="register-name-input"]` has `aria-invalid="true"`; no navigation to `#/popup/general`.
- Submit with duplicate name → existing profile is `"Acme"`; type `"acme"` (case + Unicode normalization test); assert `aria-invalid="true"`; await toast "This name is already in use." via `waitForToast`. *(testid-only + toast exception per project rule)*

**New** in `tests/e2e/import-paths.test.ts`:
- Empty-name submit → `aria-invalid="true"` on `import-name-input`; no `/popup/general`.
- Full-backup happy path: pick a backup with `profile.name = "FromBackup"`; assert `import-name-input` value becomes `"FromBackup"` after parse (testid-only — read `.value` directly).
- Full-backup with user override: pick backup, then `setVal("import-name-input", "Renamed")`; submit; assert resulting profile name (read via existing chrome.storage.local helpers) is `"Renamed"`.

**No new text-based assertions.** Existing `waitForToast` calls stay (toast text is the project's explicit exception).

### 6.3 Tests that should NOT be touched

Anything in the network suite that doesn't go through register/import flows. Network e2e tests like `wallet-lock.test.ts`, `sw-restart-network.test.ts`, etc. are gated on `registeredExtension` fixture — fixture update in P6 carries them.

## 7. Security & adversarial considerations

### 7.1 Duplicate names (resolved by §4 decision #5)

Direct Create/Import hard-blocks at UI submit-time (case-folded NFKC compare). Full-backup keeps service-side auto-suffix (`service.ts:825-840`) — this is the right semantic for restoring two backups with colliding pre-set names.

### 7.2 Homoglyph spoofing (out of scope — flagged for follow-up)

`sanitizeString` (`utils/string.ts:19`) uses `/[^\p{L}0-9 \-._]/gu`. `\p{L}` admits ALL Unicode letters — Cyrillic `А` (U+0410) and Latin `A` (U+0041) both pass. A user (or a malicious dApp instructing the user) can create visually-identical-but-different profiles: `"Acme"` (all Latin) and `"Аcme"` (Cyrillic A + Latin cme).

**Mitigations explicitly NOT in this PR**:
- IDNA-style script-confusable detection (e.g., `unicode-script-runs`).
- NFKC + casefold + script-uniformity check as part of the duplicate hard-block.

**Mitigations IN this PR**:
- NFKC normalization in F4's duplicate check catches some homoglyphs (those that fold). Cyrillic А does NOT NFKC-fold to Latin A, so the bypass is not closed — only narrowed.
- Apply `:sanitize` to `register-name-input` and `import-name-input` (UI sanitization). Matches EditProfilePopup. Strips bidi overrides + zero-widths.

A follow-up issue should track full homoglyph defense; this PR documents the gap.

### 7.3 Backup-restore name sanitization (out of scope — flagged for follow-up)

`useFullBackupImport.ts:200` casts `data.profile as { name: string }` and passes that name straight to `profileService.restore`. A maliciously crafted backup file could embed:
- A name with bidi-override characters.
- A name with extreme length (no service-side cap today).
- A name with unicode confusables.

UI sanitization doesn't help here — the backup never goes through the input.

**Mitigation IN this PR**:
- F3's mutation runs `override?.trim()` and respects the input's `:maxLength="32"` — but only when the user actively retypes. Backup-as-is path retains the unsanitized name.

**Mitigation NOT in this PR**:
- Service-side validation in `ProfileService.restore` (clamp length, strip bidi, validate `\p{L}0-9 \-._` charset).

Follow-up issue should track this.

### 7.4 Cleanup order

The shake timer (`shakeTimer`) is the only async resource the new code introduces. Composable (R1) exposes `dispose()`. Parents call it in `onBeforeUnmount`:

- `popup/pages/profile/new.vue` L170-174: currently only removes the `keydown` listener + clears `scrollEl`. Insert `dispose()` immediately before the listener removal.
- `popup/pages/import.vue` L302-306: same pattern; insert `dispose()` immediately before `removeEventListener`.
- `onboarding/pages/create.vue` L166-172: currently has `if (shakeTimer) clearTimeout(shakeTimer)` inline + secret zeroization. After R1, `clearTimeout` lives in the composable's `dispose()`; the parent calls `dispose()` instead. Keep secret zeroization (defense-in-depth).
- `onboarding/pages/import.vue` L284-291: same.

Codex/Opus did not flag a cleanup-order regression; this section is preventive.

### 7.5 Supply chain

Zero new dependencies. Zero version bumps. Pure internal work.

### 7.6 Test-fixture drift

`TEST_WALLET_NAME` → `TEST_PROFILE_NAME` (P6). Value unchanged. Internal-only constant; no external coupling.

## 8. Open questions — resolved at v2 approval

| # | v1 default | v2 resolution | How |
|---|---|---|---|
| Q1 | Silent allow duplicates | **Hard-block at UI for direct paths; service-side auto-suffix for full-backup** | User Q-NEW2 + Codex MED #5 + §4.1 F4 |
| Q2 | Keep "Open wallet" + "open the wallet" on done.vue | Same (whitelisted per §4.4) | v1 default holds — app-name use |
| Q3 | Keep "Wallet version" on About page | Same (whitelisted per §4.4) | v1 default holds — app-name use |
| Q4 | Extract `useProfileNameField` (R1) | Extract (now ~110 LOC; F4 hook integrated) | v1 + audits agreed |
| Q5 | No EditProfilePopup parity | **Yes (C5)**: length cap bump 25→32. C5b cross-profile collision is optional but recommended. | User Q-NEW3 + Codex MED #5 |
| Q6 | Apply `:sanitize` to new inputs | Yes — UI hardening | v1 default holds + Opus MED #7 (sanitize alone doesn't stop homoglyphs; documented in §7.2) |
| Q7 | Rename `TEST_WALLET_NAME` → `TEST_PROFILE_NAME` | **Commit** (was "optional" in v1 P4; now P6.1 — locked) | Opus LOW #11 |
| **Q-NEW1** | n/a | **Prefill from backup on file pick** (F3) | User |
| **Q-NEW2** | n/a | **Hard-block at submit-time for direct paths** (F4) | User |
| **Q-NEW3** | n/a | **All flows align at maxLength=32** (C5) | User |

No open questions remain. Plan v2 is internally complete; awaiting final codex pass + approval gate.

## 9. Trade-offs / risks

- **Backward compat with `useFullBackupImport`**: P1 introduces optional `profileName` / `parsedBackupName`. Both default to no-op when absent — call sites can adopt incrementally. P3 wires both parent pages in the same commit.
- **`isAllowedToContinue` redefinition in popup/import.vue**: removing the `length < 2` guard means the *submit button is no longer disabled* on empty name — it submits, then `validateName()` shakes. This is the intentional UX flip in §4.1 [F2]. Tests touching the import flow must remove any "button stays disabled" assertions if present.
- **Test surface explosion**: P6 touches 8 e2e files. Each is a small surgical edit (1–3 lines), but the volume is real. The risk is that one of the helpers is shared more widely than the breakage table shows — recommend running `bun run test:e2e` after every two files, not after the full sweep.
- **Race when prefilling from backup**: P3's `watch(parsedBackupName, ...)` fires synchronously after parse. If the user is mid-typing into the name input when they trigger file pick, the watch will clobber their input. Mitigation: prefill only when `profileName.value === ""` (the watch guards this). Documented in F2's watch implementation.
- **EditProfilePopup length-cap migration**: existing profiles up to 32 chars already exist on disk (onboarding writes them today). Bumping the cap is purely permissive — zero migration risk.
- **R1 vs inline-port redux**: v1's "if inline-port, four copies of validation"; v2 has the duplicate-check too. Inlining now means four copies of two patterns. The case for extraction is strictly stronger in v2.
- **Codex MED #5's Q1 concern**: "silent allow isn't current behavior because backup-restore auto-suffixes." Resolved — direct paths get UI hard-block; full-backup keeps auto-suffix.

## 10. Rollout

Single PR (unchanged from v1). Branch: `feat/profile-name-parity`. Squash-merge to `dev`.

PR title (Conventional Commit, lowercase per commitlint):
```
feat(extension): add profile-name input, align onboarding copy, fix full-backup name drop
```

Body covers F1/F2/F3/F4/C1–C6, links to `audit-codex.md` + `audit-opus.md` for context, calls out the e2e fixture sweep, and explicitly lists the §7.2/§7.3 follow-up items.

## 11. Validation gates

| After phase | Command |
|---|---|
| P0 | `bun run --cwd packages/extension test src/composables/useProfileNameField.test.ts && bun run audit:vue && bun run test:e2e` |
| P1 | `bun run --cwd packages/extension test src/composables/useFullBackupImport.test.ts && bun run audit:vue` |
| P2 | `bun run audit:vue && bun run test:e2e -- registration.test.ts` |
| P3 | `bun run audit:vue && bun run test:e2e -- import-paths.test.ts` |
| P4 | `bun run --cwd packages/extension test && bun run --cwd packages/extension build-storybook` |
| P5 | `bun run lint && bun run --cwd packages/extension test` |
| P6 | `bun run test:e2e && bun run e2e:agent` |
| P7 | Full `bun run audit:vue` + grep guard |
| P8 | Codex implementation review; fix loop |

## 12. Out of scope (explicit)

- Internal identifier rename (`ProfileService`, `useProfileBootstrap`, `profile.store`, RPC method names).
- Service-side name validation / hardening (length cap, charset filter, bidi strip).
- Homoglyph defense beyond NFKC normalization (Cyrillic-Latin and other script-mixing).
- Backup-restore-time name sanitization.
- "Open wallet" / "Lock wallet" / "Wallet version" / settings "wallet locking" copy — whitelisted per §4.4 (app-name use).
- Browser-fingerprint / passkey-credential changes.
- EditProfilePopup full UX-parity upgrade (shake animation, focus restore on error) — only the length cap + optional duplicate check land here.

## 13. Audit history

| Version | Date | Codex verdict | Opus verdict | Notes |
|---|---|---|---|---|
| v1 | 2026-05-21 | REJECT (3 HIGH + 3 MED) | APPROVE-WITH-FIXES (3 HIGH + 9 MED/LOW) | Initial draft. Missed full-backup-name drop, e2e fixture blast radius, `"Profile 1"` hardcoded asserts, §4.4 sweep. |
| v2 | 2026-05-21 | **APPROVE-WITH-FIXES (2 MED + 2 LOW)** | (re-review not run; v1 findings all consolidated into v2) | Consolidates both v1 audits + 3 user-locked decisions. Inline edits 2026-05-21 incorporated all 4 Codex v2 findings: passkey-paths re-import in F2 fallout, fpcs whitelist path, sync validate to close the submission race, explicit prefill guard. |

### 13.1 Codex v2 fixes applied inline

| Codex v2 # | Severity | Where | Fix applied in this v2 |
|---|---|---|---|
| #2 | MED | §4.5 F2 fallout | Added `passkey-paths.test.ts:174-194` row to the breakage table. |
| #4 | LOW | §4.4 whitelist | Corrected `popup/pages/settings/advanced/account-state/fpcs/index.vue:83` → `popup/pages/settings/fpcs/index.vue:83`. |
| #7 | MED | §4.2 R1 | `validate()` stays sync; parent fetches `existingNames` async behind the existing `isCreating` latch. Spelled out in the parent-side submission-shape code block. |
| #8 | LOW | §4.1 F3 | Made the prefill `watch` guard explicit (`if (newName && !profileName.value.trim())`) + added the clone-not-mutate implementation note. |

### 13.2 Next steps

1. Approval gate — present consolidated plan + audit verdicts to user.
2. On approval, begin implementation (P0 → P8) per §5.
3. After P8, post-impl codex review (separate session); save to `audit-codex-impl.md`.
