/**
 * Pre-extraction pin (codex seam condition, round-2 plan 4): two `ensure()` calls
 * issued in the SAME turn share one registered leg flight per leg — one client
 * call each, both callers resolve with the same data. The single-flight
 * registration (`legFlights.set` right after the run starts) is a
 * register-immediately span; a refactor that let it slip past a settlement hop
 * would issue a second client call here.
 */
import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	getGasBalances: vi.fn(),
	peekGasBalances: vi.fn(),
	getFpcs: vi.fn(),
}))

vi.mock("@/wallet/services/execution/client", () => ({
	ExecutionServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			getGasBalances: mocks.getGasBalances,
			peekGasBalances: mocks.peekGasBalances,
		}
	}),
}))
vi.mock("@/wallet/services/fpc/client", () => ({
	FpcServiceClient: vi.fn(function () {
		return { connect: vi.fn(), disconnect: vi.fn(), getFpcs: mocks.getFpcs }
	}),
}))
vi.mock("@/wallet/services/transaction/client", () => ({
	TransactionServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			onTransactionUpdated: { add: vi.fn(), remove: vi.fn() },
			onTransactionAdded: { add: vi.fn(), remove: vi.fn() },
		}
	}),
}))
vi.mock("@/stores/app.store", async () => {
	const { reactive } = await import("vue")
	const fake = reactive({ profile: undefined as { id: string; name: string } | undefined })
	return { useAppStore: () => fake }
})

import { useBalancesStore } from "./balances.store"

const SCOPE = { profileId: "p1", networkId: "n1", chainId: 111, accountAddress: "0xacct" }
const BAL = { publicFeeJuice: "1000", privateFeeJuice: null }

beforeEach(() => {
	setActivePinia(createPinia())
	mocks.getGasBalances.mockReset().mockResolvedValue(BAL)
	mocks.peekGasBalances.mockReset().mockResolvedValue(null)
	mocks.getFpcs.mockReset().mockResolvedValue([{ id: "f1", type: 1 }])
})

describe("balances store — same-turn duplicate ensure", () => {
	it("two ensures in one turn share ONE registered flight per leg", async () => {
		const store = useBalancesStore()
		const first = store.ensure(SCOPE, { legs: ["gas", "fpc"] })
		const second = store.ensure(SCOPE, { legs: ["gas", "fpc"] })
		const [a, b] = await Promise.all([first, second])
		expect(mocks.getGasBalances).toHaveBeenCalledTimes(1)
		expect(mocks.getFpcs).toHaveBeenCalledTimes(1)
		expect(a.gas.verified).toEqual(BAL)
		expect(b.gas.verified).toEqual(BAL)
		expect(a.fpc.data).toEqual([{ id: "f1", type: 1 }])
		expect(b.fpc.data).toEqual([{ id: "f1", type: 1 }])
		// The joined flight commits ONE version bump per leg, not two.
		expect(store.entry(SCOPE)?.gas.version).toBe(1)
		expect(store.entry(SCOPE)?.fpc.version).toBe(1)
	})

	it("a second ensure issued one microtask later still joins the live flight", async () => {
		const store = useBalancesStore()
		let release: (() => void) | undefined
		mocks.getGasBalances.mockImplementation(
			() =>
				new Promise((res) => {
					release = () => res(BAL)
				}),
		)
		const first = store.ensure(SCOPE, { legs: ["gas"] })
		await Promise.resolve()
		const second = store.ensure(SCOPE, { legs: ["gas"] })
		await Promise.resolve()
		release?.()
		await Promise.all([first, second])
		expect(mocks.getGasBalances).toHaveBeenCalledTimes(1)
	})
})
