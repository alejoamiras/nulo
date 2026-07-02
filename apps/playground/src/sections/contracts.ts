/**
 * Contract registration + metadata. Canonical wallet-sdk methods + the
 * Nulo-custom `registerToken` (re-introduced via the runtime schema patch in
 * `lib/nulo-schema-patch.ts`).
 *
 * registerContract needs a real ContractInstance which the test driver passes
 * via the `pg-input-contractInstance` textarea (JSON-stringified instance).
 */
import { Fr } from "@aztec/foundation/curves/bn254"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { getWallet } from "../lib/wallet"
import { logCall } from "../lib/log"
import { getInput, getState, setState } from "../state"

/** Typed augmentation for the Nulo-custom method. The runtime patch in
 *  `lib/nulo-schema-patch.ts` makes this true at runtime; the cast aligns TS. */
type WalletWithRegisterToken = Wallet & {
	registerToken(account: AztecAddress, token: AztecAddress): Promise<void>
}

export function renderContracts(): string {
	const s = getState()
	const dis = s.status === "connected" ? "" : "disabled"
	return `
		<fieldset class="pg-section">
			<legend>Contracts</legend>
			<div class="pg-row">
				<label>Token addr: <input data-testid="pg-input-tokenAddress" name="tokenAddress" type="text" placeholder="0x..." /></label>
				<label>Class id: <input data-testid="pg-input-classId" name="classId" type="text" placeholder="0x..." /></label>
				<label>Sender addr: <input data-testid="pg-input-senderAddress" name="senderAddress" type="text" placeholder="0x..." /></label>
				<label>Account addr: <input data-testid="pg-input-accountAddress" name="accountAddress" type="text" placeholder="0x..." /></label>
			</div>
			<div class="pg-row">
				<label>Contract instance JSON:
					<textarea data-testid="pg-input-contractInstance" name="contractInstance" rows="3" cols="40" placeholder='{"address":"0x...","contractClassId":"0x...","initializationHash":"0x...","publicKeys":...,"salt":"0x...","deployer":"0x...","version":1}'></textarea>
				</label>
			</div>
			<div class="pg-row">
				<button data-testid="pg-btn-registerContract" type="button" ${dis}>registerContract</button>
				<button data-testid="pg-btn-registerSender" type="button" ${dis}>registerSender</button>
				<button data-testid="pg-btn-registerToken" type="button" ${dis}>registerToken</button>
				<button data-testid="pg-btn-getContractMetadata" type="button" ${dis}>getContractMetadata</button>
				<button data-testid="pg-btn-getContractClassMetadata" type="button" ${dis}>getContractClassMetadata</button>
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

export function bindContracts(root: HTMLElement): void {
	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-getContractMetadata"]')?.addEventListener(
		"click",
		safe("getContractMetadata", async () => {
			const wallet = getWallet()!
			const addr = AztecAddress.fromStringUnsafe(getInput("tokenAddress"))
			return wallet.getContractMetadata(addr)
		}),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-getContractClassMetadata"]')?.addEventListener(
		"click",
		safe("getContractClassMetadata", async () => {
			const wallet = getWallet()!
			const id = Fr.fromString(getInput("classId") || getInput("tokenAddress"))
			return wallet.getContractClassMetadata(id)
		}),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-registerSender"]')?.addEventListener(
		"click",
		safe("registerSender", async () => {
			const wallet = getWallet()!
			const addr = AztecAddress.fromStringUnsafe(getInput("senderAddress") || getInput("tokenAddress"))
			return wallet.registerSender(addr, "test-sender")
		}),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-registerContract"]')?.addEventListener(
		"click",
		safe("registerContract", async () => {
			const wallet = getWallet()!
			const raw = getInput("contractInstance")
			if (!raw) throw new Error("Empty contractInstance — set the input first")
			// biome-ignore lint/suspicious/noExplicitAny: instance shape varies by aztec.js version
			const instance = JSON.parse(raw) as any
			return wallet.registerContract(instance)
		}),
	)

	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-registerToken"]')?.addEventListener(
		"click",
		safe("registerToken", async () => {
			const wallet = getWallet()! as WalletWithRegisterToken
			const accountInput = getInput("accountAddress") || getInput("senderAddress")
			if (!accountInput) throw new Error("Empty accountAddress — set the input first")
			const tokenInput = getInput("tokenAddress")
			if (!tokenInput) throw new Error("Empty tokenAddress — set the input first")
			const account = AztecAddress.fromStringUnsafe(accountInput)
			const token = AztecAddress.fromStringUnsafe(tokenInput)
			return wallet.registerToken(account, token)
		}),
	)
}
