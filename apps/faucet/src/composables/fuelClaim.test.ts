import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import type { DepositJournalRecord } from "@nulo/bridge-core"
import { type Mock, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@aztec/aztec.js/contracts", () => ({
	// `new BatchCall(...)` needs a constructable fn, not an arrow. BOTH paths (public + private) are now
	// carrier-less zero-app-call BatchCall([]) txs — the self-pay fee method does all the work in setup.
	// `request()` builds the payload the fixed simulate() feeds to wallet.simulateTx (NOT BatchCall.simulate,
	// which no-ops for an empty batch + ignores the fee).
	BatchCall: vi.fn(function () {
		return {
			request: async () => ({ calls: [], authWitnesses: [] }),
			simulate: async () => ({}),
			send: async () => ({ receipt: { txHash: "0xfuelclaim" } }),
		}
	}),
}))
// Keep every real export EXCEPT the fee-method builders each path feeds material into — stub them so we can
// (a) capture the salt/secret each path routed in, and (b) avoid real poseidon in jsdom (deriveBridgeSecret
// would compute an @aztec hash — the module-load-crash class).
vi.mock("@nulo/bridge-core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@nulo/bridge-core")>()
	return {
		...actual,
		privateMintAndPayFee: vi.fn(() => ({})),
		publicFeeJuicePayment: vi.fn(() => ({})),
		deriveBridgeSecret: vi.fn(() => Fr.fromString("0xdead")),
	}
})

import { privateMintAndPayFee, publicFeeJuicePayment } from "@nulo/bridge-core"
import { buildFuelClaimInteraction } from "./fuelClaim"

const saltArgOf = (call = 0): Fr => (privateMintAndPayFee as unknown as Mock).mock.calls[call][3] as Fr
// The public self-pay routes its claim into publicFeeJuicePayment(recipient, { claimAmount, claimSecret, leaf }).
const publicClaimArg = (call = 0) =>
	(publicFeeJuicePayment as unknown as Mock).mock.calls[call] as [
		AztecAddress,
		{ claimAmount: bigint; claimSecret: Fr; messageLeafIndex: bigint },
	]
const secretArgOf = (call = 0): Fr => publicClaimArg(call)[1].claimSecret

const RECIPIENT = AztecAddress.fromNumberUnsafe(0x1234)
const ABOVE_FLOOR = "100000000000000000000" // 100e18, well above the 11e18 floor
const FLOOR = 11_000_000_000_000_000_000n

const rec = (over: Record<string, unknown>): DepositJournalRecord =>
	({
		schema: 2,
		id: "0xfuel",
		direction: "deposit",
		isPrivate: false,
		amount: "100",
		createdAt: 1,
		updatedAt: 1,
		chainId: 11155111,
		portal: "0xfjportal",
		bridge: "0xfjL2",
		recipient: "0xrecipient",
		secretHashHex: "0xfuel",
		assetKind: "fee-juice",
		fuel: { amount: ABOVE_FLOOR, secret: "0x1234", secretHashHex: "0xfh", minOutput: "0", received: ABOVE_FLOOR, leafIndex: "7" },
		...over,
	}) as DepositJournalRecord

const deps = (over: Record<string, unknown> = {}) => ({
	aztec: {},
	recipient: RECIPIENT,
	minFloorFj: FLOOR,
	...over,
})

