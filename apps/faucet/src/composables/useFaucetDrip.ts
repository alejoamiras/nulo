import type { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { DripperContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Dripper.js"
import { reactive, ref } from "vue"
import { DRIPPER } from "@/contracts/deployments"
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import type { FaucetToken, TokenSymbol } from "@/constants/tokens"
import { type NormalizedError, normalizeError } from "@/lib/errors"

export type DripTarget = "public" | "private"
export type DripState = "idle" | "dripping" | "ok" | "error"

export interface DripResult {
	readonly kind: "txHash" | "error"
	readonly value: string
	readonly category?: NormalizedError["category"]
}

// Global single in-flight gate. Wallet popups serialize on the wallet
// side anyway; letting parallel drips queue creates confusing popup UX.
const inflight = ref<{ tokenSymbol: TokenSymbol; target: DripTarget } | null>(null)
const last = reactive<Record<string, DripResult | null>>({})

interface DripperInteraction {
	request: (opts?: { fee?: { paymentMethod: SponsoredFeePaymentMethod } }) => Promise<unknown>
}
interface DripperContract {
	methods: Record<string, (...args: unknown[]) => DripperInteraction>
}

export function useFaucetDrip(wallet: Wallet, account: AztecAddress) {
	return {
		inflight,
		last,
		isActive: (token: TokenSymbol, target: DripTarget) => inflight.value?.tokenSymbol === token && inflight.value.target === target,
		drip: async (token: FaucetToken, tokenAddress: AztecAddress, target: DripTarget) =>
			drip(wallet, account, token, tokenAddress, target),
	}
}

async function drip(
	wallet: Wallet,
	account: AztecAddress,
	token: FaucetToken,
	tokenAddress: AztecAddress,
	target: DripTarget,
): Promise<DripResult> {
	if (inflight.value !== null) {
		return { kind: "error", value: "Another drip is in flight." }
	}
	inflight.value = { tokenSymbol: token.symbol, target }
	const key = `${token.symbol}:${target}`
	try {
		const dripperContract = (await Contract.at(DRIPPER, DripperContractArtifact, wallet)) as unknown as DripperContract
		const fnName = target === "public" ? "drip_to_public" : "drip_to_private"
		const method = dripperContract.methods[fnName]
		if (typeof method !== "function") {
			throw new Error(`Dripper missing method ${fnName}`)
		}
		const fpc = await getSponsoredFpcInstance()
		// Pass the fee through `.request({ fee })` so aztec.js merges the
		// SponsoredFPC's `sponsor_unconditionally()` call into exec.calls
		// AND sets exec.feePayer. Tagging feePayer manually leaves the
		// public setup phase with no sponsor call, which the sequencer
		// rejects as "Setup function not on allow list".
		const interaction = method(tokenAddress, token.onchainAmount)
		const exec = await interaction.request({
			fee: { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) },
		})

		// biome-ignore lint/suspicious/noExplicitAny: SendOptions structural cast for SDK signature variance across versions
		const tx = await (wallet as any).sendTx(exec, { from: account } as any)
		const txHash = extractTxHash(tx)
		const result: DripResult = { kind: "txHash", value: txHash }
		last[key] = result
		return result
	} catch (err) {
		const norm = normalizeError(err)
		const result: DripResult = { kind: "error", value: norm.message, category: norm.category }
		last[key] = result
		return result
	} finally {
		inflight.value = null
	}
}

/**
 * sendTx with the default wait option returns `{ receipt: TxReceipt }`
 * (TxSendResultMined); with NO_WAIT it returns `{ txHash }`
 * (TxSendResultImmediate). The faucet uses the mined path, so the hash
 * lives at `tx.receipt.txHash`. The top-level `txHash` fallback keeps
 * test stubs that emit the immediate shape working.
 */
function extractTxHash(tx: unknown): string {
	if (typeof tx === "string") return tx
	if (tx && typeof tx === "object") {
		const t = tx as { receipt?: { txHash?: unknown }; txHash?: unknown; hash?: unknown }
		if (t.receipt?.txHash) return String(t.receipt.txHash)
		if (t.txHash) return String(t.txHash)
		if (t.hash) return String(t.hash)
	}
	return ""
}

/** Test-only: clear state between cases. */
export function __resetFaucetDripForTests(): void {
	inflight.value = null
	for (const k of Object.keys(last)) delete last[k]
}
