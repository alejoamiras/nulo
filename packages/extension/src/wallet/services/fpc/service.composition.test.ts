/**
 * Composition test (integration-test rollout): drives the REAL FpcService graph
 * in-process against the shared dumb PXE fake + FakeBrowserApi storage.
 *
 * SCOPE — and a HEADLINE LIMIT (see `packages/extension/tests/COMPOSITION-TESTS.md`):
 * Fpc's INTERESTING orchestration (`getFpcs` auto-discovery, `addFpc`,
 * `updateFpc`, `deleteFpc`) all route through `getOrComputeProtocolAddresses` →
 * `getContractInstanceFromInstantiationParams`, which computes a poseidon /
 * Barretenberg artifact hash. The bb.js WASM is NOT loaded in vitest/jsdom — the
 * repo deliberately keeps bb out of unit tests (contract-resolver.test.ts:190,
 * nulo-account.test.ts:7, note-schemas.test.ts:13). So that path is e2e-only.
 *
 * Fpc is therefore the doc's headline "shallow PXE surface BUT bb-bound
 * orchestration → e2e, not composition" counter-example. What composition CAN
 * prove for Fpc — and all this file claims — is the injected-seam wiring + the
 * bb-FREE profile-scoped read/authz paths. The discovery/add coverage lives in
 * the Network e2e suite.
 */
import { describe, expect, test } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ServiceCollection } from "@/wallet/base"
import { ProfileService } from "@/wallet/services/profile/service"
import { NetworkService } from "@/wallet/services/network/service"
import { makeShallowPxeFake } from "@/wallet/services/pxe/shallow-port.fake"
import { FpcService } from "./service"

function svc(name: string, methods: Record<string, unknown>) {
	return { name, dependencies: [], async start() {}, ...methods } as never
}

async function makeHarness() {
	const fake = makeShallowPxeFake()
	const api = new FakeBrowserApi()
	api.reset()
	const logger = new LoggerStore(new ConfigStore())

	const collection = new ServiceCollection()
	collection.add(svc(ProfileService.name, { getActiveProfile: async () => ({ id: "p1" }), onProfileDeleted: { add: () => {} } }))
	collection.add(svc(NetworkService.name, { registerChainPurgeSubscriber: () => {} }))
	const fpcService = new FpcService(logger, () => fake.client, api)
	collection.add(fpcService)
	await collection.start()
	return { fpcService, fake }
}

describe("FpcService composition — seam + bb-free paths (discovery is e2e; see header)", () => {
	test("constructs against the injected fake seam + serves the bb-free chainless list", async () => {
		const { fpcService, fake } = await makeHarness()
		// chainId undefined → the early-return list path; no protocol derivation, no PXE.
		const all = await fpcService.getFpcs()
		expect(all).toEqual([])
		expect(fake.registerCalls).toHaveLength(0)
	})

	test("getFpc enforces profile-scoped existence (unknown id → 'Invalid id')", async () => {
		const { fpcService } = await makeHarness()
		await expect(fpcService.getFpc("nope")).rejects.toThrow("Invalid id")
	})
})
