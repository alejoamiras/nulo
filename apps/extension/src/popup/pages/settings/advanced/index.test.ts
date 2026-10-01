import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import AdvancedSettings from "./index.vue"

vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: function ConfigServiceClient() {
		return {
			getProps: vi.fn(async () => [{ key: "developerMode", value: true }]),
			setValue: vi.fn(async () => undefined),
			onUpdate: { add: vi.fn() },
			disconnect: vi.fn(),
		}
	},
}))
vi.mock("@/components/ui/Dropdown", () => ({ Dropdown: { render: () => null } }))

const windows = { create: vi.fn(), get: vi.fn(), update: vi.fn() }

// The app store's `useSyncedRef` reads `chrome.storage.local` and listens for changes as it is created.
beforeEach(() => {
	for (const fn of Object.values(windows)) fn.mockReset()
	vi.stubGlobal("chrome", {
		storage: {
			local: {
				get: vi.fn(async () => ({})),
				set: vi.fn(async () => undefined),
				remove: vi.fn(async () => undefined),
			},
			onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
		},
		runtime: {
			connect: vi.fn(),
			getURL: (path: string) => `chrome-extension://nulo/${path}`,
			onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
		},
		windows,
	})
})
afterEach(() => vi.unstubAllGlobals())

async function mountAdvanced() {
	const wrapper = mount(AdvancedSettings, {
		global: {
			plugins: [createTestingPinia({ createSpy: vi.fn })],
			stubs: {
				SettingsPageShell: { template: "<div><slot /></div>" },
				Flex: { template: "<div><slot /></div>" },
				Text: { template: "<span><slot /></span>" },
				LoadingState: true,
				Toggle: true,
				RowTarget: true,
				MaterialIcon: true,
				RouterLink: true,
			},
		},
	})
	await flushPromises()
	return wrapper
}

test("a press while the log window is still being created opens no second one; a press after it focuses it", async () => {
	let created: (window: { id: number }) => void = () => {}
	windows.create.mockReturnValue(
		new Promise((resolve) => {
			created = resolve
		}),
	)
	const row = (await mountAdvanced()).get('[data-testid="settings-logs-row"]')

	await row.trigger("click")
	await row.trigger("click")
	expect(windows.create).toHaveBeenCalledTimes(1)

	created({ id: 7 })
	await flushPromises()
	windows.get.mockResolvedValue({ id: 7 })
	await row.trigger("click")
	await flushPromises()

	expect(windows.create).toHaveBeenCalledTimes(1)
	expect(windows.get).toHaveBeenCalledWith(7)
	expect(windows.update).toHaveBeenCalledWith(7, { focused: true })
})
