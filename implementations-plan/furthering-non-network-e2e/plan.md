# Furthering non-network e2e — implementation plan

**Status**: planned
**Owner**: brutalist-redesign team
**Branch**: `e2e/non-network-expansion`
**Audited by**: Codex (xhigh, gpt-5.4) + Claude general-purpose agent

---

## 1. Why this exists

The Nulo wallet currently has **15 active non-network e2e tests** spread across 5 files (registration, navigation, contacts, accounts, wallet-lock). Master CI reports those plus 14 active network tests as 31/31 + 5 intentional skips.

The product is now in an LLM-driven dev cycle: agents make refactors, type cleanups, package extractions, UI redesigns. **The fastest signal "did I break a real user flow?" is `bun run test:e2e`** (which already excludes `network/**` and `slow/**` per `vitest.e2e.config.ts`). For that signal to be trustworthy, the suite needs to actually exercise the surfaces an LLM is most likely to break.

Today's 15-test suite covers ~30 % of the user-reachable paths. The biggest gaps are in places where v0.13.0 just shipped major changes:

- The entire **security branch** (change-password, reset, backup → seed/key/full)
- **Networks / FPCs CRUD** (no tests at all)
- **Auth** beyond the happy path (wrong-password, ForgotPassword, SelectProfile)
- **Profile rename** via popup
- **Privacy / Appearance** settings
- **Service-worker resilience** (lock → reload → unlock)

This plan adds **~32 new tests across 7 PRs**, raising the non-network suite to ~47 active tests in roughly 3-4 minutes runtime.

## 2. Non-goals

- Do not test real Aztec network operations (those live in `tests/e2e/network/`).
- Do not test motion / hero scroll / theme color rendering — assert structural state only (`html[theme=…]`, route hash, presence of testid).
- Do not test power-user `settings/advanced/account-state/*` surfaces — low ROI for LLM regression detection.
- Do not test the `connect-dapp` flow — already disabled, requires harness work.
- Do not intercept downloads or clipboard at the OS level — assert app-visible outcomes (CTA enabled, success toast).

> **Path note**: every file path in this plan is relative to `packages/extension/` unless an explicit `packages/...` prefix is shown. The plan document itself lives at the repo root.

## 3. Constraints

- **Existing scripts already split network from non-network**:
  - `bun run test:e2e` → non-network only (uses `vitest.e2e.config.ts`)
  - `bun run test:e2e:network` → network only
  - `bun run test:e2e:all` → both
  No new npm scripts needed.
- **`fileParallelism: false`** is set in all e2e configs — files run serially, one browser fixture at a time. Total runtime = sum of file durations. The auditor-suggested `maxConcurrency=3` is irrelevant under this setting; we leave it alone.
- **Each test gets a fresh browser via `registeredExtension` fixture** (file-scoped by default). Per-test scope (`scope: "test"`) is reserved for tests that wipe state mid-flow (e.g., reset-profile).
- **Selector contract**: `[data-testid="…"]` only. No text matching. List rows compose `data-<entity>-id` (stable) and `data-<entity>-name` (display) attributes.
- **Vue auto-imports** are configured for `ref`, `computed`, `useTemplateRef`, etc. — tests don't worry about these.

## 4. Path map (final, audited)

