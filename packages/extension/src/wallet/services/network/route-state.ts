/**
 * In-memory routing state for the network service. One `NetworkRouteState`
 * per network id. Carries:
 *
 *   - `activeEndpointId` — currently routing target. May differ from
 *      `endpoints[0]` (the user-preferred) during a failover episode.
 *   - `failures` — per-endpoint consecutive-failure counters (hard + soft).
 *      Counters reset on success and decay after `STRIKE_DECAY_MS` of no
 *      incident.
 *   - `cooldownUntil` — per-endpoint epoch ms; while in the future, the
 *      endpoint is skipped during failover candidate iteration.
 *   - `invalidChain` — permanent-for-session quarantine for endpoints that
 *      probed with a chainId mismatch. Cleared only on SW restart or
 *      explicit `clearCooldowns`.
 *   - `exhaustedAt` — set when all endpoints have failed probe and we have
 *      no viable route; UI banner.
 *
 * Pure functions; no Vue, no chrome.*, no service-client deps. Service
 * owns the Map of these and calls the helpers under its lock.
 */

export const STRIKE_DECAY_MS = 60_000
export const COOLDOWN_MS = 5 * 60_000
export const HARD_THRESHOLD = 2
export const SOFT_THRESHOLD = 8

export type EndpointFailureCounters = {
	hard: number
	soft: number
	lastIncidentAt: number
}

export type NetworkRouteState = {
	activeEndpointId: string
	failures: Map<string, EndpointFailureCounters>
	cooldownUntil: Map<string, number>
	invalidChain: Set<string>
	exhaustedAt?: number
}

export function newRouteState(activeEndpointId: string): NetworkRouteState {
	return {
		activeEndpointId,
		failures: new Map(),
		cooldownUntil: new Map(),
		invalidChain: new Set(),
	}
}

/**
 * Reset a single endpoint's failure counters + cooldown on a successful call.
 * Also clears `exhaustedAt` since a working endpoint disproves exhaustion.
 */
export function recordSuccess(state: NetworkRouteState, endpointId: string): void {
	state.failures.delete(endpointId)
	state.cooldownUntil.delete(endpointId)
	state.exhaustedAt = undefined
}

/**
 * Increment the appropriate counter. Returns `{ tripped: true }` if the
 * threshold has been crossed and the caller should trigger failover.
 *
 * `now` is injectable so tests can mock the clock for decay assertions.
 */
export function recordFailure(
	state: NetworkRouteState,
	endpointId: string,
	kind: "hard" | "soft",
	now: number = Date.now(),
): { tripped: boolean } {
	const existing = state.failures.get(endpointId)
	let hard = existing?.hard ?? 0
	let soft = existing?.soft ?? 0
	// Lazy decay: if last incident was a while ago, reset both counters
	// before incrementing the new one.
	if (existing && now - existing.lastIncidentAt > STRIKE_DECAY_MS) {
		hard = 0
		soft = 0
	}
	if (kind === "hard") hard += 1
	else soft += 1
	state.failures.set(endpointId, { hard, soft, lastIncidentAt: now })
	const tripped = hard >= HARD_THRESHOLD || soft >= SOFT_THRESHOLD
	return { tripped }
}

/**
 * Demote an endpoint after a failover trip: set cooldown, drop counters
 * (they served their purpose). The endpoint becomes eligible for
 * re-promotion after `COOLDOWN_MS`.
 */
export function markCooldown(state: NetworkRouteState, endpointId: string, now: number = Date.now()): void {
	state.cooldownUntil.set(endpointId, now + COOLDOWN_MS)
	state.failures.delete(endpointId)
}

/**
 * Permanent-for-session quarantine for an endpoint that probed with a
 * chainId mismatch. Different from cooldown: never auto-expires.
 */
export function quarantineInvalidChain(state: NetworkRouteState, endpointId: string): void {
	state.invalidChain.add(endpointId)
	state.failures.delete(endpointId)
	state.cooldownUntil.delete(endpointId)
}

/**
 * True iff the endpoint is currently eligible to serve traffic. False if
 * it's in cooldown or permanent quarantine.
 */
export function isAvailable(state: NetworkRouteState, endpointId: string, now: number = Date.now()): boolean {
	if (state.invalidChain.has(endpointId)) return false
	const cool = state.cooldownUntil.get(endpointId)
	if (cool !== undefined && cool > now) return false
	return true
}

/**
 * User-driven recovery via the "Retry preferred" banner button. Wipes
 * cooldowns + invalidChain set; counters stay (they're transient and a
 * successful call will reset them anyway).
 *
 * Does NOT mutate `activeEndpointId` — that's the caller's responsibility,
 * which should defer the active swap until the next `getNode` call probes
 * the preferred endpoint (security: never bypass the probe).
 */
export function clearCooldowns(state: NetworkRouteState): void {
	state.cooldownUntil.clear()
	state.invalidChain.clear()
	state.exhaustedAt = undefined
}

/**
 * Returns the candidates the failover loop should try, in priority order.
 * Filters out invalidChain + cooldown'd entries. Starts iteration from the
 * position AFTER the current active endpoint in `endpointIds`, wraps once,
 * and never returns the current active.
 *
 * For the snapback path, callers iterate the array from index 0 first
 * (preferred) regardless of current active position; that's handled in the
 * service, not here.
 */
export function pickFailoverCandidates(state: NetworkRouteState, endpointIds: readonly string[], now: number = Date.now()): string[] {
	if (endpointIds.length === 0) return []
	const activeIdx = endpointIds.indexOf(state.activeEndpointId)
	const startAt = activeIdx >= 0 ? activeIdx + 1 : 0
	const out: string[] = []
	for (let i = 0; i < endpointIds.length; i++) {
		const id = endpointIds[(startAt + i) % endpointIds.length]!
		if (id === state.activeEndpointId) continue
		if (!isAvailable(state, id, now)) continue
		out.push(id)
	}
	return out
}

/**
 * Plain-object projection of the state for the wire boundary (the SW ↔ popup
 * messaging boundary serializes JSON; Map and Set don't survive). Used by
 * `getEndpointHealth()` so the popup can render the UX without holding live
 * references to the SW state.
 */
export type EndpointHealthSnapshot = {
	activeEndpointId: string
	failures: Record<string, EndpointFailureCounters>
	cooldownUntil: Record<string, number>
	invalidChain: string[]
	exhaustedAt?: number
}

export function snapshotRouteState(state: NetworkRouteState): EndpointHealthSnapshot {
	return {
		activeEndpointId: state.activeEndpointId,
		failures: Object.fromEntries(state.failures),
		cooldownUntil: Object.fromEntries(state.cooldownUntil),
		invalidChain: [...state.invalidChain],
		exhaustedAt: state.exhaustedAt,
	}
}
