/**
 * createAuthWit variants (callIntent + innerHash — PRIVATE witnesses,
 * silent-path on default sessions) plus the PUBLIC registry lifecycle:
 * grant (`grantPublicAuthwit` custom RPC → on-chain `set_authorized`,
 * tracked by the wallet's settings) and consume (a `sendTx` AS the
 * authorized caller invoking `transfer_public_to_public(owner, …)`,
 * which makes the token check + burn the registry approval).
 *
 * Grant and consume are deliberately SEPARATE buttons: bundling them in
 * one tx would re-grant before every consume and invert the lifecycle
 * e2e's negative assertions (post-revoke consume would self-authorize).
 * Registry approvals are single-use — fresh nonce per grant/consume pair.
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
			<div class="pg-row">
				<label>Acting account:
					<select data-testid="pg-select-account" name="actingAccount" ${dis}>
						${s.accounts
							.map(
								(a) =>
									`<option value="${a.address}" ${a.address === s.selectedAccount ? "selected" : ""}>${a.name || a.address}</option>`,
							)
							.join("")}
					</select>
				</label>
			</div>
			<div class="pg-row">
				<label>Owner (grants): <input data-testid="pg-input-authwitOwner" name="authwitOwner" type="text" placeholder="0x... (account A)" /></label>
				<label>Caller (spends): <input data-testid="pg-input-authwitCaller" name="authwitCaller" type="text" placeholder="0x... (account B)" /></label>
			</div>
			<div class="pg-row">
				<label>Amount: <input data-testid="pg-input-authwitAmount" name="authwitAmount" type="text" value="1" /></label>
				<label>Nonce: <input data-testid="pg-input-authwitNonce" name="authwitNonce" type="text" value="1" /></label>
			</div>
			<div class="pg-row">
				<button data-testid="pg-btn-grantPublicAuthwit" type="button" ${dis}>grant public authwit (registry)</button>
				<button data-testid="pg-btn-consumeAuthwit" type="button" ${dis}>consume (transfer-from as caller)</button>
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
			const fromAddr = AztecAddress.fromStringUnsafe(s.selectedAccount)
			const consumerAddr = AztecAddress.fromStringUnsafe(consumer)
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
			const fromAddr = AztecAddress.fromStringUnsafe(s.selectedAccount)
			const intent = {
				consumer: AztecAddress.fromStringUnsafe(consumer),
				innerHash: Fr.fromString(innerHashStr),
			}
			// biome-ignore lint/suspicious/noExplicitAny: IntentInnerHash shape
			return wallet.createAuthWit(fromAddr, intent as any)
		}),
	)

	root.querySelector<HTMLSelectElement>('[data-testid="pg-select-account"]')?.addEventListener("change", (ev) => {
		setState({ selectedAccount: (ev.target as HTMLSelectElement).value })
	})

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-grantPublicAuthwit"]')?.addEventListener(
		"click",
		safe("grantPublicAuthwit", async () => {
			const wallet = getWallet()!
			const s = getState()
			const tokenAddress = getInput("tokenAddress")
			if (!tokenAddress) throw new Error("tokenAddress input required")
			const owner = getInput("authwitOwner") || s.selectedAccount
			const caller = getInput("authwitCaller")
			if (!owner || !caller) throw new Error("owner + caller required")
			const amount = getInput("authwitAmount") || "1"
			const nonce = getInput("authwitNonce") || "1"
			// The grant's args must byte-match the future consume call:
			// transfer_public_to_public(owner, caller, amount, nonce).
			// biome-ignore lint/suspicious/noExplicitAny: schema-patched method — not on the upstream Wallet type
			return (wallet as any).grantPublicAuthwit(AztecAddress.fromStringUnsafe(owner), {
				caller,
				contract: tokenAddress,
				method: "transfer_public_to_public",
				args: [owner, caller, amount, nonce],
			})
		}),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-consumeAuthwit"]')?.addEventListener(
		"click",
		safe("sendTx", async () => {
			const wallet = getWallet()!
			const s = getState()
			const tokenAddress = getInput("tokenAddress")
			if (!tokenAddress) throw new Error("tokenAddress input required")
			// The CALLER consumes: the acting (selected) account must be the
			// caller the grant named; owner stays the granting account A.
			const owner = getInput("authwitOwner")
			if (!owner) throw new Error("authwitOwner required")
			if (!s.selectedAccount) throw new Error("No selected account")
			const amount = getInput("authwitAmount") || "1"
			const nonce = getInput("authwitNonce") || "1"
			const { TokenContract } = await import("@alejoamiras/aztec-standards/artifacts/src/artifacts/Token.js")
			// biome-ignore lint/suspicious/noExplicitAny: structural typing across SDK boundary
			const token: any = await TokenContract.at(AztecAddress.fromStringUnsafe(tokenAddress), wallet as any)
			const callerAddr = AztecAddress.fromStringUnsafe(s.selectedAccount)
			const exec = await token.methods
				.transfer_public_to_public(AztecAddress.fromStringUnsafe(owner), callerAddr, BigInt(amount), BigInt(nonce))
				.request()
			const payload = { calls: exec.calls ?? [], authWitnesses: [], capsules: [], extraHashedArgs: [] }
			// biome-ignore lint/suspicious/noExplicitAny: ExecutionPayload + SendOptions structural cast
			return wallet.sendTx(payload as any, { from: callerAddr, wait: "NO_WAIT" } as any)
		}),
	)
}
