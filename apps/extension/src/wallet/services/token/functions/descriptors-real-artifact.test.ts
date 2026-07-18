import { describe, expect, test } from "vitest"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { TOKEN_FN_DESCRIPTORS } from "./descriptors"
import { getDefaultTokenFn, getTokenFnCandidates } from "./runtime"
import type { TokenArtifact } from "./types"

/**
 * Pins descriptor matching against the REAL installed `@aztec-foundation/aztec-standards`
 * Token artifact — the artifact every e2e token and (post-redeploy) the live NULO token are
 * built from. This is the regression net for the crate-prefixed struct-path breakage: the
 * 5.0.1 artifact namespaces AztecAddress params as
 * `authorization_contract::aztec::protocol_types::...::AztecAddress`, which exact-path
 * predicates rejected — every balance/transfer kind resolved to zero candidates, so imports
 * came back `isComplete: false` and the popup dead-ended with "Couldn't auto-detect this
 * token's interface" (the network-suite `importToken` timeout). If a future standards bump
 * reshapes the ABI again, THIS file is the first thing that must go red.
 */

const artifact = TokenContractArtifact as unknown as TokenArtifact

const EXPECTED_DEFAULTS: Record<keyof typeof TOKEN_FN_DESCRIPTORS, string> = {
	getName: "name",
	getSymbol: "symbol",
	getDecimals: "decimals",
	balanceOfPrivate: "balance_of_private",
	balanceOfPublic: "balance_of_public",
	transferPrivate: "transfer_private_to_private",
	transferPublic: "transfer_public_to_public",
	transferPrivateToPublic: "transfer_private_to_public",
	transferPublicToPrivate: "transfer_public_to_private",
}

describe("descriptor matching vs the installed aztec-standards Token artifact", () => {
	test("the artifact still splits public fns into nonDispatchPublicFunctions", () => {
		// If a future @aztec/stdlib stops splitting, the source arrays (and the
		// descriptors' `source` variants) need re-auditing — surface it loudly.
		expect(artifact.nonDispatchPublicFunctions?.length ?? 0).toBeGreaterThan(0)
		expect(artifact.functions.length).toBeGreaterThan(0)
	})

	test("AztecAddress params arrive crate-prefixed (the shape that broke exact matching)", () => {
		const bal = artifact.functions.find((f) => f.name === "balance_of_private")
		expect(bal).toBeDefined()
		const path = (bal?.parameters[0]?.type as { path?: string })?.path
		expect(path).toMatch(/::aztec::protocol_types::address::aztec_address::AztecAddress$/)
	})

	for (const [kind, expected] of Object.entries(EXPECTED_DEFAULTS)) {
		test(`${kind} resolves default ${expected}`, () => {
			const descriptor = TOKEN_FN_DESCRIPTORS[kind as keyof typeof TOKEN_FN_DESCRIPTORS]
			const candidates = getTokenFnCandidates(descriptor, artifact)
			expect(candidates.length, `${kind}: no candidates matched`).toBeGreaterThan(0)
			const def = getDefaultTokenFn(descriptor, candidates)
			expect(def?.name, `${kind}: default did not resolve`).toBe(expected)
		})
	}

	test("all nine kinds resolve — the parse-level completeness gate", () => {
		const unresolved = Object.entries(TOKEN_FN_DESCRIPTORS)
			.filter(([, d]) => !getDefaultTokenFn(d, getTokenFnCandidates(d, artifact)))
			.map(([kind]) => kind)
		expect(unresolved).toEqual([])
	})
})
