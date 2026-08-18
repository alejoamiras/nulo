/**
 * Unit pins for `wireTabLifecycle` (Q-04 pilot) — the first unit coverage this
 * behavior has had (previously pinned only by the network e2e pair
 * `session-tabClose.test.ts` / `session-tabNavigate.test.ts`, which remain the
 * end-to-end net).
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import type { ILogger } from "@/wallet/logger"
import { type TabLifecycleDeps, wireTabLifecycle } from "./tab-lifecycle"

type RemovedListener = (tabId: number) => void
type UpdatedListener = (tabId: number, changeInfo: { status?: string; url?: string }) => void

let removedListeners: RemovedListener[]
let updatedListeners: UpdatedListener[]

beforeEach(() => {
	removedListeners = []
	updatedListeners = []
	// Merge the tabs events over the setup-file's chrome stub — replacing the
	// whole global would strip chrome.storage out from under unrelated modules.
	vi.stubGlobal("chrome", {
		// biome-ignore lint/suspicious/noExplicitAny: test-only chrome stub merge
		...(globalThis as any).chrome,
		tabs: {
			onRemoved: { addListener: (fn: RemovedListener) => removedListeners.push(fn) },
			onUpdated: { addListener: (fn: UpdatedListener) => updatedListeners.push(fn) },
		},
	})
})

const noopLogger: ILogger = { log: () => {} }

function makeDeps(sessions: Array<{ sessionId: string; origin: string; tabId: number }>) {
	const deps: TabLifecycleDeps = {
		terminateForTab: vi.fn(),
		terminateSession: vi.fn(),
		getActiveSessions: () => sessions,
		logger: noopLogger,
	}
	return deps
}

describe("wireTabLifecycle", () => {
	test("registers exactly one listener on each tabs event", () => {
		wireTabLifecycle(makeDeps([]))
		expect(removedListeners).toHaveLength(1)
		expect(updatedListeners).toHaveLength(1)
	})

	test("tab close terminates by tab id", () => {
		const deps = makeDeps([])
		wireTabLifecycle(deps)
		removedListeners[0](42)
		expect(deps.terminateForTab).toHaveBeenCalledWith(42)
	})

	test("cross-origin navigation terminates ONLY the matching tab's session (three-session matrix); logs exactly once", () => {
		const deps = makeDeps([
			{ sessionId: "hit", origin: "https://old.example", tabId: 7 },
			{ sessionId: "same-origin", origin: "https://new.example", tabId: 7 },
			{ sessionId: "other-tab", origin: "https://old.example", tabId: 9 },
		])
		const logSpy = vi.spyOn(deps.logger, "log")
		wireTabLifecycle(deps)

		updatedListeners[0](7, { status: "loading", url: "https://new.example/page" })

		expect(deps.terminateSession).toHaveBeenCalledTimes(1)
		expect(deps.terminateSession).toHaveBeenCalledWith("hit")
		expect(deps.terminateForTab).not.toHaveBeenCalled()
		// Logging is part of the moved surface: exactly one entry, for the
		// terminated session only.
		expect(logSpy).toHaveBeenCalledTimes(1)
		expect(String(logSpy.mock.calls[0][2])).toContain("hit")
	})

	test("same-origin SPA navigation spares the session (the upstream #56 carve-out)", () => {
		const deps = makeDeps([{ sessionId: "s1", origin: "https://app.example", tabId: 7 }])
		wireTabLifecycle(deps)

		updatedListeners[0](7, { status: "loading", url: "https://app.example/other-route" })

		expect(deps.terminateSession).not.toHaveBeenCalled()
		expect(deps.terminateForTab).not.toHaveBeenCalled()
	})

	test("non-loading updates and url-less updates are no-ops", () => {
		const deps = makeDeps([{ sessionId: "s1", origin: "https://app.example", tabId: 7 }])
		wireTabLifecycle(deps)

		updatedListeners[0](7, { status: "complete", url: "https://elsewhere.example/x" })
		updatedListeners[0](7, { status: "loading" })

		expect(deps.terminateSession).not.toHaveBeenCalled()
		expect(deps.terminateForTab).not.toHaveBeenCalled()
	})

	test("a malformed URL falls back to terminating the whole tab", () => {
		const deps = makeDeps([{ sessionId: "s1", origin: "https://app.example", tabId: 7 }])
		wireTabLifecycle(deps)

		updatedListeners[0](7, { status: "loading", url: "::not-a-url::" })

		expect(deps.terminateForTab).toHaveBeenCalledWith(7)
		expect(deps.terminateSession).not.toHaveBeenCalled()
	})
})