describe("buildFuelClaimInteraction — fail-closed guards", () => {
	beforeEach(() => (publicFeeJuicePayment as unknown as Mock).mockClear())

	it("no claimable Fee Juice (missing received) ⇒ stop", async () => {
		const i = await buildFuelClaimInteraction(rec({ fuel: { leafIndex: "7" } }), deps())
		await expect(i.simulate()).rejects.toThrow(/no claimable Fee Juice/)
	})

	it("private below the floor ⇒ stop (fail-closed self-pay floor)", async () => {
		const i = await buildFuelClaimInteraction(
			rec({ isPrivate: true, fuel: { received: "5", bridgeSecretSalt: "0x1", leafIndex: "7" } }),
			deps({ minFloorFj: 10n }),
		)
		await expect(i.send()).rejects.toThrow(/below the safe claim floor/)
	})

	it("public below the floor ⇒ stop (public self-pays now, so the same fail-closed floor guards it)", async () => {
		const i = await buildFuelClaimInteraction(
			rec({ fuel: { received: "5", secret: "0x1", leafIndex: "7" } }),
			deps({ minFloorFj: 10n }),
		)
		await expect(i.send()).rejects.toThrow(/below the safe claim floor/)
	})

	it("private with an UNCONFIGURED floor ⇒ stop (never silently skipped)", async () => {
		const i = await buildFuelClaimInteraction(
			rec({ isPrivate: true, fuel: { received: ABOVE_FLOOR, bridgeSecretSalt: "0x1", leafIndex: "7" } }),
			deps({ minFloorFj: undefined }),
		)
		await expect(i.simulate()).rejects.toThrow(/not configured/)
	})

	it("public with an UNCONFIGURED floor ⇒ stop (never silently skipped)", async () => {
		const i = await buildFuelClaimInteraction(
			rec({ fuel: { received: ABOVE_FLOOR, secret: "0x1", leafIndex: "7" } }),
			deps({ minFloorFj: undefined }),
		)
		await expect(i.simulate()).rejects.toThrow(/not configured/)
	})

	it("private with a DRIFTED FPC ⇒ stop (kill-switch; never claim to a drifted FPC)", async () => {
		const i = await buildFuelClaimInteraction(
			rec({ isPrivate: true, fuel: { received: ABOVE_FLOOR, bridgeSecretSalt: "0x1", fpc: "0xWRONGFPC", leafIndex: "7" } }),
			deps(),
		)
		await expect(i.simulate()).rejects.toThrow(/version drift/)
	})

	it("private missing the recovery salt ⇒ stop", async () => {
		const i = await buildFuelClaimInteraction(rec({ isPrivate: true, fuel: { received: ABOVE_FLOOR, leafIndex: "7" } }), deps())
		await expect(i.simulate()).rejects.toThrow(/missing its recovery salt/)
	})

	it("public missing the claim secret ⇒ stop", async () => {
		const i = await buildFuelClaimInteraction(rec({ fuel: { received: ABOVE_FLOOR, leafIndex: "7" } }), deps())
		await expect(i.simulate()).rejects.toThrow(/missing its claim secret/)
	})

	// Clears the static floor but NOT getFeeLimit (gasLimits*maxFees) once fees spike — the protocol's
	// balance check is against the LIMIT, so both paths must fail CLOSED before send (codex Med).
	// received = 100e18 (clears the 11e18 floor); feePerL2Gas 1e14 ⇒ public limit 1.5e20, private 4e20.
	const SPIKED = { feePerDaGas: 0n, feePerL2Gas: 100_000_000_000_000n }

	it("public clears the floor but not the fee LIMIT (fee spike) ⇒ stop", async () => {
		const i = await buildFuelClaimInteraction(rec({}), deps({ maxFeesPerGas: SPIKED }))
		await expect(i.send()).rejects.toThrow(/fee limit/)
	})

	it("private clears the floor but not the fee LIMIT (fee spike) ⇒ stop", async () => {
		const i = await buildFuelClaimInteraction(
			rec({ isPrivate: true, fuel: { received: ABOVE_FLOOR, bridgeSecretSalt: "0x1", leafIndex: "7" } }),
			deps({ maxFeesPerGas: SPIKED }),
		)
		await expect(i.send()).rejects.toThrow(/fee limit/)
	})
})

// The claim's simulate() is a load-bearing gate in useBridgeJournal: it drives the message-availability
// wait (line 704) AND recordMessageConsumed (line 820). BatchCall([]).simulate() IGNORES the fee for an
// empty batch and no-ops, so simulate MUST build the payload via request() and run it through simulateTx.
describe("buildFuelClaimInteraction — simulate validates the REAL payload, not the empty-batch no-op", () => {
	it("PUBLIC: simulate() builds the fee payload via request() and runs it through wallet.simulateTx", async () => {
		const simulateTx = vi.fn(async () => ({ ok: true }))
		const i = await buildFuelClaimInteraction(rec({}), deps({ aztec: { simulateTx } }))
		await i.simulate()
		expect(simulateTx).toHaveBeenCalledTimes(1)
	})

	it("PUBLIC: simulate() PROPAGATES a message-not-ready throw (so the gate can wait, not no-op past it)", async () => {
		const simulateTx = vi.fn(async () => {
			throw new Error("No L1 to L2 message found for message hash 0xabc")
		})
		const i = await buildFuelClaimInteraction(rec({}), deps({ aztec: { simulateTx } }))
		await expect(i.simulate()).rejects.toThrow(/No L1 to L2 message found/)
	})

	it("PRIVATE: simulate() also routes through wallet.simulateTx (shared fix; recordMessageConsumed needs it)", async () => {
		const simulateTx = vi.fn(async () => ({ ok: true }))
		const i = await buildFuelClaimInteraction(
			rec({ isPrivate: true, fuel: { received: ABOVE_FLOOR, bridgeSecretSalt: "0x1", leafIndex: "7" } }),
			deps({ aztec: { simulateTx } }),
		)
		await i.simulate()
		expect(simulateTx).toHaveBeenCalledTimes(1)
	})
})

