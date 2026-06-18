import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { DepositJournalRecord } from "@nulo/bridge-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

const claimMethod = vi.fn(() => ({
	simulate: async () => ({}),
	send: async () => ({ receipt: { txHash: "0xpubclaim" } }),
}))

vi.mock("@aztec/aztec.js/contracts", () => ({
	Contract: { at: vi.fn(async () => ({ methods: { claim_and_end_setup: claimMethod } })) },
	BatchCall: vi.fn(),
}))
vi.mock("@aztec/noir-contracts.js/FeeJuice", () => ({ FeeJuiceContractArtifact: {} }))

import { buildFuelClaimInteraction } from "./fuelClaim"

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
