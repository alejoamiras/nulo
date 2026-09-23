import type { Config, ConfigKey, ConfigProp } from "@/wallet/config"

export const CONFIG_SERVICE_NAME = "config"

/**
 * Config keys a backup restore may write. Presentation-only by design: security keys
 * (`strictSecurityMode`, `sessionTtl`) and diagnostic toggles are deliberately absent, so an
 * imported backup can never widen the wallet's security posture.
 *
 * Lives in the spec rather than the service because it is DATA two places need: the service
 * enforces it on restore, and the restore-error collector relies on it to know that a config row's
 * `key` is drawn from a fixed set and is therefore safe to name in a log.
 */
export const RESTORABLE_CONFIG_KEYS: ReadonlySet<ConfigKey> = new Set<ConfigKey>([
	"theme",
	"sidePanel",
	"showNode",
	"showPopupFullscreen",
	"disableAnimations",
	"defaultExplorer",
	"incomingTransfersVisible",
	"indicateFailures",
])

export type { Config, ConfigKey, ConfigProp }

export type Methods = {
	getProps(): ConfigProp[]
	getValue<TKey extends ConfigKey>(key: TKey): Config[TKey]
	setValue<TKey extends ConfigKey>(key: TKey, value: Config[TKey]): void
	reset(): void
}

export type Events = {
	onUpdate: ConfigProp
}
