/**
 * Single source of truth for per-method wallet-RPC metadata.
 *
 * One `MethodDescriptor` row per dispatchable method. The six tables that used
 * to be hand-maintained across `capability-map.ts`, `dispatcher.ts`, and
 * `scope-enforcement.ts` are now DERIVED from this registry (see the `derive*`
 * functions + the pre-computed exports below). Adding a method's authz/routing
 * facts is one edit here; a forgotten method is caught by the exhaustiveness
 * test (build failure) and the dispatch-entry guard (runtime throw).
 *
 * Scope: this owns the method-name-keyed METADATA only. It does NOT own the
 * kind→Operation build switches (`buildNetworkOperation`/`buildAccountOperation`
 * in dispatcher.ts) — those construct Operation objects from args and stay
 * kind-keyed. Adding a method that needs a NEW Operation kind still touches
 * those switches; the registry just centralizes the metadata facts.
 *
 * Layering: this is a near-leaf module. It imports the scope-checker function
 * references from `./method-scope-checkers` (the true leaf) and types only from
 * `./operation` + `./capabilities`. Nothing it depends on depends back on it,
 * which is what lets `capability-map.ts` / `dispatcher.ts` / `scope-enforcement.ts`
 * become thin facades over it without an import cycle.
 */

import type { OperationKind } from "./operation"
import {
	type ScopeCheck,
	checkRegisterContract,
	checkGetContractMetadata,
	checkIsTokenRegistered,
	checkGetContractClassMetadata,
	checkRegisterContractClassDisabled,
	checkSendTx,
	checkGrantPublicAuthwit,
	checkSimulateTx,
	checkProfileTx,
	checkExecuteUtility,
	checkGetPrivateEvents,
	checkCreateAuthWit,
	checkGetAccounts,
	checkGetAddressBook,
	checkRegisterSender,
} from "./method-scope-checkers"

/** Capability types a dApp method can require. Defined HERE (not capability-map.ts)
 *  so the seam is one-directional: capability-map re-exports it. */
export type CapabilityType = "accounts" | "contracts" | "contractClasses" | "simulation" | "transaction" | "data"

/** Operation kinds routed via `buildNetworkOperation` (network context only). */
export type NetworkOperationKind =
	| "aztec_getChainInfo"
	| "aztec_getContractClassMetadata"
	| "aztec_getContractMetadata"
	| "aztec_getPrivateEvents"
	| "aztec_registerSender"
	| "aztec_getAddressBook"
	| "aztec_registerContract"

/** Operation kinds routed via `buildAccountOperation` (network + account context). */
export type AccountOperationKind = "aztec_simulateTx" | "aztec_executeUtility" | "aztec_profileTx" | "aztec_createAuthWit"

// Compile-time proof the route-narrowed kinds stay subsets of Operation["kind"].
// If a kind is renamed in operation.ts and not here, this stops compiling.
type AssertExtends<T extends U, U> = T
type _NetworkSubset = AssertExtends<NetworkOperationKind, OperationKind>
type _AccountSubset = AssertExtends<AccountOperationKind, OperationKind>

/** How a method is serviced AFTER capability + scope enforcement.
 *  `handler` = popup / meta / reader (dispatch()-internal, no buildOperation). */
export type MethodRouting =
	| { readonly via: "network-operation"; readonly kind: NetworkOperationKind }
	| { readonly via: "account-operation"; readonly kind: AccountOperationKind }
	| { readonly via: "handler" }

/**
 * Per-method argument guard. A pure, NON-MUTATING predicate over the ORIGINAL
 * args array — deliberately not a parser: it can return only pass/fail, so it
 * cannot coerce, normalize, or substitute values, and everything downstream
 * (scope checkers reading `args` positionally, handler destructuring) keeps
 * seeing the exact wire values. Runs in dispatch() right after
 * `assertKnownMethod`, BEFORE capability/scope enforcement and before any
 * handler destructuring.
 *
 * Calibration is tolerance-exact (audit pins): required-LEADING arity only
 * where no working absent-arg path exists today; optional trailing args stay
 * optional; extra args stay ignored; no value-type requirements on args the
 * code `String()`-coerces. Methods whose first-arg validation is OWNED by
 * their scope checker (sendTx/simulateTx/profileTx/executeUtility — pinned
 * error strings) or that read no args at all OMIT the field: absence = no arg
 * validation, exactly today's behavior.
 */
