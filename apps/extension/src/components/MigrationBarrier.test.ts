import { SCHEMA_RUNNING_KEY } from "@nulo/wallet-core/migration"
import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { SCHEMA_BLOCKED_KEY, SCHEMA_DEGRADED_KEY, SCHEMA_RETRY_REQUESTED_KEY } from "@/wallet/storage/migrations"
import { installChromeStorage } from "../../tests/helpers/chrome-storage-mock"
import MigrationBarrier from "./MigrationBarrier.vue"

const stubs = { Spinner: true, MaterialIcon: true, Teleport: true }
const mountBarrier = () => mount(MigrationBarrier, { global: { stubs } })

describe("MigrationBarrier", () => {
	beforeEach(() => {
		document.body.innerHTML = ""
	})

	test("idle: renders nothing", async () => {
		installChromeStorage({})
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='migration-updating']").exists()).toBe(false)
		expect(w.find("[data-testid='migration-blocked']").exists()).toBe(false)
		expect(w.find("[data-testid='migration-degraded']").exists()).toBe(false)
	})

	test("running: shows the Updating overlay", async () => {
		installChromeStorage({ [SCHEMA_RUNNING_KEY]: 2 })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='migration-updating']").exists()).toBe(true)
		expect(w.text()).toContain("UPDATING")
	})

	test("blocked terminal: recovery copy + detail", async () => {
		installChromeStorage({ [SCHEMA_BLOCKED_KEY]: { kind: "failed", detail: "kaboom at v2", terminal: true } })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='migration-blocked']").exists()).toBe(true)
		expect(w.text()).toContain("UPDATE FAILED")
		expect(w.text()).toContain("funds are safe")
		expect(w.find("[data-testid='migration-blocked-detail']").text()).toContain("kaboom at v2")
	})

	test("blocked non-terminal: retry copy + a live Retry button", async () => {
		installChromeStorage({ [SCHEMA_BLOCKED_KEY]: { kind: "failed", detail: "transient", terminal: false } })
		const w = mountBarrier()
		await flushPromises()
		expect(w.text()).toContain("UPDATE INTERRUPTED")
		expect(w.text()).toContain("Retry update")
		expect(w.find("[data-testid='migration-retry-btn']").exists()).toBe(true)
	})

	test("Retry writes the one-shot gesture token and restarts the extension", async () => {
		const store = installChromeStorage({ [SCHEMA_BLOCKED_KEY]: { kind: "failed", detail: "transient", terminal: false } })
		const reload = vi.fn()
		;(globalThis as { chrome: { runtime?: unknown } }).chrome.runtime = { reload }
		const w = mountBarrier()
		await flushPromises()
		await w.find("[data-testid='migration-retry-btn']").trigger("click")
		await flushPromises()
		const token = store.data[SCHEMA_RETRY_REQUESTED_KEY] as { requestedAt?: number }
		expect(Number.isFinite(token?.requestedAt)).toBe(true)
		expect(reload).toHaveBeenCalledTimes(1)
		// The button latches into its restarting state (belt: reload is coming).
		expect(w.find("[data-testid='migration-retry-btn']").attributes("disabled")).toBeDefined()
	})

	test("a fresh claimedAt holds the button; a FUTURE claimedAt does not wedge it", async () => {
		installChromeStorage({
			[SCHEMA_BLOCKED_KEY]: { kind: "failed", detail: "x", terminal: false, claimedAt: Date.now() },
		})
		const held = mountBarrier()
		await flushPromises()
		expect(held.find("[data-testid='migration-retry-btn']").attributes("disabled")).toBeDefined()
		held.unmount()

		document.body.innerHTML = ""
		installChromeStorage({
			[SCHEMA_BLOCKED_KEY]: { kind: "failed", detail: "x", terminal: false, claimedAt: Date.now() + 60 * 60_000 },
		})
		const wedgeable = mountBarrier()
		await flushPromises()
		expect(wedgeable.find("[data-testid='migration-retry-btn']").attributes("disabled")).toBeUndefined()
	})

	test("terminal renders NO retry button", async () => {
		installChromeStorage({ [SCHEMA_BLOCKED_KEY]: { kind: "failed", detail: "kaboom", terminal: true } })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='migration-retry-btn']").exists()).toBe(false)
	})

	test("blocked takes precedence over running", async () => {
		installChromeStorage({
			[SCHEMA_RUNNING_KEY]: 2,
			[SCHEMA_BLOCKED_KEY]: { kind: "needs-recovery", detail: "corrupt marker", terminal: true },
		})
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='migration-blocked']").exists()).toBe(true)
		expect(w.find("[data-testid='migration-updating']").exists()).toBe(false)
	})

	test("running takes precedence over degraded (a retry boot mid-run)", async () => {
		installChromeStorage({
			[SCHEMA_RUNNING_KEY]: 2,
			[SCHEMA_DEGRADED_KEY]: { version: 2, error: "prior additive fail" },
		})
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='migration-updating']").exists()).toBe(true)
		expect(w.find("[data-testid='migration-degraded']").exists()).toBe(false)
	})

	test("degraded (the state a completed degraded boot leaves): warning banner, dismissible", async () => {
		installChromeStorage({ [SCHEMA_DEGRADED_KEY]: { version: 3, error: "additive fail" } })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='migration-degraded']").exists()).toBe(true)
		await w.find("[data-testid='migration-degraded-dismiss']").trigger("click")
		expect(w.find("[data-testid='migration-degraded']").exists()).toBe(false)
	})

	test("live update: overlay clears when the running marker clears", async () => {
		const s = installChromeStorage({ [SCHEMA_RUNNING_KEY]: 2 })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='migration-updating']").exists()).toBe(true)
		s.fire({ [SCHEMA_RUNNING_KEY]: { newValue: undefined } })
		await flushPromises()
		expect(w.find("[data-testid='migration-updating']").exists()).toBe(false)
	})

	test("live update: blocked appearing mid-session renders the recovery screen", async () => {
		const s = installChromeStorage({})
		const w = mountBarrier()
		await flushPromises()
		s.fire({ [SCHEMA_BLOCKED_KEY]: { newValue: { kind: "failed", detail: "late", terminal: true } } })
		await flushPromises()
		expect(w.find("[data-testid='migration-blocked']").exists()).toBe(true)
	})

	test("a STALE refresh snapshot cannot resurrect a state an event already cleared", async () => {
		// The snapshot get() and onChanged events ride different IPC channels;
		// simulate the get resolving AFTER a clearing event. Events must win.
		const s = installChromeStorage({ [SCHEMA_RUNNING_KEY]: 2 })
		const gate = s.deferNextGet()
		const w = mountBarrier() // refresh()'s get is now parked
		await flushPromises()
		s.fire({ [SCHEMA_RUNNING_KEY]: { newValue: undefined } }) // migration finished
		await flushPromises()
		gate.release() // stale snapshot (running present) resolves late
		await flushPromises()
		expect(w.find("[data-testid='migration-updating']").exists()).toBe(false)
	})

	test("changes in other areas are ignored; unmount detaches the listener", async () => {
		const s = installChromeStorage({})
		const w = mountBarrier()
		await flushPromises()
		s.fire({ [SCHEMA_RUNNING_KEY]: { newValue: 1 } }, "session")
		await flushPromises()
		expect(w.find("[data-testid='migration-updating']").exists()).toBe(false)
		w.unmount()
		expect(s.listeners).toHaveLength(0)
	})
})
