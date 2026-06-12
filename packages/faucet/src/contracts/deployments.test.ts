import { AztecAddress } from "@aztec/aztec.js/addresses"
import { describe, expect, it } from "vitest"
import { DEPLOYMENT_RECORDS, DRIPPER, ETH, USDC } from "./deployments"

describe("deployments.json invariants", () => {
	it("dripper address parses as AztecAddress and is non-zero", () => {
		expect(DRIPPER).toBeInstanceOf(AztecAddress)
		expect(DRIPPER.equals(AztecAddress.ZERO)).toBe(false)
	})

	it("USDC and ETH addresses parse and differ from each other and the dripper", () => {
		expect(USDC).toBeInstanceOf(AztecAddress)
		expect(ETH).toBeInstanceOf(AztecAddress)
		expect(USDC.equals(DRIPPER)).toBe(false)
		expect(ETH.equals(DRIPPER)).toBe(false)
		expect(USDC.equals(ETH)).toBe(false)
	})

	it("every token's minter equals the dripper address", () => {
		for (const record of [DEPLOYMENT_RECORDS.usdc, DEPLOYMENT_RECORDS.eth]) {
			const minter = AztecAddress.fromString(record.constructorArgs.minter)
			expect(minter.equals(DRIPPER)).toBe(true)
		}
	})

	it("USDC has decimals=6 and ETH has decimals=18 (and constructor_with_minter for both)", () => {
		expect(DEPLOYMENT_RECORDS.usdc.constructorArgs.decimals).toBe(6)
		expect(DEPLOYMENT_RECORDS.eth.constructorArgs.decimals).toBe(18)
		expect(DEPLOYMENT_RECORDS.usdc.constructorArtifact).toBe("constructor_with_minter")
		expect(DEPLOYMENT_RECORDS.eth.constructorArtifact).toBe("constructor_with_minter")
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
