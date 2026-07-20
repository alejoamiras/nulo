/**
 * Resilient L1 receipt wait for the bridge deposit legs.
 *
 * A plain `waitForTransactionReceipt` throws its timeout even when the
 * transaction IS mined (RPC flake, slow inclusion) — and a deposit flow that
 * dies on that timeout strands a CONFIRMED L1 deposit with no L2 claim. This
 * helper retries the wait, and after every timeout does a direct
 * `getTransactionReceipt` read: a mined-despite-timeout receipt is returned
 * instead of surfacing the flake. Only after all attempts does it throw — with
 * a message that tells the user the record stays Pending and Retry resumes
 * from the recorded transaction (the journal engine's deposit-leg recovery).
 */
export interface L1ReceiptClient<R> {
	waitForTransactionReceipt: (args: { hash: `0x${string}`; timeout?: number }) => Promise<R>
	getTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<R>
}

export interface AwaitL1ReceiptOptions {
	/** Wait rounds before giving up (default 8 — ~12 min with the default per-round timeout). */
	attempts?: number
	/** Per-round `waitForTransactionReceipt` timeout in ms (default 90s). */
	attemptTimeoutMs?: number
	/** Called after each unconfirmed round — lets the flow narrate "still waiting". */
	onStillWaiting?: (attempt: number) => void
	/** Injectable pause between rounds (tests pass a no-op). */
	waitMs?: (ms: number) => Promise<void>
}

export async function awaitL1Receipt<R>(client: L1ReceiptClient<R>, hash: `0x${string}`, opts: AwaitL1ReceiptOptions = {}): Promise<R> {
	const attempts = opts.attempts ?? 8
	const attemptTimeoutMs = opts.attemptTimeoutMs ?? 90_000
	const wait = opts.waitMs ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
	let lastError: unknown
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return await client.waitForTransactionReceipt({ hash, timeout: attemptTimeoutMs })
		} catch (e) {
			lastError = e
			try {
				return await client.getTransactionReceipt({ hash })
			} catch {
				// Genuinely not mined yet (or the RPC is still flaky) — next round.
			}
			opts.onStillWaiting?.(attempt)
			await wait(2_000)
		}
	}
	throw new Error(
		`The Ethereum transaction ${hash} was not confirmed after ${attempts} rounds of waiting. ` +
			"It may still confirm later - this bridge stays in Pending, and Retry resumes from the " +
			"recorded transaction without sending a new one.",
		{ cause: lastError },
	)
}
