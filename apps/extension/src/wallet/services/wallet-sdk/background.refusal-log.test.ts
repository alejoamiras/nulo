/**
 * A scope refusal reaches no sink with a request value, and a refused `sendTx` is filed as refused.
 * Each request carries a sentinel in every field it controls and runs through the arrival check and
 * the real dispatcher; only the connection handler and the wallet services are stubbed.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { type GrantedCapabilityRecord, WalletSdkDispatcher } from "@nulo/wallet-bridge"
import { LogLevel } from "@/wallet/logger"

vi.mock("@aztec/wallet-sdk/extension/handlers", () => ({ BackgroundConnectionHandler: class {} }))
vi.mock("./content-message-relay", () => ({ attachContentListener: () => {} }))
vi.mock("./tab-lifecycle", () => ({ wireTabLifecycle: () => {} }))
vi.mock("@nulo/wallet-sdk-schema-patch/register", () => ({}))

import { handleWalletMessage } from "./background"
import { SCOPE_VIOLATION_ENVELOPE, UNCLASSIFIED_ERROR_MESSAGE } from "./error-envelope"
import { tryCreateQueuedJournal } from "./queued-journal"
import { makeAccountStub, makeDeps, makeSession } from "./queued-journal.fixtures"

const SESSION = makeSession()
const ACCOUNT = `0x${"0a".repeat(32)}`
/** `ACCOUNT` on the chain `SESSION`'s chain info resolves to. */
const SESSION_ACCOUNT = `aztec:1336:${ACCOUNT}`
const A = `0x${"11".repeat(32)}`

const grant = (capability: unknown) => ({ capability, grantedAt: 0 }) as GrantedCapabilityRecord
const listed = (...contracts: string[]) => contracts.map((contract) => ({ contract, function: "transfer" }))
const tx = (scope: unknown) => grant({ type: "transaction", scope })
const contracts = (flags: Record<string, boolean>) => grant({ type: "contracts", contracts: [A], ...flags })
const listedSimulation = (sub: "transactions" | "utilities") => grant({ type: "simulation", [sub]: { scope: listed(A) } })
const authWit = { type: "accounts", canGet: true, canCreateAuthWit: true }
const noAddressBook = grant({ type: "data", addressBook: false })

const call = { to: "SENTINEL-TO", name: "SENTINEL-NAME" }
const exec = { calls: [call], scopes: ["SENTINEL-EXEC-SCOPE"] }
const opts = { from: "SENTINEL-FROM", scopes: ["SENTINEL-OPTS-SCOPE"], additionalScopes: ["SENTINEL-ADDITIONAL-SCOPE"] }
const callIntent = { caller: "SENTINEL-CALLER", call }
const innerHash = { consumer: "SENTINEL-CONSUMER", innerHash: "SENTINEL-INNER-HASH" }
const events = { contractAddress: "SENTINEL-CONTRACT", scopes: ["SENTINEL-EVENT-SCOPE"] }
const outsideSession = (field: string) => `Scope violation: ${field} entry not in session's approved accounts`

type Refusal = [name: string, method: string, args: unknown[], grants: GrantedCapabilityRecord[], message: string]

// An authorized sender, so the arrival check files a queued row; every other field is a sentinel.
const JOURNALED: Refusal[] = [
	[
		"a call outside the listed transaction scope",
		"sendTx",
		[exec, { ...opts, from: ACCOUNT }],
		[tx(listed(A))],
		"Scope violation: sendTx call not permitted by granted transaction scope",
	],
	["an exec.scopes account", "sendTx", [exec, { from: ACCOUNT }], [tx("*")], outsideSession("sendTx.exec.scopes")],
	[
		"an opts.scopes account",
		"sendTx",
		[{ calls: [call] }, { from: ACCOUNT, scopes: opts.scopes }],
		[tx("*")],
		outsideSession("sendTx.opts.scopes"),
	],
	[
		"an opts.additionalScopes account",
		"sendTx",
		[{ calls: [call] }, { from: ACCOUNT, additionalScopes: opts.additionalScopes }],
		[tx("*")],
		outsideSession("sendTx.opts.additionalScopes"),
	],
]

