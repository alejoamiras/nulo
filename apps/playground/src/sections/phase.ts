/**
 * The self-pay phase gate: `Token.mint_to_private` from the token's minter — a private
 * call that enqueues a public finalisation, the same shape as the bridge hub's inner
 * claim — simulated and sent AS a named account under each fee route a dApp can name:
 *   - `self-pay`    feePayer = the account, no fee call (its own public Fee Juice)
 *   - `fpc-credit`  PrivateFPC `pay_fee` from credit the account already holds
 *   - `fpc-fuel`    FeeJuice.claim + PrivateFPC `mint_and_pay_fee` (a first transaction's fuel)
 *   - `external`    feePayer = another address, no fee call (the negative control)
 * Tx validation is never skipped here: the node's setup allow-list is part of what is proven.
 * Results are projected through `summarizeSimulation` for the simulate; sends return the hash.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { decodeFromAbi } from "@aztec/stdlib/abi"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { getWallet } from "../lib/wallet"
import { logCall } from "../lib/log"
import { summarizeSimulation } from "../lib/simulation-summary"
import { getInput, getState, setState } from "../state"

export function renderPhase(): string {
	const s = getState()
	const dis = s.status === "connected" ? "" : "disabled"
	return `
		<fieldset class="pg-section">
			<legend>Self-pay phase (mint_to_private)</legend>
			<div class="pg-row">
				<label>Token instance JSON: <textarea data-testid="pg-input-phase-tokenInstance" name="phaseTokenInstance" placeholder="{...}"></textarea></label>
				<label>From (minter): <input data-testid="pg-input-phase-from" name="phaseFrom" type="text" placeholder="0x... (defaults to selected account)" /></label>
				<label>Recipient: <input data-testid="pg-input-phase-recipient" name="phaseRecipient" type="text" placeholder="0x... (defaults to from)" /></label>
				<label>Amount: <input data-testid="pg-input-phase-amount" name="phaseAmount" type="number" placeholder="1" /></label>
			</div>
			<div class="pg-row">
				<label>Fee:
					<select data-testid="pg-select-phase-fee" name="phaseFee">
						<option value="self-pay">self-pay (own public Fee Juice)</option>
						<option value="fpc-credit">PrivateFPC credit (pay_fee)</option>
						<option value="fpc-fuel">PrivateFPC fuel (claim + mint_and_pay_fee)</option>
						<option value="external">external payer, no fee call</option>
					</select>
				</label>
				<label>Fee payer (self-pay / external): <input data-testid="pg-input-phase-feePayer" name="phaseFeePayer" type="text" placeholder="0x..." /></label>
				<label>PrivateFPC: <input data-testid="pg-input-phase-fpc" name="phaseFpc" type="text" placeholder="0x..." /></label>
			</div>
			<div class="pg-row">
				<label>Fuel amount: <input data-testid="pg-input-phase-fuelAmount" name="phaseFuelAmount" type="text" placeholder="wei" /></label>
				<label>Fuel secret: <input data-testid="pg-input-phase-fuelSecret" name="phaseFuelSecret" type="text" placeholder="0x..." /></label>
				<label>Fuel salt: <input data-testid="pg-input-phase-fuelSalt" name="phaseFuelSalt" type="text" placeholder="0x..." /></label>
				<label>Fuel leaf index: <input data-testid="pg-input-phase-fuelLeaf" name="phaseFuelLeaf" type="text" placeholder="0x..." /></label>
			</div>
			<div class="pg-row">
				<button data-testid="pg-btn-phase-register" type="button" ${dis}>register (token + FPC)</button>
				<button data-testid="pg-btn-phase-simulate" type="button" ${dis}>simulate mint</button>
				<button data-testid="pg-btn-phase-send" type="button" ${dis}>send mint</button>
				<button data-testid="pg-btn-phase-mintCredit" type="button" ${dis}>send PrivateFPC.mint (credit)</button>
				<button data-testid="pg-btn-phase-credit" type="button" ${dis}>read PrivateFPC credit</button>
				<button data-testid="pg-btn-phase-balance" type="button" ${dis}>read private balance</button>
			</div>
		</fieldset>
	`
}

function required(name: string, label: string): string {
	const v = getInput(name)
	if (!v) throw new Error(`${label} input required`)
	return v
}

function fromAddress(): AztecAddress {
	const from = getInput("phaseFrom") || getState().selectedAccount
	if (!from) throw new Error("phaseFrom input required (no selected account)")
	return AztecAddress.fromStringUnsafe(from)
}

// biome-ignore lint/suspicious/noExplicitAny: structural typing across SDK boundary
async function tokenAt(address: AztecAddress): Promise<any> {
	const { TokenContract } = await import("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js")
	const wallet = getWallet()!
	// biome-ignore lint/suspicious/noExplicitAny: structural typing across SDK boundary
	return TokenContract.at(address, wallet as any)
}

function tokenAddressFromInstance(): AztecAddress {
	const raw = required("phaseTokenInstance", "phaseTokenInstance")
	const parsed = JSON.parse(raw) as { address?: string }
	if (!parsed.address) throw new Error("token instance JSON has no address")
	return AztecAddress.fromStringUnsafe(parsed.address)
}

async function fpcInstance() {
	const { PrivateFPCContract } = await import("@alejoamiras/private-fee-juice/artifacts/private")
	// biome-ignore lint/suspicious/noExplicitAny: aztec-stdlib instance mismatch between the FPC package's pinned version and Nulo's
	const artifact = (PrivateFPCContract as any).artifact
	const instance = await getContractInstanceFromInstantiationParams(artifact, { salt: new Fr(1n), deployer: AztecAddress.ZERO })
	return { artifact, instance, PrivateFPCContract }
}

/** The fee payment method a dApp would pass for the selected route, or `null` for
 *  the routes that name a payer without a fee call. */
