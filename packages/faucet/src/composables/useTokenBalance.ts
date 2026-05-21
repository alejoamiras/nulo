import type { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"
import { ref, type Ref } from "vue"
import { normalizeError } from "@/lib/errors"

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
 * every 15s via wallet.executeUtility. Extracts the first FunctionCall
 * from the ExecutionPayload returned by `method().request()`, then passes
 * the canonical option shape (scopes + empty authWitnesses/capsules/
 * extraHashedArgs) — the public ExecuteUtilityOptions type is narrower
 * than what the execution service requires at runtime.
 *
 * Caller owns lifecycle: invoke dispose() in onBeforeUnmount of the
 * parent component.
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
			const [pub, prv] = await Promise.all([
				readBalance(wallet, contract, "balance_of_public", accountAddress),
				readBalance(wallet, contract, "balance_of_private", accountAddress),
			])
			if (disposed) return
			publicBalance.value = pub
			privateBalance.value = prv
			error.value = null
		} catch (err) {
			if (disposed) return
			error.value = normalizeError(err).message
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

async function readBalance(
	wallet: Wallet,
	contract: unknown,
	fn: "balance_of_public" | "balance_of_private",
	account: AztecAddress,
): Promise<bigint> {
	const c = contract as ContractWithMethods
	const method = c.methods[fn]
	if (typeof method !== "function") {
		throw new Error(`Token contract is missing method ${fn}`)
	}
	const exec = (await method(account).request()) as ExecutionPayloadShape
	const call = exec.calls?.[0]
	if (!call) {
		throw new Error(`${fn} produced no FunctionCall`)
	}
	// ExecuteUtilityOptions publicly declares only `scopes` and optional
	// `authWitnesses`, but the execution service also requires `capsules`
	// and `extraHashedArgs` at runtime — see playground simulation.ts:106
	// for the same boundary cast.
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
