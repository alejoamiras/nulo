import { describe, test, expect } from "vitest"
import {
	METHOD_REGISTRY,
	deriveCapabilityMap,
	deriveExemptSet,
	deriveMethodToKind,
	deriveNetworkOnlyKinds,
	deriveAccountKinds,
	deriveScopeCheckerMap,
	type MethodDescriptor,
} from "./method-descriptors"
import {
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

// ── Frozen snapshots ──────────────────────────────────────────────────
// Hand-transcribed from the pre-refactor tables on `dev` (the 18-method matrix
// in implementations-plan/method-metadata-registry/plan.md). These are the
// contract the derivations must reproduce EXACTLY — latent quirks included.
// Sources: capability-map.ts:18,21; dispatcher.ts:251,272,286; scope-enforcement.ts:379.

const FROZEN_CAPABILITY_MAP: Record<string, string> = {
	createAuthWit: "accounts",
	registerToken: "accounts",
	isTokenRegistered: "contracts",
	getAccounts: "accounts",
	registerContract: "contracts",
	getContractMetadata: "contracts",
	getContractClassMetadata: "contractClasses",
	registerContractClass: "contractClasses",
	simulateTx: "simulation",
	executeUtility: "simulation",
	profileTx: "simulation",
	sendTx: "transaction",
	grantPublicAuthwit: "transaction",
	getPrivateEvents: "data",
	getAddressBook: "data",
	registerSender: "data",
}

const FROZEN_EXEMPT = new Set(["getChainInfo", "requestCapabilities", "batch"])

const FROZEN_METHOD_TO_KIND: Record<string, string> = {
	getChainInfo: "aztec_getChainInfo",
	getContractClassMetadata: "aztec_getContractClassMetadata",
	getContractMetadata: "aztec_getContractMetadata",
	getPrivateEvents: "aztec_getPrivateEvents",
	registerSender: "aztec_registerSender",
	getAddressBook: "aztec_getAddressBook",
	registerContract: "aztec_registerContract",
	simulateTx: "aztec_simulateTx",
	executeUtility: "aztec_executeUtility",
	profileTx: "aztec_profileTx",
	createAuthWit: "aztec_createAuthWit",
}

const FROZEN_NETWORK_ONLY = new Set([
	"aztec_getChainInfo",
	"aztec_getContractClassMetadata",
	"aztec_getContractMetadata",
	"aztec_getPrivateEvents",
	"aztec_registerSender",
	"aztec_getAddressBook",
	"aztec_registerContract",
])

const FROZEN_ACCOUNT = new Set(["aztec_simulateTx", "aztec_executeUtility", "aztec_profileTx", "aztec_createAuthWit"])

// Method → the EXACT checker function the pre-refactor METHOD_SCOPE_CHECKER referenced.
// For the 11 pre-named checkers this is byte-identical; for sendTx/simulateTx/profileTx
// the old map used inline arrows now lifted into named fns (checkSendTx etc.) — their
// BEHAVIOR is covered by the unchanged scope-enforcement.test.ts (D6).
const FROZEN_SCOPE_CHECKER: Record<string, unknown> = {
	registerContract: checkRegisterContract,
	getContractMetadata: checkGetContractMetadata,
	isTokenRegistered: checkIsTokenRegistered,
	getContractClassMetadata: checkGetContractClassMetadata,
	registerContractClass: checkRegisterContractClassDisabled,
	sendTx: checkSendTx,
	grantPublicAuthwit: checkGrantPublicAuthwit,
	simulateTx: checkSimulateTx,
	profileTx: checkProfileTx,
	executeUtility: checkExecuteUtility,
	getPrivateEvents: checkGetPrivateEvents,
	createAuthWit: checkCreateAuthWit,
	getAccounts: checkGetAccounts,
	getAddressBook: checkGetAddressBook,
	registerSender: checkRegisterSender,
}

// The method-name literals dispatch() special-cases (the local choke-point
// surface, independent of any schema). Hand-maintained: test (ii) cross-checks
// that each has a descriptor. A future handler branch added to dispatch() that
// is forgotten here is still caught operationally by the RUNTIME dispatch-entry
// guard (`Object.hasOwn(METHOD_REGISTRY, methodName)` throws "Unsupported wallet
// method" on first call) — that guard, not this list, is the real catch for a
// dispatchable method lacking a descriptor.
const DISPATCH_HANDLER_LITERALS = [
	"requestCapabilities",
	"getAccounts",
	"isTokenRegistered",
	"sendTx",
	"registerToken",
	"grantPublicAuthwit",
	"batch",
]

// Non-exempt methods that legitimately have NO scope checker, by design. An
// explicit allowlist (not a free-text `note`) so adding one is a deliberate,
// reviewable edit — a future method cannot skip scope coverage silently.
const SCOPE_EXEMPT_BY_DESIGN = new Set([
	// registerToken's session-account authz is enforced inline in
	// handleRegisterToken() (D8), not via a METHOD_SCOPE_CHECKER entry.
	"registerToken",
])

// ── Parity: derived maps reproduce the frozen tables EXACTLY ───────────

describe("method-descriptors — parity with the pre-refactor tables", () => {
	test("deriveCapabilityMap === frozen METHOD_CAPABILITY_MAP", () => {
		expect(deriveCapabilityMap(METHOD_REGISTRY)).toEqual(FROZEN_CAPABILITY_MAP)
	})

	test("deriveExemptSet === frozen EXEMPT_METHODS", () => {
		expect(deriveExemptSet(METHOD_REGISTRY)).toEqual(FROZEN_EXEMPT)
	})

	test("deriveMethodToKind === frozen METHOD_TO_KIND", () => {
		expect(deriveMethodToKind(METHOD_REGISTRY)).toEqual(FROZEN_METHOD_TO_KIND)
	})

	test("deriveNetworkOnlyKinds === frozen NETWORK_ONLY_KINDS", () => {
		expect(deriveNetworkOnlyKinds(METHOD_REGISTRY)).toEqual(FROZEN_NETWORK_ONLY)
	})

	test("deriveAccountKinds === frozen ACCOUNT_KINDS", () => {
		expect(deriveAccountKinds(METHOD_REGISTRY)).toEqual(FROZEN_ACCOUNT)
	})

	test("deriveScopeCheckerMap keys === frozen 15 names AND each checker is identical by reference", () => {
		const derived = deriveScopeCheckerMap(METHOD_REGISTRY)
		expect(new Set(Object.keys(derived))).toEqual(new Set(Object.keys(FROZEN_SCOPE_CHECKER)))
		for (const [method, fn] of Object.entries(FROZEN_SCOPE_CHECKER)) {
			expect(derived[method]).toBe(fn) // identity — no checker was swapped
		}
	})
})

// ── Invariants the registry must satisfy ───────────────────────────────

describe("method-descriptors — structural invariants", () => {
	test("kind partition is total + disjoint over deriveMethodToKind; method→kind injective", () => {
		const methodToKind = deriveMethodToKind(METHOD_REGISTRY)
		const network = deriveNetworkOnlyKinds(METHOD_REGISTRY)
		const account = deriveAccountKinds(METHOD_REGISTRY)
		const allKinds = new Set([...Object.values(methodToKind)])

		// total: every routed kind is in exactly one set
		expect(new Set([...network, ...account])).toEqual(allKinds)
		// disjoint
		for (const k of network) expect(account.has(k)).toBe(false)
		// injective: distinct methods map to distinct kinds (kind-set derivation depends on this)
		const kindValues = Object.values(methodToKind)
		expect(new Set(kindValues).size).toBe(kindValues.length)
	})

	test("XOR invariant: capability === null ⟺ exemptReason present (D7)", () => {
		for (const [method, d] of Object.entries(METHOD_REGISTRY)) {
			expect(`${method}:${d.capability === null}`).toBe(`${method}:${d.exemptReason !== undefined}`)
		}
	})

	test("getChainInfo is exempt AND network-routed (the one method that is both)", () => {
		const d = METHOD_REGISTRY.getChainInfo
		expect(d.exemptReason).toBeDefined()
		expect(d.routing).toEqual({ via: "network-operation", kind: "aztec_getChainInfo" })
		expect(d.scopeCheck).toBeUndefined()
	})

	test("getAccounts is NON-exempt (F-003): capability=accounts, has a scope checker", () => {
		// Guards against re-transcribing the stale dispatcher.ts:987 comment that
		// wrongly lists getAccounts as exempt — that would resurrect the F1-class hole.
		const d = METHOD_REGISTRY.getAccounts
		expect(d.capability).toBe("accounts")
		expect(d.exemptReason).toBeUndefined()
		expect(d.scopeCheck).toBe(checkGetAccounts)
	})
})

// ── Exhaustiveness: silent omission is a BUILD FAILURE ─────────────────

describe("method-descriptors — exhaustiveness (the silent-omission killer)", () => {
	test("(i) every patched WalletSchema method has a descriptor, and vice versa", async () => {
		// Import the production schema-patch side-effect FIRST (established pattern,
		// dispatcher.test.ts:682) so the 3 Nulo-custom methods are present on
		// WalletSchema. WITHOUT this import the custom trio would be invisible — the
		// import order is load-bearing for the guarantee.
		await import("@nulo/wallet-sdk-schema-patch/register")
		const { WalletSchema } = await import("@aztec/aztec.js/wallet")
		const schemaMethods = new Set(Object.keys(WalletSchema))
		const registryMethods = new Set(Object.keys(METHOD_REGISTRY))

		// forward: no dispatchable method lacks a descriptor
		for (const m of schemaMethods) {
			expect(registryMethods.has(m), `WalletSchema method "${m}" has no MethodDescriptor`).toBe(true)
		}
		// reverse: no descriptor describes a non-existent method
		for (const m of registryMethods) {
			expect(schemaMethods.has(m), `MethodDescriptor "${m}" is not a (patched) WalletSchema method`).toBe(true)
		}
	})

	test("(ii) every dispatch() handler literal has a descriptor", () => {
		for (const m of DISPATCH_HANDLER_LITERALS) {
			expect(Object.hasOwn(METHOD_REGISTRY, m), `dispatch() handles "${m}" but it has no MethodDescriptor`).toBe(true)
		}
	})

	test("scope coverage: every NON-exempt method has a scopeCheck OR is explicitly allowlisted", () => {
		for (const [method, d] of Object.entries(METHOD_REGISTRY)) {
			if (d.exemptReason !== undefined) continue // exempt methods have no scope dimension
			// An explicit allowlist (not a free-text note) makes skipping scope a
			// deliberate, reviewable edit — a bogus `note` can no longer pass CI.
			const covered = d.scopeCheck !== undefined || SCOPE_EXEMPT_BY_DESIGN.has(method)
			expect(covered, `non-exempt "${method}" has no scopeCheck and is not in SCOPE_EXEMPT_BY_DESIGN`).toBe(true)
		}
		// And the allowlist itself must not rot: every allowlisted method must exist,
		// be non-exempt, and genuinely lack a scopeCheck (else remove it from the list).
		for (const method of SCOPE_EXEMPT_BY_DESIGN) {
			const d = METHOD_REGISTRY[method]
			expect(d, `SCOPE_EXEMPT_BY_DESIGN names "${method}" which has no descriptor`).toBeDefined()
			expect(d.exemptReason, `allowlisted "${method}" is capability-exempt — it shouldn't be in the scope allowlist`).toBeUndefined()
			expect(d.scopeCheck, `allowlisted "${method}" HAS a scopeCheck — remove it from SCOPE_EXEMPT_BY_DESIGN`).toBeUndefined()
		}
	})
})

// ── Add-a-method proof (the Shotgun-Surgery cure, scoped to METADATA) ──
// Proves the win: ONE descriptor row makes a method's authz METADATA flow to
// every derived map; and a MISSING row is caught by the exhaustiveness logic.
// (A method needing a NEW Operation kind still touches the out-of-scope build
// switches, and a new handler method still needs a dispatch() branch — the
// registry centralizes the metadata facts, not the wiring.)

describe("method-descriptors — add-a-method proof (metadata only)", () => {
	const stubChecker: MethodDescriptor["scopeCheck"] = () => {}

	test("one descriptor row → capability + scope + kind all derive for the new method", () => {
		const synthetic: Record<string, MethodDescriptor> = {
			...METHOD_REGISTRY,
			newSinkMethod: {
				capability: "data",
				routing: { via: "network-operation", kind: "aztec_getAddressBook" },
				scopeCheck: stubChecker,
			},
		}
		expect(deriveCapabilityMap(synthetic).newSinkMethod).toBe("data")
		expect(deriveMethodToKind(synthetic).newSinkMethod).toBe("aztec_getAddressBook")
		expect(deriveScopeCheckerMap(synthetic).newSinkMethod).toBe(stubChecker)
		expect(deriveExemptSet(synthetic).has("newSinkMethod")).toBe(false)
	})

	test("a registry MISSING a dispatchable method is caught (silent-omission guard works)", () => {
		const incomplete = Object.fromEntries(Object.entries(METHOD_REGISTRY).filter(([m]) => m !== "sendTx"))
		// This mirrors the exhaustiveness test's forward check against the
		// dispatch handler literals — sendTx is dispatchable, so its absence MUST
		// be detectable. Build failure in real life; assertion here.
		const dispatchable = ["sendTx", "grantPublicAuthwit", "batch"]
		const missing = dispatchable.filter((m) => !(m in incomplete))
		expect(missing).toEqual(["sendTx"])
	})
})

// ── ADD-ONLY (Q-02, owner-authorized): arg-guard assertions ────────────
// Everything ABOVE this marker is the round-1 frozen oracle and is byte-
// identical to its pre-Q-02 state (verified by the surfaced git diff). The
// additions below only pin the NEW argSchema field; no authz assertion is
// touched, and the derive* parity tests above prove the authz maps are
// unchanged by the field's presence.

import { METHOD_REGISTRY as REGISTRY_FOR_ARGS } from "./method-descriptors"

// The exact split, frozen: 11 methods carry an arg guard; 8 deliberately do
// NOT (no-arg methods; methods whose first-arg validation is OWNED by their
// scope checker with pinned error strings; and the disabled method whose
// scope-check error must remain the observable error).
const FROZEN_ARG_GUARDED = new Set([
	"requestCapabilities",
	"batch",
	"createAuthWit",
	"registerToken",
	"isTokenRegistered",
	"registerContract",
	"getContractMetadata",
	"getContractClassMetadata",
	"grantPublicAuthwit",
	"getPrivateEvents",
	"registerSender",
])
const FROZEN_ARG_UNGUARDED = new Set([
	"getChainInfo", // reads no args
	"getAccounts", // reads no args
	"getAddressBook", // reads no args
	"sendTx", // exec validation owned by checkSendTx (pinned error); opts optional
	"simulateTx", // exec validation owned by checkSimulateTx (pinned error); opts optional
	"profileTx", // exec validation owned by checkProfileTx (pinned error); opts optional
	"executeUtility", // call validation owned by checkExecuteUtility (pinned error)
	"registerContractClass", // disabled at scope-check — that error must stay observable
])

describe("method-descriptors — arg guards (Q-02 ADD-only)", () => {
	test("guarded/unguarded split is exact and total over the registry", () => {
		const guarded = new Set(
			Object.entries(REGISTRY_FOR_ARGS)
				.filter(([, d]) => d.argSchema !== undefined)
				.map(([m]) => m),
		)
		const unguarded = new Set(
			Object.entries(REGISTRY_FOR_ARGS)
				.filter(([, d]) => d.argSchema === undefined)
				.map(([m]) => m),
		)
		expect(guarded).toEqual(FROZEN_ARG_GUARDED)
		expect(unguarded).toEqual(FROZEN_ARG_UNGUARDED)
	})

	test("guards are pure pass/fail over the ORIGINAL array — never mutate or replace", () => {
		for (const [method, d] of Object.entries(REGISTRY_FOR_ARGS)) {
			if (!d.argSchema) continue
			const args: unknown[] = [{ a: 1 }, ["x"], "s"]
			const snapshot = JSON.stringify(args)
			const result = d.argSchema(args)
			expect(typeof result, `${method} guard must return boolean`).toBe("boolean")
			expect(JSON.stringify(args), `${method} guard mutated args`).toBe(snapshot)
		}
	})

	test("optional trailing args stay optional; extra args stay tolerated (no max arity)", () => {
		// registerSender(address, alias?) — 1 arg is a complete call today.
		expect(REGISTRY_FOR_ARGS.registerSender.argSchema?.(["0xaddr"])).toBe(true)
		// Extra args beyond the read positions are ignored today — guards must not reject them.
		expect(REGISTRY_FOR_ARGS.registerSender.argSchema?.(["0xaddr", "alias", "extra", 42])).toBe(true)
		expect(REGISTRY_FOR_ARGS.getContractMetadata.argSchema?.(["0xaddr", "spurious"])).toBe(true)
		expect(REGISTRY_FOR_ARGS.createAuthWit.argSchema?.(["0xfrom", { consumer: "0xc", innerHash: "0xh" }, "extra"])).toBe(true)
	})

	test("required-leading arity is enforced fail-closed (the authorized rejection)", () => {
		expect(REGISTRY_FOR_ARGS.getContractMetadata.argSchema?.([])).toBe(false)
		expect(REGISTRY_FOR_ARGS.getContractClassMetadata.argSchema?.([])).toBe(false)
		expect(REGISTRY_FOR_ARGS.isTokenRegistered.argSchema?.([])).toBe(false)
		expect(REGISTRY_FOR_ARGS.registerContract.argSchema?.([])).toBe(false)
		expect(REGISTRY_FOR_ARGS.registerSender.argSchema?.([])).toBe(false)
		expect(REGISTRY_FOR_ARGS.createAuthWit.argSchema?.(["0xfrom"])).toBe(false)
		expect(REGISTRY_FOR_ARGS.getPrivateEvents.argSchema?.([{ meta: true }])).toBe(false)
		expect(REGISTRY_FOR_ARGS.registerToken.argSchema?.(["0xaccount"])).toBe(false)
		expect(REGISTRY_FOR_ARGS.grantPublicAuthwit.argSchema?.(["0xaccount"])).toBe(false)
	})

	test("value coercion tolerance is preserved — scalar args accept ANY present value", () => {
		// These args are String()-coerced downstream; the guard must not add a type requirement.
		expect(REGISTRY_FOR_ARGS.getContractMetadata.argSchema?.([12345])).toBe(true)
		expect(REGISTRY_FOR_ARGS.isTokenRegistered.argSchema?.([null])).toBe(true)
		expect(REGISTRY_FOR_ARGS.registerContract.argSchema?.(["raw-address-string"])).toBe(true)
	})

	test("requestCapabilities matches the handler's tolerance EXACTLY; batch requires well-formed legs", () => {
		// The handler optional-chains the manifest (`manifest?.capabilities ?? []`),
		// so an absent manifest is a valid "no capabilities requested" call and MUST
		// pass — rejecting it would over-tighten vs the pre-guard handler tolerance.
		expect(REGISTRY_FOR_ARGS.requestCapabilities.argSchema?.([])).toBe(true)
		expect(REGISTRY_FOR_ARGS.requestCapabilities.argSchema?.([undefined])).toBe(true)
		expect(REGISTRY_FOR_ARGS.requestCapabilities.argSchema?.([{}])).toBe(true)
		expect(REGISTRY_FOR_ARGS.requestCapabilities.argSchema?.([{ capabilities: [] }])).toBe(true)
		expect(REGISTRY_FOR_ARGS.requestCapabilities.argSchema?.([{ capabilities: [{ type: "data" }] }])).toBe(true)
		// A present manifest must be a plain object whose optional `capabilities` is
		// an array — the handler `.filter`s it, so a non-array `capabilities` is a
		// calibrated reject (not a downstream TypeError), and an array is not an object.
		expect(REGISTRY_FOR_ARGS.requestCapabilities.argSchema?.(["manifest"])).toBe(false)
		expect(REGISTRY_FOR_ARGS.requestCapabilities.argSchema?.([{ capabilities: {} }])).toBe(false)
		expect(REGISTRY_FOR_ARGS.requestCapabilities.argSchema?.([[]])).toBe(false)
		expect(REGISTRY_FOR_ARGS.requestCapabilities.argSchema?.([null])).toBe(false)

		expect(REGISTRY_FOR_ARGS.batch.argSchema?.([[{ name: "getChainInfo", args: [] }]])).toBe(true)
		expect(REGISTRY_FOR_ARGS.batch.argSchema?.([[]])).toBe(true)
		expect(REGISTRY_FOR_ARGS.batch.argSchema?.(["not-an-array"])).toBe(false)
		expect(REGISTRY_FOR_ARGS.batch.argSchema?.([[{ name: 42, args: [] }]])).toBe(false)
		expect(REGISTRY_FOR_ARGS.batch.argSchema?.([[{ name: "x" }]])).toBe(false)
	})

	test("derive* outputs are IDENTICAL with and without argSchema fields (no authz widening)", () => {
		// Strip argSchema from every row and re-derive: every derived authz/routing
		// map must be unchanged — the field is invisible to enforcement derivation.
		const stripped: Record<string, MethodDescriptor> = Object.fromEntries(
			Object.entries(REGISTRY_FOR_ARGS).map(([m, d]) => {
				const { argSchema: _drop, ...rest } = d
				return [m, rest as MethodDescriptor]
			}),
		)
		expect(deriveCapabilityMap(stripped)).toEqual(deriveCapabilityMap(REGISTRY_FOR_ARGS))
		expect(deriveExemptSet(stripped)).toEqual(deriveExemptSet(REGISTRY_FOR_ARGS))
		expect(deriveMethodToKind(stripped)).toEqual(deriveMethodToKind(REGISTRY_FOR_ARGS))
		expect(deriveNetworkOnlyKinds(stripped)).toEqual(deriveNetworkOnlyKinds(REGISTRY_FOR_ARGS))
		expect(deriveAccountKinds(stripped)).toEqual(deriveAccountKinds(REGISTRY_FOR_ARGS))
		expect(deriveScopeCheckerMap(stripped)).toEqual(deriveScopeCheckerMap(REGISTRY_FOR_ARGS))
	})
})
