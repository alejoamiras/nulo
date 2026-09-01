/**
 * Pre-extraction pin for the restore validation the plan-2 decomposition
 * moves (codex audit condition): a stored `(profileId, chainId)` collision
 * becomes THAT entry's `restoreError` and later entries continue unharmed.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { BrowserApi } from "@/utils/browser-api"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import type { ProfileService } from "@/wallet/services/profile/service"
import type { Network } from "./spec"
import { NetworkService } from "./service"

class FakeStorageArea {
	public store = new Map<string, unknown>()
	public async get(keys?: string | string[]): Promise<Record<string, unknown>> {
		if (keys === undefined) return Object.fromEntries(this.store)
		const keyList = Array.isArray(keys) ? keys : [keys]
		const out: Record<string, unknown> = {}
		for (const k of keyList) {
			if (this.store.has(k)) out[k] = this.store.get(k)
		}
		return out
	}
	public async set(items: Record<string, unknown>): Promise<void> {
		for (const [k, v] of Object.entries(items)) this.store.set(k, v)
	}
	public async remove(keys: string | string[]): Promise<void> {
		const keyList = Array.isArray(keys) ? keys : [keys]
		for (const k of keyList) this.store.delete(k)
	}
}

const mkNet = (id: string, chainId: number): Network =>
	({
		id,
		profileId: "p1",
		chainId,
		l1ChainId: chainId,
		name: `N${chainId}`,
		primaryEndpointId: "e1",
		endpoints: [{ id: "e1", rpcUrl: `https://rpc.test/${chainId}` }],
	}) as Network

describe("restore collision pin", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", {
			runtime: {
				onMessage: { addListener: () => {}, removeListener: () => {} },
				onConnect: { addListener: () => {}, removeListener: () => {} },
				sendMessage: () => Promise.resolve(),
			},
			storage: {},
		})
	})

	test("a (profileId, chainId) collision errors THAT entry and later entries still restore", async () => {
		const local = new FakeStorageArea()
		const session = new FakeStorageArea()
		const browserApi = { storage: { local, session } } as unknown as BrowserApi
		const service = new NetworkService(new LoggerStore(new ConfigStore()), browserApi, {
			create: () => {
				throw new Error("no node dials in this pin")
			},
		} as never)
		const deletionState = new ProfileDeletionState()
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in (mirrors service.test.ts)
		;(service as any).profileService = {
			getActiveProfile: async () => ({ id: "p1", name: "p1", type: "password" }),
			onActiveProfileChanged: { add: vi.fn(), remove: vi.fn() },
			onProfileDeleted: { add: vi.fn(), remove: vi.fn() },
			getDeletionState: () => deletionState,
		} as unknown as ProfileService
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		;(service as any).initialized = true

		// Seed chain 7 via a first restore, then attempt a colliding chain-7 + a clean chain-8.
		const seeded = await service.restore([mkNet("n1", 7)])
		expect(seeded[0]!.restoreError).toBeUndefined()

		const result = await service.restore([mkNet("n2", 7), mkNet("n3", 8)])
		expect(result).toHaveLength(2)
		expect(result[0]!.restoreError).toContain("A network for chain 7 already exists in profile p1")
		expect(result[1]!.restoreError).toBeUndefined()
		await expect(service.getNetwork("n3")).resolves.toMatchObject({ chainId: 8 })
	})
})
