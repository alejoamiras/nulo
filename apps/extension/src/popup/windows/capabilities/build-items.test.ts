import { describe, expect, test } from "vitest"
import { buildCapabilityItems, buildGrantedAccountsCap } from "./build-items"

const transactionCap = { type: "transaction" as const, scope: "*" as const }
const contractsCap = { type: "contracts" as const, contracts: "*" as const, canRegister: true }
const unknownCap = { type: "experimental_v2" as const } as unknown as Parameters<typeof buildCapabilityItems>[0][number]
const accountsCap = { type: "accounts" as const, accounts: [] } as unknown as Parameters<typeof buildCapabilityItems>[0][number]

describe("capabilities/build-items", () => {
	test("recognized capability types default selected=true", () => {
		const items = buildCapabilityItems([transactionCap, contractsCap], [], new Set())
		expect(items.map((i) => i.selected)).toEqual([true, true])
		expect(items.map((i) => i.isUnknown)).toEqual([false, false])
	})

	test("unknown capability types default selected=FALSE (security-critical)", () => {
		// The persistence-by-accident path: if the popup defaults unknown
		// types to selected, a mis-click on Approve persists the grant into
		// the session and a future wallet version could honor it retroactively.
		// Default-OFF forces a deliberate click.
		const items = buildCapabilityItems([unknownCap], [], new Set())
		expect(items).toHaveLength(1)
		expect(items[0].isUnknown).toBe(true)
		expect(items[0].selected).toBe(false)
	})

	test("mixed delta with known + unknown applies different defaults per entry", () => {
		const items = buildCapabilityItems([transactionCap, unknownCap, contractsCap], [], new Set())
		// Same order as input (accounts would be filtered if present, but
		// transactionCap / unknownCap / contractsCap stay).
		expect(items.map((i) => i.capability.type)).toEqual(["transaction", "experimental_v2", "contracts"])
		expect(items.map((i) => i.selected)).toEqual([true, false, true])
	})

	test("accounts capability in the delta is filtered out (popup renders its picker section instead)", () => {
		const items = buildCapabilityItems([transactionCap, accountsCap, contractsCap], [], new Set())
		expect(items.map((i) => i.capability.type)).toEqual(["transaction", "contracts"])
	})

	test("accounts with canCreateAuthWit emits the rider card (selected ON, risk high)", () => {
		const cap = { ...(accountsCap as object), canCreateAuthWit: true } as typeof accountsCap
		const items = buildCapabilityItems([cap], [], new Set())
		expect(items).toHaveLength(1)
		expect(items[0].authwitRider).toBe(true)
		expect(items[0].capability).toBe(cap)
		expect(items[0].isNew).toBe(true)
		expect(items[0].selected).toBe(true)
		expect(items[0].risk).toBe("high")
	})

	test("accounts WITHOUT canCreateAuthWit emits no rider", () => {
		const items = buildCapabilityItems([accountsCap], [], new Set())
		expect(items).toHaveLength(0)
	})

	test("truthy non-boolean canCreateAuthWit still emits the rider (Boolean coercion, mirrors enforcement)", () => {
		// A dApp sending `canCreateAuthWit: 1` is still granted+enforced truthy by
		// the dispatcher/scope-checkers — it must not dodge the consent card.
		const cap = { ...(accountsCap as object), canCreateAuthWit: 1 } as unknown as typeof accountsCap
		const items = buildCapabilityItems([cap], [], new Set())
		expect(items).toHaveLength(1)
		expect(items[0].authwitRider).toBe(true)
	})

	test("buildGrantedAccountsCap: deselected rider strips canCreateAuthWit from the grant", () => {
		const cap = { ...(accountsCap as object), canCreateAuthWit: true } as typeof accountsCap
		const items = buildCapabilityItems([cap], [], new Set())
		items[0].selected = false
		const granted = buildGrantedAccountsCap(cap, items) as { canCreateAuthWit?: unknown }
		expect(granted.canCreateAuthWit).toBe(false)
	})

	test("buildGrantedAccountsCap: selected rider passes the accounts cap through untouched", () => {
		const cap = { ...(accountsCap as object), canCreateAuthWit: true } as typeof accountsCap
		const items = buildCapabilityItems([cap], [], new Set())
		expect(buildGrantedAccountsCap(cap, items)).toBe(cap)
	})

	test("buildGrantedAccountsCap: no rider card (flag never requested) passes through untouched", () => {
		const items = buildCapabilityItems([accountsCap, transactionCap], [], new Set())
		expect(buildGrantedAccountsCap(accountsCap, items)).toBe(accountsCap)
	})

	test("reRequested set propagates to items by type", () => {
		const items = buildCapabilityItems([transactionCap, contractsCap], [], new Set(["transaction"]))
		expect(items.find((i) => i.capability.type === "transaction")?.reRequested).toBe(true)
		expect(items.find((i) => i.capability.type === "contracts")?.reRequested).toBe(false)
	})

	test("existingGrants append after delta items, all marked isNew=false", () => {
		const items = buildCapabilityItems([contractsCap], [transactionCap], new Set())
		expect(items).toHaveLength(2)
		expect(items[0].isNew).toBe(true)
		expect(items[0].capability.type).toBe("contracts")
		expect(items[1].isNew).toBe(false)
		expect(items[1].capability.type).toBe("transaction")
	})

	test("existingGrants default selected=true regardless of known/unknown", () => {
		// Existing grants represent a prior user decision; the popup just
		// displays them. They don't get the default-OFF treatment.
		const items = buildCapabilityItems([], [unknownCap], new Set())
		expect(items[0].isUnknown).toBe(true)
		expect(items[0].selected).toBe(true)
	})

	test("unknown capability head label is the CONSTANT 'Unknown permission' — never the dApp-controlled type", () => {
		// A dApp could send `type: "Read public data only — recommended"`
		// hoping that string paints as the head label. Defense in depth:
		// build-items overrides the label with a constant before the card
		// even sees it. The raw type still appears in the detail panel,
		// passed through sanitizeWireString for forensic clarity.
		const items = buildCapabilityItems([unknownCap], [], new Set())
		expect(items[0].label).toBe("Unknown permission")
		expect(items[0].description).toMatch(/doesn't recognize/)
		expect(items[0].risk).toBe("high")
	})

	test("existingGrants of unknown type also render the constant head label", () => {
		// Same protection on the read-only "already granted" section. If a
		// dApp's session carries a stale grant of an unknown type from an
		// older popup version, we still don't paint its raw type as a head.
		const items = buildCapabilityItems([], [unknownCap], new Set())
		expect(items[0].label).toBe("Unknown permission")
		expect(items[0].isUnknown).toBe(true)
	})
})
