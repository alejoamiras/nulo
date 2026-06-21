import { sleep } from "@nulo/wallet-core/utils"

/** How long a service waits for `init()` to complete before giving up. */
export const DEFAULT_INIT_TIMEOUT_MS = 30_000

/**
 * Block until the service reports initialized, or throw after the budget.
 *
 * `getInitialized` is read live on each poll (not captured once) so a service
 * that finishes `init()` mid-wait unblocks promptly. Shared verbatim by both
 * service bases — the two copies were byte-identical.
 */
export async function awaitInitialized(getInitialized: () => boolean, timeoutMs: number = DEFAULT_INIT_TIMEOUT_MS): Promise<void> {
	if (getInitialized()) return
	let restMs = timeoutMs
	while (!getInitialized() && restMs > 0) {
		await sleep(500)
		restMs -= 500
	}
	if (!getInitialized()) throw new Error("Service not initialized")
}
