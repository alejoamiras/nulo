import { SCHEMA_RUNNING_KEY } from "@nulo/wallet-core/migration"
import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, test } from "vitest"
import { SCHEMA_BLOCKED_KEY, SCHEMA_DEGRADED_KEY } from "@/wallet/storage/migrations"
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

	test("blocked non-terminal: restart-to-retry copy", async () => {
		installChromeStorage({ [SCHEMA_BLOCKED_KEY]: { kind: "failed", detail: "transient", terminal: false } })
		const w = mountBarrier()
		await flushPromises()
		expect(w.text()).toContain("UPDATE INTERRUPTED")
		expect(w.text()).toContain("reopen the extension")
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
