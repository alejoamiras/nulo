/**
 * Characterization of the dApp consent path through the public dispatcher: grant coverage against
 * enforcement, the batch refusal set and its order, and the sender a request names. Every value is
 * wire-shaped, and every refusal pins its exact class and message, since dApps and the activity
 * feed both see them.
 */
import { beforeAll, describe, expect, test } from "vitest"
import { Fr } from "@aztec-labs/foundation/curves/bn254"
import { ScopeViolationError, UnsupportedMethodError, UserRejectedError, ValidationError } from "@nulo/extension-messaging/errors"
import type { ILogger } from "@nulo/wallet-core/logger"
import { WalletSdkDispatcher } from "./dispatcher"
import { METHOD_REGISTRY } from "./method-descriptors"
import type { Operation } from "./operation"
import type { IAccountProvisioner, IAccountReader, IDappInteractionRunner, IDappSessionWriter, IExecutionRunner } from "./services-contract"
import type { IDappSessionRef } from "./session-types"

const hex = (byte: string) => `0x${byte.repeat(32)}`
const TOKEN = hex("0d")
const TOKEN_UP = `0x${TOKEN.slice(2).toUpperCase()}`
const OTHER = hex("0e")
const MALFORMED = "0x1234"
const ACC1 = new Fr(1n).toString()
const ACC2 = new Fr(0xabcdefn).toString()
const ACC2_UP = `0x${ACC2.slice(2).toUpperCase()}`
const STRANGER = new Fr(3n).toString()

const ctx = {
	chainId: 0,
	profileId: "profile-1",
	origin: "https://dapp.example",
	sessionId: "wire-session",
	fence: { profileId: "profile-1", epoch: 0, session: 1 },
}
const noopLogger: ILogger = { log: () => {} }

// __VERSION__ is a build-time define; the answer to requestCapabilities reads it.
beforeAll(() => {
	;(globalThis as { __VERSION__?: string }).__VERSION__ = "test"
})

type Sent = { kind?: string; account?: string; executionMode?: string; opts?: { from?: unknown } }
type Seen = { windows: number; sent: Sent[]; executed: Operation[] }

/** A session listing ACC2 before ACC1, over a wallet ordered [ACC1, ACC2, STRANGER]. Windows are
 *  declined, so an uncovered request rejects with `UserRejectedError` after one window. */
function harness(grants: unknown[]) {
	const session = {
		id: "row-1",
		chainId: "0",
		origin: ctx.origin,
		permissions: [],
		accounts: [`aztec:0:${ACC2}`, `aztec:0:${ACC1}`],
		confirmationLevel: 5,
		capabilityGrants: grants.map((capability) => ({ capability, grantedAt: 1 })),
		capabilityRejections: [],
	} as unknown as IDappSessionRef
	const seen: Seen = { windows: 0, sent: [], executed: [] }
	const writer: IDappSessionWriter = {
		tryGetDappSessionByOriginAndChain: async () => session,
		getDappSession: async () => session,
		updateDappSession: async () => session,
		setAccountAliases: async () => session,
		setCapabilityGrants: async () => session,
		setCapabilityRejections: async () => session,
		applyCapabilityDecision: async () => session,
	}
	const interaction: IDappInteractionRunner = {
		execute: async (params) => {
			seen.sent.push(...(params.operations as Sent[]))
			return [{ status: "ok", result: "0xsent" }] as never
		},
		requestCapabilities: async () => {
			seen.windows++
			throw new UserRejectedError("declined")
		},
	}
	const execution: IExecutionRunner = {
		executeOperations: async (ops) => {
			seen.executed.push(...ops)
			return [{ status: "ok", result: "0xran" }]
		},
	}
	const accounts: IAccountReader & IAccountProvisioner = {
		provisionDefaultAccount: async () => {},
		getAccounts: async () => [ACC1, ACC2, STRANGER].map((address, i) => ({ address, name: `Account ${i}`, chainId: 0 })),
	}
	const network = { getNetworksRaw: async () => [{ id: "net-0", chainId: 0 }] }
	const dispatcher = new WalletSdkDispatcher(network, accounts, execution, interaction, writer, noopLogger)
	return { seen, dispatch: (method: string, args: unknown[]) => dispatcher.dispatch(method, args, ctx) }
}

