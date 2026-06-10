import type { Wallet } from "@aztec/aztec.js/wallet"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { ref } from "vue"
import { type NormalizedError, normalizeError } from "@/lib/errors"

/**
 * Local typed augmentation matching the runtime schema patch in
 * `@/lib/nulo-schema-patch.ts`. The cast in `addToken()` is the typed
 * boundary - the patch makes it true at runtime, this declaration makes
 * TypeScript agree.
 */
type WalletWithRegisterToken = Wallet & {
	registerToken(account: AztecAddress, token: AztecAddress): Promise<void>
}

export type AddTokenStatus =
	| { kind: "idle" }
	| { kind: "submitting" }
	| { kind: "ok" }
	/** User clicked Deny in the extension popup. Per the wallet-bridge cancel
	 *  recipe, the UI must NOT surface an error - return to idle silently. */
	| { kind: "rejected" }
	/** Dispatcher rejected the method by string (e.g. schema patch not in place
	 *  on the wallet side, or the wallet is too old). Distinct from a network
	 *  failure so the UI can guide the user to update. */
	| { kind: "unsupported" }
	| { kind: "error"; error: NormalizedError }

/**
 * Drive a one-click "Add to wallet" call against the connected wallet's
 * `registerToken` Nulo-custom RPC. The extension shows a confirmation popup
 * (with resolved token name / symbol / decimals) before the call resolves.
 */
export function useFaucetAddToken() {
	const status = ref<AddTokenStatus>({ kind: "idle" })

	async function addToken(wallet: Wallet, accountAddress: string, tokenAddress: AztecAddress): Promise<void> {
		// Re-entrancy guard: ignore double-clicks while a previous call is
		// still in flight (the popup is open or the journal entry is being
		// written). Reset() returns the composable to a fresh state.
		if (status.value.kind === "submitting") return

		status.value = { kind: "submitting" }
		try {
			const w = wallet as WalletWithRegisterToken
			await w.registerToken(AztecAddress.fromString(accountAddress), tokenAddress)
			status.value = { kind: "ok" }
		} catch (err) {
			const normalized = normalizeError(err)
			const msg = `${normalized.message} ${err instanceof Error ? err.message : String(err)}`

			if (normalized.category === "user-rejected" || normalized.category === "capability-rejected") {
				// Silent per wallet-bridge cancel recipe (4001 → no error UI).
				status.value = { kind: "rejected" }
				return
			}

			if (msg.toLowerCase().includes("unsupported wallet method")) {
				// Schema patch not in place on this wallet (or wallet too old).
				// Distinct from a network failure: tell the user to update the
				// wallet rather than retry blindly.
				status.value = { kind: "unsupported" }
				return
			}

			status.value = { kind: "error", error: normalized }
		}
	}

	function reset() {
		status.value = { kind: "idle" }
	}

	return { status, addToken, reset }
}
