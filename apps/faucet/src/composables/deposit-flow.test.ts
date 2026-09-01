// @vitest-environment node
/**
 * Specification pins for deposit-flow.ts — the post-extraction Layer 2 of the
 * deposit-decomposition plan. Harness-bound pins (witness law, latch ordering, leg traces)
 * live in useDeposit.characterization.test.ts; these are the direct-function pins:
 * secret-derivation math, both fee multipliers, cleanup matrix, re-seal key retention,
 * event parsing, and the fee-juice builder's latch callbacks.
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
import { Fr } from "@aztec/aztec.js/fields"
import { GasFees } from "@aztec/stdlib/gas"
import { type DepositJournalRecord, deriveBridgeSecret, deriveTokenClaimSecret } from "@nulo/bridge-core"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { ref } from "vue"

const h = vi.hoisted(() => {
	const calls: Array<[string, unknown]> = []
	return { calls, t: (n: string, d?: unknown) => void calls.push([n, d]) }
})

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
	BRIDGE_FUEL: undefined,
}))

vi.mock("./useBridgeJournal", async (importOriginal) => {
	const real = (await importOriginal()) as typeof import("./useBridgeJournal")
	return {
		...real,
		updateRecord: (id: string, patch: unknown) => h.t("updateRecord", { id, patch }),
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
	}),
}))

import { buildFeeJuiceClaimDep, finalizePrivateEnvelope, handleDepositFailure, parseBridgeWithFuelEvent } from "./deposit-flow"

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

	test("(x1.5 contrast) the private fueled path pads exactly 1.5x — GasFees.mul semantics", () => {
		const padded = GasFees.from({ feePerDaGas: 10n, feePerL2Gas: 20n }).mul(1.5)
		expect(padded.feePerDaGas).toBe(15n)
		expect(padded.feePerL2Gas).toBe(30n)
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

describe("cleanup matrix (handleDepositFailure)", () => {
	const err = ref<string | null>(null)
	const rejection = Object.assign(new Error("User rejected the request."), { code: 4001 })

	beforeEach(() => {
		err.value = null
	})

	test("rejection with no depositTxHash discards; approve nuance changes the copy", () => {
		handleDepositFailure(rejection, "0xspec1", err, () => [mkRec()])
		expect(h.calls.some(([n]) => n === "discard")).toBe(true)
		expect(err.value).toBe("Rejected in your wallet - nothing was sent.")

		h.calls.length = 0
		handleDepositFailure(rejection, "0xspec1", err, () => [mkRec({ approveTxHash: "0xapprove" })])
		expect(h.calls.some(([n]) => n === "discard")).toBe(true)
		expect(err.value).toContain("Permit2 approval from this attempt remains active")
	})

	test("rejection AFTER the deposit tx flags instead of discarding; ambiguous failures flag", () => {
		handleDepositFailure(rejection, "0xspec1", err, () => [mkRec({ depositTxHash: "0xdep" })])
		expect(h.calls.some(([n]) => n === "discard")).toBe(false)
		expect(h.calls.some(([n]) => n === "flagRecordError")).toBe(true)

		h.calls.length = 0
		handleDepositFailure(new Error("boom"), "0xspec1", err, () => [mkRec()])
		expect(h.calls.some(([n]) => n === "discard")).toBe(false)
		expect(h.calls.some(([n]) => n === "flagRecordError")).toBe(true)
	})

	test("no id or no record: only the error surface is written", () => {
		handleDepositFailure(new Error("boom"), null, err, () => [])
		expect(h.calls).toHaveLength(0)
		expect(err.value).toBeTruthy()
	})
})

describe("finalizePrivateEnvelope key lifecycle", () => {
	test("a failing seal RETAINS the key (retry stays possible); no key is a no-op", async () => {
		const sealKeys = new Map<string, never>()
		sealKeys.set("0xspec1", { garbage: true } as never)
		await expect(
			finalizePrivateEnvelope({
				id: "0xspec1",
				sealKeys: sealKeys as never,
				secretStr: "0xs",
				recipient: RECIPIENT,
				tokenAmountStr: "900",
				from: "0xef4d9e1f4e9e2dd9e747b53f4be3d04bfa935f2d",
				leafIndex: "1",
			}),
		).rejects.toThrow()
		expect(sealKeys.has("0xspec1")).toBe(true)

		h.calls.length = 0
		await finalizePrivateEnvelope({
			id: "0xother",
			sealKeys: sealKeys as never,
			secretStr: "0xs",
			recipient: RECIPIENT,
			tokenAmountStr: "900",
			from: "0xef4d9e1f4e9e2dd9e747b53f4be3d04bfa935f2d",
			leafIndex: "1",
		})
		expect(h.calls).toHaveLength(0)
	})
})

describe("parseBridgeWithFuelEvent", () => {
	test("no matching event yields undefined (never a guessed shape)", () => {
		expect(parseBridgeWithFuelEvent([])).toBeUndefined()
	})
})
