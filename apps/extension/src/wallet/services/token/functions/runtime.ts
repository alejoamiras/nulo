import type { Fr } from "@aztec/foundation/curves/bn254"
import type { FunctionAbi } from "@aztec/stdlib/abi"
import { Fn, ViewFn } from "@/wallet/utils/fn"
import type { TokenArtifact, TokenFnDescriptor, TokenFnKind } from "./types"

/**
 * Generate a concrete `Fn`/`ViewFn` subclass for a descriptor. `abi()`/`buildArgs()`/
 * `unpackResult()` close over `descriptor` (a free variable, NOT an instance field): the
 * base `Fn` constructor eagerly calls `this.abi()` to compute `isStatic`/`type`, which
 * runs BEFORE any subclass field could be assigned — but `this.name`/`this.impl` are
 * already set by `FnImpl`'s super, and the closed-over descriptor is available throughout.
 */
function makeTokenFnClass(descriptor: TokenFnDescriptor): new (name: string, impl: number) => Fn {
	if (descriptor.fnType === "view") {
		return class extends ViewFn {
			protected override abi(): FunctionAbi {
				return descriptor.abiBuilder(this.name, this.impl)
			}
			public override buildArgs(...args: unknown[]): unknown[] {
				return descriptor.buildArgs(this.impl, ...args)
			}
			public override unpackResult(result: Fr[]): unknown {
				// A view descriptor always defines unpackResult (asserted when the registry is built).
				if (!descriptor.unpackResult) throw new Error(`${descriptor.kind}: missing unpackResult`)
				return descriptor.unpackResult(this.impl, result)
			}
		}
	}
	return class extends Fn {
		protected override abi(): FunctionAbi {
			return descriptor.abiBuilder(this.name, this.impl)
		}
		public override buildArgs(...args: unknown[]): unknown[] {
			return descriptor.buildArgs(this.impl, ...args)
		}
	}
}

/** Per-kind class cache, built lazily from the registry so each kind resolves one class. */
const classCache = new Map<TokenFnKind, new (name: string, impl: number) => Fn>()

function classForKind(descriptor: TokenFnDescriptor): new (name: string, impl: number) => Fn {
	let cls = classCache.get(descriptor.kind)
	if (!cls) {
		cls = makeTokenFnClass(descriptor)
		classCache.set(descriptor.kind, cls)
	}
	return cls
}

/**
 * Instantiate a token fn for a stored `(name, impl)` — the registry analog of the old
 * `<Fn>Fn.new(name, impl)`. Throws the descriptor's `invalidImplMessage` (byte-identical
 * to the old `new()` switch default) when `impl` is not one of the kind's variants.
 */
export function createTokenFn(descriptor: TokenFnDescriptor, name: string, impl: number): Fn {
	if (!descriptor.variants.some((v) => v.impl === impl)) {
		throw new Error(descriptor.invalidImplMessage)
	}
	return new (classForKind(descriptor))(name, impl)
}

/**
 * Reproduce the old kind-level `getCandidates`: for each variant IN DECLARED ORDER, scan
 * that variant's source array IN ARTIFACT ORDER, keep the predicate matches, then a single
 * STABLE sort by score descending. No dedupe (matches the old behavior exactly).
 */
export function getTokenFnCandidates(descriptor: TokenFnDescriptor, artifact: TokenArtifact): Fn[] {
	const candidates: Fn[] = []
	for (const variant of descriptor.variants) {
		const source = variant.source === "functions" ? artifact.functions : artifact.nonDispatchPublicFunctions
		for (const fn of source) {
			if (descriptor.candidatePredicate(fn, variant.impl)) {
				candidates.push(new (classForKind(descriptor))(fn.name, variant.impl))
			}
		}
	}
	candidates.sort((a, b) => descriptor.score(b) - descriptor.score(a))
	return candidates
}

/** Reproduce the old `getDefault`: the top candidate, only if its name is a canonical default name. */
export function getDefaultTokenFn(descriptor: TokenFnDescriptor, candidates: Fn[]): Fn | undefined {
	const top = candidates.at(0)
	return top && descriptor.defaultNames.includes(top.name) ? top : undefined
}

/**
 * `createTokenFn` narrowed to a `ViewFn` (has `unpackResult`) for the read kinds. Throws if the
 * descriptor is a `call` kind — a compile-time-unrepresentable-but-runtime-checked invariant, so
 * view consumers (balance reads, metadata) don't cast at every call site.
 */
export function createViewTokenFn(descriptor: TokenFnDescriptor, name: string, impl: number): ViewFn {
	if (descriptor.fnType !== "view") throw new Error(`${descriptor.kind} is not a view fn`)
	return createTokenFn(descriptor, name, impl) as ViewFn
}
