import { describe, test, expect, beforeAll } from "vitest"
import { CapabilityNotGrantedError, JobCancelledError } from "@nulo/extension-messaging/errors"
import { unwrapOperationResult, WalletSdkDispatcher } from "./dispatcher"
import type { Capability, GrantedCapabilityRecord, RejectedCapabilityRecord } from "./capabilities"
import type { CapabilityResult } from "./dapp-interaction-protocol"
import type { Operation } from "./operation"
import type { OperationResult } from "./operation-result"
import type { IAccountReader, IDappInteractionRunner, IDappSessionWriter, IExecutionRunner, INetworkReader } from "./services-contract"
import type { IDappSessionRef, INetworkRef } from "./session-types"
import { LogLevel, type ILogger } from "@nulo/wallet-core/logger"

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

// ---------------------------------------------------------------------------
// Phase 1 (plan-v3) — handleGetAccounts contract rows
// ---------------------------------------------------------------------------

/** Logger-capturing helper for the getAccounts tests below. */
function capturingLogger(): { logger: ILogger; calls: Array<{ level: LogLevel; msg: string }> } {
	const calls: Array<{ level: LogLevel; msg: string }> = []
	return {
		calls,
		logger: {
			log: (_scope, level, msg) => {
				calls.push({ level, msg: String(msg) })
			},
		},
	}
}

/** Dispatcher factory that lets each getAccounts test wire in its own
 *  session, account reader, and logger. The default network has chainId 0 to
 *  match the shared `ctx` constant. */
function makeGetAccountsDispatcher(opts: {
	session: IDappSessionRef
	accounts?: Array<{ address: string; name: string; chainId: number }>
	logger?: ILogger
}): { dispatcher: WalletSdkDispatcher; loggerCalls?: Array<{ level: LogLevel; msg: string }> } {
	const sessionWriter: IDappSessionWriter = {
		tryGetDappSessionByOriginAndChain: async () => opts.session,
		getDappSession: async () => opts.session,
		updateDappSession: async () => opts.session,
		setAccountAliases: async () => opts.session,
		setCapabilityGrants: async () => opts.session,
		setCapabilityRejections: async () => opts.session,
	}
	const network: INetworkRef = { id: "net-0", chainId: 0 }
	const networkReader: INetworkReader = { getNetworks: async () => [network] }
	const accountReader: IAccountReader = {
		getAccounts: async () => opts.accounts ?? [],
	}
	const interaction: IDappInteractionRunner = {
		execute: async () => ({}) as never,
		requestCapabilities: async () => ({ granted: [] }) as CapabilityResult,
	}
	const cap = capturingLogger()
	const logger = opts.logger ?? cap.logger
	return {
		dispatcher: new WalletSdkDispatcher(networkReader, accountReader, stubExecution, interaction, sessionWriter, logger),
		loggerCalls: opts.logger ? undefined : cap.calls,
	}
}

