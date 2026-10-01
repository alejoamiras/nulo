# M6 — Vue SFC inventory

Generated 2026-04-28 from `master` d4c0c2e.

Layers per plan: L1 = core/, L2 = ui/, L3 = composite/ (NEW dir, not yet populated), flat = src/components/ root, modules = popup/components/modules/ (mixed L3/L4 — see audit.md), popups = popup/components/popups/, windows = popup/windows/, pages = popup/pages/.

| Path | Lines | Layer | Imports | Module CSS | Has cta |
|---|---|---|---|---|---|
| `components/AddressDisplay.vue` | 111 | flat | 4 | yes | no |
| `components/Divider.vue` | 28 | flat | 0 | yes | no |
| `components/GlobalLoader.vue` | 68 | flat | 2 | yes | no |
| `components/Header.vue` | 398 | flat | 9 | yes | no |
| `components/JsonViewer/JsonViewer.vue` | 177 | flat | 11 | yes | no |
| `components/JsonViewer/LogsViewer.vue` | 811 | flat | 13 | yes | no |
| `components/NotificationManager.vue` | 118 | flat | 1 | yes | no |
| `components/Popup/Popup.vue` | 98 | flat | 2 | yes | no |
| `components/Popup/PopupCard.vue` | 108 | flat | 2 | yes | no |
| `components/core/Flex.vue` | 84 | L1 | 1 | no | no |
| `components/core/Icon.vue` | 109 | L1 | 2 | yes | no |
| `components/core/MaterialIcon.vue` | 29 | L1 | 0 | no | no |
| `components/core/Text.vue` | 77 | L1 | 1 | no | no |
| `components/install.vue` | 11 | flat | 0 | no | no |
| `components/ui/Badge.vue` | 40 | L2 | 0 | yes | no |
| `components/ui/Banner.vue` | 155 | L2 | 0 | yes | no |
| `components/ui/Button.vue` | 303 | L2 | 1 | yes | no |
| `components/ui/Checkbox.vue` | 67 | L2 | 0 | yes | no |
| `components/ui/Dropdown/DropdownDivider.vue` | 12 | L2 | 0 | yes | no |
| `components/ui/Dropdown/DropdownItem.vue` | 53 | L2 | 0 | yes | no |
| `components/ui/Dropdown/DropdownRoot.vue` | 284 | L2 | 3 | yes | no |
| `components/ui/Dropdown/DropdownTitle.vue` | 17 | L2 | 0 | yes | no |
| `components/ui/Dropdown/DropdownTrigger.vue` | 131 | L2 | 1 | yes | no |
| `components/ui/Input.vue` | 396 | L2 | 2 | yes | no |
| `components/ui/LoadingState.vue` | 44 | L2 | 0 | yes | no |
| `components/ui/Popover.vue` | 123 | L2 | 1 | yes | no |
| `components/ui/Popup/PopupHeader.vue` | 58 | L2 | 0 | yes | no |
| `components/ui/SectionLabel.vue` | 40 | L2 | 0 | yes | no |
| `components/ui/Settings/ItemsContainer.vue` | 59 | L2 | 0 | yes | no |
| `components/ui/Settings/SettingField.vue` | 84 | L2 | 0 | yes | no |
| `components/ui/Settings/SettingItem.vue` | 236 | L2 | 0 | yes | no |
| `components/ui/Settings/SettingValue.vue` | 85 | L2 | 0 | yes | no |
| `components/ui/Spinner.vue` | 49 | L2 | 0 | yes | no |
| `components/ui/SubPageHeader.vue` | 126 | L2 | 0 | yes | no |
| `components/ui/ToastManager.vue` | 90 | L2 | 1 | yes | no |
| `components/ui/Toggle.vue` | 98 | L2 | 0 | yes | no |
| `components/ui/Tooltip.vue` | 229 | L2 | 2 | yes | no |
| `components/update.vue` | 12 | flat | 0 | no | no |
| `pages/about.vue` | 9 | flat | 0 | no | no |
| `popup/app.vue` | 320 | flat | 12 | yes | no |
| `popup/components/Navigation.vue` | 95 | popup-flat | 0 | yes | no |
| `popup/components/modules/activity/TransactionAwaitingCard.vue` | 59 | modules | 1 | yes | no |
| `popup/components/modules/activity/TransactionCard.vue` | 201 | modules | 7 | yes | no |
| `popup/components/modules/activity/TransactionCardLayout.vue` | 134 | modules | 0 | yes | no |
| `popup/components/modules/activity/TransactionsList.vue` | 81 | modules | 2 | yes | no |
| `popup/components/modules/capabilities/CapabilityDetailPanel.vue` | 308 | modules | 1 | yes | no |
| `popup/components/modules/general/ActionButtonsView.vue` | 85 | modules | 1 | yes | no |
| `popup/components/modules/general/BalanceView.vue` | 423 | modules | 14 | yes | no |
| `popup/components/modules/general/EmojiGrid.vue` | 44 | modules | 0 | yes | no |
| `popup/components/modules/general/GasBalanceCard.vue` | 186 | modules | 7 | yes | no |
| `popup/components/modules/general/RecentActivityView.vue` | 413 | modules | 11 | yes | no |
| `popup/components/modules/general/SplittedBalancesView.vue` | 188 | modules | 5 | yes | no |
| `popup/components/modules/general/TokenCard.vue` | 131 | modules | 4 | yes | no |
| `popup/components/modules/general/TokensView.vue` | 307 | modules | 8 | yes | no |
| `popup/components/modules/general/WarningView.vue` | 42 | modules | 0 | yes | no |
| `popup/components/modules/send/AmountCard.vue` | 168 | modules | 2 | yes | no |
| `popup/components/modules/send/FeeJuiceCard.vue` | 66 | modules | 1 | yes | no |
| `popup/components/modules/send/FeeSettingsCard.vue` | 721 | modules | 10 | yes | no |
| `popup/components/modules/send/SelectTokenCard.vue` | 126 | modules | 1 | yes | no |
| `popup/components/modules/send/SendTypesCard.vue` | 97 | modules | 0 | yes | no |
| `popup/components/popups/AccountsPopup.vue` | 192 | popups | 4 | yes | no |
| `popup/components/popups/ChangeAuthwitsRegistryPopup.vue` | 170 | popups | 5 | yes | no |
| `popup/components/popups/ConfirmPopup.vue` | 176 | popups | 4 | yes | no |
| `popup/components/popups/DataViewerPopup.vue` | 45 | popups | 2 | yes | no |
| `popup/components/popups/EditAccountPopup.vue` | 189 | popups | 4 | yes | no |
| `popup/components/popups/EditContactPopup.vue` | 442 | popups | 7 | yes | no |
| `popup/components/popups/EditEndpointPopup.vue` | 158 | popups | 5 | yes | no |
| `popup/components/popups/EditFpcPopup.vue` | 216 | popups | 5 | yes | no |
| `popup/components/popups/EditNetworkPopup.vue` | 212 | popups | 4 | yes | no |
| `popup/components/popups/EditProfilePopup.vue` | 162 | popups | 4 | yes | no |
| `popup/components/popups/EditTokenPopup.vue` | 321 | popups | 7 | yes | no |
| `popup/components/popups/ForgotPasswordPopup.vue` | 80 | popups | 2 | yes | no |
| `popup/components/popups/ImportContactsPopup.vue` | 294 | popups | 5 | yes | no |
| `popup/components/popups/NetworksPopup.vue` | 91 | popups | 5 | yes | no |
| `popup/components/popups/NewAccountPopup.vue` | 191 | popups | 4 | yes | no |
| `popup/components/popups/NewContactPopup.vue` | 287 | popups | 6 | yes | no |
| `popup/components/popups/NewEndpointPopup.vue` | 148 | popups | 5 | yes | no |
| `popup/components/popups/NewFpcPopup.vue` | 320 | popups | 8 | yes | no |
| `popup/components/popups/NewNetworkPopup.vue` | 237 | popups | 4 | yes | no |
| `popup/components/popups/NewSenderPopup.vue` | 254 | popups | 5 | yes | no |
| `popup/components/popups/NewTokenPopup/CandidatesForm.vue` | 514 | popups | 1 | yes | no |
| `popup/components/popups/NewTokenPopup/NewTokenPopup.vue` | 350 | popups | 8 | yes | no |
| `popup/components/popups/PopupManager.vue` | 81 | popups | 31 | no | no |
| `popup/components/popups/ReceivePopup.vue` | 105 | popups | 4 | yes | no |
| `popup/components/popups/RevokeAuthwitsPopup.vue` | 347 | popups | 6 | yes | no |
| `popup/components/popups/SelectBalanceTypePopup.vue` | 221 | popups | 3 | yes | no |
| `popup/components/popups/SelectFpcPopup.vue` | 346 | popups | 7 | yes | no |
| `popup/components/popups/SelectNetworksPopup.vue` | 150 | popups | 2 | yes | no |
| `popup/components/popups/SelectProfilePopup.vue` | 165 | popups | 5 | yes | no |
| `popup/components/popups/SelectTokenPopup.vue` | 122 | popups | 4 | yes | no |
| `popup/components/popups/StealthPromoPopup.vue` | 288 | popups | 3 | yes | no |
| `popup/components/popups/TokenMetadataPopup.vue` | 215 | popups | 5 | yes | no |
| `popup/pages/[...catch].vue` | 6 | pages | 0 | no | no |
| `popup/pages/activity.vue` | 177 | pages | 3 | yes | no |
| `popup/pages/auth.vue` | 492 | pages | 8 | yes | no |
| `popup/pages/general.vue` | 45 | pages | 4 | yes | no |
| `popup/pages/import.vue` | 1188 | pages | 21 | yes | yes |
| `popup/pages/index.vue` | 6 | pages | 0 | no | no |
| `popup/pages/profile/new.vue` | 463 | pages | 9 | yes | yes |
| `popup/pages/register.vue` | 194 | pages | 4 | yes | no |
| `popup/pages/send.vue` | 753 | pages | 14 | yes | no |
| `popup/pages/settings/about.vue` | 107 | pages | 1 | yes | no |
| `popup/pages/settings/accounts/index.vue` | 188 | pages | 5 | yes | no |
| `popup/pages/settings/advanced/account-state/authwits/index.vue` | 484 | pages | 7 | yes | no |
| `popup/pages/settings/advanced/account-state/contracts/index.vue` | 188 | pages | 3 | yes | no |
| `popup/pages/settings/advanced/account-state/index.vue` | 68 | pages | 0 | yes | no |
| `popup/pages/settings/advanced/account-state/notes/index.vue` | 476 | pages | 6 | yes | no |
| `popup/pages/settings/advanced/account-state/senders/index.vue` | 235 | pages | 5 | yes | no |
| `popup/pages/settings/advanced/index.vue` | 300 | pages | 7 | yes | no |
| `popup/pages/settings/appearance.vue` | 223 | pages | 4 | yes | no |
| `popup/pages/settings/connected-apps/[id].vue` | 472 | pages | 14 | yes | no |
| `popup/pages/settings/connected-apps/index.vue` | 373 | pages | 4 | yes | no |
| `popup/pages/settings/contacts/index.vue` | 563 | pages | 9 | yes | no |
| `popup/pages/settings/fpcs/index.vue` | 465 | pages | 9 | yes | no |
| `popup/pages/settings/index.vue` | 253 | pages | 1 | yes | no |
| `popup/pages/settings/networks/[id].vue` | 260 | pages | 5 | yes | no |
| `popup/pages/settings/networks/index.vue` | 98 | pages | 4 | yes | no |
| `popup/pages/settings/privacy/index.vue` | 331 | pages | 6 | yes | no |
| `popup/pages/settings/profile/index.vue` | 87 | pages | 2 | yes | no |
| `popup/pages/settings/security/change-password.vue` | 362 | pages | 3 | yes | yes |
| `popup/pages/settings/security/export/full.vue` | 597 | pages | 16 | yes | yes |
| `popup/pages/settings/security/export/index.vue` | 77 | pages | 1 | yes | no |
| `popup/pages/settings/security/export/key.vue` | 644 | pages | 3 | yes | yes |
| `popup/pages/settings/security/export/seed.vue` | 577 | pages | 3 | yes | yes |
| `popup/pages/settings/security/index.vue` | 241 | pages | 5 | yes | no |
| `popup/pages/settings/security/reset.vue` | 310 | pages | 3 | yes | yes |
| `popup/pages/settings/tokens/index.vue` | 188 | pages | 6 | yes | no |
| `popup/pages/tokens/[id].vue` | 252 | pages | 11 | yes | no |
| `popup/pages/tx/[id].vue` | 892 | pages | 13 | yes | no |
| `popup/windows/capabilities/index.vue` | 976 | windows | 10 | yes | no |
| `popup/windows/discover/index.vue` | 448 | windows | 6 | yes | no |
| `popup/windows/execute/index.vue` | 1084 | windows | 13 | yes | no |
| `popup/windows/json/index.vue` | 83 | windows | 3 | yes | no |
| `popup/windows/logger/index.vue` | 80 | windows | 2 | yes | no |
| `popup/windows/passkey/index.vue` | 156 | windows | 4 | yes | no |
| `popup/windows/verify/index.vue` | 410 | windows | 8 | yes | no |
| `setup/app.vue` | 41 | flat | 2 | no | no |

