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
// surface, independent of any schema). Must match the branches in
// dispatcher.ts dispatch()/handleSendTx/handleRegisterToken/handleGrantPublicAuthwit.
const DISPATCH_HANDLER_LITERALS = [
	"requestCapabilities",
	"getAccounts",
	"isTokenRegistered",
	"sendTx",
	"registerToken",
	"grantPublicAuthwit",
	"batch",
]

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

	test("deriveScopeCheckerMap keys === frozen 14 names AND each checker is identical by reference", () => {
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
		await import("../../extension/src/wallet/services/wallet-sdk/nulo-schema-patch")
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
			expect(METHOD_REGISTRY[m], `dispatch() handles "${m}" but it has no MethodDescriptor`).toBeDefined()
		}
	})

	test("scope-or-note invariant: every NON-exempt method has a scopeCheck OR an explicit note", () => {
		for (const [method, d] of Object.entries(METHOD_REGISTRY)) {
			if (d.exemptReason !== undefined) continue // exempt methods have no scope dimension
			const hasGuardOrJustification = d.scopeCheck !== undefined || d.note !== undefined
			expect(hasGuardOrJustification, `non-exempt "${method}" has neither a scopeCheck nor a note explaining why`).toBe(true)
		}
	})
})

// Type-only usage so the import isn't dead while the file is additive in Phase 1.
const _typeProbe: MethodDescriptor | undefined = METHOD_REGISTRY.getChainInfo
void _typeProbe
