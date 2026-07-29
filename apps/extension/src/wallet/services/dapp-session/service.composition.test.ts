/**
 * Composition test (integration-test rollout): drives the REAL DappSessionService
 * lifecycle FSM in-process against FakeBrowserApi storage + a Profile stub — NO
 * Aztec sandbox / PXE / bb / browser. DappSession is PXE-free AND bb-free (pure
 * storage + profile scoping), so this is the cleanest composition target — the
 * "second harness shape" (no shared PXE port). See
 * `apps/extension/tests/COMPOSITION-TESTS.md`.
 */
import { describe, expect, test } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ServiceCollection } from "@/wallet/base"
import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
import { svc } from "@/wallet/services/composition-harness"
import { DappSessionService } from "./service"
import { AccessLevel, type GrantedCapabilityRecord } from "./spec"

const _waitFor = async (pred: () => Promise<boolean>, ms = 1000) => {
	const deadline = Date.now() + ms
	while (!(await pred())) {
		if (Date.now() > deadline) throw new Error("waitFor timeout")
		await new Promise((r) => setTimeout(r, 5))
	}
}

async function makeHarness() {
	const api = new FakeBrowserApi()
	api.reset()
	const logger = new LoggerStore(new ConfigStore())
	const onProfileDeleted = new EventHandler<ProfileInfo>()

	// F-12: DappSessionService now signs/verifies rows with a per-profile MAC
	// key from ProfileService. Provide a stable HMAC key so persisted rows
	// verify on read-back.
	const macKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])

	const collection = new ServiceCollection()
	collection.add(
		svc(ProfileService.name, {
			getActiveProfile: async () => ({ id: "p1" }),
			onProfileDeleted,
			deriveDappSessionMacKey: async () => macKey,
		}),
	)
	const service = new DappSessionService(logger, api)
	collection.add(service)
	await collection.start()
	return { service, onProfileDeleted }
}

const ORIGIN = "https://dapp.xyz"

describe("DappSessionService composition — in-process, no sandbox", () => {
	test("(AUDIT A12) sessions are scoped per (origin, chainId) — no cross-network trust bleed", async () => {
		const { service } = await makeHarness()
		const added = await service.addDappSession({ url: ORIGIN }, [], ["0xacc"], AccessLevel.Transactions, "0xChainA")

		// Same origin, DIFFERENT chain → no session (the trust-bleed guard).
		expect(await service.tryGetDappSessionByOriginAndChain(ORIGIN, "0xChainB")).toBeUndefined()
		// Same origin + chain → the session.
		const found = await service.tryGetDappSessionByOriginAndChain(ORIGIN, "0xChainA")
		expect(found?.id).toBe(added.id)
	})

	test("upgradeDappSession swaps old id → new id (old gone, new present)", async () => {
		const { service } = await makeHarness()
		const added = await service.addDappSession({ url: ORIGIN }, [], [], AccessLevel.Transactions, "0xA")

		const upgraded = await service.upgradeDappSession(added.id, "newid", Date.now() + 1_000_000)
		expect(upgraded.id).toBe("newid")
		expect((await service.getDappSession("newid")).id).toBe("newid")
		await expect(service.getDappSession(added.id)).rejects.toThrow("Invalid id")
	})

	test("reading an expired session evicts it (read-triggered FSM)", async () => {
		const { service } = await makeHarness()
		const added = await service.addDappSession({ url: ORIGIN }, [], [], AccessLevel.Transactions, "0xA")
		// Re-stamp a past expiry via upgrade, then read → throws + evicts.
		await service.upgradeDappSession(added.id, "expired", Date.now() - 1_000)

		await expect(service.getDappSession("expired")).rejects.toThrow("Session expired")
		expect(await service.tryGetDappSession("expired")).toBeUndefined() // evicted on read
	})

	test("setCapabilityGrants persists + round-trips through real storage", async () => {
		const { service } = await makeHarness()
		const added = await service.addDappSession({ url: ORIGIN }, [], [], AccessLevel.Transactions, "0xA")
		const grants = [{ capability: { type: "data" }, scopes: [] }] as unknown as GrantedCapabilityRecord[]

		await service.setCapabilityGrants(added.id, grants)
		expect(await service.getCapabilityGrants(added.id)).toEqual(grants)
	})

	test("onProfileDeleted cascades — all of the deleted profile's sessions are removed", async () => {
		const { service, onProfileDeleted } = await makeHarness()
		await service.addDappSession({ url: "https://a.xyz" }, [], [], AccessLevel.Transactions, "0xA")
		await service.addDappSession({ url: "https://b.xyz" }, [], [], AccessLevel.Transactions, "0xA")
		expect(await service.getDappSessions()).toHaveLength(2)

		// Profile-delete cleanup is now the coordinator's AWAITED call (finding D).
		void onProfileDeleted
		await service.purgeForProfile("p1")
		expect(await service.getDappSessions()).toHaveLength(0)
	})
})
