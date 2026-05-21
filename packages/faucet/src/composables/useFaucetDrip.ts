import type { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { DripperContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Dripper.js"
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

/**
 * Single global in-flight drip per plan-v2 §4 (codex audit r5). Wallet
 * popups serialize anyway — letting multiple drips queue creates a
 * confusing wallet UX. All four DripButtons disable while one drip is
 * active; the active one shows its spinner.
 */
const inflight = ref<{ tokenSymbol: TokenSymbol; target: DripTarget } | null>(null)
const last = reactive<Record<string, DripResult | null>>({})

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
		// global gate; caller's button is already disabled but be defensive
		return { kind: "error", value: "Another drip is in flight." }
	}
	inflight.value = { tokenSymbol: token.symbol, target }
	const key = `${token.symbol}:${target}`
	try {
		const dripperContract = await Contract.at(DRIPPER, DripperContractArtifact, wallet)
		const fnName = target === "public" ? "drip_to_public" : "drip_to_private"
		// Access the methods bag through a structural type — the SDK's
		// generated contract proxy doesn't expose a clean signature here.
		const methods = (
			dripperContract as unknown as {
				methods: Record<string, (...args: unknown[]) => { request: () => Promise<unknown> }>
			}
		).methods
		const method = methods[fnName]
		if (typeof method !== "function") {
			throw new Error(`Dripper missing method ${fnName}`)
		}
		const interaction = method(tokenAddress, token.onchainAmount)
		const exec = await interaction.request()

		const fpc = await getSponsoredFpcInstance()
		// The SDK's ExecutionPayload type in @aztec/aztec.js@4.2.0 doesn't
		// include `feePayer`. Nulo's dispatcher materializes the embedded
		// fee path at runtime (packages/wallet-bridge/src/dispatcher.ts:331).
		// Single typed-boundary cast — matches playground transactions.ts:111.
		// biome-ignore lint/suspicious/noExplicitAny: SDK ExecutionPayload omits feePayer in this version
		const execWithFee: any = { ...(exec as object), feePayer: fpc.address }

		// biome-ignore lint/suspicious/noExplicitAny: SDK sendTx signature varies; runtime accepts our shape
		const tx = await (wallet as any).sendTx(execWithFee, { from: account })
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

function extractTxHash(tx: unknown): string {
	if (typeof tx === "string") return tx
	if (tx && typeof tx === "object") {
		const t = tx as { txHash?: unknown; hash?: unknown }
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
