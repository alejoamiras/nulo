import { beforeEach, describe, expect, test, vi } from "vitest"

import { clearOnboardingTabTracking, openOrFocusOnboardingTab } from "./onboarding-tab"

const TAB_ID_KEY = "nulo:onboarding:tab-id"

type AnyAsync = (...args: never[]) => Promise<unknown>

function stubChrome(overrides: {
	sessionGet?: AnyAsync
	sessionSet?: AnyAsync
	sessionRemove?: AnyAsync
	tabsGet?: AnyAsync
	tabsUpdate?: AnyAsync
	tabsCreate?: AnyAsync
	windowsUpdate?: AnyAsync
	runtimeGetURL?: (path: string) => string
}) {
	vi.stubGlobal("chrome", {
		storage: {
			session: {
				get: vi.fn(overrides.sessionGet ?? (async () => ({}))),
				set: vi.fn(overrides.sessionSet ?? (async () => undefined)),
				remove: vi.fn(overrides.sessionRemove ?? (async () => undefined)),
			},
		},
		tabs: {
			get: vi.fn(overrides.tabsGet ?? (async () => ({}))),
			update: vi.fn(overrides.tabsUpdate ?? (async () => ({}))),
			create: vi.fn(overrides.tabsCreate ?? (async () => ({ id: 42 }))),
		},
		windows: {
			update: vi.fn(overrides.windowsUpdate ?? (async () => ({}))),
		},
		runtime: {
			getURL: vi.fn(overrides.runtimeGetURL ?? ((path: string) => `chrome-extension://abc/${path}`)),
		},
	})
}

beforeEach(() => {
	vi.unstubAllGlobals()
})

describe("openOrFocusOnboardingTab", () => {
	test("opens a fresh tab when no tab id is stored and persists the new id", async () => {
		const sessionStore: Record<string, unknown> = {}
		stubChrome({
			sessionGet: async (key) => (key in sessionStore ? { [key]: sessionStore[key] } : {}),
			sessionSet: async (entries) => Object.assign(sessionStore, entries),
			tabsCreate: async () => ({ id: 99 }),
		})

		await openOrFocusOnboardingTab()

		expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "chrome-extension://abc/src/onboarding/index.html#/onboarding/welcome" })
		expect(sessionStore[TAB_ID_KEY]).toBe(99)
	})

	test("focuses an existing live tab without creating a duplicate", async () => {
		stubChrome({
			sessionGet: async () => ({ [TAB_ID_KEY]: 11 }),
			tabsGet: async () => ({ id: 11, windowId: 7 }),
		})

		await openOrFocusOnboardingTab()

		expect(chrome.tabs.get).toHaveBeenCalledWith(11)
		expect(chrome.tabs.update).toHaveBeenCalledWith(11, { active: true })
		expect(chrome.windows.update).toHaveBeenCalledWith(7, { focused: true })
		expect(chrome.tabs.create).not.toHaveBeenCalled()
	})

	test("falls through to creating a fresh tab when the stored id no longer exists", async () => {
		stubChrome({
			sessionGet: async () => ({ [TAB_ID_KEY]: 555 }),
			tabsGet: async () => {
				throw new Error("No tab with id 555")
			},
			tabsCreate: async () => ({ id: 600 }),
		})

		await openOrFocusOnboardingTab()

		expect(chrome.tabs.create).toHaveBeenCalled()
	})

	test("concurrent calls share the in-flight promise (no duplicate tabs)", async () => {
		let resolveCreate: ((tab: { id: number }) => void) | null = null
		stubChrome({
			sessionGet: async () => ({}),
			tabsCreate: (() =>
				new Promise<{ id: number }>((resolve) => {
					resolveCreate = resolve
				})) as never,
		})

		const first = openOrFocusOnboardingTab()
		const second = openOrFocusOnboardingTab()

		// Both calls must return the SAME promise instance (lock collapsed them).
		expect(first).toBe(second)

		// Resolve on next microtask so the create() call has already been made.
		await Promise.resolve()
		if (resolveCreate) (resolveCreate as (tab: { id: number }) => void)({ id: 1 })
		await first

		expect(chrome.tabs.create).toHaveBeenCalledTimes(1)
	})

	test("clearOnboardingTabTracking removes the stored tab id", async () => {
		const sessionStore: Record<string, unknown> = { [TAB_ID_KEY]: 77 }
		stubChrome({
			sessionRemove: async (key) => {
				delete sessionStore[key]
			},
		})

		await clearOnboardingTabTracking()

		expect(chrome.storage.session.remove).toHaveBeenCalledWith(TAB_ID_KEY)
	})
})
