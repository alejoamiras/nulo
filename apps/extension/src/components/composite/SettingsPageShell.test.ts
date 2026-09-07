import { Flex } from "@nulo/design"
import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import SettingsPageShell from "./SettingsPageShell.vue"

const SubPageHeader = {
	props: ["title", "backTo"],
	template: `<header :data-title="title" :data-back="backTo"><i v-if="$slots.trailing" data-testid="trailing-marker" /><slot name="trailing" /></header>`,
}

function mountShell(props = {}, slots = {}, attrs = {}) {
	return mount(SettingsPageShell, {
		props: { title: "Senders", backTo: "/popup/settings", ...props },
		slots,
		attrs,
		global: { components: { Flex, SubPageHeader } },
	})
}

describe("SettingsPageShell", () => {
	test("the root is the wrapper column and the header comes before the content column", () => {
		const w = mountShell({}, { default: "<p>rows</p>" })
		const root = w.element
		expect(root.tagName).toBe("DIV")
		expect(root.children[0]?.tagName).toBe("HEADER")
		expect(root.children[1]?.tagName).toBe("DIV")
		expect(root.children[1]?.querySelector("p")?.textContent).toBe("rows")
	})

	test("root attributes fall through, so a page's testid lands on the wrapper", () => {
		const w = mountShell({}, {}, { "data-testid": "manage-accounts-page" })
		expect(w.attributes("data-testid")).toBe("manage-accounts-page")
	})

	test("passes title and backTo to the header", () => {
		const w = mountShell({ title: "Manage FPCs", backTo: "/popup/settings/advanced" })
		expect(w.find("header").attributes("data-title")).toBe("Manage FPCs")
		expect(w.find("header").attributes("data-back")).toBe("/popup/settings/advanced")
	})

	test("a title change after mount reaches the header", async () => {
		const w = mountShell({ title: "Devnet" })
		await w.setProps({ title: "Testnet" })
		expect(w.find("header").attributes("data-title")).toBe("Testnet")
	})

	test("forwards the trailing slot into the header only when a page provides it", () => {
		const bare = mountShell()
		expect(bare.find("[data-testid='trailing-marker']").exists()).toBe(false)
		const withActions = mountShell({}, { trailing: "<button data-testid='actions'>…</button>" })
		expect(withActions.find("[data-testid='trailing-marker']").exists()).toBe(true)
		expect(withActions.find("header [data-testid='actions']").exists()).toBe(true)
	})

	test("gap becomes the content column's gap class", () => {
		const w = mountShell({ gap: "16" })
		expect(w.element.children[1]?.className).toContain("gap--16")
	})

	test("no gap means no gap class on the content column", () => {
		const w = mountShell()
		expect(w.element.children[1]?.className).not.toMatch(/gap--/)
	})

	test("the wrapper column carries no gap of its own", () => {
		const w = mountShell({ gap: "24" })
		expect(w.element.className).not.toMatch(/gap--/)
	})

	test("a page's v-if on the shell renders nothing until its record loads, then the whole frame", async () => {
		const Page = {
			components: { SettingsPageShell },
			data: () => ({ network: null as { name: string } | null }),
			template: `<div><SettingsPageShell v-if="network" :title="network.name" backTo="/popup/settings/networks"><p>rows</p></SettingsPageShell></div>`,
		}
		const w = mount(Page, { global: { components: { Flex, SubPageHeader } } })
		expect(w.find("header").exists()).toBe(false)
		expect(w.find("p").exists()).toBe(false)
		await w.setData({ network: { name: "Devnet" } })
		expect(w.find("header").attributes("data-title")).toBe("Devnet")
		expect(w.find("header + div p").text()).toBe("rows")
	})

	test("trailing content never leaks into the content column", () => {
		const w = mountShell({}, { trailing: "<b data-testid='t' />", default: "<i data-testid='d' />" })
		expect(w.element.children[1]?.querySelector("[data-testid='t']")).toBeNull()
		expect(w.element.children[1]?.querySelector("[data-testid='d']")).not.toBeNull()
	})
})
