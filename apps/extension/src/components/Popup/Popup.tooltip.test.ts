import { Flex, Tooltip } from "@nulo/design"
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { nextTick } from "vue"

vi.mock("@/utils/core", () => ({ managers: { profile: { refreshSession: vi.fn() } } }))

import Popup from "./Popup.vue"

enableAutoUnmount(afterEach)

const byTestId = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)
const tooltipOpen = () => byTestId("tooltip-bubble") !== null
const popupOpen = () => byTestId("popup-content") !== null

/** focus-trap activates after a tick and returns focus on a timer. */
const settle = async () => {
	await nextTick()
	await flushPromises()
	await new Promise((resolve) => setTimeout(resolve, 0))
	await flushPromises()
}

const pressEscape = async (target: Element) => {
	target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
	await settle()
}

const mountHost = (template: string) =>
	mount(
		{ components: { Popup, Tooltip }, data: () => ({ show: false }), template },
		{ attachTo: document.body, global: { components: { Flex } } },
	)

describe("Popup with a tooltip", () => {
	beforeEach(() => {
		document.body.innerHTML = '<div id="popup"></div><div id="tooltip"></div>'
	})
	afterEach(() => {
		document.body.innerHTML = ""
	})

	test("a tooltip open inside the popup takes the first Escape; the second closes the popup", async () => {
		mountHost(`<div>
			<button data-testid="opener" @click="show = true">open</button>
			<Popup :show="show" :displaceIdx="1" @onClose="show = false">
				<div data-testid="popup-content">
					<Tooltip><button data-testid="inside">in</button><template #content>Tip</template></Tooltip>
				</div>
			</Popup>
		</div>`)
		const opener = byTestId("opener") as HTMLElement
		opener.focus()
		opener.click()
		await settle()
		expect(popupOpen()).toBe(true)

		const inside = byTestId("inside") as HTMLElement
		inside.focus()
		await settle()
		expect(tooltipOpen()).toBe(true)

		await pressEscape(inside)
		expect(tooltipOpen()).toBe(false)
		expect(popupOpen()).toBe(true)

		await pressEscape(inside)
		expect(popupOpen()).toBe(false)
		expect(document.activeElement).toBe(opener)
	})

	test("a popup opened from a tooltip's trigger gets the first Escape, and focus stays on the trigger", async () => {
		mountHost(`<div>
			<Tooltip>
				<button data-testid="trigger" @click="show = true">Delete profile</button>
				<template #content>Tip</template>
			</Tooltip>
			<Popup :show="show" :displaceIdx="1" @onClose="show = false">
				<div data-testid="popup-content"><button>in</button></div>
			</Popup>
		</div>`)
		const trigger = byTestId("trigger") as HTMLElement
		trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }))
		trigger.focus()
		trigger.click()
		await settle()
		expect(popupOpen()).toBe(true)
		expect(tooltipOpen()).toBe(false)

		await pressEscape(trigger)
		expect(popupOpen()).toBe(false)
		expect(document.activeElement).toBe(trigger)
		expect(tooltipOpen()).toBe(false)
	})
})
