import { describe, test, expect, beforeAll } from "vitest"
import { JobCancelledError } from "@nulo/extension-messaging/errors"
import { unwrapOperationResult, WalletSdkDispatcher } from "./dispatcher"
import type { GrantedCapabilityRecord, RejectedCapabilityRecord } from "./capabilities"
import type { CapabilityResult } from "./dapp-interaction-protocol"
import type { Operation } from "./operation"
import type { OperationResult } from "./operation-result"
import type { IAccountReader, IDappInteractionRunner, IDappSessionWriter, IExecutionRunner, INetworkReader } from "./services-contract"
import type { IDappSessionRef, INetworkRef } from "./session-types"
import type { ILogger } from "@nulo/wallet-core/logger"

// __VERSION__ is a vite define-injected global at build time; provide it for tests.
beforeAll(() => {
	;(globalThis as { __VERSION__?: string }).__VERSION__ = "test"
})

const noopLogger: ILogger = { log: () => {} }

const stubNetwork: INetworkReader = {
	getNetworks: async () => [],
}
const stubAccount: IAccountReader = {
	getAccounts: async () => [],
}
const stubExecution: IExecutionRunner = {
	executeOperations: async () => [],
}

function makeSession(overrides: Partial<IDappSessionRef> = {}): IDappSessionRef {
	return {
		id: "test-session-id",
		chainId: "1",
		origin: "https://test.example",
		permissions: [],
		accounts: [],
		confirmationLevel: 5 as never,
		capabilityGrants: [],
		capabilityRejections: [],
		...overrides,
	} as IDappSessionRef
}

function makeSessionWriter(initial: IDappSessionRef) {
	let session = initial
	const calls: { setRejections: RejectedCapabilityRecord[][]; setGrants: GrantedCapabilityRecord[][] } = {
		setRejections: [],
		setGrants: [],
	}
	const writer: IDappSessionWriter = {
		tryGetDappSessionByOriginAndChain: async () => session,
		getDappSession: async () => session,
		updateDappSession: async () => session,
		setAccountAliases: async () => session,
		setCapabilityGrants: async (_id, grants) => {
			calls.setGrants.push(grants)
			session = { ...session, capabilityGrants: grants } as IDappSessionRef
			return session
		},
		setCapabilityRejections: async (_id, rejections) => {
			calls.setRejections.push(rejections)
			session = { ...session, capabilityRejections: rejections } as IDappSessionRef
			return session
		},
	}
	return { writer, calls }
}

function makeDispatcher(
	sessionWriter: IDappSessionWriter,
	requestCapabilitiesImpl: (params: unknown) => Promise<CapabilityResult>,
): WalletSdkDispatcher {
	const interaction: IDappInteractionRunner = {
		execute: async () => ({}) as never,
		requestCapabilities: requestCapabilitiesImpl as never,
	}
	return new WalletSdkDispatcher(stubNetwork, stubAccount, stubExecution, interaction, sessionWriter, noopLogger)
}

const ctx = {
	chainId: 0,
	profileId: "test-profile",
	origin: "https://test.example",
	sessionId: "test-session-id",
}

describe("dispatcher.requestCapabilities reject persistence", () => {
	test("user-reject persists rejection for all delta items, then re-throws", async () => {
		const session = makeSession()
		const { writer, calls } = makeSessionWriter(session)
		const dispatcher = makeDispatcher(writer, async () => {
			throw new Error("User rejected")
		})

		const manifest = { capabilities: [{ type: "data" }, { type: "contracts" }] }

		await expect(dispatcher.dispatch("requestCapabilities", [manifest], ctx)).rejects.toThrow("User rejected")

		expect(calls.setRejections).toHaveLength(1)
		const rejected = calls.setRejections[0]
		expect(rejected.map((r) => r.capabilityType).sort()).toEqual(["contracts", "data"])
		expect(calls.setGrants).toHaveLength(0)
	})

	test("re-request after rejection sets reRequested for previously-rejected types", async () => {
		const session = makeSession({
			capabilityRejections: [{ capabilityType: "data", rejectedAt: 1000 }],
		})
		const { writer } = makeSessionWriter(session)

		let observedReRequested: string[] | undefined
		const dispatcher = makeDispatcher(writer, async (params) => {
			observedReRequested = (params as { reRequested?: string[] }).reRequested
			throw new Error("User rejected")
		})

		const manifest = { capabilities: [{ type: "data" }, { type: "contracts" }] }
		await expect(dispatcher.dispatch("requestCapabilities", [manifest], ctx)).rejects.toThrow()

		expect(observedReRequested).toEqual(["data"])
	})

	test("user-reject does NOT persist grants", async () => {
		const session = makeSession()
		const { writer, calls } = makeSessionWriter(session)
		const dispatcher = makeDispatcher(writer, async () => {
			throw new Error("User rejected")
		})

		const manifest = { capabilities: [{ type: "data" }] }
		await expect(dispatcher.dispatch("requestCapabilities", [manifest], ctx)).rejects.toThrow()

		expect(calls.setGrants).toHaveLength(0)
	})

	test("merge: keeps unrelated existing rejections", async () => {
		const session = makeSession({
			capabilityRejections: [{ capabilityType: "transaction", rejectedAt: 500 }],
		})
		const { writer, calls } = makeSessionWriter(session)
		const dispatcher = makeDispatcher(writer, async () => {
			throw new Error("User rejected")
		})

		const manifest = { capabilities: [{ type: "data" }] }
		await expect(dispatcher.dispatch("requestCapabilities", [manifest], ctx)).rejects.toThrow()

		const rejected = calls.setRejections[0]
		const types = rejected.map((r) => r.capabilityType).sort()
		expect(types).toEqual(["data", "transaction"])
	})

	test("successful approval persists grants AND rejections (regression)", async () => {
		const session = makeSession()
		const { writer, calls } = makeSessionWriter(session)
		const dispatcher = makeDispatcher(writer, async () => ({
			granted: [{ type: "data" }],
		}))

		const manifest = { capabilities: [{ type: "data" }, { type: "contracts" }] }
		const result = await dispatcher.dispatch("requestCapabilities", [manifest], ctx)

		expect(result).toMatchObject({ granted: expect.any(Array) })
		expect(calls.setGrants).toHaveLength(1)
		expect(calls.setRejections).toHaveLength(1)
		expect(calls.setRejections[0].map((r) => r.capabilityType)).toEqual(["contracts"])
	})
})

