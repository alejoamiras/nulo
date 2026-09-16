import { describe, expect, test } from "vitest"
import {
	MINT_SIGNATURES,
	TRANSFER_LABELS,
	TRANSFER_SIGNATURES,
	findMintSignature,
	findTransferSignature,
	transferLabel,
} from "./token-transfer-vocabulary"
import { getMethodLabel } from "./tx-enrichment"

// Hand-written, NOT derived from the descriptors: a descriptor edit (a renamed default, a dropped
// variant, a reordered parameter) must red this table, and a per-name map that keeps one shape
// per name cannot equal it — `transfer` has two.
const TWO = ["to", "amount"]
const FOUR = ["from", "to", "amount", "authwit_nonce"]
const EXPECTED: Record<string, { kind: string; params: string[] }[]> = {
	transfer_private_to_private: [
		{ kind: "transferPrivate", params: TWO },
		{ kind: "transferPrivate", params: FOUR },
	],
	transfer: [
		{ kind: "transferPrivate", params: TWO },
		{ kind: "transferPrivate", params: FOUR },
	],
	transfer_in_private: [
		{ kind: "transferPrivate", params: TWO },
		{ kind: "transferPrivate", params: FOUR },
	],
	transfer_public_to_public: [{ kind: "transferPublic", params: FOUR }],
	transfer_in_public: [{ kind: "transferPublic", params: FOUR }],
	transfer_private_to_public: [{ kind: "transferPrivateToPublic", params: FOUR }],
	transfer_to_public: [{ kind: "transferPrivateToPublic", params: FOUR }],
	transfer_public_to_private: [
		{ kind: "transferPublicToPrivate", params: TWO },
		{ kind: "transferPublicToPrivate", params: FOUR },
	],
	transfer_to_private: [
		{ kind: "transferPublicToPrivate", params: TWO },
		{ kind: "transferPublicToPrivate", params: FOUR },
	],
}

describe("token-transfer vocabulary", () => {
	test("equals the independent nine-name table, arities and parameter names included", () => {
		expect(Object.fromEntries(TRANSFER_SIGNATURES)).toEqual(EXPECTED)
	})

	test("matches on (name, arity): transfer takes both shapes, a 3-argument transfer is nothing", () => {
		expect(findTransferSignature("transfer", 2)?.params).toEqual(TWO)
		expect(findTransferSignature("transfer", 4)?.params).toEqual(FOUR)
		expect(findTransferSignature("transfer", 3)).toBeUndefined()
		expect(findTransferSignature("transfer_in_public", 2)).toBeUndefined()
		expect(findTransferSignature("mint_to_private", 2)).toBeUndefined()
	})

	test("every recognized name has a transfer label on the trust surface; shield and claim keep theirs", () => {
		const byKind = { ...TRANSFER_LABELS }
		for (const [name, signatures] of TRANSFER_SIGNATURES) {
			expect(transferLabel(name)).toBe(byKind[signatures[0].kind])
			expect(getMethodLabel(name)).toBe(byKind[signatures[0].kind])
		}
		expect(transferLabel("shield")).toBeNull()
		expect(getMethodLabel("shield")).toBe("Shield")
		expect(getMethodLabel("claim")).toBe("Claim Fee Juice")
		expect(getMethodLabel("mint_to_private")).toBe("Mint (private)")
	})
})

describe("token-mint vocabulary", () => {
	test("the two standard mints take (to, amount) and nothing else; a mint is never a transfer", () => {
		expect(Object.fromEntries(MINT_SIGNATURES)).toEqual({
			mint_to_private: [{ kind: "mintPrivate", params: TWO }],
			mint_to_public: [{ kind: "mintPublic", params: TWO }],
		})
		expect(findMintSignature("mint_to_private", 2)?.params).toEqual(TWO)
		expect(findMintSignature("mint_to_public", 3)).toBeUndefined()
		expect(findMintSignature("transfer", 2)).toBeUndefined()
		expect(findTransferSignature("mint_to_private", 2)).toBeUndefined()
	})
})
