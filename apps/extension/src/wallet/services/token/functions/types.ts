import type { Fr } from "@aztec/foundation/curves/bn254"
import type { ContractArtifact, FunctionAbi, FunctionType } from "@aztec/stdlib/abi"

/**
 * The 9 token-function kinds. Single source of truth — `TOKEN_FN_DESCRIPTORS` is
 * checked exhaustively against this union with `satisfies` so a missing/extra kind
 * is a compile error.
 */
export type TokenFnKind =
	| "getName"
	| "getSymbol"
	| "getDecimals"
	| "balanceOfPrivate"
	| "balanceOfPublic"
	| "transferPrivate"
	| "transferPublic"
	| "transferPrivateToPublic"
	| "transferPublicToPrivate"

/** `view` → wrapped in a `ViewFn` (has `unpackResult`); `call` → a plain `Fn` (transfer). */
export type TokenFnMode = "view" | "call"

/** Which artifact function array a variant's predicate scans. */
export type CandidateSource = "functions" | "nonDispatchPublicFunctions"

/**
 * One impl variant of a kind. The old modules encode these as `enum <Fn>Impl { … }`;
 * the numeric `impl` is PERSISTED in user storage (`FnImpl.impl`) so it must never
 * change. `source` is the artifact array `getCandidates` scanned for this variant.
 */
export interface TokenFnVariant {
	readonly impl: number
	readonly source: CandidateSource
}

/** The candidate shape the scorer needs (name + resolved FunctionType), from the built Fn. */
export interface ScoredCandidate {
	readonly name: string
	readonly type: FunctionType
}

/**
 * Data-driven replacement for one copy-paste token-function module. Behavior-preserving
 * by construction: `abiBuilder`/`candidatePredicate`/`score`/`buildArgs`/`unpackResult`
 * reproduce the old module's literals EXACTLY (pinned by the characterization + equivalence
 * tests). Do NOT tighten predicates, re-number impls, reorder variants, or dedupe.
 */
export interface TokenFnDescriptor {
	readonly kind: TokenFnKind
	readonly fnType: TokenFnMode
	/** In DECLARED order — `getCandidates` concatenates variants in this order before the stable score sort. */
	readonly variants: readonly TokenFnVariant[]
	/** Thrown verbatim by `createTokenFn` on an unknown impl (matches the old `new()` switch default). */
	readonly invalidImplMessage: string
	/** The exact `FunctionAbi` literal the old `Default*Fn.abi()` returned for this variant. */
	abiBuilder(name: string, impl: number): FunctionAbi
	/** The old `Default*Fn.getCandidates` per-function predicate (shape filter — NOT name). */
	candidatePredicate(fn: FunctionAbi, impl: number): boolean
	/** The old kind-level `points(fn)` scoring (exact tiers + keyword partials). Higher = better. */
	score(candidate: ScoredCandidate): number
	/** The old kind-level `getDefault`: the top candidate is returned only if its name is one of these. */
	readonly defaultNames: readonly string[]
	buildArgs(impl: number, ...args: unknown[]): unknown[]
	/** view kinds only. */
	unpackResult?(impl: number, result: Fr[]): unknown
}

export type TokenArtifact = ContractArtifact
