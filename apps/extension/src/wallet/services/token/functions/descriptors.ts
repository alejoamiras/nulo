import { Fr } from "@aztec/foundation/curves/bn254"
import { type FunctionAbi, FunctionType, type StructType } from "@aztec/stdlib/abi"
import type { TokenFnDescriptor, TokenFnKind } from "./types"

/**
 * Descriptor table — the data-driven replacement for the 9 copy-paste token-function
 * modules. Each entry reproduces its module's `abi()` literal, `getCandidates` predicate,
 * `points()` scoring, `getDefault` names, `buildArgs`, and `unpackResult` VERBATIM — pinned
 * by `token-functions.characterization.test.ts` + `registry-equivalence.test.ts`. Do not
 * "improve" while transcribing (see the module headers for the accepted loose predicates).
 *
 * ONE deliberate divergence from the verbatim pin: struct-path matching is crate-prefix
 * tolerant (`matchesStructPath`). Noir namespaces ABI struct paths by the artifact's import
 * chain, so the same AztecAddress param arrives as `aztec::protocol_types::...::AztecAddress`
 * from one compile and `authorization_contract::aztec::protocol_types::...::AztecAddress`
 * from another (observed in `@aztec-foundation/aztec-standards@5.0.1`). Exact matching made
 * every balance/transfer kind resolve to zero candidates on such artifacts — a token that
 * imports as "incomplete" with no interface. Pinned against the real installed artifact by
 * `descriptors-real-artifact.test.ts`.
 *
 * Migration status: kinds are added here one at a time, each proven equivalent to its old
 * module before the old module is deleted (Q-12 phasing). All 9 kinds present (5 read + 4 transfer).
 */

const AZTEC_ADDRESS_PATH = "aztec::protocol_types::address::aztec_address::AztecAddress"
const FIELD_COMPRESSED_STRING_PATH = "compressed_string::field_compressed_string::FieldCompressedString"

/** Crate-prefix-tolerant struct-path compare (see the header note). */
const matchesStructPath = (actual: string | undefined, canonical: string): boolean =>
	actual === canonical || (actual?.endsWith(`::${canonical}`) ?? false)

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
		matchesStructPath((fn.parameters[0].type as StructType)?.path, AZTEC_ADDRESS_PATH) &&
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
		matchesStructPath((fn.parameters[0].type as StructType)?.path, AZTEC_ADDRESS_PATH) &&
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
	matchesStructPath((actual as StructType)?.path, FIELD_COMPRESSED_STRING_PATH)

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

// ── Transfer kinds (fnType "call" — no unpackResult) ─────────────────────────────────
// Two variant shapes recur: a 4-param `(from, to, amount, authwit_nonce)` and a 2-param
// `(to, amount)` (PRIVATE only). Predicates are LOOSE on amount (kind "integer", not width)
// and accept `authwit_nonce` OR `_nonce` while the abi emits `authwit_nonce` — preserved verbatim.
const addressParam = (name: string) => ({
	name,
	type: { fields: [{ name: "inner", type: { kind: "field" as const } }], kind: "struct" as const, path: AZTEC_ADDRESS_PATH },
	visibility: "private" as const,
})
const amountParam = {
	name: "amount",
	type: { kind: "integer" as const, sign: "unsigned" as const, width: 128 },
	visibility: "private" as const,
}
const nonceParam = { name: "authwit_nonce", type: { kind: "field" as const }, visibility: "private" as const }