describe("buildFuelClaimInteraction — public self-pay claim", () => {
	beforeEach(() => (publicFeeJuicePayment as unknown as Mock).mockClear())

	it("self-pays via publicFeeJuicePayment(recipient, {claimAmount, claimSecret, leaf}) — carrier-less, NO Sponsored FPC", async () => {
		const i = await buildFuelClaimInteraction(rec({}), deps())
		expect(await i.send()).toEqual({ txHash: "0xfuelclaim" })
		const [to, claim] = publicClaimArg()
		expect(to).toBe(RECIPIENT)
		expect(claim.claimAmount).toBe(BigInt(ABOVE_FLOOR))
		expect(claim.messageLeafIndex).toBe(7n)
	})
})

// The engine unseals the authoritative claim material (private: envelope.salt; public: the gated
// rec.secret) and threads it in. The builder must PREFER it over the plaintext journal copy — trusting
// the display copy strands a recoverable private deposit if it is missing/corrupted (codex post-impl HIGH)
// and lets a public claim diverge from the secret the engine gated on (codex LOW).
describe("buildFuelClaimInteraction — authoritative claim material wins over the journal plaintext", () => {
	beforeEach(() => {
		;(publicFeeJuicePayment as unknown as Mock).mockClear()
		;(privateMintAndPayFee as unknown as Mock).mockClear()
	})

	it("PRIVATE: routes the unsealed resolvedSalt, NOT a corrupted plaintext salt", async () => {
		await buildFuelClaimInteraction(
			rec({ isPrivate: true, fuel: { received: ABOVE_FLOOR, leafIndex: "7", bridgeSecretSalt: "0xbad" } }),
			deps({ resolvedSalt: "0x2222" }),
		)
		expect(saltArgOf().toString()).toBe(Fr.fromString("0x2222").toString())
	})

	it("PRIVATE: resolvedSalt RESCUES a missing plaintext salt (no false 'missing salt' fail-stop)", async () => {
		const i = await buildFuelClaimInteraction(
			rec({ isPrivate: true, fuel: { received: ABOVE_FLOOR, leafIndex: "7" } }),
			deps({ resolvedSalt: "0x3333" }),
		)
		expect(saltArgOf().toString()).toBe(Fr.fromString("0x3333").toString())
		// The build succeeded into a real interaction — not the guard's fail-stop pair.
		expect(await i.send()).toEqual({ txHash: "0xfuelclaim" })
	})

	it("PRIVATE: falls back to the plaintext salt when the engine passes none (legacy/no-envelope)", async () => {
		await buildFuelClaimInteraction(
			rec({ isPrivate: true, fuel: { received: ABOVE_FLOOR, leafIndex: "7", bridgeSecretSalt: "0x4444" } }),
			deps(),
		)
		expect(saltArgOf().toString()).toBe(Fr.fromString("0x4444").toString())
	})

	it("PUBLIC: claims with the engine-gated resolvedSecret, NOT a divergent fuel.secret", async () => {
		await buildFuelClaimInteraction(
			rec({ fuel: { received: ABOVE_FLOOR, leafIndex: "7", secret: "0xbad" } }),
			deps({ resolvedSecret: "0x1234" }),
		)
		// The self-pay fee method is built at build time (before send), so the routed secret is captured here.
		expect(secretArgOf().toString()).toBe(Fr.fromString("0x1234").toString())
	})

	it("PUBLIC: falls back to fuel.secret when the engine passes no resolvedSecret", async () => {
		await buildFuelClaimInteraction(rec({ fuel: { received: ABOVE_FLOOR, leafIndex: "7", secret: "0x99" } }), deps())
		expect(secretArgOf().toString()).toBe(Fr.fromString("0x99").toString())
	})
})
