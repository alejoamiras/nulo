/**
 * Composition test (integration-test rollout): drives the REAL TokenService
 * graph in-process via `ServiceCollection.start()` against the shared dumb PXE
 * fake + FakeBrowserApi storage — NO Aztec sandbox / offscreen worker / proving
 * / browser. Proves the SHALLOW token-interface path: resolve the contract +
 * dedup-register + extract function candidates from a REAL artifact.
 *
 * SCOPE (narrow, on purpose): targets `parseTokenInterface` — the shallow
 * register + name-based candidate-extraction path. It does NOT touch
 * `fetchTokenMetadata`/`addToken`, which call `simulate(...)` (deep — e2e).
 * Candidate extraction is bb-FREE (it filters the artifact's functions by name/
 * params); the contract instance is a HARDCODED fake (deriving one needs the
 * Barretenberg WASM, which vitest/jsdom doesn't load). See
 * `apps/extension/tests/COMPOSITION-TESTS.md`.
 */
import { describe, expect, test, vi } from "vitest"
import type { Fr } from "@aztec/foundation/curves/bn254"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ServiceCollection } from "@/wallet/base"
import { ProfileService } from "@/wallet/services/profile/service"
import { NetworkService } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { TaskService } from "@/wallet/services/task/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import { makeShallowPxeFake, type ShallowPxeFakeConfig } from "@/wallet/services/pxe/shallow-port.fake"
import { svc } from "@/wallet/services/composition-harness"
import { TokenService } from "./service"

const NETWORK = { id: "net1", chainId: 1, primaryEndpointId: "ep1", endpoints: [{ id: "ep1", rpcUrl: "http://fake" }] }
const CONTRACT = AztecAddress.fromNumberUnsafe(0x1234).toString()
const CLASS_ID = "0xc1a55"

/** Hardcoded fake instance — deriving a real one needs the bb WASM (not loaded in vitest). */
function fakeTokenInstance(): ContractInstanceWithAddress {
	return {
		address: AztecAddress.fromStringUnsafe(CONTRACT),
		currentContractClassId: { toString: () => CLASS_ID } as unknown as Fr,
	} as unknown as ContractInstanceWithAddress
}

async function makeHarness(fakeConfig?: ShallowPxeFakeConfig) {
	const fake = makeShallowPxeFake(
		fakeConfig ?? {
			instances: new Map([[AztecAddress.fromStringUnsafe(CONTRACT).toString(), fakeTokenInstance()]]),
			artifacts: new Map([[CLASS_ID, TokenContractArtifact]]),
			registered: [],
		},
	)
	const api = new FakeBrowserApi()
	api.reset()
	const logger = new LoggerStore(new ConfigStore())
	const fakeTask = { complete: vi.fn(), fail: vi.fn(), startSubtask: vi.fn() }
	fakeTask.startSubtask.mockReturnValue(fakeTask)

	const collection = new ServiceCollection()
	collection.add(svc(ProfileService.name, { getActiveProfile: async () => ({ id: "p1" }), onProfileDeleted: { add: () => {} } }))
	collection.add(svc(NetworkService.name, { getNetwork: async () => NETWORK, registerChainPurgeSubscriber: () => {} }))
	collection.add(svc(AccountService.name, {}))
	collection.add(svc(TaskService.name, { startNewTask: () => fakeTask }))
	collection.add(svc(OperationJournalService.name, {}))
	const tokenService = new TokenService(logger, api, () => fake.client)
	collection.add(tokenService)
	await collection.start()
	return { tokenService, fake }
}

describe("TokenService composition — in-process, no sandbox", () => {
	test("parseTokenInterface resolves + dedup-registers + extracts real candidates", async () => {
		const { tokenService, fake } = await makeHarness()

		const ti = await tokenService.parseTokenInterface(NETWORK.id, CONTRACT)

		expect(ti.contract).toBe(CONTRACT)
		// Real candidate extraction against the real Token artifact (bb-free, name-based).
		expect(ti.getNameFnCandidates.length).toBeGreaterThan(0)
		expect(ti.transferPublicFnCandidates.length).toBeGreaterThan(0)
		// getContracts() returned [] → the contract was registered exactly once.
		expect(fake.registerCalls).toHaveLength(1)
	})

	test("parseTokenInterface skips registration when already registered (dedup)", async () => {
		const { tokenService, fake } = await makeHarness({
			instances: new Map([[AztecAddress.fromStringUnsafe(CONTRACT).toString(), fakeTokenInstance()]]),
			artifacts: new Map([[CLASS_ID, TokenContractArtifact]]),
			registered: [AztecAddress.fromStringUnsafe(CONTRACT)],
		})

		await tokenService.parseTokenInterface(NETWORK.id, CONTRACT)
		expect(fake.registerCalls).toHaveLength(0) // getContracts() already lists it → no register
	})
})
