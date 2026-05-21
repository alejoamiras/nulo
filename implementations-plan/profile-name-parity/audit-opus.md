# Opus audit — profile-name parity plan

**Verdict: APPROVE-WITH-FIXES** — feature design is sound and most line-level claims check out, but the plan misses a critical e2e fixture regression and several copy-sweep blind spots that will fail CI.

## Findings

### 1. (HIGH) e2e `registerProfile` fixture will hang post-F1 — plan ignores the blast radius
- `packages/extension/tests/e2e/fixtures/extension.ts:138-172` clicks `register-submit-btn` without ever typing a profile name.
- `packages/extension/tests/e2e/registration.test.ts:42`, `passkey-paths.test.ts:53` (used at L66, L85, L136), `passkey-backup.test.ts:44` do the same.
- After F1, submit calls `validateName()` which returns false on empty input — no profile created, fixture times out. **Every `registeredExtension`-based test breaks.**
- Plan §4.5 only mentions `onboarding-tab.test.ts`. Fix: P1 must update `registerProfile` to type a name into `register-name-input` first, and add the equivalent step in the three test files above.

### 2. (HIGH) e2e import helpers will hang post-F2 — same class of miss
- `packages/extension/tests/e2e/import-paths.test.ts:62-91, 93+, 144+, 540+`, `fixtures/extension.ts:554-559`, `scripts/check-derivation-parity.ts:143-150` set password/secret values but never type into a profile-name input — they rely on the `My Profile N` pre-fill which F2 removes.
- Same fix: every import helper must type into `import-name-input` before clicking the submit button. Plan §5 P2 misses this entirely.

### 3. (HIGH) `useFullBackupImport` discards the typed name — silent UX surprise
- `useFullBackupImport.ts:200,233` uses `data.profile.name` from the backup blob, not the user-typed `profileName`. Plan §5 P2 correctly notes the composable "doesn't reference `profileName`" — but draws the wrong conclusion. After F2, the user can type "Acme" into `import-name-input`, pick "Full backup", and end up with whatever the backup says — name is silently ignored. Either hide the input when `selectedImportOption === "full_backup"` or threading the typed name through `profileService.restore`. Plan needs to pick one explicitly.

### 4. (MED) Copy sweep §4.4 is incomplete — `BrutalistTitle.stories.ts` + several settings/window strings leak "wallet"
- `src/components/ui/BrutalistTitle.stories.ts:20` — `sub: "Wallet"`. Cosmetic but visible in Storybook.
- `src/popup/windows/discover/index.vue:162` — `actionLabel="wants to connect to your wallet"` (user-facing in the dApp connect window).
- `src/popup/pages/settings/security/index.vue:184` — "Automatic wallet locking (minutes)".
- `src/popup/pages/settings/advanced/account-state/senders/index.vue:61` and `settings/fpcs/index.vue:83` — confirm-description copy refers to "your wallet".
- `src/components/Header.vue:249` — `aria-label="Lock wallet"` (announced to screen readers; user-visible).

These are mostly app-name uses (refer to the app, not the account record) — plan §2 row 3 claims the sweep found no leaks "today." Either acknowledge these as app-name usages and explicitly exempt them, or fix them. The current "no leaks" claim is factually wrong.

### 5. (MED) §4.1 [F1] L97 annotation is misleading
- `onboarding/pages/create.vue:97` is `return authMethod.value === "passkey" ? "Create with passkey" : "Create wallet"`. Plan §4.3 C1 lists L97 as `"Create wallet"` → `"Create profile"`. Only half the ternary changes. Fine — but the implementer might miss the passkey branch (which already says "Create with passkey"). Spell it out: change only the password branch.
- Same shape lurks in `popup/pages/profile/new.vue:223`, which uses `Create with ${capitalize(type)}` — works either way, but worth flagging that the popup's submit label is dynamic and won't need a copy edit.

