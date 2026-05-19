# Onboarding HTML Page — Implementation Plan v2

**Changes from v1**: incorporates 24 concrete fixes from Codex (REJECT verdict) and Opus 4.7 reviews of v1. Major reframings: (a) onInstalled registration timing, (b) bootstrap orchestration via shared composable, (c) onboardingCompleted gate as the redirect predicate, (d) PasskeyCeremonyDialog teleport target, (e) `host_permissions` for localhost, (f) full e2e fixture overhaul. Copy rewritten throughout.

## 0. Context (unchanged)

Nulo Wallet — Chrome MV3 extension at `/Users/alejoamiras/Projects/nulo/nulo-3`. Vue 3 + Vite + Bun. Today first-time onboarding renders inside the popup; we are moving it to a dedicated full-page HTML tab to mirror Rabby's pattern.

User-confirmed decisions (locked):
- Profile name → required input with placeholder.
- Accelerator step → soft-require (Detect OR explicit Skip).
- Popup register/import → auto-redirect to onboarding tab when onboarding is incomplete.
- Pin-to-toolbar tip on Done screen.
- No recovery education, no network picker, no theme picker in v1.

## 1. Goals & non-goals (unchanged)

(Same as v1; see §1–§2 there.)

## 2. Flow

```
                       ┌──────────────────────────────────────────────────┐
                       │  Background SW — wallet/index.ts top-level       │
                       │  chrome.runtime.onInstalled (sync registered)    │
                       │     reason=='install' → tabs.create              │
                       └──────────────────────┬───────────────────────────┘
                                              │
                                              ▼
            chrome-extension://<id>/src/onboarding/index.html#/onboarding/welcome
                                              │
       ┌──────────────────────────────────────┴─────────────────────────────────┐
       ▼                                                                        ▼
[1] /onboarding/welcome — choose Create or Import                               │
       │                                                                        │
       ├──Create──→ [2a] /onboarding/create — name + auth-method + create ─┐   │
       │                                                                    │   │
       └──Import──→ [2b] /onboarding/import — name + import-method + auth ──┤   │
                                                                            │   │
                                                                            ▼   │
                                                       [3] /onboarding/learn ───┤
                                                                            │   │
                                                       (Skip intro routes to ───┤
                                                       /accelerator, never done) │
                                                                            ▼   │
                                                  [4] /onboarding/accelerator   │
                                                  Continue gated on:            │
                                                    status === "active" OR      │
                                                    explicit Skip-link click    │
                                                                            │   │
                                                                            ▼   │
                                              [5] /onboarding/done — pin-tip + open
                                                                            │   │
                                                                            ▼
                                          set onboardingCompleted = true,
                                          chrome.windows.create({type:"popup"}),
                                          window.close()
```

**Popup redirect predicate** (changed from v1):
- `popup/pages/register.vue` and `popup/pages/import.vue`: on mount, if `!appStore.onboardingCompleted`, call `openOrFocusOnboardingTab()` and `window.close()`. Tab is canonical.
- `popup/pages/profile/new.vue`: unchanged — used only for "add another profile" once `onboardingCompleted = true`.

The `onboardingCompleted` flag lives in `chrome.storage.local` and is hydrated into `appStore` on init.

## 3. File structure (revised)

```
packages/extension/src/onboarding/                       ← NEW peer to src/popup/
├── index.html
├── index.ts                  ← mirrors popup/index.ts: Pinia + global styles + service-clients
├── app.vue                   ← root layout; includes <div id="popup"> teleport target
├── onboarding.scss           ← imports tokens; viewport-width body
├── pages/
│   ├── welcome.vue           ← [1] /onboarding/welcome
│   ├── create.vue            ← [2a] /onboarding/create
│   ├── import.vue            ← [2b] /onboarding/import
│   ├── learn.vue             ← [3] /onboarding/learn
│   ├── accelerator.vue       ← [4] /onboarding/accelerator
│   └── done.vue              ← [5] /onboarding/done
├── components/
│   ├── StepHeader.vue
│   ├── AcceleratorStatusCard.vue
│   ├── ConceptCard.vue
│   └── PinToToolbarTip.vue
└── composables/
    └── useAcceleratorStatus.ts

packages/extension/src/composables/                      ← extended
└── useProfileBootstrap.ts    ← NEW; extracts popup/app.vue's onActiveProfileChanged orchestration

packages/extension/src/wallet/utils/                     ← extended
└── onboarding-tab.ts         ← NEW; module-level promise lock + open/focus
```

Edited files:
- `packages/extension/vite.config.ts` — add onboarding entry, pages dir, **append** onboarding dirs to existing auto-import (`src/composables`, `src/stores`, `src/utils`) + auto-component (`src/components`) globs.
- `/Users/alejoamiras/Projects/nulo/nulo-3/biome.json` (repo root, not packages/extension) — add `noRestrictedImports` override for `src/onboarding/**` using the existing structure at biome.json:207.
- `packages/extension/manifest/manifest.config.ts` — add `host_permissions: ["http://127.0.0.1/*"]`.
- `packages/extension/src/wallet/index.ts` — register `onInstalled` listener at module top level.
- `packages/extension/src/wallet/runtime.ts` — no change (listener moved out of here).
- `packages/extension/src/popup/index.ts` — hydrate `appStore.onboardingCompleted` on init.
- `packages/extension/src/popup/app.vue` — refactor `onActiveProfileChanged` to call `bootstrapActiveProfile(profile)`. Routing + reconnect watchers stay in `popup/app.vue` (do NOT extract).
- `packages/extension/src/popup/pages/register.vue` — redirect-on-mount.
- `packages/extension/src/popup/pages/import.vue` — redirect-on-mount when not onboarded.
- `packages/extension/src/popup/pages/profile/new.vue` — redirect-on-mount when **no profile exists AND !onboardingCompleted**. When a profile already exists (add-another flow), unchanged behavior.
- `packages/extension/src/popup/pages/settings/security/reset.vue` — clear `onboardingCompleted` flag when resetting profile (so the user is sent back through onboarding on next setup).
- `packages/extension/src/stores/app.store.ts` — add `onboardingCompleted` ref + setter.
- `packages/extension/tests/e2e/fixtures/extension.ts` — overhaul `registerProfile()` to drive tab + bypass remaining onboarding steps via storage seeding.

