import { watch } from "vue"

/** The bounded activation wait expired with no matching activation. */
export class UnlockTimeoutError extends Error {
	constructor() {
		super("Unlock timed out")
	}
}

/** The shell recorded a definitive bootstrap failure for the awaited profile. */
export class BootstrapFailedError extends Error {}

export interface ProfileActivationWithFailureSubject {
	isLogined: boolean
	profile?: { id: string }
	bootstrapFailure: { profileId: string; message: string } | null
}

/**
 * Bounded, identity-aware, failure-joined activation wait: resolves when the
 * shell finishes bootstrapping the EXPECTED profile (`isLogined` flips last),
 * rejects with `BootstrapFailedError` the moment the shell records a
 * definitive bootstrap failure for that profile (a definitive rejection must
 * release the waiter immediately — never burn the remaining bound), and
 * rejects with `UnlockTimeoutError` at `timeoutMs`.
 *
 * One watcher covers all three signals ON PURPOSE: composing
 * `waitForProfileActive` with a separate failure watcher via `Promise.race`
 * leaks the loser's live watcher until its own timeout and then fires an
 * unobserved rejection (unhandled-rejection noise). Errors are TYPED —
 * callers branch on `instanceof`, never message matching.
 */
export function awaitProfileActivation(store: ProfileActivationWithFailureSubject, expectedId: string, timeoutMs: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (store.isLogined && store.profile?.id === expectedId) {
			return resolve()
		}
		const initialFailure = store.bootstrapFailure
		if (initialFailure && initialFailure.profileId === expectedId) {
			return reject(new BootstrapFailedError(initialFailure.message))
		}
		const timer = setTimeout(() => {
			stop()
			reject(new UnlockTimeoutError())
		}, timeoutMs)
		const stop = watch([() => store.isLogined, () => store.profile?.id, () => store.bootstrapFailure], ([logged, id, failure]) => {
			if (logged && id === expectedId) {
				clearTimeout(timer)
				stop()
				resolve()
				return
			}
			const f = failure as ProfileActivationWithFailureSubject["bootstrapFailure"]
			if (f && f.profileId === expectedId) {
				clearTimeout(timer)
				stop()
				reject(new BootstrapFailedError(f.message))
			}
		})
	})
}
