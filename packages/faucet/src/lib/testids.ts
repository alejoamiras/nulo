/**
 * Central catalog of every data-testid the faucet emits. Components
 * import from here so a rename touches one file. E2E selectors use
 * these constants verbatim — no text/role/aria/class lookups per
 * CLAUDE.md.
 *
 * The `fa-` prefix mirrors the playground's `pg-` convention.
 */

export const TESTIDS = {
	app: "fa-app",

	// Wallet connection — drives WalletPanel + Hero status
	status: "fa-status",
	btnConnect: "fa-btn-connect",
	btnDisconnect: "fa-btn-disconnect",
	btnInstallNulo: "fa-btn-install-nulo",
	account: "fa-account",

	// Verification modal — 3×3 emoji grid + match/cancel
	verificationModal: "fa-verification-modal",
	emojiGrid: "fa-emoji-grid",
	emojiCell: (i: number) => `fa-emoji-cell-${i}`,
	btnVerifyConfirm: "fa-btn-verify-confirm",
	btnVerifyCancel: "fa-btn-verify-cancel",

	// Capability approval — second wallet interaction after verify
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

	// One-click "Add to wallet" — calls registerToken on the connected wallet
	btnAddToWallet: "fa-btn-add-to-wallet",
	addTokenStatus: "fa-add-token-status",

	// Toast
	toast: "fa-toast",

	// Shell tabs (Faucet | Bridge)
	tabs: "fa-tabs",
	tabFaucet: "fa-tab-faucet",
	tabBridge: "fa-tab-bridge",
	bridgeView: "fa-bridge-view",

	// Bridge — L1 (Ethereum) wallet
	l1Status: "fa-l1-status",
	l1Connect: "fa-l1-connect",
	l1Account: "fa-l1-account",
	l1Disconnect: "fa-l1-disconnect",
	l1SwitchChain: "fa-l1-switch-chain",

	// Bridge — L2 (Aztec) wallet
	bridgeL2Status: "fa-bridge-l2-status",
	bridgeL2Connect: "fa-bridge-l2-connect",
	bridgeL2Account: "fa-bridge-l2-account",
	bridgeL2Disconnect: "fa-bridge-l2-disconnect",

	// Bridge — the unified swap-style form (cards carry data-chain; the L2 balance carries data-privacy)
	bridgeForm: "fa-bridge-form",
	bridgeFrom: "fa-bridge-from",
	bridgeTo: "fa-bridge-to",
	bridgeFlip: "fa-bridge-flip",
	bridgeAmount: "fa-bridge-amount",
	bridgeBalanceL1: "fa-bridge-balance-l1",
	bridgeBalanceL2: "fa-bridge-balance-l2",
	bridgePrivacyToggle: "fa-bridge-privacy-toggle",
	bridgePrivacyNote: "fa-bridge-privacy-note",
	bridgeSealNote: "fa-bridge-seal-note",
	bridgeSubmit: "fa-bridge-submit",
	bridgeFormError: "fa-bridge-form-error",

	// Bridge — the explicit L1 test-USDC mint (NOT the Faucet tab's L2 drips)
	mintL1: "fa-mint-l1",
	mintL1Status: "fa-mint-l1-status",

	// Bridge — the in-flight journal (cards carry data-id/direction/stage/privacy/attention)
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

	// Bridge — add the bridged token to the wallet (registerToken, the bridge's own USDC)
	bridgeAddToken: "fa-bridge-add-token",
} as const

export type Testid = (typeof TESTIDS)[keyof typeof TESTIDS]