async function feePaymentMethod() {
	const route = getInput("phaseFee") || "self-pay"
	if (route === "self-pay" || route === "external") return null
	const fpc = AztecAddress.fromStringUnsafe(required("phaseFpc", "phaseFpc"))
	const { FPCFeePaymentMethod, PrivateMintAndPayFeePaymentMethod } = await import("@alejoamiras/private-fee-juice/fee-payment-methods")
	if (route === "fpc-credit") return new FPCFeePaymentMethod(fpc)
	if (route === "fpc-fuel") {
		return new PrivateMintAndPayFeePaymentMethod(
			fpc,
			BigInt(required("phaseFuelAmount", "phaseFuelAmount")),
			Fr.fromString(required("phaseFuelSecret", "phaseFuelSecret")),
			Fr.fromString(required("phaseFuelSalt", "phaseFuelSalt")),
			Fr.fromString(required("phaseFuelLeaf", "phaseFuelLeaf")),
		)
	}
	throw new Error(`unknown fee route ${route}`)
}

/** `mint_to_private(recipient, amount)` with the route's fee payload merged in front (the way
 *  `ContractFunctionInteraction.request` does) and `feePayer` set the way the route names it. */
async function buildMintPayload() {
	const from = fromAddress()
	const recipient = getInput("phaseRecipient") ? AztecAddress.fromStringUnsafe(getInput("phaseRecipient")) : from
	const amount = BigInt(getInput("phaseAmount") || "1")
	const token = await tokenAt(tokenAddressFromInstance())
	const method = await feePaymentMethod()
	// biome-ignore lint/suspicious/noExplicitAny: the FPC package's payment methods are typed against its own pinned aztec.js
	const exec = await token.methods.mint_to_private(recipient, amount).request(method ? { fee: { paymentMethod: method as any } } : {})
	const route = getInput("phaseFee") || "self-pay"
	if (route === "self-pay" || route === "external") {
		exec.feePayer = AztecAddress.fromStringUnsafe(required("phaseFeePayer", "phaseFeePayer"))
	}
	return { exec, from, recipient, amount }
}

