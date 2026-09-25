import { describe, expect, test } from "vitest"
import { ref } from "vue"
import type { ToastState } from "@/composables/toast"
import { createScopeEpochHandlers } from "./scope-epoch"

const VIEW = { label: "View", onSelect: () => {} }

function harness(open?: Partial<ToastState>) {
	const store = { scopeEpoch: 0 }
	const toast = ref<ToastState | null>(open ? { id: 1, kind: "success", label: "Transaction submitted", ...open } : null)
	const handlers = createScopeEpochHandlers({
		bumpEpoch: () => {
			store.scopeEpoch++
		},
		toast,
		closeToast: () => {
			toast.value = null
		},
	})
	return { store, toast, ...handlers }
}

describe("scope epoch", () => {
	test("a scope change bumps the epoch and keeps a snack without an action", () => {
		const h = harness({ label: "Address is copied" })
		h.onScopeChanged()
		expect(h.store.scopeEpoch).toBe(1)
		expect(h.toast.value?.label).toBe("Address is copied")
	})

	test("a scope change closes a snack whose action opens a record of the old scope", () => {
		const h = harness({ action: VIEW })
		h.onScopeChanged()
		expect(h.store.scopeEpoch).toBe(1)
		expect(h.toast.value).toBeNull()
	})

	test.each([
		["with an action", { action: VIEW }],
		["without one", {}],
		["none open", undefined],
	])("a lock bumps the epoch and closes any snack (%s)", (_name, open) => {
		const h = harness(open)
		h.onLocked()
		expect(h.store.scopeEpoch).toBe(1)
		expect(h.toast.value).toBeNull()
	})

	test("A → B → A and lock → unlock end under a new epoch", () => {
		const roundTrip = harness()
		roundTrip.onScopeChanged()
		roundTrip.onScopeChanged()
		expect(roundTrip.store.scopeEpoch).toBe(2)
		const lock = harness()
		lock.onLocked()
		expect(lock.store.scopeEpoch).toBe(1)
	})
})
