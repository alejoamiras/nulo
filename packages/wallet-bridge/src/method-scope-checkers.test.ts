import { describe, expect, test } from "vitest"
import { ScopeViolationError } from "@nulo/extension-messaging/errors"
import type { GrantedCapabilityRecord } from "./capabilities"
import type { MethodName } from "./method-descriptors"
import { authorizationsEffective, coversAnyContract, effectiveGrants, isAnyContractScope, readConsent } from "./method-scope-checkers"
import { enforceScopeWithSession } from "./scope-enforcement"

const A = "0x1111111111111111111111111111111111111111111111111111111111111111"
const B = "0x2222222222222222222222222222222222222222222222222222222222222222"

const listed = (...contracts: string[]) => contracts.map((contract) => ({ contract, function: "transfer" }))
const tx = (scope: unknown) => ({ type: "transaction", scope })
const accounts = { type: "accounts", canGet: true, canCreateAuthWit: true }

describe("isAnyContractScope", () => {
	test.each([
		["the any-contract scope", "*", true],
		["a pattern whose contract is any", [{ contract: "*", function: "transfer" }], true],
		["a listed pattern", listed(A), false],
		["a listed pattern for every function", [{ contract: A, function: "*" }], false],
		["no patterns", [], false],
		["a scope string other than any", "all", true],
		["a missing scope", undefined, true],
		["a pattern that is not an object", [A], true],
		["a pattern with a non-string contract", [{ contract: 1, function: "transfer" }], true],
		["a pattern without a function", [{ contract: A }], true],
	])("%s", (_name, scope, expected) => {
		expect(isAnyContractScope(scope)).toBe(expected)
	})
})

describe("coversAnyContract", () => {
	test.each([
		["no capabilities", [], false],
		["a listed transaction scope", [tx(listed(A))], false],
		["an any-contract transaction scope", [tx("*")], true],
		["a listed simulation transactions scope", [{ type: "simulation", transactions: { scope: listed(A) } }], false],
		["an any-contract simulation transactions scope", [{ type: "simulation", transactions: { scope: "*" } }], true],
		["an any-contract utilities scope alone", [{ type: "simulation", utilities: { scope: "*" } }], false],
		["a malformed simulation transactions container", [{ type: "simulation", transactions: "*" }], true],
		["an any-contract scope beside a listed one", [tx(listed(A)), { type: "simulation", transactions: { scope: "*" } }], true],
		["other types only", [accounts, { type: "contracts", contracts: "*" }], false],
	])("%s", (_name, caps, expected) => {
		expect(coversAnyContract(caps)).toBe(expected)
	})
})

describe("readConsent", () => {
	test.each([
		["a broad consent", { broad: true }, { broad: true }],
		["a narrow consent", { broad: false }, { broad: false }],
		["absent", undefined, undefined],
		["null", null, undefined],
		["a bare true", true, undefined],
		["a string broad", { broad: "true" }, undefined],
		["an empty object", {}, undefined],
		["an extra field", { broad: true, scope: "*" }, undefined],
		["an array", [true], undefined],
	])("%s", (_name, value, expected) => {
		expect(readConsent(value)).toEqual(expected)
	})
})

describe("authorizationsEffective", () => {
	test.each([
		["absent asks", undefined, [accounts, tx(listed(A))], false],
		["malformed asks", { broad: 1 }, [accounts, tx(listed(A))], false],
		["narrow over listed scopes signs", { broad: false }, [accounts, tx(listed(A))], true],
		["narrow then widened to any contract asks", { broad: false }, [accounts, tx("*")], false],
		["narrow then widened to more listed contracts signs", { broad: false }, [accounts, tx(listed(A, B))], true],
		[
			"narrow then a listed pattern widened to every function signs",
			{ broad: false },
			[accounts, tx([{ contract: A, function: "*" }])],
			true,
		],
		["broad over any contract signs", { broad: true }, [accounts, tx("*")], true],
	])("%s", (_name, consent, caps, expected) => {
		expect(authorizationsEffective(consent, caps)).toBe(expected)
	})
})