function safe<T>(method: string, fn: () => Promise<T>): () => Promise<void> {
	return async () => {
		if (!getWallet()) {
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

/** Run a utility call as `scope` and return its decoded value as a string (u128 balances). */
// biome-ignore lint/suspicious/noExplicitAny: the call is built from a structurally-typed contract
async function readUtility(call: any, scope: AztecAddress): Promise<string> {
	const wallet = getWallet()!
	// biome-ignore lint/suspicious/noExplicitAny: ExecuteUtilityOptions cast at boundary
	const opts = { scopes: [scope], authWitnesses: [], capsules: [], extraHashedArgs: [] } as any
	const out = await wallet.executeUtility(call, opts)
	return String(decodeFromAbi(call.returnTypes, out.result))
}

function on(root: HTMLElement, testid: string, method: string, fn: () => Promise<unknown>): void {
	root.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)?.addEventListener("click", safe(method, fn))
}

export function bindPhase(root: HTMLElement): void {
	on(root, "pg-btn-phase-register", "phase.register", async () => {
		const wallet = getWallet()!
		const { TokenContract } = await import("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js")
		// biome-ignore lint/suspicious/noExplicitAny: instance wire shape
		const instance = JSON.parse(required("phaseTokenInstance", "phaseTokenInstance")) as any
		// biome-ignore lint/suspicious/noExplicitAny: artifact typed against the standards package's pinned aztec.js
		await wallet.registerContract(instance, TokenContract.artifact as any)
		if (getInput("phaseFpc")) {
			const { artifact, instance } = await fpcInstance()
			// biome-ignore lint/suspicious/noExplicitAny: see fpcInstance
			await wallet.registerContract(instance as any, artifact)
		}
		return { registered: true }
	})

	on(root, "pg-btn-phase-simulate", "phase.simulate", async () => {
		const wallet = getWallet()!
		const { exec, from } = await buildMintPayload()
		const result = await wallet.simulateTx(exec, { from, skipFeeEnforcement: true })
		return summarizeSimulation(result)
	})

	on(root, "pg-btn-phase-send", "phase.send", async () => {
		const wallet = getWallet()!
		const { exec, from } = await buildMintPayload()
		// biome-ignore lint/suspicious/noExplicitAny: SendOptions structural cast
		return wallet.sendTx(exec, { from, wait: "NO_WAIT" } as any)
	})

	on(root, "pg-btn-phase-mintCredit", "phase.mintCredit", async () => {
		const wallet = getWallet()!
		const from = fromAddress()
		const { instance, PrivateFPCContract } = await fpcInstance()
		// biome-ignore lint/suspicious/noExplicitAny: see fpcInstance
		const fpc: any = await PrivateFPCContract.at(instance.address, wallet as any)
		const exec = await fpc.methods
			.mint(
				BigInt(required("phaseFuelAmount", "phaseFuelAmount")),
				Fr.fromString(required("phaseFuelSalt", "phaseFuelSalt")),
				Fr.fromString(required("phaseFuelLeaf", "phaseFuelLeaf")),
			)
			.request()
		// No `additionalScopes`: the wallet admits only session accounts there, and the mint
		// credits `msg_sender` without reading any note the FPC scope would unlock.
		// biome-ignore lint/suspicious/noExplicitAny: SendOptions structural cast
		return wallet.sendTx(exec, { from, wait: "NO_WAIT" } as any)
	})

	on(root, "pg-btn-phase-credit", "phase.credit", async () => {
		const wallet = getWallet()!
		const from = fromAddress()
		const { instance, PrivateFPCContract } = await fpcInstance()
		// biome-ignore lint/suspicious/noExplicitAny: see fpcInstance
		const fpc: any = await PrivateFPCContract.at(instance.address, wallet as any)
		const exec = await fpc.methods.balance_of(from).request()
		const call = exec.calls?.[0]
		if (!call) throw new Error("balance_of produced no call")
		return readUtility(call, from)
	})

	on(root, "pg-btn-phase-balance", "phase.balance", async () => {
		const from = fromAddress()
		const owner = getInput("phaseRecipient") ? AztecAddress.fromStringUnsafe(getInput("phaseRecipient")) : from
		const token = await tokenAt(tokenAddressFromInstance())
		const exec = await token.methods.balance_of_private(owner).request()
		const call = exec.calls?.[0]
		if (!call) throw new Error("balance_of_private produced no call")
		return readUtility(call, owner)
	})
}
