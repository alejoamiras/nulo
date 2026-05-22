# QA feedback batch #1 — faucet + extension polish

**Date:** 2026-05-22
**Tier:** B (medium / contained — multiple small fixes across two packages)
**Audit cycle:** Single codex review on the plan; no parallel-plans / opus subagent.
**Scope:** Address user feedback from friends QAing alpha-testnet faucet + extension.

---

## Decisions confirmed with user

1. **Drip button copy:** `"Get USDC (public)"` / `"Get USDC (private)"`. No amount in the button — it's fixed.
2. **Faucet status copy on success:** `"Sent 1,000 USDC to public/private"`. Persistent green emphasis (no 3s decay).
3. **PR shape:** **One bundled PR** covering both packages.

---

## Goals

10 user-facing items across the faucet and extension. None are architecturally complex; the largest is the faucet's status state-machine cleanup.

```
[F1] faucet  · Drip → "Get USDC (public/private)" button copy
[F2] faucet  · status state — suppress prev result while inflight + persistent success emphasis
[F3] faucet  · contracts URL: /contracts/{addr} → /contracts/instances/{addr}
[E1] ext     · theme default: dark → system (unfreeze the test)
[E2] ext     · cursor: pointer on copy chip in AccountsPopup + global audit
[E3] ext     · capabilities popup: auto-select single available account
[E4] ext     · tx details: brighter aztecscan link in dark mode + tx-hash as inline link
[E5] ext     · TxDebugPanel: gate behind debugMode || developerMode
[E6] ext     · empty token state: "Tap ⋯ above…" → direct link to new_token popup
[E7] ext     · transactions URL already correct (`/tx-effects/`); no-op confirmed.
```

(F = faucet, E = extension. F3 is the only aztecscan URL change needed — extension has no contract URL builder yet.)

---

## Per-item plan

### F1 — Drip button copy (`packages/faucet/`)

**Files:**
- `src/components/TokenCard.vue:136,143` — button labels
- `src/components/TokenCard.test.ts:85-90` — label assertions
- `src/components/composite/DripButton.test.ts:6-12` — label-prop assertion (no string change needed, just a sanity update if mocks reference old text)

**Change:**

```diff
-`Drip ${token.displayAmount} ${token.symbol} to public`
+`Get ${token.symbol} (public)`
-`Drip ${token.displayAmount} ${token.symbol} to private`
+`Get ${token.symbol} (private)`
```

Tests updated to match. Toast text on success can keep `Dripped 1,000 USDC to public` — internal phrasing, not on a button.

**Aria labels:** keep an explicit `aria-label` describing the action including the amount (`"Get 1,000 USDC into your public balance"`) so screen readers still announce the value. This goes on `DripButton`'s `<button>` element via a new optional prop.

---

### F2 — Faucet tx-status state cleanup (`packages/faucet/`)

**Files:**
- `src/components/TokenCard.vue` — the bulk of the change (status row template + computed + emphasis logic)
- `src/components/TokenCard.test.ts` — extend coverage for the two bug fixes below

**Two distinct bugs in one section:**

**Bug A — stale "View tx" link visible during inflight.**
Today, the status row reads `lastDrip` even while `dripping === true`. Result: while "Proving private…" is showing, the previous successful drip's "View tx" link is still rendered next to it. Pointing to the *wrong* hash.

Fix: split the template so during `dripping`, ONLY the inflight label renders. The `lastDrip` block is `v-if="!dripping"`. One-line guard.

**Bug B — success emphasis decays after 3s; users don't notice the confirmation.**
Today, `emphasisTimer` clears `emphasized = false` 3 seconds after success. The mint color reverts and the user loses the cue.

Fix: remove the 3-second timer for the success case. Emphasis persists until the next drip clears it. Errors already persist — symmetry. Specifically, drop lines 96–100 of `handleDrip` (the `setTimeout`).

**Bug C — toast emits old "Dripped" wording.**
Already chose to keep "Dripped" in toast text (user-facing reuse of the marketing term internally is fine — the issue was the button copy specifically). Leave as is.

**Tests added:**
1. While `dripping === true`, the status row does NOT render the previous drip's `txUrl` or error message.
2. After a successful drip resolves, `data-emphasized="true"` persists indefinitely (until the next drip click).
3. A subsequent click clears emphasis at the start of the new drip cycle.

---

### F3 — Faucet contract URL schema update (`packages/faucet/`)

**File:** `src/lib/explorer.ts:25-29` + `src/lib/explorer.test.ts:24-26`

```diff
-export function explorerAddressUrl(addr: string): string { return `${base}/contracts/${addr}` }
+export function explorerAddressUrl(addr: string): string { return `${base}/contracts/instances/${addr}` }
```

