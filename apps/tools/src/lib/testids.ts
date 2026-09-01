/**
 * Central catalog of every data-testid the faucet emits. Components
 * import from here so a rename touches one file. E2E selectors use
 * these constants verbatim - no text/role/aria/class lookups per
 * CLAUDE.md.
 *
 * The `tl-` prefix mirrors the playground's `pg-` convention.
 */

export const TESTIDS = {
	app: "tl-app",

	// Wallet connection - drives WalletPanel + Hero status
	status: "tl-status",
	btnConnect: "tl-btn-connect",
	btnDisconnect: "tl-btn-disconnect",
	btnInstallNulo: "tl-btn-install-nulo",
	account: "tl-account",

	// Wallet picker modal - progressive discovery list, user picks explicitly
	walletPicker: "tl-wallet-picker",
	walletPickerRow: "tl-wallet-picker-row",
	walletPickerConnect: "tl-wallet-picker-connect",
	walletPickerCancel: "tl-wallet-picker-cancel",
	walletPickerScanning: "tl-wallet-picker-scanning",
	walletPickerWaiting: "tl-wallet-picker-waiting",
	errorStrip: "tl-error-strip",
	errorStripDismiss: "tl-error-strip-dismiss",
	walletPickerWarning: "tl-wallet-picker-warning",
	btnSwitchWallet: "tl-btn-switch-wallet",
	bridgeL2SwitchWallet: "tl-bridge-l2-switch-wallet",

	// Choose-main-account modal - shown when >1 account is granted and none is remembered
	accountChoice: "tl-account-choice",
	accountChoiceRow: "tl-account-choice-row",
	accountChoiceContinue: "tl-account-choice-continue",
	accountChoiceTruncation: "tl-account-choice-truncation",

	// Account switcher - connected chip + dropdown menu (both wallet panels)
	accountChip: "tl-account-chip",
	accountMenu: "tl-account-menu",
	accountMenuRow: "tl-account-menu-row",
	accountMenuCopy: "tl-account-menu-copy",

	// Journal-card account attribution (deposit cards only — withdraws never persist their Aztec sender)
	journalAccount: "tl-journal-account",
	journalSwitchAccount: "tl-journal-switch-account",
	// (menu Disconnect keeps the pre-switcher panel ids: fa-btn-disconnect / fa-bridge-l2-disconnect)
	accountMenuTruncation: "tl-account-menu-truncation",

	// Verification modal - 3×3 emoji grid + match/cancel
	verificationModal: "tl-verification-modal",
	emojiGrid: "tl-emoji-grid",
	emojiCell: (i: number) => `tl-emoji-cell-${i}`,
	btnVerifyConfirm: "tl-btn-verify-confirm",
	btnVerifyCancel: "tl-btn-verify-cancel",

	// Capability approval - second wallet interaction after verify
	capabilityApproval: "tl-capability-approval",
	btnCapabilityRetry: "tl-btn-capability-retry",
	settingUp: "tl-setting-up",

	// Token cards
	tokenCard: "tl-token-card",
	balancePublic: "tl-balance-public",
	balancePrivate: "tl-balance-private",
	btnDripPublic: "tl-btn-drip-public",
	btnDripPrivate: "tl-btn-drip-private",
	dripStatus: "tl-drip-status",

	// One-click "Add to wallet" - calls registerToken on the connected wallet
	btnAddToWallet: "tl-btn-add-to-wallet",
	addTokenStatus: "tl-add-token-status",

	// Toast
	toast: "tl-toast",

	// Shell tabs (Faucet | Bridge)
	tabs: "tl-tabs",
	tabFaucet: "tl-tab-faucet",
	tabBridge: "tl-tab-bridge",
	tabFuel: "tl-tab-fuel",
	themeToggle: "tl-theme-toggle",
	bridgeView: "tl-bridge-view",

	// Fuel - direct L1 fee-asset → L2 Fee Juice (the third tab)
	fuelView: "tl-fuel-view",
	fuelForm: "tl-fuel-form",
	fuelAmount: "tl-fuel-amount",
	fuelBalanceL1: "tl-fuel-balance-l1",
	fuelPresetPrivate: "tl-fuel-preset-private",
	fuelPresetPublic: "tl-fuel-preset-public",
	fuelSubmit: "tl-fuel-submit",
	feeJuiceNotice: "tl-fee-juice-notice",
	fuelFormError: "tl-fuel-form-error",
	fuelFlowError: "tl-fuel-flow-error",
	fuelMintCard: "tl-fuel-mint-card",
	fuelMintBtn: "tl-fuel-mint-btn",
	fuelMintStatus: "tl-fuel-mint-status",

	// Bridge - L1 (Ethereum) wallet
	l1Status: "tl-l1-status",
	l1Connect: "tl-l1-connect",
	l1Account: "tl-l1-account",
	l1Disconnect: "tl-l1-disconnect",
	l1SwitchChain: "tl-l1-switch-chain",

	// Bridge - L2 (Aztec) wallet
	bridgeL2Status: "tl-bridge-l2-status",
	bridgeL2Connect: "tl-bridge-l2-connect",
	bridgeL2Account: "tl-bridge-l2-account",
	bridgeL2Disconnect: "tl-bridge-l2-disconnect",

	// Bridge - the unified swap-style form (cards carry data-chain; the L2 balance carries data-privacy)
	bridgeForm: "tl-bridge-form",
	bridgeFrom: "tl-bridge-from",
	bridgeTo: "tl-bridge-to",
	bridgeFlip: "tl-bridge-flip",
	bridgeAmount: "tl-bridge-amount",
	bridgeBalanceL1: "tl-bridge-balance-l1",
	// The Aztec panel stacks BOTH balances (public + private) with the toggle highlighting the
	// active one - visibility never depends on the toggle.
	bridgeBalanceL2Public: "tl-bridge-balance-l2-public",
	bridgeBalanceL2Private: "tl-bridge-balance-l2-private",
	bridgePrivacyToggle: "tl-bridge-privacy-toggle",
	// "How it arrives" preset cards (private default) — they replace the single privacy toggle.
	bridgePresetPrivate: "tl-bridge-preset-private",
	bridgePresetPublic: "tl-bridge-preset-public",
	// ONE adaptive private note (data-first carries the signature-count variant).
	bridgePrivacyNote: "tl-bridge-privacy-note",
	bridgeSubmit: "tl-bridge-submit",
	// Amount validation renders under the input; flow failures render near the button.
	bridgeFormError: "tl-bridge-form-error",
	bridgeFlowError: "tl-bridge-flow-error",

	// Bridge - the takeover stepper + receipt (phases carry data-phase/data-state)
	stepper: "tl-bridge-stepper",
	stepperPhase: "tl-stepper-phase",
	// The journal cards' compact phase rail (same mapper, distinct ids - surfaces must not collide).
	journalRail: "tl-journal-rail",
	journalPhase: "tl-journal-phase",
	// Per-bridge sealed recovery files: export icons + the journal-header restore flow.
	cardBackup: "tl-card-backup",
	bridgeAddTokenEvm: "tl-bridge-add-token-evm",
	bridgeFuelToggle: "tl-bridge-fuel-toggle",
	bridgeFuelSlice: "tl-bridge-fuel-slice",
	bridgeFuelQuote: "tl-bridge-fuel-quote",
	bridgeFuelError: "tl-bridge-fuel-error",
	bridgeFuelPrivateNote: "tl-bridge-fuel-private-note",
	journalClaimWithoutFuel: "tl-journal-claim-without-fuel",
	receiptFuel: "tl-receipt-fuel",
	journalClaimGas: "tl-journal-claim-gas",
	// Private bridge whose gas state can't be confirmed (incomplete private-claim metadata)
	journalPrivateFuelUnknown: "tl-journal-private-fuel-unknown",
	stepperBackup: "tl-stepper-backup",
	journalRestore: "tl-journal-restore",
	journalRestoreLink: "tl-journal-restore-link",
	journalRestoreInput: "tl-journal-restore-input",
	stepperBackground: "tl-stepper-background",
	stepperRetry: "tl-stepper-retry",
	receipt: "tl-bridge-receipt",
	receiptNewBridge: "tl-receipt-new-bridge",
	receiptLink: "tl-receipt-link",

	// Bridge - the explicit L1 test-USDC mint (NOT the Faucet tab's L2 drips)
	mintL1: "tl-mint-l1",
	mintL1Status: "tl-mint-l1-status",

	// Bridge - the in-flight journal (cards carry data-id/direction/stage/privacy/attention)
	journal: "tl-bridge-journal",
	journalEmpty: "tl-journal-empty",
	journalCard: "tl-journal-card",
	journalStage: "tl-journal-stage",
	journalClaim: "tl-journal-claim",
	journalFinish: "tl-journal-finish",
	journalDiscard: "tl-journal-discard",
	journalDiscardConfirm: "tl-journal-discard-confirm",
	journalClear: "tl-journal-clear",
	journalAttention: "tl-journal-attention",
	journalStep: "tl-journal-step",
	journalTxLink: "tl-journal-tx-link",

	// Bridge - add the bridged token to the wallet (registerToken, the bridge's own USDC)
	bridgeAddToken: "tl-bridge-add-token",
} as const

export type Testid = (typeof TESTIDS)[keyof typeof TESTIDS]
