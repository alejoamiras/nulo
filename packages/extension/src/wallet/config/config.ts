import type { BlockExplorerType } from "@/wallet/constants/explorers"

export class Config {
	// Appearance
	theme: "dark" | "light" | "system" = "system"
	sidePanel: boolean = false
	showNode: boolean = true
	showPopupFullscreen: boolean = true
	disableAnimations: boolean = false

	// Wallet
	sessionTtl: number = 1_800_000 // 30 minutes.
	// AUDIT A1: when ON (default), password profiles do not cache the
	// passhash in `chrome.storage.session`. SW death → re-auth required.
	// Opt OUT in Settings → Security. The default is FROZEN by
	// `config.test.ts` — flipping it to `false` is an explicit security
	// regression that requires audit / security sign-off.
	strictSecurityMode: boolean = true

	// Additional
	defaultExplorer: BlockExplorerType | null = "aztecscan"

	// Activity
	/** When OFF, IncomingTransferService records are still persisted but
	 *  `getIncomingTransfers` returns empty — the activity feed hides all
	 *  incoming-receive rows. Escape hatch for users running the same seed
	 *  on multiple devices, where the other device's outgoing transfers
	 *  arrive as PXE-synced notes here and (correctly per protocol) lack
	 *  a local outgoing-tx record. Default ON. */
	incomingTransfersVisible: boolean = true

	// Developer
	developerMode: boolean = false
	debugMode: boolean = false
	indicateFailures: boolean = false
}

export type ConfigKey = keyof Config

export type ConfigProp = {
	[TKey in ConfigKey]: {
		key: TKey
		value: Config[TKey]
	}
}[ConfigKey]
