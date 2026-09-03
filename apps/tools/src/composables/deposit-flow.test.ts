// @vitest-environment node
/**
 * Specification pins for deposit-flow.ts: secret-derivation math, both fee multipliers, the
 * fee-juice builder's latch callbacks, and the send leg's receipt recovery.
 */

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
import { computeSecretHash } from "@aztec/aztec.js/crypto"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { GasFees } from "@aztec/stdlib/gas"
import {
	type DepositJournalRecord,
	deriveBridgeSecret,
	deriveTokenClaimSecret,
	type SendDepositRecord,
	PRIVATE_HUB_CLAIM_GAS,
	SWAP_BRIDGE_ROUTER_ABI,
} from "@nulo/bridge-core"
import { encodeAbiParameters, keccak256, toHex } from "viem"
import { beforeEach, describe, expect, test, vi } from "vitest"

const h = vi.hoisted(() => {
	const calls: Array<[string, unknown]> = []
	return {
		calls,
		t: (n: string, d?: unknown) => void calls.push([n, d]),
		updateRecordThrows: false,
		/** What the node answers for a claim hash's receipt; unset = throws (unreachable). */
		receiptStatus: undefined as string | undefined,
		/** The PERSISTED record `currentRecord` answers with; undefined = nothing in the journal. */
		persisted: undefined as unknown,
	}
})

vi.mock("@/contracts/bridge-generation", () => ({
	FUEL_MIN_FJ: 1000n,
	SWAP: undefined,
}))

vi.mock("@/contracts/sponsored-fpc", () => ({
	getSponsoredFpcInstance: async () => ({ address: AztecAddress.fromStringUnsafe(`0x${"5".padStart(64, "0")}`) }),
}))

vi.mock("./useBridgeJournal", async (importOriginal) => {
	const real = (await importOriginal()) as typeof import("./useBridgeJournal")
	return {
		...real,
		updateRecord: (id: string, patch: unknown) => {
			if (h.updateRecordThrows) throw new Error("storage full")
			h.t("updateRecord", { id, patch })
		},
		currentRecord: () => h.persisted,
		discard: (id: string) => h.t("discard", id),
		flagRecordError: (id: string, msg: string) => h.t("flagRecordError", { id, msg }),
	}
})

vi.mock("./fuelClaim", () => ({
	buildFuelClaimInteraction: (_rec: unknown, opts: Record<string, unknown>) => {
		h.t("builderOpts", opts)
		return { simulate: async () => ({}), send: async () => ({ txHash: "0x1" }) }
	},
}))

vi.mock("@aztec/aztec.js/node", () => ({
	createAztecNodeClient: () => ({
		getCurrentMinFees: async () => GasFees.from({ feePerDaGas: 10n, feePerL2Gas: 20n }),
		getTxReceipt: async () => {
			if (h.receiptStatus === undefined) throw new Error("node unreachable")
			return { status: h.receiptStatus }
		},
	}),
}))

// Only the Wonderland payment method is faked, so the salt the private claim actually pays with is
// observable; every derivation around it stays real.
vi.mock("@nulo/bridge-core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@nulo/bridge-core")>()),
	privateMintAndPayFee: (_fpc: unknown, amount: bigint, secret: { toString(): string }, salt: { toString(): string }) => {
		h.t("privateMintAndPayFee", { amount, secret: secret.toString(), salt: salt.toString() })
		return { kind: "private-fpc" }
	},
}))

import { buildFeeJuiceClaimDep, recoverDepositLeg, resolveHubClaimSendOpts, resolvePrivateFuelFee } from "./deposit-flow"

const RECIPIENT = "0x1018808f2c17794badb361c02c945582b8198b495a7e8d01154f7eeb7d719c0d"

function mkRec(over: Partial<DepositJournalRecord> = {}): DepositJournalRecord {
	return {
		schema: 1,
		id: "0xspec1",
		direction: "deposit",
		isPrivate: false,
		amount: "900",
		createdAt: 1,
		updatedAt: 1,
		chainId: 11155111,
		portal: "0x00000000000000000000000000000000000000bb",
		bridge: "0x2018808f2c17794badb361c02c945582b8198b495a7e8d01154f7eeb7d719c0d",
		recipient: RECIPIENT,
		secret: "0xsecret",
		secretHashHex: "0xspec1",
		fuel: { amount: "10", secret: "0xf", secretHashHex: "0xfh", minOutput: "9" },
		...over,
	} as DepositJournalRecord
}

