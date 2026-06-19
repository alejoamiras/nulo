import { mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { Component } from "vue"
import Flex from "./core/Flex.vue"
import Icon from "./core/Icon.vue"
import MaterialIcon from "./core/MaterialIcon.vue"
import Text from "./core/Text.vue"
import Badge from "./ui/Badge.vue"
import Banner from "./ui/Banner.vue"
import BrutalistTitle from "./ui/BrutalistTitle.vue"
import Checkbox from "./ui/Checkbox.vue"
import LoadingState from "./ui/LoadingState.vue"
import SectionLabel from "./ui/SectionLabel.vue"
import Spinner from "./ui/Spinner.vue"
import Toggle from "./ui/Toggle.vue"

/**
 * Producer-side gate: every migrated SFC must mount with EXPLICIT imports — no reliance on the
 * extension's auto-import (the package + the faucet have none). Fails on a Vue "failed to resolve
 * component" warning or a runtime throw — the exact bug class (e.g. a missing `import { computed }`)
 * that vue-tsc + build silently pass on JS SFCs. Grows as later phases migrate more components.
 */
const cases: Array<[string, Component, Record<string, unknown>]> = [
	["Flex", Flex, {}],
	["Icon", Icon, { name: "external-link" }],
	["Text", Text, {}],
	["MaterialIcon", MaterialIcon, { name: "settings" }],
	["Badge", Badge, {}],
	["BrutalistTitle", BrutalistTitle, { main: "A", sub: "B" }],
	["Checkbox", Checkbox, {}],
	["SectionLabel", SectionLabel, { label: "X" }],
	["Toggle", Toggle, {}],
	["Spinner", Spinner, {}],
	// isLoading:true exercises Banner's <Spinner> branch — the missing-import trap mount-all guards.
	["Banner", Banner, { isLoading: true }],
	["LoadingState", LoadingState, { label: "Loading" }],
]

describe("@nulo/design components mount without auto-import", () => {
	let warn: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		warn = vi.spyOn(console, "warn").mockImplementation(() => {})
	})
	afterEach(() => warn.mockRestore())

	for (const [name, Comp, props] of cases) {
		test(`${name} mounts clean (no unresolved-component warning, no throw)`, () => {
			expect(() => mount(Comp, { props })).not.toThrow()
			const resolveWarnings = warn.mock.calls
				.flat()
				.filter((arg: unknown) => typeof arg === "string" && /resolve component|Failed to resolve/i.test(arg))
			expect(resolveWarnings).toEqual([])
		})
	}
})
