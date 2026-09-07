import { describe, expect, test, vi } from "vitest"
import { useAuthRegistryStatus } from "./useAuthRegistryStatus"

function fakeService() {
	const enabled = new Set<(address: string) => void>()
	const disabled = new Set<(address: string) => void>()
	return {
		getRegistryEnabled: vi.fn(),
		onRegistryEnabled: {
			add: (fn: (address: string) => void) => enabled.add(fn),
			remove: (fn: (address: string) => void) => enabled.delete(fn),
		},
		onRegistryDisabled: {
			add: (fn: (address: string) => void) => disabled.add(fn),
			remove: (fn: (address: string) => void) => disabled.delete(fn),
		},
		emitEnabled: (address: string) => {
			for (const fn of enabled) fn(address)
		},
		emitDisabled: (address: string) => {
			for (const fn of disabled) fn(address)
		},
		handlerCount: () => enabled.size + disabled.size,
	}
}

const ACTIVE = "0xactive"
const setup = (account: string | undefined = ACTIVE) => {
	const service = fakeService()
	const status = useAuthRegistryStatus(service as never, () => account)
	return { service, status }
}

describe("useAuthRegistryStatus", () => {
	test("starts unknown, not loading, without an error", () => {
		const { status } = setup()
		expect(status.isRegistryEnabled.value).toBeUndefined()
		expect(status.isLoading.value).toBe(false)
		expect(status.error.value).toBeUndefined()
	})

	test("fetch asks the service for the active account and stores the flag, toggling isLoading around the await", async () => {
		const { service, status } = setup()
		let resolve!: (v: boolean) => void
		service.getRegistryEnabled.mockImplementationOnce(() => new Promise((r) => (resolve = r)))
		const pending = status.fetch()
		expect(status.isLoading.value).toBe(true)
		expect(service.getRegistryEnabled).toHaveBeenCalledWith(ACTIVE)
		resolve(true)
		await pending
		expect(status.isRegistryEnabled.value).toBe(true)
		expect(status.isLoading.value).toBe(false)
	})

	test("a failed fetch lands in error, clears isLoading and leaves the flag as it was", async () => {
		const { service, status } = setup()
		const boom = new Error("boom")
		service.getRegistryEnabled.mockRejectedValueOnce(boom)
		await status.fetch()
		expect(status.error.value).toBe(boom)
		expect(status.isLoading.value).toBe(false)
		expect(status.isRegistryEnabled.value).toBeUndefined()
	})

	test("enabled/disabled events for the active account flip the flag", () => {
		const { service, status } = setup()
		service.emitEnabled(ACTIVE)
		expect(status.isRegistryEnabled.value).toBe(true)
		service.emitDisabled(ACTIVE)
		expect(status.isRegistryEnabled.value).toBe(false)
	})

	test("events for another account are ignored", () => {
		const { service, status } = setup()
		service.emitEnabled("0xother")
		expect(status.isRegistryEnabled.value).toBeUndefined()
		status.isRegistryEnabled.value = true
		service.emitDisabled("0xother")
		expect(status.isRegistryEnabled.value).toBe(true)
	})

	test("reset returns the three refs to their hidden state", async () => {
		const { service, status } = setup()
		service.getRegistryEnabled.mockRejectedValueOnce(new Error("boom"))
		await status.fetch()
		status.isRegistryEnabled.value = true
		status.isLoading.value = true
		status.reset()
		expect(status.isRegistryEnabled.value).toBeUndefined()
		expect(status.isLoading.value).toBe(false)
		expect(status.error.value).toBeNull()
	})

	test("dispose removes both handlers", () => {
		const { service, status } = setup()
		expect(service.handlerCount()).toBe(2)
		status.dispose()
		expect(service.handlerCount()).toBe(0)
		service.emitEnabled(ACTIVE)
		expect(status.isRegistryEnabled.value).toBeUndefined()
	})
})
