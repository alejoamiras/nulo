/**
 * Canonical wallet-sdk simulation methods:
 *   - simulateTx (token transfer ExecutionPayload)
 *   - profileTx (same payload, different op)
 *   - executeUtility (balance_of_public read)
 *
 * The retired Nulo-custom `simulateViews` surface is documented in
 * `packages/wallet-bridge/README.md` under "Custom RPC methods". The
 * dApp-facing method AND the `simulate_views` op kind are both gone; the
 * batching logic now lives in
 * `extension/src/wallet/services/execution/helpers/batched-view-simulation.ts`
 * and is called directly by balance-projector + gas-balance.
 *
 * Function-call construction uses @alejoamiras/aztec-standards Token
 * artifact + Contract.at() pattern, mirroring real dApps.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getWallet } from "../lib/wallet"
import { logCall } from "../lib/log"
import { getInput, getState, setState } from "../state"

export function renderSimulation(): string {
	const s = getState()
	const dis = s.status === "connected" ? "" : "disabled"
	return `
		<fieldset class="pg-section">
			<legend>Simulation</legend>
			<div class="pg-row">
				<button data-testid="pg-btn-simulateTx-transfer" type="button" ${dis}>simulateTx (transfer)</button>
				<button data-testid="pg-btn-profileTx" type="button" ${dis}>profileTx</button>
				<button data-testid="pg-btn-executeUtility-balance" type="button" ${dis}>executeUtility (balance_of_public)</button>
			</div>
		</fieldset>
	`
}

async function buildTransferPayload() {
	const tokenAddress = getInput("tokenAddress")
	const recipient = getInput("recipient")
	const amount = getInput("amount") || "1"
	if (!tokenAddress || !recipient) throw new Error("tokenAddress + recipient inputs required")

	const { TokenContract } = await import("@alejoamiras/aztec-standards/artifacts/src/artifacts/Token.js")
	const wallet = getWallet()!
	// biome-ignore lint/suspicious/noExplicitAny: structural typing across SDK boundary
	const token: any = await TokenContract.at(AztecAddress.fromStringUnsafe(tokenAddress), wallet as any)

	const s = getState()
	const fromAddr = s.selectedAccount ? AztecAddress.fromStringUnsafe(s.selectedAccount) : AztecAddress.fromStringUnsafe(recipient)
	const interaction = token.methods.transfer_public_to_public(fromAddr, AztecAddress.fromStringUnsafe(recipient), BigInt(amount), 0n)
	const exec = await interaction.request()
	return { exec, fromAddr }
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

export function bindSimulation(root: HTMLElement): void {
	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-simulateTx-transfer"]')?.addEventListener(
		"click",
		safe("simulateTx", async () => {
			const wallet = getWallet()!
			const { exec, fromAddr } = await buildTransferPayload()
			return wallet.simulateTx(exec, { from: fromAddr, skipFeeEnforcement: true, skipTxValidation: true })
		}),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-profileTx"]')?.addEventListener(
		"click",
		safe("profileTx", async () => {
			const wallet = getWallet()!
			const { exec, fromAddr } = await buildTransferPayload()
			// Codex audit: pass skipProofGeneration explicitly. SDK defaults to true
			// but Nulo's execution service forwards undefined.
			// biome-ignore lint/suspicious/noExplicitAny: ProfileOptions structural cast
			return wallet.profileTx(exec, { from: fromAddr, profileMode: "full", skipProofGeneration: true } as any)
		}),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-executeUtility-balance"]')?.addEventListener(
		"click",
		safe("executeUtility", async () => {
			const wallet = getWallet()!
			const { TokenContract } = await import("@alejoamiras/aztec-standards/artifacts/src/artifacts/Token.js")
			const tokenAddress = getInput("tokenAddress")
			if (!tokenAddress) throw new Error("tokenAddress input required")
			// biome-ignore lint/suspicious/noExplicitAny: structural Contract typing
			const token: any = await TokenContract.at(AztecAddress.fromStringUnsafe(tokenAddress), wallet as any)
			const s = getState()
			const acct = s.selectedAccount ? AztecAddress.fromStringUnsafe(s.selectedAccount) : AztecAddress.fromStringUnsafe(tokenAddress)
			const exec = await token.methods.balance_of_public(acct).request()
			const call = exec.calls?.[0]
			if (!call) throw new Error("balance_of_public produced no call")
			// Codex audit: ExecuteUtilityOptions requires `scopes: AztecAddress[]`.
			// The execution service parses op.opts.scopes directly; without it the
			// call fails. authWitnesses + capsules + extraHashedArgs are also required.
			// biome-ignore lint/suspicious/noExplicitAny: ExecuteUtilityOptions cast at boundary
			const opts = { scopes: [acct], authWitnesses: [], capsules: [], extraHashedArgs: [] } as any
			return wallet.executeUtility(call as Parameters<typeof wallet.executeUtility>[0], opts)
		}),
	)
}
