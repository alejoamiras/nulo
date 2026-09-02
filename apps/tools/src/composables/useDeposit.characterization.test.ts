// @vitest-environment node
/**
 * Pre-extraction CHARACTERIZATION traces for useDeposit's deposit() orchestration and the
 * journal claim/recovery deps — the equivalence proof for the deposit-decomposition plan.
 * These tests drive the REAL flow over full fakes and record exact call order + values;
 * the decomposition must keep every trace byte-identical. Where current behavior is
 * surprising it is (BUG PIN)ned here, never fixed in passing.
 *
 * Node environment (not jsdom): bb.js's sync poseidon throws std::bad_cast under jsdom,
 * and this suite needs the REAL secret-hash derivation. localStorage is shimmed below.
 */

// The composable reaches for the browser's localStorage (journal kv + seal-trust cache);
// under the node environment we provide a real-enough Storage.
const storageBacking = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
	getItem: (k: string) => storageBacking.get(k) ?? null,
	setItem: (k: string, v: string) => void storageBacking.set(k, String(v)),
	removeItem: (k: string) => void storageBacking.delete(k),
	clear: () => void storageBacking.clear(),
	key: (i: number) => [...storageBacking.keys()][i] ?? null,
	get length() {
		return storageBacking.size
	},
}

import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { GasFees } from "@aztec/stdlib/gas"
import { PRIVATE_FPC_ADDRESS, SWAP_BRIDGE_ROUTER_ABI, feeJuiceAddress } from "@nulo/bridge-core"
import { encodeAbiParameters, encodeEventTopics } from "viem"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const h = vi.hoisted(() => {
	const trace: Array<[string, unknown]> = []
	return {
		trace,
		t: (name: string, detail?: unknown) => void trace.push([name, detail]),
		captured: { deps: undefined as undefined | Record<string, unknown> },
		lastId: { value: "" },
		fj: { publicBalance: 0n, privateBalance: 0n, publicThrows: false, invokeLatch: false, claimSendError: null as null | string },
		l2: { blockNumber: 42n, txReceiptStatus: "pending" as string, txExecutionResult: "success" as string, txReceiptThrows: false },
		allowance: { value: 0n },
		bridge: { sendError: null as null | "insufficiency" | "other" },
	}
})

// ── deployment config (fuel-capable, salt-v2) ────────────────────────────────
const FROM = "0xef4d9e1f4e9e2dd9e747b53f4be3d04bfa935f2d" as const
const RECIPIENT = "0x1018808f2c17794badb361c02c945582b8198b495a7e8d01154f7eeb7d719c0d"
const BRIDGE_L2 = "0x2018808f2c17794badb361c02c945582b8198b495a7e8d01154f7eeb7d719c0d"
const ADDR = {
	usdc: "0x00000000000000000000000000000000000000aa",
	portal: "0x00000000000000000000000000000000000000bb",
	permit2: "0x00000000000000000000000000000000000000cc",
	router: "0x00000000000000000000000000000000000000dd",
	swapTarget: "0x00000000000000000000000000000000000000ee",
	quoter: "0x00000000000000000000000000000000000000ff",
	weth: "0x0000000000000000000000000000000000000011",
	feeJuiceL1: "0x0000000000000000000000000000000000000022",
} as const

vi.mock("@/contracts/bridge-deployments", () => ({
	BRIDGE_TOKEN_SYMBOL: "USDC",
	BRIDGE_TOKEN_DECIMALS: 6,
	FUEL_PORTAL: "0x0000000000000000000000000000000000000033",
	FUEL_ASSET: "0x0000000000000000000000000000000000000044",
	L1_USDC: "0x00000000000000000000000000000000000000aa",
	L1_PORTAL: "0x00000000000000000000000000000000000000bb",
	BRIDGE: { toString: () => "0x2018808f2c17794badb361c02c945582b8198b495a7e8d01154f7eeb7d719c0d" },
	BRIDGE_PERMIT2: "0x00000000000000000000000000000000000000cc",
	BRIDGE_ROUTER: "0x00000000000000000000000000000000000000dd",
	BRIDGE_SWAP_TARGET: "0x00000000000000000000000000000000000000ee",
	SUPPORTS_SALT_V2: true,
	FUEL_MIN_FJ: 1000n,
	BRIDGE_FUEL: {
		weth: "0x0000000000000000000000000000000000000011",
		feeJuice: "0x0000000000000000000000000000000000000022",
		pools: { tokenWeth: { fee: 500, tickSpacing: 10 }, ethFj: { fee: 3000, tickSpacing: 60 } },
		quoter: "0x00000000000000000000000000000000000000ff",
		router: "0x00000000000000000000000000000000000000dd",
		permit2: "0x00000000000000000000000000000000000000cc",
		swapTarget: "0x00000000000000000000000000000000000000ee",
		minFuelFj: 1000n,
		slippageBps: 100,
	},
}))

// ── heavy lazy artifacts ─────────────────────────────────────────────────────
vi.mock("@aztec/noir-contracts.js/FeeJuice", () => ({ FeeJuiceContractArtifact: { name: "FeeJuice" } }))
vi.mock("@nulo/bridge-core/private-fpc-artifact", () => ({ PrivateFPCContractArtifact: { name: "PrivateFPC" } }))

// ── sponsored FPC ────────────────────────────────────────────────────────────
vi.mock("@/contracts/sponsored-fpc", () => ({
	getSponsoredFpcInstance: async () => ({
		address: { toString: () => "0x3018808f2c17794badb361c02c945582b8198b495a7e8d01154f7eeb7d719c0d" },
	}),
}))

// ── fuel-claim builder (recorded; exercised by its own suite) ────────────────
vi.mock("./fuelClaim", () => ({
	buildFuelClaimInteraction: (rec: { id: string }, opts: Record<string, unknown>) => {
		h.t("fuelClaim.buildFuelClaimInteraction", {
			id: rec.id,
			maxFeesPerGas: opts.maxFeesPerGas,
			minFloorFj: opts.minFloorFj,
			resolvedSalt: opts.resolvedSalt,
			resolvedSecret: opts.resolvedSecret,
		})
		return {
			simulate: async () => ({}),
			send: async () => {
				// Opt-in: the real builder latches through these; the default keeps prior traces intact.
				if (h.fj.invokeLatch) {
					;(opts.onAttempt as (() => void) | undefined)?.()
					;(opts.onTxHash as ((tx: string) => void) | undefined)?.("0xfjclaimtx")
				}
				return { txHash: "0xfjclaimtx" }
			},
		}
	},
}))

