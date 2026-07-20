import { EventHandler } from "@nulo/wallet-core/utils"
import { describe, expect, test } from "vitest"
import { defaultConfig, type Config, type ConfigKey, type ConfigProp, type IConfigStore } from "@/wallet/config"
import type { ILogger } from "@/wallet/logger"
import { ConfigService } from "./service"

const noopLogger = { log: () => {} } as unknown as ILogger

function makeStore(): { config: Config; store: IConfigStore } {
	const config = defaultConfig()
	const onUpdate = new EventHandler<ConfigProp>()
	const store = {
		get props(): ConfigProp[] {
			return []
		},
		get<TKey extends ConfigKey>(key: TKey): Config[TKey] {
			return config[key]
		},
		async set<TKey extends ConfigKey>(key: TKey, value: Config[TKey]): Promise<void> {
			config[key] = value
		},
		async reset(): Promise<void> {},
		onUpdate,
	} as unknown as IConfigStore
	return { config, store }
}

const prop = (key: string, value: unknown): ConfigProp => ({ key, value }) as unknown as ConfigProp

describe("ConfigService.restore — F-06 backup allowlist", () => {
	test("applies benign presentation prefs; SKIPS security / diagnostic / unknown keys", async () => {
		const { config, store } = makeStore()
		const svc = new ConfigService(store, noopLogger)

		const result = await svc.restore([
			prop("theme", "dark"), // allowlisted → applied
			prop("strictSecurityMode", false), // SECURITY → skipped
			prop("sessionTtl", 0), // SECURITY → skipped
			prop("developerMode", true), // diagnostic → skipped
			prop("debugMode", true), // diagnostic → skipped
			prop("totallyUnknownKey", 42), // unknown → skipped
		])

		// Presentation pref restored.
		expect(config.theme).toBe("dark")
		// Security posture PRESERVED at defaults — a backup can't lower it.
		expect(config.strictSecurityMode).toBe(true)
		expect(config.sessionTtl).toBe(1_800_000)
		expect(config.developerMode).toBe(false)
		expect(config.debugMode).toBe(false)
		// Skipped keys are omitted from the result (non-fatal, not an error).
		expect(result.map((r) => r.key)).toEqual(["theme"])
	})

	test("a backup of only allowlisted prefs restores fully", async () => {
		const { config, store } = makeStore()
		const svc = new ConfigService(store, noopLogger)
		await svc.restore([prop("sidePanel", true), prop("showNode", false), prop("incomingTransfersVisible", false)])
		expect(config.sidePanel).toBe(true)
		expect(config.showNode).toBe(false)
		expect(config.incomingTransfersVisible).toBe(false)
	})
})
