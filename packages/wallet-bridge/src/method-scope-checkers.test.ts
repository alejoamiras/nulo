import { describe, expect, test } from "vitest"
import { authorizationsEffective, coversAnyContract, effectiveGrants, isAnyContractScope, readConsent } from "./method-scope-checkers"

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
