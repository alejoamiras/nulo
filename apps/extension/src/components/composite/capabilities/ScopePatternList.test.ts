import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import ScopePatternList from "./ScopePatternList.vue"

const stubs = {
	Flex: { inheritAttrs: false, template: `<div v-bind="$attrs"><slot /></div>` },
	Text: { inheritAttrs: false, template: `<span v-bind="$attrs"><slot /></span>` },
	ScopeAddress: { props: ["address"], template: `<i data-testid="scope-address" :data-address="address" />` },
}

const mountList = (scope: unknown) => mount(ScopePatternList, { props: { scope: scope as never }, global: { stubs } })

describe("composite/ScopePatternList", () => {
	test("a wildcard scope renders the single any-contract-any-function line", () => {
		const w = mountList("*")
		expect(w.text()).toContain("Any contract, any function")
		expect(w.findAll("[data-testid='scope-address']")).toHaveLength(0)
	})

	test("a scope that is neither '*' nor an array falls back to the wildcard line", () => {
		expect(mountList({ contract: "0xabc" }).text()).toContain("Any contract, any function")
		expect(mountList(undefined).text()).toContain("Any contract, any function")
	})

	test("an empty pattern list renders the list column with no rows", () => {
		const w = mountList([])
		expect(w.text()).not.toContain("Any contract")
		expect(w.text()).toBe("")
	})

	test("a wildcard contract pattern says Any contract and renders no address", () => {
		const w = mountList([{ contract: "*", function: "*" }])
		expect(w.text()).toContain("Any contract")
		expect(w.text()).not.toContain("Any contract, any function")
		expect(w.find("[data-testid='scope-address']").exists()).toBe(false)
	})

	test("an address pattern routes the contract through ScopeAddress", () => {
		const w = mountList([{ contract: "0xabc", function: "*" }])
		expect(w.find("[data-testid='scope-address']").attributes("data-address")).toBe("0xabc")
	})

	test("a wildcard function renders the bare star with no annotation", () => {
		const w = mountList([{ contract: "0xabc", function: "*" }])
		expect(w.text()).toContain("fn:")
		expect(w.text()).toMatch(/fn:\s*\*/)
		expect(w.text()).not.toContain("·")
	})

	test("a known function shows the raw id AND its friendly label", () => {
		const w = mountList([{ contract: "0xabc", function: "transfer_in_private" }])
		expect(w.text()).toContain("transfer_in_private")
		expect(w.text()).toContain("· Transfer (private)")
	})

	test("an unknown function shows only the raw id", () => {
		const w = mountList([{ contract: "0xabc", function: "totally_made_up_fn" }])
		expect(w.text()).toContain("totally_made_up_fn")
		expect(w.text()).not.toContain("·")
	})

	test("a third-party claim is not labelled as fee juice (the contract argument reaches the label lookup)", () => {
		const w = mountList([{ contract: "0xnotfeejuice", function: "claim" }])
		expect(w.text()).toContain("claim")
		expect(w.text()).not.toContain("·")
	})

	test("the raw function id has control characters stripped and is capped at 64 characters", () => {
		const long = `ab\u0007cd${"a".repeat(70)}`
		const w = mountList([{ contract: "0xabc", function: long }])
		const text = w.text()
		expect(text).not.toContain("\u0007")
		expect(text).toContain(`abcd${"a".repeat(60)}`)
		expect(text).not.toContain("a".repeat(61))
	})

	test("each pattern is one row, in order", () => {
		const w = mountList([
			{ contract: "0x1", function: "*" },
			{ contract: "0x2", function: "transfer" },
		])
		const addresses = w.findAll("[data-testid='scope-address']").map((n) => n.attributes("data-address"))
		expect(addresses).toEqual(["0x1", "0x2"])
	})
})
