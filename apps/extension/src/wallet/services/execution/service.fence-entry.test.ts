/**
 * Where a send's fence comes from at the facade: `executeOperations` refuses a
 * dApp send that carries none, and `executeSendTransaction` captures one only
 * when its caller passed none — which no production caller does, because a
 * capture taken after any await can observe a session the user never acted in.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test, vi } from "vitest"
import { SessionEndedError, TermsAcceptanceRequiredError } from "@nulo/extension-messaging/errors"
import { type LocalTxOrigin, OriginType } from "@/wallet/services/transaction/spec"
import { ExecutionService } from "./service"

const FENCE = { profileId: "p1", epoch: 0, session: 1 }
const LIVE = { profileId: "p1", epoch: 0, session: 2 }
const DAPP: LocalTxOrigin = { type: OriginType.DAPP, name: "dapp" }
const UI: LocalTxOrigin = { type: OriginType.UI }
const SEND_OP = {
	kind: "send_transaction",
	networkId: "net-1",
	accountAddress: "0xacct",
	feeSettings: { paymentMethod: { kind: "fj" } },
	actions: [],
} as never

/** The real facade methods on a bare prototype, over a capture that reports a later session. */
function makeFacade() {
	const task = { startSubtask: vi.fn(), complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
	const captureExecutionFence = vi.fn(async () => LIVE)
	const executeSendTransaction = vi.fn(async () => "0xhash")
	const startNewTask = vi.fn(() => task)
	const assertCurrent = vi.fn(async () => {})
	const facade = Object.assign(Object.create(ExecutionService.prototype), {
		ensureInitialized: async () => {},
		planner: { extractPrimaryMethod: () => "m" },
		taskService: { startNewTask },
		profileService: { captureExecutionFence },
		dappSendExecutor: { executeSendTransaction },
		legal: { assertCurrent },
		logDebug: () => {},
		logInfo: () => {},
		logError: () => {},
	}) as ExecutionService
	const sentUnder = () => executeSendTransaction.mock.calls[0]?.[3 as never]
	return { facade, captureExecutionFence, executeSendTransaction, startNewTask, sentUnder, assertCurrent }
}

describe("ExecutionService: no broadcasting entry point runs without a current Terms acceptance", () => {
	const refused = () => {
		const made = makeFacade()
		made.assertCurrent.mockRejectedValue(new TermsAcceptanceRequiredError())
		return made
	}

	test("executeSendTransaction refuses before a task exists or an executor is reached", async () => {
		const { facade, executeSendTransaction, startNewTask } = refused()
		await expect(facade.executeSendTransaction(SEND_OP, UI, undefined, undefined, FENCE)).rejects.toBeInstanceOf(
			TermsAcceptanceRequiredError,
		)
		expect(startNewTask).not.toHaveBeenCalled()
		expect(executeSendTransaction).not.toHaveBeenCalled()
	})

	test.each(["send_transaction", "aztec_sendTx"])("executeOperations refuses a batch holding a %s", async (kind) => {
		const { facade, executeSendTransaction, startNewTask } = refused()
		const batch = [
			{ kind: "aztec_getChainInfo", networkId: "net-1" },
			{ ...(SEND_OP as object), kind },
		] as never
		await expect(facade.executeOperations(batch, DAPP, undefined, undefined, undefined, FENCE)).rejects.toBeInstanceOf(
			TermsAcceptanceRequiredError,
		)
		expect(startNewTask).not.toHaveBeenCalled()
		expect(executeSendTransaction).not.toHaveBeenCalled()
	})

	test("executeOperations still serves the wallet's own reads: a batch that broadcasts nothing is not gated", async () => {
		const { facade, assertCurrent } = refused()
		Object.assign(facade, { dispatchOperation: vi.fn(async () => "done") })
		const batch = [{ kind: "aztec_simulateTx", networkId: "net-1", accountAddress: "0xacct" }] as never
		expect(await facade.executeOperations(batch, UI)).toEqual([{ status: "ok", result: "done" }])
		expect(assertCurrent).not.toHaveBeenCalled()
	})
})

describe("ExecutionService: a send runs under the fence its caller authorized", () => {
	test.each(["send_transaction", "aztec_sendTx", "register_token", "aztec_createAuthWit"])(
		"executeOperations: a dApp batch holding a %s without a fence throws before any task, capture or dispatch",
		async (kind) => {
			const { facade, captureExecutionFence, executeSendTransaction, startNewTask } = makeFacade()
			const batch = [
				{ kind: "aztec_getChainInfo", networkId: "net-1" },
				{ ...(SEND_OP as object), kind },
			] as never
			await expect(facade.executeOperations(batch, DAPP)).rejects.toThrow(
				"a dApp send requires the fence of the session that authorized it",
			)
			expect(startNewTask).not.toHaveBeenCalled()
			expect(captureExecutionFence).not.toHaveBeenCalled()
			expect(executeSendTransaction).not.toHaveBeenCalled()
		},
	)

	test("executeOperations: the wallet-sdk dispatcher's fence-less reads and registrations run", async () => {
		const { facade, captureExecutionFence } = makeFacade()
		const dispatchOperation = vi.fn(async () => "done")
		Object.assign(facade, { dispatchOperation })
		const batch = [
			{ kind: "aztec_registerContract", networkId: "net-1" },
			{ kind: "aztec_simulateTx", networkId: "net-1", accountAddress: "0xacct" },
		] as never
		const done = { status: "ok", result: "done" }
		expect(await facade.executeOperations(batch, DAPP)).toEqual([done, done])
		expect(dispatchOperation).toHaveBeenCalledTimes(2)
		expect(captureExecutionFence).not.toHaveBeenCalled()
	})

	test("executeOperations: a dApp createAuthWit dispatches under its forwarded fence, never a capture", async () => {
		const { facade, captureExecutionFence } = makeFacade()
		const executeAztecCreateAuthWit = vi.fn(async () => "0xwit")
		Object.assign(facade, { executeAztecCreateAuthWit })
		const authwit = { kind: "aztec_createAuthWit", networkId: "net-1", accountAddress: "0xacct" } as never
		expect(await facade.executeOperations([authwit], DAPP, undefined, undefined, undefined, FENCE)).toEqual([
			{ status: "ok", result: "0xwit" },
		])
		expect(executeAztecCreateAuthWit).toHaveBeenCalledWith(authwit, FENCE)
		expect(captureExecutionFence).not.toHaveBeenCalled()
	})

	test("executeOperations: a dApp batch sends under its fence; a UI batch without one captures at dispatch", async () => {
		const dapp = makeFacade()
		const ok = [{ status: "ok", result: "0xhash" }]
		expect(await dapp.facade.executeOperations([SEND_OP], DAPP, undefined, undefined, undefined, FENCE)).toEqual(ok)
		expect(dapp.captureExecutionFence).not.toHaveBeenCalled()
		expect(dapp.sentUnder()).toBe(FENCE)

		const ui = makeFacade()
		expect(await ui.facade.executeOperations([SEND_OP], UI)).toEqual(ok)
		expect(ui.captureExecutionFence).toHaveBeenCalledTimes(1)
		expect(ui.sentUnder()).toBe(LIVE)
	})

	test("executeSendTransaction captures only when no fence is passed", async () => {
		const bare = makeFacade()
		await bare.facade.executeSendTransaction(SEND_OP, UI)
		expect(bare.captureExecutionFence).toHaveBeenCalledTimes(1)
		expect(bare.sentUnder()).toBe(LIVE)

		const fenced = makeFacade()
		await fenced.facade.executeSendTransaction(SEND_OP, UI, undefined, undefined, FENCE)
		expect(fenced.captureExecutionFence).not.toHaveBeenCalled()
		expect(fenced.sentUnder()).toBe(FENCE)
	})
})

/** The real authwit arm on a bare prototype; the hash resolution is stubbed so only the account
 *  lookup, the fence gate and the sign remain. */
function makeAuthWitFacade() {
	const createAuthWit = vi.fn(async () => "0xwit")
	const getAccountContract = vi.fn(async () => ({ createAuthWit }))
	const assertFence = vi.fn(async () => {})
	const isFenceLive = vi.fn(() => true)
	const captureExecutionFence = vi.fn(async () => LIVE)
	const facade = Object.assign(Object.create(ExecutionService.prototype), {
		networkService: { getNetwork: async () => ({ id: "net-1", chainId: 7 }) },
		accountService: { getAccountContract },
		profileService: { assertFence, isFenceLive, captureExecutionFence },
		resolveAuthWitMessageHash: async () => "0xhash",
	}) as ExecutionService
	return { facade, createAuthWit, getAccountContract, assertFence, isFenceLive, captureExecutionFence }
}

const AUTHWIT_OP = { kind: "aztec_createAuthWit", networkId: "net-1", accountAddress: "0xacct", messageHashOrIntent: "0x01" } as never

describe("ExecutionService.executeAztecCreateAuthWit: the sign runs under the fence", () => {
	test("resolves the account from the fence's profile and signs once both checks pass", async () => {
		const { facade, createAuthWit, getAccountContract, assertFence, isFenceLive, captureExecutionFence } = makeAuthWitFacade()
		expect(await facade.executeAztecCreateAuthWit(AUTHWIT_OP, FENCE)).toBe("0xwit")
		expect(getAccountContract).toHaveBeenCalledWith("p1", 7, "0xacct")
		expect(captureExecutionFence).not.toHaveBeenCalled()
		expect(assertFence).toHaveBeenCalledWith(FENCE)
		expect(isFenceLive).toHaveBeenCalledWith(FENCE)
		expect(createAuthWit).toHaveBeenCalledTimes(1)
	})

	test("a session end caught by the awaited assert never signs", async () => {
		const { facade, createAuthWit, assertFence } = makeAuthWitFacade()
		assertFence.mockRejectedValueOnce(new SessionEndedError())
		await expect(facade.executeAztecCreateAuthWit(AUTHWIT_OP, FENCE)).rejects.toBeInstanceOf(SessionEndedError)
		expect(createAuthWit).not.toHaveBeenCalled()
	})

	test("a session end landing after the assert released the lock is caught by the synchronous check", async () => {
		const { facade, createAuthWit, assertFence, isFenceLive } = makeAuthWitFacade()
		isFenceLive.mockReturnValueOnce(false)
		await expect(facade.executeAztecCreateAuthWit(AUTHWIT_OP, FENCE)).rejects.toBeInstanceOf(SessionEndedError)
		expect(assertFence).toHaveBeenCalledTimes(1)
		expect(createAuthWit).not.toHaveBeenCalled()
	})

	test("a UI-origin authwit with no fence captures its own", async () => {
		const { facade, assertFence, captureExecutionFence } = makeAuthWitFacade()
		await facade.executeAztecCreateAuthWit(AUTHWIT_OP)
		expect(captureExecutionFence).toHaveBeenCalledTimes(1)
		expect(assertFence).toHaveBeenCalledWith(LIVE)
	})
})

const SRC = join(__dirname, "..", "..", "..")
const OPENERS = new Set(["(", "[", "{"])
const CLOSERS = new Set([")", "]", "}"])
const QUOTES = new Set(['"', "'", "`"])

function productionSources(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name)
		if (statSync(path).isDirectory()) return productionSources(path)
		return /\.(ts|vue)$/.test(name) && !name.endsWith(".test.ts") ? [path] : []
	})
}

