import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import { FpcType } from "@/wallet/services/fpc/client"
import FeeMethodRow from "./FeeMethodRow.vue"

const STUBS = {
	// Flex must forward attributes (data-testid) via inheritAttrs to keep
	// e2e selectors visible in tests.
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
}

const factory = (props: Record<string, unknown> = {}) => mount(FeeMethodRow, { props, global: { stubs: STUBS } })

describe("FeeMethodRow", () => {
	test("'fj' method renders the formatted FJ available row", () => {
		const w = factory({
			method: { type: "fj" },
			feeJuiceBalanceFormatted: "12.5",
		})
		const text = w.text()
		expect(text).toContain("Available")
		expect(text).toContain("12.5 Fee Juice")
	})

	test("'fj' method shows skeleton while loading", () => {
		const w = factory({ method: { type: "fj" }, isLoading: true, feeJuiceBalanceFormatted: "12" })
		expect(w.text()).not.toContain("12 Fee Juice")
		expect(w.html()).toMatch(/skeleton/)
	})

	test("'private_fpc' method with registered fpc renders private FJ value", () => {
		const w = factory({
			method: { type: "private_fpc", fpc: { id: "p1", type: FpcType.PrivateFpc } },
			privateFeeJuiceFormatted: "7.0",
		})
		expect(w.text()).toContain("Available")
		expect(w.text()).toContain("7.0 FJ")
	})

	test("'private_fpc' method without registered fpc shows 'Not available'", () => {
		const w = factory({ method: { type: "private_fpc", fpc: null } })
		expect(w.text()).toContain("Not available")
	})

	test("'private_fpc' method with null privateFeeJuice falls back to —", () => {
		const w = factory({
			method: { type: "private_fpc", fpc: { id: "p1", type: FpcType.PrivateFpc } },
			privateFeeJuiceFormatted: null,
		})
		expect(w.text()).toContain("— FJ")
	})

	test("Sponsored FPC renders nothing extra (no detail rows)", () => {
		const w = factory({
			method: {
				type: "fpc",
				fpc: { id: "s1", type: FpcType.DefaultSponsoredFpc },
			},
		})
		expect(w.text()).not.toContain("Available")
		expect(w.text()).not.toContain("Visibility")
	})

	test("'fpc' with no Sponsored detail rows does not render the visibility toggle", () => {
		// Defense-in-depth: the DefaultFpc-specific toggle is gone after Token FPC removal.
		const w = factory({
			method: {
				type: "fpc",
				fpc: { id: "s1", type: FpcType.DefaultSponsoredFpc },
			},
		})
		expect(w.find('[data-testid="send-fee-visibility-toggle"]').exists()).toBe(false)
	})
})
