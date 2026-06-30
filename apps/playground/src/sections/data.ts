/**
 * Data capability methods. Wires `getPrivateEvents`.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/foundation/curves/bn254"
import { getWallet } from "../lib/wallet"
import { logCall } from "../lib/log"
import { getInput, getState, setState } from "../state"

export function renderData(): string {
	const s = getState()
	const dis = s.status === "connected" ? "" : "disabled"
	return `
		<fieldset class="pg-section">
			<legend>Data</legend>
			<div class="pg-row">
				<button data-testid="pg-btn-getPrivateEvents" type="button" ${dis}>getPrivateEvents</button>
			</div>
		</fieldset>
	`
}

export function bindData(root: HTMLElement): void {
	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-getPrivateEvents"]')?.addEventListener("click", async () => {
		const wallet = getWallet()
		if (!wallet) {
			setState({ lastError: "Not connected" })
			return
		}
		try {
			await logCall("getPrivateEvents", async () => {
				const tokenAddress = getInput("tokenAddress")
				if (!tokenAddress) throw new Error("tokenAddress input required")
				const s = getState()
				const acct = s.selectedAccount ? AztecAddress.fromString(s.selectedAccount) : AztecAddress.fromString(tokenAddress)
				// Minimal eventMetadata stub — wallet may reject, but the call is silent-path
				// either way (PrivateData=4 < confirmationLevel=5).
				const eventMetadata = { eventSelector: Fr.ZERO, fieldNames: [], decode: (_: unknown[]) => null }
				const eventFilter = {
					contractAddress: AztecAddress.fromString(tokenAddress),
					fromBlock: 0,
					toBlock: 1000,
					scopes: [acct],
				}
				// biome-ignore lint/suspicious/noExplicitAny: getPrivateEvents shapes vary; test driver may override
				return (wallet as any).getPrivateEvents(eventMetadata, eventFilter)
			})
		} catch (err) {
			setState({ lastError: err instanceof Error ? err.message : String(err) })
		}
	})
}