// ── L1 wallet module ─────────────────────────────────────────────────────────
vi.mock("./useL1Wallet", () => {
	const publicClient = {
		readContract: async (args: { functionName: string; args?: unknown[] }) => {
			if (args.functionName === "allowance") {
				h.t("l1.read.allowance")
				return h.allowance.value
			}
			if (args.functionName === "quoteExactInputSingle") {
				const q = args.args?.[0] as { exactAmount: bigint }
				h.t("l1.read.quote", { in: q.exactAmount })
				return [q.exactAmount * 2n, 0n]
			}
			throw new Error(`unexpected readContract ${args.functionName}`)
		},
		waitForTransactionReceipt: async ({ hash }: { hash: string }) => {
			h.t("l1.waitReceipt", hash)
			return receiptFor(hash)
		},
		getTransactionReceipt: async ({ hash }: { hash: string }) => {
			h.t("l1.getReceipt", hash)
			return receiptFor(hash)
		},
	}
	const walletClient = {
		signMessage: async ({ message }: { message: string }) => {
			h.t("l1.signMessage", message.slice(0, 64))
			return `0x${"a".repeat(130)}`
		},
		signTypedData: async (typed: Record<string, unknown>) => {
			// domain + types are pinned too: a wrong chain id or Permit2 verifying contract
			// must fail the trace, not just a wrong message (codex impl-review MEDIUM).
			h.t("l1.signTypedData", { primaryType: typed.primaryType, domain: typed.domain, types: typed.types, message: typed.message })
			return `0x${"b".repeat(130)}`
		},
		writeContract: async (args: { functionName: string; args?: unknown[]; address?: string }) => {
			h.t("l1.writeContract", { fn: args.functionName, to: args.address, args: args.args })
			if (args.functionName === "approve") {
				h.allowance.value = (1n << 256n) - 1n
				return "0xapprovetx"
			}
			if (args.functionName === "bridgeWithFuel") return "0xfueldeposittx"
			if (args.functionName === "bridge") return "0xdeposittx"
			throw new Error(`unexpected writeContract ${args.functionName}`)
		},
	}
	return {
		useL1Wallet: () => ({
			address: { value: FROM },
			publicClient,
			ensureWalletClient: () => walletClient,
			isConnected: { value: true },
		}),
	}
})

// ── Aztec wallet module ──────────────────────────────────────────────────────
vi.mock("./useBridgeWallet", () => {
	const aztec = {
		executeUtility: async () => {
			h.t("aztec.executeUtility.balance_of")
			return { result: [h.fj.privateBalance] }
		},
	}
	return {
		useBridgeWallet: () => ({
			wallet: { value: aztec },
			selectedAccount: { value: RECIPIENT },
			status: { value: "connected" },
		}),
	}
})

// ── Aztec contracts: dispatch by address ─────────────────────────────────────
vi.mock("@aztec/aztec.js/contracts", async (importOriginal) => {
	const real = (await importOriginal()) as Record<string, unknown>
	return {
		...real,
		Contract: {
			at: async (addr: { toString(): string }) => contractAt(addr.toString()),
		},
	}
})

function contractAt(addr: string): Record<string, unknown> {
	if (addr === feeJuiceAddress) {
		return {
			methods: {
				balance_of_public: (_acct: unknown) => ({
					simulate: async () => {
						h.t("fj.balance_of_public.simulate")
						if (h.fj.publicThrows) throw new Error("fj read down")
						return { result: h.fj.publicBalance }
					},
				}),
				claim: (...args: unknown[]) => ({
					send: async (opts: Record<string, unknown>) => {
						h.t("fj.claim.send", { args: args.map(String), wait: opts.wait })
						if (h.fj.claimSendError) throw new Error(h.fj.claimSendError)
						return { receipt: { txHash: "0xstandalonefjtx" } }
					},
				}),
			},
		}
	}
	if (addr === PRIVATE_FPC_ADDRESS) {
		return {
			methods: {
				balance_of: (_acct: unknown) => ({ request: async () => ({ calls: [{ fn: "balance_of" }] }) }),
			},
		}
	}
	if (addr === BRIDGE_L2) {
		const interaction = (kind: string, args: unknown[]) => ({
			simulate: async (opts: Record<string, unknown>) => {
				h.t(`bridge.${kind}.simulate`, { args: args.map(String), fee: describeFee(opts.fee) })
				return {}
			},
			send: async (opts: Record<string, unknown>) => {
				h.t(`bridge.${kind}.send`, { args: args.map(String), fee: describeFee(opts.fee), wait: opts.wait })
				if (h.bridge.sendError === "insufficiency") throw new Error("Amount too low to cover gas cost")
				if (h.bridge.sendError === "other") throw new Error("boom")
				return { receipt: { txHash: "0xl2claimtx" } }
			},
		})
		return {
			methods: {
				claim_private: (...args: unknown[]) => interaction("claim_private", args),
				claim_public: (...args: unknown[]) => interaction("claim_public", args),
			},
		}
	}
	throw new Error(`Contract.at for unexpected address ${addr}`)
}

/** Project a fee option into a stable trace shape (payment method class + gas settings). */
function describeFee(fee: unknown): unknown {
	if (fee === undefined) return undefined
	const f = fee as { paymentMethod?: unknown; gasSettings?: { maxFeesPerGas?: unknown; teardownGasLimits?: unknown } }
	return {
		paymentMethod: f.paymentMethod?.constructor?.name ?? typeof f.paymentMethod,
		gasSettings: f.gasSettings
			? {
					maxFeesPerGas: norm(f.gasSettings.maxFeesPerGas),
					teardownGasLimits: String(f.gasSettings.teardownGasLimits),
				}
			: undefined,
	}
}

// ── Aztec node client ────────────────────────────────────────────────────────
vi.mock("@aztec/aztec.js/node", () => ({
	createAztecNodeClient: () => ({
		getBlockNumber: async () => h.l2.blockNumber,
		getCurrentMinFees: async () => GasFees.from({ feePerDaGas: 10n, feePerL2Gas: 20n }),
		getTxReceipt: async () => {
			if (h.l2.txReceiptThrows) throw new Error("node down")
			return { status: h.l2.txReceiptStatus, executionResult: h.l2.txExecutionResult }
		},
		getL1ToL2MessageCheckpoint: async () => undefined,
		getBlockData: async () => ({ checkpointNumber: 7n }),
	}),
}))

