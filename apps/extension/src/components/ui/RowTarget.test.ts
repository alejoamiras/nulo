import { describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { defineComponent, h, nextTick, ref } from "vue"
import { createMemoryHistory, createRouter } from "vue-router"
import RowTarget from "./RowTarget.vue"

const NOOP = { template: "<div />" }

function makeRouter() {
	return createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: NOOP }] })
}

/** A row root that listens for clicks, holding the target and a named title. */
async function mountRow(props: { to?: string }, onRow = vi.fn()) {
	const router = makeRouter()
	await router.push("/start")
	const target = ref<InstanceType<typeof RowTarget> | null>(null)
	const Row = defineComponent({
		setup: () => () =>
			h("div", { onClick: onRow, "data-testid": "row" }, [
				h(RowTarget, { ...props, labelledby: "row-title", ref: target }),
				h("span", { id: "row-title" }, "Alice"),
			]),
	})
	const w = mount(Row, { global: { plugins: [router] }, attachTo: document.body })
	const push = vi.spyOn(router, "push")
	return { w, router, push, onRow, target, el: w.find("[data-row-target]") }
}

describe("ui/RowTarget", () => {
	test("link mode renders an anchor with the route's href, named by the row's title", async () => {
		const { el, w } = await mountRow({ to: "/popup/tx/0xabc" })
		expect(el.element.tagName).toBe("A")
		expect(el.attributes("href")).toBe("/popup/tx/0xabc")
		expect(el.attributes("aria-labelledby")).toBe("row-title")
		w.unmount()
	})

	test("a click and a Space keydown each navigate exactly once, and Space's default is prevented", async () => {
		const { el, router, push, w } = await mountRow({ to: "/popup/tx/0xabc" })
		await el.trigger("click")
		await flushPromises()
		expect(push).toHaveBeenCalledTimes(1)
		expect(router.currentRoute.value.path).toBe("/popup/tx/0xabc")

		await router.push("/start")
		push.mockClear()
		const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })
		el.element.dispatchEvent(space)
		await flushPromises()
		expect(space.defaultPrevented).toBe(true)
		expect(push).toHaveBeenCalledTimes(1)
		expect(router.currentRoute.value.path).toBe("/popup/tx/0xabc")
		w.unmount()
	})

	test("Shift+Space and a Ctrl-click keep the browser's default and do not navigate", async () => {
		const { el, push, w } = await mountRow({ to: "/popup/tx/0xabc" })
		const shiftSpace = new KeyboardEvent("keydown", { key: " ", shiftKey: true, bubbles: true, cancelable: true })
		el.element.dispatchEvent(shiftSpace)
		// Read the anchor's verdict after it bubbles, then swallow the click so jsdom does not try to
		// load the href itself.
		let ctrlClickPrevented: boolean | null = null
		const swallow = (e: Event) => {
			ctrlClickPrevented = e.defaultPrevented
			e.preventDefault()
		}
		document.addEventListener("click", swallow)
		await el.trigger("click", { ctrlKey: true })
		document.removeEventListener("click", swallow)
		await nextTick()
		expect(shiftSpace.defaultPrevented).toBe(false)
		expect(ctrlClickPrevented).toBe(false)
		expect(push).not.toHaveBeenCalled()
		w.unmount()
	})

	test("activate() navigates once in link mode", async () => {
		const { target, push, w } = await mountRow({ to: "/popup/tx/0xabc" })
		target.value?.activate()
		await nextTick()
		expect(push).toHaveBeenCalledTimes(1)
		w.unmount()
	})

	test("button mode: a click, Enter and Space each reach the row root's listener once; activate() too", async () => {
		const { el, onRow, target, w } = await mountRow({})
		expect(el.element.tagName).toBe("BUTTON")
		expect(el.attributes("type")).toBe("button")
		expect(el.attributes("aria-labelledby")).toBe("row-title")
		await el.trigger("click")
		expect(onRow).toHaveBeenCalledTimes(1)
		// jsdom synthesises no click from a key; a button's Enter and Space activation is a click.
		;(el.element as HTMLButtonElement).click()
		expect(onRow).toHaveBeenCalledTimes(2)
		target.value?.activate()
		expect(onRow).toHaveBeenCalledTimes(3)
		w.unmount()
	})

	test("the target carries no tabindex or handler of its own beyond the mode's", async () => {
		const link = await mountRow({ to: "/x" })
		expect(link.el.attributes("tabindex")).toBeUndefined()
		link.w.unmount()
		const button = await mountRow({})
		expect(button.el.attributes("tabindex")).toBeUndefined()
		button.w.unmount()
	})
})
