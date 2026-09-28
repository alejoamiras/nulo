import { describe, expect, test } from "vitest"
import { applyRootFlags } from "./root-flags"

describe("applyRootFlags", () => {
	test("a route that fills its window marks <html>, and the next route without the flag clears it", () => {
		const root = document.createElement("html")
		applyRootFlags(root, { fillsWindow: true })
		expect(root.getAttribute("data-fills-window")).toBe("true")
		applyRootFlags(root, {})
		expect(root.getAttribute("data-fills-window")).toBe("false")
	})

	test("the nav flag follows showBottomNav and nothing else", () => {
		const root = document.createElement("html")
		applyRootFlags(root, { showBottomNav: true })
		expect([root.getAttribute("data-has-nav"), root.getAttribute("data-fills-window")]).toEqual(["true", "false"])
		applyRootFlags(root, { fillsWindow: true })
		expect([root.getAttribute("data-has-nav"), root.getAttribute("data-fills-window")]).toEqual(["false", "true"])
	})
})