// ── journal pass-through recorder ────────────────────────────────────────────
vi.mock("./useBridgeJournal", async (importOriginal) => {
	const real = (await importOriginal()) as typeof import("./useBridgeJournal")
	function wrap<A extends unknown[], R>(name: string, fn: (...a: A) => R, project?: (a: A) => unknown): (...a: A) => R {
		return (...a: A) => {
			h.t(name, project ? project(a) : norm(a))
			return fn(...a)
		}
	}
	return {
		...real,
		addRecordVerified: ((rec: { id: string }) => {
			h.lastId.value = rec.id
			h.t("journal.addRecordVerified", norm([rec]))
			return real.addRecordVerified(rec as never)
		}) as typeof real.addRecordVerified,
		updateRecord: wrap("journal.updateRecord", real.updateRecord),
		setRecordStep: wrap("journal.setRecordStep", real.setRecordStep),
		markSessionLive: wrap("journal.markSessionLive", real.markSessionLive),
		markApproveOutcome: wrap("journal.markApproveOutcome", real.markApproveOutcome),
		cacheSecret: wrap("journal.cacheSecret", real.cacheSecret),
		discard: wrap("journal.discard", real.discard),
		flagRecordError: wrap("journal.flagRecordError", real.flagRecordError),
		runDepositClaim: (async (id: string) => {
			h.t("journal.runDepositClaim", id)
		}) as typeof real.runDepositClaim,
		connectJournalDeps: ((deps: Record<string, unknown>) => {
			// Capture the flow's full wiring only; a test wiring a bare `kv` must not replace it.
			if ("claim" in deps) h.captured.deps = deps
			return real.connectJournalDeps(deps as never)
		}) as typeof real.connectJournalDeps,
	}
})

import { InboxAbi } from "@aztec/l1-artifacts"
import {
	FeeJuicePortalAbi,
	type DepositJournalRecord,
	type KV,
	deriveTokenClaimSecret,
	openDepositEnvelope,
	patchRecord as kvPatchRecord,
	recoveryKeyFromSignature,
} from "@nulo/bridge-core"
import { computeSecretHash } from "@aztec/aztec.js/crypto"
import { classifyClaimReceipt } from "@/lib/claim-receipt"
import { fuelReceiptStatus } from "./deposit-flow"
import { __resetJournalForTests, addRecord, connectJournalDeps, useBridgeJournal } from "./useBridgeJournal"
import { ensureDepositJournalDeps, overrideFuelClaim, reconcileFuelConsumed, useDepositFlow } from "./useDeposit"

/** Well-formed 32-byte tx hashes: `TxHash.fromString` rejects short fakes, which the probes then
 *  read as unreachable/pending — the shape the older cases rely on. */
const TX = (n: number) => `0x${n.toString(16).padStart(64, "0")}`

/** A journal store the test can write to directly — "another tab" that this tab's ref never reloads. */
function memKV(): KV {
	const store = new Map<string, string>()
	return {
		getItem: (k) => store.get(k) ?? null,
		setItem: (k, v) => void store.set(k, v),
		removeItem: (k) => void store.delete(k),
	}
}

// ── receipts with REAL-encoded event logs (parseEventLogs runs for real) ─────
function routerLog(eventName: "Bridge" | "BridgeWithFuel", aztecRecipient: `0x${string}`, values: unknown[]) {
	const abi = SWAP_BRIDGE_ROUTER_ABI
	const topics = encodeEventTopics({ abi, eventName, args: { aztecRecipient } } as never)
	const event = (abi as readonly { type: string; name?: string; inputs?: readonly { indexed?: boolean }[] }[]).find(
		(e) => e.type === "event" && e.name === eventName,
	)
	const nonIndexed = (event?.inputs ?? []).filter((i) => !i.indexed)
	const data = encodeAbiParameters(nonIndexed as never, values as never)
	return { address: ADDR.router, topics, data }
}

/** Encode a real event log for any viem ABI, values keyed by input NAME (indexed + data). */
function encodeLogFor(abi: unknown, eventName: string, values: Record<string, unknown>) {
	const event = (abi as readonly { type: string; name?: string; inputs?: readonly { name: string; indexed?: boolean }[] }[]).find(
		(e) => e.type === "event" && e.name === eventName,
	)
	if (!event) throw new Error(`no event ${eventName}`)
	const indexedArgs: Record<string, unknown> = {}
	for (const i of event.inputs ?? []) if (i.indexed) indexedArgs[i.name] = values[i.name]
	const topics = encodeEventTopics({ abi, eventName, args: indexedArgs } as never)
	const nonIndexed = (event.inputs ?? []).filter((i) => !i.indexed)
	const data = encodeAbiParameters(nonIndexed as never, nonIndexed.map((i) => values[i.name]) as never)
	return { address: ADDR.portal, topics, data }
}

function receiptFor(hash: string): { status: string; logs: unknown[] } {
	if (hash === "0xrecpending") throw new Error("not found")
	if (hash === "0xrecreverted") return { status: "reverted", logs: [] }
	if (hash === "0xrecfj") {
		return {
			status: "success",
			logs: [
				encodeLogFor(FeeJuicePortalAbi, "DepositToAztecPublic", {
					to: RECIPIENT,
					amount: 4000n,
					secretHash: msgKey(5),
					key: msgKey(6),
					index: 33n,
				}),
			],
		}
	}
	if (hash === "0xrecfueled") {
		return {
			status: "success",
			logs: [routerLog("BridgeWithFuel", zero32, [msgKey(2), 51n, 900n, msgKey(5), msgKey(3), 52n, 4100n, msgKey(4), false])],
		}
	}
	if (hash === "0xrecplain") {
		return {
			status: "success",
			logs: [encodeLogFor(InboxAbi, "MessageSent", inboxMessageSentValues(61n))],
		}
	}
	if (hash === "0xrecnoevent") return { status: "success", logs: [] }

	if (hash === "0xapprovetx") return { status: "success", logs: [] }
	if (hash === "0xdeposittx") {
		const secretHash = h.lastId.value as `0x${string}`
		return {
			status: "success",
			logs: [routerLog("Bridge", zero32, [msgKey(1), 11n, 900n, secretHash, false])],
		}
	}
	if (hash === "0xfueldeposittx") {
		const secretHash = h.lastId.value as `0x${string}`
		return {
			status: "success",
			logs: [routerLog("BridgeWithFuel", zero32, [msgKey(2), 21n, 900n, secretHash, msgKey(3), 22n, 4000n, msgKey(4), false])],
		}
	}
	throw new Error(`no receipt fixture for ${hash}`)
}
const zero32 = `0x${"0".repeat(64)}` as `0x${string}`
const msgKey = (n: number) => `0x${String(n).repeat(64).slice(0, 64)}` as `0x${string}`

