import type { Fr } from "@aztec/foundation/curves/bn254"
import { type FunctionAbi, FunctionType, type StructType } from "@aztec/stdlib/abi"
import type { TokenFnDescriptor } from "./types"

/**
 * Descriptor table — the data-driven replacement for the 9 copy-paste token-function
 * modules. Each entry reproduces its module's `abi()` literal, `getCandidates` predicate,
 * `points()` scoring, `getDefault` names, `buildArgs`, and `unpackResult` VERBATIM — pinned
 * by `token-functions.characterization.test.ts` + `registry-equivalence.test.ts`. Do not
 * "improve" while transcribing (see the module headers for the accepted loose predicates).
 *
 * Migration status: kinds are added here one at a time, each proven equivalent to its old
 * module before the old module is deleted (Q-12 phasing). Present: the 5 read (view) kinds.
 */

const AZTEC_ADDRESS_PATH = "aztec::protocol_types::address::aztec_address::AztecAddress"
const FIELD_COMPRESSED_STRING_PATH = "compressed_string::field_compressed_string::FieldCompressedString"

// Shared ABI sub-objects — byte-identical to the ones inlined in the old modules.
const OWNER_ADDRESS_PARAM = {
	name: "owner",
	type: { fields: [{ name: "inner", type: { kind: "field" as const } }], kind: "struct" as const, path: AZTEC_ADDRESS_PATH },
	visibility: "private" as const,
}
const FIELD_COMPRESSED_STRING_RETURN = {
	fields: [{ name: "value", type: { kind: "field" as const } }],
	kind: "struct" as const,
	path: FIELD_COMPRESSED_STRING_PATH,
}
// Verbatim from the modules: decode utf-8 and strip NUL padding (\u0000), NOT spaces.
const decodeUtf8 = (result: Fr[]): string => result[0].toBuffer().toString("utf-8").replaceAll("\u0000", "")

/** balanceOfPublic — 1 variant (public, `nonDispatchPublicFunctions`), from balance-of-public.ts. */
export const balanceOfPublicDescriptor: TokenFnDescriptor = {
	kind: "balanceOfPublic",
	fnType: "view",
	variants: [{ impl: 0, source: "nonDispatchPublicFunctions" }],
	invalidImplMessage: "Invalid BalanceOfPublicImpl",
	abiBuilder: (name): FunctionAbi => ({
		name,
		isInitializer: false,
		functionType: FunctionType.PUBLIC,
		isOnlySelf: false,
		isStatic: true,
		parameters: [OWNER_ADDRESS_PARAM],
		returnTypes: [{ kind: "integer", sign: "unsigned", width: 128 }],
		errorTypes: {},
	}),
	candidatePredicate: (fn): boolean =>
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
			if (fn.name.includes("public")) p += 2
		}
		return p
	},
	defaultNames: ["balance_of_public"],
	buildArgs: (_impl, address): unknown[] => [address],
	unpackResult: (_impl, result) => result[0].toBigInt(),
}

/** balanceOfPrivate — 1 variant (UTILITY, non-static, scans `functions`), from balance-of-private.ts. */
export const balanceOfPrivateDescriptor: TokenFnDescriptor = {
	kind: "balanceOfPrivate",
	fnType: "view",
	variants: [{ impl: 0, source: "functions" }],
	invalidImplMessage: "Invalid BalanceOfPrivateImpl",
	abiBuilder: (name): FunctionAbi => ({
		name,
		isInitializer: false,
		functionType: FunctionType.UTILITY,
		isOnlySelf: false,
		isStatic: false,
		parameters: [OWNER_ADDRESS_PARAM],
		returnTypes: [{ kind: "integer", sign: "unsigned", width: 128 }],
		errorTypes: {},
	}),
	candidatePredicate: (fn): boolean =>
		!fn.isInitializer &&
		!fn.isOnlySelf &&
		!fn.isStatic &&
		fn.functionType === FunctionType.UTILITY &&
		fn.parameters.length === 1 &&
		(fn.parameters[0].type as StructType)?.path === AZTEC_ADDRESS_PATH &&
		fn.returnTypes.length === 1 &&
		fn.returnTypes[0].kind === "integer",
	score: (fn): number => {
		if (fn.name === "balance_of_private") return 100
		let p = 0
		if (fn.name.includes("balance")) {
			p += 1
			if (fn.name.includes("private")) p += 2
		}
		return p
	},
	defaultNames: ["balance_of_private"],
	buildArgs: (_impl, address): unknown[] => [address],
	unpackResult: (_impl, result) => result[0].toBigInt(),
}

