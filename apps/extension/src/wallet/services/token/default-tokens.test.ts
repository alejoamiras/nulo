// @vitest-environment node
// Node, not jsdom: bb.js poseidon2 throws std::bad_cast under jsdom.
import { loadContractArtifact } from "@aztec/stdlib/abi"
import { getContractClassFromArtifact } from "@aztec/stdlib/contract"
import { getBundledTokenClassId } from "@nulo/aztec-runtime/pxe/public-events"
// @ts-expect-error — raw JSON import via vite alias
import WonderlandTokenJson from "@wonderland-token-artifact"
import { describe, expect, test } from "vitest"
import { DEFAULT_TOKEN_SEEDS } from "./default-tokens"

describe("default-token seeds", () => {
	// Red means an `@aztec-foundation/aztec-standards` move shifted the Token class: the live
	// tokens keep the class they were deployed with, so the wallet would stop resolving them to a
	// bundled artifact. Hold the pin (aztec-update skill); the seeds' class is what the chain serves.
	test("every seed runs the aztec-standards Token class the wallet bundles", async () => {
		const bundled = (await getContractClassFromArtifact(loadContractArtifact(WonderlandTokenJson))).id.toString()
		expect(new Set(DEFAULT_TOKEN_SEEDS.map((seed) => seed.expectedClassId))).toEqual(new Set([bundled]))
		expect((await getBundledTokenClassId()).toString()).toBe(bundled)
	})
})