Optionally L4→L3 promotions (decided during implementation):
- `popup/components/modules/import/ImportFullBackupForm.vue` → `components/composite/ImportFullBackupForm.vue` if reused by onboarding.
- `popup/components/modules/import/ImportMethodPicker.vue` → `components/composite/`.
- `popup/components/modules/import/ImportSecretForm.vue` → `components/composite/`.
- If reuse becomes painful, duplicate instead.

## 4. Vite + manifest changes

`packages/extension/vite.config.ts`:

```ts
// rollupOptions.input — add:
onboarding: "src/onboarding/index.html",

// usePages — append:
{ dir: "src/onboarding/pages", baseRoute: "onboarding" }

// AutoImport plugin — APPEND (current scan: src/composables, src/stores, src/utils):
dirs: ["src/composables", "src/stores", "src/utils", "src/onboarding/composables"]

// Components plugin — APPEND (current scan: src/components):
dirs: ["src/components", "src/onboarding/components"]
```

⚠ Critical: do NOT replace the existing dirs lists — append only. Codex flagged that v2 draft dropped `src/utils` from AutoImport.

`packages/extension/manifest/manifest.config.ts`:

```ts
// Add host_permissions for the local accelerator:
host_permissions: [
  ...(existing entries),
  "http://127.0.0.1/*",
]
```

No new chrome permissions required. `chrome.tabs.create` for an extension URL does not require the `"tabs"` permission. `chrome.windows.create` likewise.

**Biome override is in the REPO-ROOT `biome.json`, NOT `packages/extension/biome.json`.**

`/Users/alejoamiras/Projects/nulo/nulo-3/biome.json` — extend the existing `includes` → `linter` → `rules` → `style` → `noRestrictedImports` structure at biome.json:207. Locate the existing override pattern that bans imports from popup pages into modules; add a sibling override scoped to `packages/extension/src/onboarding/**`:

```jsonc
// Conceptual shape (must match the actual schema used at biome.json:207):
{
  "includes": ["packages/extension/src/onboarding/**"],
  "linter": {
    "rules": {
      "style": {
        "noRestrictedImports": {
          "level": "error",
          "options": {
            "paths": {
              "@/popup/pages/*": "onboarding cannot import popup pages",
              "@/popup/windows/*": "onboarding cannot import popup windows",
              "@/popup/components/modules/*": "promote shared modules to @/components/composite"
            }
          }
        }
      }
    }
  }
}
```

Verify the exact key names against the existing overrides in `biome.json` during implementation — Biome's schema is strict about `paths` vs `noRestrictedImports.paths` and `includes` vs `include`.

## 5. Background SW changes

**Listener registration MUST be synchronous at SW eval time.**

`packages/extension/src/wallet/index.ts` — top-level addition (BEFORE the `logger.rehydrate().then(runtime.start)` chain at line ~47):

```ts
// MUST run at SW eval time, not inside runtime.start() — Chrome dispatches
// onInstalled once, synchronously, when the SW boots after install.
// Late addListener calls miss the historic event.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return  // skip update / chrome_update / shared_module_update
  const { openOrFocusOnboardingTab } = await import("./utils/onboarding-tab")
  await openOrFocusOnboardingTab()
})
```

`packages/extension/src/wallet/utils/onboarding-tab.ts` — full code with promise lock:

```ts
const TAB_ID_KEY = "nulo:onboarding:tab-id"
const ONBOARDING_PATH = "src/onboarding/index.html#/onboarding/welcome"

let inFlight: Promise<void> | null = null

export function openOrFocusOnboardingTab(): Promise<void> {
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      const stored = await chrome.storage.session.get(TAB_ID_KEY)
      const existingId = stored[TAB_ID_KEY] as number | undefined
      if (typeof existingId === "number") {
        try {
          const tab = await chrome.tabs.get(existingId)
          await chrome.tabs.update(existingId, { active: true })
          if (tab.windowId !== undefined) {
            await chrome.windows.update(tab.windowId, { focused: true })
          }
          return
        } catch {
          // Tab was closed; fall through to fresh create.
        }
      }
      const url = chrome.runtime.getURL(ONBOARDING_PATH)
      const tab = await chrome.tabs.create({ url })
      if (typeof tab.id === "number") {
        await chrome.storage.session.set({ [TAB_ID_KEY]: tab.id })
      }
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}
```

The lock prevents `onInstalled` + popup-mount double-fire from opening two tabs.

Known caveat: `chrome.storage.session` is cleared on reload/update/disable/browser-restart. After such an event, the next open call falls through to create — yielding a duplicate tab if the previous one is still alive. Acceptable: rare, user can close it. Documented in §11.

