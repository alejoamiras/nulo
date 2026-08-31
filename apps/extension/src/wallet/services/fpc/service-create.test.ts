/**
 * FPC creation fences: `addFpc` and the `getFpcs` protocol-discovery writes
 * capture the deletion fence at their authorizing entry and assert it flush
 * against the row write — a deletion completing during the PXE fetches must
 * never land an orphan row.
 */
import { describe, expect, test, vi } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/spec"
import { NETWORK_SERVICE_NAME } from "@/wallet/services/network/spec"
import { svc } from "../composition-harness"

vi.mock("@/wallet/services/execution/contract-resolver", () => ({
	ensureRegistered: async () => {},
}))
// The discovery branch derives protocol instances with real Poseidon hashing,
// which cannot run in this vitest env (bb.js std::bad_cast — the composition
// boundary). The pins exercise fence ORDERING, not derivation.
vi.mock("@aztec/stdlib/contract", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getContractInstanceFromInstantiationParams: async (artifact: { functions: Array<{ name: string }> }) => ({
		address: {
			toString: () => (artifact.functions.some((f) => f.name === "sponsor_unconditionally") ? "0xsponsored" : "0xprivate"),
		},
	}),
}))

import { FpcService, FpcType } from "./service"

function _deferred<T>() {
	let resolve!: (v: T) => void
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

const SPONSOR_ARTIFACT = { functions: [{ name: "sponsor_unconditionally", parameters: [], returnTypes: [] }] }
const NETWORK = {
	id: "n1",
	profileId: "p1",
	chainId: 1,
	l1ChainId: 1,
	name: "N",
	primaryEndpointId: "e1",
	endpoints: [{ id: "e1", rpcUrl: "https://n.example/" }],
}

async function makeHarness() {
	const api = new FakeBrowserApi()
	api.reset()
	const deletionState = new ProfileDeletionState()
	const services = new ServiceCollection()
	services.add(
		svc(PROFILE_SERVICE_NAME, {
			getDeletionState: () => deletionState,
			getActiveProfile: async () => ({ id: "p1" }),
			captureExecutionFence: async () => ({ profileId: "p1", epoch: deletionState.capture("p1") }),
		}),
	)
	services.add(
		svc(NETWORK_SERVICE_NAME, {
			registerChainPurgeSubscriber: () => {},
			getNetwork: async () => NETWORK,
			getNetworks: async () => [NETWORK],
			isNetworkLive: async () => true,
		}),
	)
	const service = new FpcService(new LoggerStore(new ConfigStore()), api)
	services.add(service)
	await services.start()
	// Pre-seed the protocol-address cache so no real Poseidon derivation runs.
	;(service as unknown as { protocolAddresses: Map<number, unknown> }).protocolAddresses.set(1, {
		sponsored: "0xsponsored",
		private: "0xprivate",
	})
	return { api, deletionState, service }
}

async function fpcRowCount(api: FakeBrowserApi): Promise<number> {
	const raw = await api.storage.local.get(null)
	return Object.keys(raw).filter((k) => k.startsWith("nulo:core:fpcs@")).length
}

describe("FPC creation fences", () => {
	test("addFpc: a deletion completing DURING the artifact fetch rejects the write (entry-capture pin)", async () => {
		const h = await makeHarness()
		const gate = _deferred<unknown>()
		;(h.service as unknown as { pxeService: unknown }).pxeService = {
			getPXE: () => ({
				getContractInstance: async () => ({ currentContractClassId: "c1" }),
				getContractArtifact: () => gate.promise,
			}),
		}

		const run = h.service.addFpc("n1", FpcType.DefaultSponsoredFpc, `0x${"11".repeat(32)}`, "New")
		await new Promise((r) => setTimeout(r, 0))
		h.deletionState.beginDeletion("p1")
		h.deletionState.release("p1")
		gate.resolve(SPONSOR_ARTIFACT)

		await expect(run).rejects.toThrow(/deleted|not current/i)
		expect(await fpcRowCount(h.api)).toBe(0)
	})

	test("getFpcs discovery: a deletion completing DURING the registration park writes NO protocol rows", async () => {
		// Discovery is best-effort per item (throws are caught + logged), so the
		// observable contract is: zero rows land for the deleted profile.
		const h = await makeHarness()
		const gate = _deferred<void>()
		;(h.service as unknown as { pxeService: unknown }).pxeService = {
			getPXE: () => ({
				registerContract: () => gate.promise,
			}),
		}

		const run = h.service.getFpcs(1)
		await new Promise((r) => setTimeout(r, 0))
		h.deletionState.beginDeletion("p1")
		h.deletionState.release("p1")
		gate.resolve()

		await run
		expect(await fpcRowCount(h.api)).toBe(0)
	})
})
