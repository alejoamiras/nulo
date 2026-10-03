/**
 * Lifecycle shell for the dApp approval windows (execute, capabilities, discover): the mounted
 * sequence (eager connects, session-ready wait, auth redirect, init, then the `beforeunload`
 * registration), the unmount teardown, the completion semantics, the active-profile guard, and the
 * strip and error state. What differs per window is injected: the connect and disconnect lists in
 * their per-window order, the `init()` body, and the window-local `reject()`, whose guard clauses
 * differ between windows on purpose.
 *
 * - `closeWindow(true)` and `completeInteraction()` remove the `beforeunload` listener, so a decided
 *   interaction is never rejected again on unload; `closeWindow()` with no argument leaves it, so an
 *   overlay dismiss delivers the rejection through the unload event.
 * - The listener is added after `init()` resolves, including when init fails internally (every
 *   window's init swallows its errors into `setError`), so a half-loaded window still rejects on
 *   close. A rejecting `init` would skip the registration.
 * - `dispose()` removes the listener last, after every disconnect.
 *
 * It owns no lifecycle hooks: the window calls `start` from its `onMounted` and `dispose` from its
 * unmount hook.
 */

import { computed, ref, watch, type ComputedRef, type Ref } from "vue"
import { useRouter } from "vue-router"
import { useAppStore } from "@/stores/app.store"
import { closeCurrentWindow } from "@/utils/close-current-window"
import type { ProfileInfo } from "@/wallet/services/profile/client"

export type DappWindowError = { title: string; tooltip: string; type: string }

export interface UseDappApprovalWindowOptions {
	/** Eager service connects, in the exact per-window order. First thing `start()` runs. */
	connectServices: () => void
	/**
	 * Service disconnects, in the exact per-window order. `dispose()` runs this
	 * first, then removes the `beforeunload` listener — always last.
	 */
	disconnectServices: () => void
	/** The window's payload init. Awaited after the session gate + auth redirect. */
	init: () => Promise<void>
	/**
	 * The window-local reject. Bound to `beforeunload` and to the
	 * active-profile-change guard; guard divergences stay in the window.
	 */
	reject: () => void
	/** The window's active profile (set inside init) — the profile-change guard compares against it. */
	profile: Ref<ProfileInfo | undefined>
	isInteractionCancelled: Ref<boolean>
	isLoading: Ref<boolean>
}

export interface UseDappApprovalWindowResult {
	/** The mounted-hook body. The window calls this from its own `onMounted`. */
	start: () => Promise<void>
	/** The unmount-hook body. The window calls this from its own unmount hook. */
	dispose: () => void
	closeWindow: (interactionCompleted?: boolean) => void
	/** The interaction is decided: an unload no longer rejects it, and the window stays open. */
	completeInteraction: () => void
	/** Register on the profile service's `onActiveProfileChanged` (pre-mount, as before). */
	onActiveProfileChanged: (profile?: ProfileInfo) => void
	stripStatus: ComputedRef<"ready" | "loading" | "cancelled">
	processingError: Ref<DappWindowError | undefined>
	setError: (title: string, tooltip?: string, type?: string) => void
	clearError: () => void
}

/**
 * Resolves once `isChecked()` turns true. Call it only while `isChecked()` is false: otherwise the
 * immediate callback reads `stop` before it is initialized.
 */
export function untilSessionChecked(isChecked: () => boolean): Promise<void> {
	return new Promise<void>((resolve) => {
		const stop = watch(
			isChecked,
			(checked) => {
				if (checked) {
					stop()
					resolve()
				}
			},
			{ immediate: true },
		)
	})
}

export function useDappApprovalWindow(options: UseDappApprovalWindowOptions): UseDappApprovalWindowResult {
	const appStore = useAppStore()
	const router = useRouter()

	// One stable identity: every removal must target the exact registered listener.
	const onBeforeUnload = () => options.reject()

	const processingError = ref<DappWindowError | undefined>()
	function setError(title: string, tooltip: string = title, type: string = "error") {
		processingError.value = { title, tooltip, type }
	}
	function clearError() {
		processingError.value = undefined
	}

	const stripStatus = computed<"ready" | "loading" | "cancelled">(() => {
		if (options.isInteractionCancelled.value) return "cancelled"
		if (options.isLoading.value) return "loading"
		return "ready"
	})

	const completeInteraction = () => window.removeEventListener("beforeunload", onBeforeUnload)

	const closeWindow = (interactionCompleted?: boolean) => {
		if (interactionCompleted) completeInteraction()
		closeCurrentWindow()
	}

	const onActiveProfileChanged = (profile?: ProfileInfo) => {
		if (!profile || profile.id !== options.profile.value?.id) options.reject()
	}

	const start = async () => {
		options.connectServices()

		if (!appStore.isSessionChecked) await untilSessionChecked(() => appStore.isSessionChecked)

		if (!appStore.isLogined) {
			appStore.pageAwaitingAuth = router.currentRoute.value.fullPath
			router.push({ path: "/popup/auth" })
			return
		}

		await options.init()
		window.addEventListener("beforeunload", onBeforeUnload)
	}

	const dispose = () => {
		options.disconnectServices()
		window.removeEventListener("beforeunload", onBeforeUnload)
	}

	return { start, dispose, closeWindow, completeInteraction, onActiveProfileChanged, stripStatus, processingError, setError, clearError }
}
