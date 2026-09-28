import { Flex, RowAction } from "@nulo/design"
import { createTestingPinia } from "@pinia/testing"
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { nextTick } from "vue"
import { useAppStore } from "@/stores/app.store"
import { copyWithToast } from "@/utils/clipboard"
import SendersIndex from "./index.vue"

const SENDER = `0x${"ab".repeat(32)}`

vi.mock("@/wallet/services/account-state/client", async () => {
	const { EventHandler } = await import("@nulo/wallet-core/utils")
	return {
		AccountStateServiceClient: function AccountStateServiceClient() {
			return {
				getSenders: vi.fn(async () => [SENDER]),
				onSenderAdded: new EventHandler(),
				onSenderDeleted: new EventHandler(),
				deleteSender: vi.fn(),
				disconnect: vi.fn(),
			}
		},
	}
})
vi.mock("@/utils/clipboard", () => ({ copyWithToast: vi.fn(async () => true) }))

enableAutoUnmount(afterEach)

// The app store reads and watches `chrome.storage.local` when it is created.
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
	vi.stubGlobal("chrome", {
		storage: {
			local: {
				get: vi.fn((_k: unknown, cb?: (r: Record<string, unknown>) => void) => {
					cb?.({})
					return Promise.resolve({})
				}),
				set: vi.fn(async () => undefined),
				remove: vi.fn(async () => undefined),
			},
			onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
		},
	})
})
afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
	vi.mocked(copyWithToast).mockClear()
})

function mountPage() {
	const pinia = createTestingPinia({ createSpy: vi.fn })
	const appStore = useAppStore(pinia)
	appStore.profile = { id: "p" } as never
	appStore.network = { id: "a", chainId: 1 } as never
	return mount(SendersIndex, {
		attachTo: document.body,
		global: {
			plugins: [pinia],
			components: { Flex, RowAction },
			stubs: {
				SettingsPageShell: { template: "<div><slot /></div>" },
				AsyncListStatus: true,
				ListStatusMessage: true,
				AddressDisplay: true,
				Tooltip: { template: "<span><slot /></span>" },
				Icon: { inheritAttrs: false, props: ["name"], template: "<i :data-name='name' />" },
			},
		},
	})
}

test("copying keeps focus on the copy action while its glyph turns to the check and back", async () => {
	const wrapper = mountPage()
	await flushPromises()
	const copy = () => wrapper.find('[aria-label="Copy address"]')
	const button = copy().element as HTMLButtonElement
	button.focus()

	await copy().trigger("click")
	await nextTick()
	expect(copy().element).toBe(button)
	expect(document.activeElement).toBe(button)
	expect(copy().find("[data-name]").attributes("data-name")).toBe("check-circle")

	await copy().trigger("click")
	expect(copyWithToast).toHaveBeenCalledTimes(1)

	vi.advanceTimersByTime(2_000)
	await nextTick()
	expect(document.activeElement).toBe(button)
	expect(copy().find("[data-name]").attributes("data-name")).toBe("copy")
})