## Counts by layer

- L1/L2/L3 `components/core/`: 4 SFCs
- L1/L2/L3 `components/ui/`: 23 SFCs
- L1/L2/L3 `components/composite/`: 0 SFCs
- flat `src/components/` (incl. nested non-core/ui/composite): 11 SFCs
- `popup/components/modules/`: 19 SFCs
- `popup/components/popups/`: 32 SFCs
- `popup/windows/`: 7 SFCs
- `popup/pages/`: 37 SFCs

## Lint signals

- Files with `<style module>`: 127
- Files with raw `cta` class refs: 7
- Total raw cta usages: 22
- Total `variant="brutalist"` Input callers: 23
- Native `<input>` outside primitives: 4 sites — `auth.vue:179`, `send.vue:458`, `AmountCard.vue:79`, `capabilities/index.vue:452`
- New<X>Popup files: 7 (Account, Contact, Endpoint, Fpc, Network, Sender, Token)
- Edit<X>Popup files: 7 (Account, Contact, Endpoint, Fpc, Network, Profile, Token)
- Matched New/Edit pairs: 6 (Account, Contact, Endpoint, Fpc, Network, Token)
- Unpaired: NewSenderPopup, EditProfilePopup
- Top offenders by line count: see Phase 7 table in `plan.md`