```
┌─────────────────────────────────────────┬──────────┬────────────────────────────────────────────────────────────┐
│ Area                                    │ Decision │ Notes                                                      │
├─────────────────────────────────────────┼──────────┼────────────────────────────────────────────────────────────┤
│ Auth: wrong pwd / ForgotPwd / SelectPrf │ ADD      │ auth-flows.test.ts (4 tests)                               │
│ Profile rename via EditProfilePopup     │ ADD      │ + no-op-rename disabled state                              │
│ Change password (validation + success)  │ ADD      │ rolled into security.test.ts                               │
│ Reset profile (gates + success)         │ ADD      │ scope:test fixture, dynamic name read                      │
│ Backup: seed + key + full               │ ADD      │ security-backup.test.ts (4 tests, 3 describe)              │
│ Auto-lock TTL change persists           │ ADD      │ rolled into security.test.ts                               │
│ Networks CRUD (add / edit / delete)     │ ADD      │ rolled into settings-crud.test.ts                          │
│ FPCs CRUD                               │ ADD      │ rolled into settings-crud.test.ts                          │
│ Token edit (rename, decimals)           │ ADD      │ rolled into settings-crud.test.ts                          │
│ Token import — non-network validation   │ ADD (1)  │ single client-side validation smoke                        │
│ Account: edit name + hide/show          │ ADD      │ extends accounts.test.ts                                   │
│ Theme picker + animations toggle        │ ADD      │ appearance.test.ts (3 tests)                               │
│ Privacy toggles (5)                     │ ADD      │ privacy.test.ts (5 tests)                                  │
│ SW-disconnect resilience                │ ADD ★    │ sw-resilience.test.ts (1 test) — top-priority addition     │
├─────────────────────────────────────────┼──────────┼────────────────────────────────────────────────────────────┤
│ About page                              │ SKIP     │ user explicitly said no need                               │
│ Import contacts file flow               │ DEFER    │ file-picker mock too brittle right now                     │
│ Advanced settings (account-state etc.)  │ DEFER    │ low ROI for LLM regression goal                            │
│ dApp connect roundtrip                  │ DEFER    │ already disabled                                           │
│ Profile creation full flow (passkey)    │ DEFER    │ existing registration.test.ts covers password path         │
│ Real network ops (transfers, fees)      │ KEEP     │ stays in network/ suite                                    │
│ Slow ops (mint-token)                   │ KEEP     │ stays in slow/ suite                                       │
└─────────────────────────────────────────┴──────────┴────────────────────────────────────────────────────────────┘
★ = both auditors flagged as highest-priority addition
```

## 5. Conventions

### 5.1 testid naming

```
<area>-<entity>-<verb>
```

Examples already in tree (do not rename):
- `setting-nav-{profile,accounts,security,privacy,…}`
- `contact-row` + `data-contact-name="…"`
- `manage-accounts-row` + `data-account-name="…"`
- `account-name-input`, `new-account-submit`
- `auth-{profile,password-input,submit,reset}`
- `register-{create-btn,import-btn,method-password,method-passkey,submit-btn}`

### 5.2 Row scoping

For every list with mutable rows, expose **two** identifying attributes:
- `data-<entity>-id="…"` — stable identifier (DB id, contract address, chain id) — preferred for selector composition
- `data-<entity>-name="…"` — user-visible name — readable in failing test output

Tests select rows by id wherever possible; names are used for assertion / debugging.

### 5.3 Drops vs. my original plan

**Do NOT add**:
- `<area>-page` root testids — use `await waitForHash(page, "#/popup/…")`. Saves ~6 testids; route hash IS the contract.
- `auto-lock-current-value` — input element itself is the assertion target (`page.evaluate(() => input.value)`).
- `reveal-show-toggle` + `reveal-copy-btn` separately — replace with one `reveal-content` container; tests assert on the container's textContent.

### 5.4 Inline error / negative-path hooks

Validation errors and inline error text must surface via `[data-testid="error-text"]` AND `role="alert"` (a11y + tests). Currently inconsistent.

### 5.5 Helper API additions (`tests/e2e/fixtures/helpers.ts`)

New helpers (alphabetical):

| Helper | Purpose |
|---|---|
| `addFpc(page, {name, contract})` | Open NewFpcPopup → fill → submit |
| `addNetwork(page, {name, rpcUrl, chainId})` | Open NewNetworkPopup → fill → submit |
| `changePassword(page, oldPwd, newPwd)` | Navigate to change-password, fill all 3 inputs, submit |
| `acceptConfirmPopup(page)` | Wait for ConfirmPopup, click confirm/submit (renamed from misleading "dismiss"; see ConfirmPopup.vue testids `confirm-cancel`, `confirm-submit`) |
| `closeAllPopups(page)` | Calls `popupStore.closeAll()` via page.evaluate |
| `deleteFpc(page, id)` | Click row's edit → delete → ConfirmPopup accept |
| `deleteNetwork(page, id)` | Click row's edit → delete → ConfirmPopup accept |
| `editFpcName(page, id, newName)` | Open EditFpcPopup for given id, replace name, save |
| `editNetworkName(page, id, newName)` | Open EditNetworkPopup for given id, replace name, save |
| `getActiveProfileName(page)` | Reads `data-profile-name` attribute on /popup/settings/security/reset root |
| `getPrivacySetting(page, key)` | Reads `data-checked` / `aria-checked` for given setting |
| `openForgotPasswordFromAuth(page)` | On auth screen, click reset link, popup mounts |
| `renameProfile(page, newName)` | Open EditProfilePopup from settings/profile, save |
| `resetProfile(page)` | Tick all 3 checkboxes, type profile name, submit |
| `revealSeedPhrase(page, password)` | **Void**. Performs unlock; assertions happen in test scoped to `[data-testid="reveal-content"]` |
| `revealSecretKey(page, password, variant)` | Same shape as above, "plain" or "encrypted" |
| `setInputAndBlur(page, selector, value)` | `replaceInputValue` + dispatches `blur` to surface validation errors |
| `setTheme(page, "system" \| "light" \| "dark")` | Click theme button, verify `html[theme=…]` |
| `togglePrivacySetting(page, key)` | Click toggle, return new state |