## 6. Bootstrap orchestration — narrow composable, NOT whole-story

`profile/new.vue:134` and `import.vue:120` both depend on `appStore.isLogined` being flipped by `popup/app.vue:164`'s `onActiveProfileChanged` handler. The onboarding tab needs the same orchestration — but **scoped narrowly**.

**Extract only the inner activation sequence** into `packages/extension/src/composables/useProfileBootstrap.ts`:

```ts
// Just the "active profile → networks → accounts → isLogined" chain.
// Routing, reconnect watchers, isBackgroundConnected state — all STAY in popup/app.vue
// and get duplicated (or carefully ported) in onboarding/app.vue.
export function useProfileBootstrap() {
  async function bootstrapActiveProfile(profile: Profile): Promise<void> {
    // factored from popup/app.vue:164 — initNetworks, initAccount,
    // appStore writes, transactions hydrate, flip isLogined
  }

  async function hydrateKnownProfile(): Promise<void> {
    // optional second extract for the initial profile-load path
  }

  return { bootstrapActiveProfile, hydrateKnownProfile }
}
```

Codex v2 critique: extracting the WHOLE bootstrap story (route pushes, reconnect watchers, session-state branching) as one `ensureLogined()` is a leaky abstraction. Stay narrow.

**Popup managers dependency**: if the onboarding flow reuses `notificationStore.create` from `profile/new.vue:101` or `useFullBackupImport`, the onboarding shell also needs the manager setup currently in `popup/app.vue:311` (cacheStore/popupStore-backed managers). Document this in the onboarding `index.ts` setup; the manager setup itself can stay in popup/app.vue but the onboarding shell needs to instantiate equivalents.

**Fallback**: if `bootstrapActiveProfile` extraction is painful, duplicate the orchestration block into `onboarding/app.vue` with a pin comment. **Duplication > leaky abstraction.**

Risk note: this is now the #1 implementation risk per Codex (was #3 in v1).

## 7. Popup changes

`packages/extension/src/stores/app.store.ts` — add:

```ts
const onboardingCompleted = ref<boolean>(false)
async function loadOnboardingCompleted() {
  const v = await chrome.storage.local.get("nulo:onboarding:completed")
  onboardingCompleted.value = v["nulo:onboarding:completed"] === true
}
async function setOnboardingCompleted(value: boolean) {
  onboardingCompleted.value = value
  await chrome.storage.local.set({ "nulo:onboarding:completed": value })
}
```

`packages/extension/src/popup/index.ts` — call `appStore.loadOnboardingCompleted()` during init (alongside the existing `initAppServiceContext`).

`packages/extension/src/popup/pages/register.vue`, `popup/pages/import.vue`, **AND `popup/pages/profile/new.vue`** — add to setup script:

```ts
onBeforeMount(async () => {
  // Redirect when:
  //  - onboarding isn't complete AND there's no profile yet, OR
  //  - register.vue specifically (no-profile route, always redirect when incomplete)
  // For profile/new.vue: only redirect if no profile exists. With a profile, "add another"
  // is a legitimate post-onboarding action.
  const isFirstProfile = appStore.profiles.length === 0
  if (appStore.onboardingCompleted && !isFirstProfile) return
  if (!isFirstProfile) return  // post-onboarding add-another for profile/new.vue + import.vue
  const { openOrFocusOnboardingTab } = await import("@/wallet/utils/onboarding-tab")
  await openOrFocusOnboardingTab()
  window.close()
})
```

`popup/pages/settings/security/reset.vue` — when resetting profile, also clear `onboardingCompleted`:

```ts
// In the existing reset handler, after wiping profile data:
await appStore.setOnboardingCompleted(false)
```

This ensures a fresh-reset user is sent back through onboarding on their next setup attempt.

**Onboarding tab on mount** — branch on profile presence AND session-active state (Codex v2 D fix):

```ts
onMounted(async () => {
  await appStore.loadOnboardingCompleted()

  if (appStore.onboardingCompleted) {
    // User landed on onboarding URL after completion. Punt to popup window.
    await chrome.windows.create({
      url: chrome.runtime.getURL("src/popup/index.html"),
      type: "popup", width: 380, height: 620,
    })
    await chrome.storage.session.remove("nulo:onboarding:tab-id")
    window.close()
    return
  }

  if (appStore.profile == null) {
    // No profile yet → /welcome (default route, no action needed)
    return
  }

  // Profile exists but onboarding incomplete. Two sub-cases:
  if (appStore.isLogined) {
    // Session active → resume at /learn
    router.replace("/onboarding/learn")
  } else {
    // Profile locked. Bounce to popup auth; after unlock, popup's register/import
    // redirect predicate will re-open this tab and re-evaluate (now isLogined === true).
    await chrome.windows.create({
      url: chrome.runtime.getURL("src/popup/index.html"),
      type: "popup", width: 380, height: 620,
    })
    window.close()
  }
})
```

The locked-session bounce is the simplest correct behavior; we accept a popup hop rather than building an in-onboarding unlock UI. The popup auth flow already exists.

## 8. Onboarding tab implementation

### 8.1 Shell (`app.vue`)