type Outcome = { ok: unknown } | { threw: unknown; message: string }

async function outcome(pending: Promise<unknown>): Promise<Outcome> {
	try {
		return { ok: await pending }
	} catch (error) {
		return { threw: (error as Error).constructor, message: (error as Error).message }
	}
}

/** The engine's own wording for what `run` throws. A malformed stored element throws inside a
 *  coverage or checker expression and some engines name the variable that held it, so a caller
 *  binds the same name the production expression uses. */
function thrownBy(run: () => unknown): { threw: unknown; message: string } {
	try {
		run()
	} catch (error) {
		return { threw: (error as Error).constructor, message: (error as Error).message }
	}
	throw new Error("the reference did not throw")
}

/** "covered" when the request answers with no window, "window" when one opened, else the throw. */
async function coverage(grant: unknown, requested: unknown): Promise<unknown> {
	const h = harness([grant])
	const result = await outcome(h.dispatch("requestCapabilities", [{ capabilities: [requested] }]))
	if ("ok" in result) return h.seen.windows === 0 ? "covered" : result
	if (result.threw === UserRejectedError && h.seen.windows === 1) return "window"
	return result
}

/** "allowed" when the call reached the runner, else the throw. */
async function enforcement(grant: unknown, method: string, args: unknown[]): Promise<unknown> {
	const h = harness([grant])
	const result = await outcome(h.dispatch(method, args))
	if ("ok" in result) return h.seen.sent.length + h.seen.executed.length === 1 ? "allowed" : result
	return result
}

const refused = (message: string) => ({ threw: ScopeViolationError, message })
const sendTxRefused = refused("Scope violation: sendTx call not permitted by granted transaction scope")