const NOT_JOURNALED: Refusal[] = [
	[
		"sendTx, an explicit `from` outside the session (its missing row is a regression control)",
		"sendTx",
		[{ calls: [call] }, { from: "SENTINEL-FROM" }],
		[tx("*")],
		"Scope violation: requested account not authorized for this dApp session",
	],
	[
		"registerContract, the contract",
		"registerContract",
		[{ address: "SENTINEL-ADDRESS" }],
		[contracts({ canRegister: true })],
		"Scope violation: registerContract contract not permitted by granted contracts scope",
	],
	[
		"getContractMetadata, the contract",
		"getContractMetadata",
		["SENTINEL-ADDRESS"],
		[contracts({ canGetMetadata: true })],
		"Scope violation: getContractMetadata contract not permitted by granted contracts scope",
	],
	[
		"isTokenRegistered, the token",
		"isTokenRegistered",
		["SENTINEL-TOKEN", { scopes: ["SENTINEL-OPTS-SCOPE"] }],
		[contracts({ canGetMetadata: true })],
		"Scope violation: isTokenRegistered contract not permitted by granted contracts scope",
	],
	[
		"getContractClassMetadata, the class",
		"getContractClassMetadata",
		["SENTINEL-CLASS"],
		[grant({ type: "contractClasses", classes: [A], canGetMetadata: true })],
		"Scope violation: getContractClassMetadata class not permitted by granted contractClasses scope",
	],
	[
		"grantPublicAuthwit, the call",
		"grantPublicAuthwit",
		["SENTINEL-FROM", { caller: "SENTINEL-CALLER", contract: "SENTINEL-CONTRACT", method: "SENTINEL-METHOD", args: ["SENTINEL-ARG"] }],
		[tx(listed(A))],
		"Scope violation: grantPublicAuthwit call not permitted by granted transaction scope",
	],
	[
		"simulateTx, a call",
		"simulateTx",
		[exec, opts],
		[listedSimulation("transactions")],
		"Scope violation: simulateTx call not permitted by granted simulation.transactions scope",
	],
	[
		"profileTx, a call",
		"profileTx",
		[exec, opts],
		[listedSimulation("transactions")],
		"Scope violation: profileTx call not permitted by granted simulation.transactions scope",
	],
	[
		"executeUtility, the call",
		"executeUtility",
		[call, opts],
		[listedSimulation("utilities")],
		"Scope violation: executeUtility call not permitted by granted simulation.utilities scope",
	],
	[
		"getPrivateEvents, the contract",
		"getPrivateEvents",
		[{ eventName: "SENTINEL-EVENT" }, events],
		[grant({ type: "data", privateEvents: { contracts: [A] } })],
		"Scope violation: getPrivateEvents contract not permitted by granted data.privateEvents scope",
	],
	[
		"getPrivateEvents, a filter's scopes account",
		"getPrivateEvents",
		[{ eventName: "SENTINEL-EVENT" }, events],
		[grant({ type: "data", privateEvents: { contracts: "*" } })],
		outsideSession("getPrivateEvents.opts.scopes"),
	],
	[
		"createAuthWit, the account",
		"createAuthWit",
		["SENTINEL-FROM", callIntent],
		[grant({ ...authWit, accounts: [{ alias: "a", item: A }] })],
		"Scope violation: createAuthWit account not permitted by granted accounts scope",
	],
	[
		"createAuthWit, the call",
		"createAuthWit",
		["SENTINEL-FROM", callIntent],
		[grant(authWit), tx(listed(A))],
		"Scope violation: createAuthWit call not permitted by granted transaction or simulation scope",
	],
	[
		"createAuthWit, the inner hash's consumer",
		"createAuthWit",
		["SENTINEL-FROM", innerHash],
		[grant(authWit), tx(listed(A))],
		"Scope violation: createAuthWit inner-hash consumer not permitted by granted transaction or simulation scope",
	],
	[
		"getAccounts, the canGet flag",
		"getAccounts",
		[],
		[grant({ type: "accounts", canGet: false })],
		"Scope violation: getAccounts requires accounts.canGet=true",
	],
	[
		"getAddressBook, the addressBook flag",
		"getAddressBook",
		[],
		[noAddressBook],
		"Scope violation: getAddressBook requires data.addressBook=true",
	],
	[
		"registerSender, the addressBook flag",
		"registerSender",
		["SENTINEL-ADDRESS", "SENTINEL-ALIAS"],
		[noAddressBook],
		"Scope violation: registerSender requires data.addressBook=true",
	],
]

/** JSON of `value` with every `Error` expanded to its own properties plus `message` and `stack`,
 *  which `JSON.stringify` alone drops. */
function serialize(value: unknown): string {
	return JSON.stringify(value, (_key, v) =>
		v instanceof Error
			? {
					...Object.fromEntries(Object.getOwnPropertyNames(v).map((k) => [k, Reflect.get(v, k)])),
					message: v.message,
					stack: v.stack,
				}
			: v,
	)
}

