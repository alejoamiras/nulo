import { ValueStorage } from "@/wallet/storage"
import { Lock } from "@/wallet/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { type Config, type ConfigKey, type ConfigProp, ConfigSchema, defaultConfig } from "./config"
import type { IConfigStore } from "."

export class ConfigStore implements IConfigStore {
	public readonly onUpdate = new EventHandler<ConfigProp>()

	private readonly lock = new Lock()
	private readonly storage = new ValueStorage<Config>("nulo:config", chrome.storage.local)
	private config = defaultConfig()

	public get props(): ConfigProp[] {
		return Object.entries(this.config).map(([key, value]) => ({ key, value }) as ConfigProp)
	}

	public async load() {
		const storedConfig = await this.storage.get()
		if (storedConfig && typeof storedConfig === "object") {
			await this.apply(storedConfig)
		}
	}

	public get<TKey extends ConfigKey>(key: TKey): Config[TKey] {
		return this.config[key]
	}

	public async set<TKey extends ConfigKey>(key: TKey, value: Config[TKey]) {
		// Fail fast on an out-of-domain value BEFORE mutating memory/storage —
		// the RPC config spec is type-only, so a runtime caller could pass one.
		const parsed = ConfigSchema.shape[key].safeParse(value)
		if (!parsed.success) {
			throw new Error(`Invalid config value for "${String(key)}": ${parsed.error.message}`)
		}
		const validated = parsed.data as Config[TKey]
		try {
			await this.lock.enter()
			if (this.config[key] === validated) {
				return
			}
			this.config[key] = validated
			this.onUpdate.invoke({ key, value: validated } as ConfigProp)
			await this.storage.set(this.config)
		} finally {
			this.lock.leave()
		}
	}

	public async reset() {
		await this.apply(defaultConfig())
	}

	/**
	 * Merge an incoming/stored config in, validating each prop against the
	 * schema and KEEPING the current value for any prop that is missing or
	 * fails its domain — a corrupt/migrated value no longer loads just because
	 * its primitive `typeof` matched. Emits `onUpdate` only for props that
	 * validate AND change.
	 */
	private async apply(incoming: unknown) {
		const src = (incoming ?? {}) as Record<string, unknown>
		for (const key of Object.keys(this.config) as ConfigKey[]) {
			if (!(key in src)) continue
			const parsed = ConfigSchema.shape[key].safeParse(src[key])
			if (parsed.success && this.config[key] !== parsed.data) {
				;(this.config as Record<string, unknown>)[key] = parsed.data
				this.onUpdate.invoke({ key, value: this.config[key] } as ConfigProp)
			}
		}
		await this.storage.set(this.config)
	}
}
