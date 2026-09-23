import type { Restored, ServiceSpec } from "@/wallet/base"
import { toRestoreError } from "@/utils/restore-error"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import type { IConfigStore } from "@/wallet/config"
import type { ILogger } from "@/wallet/logger"
import { EventHandler } from "@nulo/wallet-core/utils"
import {
	CONFIG_SERVICE_NAME,
	RESTORABLE_CONFIG_KEYS,
	type Config,
	type ConfigKey,
	type ConfigProp,
	type Events,
	type Methods,
} from "./spec"

export * from "./spec"

/**
 * F-06: config keys a full-backup restore may apply — benign presentation
 * prefs ONLY. A backup must never lower the runtime security posture, so the
 * security keys (`strictSecurityMode`, `sessionTtl`), the diagnostic toggles
 * (`developerMode`, `debugMode`), and any unknown/malformed key are SKIPPED on
 * restore; the current/default (strict) value stays. Opting out of strict mode
 * is a deliberate in-app gesture in Settings, never a side effect of import.
 */
export class ConfigService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()("getProps", "getValue", "setValue", "reset")
	public static name = CONFIG_SERVICE_NAME

	public readonly onUpdate = new EventHandler<ConfigProp>()

	private readonly config: IConfigStore

	public constructor(configStore: IConfigStore, logger: ILogger) {
		super(CONFIG_SERVICE_NAME, logger)
		this.config = configStore
		this.config.onUpdate.add(this.onConfigUpdated)
	}

	public async getProps(): Promise<ConfigProp[]> {
		return this.config.props
	}

	public async getValue<TKey extends ConfigKey>(key: TKey): Promise<Config[TKey]> {
		return this.config.get(key)
	}

	public async setValue<TKey extends ConfigKey>(key: TKey, value: Config[TKey]): Promise<void> {
		await this.config.set(key, value)
	}

	public async reset(): Promise<void> {
		await this.config.reset()
	}

	public async backup(): Promise<ConfigProp[]> {
		return await this.getProps()
	}

	public async restore(configProps: ConfigProp[]): Promise<Restored<ConfigProp>[]> {
		const result: Restored<ConfigProp>[] = []

		for (const cp of configProps) {
			// F-06: skip any key not on the presentation-prefs allowlist (security
			// keys, diagnostic toggles, unknown keys) — a backup can never lower
			// the runtime security posture. Skipped keys keep their current value.
			if (!RESTORABLE_CONFIG_KEYS.has(cp.key)) {
				this.logWarn(`Skipping non-restorable config key from backup: "${cp.key}" (F-06)`)
				continue
			}
			try {
				await this.setValue(cp.key, cp.value)
				result.push(cp)
			} catch (err) {
				result.push({
					...cp,
					restoreError: toRestoreError(err),
				})
			}
		}

		return result
	}

	private readonly onConfigUpdated = (prop: ConfigProp) => {
		this.emit("onUpdate", prop)
	}
}
