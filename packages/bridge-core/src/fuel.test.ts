import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { computeSecretHash } from "@aztec/stdlib/hash"
import { describe, expect, it } from "vitest"
import { assertFuelClearsFloor, feeJuiceDepositArgs, parseFeeJuiceDeposit, planPrivateFuelDeposit, planPublicFuelDeposit } from "./fuel"
import { PRIVATE_FPC_ADDRESS, deriveBridgeSecret } from "./private-fuel"

const recipient = AztecAddress.fromNumber(0x1234)

describe("fuel — deposit planning", () => {
	it("public: recipient-bound, random secret, matching secretHash, correct args", async () => {
		const plan = await planPublicFuelDeposit(recipient, 1000n)
		expect(plan.isPrivate).toBe(false)
		expect(plan.to).toBe(recipient.toString())
		expect(plan.salt).toBeUndefined()
		expect(plan.secretHash).toBe((await computeSecretHash(plan.secret)).toString())
		expect(feeJuiceDepositArgs(plan)).toEqual([recipient.toString(), 1000n, plan.secretHash])
		// Random: a second plan must not reuse the secret.
		const plan2 = await planPublicFuelDeposit(recipient, 1000n)
		expect(plan2.secret.toString()).not.toBe(plan.secret.toString())
	})

	it("private: FPC-bound, secret DERIVED from salt+claimer (never random — anti-stranding), reproducible", async () => {
		const salt = new Fr(42n)
		const plan = await planPrivateFuelDeposit(recipient, 2000n, salt)
		expect(plan.isPrivate).toBe(true)
		expect(plan.to).toBe(PRIVATE_FPC_ADDRESS)
		expect(plan.salt?.toString()).toBe(salt.toString())
		// The claimer reconstructs this from msg_sender; a random secret would strand the FJ forever.
		expect(plan.secret.toString()).toBe(deriveBridgeSecret(salt, recipient).toString())
		// Same salt + claimer ⇒ same secret (the recovery guarantee).
		const plan2 = await planPrivateFuelDeposit(recipient, 2000n, salt)
		expect(plan2.secret.toString()).toBe(plan.secret.toString())
	})
})

describe("fuel — event parse", () => {
	it("throws when no DepositToAztecPublic event is present", () => {
		expect(() => parseFeeJuiceDeposit([])).toThrow(/DepositToAztecPublic/)
	})
})

describe("fuel — fail-closed floor", () => {
	it("undefined floor fails CLOSED (never silently skipped)", () => {
		expect(() => assertFuelClearsFloor(10n ** 30n, undefined)).toThrow(/not configured/)
	})
	it("zero / non-positive floor fails CLOSED", () => {
		expect(() => assertFuelClearsFloor(10n ** 30n, 0n)).toThrow(/not configured/)
	})
	it("received below the floor throws", () => {
		expect(() => assertFuelClearsFloor(5n, 10n)).toThrow(/below the safe claim floor/)
	})
	it("received at or above the floor passes", () => {
		expect(() => assertFuelClearsFloor(10n, 10n)).not.toThrow()
		expect(() => assertFuelClearsFloor(11n, 10n)).not.toThrow()
	})
})
