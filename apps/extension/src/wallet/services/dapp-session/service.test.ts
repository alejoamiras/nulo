/**
 * Active-profile guard preservation pins for `DappSessionService` (Q19).
 *
 * This file has three distinct active-profile dispositions in one service, and
 * the requireActiveProfile sweep must preserve each EXACTLY:
 *   - `getDappSessions` throws "Profile locked" (swept → requireActiveProfile()).
 *   - `addDappSession` throws "Wallet is locked" (swept → requireActiveProfile(_, "Wallet is locked")).
 *   - `tryGetDappSessionByOriginAndChain` SILENTLY returns undefined (deliberate
 *     non-thrower; a locked wallet must decline auto-approve, NOT throw — this
 *     site was EXCLUDED from the sweep and must stay silent).
 */
import { EventHandler } from "@nulo/wallet-core/utils"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/service"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { DappSessionService } from "./service"

let activeProfile: { id: string } | undefined

function makeProfileStub() {
	// One deterministic HMAC key per profile so MAC-storage writes/reads verify
	// within a test without a real key hierarchy.
	const keys = new Map<string, Promise<CryptoKey>>()
	return {
		name: PROFILE_SERVICE_NAME,
		dependencies: [],
		onProfileDeleted: new EventHandler(),
		getActiveProfile: vi.fn(async () => activeProfile),
		deriveDappSessionMacKey: vi.fn(async (profileId: string) => {
			let key = keys.get(profileId)
			if (!key) {
				key = crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]) as Promise<CryptoKey>
				keys.set(profileId, key)
			}
			return key
		}),
		async start() {},
	}
}

async function makeService(): Promise<{ service: DappSessionService; profileStub: ReturnType<typeof makeProfileStub> }> {
	const logger = new LoggerStore(new ConfigStore())
	const browserApi = new FakeBrowserApi()
	browserApi.reset()
	const service = new DappSessionService(logger, browserApi)
	const collection = new ServiceCollection()
	const profileStub = makeProfileStub()
	collection.add(profileStub as never)
	collection.add(service)
	await collection.start()
	return { service, profileStub }
}

beforeEach(() => {
	activeProfile = { id: "p1" }
})

describe("DappSessionService active-profile guards (Q19 preservation pins)", () => {
	test('getDappSessions throws "Profile locked" when the wallet is locked', async () => {
		const { service: svc } = await makeService()
		activeProfile = undefined
		await expect(svc.getDappSessions()).rejects.toThrow("Profile locked")
	})

	test('addDappSession throws "Wallet is locked" when the wallet is locked', async () => {
		const { service: svc } = await makeService()
		activeProfile = undefined
		await expect(svc.addDappSession({} as never, [], [], 0 as never, "1")).rejects.toThrow("Wallet is locked")
	})

	test("tryGetDappSessionByOriginAndChain SILENTLY returns undefined when locked (deliberate non-thrower, NOT swept)", async () => {
		const { service: svc } = await makeService()
		activeProfile = undefined
		await expect(svc.tryGetDappSessionByOriginAndChain("https://dapp.example", "1")).resolves.toBeUndefined()
	})
})

describe("tryGetDappSessionByOriginAndChain anchoring", () => {
	test("forProfileId filters to the given profile and bypasses the live-profile read (silently revertible without this pin)", async () => {
		const { service: svc, profileStub } = await makeService()
		await svc.addDappSession({ url: "https://dapp.example" } as never, [], [], 0 as never, "1")

		profileStub.getActiveProfile.mockClear()
		const anchored = await svc.tryGetDappSessionByOriginAndChain("https://dapp.example", "1", "p1")
		expect(anchored?.profileId).toBe("p1")
		// The anchored path must never consult the live profile — that read is
		// exactly the switch-race the anchor exists to close.
		expect(profileStub.getActiveProfile).not.toHaveBeenCalled()

		const foreign = await svc.tryGetDappSessionByOriginAndChain("https://dapp.example", "1", "p2")
		expect(foreign).toBeUndefined()
	})
})
