import { type FunctionAbi, FunctionType, type StructType } from "@aztec/stdlib/abi"
import type { TokenFnDescriptor } from "./types"

/**
 * Descriptor table — the data-driven replacement for the 9 copy-paste token-function
 * modules. Each entry reproduces its module's `abi()` literal, `getCandidates` predicate,
 * `points()` scoring, `getDefault` names, `buildArgs`, and `unpackResult` VERBATIM — pinned
 * by `token-functions.characterization.test.ts` + the equivalence tests. Do not "improve"
 * while transcribing (see the module headers for the accepted loose predicates).
 *
 * Migration status: kinds are added here one at a time, each proven equivalent to its old
 * module before the old module is deleted (Q-12 phasing).
 */

const AZTEC_ADDRESS_PATH = "aztec::protocol_types::address::aztec_address::AztecAddress"

/** balanceOfPublic — 1 variant (public, `nonDispatchPublicFunctions`), from balance-of-public.ts. */
export const balanceOfPublicDescriptor: TokenFnDescriptor = {
	kind: "balanceOfPublic",
	fnType: "view",
	variants: [{ impl: 0, source: "nonDispatchPublicFunctions" }],
	invalidImplMessage: "Invalid BalanceOfPublicImpl",
	abiBuilder: (name: string): FunctionAbi => ({
		name,
		isInitializer: false,
		functionType: FunctionType.PUBLIC,
		isOnlySelf: false,
		isStatic: true,
		parameters: [
			{
				name: "owner",
				type: {
					fields: [{ name: "inner", type: { kind: "field" } }],
					kind: "struct",
					path: AZTEC_ADDRESS_PATH,
				},
				visibility: "private",
			},
		],
		returnTypes: [{ kind: "integer", sign: "unsigned", width: 128 }],
		errorTypes: {},
	}),
	candidatePredicate: (fn: FunctionAbi): boolean =>
		!fn.isInitializer &&
		!fn.isOnlySelf &&
		fn.isStatic &&
		fn.functionType === FunctionType.PUBLIC &&
		fn.parameters.length === 1 &&
		(fn.parameters[0].type as StructType)?.path === AZTEC_ADDRESS_PATH &&
		fn.returnTypes.length === 1 &&
		fn.returnTypes[0].kind === "integer",
	score: (fn): number => {
		if (fn.name === "balance_of_public") return 100
		let p = 0
		if (fn.name.includes("balance")) {
			p += 1
			if (fn.name.includes("public")) {
				p += 2
			}
		}
		return p
	},
	defaultNames: ["balance_of_public"],
	buildArgs: (_impl: number, address: unknown): unknown[] => [address],
	unpackResult: (_impl, result) => result[0].toBigInt(),
}
