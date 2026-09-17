/**
 * Unit pins for `TokenService`'s metadata read: whichever getters the token interface has are read
 * in ONE `batchedViewSimulation` call. The helper is mocked here — how a batch is dispatched (one
 * direct-to-node call for public-static getters, one combined `simulateTx` for private ones) is pinned
 * by its own suite, `execution/helpers/batched-view-simulation.test.ts`.
 */

import { Fr } from "@aztec/foundation/curves/bn254"
import { FunctionType } from "@aztec/stdlib/abi"
import { EventHandler } from "@nulo/wallet-core/utils"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import type { EncodedCallAction } from "@nulo/wallet-bridge"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { AccountService } from "@/wallet/services/account/service"
import { svc } from "@/wallet/services/composition-harness"
import { batchedViewSimulation } from "@/wallet/services/execution/helpers/batched-view-simulation"
import { NetworkService } from "@/wallet/services/network/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { ProfileService } from "@/wallet/services/profile/service"
import { TaskService } from "@/wallet/services/task/service"
import { feeJuiceAddress, feeJuiceName, feeJuiceSymbol } from "@/wallet/utils/fee-juice"
import { TokenService } from "./service"
import type { TokenInterface } from "./spec"

vi.mock("@/wallet/services/execution/helpers/batched-view-simulation", () => ({ batchedViewSimulation: vi.fn() }))

// A real selector is a poseidon hash, i.e. Barretenberg — which the unit layer does not load.
vi.mock("@aztec/stdlib/abi", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@aztec/stdlib/abi")>()
	return {
		...actual,
		FunctionSelector: {
			...actual.FunctionSelector,
			fromNameAndParameters: vi.fn(async (name: string) => ({ toString: () => `selector-${name}` })),
		},
	}
})

const NETWORK = { id: "net1", chainId: 1, primaryEndpointId: "ep1", endpoints: [{ id: "ep1", rpcUrl: "http://fake" }] }
const CONTRACT = `0x${"0c".repeat(32)}`
const ACCOUNT = { address: "0xacc" }
const NODE = { node: true }
const PXE = { pxe: true }

/** A field-compressed string as the chain returns it: 31 utf-8 bytes behind a zero top byte (so the
 *  value stays below the field modulus), NUL-padded. */
const compressed = (text: string): Fr[] => [
	Fr.fromBuffer(Buffer.concat([Buffer.alloc(1), Buffer.from(text, "utf-8"), Buffer.alloc(32)]).subarray(0, 32)),
]

const PUBLIC = 0
const PRIVATE = 1
const ti = (impl: number, omit: Array<"getNameFn" | "getSymbolFn" | "getDecimalsFn"> = [], contract = CONTRACT): TokenInterface => {
	const all = {
		getNameFn: { name: impl === PRIVATE ? "private_get_name" : "public_get_name", impl },
		getSymbolFn: { name: impl === PRIVATE ? "private_get_symbol" : "public_get_symbol", impl },
		getDecimalsFn: { name: impl === PRIVATE ? "private_get_decimals" : "public_get_decimals", impl },
	}
	const kept = Object.fromEntries(Object.entries(all).filter(([key]) => !omit.includes(key as keyof typeof all)))
	return { chainId: 1, contract, ...kept, isComplete: true } as unknown as TokenInterface
}

type Fetch = (profileId: string, networkId: string, address: string, ti: TokenInterface) => Promise<[string, string, number]>

async function makeFetch(): Promise<Fetch> {
	const api = new FakeBrowserApi()
	api.reset()
	const deletionState = new ProfileDeletionState()
	const collection = new ServiceCollection()
	collection.add(
		svc(ProfileService.name, {
			getActiveProfile: async () => ({ id: "p1" }),
			onProfileDeleted: { add: () => {} },
			onActiveProfileChanged: new EventHandler(),
			getDeletionState: () => deletionState,
		}),
	)
	collection.add(
		svc(NetworkService.name, {
			getNetwork: async () => NETWORK,
			getNode: async () => NODE,
			registerChainPurgeSubscriber: () => {},
			onActiveNetworkChanged: new EventHandler(),
		}),
	)
	collection.add(svc(AccountService.name, { onAccountAdded: new EventHandler(), getAccountContract: async () => ACCOUNT }))
	collection.add(svc(TaskService.name, {}))
	collection.add(svc(OperationJournalService.name, {}))
	const tokenService = new TokenService(new LoggerStore(new ConfigStore()), api, () => ({ getPXE: () => PXE }) as never)
	collection.add(tokenService)
	await collection.start()
	// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in to the private metadata read
	return (...args) => (tokenService as any).fetchTokenMetadata(...args)
}

