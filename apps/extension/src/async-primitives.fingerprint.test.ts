/**
 * Temporary migration evidence for the serial-queue refactor: each case stamps the observable
 * events of one queue site with a microtask spinner's count. The literals were recorded on the
 * hand-written queues; the migrated sites must reproduce them exactly. Removed once logged.
 */
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { afterEach, describe, expect, test, vi } from "vitest"
import type { ConfigProp, IConfig } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger/store"
import { SCAN_EPISODES_KEY, ScanEpisodeStore, scanEpisodeKey } from "@/wallet/services/incoming-transfer/scan-episodes"
import { activateNetworkGuarded } from "@/utils/guarded-network-activation"
import { ensureOffscreenRunning, OFFSCREEN_READY_MESSAGE } from "@/wallet/utils/offscreen"

const CAP = 5_000

/** A self-requeueing microtask counter; `stop()` must run in `finally`. */
function spinner() {
	let ticks = 0
	let stopped = false
	let exhausted = false
	const spin = () => {
		if (stopped) return
		if (++ticks >= CAP) {
			exhausted = true
			return
		}
		queueMicrotask(spin)
	}
	queueMicrotask(spin)
	return {
		now: () => ticks,
		stop: () => {
			stopped = true
		},
		get exhausted() {
			return exhausted
		},
	}
}

