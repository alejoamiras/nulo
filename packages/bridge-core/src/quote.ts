/**
 * Off-chain fuel quoting: chained single-hop `quoteExactInputSingle` eth_calls against the
 * canonical V4 Quoter (the quoter is `nonpayable` BY DESIGN — it uses transient state — so
 * quoting goes through eth_call simulation, zero gas). The quote is DISPLAY + floor input
 * only; the on-chain bound is the signed `minFuelOutput`, and the claim side must always
 * use the event-sourced `fuelReceived`, never this estimate.
 */
import type { Address } from "viem"
import type { PoolKey } from "./l1"
import type { FuelRoute } from "./route"

const QUOTER_ABI = [
	{
		type: "function",
		name: "quoteExactInputSingle",
		stateMutability: "nonpayable",
		inputs: [
			{
				name: "params",
				type: "tuple",
				components: [
					{
						name: "poolKey",
						type: "tuple",
						components: [
							{ name: "currency0", type: "address" },
							{ name: "currency1", type: "address" },
							{ name: "fee", type: "uint24" },
							{ name: "tickSpacing", type: "int24" },
							{ name: "hooks", type: "address" },
						],
					},
					{ name: "zeroForOne", type: "bool" },
					{ name: "exactAmount", type: "uint128" },
					{ name: "hookData", type: "bytes" },
				],
			},
		],
		outputs: [
			{ name: "amountOut", type: "uint256" },
			{ name: "gasEstimate", type: "uint256" },
		],
	},
] as const

/** The viem surface this module needs — a PublicClient satisfies it. */
export interface QuoteClient {
	readContract(args: {
		address: Address
		abi: typeof QUOTER_ABI
		functionName: "quoteExactInputSingle"
		args: readonly [
			{
				poolKey: PoolKey
				zeroForOne: boolean
				exactAmount: bigint
				hookData: `0x${string}`
			},
		]
	}): Promise<readonly [bigint, bigint]>
}

/** Thrown when the route cannot currently produce output (no pool, no liquidity, dust). */
export class QuoteUnavailableError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options)
		this.name = "QuoteUnavailableError"
	}
}

/** Chains per-hop quotes (each hop's output feeds the next); returns the expected FJ out. */
export async function quoteFuelPath(client: QuoteClient, quoter: Address, route: FuelRoute, amountIn: bigint): Promise<bigint> {
	if (amountIn <= 0n) throw new QuoteUnavailableError("Quote requires a positive input amount.")
	let current = amountIn
	for (let i = 0; i < route.path.length; i++) {
		try {
			const [amountOut] = await client.readContract({
				address: quoter,
				abi: QUOTER_ABI,
				functionName: "quoteExactInputSingle",
				args: [{ poolKey: route.path[i], zeroForOne: route.zeroForOnes[i], exactAmount: current, hookData: "0x" }],
			})
			current = amountOut
		} catch (e) {
			throw new QuoteUnavailableError(`No route available through hop ${i + 1} right now.`, { cause: e })
		}
		if (current <= 0n) throw new QuoteUnavailableError(`Hop ${i + 1} quotes to zero - amount too small or pool drained.`)
	}
	return current
}

/** The signed slippage floor: quote minus `bps` (e.g. 300 = 3%). Never 0 — a zero floor signs the slice away. */
export function minOutputForSlippage(quote: bigint, bps: number): bigint {
	if (quote <= 0n) throw new QuoteUnavailableError("Cannot derive a floor from an empty quote.")
	if (bps < 0 || bps >= 10_000) throw new Error("minOutputForSlippage: bps out of range")
	const floor = (quote * BigInt(10_000 - bps)) / 10_000n
	return floor > 0n ? floor : 1n
}
