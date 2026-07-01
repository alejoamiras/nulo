import { SCHEMA_RUNNING_KEY } from "@nulo/wallet-core/migration"
import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { SCHEMA_BLOCKED_KEY, SCHEMA_DEGRADED_KEY } from "@/wallet/storage/migrations"
import MigrationBarrier from "./MigrationBarrier.vue"

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void

function installStorage(initial: Record<string, unknown>) {
	const data = { ...initial }
	const listeners: ChangeListener[] = []
	// biome-ignore lint/suspicious/noExplicitAny: test override of the setup's chrome stub
	const c = chrome as any
	c.storage.local = {
		get: vi.fn(async (keys?: string | string[]) => {
			const arr = Array.isArray(keys) ? keys : keys ? [keys] : Object.keys(data)
			const out: Record<string, unknown> = {}
			for (const k of arr) if (k in data) out[k] = data[k]
			return out
		}),
	}
	c.storage.onChanged = {
		addListener: (l: ChangeListener) => listeners.push(l),
		removeListener: (l: ChangeListener) => listeners.splice(listeners.indexOf(l), 1),
	}
	const fire = (changes: Record<string, { newValue?: unknown }>, area = "local") => {
		for (const l of [...listeners]) l(changes, area)
	}
	return { data, fire, listeners }
}

const stubs = { Spinner: true, MaterialIcon: true, Teleport: true }
const mountBarrier = () => mount(MigrationBarrier, { global: { stubs } })

describe("MigrationBarrier", () => {
	beforeEach(() => {
		document.body.innerHTML = ""
	})

	test("idle: renders nothing", async () => {
		installStorage({})
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='migration-updating']").exists()).toBe(false)
		expect(w.find("[data-testid='migration-blocked']").exists()).toBe(false)
		expect(w.find("[data-testid='migration-degraded']").exists()).toBe(false)
	})

	test("running: shows the Updating overlay", async () => {
		installStorage({ [SCHEMA_RUNNING_KEY]: 2 })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='migration-updating']").exists()).toBe(true)
		expect(w.text()).toContain("UPDATING")
	})

	test("blocked terminal: recovery copy + detail", async () => {
		installStorage({ [SCHEMA_BLOCKED_KEY]: { kind: "failed", detail: "kaboom at v2", terminal: true } })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='migration-blocked']").exists()).toBe(true)
		expect(w.text()).toContain("UPDATE FAILED")
		expect(w.text()).toContain("funds are safe")
		expect(w.find("[data-testid='migration-blocked-detail']").text()).toContain("kaboom at v2")
	})

	test("blocked non-terminal: restart-to-retry copy", async () => {
		installStorage({ [SCHEMA_BLOCKED_KEY]: { kind: "failed", detail: "transient", terminal: false } })
		const w = mountBarrier()
		await flushPromises()
		expect(w.text()).toContain("UPDATE INTERRUPTED")
		expect(w.text()).toContain("reopen the extension")
	})

	test("blocked takes precedence over running", async () => {
		installStorage({
			[SCHEMA_RUNNING_KEY]: 2,
			[SCHEMA_BLOCKED_KEY]: { kind: "needs-recovery", detail: "corrupt marker", terminal: true },
		})
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='migration-blocked']").exists()).toBe(true)
		expect(w.find("[data-testid='migration-updating']").exists()).toBe(false)
	})

	test("degraded: warning banner, dismissible", async () => {
		installStorage({ [SCHEMA_DEGRADED_KEY]: { version: 3, error: "additive fail" } })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='migration-degraded']").exists()).toBe(true)
		await w.find("[data-testid='migration-degraded-dismiss']").trigger("click")
		expect(w.find("[data-testid='migration-degraded']").exists()).toBe(false)
	})

	test("live update: overlay clears when the running marker clears", async () => {
		const s = installStorage({ [SCHEMA_RUNNING_KEY]: 2 })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='migration-updating']").exists()).toBe(true)
		s.fire({ [SCHEMA_RUNNING_KEY]: { newValue: undefined } })
		await flushPromises()
		expect(w.find("[data-testid='migration-updating']").exists()).toBe(false)
	})

	test("live update: blocked appearing mid-session renders the recovery screen", async () => {
		const s = installStorage({})
		const w = mountBarrier()
		await flushPromises()
		s.fire({ [SCHEMA_BLOCKED_KEY]: { newValue: { kind: "failed", detail: "late", terminal: true } } })
		await flushPromises()
		expect(w.find("[data-testid='migration-blocked']").exists()).toBe(true)
	})

	test("changes in other areas are ignored; unmount detaches the listener", async () => {
		const s = installStorage({})
		const w = mountBarrier()
		await flushPromises()
		s.fire({ [SCHEMA_RUNNING_KEY]: { newValue: 1 } }, "session")
		await flushPromises()
		expect(w.find("[data-testid='migration-updating']").exists()).toBe(false)
		w.unmount()
		expect(s.listeners).toHaveLength(0)
	})
})
