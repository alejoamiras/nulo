import { describe, expect, test } from "vitest"
import { PXE_SUBSET_METHODS } from "./subset"

describe("PXE_SUBSET_METHODS", () => {
	test("is the 18-method in-process subset with no duplicates", () => {
		expect(PXE_SUBSET_METHODS).toHaveLength(18)
		expect(new Set(PXE_SUBSET_METHODS).size).toBe(18)
	})

	test("excludes the SW-only methods (the deliberate Methods − IPXE delta)", () => {
		// These three live on the full `Methods` surface but are intentionally
		// NOT exposed per-network in-process; the type assertions in subset.ts
		// enforce the inclusion side, this pins the exclusion rationale.
		for (const swOnly of ["getNoteSchemas", "getBlockTimestamp", "clearChainState"]) {
			expect(PXE_SUBSET_METHODS as readonly string[]).not.toContain(swOnly)
		}
	})
})