**Modifications to existing helpers**:
- `clickByTestId(page, id)` — add a "visible-only" filter so it skips hidden popup buttons during transitions. Use `getBoundingClientRect().width > 0` + `offsetParent !== null`.

**Drops**:
- `setAutoLockMinutes` proposed earlier — drop. Without fake-timer support, we can't actually verify auto-lock fires at N minutes. Pure storage assertion belongs in unit tests.

## 6. PR breakdown

7 PRs on the `e2e/non-network-expansion` branch. Each is independently mergeable. Each must pass `bun run test:e2e` before the next starts.

### PR 1 — `chore(test): shared testid + helper infra`

**Scope**:
- Add helpers listed in §5.5 to `tests/e2e/fixtures/helpers.ts`. Empty implementations OK at this stage where they need testids that don't exist yet — those land with the area PR that uses them. Only land *generic* helpers here:
  - `dismissConfirmPopup`, `closeAllPopups`, `setInputAndBlur`, `setTheme`, `getActiveProfileName`, `togglePrivacySetting`, `getPrivacySetting`
- Add visible-only filter to `clickByTestId` in `tests/e2e/fixtures/extension.ts`.
- Document the testid naming convention as a comment in `helpers.ts`.

**Tests added**: 0
**Verifies**: `bun run test:e2e` still passes (no regressions in existing 15 tests).

### PR 2 — `feat(test): security branch e2e`

**Scope**:
- Add testids to:
  - `pages/settings/security/index.vue`: `auto-lock-input`, `backup-link-btn`
  - `pages/settings/security/change-password.vue`: `current-password-input`, `new-password-input`, `new-password-repeat-input`, `change-password-submit-btn`, `error-text` on validation errors
  - `pages/settings/security/reset.vue`: `reset-checkbox-{permanent,undone,sure}`, `reset-confirm-input`, `reset-submit-btn`, `data-profile-name="…"` on root
  - `pages/settings/security/export/index.vue`: `full-backup-link-btn`, `seed-phrase-link-btn`, `secret-key-link-btn`
  - `pages/settings/security/export/seed.vue`: `agree-continue-btn`, `unlock-password-input`, `unlock-submit-btn`, `reveal-content`, `close-btn`
  - `pages/settings/security/export/key.vue`: same + variant pickers (`key-variant-plain-btn`, `key-variant-encrypted-btn`)
  - `pages/settings/security/export/full.vue`: `agree-continue-btn`, `unlock-password-input`, `unlock-submit-btn`, `protect-password-btn`, `download-backup-btn`
- Add helpers: `changePassword`, `resetProfile`, `revealSeedPhrase`, `revealSecretKey`
- New file: `tests/e2e/security.test.ts` (3 tests)
  - validation: change-password rejects mismatched / too-short
  - happy path: change-password → lock → unlock with new password
  - auto-lock: change TTL, navigate away/back, value persists
- New file: `tests/e2e/security-reset.test.ts` (1 test, `scope: "test"`)
  - reset → all checkboxes + dynamic name match → /popup/register
- New file: `tests/e2e/security-backup.test.ts` (4 tests)
  - seed reveal returns 24 word-like tokens in `reveal-content`
  - secret-key plain variant reveals
  - secret-key encrypted variant reveals
  - full-backup: agree → unlock → download CTA enabled + toast fires (no file inspection)

**Tests added**: 8

### PR 3 — `feat(test): settings CRUD e2e (networks + fpcs + token edit)`

