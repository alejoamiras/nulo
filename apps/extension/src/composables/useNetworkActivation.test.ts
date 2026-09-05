import { beforeEach, describe, expect, test, vi } from "vitest"
import type { Network } from "@/wallet/services/network/client"

const openToastMock = vi.fn()
vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
	TOAST_DURATION: { SHORT: 1500, DEFAULT: 2000, LONG: 4000 },
}))

const appStoreState = {
	network: undefined as Network | undefined,
	profile: { id: "p1" } as { id: string } | undefined,
	hasInFlightSend: false,
	commitScopeChange: vi.fn(async (commit: () => void) => {
		commit()
		return true
	}),
}
vi.mock("@/stores/app.store", () => ({ useAppStore: () => appStoreState }))

import { useNetworkActivation } from "./useNetworkActivation"

const net = (id: string): Network =>
	({
		id,
		profileId: "p1",
		chainId: 1,
		l1ChainId: 1,
		name: id,
		primaryEndpointId: "e",
		endpoints: [{ id: "e", rpcUrl: "https://x" }],
	}) as Network

function harness(over: { persist?: (id: string) => Promise<unknown>; read?: () => Promise<Network | null | undefined> } = {}) {
	const persist = vi.fn(over.persist ?? (async () => undefined))
	const read = vi.fn(over.read ?? (async () => undefined))
	const { activate } = useNetworkActivation({ persist, read })
	return { activate, persist, read }
}

describe("composables/useNetworkActivation", () => {
	beforeEach(() => {
		openToastMock.mockClear()
		appStoreState.network = net("old")
		appStoreState.profile = { id: "p1" }
		appStoreState.hasInFlightSend = false
		appStoreState.commitScopeChange = vi.fn(async (commit: () => void) => {
			commit()
			return true
		})
	})

	test("activates: the target reaches the store and the persist callback, no toast", async () => {
		const { activate, persist } = harness()
		await expect(activate(net("new"))).resolves.toBe("activated")
		expect(appStoreState.network?.id).toBe("new")
		expect(persist).toHaveBeenCalledWith("new")
		expect(openToastMock).not.toHaveBeenCalled()
	})

	test("an in-flight send refuses before the guard: nothing moves, nothing persists, one toast", async () => {
		appStoreState.hasInFlightSend = true
		const { activate, persist } = harness()
		await expect(activate(net("new"))).resolves.toBe("blocked")
		expect(appStoreState.network?.id).toBe("old")
		expect(persist).not.toHaveBeenCalled()
		expect(appStoreState.commitScopeChange).not.toHaveBeenCalled()
		expect(openToastMock).toHaveBeenCalledTimes(1)
		expect(openToastMock.mock.calls[0]?.[0]).toMatchObject({ label: "Finish or cancel your pending transaction first" })
	})

	test("a guard refusal is reported as blocked with the same toast and no persist", async () => {
		appStoreState.commitScopeChange = vi.fn(async () => false)
		const { activate, persist } = harness()
		await expect(activate(net("new"))).resolves.toBe("blocked")
		expect(persist).not.toHaveBeenCalled()
		expect(openToastMock.mock.calls[0]?.[0]).toMatchObject({ label: "Finish or cancel your pending transaction first" })
	})

	test("a failed persist reconciles from the read callback and reports unconfirmed with the warning toast", async () => {
		const { activate, read } = harness({
			persist: async () => {
				throw new Error("rpc down")
			},
			read: async () => net("old"),
		})
		await expect(activate(net("new"))).resolves.toBe("unconfirmed")
		expect(read).toHaveBeenCalledTimes(1)
		expect(appStoreState.network?.id).toBe("old")
		expect(openToastMock.mock.calls[0]?.[0]).toMatchObject({ icon: "warning", color: "red" })
		expect(openToastMock.mock.calls[0]?.[1]).toBe(4000)
	})

	test("a failed persist AND a failed read keep the admitted target and still report unconfirmed", async () => {
		const { activate } = harness({
			persist: async () => {
				throw new Error("rpc down")
			},
			read: async () => {
				throw new Error("rpc down")
			},
		})
		await expect(activate(net("new"))).resolves.toBe("unconfirmed")
		expect(appStoreState.network?.id).toBe("new")
	})

	test("stale (profile changed while queued) is silent and touches nothing", async () => {
		const { activate, persist } = harness()
		const run = activate(net("new"))
		appStoreState.profile = { id: "p2" }
		await expect(run).resolves.toBe("stale")
		expect(persist).not.toHaveBeenCalled()
		expect(openToastMock).not.toHaveBeenCalled()
	})

	test("a failed persist with nothing authoritative to read back keeps the admitted target", async () => {
		const { activate } = harness({
			persist: async () => {
				throw new Error("rpc down")
			},
			read: async () => null,
		})
		await expect(activate(net("new"))).resolves.toBe("unconfirmed")
		expect(appStoreState.network?.id).toBe("new")
	})

	test("a successful persist never consults the read callback", async () => {
		const { activate, read } = harness()
		await activate(net("new"))
		expect(read).not.toHaveBeenCalled()
	})

	test("activations serialize: the second waits for the first to settle", async () => {
		const order: string[] = []
		let release: () => void = () => {}
		const { activate } = harness({
			persist: async (id) => {
				order.push(`start:${id}`)
				if (id === "a") await new Promise<void>((r) => (release = r))
				order.push(`end:${id}`)
			},
		})
		const first = activate(net("a"))
		const second = activate(net("b"))
		await new Promise((r) => setTimeout(r, 0))
		expect(order).toEqual(["start:a"])
		release()
		await Promise.all([first, second])
		expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"])
	})

	test("callers own success feedback: activated yields no toast even when a previous outcome did", async () => {
		appStoreState.commitScopeChange = vi.fn(async () => false)
		const { activate } = harness()
		await activate(net("new"))
		expect(openToastMock).toHaveBeenCalledTimes(1)
		openToastMock.mockClear()
		appStoreState.commitScopeChange = vi.fn(async (commit: () => void) => {
			commit()
			return true
		})
		await expect(activate(net("new"))).resolves.toBe("activated")
		expect(openToastMock).not.toHaveBeenCalled()
	})
})
