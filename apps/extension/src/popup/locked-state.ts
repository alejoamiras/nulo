import { watch } from "vue"

export interface LockedStateShell<P> {
	closePopups: () => void
	/** Bumps the scope epoch and closes any snack. */
	onLocked: () => void
	/** Clears the shell's logged-in mark. */
	markLocked: () => void
	clearActivity: () => void
	resetInFlight: () => void
	cachedProfiles: () => P[]
	setProfiles: (profiles: P[]) => void
	route: (path: string) => void
}

/**
 * The popup's locked state, in two parts. The seal drops everything a lock takes away — popups, the
 * snack, the scope epoch, the logged-in mark, every cached scope's activity, the in-flight sends —
 * and runs before anything awaits, so no snack stays up and no late result presents while the lock
 * looks up where to land. The landing picks the lock or register screen from that lookup.
 */
export function createLockedState<P>(shell: LockedStateShell<P>) {
	const seal = () => {
		shell.closePopups()
		shell.onLocked()
		shell.markLocked()
		// Switching profiles runs through lock/unlock, so a switch deliberately starts cold.
		shell.clearActivity()
		// The lock cancels the running sends, but the cancel events do not reach this popup; left
		// in place, the rows would refuse every pick on the lock screen.
		shell.resetInFlight()
	}
	const land = (profiles: P[]) => {
		shell.setProfiles(profiles)
		shell.route(profiles.length ? "/popup/auth" : "/popup/register")
	}

	/** Entered where the lock is already known and nothing is left to read. */
	const enter = (profiles: P[]) => {
		seal()
		land(profiles)
	}

	/**
	 * The lock event. A transport rejection of the lookup (worker churn at the moment of a lock)
	 * lands on the cached list, which is enough to pick auth or register; a newer profile event
	 * supersedes the landing, never the seal.
	 */
	const onLockEvent = async (readProfiles: () => Promise<P[]>, isCurrent: () => boolean) => {
		seal()
		let profiles = shell.cachedProfiles()
		try {
			profiles = await readProfiles()
		} catch {
			// The cached list stands in.
		}
		if (!isCurrent()) return
		land(profiles)
	}

	return { enter, onLockEvent }
}

/** The header marks the popup locked before the worker answers its Lock, and the snack and the
 *  epoch go with that mark: `flush: "sync"`, so nothing settling in the next microtask sees either.
 *  Under a lock event's seal it runs a second time, which changes nothing: the epoch only has to
 *  move, and the snack is already closed. */
export function watchLockStart(isLogined: () => boolean, onLocked: () => void) {
	return watch(
		isLogined,
		(logged, was) => {
			if (was && !logged) onLocked()
		},
		{ flush: "sync" },
	)
}