export type ArgGuard = (args: readonly unknown[]) => boolean

export interface MethodDescriptor {
	/** Required capability, or `null` for exempt/meta. `null` ⟺ `exemptReason` set (D7 XOR). */
	readonly capability: CapabilityType | null
	/** Present iff the method skips `enforceCapability` entirely. Documents WHY. */
	readonly exemptReason?: string
	readonly routing: MethodRouting
	/** Per-origin scope gate. Omitted = no scope dimension (enforceScope no-ops). */
	readonly scopeCheck?: ScopeCheck
	/** Arg-shape guard (see {@link ArgGuard}). Omitted = no arg validation (historical tolerance). */
	readonly argSchema?: ArgGuard
	/** Preserved F-/AUDIT markers paired with security tests. */
	readonly audit?: string
	/** Rationale migrated verbatim from the old inline comments. */
	readonly note?: string
}

// ── Arg guards (named fns so failures stack-trace to the method) ───────

const isPlainRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

/** requestCapabilities(manifest): the handler reads manifest properties directly. */
export function argsRequestCapabilities(args: readonly unknown[]): boolean {
	return isPlainRecord(args[0])
}

/** batch(legs): handleBatch iterates legs and re-dispatches `leg.name(leg.args)`;
 *  each leg is then validated by its OWN method's guard on re-entry. */
export function argsBatch(args: readonly unknown[]): boolean {
	const legs = args[0]
	if (!Array.isArray(legs)) return false
	return legs.every((leg) => isPlainRecord(leg) && typeof leg.name === "string" && Array.isArray(leg.args))
}

/** createAuthWit(from, messageHashOrIntent): both positions are read; there is
 *  no working path with the intent absent (the built operation would carry
 *  `messageHashOrIntent: undefined` into execution). Values stay unvalidated —
 *  the scope checker handles the 3 intent shapes tolerantly. */
export function argsCreateAuthWit(args: readonly unknown[]): boolean {
	return args.length >= 2
}

/** Single leading arg that the checker/handler `String()`-coerces — presence
 *  only, no type requirement (coercion tolerance preserved). */
export function argsOneRequired(args: readonly unknown[]): boolean {
	return args.length >= 1
}

/** Two leading args read (getPrivateEvents / registerToken / grantPublicAuthwit). */
export function argsTwoRequired(args: readonly unknown[]): boolean {
	return args.length >= 2
}