/** The top-level argument texts of the call whose `(` sits at `open`; string contents are skipped. */
function callArguments(source: string, open: number): string[] {
	const parts: string[] = []
	let depth = 0
	let start = open + 1
	for (let i = open; i < source.length; i++) {
		const ch = source[i] as string
		if (QUOTES.has(ch)) {
			i = source.indexOf(ch, i + 1)
			continue
		}
		if (OPENERS.has(ch)) depth++
		if (CLOSERS.has(ch)) depth--
		if (depth === 0) return [...parts, source.slice(start, i)].map((part) => part.trim()).filter(Boolean)
		if (ch === "," && depth === 1) {
			parts.push(source.slice(start, i))
			start = i + 1
		}
	}
	throw new Error(`unbalanced call at offset ${open}`)
}

/** Whether the nearest declaration of `name` before `offset` admits an absent value; an
 *  expression or an undeclared name counts as possibly absent. */
function mayBeAbsent(source: string, name: string, offset: number): boolean {
	if (!/^\w+$/.test(name) || name === "undefined") return true
	const declaration = new RegExp(`\\b(?:const|let)\\s+${name}\\b|\\b${name}(\\?)?:\\s*([^,)=;]*)`, "g")
	const nearest = [...source.slice(0, offset).matchAll(declaration)].at(-1)
	if (!nearest) return true
	return nearest[1] === "?" || /\|\s*undefined/.test(nearest[2] ?? "")
}

test("no production caller relies on that capture: every facade call passes a fence", () => {
	const calls: { site: string; args: string[]; absent: boolean }[] = []
	for (const file of productionSources(SRC)) {
		const source = readFileSync(file, "utf8")
		for (const match of source.matchAll(/(\w+)\.executeSendTransaction\(/g)) {
			// The executor's own method takes the fence as a required parameter.
			if (match[1] === "dappSendExecutor") continue
			const open = (match.index ?? 0) + match[0].length - 1
			const args = callArguments(source, open)
			calls.push({ site: `${relative(SRC, file)}@${open}`, args, absent: mayBeAbsent(source, args[4] ?? "undefined", open) })
		}
	}
	// The dispatch arm and the two registry sends, at least.
	expect(calls.length).toBeGreaterThanOrEqual(3)
	for (const { site, args, absent } of calls) {
		expect(args, site).toHaveLength(5)
		expect(absent, `${site}: the fence argument may be undefined`).toBe(false)
	}
})