/** MessageSent values for whatever input names the installed InboxAbi declares (index pinned). */
function inboxMessageSentValues(index: bigint): Record<string, unknown> {
	const event = (InboxAbi as readonly { type: string; name?: string; inputs?: readonly { name: string; type: string }[] }[]).find(
		(e) => e.type === "event" && e.name === "MessageSent",
	)
	const values: Record<string, unknown> = {}
	for (const i of event?.inputs ?? []) {
		if (i.name === "index") values[i.name] = index
		else if (i.type === "bytes32") values[i.name] = msgKey(7)
		else if (i.type.startsWith("bytes")) values[i.name] = `0x${"7".repeat(2 * Number(i.type.slice(5) || "32"))}`
		else if (i.type.startsWith("uint")) values[i.name] = 1n
		else if (i.type === "address") values[i.name] = ADDR.portal
		else values[i.name] = 0n
	}
	return values
}

// ── trace normalization ──────────────────────────────────────────────────────
function norm(v: unknown): unknown {
	if (typeof v === "bigint") return `${v}n`
	if (typeof v === "string") return v.length > 200 ? `<blob:${v.length}>` : v
	if (Array.isArray(v)) return v.map(norm)
	if (v && typeof v === "object") return normObject(v as Record<string, unknown>)
	return v
}

function normObject(v: Record<string, unknown>): unknown {
	if (v.constructor?.name === "Fr") return String(v)
	const out: Record<string, unknown> = {}
	for (const [k, val] of Object.entries(v)) {
		out[k] = k === "sealedEnvelope" && typeof val === "string" ? `<sealed:${val.length > 0}>` : norm(val)
	}
	return out
}

// ── determinism ──────────────────────────────────────────────────────────────
let frSeed = 0n
beforeEach(() => {
	h.trace.length = 0
	// h.captured.deps is deliberately NOT reset: ensureDepositJournalDeps wires once per module
	// (depsWired latch), so the capture from the first wiring is the only one there will be.
	h.fj.publicBalance = 0n
	h.fj.privateBalance = 0n
	h.fj.publicThrows = false
	h.fj.invokeLatch = false
	h.fj.claimSendError = null
	h.l2.blockNumber = 42n
	h.l2.txReceiptStatus = "pending"
	h.l2.txExecutionResult = "success"
	h.l2.txReceiptThrows = false
	h.allowance.value = 0n
	h.bridge.sendError = null
	h.lastId.value = ""
	localStorage.clear()
	__resetJournalForTests()
	frSeed = 0n
	vi.spyOn(Fr, "random").mockImplementation(() => new Fr(0x1111n + frSeed++))
	vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000)
	vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-0000000000ff")
})
afterEach(() => {
	vi.restoreAllMocks()
})

/** The full recorded trace, with the record id (poseidon of the seeded secret) stabilized. */
function stableTrace(): Array<[string, unknown]> {
	const id = h.lastId.value
	const replace = (v: unknown): unknown => {
		if (typeof v === "string") return id && v.includes(id) ? v.replaceAll(id, "<id>") : v
		if (Array.isArray(v)) return v.map(replace)
		if (v && typeof v === "object") {
			const out: Record<string, unknown> = {}
			for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = replace(val)
			return out
		}
		return v
	}
	return h.trace.map(([n, d]) => [n, replace(d)])
}

async function runDeposit(amount: bigint, isPrivate: boolean, fuelSlice?: bigint): Promise<string | null> {
	const flow = useDepositFlow()
	useBridgeJournal()
	const id = await flow.deposit(amount, isPrivate, fuelSlice ? { fuelSlice } : {})
	if (id === null && flow.error.value) {
		throw new Error(`deposit() errored: ${flow.error.value}\nlast trace: ${JSON.stringify(h.trace.slice(-4))}`)
	}
	return id
}

describe("deposit() characterization", () => {
	test("public/plain: cold-check passes on public FJ, approve + bridge, hash-before-wait", async () => {
		h.fj.publicBalance = 5n
		const id = await runDeposit(1000n, false)
		expect(id).not.toBeNull()
		expect(stableTrace()).toMatchSnapshot()
	})

	test("private/plain: seal-before-L1 with write-and-verify, derived commit, finalized re-seal", async () => {
		h.fj.publicBalance = 5n
		const id = await runDeposit(1000n, true)
		expect(id).not.toBeNull()
		expect(stableTrace()).toMatchSnapshot()
	})

	test("public/fueled: quote gate, witness law, BridgeWithFuel event drives fuel.received", async () => {
		const id = await runDeposit(5000n, false, 1000n)
		expect(id).not.toBeNull()
		expect(stableTrace()).toMatchSnapshot()
	})

	test("private/fueled: bridge-secret salt derivation, zeroed aztecRecipient, FPC fuelRecipient", async () => {
		const id = await runDeposit(5000n, true, 1000n)
		expect(id).not.toBeNull()
		expect(stableTrace()).toMatchSnapshot()
	})

	test("cold account with zero public AND private FJ blocks a no-fuel deposit", async () => {
		const flow = useDepositFlow()
		const id = await flow.deposit(1000n, false, {})
		expect(id).toBeNull()
		expect(flow.error.value).toMatch(/No gas \(Fee Juice\)/)
		expect(stableTrace()).toMatchSnapshot()
	})
})

// ── claim-dep + recovery characterization (the wired deps, invoked directly) ─

function wiredDeps(): {
	claim: (
		rec: DepositJournalRecord,
		secretHex: string,
		envelope?: { salt?: string },
	) => Promise<{ simulate: () => Promise<unknown>; send: () => Promise<{ txHash: string }> }>
	recoverDepositLeg: (rec: DepositJournalRecord) => Promise<string>
} {
	ensureDepositJournalDeps()
	useBridgeJournal()
	if (!h.captured.deps) throw new Error("deps not captured")
	return h.captured.deps as never
}

