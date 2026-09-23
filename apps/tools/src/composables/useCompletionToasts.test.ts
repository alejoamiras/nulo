import { beforeEach, describe, expect, it, vi } from "vitest"
import { effectScope, nextTick, ref } from "vue"

const lastCompleted = ref<{
	id: string
	direction: "deposit" | "withdraw"
	amount: string
	isPrivate: boolean
	assetKind?: "bridge-token" | "fee-juice"
	txHash?: string
	foreground?: boolean
} | null>(null)
const push = vi.fn()

vi.mock("@/composables/useBridgeJournal", () => ({ useBridgeJournal: () => ({ lastCompleted }) }))
vi.mock("@/composables/useToast", () => ({ useToast: () => ({ push }) }))

import { useCompletionToasts } from "./useCompletionToasts"

// A journal record with no token block of its own renders under asset-label's generic fallback.
const UNIT = 10n ** 18n
const GOOD_HASH = `0x${"ab".repeat(32)}`

describe("useCompletionToasts", () => {
	beforeEach(() => {
		lastCompleted.value = null
		push.mockClear()
	})

	// Each call registers a watcher on the module-shared ref; scope it so earlier cases cannot fire later.
	function mountOnce() {
		const scope = effectScope()
		scope.run(() => useCompletionToasts())
		return scope
	}

	it("a FOREGROUND completion does not toast (the receipt already announced it)", async () => {
		const scope = mountOnce()
		lastCompleted.value = {
			id: "0xfg",
			direction: "deposit",
			amount: (100n * UNIT).toString(),
			isPrivate: false,
			txHash: GOOD_HASH,
			foreground: true,
		}
		await nextTick()
		expect(push).not.toHaveBeenCalled()
		scope.stop()
	})

	it("a deposit completion toasts with the explorer link", async () => {
		const scope = mountOnce()
		lastCompleted.value = { id: "0xa", direction: "deposit", amount: (100n * UNIT).toString(), isPrivate: false, txHash: GOOD_HASH }
		await nextTick()
		expect(push).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "ok",
				text: expect.stringContaining("Bridged 100.00 TOKEN to Aztec"),
				link: expect.objectContaining({ href: expect.stringContaining(GOOD_HASH) }),
			}),
		)
		scope.stop()
	})

	it("a withdraw completion uses the Ethereum wording and the etherscan link", async () => {
		const scope = mountOnce()
		lastCompleted.value = { id: "0xb", direction: "withdraw", amount: (40n * UNIT).toString(), isPrivate: true, txHash: GOOD_HASH }
		await nextTick()
		expect(push).toHaveBeenCalledWith(
			expect.objectContaining({
				text: expect.stringContaining("Released 40.00 TOKEN to Ethereum"),
				link: expect.objectContaining({ href: `https://sepolia.etherscan.io/tx/${GOOD_HASH}` }),
			}),
		)
		scope.stop()
	})

	it("a fee-juice completion toasts as Fee Juice, not the token (private → Private FJ)", async () => {
		const scope = mountOnce()
		lastCompleted.value = {
			id: "0xfj",
			direction: "deposit",
			amount: (15n * UNIT).toString(),
			isPrivate: true,
			assetKind: "fee-juice",
			txHash: GOOD_HASH,
		}
		await nextTick()
		expect(push).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("Fueled Aztec with 15.00 Private FJ") }))
		scope.stop()
	})

	it("one owner: two calls would double the toast, so the shell calls it once", async () => {
		const a = mountOnce()
		const b = mountOnce()
		lastCompleted.value = { id: "0xc", direction: "deposit", amount: (1n * UNIT).toString(), isPrivate: false }
		await nextTick()
		expect(push).toHaveBeenCalledTimes(2)
		a.stop()
		b.stop()
	})
})
