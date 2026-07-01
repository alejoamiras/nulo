/**
 * Q-12 equivalence proof. Asserts the descriptor-registry output is byte-identical to the
 * old copy-paste module it replaces, kind by kind, against the real Token artifact + synthetic
 * multi-candidate artifacts. A kind's old module is only deleted after its equivalence test is
 * green. (Currently: balanceOfPublic — the framework-proving kind. The rest are added as they
 * migrate.)
 */
import type { Fr } from "@aztec/foundation/curves/bn254"
import type { ContractArtifact, FunctionAbi } from "@aztec/stdlib/abi"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
import { describe, expect, test } from "vitest"
import type { Fn, ViewFn } from "@/wallet/utils/fn"
import { BalanceOfPublicFn } from "./balance-of-public"
import { balanceOfPublicDescriptor } from "./descriptors"
import { createTokenFn, getDefaultTokenFn, getTokenFnCandidates } from "./runtime"

const abiOf = (fn: Fn): FunctionAbi => (fn as unknown as { abi(): FunctionAbi }).abi()
const shape = (fn: Fn) => ({ name: fn.name, impl: fn.getImpl().impl, type: fn.type, isStatic: fn.isStatic, abi: abiOf(fn) })
const unpack = (fn: Fn, result: Fr[]): unknown => (fn as ViewFn).unpackResult(result)
const artifact = TokenContractArtifact as ContractArtifact
const frOf = (v: bigint): Fr => ({ toBigInt: () => v }) as unknown as Fr

describe("token-fn registry ≡ old module — balanceOfPublic", () => {
	test("candidates + default identical (real Token artifact)", () => {
		const oldC = BalanceOfPublicFn.getCandidates(artifact)
		const newC = getTokenFnCandidates(balanceOfPublicDescriptor, artifact)
		expect(newC.map(shape)).toEqual(oldC.map(shape))
		expect(getDefaultTokenFn(balanceOfPublicDescriptor, newC)?.name ?? null).toBe(BalanceOfPublicFn.getDefault(oldC)?.name ?? null)
	})

	test("candidates identical (synthetic multi-candidate scoring)", () => {
		const realAbi = abiOf(BalanceOfPublicFn.getCandidates(artifact)[0])
		const rename = (n: string): FunctionAbi => ({ ...realAbi, name: n })
		const fns = [rename("zzz_unrelated"), rename("public_balance"), rename("balance_of_public"), rename("my_balance")]
		const art = { nonDispatchPublicFunctions: fns, functions: fns } as unknown as ContractArtifact
		expect(getTokenFnCandidates(balanceOfPublicDescriptor, art).map(shape)).toEqual(BalanceOfPublicFn.getCandidates(art).map(shape))
	})

	test("buildArgs + unpackResult identical", () => {
		const oldFn = BalanceOfPublicFn.new("balance_of_public", 0)
		const newFn = createTokenFn(balanceOfPublicDescriptor, "balance_of_public", 0)
		expect(newFn.buildArgs("0xowner")).toEqual(oldFn.buildArgs("0xowner"))
		expect(unpack(newFn, [frOf(42n)])).toEqual(unpack(oldFn, [frOf(42n)]))
	})

	test("invalid impl throws the same message", () => {
		expect(() => createTokenFn(balanceOfPublicDescriptor, "x", 9)).toThrow("Invalid BalanceOfPublicImpl")
		expect(() => BalanceOfPublicFn.new("x", 9 as unknown as number)).toThrow("Invalid BalanceOfPublicImpl")
	})
})