```vue
<script setup lang="ts">
import { onMounted } from "vue"
import { useRouter } from "vue-router"
import { useAppStore } from "@/stores/app.store"
import { useProfileBootstrap } from "@/composables/useProfileBootstrap"
import StepHeader from "./components/StepHeader.vue"

const router = useRouter()
const appStore = useAppStore()
const { ensureLogined } = useProfileBootstrap()

onMounted(async () => {
  await appStore.loadOnboardingCompleted()
  if (appStore.onboardingCompleted) {
    router.replace("/onboarding/done?completed=1")
    return
  }
  if (appStore.profile != null) {
    await ensureLogined()
    router.replace("/onboarding/learn")
    return
  }
  // No profile → start from welcome (default route)
})
</script>

<template>
  <main :class="$style.shell">
    <StepHeader />
    <router-view v-slot="{ Component }">
      <transition name="onboarding-fade" mode="out-in">
        <component :is="Component" :key="$route.path" />
      </transition>
    </router-view>
    <!-- PasskeyCeremonyDialog teleports here. Must remain present in the DOM. -->
    <div id="popup" />
  </main>
</template>

<style module>
.shell {
  /* Centered card, max-width ~720px */
}
</style>
```

The `<div id="popup">` matches the teleport target in `popup/components/popups/PasskeyCeremonyDialog.vue:82` (`<Teleport to="#popup">`). Without this, passkey dialogs created from the tab silently fail to render.

### 8.2 Width-lock audit

`packages/extension/src/popup/index.scss:11-15` pins `body { width: var(--base-width) }` to 360px. The onboarding bundle MUST NOT include this file (directly or transitively via any auto-imported component). The `onboarding.scss` declares its own body rules (viewport width, scroll handling). At build time, grep the onboarding bundle for `--base-width: 360px` — if found, an auto-imported component pulled in the popup styles transitively, and we need to either (a) move the rule from `popup/index.scss` into a scoped popup-only stylesheet, or (b) override `--base-width: 100%` in `onboarding.scss`. Note in test plan as a build-output assertion.

### 8.3 Welcome — `pages/welcome.vue`

Two CTA cards, stacked vertically.

Copy:
- Hero: "Welcome to Nulo." / "A private wallet for Aztec."
- Create CTA: "Create a new wallet" / "Takes about a minute."
- Import CTA: "Import an existing wallet" / "Restore from a seed, key, or backup."

Testids: `onboarding-welcome-create`, `onboarding-welcome-import`.

### 8.4 Create — `pages/create.vue`

Form:
- Profile name `<Input>` — required, placeholder `"My Wallet"`, max 32 chars.
- Auth method tabs — Password / Passkey.
- **Password mode**: password + confirm + strength meter (reuse the strength-check logic from `popup/pages/profile/new.vue`).
- **Passkey mode**: explainer + create button. Calls `usePasskeyCeremony({mode:"create", userHandle: tempId})`. **Port the retry-on-`ProfileIdConflictError` loop verbatim from `popup/pages/profile/new.vue:74-90`**.

Error handling: replicate `notificationStore.create` calls from `profile/new.vue:101-132`. UserRejectedError on passkey cancel → silent return.

**Sensitive material clearing**: explicit zeroing on `onBeforeUnmount`:

```ts
onBeforeUnmount(() => {
  password.value = ""
  confirm.value = ""
})
```

Post-submit:
- Call `managers.profile.createProfile(name, password)` (password) or `createPasskeyProfile(name, credData)` (passkey).
- Await `useProfileBootstrap().ensureLogined()`.
- `router.push("/onboarding/learn")`.

Testids: `onboarding-name-input`, `onboarding-method-password`, `onboarding-method-passkey`, `onboarding-password-input`, `onboarding-password-confirm`, `onboarding-submit-create`.

### 8.5 Import — `pages/import.vue`

Same name field. Method dropdown (Seed / Private key / Public key / Passkey / Full backup).

**Component reuse strategy (revised per Codex v2 E):**
- `ImportMethodPicker.vue`, `ImportSecretForm.vue`, `ImportFullBackupForm.vue` (the three SFCs) — **promotable** from `popup/components/modules/import/` to `@/components/composite/` (L3). They are presentational and don't import popup-only stores.
- `useFullBackupImport.ts` — **NOT promotable as-is**. It imports `useCacheStore` and `usePopupStore` and assumes popup-only viewer plumbing. For v1: **duplicate** the composable into `onboarding/composables/useFullBackupImport.ts`, adapting the popup-store dependencies to onboarding equivalents (or a thin replacement). Refactor in a follow-up PR.

Sensitive material clearing: same `onBeforeUnmount` pattern; clear seed, private-key, password fields.

Post-submit: same bootstrap + `router.push("/onboarding/learn")`.

Testids: `onboarding-name-input` (shared), `onboarding-import-method`, `onboarding-import-secret`, `onboarding-import-password`, `onboarding-submit-import`.

### 8.6 Learn — `pages/learn.vue`

Title: "Meet Aztec"

Three `<ConceptCard>`s — final copy (Codex + Opus consolidated rewrites):

| Card | Title | Body |
|------|-------|------|
| 1 | "Programmable privacy" | "Aztec runs private smart contracts. Your balances, transfers, and calls stay encrypted — visible only to you." |
| 2 | "Proofs run on your machine" | "Every transaction generates a zero-knowledge proof on your machine. The network only sees the proof — never your inputs." |
| 3 | "Proofs take time" | "In the browser, a simple transfer can take 10–30 seconds. The next screen explains how to speed this up." |

Primary CTA: "Continue" → `router.push("/onboarding/accelerator")`.
Secondary text link: "Skip intro" → routes to `/onboarding/accelerator` (NOT `/done` — the accelerator step still gates progression).

