/** How far apart an arrival and a rise of the aggregate may be for the rise to count as the arrival's. */
export const COUNT_WINDOW_MS = 10_000
export const COUNT_MS = 900

export interface BalanceCountDeps {
	now: () => number
	frame: (step: () => void) => number
	cancelFrame: (id: number) => void
	/** A value for the hero while counting, or null for the aggregate's own string. */
	show: (micro: bigint | null) => void
}

type Tween = { from: bigint; to: bigint; start: number; onScreen: bigint }

const easeOutCubic = (k: number) => 1 - (1 - k) ** 3

/**
 * Home's hero counts only between two aggregates it actually displayed: from the value shown just
 * before a rise to the risen one, when the rise and an arrival are within 10 s of each other. A
 * count never starts from a value derived from the receipt, which could show a balance that never
 * existed.
 */
export function createBalanceCount(deps: BalanceCountDeps) {
	let shown: { micro: bigint; at: number } | undefined
	let beforeRise: bigint | undefined
	let arrivalAt: number | undefined
	let calm = false
	let tween: Tween | undefined
	let frameId: number | undefined

	const withinWindow = (a: number, b: number) => b >= a && b - a <= COUNT_WINDOW_MS

	function stop(): void {
		if (frameId !== undefined) deps.cancelFrame(frameId)
		frameId = undefined
		tween = undefined
		deps.show(null)
	}

	function step(): void {
		if (!tween) return
		const k = Math.min(1, (deps.now() - tween.start) / COUNT_MS)
		if (k >= 1) {
			stop()
			return
		}
		const scaled = BigInt(Math.round(easeOutCubic(k) * 1_000_000))
		tween.onScreen = tween.from + ((tween.to - tween.from) * scaled) / 1_000_000n
		deps.show(tween.onScreen)
		frameId = deps.frame(step)
	}

	function count(from: bigint, to: bigint): void {
		if (frameId !== undefined) deps.cancelFrame(frameId)
		if (calm || from >= to) {
			stop()
			return
		}
		tween = { from, to, start: deps.now(), onScreen: from }
		deps.show(from)
		frameId = deps.frame(step)
	}

	/** The hero now displays `micro`, a known aggregate. */
	function observe(micro: bigint): void {
		const now = deps.now()
		if (shown?.micro === micro) return
		const previous = shown
		shown = { micro, at: now }
		beforeRise = previous && micro > previous.micro ? previous.micro : undefined
		if (beforeRise === undefined) {
			if (tween) stop()
			return
		}
		if (tween) count(tween.onScreen, micro)
		else if (arrivalAt !== undefined && withinWindow(arrivalAt, now)) count(beforeRise, micro)
	}

	/** `calm` (reduced motion or "Disable animations") sets the final value at once until the next arrival. */
	function arrive(isCalm: boolean): void {
		const now = deps.now()
		arrivalAt = now
		calm = isCalm
		if (!shown || beforeRise === undefined) return
		if (tween) count(tween.onScreen, shown.micro)
		else if (withinWindow(shown.at, now)) count(beforeRise, shown.micro)
	}

	/** The hero shows no known aggregate, or a new scope starts: nothing recorded may count later. */
	function reset({ scope = false } = {}): void {
		stop()
		shown = undefined
		beforeRise = undefined
		if (scope) arrivalAt = undefined
	}

	return { observe, arrive, reset, stop }
}
