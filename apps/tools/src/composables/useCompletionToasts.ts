import { watch } from "vue"
import { assetDecimals, assetSymbol } from "@/lib/asset-label"
import { etherscanTxUrl, explorerTxUrl } from "@/lib/explorer"
import { formatStoredAmount } from "@/lib/format"
import { useBridgeJournal } from "./useBridgeJournal"
import { useToast } from "./useToast"

type Completed = NonNullable<ReturnType<typeof useBridgeJournal>["lastCompleted"]["value"]>

/** A fee-juice completion is 18-dec Fee Juice, not the token's asset: label it as such. */
function completionText(done: Completed): string {
	const sym = assetSymbol(done.assetKind, done.isPrivate)
	const amount = formatStoredAmount(done.amount, assetDecimals(done.assetKind))
	if (done.direction !== "deposit") return `Released ${amount} ${sym} to Ethereum ✓`
	return done.assetKind === "fee-juice" ? `Fueled Aztec with ${amount} ${sym} ✓` : `Bridged ${amount} ${sym} to Aztec ✓`
}

function completionLink(done: Completed): { label: string; href: string } | undefined {
	if (!done.txHash) return undefined
	const href = done.direction === "deposit" ? explorerTxUrl(done.txHash) : etherscanTxUrl(done.txHash)
	return href ? { label: "view tx", href } : undefined
}

/**
 * Announces a bridge completing in the background. Mounted ONCE by the shell, so the announcement
 * neither depends on which section is visible nor doubles when two lists render the same records.
 */
export function useCompletionToasts(): void {
	const journal = useBridgeJournal()
	const { push } = useToast()
	watch(
		() => journal.lastCompleted.value,
		(done) => {
			if (!done) return
			// The foreground stepper shows the receipt for this completion — a toast would double it.
			// Keyed off the SYNCHRONOUS capture, not the live activeFlowId: the form's completion watcher
			// releases the takeover before this one runs, so the live check would always pass here.
			if (done.foreground) return
			push({ kind: "ok", text: completionText(done), link: completionLink(done) })
		},
	)
}
