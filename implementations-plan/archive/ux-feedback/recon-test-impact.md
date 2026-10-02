# Test impact survey

Which existing tests each surface's change touches, and where new ones belong. From one
read-only survey of `origin/dev` at program setup (2026-09-23); each batch's recon re-verifies its
rows against the tree it builds on. Rows marked _by name_ were found but not opened.

## Shared fixtures with the widest reach

| Fixture | Where | Why it matters |
|---|---|---|
| `registerProfile()` | `apps/extension/tests/e2e/fixtures/extension.ts` | Creates the first test profile through the **popup** page `popup/pages/profile/new.vue` (testid `register-name-input`), behind `registeredExtension` and most specs. Batch 1 keeps that field for later profiles but prefills it, so the fixture must clear before typing, and the first-profile rule decides whether this page shows the field at all when no profile exists. |
| `createAndActivateProfile()` | `fixtures/helpers.ts:351` | Same field, second profile mid-run (`network/profile-switch-sweeps-transfer`, `network/session-profileSwitch`). |
| `exportAccountBody(page, "Account", …)` | `helpers/account-io.ts:128` | 12 calls in 6 files pass the literal default account name (`account-import-export` ×5, `network/account-balance-orphans`, `backup-imported-account`, `legal-acceptance`, `imported-account-lifecycle` ×2, `network/imported-account-execution` ×2). Batch 1 changes them to "Account 1"; synthetic legacy backup payloads (`passkey-backup.test.ts:153`, `helpers/import-drivers.ts:420`) keep "Account". |
| `waitForToast()` | `fixtures/helpers.ts:1334` | Substring poll on `document.body.textContent`, position-agnostic; ≥8 specs plus `account-io.ts`. Batch 4 keeps it working; its "~2s" doc and any disappearance assumption change. |
| `centerOn` / `WindowManager.openAndAwait` | `wallet/services/window-manager/window-manager.ts` | 7 unit cases pin exact `{left, top}`. |

## Batch 1 · First run and wording

- **Account names**: `DEFAULT_ACCOUNT_NAME` (`wallet/services/account/spec.ts:6`) names the first
  account of every `(profileId, chainId)`; consumers `useProfileBootstrap.ts`,
  `popup/network-switch.ts`, `account/service.ts` (`provisionDefaultAccount`). `NewAccountPopup.vue:102`
  already numbers later accounts. Tests: `account/service.test.ts:524`,
  `popup/network-switch.test.ts:69,188`, `composables/useProfileBootstrap.test.ts:68`, the 12 e2e
  calls above. Gaps: nothing drives `NewAccountPopup`'s numbering; nothing checks per-network
  numbering.
- **First run**: `onboarding/pages/create.vue:115` and `onboarding/pages/import.vue:139` both use
  `OnboardingProfileNameField.vue` (testid `onboarding-name-input`); validation in
  `composables/useProfileNameField.ts`; `useProfileCreateFlow.ts` passes the name to
  `createProfile` and no default generator exists. e2e on `#/onboarding/create`:
  `onboarding-tab.test.ts:54`, `legal-acceptance.test.ts:64`. Component and composable tests keep
  passing unless the component is deleted.
- **Fee wording**: "Fee Source" `FeeMethodSelector.vue:26`; "Estimated Network Fee"
  `FeeCostReadout.vue:21,25`; `SPONSORED_FPC_DEFAULT_NAME = "Sponsored Fee Juice"`
  (`fpc/service.ts:45,252`); a second fallback "Sponsored FPC" in `send/fee-helpers.ts:171` and
  `send/fee-privacy.ts:105` (asserted by `fee-privacy.test.ts:16,36,219`, `fee-helpers.test.ts`).
  Send and the execute window both mount `FeeSettingsCard`. No test pins "Fee Source"; "You pay",
  "Nothing" and the strike are new. e2e (`send-fee-privacy`, `network/fee-methods`) select by
  attributes and testids only; `network/tx-sendTx-sponsoredFpc` _by name_.
- **Lock chip**: `components/Header.vue:319` (testid `header-lock`, icon-only, `aria-label="Lock
  wallet"`); the sibling `.network_chip` (`:306`) is the template. `Header.test.ts:130` and e2e
  (`passkey-paths`, `fixtures/helpers.ts` `lockWallet`) click by testid: keep it on the chip's root.
- **Privacy strip**: `components/composite/send/PublishStrip.vue` (testid `send-publish-strip`)
  draws marks from `publish-mark.module.css`, which is **shared** with `SendReviewSheet.vue:104`
  and `FeeMethodSelector.vue:33` (the "names your address" tag). `PublishStrip.test.ts` (8 of 9
  cases assert the `<i>` mark classes) breaks; the other two break only if the shared module
  changes. See spec U12.

## Batch 2 · Window placement

- Two creation paths: `WindowManager.openAndAwait()` (execute, capabilities, discover via
  `dapp-interaction/service.ts:440`) and `wallet-sdk/session-established.ts:190`
  (`openVerifyWindow`, the emoji window) calling `windows.create` directly with no position.
- Tests: `window-manager.test.ts:361-407,436-449` (7 exact-pixel cases);
  `session-established.test.ts` has no position assertions. No e2e asserts window position; the
  Firefox driver doc has no row for it.

