export type NetworkActivationResult = "activated" | "blocked" | "failed"

/**
 * Activate a network without letting the durable pointer escape the in-flight-
 * send guard. Order matters: the guard admits (and moves the in-memory scope)
 * BEFORE the service persists, so a refusal leaves NOTHING moved. The reverse
 * order let the service write land first, and a refusal then left the popup on
 * the old network while the service worker — and the next popup open — were
 * already on the new one.
 *
 * If the persist fails after the guard admitted, the in-memory assignment is
 * reverted so the two views cannot stay diverged. The revert is deliberately
 * unguarded: a send started inside that window targets a network whose
 * activation just failed, and holding the popup on it would trade a doomed
 * send for a stuck UI.
 */
export async function activateNetworkGuarded<N extends { id: string }>(
	store: { network: N | undefined; commitScopeChange: (commit: () => void) => Promise<boolean> },
	persistActiveNetwork: (networkId: string) => Promise<unknown>,
	target: N,
): Promise<NetworkActivationResult> {
	const previous = store.network
	const admitted = await store.commitScopeChange(() => {
		store.network = target
	})
	if (!admitted) return "blocked"
	try {
		await persistActiveNetwork(target.id)
		return "activated"
	} catch {
		store.network = previous
		return "failed"
	}
}
