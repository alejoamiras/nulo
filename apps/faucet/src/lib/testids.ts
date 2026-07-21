/**
 * Central catalog of every data-testid the faucet emits. Components
 * import from here so a rename touches one file. E2E selectors use
 * these constants verbatim - no text/role/aria/class lookups per
 * CLAUDE.md.
 *
 * The `fa-` prefix mirrors the playground's `pg-` convention.
 */

export const TESTIDS = {
	app: "fa-app",

	// Wallet connection - drives WalletPanel + Hero status
	status: "fa-status",
	btnConnect: "fa-btn-connect",
	btnDisconnect: "fa-btn-disconnect",
	btnInstallNulo: "fa-btn-install-nulo",
	account: "fa-account",

	// Wallet picker modal - progressive discovery list, user picks explicitly
	walletPicker: "fa-wallet-picker",
	walletPickerRow: "fa-wallet-picker-row",
	walletPickerConnect: "fa-wallet-picker-connect",
	walletPickerCancel: "fa-wallet-picker-cancel",
	walletPickerScanning: "fa-wallet-picker-scanning",
	walletPickerWarning: "fa-wallet-picker-warning",
	btnSwitchWallet: "fa-btn-switch-wallet",
	bridgeL2SwitchWallet: "fa-bridge-l2-switch-wallet",
	preferredWalletHint: "fa-preferred-wallet-hint",

	// Verification modal - 3×3 emoji grid + match/cancel
	verificationModal: "fa-verification-modal",
	emojiGrid: "fa-emoji-grid",
	emojiCell: (i: number) => `fa-emoji-cell-${i}`,
	btnVerifyConfirm: "fa-btn-verify-confirm",
	btnVerifyCancel: "fa-btn-verify-cancel",

	// Capability approval - second wallet interaction after verify
	capabilityApproval: "fa-capability-approval",
	btnCapabilityRetry: "fa-btn-capability-retry",
	settingUp: "fa-setting-up",

	// Token cards
	tokenCard: "fa-token-card",
	balancePublic: "fa-balance-public",
	balancePrivate: "fa-balance-private",
	btnDripPublic: "fa-btn-drip-public",
	btnDripPrivate: "fa-btn-drip-private",
	dripStatus: "fa-drip-status",

	// One-click "Add to wallet" - calls registerToken on the connected wallet
	btnAddToWallet: "fa-btn-add-to-wallet",
	addTokenStatus: "fa-add-token-status",

	// Toast
	toast: "fa-toast",

	// Shell tabs (Faucet | Bridge)
	tabs: "fa-tabs",
	tabFaucet: "fa-tab-faucet",
	tabBridge: "fa-tab-bridge",
	tabFuel: "fa-tab-fuel",
	themeToggle: "fa-theme-toggle",
	bridgeView: "fa-bridge-view",

	// Fuel - direct L1 fee-asset → L2 Fee Juice (the third tab)
	fuelView: "fa-fuel-view",
	fuelForm: "fa-fuel-form",
	fuelAmount: "fa-fuel-amount",
	fuelBalanceL1: "fa-fuel-balance-l1",
	fuelPresetPrivate: "fa-fuel-preset-private",
	fuelPresetPublic: "fa-fuel-preset-public",
	fuelSubmit: "fa-fuel-submit",
	feeJuiceNotice: "fa-fee-juice-notice",
	fuelFormError: "fa-fuel-form-error",
	fuelFlowError: "fa-fuel-flow-error",
	fuelMintCard: "fa-fuel-mint-card",
	fuelMintBtn: "fa-fuel-mint-btn",
	fuelMintStatus: "fa-fuel-mint-status",

	// Bridge - L1 (Ethereum) wallet
	l1Status: "fa-l1-status",
	l1Connect: "fa-l1-connect",
	l1Account: "fa-l1-account",
	l1Disconnect: "fa-l1-disconnect",
	l1SwitchChain: "fa-l1-switch-chain",

	// Bridge - L2 (Aztec) wallet
	bridgeL2Status: "fa-bridge-l2-status",
	bridgeL2Connect: "fa-bridge-l2-connect",
	bridgeL2Account: "fa-bridge-l2-account",
	bridgeL2Disconnect: "fa-bridge-l2-disconnect",

	// Bridge - the unified swap-style form (cards carry data-chain; the L2 balance carries data-privacy)
	bridgeForm: "fa-bridge-form",
	bridgeFrom: "fa-bridge-from",
	bridgeTo: "fa-bridge-to",
	bridgeFlip: "fa-bridge-flip",
	bridgeAmount: "fa-bridge-amount",
	bridgeBalanceL1: "fa-bridge-balance-l1",
	// The Aztec panel stacks BOTH balances (public + private) with the toggle highlighting the
	// active one - visibility never depends on the toggle.
	bridgeBalanceL2Public: "fa-bridge-balance-l2-public",
	bridgeBalanceL2Private: "fa-bridge-balance-l2-private",
	bridgePrivacyToggle: "fa-bridge-privacy-toggle",
	// "How it arrives" preset cards (private default) — they replace the single privacy toggle.
	bridgePresetPrivate: "fa-bridge-preset-private",
	bridgePresetPublic: "fa-bridge-preset-public",
	// ONE adaptive private note (data-first carries the signature-count variant).
	bridgePrivacyNote: "fa-bridge-privacy-note",
	bridgeSubmit: "fa-bridge-submit",
	// Amount validation renders under the input; flow failures render near the button.
	bridgeFormError: "fa-bridge-form-error",
	bridgeFlowError: "fa-bridge-flow-error",

	// Bridge - the takeover stepper + receipt (phases carry data-phase/data-state)
	stepper: "fa-bridge-stepper",
	stepperPhase: "fa-stepper-phase",
	// The journal cards' compact phase rail (same mapper, distinct ids - surfaces must not collide).
	journalRail: "fa-journal-rail",
	journalPhase: "fa-journal-phase",
	// Per-bridge sealed recovery files: export icons + the journal-header restore flow.
	cardBackup: "fa-card-backup",
	bridgeAddTokenEvm: "fa-bridge-add-token-evm",
	bridgeFuelToggle: "fa-bridge-fuel-toggle",
	bridgeFuelSlice: "fa-bridge-fuel-slice",
	bridgeFuelQuote: "fa-bridge-fuel-quote",
	bridgeFuelError: "fa-bridge-fuel-error",
	bridgeFuelPrivateNote: "fa-bridge-fuel-private-note",
	journalClaimWithoutFuel: "fa-journal-claim-without-fuel",
	receiptFuel: "fa-receipt-fuel",
	journalClaimGas: "fa-journal-claim-gas",
	stepperBackup: "fa-stepper-backup",
	journalRestore: "fa-journal-restore",
	journalRestoreLink: "fa-journal-restore-link",
	journalRestoreInput: "fa-journal-restore-input",
	stepperBackground: "fa-stepper-background",
	stepperRetry: "fa-stepper-retry",
	receipt: "fa-bridge-receipt",
	receiptNewBridge: "fa-receipt-new-bridge",
	receiptLink: "fa-receipt-link",

	// Bridge - the explicit L1 test-USDC mint (NOT the Faucet tab's L2 drips)
	mintL1: "fa-mint-l1",
	mintL1Status: "fa-mint-l1-status",

	// Bridge - the in-flight journal (cards carry data-id/direction/stage/privacy/attention)
	journal: "fa-bridge-journal",
	journalEmpty: "fa-journal-empty",
	journalCard: "fa-journal-card",
	journalStage: "fa-journal-stage",
	journalClaim: "fa-journal-claim",
	journalFinish: "fa-journal-finish",
	journalDiscard: "fa-journal-discard",
	journalDiscardConfirm: "fa-journal-discard-confirm",
	journalClear: "fa-journal-clear",
	journalAttention: "fa-journal-attention",
	journalStep: "fa-journal-step",
	journalTxLink: "fa-journal-tx-link",

	// Bridge - add the bridged token to the wallet (registerToken, the bridge's own USDC)
	bridgeAddToken: "fa-bridge-add-token",
} as const

export type Testid = (typeof TESTIDS)[keyof typeof TESTIDS]
