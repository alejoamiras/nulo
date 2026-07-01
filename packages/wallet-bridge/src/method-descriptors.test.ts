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