describe("dispatcher.handleGetAccounts — plan-v3 contract", () => {
	test("no session → throws plain 'No dApp session found' Error (NOT CapabilityNotGrantedError)", async () => {
		// Ordering pin: if a future refactor moves the session-not-found check
		// AFTER the CapabilityNotGrantedError throw, dApps relying on the
		// session-expired diagnostic would silently start seeing 4100.
		const sessionWriter: IDappSessionWriter = {
			tryGetDappSessionByOriginAndChain: async () => null as unknown as IDappSessionRef,
			getDappSession: async () => null as unknown as IDappSessionRef,
			updateDappSession: async () => null as unknown as IDappSessionRef,
			setAccountAliases: async () => null as unknown as IDappSessionRef,
			setCapabilityGrants: async () => null as unknown as IDappSessionRef,
			setCapabilityRejections: async () => null as unknown as IDappSessionRef,
		}
		const network: INetworkRef = { id: "net-0", chainId: 0 }
		const networkReader: INetworkReader = { getNetworks: async () => [network] }
		const interaction: IDappInteractionRunner = {
			execute: async () => ({}) as never,
			requestCapabilities: async () => ({ granted: [] }) as CapabilityResult,
		}
		const dispatcher = new WalletSdkDispatcher(networkReader, stubAccount, stubExecution, interaction, sessionWriter, noopLogger)

		await expect(dispatcher.dispatch("getAccounts", [], ctx)).rejects.toThrow(/No dApp session found/)
		await expect(dispatcher.dispatch("getAccounts", [], ctx)).rejects.not.toBeInstanceOf(CapabilityNotGrantedError)
	})

	test("no accounts grant → throws CapabilityNotGrantedError with exact stable message + debug log", async () => {
		// Stable-message contract (plan-v3 §5): the literal string is a public
		// contract because substring-matching dApps lock it in. If you change
		// the wording, change it everywhere AND coordinate with downstream.
		const session = makeSession()
		const { dispatcher, loggerCalls } = makeGetAccountsDispatcher({ session })

		await expect(dispatcher.dispatch("getAccounts", [], ctx)).rejects.toBeInstanceOf(CapabilityNotGrantedError)
		await expect(dispatcher.dispatch("getAccounts", [], ctx)).rejects.toMatchObject({
			code: "CAPABILITY_NOT_GRANTED",
			message: "accounts capability not granted. Call requestCapabilities() first.",
			details: { capabilityType: "accounts" },
		})

		// Log noise control: dApps may re-fire getAccounts() per render, so the
		// pre-grant throw must be Debug, not Info.
		const debugCalls = (loggerCalls ?? []).filter((c) => c.level === LogLevel.Debug)
		expect(debugCalls.length).toBeGreaterThan(0)
		expect(debugCalls.some((c) => c.msg.includes("CAPABILITY_NOT_GRANTED"))).toBe(true)
	})

	test("session has 1 account → returns formatted Aliased<AztecAddress> (fast path, regression pin)", async () => {
		// CAIP account for chainId 0 on the address below.
		const addr = "0x1111111111111111111111111111111111111111111111111111111111111111"
		const caip = `aztec:0:${addr}`
		const session = makeSession({
			accounts: [caip],
			accountAliases: { [caip]: "my-app-alias" },
		})
		const { dispatcher } = makeGetAccountsDispatcher({
			session,
			accounts: [{ address: addr, name: "Account 1", chainId: 0 }],
		})

		const result = await dispatcher.dispatch("getAccounts", [], ctx)
		expect(result).toEqual([{ alias: "my-app-alias", item: addr }])
	})

	test("desync — accounts grant exists but session.accounts is empty → returns [] + warn log (NO throw)", async () => {
		// Defensive path: if storage shipped a bad write, don't loop the dApp
		// via the 4100 throw. Return [] and warn so an engineer notices.
		const accountsGrant: GrantedCapabilityRecord = {
			capability: { type: "accounts", canGet: true, canCreateAuthWit: false, accounts: [] } as Capability,
			grantedAt: 1,
		}
		const session = makeSession({ accounts: [], capabilityGrants: [accountsGrant] })
		const { dispatcher, loggerCalls } = makeGetAccountsDispatcher({ session })

		const result = await dispatcher.dispatch("getAccounts", [], ctx)
		expect(result).toEqual([])
		const warnCalls = (loggerCalls ?? []).filter((c) => c.level === LogLevel.Warn)
		expect(warnCalls.some((c) => c.msg.includes("Desync"))).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// Phase 1.5 (plan-v3) — field-aware `accounts` delta + enrich uses stored grant
// ---------------------------------------------------------------------------

describe("dispatcher.requestCapabilities — Phase 1.5 field-aware accounts diff", () => {
	/** Phase 1.5 tests go through `enrichGrantedCapabilities` which calls
	 *  `resolveNetwork()` — so we need a network reader configured for the
	 *  ctx.chainId (0). The default `stubNetwork` returns [], which throws. */
	function makePhase15Dispatcher(
		writer: IDappSessionWriter,
		requestCapabilitiesImpl: (params: unknown) => Promise<CapabilityResult>,
	): WalletSdkDispatcher {
		const network: INetworkRef = { id: "net-0", chainId: 0 }
		const networkReader: INetworkReader = { getNetworks: async () => [network] }
		const interaction: IDappInteractionRunner = {
			execute: async () => ({}) as never,
			requestCapabilities: requestCapabilitiesImpl as never,
		}
		return new WalletSdkDispatcher(networkReader, stubAccount, stubExecution, interaction, writer, noopLogger)
	}

	test("granted accounts(canCreateAuthWit:false) + re-requested SAME shape → no popup (same-shape no-op)", async () => {
		// Regression pin: the field-aware filter must not over-trigger. If two
		// requests are shape-equal, the second one short-circuits via the
		// `delta.length === 0` early return and the popup never opens.
		let popupCalls = 0
		const existingAccountsCap: Capability = {
			type: "accounts",
			canGet: true,
			canCreateAuthWit: false,
			accounts: [],
		}
		const session = makeSession({
			capabilityGrants: [{ capability: existingAccountsCap, grantedAt: 1 }],
		})
		const { writer } = makeSessionWriter(session)
		const dispatcher = makePhase15Dispatcher(writer, async () => {
			popupCalls++
			return { granted: [{ type: "accounts" }] } as CapabilityResult
		})

		const manifest = { capabilities: [{ type: "accounts", canGet: true, canCreateAuthWit: false }] }
		await dispatcher.dispatch("requestCapabilities", [manifest], ctx)

		expect(popupCalls).toBe(0)
	})

	test("granted accounts(canCreateAuthWit:false) + re-requested with canCreateAuthWit:true → popup RE-OPENS (Bug B fix)", async () => {
		// This is the authority-escalation regression pin. Without the
		// field-aware diff (type-only `grantedTypes.has(cap.type)`), the dApp
		// could silently upgrade from `canGet`-only to `canCreateAuthWit:true`.
		let popupCalls = 0
		const existingAccountsCap: Capability = {
			type: "accounts",
			canGet: true,
			canCreateAuthWit: false,
			accounts: [],
		}
		const session = makeSession({
			capabilityGrants: [{ capability: existingAccountsCap, grantedAt: 1 }],
		})
		const { writer } = makeSessionWriter(session)
		const dispatcher = makePhase15Dispatcher(writer, async () => {
			popupCalls++
			return { granted: [{ type: "accounts", canGet: true, canCreateAuthWit: true }] } as CapabilityResult
		})

		const manifest = { capabilities: [{ type: "accounts", canGet: true, canCreateAuthWit: true }] }
		await dispatcher.dispatch("requestCapabilities", [manifest], ctx)

		expect(popupCalls).toBe(1)
	})

	test("enrichGrantedCapabilities — stored canCreateAuthWit:false, requested true → response shows false (wire can't lie)", async () => {
		// If a dApp later asks for the upgraded shape AND the user denies it,
		// the wire response must reflect what was actually granted (the older
		// `false`), not what was requested (`true`). Otherwise the dApp would
		// think it has canCreateAuthWit until scope-enforcement refuses the
		// next createAuthWit call — confusing UX + protocol-correctness bug.
		const existingAccountsCap: Capability = {
			type: "accounts",
			canGet: true,
			canCreateAuthWit: false,
			accounts: [],
		}
		const session = makeSession({
			capabilityGrants: [{ capability: existingAccountsCap, grantedAt: 1 }],
		})
		const { writer } = makeSessionWriter(session)
		// Popup returns ONLY the original `false` shape — simulating user deny on
		// the upgrade. The bug Phase 1.5 fixes is that the dApp would still see
		// `canCreateAuthWit:true` in the wire response because the OLD code
		// spread the REQUESTED cap shape, not the stored one.
		const dispatcher = makePhase15Dispatcher(writer, async () => {
			return { granted: [{ type: "accounts", canGet: true, canCreateAuthWit: false }] } as CapabilityResult
		})

		const manifest = { capabilities: [{ type: "accounts", canGet: true, canCreateAuthWit: true }] }
		const result = (await dispatcher.dispatch("requestCapabilities", [manifest], ctx)) as { granted: Array<Record<string, unknown>> }

		const accountsResult = result.granted.find((c) => c.type === "accounts")
		expect(accountsResult?.canCreateAuthWit).toBe(false)
		expect(accountsResult?.canGet).toBe(true)
	})
})

// ── registerToken (Nulo-custom) — schema-patch reachability + routing ───
//
// These tests pin the BLOCKER fixes from the dual audit:
//   - The runtime schema patch must extend WalletSchema with `registerToken`
//     (otherwise the dApp-side Proxy refuses the call before it reaches us).
//   - The dispatcher must route `registerToken` through DappInteractionService.execute()
//     (otherwise the popup gate is bypassed; the previous code path sent it
//     straight to ExecutionService.executeOperations which silenced the confirm).
//   - The capability gate must require the `accounts` capability.
//   - `getCompleteAddress` and `simulateViews` must NOT dispatch — they were
//     dropped from the wire surface. Regression guard against re-introduction
//     without a paired schema entry + test.

describe("dispatcher — registerToken reachability + routing", () => {
	test("schema patch extends WalletSchema with a 2-arg `registerToken` entry", async () => {
		// Import the production patch from the extension package. This is the
		// reachability assertion: if the side-effect import drifts (renamed,
		// moved, or accidentally tree-shaken by a future bundler), this test
		// fails.
		await import("../../extension/src/wallet/services/wallet-sdk/nulo-schema-patch")
		const { WalletSchema } = await import("@aztec/aztec.js/wallet")
		expect("registerToken" in WalletSchema).toBe(true)
		// biome-ignore lint/suspicious/noExplicitAny: WalletSchema entry shape is upstream-typed but per-key access is opaque
		const entry = (WalletSchema as any).registerToken
		expect(typeof entry?.parameters).toBe("function")
		const params = entry.parameters()
		expect(params.items.length).toBe(2)
	})

	test("dispatch('registerToken', ...) routes through DappInteractionService.execute (NOT executeOperations)", async () => {
		const session = makeSession({
			capabilityGrants: [
				{
					capability: {
						type: "accounts",
						canGet: true,
						canCreateAuthWit: false,
						accounts: [{ alias: "main", item: "0x123" }],
					} as Capability,
					grantedAt: 1,
				},
			],
			accounts: ["aztec:0:0xacc"],
		})
		const { writer } = makeSessionWriter(session)

		const executeCalls: unknown[] = []
		const executionCalls: unknown[] = []
		const interaction: IDappInteractionRunner = {
			execute: async (params: unknown) => {
				executeCalls.push(params)
				return [{ status: "ok", result: undefined }] as never
			},
			requestCapabilities: async () => ({}) as never,
		}
		const execution: IExecutionRunner = {
			executeOperations: async (ops) => {
				executionCalls.push(ops)
				return [{ status: "ok", result: undefined }] as OperationResult[]
			},
		}
		const network: INetworkReader = {
			getNetworks: async () => [{ id: "net1", chainId: 0 }] as INetworkRef[],
		}
		const account: IAccountReader = {
			getAccounts: async () => [{ address: "0xacc", name: "main", chainId: 0 }],
		}
		const dispatcher = new WalletSdkDispatcher(network, account, execution, interaction, writer, noopLogger)

		await dispatcher.dispatch("registerToken", ["0xacc", "0xdeadbeef"], ctx)

		expect(executeCalls).toHaveLength(1)
		expect(executionCalls).toHaveLength(0)
		const params = executeCalls[0] as { operations: Array<{ kind: string; account: string; address: string }> }
		expect(params.operations[0].kind).toBe("register_token")
		// The dApp-supplied account (args[0]) must be threaded into the
		// request — NOT silently swapped for a different session-authorized
		// account. Storage scoping is profile+chain but the journal records
		// the requested account.
		expect(params.operations[0].account).toBe("aztec:0:0xacc")
		expect(params.operations[0].address).toBe("0xdeadbeef")
	})

	test("dispatch('registerToken', ...) rejects when the requested account is not in the session's authorized list", async () => {
		const session = makeSession({
			capabilityGrants: [
				{
					capability: {
						type: "accounts",
						canGet: true,
						canCreateAuthWit: false,
						accounts: [{ alias: "main", item: "0xacc" }],
					} as Capability,
					grantedAt: 1,
				},
			],
			accounts: ["aztec:0:0xacc"], // only 0xacc is authorized
		})
		const { writer } = makeSessionWriter(session)

		const interaction: IDappInteractionRunner = {
			execute: async () => [{ status: "ok", result: undefined }] as never,
			requestCapabilities: async () => ({}) as never,
		}
		const execution: IExecutionRunner = {
			executeOperations: async () => [] as OperationResult[],
		}
		const network: INetworkReader = {
			getNetworks: async () => [{ id: "net1", chainId: 0 }] as INetworkRef[],
		}
		const account: IAccountReader = {
			getAccounts: async () => [
				{ address: "0xacc", name: "main", chainId: 0 },
				{ address: "0xunauthorized", name: "extra", chainId: 0 },
			],
		}
		const dispatcher = new WalletSdkDispatcher(network, account, execution, interaction, writer, noopLogger)

		// dApp asks the wallet to register a token for 0xunauthorized — an
		// account that exists on the wallet but is NOT in the session's
		// authorized list. The dispatcher must refuse rather than silently
		// substituting the session's authorized 0xacc.
		await expect(dispatcher.dispatch("registerToken", ["0xunauthorized", "0xdeadbeef"], ctx)).rejects.toThrow(/not authorized/i)
	})

	test("batch([{name:'registerToken', ...}]) is rejected server-side", async () => {
		// Even if a raw protocol client bypasses the SDK's dApp-side Zod
		// validation (BatchedMethodSchema is built from WalletMethodSchemas,
		// not the runtime-patched WalletSchema), the dispatcher must reject
		// batched registerToken because it requires a popup gate that a
		// batch result can't represent.
		const session = makeSession()
		const { writer } = makeSessionWriter(session)
		const dispatcher = makeDispatcher(writer, async () => ({}) as CapabilityResult)

		await expect(dispatcher.dispatch("batch", [[{ name: "registerToken", args: ["0xacc", "0xdeadbeef"] }]], ctx)).rejects.toThrow(
			/cannot be used inside batch/i,
		)
	})

	test("batch([{name:'sendTx', ...}]) is also rejected (same popup-gated reason)", async () => {
		const session = makeSession()
		const { writer } = makeSessionWriter(session)
		const dispatcher = makeDispatcher(writer, async () => ({}) as CapabilityResult)

		await expect(dispatcher.dispatch("batch", [[{ name: "sendTx", args: [{}, {}] }]], ctx)).rejects.toThrow(
			/cannot be used inside batch/i,
		)
	})

	test("dispatch('getCompleteAddress', ...) is no longer supported (regression guard)", async () => {
		const session = makeSession()
		const { writer } = makeSessionWriter(session)
		const dispatcher = makeDispatcher(writer, async () => ({}) as CapabilityResult)
		await expect(dispatcher.dispatch("getCompleteAddress", ["0xacc"], ctx)).rejects.toThrow(/Unsupported wallet method/)
	})

	test("dispatch('simulateViews', ...) is no longer supported (regression guard)", async () => {
		const session = makeSession()
		const { writer } = makeSessionWriter(session)
		const dispatcher = makeDispatcher(writer, async () => ({}) as CapabilityResult)
		await expect(dispatcher.dispatch("simulateViews", [[]], ctx)).rejects.toThrow(/Unsupported wallet method/)
	})

	test("getRequiredCapability('registerToken') === 'accounts'", async () => {
		const { getRequiredCapability } = await import("./capability-map")
		expect(getRequiredCapability("registerToken")).toBe("accounts")
		expect(getRequiredCapability("getCompleteAddress")).toBeNull()
		expect(getRequiredCapability("simulateViews")).toBeNull()
	})
})
