export interface FencedBootstrapDeps {
	profileId: string
	bootstrap: () => Promise<void>
	/** Bound to the shell's profile-event sequence at call time. */
	isCurrent: () => boolean
	setFailure: (record: { profileId: string; message: string } | null) => void
	shouldToast: () => boolean
	toast: () => void
}

/**
 * Compare-and-commit wrapper around one profile-activation bootstrap. A run
 * superseded by a newer profile event commits NOTHING after its await: a stale
 * success must not clear a newer run's failure record, and a stale failure must
 * not overwrite the channel or toast over a newer profile's outcome.
 */
export async function runFencedBootstrap(deps: FencedBootstrapDeps): Promise<void> {
	try {
		await deps.bootstrap()
		if (deps.isCurrent()) deps.setFailure(null)
	} catch (err) {
		console.error("bootstrap failed", err)
		if (!deps.isCurrent()) return
		deps.setFailure({ profileId: deps.profileId, message: err instanceof Error ? err.message : String(err) })
		if (deps.shouldToast()) deps.toast()
	}
}
