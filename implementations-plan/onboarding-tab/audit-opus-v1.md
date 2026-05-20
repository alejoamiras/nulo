# Opus 4.7 review of plan v1

Independent review by an Opus 4.7 agent (general-purpose). Ran in parallel with the Codex v1 review. Verdict: approve-with-fixes, 10 concerns.

---

## 1. L0–L6 adherence — the plan misplaces the new tree

CLAUDE.md says L4 feature modules live at `packages/extension/src/popup/components/modules/`. The plan puts components at `src/onboarding/components/`, peer to `src/popup/`. That's not actually wrong — it mirrors `src/setup/` which is also peer — but it sidesteps the L0–L6 model entirely (the model is scoped to `src/popup/...`). The plan should be explicit: **onboarding is a new HTML entry, not a popup feature**, and therefore it lives peer to `setup/` and `popup/`, NOT inside `popup/components/modules/`.

Concrete recommendation: **add a `biome.json` override** for `packages/extension/src/onboarding/**` that bans imports from `@/popup/pages/*` and `@/popup/windows/*` AND from `@/popup/components/modules/*`. Components shared between popup and onboarding belong in `@/components/composite/` (L3). Today's `popup/components/modules/import/ImportFullBackupForm.vue`, `ImportMethodPicker.vue`, `ImportSecretForm.vue` are L4 — if the plan wants to reuse them verbatim, they need to be PROMOTED to `@/components/composite/` (L3, no store/service deps) OR the onboarding tree should not import them and re-implement the import surface.

## 2. vite-plugin-pages with empty `src/setup/pages/`

vite-plugin-pages 0.33.3 tolerates a missing dir at startup — it just registers zero routes for that prefix. So the plan is fine. The actionable note is: `src/onboarding/pages/` must contain at least one `.vue` file, otherwise `routes` in `index.ts` resolves to `[]` and the app renders an empty `<router-view>`.

## 3. Background `onInstalled` timing — biggest hole in the plan

`wallet/index.ts:43-55` does `logger.rehydrate().then(() => runtime.start())`. `runtime.ts:80-191` then awaits `config.load()`, `BarretenbergSync.initSingleton()` (BB WASM init — seconds), the storage migration, full service-graph startup, then writes liveness. The plan puts `onInstalled` registration INSIDE `runtime.start()`.

`chrome.runtime.onInstalled` fires once, synchronously, the moment the extension is installed. The SW worker boots, parses `wallet/index.ts`, queues all the `.then(...)` work — and the event fires somewhere in that pipeline. If `addListener` hasn't been called yet, **the install event is lost forever** (Chrome buffers `onInstalled` for the synchronous SW eval pass only). On a cold install with no cache and 100MB+ of WASM to fetch, BB init can easily take 5–15s — during which the install event was dispatched but no listener was attached.

**Fix:** register `chrome.runtime.onInstalled` at module top level in `wallet/index.ts` (before `logger.rehydrate()`), not inside `runtime.start()`. The listener body can lazy-import the utility and call it — but the `addListener` itself must run during SW eval, NOT inside a `.then`.

## 4. `chrome.storage.session` and SW restarts

`chrome.storage.session` survives SW suspensions within a browser session — the plan is correct. What the plan glosses over: **between the SW suspending and respawning, the tab id may become stale**. The utility handles this (`chrome.tabs.update` rejects → fall through to create), so the assumption is fine. One bug: `chrome.tabs.update(existingId, {active: true})` followed by `chrome.tabs.get(existingId)` — if `update` rejects (tab gone), the inner `try` swallows it. Good. But there's no concurrency lock. The fix is trivial: a module-local `Promise | null` guard. The plan says "mitigate with a module-level promise lock" without showing the code; the implementation must NOT skip this — popup-mount and `onInstalled` will race on first install.

## 5. `chrome.action.openPopup` from the Done page

`chrome.action.openPopup()` from an extension context (tab) is available in Chrome 99+ but has documented quirks — it requires (a) a user gesture, (b) the action to be visible on the toolbar, (c) the popup is anchored to whichever window is currently focused.

The bigger trap: there's a Chrome bug pre-122 where calling it from a tab on Linux silently no-ops. The plan's fallback to `chrome.windows.create({type: "popup"})` is the right backup, but **the catch block needs to also handle the silent no-op case** — a try/catch won't catch a Promise that resolves to undefined when the popup didn't actually appear.

**The pin-tip and the openPopup CTA are in tension** — they assume the user hasn't pinned, then try to open a popup that requires pinning. Recommend: change "Open wallet" to "Open in a window" with `chrome.windows.create`, and let the user pin-then-click after seeing the tip.

## 6. Passkey ceremony in a tab context

`usePasskeyCeremony` (`src/composables/usePasskeyCeremony.ts:36-65`) is just a Promise wrapper around a child dialog — no `navigator.credentials` calls inline. The actual WebAuthn call lives inside `PasskeyCeremonyDialog.vue`. WebAuthn from a tab context works fine.

**The real concern is the e2e fixture**: `tests/e2e/fixtures/passkey.ts:11-30` documents that virtual authenticators are scoped per-FrameTreeNode. When we move to a tab, the test must set up the authenticator against the **onboarding tab page**.

RP ID: WebAuthn defaults `rpId` to the registrable domain of the origin. For `chrome-extension://<id>`, that's the extension ID. **Identical between popup and onboarding tab** — same extension origin. Credentials created in the tab unlock from the popup and vice versa. The test plan should add a regression test: "tab-created passkey unlocks from popup".

## 7. Existing e2e test scope — bigger than the plan claims

The plan lists 5 files to update. Actual scope:

