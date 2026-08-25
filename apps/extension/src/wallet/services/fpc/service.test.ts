/**
 * FpcService.restore tests — the deletion fence (N-14) plus a validation
 * sanity check. Real lifecycle over `svc()` stubs + `FakeBrowserApi`
 * (composition-harness convention; this was the one slice-restore writer with
 * no colocated test file).
 */
import { describe, expect, test } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/spec"
import { NETWORK_SERVICE_NAME } from "@/wallet/services/network/spec"
import { svc } from "../composition-harness"
import { FpcService, FpcType, type FpcInfo } from "./service"

async function makeHarness() {
	const api = new FakeBrowserApi()
	api.reset()
	const deletionState = new ProfileDeletionState()
	const services = new ServiceCollection()
	services.add(svc(PROFILE_SERVICE_NAME, { getDeletionState: () => deletionState }))
	services.add(svc(NETWORK_SERVICE_NAME, { registerChainPurgeSubscriber: () => {} }))
	const service = new FpcService(new LoggerStore(new ConfigStore()), api)
	services.add(service)
	await services.start()
	return { api, deletionState, service }
}

const mk = (id: string, address: string): FpcInfo => ({
	id,
	profileId: "p1",
	chainId: 1,
	type: FpcType.DefaultSponsoredFpc,
	address,
	name: "F",
	isProtocol: false,
})

describe("FpcService.restore — deletion fence (N-14)", () => {
	test("a deleteProfile beginning DURING the restore rejects every later row write", async () => {
		const h = await makeHarness()
		const origSet = h.api.storage.local.set.bind(h.api.storage.local)
		let fired = false
		h.api.storage.local.set = async (items: Record<string, unknown>) => {
			await origSet(items)
			if (!fired) {
				fired = true
				h.deletionState.beginDeletion("p1")
			}
		}
		const restored = await h.service.restore([mk("f1", "0xa"), mk("f2", "0xb")])
		expect(restored[0].restoreError).toBeUndefined()
		expect(restored[1].restoreError).toMatch(/deleted/)
		const raw = await h.api.storage.local.get(null)
		expect(Object.values(raw).filter((v) => typeof v === "string" && v.includes("0xb"))).toHaveLength(0)
	})

	test("positive control: no deletion → both rows land", async () => {
		const h = await makeHarness()
		const restored = await h.service.restore([mk("f1", "0xa"), mk("f2", "0xb")])
		expect(restored.every((r) => r.restoreError === undefined)).toBe(true)
	})

	test("rejects a deprecated Token-FPC row as restoreError, never written", async () => {
		const h = await makeHarness()
		const [res] = await h.service.restore([{ ...mk("f1", "0xa"), type: 0 as FpcType }])
		expect(res.restoreError).toMatch(/deprecated/)
	})
})
