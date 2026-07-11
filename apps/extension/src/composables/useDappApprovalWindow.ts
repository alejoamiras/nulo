/**
 * Shared lifecycle shell for the three dApp approval windows
 * (execute / capabilities / discover). Owns ONLY the byte-identical skeleton
 * the windows previously hand-rolled: the mounted sequence (eager connects →
 * session-ready wait → auth redirect → init → `beforeunload` registration),
 * the unmount teardown (disconnects, then listener removal LAST), the
 * `closeWindow` completion semantics, the active-profile-change guard, and the
 * status-strip/error-strip state. Everything divergent stays in the window and
 * is injected: the connect/disconnect lists (with their per-window ORDER), the
 * `init()` body, and the window-local `reject()` (whose guard clauses
 * deliberately differ between windows — see the frozen-oracle suites).
 *
 * Load-bearing semantics preserved verbatim (pinned by the per-window
 * `index.test.ts` frozen oracles; see
 * implementations-plan/harden-quality-arc/round-2/R3-characterization.md):
 * - `closeWindow(true)` removes the `beforeunload` listener (decided path — no
 *   double-reject); `closeWindow()` with no argument LEAVES it attached, so an
 *   overlay dismiss delivers the rejection through the unload event rather
 *   than a direct call.
 * - The `beforeunload` listener is added AFTER `init()` resolves — including
 *   when init fails internally (all three windows' inits swallow their own
 *   errors into `setError`), so a half-loaded popup still rejects the pending
 *   request on close. A rejecting `init` would skip the registration; keep
 *   inits swallowing.
 * - `dispose()` removes the listener LAST, after every disconnect.
 *
 * Per the composable convention, this owns NO lifecycle hooks: the window
 * calls `start` in its own `onMounted` and `dispose` in its own unmount hook.
 */

import { computed, ref, watch, type ComputedRef, type Ref } from "vue"
import { useRouter } from "vue-router"
import { useAppStore } from "@/stores/app.store"
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
	/** Register on the profile service's `onActiveProfileChanged` (pre-mount, as before). */
	onActiveProfileChanged: (profile?: ProfileInfo) => void
	stripStatus: ComputedRef<"ready" | "loading" | "cancelled">
	processingError: Ref<DappWindowError | undefined>
	setError: (title: string, tooltip?: string, type?: string) => void
	clearError: () => void
}

export function useDappApprovalWindow(options: UseDappApprovalWindowOptions): UseDappApprovalWindowResult {
	const appStore = useAppStore()
	const router = useRouter()

	// Stable identity shared by addEventListener / removeEventListener /
	// closeWindow — the removal must target the exact registered listener.
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

	const closeWindow = (interactionCompleted?: boolean) => {
		if (interactionCompleted) window.removeEventListener("beforeunload", onBeforeUnload)
		chrome.windows.getCurrent(undefined, (window) => {
			if (window.id) chrome.windows.remove(window.id)
		})
	}

	const onActiveProfileChanged = (profile?: ProfileInfo) => {
		if (!profile || profile.id !== options.profile.value?.id) options.reject()
	}

	const start = async () => {
		options.connectServices()

		if (!appStore.isSessionChecked) {
			await new Promise<void>((resolve) => {
				const stop = watch(
					() => appStore.isSessionChecked,
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

	return { start, dispose, closeWindow, onActiveProfileChanged, stripStatus, processingError, setError, clearError }
}