const transfer4Abi = (name: string, functionType: FunctionType): FunctionAbi => ({
	name,
	isInitializer: false,
	functionType,
	isOnlySelf: false,
	isStatic: false,
	parameters: [addressParam("from"), addressParam("to"), amountParam, nonceParam],
	returnTypes: [],
	errorTypes: {},
})
const transfer2Abi = (name: string): FunctionAbi => ({
	name,
	isInitializer: false,
	functionType: FunctionType.PRIVATE,
	isOnlySelf: false,
	isStatic: false,
	parameters: [addressParam("to"), amountParam],
	returnTypes: [],
	errorTypes: {},
})
const transfer4Predicate = (fn: FunctionAbi, functionType: FunctionType): boolean =>
	!fn.isInitializer &&
	!fn.isOnlySelf &&
	!fn.isStatic &&
	fn.functionType === functionType &&
	fn.parameters.length === 4 &&
	fn.parameters[0].name === "from" &&
	matchesStructPath((fn.parameters[0].type as StructType)?.path, AZTEC_ADDRESS_PATH) &&
	fn.parameters[1].name === "to" &&
	matchesStructPath((fn.parameters[1].type as StructType)?.path, AZTEC_ADDRESS_PATH) &&
	fn.parameters[2].name === "amount" &&
	fn.parameters[2].type.kind === "integer" &&
	(fn.parameters[3].name === "authwit_nonce" || fn.parameters[3].name === "_nonce") &&
	fn.parameters[3].type.kind === "field" &&
	fn.returnTypes.length === 0
const transfer2Predicate = (fn: FunctionAbi): boolean =>
	!fn.isInitializer &&
	!fn.isOnlySelf &&
	!fn.isStatic &&
	fn.functionType === FunctionType.PRIVATE &&
	fn.parameters.length === 2 &&
	fn.parameters[0].name === "to" &&
	matchesStructPath((fn.parameters[0].type as StructType)?.path, AZTEC_ADDRESS_PATH) &&
	fn.parameters[1].name === "amount" &&
	fn.parameters[1].type.kind === "integer" &&
	fn.returnTypes.length === 0

interface TransferVariant {
	impl: number
	source: "functions" | "nonDispatchPublicFunctions"
	functionType: FunctionType
	params: 2 | 4
}

function transferDescriptor(config: {
	kind: TokenFnDescriptor["kind"]
	invalidImplMessage: string
	variants: readonly TransferVariant[]
	score: TokenFnDescriptor["score"]
	defaultNames: readonly string[]
}): TokenFnDescriptor {
	const byImpl = new Map(config.variants.map((v) => [v.impl, v]))
	const variant = (impl: number): TransferVariant => {
		const v = byImpl.get(impl)
		if (!v) throw new Error(config.invalidImplMessage)
		return v
	}
	return {
		kind: config.kind,
		fnType: "call",
		variants: config.variants.map((v) => ({ impl: v.impl, source: v.source })),
		invalidImplMessage: config.invalidImplMessage,
		abiBuilder: (name, impl): FunctionAbi => {
			const v = variant(impl)
			return v.params === 2 ? transfer2Abi(name) : transfer4Abi(name, v.functionType)
		},
		candidatePredicate: (fn, impl): boolean => {
			const v = variant(impl)
			return v.params === 2 ? transfer2Predicate(fn) : transfer4Predicate(fn, v.functionType)
		},
		buildArgs: (impl, ...args): unknown[] => {
			const [from, to, amount] = args
			return variant(impl).params === 2 ? [to, amount] : [from, to, amount, Fr.zero()]
		},
		score: config.score,
		defaultNames: config.defaultNames,
	}
}

/** transferPublic — from transfer-public.ts (1 variant, PUBLIC, `nonDispatchPublicFunctions`). */
export const transferPublicDescriptor: TokenFnDescriptor = transferDescriptor({
	kind: "transferPublic",
	invalidImplMessage: "Invalid TransferPublicImpl",
	variants: [{ impl: 0, source: "nonDispatchPublicFunctions", functionType: FunctionType.PUBLIC, params: 4 }],
	score: (fn): number => {
		if (fn.name === "transfer_public_to_public") return 102
		if (fn.name === "transfer_in_public") return 100
		let p = 0
		if (fn.name.includes("transfer")) {
			p += 1
			if (fn.name.includes("public")) {
				p += 2
				if (!fn.name.includes("private")) p += 4
			}
		}
		return p
	},
	defaultNames: ["transfer_public_to_public", "transfer_in_public"],
})

