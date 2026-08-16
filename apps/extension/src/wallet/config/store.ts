import { ValueStorage } from "@/wallet/storage"
import { Lock } from "@/wallet/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { type Config, type ConfigKey, type ConfigProp, ConfigSchema, defaultConfig } from "./config"
import type { IConfigStore } from "."

/** ValueStorage key holding the whole serialized `Config` object. Frozen:
 *  renaming detaches every install's settings; the backup-migration registry
 *  pins it. */
export const CONFIG_STORAGE_KEY = "nulo:config"

export class ConfigStore implements IConfigStore {
	public readonly onUpdate = new EventHandler<ConfigProp>()

	private readonly lock = new Lock()
	private readonly storage = new ValueStorage<Config>(CONFIG_STORAGE_KEY, chrome.storage.local)
	private config = defaultConfig()

	public get props(): ConfigProp[] {
		return Object.entries(this.config).map(([key, value]) => ({ key, value }) as ConfigProp)
	}

	public async load() {
		let storedConfig: Config | undefined
		try {
			storedConfig = await this.storage.get()
		} catch (err) {
			// F-13: `ValueStorage.get()` is fail-closed (throws on a malformed /
			// undecodable value and PRESERVES it for a repair path). A corrupt
			// `nulo:config` must NOT poison startup — this `load()` runs inside the
			// runtime's `Promise.all`, so a propagating throw aborts the whole boot.
			// Swallow it and continue on defaults; the bad value stays in storage
			// for diagnosis / a future migration.
			console.error(`ConfigStore.load: undecodable config, booting on defaults — ${err instanceof Error ? err.message : String(err)}`)
			return
		}
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
		// `undefined` is never valid: the per-key schema has a `.default()`, so
		// `safeParse(undefined)` would SUCCEED with the default rather than fail —
		// reject it explicitly.
		if (value === undefined) {
			throw new Error(`Invalid config value for "${String(key)}": value is required`)
		}
		const parsed = ConfigSchema.shape[key].safeParse(value)
		if (!parsed.success) {
			throw new Error(`Invalid config value for "${String(key)}": ${parsed.error.message}`)
		}
		const validated = parsed.data as Config[TKey]
		await this.lock.withLock(async () => {
			if (this.config[key] === validated) {
				return
			}
			this.config[key] = validated
			this.onUpdate.invoke({ key, value: validated } as ConfigProp)
			await this.storage.set(this.config)
		})
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
			// Skip missing AND explicit-undefined props: the per-key schema has a
			// `.default()`, so `safeParse(undefined)` would reset to default rather
			// than keep the current value (the prior typeof check skipped these).
			if (!(key in src) || src[key] === undefined) continue
			const parsed = ConfigSchema.shape[key].safeParse(src[key])
			if (parsed.success && this.config[key] !== parsed.data) {
				;(this.config as Record<string, unknown>)[key] = parsed.data
				this.onUpdate.invoke({ key, value: this.config[key] } as ConfigProp)
			}
		}
		await this.storage.set(this.config)
	}
}
