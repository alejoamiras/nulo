/**
 * "Add accounts…": re-ask the connected wallet for accounts so one created after the connection
 * can join the session. The wallet decides what comes back; the app only compares the grant before
 * and after. A decline and "nothing new" both answer with the old grant and are reported alike.
 */
import { ref, type Ref } from "vue"
import { enqueuePrompt } from "@/lib/prompt-queue"
import { opsInFlight } from "./useOpsInFlight"
import { useWalletConnection } from "./useWalletConnection"

export type WideningOutcome = { kind: "added"; count: number } | { kind: "unchanged" } | { kind: "busy" } | { kind: "failed" }

export interface AccountWidening {
	/** True from the click until the wallet answered (or the request was refused as busy). */
	readonly busy: Ref<boolean>
	/** The last outcome, for the status line; null until the first click. */
	readonly outcome: Ref<WideningOutcome | null>
	addAccounts(): Promise<WideningOutcome>
}

type Session = ReturnType<typeof useWalletConnection>

/** Runs INSIDE the prompt queue: the state may have moved while the request waited its turn. */
async function runWidening(session: Session): Promise<WideningOutcome> {
	if (session.status.value !== "connected" || opsInFlight()) return { kind: "busy" }
	const before = new Set(session.accounts.value.map((a) => a.address))
	// False is the session's own no-op (another flow owns the wallet), never a refusal.
	if (!(await session.retryCapabilities())) return { kind: "busy" }
	if (session.status.value !== "connected" || session.error.value !== null) return { kind: "failed" }
	const added = session.accounts.value.filter((a) => !before.has(a.address)).length
	return added > 0 ? { kind: "added", count: added } : { kind: "unchanged" }
}

export function useAccountWidening(): AccountWidening {
	const session = useWalletConnection()
	const busy = ref(false)
	const outcome = ref<WideningOutcome | null>(null)

	async function addAccounts(): Promise<WideningOutcome> {
		if (busy.value) return { kind: "busy" }
		busy.value = true
		try {
			const result = await enqueuePrompt(() => runWidening(session))
			outcome.value = result
			return result
		} finally {
			busy.value = false
		}
	}

	return { busy, outcome, addAccounts }
}