describe("dispatcher.handleBatch", () => {
	function networkWithChainId(chainId: number): INetworkReader {
		const network: INetworkRef = { id: `net-${chainId}`, chainId }
		return { getNetworks: async () => [network] }
	}

	// Programmable executeOperations stub: each call shifts the next pre-loaded
	// result. Underflow throws — silently defaulting would hide a test that
	// expected fewer dispatches than the SUT actually made.
	function mutableExecution(): IExecutionRunner & { calls: Operation["kind"][]; results: OperationResult[] } {
		const stub: IExecutionRunner & { calls: Operation["kind"][]; results: OperationResult[] } = {
			calls: [],
			results: [],
			executeOperations: async (ops: Operation[]) => {
				stub.calls.push(ops[0].kind)
				const next = stub.results.shift()
				if (!next) {
					throw new Error(`mutableExecution: no programmed result for call #${stub.calls.length} (kind=${ops[0].kind})`)
				}
				return [next]
			},
		}
		return stub
	}

	function makeBatchDispatcher(execution: IExecutionRunner): WalletSdkDispatcher {
		const session = makeSession()
		const { writer } = makeSessionWriter(session)
		const interaction: IDappInteractionRunner = {
			execute: async () => ({}) as never,
			requestCapabilities: async () => ({ granted: [] }) as CapabilityResult,
		}
		return new WalletSdkDispatcher(networkWithChainId(0), stubAccount, execution, interaction, writer, noopLogger)
	}

	test("happy path — two legs both succeed, returns them in order", async () => {
		const execution = mutableExecution()
		execution.results.push({ status: "ok", result: { chainInfo: "a" } }, { status: "ok", result: { chainInfo: "b" } })
		const dispatcher = makeBatchDispatcher(execution)

		const result = await dispatcher.dispatch(
			"batch",
			[
				[
					{ name: "getChainInfo", args: [] },
					{ name: "getChainInfo", args: [] },
				],
			],
			ctx,
		)

		expect(result).toEqual([
			{ name: "getChainInfo", result: { chainInfo: "a" } },
			{ name: "getChainInfo", result: { chainInfo: "b" } },
		])
		expect(execution.calls).toEqual(["aztec_getChainInfo", "aztec_getChainInfo"])
	})

	test("first-leg failure aborts — subsequent legs never run", async () => {
		const execution = mutableExecution()
		// Leg 1 fails. Legs 2 and 3 are NOT programmed: if the dispatcher
		// tried to call them, mutableExecution would throw with a distinctive
		// "no programmed result" message — not the leg-1 error we want to
		// assert. Picking up the right error proves the abort.
		execution.results.push({ status: "failed", error: "boom from leg 1" })
		const dispatcher = makeBatchDispatcher(execution)

		await expect(
			dispatcher.dispatch(
				"batch",
				[
					[
						{ name: "getChainInfo", args: [] },
						{ name: "getChainInfo", args: [] },
						{ name: "getChainInfo", args: [] },
					],
				],
				ctx,
			),
		).rejects.toThrow("boom from leg 1")

		expect(execution.calls).toEqual(["aztec_getChainInfo"])
	})
})

describe("unwrapOperationResult", () => {
	test("ok returns the inner value", () => {
		expect(unwrapOperationResult({ status: "ok", result: 42 })).toBe(42)
	})

	test("cancelled throws JobCancelledError carrying jobId", () => {
		// Pin: ensures the dispatcher emits a structured rejection that the
		// wallet-sdk handler can map to a `{ code: 4001, ... }` dApp response.
		// Regression target: silently downgrading this to `new Error(...)`
		// would re-introduce the misclassification dApps see today.
		try {
			unwrapOperationResult({ status: "cancelled", jobId: "abc-123", reason: "user" })
			expect.unreachable("should have thrown")
		} catch (err) {
			expect(err).toBeInstanceOf(JobCancelledError)
			expect((err as JobCancelledError).code).toBe(JobCancelledError.CODE)
			expect((err as JobCancelledError).details).toMatchObject({ jobId: "abc-123" })
		}
	})

	test("failed throws plain Error with the inner error string", () => {
		expect(() => unwrapOperationResult({ status: "failed", error: "boom" })).toThrowError(/boom/)
	})

	test("skipped throws (batch sibling after a non-ok)", () => {
		expect(() => unwrapOperationResult({ status: "skipped" })).toThrow()
	})
})