### 6. (MED) Plan §7.1 should hard-block duplicates, not "silent allow"
- Current default (c) is wrong. Profile names render in `AuthProfilePill`, `SelectProfilePopup`, toast notifications, and notification history. Two identical names are not a security issue per se, but they are a real foot-gun: the user can't tell which row is which in the profile picker, and a phishing-adjacent confusion vector exists (malicious dApp instructs the user to "rename your profile to X to receive the airdrop"). EditProfilePopup already has the UI scaffolding (`isAlreadyExist`, "Already exist" warning at L116) — adapting it for cross-profile collision is ~10-15 LOC. Pick option (a) with a `profileService.getProfiles()` call inside `validateName`.

### 7. (MED) `sanitizeString` does NOT defend against homoglyph spoofing
- `src/utils/string.ts:19` strips only non-`[\p{L}0-9 \-._]` chars. RTL/LTR overrides (U+202E) and zero-widths (U+200B–U+200D) ARE in `\p{C}` so they're stripped. But Cyrillic `а` (U+0430) and Latin `a` (U+0061) both match `\p{L}` and pass through. A user can create "Acme" (Latin) and "Аcme" (leading Cyrillic 'А') as visually identical profiles. Plan §7.2 asks to "audit `sanitizeString`'s implementation" — here's the audit: it's NOT a defense against confusable spoofing. Combine with finding #6 (duplicate-block via case-folded comparison + `unorm`/NFKC normalization) to actually neutralize this.

### 8. (LOW) R1 is the right call, but `dispose()` ownership creates an L0–L6 import worry
- 4 consumers crosses CLAUDE.md's "same code in 3 places" threshold cleanly — extract.
- The composable file path in §4.2 is `src/composables/useProfileNameField.ts` (C0 — pure utility, no `chrome.*`). Good.
- The parent must call `dispose()` AFTER service `disconnect()` and BEFORE timer cleanup per CLAUDE.md's cleanup-order rule. Plan §5 P1.1 says "after services, before timers" — correct, but `popup/pages/profile/new.vue` doesn't currently have any service `disconnect()` in `onBeforeUnmount` (L170-174 only removes listeners). Spell out that the `dispose()` call slot is just before the listener teardown.

### 9. (LOW) §6 test plan is right-sized but missing one critical case
- The 10 composable cases are well-shaped — no redundancy. But test case for "trimmed name passing validation" (e.g., `"  Acme  "` → `"Acme"` valid + retained) is missing. Add it; drop case #4 (single non-space char) if you want to stay at 10 — case #5 (exactly 32) already covers the upper boundary.

### 10. (LOW) `clearFormState` divergence between popup + onboarding import
- `popup/pages/import.vue:258` resets `profileName = ""` on Back.
- `onboarding/pages/import.vue:269-280` deliberately KEEPS `profileName`. Comment at L276 explains why.
- After F2 lands, behavior diverges silently between the two surfaces. Pick one and document. The onboarding choice is the better UX.

### 11. (LOW) §4.5 — `TEST_WALLET_NAME` rename is a Q7 "default yes" but P4 lists it as "optional"
- §8 Q7 says default Yes; §5 P4.1 says "Optional". Internally inconsistent. Either commit or drop the option.

### 12. (LOW) Length-cap inconsistency between Edit and Create/Import
- `EditProfilePopup.vue:108` uses `:maxLength="25"`.
- Plan's new inputs use `:maxLength="32"` (matches onboarding).
- A user can create a 32-char name, then enter Edit and find the input refuses to accept their existing value's full length. Pre-existing bug, but plan introduces a new path that exercises it more. Document as a follow-up.

## Disagreements with §8 defaults

- **Q1**: change default from (c) to (a). See #6.
- **Q6** (apply `:sanitize`): yes, but acknowledge that sanitize alone doesn't stop homoglyph spoofing (#7).
- **Q7**: commit, don't "optional".

Everything else in §8 — Q2, Q3, Q4, Q5 — defaults are sound.
