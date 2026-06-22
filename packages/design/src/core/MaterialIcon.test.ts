import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import MaterialIcon from "./MaterialIcon.vue"

describe("MaterialIcon", () => {
	test("renders the ligature name as text", () => {
		expect(mount(MaterialIcon, { props: { name: "settings" } }).text()).toBe("settings")
	})

	test("has the material-symbols-outlined class", () => {
		expect(mount(MaterialIcon, { props: { name: "settings" } }).classes()).toContain("material-symbols-outlined")
	})

	test("color → color-- class (default primary, overridable)", () => {
		expect(mount(MaterialIcon, { props: { name: "settings" } }).classes()).toContain("color--primary")
		expect(mount(MaterialIcon, { props: { name: "settings", color: "red" } }).classes()).toContain("color--red")
	})

	test("size → fontSize style", () => {
		expect(mount(MaterialIcon, { props: { name: "settings", size: 32 } }).attributes("style")).toContain("32px")
	})

	test("default size is 24px", () => {
		expect(mount(MaterialIcon, { props: { name: "settings" } }).attributes("style")).toContain("24px")
	})
})
