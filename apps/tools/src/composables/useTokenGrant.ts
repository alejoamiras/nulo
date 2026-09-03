/**
 * The per-token wallet grant. Every hub Token the wizard acts on must be in the wallet's grant
 * before anything is sent against it, and the grant is exact-address: a new token is a new wallet
 * prompt. This composable owns exactly that decision — is it granted, and if not, raise ONE prompt
 * and report what came back.
 */
import type { GrantOutcome, ResolvedToken } from "@/lib/send-model"
import { requestHubToken, useWalletConnection } from "./useWalletConnection"

/**
 * One prompt at a time, app-wide. Two selections racing would otherwise open two capability
 * requests whose approvals each REPLACE the stored grant, so the later approval could drop the
 * earlier token's scopes.
 */
let promptQueue: Promise<void> = Promise.resolve()

function enqueuePrompt<T>(run: () => Promise<T>): Promise<T> {
	const next = promptQueue.then(run)
	// The chain must outlive a rejected prompt: a queue left in a rejected state would fail every
	// later request without ever reaching the wallet.
	promptQueue = next.then(
		() => undefined,
		() => undefined,
	)
	return next
}

/** Test-only: drop the queue between cases. */
export function __resetTokenGrantQueueForTests(): void {
	promptQueue = Promise.resolve()
}

export interface TokenGrant {
	isGranted(l2Token: string): boolean
	/** Raise the wallet prompt for `token` unless the grant already covers it. `epoch` is read at
	 *  call time and again on completion — a selection that moved on discards the result. */
	ensureGranted(token: ResolvedToken, epoch: () => number): Promise<GrantOutcome>
	dispose(): void
}

/** Statuses in which the session is mid-flow: `retryCapabilities` no-ops in exactly these, so the
 *  wallet is never asked and never refuses anything. Any OTHER non-connected status is a real one. */
const MID_FLOW_STATUSES = new Set(["discovering", "choosing", "verifying", "capability-approval", "choosing-account", "setting-up"])

export function useTokenGrant(): TokenGrant {
	const session = useWalletConnection()
	let disposed = false

	function isGranted(l2Token: string): boolean {
		const wanted = l2Token.toLowerCase()
		return session.grantedContracts.value.some((granted) => granted.toLowerCase() === wanted)
	}

	const notConnected = (): GrantOutcome => (MID_FLOW_STATUSES.has(session.status.value) ? "busy" : "declined")

	function outcomeAfterPrompt(token: ResolvedToken, epoch: () => number, epochAtCall: number, ran: boolean): GrantOutcome {
		// The selection moved (or the caller went away) while the wallet was deciding. The completion
		// is DISCARDED rather than applied: the grant that came back describes the token the user was
		// looking at THEN, and attributing its registration or its scopes to the token they are
		// looking at NOW would let a stale approval stand in for one the user never saw.
		if (disposed || epoch() !== epochAtCall) return "stale"
		// Checked BEFORE the status: a flow that took the wallet between this call and the queue may
		// well have finished by now, and a completion nobody asked for is not a decision.
		if (!ran) return "busy"
		if (session.status.value !== "connected") return notConnected()
		return isGranted(token.l2Token) ? "granted" : "declined"
	}

	async function ensureGranted(token: ResolvedToken, epoch: () => number): Promise<GrantOutcome> {
		if (disposed) return "stale"
		// Recorded even when the grant already covers it: the requested set is what the NEXT
		// capability request re-grants and what a reconnect re-registers.
		requestHubToken({ l2Token: token.l2Token, erc20: token.address, words: token.words, decimals: token.decimals })
		if (isGranted(token.l2Token)) return "granted"
		if (session.status.value !== "connected") return notConnected()

		const epochAtCall = epoch()
		let ran = true
		await enqueuePrompt(async () => {
			// A prompt that ran ahead in the queue carries the whole requested set, so it may already
			// have granted this token — re-check before asking the user a second time.
			if (isGranted(token.l2Token)) return
			ran = await session.retryCapabilities()
		})
		return outcomeAfterPrompt(token, epoch, epochAtCall, ran)
	}

	/** The caller is gone: any prompt still in flight for it resolves as stale. */
	function dispose(): void {
		disposed = true
	}

	return { isGranted, ensureGranted, dispose }
}
