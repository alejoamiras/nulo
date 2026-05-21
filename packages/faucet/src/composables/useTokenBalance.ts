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
 * Per-token balance reader. Polls `balance_of_public` and `balance_of_private`
 * every 15s via `wallet.executeUtility(...)` — NOT `simulateUtility`. The
 * canonical option shape (with empty `scopes`/`authWitnesses`/`capsules`/
 * `extraHashedArgs` arrays) matches the playground at
 * `packages/playground/src/sections/simulation.ts:99` (codex audit r1).
 *
 * Caller owns lifecycle: invoke `dispose()` in `onBeforeUnmount` of the
 * parent component (per CLAUDE.md composable rule).
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
			const opts = {
				from: accountAddress,
				scopes: [],
				authWitnesses: [],
				capsules: [],
				extraHashedArgs: [],
			}
			const [pub, prv] = await Promise.all([
				readBalance(wallet, contract, "balance_of_public", accountAddress, opts),
				readBalance(wallet, contract, "balance_of_private", accountAddress, opts),
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

interface ExecuteUtilityOpts {
	from: AztecAddress
	scopes: AztecAddress[]
	authWitnesses: unknown[]
	capsules: unknown[]
	extraHashedArgs: unknown[]
}

async function readBalance(
	wallet: Wallet,
	contract: unknown,
	fn: "balance_of_public" | "balance_of_private",
	account: AztecAddress,
	opts: ExecuteUtilityOpts,
): Promise<bigint> {
	const c = contract as ContractWithMethods
	const method = c.methods[fn]
	if (typeof method !== "function") {
		throw new Error(`Token contract is missing method ${fn}`)
	}
	const call = await method(account).request()
	// SDK `executeUtility` is typed against zod-inferred shapes; the
	// playground casts at the boundary. We do the same in one spot.
	// biome-ignore lint/suspicious/noExplicitAny: SDK uses zod-inferred types
	const result = await (wallet as any).executeUtility(call, opts)
	return toBigInt(result)
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
