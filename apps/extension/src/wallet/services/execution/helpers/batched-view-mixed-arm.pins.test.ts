/**
 * Pre-extraction pin: a MIXED-arm batch (public-static fast prefix + private
 * slow tail) performs exactly ONE `node.getNodeInfo()` and the SAME validated
 * `chainInfo` object feeds both arms — the fast arm's `simulateViaNode` and
 * the slow arm's `buildTxExecutionRequest`. A drifted RPC returning tuple A
 * then B must never validate A for one arm while the other silently commits B.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("@aztec/stdlib/abi", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@aztec/stdlib/abi")>()
	return {
		...actual,
		// Selector computation is a Wasm hash — too heavy for unit tests.
		FunctionSelector: {
			...actual.FunctionSelector,
			fromNameAndParameters: vi.fn(async (name: string, _params: unknown) => ({
				toString: () => `selector-${name}`,
			})),
			fromString: vi.fn((selector: string) => ({ toString: () => selector })),
		},
		encodeArguments: vi.fn(() => []),
		decodeFromAbi: vi.fn((_types: unknown, values: unknown) => values),
	}
})
vi.mock("@aztec/wallet-sdk/base-wallet", () => ({
	simulateViaNode: vi.fn(),
}))
vi.mock("@nulo/aztec-runtime/account", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@nulo/aztec-runtime/account")>()
	return {
		...actual,
		completeFeeOptions: vi.fn(async () => ({ id: "stub-gas-settings" })),
	}
})

import { Fr } from "@aztec/foundation/curves/bn254"
import { type FunctionAbi, FunctionType } from "@aztec/stdlib/abi"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { simulateViaNode } from "@aztec/wallet-sdk/base-wallet"
import type { CallAction } from "@nulo/wallet-bridge"
import { ContractResolver } from "../contract-resolver"
import { batchedViewSimulation, type BatchedViewSimulationDeps } from "./batched-view-simulation"

const simulateViaNodeMock = simulateViaNode as unknown as ReturnType<typeof vi.fn>

const CONTRACT_A = "0x0000000000000000000000000000000000000000000000000000000000000a01"
const ACCOUNT_ADDR = AztecAddress.fromStringUnsafe("0x000000000000000000000000000000000000000000000000000000000000000a")

function abi(name: string, kind: FunctionType, isStatic: boolean): FunctionAbi {
	return {
		name,
		functionType: kind,
		isInternal: false,
		isStatic,
		parameters: [],
		returnTypes: [],
		errorTypes: {},
		// biome-ignore lint/suspicious/noExplicitAny: FunctionAbi has many fields we don't read; cast keeps the fixture small.
	} as any
}

function makeDeps() {
	const fns = [abi("fast_view", FunctionType.PUBLIC, true), abi("bal_priv", FunctionType.PRIVATE, false)]
	// biome-ignore lint/suspicious/noExplicitAny: duck-typed PXE stub
	const pxe: any = {
		getContracts: vi.fn(async () => [AztecAddress.fromStringUnsafe(CONTRACT_A)]),
		registerContract: vi.fn(async () => undefined),
		getSyncedBlockHeader: vi.fn(async () => ({ id: "pxe-synced-header" })),
		executeUtility: vi.fn(),
		simulateTx: vi.fn(async () => ({
			getPublicReturnValues: () => [],
			// Origin === account.address → the helper reads `.nested`.
			getPrivateReturnValues: () => ({ nested: [{ values: [new Fr(7n)] }] }),
		})),
	}
	// biome-ignore lint/suspicious/noExplicitAny: duck-typed node stub
	const node: any = {
		getBlockHeader: vi.fn(async () => ({ id: "node-header" })),
		getNodeInfo: vi.fn(async () => ({ l1ChainId: 11155111, rollupVersion: 4127419662 })),
	}
	// biome-ignore lint/suspicious/noExplicitAny: stub IAccountContract — only the surface the helper touches
	const account: any = {
		address: ACCOUNT_ADDR,
		ensureRegistered: vi.fn(async () => undefined),
		buildTxExecutionRequest: vi.fn(async () => ({ origin: ACCOUNT_ADDR })),
	}
	const contractResolver = {
		extractContracts: vi.fn(() => [CONTRACT_A]),
		resolveInstances: vi.fn(async () => new Map([[CONTRACT_A, { currentContractClassId: { toString: () => "class-A" } }]])),
		resolveInstance: vi.fn(),
		resolveArtifact: vi.fn(),
		resolveArtifacts: vi.fn(async () => new Map([["class-A", { functions: fns, nonDispatchPublicFunctions: [] }]])),
		ensureContractsRegistered: ContractResolver.prototype.ensureContractsRegistered,
		// biome-ignore lint/suspicious/noExplicitAny: ContractResolver structural stub
	} as any
	// chainId=0 → assertLiveChainIdentity is a noop (local substrate).
	return { pxe, node, network: { chainId: 0 }, account, contractResolver, logger: { log: () => {} } } as BatchedViewSimulationDeps
}

beforeEach(() => {
	simulateViaNodeMock.mockReset()
})

describe("batchedViewSimulation — mixed-arm chain-identity pin", () => {
	test("mixed batch: ONE getNodeInfo, the SAME chainInfo object on both arms", async () => {
		simulateViaNodeMock.mockResolvedValueOnce([{ publicOutput: { publicReturnValues: [{ values: [new Fr(42n)] }] } }])
		const deps = makeDeps()
		const calls: CallAction[] = [
			{ kind: "call", contract: CONTRACT_A, method: "fast_view", args: [] }, // fast arm
			{ kind: "call", contract: CONTRACT_A, method: "bal_priv", args: [] }, // slow arm
		]
		const result = await batchedViewSimulation(calls, deps)

		// Both arms genuinely dispatched (no fallback demotion).
		expect(simulateViaNodeMock).toHaveBeenCalledTimes(1)
		// biome-ignore lint/suspicious/noExplicitAny: reading stub call args
		expect((deps.pxe as any).simulateTx).toHaveBeenCalledTimes(1)
		expect(result.encoded[0]?.[0]?.toBigInt()).toBe(42n)
		expect(result.encoded[1]?.[0]?.toBigInt()).toBe(7n)

		// The chain-identity single-sourcing invariant.
		// biome-ignore lint/suspicious/noExplicitAny: reading stub call args
		expect((deps.node as any).getNodeInfo).toHaveBeenCalledTimes(1)
		const fastChainInfo = simulateViaNodeMock.mock.calls[0]?.[3] as { chainId: Fr; version: Fr }
		// biome-ignore lint/suspicious/noExplicitAny: reading stub call args
		const slowChainInfo = (deps.account as any).buildTxExecutionRequest.mock.calls[0]?.[4] as { chainId: Fr; version: Fr }
		expect(fastChainInfo).toBe(slowChainInfo)
		expect(fastChainInfo.chainId.toBigInt()).toBe(11155111n)
		expect(fastChainInfo.version.toBigInt()).toBe(4127419662n)
	})
})