beforeEach(() => {
	h.calls.length = 0
	h.updateRecordThrows = false
	h.receiptStatus = undefined
	h.persisted = undefined
	vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000)
})

describe("secret-derivation conservation", () => {
	test("the private token commit hashes the DERIVED secret, never the raw salt", async () => {
		const salt = new Fr(0x5555n)
		const recipient = AztecAddress.fromStringUnsafe(RECIPIENT)
		const derived = deriveTokenClaimSecret(salt, recipient)
		const committed = await computeSecretHash(derived)
		const rawCommitted = await computeSecretHash(salt)
		expect(derived.toString()).not.toBe(salt.toString())
		expect(committed.toString()).not.toBe(rawCommitted.toString())
	})

	test("the private fuel secret is claimer-committed (recipient-bound, salt-recoverable)", () => {
		const salt = new Fr(0x8888n)
		const a = deriveBridgeSecret(salt, AztecAddress.fromStringUnsafe(RECIPIENT))
		const b = deriveBridgeSecret(salt, AztecAddress.fromStringUnsafe(RECIPIENT))
		const other = deriveBridgeSecret(salt, AztecAddress.fromStringUnsafe(`0x2018${RECIPIENT.slice(6)}`))
		expect(a.toString()).toBe(b.toString())
		expect(a.toString()).not.toBe(other.toString())
	})
})

describe("fee-juice claim builder", () => {
	test("gets RAW predicted-worst fees (no padding) and per-privacy claim material", async () => {
		await buildFeeJuiceClaimDep(mkRec({ isPrivate: false }), "0xsecrethex", undefined, {})
		await buildFeeJuiceClaimDep(mkRec({ isPrivate: true }), "0xsecrethex", { salt: "0xenvsalt" }, {})
		const [pub, priv] = h.calls.filter(([n]) => n === "builderOpts").map(([, d]) => d as Record<string, unknown>)
		expect((pub.maxFeesPerGas as { feePerDaGas: bigint }).feePerDaGas).toBe(10n)
		expect((pub.maxFeesPerGas as { feePerL2Gas: bigint }).feePerL2Gas).toBe(20n)
		expect(pub.resolvedSecret).toBe("0xsecrethex")
		expect(pub.resolvedSalt).toBeUndefined()
		expect(priv.resolvedSalt).toBe("0xenvsalt")
		expect(priv.resolvedSecret).toBeUndefined()
	})

	test("latch callbacks write journal-first shapes and insufficiency separately", async () => {
		await buildFeeJuiceClaimDep(mkRec(), "0xs", undefined, {})
		const opts = h.calls.find(([n]) => n === "builderOpts")?.[1] as {
			onAttempt: () => void
			onTxHash: (tx: string) => void
			onSetupInsufficiency: () => void
		}
		opts.onAttempt()
		opts.onTxHash("0xtx")
		opts.onSetupInsufficiency()
		const patches = h.calls.filter(([n]) => n === "updateRecord").map(([, d]) => (d as { patch: { fuel: unknown } }).patch.fuel)
		expect(patches[0]).toMatchObject({ claimAttempt: true, claimAttemptAt: 1_700_000_000_000, setupInsufficiency: false })
		expect(patches[1]).toMatchObject({ claimAttempt: true, claimTxHash: "0xtx" })
		expect(patches[2]).toMatchObject({ setupInsufficiency: true })
	})
})

