import { z } from "zod"
import { BLOCK_EXPLORER_IDS } from "@/wallet/constants/explorers"

/**
 * The wallet config schema is the single source of truth for `Config`, its
 * defaults, and persisted-value validation. Loading validates each stored prop
 * against its real domain (literal unions, not just `typeof`), so a corrupt or
 * migrated value outside the domain is rejected and the default kept — closing
 * the prior "any string loads as a valid `theme`" hole.
 */
export const ConfigSchema = z.object({
	// Appearance
	theme: z.enum(["dark", "light", "system"]).default("system"),
	sidePanel: z.boolean().default(false),
	showNode: z.boolean().default(true),
	showPopupFullscreen: z.boolean().default(true),
	disableAnimations: z.boolean().default(false),

	// Wallet
	sessionTtl: z.number().default(1_800_000), // 30 minutes.
	// AUDIT A1: when ON (default), password profiles do not cache the
	// passhash in `chrome.storage.session`. SW death → re-auth required.
	// Opt OUT in Settings → Security. The default is FROZEN by
	// `config.test.ts` — flipping it to `false` is an explicit security
	// regression that requires audit / security sign-off.
	strictSecurityMode: z.boolean().default(true),

	// Additional — enum derived from the explorer-ids single source (no drift).
	defaultExplorer: z.enum(BLOCK_EXPLORER_IDS).nullable().default("aztecscan"),

	// Activity
	// When OFF, IncomingTransferService records are still persisted but
	// `getIncomingTransfers` returns empty — the activity feed hides all
	// incoming-receive rows. Escape hatch for users running the same seed
	// on multiple devices, where the other device's outgoing transfers
	// arrive as PXE-synced notes here and (correctly per protocol) lack
	// a local outgoing-tx record. Default ON.
	incomingTransfersVisible: z.boolean().default(true),

	// Developer
	developerMode: z.boolean().default(false),
	debugMode: z.boolean().default(false),
	indicateFailures: z.boolean().default(false),
})

export type Config = z.infer<typeof ConfigSchema>

/** A fresh config with all schema defaults applied. Replaces `new Config()`. */
export const defaultConfig = (): Config => ConfigSchema.parse({})

export type ConfigKey = keyof Config

export type ConfigProp = {
	[TKey in ConfigKey]: {
		key: TKey
		value: Config[TKey]
	}
}[ConfigKey]
