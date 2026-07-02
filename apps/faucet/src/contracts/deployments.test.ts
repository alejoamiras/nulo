import { AztecAddress } from "@aztec/aztec.js/addresses"
import { describe, expect, it } from "vitest"
import { DEPLOYMENT_RECORDS, DRIPPER, OLUN, NULO } from "./deployments"

describe("deployments.json invariants", () => {
	it("dripper address parses as AztecAddress and is non-zero", () => {
		expect(DRIPPER).toBeInstanceOf(AztecAddress)
		expect(DRIPPER.equals(AztecAddress.ZERO)).toBe(false)
	})

	it("NULO and OLUN addresses parse and differ from each other and the dripper", () => {
		expect(NULO).toBeInstanceOf(AztecAddress)
		expect(OLUN).toBeInstanceOf(AztecAddress)
		expect(NULO.equals(DRIPPER)).toBe(false)
		expect(OLUN.equals(DRIPPER)).toBe(false)
		expect(NULO.equals(OLUN)).toBe(false)
	})

	it("every token's minter equals the dripper address", () => {
		for (const record of [DEPLOYMENT_RECORDS.nulo, DEPLOYMENT_RECORDS.olun]) {
			const minter = AztecAddress.fromStringUnsafe(record.constructorArgs.minter)
			expect(minter.equals(DRIPPER)).toBe(true)
		}
	})

	it("NULO has decimals=6 and OLUN has decimals=18 (and constructor_with_minter for both)", () => {
		expect(DEPLOYMENT_RECORDS.nulo.constructorArgs.decimals).toBe(6)
		expect(DEPLOYMENT_RECORDS.olun.constructorArgs.decimals).toBe(18)
		expect(DEPLOYMENT_RECORDS.nulo.constructorArtifact).toBe("constructor_with_minter")
		expect(DEPLOYMENT_RECORDS.olun.constructorArtifact).toBe("constructor_with_minter")
	})

	it("dripper record uses the parameterless constructor (no minter on the dripper itself)", () => {
		expect(DEPLOYMENT_RECORDS.dripper.constructorArtifact).toBe("constructor")
	})

	// The reconstructed-address invariant (each rebuild*Instance() address ===
	// the committed JSON address) is verified by `scripts/verify-deployments.ts`,
	// NOT here - bb.js's sync poseidon hasher needs the WASM runtime to be
	// initialized at process boot, which jsdom doesn't do. Running it as a
	// bun script (Node) is the reliable path; called from `audit:faucet`.
})
