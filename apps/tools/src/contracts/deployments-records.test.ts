import { describe, expect, it } from "vitest"
import { rebuildTokenInstanceFrom, type TokenDeployment } from "./deployments.js"

// Address DERIVATION is deliberately untested here: bb.js's sync poseidon needs
// a WASM init jsdom doesn't provide (same reason verify-deployments.ts is a bun
// script). The derive path is proven by `verify-deployments [--config]` against
// real jsons; this pins the record-validation seam in front of it.

const record = (authContract?: string): TokenDeployment => ({
	address: `0x${"ab".repeat(32)}`,
	salt: 1,
	deployer: `0x${"00".repeat(32)}`,
	constructorArtifact: "constructor_with_minter",
	constructorArgs: {
		name: "Nulo",
		symbol: "NULO",
		decimals: 6,
		minter: `0x${"11".repeat(32)}`,
		...(authContract === undefined ? {} : { authContract }),
	},
})

describe("rebuildTokenInstanceFrom — 5.0.1 record validation", () => {
	it("rejects a pre-5.0.1 record (no authContract) with a targeted error, not an arity crash", async () => {
		await expect(rebuildTokenInstanceFrom(record())).rejects.toThrow(/pre-5\.0\.1 record lacks constructorArgs\.authContract/)
	})

	it("names the offending token symbol in the error", async () => {
		await expect(rebuildTokenInstanceFrom(record())).rejects.toThrow(/token NULO/)
	})
})