## Batch 3 · Tooltips and glossary

- `packages/design/src/ui/Tooltip.vue` is the only tooltip (resolver `NULO_DESIGN_COMPONENTS`):
  `maxWidth` defaults to `undefined`, the only clamp is `max-width: calc(var(--base-width) - 40px)`,
  and the position resolver does no viewport clamping. `Tooltip.test.ts` "positioning geometry"
  has 12 exact-pixel cases with no viewport. 33 usages in 24 files (list in the survey), plus
  `Input.vue`. Consumers' tests mostly stub `Tooltip`.
- Glossary: `popup/pages/settings/index.vue` `ItemsContainer title="App"` (Appearance, Proving,
  Advanced) takes a new `SettingItem` to a new page under `popup/pages/settings/`; no
  `SettingItem.test.ts` exists; `settings-crud.test.ts` never enumerates the App rows.
- Rule-6 texts: `components/composite/DappIdentityBlock.vue:47` (execute, capabilities, and
  _likely_ discover windows) — `DappIdentityBlock.test.ts:49-57` asserts the tooltip stub and
  must be rewritten; `components/composite/import/ImportSecretForm.vue:35` (onboarding and popup
  import) — no test guards it.

## Batch 4 · Snackbar, rows, arrivals

- Toasts: `packages/design/src/composables/toast.ts` (`useToast`, `TOAST_DURATION` 1500/2000/4000,
  every toast auto-closes, `color` is the only severity), `ToastManagerBase.vue` (top-centre,
  teleported to `#toast`, no timer bar), `apps/extension/src/components/ui/ToastManager.vue`,
  `composables/toast.js` shim (~55 import sites). 57 files call `openToast`, 6 pass
  `color: "red"`: classifying errors is real work. `packages/design/src/ui/Toast.vue` is a
  different, idle component; not the live one. Tests: `toast.test.ts` (14, fake timers pin the
  durations), `ToastManagerBase.test.ts` (9), `ToastManager.test.ts` (2).
- Rows: `TokenCard.vue:117` and `TransactionCard.vue:210` duplicate one hover rule with no focus
  state; `TransactionIncomingCard.vue` has none; `TransactionCardLayout.vue` (shared by all four
  activity cards) owns none; `SettingItem.vue:108` is the richest. No test observes hover/focus.
- Arrivals: `composables/useIncomingTransfers.ts` (`onAdded` unshifts, no "just arrived" signal),
  used by `popup/pages/activity.vue` and `modules/general/RecentActivityView.vue`; backend in
  `wallet/services/incoming-transfer/`. e2e `network/incoming-transfers`,
  `network/incoming-public-transfers`, `fixtures/incoming-poll-gate.ts` _by name_: check the
  animation against their waits.

## Batch 5 · Permissions

- Window: `popup/windows/capabilities/index.vue`, `build-items.ts` (the authwit rider),
  `CapabilityCard.vue` (testids `cap-item`, `cap-toggle`, `cap-detail-toggle`,
  `cap-unrecognized-badge`, `cap-rerequested-badge`), `AccountSelectRow.vue` (Alias ⓘ,
  `cap-account-alias-input`), `components/composite/capabilities/CapabilityDetailPanel.vue`,
  `ScopePatternList.vue`, `components/ScopeAddress.vue`; copy in `dapp-session/capability-meta.ts`.
  Footer testids `cap-approve-btn`, `cap-reject-btn`, `cap-switch-network-btn`, `cap-chain-banner`.
- Routing: `packages/wallet-bridge/src/dispatcher.ts` `handleCreateAuthWit` (~979–1020): covered by
  tx/simulation scope → signs silently (~990), otherwise → the execute/approval window. Off = ask
  adds the per-app flag to that branch. `AccountsCapability` (`wallet-bridge/src/capabilities.ts:16`)
  has no such field yet; grants persist in `DappSession.capabilityGrants`, so an absent field reads
  as today's behaviour. `method-scope-checkers.ts:270` (`isCreateAuthWitCoveredByTxOrSimulationScope`)
  and `:276` (`checkCreateAuthWit`). The dispatcher's own test file is the first to read.
- Tests: unit `capabilities/index.test.ts`, `chain-mismatch.test.ts`, `chain-switch.test.ts`,
  `reentrancy.test.ts`, `build-items.test.ts`, `CapabilityCard.test.ts`, `AccountSelectRow.test.ts`,
  `CapabilityDetailPanel.test.ts`, `ScopePatternList.test.ts`,
  `execute/OperationCard.createAuthwit.test.ts`; e2e (_by name_) `network/cap-request-basic`,
  `-accounts`, `-partial` (unticking: rewrite onto the switch rows), `-reject`,
  `-repeat-noPopup`, `-rerequest`, `cap-widening`, `cap-chain-mismatch`, `connect-dapp`,
  `connect-deny`, `err-scope-and-cap`, `home-cap`, `public-events-capability`, and
  `authwit-consume-smoke`, `authwit-lifecycle`, `authwit-variants`.
- Driver: `apps/playground` already exposes `createAuthWit` (call intent and inner hash) with
  stable testids (`apps/playground/README.md`), so Off = ask needs no new dApp code.
