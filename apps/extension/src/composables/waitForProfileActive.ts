import { watch } from "vue"

/**
 * Minimal structural shape needed from the app store. Decouples this
 * helper from the full `useAppStore()` return type — only the two
 * fields actually read are typed here.
 */
export interface ProfileActivationSubject {
	isLogined: boolean
	profile?: { id: string }
}

/**
 * Resolves once the SW has emitted `onActiveProfileChanged` AND the
 * shell's handler has finished initializing the new profile (sets
 * `profile.id`, flips `isLogined` last). Watches BOTH conditions so the
 * wait still works if the user was already unlocked as a different
 * profile — `isLogined` alone would be a no-op in that case.
 *
 * Used post-import to gate the success toast / routing on the wallet
 * actually being usable. Pass the live `appStore` (it satisfies the
 * structural type) and the expected new profile id.
 *
 * @param store live store instance; `isLogined` and `profile.id` must be
 *   reactive (i.e. observable by Vue's `watch`).
 * @param expectedId the new profile's id.
 * @param timeoutMs reject after this many ms; the watcher is torn down
 *   on both paths so no subscription leaks.
 */
export function waitForProfileActive(store: ProfileActivationSubject, expectedId: string, timeoutMs: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (store.isLogined && store.profile?.id === expectedId) {
			return resolve()
		}
		const timer = setTimeout(() => {
			stop()
			reject(new Error("Profile activation timeout"))
		}, timeoutMs)
		const stop = watch([() => store.isLogined, () => store.profile?.id], ([logged, id]) => {
			if (logged && id === expectedId) {
				clearTimeout(timer)
				stop()
				resolve()
			}
		})
	})
}