const DEPLOY = { chainId: 11155111, portal: ADDR.portal, bridge: BRIDGE_L2 }
function mkRec(over: Partial<DepositJournalRecord> = {}): DepositJournalRecord {
	const rec: DepositJournalRecord = {
		schema: 1,
		id: "0xrec1",
		direction: "deposit",
		isPrivate: false,
		amount: "900",
		createdAt: 1,
		updatedAt: 1,
		recipient: RECIPIENT,
		secret: "0x0000000000000000000000000000000000000000000000000000000000005555",
		secretHashHex: "0xrec1",
		leafIndex: "11",
		...DEPLOY,
		...over,
	} as DepositJournalRecord
	h.lastId.value = rec.id
	addRecord(rec)
	return rec
}

const FUEL_OK = {
	amount: "1000",
	secret: "0x0000000000000000000000000000000000000000000000000000000000006666",
	secretHashHex: "0x7777",
	minOutput: "3960",
	leafIndex: "22",
	received: "4000",
}

async function expectStop(i: { simulate: () => Promise<unknown> }): Promise<string> {
	try {
		await i.simulate()
	} catch (e) {
		return e instanceof Error ? e.message : String(e)
	}
	throw new Error("expected a fail-stop interaction")
}

describe("claim dep characterization", () => {
	test("direct fee-juice (public): builder gets RAW predicted-worst fees + top-level secret", async () => {
		const deps = wiredDeps()
		const rec = mkRec({ assetKind: "fee-juice", fuel: { ...FUEL_OK } } as never)
		await deps.claim(rec, "0xsecrethex", undefined)
		expect(stableTrace()).toMatchSnapshot()
	})

	test("direct fee-juice (private): builder gets the ENVELOPE salt, never the journal copy", async () => {
		const deps = wiredDeps()
		const rec = mkRec({ assetKind: "fee-juice", isPrivate: true, secret: undefined, fuel: { ...FUEL_OK } } as never)
		await deps.claim(rec, "0xsecrethex", { salt: "0xenvelopesalt" } as never)
		expect(stableTrace()).toMatchSnapshot()
	})

	test("private fueled, full metadata: claim_private with x1.5 fees; send latches journal-first", async () => {
		const deps = wiredDeps()
		const rec = mkRec({
			isPrivate: true,
			secret: undefined,
			schema: 2,
			fuel: {
				...FUEL_OK,
				bridgeSecretSalt: "0x0000000000000000000000000000000000000000000000000000000000008888",
				fpc: PRIVATE_FPC_ADDRESS,
			},
		} as never)
		const i = await deps.claim(rec, "0x0000000000000000000000000000000000000000000000000000000000005555", undefined)
		await i.simulate()
		await i.send()
		expect(stableTrace()).toMatchSnapshot()
	})

	test("private fueled: insufficiency throw latches setupInsufficiency and rethrows; other throws latch nothing", async () => {
		const deps = wiredDeps()
		const rec = mkRec({
			isPrivate: true,
			secret: undefined,
			schema: 2,
			fuel: {
				...FUEL_OK,
				bridgeSecretSalt: "0x0000000000000000000000000000000000000000000000000000000000008888",
				fpc: PRIVATE_FPC_ADDRESS,
			},
		} as never)
		const i = await deps.claim(rec, "0x0000000000000000000000000000000000000000000000000000000000005555", undefined)
		h.bridge.sendError = "insufficiency"
		await expect(i.send()).rejects.toThrow("Amount too low")
		h.bridge.sendError = "other"
		const i2 = await deps.claim(rec, "0x0000000000000000000000000000000000000000000000000000000000005555", undefined)
		await expect(i2.send()).rejects.toThrow("boom")
		expect(stableTrace()).toMatchSnapshot()
	})

	test("private fueled, incomplete metadata: L11 fail-stop (retryable copy when depositTxHash exists)", async () => {
		const deps = wiredDeps()
		const rec = mkRec({ isPrivate: true, secret: undefined, schema: 2, depositTxHash: "0xdep", fuel: { ...FUEL_OK } } as never)
		const why = await expectStop(await deps.claim(rec, "0x5555", undefined))
		expect(why).toMatchSnapshot()
	})

	test("private fueled: FPC drift and below-floor both fail-stop", async () => {
		const deps = wiredDeps()
		const drift = mkRec({
			id: "0xrecdrift",
			isPrivate: true,
			secret: undefined,
			schema: 2,
			fuel: { ...FUEL_OK, bridgeSecretSalt: "0x8888", fpc: "0xwrongfpc" },
		} as never)
		const whyDrift = await expectStop(await deps.claim(drift, "0x5555", undefined))
		const floor = mkRec({
			id: "0xrecfloor",
			isPrivate: true,
			secret: undefined,
			schema: 2,
			fuel: { ...FUEL_OK, received: "500", bridgeSecretSalt: "0x8888", fpc: PRIVATE_FPC_ADDRESS },
		} as never)
		const whyFloor = await expectStop(await deps.claim(floor, "0x5555", undefined))
		expect({ whyDrift, whyFloor }).toMatchSnapshot()
	})

	test("public fueled, fresh: fjwc fee; the PROPOSED write keeps the pre-send claimAttemptAt", async () => {
		const deps = wiredDeps()
		const rec = mkRec({ fuel: { ...FUEL_OK } } as never)
		const i = await deps.claim(rec, rec.secret as string, undefined)
		await i.simulate()
		await i.send()
		// Every fuel write merges into the PERSISTED block, so the journal-first latch's
		// claimAttemptAt survives the PROPOSED patch that adds the hash.
		const patches = h.trace.filter(([n]) => n === "journal.updateRecord").map(([, d]) => d)
		expect(patches).toMatchSnapshot("fjwc-latch-patches")
		expect(stableTrace()).toMatchSnapshot()
	})

	/** The fuel patches recorded since the trace was last cleared, oldest first. */
	const fuelPatches = () =>
		h.trace
			.filter(([n]) => n === "journal.updateRecord")
			.map(([, d]) => ((d as [string, { fuel?: Record<string, unknown> }])[1] ?? {}).fuel)

	test("fuel writes merge into the PERSISTED block: a field another tab wrote lands in every fjwc latch", async () => {
		const kv = memKV()
		connectJournalDeps({ kv } as never)
		const deps = wiredDeps()
		const rec = mkRec({ fuel: { ...FUEL_OK } } as never)
		const i = await deps.claim(rec, rec.secret as string, undefined)
		await i.simulate()
		// "Another tab" writes straight to storage; this tab's reactive copy never reloads.
		kvPatchRecord(kv, rec.id, { fuel: { ...FUEL_OK, messageHash: "0xfromothertab" } } as never)
		h.trace.length = 0
		await i.send()
		const patches = fuelPatches()
		expect(patches).toHaveLength(2)
		expect(patches.every((f) => f?.messageHash === "0xfromothertab")).toBe(true)
		expect(patches[1]).toMatchObject({ claimAttempt: true, claimAttemptAt: 1_700_000_000_000, claimTxHash: "0xl2claimtx" })
	})

	test("direct fee-juice latch: onAttempt clears a stale setupInsufficiency and onTxHash keeps it cleared", async () => {
		const deps = wiredDeps()
		h.fj.invokeLatch = true
		const rec = mkRec({ assetKind: "fee-juice", fuel: { ...FUEL_OK, setupInsufficiency: true } } as never)
		const i = await deps.claim(rec, "0xsecrethex", undefined)
		h.trace.length = 0
		await i.send()
		const patches = fuelPatches()
		expect(patches[0]).toMatchObject({ claimAttempt: true, claimAttemptAt: 1_700_000_000_000, setupInsufficiency: false })
		expect(patches[1]).toMatchObject({ claimAttempt: true, claimTxHash: "0xfjclaimtx", setupInsufficiency: false })
		const { records } = useBridgeJournal()
		expect((records.value.find((r) => r.id === rec.id) as DepositJournalRecord).fuel?.setupInsufficiency).toBe(false)
	})

	test("direct fee-juice: an included prior fuel claim is never rebuilt; a dropped one is", async () => {
		const deps = wiredDeps()
		h.l2.txReceiptStatus = "checkpointed"
		const included = mkRec({
			id: "0xfjinc",
			assetKind: "fee-juice",
			fuel: { ...FUEL_OK, claimAttempt: true, claimTxHash: TX(1) },
		} as never)
		const why = await expectStop(await deps.claim(included, "0xsecrethex", undefined))
		expect(why).toMatch(/already included/)
		expect(h.trace.some(([n]) => n === "fuelClaim.buildFuelClaimInteraction")).toBe(false)
		h.l2.txReceiptStatus = "dropped"
		const dropped = mkRec({
			id: "0xfjdrop",
			assetKind: "fee-juice",
			fuel: { ...FUEL_OK, claimAttempt: true, claimTxHash: TX(1) },
		} as never)
		await (await deps.claim(dropped, "0xsecrethex", undefined)).simulate()
		expect(h.trace.some(([n]) => n === "fuelClaim.buildFuelClaimInteraction")).toBe(true)
	})

	test("standalone FJ settle merges into the persisted block, not the fuel captured at build time", async () => {
		const kv = memKV()
		connectJournalDeps({ kv } as never)
		const deps = wiredDeps()
		// The already-consumed shape settles immediately (the inclusion poll cannot parse the
		// harness's short standalone hash); the write site is the same `fuel` captured at build.
		h.fj.claimSendError = "No non-nullified L1 to L2 message found"
		const rec = mkRec({ fuel: { ...FUEL_OK, received: "500" } } as never)
		const i = await deps.claim(rec, rec.secret as string, undefined)
		kvPatchRecord(kv, rec.id, { fuel: { ...FUEL_OK, received: "500", messageHash: "0xfromothertab" } } as never)
		h.trace.length = 0
		await i.send()
		await new Promise((r) => setTimeout(r, 20))
		const settle = fuelPatches().find((f) => f?.standaloneClaimed === true)
		expect(settle).toMatchObject({ standaloneClaimed: true, messageHash: "0xfromothertab" })
	})

	test("reconcileFuelConsumed merges into the persisted block, not the copy it read before its await", async () => {
		const kv = memKV()
		connectJournalDeps({ kv } as never)
		wiredDeps()
		h.l2.txReceiptStatus = "checkpointed"
		const rec = mkRec({ fuel: { ...FUEL_OK, claimAttempt: true, claimTxHash: TX(2) } } as never)
		kvPatchRecord(kv, rec.id, { fuel: { ...FUEL_OK, claimAttempt: true, claimTxHash: TX(2), messageHash: "0xfromothertab" } } as never)
		h.trace.length = 0
		await reconcileFuelConsumed(rec.id)
		expect(fuelPatches()).toEqual([expect.objectContaining({ consumed: true, claimTxHash: TX(2), messageHash: "0xfromothertab" })])
	})

	test("an included-but-reverted receipt reads `reverted` to the journal and `included` to the fuel probe", async () => {
		const deps = wiredDeps() as unknown as { claimReceiptStatus: (txHash: string) => Promise<string> }
		h.l2.txReceiptStatus = "checkpointed"
		h.l2.txExecutionResult = "app_logic_reverted"
		expect(classifyClaimReceipt({ status: "checkpointed", executionResult: "app_logic_reverted" })).toBe("reverted")
		expect(await deps.claimReceiptStatus(TX(3))).toBe("reverted")
		expect(await fuelReceiptStatus(TX(3))).toBe("included")
	})

	test("after an fjwc claim reverted (hash cleared), the retry pays sponsored — the FJ was consumed in setup", async () => {
		const deps = wiredDeps()
		h.l2.txReceiptStatus = "checkpointed"
		h.l2.txExecutionResult = "app_logic_reverted"
		const rec = mkRec({ fuel: { ...FUEL_OK, claimAttempt: true, claimAttemptAt: 1, claimTxHash: TX(4) } } as never)
		const i = await deps.claim(rec, rec.secret as string, undefined)
		await i.simulate()
		await i.send()
		// The only fuel write is the inclusion-grade `consumed` promotion; no fjwc latch fires on send.
		expect(fuelPatches()).toEqual([expect.objectContaining({ consumed: true, claimTxHash: TX(4) })])
		expect(stableTrace()).toMatchSnapshot()
	})

	test("after a private fuel claim reverted (hash cleared), the retry stops as consumed — never a second mint", async () => {
		const deps = wiredDeps()
		h.l2.txReceiptStatus = "checkpointed"
		h.l2.txExecutionResult = "app_logic_reverted"
		const rec = mkRec({
			isPrivate: true,
			secret: undefined,
			schema: 2,
			fuel: {
				...FUEL_OK,
				bridgeSecretSalt: "0x0000000000000000000000000000000000000000000000000000000000008888",
				fpc: PRIVATE_FPC_ADDRESS,
				claimAttempt: true,
				claimAttemptAt: 1,
				claimTxHash: TX(5),
			},
		} as never)
		const why = await expectStop(await deps.claim(rec, "0x0000000000000000000000000000000000000000000000000000000000005555", undefined))
		expect(why).toMatch(/private fuel already consumed/)
	})

	test("public fueled, attempt pending: wait fail-stop", async () => {
		const deps = wiredDeps()
		h.l2.txReceiptStatus = "pending"
		const rec = mkRec({ fuel: { ...FUEL_OK, claimAttempt: true, claimTxHash: "0xoldattempt" } } as never)
		const why = await expectStop(await deps.claim(rec, rec.secret as string, undefined))
		expect(why).toMatchSnapshot()
	})

	test("public fueled, below floor: sponsored + standalone FJ fires inclusion-gated claim", async () => {
		const deps = wiredDeps()
		h.l2.txReceiptStatus = "success"
		const rec = mkRec({ fuel: { ...FUEL_OK, received: "500" } } as never)
		const i = await deps.claim(rec, rec.secret as string, undefined)
		await i.send()
		await new Promise((r) => setTimeout(r, 20))
		expect(stableTrace()).toMatchSnapshot()
	})

	test("no-fuel: allow leaves fee to the wallet picker; unverifiable and none fail-stop", async () => {
		const deps = wiredDeps()
		h.fj.publicBalance = 5n
		const allow = mkRec({})
		const iAllow = await deps.claim(allow, allow.secret as string, undefined)
		await iAllow.simulate()

		h.fj.publicBalance = 0n
		h.fj.publicThrows = true
		const unver = mkRec({ id: "0xrecunver" })
		const whyUnver = await expectStop(await deps.claim(unver, unver.secret as string, undefined))

		h.fj.publicThrows = false
		const none = mkRec({ id: "0xrecnone" })
		const whyNone = await expectStop(await deps.claim(none, none.secret as string, undefined))
		expect({ whyUnver, whyNone }).toMatchSnapshot()
		expect(stableTrace()).toMatchSnapshot()
	})

	test("no-fuel private token: claim_private, wallet-picker fee", async () => {
		const deps = wiredDeps()
		h.fj.publicBalance = 5n
		const rec = mkRec({ isPrivate: true, secret: undefined })
		const i = await deps.claim(rec, "0x0000000000000000000000000000000000000000000000000000000000005555", undefined)
		await i.simulate()
		expect(stableTrace()).toMatchSnapshot()
	})
})

