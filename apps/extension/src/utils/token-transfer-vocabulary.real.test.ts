// @vitest-environment node
/**
 * The selector table against the real hash and both installed Tokens: aztec-nr's sample Token and
 * the aztec-standards Token. Nothing is mocked. Node environment on purpose: poseidon2 throws
 * `BBApiException: std::bad_cast` under jsdom, so there every hash would fail.
 */

import { describe, expect, test } from "vitest"
import { TokenContractArtifact as StandardToken } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { TokenContractArtifact as SampleToken } from "@aztec-labs/noir-contracts.js/Token"
import { type ContractArtifact, type FunctionAbi, FunctionSelector } from "@aztec-labs/stdlib/abi"
import { TOKEN_FN_DESCRIPTORS } from "@/wallet/services/token/functions/descriptors"
import { MINT_SIGNATURES, TRANSFER_SIGNATURES, VOCABULARY_SELECTORS, vocabularySelector } from "./token-transfer-vocabulary"

type Shape = Pick<FunctionAbi, "name" | "parameters">

const selectorOf = async (fn: Shape): Promise<string> => (await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters)).toString()
const keyOf = (fn: Shape): string => `${fn.name}/${fn.parameters.length}`
const functionsOf = (artifact: ContractArtifact): FunctionAbi[] => [...artifact.functions, ...artifact.nonDispatchPublicFunctions]

/** Every shape as the descriptors' builder emits it; a mint takes the two-argument transfer's types. */
const vocabularyShapes = (): Shape[] => {
	const transfers = Object.values(TOKEN_FN_DESCRIPTORS)
		.filter((d) => d.fnType === "call")
		.flatMap((d) => d.defaultNames.flatMap((name) => d.variants.map((v) => d.abiBuilder(name, v.impl))))
	const toAmount = TOKEN_FN_DESCRIPTORS.transferPrivate.abiBuilder("transfer", 0).parameters
	expect(toAmount.map((p) => p.name)).toEqual(["to", "amount"])
	return [...transfers, ...[...MINT_SIGNATURES.keys()].map((name) => ({ name, parameters: toAmount }))]
}

const STANDARD_IN_VOCABULARY = [
	"mint_to_private/2",
	"mint_to_public/2",
	"transfer_private_to_private/4",
	"transfer_private_to_public/4",
	"transfer_public_to_private/4",
	"transfer_public_to_public/4",
]
const SAMPLE_IN_VOCABULARY = [
	"mint_to_private/2",
	"mint_to_public/2",
	"transfer/2",
	"transfer_in_private/4",
	"transfer_in_public/4",
	"transfer_to_private/2",
	"transfer_to_public/4",
]
/** The standard Token's other `(from, …, _nonce)` functions: a commitment is not a recipient. */
const STANDARD_OUTSIDE = [
	"burn_private",
	"burn_public",
	"transfer_private_to_commitment",
	"transfer_public_to_commitment",
	"transfer_private_to_public_with_commitment",
]

describe("the vocabulary's selector table", () => {
	test("every entry is the real hash of the vocabulary's own signature", async () => {
		const shapes = vocabularyShapes()
		expect(shapes).toHaveLength(16)
		for (const shape of shapes)
			expect(vocabularySelector(shape.name, shape.parameters.length), keyOf(shape)).toBe(await selectorOf(shape))
	})

	test("it holds exactly the vocabulary's shapes, each at its own selector", () => {
		const signatures = [...TRANSFER_SIGNATURES, ...MINT_SIGNATURES].flatMap(([name, list]) =>
			list.map((s: { params: readonly string[] }) => `${name}/${s.params.length}`),
		)
		expect([...VOCABULARY_SELECTORS.keys()].sort()).toEqual(signatures.sort())
		expect(new Set(VOCABULARY_SELECTORS.values()).size).toBe(VOCABULARY_SELECTORS.size)
	})

	test.each([
		["aztec-standards", StandardToken, STANDARD_IN_VOCABULARY],
		["sample", SampleToken, SAMPLE_IN_VOCABULARY],
	] as const)("the %s Token's transfers and mints sit at their entries", async (_label, artifact, expected) => {
		const inVocabulary = functionsOf(artifact).filter((fn) => vocabularySelector(fn.name, fn.parameters.length) !== undefined)
		expect(inVocabulary.map(keyOf).sort()).toEqual(expected)
		for (const fn of inVocabulary) expect(await selectorOf(fn), keyOf(fn)).toBe(vocabularySelector(fn.name, fn.parameters.length))
	})

	test("the standard Token's burns and commitment transfers sit at none of them", async () => {
		const table = new Set(VOCABULARY_SELECTORS.values())
		for (const name of STANDARD_OUTSIDE) {
			const fn = functionsOf(StandardToken).find((f) => f.name === name)
			if (!fn) throw new Error(`the standard Token has no ${name}`)
			expect(table.has(await selectorOf(fn)), name).toBe(false)
		}
	})
})