describe("grant coverage agrees with enforcement", () => {
	const scopeRows: Array<[string, unknown, { contract: string; function: string }, boolean]> = [
		["exact match", [{ contract: TOKEN, function: "transfer" }], { contract: TOKEN, function: "transfer" }, true],
		["case-changed address", [{ contract: TOKEN_UP, function: "transfer" }], { contract: TOKEN, function: "transfer" }, true],
		["other address", [{ contract: TOKEN, function: "transfer" }], { contract: OTHER, function: "transfer" }, false],
		["wildcard function", [{ contract: TOKEN, function: "*" }], { contract: TOKEN, function: "mint" }, true],
		["wildcard contract", [{ contract: "*", function: "transfer" }], { contract: OTHER, function: "transfer" }, true],
		["function mismatch", [{ contract: TOKEN, function: "transfer" }], { contract: TOKEN, function: "mint" }, false],
		["scope *", "*", { contract: OTHER, function: "mint" }, true],
	]

	test.each(scopeRows)("transaction scope, %s", async (_label, scope, pattern, held) => {
		const grant = { type: "transaction", scope }
		expect(await coverage(grant, { type: "transaction", scope: [pattern] })).toBe(held ? "covered" : "window")
		const call = [{ calls: [{ to: pattern.contract, name: pattern.function }] }, {}]
		expect(await enforcement(grant, "sendTx", call)).toEqual(held ? "allowed" : sendTxRefused)
	})

	test("a requested wildcard contract is covered only by a wildcard contract", async () => {
		const asked = { type: "transaction", scope: [{ contract: "*", function: "transfer" }] }
		expect(await coverage({ type: "transaction", scope: [{ contract: TOKEN, function: "transfer" }] }, asked)).toBe("window")
		expect(await coverage({ type: "transaction", scope: [{ contract: "*", function: "transfer" }] }, asked)).toBe("covered")
	})

	test("a requested scope * is covered only by a held scope *", async () => {
		expect(
			await coverage({ type: "transaction", scope: [{ contract: "*", function: "*" }] }, { type: "transaction", scope: "*" }),
		).toBe("window")
		expect(await coverage({ type: "transaction", scope: "*" }, { type: "transaction", scope: "*" })).toBe("covered")
	})

	test("a stored malformed address matches nothing, itself included", async () => {
		const grant = { type: "transaction", scope: [{ contract: MALFORMED, function: "transfer" }] }
		expect(await coverage(grant, { type: "transaction", scope: [{ contract: TOKEN, function: "transfer" }] })).toBe("window")
		expect(await enforcement(grant, "sendTx", [{ calls: [{ to: MALFORMED, name: "transfer" }] }, {}])).toEqual(sendTxRefused)
	})

	test("an empty function name: enforcement refuses it under *, the request projection refuses to ask for it", async () => {
		const grant = { type: "transaction", scope: "*" }
		expect(await enforcement(grant, "sendTx", [{ calls: [{ to: TOKEN, name: "" }] }, {}])).toEqual(sendTxRefused)
		expect(await coverage(grant, { type: "transaction", scope: [{ contract: TOKEN, function: "" }] })).toEqual({
			threw: ValidationError,
			message: "Malformed transaction capability",
		})
	})

	test("contracts: a listing in another case covers and admits", async () => {
		const grant = { type: "contracts", contracts: [TOKEN_UP], canRegister: true }
		expect(await coverage(grant, { type: "contracts", contracts: [TOKEN], canRegister: true })).toBe("covered")
		expect(await enforcement(grant, "registerContract", [{ address: TOKEN }])).toBe("allowed")
	})

	test("contracts: a grant without the asked flag neither covers nor admits", async () => {
		const grant = { type: "contracts", contracts: [TOKEN], canRegister: true }
		expect(await coverage(grant, { type: "contracts", contracts: [TOKEN], canGetMetadata: true })).toBe("window")
		expect(await enforcement(grant, "getContractMetadata", [TOKEN])).toEqual(
			refused("Scope violation: getContractMetadata contract not permitted by granted contracts scope"),
		)
	})

	test("contracts: another address neither covers nor admits", async () => {
		const grant = { type: "contracts", contracts: [TOKEN], canRegister: true }
		expect(await coverage(grant, { type: "contracts", contracts: [OTHER], canRegister: true })).toBe("window")
		expect(await enforcement(grant, "registerContract", [{ address: OTHER }])).toEqual(
			refused("Scope violation: registerContract contract not permitted by granted contracts scope"),
		)
	})

	test("contracts: a held * covers and admits any address", async () => {
		const grant = { type: "contracts", contracts: "*", canRegister: true }
		expect(await coverage(grant, { type: "contracts", contracts: [OTHER], canRegister: true })).toBe("covered")
		expect(await enforcement(grant, "registerContract", [{ address: OTHER }])).toBe("allowed")
	})

	// Engines word a TypeError differently after the expression it names (Bun appends the
	// transformed source), so the pin is the class and the expression that threw.
	test("contracts: a held list that is not an array throws today's TypeError on both paths", async () => {
		const grant = { type: "contracts", contracts: {}, canRegister: true }
		const covered = await coverage(grant, { type: "contracts", contracts: [TOKEN], canRegister: true })
		expect(covered).toMatchObject({ threw: TypeError })
		expect((covered as { message: string }).message.startsWith("e.contracts.some is not a function")).toBe(true)
		const enforced = await enforcement(grant, "registerContract", [{ address: TOKEN }])
		expect(enforced).toMatchObject({ threw: TypeError })
		expect((enforced as { message: string }).message.startsWith("list.some is not a function")).toBe(true)
	})

	test("private events: a listing in another case covers and admits", async () => {
		const grant = { type: "data", privateEvents: { contracts: [TOKEN_UP] } }
		expect(await coverage(grant, { type: "data", privateEvents: { contracts: [TOKEN] } })).toBe("covered")
		expect(await enforcement(grant, "getPrivateEvents", [{}, { contractAddress: TOKEN }])).toBe("allowed")
	})

	test("private events: an address-book-only grant opens the window without throwing, and refuses the call", async () => {
		const grant = { type: "data", addressBook: true }
		expect(await coverage(grant, { type: "data", privateEvents: { contracts: [TOKEN] } })).toBe("window")
		expect(await enforcement(grant, "getPrivateEvents", [{}, { contractAddress: TOKEN }])).toEqual(
			refused("Scope violation: getPrivateEvents contract not permitted by granted data.privateEvents scope"),
		)
	})

	test("transaction scope: a held null pattern throws the coverage predicate's own TypeError", async () => {
		const ep = null as unknown as { contract: unknown }
		const expected = thrownBy(() => ep.contract)
		const grant = { type: "transaction", scope: [null] }
		expect(await coverage(grant, { type: "transaction", scope: [{ contract: TOKEN, function: "transfer" }] })).toEqual(expected)
	})

	test("private events: a held element String() cannot convert throws each path's own TypeError", async () => {
		const element = { toString: 1 }
		const grant = { type: "data", privateEvents: { contracts: [element] } }
		const x = element
		expect(await coverage(grant, { type: "data", privateEvents: { contracts: [TOKEN] } })).toEqual(thrownBy(() => String(x)))
		const item = element
		expect(await enforcement(grant, "getPrivateEvents", [{}, { contractAddress: TOKEN }])).toEqual(thrownBy(() => String(item)))
	})
})

