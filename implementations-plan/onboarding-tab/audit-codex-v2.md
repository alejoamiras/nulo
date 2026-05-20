**A. Partial**
1. Layer/lint coverage: partial. The fix is directionally right, but the plan points at nonexistent `packages/extension/biome.json`; the real file is repo-root [biome.json](biome.json:207). The sample override shape in [onboarding-plan-v2.md](/tmp/onboarding-plan-v2.md:146) also does not match the current `includes -> linter -> rules -> style -> noRestrictedImports` structure.
2. “Mirror popup, not setup”: partial. Using Pinia/global styles is the right correction, but if you reuse `notificationStore.create` from [profile/new.vue](packages/extension/src/popup/pages/profile/new.vue:101) or `useFullBackupImport`, the onboarding shell also needs popup managers from [popup/app.vue](packages/extension/src/popup/app.vue:311), not just `popup/index.ts` behavior.
3. Vite auto-import dirs: partial. You need to append, not replace. Current AutoImport scans `src/composables`, `src/stores`, and `src/utils` in [vite.config.ts](packages/extension/vite.config.ts:157); v2’s sample drops `src/utils`, which would be a regression.
4. `onInstalled` timing: yes. Moving the listener to top-level [onboarding-plan-v2.md](/tmp/onboarding-plan-v2.md:167) fixes the hard MV3 issue.
5. `openPopup` removal: yes. Replacing it with `chrome.windows.create` in [onboarding-plan-v2.md](/tmp/onboarding-plan-v2.md:476) is the safer path.
6. `storage.session` lifecycle: yes. The caveat handling is honest now.
7. Route hash mismatch: yes. The `#/onboarding/*` fix is consistent.
8. Host permissions for localhost fetch: yes. Adding `http://127.0.0.1/*` is the right correction.

**B. Partial**
- Extracting the inner activation sequence from [popup/app.vue](packages/extension/src/popup/app.vue:75) is realistic: `initNetworks`, `initAccount`, and the “active profile -> appStore -> transactions -> isLogined” block at [popup/app.vue](packages/extension/src/popup/app.vue:164).
- Extracting the whole bootstrap story as one `ensureLogined()` composable is not honest. [popup/app.vue](packages/extension/src/popup/app.vue:189) mixes initial profile load, routing, reconnect behavior, and session-state branching.
- Concrete ask: extract `bootstrapActiveProfile(profile)` and maybe `hydrateKnownProfile()`; keep route pushes and `isBackgroundConnected` watchers local. If schedule matters, duplication with a pin comment is better than a leaky abstraction.

**C. Partial**
- The `onboardingCompleted` gate works for “created profile, closed tab, reopened popup” only if the session is still active.
- Deep-link bypass still exists. [popup/index.ts](packages/extension/src/popup/index.ts:78) explicitly allows `#/popup/profile/new` when no profile exists, and v2 does not gate that route.
- Reset must clear the flag, and the plan does not wire it concretely enough. Current [reset.vue](packages/extension/src/popup/pages/settings/security/reset.vue:39) never touches onboarding state, and the file is not listed among edited files in v2.
- “Second wallet via popup/profile/new after completion” is correct.

**D. No**
- `ensureLogined()` is not sufficient for the locked-session case. It can finish bootstrap after activation, but it cannot recreate a missing session after SW/browser restart.
- That matters because popup auth today is a real branch, not a theoretical one; see [popup/app.vue](packages/extension/src/popup/app.vue:217) and [auth.vue](packages/extension/src/popup/pages/auth.vue:61).
- Concrete ask: onboarding needs an explicit “profile exists but no active session” path. Either route to popup auth and then bounce back, or add an onboarding unlock step. Without that, `profile != null && !onboardingCompleted` is under-specified.

**E. Partial**
- The three SFCs are promotable as-is. [ImportMethodPicker.vue](packages/extension/src/popup/components/modules/import/ImportMethodPicker.vue:1), [ImportSecretForm.vue](packages/extension/src/popup/components/modules/import/ImportSecretForm.vue:1), and [ImportFullBackupForm.vue](packages/extension/src/popup/components/modules/import/ImportFullBackupForm.vue:1) are presentational.
- The full backup stack is not promotable as a unit. [useFullBackupImport.ts](packages/extension/src/popup/components/modules/import/useFullBackupImport.ts:3) imports `useCacheStore` and `usePopupStore` and assumes popup-only viewer plumbing.
- For v1, duplication is the more honest path for the full-backup orchestration unless you first parameterize that composable.

**F. Partial**
- Biggest miss: the proposed regression “tab-created passkey unlocks from popup” is probably not ordinary e2e-testable with the current virtual authenticator model. [fixtures/passkey.ts](packages/extension/tests/e2e/fixtures/passkey.ts:17) says the authenticator is FrameTreeNode-scoped.
- Add a manual smoke requirement for that regression, or introduce a test hook. Do not promise it as routine Puppeteer coverage.
- Add a smoke for direct `#/popup/profile/new` when `onboardingCompleted=false`.
- Add two restart cases: “profile exists + session still active” and “profile exists + session locked”.

**G. No**
- The risk list is still mis-ranked.
- After v2, `onInstalled` timing is mechanical and unlikely to be the thing that bites first.
- Higher-risk items are bootstrap extraction/locked-session semantics, passkey cross-context testability, and the E2E fixture cascade.

Approve-with-fixes