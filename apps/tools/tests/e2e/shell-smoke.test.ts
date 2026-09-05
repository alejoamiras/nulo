/*
 * Shell smoke. Mounts App.vue in jsdom over the same mocked SDK boundary as tools-smoke and walks
 * the shell itself: the rail, the section header's wallet chips, the Activity page, and the
 * completion toast that must fire whichever section is showing.
 */

import { flushPromises, type VueWrapper } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@aztec/wallet-sdk/manager", async () => (await import("./fixtures/sdk-boundary")).walletManagerModule())
vi.mock("@/lib/emoji", async () => (await import("./fixtures/sdk-boundary")).emojiModule())
vi.mock("@aztec/aztec.js/node", async () => (await import("./fixtures/sdk-boundary")).aztecNodeModule())
vi.mock("@/contracts/deployments", async () => (await import("./fixtures/sdk-boundary")).deploymentsModule())
vi.mock("@/contracts/sponsored-fpc", async () => (await import("./fixtures/sdk-boundary")).sponsoredFpcModule())
vi.mock("@/contracts/private-fpc", async () => (await import("./fixtures/sdk-boundary")).privateFpcModule())
vi.mock("@/contracts/bridge-generation", async (importActual) =>
	(await import("./fixtures/sdk-boundary")).bridgeGenerationModule(importActual),
)
vi.mock("@aztec/aztec.js/contracts", async () => (await import("./fixtures/sdk-boundary")).aztecContractsModule())
vi.mock("@aztec/aztec.js/addresses", async (importActual) => importActual())
vi.mock("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Dripper.js", async () =>
	(await import("./fixtures/sdk-boundary")).dripperArtifactModule(),
)
vi.mock("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js", async () =>
	(await import("./fixtures/sdk-boundary")).tokenArtifactModule(),
)

import { __resetJournalForTests, lastCompleted } from "@/composables/useBridgeJournal"
import { __resetDockStateForTests } from "@/composables/useDockState"
import { __resetDripForTests } from "@/composables/useDrip"
import { __resetShellForTests } from "@/composables/useShell"
import { __resetToastsForTests } from "@/composables/useToast"
import { __resetWalletConnectionForTests } from "@/composables/useWalletConnection"
import { IS_PLACEHOLDER } from "@/contracts/bridge-generation"
import { TESTIDS } from "@/lib/testids"
import { mountApp, resetBoundary } from "./fixtures/sdk-boundary"

const sel = (t: string) => `[data-testid="${t}"]`

describe("shell smoke", () => {
	let wrapper: VueWrapper | null = null

	beforeEach(() => {
		localStorage.clear()
		__resetWalletConnectionForTests()
		__resetDripForTests()
		__resetToastsForTests()
		__resetShellForTests()
		__resetDockStateForTests()
		if (!IS_PLACEHOLDER) __resetJournalForTests()
		resetBoundary()
	})

	afterEach(() => {
		wrapper?.unmount()
		wrapper = null
		vi.clearAllMocks()
		document.body.innerHTML = ""
	})

	it("1. the rail lands on the faucet with three sections, and Tab reaches exactly one of them", async () => {
		wrapper = await mountApp()
		const rail = wrapper.get(sel(TESTIDS.tabs))
		expect(rail.attributes("role")).toBe("tablist")
		const tabs = [TESTIDS.tabSend, TESTIDS.tabDrip, TESTIDS.tabActivity].map((id) => wrapper?.get(sel(id)))
		expect(tabs.map((t) => t?.attributes("tabindex"))).toEqual(["-1", "0", "-1"])
		expect(wrapper.find(sel(TESTIDS.dripView)).isVisible()).toBe(true)
		expect(wrapper.find(sel(TESTIDS.sendView)).isVisible()).toBe(false)
	})

	it("2. each section keeps its wallet chips in the header: the faucet chip alone, Ethereum + Aztec elsewhere", async () => {
		wrapper = await mountApp()
		const header = () => wrapper?.get(sel(TESTIDS.sectionHeader))
		expect(header()?.find(sel(TESTIDS.status)).exists()).toBe(true)
		expect(header()?.find(sel(TESTIDS.l1Status)).exists()).toBe(false)
		await wrapper.get(sel(TESTIDS.tabSend)).trigger("click")
		await flushPromises()
		expect(header()?.find(sel(TESTIDS.l1Status)).exists()).toBe(true)
		expect(header()?.find(sel(TESTIDS.bridgeL2Status)).exists()).toBe(true)
		expect(header()?.find(sel(TESTIDS.status)).exists()).toBe(false)
		// The wizard view no longer carries chips of its own.
		expect(wrapper.get(sel(TESTIDS.sendView)).find(sel(TESTIDS.l1Status)).exists()).toBe(false)
	})

	it("3. Activity is a page: the first-visit tiles route to Send and Faucet; the dock is not there", async () => {
		wrapper = await mountApp()
		await wrapper.get(sel(TESTIDS.tabActivity)).trigger("click")
		await flushPromises()
		expect(wrapper.find(sel(TESTIDS.activityView)).exists()).toBe(true)
		if (IS_PLACEHOLDER) {
			expect(wrapper.find(sel(TESTIDS.activityUnavailable)).exists()).toBe(true)
			return
		}
		expect(wrapper.find(sel(TESTIDS.activityFirstVisit)).exists()).toBe(true)
		await wrapper.get(sel(TESTIDS.activityTileSend)).trigger("click")
		await flushPromises()
		expect(wrapper.find(sel(TESTIDS.sendView)).isVisible()).toBe(true)
		expect(wrapper.find(sel(TESTIDS.activityView)).exists()).toBe(false)
	})

	it("4. a background completion toasts while the faucet is showing (the shell owns the toast)", async () => {
		if (IS_PLACEHOLDER) return
		wrapper = await mountApp()
		lastCompleted.value = {
			id: "0xbg",
			direction: "deposit",
			amount: "1000000",
			isPrivate: false,
			assetKind: "bridge-token",
			txHash: `0x${"ab".repeat(32)}`,
			foreground: false,
		}
		await flushPromises()
		expect(wrapper.text()).toContain("to Aztec ✓")
	})

	it("5. the rail's keyboard: arrows move between sections without leaving the tablist", async () => {
		wrapper = await mountApp()
		await wrapper.get(sel(TESTIDS.tabDrip)).trigger("keydown", { key: "ArrowDown" })
		await flushPromises()
		expect(wrapper.find(sel(TESTIDS.activityView)).exists()).toBe(true)
		await wrapper.get(sel(TESTIDS.tabActivity)).trigger("keydown", { key: "ArrowDown" })
		await flushPromises()
		expect(wrapper.find(sel(TESTIDS.sendView)).isVisible()).toBe(true)
	})
})