const SEND_LEG = { name: "sendTx", args: [{ calls: [] }, {}] }
const TOKEN_LEG = { name: "registerToken", args: [ACC1, TOKEN] }
const CHAIN_LEG = { name: "getChainInfo", args: [] }
const batchRefusal = (name: string) => ({
	threw: Error,
	message: `Method "${name}" cannot be used inside batch — it requires a confirmation popup`,
})

async function runBatch(legs: unknown, grants: unknown[] = []) {
	const h = harness(grants)
	const result = await outcome(h.dispatch("batch", [legs]))
	return { result, ran: h.seen.executed.map((op) => op.kind), sent: h.seen.sent.map((op) => op.kind) }
}

describe("batch refusal", () => {
	test.each([
		["sendTx alone", [SEND_LEG], "sendTx"],
		["registerToken alone", [TOKEN_LEG], "registerToken"],
		["a refused leg after a runnable one", [CHAIN_LEG, SEND_LEG], "sendTx"],
		["the first refused leg in order", [TOKEN_LEG, SEND_LEG], "registerToken"],
		["a refused leg after an unknown one", [{ name: "nope", args: [] }, SEND_LEG], "sendTx"],
	])("%s is refused before any leg runs", async (_label, legs, name) => {
		expect(await runBatch(legs)).toEqual({ result: batchRefusal(name), ran: [], sent: [] })
	})

	test("a malformed envelope is refused by batch's own guard first", async () => {
		expect((await runBatch([{ name: "sendTx", args: "x" }])).result).toEqual({
			threw: Error,
			message: "Invalid arguments for wallet method: batch",
		})
	})

	test.each(["__proto__", "constructor", "hasOwnProperty", "toString", "SendTx"])(
		"a leg named %s passes the pre-scan and fails as an unknown method",
		async (name) => {
			expect((await runBatch([{ name, args: [] }])).result).toEqual({
				threw: UnsupportedMethodError,
				message: `Unsupported wallet method: ${name}`,
			})
		},
	)

	test("a nested batch is scanned only when it runs, after the outer legs before it", async () => {
		const nested = { name: "batch", args: [[SEND_LEG]] }
		expect(await runBatch([CHAIN_LEG, nested])).toEqual({ result: batchRefusal("sendTx"), ran: ["aztec_getChainInfo"], sent: [] })
	})

	test("runnable legs run in order and an empty batch answers empty (success controls)", async () => {
		const bookLeg = { name: "getAddressBook", args: [] }
		expect(await runBatch([bookLeg, CHAIN_LEG], [{ type: "data", addressBook: true }])).toEqual({
			result: {
				ok: [
					{ name: "getAddressBook", result: "0xran" },
					{ name: "getChainInfo", result: "0xran" },
				],
			},
			ran: ["aztec_getAddressBook", "aztec_getChainInfo"],
			sent: [],
		})
		expect((await runBatch([])).result).toEqual({ ok: [] })
	})

	test("over every registry method, exactly registerToken and sendTx are refused as batch legs", async () => {
		const names = Object.keys(METHOD_REGISTRY)
		expect(names.length).toBeGreaterThan(0)
		const refusedNames: string[] = []
		for (const name of names) {
			const { result } = await runBatch([{ name, args: [] }])
			if ("threw" in result && result.message === batchRefusal(name).message) refusedNames.push(name)
		}
		expect(refusedNames.sort()).toEqual(["registerToken", "sendTx"])
	})

	test("registerContractClass inside a batch keeps its scope-check refusal", async () => {
		const grant = { type: "contractClasses", classes: "*", canGetMetadata: true }
		expect((await runBatch([{ name: "registerContractClass", args: [{}] }], [grant])).result).toEqual({
			threw: Error,
			message:
				"registerContractClass is intentionally disabled in Nulo pending contractClasses.canRegister support and class-id-scoped enforcement.",
		})
	})

	test("(DRIFT PIN) grantPublicAuthwit runs inside a batch although it is popup-routed", async () => {
		const content = { caller: OTHER, contract: TOKEN, method: "transfer", args: [] }
		expect(await runBatch([{ name: "grantPublicAuthwit", args: [ACC1, content] }], [{ type: "transaction", scope: "*" }])).toEqual({
			result: { ok: [{ name: "grantPublicAuthwit", result: "0xsent" }] },
			ran: [],
			sent: ["send_transaction"],
		})
	})
})

