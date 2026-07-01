/**
 * Q-12 equivalence proof. Asserts the descriptor-registry output is byte-identical to the
 * old copy-paste module it replaces, kind by kind, against the real Token artifact + synthetic
 * multi-candidate artifacts. A kind's old module is only deleted after its equivalence test is
 * green. (Currently: the 5 read/view kinds. Transfers are added as they migrate.)
 */
import type { Fr } from "@aztec/foundation/curves/bn254"
import type { ContractArtifact, FunctionAbi } from "@aztec/stdlib/abi"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
import { describe, expect, test } from "vitest"
import type { Fn, ViewFn } from "@/wallet/utils/fn"
import { BalanceOfPrivateFn } from "./balance-of-private"
import { BalanceOfPublicFn } from "./balance-of-public"
import {
	balanceOfPrivateDescriptor,
	balanceOfPublicDescriptor,
	getDecimalsDescriptor,
	getNameDescriptor,
	getSymbolDescriptor,
} from "./descriptors"
import { GetDecimalsFn } from "./get-decimals"
import { GetNameFn } from "./get-name"
import { GetSymbolFn } from "./get-symbol"
import { createTokenFn, getDefaultTokenFn, getTokenFnCandidates } from "./runtime"
import type { TokenFnDescriptor } from "./types"

// The old abstract matcher classes expose these statics; typed structurally for the loop.
type OldMatcher = {
	getCandidates(artifact: ContractArtifact): Fn[]
	getDefault(candidates: Fn[]): Fn | undefined
	new: (name: string, impl: number) => Fn
}

const abiOf = (fn: Fn): FunctionAbi => (fn as unknown as { abi(): FunctionAbi }).abi()
const shape = (fn: Fn) => ({ name: fn.name, impl: fn.getImpl().impl, type: fn.type, isStatic: fn.isStatic, abi: abiOf(fn) })
const unpack = (fn: Fn, result: Fr[]): unknown => (fn as ViewFn).unpackResult(result)
const artifact = TokenContractArtifact as ContractArtifact

// A structural Fr satisfying every read kind's unpackResult (bigint / number / NUL-padded utf8).
const frMock = (): Fr =>
	({
		toBigInt: () => 123n,
		toNumber: () => 6,
		toBuffer: () => Buffer.concat([Buffer.from("USDC", "utf-8"), Buffer.alloc(2)]),
	}) as unknown as Fr

const READ_KINDS: ReadonlyArray<{
	name: string
	descriptor: TokenFnDescriptor
	old: OldMatcher
	canonical: string
	invalidMessage: string
	args: unknown[]
}> = [
	{
		name: "balanceOfPublic",
		descriptor: balanceOfPublicDescriptor,
		old: BalanceOfPublicFn as unknown as OldMatcher,
		canonical: "balance_of_public",
		invalidMessage: "Invalid BalanceOfPublicImpl",
		args: ["0xowner"],
	},
	{
		name: "balanceOfPrivate",
		descriptor: balanceOfPrivateDescriptor,
		old: BalanceOfPrivateFn as unknown as OldMatcher,
		canonical: "balance_of_private",
		invalidMessage: "Invalid BalanceOfPrivateImpl",
		args: ["0xowner"],
	},
	{
		name: "getName",
		descriptor: getNameDescriptor,
		old: GetNameFn as unknown as OldMatcher,
		canonical: "name",
		invalidMessage: "Invalid GetNameImpl",
		args: [],
	},
	{
		name: "getSymbol",
		descriptor: getSymbolDescriptor,
		old: GetSymbolFn as unknown as OldMatcher,
		canonical: "symbol",
		invalidMessage: "Invalid GetSymbolImpl",
		args: [],
	},
	{
		name: "getDecimals",
		descriptor: getDecimalsDescriptor,
		old: GetDecimalsFn as unknown as OldMatcher,
		canonical: "decimals",
		invalidMessage: "Invalid GetDecimalsImpl",
		args: [],
	},
]

for (const k of READ_KINDS) {
	describe(`token-fn registry ≡ old module — ${k.name}`, () => {
		test("candidates + default identical (real Token artifact)", () => {
			const oldC = k.old.getCandidates(artifact)
			const newC = getTokenFnCandidates(k.descriptor, artifact)
			expect(newC.map(shape)).toEqual(oldC.map(shape))
			expect(getDefaultTokenFn(k.descriptor, newC)?.name ?? null).toBe(k.old.getDefault(oldC)?.name ?? null)
		})

		test("buildArgs + unpackResult identical", () => {
			// The canonical name resolves to variant impl 0 in both old + new.
			const oldFn = k.old.new(k.canonical, 0)
			const newFn = createTokenFn(k.descriptor, k.canonical, 0)
			expect(newFn.buildArgs(...k.args)).toEqual(oldFn.buildArgs(...k.args))
			expect(unpack(newFn, [frMock()])).toEqual(unpack(oldFn, [frMock()]))
		})

		test("invalid impl throws the same message", () => {
			expect(() => createTokenFn(k.descriptor, "x", 99)).toThrow(k.invalidMessage)
			expect(() => k.old.new("x", 99)).toThrow(k.invalidMessage)
		})
	})
}

describe("token-fn registry ≡ old module — balanceOfPublic synthetic scoring", () => {
	test("candidates identical (synthetic multi-candidate)", () => {
		const realAbi = abiOf(BalanceOfPublicFn.getCandidates(artifact)[0])
		const rename = (n: string): FunctionAbi => ({ ...realAbi, name: n })
		const fns = [rename("zzz_unrelated"), rename("public_balance"), rename("balance_of_public"), rename("my_balance")]
		const art = { nonDispatchPublicFunctions: fns, functions: fns } as unknown as ContractArtifact
		expect(getTokenFnCandidates(balanceOfPublicDescriptor, art).map(shape)).toEqual(BalanceOfPublicFn.getCandidates(art).map(shape))
	})
})
