/**
 * Read-only meta methods. Silent-path on default sessions
 * (confirmationLevel = Transactions, all of these are <= PxeState).
 *
 * getCompleteAddress (Nulo-custom) was dropped in the canonical refactor.
 */
import { getWallet } from "../lib/wallet"
import { logCall } from "../lib/log"
import { getState, setState } from "../state"

export function renderMeta(): string {
	const s = getState()
	const dis = s.status === "connected" ? "" : "disabled"
	return `
		<fieldset class="pg-section">
			<legend>Meta (silent on default sessions)</legend>
			<div class="pg-row">
				<button data-testid="pg-btn-getChainInfo" type="button" ${dis}>getChainInfo</button>
				<button data-testid="pg-btn-getAccounts" type="button" ${dis}>getAccounts</button>
				<button data-testid="pg-btn-getAddressBook" type="button" ${dis}>getAddressBook</button>
			</div>
		</fieldset>
	`
}

function safeCall<T>(method: string, fn: (w: NonNullable<ReturnType<typeof getWallet>>) => Promise<T>): () => Promise<void> {
	return async () => {
		const wallet = getWallet()
		if (!wallet) {
			setState({ lastError: "Not connected — call connect() first" })
			return
		}
		try {
			await logCall(method, () => fn(wallet))
		} catch (err) {
			setState({ lastError: err instanceof Error ? err.message : String(err) })
		}
	}
}

export function bindMeta(root: HTMLElement): void {
	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-getChainInfo"]')?.addEventListener(
		"click",
		safeCall("getChainInfo", (w) => w.getChainInfo()),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-getAccounts"]')?.addEventListener(
		"click",
		safeCall("getAccounts", (w) => w.getAccounts()),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-getAddressBook"]')?.addEventListener(
		"click",
		safeCall("getAddressBook", (w) => w.getAddressBook()),
	)
}
