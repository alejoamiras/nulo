/**
 * createAuthWit variants: callIntent + innerHash. Both silent-path on default
 * sessions (PrivateData=4 < Transactions=5).
 */
import { Fr } from "@aztec/foundation/curves/bn254"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { FunctionCall, FunctionSelector, FunctionType } from "@aztec/aztec.js/abi"
import { getWallet } from "../lib/wallet"
import { logCall } from "../lib/log"
import { getInput, getState, setState } from "../state"

export function renderAuthwit(): string {
	const s = getState()
	const dis = s.status === "connected" ? "" : "disabled"
	return `
		<fieldset class="pg-section">
			<legend>AuthWit</legend>
			<div class="pg-row">
				<label>Consumer: <input data-testid="pg-input-consumer" name="consumer" type="text" placeholder="0x..." /></label>
				<label>InnerHash: <input data-testid="pg-input-innerHash" name="innerHash" type="text" placeholder="0x..." /></label>
			</div>
			<div class="pg-row">
				<button data-testid="pg-btn-createAuthWit-callIntent" type="button" ${dis}>createAuthWit (callIntent)</button>
				<button data-testid="pg-btn-createAuthWit-innerHash" type="button" ${dis}>createAuthWit (innerHash)</button>
			</div>
		</fieldset>
	`
}

function safe<T>(method: string, fn: () => Promise<T>): () => Promise<void> {
	return async () => {
		const wallet = getWallet()
		if (!wallet) {
			setState({ lastError: "Not connected — call connect() first" })
			return
		}
		try {
			await logCall(method, fn)
		} catch (err) {
			setState({ lastError: err instanceof Error ? err.message : String(err) })
		}
	}
}

export function bindAuthwit(root: HTMLElement): void {
	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-createAuthWit-callIntent"]')?.addEventListener(
		"click",
		safe("createAuthWit", async () => {
			const wallet = getWallet()!
			const s = getState()
			if (!s.selectedAccount) throw new Error("No selected account")
			const consumer = getInput("consumer") || getInput("tokenAddress")
			if (!consumer) throw new Error("consumer or tokenAddress required")
			const fromAddr = AztecAddress.fromString(s.selectedAccount)
			const consumerAddr = AztecAddress.fromString(consumer)
			const intent = {
				caller: consumerAddr,
				call: FunctionCall.from({
					name: "transfer_public_to_public",
					to: consumerAddr,
					selector: await FunctionSelector.fromSignature("transfer_public_to_public((Field),(Field),Field,Field)"),
					type: FunctionType.PUBLIC,
					hideMsgSender: false,
					isStatic: false,
					args: [],
					returnTypes: [],
				}),
			}
			// biome-ignore lint/suspicious/noExplicitAny: CallIntent shape varies by aztec.js version
			return wallet.createAuthWit(fromAddr, intent as any)
		}),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-createAuthWit-innerHash"]')?.addEventListener(
		"click",
		safe("createAuthWit", async () => {
			const wallet = getWallet()!
			const s = getState()
			if (!s.selectedAccount) throw new Error("No selected account")
			const consumer = getInput("consumer") || getInput("tokenAddress")
			const innerHashStr = getInput("innerHash") || "0x01"
			if (!consumer) throw new Error("consumer or tokenAddress required")
			const fromAddr = AztecAddress.fromString(s.selectedAccount)
			const intent = {
				consumer: AztecAddress.fromString(consumer),
				innerHash: Fr.fromString(innerHashStr),
			}
			// biome-ignore lint/suspicious/noExplicitAny: IntentInnerHash shape
			return wallet.createAuthWit(fromAddr, intent as any)
		}),
	)
}
