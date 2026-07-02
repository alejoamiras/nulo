import type { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { TokenContractArtifact } from "@alejoamiras/aztec-standards/dist/src/artifacts/Token.js"
import { ref, type Ref } from "vue"

const POLL_INTERVAL_MS = 15_000

export interface UseTokenBalanceHandle {
	readonly publicBalance: Ref<bigint | null>
	readonly privateBalance: Ref<bigint | null>
	readonly loading: Ref<boolean>
	readonly error: Ref<string | null>
	refresh: () => Promise<void>
	dispose: () => void
}

/**
 * Per-token balance reader. Polls balance_of_public + balance_of_private
 * every 15s. The two paths diverge by Aztec function kind:
 *   - `balance_of_public` is `#[external("public")] #[view]` → read via
 *     `interaction.simulate({from})`. The SDK returns a SimulationResult
 *     `{ result, ... }`, so we extract `.result` and coerce to bigint.
 *   - `balance_of_private` is `#[external("utility")]` → read via
 *     `wallet.executeUtility(call, opts)`. The SDK returns a
 *     UtilityExecutionResult `{ result: Fr[], ... }`; we pick result[0].
 *
 * Caller owns lifecycle: invoke dispose() in onBeforeUnmount.
 */
export function useTokenBalance(wallet: Wallet, tokenAddress: AztecAddress, accountAddress: AztecAddress): UseTokenBalanceHandle {
	const publicBalance = ref<bigint | null>(null)
	const privateBalance = ref<bigint | null>(null)
	const loading = ref<boolean>(false)
	const error = ref<string | null>(null)
	let timer: ReturnType<typeof setInterval> | null = null
	let disposed = false

	async function fetchOnce(): Promise<void> {
		if (disposed) return
		loading.value = true
		try {
			const contract = await Contract.at(tokenAddress, TokenContractArtifact, wallet)
			// Settled independently: one failing path must not blank the other, and per-path raw
			// errors (with stacks) are the diagnosable artifact - normalizeError produces toast copy
			// that masks the cause ("Something went wrong"), so it is never stored here.
			const [pub, prv] = await Promise.allSettled([
				readBalance(wallet, contract, "balance_of_public", accountAddress),
				readBalance(wallet, contract, "balance_of_private", accountAddress),
			])
			if (disposed) return
			if (pub.status === "fulfilled") publicBalance.value = pub.value
			else console.warn(`[token-balance] balance_of_public failed (${tokenAddress.toString()}):`, pub.reason)
			if (prv.status === "fulfilled") privateBalance.value = prv.value
			else console.warn(`[token-balance] balance_of_private failed (${tokenAddress.toString()}):`, prv.reason)
			const firstFailure = [pub, prv].find((r): r is PromiseRejectedResult => r.status === "rejected")
			error.value = firstFailure
				? firstFailure.reason instanceof Error
					? firstFailure.reason.message
					: String(firstFailure.reason)
				: null
		} catch (err) {
			if (disposed) return
			console.warn(`[token-balance] reader failed (${tokenAddress.toString()}):`, err)
			error.value = err instanceof Error ? err.message : String(err)
		} finally {
			if (!disposed) loading.value = false
		}
	}

	async function refresh(): Promise<void> {
		await fetchOnce()
	}

	function start(): void {
		void fetchOnce()
		timer = setInterval(() => {
			void fetchOnce()
		}, POLL_INTERVAL_MS)
	}

	function dispose(): void {
		disposed = true
		if (timer !== null) {
			clearInterval(timer)
			timer = null
		}
	}

	start()

	return { publicBalance, privateBalance, loading, error, refresh, dispose }
}

interface ContractWithMethods {
	methods: Record<string, (...args: unknown[]) => { request: () => Promise<unknown> }>
}

interface ExecutionPayloadShape {
	calls?: unknown[]
}

interface UtilityExecutionResultShape {
	result?: unknown[]
}

interface SimulationResultShape {
	result?: unknown
}

export async function readBalance(
	wallet: Wallet,
	contract: unknown,
	// `balance_of` is the Wonderland PrivateFPC's `abi_utility` private-FJ read — it takes the same
	// utility path as `balance_of_private` (the `else` branch below), NOT the public-view path.
	fn: "balance_of_public" | "balance_of_private" | "balance_of",
	account: AztecAddress,
): Promise<bigint> {
	const c = contract as ContractWithMethods
	const method = c.methods[fn]
	if (typeof method !== "function") {
		throw new Error(`Token contract is missing method ${fn}`)
	}
	// Token contract attributes (aztec-standards):
	//   balance_of_public:  #[external("public")] #[view]   ← on-chain public view
	//   balance_of_private: #[external("utility")]           ← off-chain utility
	// Public views are read via `interaction.simulate({from})` and return a
	// `SimulationResult { result, … }` - we extract `.result` not the wrapper
	// (passing the wrapper to a coercer that expects bigint silently returns 0n).
	if (fn === "balance_of_public") {
		const interaction = method(account)
		// biome-ignore lint/suspicious/noExplicitAny: SDK SimulationResult.result is typed `any` upstream
		const raw = (await (interaction as any).simulate({ from: account })) as SimulationResultShape
		return toBigInt(raw?.result)
	}
	const exec = (await method(account).request()) as ExecutionPayloadShape
	const call = exec.calls?.[0]
	if (!call) {
		throw new Error(`${fn} produced no FunctionCall`)
	}
	const opts = {
		scopes: [account],
		authWitnesses: [],
		capsules: [],
		extraHashedArgs: [],
		// biome-ignore lint/suspicious/noExplicitAny: ExecuteUtilityOptions narrower than runtime
	} as any
	// biome-ignore lint/suspicious/noExplicitAny: FunctionCall isn't exported through aztec.js root
	const raw = (await wallet.executeUtility(call as any, opts)) as UtilityExecutionResultShape
	return extractFirstFr(raw)
}

function extractFirstFr(raw: UtilityExecutionResultShape): bigint {
	const first = raw.result?.[0]
	if (first === undefined || first === null) return 0n
	return toBigInt(first)
}

function toBigInt(value: unknown): bigint {
	if (typeof value === "bigint") return value
	if (typeof value === "number") return BigInt(value)
	if (typeof value === "string") return BigInt(value)
	if (value && typeof value === "object" && "toBigInt" in value) {
		const fn = (value as { toBigInt: () => bigint }).toBigInt
		if (typeof fn === "function") return fn.call(value)
	}
	return 0n
}
