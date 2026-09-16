/**
 * Where a send's fence comes from at the facade: `executeOperations` refuses a
 * dApp batch that carries none, and `executeSendTransaction` captures one only
 * when its caller passed none — which no production caller does, because a
 * capture taken after any await can observe a session the user never acted in.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test, vi } from "vitest"
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
	const facade = Object.assign(Object.create(ExecutionService.prototype), {
		ensureInitialized: async () => {},
		planner: { extractPrimaryMethod: () => "m" },
		taskService: { startNewTask },
		profileService: { captureExecutionFence },
		dappSendExecutor: { executeSendTransaction },
		logDebug: () => {},
		logInfo: () => {},
		logError: () => {},
	}) as ExecutionService
	const sentUnder = () => executeSendTransaction.mock.calls[0]?.[3 as never]
	return { facade, captureExecutionFence, executeSendTransaction, startNewTask, sentUnder }
}

describe("ExecutionService: a send runs under the fence its caller authorized", () => {
	test("executeOperations: a dApp batch without a fence throws before any task, capture or dispatch", async () => {
		const { facade, captureExecutionFence, executeSendTransaction, startNewTask } = makeFacade()
		await expect(facade.executeOperations([SEND_OP], DAPP)).rejects.toThrow(
			"dApp operations require the fence of the session that authorized them",
		)
		expect(startNewTask).not.toHaveBeenCalled()
		expect(captureExecutionFence).not.toHaveBeenCalled()
		expect(executeSendTransaction).not.toHaveBeenCalled()
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