**Scope**:
- Add testids to:
  - `pages/settings/networks/index.vue`: `network-row` + `data-network-id` + `data-network-name`, `network-edit-btn`, `network-delete-btn`, `network-new-btn` (no root `*-page` testid — use `waitForHash(page, "#/popup/settings/networks")`)
  - `popups/NewNetworkPopup.vue`: `network-name-input`, `network-rpc-input`, `network-chain-id-input`, `new-network-submit`, `new-network-cancel`
  - `popups/EditNetworkPopup.vue`: same fields + `edit-network-delete-btn`
  - `pages/settings/fpcs/index.vue`: `fpc-row` + `data-fpc-id` + `data-fpc-name`, `fpc-edit-btn`, `fpc-delete-btn`, `fpc-new-btn`
  - `popups/NewFpcPopup.vue` + `popups/EditFpcPopup.vue`: parallel
  - `popups/EditTokenPopup.vue`: `token-name-input`, `token-symbol-input`, `edit-token-submit`
  - `popups/NewTokenPopup/NewTokenPopup.vue`: ensure `token-address-input` + `import-token-button` already exist (used by network suite); add `error-text` for the validation smoke
- Add helpers: `addNetwork`, `deleteNetwork`, `editNetworkName`, `addFpc`, `editFpcName`, `deleteFpc`
- New file: `tests/e2e/settings-crud.test.ts` (~9 tests)
  - networks: add → row visible by id → edit name → row reflects new name → delete → row gone (3 tests — split for clarity)
  - fpcs: add → edit → delete (3 tests, parallel)
  - token edit: rename → reflected in tokens list (1 test)
  - token decimals: edit decimals → reflected in tokens list (1 test)
  - token import — non-network validation: open NewTokenPopup, paste invalid contract string, assert `error-text` surfaces; valid-shape but unimported address keeps submit gated (1 test, no contract probe)
  - **persistence**: each network/fpc/token helper closes popup then reopens row in EditPopup to confirm save persisted (Codex's gap)

**Tests added**: ~9

### PR 4 — `feat(test): auth + profile flows`

**Scope**:
- Add testids to:
  - `pages/auth.vue`: `error-text` on wrong password (currently only inline span)
  - `popups/ForgotPasswordPopup.vue`: `forgot-reset-btn`, `forgot-report-btn`
  - `popups/SelectProfilePopup.vue`: `select-profile-row` + `data-profile-id` + `data-profile-name`, `select-profile-new-btn`, `select-profile-import-btn`
  - `popups/EditProfilePopup.vue`: `profile-name-input`, `edit-profile-submit`, `edit-profile-cancel`
  - `pages/settings/profile/index.vue`: `identity-name-row`, `identity-id-row`, `backup-link-btn`, `change-password-link-btn`, `delete-profile-link-btn`
- Add helpers: `openForgotPasswordFromAuth`, `renameProfile`
- New file: `tests/e2e/auth-flows.test.ts` (4 tests)
  - wrong password shows error, can retry
  - ForgotPassword link → popup opens → click reset → on /popup/settings/security/reset
  - SelectProfile from auth → popup lists current profile
  - SelectProfile → "New profile" routes to /popup/profile/new
- New file: `tests/e2e/profile-rename.test.ts` (3 tests)
  - rename via popup → reflected in settings/profile name row + auth profile pill
  - no-op rename: typing the same name disables submit (LLM regression target)
  - cancel discards change

**Tests added**: 7

### PR 5 — `feat(test): appearance + privacy e2e`

**Scope**:
- Add testids to:
  - `pages/settings/appearance.vue`: `theme-system-btn`, `theme-light-btn`, `theme-dark-btn`, `animations-toggle`
  - `pages/settings/privacy/index.vue`: `setting-{external-links,contract-registry,walletconnect,external-images}` (stealth-mode-toggle exists)
- Add helpers: `setTheme` is already in PR 1's infra
- New file: `tests/e2e/appearance.test.ts` (3 tests)
  - cycle theme: system → light → dark → verify `html[theme=…]` after each
  - animations toggle persists across reload
  - theme persists across navigation away and back
- New file: `tests/e2e/privacy.test.ts` (5 tests)
  - each toggle: stealth, external-links, contract-registry, walletconnect, external-images — flip and verify state via `getPrivacySetting`
  - stealth-disable: verify warning surfaces (could be a banner / inline text — assert structural presence, not copy)

**Tests added**: 8

### PR 6 — `feat(test): SW-disconnect resilience`

**Scope**:
- 1 test, surgical, no new testids needed (uses existing lock/unlock).
- New file: `tests/e2e/sw-resilience.test.ts`:
  - `lockWallet` → `chrome.runtime.reload()` via debugger CDP → wait for SW liveness → `unlockWallet` → on /popup/general
- This is the Codex-flagged top-priority test. Catches storage migration / SW bootstrap regressions. **Must NOT be flaky** — if it ever flakes, demote to skipped + open issue.

**Tests added**: 1

### PR 7 — `feat(test): account extras`

**Scope**:
- Add testids to:
  - `popups/EditAccountPopup.vue`: `account-name-input` (already exists?), `edit-account-submit`, `account-hide-toggle`, `account-show-toggle`
- Extends `accounts.test.ts`:
  - edit account name → reflected in `data-account-name`
  - hide account → row shows `data-hidden="true"` → re-show

**Tests added**: 2

### Summary

| PR | Tests | Cumulative |
|---|---|---|
| 1 (infra) | 0 | 15 (baseline) |
| 2 (security) | 8 | 23 |
| 3 (settings-crud) | 9 | 32 |
| 4 (auth + profile) | 7 | 39 |
| 5 (appearance + privacy) | 8 | 47 |
| 6 (sw-resilience) | 1 | 48 |
| 7 (account extras) | 2 | 50 |

Final non-network suite: **~50 active tests**, runtime ~3-4 minutes (sequential, file-scoped browsers).

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Reset-profile redirect race (sync `deleteProfile` then `router.push`) | HIGH | `scope: "test"` fixture for `security-reset.test.ts`; helper waits for hash change |
| Hidden popup buttons clicked during transitions | MED | Visible-only filter on `clickByTestId` in PR 1 |
| Toast lifetime ~2s vs slow follow-up assertion | MED | Assert on next visible side effect (row, hash), not toast presence |
| Storage migration leak across tests | LOW | Each fixture spawns fresh `--user-data-dir` (verified) |
| Stealth-mode default `true` leaking into next test | LOW | Privacy test uses fresh fixture; resets state |
| `EditProfilePopup` `isAlreadyExist` check may not be `data-testid`-able as a "disabled" state | LOW | Inspect during PR 4; if not, assert via `disabled` attribute on submit |
| Network test isolation: e2e harness spawns its own Aztec sandbox; non-network suite must NOT trigger that | LOW | `vitest.e2e.config.ts` already excludes `network/**` and `slow/**` |
| `fileParallelism: false` means total runtime grows linearly with files | MED | Keep file count to 7-8; no over-fragmentation |

## 8. Verification rhythm

Per PR (in order):

1. **Pre-PR**: `bun run test:e2e` baseline → must pass on the branch tip before changes.
2. **Per testid add**: rebuild popup, smoke the page manually if testid is on a hidden element.
3. **Per test added**: run *just that test* with `bunx vitest run tests/e2e/<file>.test.ts --config vitest.e2e.config.ts` to iterate fast.
4. **Pre-merge of each PR**: full `bun run test:e2e` must be green. If a test in this PR flakes during the pre-merge run, **investigate root cause first** (race, missing wait, popup not visible, etc.). Only after root-cause is understood and is genuinely environmental, demote with `.skip()` AND open a tracked follow-up issue referenced from the test's own `// TODO(#issue): re-enable when X` comment. Never `.skip()` without a paper trail.
5. **Post-PR landing**: `bun run test:e2e:all` (full suite incl. network) once after every 2 PRs to ensure no cross-suite regressions.

## 9. Definition of done

- [ ] All 7 PRs merged into `e2e/non-network-expansion`.
- [ ] `e2e/non-network-expansion` merged into `master` via fast-forward (or merge commit if behind).
- [ ] `bun run test:e2e` reports **50/50** (or current target — the cumulative count, minus any tracked-skip exceptions per §8.4).
- [ ] `bun run test:e2e:network` still 14/14.
- [ ] Any `.skip()` in the suite has a `// TODO(#issue):` reference and is listed in this plan's "Open Questions" section.
- [ ] `helpers.ts` documents the testid naming convention as a top-of-file comment.

## 10. Out of scope (explicitly)

- Adding `test:e2e:non-network` script — already exists as `bun run test:e2e`.
- Setting `maxConcurrency` — irrelevant under `fileParallelism: false`.
- About-page test — user explicitly opted out.
- Real download / clipboard interception — auditors agreed app-visible outcomes are enough.
- Migrating any existing test to a different file structure.

## 11. Open questions for future iteration

- Should `data-testid="*-page"` be added to *some* pages where a route hash isn't unique enough (e.g., dynamic `[id]` routes)? Defer — not blocking.
- Should we add a `bun run test:e2e:fast` that excludes `sw-resilience` (the test that involves a reload) for sub-1-minute LLM checks? Defer — see if 3 min total is fast enough first.
- Should we add visual regression (Percy / Chromatic)? Out of scope; the brutalist redesign is too fresh and would produce noise.

---

**Last updated**: 2026-04-25
