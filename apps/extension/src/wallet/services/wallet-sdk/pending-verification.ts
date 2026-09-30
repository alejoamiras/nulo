/**
 * The pending-verification marker: written at interactive discovery approval,
 * consumed at session establishment, keyed by the transport REQUEST id (which
 * the upstream handler reuses verbatim as the sessionId — "the discovery
 * requestId becomes our sessionId"). Request-keying is load-bearing: a
 * tuple-keyed marker let one origin's concurrent handshakes consume each
 * other's markers, and a reconnect could strip the marker from a still-open
 * approved handshake.
 *
 * The value binds WHO approved (the profile whose DappSession row the
 * approval created — the establishment path fail-closes on mismatch, so an
 * approval started under one profile can never mint a channel stamped with
 * another) and WHERE (the discovery's tab — tab teardown deletes by tabId,
 * because `tabs.onRemoved` supplies nothing else and pre-establishment there
 * is no ActiveSession to map through).
 *
 * Staleness follows the layer's stamp-on-write / check-on-read convention
 * (see `isDiscoveryExpired`): no alarms. A STALE-but-present marker at
 * establishment TERMINATES the session — a parked approved handshake is dead,
 * never softened into reconnect semantics.
 *
 * An abandoned or failed attempt's marker is tombstoned (`cancelled`), not
 * deleted: the SDK restores an approved discovery on every termination, so the
 * same id can establish again later, and a missing marker would read as a
 * reconnect. Only a successful establishment spends a marker.
 */
export type PendingVerificationEntry = { at: number; profileId: string; tabId: number; cancelled?: true }

export const PENDING_VERIFICATION_STALE_MS = 90_000

export function isPendingVerificationStale(entry: PendingVerificationEntry, now = Date.now()): boolean {
	return now - entry.at > PENDING_VERIFICATION_STALE_MS
}

/** Tombstone `id`'s marker if it exists: its attempt was abandoned, so no establishment of it may succeed. */
export function cancelPendingVerification(markers: Map<string, PendingVerificationEntry>, id: string): void {
	const entry = markers.get(id)
	if (entry) entry.cancelled = true
}

/** A cancelled or stale marker: establishment terminates on it. */
export function isPendingVerificationDead(entry: PendingVerificationEntry, now = Date.now()): boolean {
	return entry.cancelled === true || isPendingVerificationStale(entry, now)
}

/** `id` established: a live or stale marker is spent, a tombstone stays so every retry of that id
 *  terminates too. */
export function consumePendingVerification(markers: Map<string, PendingVerificationEntry>, id: string): void {
	if (markers.get(id)?.cancelled !== true) markers.delete(id)
}

/** A new connection's establishment ended: success spends `id`'s marker, any other exit tombstones it. */
export function settlePendingVerification(markers: Map<string, PendingVerificationEntry>, id: string, established: boolean): void {
	if (established) consumePendingVerification(markers, id)
	else cancelPendingVerification(markers, id)
}

/** Delete every marker belonging to a torn-down tab. */
export function deletePendingVerificationForTab(markers: Map<string, PendingVerificationEntry>, tabId: number): void {
	for (const [key, entry] of markers) {
		if (entry.tabId === tabId) markers.delete(key)
	}
}
