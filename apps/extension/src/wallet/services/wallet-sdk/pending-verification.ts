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
 */
export type PendingVerificationEntry = { at: number; profileId: string; tabId: number }

export const PENDING_VERIFICATION_STALE_MS = 90_000

export function isPendingVerificationStale(entry: PendingVerificationEntry, now = Date.now()): boolean {
	return now - entry.at > PENDING_VERIFICATION_STALE_MS
}

/** Delete every marker belonging to a torn-down tab. */
export function deletePendingVerificationForTab(markers: Map<string, PendingVerificationEntry>, tabId: number): void {
	for (const [key, entry] of markers) {
		if (entry.tabId === tabId) markers.delete(key)
	}
}