/** The trailing args after `exec`, and the account the request acts as (or the exact refusal). */
type SenderRow = [label: string, tail: unknown[], expected: string | { threw: unknown; message: string }]

/** The engine's own wording for converting an object whose `toString` is not callable. */
function stringConversionError(value: unknown): { threw: unknown; message: string } {
	return thrownBy(() => String(value))
}

const notAuthorized = refused("Scope violation: requested account not authorized for this dApp session")
const SENDER_ROWS: SenderRow[] = [
	["opts absent", [], ACC1],
	["opts undefined", [undefined], ACC1],
	["opts null", [null], ACC1],
	["from absent", [{}], ACC1],
	["from undefined", [{ from: undefined }], ACC1],
	["from null", [{ from: null }], ACC1],
	["NO_FROM", [{ from: "NO_FROM" }], ACC1],
	["no_from", [{ from: "no_from" }], notAuthorized],
	["empty string", [{ from: "" }], notAuthorized],
	["zero", [{ from: 0 }], notAuthorized],
	["false", [{ from: false }], notAuthorized],
	["an object", [{ from: {} }], notAuthorized],
	["a session account", [{ from: ACC2 }], ACC2],
	["a session account in upper case", [{ from: ACC2_UP }], notAuthorized],
	["a wallet account outside the session", [{ from: STRANGER }], notAuthorized],
	["an Fr naming a session account", [{ from: new Fr(0xabcdefn) }], ACC2],
	["an object String() cannot convert", [{ from: { toString: "x" } }], stringConversionError({ toString: "x" })],
]

const SENDER_GRANTS = [
	{ type: "accounts", canGet: true, canCreateAuthWit: false, accounts: [] },
	{ type: "transaction", scope: [] },
	{ type: "simulation", transactions: { scope: "*" } },
]

describe("the sender a request names", () => {
	test.each(SENDER_ROWS)("sendTx, %s", async (label, tail, expected) => {
		const h = harness(SENDER_GRANTS)
		const result = await outcome(h.dispatch("sendTx", [{ calls: [] }, ...tail]))
		if (typeof expected !== "string") {
			expect(result).toEqual(expected)
			expect(h.seen.sent).toEqual([])
			return
		}
		expect(result).toEqual({ ok: "0xsent" })
		const noFrom = label === "NO_FROM"
		const [op] = h.seen.sent
		expect({ account: op?.account, executionMode: op?.executionMode, from: op?.opts?.from }).toEqual({
			account: `aztec:0:${expected}`,
			executionMode: noFrom ? "default_entrypoint" : undefined,
			from: noFrom ? "NO_FROM" : expected,
		})
	})

	test.each(["simulateTx", "profileTx"].flatMap((method) => SENDER_ROWS.map((row) => [method, ...row] as const)))(
		"%s, %s",
		async (method, _label, tail, expected) => {
			const h = harness(SENDER_GRANTS)
			const result = await outcome(h.dispatch(method, [{ calls: [] }, ...tail]))
			if (typeof expected !== "string") {
				expect(result).toEqual(expected)
				expect(h.seen.executed).toEqual([])
				return
			}
			expect(result).toEqual({ ok: "0xran" })
			const [op] = h.seen.executed as Array<Operation & { accountAddress?: string; opts?: { from?: unknown } }>
			expect({ account: op?.accountAddress, from: op?.opts?.from }).toEqual({ account: expected, from: expected })
		},
	)
})
