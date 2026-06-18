import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import type { DepositJournalRecord } from "@nulo/bridge-core"
import { type Mock, beforeEach, describe, expect, it, vi } from "vitest"

const claimMethod = vi.fn(() => ({
	simulate: async () => ({}),
	send: async () => ({ receipt: { txHash: "0xpubclaim" } }),
}))

vi.mock("@aztec/aztec.js/contracts", () => ({
	Contract: { at: vi.fn(async () => ({ methods: { claim_and_end_setup: claimMethod } })) },
	// biome-ignore lint/complexity/useArrowFunction: `new BatchCall(...)` needs a constructable fn, not an arrow.
	BatchCall: vi.fn(function () {
		return { simulate: async () => ({}), send: async () => ({ receipt: { txHash: "0xprivclaim" } }) }
	}),
}))
vi.mock("@aztec/noir-contracts.js/FeeJuice", () => ({ FeeJuiceContractArtifact: {} }))
// Keep every real export EXCEPT the two that the private claim feeds the salt into — stub them so we can
// (a) capture which salt the builder routed to `privateMintAndPayFee`, and (b) avoid real poseidon in jsdom
// (deriveBridgeSecret would compute an @aztec hash — the module-load-crash class).
vi.mock("@nulo/bridge-core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@nulo/bridge-core")>()
	return { ...actual, privateMintAndPayFee: vi.fn(() => ({})), deriveBridgeSecret: vi.fn(() => Fr.fromString("0xdead")) }
})

import { privateMintAndPayFee } from "@nulo/bridge-core"
import { buildFuelClaimInteraction } from "./fuelClaim"

const saltArgOf = (call = 0): Fr => (privateMintAndPayFee as unknown as Mock).mock.calls[call][3] as Fr
const secretArgOf = (call = 0): Fr => (claimMethod.mock.calls[call] as unknown as Fr[])[2]

const RECIPIENT = AztecAddress.fromNumber(0x1234)
const SPONSORED = AztecAddress.fromNumber(0x5)
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
	sponsoredFpc: SPONSORED,
	minFloorFj: FLOOR,
	...over,
})

describe("buildFuelClaimInteraction — fail-closed guards", () => {
	beforeEach(() => claimMethod.mockClear())

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

	it("private with an UNCONFIGURED floor ⇒ stop (never silently skipped)", async () => {
		const i = await buildFuelClaimInteraction(
			rec({ isPrivate: true, fuel: { received: ABOVE_FLOOR, bridgeSecretSalt: "0x1", leafIndex: "7" } }),
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
})

describe("buildFuelClaimInteraction — public claim", () => {
	beforeEach(() => claimMethod.mockClear())

	it("builds claim_and_end_setup(recipient, received, secret, leaf) paid by the Sponsored FPC", async () => {
		const i = await buildFuelClaimInteraction(rec({}), deps())
		expect(await i.send()).toEqual({ txHash: "0xpubclaim" })
		const [to, amount] = claimMethod.mock.calls[0] as unknown as [AztecAddress, bigint]
		expect(to).toBe(RECIPIENT)
		expect(amount).toBe(BigInt(ABOVE_FLOOR))
	})
})

// The engine unseals the authoritative claim material (private: envelope.salt; public: the gated
// rec.secret) and threads it in. The builder must PREFER it over the plaintext journal copy — trusting
// the display copy strands a recoverable private deposit if it is missing/corrupted (codex post-impl HIGH)
// and lets a public claim diverge from the secret the engine gated on (codex LOW).
describe("buildFuelClaimInteraction — authoritative claim material wins over the journal plaintext", () => {
	beforeEach(() => {
		claimMethod.mockClear()
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
		expect(await i.send()).toEqual({ txHash: "0xprivclaim" })
	})

	it("PRIVATE: falls back to the plaintext salt when the engine passes none (legacy/no-envelope)", async () => {
		await buildFuelClaimInteraction(
			rec({ isPrivate: true, fuel: { received: ABOVE_FLOOR, leafIndex: "7", bridgeSecretSalt: "0x4444" } }),
			deps(),
		)
		expect(saltArgOf().toString()).toBe(Fr.fromString("0x4444").toString())
	})

	it("PUBLIC: claims with the engine-gated resolvedSecret, NOT a divergent fuel.secret", async () => {
		const i = await buildFuelClaimInteraction(
			rec({ fuel: { received: ABOVE_FLOOR, leafIndex: "7", secret: "0xbad" } }),
			deps({ resolvedSecret: "0x1234" }),
		)
		await i.send() // claim_and_end_setup runs inside send, not at build time.
		expect(secretArgOf().toString()).toBe(Fr.fromString("0x1234").toString())
	})

	it("PUBLIC: falls back to fuel.secret when the engine passes no resolvedSecret", async () => {
		const i = await buildFuelClaimInteraction(rec({ fuel: { received: ABOVE_FLOOR, leafIndex: "7", secret: "0x99" } }), deps())
		await i.send()
		expect(secretArgOf().toString()).toBe(Fr.fromString("0x99").toString())
	})
})
