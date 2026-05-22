/**
 * Batch combos.
 *
 * - meta: 3 silent-path methods (no popup).
 * - mixed: silent reads incl. one capability-gated method (no popup once the
 *   capability is granted).
 * - abort-on-failure: includes a leg expected to fail; verifies the dispatcher
 *   aborts the batch on the first failure and the dApp sees the underlying error.
 */
import { getWallet } from "../lib/wallet"
import { logCall } from "../lib/log"
import { getInput, getState, setState } from "../state"

export function renderBatch(): string {
	const s = getState()
	const dis = s.status === "connected" ? "" : "disabled"
	return `
		<fieldset class="pg-section">
			<legend>Batch</legend>
			<div class="pg-row">
				<button data-testid="pg-btn-batch-meta" type="button" ${dis}>batch meta</button>
				<button data-testid="pg-btn-batch-mixed" type="button" ${dis}>batch mixed</button>
				<button data-testid="pg-btn-batch-partial-failure" type="button" ${dis}>batch abort on failure</button>
			</div>
		</fieldset>
	`
}

function safeBatch(method: string, fn: () => Promise<unknown>): () => Promise<void> {
	return async () => {
		const wallet = getWallet()
		if (!wallet) {
			setState({ lastError: "Not connected" })
			return
		}
		try {
			await logCall(method, fn)
		} catch (err) {
			setState({ lastError: err instanceof Error ? err.message : String(err) })
		}
	}
}

export function bindBatch(root: HTMLElement): void {
	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-batch-meta"]')?.addEventListener(
		"click",
		safeBatch("batch", () => {
			const wallet = getWallet()!
			// Only include exempt methods (capability-map.ts:14) so this works
			// without any granted capabilities. `getAccounts` is NOT exempt: it
			// throws CapabilityNotGrantedError("accounts") pre-grant — pinned by
			// meta-getAccounts-pregrant.test.ts. So this batch uses 3x getChainInfo.
			// biome-ignore lint/suspicious/noExplicitAny: structural batch shape
			return (wallet as any).batch([
				{ name: "getChainInfo", args: [] },
				{ name: "getChainInfo", args: [] },
				{ name: "getChainInfo", args: [] },
			])
		}),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-batch-mixed"]')?.addEventListener(
		"click",
		safeBatch("batch", async () => {
			const wallet = getWallet()!
			// Silent meta (exempt) + two `basic`-bundle silent legs. `getAccounts`
			// would throw without the `accounts` cap (see comment in batch-meta
			// above) — so this batch uses getChainInfo + 2x getContractMetadata
			// to stress both an exempt leg AND a contracts-gated leg.
			// (No sendTx leg in this variant — sendTx-in-batch deserves its own
			//  test with deeper popup choreography. See plan §3 #36.)
			// biome-ignore lint/suspicious/noExplicitAny: structural batch shape
			return (wallet as any).batch([
				{ name: "getChainInfo", args: [] },
				{ name: "getContractMetadata", args: [getInput("tokenAddress") || "0x0"] },
				{ name: "getContractMetadata", args: [getInput("tokenAddress") || "0x0"] },
			])
		}),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-batch-partial-failure"]')?.addEventListener(
		"click",
		safeBatch("batch", () => {
			const wallet = getWallet()!
			// One real meta call + one expected-to-fail leg (unknown method).
			// The dispatcher aborts on the first failure; the unknown method
			// throws and the whole batch rejects with that error.
			// biome-ignore lint/suspicious/noExplicitAny: structural batch shape
			return (wallet as any).batch([
				{ name: "getChainInfo", args: [] },
				{ name: "thisMethodDoesNotExist", args: [] },
			])
		}),
	)
}