describe("effectiveGrants", () => {
	test("a delta type replaces the held grant of that type", () => {
		expect(effectiveGrants([accounts, tx(listed(A))], [tx("*")])).toEqual([accounts, tx("*")])
	})

	test("a delta type the app does not hold is appended", () => {
		const contracts = { type: "contracts", contracts: [A] }
		expect(effectiveGrants([accounts], [contracts])).toEqual([accounts, contracts])
	})

	test("unknown types replace and append like known ones", () => {
		const held = { type: "x-vendor", level: 1 }
		const next = { type: "x-vendor", level: 2 }
		expect(effectiveGrants([accounts, held], [next])).toEqual([accounts, next])
		expect(effectiveGrants([accounts], [held])).toEqual([accounts, held])
	})

	test("a held type absent from the delta stays, as a rejected type's grant does", () => {
		const data = { type: "data", privateEvents: { contracts: [A] } }
		expect(effectiveGrants([accounts, data], [tx(listed(A))])).toEqual([accounts, data, tx(listed(A))])
	})
})

describe("no request value reaches a scope refusal", () => {
	const grant = (capability: unknown) => ({ capability, grantedAt: 0 }) as GrantedCapabilityRecord
	const contracts = (flags: Record<string, boolean>) => grant({ type: "contracts", contracts: [A], ...flags })
	const listedSimulation = (sub: "transactions" | "utilities") => grant({ type: "simulation", [sub]: { scope: listed(A) } })
	const noAddressBook = grant({ type: "data", addressBook: false })
	const sessionAccounts = new Set([`aztec:0:${A}`, A])
	const call = { to: "SENTINEL-TO", name: "SENTINEL-NAME" }
	const exec = { calls: [call], scopes: ["SENTINEL-EXEC-SCOPE"] }
	const opts = { from: "SENTINEL-FROM", scopes: ["SENTINEL-OPTS-SCOPE"], additionalScopes: ["SENTINEL-ADDITIONAL-SCOPE"] }
	const callIntent = { caller: "SENTINEL-CALLER", call }
	const innerHash = { consumer: "SENTINEL-CONSUMER", innerHash: "SENTINEL-INNER-HASH" }
	const events = { contractAddress: "SENTINEL-CONTRACT", scopes: ["SENTINEL-EVENT-SCOPE"] }
	const outsideSession = (field: string) => `Scope violation: ${field} entry not in session's approved accounts`

	// Each row's grants refuse it, and its message pins the branch that threw. Only a raw hash, which
	// no grant can admit, stays a plain Error.
	const refusals: [string, MethodName, unknown[], GrantedCapabilityRecord[], string, boolean][] = [
		[
			"registerContract, the contract",
			"registerContract",
			[{ address: "SENTINEL-ADDRESS" }],
			[contracts({ canRegister: true })],
			"Scope violation: registerContract contract not permitted by granted contracts scope",
			true,
		],
		[
			"getContractMetadata, the contract",
			"getContractMetadata",
			["SENTINEL-ADDRESS"],
			[contracts({ canGetMetadata: true })],
			"Scope violation: getContractMetadata contract not permitted by granted contracts scope",
			true,
		],
		[
			"isTokenRegistered, the token",
			"isTokenRegistered",
			["SENTINEL-TOKEN", { scopes: ["SENTINEL-OPTS-SCOPE"] }],
			[contracts({ canGetMetadata: true })],
			"Scope violation: isTokenRegistered contract not permitted by granted contracts scope",
			true,
		],
		[
			"getContractClassMetadata, the class",
			"getContractClassMetadata",
			["SENTINEL-CLASS"],
			[grant({ type: "contractClasses", classes: [A], canGetMetadata: true })],
			"Scope violation: getContractClassMetadata class not permitted by granted contractClasses scope",
			true,
		],
		[
			"sendTx, a call",
			"sendTx",
			[exec, opts],
			[grant(tx(listed(A)))],
			"Scope violation: sendTx call not permitted by granted transaction scope",
			true,
		],
		[
			"grantPublicAuthwit, the call",
			"grantPublicAuthwit",
			[
				"SENTINEL-FROM",
				{ caller: "SENTINEL-CALLER", contract: "SENTINEL-CONTRACT", method: "SENTINEL-METHOD", args: ["SENTINEL-ARG"] },
			],
			[grant(tx(listed(A)))],
			"Scope violation: grantPublicAuthwit call not permitted by granted transaction scope",
			true,
		],
		[
			"simulateTx, a call",
			"simulateTx",
			[exec, opts],
			[listedSimulation("transactions")],
			"Scope violation: simulateTx call not permitted by granted simulation.transactions scope",
			true,
		],
		[
			"profileTx, a call",
			"profileTx",
			[exec, opts],
			[listedSimulation("transactions")],
			"Scope violation: profileTx call not permitted by granted simulation.transactions scope",
			true,
		],
		[
			"executeUtility, the call",
			"executeUtility",
			[call, opts],
			[listedSimulation("utilities")],
			"Scope violation: executeUtility call not permitted by granted simulation.utilities scope",
			true,
		],
		[
			"getPrivateEvents, the contract",
			"getPrivateEvents",
			[{ eventName: "SENTINEL-EVENT" }, events],
			[grant({ type: "data", privateEvents: { contracts: [A] } })],
			"Scope violation: getPrivateEvents contract not permitted by granted data.privateEvents scope",
			true,
		],
		[
			"createAuthWit, the account",
			"createAuthWit",
			["SENTINEL-FROM", callIntent],
			[grant({ ...accounts, accounts: [{ alias: "a", item: A }] })],
			"Scope violation: createAuthWit account not permitted by granted accounts scope",
			true,
		],
		[
			"createAuthWit, the call",
			"createAuthWit",
			["SENTINEL-FROM", callIntent],
			[grant(tx(listed(A)))],
			"Scope violation: createAuthWit call not permitted by granted transaction or simulation scope",
			true,
		],
		[
			"createAuthWit, the inner hash's consumer",
			"createAuthWit",
			["SENTINEL-FROM", innerHash],
			[grant(tx(listed(A)))],
			"Scope violation: createAuthWit inner-hash consumer not permitted by granted transaction or simulation scope",
			true,
		],
		[
			"createAuthWit, a raw message hash (regression control)",
			"createAuthWit",
			["SENTINEL-FROM", "SENTINEL-HASH"],
			[grant(accounts)],
			"Scope violation: createAuthWit requires a structured call intent; a raw message hash cannot be authorized",
			false,
		],
		[
			"getAccounts, the canGet flag",
			"getAccounts",
			[],
			[grant({ type: "accounts", canGet: false })],
			"Scope violation: getAccounts requires accounts.canGet=true",
			true,
		],
		[
			"getAddressBook, the addressBook flag",
			"getAddressBook",
			[],
			[noAddressBook],
			"Scope violation: getAddressBook requires data.addressBook=true",
			true,
		],
		[
			"registerSender, the addressBook flag",
			"registerSender",
			["SENTINEL-ADDRESS", "SENTINEL-ALIAS"],
			[noAddressBook],
			"Scope violation: registerSender requires data.addressBook=true",
			true,
		],
		[
			"sendTx, an exec.scopes account",
			"sendTx",
			[exec, { from: "SENTINEL-FROM" }],
			[grant(tx("*"))],
			outsideSession("sendTx.exec.scopes"),
			true,
		],
		[
			"sendTx, an opts.scopes account",
			"sendTx",
			[{ calls: [call] }, { from: "SENTINEL-FROM", scopes: ["SENTINEL-OPTS-SCOPE"] }],
			[grant(tx("*"))],
			outsideSession("sendTx.opts.scopes"),
			true,
		],
		[
			"sendTx, an opts.additionalScopes account",
			"sendTx",
			[{ calls: [call] }, { from: "SENTINEL-FROM", additionalScopes: ["SENTINEL-ADDITIONAL-SCOPE"] }],
			[grant(tx("*"))],
			outsideSession("sendTx.opts.additionalScopes"),
			true,
		],
		[
			"getPrivateEvents, a filter's scopes account",
			"getPrivateEvents",
			[{ eventName: "SENTINEL-EVENT" }, events],
			[grant({ type: "data", privateEvents: { contracts: "*" } })],
			outsideSession("getPrivateEvents.opts.scopes"),
			true,
		],
	]

	test.each(refusals)("%s", (_name, method, args, grants, message, typed) => {
		let refusal: Error | undefined
		try {
			enforceScopeWithSession(method, args, grants, sessionAccounts)
		} catch (error) {
			refusal = error as Error
		}
		expect(refusal).toBeInstanceOf(Error)
		const serialized = JSON.stringify({ ...refusal, message: refusal?.message, stack: refusal?.stack })
		expect({ typed: refusal instanceof ScopeViolationError, message: refusal?.message, leaks: /SENTINEL-/.test(serialized) }).toEqual({
			typed,
			message,
			leaks: false,
		})
	})
})
