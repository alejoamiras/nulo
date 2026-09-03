import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import { useGasHeld } from "./useGasHeld"

const h = vi.hoisted(() => ({ pub: vi.fn<() => Promise<bigint>>(), priv: vi.fn<() => Promise<bigint>>() }))

vi.mock("./deposit-flow", () => ({
	readPublicFeeJuiceBalance: () => h.pub(),
	readPrivateFeeJuiceBalance: () => h.priv(),
	readFeeJuiceOrNull: async (_label: string, read: () => Promise<bigint>) => {
		try {
			return await read()
		} catch {
			return null
		}
	},
}))

const ACCOUNT = `0x${"10".repeat(32)}`

function harness(account: string | null = ACCOUNT, aztec: unknown = {}) {
	const who = ref<string | undefined>(account ?? undefined)
	const wallet = ref(aztec)
	return { who, wallet, handle: useGasHeld({ aztec: () => wallet.value, account: () => who.value }) }
}

describe("useGasHeld", () => {
	beforeEach(() => {
		h.pub.mockReset().mockResolvedValue(0n)
		h.priv.mockReset().mockResolvedValue(0n)
	})

	it("is unknown without an Aztec account", async () => {
		const { handle } = harness(null)
		await flushPromises()
		expect(handle.held.value).toBeNull()
		expect(h.pub).not.toHaveBeenCalled()
	})

	it("holds gas when either balance is non-zero", async () => {
		h.priv.mockResolvedValue(5n)
		const { handle } = harness()
		await flushPromises()
		expect(handle.held.value).toBe(true)
	})

	it("holds none when both balances read zero", async () => {
		const { handle } = harness()
		await flushPromises()
		expect(handle.held.value).toBe(false)
	})

	it("an unreadable balance beside a zero leaves the answer open", async () => {
		h.priv.mockRejectedValue(new Error("rpc"))
		const { handle } = harness()
		await flushPromises()
		expect(handle.held.value).toBeNull()
	})

	it("an unreadable balance beside a non-zero one still holds", async () => {
		h.pub.mockRejectedValue(new Error("rpc"))
		h.priv.mockResolvedValue(1n)
		const { handle } = harness()
		await flushPromises()
		expect(handle.held.value).toBe(true)
	})

	it("re-reads when the account changes, and a stale read never lands", async () => {
		let release = (): void => {}
		h.pub.mockImplementationOnce(() => new Promise((r) => (release = () => r(9n))))
		const { who, handle } = harness()
		await flushPromises()
		who.value = `0x${"20".repeat(32)}`
		await flushPromises()
		release()
		await flushPromises()
		expect(handle.held.value).toBe(false)
		expect(h.pub).toHaveBeenCalledTimes(2)
	})
})
