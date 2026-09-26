# Batch 1 recon

Two read-only agents on the arc base (`origin/dev` + docs): a reuse sweep over every capability
the batch needs, and a mapper of the fee card. Consolidated here; file references are
repo-relative (`apps/extension/src/...` unless stated).

## Reuse map

| Capability | Existing code | Verdict |
|---|---|---|
| Default account name | `DEFAULT_ACCOUNT_NAME = "Account"` (`wallet/services/account/spec.ts:6`), passed bare by `account/service.ts:227` (`provisionDefaultAccount`), `composables/useProfileBootstrap.ts:106`, `popup/network-switch.ts:71` | **adapt**: the constant becomes `"Account 1"` |
| Numbering later accounts | `NewAccountPopup.vue:101-109`: smallest free `Account ${n}` over `appStore.accounts` (one profile, one network) | **adapt**: lift the loop into a pure helper both the popup and the constant's test use |
| Avatar initials | `utils/string.ts:21` `getInitials`: "Account" → "AC", "Account 1" → "A1" | **reuse as is** (the A1/A2 of the spec follow from the name) |
| First-profile detection, default names | none: no code yields "Main" or "Profile N"; `appStore.soleProfile` exists but only for activity scope. Search: `profiles.length`, `profiles.value.length`, `"Main"`, `` `Profile ${`` over `apps/extension/src` | **build new**: one pure naming helper plus a first-profile step in the two flow composables |
| Profile-name fields | four pages, not two: `onboarding/pages/create.vue:115` and `onboarding/pages/import.vue:139` (both `OnboardingProfileNameField.vue`, testid `onboarding-name-input`), `popup/pages/profile/new.vue:99` (`register-name-input`), `popup/pages/import.vue:176` (`import-name-input`) | **adapt** all four |
| Name validation | `composables/useProfileNameField.ts` (1–32 chars, NFKC case-folded duplicate check at submit) | **reuse as is** |
| Backup name | `useFullBackupImport.ts:431` (trimmed override wins, else the backup's name); `useProfileImportFlow.ts:413` (prefill the field from the parsed backup only while it is empty) | **reuse**, with one decision: a prefilled default must not block the backup's name |
| Lock chip | `components/Header.vue:320` icon-only `MaterialIcon lock` (`header-lock`, `aria-label="Lock wallet"`); sibling `.network_chip` (`:308`, styles `:460`) is the pattern | **adapt** |
| Private/public glyphs | `BalanceView.vue:293,298` and `TokenCard.vue:95,98`: `<Icon name="lock">` / `<Icon name="globe">`, coloured by the wrapping span | **reuse** the icons and the colour-by-parent convention |
| Send marks | `components/composite/send/publish-mark.module.css` shared by `PublishStrip.vue`, `SendReviewSheet.vue` rows, `FeeMethodSelector.vue` tag; four states `hidden`/`public`/`exposed`/`unknown` (`publish-facts.ts:4`) | **adapt**: one mark component for all three consumers |
| Screen-reader-only text | none (searched `sr-only`, `srOnly`, `visually-hidden`, `visuallyHidden`, `clip: rect`, `screen reader` in `apps/extension/src`, `packages/design/src`) | **build new**, local to the readout |
| Fee readout states | `FeeCostReadout.vue`: estimating, estimated, idle; props `estimate`, `isEstimating` only; no payer signal | **adapt**: the card passes whether the sponsor pays |
| Sponsor signal | `FeeSettingsCard.vue:185` `effectiveMethod.type === "fpc"` (only `DefaultSponsoredFpc` rows become `fpc` options, `fee-helpers.ts:168`) | **reuse** |
| Menu spend column | `FeeMethodSelector.vue:52-69` prints `subtitle` ("public"/"private"/"sponsored") or `disabledReason`; balances live in `FeeSettingsCard.vue:131-136` (`formatGasBalance`) | **adapt**: the option carries its spend label |
| USD / FJ formatting | `utils/fee-estimation.ts`: `formatFeeJuice` (amount, 6 dp), `feeToUsd` (`null` without a live quote), `formatGasBalance` (balances) | **reuse unchanged** |

## Facts the plan rests on

- Popup `profile/new.vue` and `popup/pages/import.vue` create **first** profiles in production
  (after the last profile is deleted, `onboardingCompleted` stays true, `reset.vue`, route guard
  `popup/route-guard.ts:47`) and in e2e: `launchExtension()` seeds `nulo:onboarding:completed`
  so `registerProfile()` (`tests/e2e/fixtures/extension.ts:272`) creates every suite's first
  profile through `profile/new.vue`, typing "Test Profile".
- `createAndActivateProfile()` (`fixtures/helpers.ts:351`) always adds a later profile and sets
  the field with a native value setter (full replace).
- `importSeed()` (`tests/e2e/helpers/import-drivers.ts:188`) writes "Imported Profile" into the
  shell's name field unconditionally; callers run on fresh (first-profile) and populated contexts.
- Smoke = `tests/e2e/*.test.ts`; network = `tests/e2e/network/**`.
- The fee menu order is Public, Private, Sponsored (`fee-helpers.ts:160`), as drawn.
- The seeded sponsor name is stored once per profile and chain (`fpc/service.ts:253`, root
  `nulo:core:fpcs`) and protocol rows refuse renames (`fpc/service.ts:340`); the fallback
  "Sponsored FPC" only shows for an unnamed row.
- Home's pair reads "Public Juice" / "Private Fee Juice" today (`GasBalanceCard.vue:161,170`);
  the method row's balance says "Fee Juice" as a unit for public and "FJ" for private
  (`FeeMethodRow.vue:31,42`); the locked row says "Fee Juice · set by the app"
  (`FeeSettingsCard.vue:740`).
- Storybook scans `src/components/**`, `src/design/**`, `packages/design/src/**` only
  (`.storybook/main.ts:23`); `PublishStrip.stories.ts` is the one story this batch reaches.
- Out of scope and already correct: "Public/Private Fee Juice" in `tx-detail-helpers.ts` and
  `fpc-helpers.ts`; `feeJuiceName` (`wallet/utils/fee-juice.ts:11`) is the token's name.

## Tests the change reaches

Unit/component: `account/service.test.ts:524`, `popup/network-switch.test.ts:69,188`,
`useProfileBootstrap.test.ts:68` (mock shape), `FeeCostReadout.test.ts:21,27`,
`FeeMethodSelector.test.ts:45,89-92`, `FeeMethodRow.test.ts:23,78`, `fee-privacy.test.ts:219`,
`PublishStrip.test.ts:12,23-39,71`, `SendReviewSheet.test.ts:169-174`.

e2e smoke: `fixtures/extension.ts` (`registerProfile`), `helpers/import-drivers.ts` (both shells),
`onboarding-tab.test.ts:54`, `legal-acceptance.test.ts:64,92,208,334`, `onboarding-import.test.ts`,
`import-paths.test.ts`, `backup-migration.test.ts`, `backup-roundtrip.test.ts`,
`import-dead-rpc.test.ts`, `helpers/crash-truth.ts`, `account-import-export.test.ts` (×5
`exportAccountBody("Account")`), `backup-imported-account.test.ts:50`,
`imported-account-lifecycle.test.ts:58,139`; found while planning: `registration.test.ts:33`,
`fixtures/passkey.ts:22`, `passkey-backup.test.ts:85`, `passkey-paths.test.ts:174`,
`duplicate-phrase-import.test.ts:34`, and the manual `scripts/check-derivation-parity.ts:133`.

e2e network: `imported-account-execution.test.ts:72,125`, `account-balance-orphans.test.ts:108`,
`profile-reimport-matrix.test.ts`, `backup-migration-roundtrip.test.ts`,
`backup-restore-integrity.test.ts`, `backup-restore-sw-restart.test.ts`,
`profile-switch-sweeps-transfer.test.ts`, `session-profileSwitch.test.ts` (second profile).

Verified unaffected: `Header.test.ts` and `lockWallet()` (testid only), `GasBalanceCard.test.ts`
(reads values, not labels), `send-fee-privacy.test.ts` and the fee-method network specs (testids,
`data-fee-method`, substring "Sponsored"), `accounts.test.ts` (types its own name),
`auth-flows.test.ts` (truthiness), synthetic backups naming a restored account "Account".
