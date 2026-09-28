import type { Ref } from "vue"
import type { ToastState } from "@/composables/toast"

export interface ScopeEpochDeps {
	bumpEpoch: () => void
	toast: Ref<ToastState | null | undefined>
	closeToast: () => void
}

/**
 * What a lock and a scope change do to `appStore.scopeEpoch` and to the snack. A result that
 * settles under another epoch, or locked, announces nothing, and A → B → A or lock → unlock end on
 * the same ids under a new epoch. A snack whose action opens a record of the scope that just
 * changed closes with it; one without an action stays. A lock closes any snack, so no amount,
 * recipient or account name stays on the lock screen.
 */
export function createScopeEpochHandlers(deps: ScopeEpochDeps) {
	const onScopeChanged = () => {
		deps.bumpEpoch()
		if (deps.toast.value?.action) deps.closeToast()
	}
	const onLocked = () => {
		deps.bumpEpoch()
		deps.closeToast()
	}
	return { onScopeChanged, onLocked }
}