/**
 * Metadata kinds (name/symbol/decimals) share the 2-variant (public + private) shape, 3-tier
 * exact scoring (canonical 102 / private_get_* 101 / public_get_* 100), and no-args build.
 * The factory keeps them byte-identical to the modules.
 */
function metadataDescriptor(config: {
	kind: TokenFnDescriptor["kind"]
	invalidImplMessage: string
	keyword: string
	canonical: string
	privateName: string
	publicName: string
	returnType: FunctionAbi["returnTypes"][number]
	returnMatches: (actual: FunctionAbi["returnTypes"][number]) => boolean
	unpackResult: (result: Fr[]) => unknown
}): TokenFnDescriptor {
	const isPrivate = (impl: number) => impl === 1
	return {
		kind: config.kind,
		fnType: "view",
		variants: [
			{ impl: 0, source: "nonDispatchPublicFunctions" },
			{ impl: 1, source: "functions" },
		],
		invalidImplMessage: config.invalidImplMessage,
		abiBuilder: (name, impl): FunctionAbi => ({
			name,
			isInitializer: false,
			functionType: isPrivate(impl) ? FunctionType.PRIVATE : FunctionType.PUBLIC,
			isOnlySelf: false,
			isStatic: true,
			parameters: [],
			returnTypes: [config.returnType],
			errorTypes: {},
		}),
		candidatePredicate: (fn, impl): boolean =>
			!fn.isInitializer &&
			!fn.isOnlySelf &&
			fn.isStatic &&
			fn.functionType === (isPrivate(impl) ? FunctionType.PRIVATE : FunctionType.PUBLIC) &&
			fn.parameters.length === 0 &&
			fn.returnTypes.length === 1 &&
			config.returnMatches(fn.returnTypes[0]),
		score: (fn): number => {
			if (fn.name === config.canonical) return 102
			if (fn.name === config.privateName) return 101
			if (fn.name === config.publicName) return 100
			let p = 0
			if (fn.name.includes(config.keyword)) {
				p += 1
				if (fn.type === FunctionType.PRIVATE) p += 2
			}
			return p
		},
		defaultNames: [config.canonical, config.privateName, config.publicName],
		buildArgs: (): unknown[] => [],
		unpackResult: (_impl, result) => config.unpackResult(result),
	}
}

const matchesFieldCompressedString = (actual: FunctionAbi["returnTypes"][number]): boolean =>
	(actual as StructType)?.path === FIELD_COMPRESSED_STRING_PATH

/** getName — from get-name.ts. */
export const getNameDescriptor: TokenFnDescriptor = metadataDescriptor({
	kind: "getName",
	invalidImplMessage: "Invalid GetNameImpl",
	keyword: "name",
	canonical: "name",
	privateName: "private_get_name",
	publicName: "public_get_name",
	returnType: FIELD_COMPRESSED_STRING_RETURN,
	returnMatches: matchesFieldCompressedString,
	unpackResult: decodeUtf8,
})

/** getSymbol — from get-symbol.ts. */
export const getSymbolDescriptor: TokenFnDescriptor = metadataDescriptor({
	kind: "getSymbol",
	invalidImplMessage: "Invalid GetSymbolImpl",
	keyword: "symbol",
	canonical: "symbol",
	privateName: "private_get_symbol",
	publicName: "public_get_symbol",
	returnType: FIELD_COMPRESSED_STRING_RETURN,
	returnMatches: matchesFieldCompressedString,
	unpackResult: decodeUtf8,
})

/** getDecimals — from get-decimals.ts (integer/unsigned/width 8 return, toNumber unpack). */
export const getDecimalsDescriptor: TokenFnDescriptor = metadataDescriptor({
	kind: "getDecimals",
	invalidImplMessage: "Invalid GetDecimalsImpl",
	keyword: "decimals",
	canonical: "decimals",
	privateName: "private_get_decimals",
	publicName: "public_get_decimals",
	returnType: { kind: "integer", sign: "unsigned", width: 8 },
	returnMatches: (actual) => actual.kind === "integer" && actual.sign === "unsigned" && actual.width === 8,
	unpackResult: (result) => result[0].toNumber(),
})
