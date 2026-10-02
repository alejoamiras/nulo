import { describe, expect, test } from "vitest"
import { TOKEN_FN_DESCRIPTORS } from "@/wallet/services/token/functions/descriptors"
import {
	MINT_SIGNATURES,
	TRANSFER_LABELS,
	TRANSFER_SIGNATURES,
	abiNameFitsRole,
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

describe("abiNameFitsRole", () => {
	test("the nonce role takes either nonce name and nothing else; no other role takes a nonce name", () => {
		expect(abiNameFitsRole("authwit_nonce", "authwit_nonce")).toBe(true)
		expect(abiNameFitsRole("authwit_nonce", "_nonce")).toBe(true)
		expect(abiNameFitsRole("to", "to")).toBe(true)
		for (const name of ["nonce", "__nonce", "authwitNonce", "from"]) expect(abiNameFitsRole("authwit_nonce", name), name).toBe(false)
		for (const role of ["from", "to", "amount"]) expect(abiNameFitsRole(role, "_nonce"), role).toBe(false)
	})

	test("it agrees with the transfer descriptors' own predicate on the fourth parameter's name", () => {
		const descriptor = TOKEN_FN_DESCRIPTORS.transferPublic
		const abi = descriptor.abiBuilder("transfer_public_to_public", 0)
		for (const name of ["authwit_nonce", "_nonce", "nonce", "authwitNonce"]) {
			const renamed = { ...abi, parameters: abi.parameters.map((p, i) => (i === 3 ? { ...p, name } : p)) }
			expect(descriptor.candidatePredicate(renamed, 0), name).toBe(abiNameFitsRole("authwit_nonce", name))
		}
	})
})
