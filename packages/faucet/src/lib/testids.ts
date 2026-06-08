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

	// Bridge — deposit
	depositAmount: "fa-deposit-amount",
	depositSubmit: "fa-deposit-submit",
	depositStage: "fa-deposit-stage",
	depositSuccess: "fa-deposit-success",
	depositError: "fa-deposit-error",
	depositPending: "fa-deposit-pending",

	// Bridge — withdraw
	withdrawAmount: "fa-withdraw-amount",
	withdrawSubmit: "fa-withdraw-submit",
	withdrawStage: "fa-withdraw-stage",
	withdrawSuccess: "fa-withdraw-success",
	withdrawError: "fa-withdraw-error",
	withdrawPending: "fa-withdraw-pending",

	// Bridge — add the bridged token to the wallet (registerToken, the bridge's own USDC)
	bridgeAddToken: "fa-bridge-add-token",
} as const

export type Testid = (typeof TESTIDS)[keyof typeof TESTIDS]
