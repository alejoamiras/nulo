/**
 * Causal wait for the wallet service worker's liveness signal to ADVANCE.
 *
 * `nulo:liveness` (chrome.storage.session) has exactly one writer: the SW
 * runtime, which writes it immediately after `services.start()` + the SDK
 * handler are wired ("runtime is fully wired and ready to handle messages" —
 * wallet/runtime.ts) and then re-writes it on a 10s heartbeat. A STRICTLY
 * LATER value than a caller's baseline therefore proves a fully-wired worker
 * completed startup after that baseline was read — the signal a crash-recovery
 * caller needs before re-issuing work into the MV3 respawn gap, where new
 * calls otherwise reject in milliseconds against doomed ports.
 *
 * The baseline may already BE the new worker's first write; that is fine — the
 * heartbeat supplies the next strictly-later value within ~10s, so the wait
 * self-heals (it proves "a wired worker exists NOW", not worker identity).
 * Liveness is wall-clock (`clock.now()`): a clock step-back stalls
 * "strictly-later" until real time recovers, which lands on the ceiling —
 * fail-closed, tolerated.
 *
 * Two concurrent observers — a storage `onChanged` subscription (with a
 * post-subscribe re-read closing the subscribe race) AND a 1s value poll —
 * so delivery quirks of either mechanism cannot starve the wait; both legs
 * are causal (the signal is the VALUE advancing, not time passing). The
 * ceiling exists only to surface failure to the caller, never as the
 * success mechanism.
 */

const LIVENESS_KEY = "nulo:liveness"
const POLL_INTERVAL_MS = 1_000

export async function readLiveness(): Promise<number> {
	const rec = await chrome.storage.session.get(LIVENESS_KEY)
	const v = rec[LIVENESS_KEY]
	return typeof v === "number" ? v : 0
}

/**
 * Resolve once `nulo:liveness` holds a value STRICTLY greater than
 * `baseline`; reject with the last-seen value after `ceilingMs`.
 * Both observers and the ceiling timer are torn down on EVERY exit path —
 * resolution and ceiling alike (the dual-observer shape must not leak work).
 */
export function awaitLivenessAdvance(baseline: number, ceilingMs: number): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		let settled = false
		let lastSeen = baseline
		let pollTimer: ReturnType<typeof setTimeout> | undefined

		const cleanup = (): void => {
			chrome.storage.session.onChanged.removeListener(onChanged)
			clearTimeout(pollTimer)
			clearTimeout(ceilingTimer)
		}
		const settle = (value: number | undefined): void => {
			if (settled) return
			settled = true
			cleanup()
			if (value !== undefined) resolve(value)
			else
				reject(
					new Error(
						`liveness never advanced past ${baseline} within ${ceilingMs}ms (last seen: ${lastSeen}) — no fully-wired worker appeared`,
					),
				)
		}
		const consider = (value: unknown): void => {
			if (typeof value !== "number") return
			if (value > lastSeen) lastSeen = value
			if (value > baseline) settle(value)
		}

		const onChanged = (changes: Record<string, chrome.storage.StorageChange>): void => {
			if (LIVENESS_KEY in changes) consider(changes[LIVENESS_KEY].newValue)
		}
		const poll = (): void => {
			if (settled) return
			void readLiveness().then((v) => {
				consider(v)
				if (!settled) pollTimer = setTimeout(poll, POLL_INTERVAL_MS)
			})
		}

		const ceilingTimer = setTimeout(() => settle(undefined), ceilingMs)
		chrome.storage.session.onChanged.addListener(onChanged)
		// Post-subscribe re-read closes the subscribe race; it also seeds the
		// poll leg's first sample.
		poll()
	})
}