// Private `satisfies` source so the literal KEYS survive for `MethodName`
// (`keyof typeof METHOD_REGISTRY_SOURCE`). The public `METHOD_REGISTRY` below is
// a wide-typed (`Record<string, MethodDescriptor>`) re-export of this SAME object
// so the frozen oracle + derivations keep their optional-field (`exemptReason?`/
// `scopeCheck?`) access. Runtime-identical; oracle byte-UNEDITED.
const METHOD_REGISTRY_SOURCE = {
	// ── Exempt meta / infra (no capability, no scope) ──
	getChainInfo: {
		capability: null,
		exemptReason: "meta-protocol — chain info is public, requires no grant",
		routing: { via: "network-operation", kind: "aztec_getChainInfo" },
	},
	requestCapabilities: {
		capability: null,
		exemptReason: "capability-negotiation meta-protocol — the method by which grants are obtained",
		routing: { via: "handler" },
		argSchema: argsRequestCapabilities,
	},
	batch: {
		capability: null,
		exemptReason: "infrastructure wrapper — each leg re-enters dispatch() and is enforced individually",
		routing: { via: "handler" },
		argSchema: argsBatch,
	},

	// ── accounts ──
	createAuthWit: {
		capability: "accounts",
		routing: { via: "account-operation", kind: "aztec_createAuthWit" },
		scopeCheck: checkCreateAuthWit,
		argSchema: argsCreateAuthWit,
	},
	registerToken: {
		capability: "accounts",
		routing: { via: "handler" },
		argSchema: argsTwoRequired,
		// D8: NOT a missing scope checker. registerToken's session-account authz
		// is enforced inline in handleRegisterToken(); it has no METHOD_SCOPE_CHECKER
		// entry by design.
		note: "popup-routed; session-account authz is inline in handleRegisterToken (no scope-checker by design)",
	},
	getAccounts: {
		capability: "accounts",
		routing: { via: "handler" },
		scopeCheck: checkGetAccounts,
		audit: "F-003: was EXEMPT; now requires accounts.canGet=true (the canGet sub-grant was decorative before)",
	},

	// ── contracts ──
	isTokenRegistered: {
		capability: "contracts",
		routing: { via: "handler" },
		scopeCheck: checkIsTokenRegistered,
		argSchema: argsOneRequired,
		// A1: wallet-local registration probe; gated by the contracts grant
		// (need-to-know address list), scope-checked via canGetMetadata — the same
		// consent surface as getContractMetadata. Preserved verbatim.
		note: "reader-routed; contracts grant + canGetMetadata scope (A1, preserved)",
	},
	registerContract: {
		capability: "contracts",
		routing: { via: "network-operation", kind: "aztec_registerContract" },
		scopeCheck: checkRegisterContract,
		argSchema: argsOneRequired,
	},
	getContractMetadata: {
		capability: "contracts",
		routing: { via: "network-operation", kind: "aztec_getContractMetadata" },
		scopeCheck: checkGetContractMetadata,
		argSchema: argsOneRequired,
	},

	// ── contractClasses ──
	getContractClassMetadata: {
		capability: "contractClasses",
		routing: { via: "network-operation", kind: "aztec_getContractClassMetadata" },
		scopeCheck: checkGetContractClassMetadata,
		argSchema: argsOneRequired,
	},
	registerContractClass: {
		capability: "contractClasses",
		routing: { via: "handler" },
		scopeCheck: checkRegisterContractClassDisabled,
		note: "Neutralized: unbound PXE artifact registration (5.0-new) is NOT dApp-exposed until contractClasses.canRegister + UI disclosure + class-id-scoped async enforcement exist. Denied at scope-check (codex audit).",
	},

	// ── simulation ──
	simulateTx: {
		capability: "simulation",
		routing: { via: "account-operation", kind: "aztec_simulateTx" },
		scopeCheck: checkSimulateTx,
	},
	executeUtility: {
		capability: "simulation",
		routing: { via: "account-operation", kind: "aztec_executeUtility" },
		scopeCheck: checkExecuteUtility,
	},
	profileTx: {
		capability: "simulation",
		routing: { via: "account-operation", kind: "aztec_profileTx" },
		scopeCheck: checkProfileTx,
	},

	// ── transaction (both popup-routed → handler, no kind) ──
	sendTx: {
		capability: "transaction",
		routing: { via: "handler" },
		scopeCheck: checkSendTx,
		note: "popup-routed via DappInteractionService (fee selection); no METHOD_TO_KIND entry",
	},
	grantPublicAuthwit: {
		capability: "transaction",
		routing: { via: "handler" },
		scopeCheck: checkGrantPublicAuthwit,
		argSchema: argsTwoRequired,
		// F1: WITHOUT the transaction capability, enforceCapability returns [] and the
		// scope-enforcement block is skipped — the gate becomes dead code (audit F1).
		audit: "F1: requires the transaction capability or the scope gate is dead code (dispatcher.test.ts:1459-1544)",
	},

	// ── data ──
	getPrivateEvents: {
		capability: "data",
		routing: { via: "network-operation", kind: "aztec_getPrivateEvents" },
		scopeCheck: checkGetPrivateEvents,
		argSchema: argsTwoRequired,
	},
	getAddressBook: {
		capability: "data",
		routing: { via: "network-operation", kind: "aztec_getAddressBook" },
		scopeCheck: checkGetAddressBook,
		audit: "F-004: requires data.addressBook=true",
	},
	registerSender: {
		capability: "data",
		routing: { via: "network-operation", kind: "aztec_registerSender" },
		scopeCheck: checkRegisterSender,
		argSchema: argsOneRequired,
		audit: "F-004 (paired): requires data.addressBook=true",
	},
} satisfies Record<string, MethodDescriptor>

