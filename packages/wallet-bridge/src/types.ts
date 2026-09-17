/** The execution fence captured when a wallet message is admitted — the profile, its
 *  deletion epoch, and the live session serial. Structural mirror of the extension's
 *  `ExecutionFence`; wallet-bridge sits below aztec-runtime and cannot import it, and the
 *  field set stays in lockstep across the boundary because the concrete runner consumes it. */
export type ExecutionFence = { profileId: string; epoch: number; session: number }

/**
 * Context derived from an active wallet-sdk session, passed to the dispatcher
 * so it can resolve the correct network, profile, and account for each call.
 */
export type SessionContext = {
	/** Aztec chain ID from the session's ChainInfo (e.g. 677868 for devnet). */
	chainId: number
	/** The active profile ID at the time the session was established. */
	profileId: string
	/** The dApp's origin URL (e.g. "https://mydapp.xyz"). */
	origin: string
	/** The wallet-sdk session ID (maps to BackgroundConnectionHandler.ActiveSession.sessionId). */
	sessionId: string
	/** The fence captured at admission, threaded into every fenced execution so a lock,
	 *  switch, re-unlock or same-id re-import parked between admission and commit fails
	 *  closed. Optional on the type; the wire handler always sets it. */
	fence?: ExecutionFence
}
