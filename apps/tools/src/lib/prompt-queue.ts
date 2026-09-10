/**
 * One wallet prompt at a time, app-wide. Two capability requests racing would each REPLACE the
 * stored grant, so the later approval could drop what the earlier one added; a membership read
 * racing a grant could overwrite the wider answer with the narrower one.
 */
let promptQueue: Promise<void> = Promise.resolve()

export function enqueuePrompt<T>(run: () => Promise<T>): Promise<T> {
	const next = promptQueue.then(run)
	// The chain must outlive a rejected prompt: a queue left in a rejected state would fail every
	// later request without ever reaching the wallet.
	promptQueue = next.then(
		() => undefined,
		() => undefined,
	)
	return next
}

/** Statuses in which the session is mid-flow: `retryCapabilities` no-ops in exactly these, so the
 *  wallet is never asked and never refuses anything. Any OTHER non-connected status is a real one. */
export const MID_FLOW_STATUSES: ReadonlySet<string> = new Set([
	"discovering",
	"choosing",
	"verifying",
	"capability-approval",
	"choosing-account",
	"setting-up",
])

/** Test-only: drop the queue between cases. */
export function __resetPromptQueueForTests(): void {
	promptQueue = Promise.resolve()
}
