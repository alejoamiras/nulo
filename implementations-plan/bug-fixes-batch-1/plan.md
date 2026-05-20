# Bug-fixes batch #1 — plan v2.1

**Changes from v1**: incorporates Codex (`APPROVE-WITH-FIXES`) + Opus 4.7 (`APPROVE-WITH-FIXES`) reviews. Net effect: B1 grows by a tiny but real bug fix (`toast.js` timer race), B2's UX split is an explicit two-option ask, B3 gets correct stroke math + four missed consumer surfaces, B4 cleanly removes the orphaned keyframes block, B5 trusts the layout to collapse. Commit order flipped to smallest-risk first.

**Changes v2 → v2.1**: incorporates Codex's final-review feedback (v2 was NO-GO on three factual gaps):
- B1: existing `useToast` coverage lives in `ToastManager.test.ts` (v2 wrongly claimed `toast.js` had no coverage). Add ONE timer-reset regression case there; do NOT create a new `toast.test.ts`.
- B2 Option A: `@click.stop` in a `SettingItem` `#right` slot already works in this codebase (`settings/networks/[id].vue:181,196`). Option A does NOT need a `SettingItem` contract change. Q1 reframed accordingly.
- B2: explicit `data-testid` names added for both options (Option A: `network-row-manage`; Option B: `network-set-active`).
- B3: dropped the duplicate-SVG consolidation. Keep both `src/assets/logo.svg` AND `public/logo.svg`; replace BOTH file contents to the new design. Regenerate `logo.png` from `src/assets/logo.svg`. Removes Q4 entirely.
- B3: step ordering fixed (v2 deleted `src/assets/logo.svg` then rasterized from it — internally inconsistent).

Branch: `feat/bug-fixes-batch-1` (off `origin/dev` @ `accfce3c`).

## 0. Context

Five user-reported issues, mixed extension + landing. Independent enough to ship as one PR, sequenced smallest-risk first so any regression is easy to diagnose. Audit cycle: Codex + Opus 4.7 in parallel for v1; this v2 consolidates both.

## 1. Scope

| # | Bug | Surface | Risk |
|---|---|---|---|
| B5 | Landing footer items removed | landing | trivial |
| B4 | Landing wordmark `NUL○` → `NULO` | landing | trivial |
| B3 | Extension icon ≡ landing favicon | extension icons + manifest | low-medium (dApp-visible) |
| B1 | Fee estimation failure toast (+ toast.js timer race fix) | extension popup (send + execute) | medium |
| B2 | Network chip → Manage Networks (popup deleted) | extension popup | medium-high (e2e helpers) |

## 2. Non-goals

- Do NOT redesign FeeCostReadout's idle copy (`"Fee estimated after simulation"`). The toast is the user signal; readout polish is a follow-up if a reviewer eyeballs it and pushes back.
- Do NOT modify `SettingItem`'s contract just to support a chevron-vs-row click split. If you want the "row tap = switch" UX, see Q1 below.
- Do NOT touch the landing favicon — it is already the correct circle.
- Do NOT bump version. The release workflow handles that.
- Do NOT redesign footer layout on B5 — trust the flexbox collapse.

## 3. The five fixes

### B5 — Landing footer: remove two items

**Files (current):**
- `packages/landing/index.html:266` — `<div>&copy; THE FRONTIER MANIFESTO</div>`
- `packages/landing/index.html:271` — `<div class="footer__version">COORDINATION LAYER v.01-ALPHA</div>`
- `packages/landing/src/styles/layout.css:105-108` — `.footer__version` rule.

**Fix:**

1. Delete both `<div>` lines from `index.html`.
2. Delete the `.footer__version` rule from `layout.css`.
3. **Do not** touch the `@media (min-width: 768px)` block (layout.css:86-89). With one remaining child, `justify-content: space-between` resolves to flex-start naturally — that is acceptable for a minimal one-group footer.

**Tests:** none. Manual: `bun run --cwd packages/landing build` + visual diff.

---

### B4 — Landing wordmark: drop the circle artifact

