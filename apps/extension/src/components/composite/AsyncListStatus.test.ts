import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import AsyncListStatus from "./AsyncListStatus.vue"

const stubs = {
	LoadingState: { props: ["label"], template: `<p data-testid="loading">{{ label }}</p>` },
	Tooltip: {
		props: { wide: Boolean },
		template: `<div data-testid="tooltip" :data-wide="wide"><slot /><aside data-testid="tooltip-content"><slot name="content" /></aside></div>`,
	},
	Banner: {
		props: { action: Object, variant: String, wide: Boolean },
		template: `<div data-testid="banner" :data-variant="variant" :data-wide="wide"><slot /><button data-testid="banner-action" @click="action.callback()">{{ action.name }}</button></div>`,
	},
}

const mountStatus = (props: Record<string, unknown>) =>
	mount(AsyncListStatus, { props: { label: "FETCHING SENDERS", ...props }, global: { stubs } })

describe("AsyncListStatus", () => {
	test("loading renders the loading line with the page's label", () => {
		const w = mountStatus({ loading: true })
		expect(w.find("[data-testid='loading']").text()).toBe("FETCHING SENDERS")
		expect(w.find("[data-testid='banner']").exists()).toBe(false)
	})

	test("loading wins over an error", () => {
		const w = mountStatus({ loading: true, error: new Error("boom") })
		expect(w.find("[data-testid='loading']").exists()).toBe(true)
		expect(w.find("[data-testid='tooltip']").exists()).toBe(false)
	})

	test("an error renders the wide error banner with its retry action", () => {
		const w = mountStatus({ error: new Error("boom") })
		const banner = w.find("[data-testid='banner']")
		expect(banner.attributes("data-variant")).toBe("error")
		expect(banner.attributes("data-wide")).toBe("true")
		expect(banner.text()).toContain("Something went wrong")
		expect(w.find("[data-testid='banner-action']").text()).toBe("Try again")
	})

	test("the tooltip is wide and its content is the error itself", () => {
		const w = mountStatus({ error: new Error("boom") })
		expect(w.find("[data-testid='tooltip']").attributes("data-wide")).toBe("true")
		expect(w.find("[data-testid='tooltip-content']").text()).toBe("Error: boom")
	})

	test("a string error renders verbatim", () => {
		const w = mountStatus({ error: "network down" })
		expect(w.find("[data-testid='tooltip-content']").text()).toBe("network down")
	})

	test.each([[null], [undefined], [""], [false]])("a falsy error (%s) renders nothing", (error) => {
		const w = mountStatus({ error })
		expect(w.html()).not.toContain("data-testid")
	})

	test("retry emits once per click", async () => {
		const w = mountStatus({ error: new Error("boom") })
		await w.find("[data-testid='banner-action']").trigger("click")
		expect(w.emitted("retry")).toHaveLength(1)
	})

	test("loading → error → settled follows the page's fetch cycle", async () => {
		const w = mountStatus({ loading: true })
		expect(w.find("[data-testid='loading']").exists()).toBe(true)
		await w.setProps({ loading: false, error: new Error("boom") })
		expect(w.find("[data-testid='loading']").exists()).toBe(false)
		expect(w.find("[data-testid='banner']").exists()).toBe(true)
		await w.setProps({ error: null })
		expect(w.html()).not.toContain("data-testid")
	})

	test("the label is only used while loading", () => {
		const w = mountStatus({ error: new Error("boom"), label: "FETCHING NOTES" })
		expect(w.text()).not.toContain("FETCHING NOTES")
	})
})