async function refuse(method: string, args: unknown[], grants: GrantedCapabilityRecord[]) {
	const stored = {
		tryGetDappSessionByOriginAndChain: async () => ({
			id: "row-1",
			origin: SESSION.origin,
			accounts: [SESSION_ACCOUNT],
			capabilityGrants: grants,
			capabilityRejections: [],
			dappMetadata: { name: "Example Dapp" },
		}),
	}
	const account = makeAccountStub([ACCOUNT])
	const { deps, journal, networkSvc } = makeDeps({ dappSession: stored as never, account: account as never })
	// One logger serves the handler, the dispatcher, the arrival check and the journal, and the
	// console reaches the same buffer in the extension.
	const log = vi.spyOn(deps.logger, "log")
	const consoleLines = (["debug", "warn", "error"] as const).map((level) => vi.spyOn(console, level))
	const execution = { executeOperations: vi.fn() }
	const interaction = { execute: vi.fn(), requestCapabilities: vi.fn() }
	const dispatcher = new WalletSdkDispatcher(
		networkSvc as never,
		account as never,
		execution,
		interaction as never,
		stored as never,
		deps.logger,
	)
	const dispatch = vi.spyOn(dispatcher, "dispatch")
	const sendResponse = vi.fn(async (_sessionId: string, _response: unknown) => {})
	const message = { messageId: "m1", type: method, args } as never
	// The background files a queued row at arrival for a `sendTx` only.
	const queuedJournalId = method === "sendTx" ? await tryCreateQueuedJournal(message, SESSION, deps) : undefined

	await handleWalletMessage(
		SESSION,
		message,
		{ sendResponse, terminateSession: vi.fn() } as never,
		dispatcher,
		{ captureExecutionFence: async () => ({ profileId: "profile-1", epoch: 0, session: 1 }) } as never,
		journal,
		new Map([[SESSION.sessionId, "profile-1"]]),
		{ current: () => 0 } as never,
		deps.logger,
		{ assertCurrent: async () => {} },
		{ queuedJournalId },
	)

	const refusal = await Promise.resolve(dispatch.mock.results[0]?.value).then(
		() => undefined,
		(error: unknown) => error as Error,
	)
	const failureLine = log.mock.calls.find(([, , text]) => String(text).startsWith("Method "))
	const lines = [log, ...consoleLines].flatMap((spy) => spy.mock.calls as unknown[][])
	const row = queuedJournalId === undefined ? undefined : await journal.getOperation(queuedJournalId)
	return {
		refusal: refusal?.message,
		level: failureLine?.[1],
		envelope: (sendResponse.mock.calls[0]?.[1] as { error?: unknown } | undefined)?.error,
		leakingLines: lines.map(serialize).filter((line) => /SENTINEL-/.test(line)),
		responseLeaks: /SENTINEL-/.test(serialize(sendResponse.mock.calls)),
		ran: [execution.executeOperations, interaction.execute, interaction.requestCapabilities].flatMap((fn) => fn.mock.calls),
		rows: await journal.countOperations({ sessionId: SESSION.sessionId }),
		row: row && {
			stage: row.progress.stage,
			kind: row.error?.kind,
			message: row.error?.message,
			leaks: /SENTINEL-/.test(serialize(row.error)),
			title: row.title,
		},
	}
}

const refusedCleanly = (message: string) => ({
	refusal: message,
	level: LogLevel.Debug,
	envelope: SCOPE_VIOLATION_ENVELOPE,
	leakingLines: [],
	responseLeaks: false,
	ran: [],
})

describe("handleWalletMessage — a scope refusal", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("the serializer sees a nested Error's message", () => {
		expect(serialize([{ error: new Error("SENTINEL-PROBE") }])).toMatch(/SENTINEL-PROBE/)
	})

	test.each(JOURNALED)("of a sendTx, %s, fails its queued row as refused", async (_name, method, args, grants, message) => {
		expect(await refuse(method, args, grants)).toEqual({
			...refusedCleanly(message),
			rows: 1,
			row: { stage: "failed", kind: "scope_refused", message, leaks: false, title: "SENTINEL-NAME" },
		})
	})

	test.each(NOT_JOURNALED)("of %s leaves no row", async (_name, method, args, grants, message) => {
		expect(await refuse(method, args, grants)).toEqual({ ...refusedCleanly(message), rows: 0, row: undefined })
	})

	test("a createAuthWit for a raw message hash, which no grant can admit, stays unclassified (regression control)", async () => {
		expect(await refuse("createAuthWit", ["SENTINEL-FROM", "SENTINEL-HASH"], [grant(authWit)])).toEqual({
			...refusedCleanly("Scope violation: createAuthWit requires a structured call intent; a raw message hash cannot be authorized"),
			level: LogLevel.Error,
			envelope: UNCLASSIFIED_ERROR_MESSAGE,
			rows: 0,
			row: undefined,
		})
	})
})