const batched = vi.mocked(batchedViewSimulation)

beforeEach(() => {
	batched.mockReset()
})

describe("TokenService metadata read", () => {
	test("name, symbol and decimals are read in ONE batched simulation, in that order, and decoded as before", async () => {
		batched.mockResolvedValue({ encoded: [compressed("Clean USDC"), compressed("cUSDC"), [new Fr(6)]], decoded: [] })
		const fetch = await makeFetch()

		expect(await fetch("p1", NETWORK.id, ACCOUNT.address, ti(PUBLIC))).toEqual(["Clean USDC", "cUSDC", 6])

		expect(batched).toHaveBeenCalledTimes(1)
		const [calls, deps] = batched.mock.calls[0]
		expect(calls).toMatchObject([
			{ kind: "encoded_call", to: CONTRACT, name: "public_get_name", type: FunctionType.PUBLIC, isStatic: true, args: [] },
			{ kind: "encoded_call", to: CONTRACT, name: "public_get_symbol", type: FunctionType.PUBLIC, isStatic: true, args: [] },
			{ kind: "encoded_call", to: CONTRACT, name: "public_get_decimals", type: FunctionType.PUBLIC, isStatic: true, args: [] },
		])
		// Public + static + no hidden sender is what makes the whole batch eligible for the direct-to-node arm.
		expect((calls as EncodedCallAction[]).some((call) => call.hideMsgSender)).toBe(false)
		expect(deps).toMatchObject({ pxe: PXE, node: NODE, network: NETWORK, account: ACCOUNT })
	})

	test("private getters still make ONE batch (the helper's combined slow arm)", async () => {
		batched.mockResolvedValue({ encoded: [compressed("Name"), compressed("SYM"), [new Fr(18)]], decoded: [] })
		const fetch = await makeFetch()

		expect(await fetch("p1", NETWORK.id, ACCOUNT.address, ti(PRIVATE))).toEqual(["Name", "SYM", 18])

		expect(batched).toHaveBeenCalledTimes(1)
		expect((batched.mock.calls[0][0] as EncodedCallAction[]).map((call) => call.type)).toEqual([
			FunctionType.PRIVATE,
			FunctionType.PRIVATE,
			FunctionType.PRIVATE,
		])
	})

	test("a missing getter keeps its fallback and the others keep their slot in the batch", async () => {
		batched.mockResolvedValue({ encoded: [compressed("Only Name"), [new Fr(8)]], decoded: [] })
		const fetch = await makeFetch()

		expect(await fetch("p1", NETWORK.id, ACCOUNT.address, ti(PUBLIC, ["getSymbolFn"]))).toEqual(["Only Name", "<symbol>", 8])
		expect((batched.mock.calls[0][0] as EncodedCallAction[]).map((call) => call.name)).toEqual([
			"public_get_name",
			"public_get_decimals",
		])
	})

	test("no getters at all: placeholder fallbacks, fee juice gets its fixed name and symbol", async () => {
		batched.mockResolvedValue({ encoded: [], decoded: [] })
		const fetch = await makeFetch()
		const none = ["getNameFn", "getSymbolFn", "getDecimalsFn"] as const

		expect(await fetch("p1", NETWORK.id, ACCOUNT.address, ti(PUBLIC, [...none]))).toEqual(["<name>", "<symbol>", 0])
		expect(await fetch("p1", NETWORK.id, ACCOUNT.address, ti(PUBLIC, [...none], feeJuiceAddress))).toEqual([
			feeJuiceName,
			feeJuiceSymbol,
			0,
		])
		for (const [calls] of batched.mock.calls) expect(calls).toEqual([])
	})

	test("a failed read propagates — no partial metadata", async () => {
		batched.mockRejectedValue(new Error("simulation reverted"))
		const fetch = await makeFetch()

		await expect(fetch("p1", NETWORK.id, ACCOUNT.address, ti(PUBLIC))).rejects.toThrow("simulation reverted")
	})
})