Testids: `onboarding-learn-continue`, `onboarding-learn-skip`.

### 8.7 Accelerator — `pages/accelerator.vue`

Title: "Speed up proving"
Subtitle: "Aztec Accelerator runs proving outside the browser, on this device. It lives in your menu bar."

`<AcceleratorStatusCard>` — five visual states:

| Status | Visual | Body copy | Actions |
|--------|--------|-----------|---------|
| `idle` | — | (transient; immediately becomes `detecting`) | — |
| `detecting` | spinner | "Looking for Aztec Accelerator..." | — |
| `not-detected` | red dot | "Not detected. Proofs will run in your browser (slower)." | [Download for {OS}] [Test connection] |
| `no-bb` | yellow dot | "Detected. Aztec Accelerator is still installing its proving binary — open the menu-bar app and wait for setup to finish." | [Test connection] |
| `active` | green check | "Active. Aztec runtime {aztec_version}." | [Re-test] |

Auto-detect on mount via `useAcceleratorStatus()`. Continue button gated:
- Enabled when `status === "active"` OR user has clicked the Skip-link.
- Skip-link copy: "Skip — proving will run in your browser." Sets a local `acceleratorAcknowledgedSkip` flag and enables Continue (does NOT auto-route).

The Skip-link satisfies the locked "must click Detect or explicit Skip" decision — the user must take a deliberate action when detection fails.

OS detection for Download CTA — `navigator.userAgent` matching:
- macOS Apple Silicon / Intel → matching .dmg link
- Linux → .deb or .AppImage
- Windows → CTA disabled with subtitle "Aztec Accelerator isn't available on Windows yet."

Testids: `onboarding-accelerator-status`, `onboarding-accelerator-test`, `onboarding-accelerator-download`, `onboarding-accelerator-skip`, `onboarding-accelerator-continue`.

### 8.8 useAcceleratorStatus composable

```ts
type Status = "idle" | "detecting" | "not-detected" | "no-bb" | "active"

export function useAcceleratorStatus() {
  const status = ref<Status>("idle")
  const info = ref<{ version?: string; aztec_version?: string } | null>(null)

  async function detect() {
    status.value = "detecting"
    try {
      const r = await fetch("http://127.0.0.1:59833/health", {
        signal: AbortSignal.timeout(2000),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = (await r.json()) as {
        status: string
        version: string
        aztec_version: string
        bb_available: boolean
      }
      info.value = { version: data.version, aztec_version: data.aztec_version }
      status.value = data.bb_available ? "active" : "no-bb"
    } catch {
      info.value = null
      status.value = "not-detected"
    }
  }

  onMounted(detect)
  return { status, info, detect }
}
```

