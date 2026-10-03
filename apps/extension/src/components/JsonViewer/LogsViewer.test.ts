/**
 * Narrow test of the log viewer's fetch deadline: each batch read races a 500 ms timer, a win clears
 * that timer, and a lost race retries with a quarter of the batch. The editor is a stub.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mount } from "@vue/test-utils"

const H = vi.hoisted(() => ({
	getLogs: vi.fn(),
	editors: [] as unknown[],
	noopEvent: { add: vi.fn(), remove: vi.fn() },
}))

vi.mock("@/wallet/services/log-viewer/client", () => ({
	LogViewerServiceClient: vi.fn(function () {
		return { disconnect: vi.fn(), onLog: H.noopEvent, getLogs: H.getLogs, clearLogs: vi.fn() }
	}),
}))
vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(function () {
		return { disconnect: vi.fn(), onUpdate: H.noopEvent, getValue: vi.fn().mockResolvedValue(false) }
	}),
}))
vi.mock("@/wallet/config", () => ({ defaultConfig: () => ({ debugMode: false }) }))
vi.mock("@/utils", () => ({ downloadFile: vi.fn() }))
vi.mock("@/composables/toast", () => ({ useToast: () => ({ openToast: vi.fn() }) }))
vi.mock("./logs-decoration", () => ({ logDecorationsField: {} }))
vi.mock("./creator.js", () => ({ createLoggerTheme: () => [] }))
vi.mock("@codemirror/state", () => ({ EditorState: { create: (config: unknown) => config, readOnly: { of: () => ({}) } } }))
vi.mock("@codemirror/view", () => ({ keymap: { of: () => ({}) }, highlightActiveLine: () => ({}) }))
vi.mock("@codemirror/commands", () => ({ defaultKeymap: [] }))
vi.mock("@codemirror/search", () => ({ searchKeymap: [] }))
vi.mock("codemirror", () => {
	class EditorView {
		static scrollIntoView = () => ({})
		state = { doc: { lines: 1, line: () => ({ from: 0 }), toString: () => "" } }
		scrollDOM = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
		dispatch = vi.fn()
		constructor(config: unknown) {
			H.editors.push(config)
		}
	}
	return { EditorView }
})

import LogsViewer from "./LogsViewer.vue"

const DEADLINE_MS = 500

function mountViewer() {
	return mount(LogsViewer, {
		global: { stubs: { LogsToolbar: true, Flex: true, Icon: true } },
	})
}

beforeEach(() => {
	vi.useFakeTimers()
	H.getLogs.mockReset()
	H.editors.length = 0
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe("LogsViewer fetch deadline", () => {
	test("a batch that arrives in time clears its deadline timer", async () => {
		H.getLogs.mockResolvedValue([])
		const set = vi.spyOn(globalThis, "setTimeout")
		const clear = vi.spyOn(globalThis, "clearTimeout")
		const wrapper = mountViewer()
		await vi.advanceTimersByTimeAsync(0)
		expect(H.editors).toHaveLength(1)
		const armed = set.mock.calls.findIndex(([, ms]) => ms === DEADLINE_MS)
		expect(armed).toBeGreaterThanOrEqual(0)
		expect(clear).toHaveBeenCalledWith(set.mock.results[armed].value)
		wrapper.unmount()
	})

	test("a batch that misses the deadline is retried with a quarter of the count", async () => {
		H.getLogs.mockReturnValueOnce(new Promise(() => {})).mockResolvedValue([])
		const wrapper = mountViewer()
		await vi.advanceTimersByTimeAsync(0)
		expect(H.getLogs.mock.calls).toEqual([[1024, undefined]])
		expect(H.editors).toHaveLength(0)
		await vi.advanceTimersByTimeAsync(DEADLINE_MS)
		expect(H.getLogs.mock.calls).toEqual([
			[1024, undefined],
			[256, undefined],
		])
		expect(H.editors).toHaveLength(1)
		wrapper.unmount()
	})
})