describe("fee-juice claim builder — a prior claim on the PERSISTED block gates the rebuild", () => {
	// A field-sized hash: the well-formedness check is 64 hex digits AND the TxHash parser.
	const HASH = `0x${"00".repeat(31)}ab`
	const built = () => h.calls.some(([n]) => n === "builderOpts")
	const stopWhy = async (rec: DepositJournalRecord) => {
		const dep = await buildFeeJuiceClaimDep(rec, "0xs", undefined, {})
		return dep.simulate().then(
			() => undefined,
			(e: Error) => e.message,
		)
	}

	test("a consumed block never rebuilds", async () => {
		expect(await stopWhy(mkRec({ fuel: { ...mkRec().fuel, consumed: true } as never }))).toMatch(/already included/)
		expect(built()).toBe(false)
	})

	test("an included prior claim stops; a dropped one rebuilds; a pending or unreachable one waits", async () => {
		const withHash = mkRec({ fuel: { ...mkRec().fuel, claimTxHash: HASH } as never })
		h.receiptStatus = "success"
		expect(await stopWhy(withHash)).toMatch(/already included/)
		h.receiptStatus = "pending"
		expect(await stopWhy(withHash)).toMatch(/still pending/)
		h.receiptStatus = undefined
		expect(await stopWhy(withHash)).toMatch(/still pending/)
		expect(built()).toBe(false)
		h.receiptStatus = "dropped"
		expect(await stopWhy(withHash)).toBeUndefined()
		expect(built()).toBe(true)
	})

	test("a malformed persisted hash is a record fault, not a receipt to wait on", async () => {
		expect(await stopWhy(mkRec({ fuel: { ...mkRec().fuel, claimTxHash: "0xnothex" } as never }))).toMatch(/malformed/)
		expect(built()).toBe(false)
	})

	test("the gate reads the PERSISTED block over the captured one, and latches merge into it", async () => {
		// The captured record has no prior claim; the journal holds one that dropped, plus a field the
		// captured copy never saw. The latch must carry that field, not overwrite it from the copy.
		h.persisted = mkRec({ fuel: { ...mkRec().fuel, claimTxHash: HASH, leafIndex: "7" } as never })
		h.receiptStatus = "dropped"
		await buildFeeJuiceClaimDep(mkRec(), "0xs", undefined, {})
		expect(built()).toBe(true)
		const opts = h.calls.find(([n]) => n === "builderOpts")?.[1] as { onAttempt: () => void }
		opts.onAttempt()
		const patch = h.calls
			.filter(([n]) => n === "updateRecord")
			.map(([, d]) => (d as { patch: { fuel: unknown } }).patch.fuel)
			.at(-1)
		expect(patch).toMatchObject({ leafIndex: "7", claimTxHash: HASH, claimAttempt: true })
	})
})

describe("private fuel fee — the sealed salt is authoritative", () => {
	const SEALED_SALT = new Fr(0x5eaedn).toString()
	const TAMPERED_SALT = new Fr(0xbadn).toString()
	const recipient = AztecAddress.fromStringUnsafe(RECIPIENT)

	const fueled = (bridgeSecretSalt: string): SendDepositRecord =>
		mkRec({
			schema: 3,
			intent: "token+gas",
			isPrivate: true,
			secret: undefined,
			fuel: {
				amount: "10",
				secret: "0xf",
				secretHashHex: "0xfh",
				minOutput: "9",
				received: "100000000",
				leafIndex: "8",
				bridgeSecretSalt,
			},
		} as never) as unknown as SendDepositRecord

	const paidWith = () => h.calls.find(([n]) => n === "privateMintAndPayFee")?.[1] as { secret: string; salt: string }

	test("a rewritten journal salt loses to the envelope's, and the record is corrected", async () => {
		const fee = await resolvePrivateFuelFee(fueled(TAMPERED_SALT), recipient, SEALED_SALT)

		expect(fee.kind).toBe("fee")
		expect(paidWith().salt).toBe(SEALED_SALT)
		expect(paidWith().secret).toBe(deriveBridgeSecret(Fr.fromString(SEALED_SALT), recipient).toString())
		// The record is rewritten from the sealed copy, so the next retry no longer disagrees.
		const patches = h.calls
			.filter(([n]) => n === "updateRecord")
			.map(([, d]) => (d as { patch: { fuel: { bridgeSecretSalt: string } } }).patch)
		expect(patches.at(0)?.fuel.bridgeSecretSalt).toBe(SEALED_SALT)
		expect((fee as { fuel: { bridgeSecretSalt: string } }).fuel.bridgeSecretSalt).toBe(SEALED_SALT)
	})

	test("an agreeing journal salt is left alone - no rewrite, same claim", async () => {
		const fee = await resolvePrivateFuelFee(fueled(SEALED_SALT), recipient, SEALED_SALT)

		expect(fee.kind).toBe("fee")
		expect(paidWith().salt).toBe(SEALED_SALT)
		expect(h.calls.filter(([n]) => n === "updateRecord")).toHaveLength(0)
	})

	test("with no envelope opened the journal copy still drives the claim", async () => {
		await resolvePrivateFuelFee(fueled(TAMPERED_SALT), recipient)
		expect(paidWith().salt).toBe(TAMPERED_SALT)
	})

	test("the FPC claim declares explicit gas limits with the raw predicted-worst fees (no padding)", async () => {
		// Without limits the wallet declares the network's per-tx maximum and the FPC's ceiling
		// (limits × fees) outgrows any realistic fuel slice.
		const fee = await resolvePrivateFuelFee(fueled(SEALED_SALT), recipient, SEALED_SALT)
		const gas = (
			fee as { fee: { gasSettings: { gasLimits: { daGas: number; l2Gas: number }; maxFeesPerGas: { feePerL2Gas: bigint } } } }
		).fee.gasSettings
		expect({ daGas: gas.gasLimits.daGas, l2Gas: gas.gasLimits.l2Gas }).toEqual(PRIVATE_HUB_CLAIM_GAS)
		expect(gas.maxFeesPerGas.feePerL2Gas).toBe(20n)
	})

	test("a bridged amount under the committed ceiling stops before the FPC can reject it", async () => {
		// Mocked fees 10/20 → ceiling = 2_000_000·20 + 100_000·10 = 41_000_000 FJ-wei.
		const short = fueled(SEALED_SALT)
		short.fuel = { ...(short.fuel as object), received: "40999999" } as never
		const fee = await resolvePrivateFuelFee(short, recipient, SEALED_SALT)
		expect(fee.kind).toBe("stop")
		expect((fee as { why: string }).why).toMatch(/fee ceiling/)
		expect(h.calls.some(([n]) => n === "privateMintAndPayFee")).toBe(false)
	})

	test("the hub ladder pays a first-time token's registration from the sponsor, the claim from the fuel", async () => {
		const resolved = await resolveHubClaimSendOpts({
			rec: fueled(SEALED_SALT) as never,
			recipientAddr: recipient,
			aztec: {},
			userOverride: false,
			sealedSalt: SEALED_SALT,
		})
		expect(resolved.kind).toBe("opts")
		const opts = (resolved as unknown as { opts: { fee: { paymentMethod: unknown }; registerFee: { paymentMethod: unknown } } }).opts
		expect(opts.fee.paymentMethod).toEqual({ kind: "private-fpc" })
		expect(opts.registerFee.paymentMethod).toBeInstanceOf(SponsoredFeePaymentMethod)
	})
})