/** Runs `scenario` under a spinner and returns its stamps relative to the first one. */
async function fingerprint(scenario: (stamp: (event: string) => void) => Promise<void>): Promise<string[]> {
	const raw: [string, number][] = []
	const spin = spinner()
	try {
		await scenario((event) => raw.push([event, spin.now()]))
	} finally {
		spin.stop()
	}
	if (spin.exhausted) throw new Error(`spinner exhausted its cap of ${CAP} before the scenario finished`)
	const base = raw[0]?.[1] ?? 0
	const out = raw.map(([event, at]) => `${event}@${at - base}`)
	return out
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe("serial-queue site fingerprints (temporary)", () => {
	test("scan episodes: hydrate's repair write, then a write and a removal", async () => {
		const api = new FakeBrowserApi()
		api.reset()
		const MIN = 60_000
		const NOW = 1_000 * MIN
		const KEY = scanEpisodeKey("p1", "n1", "0xc")
		await api.storage.session.set({
			[SCAN_EPISODES_KEY]: {
				episodes: { [KEY]: { failures: 4, failingSince: NOW - 20 * MIN, nextAttemptAt: NOW + 1_000 * MIN } },
				announced: [],
			},
		})
		const log = await fingerprint(async (stamp) => {
			const area = {
				get: (key: string) => api.storage.session.get(key),
				set: async (items: Record<string, unknown>) => {
					stamp("set-start")
					await api.storage.session.set(items)
					stamp("set-done")
				},
				remove: async (key: string) => {
					stamp("remove-start")
					await api.storage.session.remove(key)
					stamp("remove-done")
				},
			}
			const store = new ScanEpisodeStore(area as never, () => stamp("reported"))
			stamp("hydrate")
			await store.hydrate(NOW)
			stamp("hydrated")
			store.record(KEY, "failed", NOW)
			store.deleteWhere(() => true)
			await store.settled()
			stamp("settled")
		})
		expect(log).toEqual(EXPECTED.scan)
	})

	test("logger: two purges, the first one's removal failing", async () => {
		const session = {
			get: vi.fn(async () => ({})),
			set: vi.fn(async () => undefined),
			remove: vi.fn(async () => undefined),
		}
		// biome-ignore lint/suspicious/noExplicitAny: temporary chrome.storage.session double
		const previous = (globalThis as any).chrome
		// biome-ignore lint/suspicious/noExplicitAny: temporary chrome.storage.session double
		;(globalThis as any).chrome = { storage: { session } }
		// biome-ignore lint/suspicious/noExplicitAny: console-sniffer internals the logger prints through
		const c = console as any
		for (const k of ["_debug", "_log", "_warn", "_error"]) c[k] ??= () => {}
		try {
			const config: IConfig = { onUpdate: new EventHandler<ConfigProp>(), get: (() => false) as IConfig["get"] }
			const store = new LoggerStore(config)
			const log = await fingerprint(async (stamp) => {
				session.remove
					.mockImplementationOnce(async () => {
						stamp("remove-1")
						throw new Error("unavailable")
					})
					.mockImplementationOnce(async () => {
						stamp("remove-2")
					})
				stamp("start")
				const first = store.applyRetentionPolicy().then(() => stamp("purge-1-resolved"))
				const second = store.applyRetentionPolicy().then(() => stamp("purge-2-resolved"))
				await Promise.all([first, second])
			})
			expect(log).toEqual(EXPECTED.logger)
		} finally {
			// biome-ignore lint/suspicious/noExplicitAny: restore the shared chrome stub
			;(globalThis as any).chrome = previous
		}
	})

	test("guarded activation: an activation that throws, then one that persists", async () => {
		const store = {
			network: { id: "n1" } as { id: string } | undefined,
			profile: { id: "p1" },
			commitScopeChange: vi.fn(async (commit: () => void) => {
				commit()
				return true
			}),
		}
		const log = await fingerprint(async (stamp) => {
			store.commitScopeChange.mockImplementationOnce(async () => {
				stamp("a-guard-throws")
				throw new Error("guard exploded")
			})
			const persist = async (id: string) => {
				stamp(`persist-${id}`)
			}
			stamp("start")
			const a = activateNetworkGuarded(store, persist, async () => undefined, { id: "n2" }).then(
				() => stamp("a-resolved"),
				() => stamp("a-rejected"),
			)
			const b = activateNetworkGuarded(store, persist, async () => undefined, { id: "n3" }).then((r) => stamp(`b-${r}`))
			await Promise.all([a, b])
		})
		expect(log).toEqual(EXPECTED.guarded)
	})

	test("offscreen: the loading-race close rides the close tail before the retry create", async () => {
		const listeners: Array<(m: unknown, sender?: chrome.runtime.MessageSender) => void> = []
		// biome-ignore lint/suspicious/noExplicitAny: augmenting the shared chrome stub for the offscreen surface
		const ch = ((globalThis as any).chrome ??= {})
		ch.runtime = {
			...ch.runtime,
			id: "nulo-ext-id",
			getURL: (p: string) => `chrome-extension://test/${p}`,
			getContexts: vi.fn(async () => []),
			sendMessage: vi.fn(async () => {}),
			onMessage: {
				addListener: (l: (m: unknown) => void) => {
					listeners.push(l)
				},
				removeListener: (l: (m: unknown) => void) => {
					const i = listeners.indexOf(l)
					if (i >= 0) listeners.splice(i, 1)
				},
			},
		}
		const offscreenDoc = { id: "nulo-ext-id", url: "chrome-extension://test/src/offscreen/index.html" } as chrome.runtime.MessageSender
		const log = await fingerprint(async (stamp) => {
			let creates = 0
			ch.offscreen = {
				createDocument: vi.fn(async () => {
					creates += 1
					stamp(`create-${creates}`)
					if (creates === 1) throw new Error("Offscreen document closed before fully loading.")
					for (const l of [...listeners]) l(OFFSCREEN_READY_MESSAGE, offscreenDoc)
				}),
				closeDocument: vi.fn(async () => {
					stamp("close")
				}),
			}
			stamp("start")
			await ensureOffscreenRunning()
			stamp("ready")
		})
		expect(log).toEqual(EXPECTED.offscreen)
	})
})

const EXPECTED: Record<"scan" | "logger" | "guarded" | "offscreen", string[]> = {
	scan: [
		"hydrate@0",
		"set-start@3",
		"set-done@9",
		"hydrated@13",
		"set-start@14",
		"set-done@20",
		"remove-start@23",
		"remove-done@29",
		"settled@32",
	],
	logger: ["start@0", "remove-1@1", "remove-2@5", "purge-1-resolved@6", "purge-2-resolved@10"],
	guarded: ["start@0", "a-guard-throws@1", "a-rejected@5", "persist-n3@6", "b-activated@10"],
	offscreen: ["start@0", "create-1@2", "close@4", "create-2@8", "ready@13"],
}
