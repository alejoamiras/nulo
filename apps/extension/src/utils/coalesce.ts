/** A burst of `onIncomingTransferAdded` becomes one read: 250 ms after the last, at most 1 s after the first. */
export const ADDED_COALESCE = { quietMs: 250, maxWaitMs: 1_000 } as const

/**
 * Runs `fn` once per burst of triggers: `quietMs` after the last one, and never later than
 * `maxWaitMs` after the first, so a steady stream cannot postpone it forever.
 */
export function coalesce(fn: () => void, timing: { quietMs: number; maxWaitMs: number }) {
	let quiet: ReturnType<typeof setTimeout> | undefined
	let cap: ReturnType<typeof setTimeout> | undefined
	const cancel = () => {
		clearTimeout(quiet)
		clearTimeout(cap)
		quiet = undefined
		cap = undefined
	}
	const fire = () => {
		cancel()
		fn()
	}
	const trigger = () => {
		clearTimeout(quiet)
		quiet = setTimeout(fire, timing.quietMs)
		cap ??= setTimeout(fire, timing.maxWaitMs)
	}
	return { trigger, cancel }
}
