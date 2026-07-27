export type NetworkActivationResult = "activated" | "blocked" | "unconfirmed" | "stale"

type ScopeStore<N> = {
	network: N | undefined
	profile?: { id: string } | undefined
	commitScopeChange: (commit: () => void) => Promise<boolean>
}

/**
 * Strict serialization of activations within this popup realm. Every
 * activation runs to full completion (admit → commit → persist → reconcile)
 * before the next starts, so an older activation can never resume after a
 * newer one finished and overwrite the user's later intent. The tail is
 * rejection-proof: a throwing activation must not wedge every future switch.
 * (Cross-window: realms don't share this chain; each view converges to the
 * durable pointer on its own bootstrap — recorded follow-up, not attempted.)
 */
let tail: Promise<unknown> = Promise.resolve()

/**
 * Activate a network without letting the durable pointer escape the in-flight-
 * send guard. Order inside one activation: the guard admits (and moves the
 * in-memory scope) BEFORE the service persists, so a refusal moves NOTHING.
 *
 * A persist failure is INDETERMINATE — the RPC can fail after the durable
 * write landed. Reconcile by reading the authoritative pointer and committing
 * it back THROUGH the guard: if a send started in the admitted scope in the
 * meantime, the guard refuses, the view keeps that send's activity visible,
 * and the caller reports the switch unconfirmed; the next popup bootstrap
 * converges. A blind unguarded revert did neither.
 *
 * The activation captures its profile at enqueue: if the wallet re-scoped to
 * another profile while this was queued (lock → unlock another profile), the
 * queued target belongs to a foreign profile and the activation is dropped
 * as "stale" before touching anything.
 */
export async function activateNetworkGuarded<N extends { id: string }>(
	store: ScopeStore<N>,
	persistActiveNetwork: (networkId: string) => Promise<unknown>,
	readActiveNetwork: () => Promise<N | null | undefined>,
	target: N,
): Promise<NetworkActivationResult> {
	const enqueuedProfileId = store.profile?.id
	const run = tail.then(() => runActivation(store, persistActiveNetwork, readActiveNetwork, target, enqueuedProfileId))
	// Rejection-proof tail: the NEXT activation must run whether this one
	// resolved or threw. The thrown error still reaches this run's caller.
	tail = run.then(
		() => undefined,
		() => undefined,
	)
	return run
}

async function runActivation<N extends { id: string }>(
	store: ScopeStore<N>,
	persistActiveNetwork: (networkId: string) => Promise<unknown>,
	readActiveNetwork: () => Promise<N | null | undefined>,
	target: N,
	enqueuedProfileId: string | undefined,
): Promise<NetworkActivationResult> {
	if (enqueuedProfileId !== undefined && store.profile?.id !== enqueuedProfileId) return "stale"
	const admitted = await store.commitScopeChange(() => {
		store.network = target
	})
	if (!admitted) return "blocked"
	try {
		await persistActiveNetwork(target.id)
		return "activated"
	} catch {
		try {
			const authoritative = await readActiveNetwork()
			// THROUGH the guard: a send may have started in the admitted scope
			// during the persist attempt; moving the view out from under it would
			// hide its activity/cancel surface. Refusal leaves the view put.
			if (authoritative) {
				await store.commitScopeChange(() => {
					store.network = authoritative
				})
			}
		} catch {
			// Even the read failed — leave the in-memory target in place; the
			// next popup bootstrap reconciles against durable state.
		}
		return "unconfirmed"
	}
}