Test pin updated to match. `explorerTxUrl` already on `/tx-effects/` (correct).

---

### E1 — Theme default `dark` → `system` (`packages/extension/`)

**Files:**
- `src/wallet/config/config.ts:5` — default value
- `src/wallet/config/config.test.ts:34-36` — **frozen** test (explicitly designed to require sign-off)

**Why frozen?** The frozen test pattern in this repo guards configuration defaults that affect security or UX commitments. `theme` is UX, not security — flipping default to `system` is a clear improvement (matches the OS, friendlier first-run experience). I'll update both the test and the default in one commit so the test stays green.

**Migration:** Existing users keep their current setting via existing config persistence. New installs / first-run get `system`. No migration logic needed — the change is only to the *factory default*.

```diff
- theme: "dark" | "light" | "system" = "dark"
+ theme: "dark" | "light" | "system" = "system"
```

---

### E2 — `cursor: pointer` audit (`packages/extension/`)

**Primary fix — copy-address icon in AccountsPopup:**
- `src/popup/components/popups/AccountsPopup.vue:185-191` — the `.icon_btn` rule is missing `cursor: pointer`.

**Audit scope — also check:**
- `src/popup/components/popups/AccountsPopup.vue` line 78-85 — the copy `<button>` element (likely has cursor by default since it's `<button>`, but verify)
- `src/popup/components/modules/` — interactive non-button elements (rows, chips, copy widgets)
- `src/components/composite/` — any composite that renders an interactive surface as `<div @click>`

**Heuristic for audit:** grep for `@click` on `<div>` / `<span>` / `<a>` (non-`<button>`) and confirm each carries `cursor: pointer` in CSS.

**Outcome expected:** ≤5 missing instances across the codebase given the explorer's quick scan suggested most interactive elements are already covered.

**No new global rule.** Adding `cursor: pointer` to `[role="button"]` globally could surprise existing components that intentionally suppress it. Component-by-component fix is safer.

---

### E3 — Auto-select single account in capabilities popup (`packages/extension/`)

**Files:**
- `src/popup/windows/capabilities/index.vue` — `init()` at line 84-110 + state at 40-43
- `src/popup/windows/capabilities/index.test.ts` (if exists) or add a new test asserting auto-select behavior

**Change in `init()` after `availableAccounts.value = payload.value.params.availableAccounts`:**

```ts
if (availableAccounts.value.length === 1) {
  selectedAccounts.value = [...availableAccounts.value]
}
```

**Edge cases checked:**
- User can still de-select the auto-selected account (the existing `selectAccount()` toggle still works).
- The "Select at least one account" error path in `approve()` (line 131) still fires if user de-selects.
- If `availableAccounts` is empty, the existing toast `"No accounts available for this network"` still fires.
- If `availableAccounts.length > 1`, behavior unchanged (no auto-select).

---

### E4 — Tx details aztecscan link + tx-hash link (`packages/extension/`)

**Files:**
- `src/popup/pages/tx/[id].vue` — line 137-147 (link element), line 148-155 (hash fallback), line 350 (link CSS color)

**Two changes:**

**E4a — link color readability in dark mode.**
Today `.hero_link` uses `var(--nulo-outline)`. The user reports it's hard to read. I'll bump to a slightly lighter token. Concrete options:
- `var(--text-secondary)` if already in tokens
- `var(--nulo-mute-strong)` or similar mid-tone
- Pick the closest token between current outline (~too dim) and accent (~too loud)

I'll inspect `design/base.css` + `design/tokens.ts` during implementation and pick the one closest to "comfortable readable link" — call it out in the PR.

**E4b — make the tx hash itself a link.**
Today the hash is shown as `<span>` text only. Add: when an explorer URL is available, render the hash as an `<a target="_blank" rel="noopener">` pointing to the same `explorerUrl`. Use the same color treatment as E4a. The "View on aztecscan" hero link stays for prominence.

**Tests:** assert the `<a>` wrapping the hash uses the same `explorerUrl` and opens in a new tab.

---

### E5 — Hide TxDebugPanel outside debug mode (`packages/extension/`)

**Files:**
- `src/popup/pages/tx/[id].vue:301` — `<TxDebugPanel ... />`
- Add a guard from `useConfigService()` reading `debugMode` || `developerMode`

**Change:**

```vue
<TxDebugPanel v-if="debugMode || developerMode" :tx="tx" />
```

Wire up via the existing config service client (mirrors how other settings are read on this page).

**Tests:** assert TxDebugPanel does NOT render with both flags false; DOES render with either flag true.

---

### E6 — Empty token state direct link (`packages/extension/`)

**File:** `src/popup/components/modules/general/TokensView.vue:314-319`

**Today:**
```vue
<span :class="$style.empty_sub">Tap ⋯ above to import your first token.</span>
```

**Change to:**
```vue
<span :class="$style.empty_sub">
  Tap <a href="#" @click.prevent="popupStore.open('new_token')">here</a> to import your first token.
</span>
```

The "here" link uses the existing `popupStore.open('new_token')` action already wired up via the `⋯` menu (line 267).

**Tests:** clicking the "here" link calls `popupStore.open('new_token')` once.

---

## What's NOT in this PR

- **Faucet "Confirmed" vs "Submitted" state distinction.** The faucet's `wallet.sendTx` already awaits mining by default (returns `TxSendResultMined`). When the call resolves, the tx is already confirmed on-chain. The user's "we don't notice when it's confirmed" feedback is fundamentally about the success cue being too short — addressed by F2-bug-B. Splitting `dripping` into two distinct phases (proving / broadcasting) would require a deeper SDK hook (no public progress callback today) and is out of scope.
- **Extension contract URL builder.** No code currently builds aztecscan contract URLs in the extension. F3 covers the faucet's broken pattern. Adding a contract URL builder to the extension for hypothetical future use is YAGNI.
- **Global `cursor: pointer` rule.** Audit-then-fix is safer; a global rule on `[role="button"]` could regress current intentional non-pointer styles.

---

## Security & adversarial considerations

This is a UI/copy/state-fix batch; the threat surface barely moves. But going through the checklist:

**Threat model.**
- F1 / F3 / E1 / E2 / E6 — pure presentation changes. No new trust boundaries.
- E3 (auto-select single account) — DOES touch the capability-grant decision surface. Adversarial questions:
  - Could the auto-select trick a user into granting an account they didn't mean to? **No** — auto-select only fires when there's a single account. The user always sees that account on the popup and must still click `Approve`. The flow already requires explicit Approve.
  - Could a malicious dApp craft an `availableAccounts` payload that includes a phantom account? **No** — the wallet itself decides `availableAccounts` based on what's stored locally for the active profile. The dApp doesn't get to pick.
  - Could the user mistakenly Approve thinking they had un-selected the auto-pick? Mitigated by visible checkmark state — the existing `isAccountSelected()` getter is what the checkbox uses; auto-fill goes through the same state.
- E4 (tx hash → aztecscan link) — opens external URL in new tab. We use `target="_blank" rel="noopener"` (matches existing `.hero_link` pattern at line 350). No `noreferrer` issue today (aztecscan is non-hostile + already linked elsewhere).
- E5 (debug panel gating) — REDUCES exposure of internal tx state to users who haven't opted in. Net-positive for privacy / security.
- F2 (suppress stale "View tx" during inflight) — fixes a UX bug that could mislead users into thinking the *current* drip succeeded when really they're looking at the previous one. Confidence cue accuracy. Net-positive.

**Least privilege:** no new permissions or scopes requested.

**Crypto:** no crypto code touched.

**Input validation:** `popupStore.open('new_token')` (E6) takes a static string literal — no user input flows in.

**Supply chain:** no new deps.

**Domain-specific risk — wallet UX:**
- E1 (theme default → system): a user on a light-mode OS will get a light-themed wallet on first install. We need to make sure the *light* theme is actually readable / not broken — check Sandbox / DevTools light mode before merging.

---

## Validation strategy

After implementation, in order:

1. **Per-file** — `bun run lint` + `bun run typecheck` on each touched file.
2. **Unit tests** — `bun run test` in faucet + extension. Pre-existing tests stay green + new tests added.
3. **`audit:vue`** (the standard pre-PR gate) — typecheck → unit → lint → build.
4. **Smoke e2e** — `bun run test:e2e` for the extension (mock wallet). Faucet has its own 5-case smoke.
5. **Manual on alpha-testnet** (this is the QA pass that matters most):
   - Faucet: load, connect Nulo, drip all four combinations, watch status emphasis persist.
   - Extension: install fresh (theme defaults to system), open Accounts popup (cursor on copy), grant a capability with single account (auto-select pre-checked), view a tx (aztecscan link readable, hash clickable, debug panel hidden), empty wallet (token import link works).

**Pre-PR gate:** all of 1-4 must pass before opening the PR. Manual smoke (#5) is for the user post-merge but I'll do at least faucet manual since the dev server is local.

---

## Codex review brief

```
Tier-B QA-feedback PR for the Nulo monorepo:
- packages/faucet/ — UI/copy/status fixes (3 items)
- packages/extension/ — UI/copy/state fixes (7 items)

Plan path: implementations-plan/qa-feedback-batch-1/plan.md

Adversarial ask:
1. The auto-select-single-account change (E3) in the capabilities popup — does this open any trick path where a malicious dApp could nudge a user into granting an account they wouldn't have consciously selected?
2. The "suppress stale View tx during inflight" fix (F2 bug A) — am I closing the only stale-state path, or are there others (e.g. error overrides ok)?
3. The theme default flip (E1) — am I missing a frozen-test invariant by also editing the test in the same commit? Is "frozen" enforced anywhere else (e.g. CI greptest)?
4. E6's `<a href="#" @click.prevent>` — any reason to prefer a `<button>` styled-as-link here for a11y?

What could a sloppy implementation get wrong? Where would you tighten the plan?
```

---

## Codex review feedback adopted (round 1)

Codex came back **needs-work** (no security blocker). Four fallouts integrated:

### Adopted: E3 e2e helper + tests fallout

`tests/e2e/fixtures/popups.ts:177` (the `approveCapabilities` helper or similar) blindly clicks the first requested account row. With auto-select, that click becomes a **de-select**. Existing tests that pass the first account explicitly need updating:
- `tests/e2e/network/cap-request-accounts.test.ts:35`
- `tests/e2e/network/meta-getAccounts.test.ts:34`
- Anywhere else that grep finds matching the pattern

**Plan:** make the helper idempotent — check `[data-testid="account-row-selected"]` (or analogous selected-state attr) before clicking. If already selected, skip the click. Same helper works for both pre- and post-auto-select states + multi-account flows.

### Adopted: F2 toast path is a residual stale-link surface

`packages/faucet/src/composables/useToast.ts:19` gives success toasts a 6s TTL. The success toast carries a `view tx` link. If the user re-drips within those 6s, the prior toast is still clickable during the new inflight state — same class of bug as bug A (inline row), just routed through the toast.

**Plan:** when a new drip begins (in `handleDrip` before `await drip.drip(...)`), dismiss any existing tx-link toasts for the same token. Implementation: add a `dismissByKey` to `useToast.ts` keyed by token symbol. Cost: ~10 LOC.

### Adopted: F2 test approach insufficient

Existing `TokenCard.test.ts:22` mocks `useFaucetDrip` with a `dripFn` that resolves immediately and never mutates `inflight.value`. To prove bug A is closed, the test must drive a real *deferred* state:

```ts
// Inside the test:
let resolveDrip!: (value: DripResult) => void
const dripPromise = new Promise<DripResult>((r) => { resolveDrip = r })
dripFn.mockReturnValueOnce(dripPromise)
inflightRef.value = { token: USDC, target: "private" }   // ← simulate inflight
// Click drip button; assert no .status-link visible; assert "Proving private…" only
resolveDrip({ kind: "txHash", value: "0xabc" })          // ← let it complete
await flushPromises()
// Now assert post-resolve state
```

Plus explicit `success → error` and `error → success` transition tests.

### Adopted: E1 frozen-test comment update

`config.test.ts:4-8` currently reads "do not fix this without an explicit SECURITY.md entry". Codex is right — for a UX-only default, adding a fake SECURITY.md entry trains future reviewers to ignore the freeze. Instead: narrow the comment to clarify the freeze covers **security/financial-default** invariants, and `theme` is approved to flip with reviewer sign-off (link to this plan).

### Adopted: E6 use real `<button type="button">` styled as link

Convention in this codebase is mixed but the right answer is the real button. Reference: `Button.vue:10` ghost variant + `SecretCountdownClose.vue:40`. Switch from `<a href="#" @click.prevent>` to `<button type="button" @click>`.

### Adopted: E2 audit scope widened

Original plan said "audit `src/popup/components/modules/` + `src/components/composite/`". Codex right that user's "check other places too" feedback wants **repo-wide** over `packages/extension/src/**/*.vue`. Audit method:
- grep for `@click` on `<div>` / `<span>` / `<a>` (non-`<button>`) + `role="button"` annotations
- Survey results documented in the PR description

---

## Lessons / open questions (post-review)

- The frozen-test pattern in `config.test.ts` is a guardrail I want to respect, not bulldoze. Updated the comment scope (security/financial only) so future contributors don't get trained to ignore it for unrelated UX flips.
- The faucet toast dismissal pattern adds a small surface that didn't exist before (`dismissByKey`). One unit test covers the key behavior.
- The deferred-promise test pattern for `TokenCard` is generally useful — I'll keep that test as a fixture-friendly example for future composable tests.