/** transferPrivate — from transfer-private.ts (2 variants: Default `[to,amount]` + DefaultFrom 4-param). */
export const transferPrivateDescriptor: TokenFnDescriptor = transferDescriptor({
	kind: "transferPrivate",
	invalidImplMessage: "Invalid TransferPrivateImpl",
	variants: [
		{ impl: 0, source: "functions", functionType: FunctionType.PRIVATE, params: 2 },
		{ impl: 1, source: "functions", functionType: FunctionType.PRIVATE, params: 4 },
	],
	score: (fn): number => {
		if (fn.name === "transfer_private_to_private") return 102
		if (fn.name === "transfer") return 101
		if (fn.name === "transfer_in_private") return 100
		let p = 0
		if (fn.name.includes("transfer")) {
			p += 1
			if (fn.name.includes("private")) {
				p += 2
				if (!fn.name.includes("public")) p += 4
			}
		}
		return p
	},
	defaultNames: ["transfer_private_to_private", "transfer", "transfer_in_private"],
})

/** transferPublicToPrivate — from transfer-public-to-private.ts (2 variants: Default `[to,amount]` + DefiWonderland 4-param). */
export const transferPublicToPrivateDescriptor: TokenFnDescriptor = transferDescriptor({
	kind: "transferPublicToPrivate",
	invalidImplMessage: "Invalid TransferPublicToPrivateImpl",
	variants: [
		{ impl: 0, source: "functions", functionType: FunctionType.PRIVATE, params: 2 },
		{ impl: 1, source: "functions", functionType: FunctionType.PRIVATE, params: 4 },
	],
	score: (fn): number => {
		if (fn.name === "transfer_public_to_private") return 101
		if (fn.name === "transfer_to_private") return 100
		let p = 0
		if (fn.name.includes("transfer")) {
			p += 1
			if (fn.name.includes("to_private")) {
				p += 2
				if (fn.name.includes("public_to_private")) p += 4
			}
		}
		return p
	},
	defaultNames: ["transfer_public_to_private", "transfer_to_private"],
})

/** transferPrivateToPublic — from transfer-private-to-public.ts (1 variant, PRIVATE, 4-param). */
export const transferPrivateToPublicDescriptor: TokenFnDescriptor = transferDescriptor({
	kind: "transferPrivateToPublic",
	invalidImplMessage: "Invalid TransferPrivateToPublicImpl",
	variants: [{ impl: 0, source: "functions", functionType: FunctionType.PRIVATE, params: 4 }],
	score: (fn): number => {
		if (fn.name === "transfer_private_to_public") return 101
		if (fn.name === "transfer_to_public") return 100
		let p = 0
		if (fn.name.includes("transfer")) {
			p += 1
			if (fn.name.includes("to_public")) {
				p += 2
				if (fn.name.includes("private_to_public")) p += 4
			}
		}
		return p
	},
	defaultNames: ["transfer_private_to_public", "transfer_to_public"],
})

/**
 * The single source of truth for the 9 token-function kinds. `satisfies` makes a missing or
 * extra kind a compile error. Consumers (service assembly, spec completeness, OperationPlanner)
 * iterate this instead of re-threading the 9-way enum.
 */
export const TOKEN_FN_DESCRIPTORS = {
	getName: getNameDescriptor,
	getSymbol: getSymbolDescriptor,
	getDecimals: getDecimalsDescriptor,
	balanceOfPrivate: balanceOfPrivateDescriptor,
	balanceOfPublic: balanceOfPublicDescriptor,
	transferPrivate: transferPrivateDescriptor,
	transferPublic: transferPublicDescriptor,
	transferPrivateToPublic: transferPrivateToPublicDescriptor,
	transferPublicToPrivate: transferPublicToPrivateDescriptor,
} satisfies Record<TokenFnKind, TokenFnDescriptor>
