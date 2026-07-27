export type NetworkActivationResult = "activated" | "blocked" | "unconfirmed"

/** Monotonic per-popup activation counter. A slow activation's failure
 *  handling must never clobber the state of a newer activation that
 *  superseded it — each call takes a ticket and acts only while current. */
let activationSeq = 0

/**
 * Activate a network without letting the durable pointer escape the in-flight-
 * send guard. Order matters: the guard admits (and moves the in-memory scope)
 * BEFORE the service persists, so a refusal moves NOTHING. The reverse order
 * let the service write land first, and a refusal then left the popup on the
 * old network while the service worker — and the next popup open — were
 * already on the new one.
 *
 * A persist failure is INDETERMINATE, not proof the write missed: the RPC can
 * fail after the durable pointer moved (port disconnect, response timeout). A
 * blind revert to the previous network would recreate exactly the durable/UI
 * split-brain this helper exists to prevent. Instead, reconcile: read the
 * authoritative durable pointer and adopt whatever it says — the target if the
 * write landed, the previous network if it didn't. If even the read fails, the
 * in-memory state stays on the target and the caller reports the switch as
 * unconfirmed; the next popup open bootstraps from durable state and converges.
 */
export async function activateNetworkGuarded<N extends { id: string }>(
	store: { network: N | undefined; commitScopeChange: (commit: () => void) => Promise<boolean> },
	persistActiveNetwork: (networkId: string) => Promise<unknown>,
	readActiveNetwork: () => Promise<N | null | undefined>,
	target: N,
): Promise<NetworkActivationResult> {
	activationSeq += 1
	const ticket = activationSeq
	const admitted = await store.commitScopeChange(() => {
		store.network = target
	})
	if (!admitted) return "blocked"
	try {
		await persistActiveNetwork(target.id)
		return "activated"
	} catch {
		if (ticket === activationSeq) {
			try {
				const authoritative = await readActiveNetwork()
				// Re-check after the read's await: a newer activation may have
				// started while it was in flight, and its state wins.
				if (ticket === activationSeq && authoritative) store.network = authoritative
			} catch {
				// Even the read failed — leave the in-memory target in place; the
				// next popup bootstrap reconciles against durable state.
			}
		}
		return "unconfirmed"
	}
}
