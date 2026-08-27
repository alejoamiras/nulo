import { connect, disconnect, requestCapabilities } from "../lib/wallet"
import { type BundleId, buildManifest } from "../lib/bundles"
import { logCall } from "../lib/log"
import { getState, setState } from "../state"

export function renderConnect(): string {
	const s = getState()
	return `
		<fieldset class="pg-section">
			<legend>Connect</legend>
			<div class="pg-row">
				<button data-testid="pg-btn-connect" type="button" ${s.status === "connected" ? "disabled" : ""}>Connect</button>
				<button data-testid="pg-btn-disconnect" type="button" ${s.status === "connected" ? "" : "disabled"}>Disconnect</button>
				<select data-testid="pg-bundle-select" name="bundle">
					<option data-bundle-id="basic" value="basic">basic</option>
					<option data-bundle-id="basic-noUtilities" value="basic-noUtilities">basic-noUtilities</option>
					<option data-bundle-id="basic-readOnly" value="basic-readOnly">basic-readOnly</option>
					<option data-bundle-id="accounts" value="accounts">accounts</option>
					<option data-bundle-id="accounts-noAuthWit" value="accounts-noAuthWit">accounts-noAuthWit</option>
					<option data-bundle-id="transaction" value="transaction">transaction</option>
					<option data-bundle-id="transaction-contracts" value="transaction-contracts">transaction-contracts</option>
					<option data-bundle-id="transaction-scoped" value="transaction-scoped">transaction-scoped</option>
					<option data-bundle-id="data" value="data">data</option>
					<option data-bundle-id="data-scopedEvents" value="data-scopedEvents">data-scopedEvents</option>
					<option data-bundle-id="contractClasses" value="contractClasses">contractClasses</option>
					<option data-bundle-id="full" value="full">full</option>
					<option data-bundle-id="custom" value="custom">custom</option>
				</select>
				<button data-testid="pg-btn-requestCapabilities" type="button" ${s.status === "connected" ? "" : "disabled"}>Request capabilities</button>
			</div>
		</fieldset>
	`
}

export function bindConnect(root: HTMLElement): void {
	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-connect"]')?.addEventListener("click", async () => {
		try {
			await connect()
		} catch (err) {
			setState({ status: "error", lastError: err instanceof Error ? err.message : String(err) })
		}
	})

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-disconnect"]')?.addEventListener("click", async () => {
		await disconnect()
	})

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-requestCapabilities"]')?.addEventListener("click", async () => {
		const select = root.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')
		const bundleId = (select?.value ?? "basic") as BundleId
		try {
			await logCall("requestCapabilities", () => requestCapabilities(buildManifest(bundleId)))
		} catch (err) {
			setState({ lastError: err instanceof Error ? err.message : String(err) })
		}
	})
}