describe("recoverDepositLeg characterization", () => {
	test("pending, reverted, and event-less receipts", async () => {
		const deps = wiredDeps()
		const pending = mkRec({ id: "0xrp", depositTxHash: "0xrecpending" })
		expect(await deps.recoverDepositLeg(pending)).toBe("pending")
		const reverted = mkRec({ id: "0xrr", depositTxHash: "0xrecreverted" })
		await expect(deps.recoverDepositLeg(reverted)).rejects.toThrow(/reverted/)
		const noEvent = mkRec({ id: "0xrn", depositTxHash: "0xrecnoevent" })
		await expect(deps.recoverDepositLeg(noEvent)).rejects.toThrow(/no recognizable deposit event/)
		expect(stableTrace()).toMatchSnapshot()
	})

	test("fee-juice record recovers from DepositToAztecPublic", async () => {
		const deps = wiredDeps()
		const rec = mkRec({ id: "0xrfj", assetKind: "fee-juice", depositTxHash: "0xrecfj", fuel: { ...FUEL_OK } } as never)
		expect(await deps.recoverDepositLeg(rec)).toBe("recovered")
		expect(stableTrace()).toMatchSnapshot()
	})

	test("fueled record recovers token + fuel legs from BridgeWithFuel", async () => {
		const deps = wiredDeps()
		const rec = mkRec({
			id: "0xrfu",
			schema: 2,
			depositTxHash: "0xrecfueled",
			fuel: { ...FUEL_OK, received: undefined, leafIndex: undefined },
		} as never)
		expect(await deps.recoverDepositLeg(rec)).toBe("recovered")
		expect(stableTrace()).toMatchSnapshot()
	})

	test("schema-2 record without fuel data fails closed on a fuel-less receipt", async () => {
		const deps = wiredDeps()
		const rec = mkRec({
			id: "0xrs2",
			schema: 2,
			depositTxHash: "0xrecplain",
			fuel: { ...FUEL_OK, received: undefined, leafIndex: undefined },
		} as never)
		await expect(deps.recoverDepositLeg(rec)).rejects.toThrow(/can't be recovered from the chain/)
	})

	test("plain record recovers its leaf from the Inbox MessageSent fallback", async () => {
		const deps = wiredDeps()
		const rec = mkRec({ id: "0xrpl", depositTxHash: "0xrecplain" })
		expect(await deps.recoverDepositLeg(rec)).toBe("recovered")
		expect(stableTrace()).toMatchSnapshot()
	})
})

describe("spec pins over the harness (witness law vs INPUT semantics)", () => {
	test("private/fueled witness: zeroed aztecRecipient, FPC fuelRecipient, amount law, swapTarget bound", async () => {
		await runDeposit(5000n, true, 1000n)
		const typed = h.trace.find(([n]) => n === "l1.signTypedData")?.[1] as { message: Record<string, unknown> }
		const w = typed.message.witness as Record<string, unknown>
		expect(w.aztecRecipient).toBe(`0x${"0".repeat(64)}`)
		expect(String(w.fuelRecipient)).toBe(PRIVATE_FPC_ADDRESS)
		expect(w.totalAmount).toBe(5000n)
		expect(w.fuelAmount).toBe(1000n)
		expect(w.swapTarget).toBe("0x00000000000000000000000000000000000000ee")
		const call = h.trace.find(([n, d]) => n === "l1.writeContract" && (d as { fn: string }).fn === "bridgeWithFuel")?.[1] as {
			args: [Record<string, unknown>, unknown]
		}
		// Calldata mirrors the SIGNED witness field-for-field (a consistent wrong value in both
		// is the theft shape — hence the comparison against the raw inputs above, not just parity).
		expect(call.args[0].totalAmount).toBe(5000n)
		expect(call.args[0].fuelAmount).toBe(1000n)
		expect(call.args[0].aztecRecipient).toBe(w.aztecRecipient)
		expect(call.args[0].fuelRecipient).toBe(w.fuelRecipient)
		// Token-claim record amount law: total minus fuel.
		const added = h.trace.find(([n]) => n === "journal.addRecordVerified")
		const rec = (added?.[1] as [Record<string, unknown>] | undefined)?.[0]
		expect(rec?.amount).toBe("4000")
	})

	test("public/fueled witness: user fuelRecipient, real aztecRecipient", async () => {
		await runDeposit(5000n, false, 1000n)
		const typed = h.trace.find(([n]) => n === "l1.signTypedData")?.[1] as { message: Record<string, unknown> }
		const w = typed.message.witness as Record<string, unknown>
		expect(String(w.aztecRecipient)).toBe(RECIPIENT)
		expect(String(w.fuelRecipient)).toBe(RECIPIENT)
	})

	test("plain witness zeroes every fuel field", async () => {
		h.fj.publicBalance = 5n
		await runDeposit(1000n, false)
		const typed = h.trace.find(([n]) => n === "l1.signTypedData")?.[1] as { message: Record<string, unknown> }
		const w = typed.message.witness as Record<string, unknown>
		expect(w.fuelAmount).toBe(0n)
		expect(w.fuelRecipient).toBe(`0x${"0".repeat(64)}`)
		expect(w.fuelSecretHash).toBe(`0x${"0".repeat(64)}`)
		expect(w.minFuelOutput).toBe(0n)
		expect(w.routeHash).toBe(`0x${"0".repeat(64)}`)
	})
})

describe("private ladder: the remaining decisions fail-stop (never public)", () => {
	test("consumed: never re-mint; pending attempt: wait", async () => {
		const deps = wiredDeps()
		const consumed = mkRec({
			id: "0xrpc",
			isPrivate: true,
			secret: undefined,
			schema: 2,
			fuel: { ...FUEL_OK, claimAttempt: true, consumed: true, bridgeSecretSalt: "0x8888", fpc: PRIVATE_FPC_ADDRESS },
		} as never)
		const whyConsumed = await expectStop(await deps.claim(consumed, "0x5555", undefined))
		expect(whyConsumed).toContain("not re-minting")

		h.l2.txReceiptStatus = "pending"
		const waiting = mkRec({
			id: "0xrpw",
			isPrivate: true,
			secret: undefined,
			schema: 2,
			fuel: {
				...FUEL_OK,
				claimAttempt: true,
				claimAttemptAt: 1_700_000_000_000,
				claimTxHash: "0xpriorpriv",
				bridgeSecretSalt: "0x8888",
				fpc: PRIVATE_FPC_ADDRESS,
			},
		} as never)
		const whyWait = await expectStop(await deps.claim(waiting, "0x5555", undefined))
		expect(whyWait).toContain("waiting for its receipt")
	})
})

describe("commitment identity + envelope round-trip (codex impl-review pins)", () => {
	test("private/plain: the record id IS hash(deriveTokenClaimSecret(secret, recipient)); the finalized envelope decrypts to the full claim material", async () => {
		h.fj.publicBalance = 5n
		const id = await runDeposit(1000n, true)
		// Seeded Fr.random sequence: the token secret is the FIRST draw (0x1111).
		const secret = new Fr(0x1111n)
		const expectedId = (await computeSecretHash(deriveTokenClaimSecret(secret, AztecAddress.fromStringUnsafe(RECIPIENT)))).toString()
		expect(id).toBe(expectedId)

		// Decrypt the FINALIZED envelope with the recovery key derived from the (fake, fixed)
		// seal signature — proves the re-sealed material, not just its presence.
		const rec = useBridgeJournal().records.value.find((r) => r.id === id) as { sealedEnvelope?: string } | undefined
		const key = await recoveryKeyFromSignature(`0x${"a".repeat(130)}`)
		const envelope = await openDepositEnvelope(key, rec?.sealedEnvelope as string)
		expect(envelope).toMatchObject({
			secret: secret.toString(),
			recipient: RECIPIENT,
			amount: "1000",
			sealerL1: FROM,
			leafIndex: "11",
		})
	})

	test("private/fueled: the commitment binds the SECOND Fr draw (the first is the fuel salt)", async () => {
		const id = await runDeposit(5000n, true, 1000n)
		const tokenSecret = new Fr(0x1112n)
		const expectedId = (
			await computeSecretHash(deriveTokenClaimSecret(tokenSecret, AztecAddress.fromStringUnsafe(RECIPIENT)))
		).toString()
		expect(id).toBe(expectedId)
	})

	test("public/plain: the commitment is hash(rawSecret) — no derivation", async () => {
		h.fj.publicBalance = 5n
		const id = await runDeposit(1000n, false)
		const expectedId = (await computeSecretHash(new Fr(0x1111n))).toString()
		expect(id).toBe(expectedId)
	})
})

describe("public ladder: sponsored arm + wait sendWhy (codex impl-review pins)", () => {
	test("user override routes to plain sponsored — no fjwc latch, no standalone claim", async () => {
		const deps = wiredDeps()
		const rec = mkRec({ id: "0xrovr", fuel: { ...FUEL_OK } } as never)
		overrideFuelClaim("0xrovr")
		const i = await deps.claim(rec, rec.secret as string, undefined)
		await i.simulate()
		await i.send()
		const feeSeen = h.trace.find(([n]) => n === "bridge.claim_public.simulate")?.[1] as { fee: { paymentMethod: string } }
		expect(feeSeen.fee.paymentMethod).toBe("SponsoredFeePaymentMethod")
		expect(h.trace.some(([n]) => n === "journal.updateRecord")).toBe(false)
		expect(h.trace.some(([n]) => n === "fj.claim.send")).toBe(false)
	})

	test("a consumed prior attempt routes to plain sponsored", async () => {
		const deps = wiredDeps()
		const rec = mkRec({ id: "0xrcon", fuel: { ...FUEL_OK, claimAttempt: true, consumed: true } } as never)
		const i = await deps.claim(rec, rec.secret as string, undefined)
		await i.simulate()
		const feeSeen = h.trace.find(([n]) => n === "bridge.claim_public.simulate")?.[1] as { fee: { paymentMethod: string } }
		expect(feeSeen.fee.paymentMethod).toBe("SponsoredFeePaymentMethod")
	})

	test("the wait stop keeps the historical ASYMMETRIC messages (send is shorter)", async () => {
		const deps = wiredDeps()
		h.l2.txReceiptStatus = "pending"
		const rec = mkRec({ id: "0xrwait", fuel: { ...FUEL_OK, claimAttempt: true, claimTxHash: "0xoldattempt" } } as never)
		const i = await deps.claim(rec, rec.secret as string, undefined)
		await expect(i.simulate()).rejects.toThrow("fuel claim attempt pending - waiting for its receipt before retrying")
		await expect(i.send()).rejects.toThrow(/^fuel claim attempt pending$/)
	})
})
