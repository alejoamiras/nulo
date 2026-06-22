/*
 * Fuel smoke e2e. Mounts FuelView in jsdom with faked wallet/asset/flow boundaries, and drives a
 * fee-juice record through the REAL journal engine. Pins:
 *
 *   1. the form renders the L1 fee-asset balance + submit
 *   2. a sub-floor amount is rejected at the form (no deposit fires)
 *   3. public + private submits call useFuel.deposit with the right privacy
 *   4. a fee-juice record drives to done through the engine (deploymentMatches accepts the Fuel binding)
 *
 * Local-gates only: completing a REAL bridge needs the L2 network (deferred). Selectors are data-testid only.
 */
import { type DepositJournalRecord, JOURNAL_KEY, feeJuiceAddress } from "@nulo/bridge-core"
import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

const depositFn = vi.fn(async (_amount: bigint, _isPrivate: boolean) => "0xfuelrec")

vi.mock("@/composables/useL1Wallet", () => ({
	useL1Wallet: () => ({ isConnected: ref(true), address: ref("0xl1addr") }),
}))
vi.mock("@/composables/useBridgeWallet", () => ({
	useBridgeWallet: () => ({ status: ref("connected"), selectedAccount: ref(`0x${"10".repeat(32)}`), wallet: ref({}) }),
}))
vi.mock("@/composables/useL1FeeAsset", () => ({
	useL1FeeAsset: () => ({
		balance: ref(50n * 10n ** 18n),
		approving: ref(false),
		error: ref(null),
		refresh: vi.fn(),
		allowance: vi.fn(async () => 0n),
		approve: vi.fn(),
	}),
	FUEL_ASSET_DECIMALS: 18,
}))
vi.mock("@/composables/useFuel", () => ({
	useFuelFlow: () => ({ busy: ref(false), error: ref(null), deposit: depositFn, journal: {} }),
}))

import { __resetJournalForTests, addRecord, connectJournalDeps, lastCompleted, runDepositClaim } from "@/composables/useBridgeJournal"
import { FUEL_PORTAL } from "@/contracts/bridge-deployments"
import { TESTIDS } from "@/lib/testids"
import FuelView from "@/views/FuelView.vue"

const sel = (t: string) => `[data-testid="${t}"]`

function mountFuel() {
	return mount(FuelView, { global: { stubs: { L1WalletPanel: true, BridgeWalletPanel: true } } })
}

describe("fuel smoke", () => {
	beforeEach(() => {
		localStorage.clear()
		__resetJournalForTests()
		depositFn.mockClear()
	})

	it("renders the form with the L1 fee-asset balance and a submit", async () => {
		const w = mountFuel()
		await flushPromises()
		expect(w.find(sel(TESTIDS.fuelForm)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.fuelBalanceL1)).text()).toMatch(/\$AZTEC/)
		expect(w.find(sel(TESTIDS.fuelSubmit)).exists()).toBe(true)
	})

	it("rejects a sub-floor amount at the form - no deposit fires", async () => {
		const w = mountFuel()
		await flushPromises()
		await w.find(sel(TESTIDS.fuelAmount)).setValue("5") // below the ~11 FJ floor
		await w.find(sel(TESTIDS.fuelSubmit)).trigger("click")
		await flushPromises()
		expect(w.find(sel(TESTIDS.fuelFormError)).exists()).toBe(true)
		expect(depositFn).not.toHaveBeenCalled()
	})

	it("public submit calls deposit(amount, isPrivate=false); private submit passes true", async () => {
		const w = mountFuel()
		await flushPromises()
		await w.find(sel(TESTIDS.fuelAmount)).setValue("20") // above the ~16 FJ floor (covers the claim's max_gas_cost)
		await w.find(sel(TESTIDS.fuelPresetPublic)).trigger("click")
		await w.find(sel(TESTIDS.fuelSubmit)).trigger("click")
		await flushPromises()
		expect(depositFn).toHaveBeenCalledWith(20n * 10n ** 18n, false, expect.anything())

		depositFn.mockClear()
		await w.find(sel(TESTIDS.fuelPresetPrivate)).trigger("click")
		await w.find(sel(TESTIDS.fuelSubmit)).trigger("click")
		await flushPromises()
		expect(depositFn).toHaveBeenCalledWith(20n * 10n ** 18n, true, expect.anything())
	})

	it("a fee-juice record drives to done through the engine (deploymentMatches accepts the Fuel binding)", async () => {
		let claimSent = false
		const claim = vi.fn(async () => ({
			simulate: async () => {
				if (claimSent) throw new Error("No L1 to L2 message found for message hash 0xdead")
				return {}
			},
			send: async () => {
				claimSent = true
				return { txHash: "0xfuelclaim" }
			},
		}))
		connectJournalDeps({
			kv: localStorage,
			waitMs: async () => {},
			now: () => 4242,
			connectedL1: () => "0xl1addr",
			connectedAztec: () => `0x${"10".repeat(32)}`,
			signL1: async () => `0x${"a".repeat(130)}`,
			claim: claim as never,
			claimReceiptStatus: async () => "success",
			waitConsumeReceipt: async () => true,
			verifyConsumeIdentity: async () => true,
			consume: async () => ({ consumeTxHash: "0x" }),
		})
		const rec: DepositJournalRecord = {
			schema: 2,
			id: "0xfj1",
			direction: "deposit",
			isPrivate: false,
			assetKind: "fee-juice",
			amount: "20000000000000000000",
			createdAt: 4242,
			updatedAt: 4242,
			chainId: 11155111,
			portal: FUEL_PORTAL as string,
			bridge: feeJuiceAddress,
			recipient: `0x${"10".repeat(32)}`,
			secret: "0xpublicsecret",
			secretHashHex: "0xfj1",
			leafIndex: "7",
			fuel: {
				amount: "20000000000000000000",
				secret: "0xpublicsecret",
				secretHashHex: "0xfj1",
				minOutput: "0",
				received: "20000000000000000000",
				leafIndex: "7",
			},
		}
		addRecord(rec)
		await runDepositClaim("0xfj1")
		await flushPromises()
		expect(claim).toHaveBeenCalled()
		const stored = JSON.parse(localStorage.getItem(JOURNAL_KEY) ?? "{}") as { records?: { id: string; completedAt?: number }[] }
		expect(stored.records?.find((r) => r.id === "0xfj1")?.completedAt).toBeDefined()
		// The completion carries the fee-juice kind so the (bridge-tab) toast labels it as Fee Juice, not the token.
		expect(lastCompleted.value).toMatchObject({ id: "0xfj1", assetKind: "fee-juice" })
	})
})
