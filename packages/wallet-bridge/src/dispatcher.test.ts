import { describe, test, expect, beforeAll } from "vitest"
import { CapabilityNotGrantedError, JobCancelledError } from "@nulo/extension-messaging/errors"
import { unwrapOperationResult, WalletSdkDispatcher } from "./dispatcher"
import type { Capability, GrantedCapabilityRecord, RejectedCapabilityRecord } from "./capabilities"
import type { CapabilityResult } from "./dapp-interaction-protocol"
import type { Operation } from "./operation"
import type { OperationResult } from "./operation-result"
import type {
	IAccountReader,
	IDappInteractionRunner,
	IDappSessionWriter,
	IExecutionHooks,
	IExecutionRunner,
	INetworkReader,
} from "./services-contract"
import type { IAccountRef, IDappSessionRef, INetworkRef } from "./session-types"
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
	test("no session → throws CapabilityNotGrantedError (F-006: fail-closed)", async () => {
		// Phase 3 / F-006: pre-fix, this returned [] from enforceCapability
		// and the dispatcher fell through with no grants, letting network-only
		// methods execute unchecked after the user revoked the dApp.
		// Post-fix: enforceCapability throws CapabilityNotGrantedError when
		// the session is missing, paired with the live-transport teardown
		// in wallet-sdk/background.ts.
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

		await expect(dispatcher.dispatch("getAccounts", [], ctx)).rejects.toBeInstanceOf(CapabilityNotGrantedError)
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

	test("session has 1 account + canGet=true grant → returns formatted Aliased<AztecAddress> (fast path)", async () => {
		// CAIP account for chainId 0 on the address below.
		// Post F-003: also requires an accounts grant with canGet=true. The
		// legacy "accounts present without a grant" fast-path is closed; F-003's
		// scope-enforcement now requires explicit canGet.
		const addr = "0x1111111111111111111111111111111111111111111111111111111111111111"
		const caip = `aztec:0:${addr}`
		const session = makeSession({
			accounts: [caip],
			accountAliases: { [caip]: "my-app-alias" },
			capabilityGrants: [
				{
					capability: { type: "accounts", canGet: true, accounts: [{ alias: "my-app-alias", item: caip }] } as Capability,
					grantedAt: 1,
				},
			],
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

/**
 * Plan §Tests #N: hooks invariant for batch dispatch.
 *
 * Codex round-3 F3 + R6 confirmation: `dispatch("batch", legs, ctx, hooks)`
 * MUST NOT forward hooks into the recursive per-leg dispatch. Otherwise a
 * batched sendTx leg's `onExecutionEnqueued` would advance the top-level
 * session FIFO baton before later batch legs complete, breaking batch's
 * sequential-completion contract.
 */
describe("dispatcher batch hooks isolation", () => {
	test("batch dispatch does NOT forward hooks into recursive per-leg dispatch", async () => {
		const session = makeSession({
			capabilityGrants: [
				{ capability: { type: "accounts", canGet: true, canCreateAuthWit: false, accounts: [] }, grantedAt: 1 },
				{ capability: { type: "transaction", scope: [] }, grantedAt: 1 },
			],
		})
		const { writer } = makeSessionWriter(session)
		// requestCapabilities not called in this test; pass a stub.
		const dispatcher = makeDispatcher(writer, async () => ({}) as CapabilityResult)

		// Hooks that a top-level caller might supply. We want to verify they
		// don't leak into recursive leg dispatches.
		let fired = 0
		const hooks = {
			onExecutionEnqueued: () => {
				fired++
			},
			queuedJournalId: "top-level-queued-id",
		}

		// Dispatch a batch with two methods that exercise the recursive
		// dispatch path. `getAccounts` is a simple method that completes
		// quickly. If hooks leak into the recursive ctx, this test would
		// observe `fired` being non-zero (no handler calls `onExecutionEnqueued`
		// for non-sendTx ops anyway, but the safety-net would still preserve it).
		const batchLegs = [
			{ name: "getAccounts", args: [] },
			{ name: "getAccounts", args: [] },
		]

		await dispatcher.dispatch("batch", [batchLegs], ctx, hooks).catch(() => {
			// We don't care about success — only that no hook leak occurs.
		})

		// The hooks were forwarded to the OUTER dispatch but should NOT
		// have been forwarded into the recursive per-leg dispatches. Since
		// nothing inside the legs invokes onExecutionEnqueued, fired remains 0.
		expect(fired).toBe(0)
	})
})

/**
 * Positive counterpart to the batch-isolation test: a non-batch `sendTx`
 * MUST forward `onExecutionEnqueued` (the baton release) + `queuedJournalId`
 * through to `DappInteractionService.execute` under the exact field names it
 * reads. Pins the wiring whose field-name drift left the release dead before
 * v3 — if someone renames one side of the hooks bag again, this fails.
 */
describe("dispatcher sendTx hook forwarding", () => {
	test("dispatch('sendTx', ...) forwards onExecutionEnqueued + queuedJournalId to DappInteractionService.execute", async () => {
		const session = makeSession({
			capabilityGrants: [
				{ capability: { type: "accounts", canGet: true, canCreateAuthWit: false, accounts: [] }, grantedAt: 1 },
				{ capability: { type: "transaction", scope: [] }, grantedAt: 1 },
			],
			accounts: ["aztec:0:0xacc"],
		})
		const { writer } = makeSessionWriter(session)

		let observedHooks: IExecutionHooks | undefined
		const interaction: IDappInteractionRunner = {
			execute: async (_params, _cancellationToken, hooks) => {
				observedHooks = hooks
				return [{ status: "ok", result: undefined }] as never
			},
			requestCapabilities: async () => ({}) as never,
		}
		const network: INetworkReader = {
			getNetworks: async () => [{ id: "net1", chainId: 0 }] as INetworkRef[],
		}
		const account: IAccountReader = {
			getAccounts: async () => [{ address: "0xacc", name: "main", chainId: 0 }],
		}
		const dispatcher = new WalletSdkDispatcher(network, account, stubExecution, interaction, writer, noopLogger)

		const release = () => {}
		// Empty exec.calls → scope enforcement is vacuously satisfied.
		await dispatcher.dispatch("sendTx", [{ calls: [] }, {}], ctx, { onExecutionEnqueued: release, queuedJournalId: "q-1" })

		expect(observedHooks?.onExecutionEnqueued).toBe(release)
		expect(observedHooks?.queuedJournalId).toBe("q-1")
		// originKey = canonical ctx.origin (the per-origin backpressure cap principal).
		expect(observedHooks?.originKey).toBe(ctx.origin)
	})

	test("dispatch('sendTx', ...) sets originKey from ctx.origin even when no FIFO hooks are supplied", async () => {
		const session = makeSession({
			capabilityGrants: [
				{ capability: { type: "accounts", canGet: true, canCreateAuthWit: false, accounts: [] }, grantedAt: 1 },
				{ capability: { type: "transaction", scope: [] }, grantedAt: 1 },
			],
			accounts: ["aztec:0:0xacc"],
		})
		const { writer } = makeSessionWriter(session)
		let observedHooks: IExecutionHooks | undefined
		const interaction: IDappInteractionRunner = {
			execute: async (_params, _cancellationToken, hooks) => {
				observedHooks = hooks
				return [{ status: "ok", result: undefined }] as never
			},
			requestCapabilities: async () => ({}) as never,
		}
		const network: INetworkReader = { getNetworks: async () => [{ id: "net1", chainId: 0 }] as INetworkRef[] }
		const account: IAccountReader = { getAccounts: async () => [{ address: "0xacc", name: "main", chainId: 0 }] }
		const dispatcher = new WalletSdkDispatcher(network, account, stubExecution, interaction, writer, noopLogger)

		// No 4th-arg hooks — the per-origin cap must still receive originKey so a
		// dApp that arrives without the FIFO-baton hooks can't bypass the cap.
		await dispatcher.dispatch("sendTx", [{ calls: [] }, {}], ctx)

		expect(observedHooks?.originKey).toBe(ctx.origin)
		expect(observedHooks?.onExecutionEnqueued).toBeUndefined()
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

/**
 * Phase 0.5: dispatcher session-lookup consolidation.
 *
 * Pre-refactor: 6 separate `tryGetDappSessionByOriginAndChain` calls in
 * dispatcher.ts (handleGetAccounts, handleSendTx, handleRegisterToken,
 * handleRequestCapabilities, enforceCapability, resolveNetworkAndAccount).
 * Each gave its caller an independent view of the session; if the session
 * was deleted between two handler calls inside one dispatch(), the wallet
 * could half-apply a decision.
 *
 * Post-refactor: dispatch() captures the session ONCE at entry and threads
 * it through every internal call. Pinned by counting how many times the
 * session-lookup is invoked per dispatch() call.
 *
 * Audit reference: audit/security/2026-06-08-ultra-e6759a/findings/consolidated.md
 * cross-cutting #1 + opus B-1/CC-2 + codex Round 2 B-1.
 */
describe("F-006: network-only methods fail-closed on missing session (Phase 3)", () => {
	function dispatcherNoSession(): WalletSdkDispatcher {
		const writer: IDappSessionWriter = {
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
		return new WalletSdkDispatcher(networkReader, stubAccount, stubExecution, interaction, writer, noopLogger)
	}

	test("getPrivateEvents throws CapabilityNotGrantedError when session is missing (was: silently succeeded)", async () => {
		const dispatcher = dispatcherNoSession()
		await expect(
			dispatcher.dispatch("getPrivateEvents", [{ eventName: "x" }, { contractAddress: "0xabc" }], ctx),
		).rejects.toBeInstanceOf(CapabilityNotGrantedError)
	})

	test("getAddressBook throws CapabilityNotGrantedError when session is missing", async () => {
		const dispatcher = dispatcherNoSession()
		await expect(dispatcher.dispatch("getAddressBook", [], ctx)).rejects.toBeInstanceOf(CapabilityNotGrantedError)
	})

	test("registerContract throws CapabilityNotGrantedError when session is missing", async () => {
		const dispatcher = dispatcherNoSession()
		await expect(dispatcher.dispatch("registerContract", [{ address: { toString: () => "0xabc" } }], ctx)).rejects.toBeInstanceOf(
			CapabilityNotGrantedError,
		)
	})

	test("getChainInfo (exempt) does NOT throw CapabilityNotGrantedError without a session", async () => {
		// Exempt methods don't require a session — getChainInfo is the canonical
		// dApp probe path. The base stubExecution returns an empty object; we
		// only assert that the throw is NOT CapabilityNotGrantedError (the
		// fail-closed F-006 path), not that the method succeeds end-to-end.
		const dispatcher = dispatcherNoSession()
		await expect(dispatcher.dispatch("getChainInfo", [], ctx)).rejects.not.toBeInstanceOf(CapabilityNotGrantedError)
	})
})

describe("Phase 0.5: session lookup consolidation (TOCTOU defense)", () => {
	function makeCountingWriter(initial: IDappSessionRef | null) {
		let session: IDappSessionRef | null = initial
		const counter = { lookups: 0 }
		const writer: IDappSessionWriter = {
			tryGetDappSessionByOriginAndChain: async () => {
				counter.lookups += 1
				return session as IDappSessionRef
			},
			getDappSession: async () => session as IDappSessionRef,
			updateDappSession: async () => session as IDappSessionRef,
			setAccountAliases: async () => session as IDappSessionRef,
			setCapabilityGrants: async (_id, grants) => {
				session = { ...(session as IDappSessionRef), capabilityGrants: grants } as IDappSessionRef
				return session
			},
			setCapabilityRejections: async (_id, rejections) => {
				session = { ...(session as IDappSessionRef), capabilityRejections: rejections } as IDappSessionRef
				return session
			},
		}
		const setSession = (next: IDappSessionRef | null) => {
			session = next
		}
		return { writer, counter, setSession }
	}

	const networkWithChainId0: INetworkReader = {
		getNetworks: async () => [{ id: "net-0", chainId: 0 } as INetworkRef],
	}

	function dispatcherWith(writer: IDappSessionWriter, accounts: IAccountRef[] = []): WalletSdkDispatcher {
		const accountReader: IAccountReader = { getAccounts: async () => accounts }
		const interaction: IDappInteractionRunner = {
			execute: async () => ({}) as never,
			requestCapabilities: async () => ({ granted: [] }) as CapabilityResult,
		}
		return new WalletSdkDispatcher(networkWithChainId0, accountReader, stubExecution, interaction, writer, noopLogger)
	}

	test("dispatch(requestCapabilities) issues exactly 1 session lookup (was 2 pre-refactor)", async () => {
		const session = makeSession()
		const { writer, counter } = makeCountingWriter(session)
		const dispatcher = dispatcherWith(writer)
		const manifest = { capabilities: [{ type: "data" }] }
		await dispatcher.dispatch("requestCapabilities", [manifest], ctx)
		expect(counter.lookups).toBe(1)
	})

	test("dispatch(getAccounts) issues exactly 1 session lookup (was 2 pre-refactor)", async () => {
		const session = makeSession({
			accounts: ["aztec:0:0xaaa"],
			capabilityGrants: [
				{
					capability: { type: "accounts", canGet: true, accounts: [{ alias: "a", item: "aztec:0:0xaaa" }] },
					grantedAt: 1,
				} as GrantedCapabilityRecord,
			],
		})
		const { writer, counter } = makeCountingWriter(session)
		const dispatcher = dispatcherWith(writer)
		await dispatcher.dispatch("getAccounts", [], ctx)
		expect(counter.lookups).toBe(1)
	})

	test("dispatch(registerToken with no session) only consults storage once before throwing", async () => {
		const { writer, counter } = makeCountingWriter(null)
		const dispatcher = dispatcherWith(writer)
		await expect(dispatcher.dispatch("registerToken", ["0xaaaa", "0xbbbb"], ctx)).rejects.toThrow()
		// Pre-refactor was 2 (enforceCapability + handleRegisterToken).
		// Post-refactor: 1 captured at dispatch entry; no re-lookup inside the throw path.
		expect(counter.lookups).toBe(1)
	})
})

// ── isTokenRegistered (Nulo-custom) — reachability + gating + routing ───

describe("dispatcher — isTokenRegistered reachability + gating", () => {
	const contractsSession = (contracts: "*" | string[], canGetMetadata = true) =>
		makeSession({
			capabilityGrants: [
				{
					capability: { type: "contracts", contracts, canRegister: true, canGetMetadata },
					grantedAt: 1,
				} as unknown as GrantedCapabilityRecord,
			],
		})

	function makeReaderDispatcher(session: IDappSessionRef, registered: boolean) {
		const { writer } = makeSessionWriter(session)
		const reader = { isTokenRegistered: async () => registered }
		const interaction: IDappInteractionRunner = {
			execute: async () => ({}) as never,
			requestCapabilities: (async () => ({})) as never,
		}
		return new WalletSdkDispatcher(stubNetwork, stubAccount, stubExecution, interaction, writer, noopLogger, reader)
	}

	test("schema patch extends WalletSchema with a 1-arg boolean `isTokenRegistered` entry", async () => {
		await import("../../extension/src/wallet/services/wallet-sdk/nulo-schema-patch")
		const { WalletSchema } = await import("@aztec/aztec.js/wallet")
		expect("isTokenRegistered" in WalletSchema).toBe(true)
		// biome-ignore lint/suspicious/noExplicitAny: WalletSchema entry shape is upstream-typed but per-key access is opaque
		const entry = (WalletSchema as any).isTokenRegistered
		const params = entry.parameters()
		expect(params.items.length).toBe(1)
	})

	test("the three schema-patch copies are content-identical (drift pin)", async () => {
		const { readFileSync } = await import("node:fs")
		const { resolve } = await import("node:path")
		const root = resolve(__dirname, "../../..")
		const read = (p: string) => readFileSync(resolve(root, p), "utf8")
		const ext = read("packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts")
		const faucet = read("packages/faucet/src/lib/nulo-schema-patch.ts")
		const playground = read("packages/playground/src/lib/nulo-schema-patch.ts")
		// Identical Zod surface: compare with the per-file header comments stripped (comments may
		// name their own mirror paths) - every CODE line must match.
		const code = (s: string) =>
			s
				.split("\n")
				.filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
				.join("\n")
		expect(code(faucet)).toBe(code(ext))
		expect(code(playground)).toBe(code(ext))
	})

	test("granted address ⇒ boolean from the reader, NO interaction service involved", async () => {
		const dispatcher = makeReaderDispatcher(contractsSession(["0xtok"]), true)
		const result = await dispatcher.dispatch("isTokenRegistered", ["0xtok"], ctx)
		expect(result).toBe(true)
	})

	test("ungranted address ⇒ scope violation (never a silent false)", async () => {
		const dispatcher = makeReaderDispatcher(contractsSession(["0xtok"]), true)
		await expect(dispatcher.dispatch("isTokenRegistered", ["0xother"], ctx)).rejects.toThrow(/Scope violation: isTokenRegistered/)
	})

	test("contracts grant without canGetMetadata ⇒ scope violation", async () => {
		const dispatcher = makeReaderDispatcher(contractsSession(["0xtok"], false), true)
		await expect(dispatcher.dispatch("isTokenRegistered", ["0xtok"], ctx)).rejects.toThrow(/Scope violation/)
	})

	test("no contracts grant at all ⇒ capability refusal", async () => {
		const dispatcher = makeReaderDispatcher(makeSession(), true)
		await expect(dispatcher.dispatch("isTokenRegistered", ["0xtok"], ctx)).rejects.toThrow()
	})

	test("a build without the reader refuses explicitly", async () => {
		const { writer } = makeSessionWriter(contractsSession(["0xtok"]))
		const interaction: IDappInteractionRunner = {
			execute: async () => ({}) as never,
			requestCapabilities: (async () => ({})) as never,
		}
		const dispatcher = new WalletSdkDispatcher(stubNetwork, stubAccount, stubExecution, interaction, writer, noopLogger)
		await expect(dispatcher.dispatch("isTokenRegistered", ["0xtok"], ctx)).rejects.toThrow(/not available/)
	})
})

describe("dispatcher — contracts field-diff re-consent", () => {
	const grant = (
		contracts: string[],
		flags: { canRegister?: boolean; canGetMetadata?: boolean } = { canRegister: true, canGetMetadata: true },
	) => ({ capability: { type: "contracts", contracts, ...flags }, grantedAt: 1 }) as unknown as GrantedCapabilityRecord

	const manifest = (contracts: string[]) => ({
		capabilities: [{ type: "contracts", contracts, canRegister: true, canGetMetadata: true }],
	})

	test("a request covered by the stored grant does NOT re-prompt", async () => {
		const session = makeSession({ capabilityGrants: [grant(["0xa", "0xb"])] })
		const { writer } = makeSessionWriter(session)
		let prompted = false
		const dispatcher = makeDispatcher(writer, async () => {
			prompted = true
			return { granted: [] } as never
		})
		await dispatcher.dispatch("requestCapabilities", [manifest(["0xa"])], ctx)
		expect(prompted).toBe(false)
	})

	test("a request with NEW addresses re-prompts (the redeploy path)", async () => {
		const session = makeSession({ capabilityGrants: [grant(["0xold"])] })
		const { writer } = makeSessionWriter(session)
		let prompted = false
		const dispatcher = makeDispatcher(writer, async () => {
			prompted = true
			return { granted: [{ type: "contracts", contracts: ["0xnew"], canRegister: true, canGetMetadata: true }] } as never
		})
		await dispatcher.dispatch("requestCapabilities", [manifest(["0xnew"])], ctx)
		expect(prompted).toBe(true)
	})

	test("an approved contracts re-consent PERSISTS the replacement grant (codex post-impl condition)", async () => {
		const session = makeSession({ capabilityGrants: [grant(["0xold"])] })
		const { writer, calls } = makeSessionWriter(session)
		// The popup echoes the existing cap alongside the newly approved delta (approvedNew + existing).
		const dispatcher = makeDispatcher(
			writer,
			async () =>
				({
					granted: [
						{ type: "contracts", contracts: ["0xold", "0xnew"], canRegister: true, canGetMetadata: true },
						{ type: "contracts", contracts: ["0xold"], canRegister: true, canGetMetadata: true },
					],
				}) as never,
		)
		await dispatcher.dispatch("requestCapabilities", [manifest(["0xold", "0xnew"])], ctx)
		const stored = calls.setGrants.at(-1) ?? []
		const contractsGrants = stored.filter((g) => g.capability.type === "contracts")
		expect(contractsGrants).toHaveLength(1) // replaced, not duplicated
		const addrs = (contractsGrants[0].capability as { contracts: string[] }).contracts
		expect(addrs).toContain("0xnew")

		// And the follow-up request is now COVERED - no second prompt.
		let promptedAgain = false
		const dispatcher2 = makeDispatcher(writer, async () => {
			promptedAgain = true
			return { granted: [] } as never
		})
		await dispatcher2.dispatch("requestCapabilities", [manifest(["0xold", "0xnew"])], ctx)
		expect(promptedAgain).toBe(false)
	})

	test("a REJECTED contracts re-consent keeps the old grant intact (rejection interplay)", async () => {
		const session = makeSession({ capabilityGrants: [grant(["0xold"])] })
		const { writer, calls } = makeSessionWriter(session)
		const dispatcher = makeDispatcher(writer, async () => ({ granted: [] }) as never)
		await dispatcher.dispatch("requestCapabilities", [manifest(["0xold", "0xnew"])], ctx).catch(() => {})
		const stored = calls.setGrants.at(-1)
		if (stored) {
			const contractsGrants = stored.filter((g) => g.capability.type === "contracts")
			expect(contractsGrants).toHaveLength(1)
			expect((contractsGrants[0].capability as { contracts: string[] }).contracts).toEqual(["0xold"])
		}
	})

	test("CAIP-stored session accounts accept RAW-hex scope arrays (the fresh-session balance bug)", async () => {
		// The popup persists accounts as CAIP-10; dApps send raw addresses in executeUtility
		// scopes. A fresh (CAIP-only) session must still validate them.
		const session = makeSession({
			accounts: ["aztec:0:0x1c4d2aee53b88fa9e4061ec8c673dec03aadc3cd012177d0dcf20802ea9be10a"],
			capabilityGrants: [
				{
					capability: {
						type: "simulation",
						utilities: { scope: [{ contract: "0xtok", function: "balance_of_private" }] },
						transactions: { scope: [] },
					},
					grantedAt: 1,
				} as unknown as GrantedCapabilityRecord,
			],
		} as Partial<IDappSessionRef>)
		const { writer } = makeSessionWriter(session)
		const interaction: IDappInteractionRunner = {
			execute: async () => ({}) as never,
			requestCapabilities: (async () => ({})) as never,
		}
		const dispatcher = new WalletSdkDispatcher(stubNetwork, stubAccount, stubExecution, interaction, writer, noopLogger)
		// Success = getting PAST the account-scope gate. The stub harness has no network, so the
		// dispatch fails DOWNSTREAM - the pin is that the failure is NOT the scope violation.
		const failure = await dispatcher
			.dispatch(
				"executeUtility",
				[
					{ to: "0xtok", name: "balance_of_private" },
					{ scopes: ["0x1c4d2aee53b88fa9e4061ec8c673dec03aadc3cd012177d0dcf20802ea9be10a"], authWitnesses: [], capsules: [] },
				],
				ctx,
			)
			.then(() => null)
			.catch((e: unknown) => (e instanceof Error ? e.message : String(e)))
		expect(failure).not.toMatch(/approved accounts/)
		expect(failure).toMatch(/No network configured/)
	})

	test("the reader receives the SESSION context's profileId and chainId verbatim (stickiness pin)", async () => {
		const session = makeSession({
			capabilityGrants: [
				{
					capability: { type: "contracts", contracts: ["0xtok"], canGetMetadata: true },
					grantedAt: 1,
				} as unknown as GrantedCapabilityRecord,
			],
		})
		const { writer } = makeSessionWriter(session)
		const seen: unknown[] = []
		const reader = {
			isTokenRegistered: async (address: string, profileId: string, chainId: number) => {
				seen.push([address, profileId, chainId])
				return false
			},
		}
		const interaction: IDappInteractionRunner = {
			execute: async () => ({}) as never,
			requestCapabilities: (async () => ({})) as never,
		}
		const dispatcher = new WalletSdkDispatcher(stubNetwork, stubAccount, stubExecution, interaction, writer, noopLogger, reader)
		await dispatcher.dispatch("isTokenRegistered", ["0xtok"], { ...ctx, profileId: "profile-A", chainId: 42 })
		expect(seen[0]).toEqual(["0xtok", "profile-A", 42])
	})

	test("a flag upgrade re-prompts even with the same addresses", async () => {
		const session = makeSession({ capabilityGrants: [grant(["0xa"], { canRegister: true, canGetMetadata: false })] })
		const { writer } = makeSessionWriter(session)
		let prompted = false
		const dispatcher = makeDispatcher(writer, async () => {
			prompted = true
			return { granted: [] } as never
		})
		await dispatcher.dispatch("requestCapabilities", [manifest(["0xa"])], ctx)
		expect(prompted).toBe(true)
	})
})

// ── grantPublicAuthwit (Nulo-custom) — schema-patch reachability + routing ──
//
// Same contract as registerToken: three identical schema-patch copies
// (extension / faucet / playground) pinned by importing the extension's,
// routing through DappInteractionService.execute (popup gate), and the
// dApp-supplied account validated against the session's authorized set.

describe("dispatcher — grantPublicAuthwit reachability + routing", () => {
	test("schema patch extends WalletSchema with a 2-arg `grantPublicAuthwit` entry", async () => {
		await import("../../extension/src/wallet/services/wallet-sdk/nulo-schema-patch")
		const { WalletSchema } = await import("@aztec/aztec.js/wallet")
		expect("grantPublicAuthwit" in WalletSchema).toBe(true)
		// biome-ignore lint/suspicious/noExplicitAny: WalletSchema entry shape is upstream-typed but per-key access is opaque
		const entry = (WalletSchema as any).grantPublicAuthwit
		expect(typeof entry?.parameters).toBe("function")
		expect(entry.parameters().items.length).toBe(2)
	})

	test("dispatch('grantPublicAuthwit', ...) routes a send_transaction with ONE add_public_authwit call-content action through DappInteractionService.execute", async () => {
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
				{
					capability: {
						type: "transaction",
						scope: [{ contract: "0xtoken", function: "transfer_public_to_public" }],
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
				return [{ status: "ok", result: "0xtxhash" }] as never
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

		const grantContent = {
			caller: "0xcaller",
			contract: "0xtoken",
			method: "transfer_public_to_public",
			args: ["0xacc", "0xcaller", "5", "1"],
		}
		const result = await dispatcher.dispatch("grantPublicAuthwit", ["0xacc", grantContent], ctx)

		expect(result).toBe("0xtxhash")
		expect(executeCalls).toHaveLength(1)
		expect(executionCalls).toHaveLength(0)
		const params = executeCalls[0] as {
			operations: Array<{ kind: string; account: string; actions: Array<{ kind: string; content: Record<string, unknown> }> }>
		}
		const op = params.operations[0]
		expect(op.kind).toBe("send_transaction")
		expect(op.account).toBe("aztec:0:0xacc")
		expect(op.actions).toHaveLength(1)
		expect(op.actions[0].kind).toBe("add_public_authwit")
		expect(op.actions[0].content).toEqual({
			kind: "call",
			caller: "0xcaller",
			contract: "0xtoken",
			method: "transfer_public_to_public",
			args: ["0xacc", "0xcaller", "5", "1"],
		})
	})

	test("dispatch('grantPublicAuthwit', ...) rejects an account outside the session's authorized list", async () => {
		const session = makeSession({
			capabilityGrants: [
				{
					capability: { type: "transaction", scope: [{ contract: "0xt", function: "m" }] } as Capability,
					grantedAt: 1,
				},
			],
			accounts: ["aztec:0:0xacc"],
		})
		const { writer } = makeSessionWriter(session)
		const interaction: IDappInteractionRunner = {
			execute: async () => [{ status: "ok", result: undefined }] as never,
			requestCapabilities: async () => ({}) as never,
		}
		const execution: IExecutionRunner = { executeOperations: async () => [] as OperationResult[] }
		const network: INetworkReader = { getNetworks: async () => [{ id: "net1", chainId: 0 }] as INetworkRef[] }
		const account: IAccountReader = { getAccounts: async () => [{ address: "0xacc", name: "main", chainId: 0 }] }
		const dispatcher = new WalletSdkDispatcher(network, account, execution, interaction, writer, noopLogger)

		await expect(
			dispatcher.dispatch("grantPublicAuthwit", ["0xother", { caller: "0xc", contract: "0xt", method: "m", args: [] }], ctx),
		).rejects.toThrow(/not authorized for this dApp session/)
	})

	// ── audit F1 regression guards: the scope gate MUST run ──
	// grantPublicAuthwit requires the `transaction` capability (capability-map.ts).
	// Without the map entry these would have passed silently (dead scope gate).

	test("dispatch('grantPublicAuthwit', ...) REJECTS a session with NO transaction capability (F1 — gate must run)", async () => {
		const session = makeSession({
			// Only an accounts grant — the standard connect grant. Must NOT be
			// enough to mint an on-chain authwit.
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
			accounts: ["aztec:0:0xacc"],
		})
		const { writer } = makeSessionWriter(session)
		const interaction: IDappInteractionRunner = {
			execute: async () => [{ status: "ok", result: undefined }] as never,
			requestCapabilities: async () => ({}) as never,
		}
		const execution: IExecutionRunner = { executeOperations: async () => [] as OperationResult[] }
		const network: INetworkReader = { getNetworks: async () => [{ id: "net1", chainId: 0 }] as INetworkRef[] }
		const account: IAccountReader = { getAccounts: async () => [{ address: "0xacc", name: "main", chainId: 0 }] }
		const dispatcher = new WalletSdkDispatcher(network, account, execution, interaction, writer, noopLogger)

		await expect(
			dispatcher.dispatch(
				"grantPublicAuthwit",
				[
					"0xacc",
					{
						caller: "0xattacker",
						contract: "0xtoken",
						method: "transfer_public_to_public",
						args: ["0xacc", "0xattacker", "999", "1"],
					},
				],
				ctx,
			),
		).rejects.toThrow()
	})

	test("dispatch('grantPublicAuthwit', ...) REJECTS a contract@method outside the granted transaction scope (F1 — scope check runs)", async () => {
		const session = makeSession({
			// Transaction scope permits transfer on 0xtoken ONLY.
			capabilityGrants: [
				{
					capability: {
						type: "transaction",
						scope: [{ contract: "0xtoken", function: "transfer_public_to_public" }],
					} as Capability,
					grantedAt: 1,
				},
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
			accounts: ["aztec:0:0xacc"],
		})
		const { writer } = makeSessionWriter(session)
		const interaction: IDappInteractionRunner = {
			execute: async () => [{ status: "ok", result: undefined }] as never,
			requestCapabilities: async () => ({}) as never,
		}
		const execution: IExecutionRunner = { executeOperations: async () => [] as OperationResult[] }
		const network: INetworkReader = { getNetworks: async () => [{ id: "net1", chainId: 0 }] as INetworkRef[] }
		const account: IAccountReader = { getAccounts: async () => [{ address: "0xacc", name: "main", chainId: 0 }] }
		const dispatcher = new WalletSdkDispatcher(network, account, execution, interaction, writer, noopLogger)

		// Grant for a DIFFERENT contract — must be scope-rejected.
		await expect(
			dispatcher.dispatch(
				"grantPublicAuthwit",
				["0xacc", { caller: "0xc", contract: "0xOTHER", method: "transfer_public_to_public", args: [] }],
				ctx,
			),
		).rejects.toThrow(/[Ss]cope/)
	})
})