**Files (current):**
- `packages/landing/index.html:62-64` — `<a class="nav__logo">NUL<span class="nav__logo-o" aria-hidden="true"></span></a>`
- `packages/landing/src/styles/layout.css:39-46` — `.nav__logo-o` selector (sizing + border).
- `packages/landing/src/styles/animations.css:103-110` — `@keyframes breathe` (single consumer: `.nav__logo-o`).
- `packages/landing/src/styles/animations.css:113-115` — `.nav__logo-o { animation: breathe ... }`.
- `packages/landing/src/styles/animations.css:182-184` — reduced-motion `.nav__logo-o { animation: none }` override.

**Fix:**

1. HTML → `<a class="nav__logo" href="/" aria-label="NULO home">NULO</a>` (drop the span).
2. Delete the `.nav__logo-o` rule in `layout.css:39-46`.
3. Delete the `.nav__logo-o` animation rule in `animations.css:113-115`.
4. Delete the `@keyframes breathe` block in `animations.css:103-110` (now orphan — single-consumer verified by Opus's review).
5. Delete the reduced-motion `.nav__logo-o` override in `animations.css:182-184`.

`aria-label="NULO home"` matches the new visible text. No further a11y change.

**Tests:** none. Manual: `bun run --cwd packages/landing build`.

---

### B3 — Standardize extension icon to landing favicon

**Files (current):**
- `packages/extension/src/assets/logo.svg` — current slash-circle design.
- `packages/extension/public/logo.svg` — **byte-identical duplicate** of `src/assets/logo.svg` (verified). Both stay; both get the new content in step 1 of the fix.
- `packages/extension/src/assets/logo.png` — 256x256 PNG rendered from the SVG.
- `packages/extension/manifest/manifest.config.ts:50-54` — icons 16/24/32/128 → `src/assets/logo.png`.
- `packages/extension/manifest/manifest.config.ts:59` — `web_accessible_resources` exposes `src/assets/logo.png` to dApps.
- `packages/extension/src/popup/app.vue:31` — `import LogoIcon from "@/assets/logo.svg?raw"` (DevTools console banner).
- `packages/extension/src/popup/index.html:5` — `<link rel="icon" type="image/svg+xml" href="/logo.svg" />`.
- `packages/extension/src/setup/index.html:5` — same.
- `packages/extension/src/onboarding/index.html:5` — same.
- **`packages/extension/src/wallet/services/wallet-sdk/background.ts:107`** — `walletIcon: chrome.runtime.getURL("/src/assets/logo.png")`. **dApp-visible via wallet-discovery.** (Opus catch.)

**Fix (do NOT consolidate — keep both SVGs):**

1. Replace the content of BOTH `packages/extension/src/assets/logo.svg` AND `packages/extension/public/logo.svg` with the new circle design. Use a 32-viewBox to match the landing favicon directly; bump the stroke to `2` (from landing's `1.5`) so the 16px Chrome toolbar raster still reads as a line:

   ```svg
   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
     <rect width="32" height="32" fill="#0A0908"/>
     <circle cx="16" cy="16" r="9" fill="none" stroke="#F5F0E6" stroke-width="2"/>
   </svg>
   ```

   Both files stay byte-identical (as they are today). No deletion, no import path changes. The `?raw` import in `popup/app.vue:31` (`@/assets/logo.svg?raw`) stays — same path, new content.

   *Math fix*: `1.5/32 = 0.0469`; `3/64 = 0.0469` (same relative weight; v1's "bumped" claim was wrong, both reviewers caught it). `2/32 = 0.0625` thickens the stroke ~33% — perceptible at 16px.

2. Regenerate `packages/extension/src/assets/logo.png` at 512x512 from `src/assets/logo.svg`. Local tool preference order:
   - `rsvg-convert -w 512 -h 512 packages/extension/src/assets/logo.svg -o packages/extension/src/assets/logo.png` (if installed via brew).
   - `bun add -d sharp` then a one-shot Node script (reproducible if ever needed in CI).
   - macOS fallback: `qlmanage -t -s 512 packages/extension/src/assets/logo.svg -o packages/extension/src/assets/`

   Document the command in the commit body so it's reproducible.

3. No code changes. Manifest icons + dApp `walletIcon` (via `wallet/services/wallet-sdk/background.ts:107`) pick up the new PNG automatically.

**Tests:** none. Manual QA (must do):
- Load unpacked, eyeball toolbar at 16px.
- Inspect `chrome://extensions` thumbnail at 48px.
- Verify the DevTools console banner in popup renders the new SVG.
- Test against a dApp that uses the wallet-discovery `walletIcon` (e.g., the playground at `packages/playground`).

---

### B1 — Fee estimation failure surfaces silently (+ toast.js timer race)

**Files (current):**
- `packages/extension/src/composables/toast.js:5-25` — `useToast`. **Bug**: `openToast` schedules a new `closeTm` without clearing the previous one. Rapid back-to-back calls cancel each other's display (both reviewers caught).
- `packages/extension/src/composables/useFeeEstimation.ts:71-74` — swallows errors and calls `onError?(err)`.
- `packages/extension/src/composables/useFeeEstimationMap.ts` — same pattern, used only by `execute/index.vue:97` (verified, no other consumers).
- `packages/extension/src/popup/pages/send.vue:226` — `onError: console.error`.
- `packages/extension/src/popup/windows/execute/index.vue:97` — `onError: console.error`.
- `TOAST_DURATION.LONG = 4_000` (toast.js:8 — NOT 5000 as v1 claimed).

**Fix (two parts):**

**Part 1 — `toast.js` timer race.** In `openToast`, clear the previous timer before scheduling the new one. One-line change:

```js
export const useToast = () => {
  const openToast = (newToast, duration = TOAST_DURATION.DEFAULT) => {
    clearTimeout(closeTm)        // ← NEW. Cancels any previous timer.
    toast.value = newToast
    closeTm = setTimeout(() => {
      toast.value = null
    }, duration)
  }
  ...
}
```

Test: add ONE new case in the EXISTING `packages/extension/src/components/ui/ToastManager.test.ts` (which already exercises `useToast` directly — verified). The new case: "rapid second openToast resets the timer; the first timer does not nullify the new toast early." Do NOT create a separate `toast.test.ts` (that was the v2 mistake).

**Part 2 — Fee estimation toast.** In both `send.vue:226` and `execute/index.vue:97`, change `onError` to also surface a toast:

```ts
onError: (err) => {
  console.error(`[send:${sendInstanceId}] estimateTransferFee failed:`, err)
  openToast({ label: "Couldn't estimate fee — retry.", icon: "warning", color: "red" }, TOAST_DURATION.LONG)
}
```

Execute window: `useToast` already imported (verify, add if not).

**UX copy** (final pick after both reviews): `"Couldn't estimate fee — retry."` (concise, brand voice, prompts user action). Identical in both surfaces. (Q3 below confirms.)

**Manual QA item**: induce three back-to-back failures (e.g., type to an invalid address, then a valid+broken one, then again rapidly). Expect: exactly **one** toast visible at the end. Catches the `closeTm` regression at the user-facing layer (Opus's recommendation).

**Tests:**
- ONE new case appended to the EXISTING `packages/extension/src/components/ui/ToastManager.test.ts`: "rapid second openToast resets the timer; the first timer does not nullify the new toast early." No new test file.
- `useFeeEstimation.test.ts:128` already pins the `onError` path — no new unit case needed.
- E2E: none. Inducing a real fee-estimation failure mid-PXE is flaky; manual QA covers it.

---

### B2 — Network chip → Manage Networks (popup deleted)

**Files (current):**
- `packages/extension/src/components/Header.vue:229` — network **chip** button (network name + status dot, not a "globe" — Opus correction). Calls `handleOpenPopup('networks')`.
- `packages/extension/src/popup/components/popups/NetworksPopup.vue` — the popup. Two callers only (verified): `Header.vue` and `PopupManager.vue:46`. `popup.store.ts` has NO typed enum — bare-string keys (Codex+Opus verified). The "remove the `networks` key from popup-store types" line in v1 is a non-op; struck.
- `packages/extension/src/popup/components/popups/PopupManager.vue:46` — popup mount.
- `packages/extension/src/popup/pages/settings/networks/index.vue:30-37` — file-header comment claims "switching goes through globe → NetworksPopup".
- `packages/extension/src/components/ui/Settings/SettingItem.vue:44-104` — single click target on the wrapper `<component>`. Slot `right` does NOT get its own click handler. A button-in-slot would propagate to the row.

**Fix (the always-do part):**

1. `Header.vue:229` → `@click="handleNavigateToNetworks"` where `handleNavigateToNetworks` does:
   ```ts
   const handleNavigateToNetworks = () => {
     if (!appStore.isLogined) return
     router.push("/popup/settings/networks")
   }
   ```
2. Delete `NetworksPopup.vue`.
3. Remove the `<NetworksPopup>` mount from `PopupManager.vue:46`.
4. Rewrite the file-header comment in `settings/networks/index.vue:30-34` to describe the new behavior (no milestone/PR tags).

**The UX-split decision (Q1 below) decides whether to also:**

- **Option A — Row-tap switches, manage via icon-button in `#right` slot.** In `settings/networks/index.vue`, switch row-click handler to `handleSetActive(network)`. Replace the existing decorative `<MaterialIcon name="chevron_right">` in the `#right` slot with an icon-button carrying `@click.stop="handleOpenDetail(network)"` + `data-testid="network-row-manage"`. **No `SettingItem` contract change needed** — the `@click.stop` pattern already works in this codebase (`settings/networks/[id].vue:181,196`). e2e helpers: `openNetworkDetail` retargets to `[data-testid="network-row-manage"]`; `switchToLocalNetwork` / `switchToNetwork` click the row.

- **Option B — Tap-row stays drill; add "Set as active" inside the detail page.** Settings/networks row-click stays as `handleOpenDetail` (current behavior). In `settings/networks/[id].vue`, add a new SettingItem row labeled `"Set as active network"` with `data-testid="network-set-active"`. Switching from header chip = 3 taps (chip → row → "Set as active"). Editing = 2 taps (chip → row). **No `SettingItem` change, no helper signature change.**

Default in this plan: **Option B**, because:
- Smaller diff (~20 LOC vs ~40 LOC).
- Zero blast on e2e helpers (`openNetworkDetail`, `deleteNetworkRow`, `switchToLocalNetwork`).
- User's stated benefit ("saves a click for editing") is preserved by both options; B's switching is slightly heavier (3 taps vs 2), but switching is a less-common operation.

Both options are tractable — Q1 is a real user choice.

**E2E test surface (full list, both reviewers consolidated):**
- `packages/extension/tests/e2e/fixtures/helpers.ts:131-145` — `openNetworksPopup()` + `switchToNetwork()`.
- `packages/extension/tests/e2e/fixtures/extension.ts` — 7 callsites of `switchToLocalNetwork` (signatures stay the same in Option B).
- `packages/extension/tests/e2e/fixtures/helpers.ts:997+` — `openNetworkDetail()` (5 callers in `endpoints.test.ts`).
- `packages/extension/tests/e2e/fixtures/helpers.ts:1016+` — `deleteNetworkRow()` (1 caller in `settings-crud.test.ts`).
- `packages/extension/tests/e2e/scripts/check-derivation-parity.ts:165-173` — explicit `[data-testid="networks-popup"]` selector. Rewrite to navigate to settings.

In **Option B**, only `openNetworksPopup` / `switchToNetwork` / `check-derivation-parity.ts` need updates (the popup-specific selectors). `openNetworkDetail` / `deleteNetworkRow` / `switchToLocalNetwork` stay as-is.

In **Option A**, all of the above need updates because row-click semantics change.

**Tests:**
- `NetworksPopup.vue` has no unit tests (verified — L5 popup). Deletion is clean.
- New: in Option B, the "Set as active" row inside `[id].vue` may warrant a small smoke check via e2e (or just manual QA, since `[id].vue` is L6).

---

## 4. Implementation order (smallest-risk first)

Per Opus's recommendation:

1. `chore(landing): remove footer manifesto + version lines` — B5.
2. `chore(landing): replace NUL+circle wordmark with plain NULO` — B4.
3. `chore(brand): align extension icon to landing favicon (circle outline)` — B3.
4. `fix(toast): clear previous timer in openToast + toast on fee-estimation failure` — B1 (toast.js fix + send + execute).
5. `feat(networks): header chip routes to Manage Networks; popup deleted` — B2 (UX option per Q1).

Each commit signed. One PR. PR title mirrors the largest commit subject.

## 5. Test plan

### Local gates (must run, in order)

| When | Command | Covers |
|---|---|---|
| After every commit | `bun run audit:vue` | Extension typecheck:all + units + lint + build. |
| After B4 / B5 (and B3 too — see note) | `bun run --cwd packages/landing build` | **Landing build is NOT covered by `audit:vue`** (Codex catch). Required for any landing-touching commit. |
| After B2 | `bun run test:e2e` (smoke) + `bun run e2e:agent` (network) | Helper rewrites must keep both suites green. |

### CI gates (PR)

- `Quality / Status` — required.
- `Smoke e2e / Status` — diff touches `Header.vue` + `settings/networks/index.vue` → filter triggers.
- `Network e2e / Status` — diff touches `tests/e2e/network/networks.test.ts` (indirectly via helpers) → filter triggers.

### Test budgets (CLAUDE.md compliance)

No new components, no new test files, no new composables. B1 adds one regression case to the existing `ToastManager.test.ts` (the patched `useToast` behavior). Composable ≥10 rule does not apply (no new composable is created).

## 6. UX copy decisions

| Bug | Surface | Final copy |
|---|---|---|
| B1 | Toast on estimation failure | `"Couldn't estimate fee — retry."` |
| B2 | (Option B) Detail page action row | `"Set as active network"` (header: `"Active state"`) |
| B3 | (none — visual only) | n/a |
| B4 | Wordmark | `NULO` |
| B5 | Footer | (items removed; no new copy) |

## 7. Open questions for the user

**Q1 (B2 — UX split):** Option A (row-tap=switch, icon-button in `#right` slot=manage; ~40 LOC; helpers retarget to `network-row-manage` testid) or **Option B (row-tap=manage as today; add "Set as active" row in detail page; ~20 LOC; no helper signature change; default).**

**Q2 (B3 — icon stroke):** circle stroke of `2` on a `32` viewBox (33% thicker than landing favicon's `1.5`). Acceptable, or thinner/thicker?

**Q3 (B1 — toast wording):** `"Couldn't estimate fee — retry."` — accept, or rephrase?

*(Q4 from v2 dropped — duplicate-SVG consolidation removed; both files stay, both get the new content.)*

## 8. Estimated diff

| Block | LOC delta | Files changed |
|---|---|---|
| B5 | -7 | 2 (index.html + layout.css) |
| B4 | -25 | 3 (index.html + layout.css + animations.css) |
| B3 | net 0 (binary regen + 2× SVG content edit) | 3 (2 SVGs + 1 PNG) |
| B1 | +15 (toast clearTimeout + 2 toast calls + 1 case in existing ToastManager.test.ts) | 4 (toast.js + send + execute + ToastManager.test.ts) |
| B2 Option B | +30 (action row in `[id].vue` + delete popup + helpers minor update) | 4 |
| B2 Option A | +40 (button-in-slot + delete popup + helpers retarget) | 5 |

Net (with Option B): **~30 LOC net delete + 1 new binary asset (regenerated PNG)**. No new files.

## 9. Risk per bug

- B5, B4: trivial.
- B3: low logic risk; medium visual risk (dApp-visible via `walletIcon`). Manual QA mandatory.
- B1: medium. The `clearTimeout` fix is one line but applies repo-wide to every `openToast` caller; risk is "did I break a flow that relied on stacked timers"? — verified no such flow exists (search came up empty).
- B2: depends on Q1 choice. Option B is medium-low; Option A is medium-high.