CORS confirmed open (`Access-Control-Allow-Origin: *` from accelerator's `server.rs:107-114`). With `host_permissions: ["http://127.0.0.1/*"]` added to the manifest, this fetch is unambiguously allowed regardless of Chrome's MV3 cross-origin defaults.

### 8.9 Done — `pages/done.vue`

Copy:
- Title: "You're all set."
- Body: "Your wallet is ready."
- Pin tip: "Click the puzzle icon in your toolbar, then pin Nulo for quick access." (No emoji.)
- Primary CTA: "Open wallet"

Click handler:

```ts
async function openWallet() {
  await appStore.setOnboardingCompleted(true)
  await chrome.storage.session.remove("nulo:onboarding:tab-id")
  // Skip chrome.action.openPopup — the user almost certainly hasn't pinned yet,
  // and openPopup tied to action visibility is unreliable across Chrome versions.
  // Open a popup-shaped window directly. The pin-tip educates them how to find
  // the toolbar icon next time.
  await chrome.windows.create({
    url: chrome.runtime.getURL("src/popup/index.html"),
    type: "popup",
    width: 380,
    height: 620,
  })
  window.close()
}
```

If the URL has `?completed=1` query (user landed on Done from a re-visit), skip the storage write and just open the popup-window.

Testids: `onboarding-done-open`, `onboarding-pin-tip`.

## 9. State management within the wizard (revised)

- `appStore.onboardingCompleted` is the durable signal (`chrome.storage.local`-backed).
- Wizard form state stays local to each page (refs in setup script). Cleared on unmount.
- The `useProfileBootstrap()` composable encapsulates the "profile → networks → accounts → isLogined" chain. Both popup and onboarding tab use it.
- No persistence across tab close for in-progress form data (matches Rabby; security trade-off).

## 10. Aztec accelerator detection — security model (revised)

- **`host_permissions: ["http://127.0.0.1/*"]`** added to the manifest. This is the canonical authorization for the fetch and removes any doubt about MV3 cross-origin behavior.
- CORS still authoritative on the response side (accelerator emits `Access-Control-Allow-Origin: *`).
- `/health` is unauthenticated; no site-authorization prompt from the accelerator.
- Mixed-content does not apply (extension origin → loopback HTTP is allowed).
- Timeout 2 s.

## 11. Re-entry behavior (revised)

| Scenario | Behavior |
|----------|----------|
| Cold install | `onInstalled.addListener` (registered synchronously at SW eval) opens the tab via `openOrFocusOnboardingTab()`. |
| User closes tab mid-wizard | Tab id is stale in `chrome.storage.session`. Next popup click finds the key, `chrome.tabs.get` rejects, falls through to fresh tab. |
| User refreshes the tab mid-wizard | Vue router re-renders the same route. Form state lost (refs reinit). |
| User opens a second context (popup + tab race) | Module-level `inFlight` lock ensures one tab. |
| User closes tab AFTER profile creation but BEFORE Done | `onboardingCompleted` is still false. Next popup click sees `!onboardingCompleted`, redirects to tab. Tab on mount sees `profile != null && !onboardingCompleted` → routes to `/onboarding/learn` (the user resumes after the create/import step). |
| User completes onboarding, popup later opens fine | `onboardingCompleted = true`; register.vue and import.vue see it, do not redirect; popup flows normally. |
| User uninstalls + reinstalls | `chrome.storage.local` is wiped; `onboardingCompleted` is false on next boot. `onInstalled` fires; tab opens. |
| Browser restart with onboarding incomplete | `chrome.storage.session` cleared; tab id gone. Profile may exist in `chrome.storage.local`; `onboardingCompleted` is the truth. Next popup click reads `!onboardingCompleted`, opens fresh tab; tab routes to `/onboarding/learn` if profile exists. |
| Browser shows a duplicate onboarding tab (rare; storage.session cleared but old tab still alive) | User can close one. Acceptable degradation. |
| User reset profile from settings | Settings deletes the profile + clears `onboardingCompleted`. Next popup click triggers redirect. |

## 12. Copy strings — final v2 draft

(All copy is draft; final review during implementation. Brand voice: cold, direct, no fluff, no emojis.)

**Welcome (`/onboarding/welcome`):**
- Hero: "Welcome to Nulo." / "A private wallet for Aztec."
- Create card title: "Create a new wallet"
- Create card body: "Takes about a minute."
- Import card title: "Import an existing wallet"
- Import card body: "Restore from a seed, key, or backup."

**Create (`/onboarding/create`):**
- Page title: "Set up your wallet"
- Name field label: "Wallet name"
- Name field placeholder: "My Wallet"
- Auth tabs: "Password" / "Passkey"
- Passkey body: "Your passkey replaces a password. Touch ID, Windows Hello, or a hardware key — whichever your device supports."
- Submit button: "Create wallet"

**Import (`/onboarding/import`):**
- Page title: "Import your wallet"
- Name field placeholder: "My Wallet"
- Method picker label: "Import method"
- Submit button: "Import wallet"

**Learn (`/onboarding/learn`):**
- Page title: "Meet Aztec"
- Card 1: "Programmable privacy" / "Aztec runs private smart contracts. Your balances, transfers, and calls stay encrypted — visible only to you."
- Card 2: "Proofs run on your machine" / "Every transaction generates a zero-knowledge proof on your machine. The network only sees the proof — never your inputs."
- Card 3: "Proofs take time" / "In the browser, a simple transfer can take 10–30 seconds. The next screen explains how to speed this up."
- Continue: "Continue"
- Skip link: "Skip intro"

**Accelerator (`/onboarding/accelerator`):**
- Page title: "Speed up proving"
- Subtitle: "Aztec Accelerator runs proving outside the browser, on this device. It lives in your menu bar."
- Status (not-detected): "Not detected. Proofs will run in your browser (slower)."
- Status (no-bb): "Detected. Aztec Accelerator is still installing its proving binary — open the menu-bar app and wait for setup to finish."
- Status (active): "Active. Aztec runtime {aztec_version}."
- Download button label: "Download for {OS}" (e.g. "Download for macOS")
- Test button label: "Test connection"
- Skip link: "Skip — proving will run in your browser."
- Continue: "Continue"
- Windows variant subtitle: "Aztec Accelerator isn't available on Windows yet."

**Done (`/onboarding/done`):**
- Page title: "You're all set."
- Body: "Your wallet is ready."
- Pin tip: "Click the puzzle icon in your toolbar, then pin Nulo for quick access."
- Primary button: "Open wallet"

## 13. Test plan

### 13.1 Unit tests

- `wallet/utils/onboarding-tab.test.ts` (5 cases):
  - Opens fresh tab when no stored id; stores id.
  - Reuses live stored id.
  - Falls through to create when `chrome.tabs.get` rejects.
  - Concurrent calls share the in-flight promise.
  - Stored id cleared from `chrome.storage.session` on completion via Done page (covered by integration; not unit).
- `wallet/index.test.ts` (or extend existing) — `onInstalled` listener:
  - Registered at module evaluation (regression: verify by importing the module and asserting `chrome.runtime.onInstalled.addListener` was called synchronously).
  - Filters `reason: "install"` only.
- `composables/useAcceleratorStatus.test.ts` (5 cases):
  - mount → detecting → active when fetch succeeds with `bb_available: true`.
  - active without bb → `no-bb`.
  - HTTP error → `not-detected`.
  - timeout → `not-detected`.
  - manual `detect()` cycles state.
- `composables/useProfileBootstrap.test.ts` (≥10 — composable coverage minimum per CLAUDE.md):
  - `ensureLogined` resolves after profile activation.
  - Idempotent: second call returns immediately.
  - Disposes cleanly.
  - Handles missing network gracefully.
  - Etc.

### 13.2 Component tests

- `onboarding/components/AcceleratorStatusCard.test.ts` (≥6): renders each of 5 states; Test button emits `test`; Skip link emits `skip`.
- `onboarding/components/StepHeader.test.ts` (≥3): current step highlighted; arrow-only progression.
- `onboarding/components/PinToToolbarTip.test.ts` (≥2): renders icon + text.
- `onboarding/components/ConceptCard.test.ts` (≥3): title + body + icon slot.

Pages skip component tests (covered by e2e).

### 13.3 E2E smoke

New file `tests/e2e/onboarding-tab.test.ts`:
- on install, opens onboarding tab — wait for tab matching `chrome-extension://<id>/src/onboarding/index.html`. NEW fixture variant `launchExtensionPristine()` that does not pre-open the popup (the existing `launchExtension` goes to popup HTML to wait for liveness — incompatible with cold-install test).
- create + password happy path.
- import + seed happy path.
- passkey-create happy path with virtual authenticator anchored to the onboarding tab page (NOT the popup).
- popup redirects to tab when `!onboardingCompleted`.
- popup reuses existing tab on second mount.
- accelerator detection: mocked OK via request interception → `active` → Continue enabled.
- accelerator skip: mocked 502 → `not-detected` → click Skip → Continue enabled → routes to Done.
- onboardingCompleted gate: after walking to Done, popup mount does NOT redirect.
- **deep-link bypass**: direct `chrome-extension://<id>/src/popup/index.html#/popup/profile/new` with `onboardingCompleted=false` and no profile → redirects to tab.
- **session restart resume — active session**: walk to /learn, restart SW (via `chrome.runtime.reload` test hook), reload tab → still on /learn (profile + isLogined still true).
- **session restart resume — locked session**: walk past create, restart SW + clear session storage to simulate lock → tab on mount sees `profile && !isLogined` → bounces to popup-window auth.

**Cross-context passkey regression (MANUAL smoke, NOT puppeteer)**:
Codex v2 F: Puppeteer's virtual authenticator is `FrameTreeNode`-scoped (`fixtures/passkey.ts:17`), so a credential created in the onboarding tab's FTN cannot be replayed from the popup's FTN. The "tab-created passkey unlocks from popup" regression is NOT realistically e2e-testable with the current authenticator model. Document as a manual smoke step in the PR checklist instead:

```
Manual smoke (passkey cross-context):
1. Fresh install. Onboarding tab opens.
2. Create wallet with passkey method. Complete onboarding to Done.
3. Open the popup-window from Done CTA.
4. Lock the wallet (or wait for session expiry).
5. Click "Unlock with passkey" — verify the same credential authenticates.
```

If we want automated coverage in the future, add a test hook that exposes a shared authenticator across FTNs — out of scope for v1.

E2E fixture overhaul (`tests/e2e/fixtures/extension.ts`):
- `registerProfile()` helper rewritten to drive the onboarding tab from `welcome` → `create` → submit → seed `onboardingCompleted=true` via `chrome.storage.local` manipulation (skip learn + accelerator + done in tests for speed).
- `setupPasskeyVirtualAuth(browser, page)` calls in `passkey-paths.test.ts` etc. — `page` argument changes from popup page to onboarding tab page.
- New `launchExtensionPristine()` variant for tests that need to observe the install-time tab open.
- New `openOnboarding(extension)` helper that opens the onboarding tab URL directly (for tests that bypass install detection).

Tests requiring updates beyond fixture:
- `registration.test.ts` — full rewrite to drive tab.
- `passkey-paths.test.ts` — `setupPasskeyVirtualAuth` anchorPage + tab driver.
- `passkey-backup.test.ts` — same.
- `import-paths.test.ts` — drive tab import path.
- `security-reset.test.ts` — verify reset clears `onboardingCompleted`; second registration drives tab.
- `auth-flows.test.ts` — only the "first-install" branch; "add another profile" branch unchanged.
- `security-backup.test.ts` — verify if affected.
- `scripts/check-derivation-parity.ts` — uses `registerProfile`; will inherit the new behavior automatically once the fixture is updated.

### 13.4 E2E network

No new tests required. The existing network fixtures depend on `registerProfile`; once that fixture is updated, network tests run unchanged.

### 13.5 audit:vue gate

`bun run audit:vue` (typecheck → unit + component tests → lint → build) must pass. Build step verifies vite entry + manifest changes compile.

## 14. Edge cases & risks (re-ranked per Codex v2 G)

The risk list is re-ordered: bootstrap extraction + locked-session semantics is the **#1 implementation risk**, NOT `onInstalled` timing (which is mechanical and one-line).

1. **Bootstrap orchestration extraction + locked-session semantics**. The `bootstrapActiveProfile` extraction touches `popup/app.vue:164-220`. The locked-session bounce path adds a new state branch. Most likely to leak or regress. Fallback: duplicate orchestration with pin comment. (Codex). §6, §7, §8.1.
2. **Passkey cross-context testability**. Virtual authenticator is FTN-scoped; tab-created-credential-unlocks-popup is MANUAL only. Document in PR checklist. (Codex + Opus). §13.3.
3. **E2E fixture cascade**. `registerProfile()` is the root of ~8 tests + the derivation-parity script. Update the fixture FIRST. (Codex + Opus). §13.3.
4. **L4 ↔ L3 reuse boundary**. Three SFCs promotable; `useFullBackupImport` NOT — duplicate. (Codex + Opus). §3, §8.5.
5. **Auto-import dirs**. APPEND, don't replace. `src/utils` is in the current AutoImport list and must stay. (Codex). §4.
6. **PasskeyCeremonyDialog teleport target**. `<div id="popup">` must exist in onboarding shell. (Codex). §8.1.
7. **`popup/index.scss` width-lock global selector bleed**. Audit bundle. (Opus). §8.2.
8. **`onboardingCompleted` gate + reset clearing**. Predicate change AND reset.vue must clear the flag. (Codex). §7.
9. **`host_permissions` for accelerator fetch**. Added. (Codex). §4, §10.
10. **`onInstalled` registration timing**. Mechanical — register at SW eval. (Codex + Opus). §5.
11. **`chrome.action.openPopup` removal in favor of `chrome.windows.create`**. (Codex + Opus). §8.9.
12. **Deep-link `#/popup/profile/new` bypass**. Redirect predicate also fires on this entrypoint. (Codex v2). §7.
13. **Module-level promise lock for openOrFocusOnboardingTab**. Coded in §5.
14. **`storage.session` ephemerality**. Documented; acceptable. (Codex). §11.
15. **Skip-intro routing**. Routes to `/accelerator`. (Codex). §8.6.
16. **Passkey retry-on-ID-conflict loop**. Port verbatim. (Codex). §8.4.
17. **Sensitive material zeroing on unmount**. (Codex). §8.4, §8.5.
18. **Route hash form**. `#/onboarding/*`. Fixed. §2.
19. **`onInstalled` reason filter completeness**. §5.
20. **Auto-detect + Skip-link gate compromise**. Continue gated; Skip is an explicit action. §8.7.
21. **No-bb copy**. "Open the menu-bar app, wait for setup." No "Open Releases" button. §8.7.
22. **Windows accelerator unavailability**. CTA disabled, informative subtitle. §8.7.

## 15. Phasing — single PR

Estimated total: 2500–3500 LOC across new files + edited files + tests. Single PR.

Implementation order within the PR:
1. **Foundation** (lowest risk; can verify in isolation):
   - vite.config.ts auto-import + entry changes
   - manifest host_permissions
   - biome.json onboarding override
   - `wallet/utils/onboarding-tab.ts` (with lock) + unit tests
   - `wallet/index.ts` top-level `onInstalled` listener
   - `app.store.ts` `onboardingCompleted` flag
   - `composables/useProfileBootstrap.ts` (factored from popup/app.vue) + unit tests
2. **Onboarding shell**:
   - `src/onboarding/{index.html, index.ts, app.vue, onboarding.scss}`
   - `pages/welcome.vue` + `done.vue` (minimal)
   - Smoke that the tab opens and renders
3. **Wizard core**:
   - `pages/create.vue` + sensitive-material handling
   - `pages/import.vue` + L4→L3 promotion of import modules
   - `pages/learn.vue`
   - `pages/accelerator.vue` + `useAcceleratorStatus` composable
4. **Components**:
   - `StepHeader.vue`, `AcceleratorStatusCard.vue`, `ConceptCard.vue`, `PinToToolbarTip.vue`
5. **Popup integration**:
   - `popup/index.ts` hydrate `onboardingCompleted`
   - `popup/app.vue` refactor to use `useProfileBootstrap()`
   - `popup/pages/register.vue` + `popup/pages/import.vue` redirect
6. **E2E fixture overhaul** (biggest blast radius):
   - `tests/e2e/fixtures/extension.ts` — `registerProfile` rewrite + `launchExtensionPristine` + `openOnboarding`
   - Cascade updates to ~7 dependent tests
7. **New E2E suite**:
   - `tests/e2e/onboarding-tab.test.ts` (~10 cases)
8. **Final gates**:
   - `bun run audit:vue`
   - `bun run test:e2e`
   - Manual smoke in a real Chrome

## 16. Open questions for v2 (deferred to v3 / post-launch)

- Cross-device flow for passkey wallets.
- Optional mnemonic export inside onboarding (vs only in settings).
- Network selection during onboarding.
- "Resume from where you left off" persistence (currently restart per page).
- Localization (no i18n infra exists today).
- A `useOnboarding` composable exposing "navigate to next step" semantics, if the wizard grows.

---

## Appendix — what changed v1 → v2

(Hard rejects from Codex addressed, plus Opus's missing-pieces. Numbered to match the v1→v2 issue table in the consolidation message.)

1. ✅ onInstalled moved to wallet/index.ts top-level
2. ✅ Onboarding shell mirrors popup/index.ts (Pinia + global styles)
3. ✅ useProfileBootstrap composable extracted; fallback documented
4. ✅ Vite auto-import dirs extended
5. ✅ biome.json override for onboarding
6. ✅ Onboarding shell includes `<div id="popup">` for PasskeyCeremonyDialog teleport
7. ✅ Drop chrome.action.openPopup; use chrome.windows.create
8. ✅ Route paths corrected to `#/onboarding/*`
9. ✅ host_permissions for `http://127.0.0.1/*` added
10. ✅ Module promise lock coded
11. ✅ storage.session lifecycle documented; second-tab risk accepted
12. ✅ onboardingCompleted flag in chrome.storage.local
13. ✅ Skip-intro routes to /accelerator
14. ✅ popup/import.vue redirects when !onboardingCompleted
15. ✅ Passkey retry-on-ID-conflict ported
16. ✅ Full e2e fixture overhaul + cascade documented
17. ✅ setupPasskeyVirtualAuth anchorPage updated
18. ✅ testid prefix list spec'd
19. ✅ popup/index.scss bleed audit step
20. ✅ no-bb copy fixed; no "Open Releases" button
21. ✅ Copy rewrites applied throughout §12
22. ✅ Sensitive input zeroing on unmount
23. ✅ onInstalled filter excludes update/chrome_update/shared_module_update
24. ✅ Auto-detect + Skip-link compromise documented