/** The registry the facades/derivations/oracle consume — the SAME object as
 *  `METHOD_REGISTRY_SOURCE`, widened to `Record<string, MethodDescriptor>` so
 *  optional-field access (`exemptReason?`/`scopeCheck?`) type-checks. */
export const METHOD_REGISTRY: Record<string, MethodDescriptor> = METHOD_REGISTRY_SOURCE

// ── Derivations (each replaces a former hand-maintained table) ─────────

export function deriveCapabilityMap(registry: Record<string, MethodDescriptor>): Record<string, CapabilityType> {
	const out: Record<string, CapabilityType> = {}
	for (const [method, d] of Object.entries(registry)) {
		if (d.capability !== null) out[method] = d.capability
	}
	return out
}

export function deriveExemptSet(registry: Record<string, MethodDescriptor>): Set<string> {
	const out = new Set<string>()
	for (const [method, d] of Object.entries(registry)) {
		if (d.exemptReason !== undefined) out.add(method)
	}
	return out
}

export function deriveMethodToKind(registry: Record<string, MethodDescriptor>): Record<string, OperationKind> {
	const out: Record<string, OperationKind> = {}
	for (const [method, d] of Object.entries(registry)) {
		if (d.routing.via !== "handler") out[method] = d.routing.kind
	}
	return out
}

export function deriveNetworkOnlyKinds(registry: Record<string, MethodDescriptor>): Set<OperationKind> {
	const out = new Set<OperationKind>()
	for (const d of Object.values(registry)) {
		if (d.routing.via === "network-operation") out.add(d.routing.kind)
	}
	return out
}

export function deriveAccountKinds(registry: Record<string, MethodDescriptor>): Set<OperationKind> {
	const out = new Set<OperationKind>()
	for (const d of Object.values(registry)) {
		if (d.routing.via === "account-operation") out.add(d.routing.kind)
	}
	return out
}

export function deriveScopeCheckerMap(registry: Record<string, MethodDescriptor>): Record<string, ScopeCheck> {
	const out: Record<string, ScopeCheck> = {}
	for (const [method, d] of Object.entries(registry)) {
		if (d.scopeCheck !== undefined) out[method] = d.scopeCheck
	}
	return out
}

/** The exact set of dApp RPC method names the dispatcher supports — the literal
 *  key union of `METHOD_REGISTRY`. A typed replacement for the bare `string` at
 *  the dispatch boundary; layered FROM the registry (not a second whitelist). */
export type MethodName = keyof typeof METHOD_REGISTRY_SOURCE

/** A dApp RPC request after the dispatch-entry guard has validated the method.
 *  `args` stays `unknown[]` — per-arg typing would need per-method arg schemas
 *  (new descriptor fields → an oracle change), deferred. */
export interface RpcRequest {
	method: MethodName
	args: unknown[]
}

/** Fail-closed dispatch-entry guard + narrowing. Throws (preserving the frozen
 *  "Unsupported wallet method" string) for any name absent from `METHOD_REGISTRY`;
 *  `Object.hasOwn` (not a truthy index) rejects prototype names. On return,
 *  `methodName` is narrowed to `MethodName`. This is the single typed choke point
 *  the dispatcher routes through — no permissive default, no `as` at the boundary. */
export function assertKnownMethod(methodName: string): asserts methodName is MethodName {
	if (!Object.hasOwn(METHOD_REGISTRY, methodName)) {
		throw new Error(`Unsupported wallet method: ${methodName}`)
	}
}

// Pre-computed once at module load — these are what the facades import in Phase 2.
export const METHOD_CAPABILITY_MAP: Record<string, CapabilityType> = deriveCapabilityMap(METHOD_REGISTRY)
export const EXEMPT_METHODS: Set<string> = deriveExemptSet(METHOD_REGISTRY)
export const METHOD_TO_KIND: Record<string, OperationKind> = deriveMethodToKind(METHOD_REGISTRY)
export const NETWORK_ONLY_KINDS: Set<OperationKind> = deriveNetworkOnlyKinds(METHOD_REGISTRY)
export const ACCOUNT_KINDS: Set<OperationKind> = deriveAccountKinds(METHOD_REGISTRY)
export const METHOD_SCOPE_CHECKER: Record<string, ScopeCheck> = deriveScopeCheckerMap(METHOD_REGISTRY)
