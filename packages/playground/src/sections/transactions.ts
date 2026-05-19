/**
 * `sendTx` variants: default, `NoFrom`, `feePayer`, multicall, chunked,
 * reject, sponsored.
 *
 * Each variant constructs an `ExecutionPayload` and calls
 * `wallet.sendTx()`. `sendTx` ALWAYS opens `/windows/execute`
 * (`Transactions=5 >= confirmationLevel=5`); tests drive the popup via
 * `approveExecute()` / `rejectExecute()`.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getWallet } from "../lib/wallet"
import { logCall } from "../lib/log"
import { getInput, getState, setState } from "../state"

export function renderTransactions(): string {
	const s = getState()
	const dis = s.status === "connected" ? "" : "disabled"
	return `
		<fieldset class="pg-section">
			<legend>Transactions</legend>
			<div class="pg-row">
				<label>Recipient: <input data-testid="pg-input-recipient" name="recipient" type="text" placeholder="0x..." /></label>
				<label>Amount: <input data-testid="pg-input-amount" name="amount" type="number" placeholder="100" /></label>
				<label>FeePayer (FPC addr): <input data-testid="pg-input-feePayer" name="feePayer" type="text" placeholder="0x... (defaults to recipient)" /></label>
			</div>
			<div class="pg-row">
				<button data-testid="pg-btn-sendTx-default" type="button" ${dis}>sendTx default</button>
				<button data-testid="pg-btn-sendTx-noFrom" type="button" ${dis}>sendTx NoFrom</button>
				<button data-testid="pg-btn-sendTx-feePayer" type="button" ${dis}>sendTx feePayer</button>
				<button data-testid="pg-btn-sendTx-multicall" type="button" ${dis}>sendTx multicall</button>
				<button data-testid="pg-btn-sendTx-multicall-chunked" type="button" ${dis}>sendTx multicall &gt;5</button>
			</div>
		</fieldset>
	`
}

async function buildTransferExec(callCount = 1) {
	const tokenAddress = getInput("tokenAddress")
	const recipient = getInput("recipient")
	const amount = getInput("amount") || "1"
	if (!tokenAddress || !recipient) throw new Error("tokenAddress + recipient inputs required")

	const { TokenContract } = await import("@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js")
	const wallet = getWallet()!
	// biome-ignore lint/suspicious/noExplicitAny: structural typing across SDK boundary
	const token: any = await TokenContract.at(AztecAddress.fromString(tokenAddress), wallet as any)
	const s = getState()
	const fromAddr = s.selectedAccount ? AztecAddress.fromString(s.selectedAccount) : AztecAddress.fromString(recipient)
	const toAddr = AztecAddress.fromString(recipient)

	// Build N transfer calls. For the chunked variant (callCount > 5) we issue
	// N independent BatchCall.request() requests and concat their calls arrays.
	const calls: unknown[] = []
	for (let i = 0; i < callCount; i++) {
		const exec = await token.methods.transfer_public_to_public(fromAddr, toAddr, BigInt(amount), BigInt(i)).request()
		calls.push(...(exec.calls ?? []))
	}
	return { exec: { calls, authWitnesses: [], capsules: [], extraHashedArgs: [] }, fromAddr }
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

export function bindTransactions(root: HTMLElement): void {
	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-sendTx-default"]')?.addEventListener(
		"click",
		safe("sendTx", async () => {
			const wallet = getWallet()!
			const { exec, fromAddr } = await buildTransferExec(1)
			// biome-ignore lint/suspicious/noExplicitAny: ExecutionPayload + SendOptions structural cast
			return wallet.sendTx(exec as any, { from: fromAddr } as any)
		}),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-sendTx-noFrom"]')?.addEventListener(
		"click",
		safe("sendTx", async () => {
			const wallet = getWallet()!
			const { exec } = await buildTransferExec(1)
			// NoFrom: dispatcher.ts:82-88 detects from === "NO_FROM" and routes
			// through DefaultEntrypoint instead of the account contract.
			// biome-ignore lint/suspicious/noExplicitAny: NO_FROM is a sentinel string the SDK doesn't type
			return wallet.sendTx(exec as any, { from: "NO_FROM" } as any)
		}),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-sendTx-feePayer"]')?.addEventListener(
		"click",
		safe("sendTx", async () => {
			const wallet = getWallet()!
			const { exec, fromAddr } = await buildTransferExec(1)
			// dispatcher.ts:368-369 + execute/index.vue:202: when exec.feePayer is set,
			// the wallet auto-uses embedded paymentMethod and skips the fee picker.
			// Test mode passes a real FPC address via pg-input-feePayer; fallback to
			// recipient for ad-hoc playground usage (will fail at submit but exercises
			// the popup path).
			const feePayerInput = getInput("feePayer")
			const feePayer = AztecAddress.fromString(feePayerInput || getInput("recipient"))
			// biome-ignore lint/suspicious/noExplicitAny: ExecutionPayload doesn't include feePayer in this version's types
			const execWithFeePayer: any = { ...exec, feePayer }
			// biome-ignore lint/suspicious/noExplicitAny: SendOptions structural cast
			return wallet.sendTx(execWithFeePayer, { from: fromAddr } as any)
		}),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-sendTx-multicall"]')?.addEventListener(
		"click",
		safe("sendTx", async () => {
			const wallet = getWallet()!
			const { exec, fromAddr } = await buildTransferExec(3)
			// biome-ignore lint/suspicious/noExplicitAny: structural cast
			return wallet.sendTx(exec as any, { from: fromAddr } as any)
		}),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-sendTx-multicall-chunked"]')?.addEventListener(
		"click",
		safe("sendTx", async () => {
			const wallet = getWallet()!
			// >5 calls triggers nulo-account.ts recursive chunking (CLAUDE.md mentions this).
			const { exec, fromAddr } = await buildTransferExec(7)
			// biome-ignore lint/suspicious/noExplicitAny: structural cast
			return wallet.sendTx(exec as any, { from: fromAddr } as any)
		}),
	)
}