describe("recoverDepositLeg — send records", () => {
	const ROUTER = "0x1111111111111111111111111111111111111111" as const
	const generation = {
		router: ROUTER,
		routerAbi: SWAP_BRIDGE_ROUTER_ABI,
		permit2: "0x000000000022d473030f116ddee9f6b43ac78ba3",
		factory: "0x3333333333333333333333333333333333333333",
		implementation: "0x2222222222222222222222222222222222222222",
		feeJuicePortal: "0x4444444444444444444444444444444444444444",
		feeAsset: "0x5555555555555555555555555555555555555555",
		swapTarget: "0x6666666666666666666666666666666666666666",
		chainId: 31337,
		hub: `0x${"7".padStart(64, "0")}`,
		tokenClassId: `0x${"1".padStart(64, "0")}`,
	} as const
	const zero32 = `0x${"0".repeat(64)}` as const
	const bridgeLog = (emitter: string, index: bigint, logIndex: number) => ({
		address: emitter,
		logIndex,
		topics: [keccak256(toHex("Bridge(bytes32,bytes32,uint256,uint256,bytes32,bool)")), zero32],
		data: encodeAbiParameters(
			[{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }, { type: "bool" }],
			[`0x${"b".repeat(64)}`, index, 5n, zero32, false],
		),
		blockNumber: 1n,
		blockHash: zero32,
		transactionHash: zero32,
		transactionIndex: 0,
		removed: false,
	})
	const record = {
		id: "send-1",
		schema: 3,
		direction: "deposit",
		intent: "token",
		depositTxHash: zero32,
		chainId: 31337,
		isPrivate: false,
	} as unknown as SendDepositRecord

	test("reads the deposit leaf from the router's own event, not the first Inbox leaf", async () => {
		const client = {
			getTransactionReceipt: async () => ({
				status: "success",
				// A first deposit's receipt: a foreign same-signature log first, then the router's.
				logs: [bridgeLog("0x00000000000000000000000000000000000e2c20", 999n, 0), bridgeLog(ROUTER, 41n, 1)],
			}),
		}
		await expect(recoverDepositLeg(record, client, generation as never)).resolves.toBe("recovered")
		expect(h.calls.at(-1)).toEqual(["updateRecord", { id: "send-1", patch: { leafIndex: "41", messageHash: `0x${"b".repeat(64)}` } }])
	})

	test("a send record without a generation cannot recover", async () => {
		const client = { getTransactionReceipt: async () => ({ status: "success", logs: [] }) }
		await expect(recoverDepositLeg(record, client)).rejects.toThrow(/no bridge/)
	})
})