- `registration.test.ts` — full re-write.
- `passkey-paths.test.ts:40, 50` — depends on `#/popup/register` being the landing page. Same for `passkey-backup.test.ts`.
- `import-paths.test.ts:47-55` — does `openPopup`, then hash-navigates to `/popup/import`. Once the redirect fires, the popup CLOSES before the hash-nav completes. **This test breaks immediately.** Same pattern in `passkey-backup.test.ts:408`.
- `security-reset.test.ts:9-15` — `registeredExtensionPerTest` reset flow lands on `#/popup/register`. After this PR, the popup's register.vue redirects to onboarding tab. **Reset-while-other-profiles-exist** still works (no redirect), but **reset-as-only-profile** breaks.
- `auth-flows.test.ts` — `SelectProfile new-btn routes to /popup/profile/new` at line 82-96: this is the multi-profile "add another" flow, NOT first-install.

**Net scope:** ~8 e2e files, ~2 fixtures, one new test file. The plan's "wherever they call openPopup() and expect the popup register page" undercounts by hiding that the `registerProfile` fixture itself is the root.

## 8. Plan completeness — what's missing

- **testid stability rule.** Plan does not say a word about CLAUDE.md's "every extraction preserves all `data-testid` attributes verbatim". Suggest a testid prefix: `onboarding-`.
- **i18n.** No i18n infrastructure exists. Strings are all inline.
- **Error states on `createProfile` rejection.** `profile/new.vue:101-132` has a full error path with `notificationStore.create` and `ProfileIdConflictError` retry logic. The plan needs to replicate this.
- **Reset between wizard attempts.** If the user enters mismatched passwords twice, what happens? The current `profile/new.vue` has `strengthHint` and `isAllowedToContinue` blocking the button. Plan should reuse this verbatim.
- **`appStore.network` precondition.** `profile/new.vue:142` asserts `appStore.network` exists before fetching accounts. The onboarding tab page must also wait for the SW to be ready.
- **`appStore.isLogined` race.** `profile/new.vue:134-136` does `while (!appStore.isLogined) await sleep(100)`. The onboarding tab needs the same wait or a clean composable around it.
- **Cancel mid-create.** If the user closes the tab during `createProfile`, what happens? The profile is in `chrome.storage.local` but the user never saw the learn/done flow. Next popup open lands on `/popup/auth` (profile exists).
- **`chrome.tabs.create` permission.** Plan says no new permissions. Verified — fine.

## 9. Copy quality

Brand voice ("cold but hand-holding"):

- "Welcome to Nulo." / "A private wallet for Aztec — encrypted by default." — Solid.
- "Create a new wallet" / "Set up a fresh wallet in 30 seconds." — The "30 seconds" is a lie (passkey ceremony alone can take longer). **Rewrite:** "Set up a new wallet. Takes a minute."
- "Use your device's secure enclave (Touch ID, Windows Hello) to protect your wallet. Faster to unlock, never typed." — Too marketing-y. **Rewrite:** "Your passkey replaces a password. Touch ID, Windows Hello, or a hardware key — whichever your device supports."
- "Aztec is the first network with private programmable state..." — "the first" is unverifiable and will age badly. **Rewrite:** "Aztec runs private smart contracts. Your balances, transfers, and calls stay encrypted — visible only to you."
- "Privacy isn't free. Generating proofs takes time. In your browser, a simple transfer can take 10–30 seconds." — Honest. Good. Keep verbatim. Drop "The next screen explains how to make this faster."
- "Aztec Accelerator is a free native app..." — "quietly" is editorial. **Rewrite:** "Aztec Accelerator is a free native app. It proves transactions on your hardware so they finish in seconds instead of half a minute. Lives in your menu bar."
- "You're all set" / "Your wallet is ready. Aztec transactions are now waiting for you." — Second sentence is nonsense ("waiting for you" — for what?). **Rewrite:** "Your wallet is ready."
- "Click the puzzle icon in your toolbar, then pin Nulo for quick access." — Fine. The emoji in plan — strip it; CLAUDE.md says no emojis.

## 10. Risk ordering — what'll bite

Most likely to bite, in order:

1. **`onInstalled` timing** — silently miss the first install event on slow cold boots. Should be risk #1.
2. **e2e fixture cascade** — `registerProfile` in `extension.ts` is the foundation of ~25 tests. Until it's updated to drive the tab, the whole suite breaks.
3. **`chrome.action.openPopup()` quirks** — should default to `chrome.windows.create` from the start on the Done page.
4. **L3/L4 component reuse boundary** — reusing `ImportFullBackupForm`, `ImportMethodPicker`, etc. crosses the L4→L4 boundary horizontally. Promote to L3 or duplicate.
5. **Passkey FrameTreeNode anchoring in e2e** — fixture must use the onboarding tab as the anchor.
6. **Concurrent open** — easy to fix, easy to forget. Show the code.
7. **Width-lock SCSS bleed** — auto-imported components may transitively bring the 360px lock. Audit onboarding bundle for `popup/index.scss` inclusion; expect zero matches.
8. **Windows users without Accelerator binary** — cosmetic; acceptable.

Missing from the risk list:
- onInstalled timing.
- L3/L4 reuse boundary.
- `popup/index.scss` global-selector bleed.
- E2E `registerProfile` fixture cascade.
- onboarding-tab passkey credential is per-FTN → if user navigates the tab during the ceremony, credential is lost mid-flow.

Plan is approvable with these fixes. The single biggest correctness issue is `onInstalled` registration timing in `wallet/index.ts` — that's a real bug that needs to land outside `runtime.start()`.
